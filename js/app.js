import { CONFIG } from './config.js';
import { dataService } from './services/dataService.js';
import { authService } from './services/authService.js';
import { REGIONS } from './regions.js';
import { CITIES } from './cities.js';

const app = document.getElementById('app');
const tabbar = document.getElementById('tabbar');
const adbar = document.getElementById('adbar');
const state = {
  user: null,
  locations: null,
  filters: { q: '', country: '', state: '', city: '', platform: '', category: '', followers: '', when: '' },
};

// ---------- helpers ----------
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = app) => root.querySelector(sel);
const PLATFORMS = CONFIG.PLATFORMS.filter((p) => CONFIG.ENABLED_PLATFORMS.includes(p.id));
const SINGLE_PLATFORM = PLATFORMS.length === 1;
const platformLabel = (id) => CONFIG.PLATFORMS.find((p) => p.id === id)?.label || id;
const countryName = (code) => state.locations?.countries.find((c) => c.code === code)?.name || code;
const fmtNum = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n % 1000 ? 1 : 0)}K` : String(n));
const parseDate = (iso) => new Date(`${iso}T12:00:00`);
const fmtDate = (iso, opts) => parseDate(iso).toLocaleDateString('en-US', opts);
const banner = (color) => `background: radial-gradient(circle at 85% 20%, ${color}cc, transparent 60%), linear-gradient(135deg, ${color}55, #1f1f2b);`;
// Unsplash supports on-the-fly resizing via query params.
const photo = (url, w = 800, h) => `${url}?auto=format&fit=crop&q=70&w=${w}${h ? `&h=${h}` : ''}`;
const isFeatured = (p) => p.listingTier === 'featured' && p.photos?.length;
// CONFIG.PHOTOS_FOR_ALL_LISTINGS: every listing shows a photo (MVP demo).
// Set false to go back to "photos only for Featured" (the paid upsell).
const showsPhoto = (p) => (CONFIG.PHOTOS_FOR_ALL_LISTINGS ? !!p.photos?.length : isFeatured(p));
// Days at the same partner rotate through its photos so the list doesn't repeat.
const dayPhoto = (d) => d.partner.photos[(parseInt(d.id.replace(/\D/g, ''), 10) || 0) % d.partner.photos.length];
const photoBg = (url, w) => `background-image: linear-gradient(180deg, rgba(0,0,0,.10), rgba(0,0,0,.55)), url('${photo(url, w)}');`;
const partnerBanner = (p, w, url = p.photos?.[0]) => (showsPhoto(p) ? photoBg(url, w) : banner(p.accentColor));
const fmtDuration = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
const initials = (name = '') => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const totalFollowers = (u) => (u?.platforms || []).filter((p) => CONFIG.ENABLED_PLATFORMS.includes(p.id)).reduce((s, p) => s + (Number(p.followers) || 0), 0);

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

// White-lettering mark for dark backgrounds, black-lettering for light (CSS shows the right one).
const goMark = () => `<img class="go-mark mark-dark" src="icons/brand/tiktokgo-mark-w.png" alt="TikTok GO"><img class="go-mark mark-light" src="icons/brand/tiktokgo-mark-b.png" alt="TikTok GO">`;

// ---------- appearance (light / dark) ----------
const THEME_KEY = 'cg_theme';
const THEMES = [['dark', 'Dark'], ['light', 'Light'], ['system', 'Match device']];
const getTheme = () => { try { return localStorage.getItem(THEME_KEY) || 'dark'; } catch { return 'dark'; } };
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  const light = t === 'light' || (t === 'system' && matchMedia('(prefers-color-scheme: light)').matches);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', light ? '#f5f5f8' : '#0b0b10');
}
function setTheme(t) {
  try { localStorage.setItem(THEME_KEY, t); } catch { /* storage unavailable */ }
  applyTheme(t);
}
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => applyTheme(getTheme()));

// ---------- agency + recruiting ----------
const agencyLabel = (a) => (!a || a === CONFIG.NO_AGENCY ? 'No agency' : a);

function agencyFields(selected = '', recruit = false) {
  return `
    <div class="field"><label for="agency">Your TikTok GO agency</label>
      <select class="input" id="agency" name="agency" required>
        ${options(CONFIG.AGENCIES, selected, 'Select your agency')}
        <option value="${CONFIG.NO_AGENCY}" ${selected === CONFIG.NO_AGENCY ? 'selected' : ''}>No agency, I'm an independent GO Creator</option>
      </select></div>
    <label class="check" id="recruit-row" ${selected === CONFIG.NO_AGENCY ? '' : 'hidden'}>
      <input type="checkbox" name="recruitInterest" ${recruit ? 'checked' : ''}>
      <span>I'd like to hear about joining <b>${esc(CONFIG.RECRUITING_AGENCY)}</b>.</span>
    </label>`;
}
function wireAgency() {
  $('#agency').addEventListener('change', (e) => { $('#recruit-row').hidden = e.target.value !== CONFIG.NO_AGENCY; });
}
const readAgency = (f) => ({
  agency: f.get('agency'),
  recruitInterest: f.get('agency') === CONFIG.NO_AGENCY && f.get('recruitInterest') === 'on',
});

// ---------- rewards ----------
const ATTENDED = ['attended', 'completed'];
function rewardProgress(u) {
  const days = (u.applications || []).filter((a) => ATTENDED.includes(a.status)).length;
  const links = (u.postLinks || []).length;
  const R = CONFIG.REWARDS;
  return { days, links, R, entered: days >= R.contentDaysGoal || links >= R.postLinksGoal };
}
const bar = (n, goal) => `<div class="bar"><span style="width:${Math.min(100, (n / goal) * 100)}%"></span></div>`;

