// Covenant Creative Recruiting Hub: local server with a built-in database.
// Run:  node recruiting/server.mjs    then open http://localhost:5190
// No installs needed (uses Node's built-in SQLite). Data lives in recruiting/data/.
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile, writeFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { dirname, join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, 'public');
const dataDir = process.env.RECRUITING_DATA || join(here, 'data');
mkdirSync(join(dataDir, 'batches'), { recursive: true });
const PORT = Number(process.env.PORT) || 5190;
const HOST = process.env.HOST || '127.0.0.1';

import { createCore, HttpError } from './public/core.js';

const db = new DatabaseSync(join(dataDir, 'recruiting.db'));
const core = createCore(db, { startCommand, kill: killTree });
const { state, settings, setSetting, log, now, batchItems, toCSV, appendLog, closeBatch, DANGER } = core;

// ---------- running the DM script (office computer only) ----------
function killTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F']);
  else proc.kill('SIGTERM');
}

async function startCommand(batch, s, who) {
  const items = batchItems(batch.id);
  const file = join(dataDir, 'batches', `batch-${batch.id}.csv`);
  await writeFile(file, toCSV(items, ['handle', 'name', 'phone', 'program', 'league', 'region']));
  const cmd = s.send_command.includes('{file}') ? s.send_command.replaceAll('{file}', `"${file}"`) : `${s.send_command} "${file}"`;
  appendLog(batch.id, `[${now()}] Running: ${cmd}\n`);
  const proc = spawn(cmd, {
    shell: true, cwd: s.send_cwd || here, windowsHide: true,
    env: { ...process.env, BATCH_FILE: file, BATCH_ID: String(batch.id), MESSAGE_TEMPLATE: s.message_template, PYTHONUNBUFFERED: '1' },
  });
  const run = { batchId: batch.id, proc, sent: new Set(), failed: new Set(), stopReason: null };
  state.running = run;
  let buf = '';
  const onLine = (line) => {
    let m;
    if ((m = line.match(/^\s*SENT[:\s]+@?(\S+)/i))) run.sent.add(m[1]);
    else if ((m = line.match(/^\s*FAIL(?:ED)?[:\s]+@?(\S+)/i))) run.failed.add(m[1]);
    if (!run.stopReason && DANGER.test(line)) {
      run.stopReason = `Script output mentioned "${line.match(DANGER)[0]}". Sending was paused to protect the account.`;
      setSetting('paused', '1');
      appendLog(batch.id, `\n[${now()}] AUTO-STOP: ${run.stopReason}\n`);
      killTree(proc);
    }
  };
  const onData = (chunk) => {
    const text = chunk.toString();
    appendLog(batch.id, text);
    buf += text;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i)); buf = buf.slice(i + 1); }
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  proc.on('error', (e) => appendLog(batch.id, `\n[${now()}] Could not start the script: ${e.message}\n`));
  proc.on('close', (code) => {
    if (buf) onLine(buf);
    appendLog(batch.id, `\n[${now()}] Script ended (exit code ${code}).\n`);
    const reported = run.sent.size > 0 || run.failed.size > 0;
    let res;
    if (reported) res = closeBatch(batch.id, run.sent, run.failed, who, 'from script output');
    else if (code === 0 && !run.stopReason) res = closeBatch(batch.id, null, [], who, 'script finished without errors');
    else res = closeBatch(batch.id, [], [], who, run.stopReason ? 'auto-stopped' : `script error, exit code ${code}`);
    appendLog(batch.id, `[${now()}] Result: ${res.sent} sent, ${res.failed} failed, ${res.notSent} not sent.\n`);
    if (state.running === run) state.running = null;
  });
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

