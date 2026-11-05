// Offline cache for the app shell + demo data. Bump VERSION on each deploy.
const VERSION = 'cg-v8';
const SHELL = [
  './', './index.html', './css/styles.css', './manifest.webmanifest',
  './js/app.js', './js/config.js', './js/services/http.js',
  './js/services/dataService.js', './js/services/authService.js',
  './data/partners.json', './data/content-days.json', './data/locations.json', './data/vault-clips.json',
  './icons/icon.svg', './icons/brand/tiktokgo-mark-w.png', './icons/brand/tiktokgo-wordmark-w.png', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for same-origin GETs so updates show up, cache as fallback.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
