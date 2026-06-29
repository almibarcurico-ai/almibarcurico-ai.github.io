// Almíbar PWA sw v27 (29-jun-2026) — network-first
var CACHE='almibar-v27';
self.addEventListener('install',function(e){self.skipWaiting();});
self.addEventListener('activate',function(e){e.waitUntil((async function(){var k=await caches.keys();await Promise.all(k.map(function(x){return caches.delete(x);}));await self.clients.claim();var w=await self.clients.matchAll({type:'window'});w.forEach(function(c){try{c.navigate(c.url);}catch(_){}});})());});
self.addEventListener('fetch',function(e){if(e.request.method!=='GET')return;e.respondWith(fetch(e.request).then(function(r){var cp=r.clone();caches.open(CACHE).then(function(c){c.put(e.request,cp);}).catch(function(){});return r;}).catch(function(){return caches.match(e.request);}));});
