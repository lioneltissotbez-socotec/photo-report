/* Import d'une sauvegarde ZIP créée par l'application. */
const Backup = (() => {
  const entree = document.getElementById('entree-sauvegarde');
  const etat = document.getElementById('import-sauvegarde-etat');

  async function creerVignette(blob) {
    let image;
    if ('createImageBitmap' in window) image = await createImageBitmap(blob);
    else {
      const url = URL.createObjectURL(blob);
      image = await new Promise((resolve, reject) => { const i = new Image(); i.onload=()=>resolve(i); i.onerror=reject; i.src=url; });
      URL.revokeObjectURL(url);
    }
    const e = Math.min(1, 320 / Math.max(image.width, image.height));
    const c = document.createElement('canvas');
    c.width = Math.round(image.width * e); c.height = Math.round(image.height * e);
    c.getContext('2d').drawImage(image, 0, 0, c.width, c.height);
    if (typeof image.close === 'function') image.close();
    return new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', .75));
  }


  function reconstruireTagsLegacy(meta, tagsDossier) {
    const libelles = [...(meta.localisation || []), ...(meta.remarques || [])];
    return tagsDossier.filter((t) => libelles.includes(t.libelle)).map((t) => t.id);
  }

  async function importer(fichier) {
    etat.hidden = false; etat.textContent = 'Lecture de la sauvegarde…';
    const bouton = document.getElementById('btn-importer-sauvegarde');
    if (bouton) bouton.disabled = true;
    try {
      const zip = await JSZip.loadAsync(fichier);
      const entreeJson = zip.file('donnees.json');
      if (!entreeJson) throw new Error('Fichier donnees.json absent.');
      const data = JSON.parse(await entreeJson.async('string'));
      const version = data.versionFormat || 1;
      if ((data.format && data.format !== 'photo-report') || version > 2 || !data.dossier) {
        throw new Error('Format de sauvegarde non reconnu ou trop récent.');
      }
      const nouvelIdDossier = crypto.randomUUID();
      const maintenant = Date.now();
      const dossier = {
        ...(data.dossier || {}), id: nouvelIdDossier,
        nom: `${data.dossier?.nom || 'Dossier restauré'} — restauré`,
        dateCreation: data.dossier?.dateCreation || maintenant,
        dateModification: maintenant,
      };
      await DB.enregistrer('dossiers', dossier);

      const correspondancePhotos = new Map();
      for (let i = 0; i < (data.photos || []).length; i++) {
        const meta = data.photos[i];
        etat.textContent = `Restauration photo ${i + 1} / ${data.photos.length}…`;
        const fichierImage = zip.file(meta.fichier);
        if (!fichierImage) continue;
        const image = await fichierImage.async('blob');
        const nouveauPhotoId = crypto.randomUUID();
        correspondancePhotos.set(meta.id || `numero:${meta.numero || i + 1}`, nouveauPhotoId);
        correspondancePhotos.set(`numero:${meta.numero || i + 1}`, nouveauPhotoId);
        let apercu;
        if (meta.fichierAnnote && zip.file(meta.fichierAnnote)) apercu = await zip.file(meta.fichierAnnote).async('blob');
        await DB.enregistrer('photos', {
          id: nouveauPhotoId, dossierId: nouvelIdDossier,
          numero: Number(meta.numero) || i + 1,
          dateCreation: meta.dateCreation || maintenant + i,
          image, vignette: await creerVignette(image),
          tags: meta.tags || reconstruireTagsLegacy(meta, dossier.tags || []), observation: meta.observation || '',
          exterieure: Boolean(meta.exterieure || meta.gps), gps: meta.gps || null,
          annotations: meta.annotations || [], ...(apercu ? { apercu } : {}),
        });
      }

      for (let i = 0; i < (data.plans || []).length; i++) {
        const meta = data.plans[i];
        etat.textContent = `Restauration plan ${i + 1} / ${data.plans.length}…`;
        const fichierPlan = zip.file(meta.fichier);
        if (!fichierPlan) continue;
        await DB.enregistrer('plans', {
          id: crypto.randomUUID(), dossierId: nouvelIdDossier,
          nom: meta.nom || `Plan ${i + 1}`, image: await fichierPlan.async('blob'),
          dateCreation: meta.dateCreation || maintenant + i,
          reperes: (meta.reperes || []).map((r) => ({
            id: crypto.randomUUID(), x: r.x, y: r.y,
            photoId: correspondancePhotos.get(r.photoId) || correspondancePhotos.get(`numero:${r.numeroPhoto}`),
          })).filter((r) => r.photoId),
        });
      }
      etat.textContent = 'Sauvegarde restaurée avec succès.';
      await Dossiers.afficherListe();
      setTimeout(() => { etat.hidden = true; }, 2500);
    } catch (e) {
      console.error(e); etat.textContent = `Échec de la restauration : ${e.message}`;
      alert(`Impossible de restaurer cette sauvegarde. ${e.message}`);
    } finally {
      if (bouton) bouton.disabled = false;
    }
  }

  function initialiser() {
    document.getElementById('btn-importer-sauvegarde').addEventListener('click', () => entree.click());
    entree.addEventListener('change', async () => {
      const fichier = entree.files?.[0]; entree.value = '';
      if (fichier) await importer(fichier);
    });
  }
  return { initialiser };
})();