// ---------- phone / other-device access ----------
// The computer running the hub never needs a passcode. Any other device (a phone on the
// same Wi-Fi, or over Tailscale) must sign in with the passcode set on the computer.
db.exec(`CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, created_at TEXT, ip TEXT, agent TEXT)`);
const SESSION_DAYS = 90;
const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const passcodeHash = () => db.prepare("SELECT value FROM settings WHERE key = 'passcode_hash'").get()?.value || '';
function hashPasscode(code, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(String(code), salt, 32).toString('hex')}`;
}
function checkPasscode(code) {
  const stored = passcodeHash();
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const a = Buffer.from(hash, 'hex'), b = scryptSync(String(code), salt, 32);
  return a.length === b.length && timingSafeEqual(a, b);
}
const cookieToken = (req) => (req.headers.cookie || '').split(/;\s*/).map((c) => c.split('=')).find(([k]) => k === 'hub_session')?.[1] || '';
function hasSession(req) {
  const t = cookieToken(req);
  if (!t) return false;
  const row = db.prepare('SELECT created_at FROM sessions WHERE token = ?').get(t);
  if (!row) return false;
  return Date.now() - new Date(row.created_at.replace(' ', 'T')).getTime() < SESSION_DAYS * 864e5;
}
const failedLogins = new Map(); // ip -> { n, until }
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ name, url: `http://${a.address}:${PORT}`, tailscale: /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a.address) });
    }
  }
  return out;
}
async function handleAuth(req, res, url, send, readBody) {
  const local = isLocal(req);
  const ip = req.socket.remoteAddress;
  if (url.pathname === '/api/auth' && req.method === 'GET') {
    return send(200, {
      local, signedIn: local || hasSession(req), passcodeSet: !!passcodeHash(),
      shared: HOST !== '127.0.0.1' && HOST !== 'localhost', addresses: local ? lanAddresses() : undefined,
      devices: local ? db.prepare('SELECT count(*) n FROM sessions').get().n : undefined,
    });
  }
  if (url.pathname === '/api/login' && req.method === 'POST') {
    const f = failedLogins.get(ip);
    if (f && f.n >= 8 && f.until > Date.now()) return send(429, { error: 'Too many wrong tries. Wait 15 minutes.' });
    if (!passcodeHash()) return send(409, { error: 'No passcode is set yet. Set one in Settings on the computer running the hub.' });
    const body = await readBody();
    if (!checkPasscode(body.passcode || '')) {
      const n = (f && f.until > Date.now() ? f.n : 0) + 1;
      failedLogins.set(ip, { n, until: Date.now() + 15 * 60000 });
      return send(401, { error: 'Wrong passcode' });
    }
    failedLogins.delete(ip);
    const token = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions(token, created_at, ip, agent) VALUES (?, ?, ?, ?)').run(token, now(), ip, String(req.headers['user-agent'] || '').slice(0, 200));
    log(body.name || 'Someone', 'Signed in from another device', ip);
    res.setHeader('Set-Cookie', `hub_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`);
    return send(200, { ok: true });
  }
  if (url.pathname === '/api/logout' && req.method === 'POST') {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(cookieToken(req));
    res.setHeader('Set-Cookie', 'hub_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
    return send(200, { ok: true });
  }
  if (url.pathname === '/api/passcode' && req.method === 'POST') {
    if (!local) return send(403, { error: 'The passcode can only be changed on the computer running the hub.' });
    const body = await readBody();
    const code = String(body.passcode || '');
    if (code.length < 6) return send(400, { error: 'Use at least 6 characters' });
    setSetting('passcode_hash', hashPasscode(code));
    db.prepare('DELETE FROM sessions').run(); // old devices must sign in with the new passcode
    log(decodeURIComponent(req.headers['x-user'] || '') || 'Someone', 'Set the phone passcode', 'all other devices were signed out');
    return send(200, { ok: true });
  }
  if (url.pathname === '/api/devices/signout' && req.method === 'POST') {
    if (!local) return send(403, { error: 'Only from the computer running the hub' });
    const n = db.prepare('DELETE FROM sessions').run().changes;
    return send(200, { ok: true, removed: n });
  }
  return null;
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(obj));
  };
  const readBody = async () => {
    const chunks = [];
    let size = 0;
    for await (const c of req) { size += c.length; if (size > 25e6) throw new HttpError(413, 'Upload too large'); chunks.push(c); }
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  };
  if (url.pathname.startsWith('/api/')) {
    try {
      if ((await handleAuth(req, res, url, send, readBody)) !== null || res.headersSent) return;
    } catch (e) { return send(400, { error: e.message }); }
    if (!isLocal(req) && !hasSession(req)) return send(401, { error: 'Please sign in', login: true });
    // Block cross-site requests from other web pages (the hub's own page never sends these).
    const origin = req.headers.origin;
    if (origin && req.method !== 'GET' && new URL(origin).host !== req.headers.host) return send(403, { error: 'Blocked request from another site' });
    try {
      const body = req.method !== 'GET' && req.method !== 'DELETE' ? await readBody() : {};
      let who = 'Someone';
      try { who = decodeURIComponent(req.headers['x-user'] || '') || 'Someone'; } catch {}
      const out = await core.handle(req.method, url.pathname, Object.fromEntries(url.searchParams), body, who, isLocal(req));
      return send(200, out ?? { ok: true });
    } catch (e) {
      if (!(e instanceof HttpError)) console.error(e);
      return send(e.status || 500, { error: e.message || 'Something went wrong' });
    }
  }
  let path = decodeURIComponent(url.pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(publicDir, path));
  if (!file.startsWith(publicDir)) return res.writeHead(403).end();
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }).end(data);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(PORT, HOST, () => {
  console.log(`Covenant Creative Recruiting Hub: http://localhost:${PORT}`);
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
    console.log('\nPhone access is ON. On your phone, open one of these:');
    for (const a of lanAddresses()) console.log(`  ${a.url}   ${a.tailscale ? '(Tailscale: works from anywhere)' : `(same Wi-Fi, ${a.name})`}`);
    if (!passcodeHash()) console.log('  First set a passcode: Settings > Phone access, on this computer.');
    console.log('');
  }
  console.log(`Data is saved in ${join(dataDir, 'recruiting.db')}`);
});

process.on('SIGINT', () => { if (state.running) killTree(state.running.proc); process.exit(0); });
