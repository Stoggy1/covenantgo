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

const db = new DatabaseSync(join(dataDir, 'recruiting.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS creators (
  id INTEGER PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT, program TEXT NOT NULL DEFAULT 'live',
  followers INTEGER, max_diamonds INTEGER, league TEXT, region TEXT, country TEXT,
  phone TEXT, email TEXT, source TEXT, agency TEXT NOT NULL DEFAULT 'unmanaged',
  eligibility TEXT NOT NULL DEFAULT 'needs_data', multi_account INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new', notes TEXT,
  checked_at TEXT, messaged_at TEXT, created_at TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS creators_status ON creators(status, eligibility, program);
CREATE TABLE IF NOT EXISTS batches (
  id INTEGER PRIMARY KEY, program TEXT, created_at TEXT, created_by TEXT,
  status TEXT NOT NULL DEFAULT 'ready', started_at TEXT, finished_at TEXT,
  sent_count INTEGER NOT NULL DEFAULT 0, log TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS batch_items (
  batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  creator_id INTEGER NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  result TEXT NOT NULL DEFAULT 'pending',
  PRIMARY KEY (batch_id, creator_id)
);
CREATE TABLE IF NOT EXISTS api_checks (
  id INTEGER PRIMARY KEY, creator_id INTEGER, at TEXT, provider TEXT, ok INTEGER, detail TEXT
);
CREATE TABLE IF NOT EXISTS go_sales (
  id INTEGER PRIMARY KEY, creator_id INTEGER NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  month TEXT NOT NULL, videos INTEGER NOT NULL DEFAULT 0, sales REAL NOT NULL DEFAULT 0, notes TEXT,
  UNIQUE (creator_id, month)
);
CREATE TABLE IF NOT EXISTS rewards (
  id INTEGER PRIMARY KEY, creator_id INTEGER NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  kind TEXT, value REAL, status TEXT NOT NULL DEFAULT 'planned', date TEXT, notes TEXT
);
CREATE TABLE IF NOT EXISTS revenue (
  month TEXT PRIMARY KEY, revenue REAL, diamonds INTEGER, benchmark INTEGER,
  share_pct REAL NOT NULL DEFAULT 14, notes TEXT
);
CREATE TABLE IF NOT EXISTS hours (
  id INTEGER PRIMARY KEY, person TEXT NOT NULL, date TEXT NOT NULL, hours REAL NOT NULL, task TEXT
);
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY, at TEXT, who TEXT, action TEXT, detail TEXT
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`);

// ---------- helpers ----------
const pad = (n) => String(n).padStart(2, '0');
const now = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const today = () => now().slice(0, 10);
const thisMonth = () => now().slice(0, 7);
function weekStart() {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return now(d).slice(0, 10);
}
const nil = (v) => (v === undefined || v === '' ? null : v);

function toNum(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim().toLowerCase().replace(/[$,\s]/g, '');
  if (!s) return null;
  let mult = 1;
  if (s.endsWith('k')) { mult = 1e3; s = s.slice(0, -1); }
  else if (s.endsWith('m')) { mult = 1e6; s = s.slice(0, -1); }
  else if (s.endsWith('b')) { mult = 1e9; s = s.slice(0, -1); }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n * mult : null;
}
const toInt = (v) => { const n = toNum(v); return n === null ? null : Math.round(n); };

function cleanHandle(h) {
  if (!h) return '';
  let s = String(h).trim();
  const m = s.match(/tiktok\.com\/@([^/?#\s]+)/i);
  if (m) s = m[1];
  return s.replace(/^@+/, '').trim();
}
function cleanAgency(v) {
  if (v === null || v === undefined || String(v).trim() === '') return undefined;
  const s = String(v).trim().toLowerCase();
  if (/^(no|none|n\/a|unmanaged|false|0|independent|no agency)$/.test(s)) return 'unmanaged';
  if (s === 'unknown') return 'unknown';
  return 'managed';
}
const isUS = (c) => !c || /^(us|usa|u\.s\.|u\.s\.a\.|united states|united states of america)$/i.test(String(c).trim());
const NON_US_SQL = `(country IS NOT NULL AND country <> '' AND upper(country) NOT IN ('US','USA','U.S.','U.S.A.','UNITED STATES','UNITED STATES OF AMERICA'))`;

const DEFAULTS = {
  batch_size: '350', daily_cap: '1500', cooldown_min: '60', paused: '0',
  api_daily_quota: '2200', follower_limit: '200000', diamond_limit: '200000', premium_invites_left: '2',
  weekly_hours_cap: '10',
  api_mode: 'demo', api_url: '', api_key: '', api_key_header: 'x-api-key',
  map_followers: 'followers', map_diamonds: 'max_monthly_diamonds', map_league: 'league',
  map_region: 'region', map_country: 'country',
  send_mode: 'export', send_command: '', send_cwd: '',
  message_template: "Hi {name}! I'm with Covenant Creative, a TikTok LIVE agency. We'd love to help you grow your LIVEs. Want to hear more?",
};
const SETTING_KEYS = Object.keys(DEFAULTS);
function settings() {
  const s = { ...DEFAULTS };
  for (const r of db.prepare('SELECT key, value FROM settings').all()) if (r.key in s) s[r.key] = r.value;
  return s;
}
function setSetting(k, v) {
  db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v));
}
function log(who, action, detail = '') {
  db.prepare('INSERT INTO activity(at, who, action, detail) VALUES (?, ?, ?, ?)').run(now(), who || 'Someone', action, String(detail));
}

// One rule for eligibility, from the TikTok LIVE invitation guidelines:
// regular invite = followers <= 200K AND highest monthly diamonds (last 6 months) <= 200K; otherwise premium.
function eligibilitySQL(where, ...whereArgs) {
  const s = settings();
  db.prepare(`UPDATE creators SET eligibility = CASE
      WHEN agency = 'managed' THEN 'ineligible'
      WHEN program = 'go' THEN 'regular'
      WHEN followers IS NULL OR max_diamonds IS NULL THEN 'needs_data'
      WHEN followers <= ? AND max_diamonds <= ? THEN 'regular'
      ELSE 'premium' END ${where}`).run(Number(s.follower_limit), Number(s.diamond_limit), ...whereArgs);
}
const refreshEligibility = (id) => eligibilitySQL('WHERE id = ?', id);
const refreshAllEligibility = () => eligibilitySQL('');

// ---------- creators ----------
const ALIASES = {
  handle: ['handle', 'username', 'user', 'tiktokhandle', 'tiktokusername', 'uniqueid', 'creatorhandle', 'creatorusername', 'account', 'creator', 'tiktok', 'profile', 'url', 'link'],
  name: ['name', 'displayname', 'nickname', 'creatorname', 'fullname'],
  followers: ['followers', 'followercount', 'follower', 'fans', 'followerscount', 'totalfollowers'],
  max_diamonds: ['maxdiamonds', 'highestmonthlydiamonds', 'maxmonthlydiamonds', 'diamonds', 'monthlydiamonds', 'diamonds6mo', 'peakdiamonds'],
  league: ['league', 'tier', 'livetier', 'liveleague'],
  region: ['region', 'state', 'city', 'location', 'area'],
  country: ['country', 'countrycode', 'market'],
  phone: ['phone', 'phonenumber', 'mobile', 'tel', 'cell'],
  email: ['email', 'emailaddress'],
  agency: ['agency', 'agencystatus', 'managed'],
  notes: ['notes', 'note', 'comments'],
  program: ['program', 'type'],
  month: ['month', 'period'],
  videos: ['videos', 'govideos', 'posts', 'videocount'],
  sales: ['sales', 'gmv', 'salesusd', 'gosales', 'revenue'],
};
function mapRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row || {})) {
    const nk = String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const [field, list] of Object.entries(ALIASES)) {
      if (out[field] === undefined && list.includes(nk)) { out[field] = v; break; }
    }
  }
  return out;
}

const EDITABLE = ['name', 'program', 'followers', 'max_diamonds', 'league', 'region', 'country', 'phone', 'email', 'source', 'agency', 'notes', 'multi_account'];
function normalizeFields(data) {
  const v = {};
  for (const f of EDITABLE) {
    if (data[f] === undefined) continue;
    let x = data[f];
    if (f === 'followers' || f === 'max_diamonds') x = toInt(x);
    else if (f === 'agency') { x = cleanAgency(x); if (x === undefined) continue; }
    else if (f === 'multi_account') x = x ? 1 : 0;
    else if (f === 'program') x = /go/i.test(String(x)) ? 'go' : 'live';
    else if (f === 'league') x = nil(String(x).trim().toUpperCase().replace(/^LEAGUE\s*/, ''));
    else x = nil(typeof x === 'string' ? x.trim() : x);
    v[f] = x;
  }
  return v;
}
function upsertCreator(data, { overwriteBlank = false } = {}) {
  const handle = cleanHandle(data.handle);
  if (!handle) return null;
  const fields = normalizeFields(data);
  if (!overwriteBlank) for (const k of Object.keys(fields)) if (fields[k] === null) delete fields[k];
  const existing = db.prepare('SELECT id FROM creators WHERE handle = ?').get(handle);
  let id;
  if (existing) {
    id = existing.id;
    const keys = Object.keys(fields);
    if (keys.length) {
      db.prepare(`UPDATE creators SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
        .run(...keys.map((k) => fields[k]), now(), id);
    }
  } else {
    const keys = Object.keys(fields);
    const r = db.prepare(`INSERT INTO creators (handle, ${[...keys, 'created_at', 'updated_at'].join(', ')}) VALUES (?, ${[...keys, 1, 2].map(() => '?').join(', ')})`)
      .run(handle, ...keys.map((k) => fields[k]), now(), now());
    id = Number(r.lastInsertRowid);
  }
  refreshEligibility(id);
  return { id, created: !existing };
}

