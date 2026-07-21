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
  async function demarrer() {
    Dossiers.initialiser();
    Photos.initialiser();
    Camera.initialiser();
    await Dossiers.afficherListe();
    surveillerReseau();
    enregistrerServiceWorker();
  }

  // Lance l'app une fois le HTML entièrement chargé
  document.addEventListener('DOMContentLoaded', demarrer);

  return { montrerEcran };

})();
