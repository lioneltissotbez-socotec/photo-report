/* ====================================================================
   db.js — Couche base de données (IndexedDB)
   --------------------------------------------------------------------
   RÔLE : ce fichier est le SEUL endroit du projet qui parle à
   IndexedDB. Tous les autres fichiers passent par les fonctions DB.*
   Avantage : si demain on change de stockage, on ne modifie qu'ici.

   IndexedDB est asynchrone et fonctionne avec des "requêtes" et des
   événements. Pour simplifier son usage partout ailleurs, on
   l'enveloppe dans des Promesses : on pourra écrire
       const dossiers = await DB.obtenirTous('dossiers');
   ==================================================================== */

const DB = (() => {

  const NOM_BASE = 'reportage-photo';
  const VERSION = 1; // à incrémenter si on modifie le schéma plus tard

  let base = null; // connexion ouverte, réutilisée par toutes les fonctions

  /* ------------------------------------------------------------------
     Ouverture de la base + création du schéma.
     'onupgradeneeded' ne s'exécute QUE la première fois (ou quand
     VERSION augmente) : c'est là qu'on déclare les "magasins"
     (l'équivalent des tables) et leurs index de recherche.
     Le schéma couvre déjà toutes les étapes du projet :
       - dossiers   : les dossiers de reportage
       - photos     : les photos (liées à un dossier via dossierId)
       - plans      : les plans avec repères (liés à un dossier)
       - remarques  : la bibliothèque de tags Remarque commune
     ------------------------------------------------------------------ */
  function ouvrir() {
    return new Promise((resoudre, rejeter) => {
      if (base) { resoudre(base); return; } // déjà ouverte : on réutilise

      const requete = indexedDB.open(NOM_BASE, VERSION);

      requete.onupgradeneeded = (evenement) => {
        const b = evenement.target.result;

        if (!b.objectStoreNames.contains('dossiers')) {
          b.createObjectStore('dossiers', { keyPath: 'id' });
        }

        if (!b.objectStoreNames.contains('photos')) {
          const magasinPhotos = b.createObjectStore('photos', { keyPath: 'id' });
          // Index = permet de retrouver vite toutes les photos d'un dossier
          magasinPhotos.createIndex('parDossier', 'dossierId', { unique: false });
        }

        if (!b.objectStoreNames.contains('plans')) {
          const magasinPlans = b.createObjectStore('plans', { keyPath: 'id' });
          magasinPlans.createIndex('parDossier', 'dossierId', { unique: false });
        }

        if (!b.objectStoreNames.contains('remarques')) {
          b.createObjectStore('remarques', { keyPath: 'id' });
        }
      };

      requete.onsuccess = () => { base = requete.result; resoudre(base); };
      requete.onerror = () => rejeter(requete.error);
    });
  }

  /* ------------------------------------------------------------------
     Petite fonction interne : exécute une opération dans une
     transaction et renvoie une Promesse. Évite de répéter le même
     code dans chaque fonction publique.
     ------------------------------------------------------------------ */
  function transaction(nomMagasin, mode, operation) {
    return ouvrir().then((b) => new Promise((resoudre, rejeter) => {
      const tx = b.transaction(nomMagasin, mode);
      const magasin = tx.objectStore(nomMagasin);
      const requete = operation(magasin);
      requete.onsuccess = () => resoudre(requete.result);
      requete.onerror = () => rejeter(requete.error);
    }));
  }

  /* ----------------------- Fonctions publiques ---------------------- */

  // Ajoute OU met à jour un enregistrement (put = "écrase si existe")
  function enregistrer(nomMagasin, objet) {
    return transaction(nomMagasin, 'readwrite', (m) => m.put(objet));
  }

  // Récupère un enregistrement par son id
  function obtenir(nomMagasin, id) {
    return transaction(nomMagasin, 'readonly', (m) => m.get(id));
  }

  // Récupère tous les enregistrements d'un magasin
  function obtenirTous(nomMagasin) {
    return transaction(nomMagasin, 'readonly', (m) => m.getAll());
  }

  // Récupère tous les enregistrements liés à un dossier (via l'index)
  function obtenirParDossier(nomMagasin, dossierId) {
    return transaction(nomMagasin, 'readonly',
      (m) => m.index('parDossier').getAll(dossierId));
  }

  // Supprime un enregistrement par son id
  function supprimer(nomMagasin, id) {
    return transaction(nomMagasin, 'readwrite', (m) => m.delete(id));
  }

  /* ------------------------------------------------------------------
     Suppression complète d'un dossier : le dossier lui-même,
     puis toutes ses photos et tous ses plans (sinon ils resteraient
     "orphelins" et occuperaient de la place pour rien).
     ------------------------------------------------------------------ */
  async function supprimerDossierComplet(dossierId) {
    const photos = await obtenirParDossier('photos', dossierId);
    for (const photo of photos) await supprimer('photos', photo.id);

    const plans = await obtenirParDossier('plans', dossierId);
    for (const plan of plans) await supprimer('plans', plan.id);

    await supprimer('dossiers', dossierId);
  }

  // On expose uniquement ces fonctions au reste de l'application
  return {
    enregistrer,
    obtenir,
    obtenirTous,
    obtenirParDossier,
    supprimer,
    supprimerDossierComplet,
  };

})();
