// Auth + profile layer. "local" keeps demo accounts in this browser only
// (MVP showcase). "api" hands everything to the backend and keeps a JWT.
import { CONFIG } from '../config.js';
import { apiRequest, tokenStore } from './http.js';

const USERS_KEY = 'cg_users';
const SESSION_KEY = 'cg_session';

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
  async signUp({ name, email, password, location, platforms = [] }) {
    email = email.trim().toLowerCase();
    const users = read(USERS_KEY, {});
    if (users[email]) throw new Error('An account with that email already exists.');
    const salt = crypto.getRandomValues(new Uint32Array(2)).join('');
    const user = {
      id: `usr_${Date.now().toString(36)}`,
      name: name.trim(),
      email,
      location,
      platforms,
      applications: [],
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
};

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
  async applyToContentDay(contentDayId, note = '') {
    await apiRequest(`/content-days/${encodeURIComponent(contentDayId)}/applications`, { method: 'POST', body: { note } });
    return apiRequest('/me');
  },
  async toggleSavedClip(clipId) {
    await apiRequest(`/vault/clips/${encodeURIComponent(clipId)}/save`, { method: 'POST' });
    return apiRequest('/me');
  },
};

export const authService = CONFIG.AUTH_PROVIDER === 'api' ? apiProvider : localProvider;
