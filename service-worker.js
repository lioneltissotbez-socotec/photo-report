/* ====================================================================
   service-worker.js — Le gardien hors ligne de la PWA
   --------------------------------------------------------------------
   RÔLE : au premier chargement, il copie tous les fichiers de l'app
   dans un cache. Ensuite, à chaque demande de fichier :
     1. il essaie d'abord le réseau (pour toujours avoir la version
        la plus récente pendant le développement),
     2. si le réseau échoue (hors ligne), il sert la copie du cache.
   Les PHOTOS, elles, ne passent pas par ici : elles sont dans
   IndexedDB, qui fonctionne nativement hors ligne.

   IMPORTANT PENDANT LE DÉVELOPPEMENT : à chaque fois qu'on ajoute
   un fichier au projet, il faut l'ajouter à FICHIERS_APP ci-dessous
   ET augmenter le numéro de VERSION_CACHE (sinon les appareils
   garderaient l'ancienne version en cache).
   ==================================================================== */

const VERSION_CACHE = 'reportage-photo-v14';

const FICHIERS_APP = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './lib/pdf.min.js',
  './lib/pdf.worker.min.js',
  './js/db.js',
  './js/geo.js',
  './js/camera.js',
  './js/predefinis.js',
  './js/tags.js',
  './js/dictee.js',
  './js/annotate.js',
  './js/carte.js',
  './js/plans.js',
  './js/photos.js',
  './js/dossiers.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

/* Installation : mise en cache de tous les fichiers de l'app */
self.addEventListener('install', (evenement) => {
  evenement.waitUntil(
    caches.open(VERSION_CACHE)
      .then((cache) => cache.addAll(FICHIERS_APP))
      .then(() => self.skipWaiting()) // active la nouvelle version sans attendre
  );
});

/* Activation : supprime les caches des anciennes versions */
self.addEventListener('activate', (evenement) => {
  evenement.waitUntil(
    caches.keys().then((noms) =>
      Promise.all(
        noms
          .filter((nom) => nom !== VERSION_CACHE)
          .map((nom) => caches.delete(nom))
      )
    ).then(() => self.clients.claim())
  );
});

/* Interception des requêtes : réseau d'abord, cache en secours */
self.addEventListener('fetch', (evenement) => {
  // On ne gère que les lectures de fichiers (GET)
  if (evenement.request.method !== 'GET') return;

  evenement.respondWith(
    fetch(evenement.request)
      .then((reponse) => {
        // Réseau disponible : on rafraîchit la copie en cache au passage
        const copie = reponse.clone();
        caches.open(VERSION_CACHE)
          .then((cache) => cache.put(evenement.request, copie));
        return reponse;
      })
      .catch(() => caches.match(evenement.request)) // hors ligne : cache
  );
});
