// Data access layer. The UI only talks to `dataService`; the provider
// behind it is chosen by CONFIG.DATA_SOURCE. Both providers return the
// same shapes (see docs/API.md), so swapping is a config change.
import { CONFIG } from '../config.js';
import { apiRequest } from './http.js';

const cache = {};
async function loadJson(name) {
  if (!cache[name]) {
    cache[name] = fetch(`./data/${name}.json`).then((r) => {
      if (!r.ok) throw new Error(`Could not load ${name}`);
      return r.json();
    });
  }
  return cache[name];
}

function matches(day, partner, f) {
  if (f.country && day.location.country !== f.country) return false;
  if (f.state && day.location.state !== f.state) return false;
  if (f.city && day.location.city !== f.city) return false;
  if (f.platform && day.platforms && !day.platforms.includes(f.platform)) return false;
  if (f.category && partner?.category !== f.category) return false;
  if (f.fromDate && day.date < f.fromDate) return false;
  if (f.q) {
    const q = f.q.toLowerCase();
    const hay = [day.title, partner?.name, partner?.group, day.location.city, day.location.state, day.location.country]
      .join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

const staticProvider = {
  async getLocations() {
    return loadJson('locations');
  },
  async getPartners() {
    return loadJson('partners');
  },
  async getPartner(id) {
    return (await loadJson('partners')).find((p) => p.id === id) || null;
  },
  async getContentDays(filters = {}) {
    const [days, partners] = await Promise.all([loadJson('content-days'), loadJson('partners')]);
    const byId = Object.fromEntries(partners.map((p) => [p.id, p]));
    return days
      .filter((d) => matches(d, byId[d.partnerId], filters))
      .map((d) => ({ ...d, partner: byId[d.partnerId] }))
      .sort((a, b) => a.date.localeCompare(b.date));
  },
  async getContentDay(id) {
    const all = await this.getContentDays();
    return all.find((d) => d.id === id) || null;
  },
  async getClips(filters = {}) {
    const [clips, partners] = await Promise.all([loadJson('vault-clips'), loadJson('partners')]);
    const byId = Object.fromEntries(partners.map((p) => [p.id, p]));
    return clips
      .filter((c) => matches(c, byId[c.partnerId], filters))
      .map((c) => ({ ...c, partner: byId[c.partnerId] }))
      .sort((a, b) => b.shotOn.localeCompare(a.shotOn));
  },
  async getClip(id) {
    const all = await this.getClips();
    return all.find((c) => c.id === id) || null;
  },
};

const apiProvider = {
  getLocations: () => apiRequest('/locations'),
  getPartners: () => apiRequest('/partners'),
  getPartner: (id) => apiRequest(`/partners/${encodeURIComponent(id)}`),
  getContentDays: (filters = {}) => apiRequest('/content-days', { query: filters }),
  getContentDay: (id) => apiRequest(`/content-days/${encodeURIComponent(id)}`),
  getClips: (filters = {}) => apiRequest('/vault/clips', { query: filters }),
  getClip: (id) => apiRequest(`/vault/clips/${encodeURIComponent(id)}`),
};

export const dataService = CONFIG.DATA_SOURCE === 'api' ? apiProvider : staticProvider;
