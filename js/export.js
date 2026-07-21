/* ====================================================================
   export.js — Export d'un dossier en PDF et en archive ZIP
   --------------------------------------------------------------------
   PDF (livrable) : page de garde, puis les plans avec repères, puis les
   photos dans l'ordre de leur numéro — chacune avec sa version annotée,
   ses tags et son observation. Un filtre permet d'EXCLURE les photos
   portant certains tags (tout coché par défaut).

   ZIP (archive technique) : les photos originales + un fichier JSON
   décrivant tout le dossier, pour l'archivage et l'import futur dans le
   logiciel métier.

   Bibliothèques (locales, hors ligne) : jsPDF et JSZip.
   ==================================================================== */

const Export = (() => {

  const dialogue = document.getElementById('dialogue-export');
  let dossierCourant = null;
  let logoData = null;   // logo Socotec en base64 (chargé à la 1re utilisation)
  // Ensemble des id de tags EXCLUS (décochés). Vide = tout exporté.
  const tagsExclus = new Set();

  /* Charge le logo Socotec (fond blanc) pour l'insérer dans le PDF */
  async function chargerLogo() {
    if (logoData) return logoData;
    try {
      const reponse = await fetch('icons/logo-pdf.png');
      const blob = await reponse.blob();
      logoData = await blobEnBase64(blob);
    } catch (e) {
      logoData = null; // pas bloquant si le logo manque
    }
    return logoData;
  }

  /* ==================================================================
     OUVERTURE de la fenêtre d'export
     ================================================================== */
  async function ouvrir(dossier) {
    dossierCourant = dossier;
    tagsExclus.clear();
    afficherTags();
    await majCompte();
    dialogue.showModal();
  }

  /* Affiche les tags cochables (tout coché = inclus) */
  function afficherTags() {
    const remplir = (type, conteneurId) => {
      const conteneur = document.getElementById(conteneurId);
      conteneur.innerHTML = '';
      const tags = (dossierCourant.tags || []).filter((t) => t.type === type);

      if (tags.length === 0) {
        conteneur.innerHTML = '<span class="tags-vide">Aucun tag.</span>';
        return;
      }
      for (const tag of tags) {
        const puce = document.createElement('button');
        puce.type = 'button';
        puce.className = 'tag-puce tag-puce--coche';
        puce.textContent = tag.libelle;
        puce.addEventListener('click', async () => {
          // Bascule inclusion / exclusion
          if (tagsExclus.has(tag.id)) {
            tagsExclus.delete(tag.id);
            puce.classList.add('tag-puce--coche');
          } else {
            tagsExclus.add(tag.id);
            puce.classList.remove('tag-puce--coche');
          }
          await majCompte();
        });
        conteneur.appendChild(puce);
      }
    };
    remplir('localisation', 'export-tags-localisation');
    remplir('remarque', 'export-tags-remarque');
  }

  /* Renvoie les photos à exporter (triées par numéro, filtrées par tags) */
  async function photosAExporter() {
    const photos = await DB.obtenirParDossier('photos', dossierCourant.id);
    photos.sort((a, b) => a.dateCreation - b.dateCreation); // = ordre des numéros
    // On garde une photo sauf si elle porte AU MOINS un tag exclu
    return photos.filter((photo) =>
      !(photo.tags || []).some((idTag) => tagsExclus.has(idTag)));
  }

  async function majCompte() {
    const total = (await DB.obtenirParDossier('photos', dossierCourant.id)).length;
    const retenues = (await photosAExporter()).length;
    document.getElementById('export-compte').textContent =
      `${retenues} photo(s) sur ${total} seront exportées.`;
  }

  /* Petit utilitaire : charge un Blob en Image (pour le dessiner) */
  function chargerImage(blob) {
    return new Promise((resoudre, rejeter) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resoudre(img); };
      img.onerror = rejeter;
      img.src = url;
    });
  }

  /* Convertit un Blob en base64 (pour jsPDF et le JSON du ZIP) */
  function blobEnBase64(blob) {
    return new Promise((resoudre) => {
      const lecteur = new FileReader();
      lecteur.onload = () => resoudre(lecteur.result);
      lecteur.readAsDataURL(blob);
    });
  }

  function progression(texte) {
    const p = document.getElementById('export-progression');
    if (!texte) { p.hidden = true; return; }
    p.hidden = false;
    p.textContent = texte;
  }

  /* ==================================================================
     EXPORT PDF
     ================================================================== */
  async function genererPdf() {
    progression('Génération du PDF…');
    const { jsPDF } = window.jspdf;
    // Document en portrait par défaut ; on ajoutera des pages paysage
    // pour les plans grâce au paramètre d'orientation d'addPage.
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const L = 210, H = 297;      // A4 portrait (mm)
    const marge = 14;

    await chargerLogo();

    // ---------- Page de garde ----------
    pdf.setFillColor(15, 44, 74);
    pdf.rect(0, 0, L, 46, 'F');
    // Logo en haut à droite (sur bandeau bleu, on met le logo blanc… mais
    // notre logo est sur fond blanc : on le pose donc sur une pastille blanche)
    if (logoData) {
      pdf.setFillColor(255, 255, 255);
      pdf.roundedRect(L - marge - 30, 8, 30, 30, 2, 2, 'F');
      pdf.addImage(logoData, 'PNG', L - marge - 28, 10, 26, 26);
    }
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(20);
    pdf.text('Reportage photo', marge, 24);
    pdf.setFontSize(11);
    pdf.text('Socotec Diagnostic', marge, 33);

    pdf.setTextColor(30, 39, 51);
    let y = 62;
    const ligne = (label, valeur) => {
      if (!valeur) return;
      pdf.setFontSize(9); pdf.setTextColor(120, 120, 120);
      pdf.text(label.toUpperCase(), marge, y);
      pdf.setFontSize(12); pdf.setTextColor(20, 30, 40);
      pdf.text(String(valeur), marge, y + 6);
      y += 16;
    };
    ligne('Dossier', dossierCourant.nom);
    ligne('Référence', dossierCourant.reference);
    ligne('Adresse', dossierCourant.adresse);
    if (dossierCourant.gps) {
      ligne('Coordonnées GPS',
        `${dossierCourant.gps.latitude.toFixed(5)}, ${dossierCourant.gps.longitude.toFixed(5)}`);
    }
    ligne('Édité le', new Date().toLocaleString('fr-FR'));

    const photos = await photosAExporter();
    ligne('Nombre de photos', photos.length);

    // ---------- Plans (chacun sur une page PAYSAGE) ----------
    const plans = await DB.obtenirParDossier('plans', dossierCourant.id);
    plans.sort((a, b) => a.dateCreation - b.dateCreation);

    for (const plan of plans) {
      // Page paysage : largeur et hauteur inversées (297 × 210)
      pdf.addPage('a4', 'landscape');
      const Lp = 297, Hp = 210;
      pdf.setFontSize(14); pdf.setTextColor(15, 44, 74);
      pdf.text('Plan : ' + plan.nom, marge, 18);

      const canvasPlan = await composerPlan(plan, new Set(photos.map((p) => p.id)));
      const imgData = canvasPlan.toDataURL('image/jpeg', 0.85);
      const ratio = canvasPlan.height / canvasPlan.width;

      // Ajuste le plan dans l'espace disponible (sous le titre)
      const dispoL = Lp - marge * 2;
      const dispoH = Hp - 30;
      let largeurImg = dispoL;
      let hauteurImg = largeurImg * ratio;
      if (hauteurImg > dispoH) { hauteurImg = dispoH; largeurImg = hauteurImg / ratio; }
      pdf.addImage(imgData, 'JPEG', (Lp - largeurImg) / 2, 24, largeurImg, hauteurImg);
    }

    // ---------- Photos : DEUX par page (portrait) ----------
    // Chaque page est divisée en deux moitiés (haut / bas).
    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i];
      progression(`PDF : photo ${i + 1} / ${photos.length}…`);
      const numero = await Photos.numeroPhoto(dossierCourant.id, photo.id);

      // Nouvelle page toutes les 2 photos (positions paires)
      if (i % 2 === 0) pdf.addPage('a4', 'portrait');

      // yBase = haut de la demi-page où placer cette photo
      const demiHauteur = (H - marge * 2) / 2;     // hauteur d'une moitié
      const yBase = (i % 2 === 0) ? marge : marge + demiHauteur + 4;

      await dessinerBlocPhoto(pdf, photo, numero, yBase, demiHauteur, L, marge);

      // Ligne de séparation entre les deux photos d'une même page
      if (i % 2 === 0 && i + 1 < photos.length) {
        pdf.setDrawColor(210, 221, 230);
        pdf.line(marge, marge + demiHauteur + 2, L - marge, marge + demiHauteur + 2);
      }
    }

    progression('Enregistrement…');
    pdf.save(nomFichier('pdf'));
    progression('');
  }

  /* Dessine un bloc "photo" (image + numéro + tags + observation) dans une
     zone donnée (une demi-page). Image à gauche, informations à droite. */
  async function dessinerBlocPhoto(pdf, photo, numero, yBase, hauteurZone, L, marge) {
    // Pastille numéro + titre
    pdf.setFillColor(11, 92, 171);
    pdf.circle(marge + 5, yBase + 5, 5, 'F');
    pdf.setTextColor(255, 255, 255); pdf.setFontSize(11);
    pdf.text(String(numero), marge + 5, yBase + 7, { align: 'center' });
    pdf.setTextColor(15, 44, 74); pdf.setFontSize(12);
    pdf.text('Photo n°' + numero, marge + 14, yBase + 7);

    // Image (annotée si dispo) à gauche
    const source = photo.apercu || photo.image;
    const img = await chargerImage(source);
    const dataImg = await blobEnBase64(source);
    const ratio = img.height / img.width;

    const largeurImg = (L - marge * 2) * 0.55; // ~55 % de la largeur
    let hauteurImg = largeurImg * ratio;
    const hMax = hauteurZone - 16;
    let lImg = largeurImg;
    if (hauteurImg > hMax) { hauteurImg = hMax; lImg = hauteurImg / ratio; }
    pdf.addImage(dataImg, 'JPEG', marge, yBase + 12, lImg, hauteurImg);

    // Informations à droite
    const xInfo = marge + largeurImg + 8;
    const largeurInfo = L - marge - xInfo;
    let yi = yBase + 16;

    const loc = tagsDe(photo, 'localisation');
    const rem = tagsDe(photo, 'remarque');

    const bloc = (label, valeur) => {
      if (!valeur || !valeur.length) return;
      pdf.setFontSize(8); pdf.setTextColor(120, 120, 120);
      pdf.text(label, xInfo, yi);
      pdf.setFontSize(10); pdf.setTextColor(20, 30, 40);
      const texte = Array.isArray(valeur) ? valeur.join(', ') : valeur;
      const lignes = pdf.splitTextToSize(texte, largeurInfo);
      pdf.text(lignes, xInfo, yi + 4.5);
      yi += 4.5 + lignes.length * 4.5 + 3;
    };
    bloc('LOCALISATION', loc);
    if (photo.exterieure && Number.isFinite(Number(photo.gps?.latitude)) && Number.isFinite(Number(photo.gps?.longitude))) {
      bloc('COORDONNÉES GPS', `${Number(photo.gps.latitude).toFixed(6)}, ${Number(photo.gps.longitude).toFixed(6)}`);
    }
    bloc('REMARQUES', rem);
    if (photo.observation && photo.observation.trim()) {
      bloc('OBSERVATION', photo.observation.trim());
    }
  }

  /* Compose un plan + ses repères (numéros + couleurs) sur un canvas */
  async function composerPlan(plan, photoIdsInclus = null) {
    const img = await chargerImage(plan.image);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    for (const repere of (plan.reperes || [])) {
      if (photoIdsInclus && !photoIdsInclus.has(repere.photoId)) continue;
      const numero = await Photos.numeroPhoto(dossierCourant.id, repere.photoId);
      const cx = repere.x * canvas.width;
      const cy = repere.y * canvas.height;
      const rayon = Math.max(14, canvas.width * 0.012);

      ctx.beginPath();
      ctx.arc(cx, cy, rayon, 0, Math.PI * 2);
      ctx.fillStyle = await couleurRepere(repere);
      ctx.fill();
      ctx.lineWidth = Math.max(2, rayon * 0.15);
      ctx.strokeStyle = '#FFFFFF';
      ctx.stroke();

      ctx.fillStyle = '#FFFFFF';
      ctx.font = `bold ${rayon * 1.1}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(numero ?? '?'), cx, cy);
    }
    return canvas;
  }

  /* Couleur d'un repère selon la 1re remarque de sa photo (comme plans.js) */
  const PALETTE = ['#E53935', '#8E24AA', '#1E88E5', '#00897B', '#F4511E',
    '#3949AB', '#7CB342', '#D81B60', '#00ACC1', '#6D4C41'];
  async function couleurRepere(repere) {
    const photo = await DB.obtenir('photos', repere.photoId);
    if (!photo || !photo.tags || photo.tags.length === 0) return '#78909C';
    const remarques = (dossierCourant.tags || []).filter((t) => t.type === 'remarque');
    const premiere = remarques.find((t) => photo.tags.includes(t.id));
    if (!premiere) return '#78909C';
    return PALETTE[remarques.indexOf(premiere) % PALETTE.length];
  }

  /* Libellés des tags d'un type portés par une photo */
  function tagsDe(photo, type) {
    return (dossierCourant.tags || [])
      .filter((t) => t.type === type && (photo.tags || []).includes(t.id))
      .map((t) => t.libelle);
  }

  /* ==================================================================
     EXPORT ZIP (archive technique)
     ================================================================== */
  async function genererZip() {
    progression('Préparation de la sauvegarde…');
    const zip = new JSZip();
    const photos = await photosAExporter();
    const plans = await DB.obtenirParDossier('plans', dossierCourant.id);
    const dossierPhotos = zip.folder('photos-optimisees');
    const dossierAnnotees = zip.folder('photos-annotees');
    const dossierPlans = zip.folder('plans');

    const donnees = {
      format: 'photo-report',
      versionFormat: 2,
      versionApplication: '2.1.3',
      dossier: {
        id: dossierCourant.id,
        nom: dossierCourant.nom,
        reference: dossierCourant.reference,
        adresse: dossierCourant.adresse,
        gps: dossierCourant.gps || null,
        tags: dossierCourant.tags || [],
        dateCreation: dossierCourant.dateCreation,
        dateModification: dossierCourant.dateModification,
      },
      photos: [], plans: [], exporteLe: new Date().toISOString(),
    };

    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i];
      progression(`Sauvegarde : photo ${i + 1} / ${photos.length}…`);
      const numero = await Photos.numeroPhoto(dossierCourant.id, photo.id);
      const base = `photo-${String(numero).padStart(3, '0')}`;
      const fichier = `photos-optimisees/${base}.jpg`;
      dossierPhotos.file(`${base}.jpg`, photo.image);
      let fichierAnnote = null;
      if (photo.apercu) {
        fichierAnnote = `photos-annotees/${base}-annotee.jpg`;
        dossierAnnotees.file(`${base}-annotee.jpg`, photo.apercu);
      }
      donnees.photos.push({
        id: photo.id, numero, fichier, fichierAnnote,
        tags: photo.tags || [], observation: photo.observation || '',
        exterieure: Boolean(photo.exterieure), gps: photo.gps || null,
        annotations: photo.annotations || [], dateCreation: photo.dateCreation,
      });
    }

    for (let i = 0; i < plans.length; i++) {
      const plan = plans[i];
      const nomPlan = `plan-${String(i + 1).padStart(2, '0')}.jpg`;
      dossierPlans.file(nomPlan, plan.image);
      const reperes = (plan.reperes || [])
        .filter((r) => photos.some((p) => p.id === r.photoId))
        .map((r) => ({ id: r.id, photoId: r.photoId, x: r.x, y: r.y }));
      donnees.plans.push({
        id: plan.id, nom: plan.nom, fichier: 'plans/' + nomPlan,
        dateCreation: plan.dateCreation, reperes,
      });
    }

    zip.file('donnees.json', JSON.stringify(donnees, null, 2));
    progression('Compression…');
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    telecharger(blob, nomFichier('zip'));
    progression('');
  }

  /* ==================================================================
     UTILITAIRES DE TÉLÉCHARGEMENT
     ================================================================== */
  function nomFichier(ext) {
    const base = (dossierCourant.reference || dossierCourant.nom || 'dossier')
      .replace(/[^a-z0-9]+/gi, '-').slice(0, 40);
    const date = new Date().toISOString().slice(0, 10);
    return `${base}_${date}.${ext}`;
  }

  function telecharger(blob, nom) {
    const url = URL.createObjectURL(blob);
    const lien = document.createElement('a');
    lien.href = url;
    lien.download = nom;
    lien.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ==================================================================
     BRANCHEMENTS
     ================================================================== */
  function initialiser() {
    document.getElementById('btn-exporter')
      .addEventListener('click', () => ouvrir(Photos.dossierActuel()));

    document.getElementById('btn-export-pdf').addEventListener('click', async () => {
      try { await genererPdf(); }
      catch (e) { console.error(e); progression(''); alert('Erreur lors de la génération du PDF.'); }
    });

    document.getElementById('btn-export-zip').addEventListener('click', async () => {
      try { await genererZip(); }
      catch (e) { console.error(e); progression(''); alert('Erreur lors de la création de l\'archive.'); }
    });

    document.getElementById('btn-export-fermer')
      .addEventListener('click', () => dialogue.close());
  }

  return { initialiser };

})();
