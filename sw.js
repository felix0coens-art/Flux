/*
 * Helder service worker: maakt de app installeerbaar en bruikbaar zonder verbinding.
 * Met internet wordt altijd eerst de nieuwste versie opgehaald (en bewaard); zonder internet (of als de
 * server niet binnen 4 seconden antwoordt) komt de bewaarde versie. /api-verzoeken gaan altijd naar het netwerk.
 */
const CACHE = 'helder-app-v7';
const ASSETS = ['./', 'index.html', 'css/style.css', 'css/legal.css', 'privacy.html', 'voorwaarden.html', 'js/theme.js', 'js/core.js', 'js/store.js', 'js/lookup.js', 'js/banks.js', 'js/invest.js', 'js/groups.js', 'js/sync.js', 'js/app.js', 'groep.html', 'css/groep.css', 'js/groep.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png',
  'fonts/rethink-sans-latin-400-normal.woff2', 'fonts/rethink-sans-latin-500-normal.woff2', 'fonts/rethink-sans-latin-600-normal.woff2', 'fonts/rethink-sans-latin-700-normal.woff2', 'fonts/rethink-sans-latin-800-normal.woff2'];

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
    // Een groepslink (/g) mag nooit terugvallen op de app zelf
    const fallback = cached || (event.request.mode === 'navigate' && !/^\/g\/?$|groep\.html$/.test(url.pathname) ? await cache.match('index.html') : undefined);
    const network = fetch(event.request).then(res => {
      if (res.ok) cache.put(event.request, res.clone());
      return res;
    });
    if (!fallback) return network;
    // Netwerk eerst; traag of geen verbinding: de bewaarde versie
    const slow = new Promise(resolve => setTimeout(() => resolve(fallback), 4000));
    return Promise.race([network.catch(() => fallback), slow]);
  }));
});
