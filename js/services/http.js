import { CONFIG } from '../config.js';

const TOKEN_KEY = 'cg_token';

export const tokenStore = {
  get: () => safe(() => localStorage.getItem(TOKEN_KEY)),
  set: (t) => safe(() => localStorage.setItem(TOKEN_KEY, t)),
  clear: () => safe(() => localStorage.removeItem(TOKEN_KEY)),
};

function safe(fn) {
  try { return fn(); } catch { return null; }
}

// Thin fetch wrapper used by every API-backed service.
export async function apiRequest(path, { method = 'GET', body, query } = {}) {
  if (!CONFIG.API_BASE_URL) throw new Error('API_BASE_URL is not configured');
  const url = new URL(CONFIG.API_BASE_URL.replace(/\/$/, '') + path);
  if (query) {
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    });
  }
  const headers = { 'Content-Type': 'application/json' };
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Request failed (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}
