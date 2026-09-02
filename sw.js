// Almíbar PWA sw v57 — estrategia por tipo de recurso
// - Navegaciones (/, /socio.html, /privacidad.html): network-first (timeout 3s) para captar bundles nuevos
// - /_expo/static/** (hash en el nombre, inmutable): cache-first  => arranque repetido casi instantáneo
// - Imágenes/estáticos same-origin: stale-while-revalidate
// - Fuentes de Google: cache-first (woff2 inmutables)
// - *.supabase.co y demás APIs: NUNCA se interceptan
var VERSION='v76';
var STATIC='almibar-static-'+VERSION;
var PAGES='almibar-pages-'+VERSION;
var ASSETS='almibar-assets-'+VERSION;
var KEEP=[STATIC,PAGES,ASSETS];

self.addEventListener('install',function(e){
  e.waitUntil(
    caches.open(PAGES).then(function(c){
      return c.addAll(['/','/carta.html','/happy-hour.html','/promociones.html','/tenedor-libre.html','/secciones.css','/delivery.html','/reservas.html','/reservas.js','/socio.html','/privacidad.html','/acceso.css','/acceso.js']).catch(function(){});
    }).then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate',function(e){
  e.waitUntil((async function(){
    var keys=await caches.keys();
    await Promise.all(keys.map(function(k){ if(KEEP.indexOf(k)===-1) return caches.delete(k); }));
    await self.clients.claim();
    // Sin c.navigate(): la recarga la maneja index.html vía 'controllerchange'
  })());
});

function networkFirst(req,cacheName,timeoutMs){
  return caches.open(cacheName).then(function(cache){
    return new Promise(function(resolve){
      var settled=false;
      var timer=setTimeout(function(){
        cache.match(req).then(function(hit){ if(hit&&!settled){settled=true;resolve(hit);} });
      },timeoutMs);
      fetch(req).then(function(res){
        clearTimeout(timer);
        if(res&&res.ok) cache.put(req,res.clone());
        if(!settled){settled=true;resolve(res);}
      }).catch(function(){
        clearTimeout(timer);
        cache.match(req).then(function(hit){ if(!settled){settled=true;resolve(hit||Response.error());} });
      });
    });
  });
}

function cacheFirst(req,cacheName){
  return caches.open(cacheName).then(function(cache){
    return cache.match(req).then(function(hit){
      if(hit) return hit;
      return fetch(req).then(function(res){
        if(res&&res.ok){
          cache.put(req,res.clone());
          if(req.url.indexOf('/_expo/static/js/web/')!==-1){
            cache.keys().then(function(ks){
              ks.forEach(function(k){
                if(k.url.indexOf('/_expo/static/js/web/')!==-1&&k.url!==req.url) cache.delete(k);
              });
            });
          }
        }
        return res;
      });
    });
  });
}

function staleWhileRevalidate(req,cacheName){
  return caches.open(cacheName).then(function(cache){
    return cache.match(req).then(function(hit){
      var refetch=fetch(req).then(function(res){
        if(res&&res.ok) cache.put(req,res.clone());
        return res;
      }).catch(function(){ return hit; });
      return hit||refetch;
    });
  });
}

self.addEventListener('fetch',function(e){
  var req=e.request;
  if(req.method!=='GET') return;
  var url;
  try{ url=new URL(req.url); }catch(_){ return; }

  // Nunca tocar APIs de datos
  if(url.hostname.indexOf('supabase.co')!==-1) return;

  // Navegaciones: red primero (para captar bundles nuevos), caché a los 3s
  if(req.mode==='navigate'){ e.respondWith(networkFirst(req,PAGES,3000)); return; }

  if(url.origin===location.origin){
    if(url.pathname.indexOf('/_expo/static/')===0){ e.respondWith(cacheFirst(req,STATIC)); return; }
    e.respondWith(staleWhileRevalidate(req,ASSETS)); return;
  }

  if(url.hostname==='fonts.gstatic.com'){ e.respondWith(cacheFirst(req,ASSETS)); return; }
  if(url.hostname==='fonts.googleapis.com'){ e.respondWith(staleWhileRevalidate(req,ASSETS)); return; }
  // Resto cross-origin: sin interceptar
});