function rewardsCardHtml(u, { compact = false } = {}) {
  const { days, links, R, entered } = rewardProgress(u);
  return `
    <a class="reward-card" href="#/rewards">
      <div class="reward-head"><span class="trophy" aria-hidden="true">🏆</span><div><b>${esc(R.prize)}</b>
        ${compact ? '' : `<div class="card-meta">${esc(R.prizeDetail)}</div>`}</div></div>
      ${entered ? '<div class="notice ok">You\'re entered! Keep going to stay in the running.</div>' : '<div class="card-meta">Hit either goal to be entered:</div>'}
      <div class="goal"><span>Attend content days</span><b>${days} / ${R.contentDaysGoal}</b></div>${bar(days, R.contentDaysGoal)}
      <div class="goal"><span class="go-inline">${goMark()} Submit TikTok post links</span><b>${links} / ${R.postLinksGoal}</b></div>${bar(links, R.postLinksGoal)}
    </a>`;
}

// Inline form for submitting a TikTok post link (rewards credit).
function postLinkFormHtml(label = 'Posted it? Submit your TikTok link') {
  return `
    <form class="link-form" id="link-form">
      <label for="post-url" class="go-inline">${goMark()}<span>${esc(label)}</span></label>
      <div class="link-row">
        <input class="input" id="post-url" name="url" type="url" inputmode="url" placeholder="https://www.tiktok.com/@you/video/…" required>
        <button class="btn" type="submit">Submit</button>
      </div>
      <div class="error" id="link-err"></div>
    </form>`;
}
function wirePostLinkForm(extra, onDone) {
  $('#link-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      state.user = await authService.submitPostLink({ url: e.target.url.value, ...extra });
      onDone();
    } catch (err) {
      $('#link-err').textContent = err.message;
    }
  });
}

// ---------- sponsored ad carousel (under the header) ----------
function adHtml(ad, partner) {
  if (ad.house) {
    return `
      <div class="ad house">
        <div class="ad-img house-art" aria-hidden="true"><span>AD</span></div>
        <div class="ad-copy">
          <span class="ad-label">Ad space available</span>
          <b class="ad-headline">${esc(ad.headline)}</b>
          <span class="ad-body">${esc(ad.body)}</span>
          <span class="ad-cta">${esc(ad.cta)}</span>
        </div>
      </div>`;
  }
  return `
    <a class="ad" href="${esc(ad.href)}">
      <div class="ad-img" style="background-image:url('${photo(ad.image, 480, 480)}')"></div>
      <div class="ad-copy">
        <span class="ad-label">Sponsored · ${esc(partner?.name || '')}</span>
        <b class="ad-headline">${esc(ad.headline)}</b>
        <span class="ad-body">${esc(ad.body)}</span>
        <span class="ad-cta">${esc(ad.cta)} ›</span>
      </div>
    </a>`;
}

async function renderAdbar() {
  const [ads, partners] = await Promise.all([dataService.getAds('top'), dataService.getPartners()]);
  if (!ads.length) return;
  const byId = Object.fromEntries(partners.map((p) => [p.id, p]));
  adbar.innerHTML = `
    <div class="ad-track" id="ad-track">${ads.map((a) => `<div class="ad-slide">${adHtml(a, byId[a.partnerId])}</div>`).join('')}</div>
    <div class="ad-dots" id="ad-dots">${ads.map((_, i) => `<button type="button" aria-label="Ad ${i + 1}" data-i="${i}"></button>`).join('')}</div>`;

  const track = adbar.querySelector('#ad-track');
  const dots = [...adbar.querySelectorAll('#ad-dots button')];
  const slideW = () => track.querySelector('.ad-slide').getBoundingClientRect().width + parseFloat(getComputedStyle(track).columnGap || 0);
  const current = () => Math.round(track.scrollLeft / slideW());
  const visible = () => Math.max(1, Math.round(track.clientWidth / slideW()));
  const goTo = (i) => track.scrollTo({ left: i * slideW(), behavior: 'smooth' });
  const sync = () => {
    const i = current();
    dots.forEach((d, k) => d.classList.toggle('active', k >= i && k < i + visible()));
  };
  track.addEventListener('scroll', () => requestAnimationFrame(sync), { passive: true });
  dots.forEach((d) => d.addEventListener('click', () => goTo(Number(d.dataset.i))));
  sync();

  // Auto-rotate; pauses while the user touches/hovers it. Off for reduced motion.
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let paused = false;
  ['pointerenter', 'touchstart', 'focusin'].forEach((ev) => adbar.addEventListener(ev, () => { paused = true; }, { passive: true }));
  ['pointerleave', 'touchend', 'focusout'].forEach((ev) => adbar.addEventListener(ev, () => { paused = false; }, { passive: true }));
  setInterval(() => {
    if (paused || adbar.hidden || document.hidden) return;
    const next = current() + 1;
    goTo(next > ads.length - visible() ? 0 : next);
  }, 5000);
}

