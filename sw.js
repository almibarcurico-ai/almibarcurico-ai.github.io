// Almíbar PWA service worker — v17 (13-jun-2026)
// Reemplaza a los SW viejos (almibar-v14/v16) que quedaron pegados en los
// dispositivos de clientes sirviendo la app vieja (no podían marcar).
// Estrategia network-first: SIEMPRE intenta la red y solo cae a caché sin
// conexión, así nunca vuelve a quedar pegado en una versión vieja.
var CACHE = 'almibar-v17';

self.addEventListener('install', function (e) {
  // Activar de inmediato, sin esperar a que se cierren las pestañas viejas.
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil((async function () {
    // 1) Borrar TODOS los cachés viejos (almibar-v14, v16, etc.).
    var keys = await caches.keys();
    await Promise.all(keys.map(function (k) { return caches.delete(k); }));
    // 2) Tomar control de las pestañas abiertas ya mismo.
    await self.clients.claim();
    // 3) Forzar una recarga única para que traigan el bundle nuevo.
    var wins = await self.clients.matchAll({ type: 'window' });
    wins.forEach(function (c) { try { c.navigate(c.url); } catch (_) {} });
  })());
});

// Network-first con fallback a caché solo si no hay red.
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
