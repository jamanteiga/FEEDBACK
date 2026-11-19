// Service worker: permite instalar la app y usarla sin conexión tras la primera carga.
// Código propio (html/js/css): red primero, con caché de respaldo (así las actualizaciones llegan solas).
// Librerías (vendor/) e iconos: caché primero. Los documentos del usuario nunca pasan por aquí.
const V = 'feedback-v0.23';
const SHELL = ['./', 'index.html', 'style.css', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'js/app.js', 'js/db.js', 'js/proc.js', 'js/extract.js', 'js/store.js', 'js/report.js', 'js/export.js', 'js/extras.js', 'js/panels.js', 'js/viewer.js', 'js/compare.js', 'js/cad.js', 'js/legacy.js', 'js/mail.js', 'js/parse.js', 'js/parse.worker.js', 'js/units.js', 'js/trace.js', 'js/vault.js', 'js/lock.js', 'js/es.js', 'js/flow.js', 'js/cadview.js', 'js/vwin.js', 'js/preview.js', 'js/locate.js', 'js/semantic.js', 'js/equipos.js', 'js/duplicados.js', 'js/ocrreview.js', 'js/carve.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url); if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  const vendor = u.pathname.includes('/vendor/') || /\.(png|webmanifest)$/.test(u.pathname);
  e.respondWith(vendor
    ? caches.match(e.request).then(r => r || fetch(e.request).then(res => { if (res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(e.request, cp)); } return res; }))
    : fetch(e.request).then(res => { if (res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(e.request, cp)); } return res; }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
