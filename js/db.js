/* Couche unique d'accès à IndexedDB. */
const DB = (() => {
  const NOM_BASE = 'reportage-photo';
  // Ne pas imposer de version : l'application réutilise directement la base
  // historique existante. Le schéma actuel est identique à la version 1.
  let base = null;

  function ouvrir() {
    return new Promise((resolve, reject) => {
      if (base) return resolve(base);
      const req = indexedDB.open(NOM_BASE);
      req.onupgradeneeded = (event) => {
        const b = event.target.result;
        if (!b.objectStoreNames.contains('dossiers')) b.createObjectStore('dossiers', { keyPath: 'id' });
        if (!b.objectStoreNames.contains('photos')) {
          const s = b.createObjectStore('photos', { keyPath: 'id' });
          s.createIndex('parDossier', 'dossierId', { unique: false });
        }
        if (!b.objectStoreNames.contains('plans')) {
          const s = b.createObjectStore('plans', { keyPath: 'id' });
          s.createIndex('parDossier', 'dossierId', { unique: false });
        }
        if (!b.objectStoreNames.contains('remarques')) b.createObjectStore('remarques', { keyPath: 'id' });
      };
      req.onsuccess = () => {
        base = req.result;
        base.onversionchange = () => { base.close(); base = null; };
        resolve(base);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Base de données bloquée par un autre onglet.'));
      setTimeout(() => {
        if (!base && req.readyState === 'pending') {
          reject(new Error('L’ouverture de la base locale prend trop de temps. Fermez les autres onglets de l’application puis rechargez.'));
        }
      }, 8000);
    });
  }

  function transaction(magasins, mode, operation) {
    const noms = Array.isArray(magasins) ? magasins : [magasins];
    return ouvrir().then((b) => new Promise((resolve, reject) => {
      const tx = b.transaction(noms, mode);
      let resultat;
      let erreurOperation = null;
      tx.oncomplete = () => resolve(resultat);
      tx.onerror = () => reject(tx.error || erreurOperation || new Error('Transaction IndexedDB échouée.'));
      tx.onabort = () => reject(tx.error || erreurOperation || new Error('Transaction IndexedDB annulée.'));
      try {
        resultat = operation(tx, (nom) => tx.objectStore(nom));
      } catch (e) {
        erreurOperation = e;
        try { tx.abort(); } catch (_) {}
      }
    }));
  }

  function requete(magasin, mode, operation) {
    return ouvrir().then((b) => new Promise((resolve, reject) => {
      const tx = b.transaction(magasin, mode);
      const req = operation(tx.objectStore(magasin));
      let resultat;
      req.onsuccess = () => { resultat = req.result; };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve(resultat);
      tx.onerror = () => reject(tx.error || req.error);
      tx.onabort = () => reject(tx.error || new Error('Transaction annulée.'));
    }));
  }

  const enregistrer = (m, o) => requete(m, 'readwrite', (s) => s.put(o));
  const obtenir = (m, id) => requete(m, 'readonly', (s) => s.get(id));
  const obtenirTous = (m) => requete(m, 'readonly', (s) => s.getAll());
  const obtenirParDossier = (m, id) => requete(m, 'readonly', (s) => s.index('parDossier').getAll(id));
  const supprimer = (m, id) => requete(m, 'readwrite', (s) => s.delete(id));

  async function prochainNumeroPhoto(dossierId) {
    const photos = await obtenirParDossier('photos', dossierId);
    return photos.reduce((max, p) => Math.max(max, Number(p.numero) || 0), 0) + 1;
  }

  async function migrerNumerosPhotos() {
    const photos = await obtenirTous('photos');
    const groupes = new Map();
    for (const p of photos) {
      if (!groupes.has(p.dossierId)) groupes.set(p.dossierId, []);
      groupes.get(p.dossierId).push(p);
    }
    for (const groupe of groupes.values()) {
      groupe.sort((a, b) => a.dateCreation - b.dateCreation);
      const utilises = new Set(groupe.map((p) => Number(p.numero)).filter((n) => n > 0));
      let suivant = 1;
      for (const p of groupe) {
        if (Number(p.numero) > 0) continue;
        while (utilises.has(suivant)) suivant++;
        p.numero = suivant;
        utilises.add(suivant);
        await enregistrer('photos', p);
      }
    }
  }

  async function supprimerPhotoComplete(photoId, dossierId) {
    const plans = await obtenirParDossier('plans', dossierId);
    await transaction(['photos', 'plans'], 'readwrite', (tx, store) => {
      store('photos').delete(photoId);
      for (const plan of plans) {
        const avant = (plan.reperes || []).length;
        plan.reperes = (plan.reperes || []).filter((r) => r.photoId !== photoId);
        if (plan.reperes.length !== avant) store('plans').put(plan);
      }
    });
  }

  async function supprimerDossierComplet(dossierId) {
    const [photos, plans] = await Promise.all([
      obtenirParDossier('photos', dossierId), obtenirParDossier('plans', dossierId),
    ]);
    await transaction(['dossiers', 'photos', 'plans'], 'readwrite', (tx, store) => {
      photos.forEach((p) => store('photos').delete(p.id));
      plans.forEach((p) => store('plans').delete(p.id));
      store('dossiers').delete(dossierId);
    });
  }

  return {
    ouvrir, enregistrer, obtenir, obtenirTous, obtenirParDossier, supprimer,
    supprimerDossierComplet, supprimerPhotoComplete, prochainNumeroPhoto,
    migrerNumerosPhotos,
  };
})();
