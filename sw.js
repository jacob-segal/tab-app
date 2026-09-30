// Tab service worker: app works offline after first load.
// Same-origin: network-first (dev edits show immediately), cache fallback.
// CDN / fonts / map tiles: stale-while-revalidate.
const VERSION = 'tab-v2';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  ...['home', 'track', 'session', 'drop', 'friends', 'groups', 'history', 'settings', 'onboarding'].flatMap(p => [`css/pages/${p}.css`, `js/pages/${p}.js`]),
  ...['app', 'lib', 'config', 'time', 'stats', 'geomath', 'demo', 'store', 'data', 'clock', 'hooks', 'router', 'geo', 'actions', 'ui'].map(m => `js/${m}.js`),
  'js/components/week-summary.js',
  'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];
const CDN_HOSTS = ['unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'server.arcgisonline.com'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.allSettled(SHELL.map(u => cache.add(u)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      try {
        const res = await fetch(req, { cache: 'no-cache' }); // revalidate so updates show up
        if (res.ok) (await caches.open(VERSION)).put(req, res.clone());
        return res;
      } catch {
        const hit = await caches.match(req, { ignoreSearch: true });
        return hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error());
      }
    })());
  } else if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const hit = await cache.match(req);
      const fresh = fetch(req).then(res => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; }).catch(() => null);
      return hit || (await fresh) || Response.error();
    })());
  }
});
