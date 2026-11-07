// Offline-first service worker: the app shell is cached on install, so it runs with no network.
const CACHE = 'budget-v3';
const SHELL = ['./', './index.html', './styles.css', './app.js', './calendar.js', './format.js', './icons.js', './projection.js', './store.js', './ui.js',
  './vendor/chart.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Serve from cache immediately, refresh in the background (picks up updates on next launch).
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then((res) => { if (res.ok || res.type === 'opaque') cache.put(e.request, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});
