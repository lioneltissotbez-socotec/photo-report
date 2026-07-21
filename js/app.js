/* ====================================================================
   app.js — Chef d'orchestre de l'application
   --------------------------------------------------------------------
   RÔLE : navigation entre les écrans, indicateur hors ligne,
   démarrage de l'app et enregistrement du service worker (PWA).
   ==================================================================== */

const App = (() => {

  /* ------------------------------------------------------------------
     NAVIGATION : un seul écran visible à la fois.
     Principe : toutes les <section class="ecran"> sont masquées par
     le CSS ; on ajoute la classe .ecran--visible à celle demandée.
     ------------------------------------------------------------------ */
  function montrerEcran(idEcran) {
    document.querySelectorAll('.ecran').forEach((ecran) => {
      ecran.classList.toggle('ecran--visible', ecran.id === idEcran);
    });
    window.scrollTo(0, 0); // repart en haut de page à chaque changement
  }

  /* ------------------------------------------------------------------
     INDICATEUR RÉSEAU : affiche la pastille "Hors ligne" dans la
     barre du haut. Purement informatif : l'app fonctionne pareil.
     ------------------------------------------------------------------ */
  function surveillerReseau() {
    const pastille = document.getElementById('indicateur-reseau');
    const mettreAJour = () => { pastille.hidden = navigator.onLine; };

    window.addEventListener('online', mettreAJour);
    window.addEventListener('offline', mettreAJour);
    mettreAJour(); // état initial au démarrage
  }

  /* ------------------------------------------------------------------
     SERVICE WORKER : le "gardien hors ligne" de la PWA.
     Il intercepte les requêtes réseau et sert les fichiers depuis
     son cache quand il n'y a pas de connexion (voir service-worker.js).
     ------------------------------------------------------------------ */
  function enregistrerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('service-worker.js')
        .catch((erreur) => console.error('Service worker non enregistré :', erreur));
    }
  }

  /* ------------------------------------------------------------------
     DÉMARRAGE
     ------------------------------------------------------------------ */
  async function afficherStockage() {
    const zone = document.getElementById('stockage-etat');
    if (!zone || !navigator.storage?.estimate) return;
    try {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      const mo = (usage / 1024 / 1024).toFixed(1);
      const total = quota ? (quota / 1024 / 1024).toFixed(0) : '?';
      zone.textContent = `Stockage utilisé : ${mo} Mo sur environ ${total} Mo`;
    } catch (_) { zone.textContent = ''; }
  }

  function initialiserInterface() {
    // Les branchements de l’interface ne doivent jamais dépendre d’une
    // migration IndexedDB. Ainsi les boutons restent utilisables même si
    // une ancienne base est momentanément bloquée ou si une migration échoue.
    Dossiers.initialiser();
    Photos.initialiser();
    Camera.initialiser();
    Tags.initialiser();
    Dictee.initialiser();
    Annotate.initialiser();
    Plans.initialiser();
    Carte.initialiser();
    Export.initialiser();
    Backup.initialiser();
    surveillerReseau();
    enregistrerServiceWorker();
  }

  async function demarrer() {
    initialiserInterface();

    try {
      await DB.ouvrir();
      await Dossiers.afficherListe();

      // La numérotation permanente est une migration de confort : elle ne
      // doit pas empêcher l’affichage des missions historiques.
      DB.migrerNumerosPhotos()
        .then(() => Dossiers.afficherListe())
        .catch((erreur) => console.warn('Migration des numéros non bloquante :', erreur));
    } catch (erreur) {
      console.error('Impossible d’ouvrir la base existante :', erreur);
      const vide = document.getElementById('etat-vide');
      if (vide) {
        vide.hidden = false;
        vide.textContent = 'La base locale n’a pas pu être ouverte. Fermez les autres onglets de l’application puis rechargez la page.';
      }
    }

    await afficherStockage();
  }

  // Lance l'app une fois le HTML entièrement chargé
  document.addEventListener('DOMContentLoaded', demarrer);

  return { montrerEcran };

})();
