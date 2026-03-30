var CACHE = 'almibar-v5';
self.addEventListener('install', function(e) { self.skipWaiting(); });
self.addEventListener('activate', function(e) { e.waitUntil(caches.keys().then(function(names) { return Promise.all(names.filter(function(n) { return n !== CACHE; }).map(function(n) { return caches.delete(n); })); })); });
self.addEventListener('fetch', function(e) { e.respondWith(fetch(e.request).catch(function() { return caches.match(e.request); })); });
