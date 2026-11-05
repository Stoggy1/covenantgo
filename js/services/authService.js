// Auth + profile layer. "local" keeps demo accounts in this browser only
// (MVP showcase). "api" hands everything to the backend and keeps a JWT.
import { CONFIG } from '../config.js';
import { apiRequest, tokenStore } from './http.js';

const USERS_KEY = 'cg_users';
const SESSION_KEY = 'cg_session';
const DEMO_EMAIL = 'demo@covenantgo.demo';

function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

async function hash(password, salt) {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function publicUser(u) {
  if (!u) return null;
  const { passwordHash, salt, ...rest } = u;
  return rest;
}

const localProvider = {
  async signUp({ name, email, password, phone = '', agency, recruitInterest = false, location, platforms = [] }) {
    email = email.trim().toLowerCase();
    const users = read(USERS_KEY, {});
    if (users[email]) throw new Error('An account with that email already exists.');
    const salt = crypto.getRandomValues(new Uint32Array(2)).join('');
    const user = {
      id: `usr_${Date.now().toString(36)}`,
      name: name.trim(),
      email,
      phone,
      agency,
      recruitInterest,
      location,
      platforms,
      applications: [],
      savedClips: [],
      postLinks: [],
      createdAt: new Date().toISOString(),
      salt,
      passwordHash: await hash(password, salt),
    };
    users[email] = user;
    write(USERS_KEY, users);
    write(SESSION_KEY, email);
    return publicUser(user);
  },

  async signIn({ email, password }) {
    email = email.trim().toLowerCase();
    const user = read(USERS_KEY, {})[email];
    if (!user || (await hash(password, user.salt)) !== user.passwordHash) {
      throw new Error('Email or password is incorrect.');
    }
    write(SESSION_KEY, email);
    return publicUser(user);
  },

  async signOut() {
    try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  },

  // TEMPORARY demo account (CONFIG.DEMO_MODE): no password, pre-filled activity.
  async demoSignIn() {
    const users = read(USERS_KEY, {});
    if (!users[DEMO_EMAIL]) {
      const now = new Date().toISOString();
      users[DEMO_EMAIL] = {
        id: 'usr_demo',
        isDemo: true,
        name: 'Demo Creator',
        email: DEMO_EMAIL,
        phone: '',
        agency: 'Covenant Creative',
        recruitInterest: false,
        location: { country: 'US', state: 'Texas', city: 'Austin' },
        platforms: [{ id: 'tiktok', handle: '@democreator', followers: 48000 }],
        applications: [
          { contentDayId: 'cd_002', note: '', status: 'completed', appliedAt: now },
          { contentDayId: 'cd_010', note: '', status: 'completed', appliedAt: now },
          { contentDayId: 'cd_021', note: '', status: 'approved', appliedAt: now },
          { contentDayId: 'cd_034', note: '', status: 'pending', appliedAt: now },
        ],
        savedClips: [{ clipId: 'clip_002', savedAt: now }, { clipId: 'clip_007', savedAt: now }, { clipId: 'clip_015', savedAt: now }],
        postLinks: [
          { url: 'https://www.tiktok.com/@democreator/video/1001', source: 'content_day', clipId: null, contentDayId: 'cd_002', status: 'approved', submittedAt: now },
          { url: 'https://www.tiktok.com/@democreator/video/1002', source: 'vault', clipId: 'clip_002', contentDayId: null, status: 'approved', submittedAt: now },
          { url: 'https://www.tiktok.com/@democreator/video/1003', source: 'vault', clipId: 'clip_007', contentDayId: null, status: 'pending', submittedAt: now },
          { url: 'https://www.tiktok.com/@democreator/video/1004', source: 'other', clipId: null, contentDayId: null, status: 'pending', submittedAt: now },
        ],
        createdAt: now,
      };
      write(USERS_KEY, users);
    }
    write(SESSION_KEY, DEMO_EMAIL);
    return publicUser(users[DEMO_EMAIL]);
  },

  async currentUser() {
    const email = read(SESSION_KEY, null);
    return email ? publicUser(read(USERS_KEY, {})[email]) : null;
  },

  async updateProfile(patch) {
    const email = read(SESSION_KEY, null);
    const users = read(USERS_KEY, {});
    if (!email || !users[email]) throw new Error('Not signed in.');
    users[email] = { ...users[email], ...patch };
    write(USERS_KEY, users);
    return publicUser(users[email]);
  },

  async applyToContentDay(contentDayId, note = '') {
    const email = read(SESSION_KEY, null);
    const users = read(USERS_KEY, {});
    const user = users[email];
    if (!user) throw new Error('Not signed in.');
    if (user.applications.some((a) => a.contentDayId === contentDayId)) return publicUser(user);
    user.applications.push({ contentDayId, note, status: 'pending', appliedAt: new Date().toISOString() });
    write(USERS_KEY, users);
    return publicUser(user);
  },

  // Footage Vault: toggle a clip in the creator's saved list.
  async toggleSavedClip(clipId) {
    const email = read(SESSION_KEY, null);
    const users = read(USERS_KEY, {});
    const user = users[email];
    if (!user) throw new Error('Not signed in.');
    user.savedClips ||= [];
    const i = user.savedClips.findIndex((s) => s.clipId === clipId);
    if (i >= 0) user.savedClips.splice(i, 1);
    else user.savedClips.push({ clipId, savedAt: new Date().toISOString() });
    write(USERS_KEY, users);
    return publicUser(user);
  },

  // Rewards: a TikTok post the creator made from a content day or vault clip.
  async submitPostLink({ url, source = 'other', clipId = null, contentDayId = null }) {
    const email = read(SESSION_KEY, null);
    const users = read(USERS_KEY, {});
    const user = users[email];
    if (!user) throw new Error('Not signed in.');
    url = normalizeTikTokUrl(url);
    user.postLinks ||= [];
    if (user.postLinks.some((l) => l.url === url)) throw new Error('You already submitted that link.');
    user.postLinks.push({ url, source, clipId, contentDayId, status: 'pending', submittedAt: new Date().toISOString() });
    write(USERS_KEY, users);
    return publicUser(user);
  },
};

// Shared helper for the local provider: load, change, and save the signed-in user.
function mutateUser(fn) {
  const email = read(SESSION_KEY, null);
  const users = read(USERS_KEY, {});
  const user = users[email];
  if (!user) throw new Error('Not signed in.');
  fn(user);
  write(USERS_KEY, users);
  return publicUser(user);
}
Object.assign(localProvider, {
  // Pricing: DEMO subscription, no payment is taken.
  async setPlan(planId) {
    return mutateUser((u) => { u.plan = planId ? { id: planId, since: new Date().toISOString(), demo: true } : null; });
  },
  // Learn: mark a lesson complete / not complete.
  async toggleLesson(lessonId) {
    return mutateUser((u) => {
      u.completedLessons ||= [];
      const i = u.completedLessons.indexOf(lessonId);
      if (i >= 0) u.completedLessons.splice(i, 1); else u.completedLessons.push(lessonId);
    });
  },
});

// Accepts tiktok.com links only; returns a cleaned URL or throws.
export function normalizeTikTokUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { throw new Error('Paste the full TikTok link (starts with https://).'); }
  if (!/(^|\.)tiktok\.com$/i.test(u.hostname)) throw new Error('That isn’t a TikTok link.');
  u.hash = '';
  return u.toString();
}

