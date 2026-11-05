import { CONFIG } from './config.js';
import { dataService } from './services/dataService.js';
import { authService } from './services/authService.js';

const app = document.getElementById('app');
const tabbar = document.getElementById('tabbar');
const state = {
  user: null,
  locations: null,
  filters: { q: '', country: '', state: '', city: '', platform: '', category: '' },
};

// ---------- helpers ----------
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = app) => root.querySelector(sel);
const platformLabel = (id) => CONFIG.PLATFORMS.find((p) => p.id === id)?.label || id;
const countryName = (code) => state.locations?.countries.find((c) => c.code === code)?.name || code;
const fmtNum = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n % 1000 ? 1 : 0)}K` : String(n));
const parseDate = (iso) => new Date(`${iso}T12:00:00`);
const fmtDate = (iso, opts) => parseDate(iso).toLocaleDateString('en-US', opts);
const banner = (color) => `background: radial-gradient(circle at 85% 20%, ${color}cc, transparent 60%), linear-gradient(135deg, ${color}55, #1f1f2b);`;
const initials = (name = '') => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const totalFollowers = (u) => (u?.platforms || []).reduce((s, p) => s + (Number(p.followers) || 0), 0);

function options(list, selected, placeholder) {
  return `<option value="">${esc(placeholder)}</option>` +
    list.map((o) => {
      const [value, label] = typeof o === 'string' ? [o, o] : [o.value, o.label];
      return `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`;
    }).join('');
}

function statesFor(country) {
  return state.locations.countries.find((c) => c.code === country)?.states || [];
}
function citiesFor(country, st) {
  return statesFor(country).find((s) => s.name === st)?.cities || [];
}

// Set CONFIG.LOGO_URL to use the brand logo image instead of the text logo.
function logoHtml(extra = '') {
  return CONFIG.LOGO_URL
    ? `<img class="logo-img ${extra}" src="${CONFIG.LOGO_URL}" alt="${CONFIG.APP_NAME}">`
    : `<div class="logo ${extra}">Covenant<span class="go">Go</span></div>`;
}

// ---------- router ----------
const routes = [
  { path: /^#\/welcome$/, view: welcomeView, public: true },
  { path: /^#\/login$/, view: loginView, public: true },
  { path: /^#\/signup$/, view: signupView, public: true },
  { path: /^#\/discover$/, view: discoverView, tab: 'discover' },
  { path: /^#\/day\/([\w-]+)$/, view: dayView, tab: 'discover' },
  { path: /^#\/my-days$/, view: myDaysView, tab: 'my-days' },
  { path: /^#\/profile$/, view: profileView, tab: 'profile' },
];

async function router() {
  const hash = location.hash || (state.user ? '#/discover' : '#/welcome');
  const route = routes.find((r) => r.path.test(hash));
  if (!route) return go(state.user ? '#/discover' : '#/welcome');
  if (!route.public && !state.user) return go('#/welcome');
  if (route.public && state.user) return go('#/discover');

  tabbar.hidden = !!route.public;
  tabbar.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.dataset.tab === route.tab));
  const params = hash.match(route.path).slice(1);
  window.scrollTo(0, 0);
  try {
    await route.view(...params);
  } catch (e) {
    app.innerHTML = `<div class="empty">Something went wrong: ${esc(e.message)}</div>`;
  }
}
const go = (hash) => { location.hash = hash; };

// ---------- views ----------
async function welcomeView() {
  const days = await dataService.getContentDays();
  const partners = new Set(days.map((d) => d.partnerId)).size;
  const cities = new Set(days.map((d) => d.location.city)).size;
  app.innerHTML = `
    <section class="hero">
      ${logoHtml('hero-logo')}
      <h1>Get booked for content days.</h1>
      <p>CovenantGo connects TikTok GO <strong class="accent">creators</strong> with hotels, resorts, and things to do across the United States and Mexico.</p>
      <div class="hero-stats">
        <div><b>${days.length}</b><span>Open content days</span></div>
        <div><b>${partners}</b><span>Partners</span></div>
        <div><b>${cities}</b><span>Cities</span></div>
      </div>
      <div class="stack">
        <a class="btn" href="#/signup">Create creator account</a>
        <a class="btn secondary" href="#/login">I already have an account</a>
      </div>
    </section>`;
}

function loginView() {
  app.innerHTML = `
    <a class="back" href="#/welcome">‹ Back</a>
    <div class="page-head"><h1>Welcome back</h1></div>
    <form class="stack" id="login">
      <div class="field"><label for="email">Email</label><input class="input" id="email" name="email" type="email" autocomplete="email" required></div>
      <div class="field"><label for="password">Password</label><input class="input" id="password" name="password" type="password" autocomplete="current-password" required></div>
      <div class="error" id="err"></div>
      <button class="btn" type="submit">Log in</button>
      <a class="btn ghost" href="#/signup">New here? Create an account</a>
    </form>`;
  $('#login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      state.user = await authService.signIn({ email: f.get('email'), password: f.get('password') });
      go('#/discover');
    } catch (err) {
      $('#err').textContent = err.message;
    }
  });
}

function locationFields(prefix, loc = {}) {
  const country = loc.country || 'US';
  return `
    <div class="field"><label for="${prefix}-country">Country</label>
      <select class="input" id="${prefix}-country" name="country" required>
        ${options(state.locations.countries.map((c) => ({ value: c.code, label: c.name })), country, 'Select country')}
      </select></div>
    <div class="row">
      <div class="field"><label for="${prefix}-state">State</label><input class="input" id="${prefix}-state" name="state" value="${esc(loc.state || '')}" placeholder="e.g. Texas" required></div>
      <div class="field"><label for="${prefix}-city">City</label><input class="input" id="${prefix}-city" name="city" value="${esc(loc.city || '')}" placeholder="e.g. Austin" required></div>
    </div>`;
}

function platformFields(existing = []) {
  return CONFIG.PLATFORMS.map((p) => {
    const cur = existing.find((x) => x.id === p.id) || {};
    return `
      <div class="platform-row">
        <span class="name">${esc(p.label)}</span>
        <input class="input" name="handle-${p.id}" placeholder="@handle" value="${esc(cur.handle || '')}" autocapitalize="off" autocorrect="off">
        <input class="input" name="followers-${p.id}" placeholder="Followers" inputmode="numeric" value="${esc(cur.followers || '')}">
      </div>`;
  }).join('');
}

function readPlatforms(f) {
  return CONFIG.PLATFORMS.map((p) => ({
    id: p.id,
    handle: String(f.get(`handle-${p.id}`) || '').trim().replace(/^@?/, '@'),
    followers: Number(String(f.get(`followers-${p.id}`) || '').replace(/[^\d]/g, '')) || 0,
  })).filter((p) => p.handle.length > 1);
}

function signupView() {
  app.innerHTML = `
    <a class="back" href="#/welcome">‹ Back</a>
    <div class="page-head"><h1>Create your account</h1></div>
    <form class="stack" id="signup">
      <div class="field"><label for="name">Full name</label><input class="input" id="name" name="name" autocomplete="name" required></div>
      <div class="field"><label for="email">Email</label><input class="input" id="email" name="email" type="email" autocomplete="email" required></div>
      <div class="field"><label for="password">Password</label><input class="input" id="password" name="password" type="password" minlength="8" autocomplete="new-password" required></div>

      <div class="section-title">Where are you based?</div>
      ${locationFields('su')}

      <div class="section-title">Your platforms</div>
      ${platformFields()}

      <div class="error" id="err"></div>
      <button class="btn" type="submit">Join CovenantGo</button>
    </form>`;

  $('#signup').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const platforms = readPlatforms(f);
    if (!platforms.length) return ($('#err').textContent = 'Add at least one platform handle.');
    try {
      state.user = await authService.signUp({
        name: f.get('name'),
        email: f.get('email'),
        password: f.get('password'),
        location: { country: f.get('country'), state: f.get('state').trim(), city: f.get('city').trim() },
        platforms,
      });
      go('#/discover');
    } catch (err) {
      $('#err').textContent = err.message;
    }
  });
}

async function discoverView() {
  const f = state.filters;
  const categories = ['Hotels & Resorts', 'Things to Do'];
  app.innerHTML = `
    <div class="page-head">
      ${logoHtml()}
    </div>
    <div class="search">
      <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input class="input" id="q" type="search" placeholder="Search hotels, groups, cities…" value="${esc(f.q)}">
    </div>
    <div class="filters">
      <select class="input" id="country" aria-label="Country">${options(state.locations.countries.map((c) => ({ value: c.code, label: c.name })), f.country, 'Country')}</select>
      <select class="input" id="state" aria-label="State" ${f.country ? '' : 'disabled'}>${options(statesFor(f.country).map((s) => s.name), f.state, 'State')}</select>
      <select class="input" id="city" aria-label="City" ${f.state ? '' : 'disabled'}>${options(citiesFor(f.country, f.state), f.city, 'City')}</select>
    </div>
    <div class="chips" id="platforms">
      <button class="chip ${f.platform ? '' : 'active'}" data-platform="">All platforms</button>
      ${CONFIG.PLATFORMS.slice(0, 5).map((p) => `<button class="chip ${f.platform === p.id ? 'active' : ''}" data-platform="${p.id}">${esc(p.label)}</button>`).join('')}
    </div>
    <div class="chips" id="categories">
      <button class="chip ${f.category ? '' : 'active'}" data-category="">All</button>
      ${categories.map((c) => `<button class="chip ${f.category === c ? 'active' : ''}" data-category="${c}">${c}</button>`).join('')}
    </div>
    <div class="result-count"><span id="count"></span><button id="clear" type="button">Clear filters</button></div>
    <div class="cards" id="results"><div class="loading">Loading content days…</div></div>`;

  const refresh = async () => {
    const days = await dataService.getContentDays({ ...f, fromDate: new Date().toISOString().slice(0, 10) });
    $('#count').textContent = `${days.length} content day${days.length === 1 ? '' : 's'}`;
    $('#results').innerHTML = days.length
      ? days.map(cardHtml).join('')
      : `<div class="empty">No content days match those filters yet.</div>`;
  };

  let t;
  $('#q').addEventListener('input', (e) => { f.q = e.target.value; clearTimeout(t); t = setTimeout(refresh, 150); });
  $('#country').addEventListener('change', (e) => { Object.assign(f, { country: e.target.value, state: '', city: '' }); discoverView(); });
  $('#state').addEventListener('change', (e) => { Object.assign(f, { state: e.target.value, city: '' }); discoverView(); });
  $('#city').addEventListener('change', (e) => { f.city = e.target.value; refresh(); });
  $('#platforms').addEventListener('click', (e) => {
    const b = e.target.closest('[data-platform]'); if (!b) return;
    f.platform = b.dataset.platform; discoverView();
  });
  $('#categories').addEventListener('click', (e) => {
    const b = e.target.closest('[data-category]'); if (!b) return;
    f.category = b.dataset.category; discoverView();
  });
  $('#clear').addEventListener('click', () => {
    Object.assign(f, { q: '', country: '', state: '', city: '', platform: '', category: '' }); discoverView();
  });
  await refresh();
}

function spotsHtml(d) {
  const left = d.spotsTotal - d.spotsTaken;
  const cls = left === 0 ? 'full' : left <= 2 ? 'low' : '';
  return `<span class="spots ${cls}">${left === 0 ? 'Waitlist' : `${left} of ${d.spotsTotal} spots left`}</span>`;
}

function cardHtml(d) {
  const p = d.partner;
  return `
    <a class="card" href="#/day/${d.id}">
      <div class="card-banner" style="${banner(p.accentColor)}">
        <div class="date-badge"><b>${fmtDate(d.date, { day: 'numeric' })}</b><span>${fmtDate(d.date, { month: 'short' })}</span></div>
        <span class="pill go">TikTok GO · ${d.commissionRate}%</span>
      </div>
      <div class="card-body">
        <h3>${esc(d.title)}</h3>
        <div class="card-meta">${esc(p.type)} · ${esc(p.name)} · ${esc(d.location.city)}, ${esc(d.location.state)}, ${esc(d.location.country)}</div>
        <div class="card-foot">
          ${spotsHtml(d)}
          <div class="icons">${d.platforms.map((x) => `<span>${esc(platformLabel(x))}</span>`).join('')}</div>
        </div>
      </div>
    </a>`;
}

async function dayView(id) {
  const d = await dataService.getContentDay(id);
  if (!d) { app.innerHTML = `<div class="empty">Content day not found.</div>`; return; }
  const p = d.partner;
  const applied = state.user.applications?.find((a) => a.contentDayId === id);
  const followers = totalFollowers(state.user);
  const eligible = followers >= d.minFollowers;
  const full = d.spotsTaken >= d.spotsTotal;

  app.innerHTML = `
    <a class="back" href="#/discover">‹ Discover</a>
    <div class="detail-banner" style="${banner(p.accentColor)}">
      <span class="pill go" style="align-self:flex-start;margin-bottom:auto">TikTok GO partner</span>
      <h1>${esc(d.title)}</h1>
      <p>${esc(p.name)} · ${esc(p.group)}</p>
    </div>
    <div class="facts">
      <div class="fact"><span>Date</span><b>${fmtDate(d.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</b></div>
      <div class="fact"><span>Call time</span><b>${esc(d.time)}</b></div>
      <div class="fact"><span>Location</span><b>${esc(d.location.city)}, ${esc(d.location.state)}</b></div>
      <div class="fact"><span>Country</span><b>${esc(countryName(d.location.country))}</b></div>
      <div class="fact"><span>Booking commission</span><b>${d.commissionRate}% via TikTok GO</b></div>
      <div class="fact"><span>Min. followers</span><b>${fmtNum(d.minFollowers)}</b></div>
    </div>

    <div class="section-title">What you get</div>
    <ul class="list">${d.perks.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>

    <div class="section-title">Deliverables</div>
    <ul class="list">${d.deliverables.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>

    <div class="section-title">Platforms</div>
    <div class="chips">${d.platforms.map((x) => `<span class="chip">${esc(platformLabel(x))}</span>`).join('')}</div>

    <div class="section-title">About the partner</div>
    <p class="card-meta">${esc(p.description)} Rated ${p.rating}★.</p>

    <div class="section-title">Availability</div>
    <p>${spotsHtml(d)}</p>

    <div class="sticky-cta"><div id="cta"></div></div>`;

  const cta = $('#cta');
  const renderCta = (isApplied) => {
    if (isApplied) {
      cta.innerHTML = `<div class="notice ok">Request sent — the partner will confirm your spot.</div>`;
    } else if (!eligible) {
      cta.innerHTML = `<div class="notice">This day needs ${fmtNum(d.minFollowers)}+ followers. Your profile shows ${fmtNum(followers)}. <a href="#/profile">Update platforms</a></div>`;
    } else {
      cta.innerHTML = `<button class="btn" id="apply">${full ? 'Join waitlist' : 'Request a spot'}</button>`;
      $('#apply').addEventListener('click', async () => {
        state.user = await authService.applyToContentDay(id);
        renderCta(true);
      });
    }
  };
  renderCta(!!applied);
}

async function myDaysView() {
  const apps = state.user.applications || [];
  const all = await dataService.getContentDays();
  const byId = Object.fromEntries(all.map((d) => [d.id, d]));
  const rows = apps.map((a) => ({ ...a, day: byId[a.contentDayId] })).filter((a) => a.day);

  app.innerHTML = `
    <div class="page-head"><h1>My Content Days</h1></div>
    ${rows.length ? `<div class="cards">${rows.map((r) => `
      <a class="card" href="#/day/${r.day.id}">
        <div class="card-body">
          <div class="card-foot" style="margin:0 0 6px"><span class="card-meta">${fmtDate(r.day.date, { weekday: 'short', month: 'short', day: 'numeric' })} · ${esc(r.day.time)}</span><span class="status">${esc(r.status)}</span></div>
          <h3>${esc(r.day.title)}</h3>
          <div class="card-meta">${esc(r.day.partner.name)} · ${esc(r.day.location.city)}, ${esc(r.day.location.state)}</div>
        </div>
      </a>`).join('')}</div>`
    : `<div class="empty">You haven't requested any content days yet.<a class="btn" href="#/discover">Find content days</a></div>`}`;
}

function profileView() {
  const u = state.user;
  app.innerHTML = `
    <div class="profile-head">
      <div class="avatar">${esc(initials(u.name))}</div>
      <div>
        <h1 style="font-size:22px">${esc(u.name)}</h1>
        <div class="card-meta">${esc(u.email)}</div>
        <div class="card-meta">${esc(u.location?.city)}, ${esc(u.location?.state)} · ${esc(countryName(u.location?.country))}</div>
      </div>
    </div>
    <div class="facts" style="margin-top:12px">
      <div class="fact"><span>Total followers</span><b>${fmtNum(totalFollowers(u))}</b></div>
      <div class="fact"><span>Requests</span><b>${(u.applications || []).length}</b></div>
    </div>

    <form class="stack" id="profile">
      <div class="section-title">Name</div>
      <input class="input" name="name" value="${esc(u.name)}" required>
      <div class="section-title">Location</div>
      ${locationFields('pf', u.location)}
      <div class="section-title">Platforms</div>
      ${platformFields(u.platforms)}
      <div class="error" id="err"></div>
      <button class="btn" type="submit">Save profile</button>
      <button class="btn secondary" type="button" id="logout">Log out</button>
    </form>
    <p class="demo-banner">MVP demo · data source: ${CONFIG.DATA_SOURCE} · auth: ${CONFIG.AUTH_PROVIDER}</p>`;

  $('#profile').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      state.user = await authService.updateProfile({
        name: f.get('name').trim(),
        location: { country: f.get('country'), state: f.get('state').trim(), city: f.get('city').trim() },
        platforms: readPlatforms(f),
      });
      profileView();
    } catch (err) {
      $('#err').textContent = err.message;
    }
  });
  $('#logout').addEventListener('click', async () => {
    await authService.signOut();
    state.user = null;
    go('#/welcome');
  });
}

// ---------- boot ----------
async function boot() {
  app.innerHTML = `<div class="loading">Loading…</div>`;
  [state.user, state.locations] = await Promise.all([authService.currentUser(), dataService.getLocations()]);
  window.addEventListener('hashchange', router);
  router();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}
boot();