const SORTS = {
  newest: 'id DESC', oldest: 'id ASC', followers: 'followers DESC NULLS LAST', diamonds: 'max_diamonds DESC NULLS LAST',
  handle: 'handle COLLATE NOCASE ASC', updated: 'updated_at DESC',
};
function creatorFilters(q) {
  const where = [], args = [];
  if (q.q) { where.push('(handle LIKE ? OR name LIKE ? OR notes LIKE ? OR source LIKE ?)'); const l = `%${q.q.replace(/^@/, '')}%`; args.push(l, l, l, l); }
  for (const f of ['status', 'eligibility', 'program', 'league', 'source']) if (q[f]) { where.push(`${f} = ?`); args.push(q[f]); }
  if (q.flag === 'multi') where.push('multi_account = 1');
  if (q.flag === 'nonus') where.push(NON_US_SQL);
  if (q.flag === 'any') where.push(`(multi_account = 1 OR ${NON_US_SQL})`);
  if (q.region) { where.push('region LIKE ?'); args.push(`%${q.region}%`); }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', args };
}
const withFlags = (c) => ({ ...c, non_us: !isUS(c.country) });

// ---------- API lookups ----------
function hash(s) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function demoLookup(handle) {
  const r = (salt) => (hash(handle.toLowerCase() + salt) % 10000) / 10000;
  const followers = Math.round(600 + Math.pow(r('f'), 3) * 420000);
  const max_diamonds = Math.round(Math.pow(r('d'), 2.6) * 360000);
  const league = max_diamonds > 150000 ? 'A' : max_diamonds > 40000 ? 'B' : max_diamonds > 8000 ? 'C' : 'D';
  const regions = ['TX', 'CA', 'FL', 'NY', 'GA', 'IL', 'AZ', 'NC', 'OH', 'WA', 'NV', 'TN'];
  const country = r('c') < 0.9 ? 'US' : ['MX', 'RO', 'CN', 'PH'][hash(handle) % 4];
  return { followers, max_diamonds, league, region: regions[hash(handle + 'r') % regions.length], country };
}
const getPath = (o, p) => (p ? String(p).split('.').reduce((a, k) => (a == null ? a : a[k]), o) : undefined);
async function httpLookup(handle, s) {
  if (!s.api_url) throw new Error('No API address set (Settings → Creator data API)');
  const url = s.api_url.replaceAll('{handle}', encodeURIComponent(handle));
  const headers = { accept: 'application/json' };
  if (s.api_key) headers[s.api_key_header || 'x-api-key'] = s.api_key;
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`API answered ${r.status}`);
  const j = await r.json();
  return {
    followers: toInt(getPath(j, s.map_followers)), max_diamonds: toInt(getPath(j, s.map_diamonds)),
    league: nil(getPath(j, s.map_league) ?? null), region: nil(getPath(j, s.map_region) ?? null),
    country: nil(getPath(j, s.map_country) ?? null), raw: j,
  };
}
const lookup = (handle, s) => (s.api_mode === 'http' ? httpLookup(handle, s) : demoLookup(handle));
const apiUsedToday = () => db.prepare('SELECT count(*) n FROM api_checks WHERE substr(at, 1, 10) = ?').get(today()).n;