const apiProvider = {
  async signUp(payload) {
    const { token, user } = await apiRequest('/auth/signup', { method: 'POST', body: payload });
    tokenStore.set(token);
    return user;
  },
  async signIn(payload) {
    const { token, user } = await apiRequest('/auth/login', { method: 'POST', body: payload });
    tokenStore.set(token);
    return user;
  },
  async signOut() {
    await apiRequest('/auth/logout', { method: 'POST' }).catch(() => {});
    tokenStore.clear();
  },
  async currentUser() {
    if (!tokenStore.get()) return null;
    return apiRequest('/me').catch(() => null);
  },
  updateProfile: (patch) => apiRequest('/me', { method: 'PATCH', body: patch }),
  async demoSignIn() {
    const { token, user } = await apiRequest('/auth/demo', { method: 'POST' });
    tokenStore.set(token);
    return user;
  },
  async applyToContentDay(contentDayId, note = '') {
    await apiRequest(`/content-days/${encodeURIComponent(contentDayId)}/applications`, { method: 'POST', body: { note } });
    return apiRequest('/me');
  },
  async toggleSavedClip(clipId) {
    await apiRequest(`/vault/clips/${encodeURIComponent(clipId)}/save`, { method: 'POST' });
    return apiRequest('/me');
  },
  async submitPostLink(link) {
    await apiRequest('/me/post-links', { method: 'POST', body: { ...link, url: normalizeTikTokUrl(link.url) } });
    return apiRequest('/me');
  },
  async setPlan(planId) {
    await apiRequest('/me/subscription', { method: planId ? 'PUT' : 'DELETE', body: planId ? { planId } : undefined });
    return apiRequest('/me');
  },
  async toggleLesson(lessonId) {
    await apiRequest(`/learn/lessons/${encodeURIComponent(lessonId)}/complete`, { method: 'POST' });
    return apiRequest('/me');
  },
};

export const authService = CONFIG.AUTH_PROVIDER === 'api' ? apiProvider : localProvider;
