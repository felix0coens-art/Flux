/*
 * Flux service worker: maakt de app installeerbaar en bruikbaar zonder verbinding.
 * De app-bestanden worden uit de cache geladen en op de achtergrond ververst
 * ("stale-while-revalidate"); /api-verzoeken gaan altijd naar het netwerk.
 */
const CACHE = 'flux-app-v3';
const ASSETS = ['./', 'index.html', 'css/style.css', 'js/core.js', 'js/store.js', 'js/lookup.js', 'js/banks.js', 'js/invest.js', 'js/sync.js', 'js/app.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(event.request, { ignoreSearch: true });
    const network = fetch(event.request).then(res => {
      if (res.ok) cache.put(event.request, res.clone());
      return res;
    }).catch(() => cached || (event.request.mode === 'navigate' ? cache.match('index.html') : undefined));
    return cached || network;
  }));
});
