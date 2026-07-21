/* Service worker PWA : cache statique maîtrisé et cache tuiles limité. */
const VERSION_APP = '2.1.3';
const CACHE_APP = `reportage-photo-app-${VERSION_APP}`;
const CACHE_TUILES = `reportage-photo-tuiles-${VERSION_APP}`;
const LIMITE_TUILES = 150;
const FICHIERS_APP = [
  './','./index.html','./manifest.json','./css/styles.css',
  './icons/logo-transparent.png','./icons/logo-pdf.png',
  './lib/pdf.min.js','./lib/pdf.worker.min.js','./lib/jspdf.umd.min.js','./lib/jszip.min.js',
  './js/db.js','./js/geo.js','./js/camera.js','./js/predefinis.js','./js/tags.js',
  './js/dictee.js','./js/annotate.js','./js/carte.js','./js/plans.js','./js/photos.js',
  './js/export.js','./js/backup.js','./js/dossiers.js','./js/app.js',
  './icons/icon-192.png','./icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_APP).then((c) => c.addAll(FICHIERS_APP)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((noms) => Promise.all(
    noms.filter((n) => n.startsWith('reportage-photo-') && ![CACHE_APP, CACHE_TUILES].includes(n)).map((n) => caches.delete(n))
  )).then(() => self.clients.claim()));
});

async function limiterCache(nom, limite) {
  const cache = await caches.open(nom); const cles = await cache.keys();
  while (cles.length > limite) await cache.delete(cles.shift());
}
function estTuile(url) {
  return /geoportail|ign\.fr|tile|wmts/i.test(url.hostname + url.pathname);
}
async function cacheFirst(request, nomCache) {
  const cache = await caches.open(nomCache);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') { await cache.put(request, response.clone()); if (nomCache === CACHE_TUILES) limiterCache(nomCache, LIMITE_TUILES); }
  return response;
}
async function networkFirst(request) {
  const cache = await caches.open(CACHE_APP);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (_) {
    return await cache.match(request, { ignoreSearch: true }) || new Response('Hors ligne', { status: 503 });
  }
}
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin) event.respondWith(networkFirst(event.request));
  else if (estTuile(url)) event.respondWith(cacheFirst(event.request, CACHE_TUILES).catch(() => caches.match(event.request)));
});