async function runChecks(ids, who) {
  const s = settings();
  const left = Math.max(0, Number(s.api_daily_quota) - apiUsedToday());
  const todo = ids.slice(0, Math.min(left, 500));
  const out = { checked: 0, failed: 0, skipped_quota: ids.length - todo.length, errors: [], demo: s.api_mode !== 'http' };
  const provider = s.api_mode === 'http' ? (() => { try { return new URL(s.api_url).host; } catch { return 'http'; } })() : 'demo';
  let i = 0;
  const worker = async () => {
    while (i < todo.length) {
      const c = db.prepare('SELECT id, handle FROM creators WHERE id = ?').get(todo[i++]);
      if (!c) continue;
      try {
        const d = await lookup(c.handle, s);
        db.prepare(`UPDATE creators SET followers = coalesce(?, followers), max_diamonds = coalesce(?, max_diamonds),
          league = coalesce(?, league), region = coalesce(?, region), country = coalesce(?, country), checked_at = ?, updated_at = ? WHERE id = ?`)
          .run(d.followers, d.max_diamonds, d.league == null ? null : String(d.league).toUpperCase(), d.region, d.country, now(), now(), c.id);
        refreshEligibility(c.id);
        db.prepare('INSERT INTO api_checks(creator_id, at, provider, ok, detail) VALUES (?, ?, ?, 1, ?)').run(c.id, now(), provider, JSON.stringify({ ...d, raw: undefined }));
        out.checked++;
      } catch (e) {
        db.prepare('INSERT INTO api_checks(creator_id, at, provider, ok, detail) VALUES (?, ?, ?, 0, ?)').run(c.id, now(), provider, e.message);
        out.failed++;
        if (out.errors.length < 5) out.errors.push(`@${c.handle}: ${e.message}`);
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  log(who, 'Checked creators', `${out.checked} checked, ${out.failed} failed${out.demo ? ' (demo data)' : ''}${out.skipped_quota ? `, ${out.skipped_quota} skipped: daily limit` : ''}`);
  return out;
}

// ---------- outreach batches ----------
let running = null; // { batchId, proc, sent:Set, failed:Set, stopReason }
const DANGER = /(spam|rate.?limit|too many requests|temporarily (blocked|restricted)|captcha|verify you'?re human|account (is )?(restricted|suspended))/i;

function guards() {
  const s = settings();
  const sentToday = db.prepare('SELECT count(*) n FROM creators WHERE substr(messaged_at, 1, 10) = ?').get(today()).n;
  const last = db.prepare("SELECT max(finished_at) t FROM batches WHERE status IN ('sent', 'partial')").get().t;
  let cooldownLeft = 0;
  if (last) {
    const mins = (Date.now() - new Date(last.replace(' ', 'T')).getTime()) / 60000;
    cooldownLeft = Math.max(0, Math.ceil(Number(s.cooldown_min) - mins));
  }
  const open = db.prepare("SELECT id, status FROM batches WHERE status IN ('ready', 'sending') ORDER BY id DESC LIMIT 1").get() || null;
  return {
    sentToday, dailyCap: Number(s.daily_cap), remainingToday: Math.max(0, Number(s.daily_cap) - sentToday),
    batchSize: Number(s.batch_size), cooldownLeft, cooldownMin: Number(s.cooldown_min), lastFinished: last,
    paused: s.paused === '1', running: running ? running.batchId : null, openBatch: open, sendMode: s.send_mode,
  };
}
const batchItems = (id) => db.prepare(`SELECT c.id, c.handle, c.name, c.phone, c.program, c.league, c.region, c.status, bi.result
  FROM batch_items bi JOIN creators c ON c.id = bi.creator_id WHERE bi.batch_id = ? ORDER BY c.handle COLLATE NOCASE`).all(id);
const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCSV = (rows, cols) => [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n';
function appendLog(id, text) {
  db.prepare('UPDATE batches SET log = substr(log || ?, -30000) WHERE id = ?').run(text, id);
}

function closeBatch(id, sentHandles, failedHandles, who, how) {
  // sentHandles === null means "everything still pending was sent".
  const items = batchItems(id);
  const sentSet = sentHandles ? new Set([...sentHandles].map((h) => cleanHandle(h).toLowerCase())) : null;
  const failSet = new Set([...(failedHandles || [])].map((h) => cleanHandle(h).toLowerCase()));
  let sent = 0, failed = 0, notSent = 0;
  const ts = now();
  db.exec('BEGIN');
  try {
    for (const it of items) {
      if (it.result !== 'pending') continue;
      const h = it.handle.toLowerCase();
      let result;
      if (failSet.has(h)) result = 'failed';
      else if (sentSet === null || sentSet.has(h)) result = 'sent';
      else result = 'not_sent';
      db.prepare('UPDATE batch_items SET result = ? WHERE batch_id = ? AND creator_id = ?').run(result, id, it.id);
      if (result === 'sent') {
        sent++;
        db.prepare("UPDATE creators SET status = 'messaged', messaged_at = ?, updated_at = ? WHERE id = ? AND status = 'queued'").run(ts, ts, it.id);
      } else {
        result === 'failed' ? failed++ : notSent++;
        db.prepare("UPDATE creators SET status = 'new', updated_at = ? WHERE id = ? AND status = 'queued'").run(ts, it.id);
      }
    }
    const status = sent === 0 ? 'error' : failed + notSent > 0 ? 'partial' : 'sent';
    db.prepare('UPDATE batches SET status = ?, finished_at = ?, sent_count = sent_count + ? WHERE id = ?').run(status, sent ? ts : null, sent, id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  log(who, `Batch #${id} finished`, `${sent} sent, ${failed} failed, ${notSent} not sent (${how}). Failed and not-sent creators go back to the queue.`);
  return { sent, failed, notSent };
}

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
  running = run;
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
    if (running === run) running = null;
  });
}

// ---------- sample data (clearly labeled, removable) ----------
function loadSample(who) {
  const first = ['sunny', 'mila', 'jay', 'rosa', 'dev', 'kai', 'nova', 'luz', 'tre', 'ivy', 'beau', 'zara', 'cruz', 'remy', 'gia'];
  const last = ['vibes', 'lives', 'eats', 'travels', 'styles', 'beauty', 'gaming', 'talks', 'cooks', 'fits'];
  let n = 0;
  db.exec('BEGIN');
  try {
    for (let i = 0; i < 60; i++) {
      const handle = `sample_${first[i % first.length]}${last[(i * 7) % last.length]}${i}`;
      const program = i % 4 === 0 ? 'go' : 'live';
      const d = program === 'live' && i % 5 !== 1 ? demoLookup(handle) : { country: i % 9 === 0 ? 'RO' : 'US', region: ['TX', 'CA', 'FL', 'NY'][i % 4] };
      const r = upsertCreator({ handle, name: `${first[i % first.length][0].toUpperCase()}${first[i % first.length].slice(1)} (sample)`, program, source: 'sample', multi_account: i % 17 === 3, ...d });
      if (r?.created) n++;
      if (program === 'go' && r) {
        for (const [k, m] of [[0, thisMonth()], [1, now(new Date(new Date().setDate(0))).slice(0, 7)]]) {
          const sales = Math.round((hash(handle + m) % 900000) / 100) / (k + 1);
          db.prepare('INSERT INTO go_sales(creator_id, month, videos, sales) VALUES (?, ?, ?, ?) ON CONFLICT(creator_id, month) DO NOTHING')
            .run(r.id, m, hash(handle + m + 'v') % 30, sales);
        }
      }
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  log(who, 'Loaded sample data', `${n} sample creators (handles start with "sample_")`);
  return { created: n };
}
function clearSample(who) {
  const n = db.prepare("DELETE FROM creators WHERE source = 'sample'").run().changes;
  db.prepare('DELETE FROM batches WHERE id NOT IN (SELECT DISTINCT batch_id FROM batch_items)').run();
  log(who, 'Removed sample data', `${n} sample creators removed`);
  return { removed: n };
}

// ---------- HTTP ----------
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const routes = [];
const route = (method, path, fn) => routes.push({ method, re: new RegExp(`^${path.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), fn });

route('GET', '/api/stats', () => {
  const s = settings();
  const count = (sql, ...a) => db.prepare(sql).get(...a).n;
  const byStatus = Object.fromEntries(db.prepare('SELECT status, count(*) n FROM creators GROUP BY status').all().map((r) => [r.status, r.n]));
  const byElig = Object.fromEntries(db.prepare('SELECT eligibility, count(*) n FROM creators GROUP BY eligibility').all().map((r) => [r.eligibility, r.n]));
  const byProgram = Object.fromEntries(db.prepare('SELECT program, count(*) n FROM creators GROUP BY program').all().map((r) => [r.program, r.n]));
  const readyToMessage = count(`SELECT count(*) n FROM creators WHERE status = 'new' AND eligibility = 'regular' AND multi_account = 0 AND NOT ${NON_US_SQL}`);
  const ws = weekStart();
  const hoursWeek = db.prepare('SELECT person, sum(hours) h FROM hours WHERE date >= ? GROUP BY person ORDER BY h DESC').all(ws);
  const topGo = db.prepare(`SELECT c.id, c.handle, c.name, g.sales, g.videos FROM go_sales g JOIN creators c ON c.id = g.creator_id
    WHERE g.month = ? ORDER BY g.sales DESC LIMIT 5`).all(thisMonth());
  const revenue = db.prepare('SELECT * FROM revenue ORDER BY month DESC LIMIT 6').all();
  return {
    total: count('SELECT count(*) n FROM creators'), byStatus, byElig, byProgram, readyToMessage,
    flagged: count(`SELECT count(*) n FROM creators WHERE multi_account = 1 OR ${NON_US_SQL}`),
    apiUsedToday: apiUsedToday(), apiQuota: Number(s.api_daily_quota), apiMode: s.api_mode,
    premiumLeft: Number(s.premium_invites_left), guards: guards(), hoursWeek, weekStart: ws, hoursCap: Number(s.weekly_hours_cap),
    topGo, month: thisMonth(), revenue, rewardsPlanned: count("SELECT count(*) n FROM rewards WHERE status = 'planned'"),
    sample: count("SELECT count(*) n FROM creators WHERE source = 'sample'"),
    recent: db.prepare('SELECT * FROM activity ORDER BY id DESC LIMIT 8').all(),
  };
});

route('GET', '/api/creators', ({ query }) => {
  const { sql, args } = creatorFilters(query);
  const limit = Math.min(500, Number(query.limit) || 100);
  const offset = Math.max(0, Number(query.offset) || 0);
  const order = SORTS[query.sort] || SORTS.newest;
  const total = db.prepare(`SELECT count(*) n FROM creators ${sql}`).get(...args).n;
  const rows = db.prepare(`SELECT * FROM creators ${sql} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, limit, offset).map(withFlags);
  const sources = db.prepare("SELECT DISTINCT source FROM creators WHERE source IS NOT NULL AND source <> '' ORDER BY source").all().map((r) => r.source);
  return { total, rows, sources };
});
route('GET', '/api/creators.csv', ({ query }) => {
  const { sql, args } = creatorFilters(query);
  const rows = db.prepare(`SELECT * FROM creators ${sql} ORDER BY id`).all(...args);
  return { csv: toCSV(rows, ['handle', 'name', 'program', 'followers', 'max_diamonds', 'league', 'region', 'country', 'phone', 'email', 'agency', 'eligibility', 'multi_account', 'status', 'source', 'messaged_at', 'checked_at', 'notes']), filename: `creators-${today()}.csv` };
});
route('GET', '/api/creators/:id', ({ params }) => {
  const c = db.prepare('SELECT * FROM creators WHERE id = ?').get(params.id);
  if (!c) throw new HttpError(404, 'Creator not found');
  return {
    creator: withFlags(c),
    sales: db.prepare('SELECT * FROM go_sales WHERE creator_id = ? ORDER BY month DESC').all(c.id),
    rewards: db.prepare('SELECT * FROM rewards WHERE creator_id = ? ORDER BY id DESC').all(c.id),
    checks: db.prepare('SELECT at, provider, ok, detail FROM api_checks WHERE creator_id = ? ORDER BY id DESC LIMIT 5').all(c.id),
    batches: db.prepare('SELECT b.id, b.status, b.finished_at, bi.result FROM batch_items bi JOIN batches b ON b.id = bi.batch_id WHERE bi.creator_id = ? ORDER BY b.id DESC').all(c.id),
  };
});
route('POST', '/api/creators', ({ body, who }) => {
  if (!cleanHandle(body.handle)) throw new HttpError(400, 'A TikTok handle is required');
  const r = upsertCreator(body);
  log(who, r.created ? 'Added creator' : 'Updated creator', `@${cleanHandle(body.handle)}`);
  return r;
});

const STATUSES = ['new', 'queued', 'messaged', 'replied', 'invited', 'joined', 'declined', 'verification_failed', 'do_not_contact'];
function setStatus(id, status, who) {
  if (!STATUSES.includes(status)) throw new HttpError(400, 'Unknown status');
  const c = db.prepare('SELECT * FROM creators WHERE id = ?').get(id);
  if (!c) throw new HttpError(404, 'Creator not found');
  if (c.status === status) return;
  if (status === 'queued') throw new HttpError(400, 'Creators are queued by building a batch on the Outreach page');
  if (status === 'invited' && c.eligibility === 'premium') {
    const left = Number(settings().premium_invites_left);
    if (left <= 0) throw new HttpError(409, `@${c.handle} needs a premium invite and there are none left. Update the count in Settings if you got more.`);
    setSetting('premium_invites_left', left - 1);
    log(who, 'Used a premium invite', `@${c.handle} (${left - 1} left)`);
  }
  if (c.status === 'queued') {
    db.prepare("UPDATE batch_items SET result = 'removed' WHERE creator_id = ? AND result = 'pending'").run(id);
  }
  db.prepare('UPDATE creators SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id);
  log(who, 'Changed status', `@${c.handle}: ${c.status} → ${status}`);
}
route('PATCH', '/api/creators/:id', ({ params, body, who }) => {
  const id = Number(params.id);
  const c = db.prepare('SELECT * FROM creators WHERE id = ?').get(id);
  if (!c) throw new HttpError(404, 'Creator not found');
  if (body.status) setStatus(id, body.status, who);
  const fields = normalizeFields(body);
  const keys = Object.keys(fields);
  if (keys.length) {
    db.prepare(`UPDATE creators SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...keys.map((k) => fields[k]), now(), id);
    refreshEligibility(id);
    const changed = keys.filter((k) => String(c[k] ?? '') !== String(fields[k] ?? ''));
    if (changed.length) log(who, 'Edited creator', `@${c.handle}: ${changed.join(', ')}`);
  }
  return withFlags(db.prepare('SELECT * FROM creators WHERE id = ?').get(id));
});
route('POST', '/api/creators/bulk', ({ body, who }) => {
  const ids = (body.ids || []).map(Number).filter(Boolean);
  const errors = [];
  let done = 0;
  if (body.action === 'status') for (const id of ids) { try { setStatus(id, body.status, who); done++; } catch (e) { errors.push(e.message); } }
  else if (body.action === 'delete') {
    for (const id of ids) {
      const c = db.prepare('SELECT handle, status FROM creators WHERE id = ?').get(id);
      if (!c) continue;
      if (c.status === 'queued') { errors.push(`@${c.handle} is in an open batch; cancel the batch first`); continue; }
      db.prepare('DELETE FROM creators WHERE id = ?').run(id); done++;
    }
    log(who, 'Deleted creators', `${done} deleted`);
  } else if (body.action === 'flag') {
    for (const id of ids) { db.prepare('UPDATE creators SET multi_account = ?, updated_at = ? WHERE id = ?').run(body.value ? 1 : 0, now(), id); done++; }
    log(who, body.value ? 'Flagged multi-account risk' : 'Cleared multi-account flag', `${done} creators`);
  } else throw new HttpError(400, 'Unknown action');
  return { done, errors: errors.slice(0, 10), errorCount: errors.length };
});

route('POST', '/api/import', ({ body, who }) => {
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const out = { created: 0, updated: 0, skipped: 0, sales: 0 };
  db.exec('BEGIN');
  try {
    for (const raw of rows) {
      const m = mapRow(raw);
      if (!cleanHandle(m.handle)) { out.skipped++; continue; }
      const data = { ...m, source: m.source || body.source || null, program: m.program || body.program || 'live' };
      if (body.type === 'go_sales') data.program = 'go';
      const r = upsertCreator(data);
      r.created ? out.created++ : out.updated++;
      if (body.type === 'go_sales') {
        const month = /^\d{4}-\d{2}/.test(String(m.month || '')) ? String(m.month).slice(0, 7) : body.month || thisMonth();
        db.prepare(`INSERT INTO go_sales(creator_id, month, videos, sales) VALUES (?, ?, ?, ?)
          ON CONFLICT(creator_id, month) DO UPDATE SET videos = excluded.videos, sales = excluded.sales`)
          .run(r.id, month, toInt(m.videos) || 0, toNum(m.sales) || 0);
        out.sales++;
      }
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  log(who, body.type === 'go_sales' ? 'Imported Go sales' : 'Imported creators', `${out.created} new, ${out.updated} updated, ${out.skipped} skipped${body.source ? ` (list: ${body.source})` : ''}`);
  return out;
});

route('POST', '/api/check', async ({ body, who }) => {
  let ids = (body.ids || []).map(Number).filter(Boolean);
  if (body.scope === 'needs_data') {
    ids = db.prepare("SELECT id FROM creators WHERE eligibility = 'needs_data' AND program = 'live' ORDER BY checked_at IS NOT NULL, id LIMIT ?")
      .all(Number(body.limit) || 200).map((r) => r.id);
  }
  if (!ids.length) throw new HttpError(400, 'No creators to check');
  return runChecks(ids, who);
});
route('POST', '/api/check/test', async ({ body }) => {
  const s = { ...settings(), ...(body.settings || {}) };
  if (body.settings?.api_key === '••••••••') s.api_key = settings().api_key;
  const d = await lookup(cleanHandle(body.handle) || 'example', s);
  return d;
});

route('GET', '/api/batches', () => ({
  guards: guards(),
  batches: db.prepare(`SELECT b.id, b.program, b.created_at, b.created_by, b.status, b.started_at, b.finished_at, b.sent_count,
    (SELECT count(*) FROM batch_items WHERE batch_id = b.id) size FROM batches b ORDER BY b.id DESC LIMIT 100`).all(),
}));
route('GET', '/api/batches/:id', ({ params }) => {
  const b = db.prepare('SELECT * FROM batches WHERE id = ?').get(params.id);
  if (!b) throw new HttpError(404, 'Batch not found');
  return { batch: b, items: batchItems(b.id), guards: guards(), running: running?.batchId === b.id };
});
route('GET', '/api/batches/:id/csv', ({ params }) => ({
  csv: toCSV(batchItems(Number(params.id)), ['handle', 'name', 'phone', 'program', 'league', 'region']),
  filename: `batch-${params.id}-${today()}.csv`,
}));
route('POST', '/api/batches', ({ body, who }) => {
  const g = guards();
  if (g.openBatch) throw new HttpError(409, `Batch #${g.openBatch.id} is still open. Finish or cancel it first.`);
  if (g.remainingToday <= 0) throw new HttpError(409, `Today's limit of ${g.dailyCap} messages is reached. Try again tomorrow.`);
  const size = Math.max(1, Math.min(Number(body.size) || g.batchSize, g.batchSize, g.remainingToday));
  const program = body.program === 'go' ? 'go' : 'live';
  const where = ["status = 'new'", "eligibility = 'regular'", 'multi_account = 0', `NOT ${NON_US_SQL}`, 'program = ?'];
  const args = [program];
  if (body.league) { where.push('league = ?'); args.push(body.league); }
  if (body.region) { where.push('region LIKE ?'); args.push(`%${body.region}%`); }
  if (body.source) { where.push('source = ?'); args.push(body.source); }
  const ids = db.prepare(`SELECT id FROM creators WHERE ${where.join(' AND ')} ORDER BY id LIMIT ?`).all(...args, size).map((r) => r.id);
  if (!ids.length) throw new HttpError(404, 'No creators match: they need status "New", a regular invite, no multi-account flag, and a US account.');
  db.exec('BEGIN');
  let id;
  try {
    id = Number(db.prepare('INSERT INTO batches(program, created_at, created_by) VALUES (?, ?, ?)').run(program, now(), who).lastInsertRowid);
    for (const cid of ids) {
      db.prepare('INSERT INTO batch_items(batch_id, creator_id) VALUES (?, ?)').run(id, cid);
      db.prepare("UPDATE creators SET status = 'queued', updated_at = ? WHERE id = ?").run(now(), cid);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  log(who, `Built batch #${id}`, `${ids.length} ${program === 'go' ? 'Go' : 'LIVE'} creators`);
  return { id, size: ids.length };
});
route('POST', '/api/batches/:id/start', async ({ params, who }) => {
  const id = Number(params.id);
  const b = db.prepare('SELECT * FROM batches WHERE id = ?').get(id);
  if (!b) throw new HttpError(404, 'Batch not found');
  if (b.status !== 'ready') throw new HttpError(409, 'This batch was already started');
  const g = guards();
  const s = settings();
  if (g.paused) throw new HttpError(409, 'Sending is paused. Turn it back on from the Outreach page once the account is safe.');
  if (g.running) throw new HttpError(409, `Batch #${g.running} is still running`);
  if (g.cooldownLeft > 0) throw new HttpError(409, `Wait ${g.cooldownLeft} more minute(s) between batches to avoid spam blocks.`);
  const size = db.prepare("SELECT count(*) n FROM batch_items WHERE batch_id = ? AND result = 'pending'").get(id).n;
  if (size > g.remainingToday) throw new HttpError(409, `This batch has ${size} creators but only ${g.remainingToday} messages are left today.`);
  if (s.send_mode === 'command' && !s.send_command.trim()) throw new HttpError(400, 'No script command set (Settings → Sending)');
  db.prepare("UPDATE batches SET status = 'sending', started_at = ? WHERE id = ?").run(now(), id);
  log(who, `Started batch #${id}`, s.send_mode === 'command' ? 'running the messaging script' : 'sending by hand / outside the hub');
  if (s.send_mode === 'command') await startCommand(b, s, who);
  return { ok: true };
});
route('POST', '/api/batches/:id/finish', ({ params, body, who }) => {
  const id = Number(params.id);
  const b = db.prepare('SELECT * FROM batches WHERE id = ?').get(id);
  if (!b || b.status !== 'sending') throw new HttpError(409, 'Only a batch that is sending can be marked done');
  if (running?.batchId === id) throw new HttpError(409, 'The script is still running');
  const failed = String(body.failed || '').split(/[\s,;]+/).filter(Boolean);
  return closeBatch(id, null, failed, who, 'marked done by hand');
});
route('POST', '/api/batches/:id/stop', ({ params, who }) => {
  if (running?.batchId !== Number(params.id)) throw new HttpError(409, 'That batch is not running');
  running.stopReason = `Stopped by ${who}`;
  appendLog(running.batchId, `\n[${now()}] Stopped by ${who}\n`);
  killTree(running.proc);
  return { ok: true };
});
route('POST', '/api/batches/:id/cancel', ({ params, who }) => {
  const id = Number(params.id);
  if (running?.batchId === id) throw new HttpError(409, 'Stop the script first');
  const b = db.prepare('SELECT * FROM batches WHERE id = ?').get(id);
  if (!b || !['ready', 'sending'].includes(b.status)) throw new HttpError(409, 'Only an open batch can be cancelled');
  db.prepare("UPDATE creators SET status = 'new', updated_at = ? WHERE status = 'queued' AND id IN (SELECT creator_id FROM batch_items WHERE batch_id = ? AND result = 'pending')").run(now(), id);
  db.prepare("UPDATE batch_items SET result = 'cancelled' WHERE batch_id = ? AND result = 'pending'").run(id);
  db.prepare("UPDATE batches SET status = 'cancelled' WHERE id = ?").run(id);
  log(who, `Cancelled batch #${id}`, 'its creators went back to the queue');
  return { ok: true };
});
route('POST', '/api/pause', ({ body, who }) => {
  setSetting('paused', body.paused ? '1' : '0');
  if (body.paused && running) { running.stopReason = `Paused by ${who}`; killTree(running.proc); }
  log(who, body.paused ? 'Paused all sending' : 'Turned sending back on');
  return guards();
});

// Go sales & rewards
route('GET', '/api/go', ({ query }) => {
  const month = query.month || thisMonth();
  return {
    month,
    months: db.prepare('SELECT DISTINCT month FROM go_sales ORDER BY month DESC').all().map((r) => r.month),
    rows: db.prepare(`SELECT g.*, c.handle, c.name, c.country FROM go_sales g JOIN creators c ON c.id = g.creator_id WHERE g.month = ? ORDER BY g.sales DESC`).all(month).map(withFlags),
    allTime: db.prepare(`SELECT c.id, c.handle, c.name, sum(g.sales) sales, sum(g.videos) videos, count(*) months FROM go_sales g JOIN creators c ON c.id = g.creator_id GROUP BY c.id ORDER BY sales DESC LIMIT 15`).all(),
    rewards: db.prepare('SELECT r.*, c.handle, c.name FROM rewards r JOIN creators c ON c.id = r.creator_id ORDER BY r.status = \'sent\', r.id DESC').all(),
  };
});
route('POST', '/api/go', ({ body, who }) => {
  const r = upsertCreator({ handle: body.handle, program: 'go' });
  if (!r) throw new HttpError(400, 'A TikTok handle is required');
  const month = /^\d{4}-\d{2}$/.test(body.month) ? body.month : thisMonth();
  db.prepare(`INSERT INTO go_sales(creator_id, month, videos, sales, notes) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(creator_id, month) DO UPDATE SET videos = excluded.videos, sales = excluded.sales, notes = excluded.notes`)
    .run(r.id, month, toInt(body.videos) || 0, toNum(body.sales) || 0, nil(body.notes));
  log(who, 'Saved Go sales', `@${cleanHandle(body.handle)} ${month}: $${toNum(body.sales) || 0}`);
  return { ok: true };
});
route('DELETE', '/api/go/:id', ({ params, who }) => { db.prepare('DELETE FROM go_sales WHERE id = ?').run(params.id); log(who, 'Deleted a Go sales entry'); return { ok: true }; });
route('POST', '/api/rewards', ({ body, who }) => {
  const c = db.prepare('SELECT id, handle FROM creators WHERE handle = ?').get(cleanHandle(body.handle));
  if (!c) throw new HttpError(404, 'Add this creator first');
  db.prepare('INSERT INTO rewards(creator_id, kind, value, status, date, notes) VALUES (?, ?, ?, ?, ?, ?)')
    .run(c.id, nil(body.kind), toNum(body.value), body.status === 'sent' ? 'sent' : 'planned', nil(body.date), nil(body.notes));
  log(who, 'Added a reward', `@${c.handle}: ${body.kind || 'reward'}`);
  return { ok: true };
});
route('PATCH', '/api/rewards/:id', ({ params, body, who }) => {
  db.prepare('UPDATE rewards SET status = ?, date = coalesce(?, date) WHERE id = ?').run(body.status === 'sent' ? 'sent' : 'planned', nil(body.date), params.id);
  log(who, body.status === 'sent' ? 'Marked reward sent' : 'Marked reward planned', `#${params.id}`);
  return { ok: true };
});
route('DELETE', '/api/rewards/:id', ({ params, who }) => { db.prepare('DELETE FROM rewards WHERE id = ?').run(params.id); log(who, 'Deleted a reward'); return { ok: true }; });

// Agency revenue
route('GET', '/api/revenue', () => db.prepare('SELECT * FROM revenue ORDER BY month DESC').all());
route('POST', '/api/revenue', ({ body, who }) => {
  if (!/^\d{4}-\d{2}$/.test(body.month || '')) throw new HttpError(400, 'Pick a month');
  db.prepare(`INSERT INTO revenue(month, revenue, diamonds, benchmark, share_pct, notes) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(month) DO UPDATE SET revenue = excluded.revenue, diamonds = excluded.diamonds, benchmark = excluded.benchmark, share_pct = excluded.share_pct, notes = excluded.notes`)
    .run(body.month, toNum(body.revenue), toInt(body.diamonds), toInt(body.benchmark), toNum(body.share_pct) ?? 14, nil(body.notes));
  log(who, 'Saved revenue', body.month);
  return { ok: true };
});
route('DELETE', '/api/revenue/:month', ({ params, who }) => { db.prepare('DELETE FROM revenue WHERE month = ?').run(params.month); log(who, 'Deleted revenue', params.month); return { ok: true }; });

// Hours
route('GET', '/api/hours', ({ query }) => {
  const from = query.from || weekStart();
  return {
    weekStart: weekStart(), cap: Number(settings().weekly_hours_cap), from,
    week: db.prepare('SELECT person, sum(hours) h FROM hours WHERE date >= ? GROUP BY person ORDER BY person').all(weekStart()),
    rows: db.prepare('SELECT * FROM hours WHERE date >= ? ORDER BY date DESC, id DESC').all(from),
  };
});
route('POST', '/api/hours', ({ body, who }) => {
  const h = toNum(body.hours);
  if (!body.person || !h || h <= 0 || h > 24) throw new HttpError(400, 'Enter a name and the hours worked');
  db.prepare('INSERT INTO hours(person, date, hours, task) VALUES (?, ?, ?, ?)').run(String(body.person).trim(), body.date || today(), h, nil(body.task));
  log(who, 'Logged hours', `${body.person}: ${h}h${body.task ? ` – ${body.task}` : ''}`);
  return { ok: true };
});
route('DELETE', '/api/hours/:id', ({ params, who }) => { db.prepare('DELETE FROM hours WHERE id = ?').run(params.id); log(who, 'Deleted an hours entry'); return { ok: true }; });

route('GET', '/api/activity', ({ query }) => db.prepare('SELECT * FROM activity ORDER BY id DESC LIMIT ?').all(Math.min(1000, Number(query.limit) || 200)));

route('GET', '/api/settings', () => { const s = settings(); return { ...s, api_key: s.api_key ? '••••••••' : '' }; });
route('PUT', '/api/settings', ({ body, who, local }) => {
  const before = settings();
  const changed = [];
  for (const k of SETTING_KEYS) {
    if (body[k] === undefined || k === 'paused') continue;
    if (!local && (k === 'send_command' || k === 'send_cwd')) continue; // only from the computer itself
    if (k === 'api_key' && body[k] === '••••••••') continue;
    if (String(body[k]) !== String(before[k])) { setSetting(k, body[k]); changed.push(k); }
  }
  if (changed.some((k) => k === 'follower_limit' || k === 'diamond_limit')) refreshAllEligibility();
  if (changed.length) log(who, 'Changed settings', changed.map((k) => (k === 'api_key' ? 'API key' : k)).join(', '));
  return { ok: true, changed };
});
route('POST', '/api/sample', ({ who }) => loadSample(who));
route('DELETE', '/api/sample', ({ who }) => clearSample(who));

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

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
    const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
    if (!r) return send(404, { error: 'Not found' });
    try {
      const body = req.method !== 'GET' && req.method !== 'DELETE' ? await readBody() : {};
      let who = 'Someone';
      try { who = decodeURIComponent(req.headers['x-user'] || '') || 'Someone'; } catch {}
      const out = await r.fn({ params: url.pathname.match(r.re).groups || {}, query: Object.fromEntries(url.searchParams), body, who, local: isLocal(req) });
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

process.on('SIGINT', () => { if (running) killTree(running.proc); process.exit(0); });
