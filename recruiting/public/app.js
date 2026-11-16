// Recruiting Hub front end: plain JavaScript, talks to server.mjs at /api/*.
'use strict';

// ---------- small helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString());
const money = (n) => (n === null || n === undefined ? '—' : '$' + Number(n).toLocaleString(undefined, Number.isInteger(Number(n)) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pct = (a, b) => (b ? Math.min(100, Math.round((a / b) * 100)) : 0);
const when = (t) => (t ? new Date(t.replace(' ', 'T')).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const day = (t) => (t ? new Date(t.slice(0, 10) + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const monthName = (m) => (m ? new Date(m + '-15T12:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : '—');
const pad = (n) => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const store = {
  get(k, d = null) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
let USER = store.get('hub-user', '');

const STATUS = {
  new: 'New', queued: 'In a batch', messaged: 'Messaged', replied: 'Replied', invited: 'Invited', joined: 'Joined',
  declined: 'Declined', verification_failed: 'Verification failed', do_not_contact: 'Do not contact',
};
const ELIG = { regular: 'Regular invite', premium: 'Premium invite', needs_data: 'Needs data', ineligible: 'Has an agency' };
const BATCH = { ready: 'Ready', sending: 'Sending', sent: 'Sent', partial: 'Partly sent', error: 'Nothing sent', cancelled: 'Cancelled' };
const badge = (key, label) => `<span class="badge b-${esc(key)}">${esc(label ?? key)}</span>`;
const meter = (v, max) => { const p = pct(v, max); return `<div class="meter ${p >= 100 ? 'bad' : p >= 80 ? 'warn' : ''}"><i style="width:${p}%"></i></div>`; };

async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch(path, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-user': encodeURIComponent(USER || '') },
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && j.login) { showLogin(); throw new Error('Please sign in'); }
  if (!r.ok) throw new Error(j.error || `Something went wrong (${r.status})`);
  return j;
}
let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), err ? 6000 : 3000);
}
function openModal(html) {
  const m = $('#modal');
  m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  m.hidden = false;
  m.onclick = (e) => { if (e.target === m) closeModal(); };
  $('input, select, textarea', m)?.focus();
  return $('.sheet', m);
}
function closeModal() { $('#modal').hidden = true; $('#modal').innerHTML = ''; }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });
function download(filename, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const formData = (form) => Object.fromEntries(new FormData(form).entries());
// Wraps an async button handler: disables the button while running and shows errors.
function act(fn) {
  return async (e) => {
    const b = e?.currentTarget;
    if (b && b.tagName === 'BUTTON') b.disabled = true;
    try { await fn(e); } catch (err) { toast(err.message, true); } finally { if (b && b.isConnected) b.disabled = false; }
  };
}

function parseTable(text) {
  text = text.replace(/^\uFEFF/, '');
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) || '';
  const delim = firstLine.includes('\t') ? '\t' : firstLine.includes(',') ? ',' : null;
  if (!delim) { // just a list of handles, one per line
    return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^(handle|username|creator)s?$/i.test(l)).map((handle) => ({ handle }));
  }
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { row.push(f); f = ''; }
    else if (ch === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (ch !== '\r') f += ch;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  const clean = rows.filter((r) => r.some((c) => c.trim()));
  const [head, ...rest] = clean;
  if (!head) return [];
  return rest.map((r) => Object.fromEntries(head.map((k, i) => [k.trim(), (r[i] ?? '').trim()])));
}

// ---------- router ----------
const PAGES = { dashboard, creators, outreach, go: goSales, revenue, hours, activity, settings: settingsPage };
let pollTimer = null;
async function render() {
  clearInterval(pollTimer); pollTimer = null;
  const page = (location.hash.slice(1) || 'dashboard').split('?')[0];
  const fn = PAGES[page] || dashboard;
  $$('#nav a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + (PAGES[page] ? page : 'dashboard')));
  try { await fn($('#main')); } catch (e) { $('#main').innerHTML = `<div class="alert bad">${esc(e.message)}</div>`; }
  refreshBanner();
}
window.addEventListener('hashchange', render);
async function refreshBanner() {
  try {
    const g = (await api('/api/batches')).guards;
    $('#banner').innerHTML = g.paused
      ? `<div class="alert bad"><b>Sending is paused.</b> No batches can start until someone turns it back on. <a href="#outreach">Go to Outreach</a></div>` : '';
  } catch {}
}
function setUser(name) { USER = name.trim(); store.set('hub-user', USER); $('#who').textContent = USER ? `You: ${USER}` : 'Who are you?'; }
function askUser() {
  const sheet = openModal(`<h2>Who's using the hub?</h2><p class="muted">Your name goes on everything you do here, so the team can see who did what.</p>
    <form id="uf"><label class="f">Your name<input name="name" required value="${esc(USER)}" placeholder="e.g. Alexander"></label>
    <div class="foot"><button class="primary">Continue</button></div></form>`);
  $('#uf', sheet).onsubmit = (e) => { e.preventDefault(); setUser(formData(e.target).name); closeModal(); render(); };
}
$('#who').onclick = askUser;
setUser(USER);

// Phones and other devices sign in with the passcode set on the computer running the hub.
let AUTH = { local: true };
function showLogin() {
  if ($('#login')) return;
  $('#main').innerHTML = '';
  const sheet = openModal(`<form id="login"><h2>Sign in to the Recruiting Hub</h2>
    <p class="muted">Enter the passcode that was set on the computer running the hub.</p>
    <div class="form" style="grid-template-columns:1fr">
      <label class="f">Your name<input name="name" required value="${esc(USER)}" autocomplete="name"></label>
      <label class="f">Passcode<input name="passcode" type="password" required autocomplete="current-password"></label>
    </div><p id="lerr" class="muted"></p>
    <div class="foot"><button class="primary">Sign in</button></div></form>`);
  $('#modal').onclick = null; // can't dismiss the sign-in screen
  $('#login', sheet).onsubmit = async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { $('#lerr', sheet).textContent = j.error || 'Could not sign in'; return; }
    setUser(f.name); closeModal(); render();
  };
}
(async () => {
  try { AUTH = await (await fetch('/api/auth')).json(); } catch {}
  if (!AUTH.signedIn) return showLogin();
  if (!USER) askUser();
  render();
})();

// ---------- Dashboard ----------
async function dashboard(main) {
  const s = await api('/api/stats');
  const g = s.guards;
  const st = (k) => s.byStatus[k] || 0;
  const reached = st('messaged') + st('replied') + st('invited') + st('joined') + st('declined') + st('verification_failed');
  const outreachLine = g.paused ? badge('bad', 'Paused')
    : g.openBatch ? `Batch #${g.openBatch.id} is ${g.openBatch.status === 'sending' ? 'sending' : 'ready to send'}`
    : g.cooldownLeft ? `Next batch can start in ${g.cooldownLeft} min`
    : g.remainingToday ? 'Ready for the next batch' : 'Daily limit reached';
  main.innerHTML = `
    <div class="head"><div><h1>Dashboard</h1><div class="muted">${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} · ${outreachLine}</div></div>
      <div class="row"><a class="btn" href="#creators">Creators</a><a class="btn primary" style="background:var(--pink);color:#fff;border-color:var(--pink)" href="#outreach">Outreach</a></div></div>
    ${s.total === 0 ? `<div class="card" style="margin-bottom:14px"><h2>Get started</h2>
      <ol class="steps"><li>Import a creator list on <a href="#creators">Creators</a> (a CSV, a Google Sheets paste, or a list of handles)</li>
      <li>Click <b>Check missing data</b> to fill in followers and diamonds, which decide the invite type</li>
      <li>Build a batch of up to ${g.batchSize} on <a href="#outreach">Outreach</a> and send it</li>
      <li>Update each creator's status as they reply, get invited and join</li></ol>
      <button id="sample">Load sample data to try it out</button> <small>Sample creators start with "sample_" and can be removed in Settings.</small></div>` : ''}
    ${s.sample ? `<div class="alert info">${s.sample} sample creators are loaded. Remove them in <a href="#settings">Settings</a> before real work.</div>` : ''}
    ${s.apiMode !== 'http' ? `<div class="alert warn"><b>Creator data API is in demo mode.</b> "Check data" fills in made-up numbers until the chosen API is set up in <a href="#settings">Settings</a>.</div>` : ''}
    <div class="grid g4">
      <div class="card kpi"><div class="l">Ready to message</div><div class="n">${fmt(s.readyToMessage)}</div><div class="s">Regular invite, US, not contacted</div></div>
      <div class="card kpi"><div class="l">Messaged today</div><div class="n">${fmt(g.sentToday)} <small>/ ${fmt(g.dailyCap)}</small></div>${meter(g.sentToday, g.dailyCap)}</div>
      <div class="card kpi"><div class="l">API checks today</div><div class="n">${fmt(s.apiUsedToday)} <small>/ ${fmt(s.apiQuota)}</small></div>${meter(s.apiUsedToday, s.apiQuota)}</div>
      <div class="card kpi"><div class="l">Premium invites left</div><div class="n">${fmt(s.premiumLeft)}</div><div class="s">${fmt(s.byElig.premium || 0)} creators need one</div></div>
      <div class="card kpi"><div class="l">Joined</div><div class="n">${fmt(st('joined'))}</div><div class="s">${reached ? pct(st('joined'), reached) : 0}% of creators reached</div></div>
      <div class="card kpi"><div class="l">Needs review</div><div class="n">${fmt(s.flagged)}</div><div class="s"><a href="#creators?flag=any">Multi-account or non-US</a></div></div>
    </div>
    <div class="card" style="margin-top:14px"><h2>Pipeline <small>· ${fmt(s.total)} creators (${fmt(s.byProgram.live || 0)} LIVE, ${fmt(s.byProgram.go || 0)} Go)</small></h2>
      <div class="funnel">${['new', 'queued', 'messaged', 'replied', 'invited', 'joined', 'declined', 'verification_failed', 'do_not_contact']
        .map((k) => `<div><b>${fmt(st(k))}</b><span>${STATUS[k]}</span></div>`).join('')}</div></div>
    <div class="grid g2" style="margin-top:14px">
      <div class="card"><h2>Hours this week <small>· since ${day(s.weekStart)}</small></h2>
        ${s.hoursWeek.length ? s.hoursWeek.map((h) => `<div style="margin-bottom:10px"><div class="row" style="justify-content:space-between"><span>${esc(h.person)}</span><b>${fmt(h.h)} / ${s.hoursCap} h</b></div>${meter(h.h, s.hoursCap)}</div>`).join('') : '<p class="muted">No hours logged this week.</p>'}
        <a href="#hours">Log hours →</a></div>
      <div class="card"><h2>Top Go sellers <small>· ${monthName(s.month)}</small></h2>
        ${s.topGo.length ? `<div class="list">${s.topGo.map((c, i) => `<div class="it"><span>${i + 1}. <span class="handle" data-id="${c.id}">@${esc(c.handle)}</span> <small>${fmt(c.videos)} videos</small></span><b>${money(c.sales)}</b></div>`).join('')}</div>` : '<p class="muted">No Go sales entered for this month.</p>'}
        ${s.rewardsPlanned ? `<p><a href="#go">${s.rewardsPlanned} reward(s) planned, not sent yet →</a></p>` : ''}</div>
    </div>
    <div class="grid g2" style="margin-top:14px">
      <div class="card"><h2>Agency revenue</h2>
        ${s.revenue.length ? `<div class="list">${s.revenue.map((r) => `<div class="it"><span>${monthName(r.month)}</span><b>${money(r.revenue)}</b></div>`).join('')}</div>` : '<p class="muted">No months entered yet.</p>'}
        <a href="#revenue">Revenue →</a></div>
      <div class="card"><h2>Recent activity</h2>
        ${s.recent.length ? `<div class="list">${s.recent.map((a) => `<div class="it"><span><b>${esc(a.who)}</b> ${esc(a.action)}<br><small>${esc(a.detail)}</small></span><small>${when(a.at)}</small></div>`).join('')}</div>` : '<p class="muted">Nothing yet.</p>'}
        <a href="#activity">All activity →</a></div>
    </div>`;
  $('#sample', main)?.addEventListener('click', act(async () => { const r = await api('/api/sample', { method: 'POST' }); toast(`Loaded ${r.created} sample creators`); render(); }));
  $$('.handle', main).forEach((el) => (el.onclick = () => creatorSheet(el.dataset.id)));
}

// ---------- Creators ----------
const CF = { q: '', status: '', eligibility: '', program: '', flag: '', source: '', sort: 'newest', offset: 0 };
const selected = new Set();
async function creators(main) {
  const qp = new URLSearchParams(location.hash.split('?')[1] || '');
  for (const [k, v] of qp) if (k in CF) CF[k] = v;
  if (qp.toString()) { CF.offset = 0; history.replaceState(null, '', '#creators'); }
  const opt = (map, cur, all) => `<option value="">${all}</option>` + Object.entries(map).map(([k, v]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${v}</option>`).join('');
  main.innerHTML = `
    <div class="head"><div><h1>Creators</h1><div class="muted">Every creator from every list, with their invite type and where they are in outreach.</div></div>
      <div class="row"><button id="imp" class="primary">Import list</button><button id="add">Add creator</button><button id="chk">Check missing data</button><button id="exp">Export CSV</button></div></div>
    <div class="row" style="margin-bottom:12px">
      <input id="q" type="search" placeholder="Search handle, name, notes, list" value="${esc(CF.q)}" style="flex:1;min-width:200px">
      <select id="f-program">${opt({ live: 'LIVE', go: 'Go' }, CF.program, 'All programs')}</select>
      <select id="f-status">${opt(STATUS, CF.status, 'All statuses')}</select>
      <select id="f-eligibility">${opt(ELIG, CF.eligibility, 'All invite types')}</select>
      <select id="f-flag">${opt({ any: 'Needs review (any flag)', multi: 'Multi-account risk', nonus: 'Non-US account' }, CF.flag, 'No flag filter')}</select>
      <select id="f-source"><option value="">All lists</option></select>
      <select id="f-sort">${Object.entries({ newest: 'Newest first', oldest: 'Oldest first', followers: 'Most followers', diamonds: 'Most diamonds', handle: 'A–Z', updated: 'Recently updated' }).map(([k, v]) => `<option value="${k}" ${CF.sort === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
    </div>
    <div id="bulk"></div>
    <div id="ctable"><p class="muted">Loading…</p></div>`;
  let t;
  $('#q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { CF.q = e.target.value; CF.offset = 0; loadCreators(); }, 250); };
  for (const k of ['program', 'status', 'eligibility', 'flag', 'source', 'sort']) $(`#f-${k}`).onchange = (e) => { CF[k] = e.target.value; CF.offset = 0; loadCreators(); };
  $('#imp').onclick = () => importSheet('creators');
  $('#add').onclick = () => creatorSheet(null);
  $('#exp').onclick = act(async () => { const r = await api('/api/creators.csv?' + new URLSearchParams(filterParams())); download(r.filename, r.csv); });
  $('#chk').onclick = act(async () => {
    const r = await api('/api/check', { method: 'POST', body: { scope: 'needs_data', limit: 200 } });
    checkResult(r); loadCreators();
  });
  await loadCreators();
}
const filterParams = () => Object.fromEntries(Object.entries(CF).filter(([k, v]) => v !== '' && k !== 'offset'));
function checkResult(r) {
  toast(`${r.checked} checked${r.failed ? `, ${r.failed} failed` : ''}${r.skipped_quota ? `, ${r.skipped_quota} skipped (daily API limit)` : ''}${r.demo ? ' · demo data' : ''}`, r.failed > 0 && !r.checked);
  if (r.errors?.length) setTimeout(() => toast(r.errors[0], true), 3100);
}
async function loadCreators() {
  const limit = 100;
  const r = await api('/api/creators?' + new URLSearchParams({ ...filterParams(), limit, offset: CF.offset }));
  const src = $('#f-source');
  if (src) src.innerHTML = '<option value="">All lists</option>' + r.sources.map((s) => `<option ${CF.source === s ? 'selected' : ''}>${esc(s)}</option>`).join('');
  const box = $('#ctable');
  if (!box) return;
  if (!r.rows.length) {
    box.innerHTML = `<div class="card"><p class="muted">${r.total === 0 && !Object.keys(filterParams()).filter((k) => k !== 'sort').length ? 'No creators yet. Click <b>Import list</b> to add a list from TikTok, a spreadsheet, or a list of handles.' : 'No creators match these filters.'}</p></div>`;
    renderBulk(); return;
  }
  box.innerHTML = `<div class="tablewrap"><table><thead><tr>
      <th><input type="checkbox" id="all" aria-label="Select all on this page"></th><th>Handle</th><th>Program</th><th class="num">Followers</th><th class="num">Max diamonds</th><th>League</th><th>Location</th><th>Invite</th><th>Flags</th><th>Status</th><th>Messaged</th>
    </tr></thead><tbody>${r.rows.map((c) => `<tr data-id="${c.id}">
      <td><input type="checkbox" class="sel" ${selected.has(c.id) ? 'checked' : ''} aria-label="Select @${esc(c.handle)}"></td>
      <td><span class="handle" data-id="${c.id}">@${esc(c.handle)}</span>${c.name ? `<br><small>${esc(c.name)}</small>` : ''}</td>
      <td>${c.program === 'go' ? 'Go' : 'LIVE'}</td>
      <td class="num">${fmt(c.followers)}</td><td class="num">${c.program === 'go' ? '' : fmt(c.max_diamonds)}</td>
      <td>${esc(c.league || '')}</td><td>${esc([c.region, c.country].filter(Boolean).join(', '))}</td>
      <td>${badge(c.eligibility, ELIG[c.eligibility])}</td>
      <td>${c.multi_account ? badge('bad', 'Multi-account') : ''} ${c.non_us ? badge('warn', 'Non-US') : ''}</td>
      <td><select class="st" aria-label="Status" ${c.status === 'queued' ? 'disabled title="In an open batch"' : ''}>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${c.status === k ? 'selected' : ''} ${k === 'queued' && c.status !== 'queued' ? 'disabled' : ''}>${v}</option>`).join('')}</select></td>
      <td>${c.messaged_at ? day(c.messaged_at) : '—'}</td></tr>`).join('')}</tbody></table></div>
    <div class="pager"><span class="muted">${fmt(CF.offset + 1)}–${fmt(CF.offset + r.rows.length)} of ${fmt(r.total)}</span>
      <span class="row"><button id="prev" ${CF.offset ? '' : 'disabled'}>← Previous</button><button id="next" ${CF.offset + limit < r.total ? '' : 'disabled'}>Next →</button></span></div>`;
  $('#prev').onclick = () => { CF.offset = Math.max(0, CF.offset - limit); loadCreators(); };
  $('#next').onclick = () => { CF.offset += limit; loadCreators(); };
  $$('.handle', box).forEach((el) => (el.onclick = () => creatorSheet(el.dataset.id)));
  $$('.sel', box).forEach((el) => (el.onchange = () => { const id = Number(el.closest('tr').dataset.id); el.checked ? selected.add(id) : selected.delete(id); renderBulk(); }));
  $('#all').onchange = (e) => { $$('.sel', box).forEach((el) => { el.checked = e.target.checked; const id = Number(el.closest('tr').dataset.id); e.target.checked ? selected.add(id) : selected.delete(id); }); renderBulk(); };
  $$('.st', box).forEach((el) => {
    const prev = el.value;
    el.onchange = async () => {
      try { await api(`/api/creators/${el.closest('tr').dataset.id}`, { method: 'PATCH', body: { status: el.value } }); toast('Status updated'); }
      catch (e) { toast(e.message, true); el.value = prev; }
    };
  });
  renderBulk();
}
function renderBulk() {
  const box = $('#bulk');
  if (!box) return;
  if (!selected.size) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="card row" style="margin-bottom:12px;padding:10px 14px"><b>${selected.size} selected</b>
    <select id="bs">${Object.entries(STATUS).filter(([k]) => k !== 'queued').map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select><button id="bsa">Set status</button>
    <button id="bck">Check data</button><button id="bfl">Flag multi-account</button><button id="bun">Clear flag</button>
    <button id="bdel" class="danger">Delete</button><button id="bclr">Clear selection</button></div>`;
  const ids = [...selected];
  const bulk = async (body, msg) => { const r = await api('/api/creators/bulk', { method: 'POST', body: { ids, ...body } }); toast(`${msg}: ${r.done}${r.errorCount ? ` · ${r.errorCount} skipped: ${r.errors[0]}` : ''}`, r.errorCount > 0); selected.clear(); loadCreators(); };
  $('#bsa').onclick = act(() => bulk({ action: 'status', status: $('#bs').value }, 'Updated'));
  $('#bck').onclick = act(async () => { const r = await api('/api/check', { method: 'POST', body: { ids } }); checkResult(r); selected.clear(); loadCreators(); });
  $('#bfl').onclick = act(() => bulk({ action: 'flag', value: true }, 'Flagged'));
  $('#bun').onclick = act(() => bulk({ action: 'flag', value: false }, 'Cleared'));
  $('#bdel').onclick = act(async () => { if (confirm(`Delete ${ids.length} creator(s)? This can't be undone.`)) await bulk({ action: 'delete' }, 'Deleted'); });
  $('#bclr').onclick = () => { selected.clear(); loadCreators(); };
}

async function creatorSheet(id) {
  const d = id ? await api(`/api/creators/${id}`) : { creator: { program: 'live', agency: 'unmanaged' }, sales: [], rewards: [], checks: [], batches: [] };
  const c = d.creator;
  const sel = (name, map) => `<select name="${name}">${Object.entries(map).map(([k, v]) => `<option value="${k}" ${String(c[name] ?? '') === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
  const inp = (name, label, type = 'text') => `<label class="f">${label}<input name="${name}" type="${type}" value="${esc(c[name] ?? '')}"></label>`;
  const sheet = openModal(`
    <div class="head" style="margin-bottom:8px"><div><h2 style="margin:0">${id ? `@${esc(c.handle)}` : 'Add a creator'}</h2>
      ${id ? `<small>${badge(c.eligibility, ELIG[c.eligibility])} ${badge(c.status, STATUS[c.status])} ${c.multi_account ? badge('bad', 'Multi-account') : ''} ${c.non_us ? badge('warn', 'Non-US') : ''}</small>` : ''}</div>
      ${id ? `<a class="btn" href="https://www.tiktok.com/@${encodeURIComponent(c.handle)}" target="_blank" rel="noopener">Open TikTok ↗</a>` : ''}</div>
    ${c.eligibility === 'premium' ? `<div class="alert warn">Over 200K followers or 200K monthly diamonds, so this creator needs a <b>premium invite</b>. Setting them to "Invited" uses one.</div>` : ''}
    ${c.eligibility === 'needs_data' ? `<div class="alert info">Followers and highest monthly diamonds are both needed to know the invite type. Click <b>Check data</b> or type them in.</div>` : ''}
    <form id="cf" class="form">
      ${id ? '' : inp('handle', 'TikTok handle')}
      ${inp('name', 'Name')}
      <label class="f">Program${sel('program', { live: 'TikTok LIVE', go: 'TikTok Go' })}</label>
      ${inp('followers', 'Followers')}
      ${inp('max_diamonds', 'Highest monthly diamonds (6 mo)')}
      ${inp('league', 'League (A–D)')}
      ${inp('region', 'Region / state')}
      ${inp('country', 'Country')}
      ${inp('phone', 'Phone', 'tel')}
      ${inp('email', 'Email', 'email')}
      <label class="f">Agency${sel('agency', { unmanaged: 'No agency', unknown: 'Not sure', managed: 'Has an agency' })}</label>
      ${inp('source', 'List / source')}
      <label class="check" style="grid-column:1/-1"><input type="checkbox" name="multi_account" ${c.multi_account ? 'checked' : ''}> Multi-account risk (has other TikTok accounts that may not qualify)</label>
      <label class="f" style="grid-column:1/-1">Notes<textarea name="notes">${esc(c.notes ?? '')}</textarea></label>
    </form>
    ${id ? `
      ${d.batches.length ? `<h3>Outreach</h3><div class="list">${d.batches.map((b) => `<div class="it"><span>Batch #${b.id} ${badge(b.result, b.result.replace('_', ' '))}</span><small>${when(b.finished_at)}</small></div>`).join('')}</div>` : ''}
      ${d.sales.length ? `<h3>Go sales</h3><div class="list">${d.sales.map((g) => `<div class="it"><span>${monthName(g.month)} · ${fmt(g.videos)} videos</span><b>${money(g.sales)}</b></div>`).join('')}</div>` : ''}
      ${d.rewards.length ? `<h3>Rewards</h3><div class="list">${d.rewards.map((r) => `<div class="it"><span>${esc(r.kind || 'Reward')} ${r.value ? money(r.value) : ''}</span>${badge(r.status === 'sent' ? 'sent' : 'ready', r.status)}</div>`).join('')}</div>` : ''}
      ${d.checks.length ? `<h3>Data checks</h3><div class="list">${d.checks.map((k) => `<div class="it"><span>${k.ok ? 'OK' : esc(k.detail)} <small>${esc(k.provider)}</small></span><small>${when(k.at)}</small></div>`).join('')}</div>` : ''}
      <p><small>Added ${when(c.created_at)} · updated ${when(c.updated_at)}${c.checked_at ? ` · data checked ${when(c.checked_at)}` : ''}</small></p>` : ''}
    <div class="foot">${id ? '<button id="ck">Check data</button>' : ''}<button id="cancel">Close</button><button id="save" class="primary">${id ? 'Save' : 'Add'}</button></div>`);
  $('#cancel', sheet).onclick = closeModal;
  const save = act(async () => {
    const body = formData($('#cf', sheet));
    body.multi_account = !!body.multi_account;
    for (const k of ['name', 'league', 'region', 'country', 'phone', 'email', 'source', 'notes', 'followers', 'max_diamonds']) if (body[k] === undefined) body[k] = '';
    if (id) { await api(`/api/creators/${id}`, { method: 'PATCH', body }); toast('Saved'); }
    else { await api('/api/creators', { method: 'POST', body }); toast('Creator added'); }
    closeModal();
    if (location.hash.startsWith('#creators')) loadCreators(); else render();
  });
  $('#save', sheet).onclick = save;
  $('#cf', sheet).onsubmit = (e) => { e.preventDefault(); save(); };
  $('#ck', sheet)?.addEventListener('click', act(async () => { const r = await api('/api/check', { method: 'POST', body: { ids: [Number(id)] } }); checkResult(r); creatorSheet(id); }));
}

function importSheet(type) {
  const sheet = openModal(`<h2>${type === 'go_sales' ? 'Import Go sales' : 'Import a creator list'}</h2>
    <p class="muted">Upload a CSV or paste from Google Sheets / Excel. The first row should be column names. Handles, @handles and TikTok profile links all work.
    ${type === 'go_sales' ? 'Columns used: <b>handle, month (YYYY-MM), videos, sales</b>.' : 'Columns used when present: <b>handle, name, followers, max diamonds, league, region, country, phone, email, agency, notes</b>. A plain list of handles (one per line) also works.'}
    Creators already in the hub are updated, not duplicated.</p>
    <div class="form">
      <label class="f">What is this?<select id="itype"><option value="creators" ${type === 'creators' ? 'selected' : ''}>Creator list</option><option value="go_sales" ${type === 'go_sales' ? 'selected' : ''}>Go sales</option></select></label>
      <label class="f" id="iprog">Program<select id="iprogram"><option value="live">TikTok LIVE</option><option value="go">TikTok Go</option></select></label>
      <label class="f">List name<input id="isource" placeholder="e.g. TikTok unmanaged Go – Nov"></label>
      <label class="f" id="imonthw">Month (if the file has no month)<input id="imonth" type="month" value="${todayStr().slice(0, 7)}"></label>
      <label class="f" style="grid-column:1/-1">File<input id="ifile" type="file" accept=".csv,.tsv,.txt"></label>
      <label class="f" style="grid-column:1/-1">…or paste<textarea id="itext" placeholder="handle,followers,diamonds&#10;@example,12000,4000"></textarea></label>
    </div>
    <div id="ipreview" class="muted" style="margin-top:10px"></div>
    <div class="foot"><button id="icancel">Cancel</button><button id="igo" class="primary" disabled>Import</button></div>`);
  let rows = [];
  const syncType = () => { const go = $('#itype', sheet).value === 'go_sales'; $('#iprog', sheet).hidden = go; $('#imonthw', sheet).hidden = !go; };
  syncType();
  $('#itype', sheet).onchange = syncType;
  const preview = (text) => {
    rows = parseTable(text);
    const cols = rows[0] ? Object.keys(rows[0]) : [];
    $('#ipreview', sheet).innerHTML = rows.length ? `<b>${fmt(rows.length)} rows found.</b> Columns: ${cols.map(esc).join(', ')}` : text.trim() ? 'No rows found. Check that the first row has column names.' : '';
    $('#igo', sheet).disabled = !rows.length;
  };
  $('#itext', sheet).oninput = (e) => preview(e.target.value);
  $('#ifile', sheet).onchange = async (e) => { const f = e.target.files[0]; if (!f) return; const text = await f.text(); $('#itext', sheet).value = text.slice(0, 20000) + (text.length > 20000 ? '\n…' : ''); preview(text); if (!$('#isource', sheet).value) $('#isource', sheet).value = f.name.replace(/\.\w+$/, ''); };
  $('#icancel', sheet).onclick = closeModal;
  $('#igo', sheet).onclick = act(async () => {
    const r = await api('/api/import', { method: 'POST', body: { type: $('#itype', sheet).value, program: $('#iprogram', sheet).value, source: $('#isource', sheet).value.trim(), month: $('#imonth', sheet).value, rows } });
    toast(`Imported: ${r.created} new, ${r.updated} updated${r.skipped ? `, ${r.skipped} skipped (no handle)` : ''}`);
    closeModal(); render();
  });
}

// ---------- Outreach ----------
async function outreach(main) {
  const [{ guards: g, batches }, s, st, src] = await Promise.all([api('/api/batches'), api('/api/settings'), api('/api/stats'), api('/api/creators?limit=1')]);
  const cmdMode = s.send_mode === 'command';
  main.innerHTML = `
    <div class="head"><div><h1>Outreach</h1><div class="muted">Send DMs in batches of up to ${g.batchSize}, at most ${fmt(g.dailyCap)} a day, with ${g.cooldownMin} minutes between batches, to avoid spam blocks.</div></div>
      <button id="pause" class="${g.paused ? 'primary' : 'danger'}">${g.paused ? 'Resume sending' : 'Pause all sending'}</button></div>
    <div class="grid g4" style="margin-bottom:14px">
      <div class="card kpi"><div class="l">Messaged today</div><div class="n">${fmt(g.sentToday)} <small>/ ${fmt(g.dailyCap)}</small></div>${meter(g.sentToday, g.dailyCap)}</div>
      <div class="card kpi"><div class="l">Ready to message</div><div class="n">${fmt(st.readyToMessage)}</div><div class="s">Regular invite, US, no flags</div></div>
      <div class="card kpi"><div class="l">Next batch</div><div class="n" style="font-size:20px">${g.paused ? 'Paused' : g.cooldownLeft ? `in ${g.cooldownLeft} min` : g.remainingToday ? 'Can start now' : 'Tomorrow'}</div><div class="s">Last finished ${when(g.lastFinished)}</div></div>
      <div class="card kpi"><div class="l">How messages go out</div><div class="n" style="font-size:20px">${cmdMode ? 'Hub runs the script' : 'Download the list'}</div><div class="s"><a href="#settings">Change in Settings</a></div></div>
    </div>
    <div id="open"></div>
    <h3>Batch history</h3>
    ${batches.length ? `<div class="tablewrap"><table><thead><tr><th>Batch</th><th>Program</th><th>Built</th><th>By</th><th class="num">Size</th><th class="num">Sent</th><th>Status</th><th>Finished</th></tr></thead><tbody>
      ${batches.map((b) => `<tr><td><a href="#" class="bv" data-id="${b.id}">#${b.id}</a></td><td>${b.program === 'go' ? 'Go' : 'LIVE'}</td><td>${when(b.created_at)}</td><td>${esc(b.created_by)}</td><td class="num">${fmt(b.size)}</td><td class="num">${fmt(b.sent_count)}</td><td>${badge(b.status, BATCH[b.status])}</td><td>${when(b.finished_at)}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted">No batches yet.</p>'}`;
  $('#pause').onclick = act(async () => {
    if (!g.paused && !confirm('Pause all sending? Any running script is stopped and no batch can start until someone resumes.')) return;
    await api('/api/pause', { method: 'POST', body: { paused: !g.paused } }); render();
  });
  $$('.bv', main).forEach((a) => (a.onclick = (e) => { e.preventDefault(); batchSheet(a.dataset.id); }));
  const open = $('#open');
  if (g.openBatch) return openBatchPanel(open, g.openBatch.id, s);
  const max = Math.min(g.batchSize, g.remainingToday);
  open.innerHTML = `<div class="card"><h2>Build the next batch</h2>
    <p class="muted">Picks creators with status <b>New</b>, a <b>regular invite</b>, no multi-account flag and a US account, oldest first. Premium-invite and flagged creators are handled one by one from the Creators page.</p>
    <form id="bf" class="form">
      <label class="f">Program<select name="program"><option value="live">TikTok LIVE</option><option value="go">TikTok Go</option></select></label>
      <label class="f">League<select name="league"><option value="">Any</option><option>C</option><option>D</option><option>B</option><option>A</option></select></label>
      <label class="f">Region contains<input name="region" placeholder="e.g. TX"></label>
      <label class="f">List<select name="source"><option value="">Any list</option>${src.sources.map((x) => `<option>${esc(x)}</option>`).join('')}</select></label>
      <label class="f">How many (max ${max})<input name="size" type="number" min="1" max="${max}" value="${max}"></label>
      <button class="primary" ${max ? '' : 'disabled'}>Build batch</button>
    </form>${max ? '' : `<p class="muted">Today's limit is reached.</p>`}</div>`;
  $('#bf').onsubmit = act(async (e) => {
    e.preventDefault();
    const r = await api('/api/batches', { method: 'POST', body: formData(e.target) });
    toast(`Batch #${r.id} built with ${r.size} creators`); render();
  });
}
async function openBatchPanel(box, id, s) {
  const d = await api(`/api/batches/${id}`);
  const b = d.batch, g = d.guards;
  const cmdMode = s.send_mode === 'command';
  const items = d.items;
  const pending = items.filter((i) => i.result === 'pending').length;
  let body = '';
  if (b.status === 'ready') {
    const blocker = g.paused ? 'Sending is paused.' : g.running ? `Batch #${g.running} is running.` : g.cooldownLeft ? `Wait ${g.cooldownLeft} more minute(s) after the last batch.` : pending > g.remainingToday ? `Only ${g.remainingToday} messages left today.` : '';
    body = cmdMode
      ? `<ol class="steps"><li>Make sure the Covenant Creative LIVE account is logged in where the script runs</li><li>Click <b>Run script</b>. The hub watches the output and stops on any spam or rate-limit warning</li><li>Results are saved here when the script ends</li></ol>
         ${blocker ? `<div class="alert warn">${esc(blocker)}</div>` : ''}
         <div class="row"><button id="run" class="primary" ${blocker ? 'disabled' : ''}>Run script</button><button id="dl">Download list</button><button id="cx" class="danger">Cancel batch</button></div>`
      : `<ol class="steps"><li>Click <b>Start sending</b> (checks today's limit and the wait time)</li><li>Download the list and send the DMs from the Covenant Creative LIVE account</li><li>Come back and click <b>Mark done</b>, listing any handles that failed</li></ol>
         ${blocker ? `<div class="alert warn">${esc(blocker)}</div>` : ''}
         <div class="row"><button id="start" class="primary" ${blocker ? 'disabled' : ''}>Start sending</button><button id="dl">Download list</button><button id="cx" class="danger">Cancel batch</button></div>`;
  } else if (b.status === 'sending' && !d.running) {
    body = `<p>Started ${when(b.started_at)}. When the messages are sent, list any handles that <b>failed</b> (one per line or comma-separated) and click Mark done. Everyone else counts as messaged. Failed ones go back to the queue.</p>
      <label class="f">Failed handles (optional)<textarea id="failed" placeholder="@handle1&#10;@handle2"></textarea></label>
      <div class="row" style="margin-top:10px"><button id="done" class="primary">Mark done</button><button id="dl">Download list</button><button id="cx" class="danger">Cancel batch</button></div>`;
  } else if (d.running) {
    body = `<div class="row" style="margin-bottom:10px">${badge('sending', 'Script running')} <span class="muted">${items.filter((i) => i.result === 'pending').length} pending</span><button id="stop" class="danger">Stop</button></div>
      <pre class="log" id="log">${esc(b.log)}</pre>`;
  }
  box.innerHTML = `<div class="card"><div class="head" style="margin-bottom:10px"><h2 style="margin:0">Batch #${b.id} · ${fmt(items.length)} ${b.program === 'go' ? 'Go' : 'LIVE'} creators ${badge(b.status, BATCH[b.status])}</h2><small>Built ${when(b.created_at)} by ${esc(b.created_by)}</small></div>
    ${body}
    ${!d.running && b.log ? `<details style="margin-top:12px"><summary>Script output</summary><pre class="log">${esc(b.log)}</pre></details>` : ''}
    <details style="margin-top:12px"><summary>Creators in this batch</summary><div class="list" style="margin-top:8px">${items.map((i) => `<div class="it"><span>@${esc(i.handle)} <small>${esc(i.name || '')}</small></span>${badge(i.result, i.result.replace('_', ' '))}</div>`).join('')}</div></details></div>`;
  const reload = () => render();
  $('#dl', box)?.addEventListener('click', act(async () => { const r = await api(`/api/batches/${id}/csv`); download(r.filename, r.csv); }));
  $('#cx', box)?.addEventListener('click', act(async () => { if (confirm(`Cancel batch #${id}? Its creators go back to the queue.`)) { await api(`/api/batches/${id}/cancel`, { method: 'POST' }); reload(); } }));
  $('#start', box)?.addEventListener('click', act(async () => { await api(`/api/batches/${id}/start`, { method: 'POST' }); toast('Started. Download the list and send.'); reload(); }));
  $('#run', box)?.addEventListener('click', act(async () => { await api(`/api/batches/${id}/start`, { method: 'POST' }); reload(); }));
  $('#done', box)?.addEventListener('click', act(async () => { const r = await api(`/api/batches/${id}/finish`, { method: 'POST', body: { failed: $('#failed', box).value } }); toast(`${r.sent} messaged${r.failed ? `, ${r.failed} back in the queue` : ''}`); reload(); }));
  $('#stop', box)?.addEventListener('click', act(async () => { await api(`/api/batches/${id}/stop`, { method: 'POST' }); toast('Stopping…'); }));
  if (d.running) {
    pollTimer = setInterval(async () => {
      try {
        const n = await api(`/api/batches/${id}`);
        if (!n.running) { clearInterval(pollTimer); render(); return; }
        const log = $('#log');
        if (log) { const atEnd = log.scrollTop + log.clientHeight >= log.scrollHeight - 20; log.textContent = n.batch.log; if (atEnd) log.scrollTop = log.scrollHeight; }
      } catch {}
    }, 2000);
  }
}
async function batchSheet(id) {
  const d = await api(`/api/batches/${id}`);
  const b = d.batch;
  const counts = d.items.reduce((a, i) => ((a[i.result] = (a[i.result] || 0) + 1), a), {});
  const sheet = openModal(`<h2>Batch #${b.id} ${badge(b.status, BATCH[b.status])}</h2>
    <p class="muted">Built ${when(b.created_at)} by ${esc(b.created_by)} · started ${when(b.started_at)} · finished ${when(b.finished_at)}</p>
    <p>${Object.entries(counts).map(([k, v]) => `${badge(k, k.replace('_', ' '))} ${v}`).join(' &nbsp; ')}</p>
    ${b.log ? `<h3>Script output</h3><pre class="log">${esc(b.log)}</pre>` : ''}
    <h3>Creators</h3><div class="list">${d.items.map((i) => `<div class="it"><span>@${esc(i.handle)} <small>${STATUS[i.status] || ''}</small></span>${badge(i.result, i.result.replace('_', ' '))}</div>`).join('')}</div>
    <div class="foot"><button id="bdl">Download list</button><button id="bx" class="primary">Close</button></div>`);
  $('#bx', sheet).onclick = closeModal;
  $('#bdl', sheet).onclick = act(async () => { const r = await api(`/api/batches/${id}/csv`); download(r.filename, r.csv); });
}

// ---------- Go sales & rewards ----------
let goMonth = '';
async function goSales(main) {
  const d = await api('/api/go' + (goMonth ? `?month=${goMonth}` : ''));
  goMonth = d.month;
  const months = [...new Set([todayStr().slice(0, 7), d.month, ...d.months])].sort().reverse();
  const total = d.rows.reduce((a, r) => a + r.sales, 0);
  main.innerHTML = `
    <div class="head"><div><h1>Go sales &amp; rewards</h1><div class="muted">Which Go creators are posting and selling, and who has earned a reward.</div></div>
      <div class="row"><select id="gm">${months.map((m) => `<option value="${m}" ${m === d.month ? 'selected' : ''}>${monthName(m)}</option>`).join('')}</select><button id="gimp">Import Go sales</button></div></div>
    <div class="grid g4" style="margin-bottom:14px">
      <div class="card kpi"><div class="l">Sales in ${monthName(d.month)}</div><div class="n">${money(total)}</div></div>
      <div class="card kpi"><div class="l">Creators selling</div><div class="n">${fmt(d.rows.filter((r) => r.sales > 0).length)}</div><div class="s">of ${fmt(d.rows.length)} with entries</div></div>
      <div class="card kpi"><div class="l">Go videos</div><div class="n">${fmt(d.rows.reduce((a, r) => a + r.videos, 0))}</div></div>
      <div class="card kpi"><div class="l">Rewards to send</div><div class="n">${fmt(d.rewards.filter((r) => r.status !== 'sent').length)}</div></div>
    </div>
    <div class="card" style="margin-bottom:14px"><h2>Add or update a month</h2>
      <form id="gf" class="form"><label class="f">TikTok handle<input name="handle" required placeholder="@creator"></label>
        <label class="f">Month<input name="month" type="month" value="${d.month}" required></label>
        <label class="f">Go videos<input name="videos" type="number" min="0" value="0"></label>
        <label class="f">Sales ($)<input name="sales" inputmode="decimal" placeholder="0"></label>
        <label class="f">Notes<input name="notes"></label><button class="primary">Save</button></form></div>
    <div class="grid g2">
      <div><h3>${monthName(d.month)}</h3>${d.rows.length ? `<div class="tablewrap"><table><thead><tr><th>#</th><th>Creator</th><th class="num">Videos</th><th class="num">Sales</th><th></th></tr></thead><tbody>
        ${d.rows.map((r, i) => `<tr><td>${i + 1}</td><td><span class="handle" data-id="${r.creator_id}">@${esc(r.handle)}</span> ${r.non_us ? badge('warn', 'Non-US') : ''}${r.notes ? `<br><small>${esc(r.notes)}</small>` : ''}</td><td class="num">${fmt(r.videos)}</td><td class="num"><b>${money(r.sales)}</b></td>
          <td><button class="small rw" data-h="${esc(r.handle)}">Reward</button> <button class="small danger gd" data-id="${r.id}" aria-label="Delete entry">✕</button></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">No entries for this month.</p>'}</div>
      <div><h3>All-time leaders</h3>${d.allTime.length ? `<div class="card list">${d.allTime.map((r, i) => `<div class="it"><span>${i + 1}. <span class="handle" data-id="${r.id}">@${esc(r.handle)}</span> <small>${fmt(r.videos)} videos · ${r.months} mo</small></span><b>${money(r.sales)}</b></div>`).join('')}</div>` : '<p class="muted">Nothing yet.</p>'}</div>
    </div>
    <h3>Rewards</h3>
    <div class="card" style="margin-bottom:14px"><form id="rf" class="form">
      <label class="f">TikTok handle<input name="handle" id="rh" required placeholder="@creator"></label>
      <label class="f">Reward<select name="kind"><option>Dining voucher</option><option>Hotel stay</option><option>Gift card</option><option>Cash bonus</option><option>Other</option></select></label>
      <label class="f">Value ($)<input name="value" inputmode="decimal"></label>
      <label class="f">Notes<input name="notes" placeholder="Why, e.g. $21K in sales"></label><button class="primary">Add reward</button></form></div>
    ${d.rewards.length ? `<div class="tablewrap"><table><thead><tr><th>Creator</th><th>Reward</th><th class="num">Value</th><th>Notes</th><th>Status</th><th></th></tr></thead><tbody>
      ${d.rewards.map((r) => `<tr><td>@${esc(r.handle)}</td><td>${esc(r.kind)}</td><td class="num">${r.value ? money(r.value) : '—'}</td><td class="wrap">${esc(r.notes || '')}</td>
        <td>${r.status === 'sent' ? `${badge('sent', 'Sent')} <small>${day(r.date)}</small>` : badge('ready', 'Planned')}</td>
        <td><button class="small rs" data-id="${r.id}" data-s="${r.status === 'sent' ? 'planned' : 'sent'}">${r.status === 'sent' ? 'Undo' : 'Mark sent'}</button> <button class="small danger rd" data-id="${r.id}" aria-label="Delete reward">✕</button></td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted">No rewards yet.</p>'}`;
  $('#gm').onchange = (e) => { goMonth = e.target.value; render(); };
  $('#gimp').onclick = () => importSheet('go_sales');
  $('#gf').onsubmit = act(async (e) => { e.preventDefault(); const body = formData(e.target); await api('/api/go', { method: 'POST', body }); goMonth = body.month; toast('Saved'); render(); });
  $('#rf').onsubmit = act(async (e) => { e.preventDefault(); await api('/api/rewards', { method: 'POST', body: formData(e.target) }); toast('Reward added'); render(); });
  $$('.rw', main).forEach((b) => (b.onclick = () => { $('#rh').value = '@' + b.dataset.h; $('#rh').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('#rh').focus(); }));
  $$('.gd', main).forEach((b) => (b.onclick = act(async () => { if (confirm('Delete this sales entry?')) { await api(`/api/go/${b.dataset.id}`, { method: 'DELETE' }); render(); } })));
  $$('.rs', main).forEach((b) => (b.onclick = act(async () => { await api(`/api/rewards/${b.dataset.id}`, { method: 'PATCH', body: { status: b.dataset.s, date: b.dataset.s === 'sent' ? todayStr() : null } }); render(); })));
  $$('.rd', main).forEach((b) => (b.onclick = act(async () => { if (confirm('Delete this reward?')) { await api(`/api/rewards/${b.dataset.id}`, { method: 'DELETE' }); render(); } })));
  $$('.handle', main).forEach((el) => (el.onclick = () => creatorSheet(el.dataset.id)));
}

// ---------- Revenue ----------
async function revenue(main) {
  const rows = await api('/api/revenue');
  const best = rows.reduce((a, r) => (r.revenue > (a?.revenue ?? -1) ? r : a), null);
  const last6 = rows.slice(0, 6).filter((r) => r.revenue != null);
  const avg = last6.length ? last6.reduce((a, r) => a + r.revenue, 0) / last6.length : null;
  main.innerHTML = `
    <div class="head"><div><h1>Agency revenue</h1><div class="muted">Monthly LIVE agency earnings, diamonds against the benchmark, and the revenue share.</div></div></div>
    <div class="grid g4" style="margin-bottom:14px">
      <div class="card kpi"><div class="l">Latest month</div><div class="n">${rows[0] ? money(rows[0].revenue) : '—'}</div><div class="s">${rows[0] ? monthName(rows[0].month) : ''}</div></div>
      <div class="card kpi"><div class="l">Best month</div><div class="n">${best ? money(best.revenue) : '—'}</div><div class="s">${best ? monthName(best.month) : ''}</div></div>
      <div class="card kpi"><div class="l">Average (last ${last6.length || 0} months)</div><div class="n">${avg != null ? money(Math.round(avg)) : '—'}</div></div>
    </div>
    <div class="card" style="margin-bottom:14px"><h2>Add or update a month</h2>
      <form id="rvf" class="form"><label class="f">Month<input name="month" type="month" required value="${todayStr().slice(0, 7)}"></label>
        <label class="f">Agency revenue ($)<input name="revenue" inputmode="decimal" required></label>
        <label class="f">Total diamonds<input name="diamonds" inputmode="numeric"></label>
        <label class="f">Diamond benchmark<input name="benchmark" inputmode="numeric"></label>
        <label class="f">Revenue share (%)<input name="share_pct" inputmode="decimal" value="14"></label>
        <label class="f">Notes<input name="notes"></label><button class="primary">Save</button></form></div>
    ${rows.length ? `<div class="tablewrap"><table><thead><tr><th>Month</th><th class="num">Revenue</th><th class="num">Diamonds</th><th class="num">Benchmark</th><th>Of benchmark</th><th class="num">Share</th><th>Notes</th><th></th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${monthName(r.month)}</td><td class="num"><b>${money(r.revenue)}</b></td><td class="num">${fmt(r.diamonds)}</td><td class="num">${fmt(r.benchmark)}</td>
        <td style="min-width:120px">${r.diamonds && r.benchmark ? `${Math.round((r.diamonds / r.benchmark) * 100)}%${meter(r.diamonds, r.benchmark)}` : '—'}</td><td class="num">${fmt(r.share_pct)}%</td><td class="wrap">${esc(r.notes || '')}</td>
        <td><button class="small re" data-m="${r.month}">Edit</button> <button class="small danger rx" data-m="${r.month}" aria-label="Delete month">✕</button></td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted">No months entered yet.</p>'}`;
  $('#rvf').onsubmit = act(async (e) => { e.preventDefault(); await api('/api/revenue', { method: 'POST', body: formData(e.target) }); toast('Saved'); render(); });
  $$('.re', main).forEach((b) => (b.onclick = () => {
    const r = rows.find((x) => x.month === b.dataset.m); const f = $('#rvf');
    for (const k of ['month', 'revenue', 'diamonds', 'benchmark', 'share_pct', 'notes']) f.elements[k].value = r[k] ?? '';
    f.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));
  $$('.rx', main).forEach((b) => (b.onclick = act(async () => { if (confirm(`Delete ${monthName(b.dataset.m)}?`)) { await api(`/api/revenue/${b.dataset.m}`, { method: 'DELETE' }); render(); } })));
}

// ---------- Hours ----------
let hoursRange = 'week';
async function hours(main) {
  const d0 = new Date();
  const from = hoursRange === 'all' ? '0000-01-01' : hoursRange === '2weeks' ? (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; })()
    : hoursRange === 'month' ? `${d0.getFullYear()}-${pad(d0.getMonth() + 1)}-01` : '';
  const d = await api('/api/hours' + (from ? `?from=${from}` : ''));
  const over = d.week.filter((w) => w.h >= d.cap);
  const near = d.week.filter((w) => w.h >= d.cap * 0.8 && w.h < d.cap);
  const total = d.rows.reduce((a, r) => a + r.hours, 0);
  main.innerHTML = `
    <div class="head"><div><h1>Hours</h1><div class="muted">Log work time. The weekly limit is ${d.cap} hours; going over needs an OK first.</div></div></div>
    ${over.map((w) => `<div class="alert bad"><b>${esc(w.person)} has reached ${fmt(w.h)} hours this week.</b> Let Nechelle know before working more hours.</div>`).join('')}
    ${near.map((w) => `<div class="alert warn">${esc(w.person)} is at ${fmt(w.h)} of ${d.cap} hours this week.</div>`).join('')}
    <div class="grid g2" style="margin-bottom:14px">
      <div class="card"><h2>Log time</h2><form id="hf" class="form">
        <label class="f">Name<input name="person" required value="${esc(USER)}"></label>
        <label class="f">Date<input name="date" type="date" required value="${todayStr()}"></label>
        <label class="f">Hours<input name="hours" inputmode="decimal" required placeholder="1.5"></label>
        <label class="f" style="grid-column:1/-1">What you worked on<input name="task" placeholder="e.g. API research"></label>
        <button class="primary">Log hours</button></form></div>
      <div class="card"><h2>This week <small>· since ${day(d.weekStart)}</small></h2>
        ${d.week.length ? d.week.map((w) => `<div style="margin-bottom:10px"><div class="row" style="justify-content:space-between"><span>${esc(w.person)}</span><b>${fmt(w.h)} / ${d.cap} h</b></div>${meter(w.h, d.cap)}</div>`).join('') : '<p class="muted">No hours logged this week.</p>'}</div>
    </div>
    <div class="row" style="justify-content:space-between;margin-bottom:8px"><select id="hr">${Object.entries({ week: 'This week', '2weeks': 'This week and last', month: 'This month', all: 'All time' }).map(([k, v]) => `<option value="${k}" ${hoursRange === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <span class="row"><span class="muted">${fmt(total)} hours</span><button id="hx">Export CSV</button></span></div>
    ${d.rows.length ? `<div class="tablewrap"><table><thead><tr><th>Date</th><th>Name</th><th class="num">Hours</th><th>Work</th><th></th></tr></thead><tbody>
      ${d.rows.map((r) => `<tr><td>${day(r.date)}</td><td>${esc(r.person)}</td><td class="num">${fmt(r.hours)}</td><td class="wrap">${esc(r.task || '')}</td><td><button class="small danger hd" data-id="${r.id}" aria-label="Delete entry">✕</button></td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted">No entries in this range.</p>'}`;
  $('#hf').onsubmit = act(async (e) => { e.preventDefault(); await api('/api/hours', { method: 'POST', body: formData(e.target) }); toast('Hours logged'); render(); });
  $('#hr').onchange = (e) => { hoursRange = e.target.value; render(); };
  $('#hx').onclick = () => download(`hours-${todayStr()}.csv`, 'date,name,hours,work\n' + d.rows.map((r) => [r.date, r.person, r.hours, r.task || ''].map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(',')).join('\n') + '\n');
  $$('.hd', main).forEach((b) => (b.onclick = act(async () => { if (confirm('Delete this entry?')) { await api(`/api/hours/${b.dataset.id}`, { method: 'DELETE' }); render(); } })));
}

// ---------- Activity ----------
async function activity(main) {
  const rows = await api('/api/activity?limit=500');
  main.innerHTML = `<div class="head"><div><h1>Activity</h1><div class="muted">Everything done in the hub, newest first.</div></div></div>
    ${rows.length ? `<div class="tablewrap"><table><thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead><tbody>
      ${rows.map((a) => `<tr><td>${when(a.at)}</td><td>${esc(a.who)}</td><td>${esc(a.action)}</td><td class="wrap">${esc(a.detail)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Nothing yet.</p>'}`;
}

// ---------- Settings ----------
function phoneCard() {
  if (!AUTH.local) {
    return `<div class="card" style="margin-bottom:14px"><h2>This device</h2><p class="muted">You're signed in on this phone or computer.</p><button id="plo">Sign out</button></div>`;
  }
  const addrs = AUTH.addresses || [];
  const ts = addrs.filter((a) => a.tailscale), wifi = addrs.filter((a) => !a.tailscale);
  return `<div class="card" style="margin-bottom:14px"><h2>Phone access</h2>
    ${AUTH.shared
      ? `<p>Phone access is <b>on</b>. On your phone, open:</p>
         <div class="list">${wifi.map((a) => `<div class="it"><b>${esc(a.url)}</b><small>same Wi-Fi as this computer</small></div>`).join('')}
         ${ts.map((a) => `<div class="it"><b>${esc(a.url)}</b><small>Tailscale: works from anywhere</small></div>`).join('')}</div>
         <p class="muted">Then tap Share → <b>Add to Home Screen</b> so it opens like an app. This computer has to stay on with the hub running.</p>`
      : `<div class="alert info">Phone access is <b>off</b>. To turn it on, close the hub and start it with <b>Start Recruiting Hub (phone access).bat</b> instead.</div>`}
    <h3>Passcode</h3>
    <p class="muted">${AUTH.passcodeSet ? 'A passcode is set. Saving a new one signs out every phone.' : '<b>No passcode yet.</b> Phones can\'t sign in until you set one.'} This computer never needs it.</p>
    <form id="pcf" class="row"><input name="passcode" type="password" minlength="6" required placeholder="At least 6 characters" autocomplete="new-password" style="width:240px"><button class="primary">${AUTH.passcodeSet ? 'Change passcode' : 'Set passcode'}</button></form>
    ${AUTH.devices ? `<p class="row" style="margin-top:12px"><span class="muted">${AUTH.devices} device(s) signed in.</span><button id="pso" class="danger">Sign out all devices</button></p>` : ''}</div>`;
}
async function settingsPage(main) {
  const s = await api('/api/settings');
  const inp = (k, label, type = 'text', extra = '') => `<label class="f">${label}<input name="${k}" type="${type}" value="${esc(s[k])}" ${extra}></label>`;
  main.innerHTML = `
    <div class="head"><div><h1>Settings</h1><div class="muted">Shared by everyone using this hub.</div></div><button id="save" class="primary">Save settings</button></div>
    <form id="sf">
    <div class="card" style="margin-bottom:14px"><h2>Outreach limits</h2><p class="muted">From the Backstage limits: tranches of about 350, 1,000–1,500 messages a day.</p><div class="form">
      ${inp('batch_size', 'Max creators per batch', 'number', 'min="1"')}${inp('daily_cap', 'Max messages per day', 'number', 'min="1"')}
      ${inp('cooldown_min', 'Minutes between batches', 'number', 'min="0"')}${inp('weekly_hours_cap', 'Weekly hours limit', 'number', 'min="1"')}</div></div>
    <div class="card" style="margin-bottom:14px"><h2>LIVE invite rules</h2><p class="muted">Regular invite: followers and highest monthly diamonds (past 6 months) both at or under these limits. Anyone over either one needs a premium invite.</p><div class="form">
      ${inp('follower_limit', 'Follower limit', 'number')}${inp('diamond_limit', 'Monthly diamond limit', 'number')}${inp('premium_invites_left', 'Premium invites left', 'number', 'min="0"')}</div></div>
    <div class="card" style="margin-bottom:14px"><h2>Creator data API</h2>
      <p class="muted">Fills in followers, diamonds, league and region. Stay on <b>Demo</b> until a provider is chosen; demo numbers are made up. For a real provider, put <code>{handle}</code> in the address where the username goes, then tell the hub where each number is in the response (for example <code>data.stats.followers</code>).</p>
      <div class="form">
        <label class="f">Mode<select name="api_mode"><option value="demo" ${s.api_mode !== 'http' ? 'selected' : ''}>Demo (made-up data)</option><option value="http" ${s.api_mode === 'http' ? 'selected' : ''}>Real API</option></select></label>
        ${inp('api_daily_quota', 'Checks per day (plan limit)', 'number', 'min="0"')}
        <label class="f" style="grid-column:1/-1">API address<input name="api_url" value="${esc(s.api_url)}" placeholder="https://api.example.com/v1/creator?username={handle}"></label>
        ${inp('api_key', 'API key', 'password', 'autocomplete="off"')}${inp('api_key_header', 'Key header name')}
        ${inp('map_followers', 'Followers field')}${inp('map_diamonds', 'Max monthly diamonds field')}${inp('map_league', 'League field')}${inp('map_region', 'Region field')}${inp('map_country', 'Country field')}
      </div>
      <div class="row" style="margin-top:12px"><input id="th" placeholder="@handle to test" style="width:200px"><button type="button" id="test">Test lookup</button></div>
      <pre class="log" id="tout" hidden style="margin-top:10px"></pre></div>
    <div class="card" style="margin-bottom:14px"><h2>Sending</h2>
      <p class="muted"><b>Download the list</b>: you get a CSV for each batch and mark it done afterward. <b>Run a script</b>: the hub runs the messaging script for you. It passes the batch file as <code>{file}</code> (also in the <code>BATCH_FILE</code> environment variable) and the message in <code>MESSAGE_TEMPLATE</code>. If the script prints <code>SENT handle</code> or <code>FAIL handle</code> lines, the hub records each one. It stops and pauses sending if the output mentions spam, rate limits, captchas or a restricted account.</p>
      <div class="form">
        <label class="f">How messages go out<select name="send_mode"><option value="export" ${s.send_mode !== 'command' ? 'selected' : ''}>Download the list</option><option value="command" ${s.send_mode === 'command' ? 'selected' : ''}>Run a script</option></select></label>
        <label class="f" style="grid-column:span 2">Script command<input name="send_command" value="${esc(s.send_command)}" placeholder='python send_dms.py {file}'></label>
        <label class="f">Script folder<input name="send_cwd" value="${esc(s.send_cwd)}" placeholder="C:\\path\\to\\script"></label>
        <label class="f" style="grid-column:1/-1">Message template <small>({name} becomes the creator's name)</small><textarea name="message_template">${esc(s.message_template)}</textarea></label>
      </div></div>
    </form>
    ${phoneCard()}
    <div class="card"><h2>Sample data</h2><p class="muted">60 made-up creators (handles start with "sample_") to try things out. Remove them before real work.</p>
      <div class="row"><button id="sl">Load sample data</button><button id="sr" class="danger">Remove sample data</button></div></div>`;
  $('#save').onclick = act(async () => { const r = await api('/api/settings', { method: 'PUT', body: formData($('#sf')) }); toast(r.changed.length ? 'Settings saved' : 'Nothing changed'); render(); });
  $('#test').onclick = act(async () => {
    const out = $('#tout'); out.hidden = false; out.textContent = 'Checking…';
    try { out.textContent = JSON.stringify(await api('/api/check/test', { method: 'POST', body: { handle: $('#th').value, settings: formData($('#sf')) } }), null, 2); }
    catch (e) { out.textContent = e.message; }
  });
  $('#pcf')?.addEventListener('submit', act(async (e) => {
    e.preventDefault();
    await api('/api/passcode', { method: 'POST', body: formData(e.target) });
    toast('Passcode saved. Phones can sign in now.'); AUTH = await api('/api/auth'); render();
  }));
  $('#pso')?.addEventListener('click', act(async () => {
    if (!confirm('Sign out every phone and other device?')) return;
    const r = await api('/api/devices/signout', { method: 'POST' }); toast(`Signed out ${r.removed} device(s)`); AUTH = await api('/api/auth'); render();
  }));
  $('#plo')?.addEventListener('click', act(async () => { await api('/api/logout', { method: 'POST' }); location.reload(); }));
  $('#sl').onclick = act(async () => { const r = await api('/api/sample', { method: 'POST' }); toast(`Loaded ${r.created} sample creators`); });
  $('#sr').onclick = act(async () => { if (!confirm('Remove all sample creators and their data?')) return; const r = await api('/api/sample', { method: 'DELETE' }); toast(`Removed ${r.removed} sample creators`); });
}