// ---------- router ----------
const routes = [
  { path: /^#\/welcome$/, view: welcomeView, public: true },
  { path: /^#\/login$/, view: loginView, public: true, layout: 'narrow' },
  { path: /^#\/signup$/, view: signupView, public: true, layout: 'narrow' },
  { path: /^#\/discover$/, view: () => discoverView('days'), tab: 'discover' },
  { path: /^#\/vault$/, view: () => discoverView('vault'), tab: 'discover' },
  { path: /^#\/clip\/([\w-]+)$/, view: clipView, tab: 'discover' },
  { path: /^#\/day\/([\w-]+)$/, view: dayView, tab: 'discover' },
  { path: /^#\/my-days$/, view: myDaysView, tab: 'my-days' },
  { path: /^#\/rewards$/, view: rewardsView, tab: 'rewards', layout: 'medium' },
  { path: /^#\/profile$/, view: profileView, tab: 'profile', layout: 'narrow' },
];

async function router() {
  const hash = location.hash || (state.user ? '#/discover' : '#/welcome');
  const route = routes.find((r) => r.path.test(hash));
  if (!route) return go(state.user ? '#/discover' : '#/welcome');
  if (!route.public && !state.user) return go('#/welcome');
  if (route.public && state.user) return go('#/discover');

  tabbar.hidden = !!route.public;
  app.dataset.layout = route.layout || 'wide';
  document.body.classList.toggle('is-public', !!route.public);
  document.body.dataset.layout = route.layout || 'wide';
  adbar.hidden = !!route.public;
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
  const [days, clips, partners] = await Promise.all([dataService.getContentDays(), dataService.getClips(), dataService.getPartners()]);
  const art = partners.filter(isFeatured).slice(0, 4);
  const cities = new Set(days.map((d) => d.location.city)).size;
  app.innerHTML = `
    <section class="hero">
      <div class="hero-copy">
      <h1>Get Booked For Content Days.</h1>
      <p>CovenantGo connects TikTok GO <strong class="accent">CREATORS</strong> with hotels, resorts, and things to do across the United States and Mexico.</p>
      <div class="built-for"><img class="mark-dark" src="icons/brand/tiktokgo-mark-w.png" alt=""><img class="mark-light" src="icons/brand/tiktokgo-mark-b.png" alt=""><span>Built for TikTok GO Creators</span></div>
      <p class="open-to-all">Open to every TikTok GO Creator, with an agency or without one.</p>
      <div class="hero-stats">
        <div><b>${days.length}</b><span>Open content days</span></div>
        <div><b>${clips.length}</b><span>Vault clips</span></div>
        <div><b>${cities}</b><span>Cities</span></div>
      </div>
      <div class="stack">
        <a class="btn" href="#/signup">Create Creator account</a>
        <a class="btn secondary" href="#/login">I already have an account</a>
      </div>
      ${demoButtonHtml()}
      <p class="trademark">TikTok and TikTok GO are trademarks of TikTok. CovenantGo is an independent Creator platform.</p>
      </div>
      <div class="hero-art" aria-hidden="true">
        ${art.map((p) => `<div class="art-tile" style="background-image:url('${photo(p.photos[0], 600, 800)}')"><span>${esc(p.location.city)}</span></div>`).join('')}
      </div>
    </section>`;
  wireDemoButton();
  fitHeroTitle();
}

// Phone only: shrink the hero title until it fits on one line (fonts differ by device).
function fitHeroTitle() {
  const h = $('.hero h1');
  if (!h || getComputedStyle(h).whiteSpace !== 'nowrap') return;
  h.style.fontSize = '';
  let size = parseFloat(getComputedStyle(h).fontSize);
  while (h.scrollWidth > h.clientWidth && size > 16) h.style.fontSize = `${(size -= 0.5)}px`;
}
window.addEventListener('resize', () => fitHeroTitle());

// TEMPORARY (CONFIG.DEMO_MODE): open the app as a pre-filled demo creator.
function demoButtonHtml() {
  if (!CONFIG.DEMO_MODE) return '';
  return `<button class="btn demo" type="button" id="demo">Preview the app (demo)</button>
    <p class="demo-note">No sign-up needed. Opens a sample Creator account.</p>`;
}
function wireDemoButton() {
  $('#demo')?.addEventListener('click', async () => {
    state.user = await authService.demoSignIn();
    go('#/discover');
  });
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
      ${demoButtonHtml()}
    </form>`;
  wireDemoButton();
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
    <div class="field"><label for="${prefix}-state">State</label>
      <select class="input" id="${prefix}-state" name="state" required>${stateOptions(country, loc.state)}</select></div>
    <div class="field"><label for="${prefix}-city">City</label>
      <select class="input" id="${prefix}-city" name="city" required ${loc.state ? '' : 'disabled'}>${cityOptions(loc.state, loc.city)}</select>
      <input class="input city-other" id="${prefix}-city-other" name="cityOther" placeholder="Type your city" value="${esc(cityIsListed(loc.state, loc.city) ? '' : loc.city || '')}" ${loc.city && !cityIsListed(loc.state, loc.city) ? '' : 'hidden'}>
    </div>`;
}

// City dropdown filled from the chosen state, plus "Other" to type one that isn't listed.
const CITY_OTHER = '__other';
const cityIsListed = (st, city) => (CITIES[st] || []).includes(city);
function cityOptions(st, selected = '') {
  if (!st) return '<option value="">Choose a state first</option>';
  const list = CITIES[st] || [];
  const other = selected && !list.includes(selected);
  return '<option value="">Select city</option>'
    + list.map((c) => `<option value="${esc(c)}" ${c === selected ? 'selected' : ''}>${esc(c)}</option>`).join('')
    + `<option value="${CITY_OTHER}" ${other ? 'selected' : ''}>Other (type it)</option>`;
}
const readCity = (f) => String(f.get('city') === CITY_OTHER ? f.get('cityOther') || '' : f.get('city') || '').trim();

// State dropdown: "IA – Iowa"; saves the full name. Keeps an older free-text value if it isn't in the list.
function stateOptions(country, selected = '') {
  const list = REGIONS[country] || [];
  const known = list.some(([, name]) => name === selected);
  return `<option value="">Select state</option>`
    + (selected && !known ? `<option value="${esc(selected)}" selected>${esc(selected)}</option>` : '')
    + list.map(([abbr, name]) => `<option value="${esc(name)}" ${name === selected ? 'selected' : ''}>${abbr} – ${esc(name)}</option>`).join('');
}
// Country → refills states; State → refills cities; "Other" reveals a text box.
function wireLocation(prefix) {
  const stateSel = $(`#${prefix}-state`), citySel = $(`#${prefix}-city`), other = $(`#${prefix}-city-other`);
  const syncOther = () => {
    const show = citySel.value === CITY_OTHER;
    other.hidden = !show;
    other.required = show;
    if (show) other.focus();
  };
  const fillCities = () => {
    citySel.innerHTML = cityOptions(stateSel.value);
    citySel.disabled = !stateSel.value;
    syncOther();
  };
  $(`#${prefix}-country`).addEventListener('change', (e) => { stateSel.innerHTML = stateOptions(e.target.value); fillCities(); });
  stateSel.addEventListener('change', fillCities);
  citySel.addEventListener('change', syncOther);
  other.required = citySel.value === CITY_OTHER;
}

function platformFields(existing = []) {
  return PLATFORMS.map((p) => {
    const cur = existing.find((x) => x.id === p.id) || {};
    return `
      <div class="platform-row">
        <span class="name">${p.id === 'tiktok' ? `${goMark()}<span class="sr">TikTok</span>` : esc(p.label)}</span>
        <input class="input" name="handle-${p.id}" placeholder="@handle" value="${esc(cur.handle || '')}" autocapitalize="off" autocorrect="off">
        <input class="input" name="followers-${p.id}" placeholder="Followers" inputmode="numeric" value="${esc(cur.followers || '')}">
      </div>`;
  }).join('');
}

function readPlatforms(f) {
  return PLATFORMS.map((p) => ({
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
      <div class="field"><label for="phone">Phone number</label><input class="input" id="phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="(555) 555-5555"></div>

      <div class="section-title">TikTok GO agency</div>
      ${agencyFields()}

      <div class="section-title">Where are you based?</div>
      ${locationFields('su')}

      <div class="section-title tt-title">${SINGLE_PLATFORM ? `${goMark()}<span>Your ${esc(PLATFORMS[0].label)}</span>` : 'Your platforms'}</div>
      ${platformFields()}

      <div class="error" id="err"></div>
      <button class="btn" type="submit">Join CovenantGo</button>
    </form>`;
  wireAgency();
  wireLocation('su');

  $('#signup').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const platforms = readPlatforms(f);
    if (!platforms.length) return ($('#err').textContent = SINGLE_PLATFORM ? `Add your ${PLATFORMS[0].label} handle.` : 'Add at least one platform handle.');
    try {
      state.user = await authService.signUp({
        name: f.get('name'),
        email: f.get('email'),
        password: f.get('password'),
        phone: String(f.get('phone') || '').trim(),
        ...readAgency(f),
        location: { country: f.get('country'), state: f.get('state').trim(), city: readCity(f) },
        platforms,
      });
      go('#/discover');
    } catch (err) {
      $('#err').textContent = err.message;
    }
  });
}

// Expedia-style Discover: category tabs → Content Days / Vault switch → search card.
const CATEGORY_TABS = [
  ['', 'All', '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'],
  ['Hotels & Resorts', 'Hotels & Resorts', '<path d="M3 18V8M3 14h18v4M21 18v-6a3 3 0 0 0-3-3h-7v5"/><circle cx="7" cy="11" r="2"/>'],
  ['Things to Do', 'Things to Do', '<path d="M4 9V7a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2a2 2 0 0 0 0 4v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2a2 2 0 0 0 0-4z"/><path d="M14 6v10" stroke-dasharray="2 2"/>'],
];
const WHEN_OPTIONS = [['', 'Any time'], ['7', 'Next 7 days'], ['30', 'Next 30 days'], ['90', 'Next 90 days']];
const ICONS = {
  pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.9.7 3.1 2.5 3.5 5.2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
};
const svg = (paths) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;

// "Where to?" suggestions: cities, states, countries, and partner names.
async function whereIndex() {
  const partners = await dataService.getPartners();
  const items = [];
  for (const c of state.locations.countries) {
    items.push({ kind: 'Country', label: c.name, sub: 'Country', set: { country: c.code, state: '', city: '', q: '' } });
    for (const s of c.states) {
      items.push({ kind: 'State', label: s.name, sub: `State · ${c.name}`, set: { country: c.code, state: s.name, city: '', q: '' } });
      for (const city of s.cities) items.push({ kind: 'City', label: city, sub: `${s.name}, ${c.name}`, set: { country: c.code, state: s.name, city, q: '' } });
    }
  }
  for (const p of partners) items.push({ kind: p.type, label: p.name, sub: `${p.type} · ${p.location.city}, ${p.location.state}`, set: { country: '', state: '', city: '', q: p.name } });
  return items;
}
// Places before hotels; names that start with the query before ones that merely contain it.
const KIND_ORDER = { City: 0, State: 1, Country: 2 };
function rank(item, q) {
  const label = norm(item.label), sub = norm(item.sub);
  const match = label.startsWith(q) ? 0 : label.split(/[\s,]+/).some((w) => w.startsWith(q)) ? 1 : label.includes(q) ? 2 : sub.includes(q) ? 4 : 9;
  if (match === 9) return 9;
  return match + (KIND_ORDER[item.kind] ?? 3) * 0.1;
}
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function whereLabel(f) {
  if (f.q) return f.q;
  if (f.city) return `${f.city}, ${f.state}`;
  if (f.state) return f.state;
  if (f.country) return countryName(f.country);
  return '';
}

async function discoverView(mode = 'days') {
  const f = state.filters;
  const vault = mode === 'vault';
  const me = totalFollowers(state.user);
  app.innerHTML = `
    <nav class="cat-tabs" id="categories" aria-label="Category">
      ${CATEGORY_TABS.map(([v, label, icon]) => `<button type="button" class="${f.category === v ? 'active' : ''}" data-category="${esc(v)}">${svg(icon)}<span>${label}</span></button>`).join('')}
    </nav>
    <nav class="segmented" aria-label="Browse">
      <a href="#/discover" class="${vault ? '' : 'active'}">Content Days</a>
      <a href="#/vault" class="${vault ? 'active' : ''}">Footage Vault</a>
    </nav>
    ${vault ? '<p class="mode-intro">Clips our team shot at partner properties. Save them and repurpose them in your own TikTok GO posts.</p>' : ''}

    <div class="search-brand"><span class="wordmark-badge"><img src="icons/brand/tiktokgo-wordmark-color.png" alt="TikTok GO"></span></div>
    <form class="search-card ${vault ? 'is-vault' : ''}" id="search" role="search" autocomplete="off">
      <div class="sfield where">
        ${svg(ICONS.pin)}
        <label for="where">Where to?</label>
        <input id="where" type="text" placeholder="City, state, or hotel" value="${esc(whereLabel(f))}" aria-autocomplete="list" aria-controls="where-list">
        <button type="button" class="sfield-clear" id="where-clear" aria-label="Clear location" ${whereLabel(f) ? '' : 'hidden'}>×</button>
        <ul class="suggest" id="where-list" role="listbox" hidden></ul>
      </div>
      ${vault ? '' : `
      <div class="sfield">
        ${svg(ICONS.cal)}
        <label for="when">When</label>
        <select id="when">${WHEN_OPTIONS.map(([v, l]) => `<option value="${v}" ${String(f.when || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </div>
      <div class="sfield">
        ${svg(ICONS.people)}
        <label for="followers">Followers needed</label>
        <select id="followers">${FOLLOWER_FILTERS.map(([v, l]) => `<option value="${v}" ${String(f.followers || '') === v ? 'selected' : ''}>${v === 'me' ? `I qualify (${fmtNum(me)})` : l}</option>`).join('')}</select>
      </div>`}
      <button class="btn search-btn" type="submit">${svg(ICONS.search)}<span>Search</span></button>
    </form>

    <div class="result-count"><span id="count"></span><button id="clear" type="button">Clear filters</button></div>
    <div class="${vault ? 'clip-grid' : 'cards'}" id="results"><div class="loading">Loading…</div></div>`;

  const refresh = async () => {
    if (vault) {
      const clips = await dataService.getClips(f);
      $('#count').textContent = `${clips.length} clip${clips.length === 1 ? '' : 's'}`;
      $('#results').innerHTML = clips.length
        ? clips.map(clipCardHtml).join('')
        : `<div class="empty">No vault clips for those filters yet.</div>`;
      return;
    }
    const today = new Date();
    const toDate = f.when ? new Date(today.getTime() + Number(f.when) * 864e5).toISOString().slice(0, 10) : '';
    const maxFollowers = f.followers === 'me' ? me : Number(f.followers) || '';
    const days = await dataService.getContentDays({ ...f, followers: undefined, when: undefined, maxFollowers, toDate, fromDate: today.toISOString().slice(0, 10) });
    $('#count').textContent = `${days.length} content day${days.length === 1 ? '' : 's'}`;
    $('#results').innerHTML = days.length
      ? days.map(cardHtml).join('')
      : `<div class="empty">No content days match those filters yet.</div>`;
  };

  // ---- Where to? autocomplete ----
  const index = await whereIndex();
  const input = $('#where'), list = $('#where-list');
  let pending = null; // suggestion picked but not yet searched
  const render = () => {
    const q = norm(input.value.trim());
    const hits = q
      ? index.map((i) => ({ i, score: rank(i, q) })).filter((x) => x.score < 9)
        .sort((x, y) => x.score - y.score).map((x) => x.i).slice(0, 8)
      : index.filter((i) => i.kind === 'City').slice(0, 6);
    list.innerHTML = (q ? '' : '<li class="suggest-head">Popular destinations</li>')
      + hits.map((h, i) => `<li role="option" data-i="${index.indexOf(h)}" class="${i === 0 && q ? 'hl' : ''}">
          <span class="suggest-icon">${svg(h.kind === 'City' || h.kind === 'State' || h.kind === 'Country' ? ICONS.pin : '<path d="M3 18V8M3 14h18v4M21 18v-6a3 3 0 0 0-3-3h-7v5"/>')}</span>
          <span><b>${esc(h.label)}</b><small>${esc(h.sub)}</small></span></li>`).join('')
      + (q && !hits.length ? `<li class="suggest-head">Press Search to look for “${esc(input.value.trim())}”</li>` : '');
    list.hidden = false;
  };
  const pick = (item) => { pending = item.set; input.value = item.label; list.hidden = true; $('#where-clear').hidden = false; };
  input.addEventListener('focus', render);
  input.addEventListener('click', () => { if (list.hidden) render(); });
  input.addEventListener('input', () => { pending = null; $('#where-clear').hidden = !input.value; render(); });
  input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !list.hidden) {
      const first = list.querySelector('li[data-i]');
      if (first && input.value.trim()) { e.preventDefault(); pick(index[first.dataset.i]); }
    }
    if (e.key === 'Escape') list.hidden = true;
  });
  list.addEventListener('pointerdown', (e) => {
    const li = e.target.closest('li[data-i]'); if (!li) return;
    e.preventDefault(); pick(index[li.dataset.i]);
  });
  $('#where-clear').addEventListener('click', () => {
    input.value = ''; pending = { country: '', state: '', city: '', q: '' }; $('#where-clear').hidden = true; input.focus();
  });

  // ---- Search (applies everything, like Expedia) ----
  $('#search').addEventListener('submit', (e) => {
    e.preventDefault();
    const typed = input.value.trim();
    Object.assign(f, pending || (typed === whereLabel(f) ? {} : { country: '', state: '', city: '', q: typed }));
    if (!vault) { f.when = $('#when').value; f.followers = $('#followers').value; }
    list.hidden = true;
    input.blur();
    refresh();
  });
  // Category tabs apply instantly.
  $('#categories').addEventListener('click', (e) => {
    const b = e.target.closest('[data-category]'); if (!b) return;
    f.category = b.dataset.category; discoverView(mode);
  });
  $('#clear').addEventListener('click', () => {
    Object.assign(f, { q: '', country: '', state: '', city: '', platform: '', category: '', followers: '', when: '' }); discoverView(mode);
  });
  await refresh();
}

// Followers filter options: value = max followers a content day may require.
const FOLLOWER_FILTERS = [['', 'Any'], ['me', 'I qualify'], ['1000', 'Up to 1K'], ['2500', 'Up to 2.5K'], ['5000', 'Up to 5K'], ['10000', 'Up to 10K'], ['25000', 'Up to 25K']];
function qualifyHtml(d) {
  return totalFollowers(state.user) >= d.minFollowers
    ? `<span class="qualify yes">✓ You qualify</span>`
    : `<span class="qualify no">Needs ${fmtNum(d.minFollowers)}+ followers</span>`;
}

function spotsHtml(d) {
  const left = d.spotsTotal - d.spotsTaken;
  const cls = left === 0 ? 'full' : left <= 2 ? 'low' : '';
  return `<span class="spots ${cls}">${left === 0 ? 'Waitlist' : `${left} of ${d.spotsTotal} spots left`}</span>`;
}

function cardHtml(d) {
  const p = d.partner;
  const left = d.spotsTotal - d.spotsTaken;
  return `
    <a class="card ${isFeatured(p) ? 'is-featured' : ''}" href="#/day/${d.id}">
      <div class="card-banner ${showsPhoto(p) ? 'has-photo' : ''}" style="${partnerBanner(p, 800, showsPhoto(p) ? dayPhoto(d) : undefined)}">
        <div class="date-badge"><b>${fmtDate(d.date, { day: 'numeric' })}</b><span>${fmtDate(d.date, { month: 'short' })}</span></div>
        <div class="pill-stack">
          <span class="pill go">${goMark()}<span>${d.commissionRate}%</span></span>
          ${isFeatured(p) ? '<span class="pill featured">★ Featured</span>' : ''}
        </div>
        <span class="banner-loc">${esc(d.location.city)}, ${esc(d.location.country === 'US' ? d.location.state : countryName(d.location.country))}</span>
      </div>
      <div class="card-body">
        <div class="card-kicker">${esc(p.type)} · ${esc(p.category)}</div>
        <h3>${esc(d.title)}</h3>
        <div class="card-partner"><span>${esc(p.name)}</span><span class="rating">★ ${p.rating}</span></div>
        <div class="spots-bar" aria-hidden="true"><span style="width:${Math.round((d.spotsTaken / d.spotsTotal) * 100)}%"></span></div>
        <div class="card-foot">
          ${left === 0 ? '<span class="spots full">Waitlist</span>' : `<span class="spots ${left <= 2 ? 'low' : ''}">${left} of ${d.spotsTotal} spots left</span>`}
          ${SINGLE_PLATFORM
            ? qualifyHtml(d)
            : `<div class="icons">${d.platforms.filter((x) => CONFIG.ENABLED_PLATFORMS.includes(x)).map((x) => `<span>${esc(platformLabel(x))}</span>`).join('')}</div>`}
        </div>
      </div>
    </a>`;
}

function clipCardHtml(c) {
  return `
    <a class="clip" href="#/clip/${c.id}">
      <div class="clip-thumb" style="background-image:url('${photo(c.thumbnail, 400, 711)}')">
        <span class="clip-badge">${esc(c.resolution)}</span>
        <span class="clip-tt" title="Made for TikTok">${goMark()}</span>
        <span class="clip-play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>
        <span class="clip-duration">${fmtDuration(c.durationSec)}</span>
      </div>
      <div class="clip-body">
        <h3>${esc(c.title)}</h3>
        <div class="card-meta">${esc(c.partner.name)}</div>
        <div class="card-meta">${esc(c.location.city)}, ${esc(c.location.country)}</div>
      </div>
    </a>`;
}

async function clipView(id) {
  const c = await dataService.getClip(id);
  if (!c) { app.innerHTML = `<div class="empty">Clip not found.</div>`; return; }
  const p = c.partner;
  app.innerHTML = `
    <a class="back" href="#/vault">‹ Footage Vault</a>
    <div class="detail clip-detail">
    <div class="d-banner">
    <div class="clip-hero" style="background-image:url('${photo(c.thumbnail, 720, 1280)}')">
      <span class="clip-badge">${esc(c.resolution)} · ${esc(c.orientation)}</span>
      <span class="clip-play big" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>
      <span class="clip-duration">${fmtDuration(c.durationSec)}</span>
    </div>
    </div>
    <aside class="d-side">
    <h1 class="clip-title">${esc(c.title)}</h1>
    <p class="card-meta">${esc(p.type)} · ${esc(p.name)} · ${esc(c.location.city)}, ${esc(c.location.state)}</p>

    <div class="facts" style="margin-top:14px">
      <div class="fact"><span>Shot by</span><b>${esc(c.shotBy)}</b></div>
      <div class="fact"><span>Shot on</span><b>${fmtDate(c.shotOn, { month: 'short', day: 'numeric', year: 'numeric' })}</b></div>
      <div class="fact"><span>Length</span><b>${fmtDuration(c.durationSec)}</b></div>
      <div class="fact"><span>Saved by Creators</span><b>${c.saves}</b></div>
    </div>
    <div class="sticky-cta"><div id="cta"></div></div>
    </aside>

    <section class="d-body">
    <div class="section-title">Tags</div>
    <div class="chips">${c.tags.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>

    <div class="section-title">How you can use it</div>
    <div class="notice usage">${goMark()}<span>${esc(c.usage)}</span></div>

    <div class="section-title">Earn rewards</div>
    <div id="clip-link"></div>
    </section>
    </div>`;

  const renderLink = () => {
    const mine = (state.user.postLinks || []).filter((l) => l.clipId === id);
    $('#clip-link').innerHTML = (mine.length ? `<div class="notice ok">${mine.length} post link${mine.length === 1 ? '' : 's'} submitted with this clip.</div>` : '')
      + postLinkFormHtml('Posted with this clip? Submit your TikTok link');
    wirePostLinkForm({ source: 'vault', clipId: id }, renderLink);
  };
  renderLink();

  const renderCta = () => {
    const saved = (state.user.savedClips || []).some((s) => s.clipId === id);
    $('#cta').innerHTML = saved
      ? `<button class="btn secondary" id="save">✓ Saved to your clips · tap to remove</button>`
      : `<button class="btn" id="save">Save to my clips</button>`;
    $('#save').addEventListener('click', async () => {
      state.user = await authService.toggleSavedClip(id);
      renderCta();
    });
  };
  renderCta();
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
    <div class="detail">
    <div class="d-banner">
    <div class="detail-banner ${showsPhoto(p) ? 'has-photo' : ''}" style="${partnerBanner(p, 1000, showsPhoto(p) ? dayPhoto(d) : undefined)}">
      <span class="pill go" style="align-self:flex-start;margin-bottom:auto">${goMark()}<span>Bookable partner</span></span>
      <h1>${esc(d.title)}</h1>
      <p>${esc(p.name)} · ${esc(p.group)}</p>
    </div>
    </div>

    <section class="d-about">
      <div class="section-title">About the partner</div>
      <div class="partner-card">
        <div class="partner-head">
          <div class="partner-avatar" style="${showsPhoto(p) ? `background-image:url('${photo(p.photos[0], 160, 160)}')` : `background:${p.accentColor}`}">${showsPhoto(p) ? '' : esc(initials(p.name))}</div>
          <div>
            <b>${esc(p.name)}</b>
            <div class="card-meta">${esc(p.type)} · ${esc(p.group)}</div>
            <div class="card-meta">${esc(p.location.city)}, ${esc(p.location.state)} · ★ ${p.rating}</div>
          </div>
        </div>
        <p>${esc(p.description)}</p>
      </div>
    </section>

    <aside class="d-side">
    <div class="facts">
      <div class="fact"><span>Date</span><b>${fmtDate(d.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</b></div>
      <div class="fact"><span>Call time</span><b>${esc(d.time)}</b></div>
      <div class="fact"><span>Location</span><b>${esc(d.location.city)}, ${esc(d.location.state)}</b></div>
      <div class="fact"><span>Country</span><b>${esc(countryName(d.location.country))}</b></div>
      <div class="fact"><span>Booking commission</span><b class="go-inline">${d.commissionRate}% via ${goMark()}</b></div>
      <div class="fact"><span>Min. followers</span><b>${fmtNum(d.minFollowers)}</b></div>
    </div>
    <div class="sticky-cta"><div id="cta"></div></div>
    </aside>

    <section class="d-body">
    <div class="section-title">What you’ll do</div>
    <ul class="list do-list">${(d.activities || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    <p class="custom-note">${esc(d.customNote || 'Every content day is custom to our partnership with this partner.')}</p>

    <div class="section-title tt-title">${goMark()}<span>Deliverables · ${d.deliverables.length} TikTok posts</span></div>
    <ul class="list tt-list">${d.deliverables.map((x) => `<li>${goMark()}<span>${esc(x)}</span></li>`).join('')}</ul>

    <div class="section-title" ${SINGLE_PLATFORM ? 'hidden' : ''}>Platforms</div>
    <div class="chips" ${SINGLE_PLATFORM ? 'hidden' : ''}>${d.platforms.filter((x) => CONFIG.ENABLED_PLATFORMS.includes(x)).map((x) => `<span class="chip">${esc(platformLabel(x))}</span>`).join('')}</div>

    <div class="section-title">Availability</div>
    <p>${spotsHtml(d)}</p>

    <div id="day-link"></div>
    </section>
    </div>`;

  const cta = $('#cta');
  const renderCta = (isApplied) => {
    if (isApplied) {
      const status = state.user.applications?.find((a) => a.contentDayId === id)?.status;
      cta.innerHTML = `<div class="notice ok">${
        ATTENDED.includes(status) ? '✓ You attended this content day. It counts toward rewards.'
        : status === 'approved' ? '✓ You’re confirmed! See you there.'
        : 'Request sent. The partner will confirm your spot.'}</div>`;
      const mine = (state.user.postLinks || []).filter((l) => l.contentDayId === id);
      $('#day-link').innerHTML = `<div class="section-title">Earn rewards</div>`
        + (mine.length ? `<div class="notice ok">${mine.length} post link${mine.length === 1 ? '' : 's'} submitted for this day.</div>` : '')
        + postLinkFormHtml('After the shoot, submit your TikTok post link');
      wirePostLinkForm({ source: 'content_day', contentDayId: id }, () => renderCta(true));
    } else if (!eligible) {
      cta.innerHTML = `<div class="notice">This day needs ${fmtNum(d.minFollowers)}+ followers. Your profile shows ${fmtNum(followers)}. <a href="#/profile">Update profile</a></div>`;
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

function rewardsView() {
  const u = state.user;
  const links = [...(u.postLinks || [])].reverse();
  const sourceLabel = { vault: 'Footage Vault', content_day: 'Content day', other: 'Other GO post' };
  app.innerHTML = `
    <div class="page-head"><h1>Rewards</h1></div>
    ${rewardsCardHtml(u)}

    <div class="section-title">How to earn</div>
    <ul class="list">
      <li><b>Attend content days.</b> Counted when the partner checks you in.</li>
      <li><b>Post with Footage Vault clips</b> and submit the TikTok link.</li>
      <li><b>Post from a content day</b> and submit the TikTok link.</li>
    </ul>

    <div class="section-title">Submit a post</div>
    ${postLinkFormHtml('TikTok GO post link')}

    <div class="section-title">Your submitted links</div>
    ${links.length ? `<ul class="list links">${links.map((l) => `
      <li><div class="card-foot" style="margin:0"><span class="card-meta">${esc(sourceLabel[l.source] || 'Post')} · ${fmtDate(l.submittedAt.slice(0, 10), { month: 'short', day: 'numeric' })}</span><span class="status">${esc(l.status)}</span></div>
      <a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.url)}</a></li>`).join('')}</ul>`
    : '<div class="empty">No links yet. Post with a vault clip or after a content day, then drop the link here.</div>'}
    <p class="demo-banner">Demo: prize, goals and contest rules are placeholders.</p>`;
  wirePostLinkForm({ source: 'other' }, rewardsView);
}

async function myDaysView() {
  const apps = state.user.applications || [];
  const all = await dataService.getContentDays();
  const byId = Object.fromEntries(all.map((d) => [d.id, d]));
  const rows = apps.map((a) => ({ ...a, day: byId[a.contentDayId] })).filter((a) => a.day);
  const clipsById = Object.fromEntries((await dataService.getClips()).map((c) => [c.id, c]));
  const saved = (state.user.savedClips || []).map((s) => clipsById[s.clipId]).filter(Boolean);

  app.innerHTML = `
    <div class="page-head"><h1>Saved</h1></div>
    ${rewardsCardHtml(state.user, { compact: true })}
    <div class="section-title">My content days</div>
    ${rows.length ? `<div class="cards">${rows.map((r) => `
      <a class="card row-card" href="#/day/${r.day.id}">
        <div class="row-thumb" style="${partnerBanner(r.day.partner, 240, showsPhoto(r.day.partner) ? dayPhoto(r.day) : undefined)}"></div>
        <div class="card-body">
          <div class="card-foot" style="margin:0 0 4px"><span class="card-meta">${fmtDate(r.day.date, { weekday: 'short', month: 'short', day: 'numeric' })} · ${esc(r.day.time)}</span><span class="status status-${esc(r.status)}">${esc(r.status)}</span></div>
          <h3>${esc(r.day.title)}</h3>
          <div class="card-meta">${esc(r.day.partner.name)} · ${esc(r.day.location.city)}, ${esc(r.day.location.state)}</div>
        </div>
      </a>`).join('')}</div>`
    : `<div class="empty">You haven't requested any content days yet.<a class="btn" href="#/discover">Find content days</a></div>`}
    <div class="section-title">My vault clips</div>
    ${saved.length
      ? `<div class="clip-grid">${saved.map(clipCardHtml).join('')}</div>`
      : `<div class="empty">No saved clips yet.<a class="btn secondary" href="#/vault">Browse the Footage Vault</a></div>`}`;
}

function profileView() {
  const u = state.user;
  app.innerHTML = `
    <div class="profile-head">
      <div class="avatar">${esc(initials(u.name))}</div>
      <div>
        <h1 style="font-size:22px">${esc(u.name)}</h1>
        <div class="card-meta">${esc(u.email)}${u.phone ? ` · ${esc(u.phone)}` : ''}</div>
        <div class="card-meta">${esc(u.location?.city)}, ${esc(u.location?.state)} · ${esc(countryName(u.location?.country))}</div>
      </div>
    </div>
    <div class="facts" style="margin-top:12px">
      <div class="fact"><span>Total followers</span><b>${fmtNum(totalFollowers(u))}</b></div>
      <div class="fact"><span>Requests</span><b>${(u.applications || []).length}</b></div>
      <div class="fact" style="grid-column: 1 / -1"><span>TikTok GO agency</span><b>${esc(agencyLabel(u.agency))}</b></div>
    </div>
    ${u.agency === CONFIG.NO_AGENCY && !u.recruitInterest ? `
      <div class="recruit-card">
        <b>Not with an agency yet?</b>
        <p>${esc(CONFIG.RECRUITING_AGENCY)} works with TikTok GO Creators on hospitality deals. Tick the box under <b>Agency</b> below and our team will reach out.</p>
      </div>` : ''}

    <div class="section-title">Appearance</div>
    <div class="theme-picker" id="theme-picker" role="radiogroup" aria-label="Appearance">
      ${THEMES.map(([id, label]) => `<button type="button" role="radio" data-theme="${id}" aria-checked="${getTheme() === id}" class="${getTheme() === id ? 'active' : ''}">${label}</button>`).join('')}
    </div>

    <form class="stack" id="profile">
      <div class="section-title">Name</div>
      <input class="input" name="name" value="${esc(u.name)}" required>
      <div class="section-title">Phone</div>
      <input class="input" name="phone" type="tel" autocomplete="tel" inputmode="tel" value="${esc(u.phone || '')}" placeholder="(555) 555-5555">
      <div class="section-title">Agency</div>
      ${agencyFields(u.agency || '', !!u.recruitInterest)}
      <div class="section-title">Location</div>
      ${locationFields('pf', u.location)}
      <div class="section-title tt-title">${SINGLE_PLATFORM ? `${goMark()}<span>${esc(PLATFORMS[0].label)}</span>` : 'Platforms'}</div>
      ${platformFields(u.platforms)}
      <div class="error" id="err"></div>
      <button class="btn" type="submit">Save profile</button>
      <button class="btn secondary" type="button" id="logout">Log out</button>
    </form>
    <p class="demo-banner">MVP demo · data source: ${CONFIG.DATA_SOURCE} · auth: ${CONFIG.AUTH_PROVIDER}</p>`;
  wireAgency();
  wireLocation('pf');
  // Appearance applies instantly (no Save needed) and is remembered on this device.
  $('#theme-picker').addEventListener('click', (e) => {
    const b = e.target.closest('[data-theme]'); if (!b) return;
    setTheme(b.dataset.theme);
    $('#theme-picker').querySelectorAll('button').forEach((x) => {
      x.classList.toggle('active', x === b);
      x.setAttribute('aria-checked', String(x === b));
    });
  });

  $('#profile').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      state.user = await authService.updateProfile({
        name: f.get('name').trim(),
        phone: String(f.get('phone') || '').trim(),
        ...readAgency(f),
        location: { country: f.get('country'), state: f.get('state').trim(), city: readCity(f) },
        platforms: [...readPlatforms(f), ...(u.platforms || []).filter((p) => !CONFIG.ENABLED_PLATFORMS.includes(p.id))],
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
  applyTheme(getTheme());
  // Shared header on every page.
  document.getElementById('brand').innerHTML = `${logoHtml()}<span class="brand-tag">for TikTok GO Creators</span>`;
  renderAdbar().catch(() => {});
  app.innerHTML = `<div class="loading">Loading…</div>`;
  [state.user, state.locations] = await Promise.all([authService.currentUser(), dataService.getLocations()]);
  window.addEventListener('hashchange', router);
  router();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    // Always check for a new app version; when one takes over, reload once to show it.
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {});
    let reloaded = false;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !reloaded) { reloaded = true; location.reload(); }
    });
  }
}
boot();
