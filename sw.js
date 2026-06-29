// Almíbar PWA service worker — v18 (28-jun-2026)
// Network-first: SIEMPRE intenta la red y solo cae a caché sin conexión, así
// nunca queda pegado en una versión vieja. Al activarse purga cachés viejos.
var CACHE = 'almibar-v18';

self.addEventListener('install', function (e) {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil((async function () {
    var keys = await caches.keys();
    await Promise.all(keys.map(function (k) { return caches.delete(k); }));
    await self.clients.claim();
    var wins = await self.clients.matchAll({ type: 'window' });
    wins.forEach(function (c) { try { c.navigate(c.url); } catch (_) {} });
  })());
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); }).catch(function () {});
        return res;
      })
      .catch(function () { return caches.match(e.request); })
  );
});
