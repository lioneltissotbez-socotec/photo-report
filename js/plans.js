/* ====================================================================
   plans.js — Plans et repères
   --------------------------------------------------------------------
   RÔLE : importer des plans (image ou PDF) dans un dossier, et y poser
   des repères qui renvoient chacun à une photo.

   PDF : converti en image DÈS L'IMPORT via pdf.js (une page = un plan).
   Ainsi, en interne, un plan est toujours une image — l'affichage et le
   placement des repères sont identiques quel que soit le format d'origine,
   et tout reste disponible hors ligne.

   REPÈRE : { id, x, y, photoId, numero }
   - x, y sont en POURCENTAGE (0 à 1) de la taille du plan : le repère
     reste bien placé quelle que soit la taille d'affichage.
   - numero : ordre d'apparition sur le plan (1, 2, 3…).
   - couleur : calculée à l'affichage selon la 1re remarque de la photo.

   Un plan : { id, dossierId, nom, image (Blob), reperes: [], dateCreation }
   ==================================================================== */

const Plans = (() => {

  // Palette pour colorer les repères selon leur remarque
  const PALETTE = ['#E53935', '#8E24AA', '#1E88E5', '#00897B', '#F4511E',
    '#3949AB', '#7CB342', '#D81B60', '#00ACC1', '#6D4C41'];
  const COULEUR_SANS_REMARQUE = '#78909C'; // gris si la photo n'a pas de remarque

  // Éléments HTML
  const grillePlans = document.getElementById('grille-plans');
  const etatVidePlans = document.getElementById('etat-vide-plans');
  const entreePlan = document.getElementById('entree-plan');
  const indicateurPlan = document.getElementById('indicateur-plan');
  const planZone = document.getElementById('plan-zone');
  const planImage = document.getElementById('plan-image');

  let dossierCourant = null;
  let planCourant = null;
  let modePlacement = false;   // true quand on place/déplace des repères
  let planASupprimer = null;
  let urlsTemp = [];

  function libererUrls() {
    urlsTemp.forEach((u) => URL.revokeObjectURL(u));
    urlsTemp = [];
  }

  /* ==================================================================
     OUVERTURE de l'écran des plans du dossier
     ================================================================== */
  async function ouvrir(dossier) {
    dossierCourant = dossier;
    document.getElementById('plans-sous-titre').textContent = dossier.nom;
    await afficherGrillePlans();
    App.montrerEcran('ecran-plans');
  }

  async function afficherGrillePlans() {
    libererUrls();
    const plans = await DB.obtenirParDossier('plans', dossierCourant.id);
    plans.sort((a, b) => a.dateCreation - b.dateCreation);

    grillePlans.innerHTML = '';
    etatVidePlans.hidden = plans.length > 0;

    for (const plan of plans) {
      const url = URL.createObjectURL(plan.image);
      urlsTemp.push(url);

      const carte = document.createElement('li');
      carte.className = 'plan-carte';
      carte.innerHTML = `
        <img src="${url}" alt="Plan" loading="lazy">
        <div class="plan-carte__pied">
          <span class="plan-carte__nom"></span>
          <span class="plan-carte__compteur">${(plan.reperes || []).length} repère(s)</span>
        </div>`;
      carte.querySelector('.plan-carte__nom').textContent = plan.nom;
      carte.addEventListener('click', () => ouvrirPlan(plan));
      grillePlans.appendChild(carte);
    }
  }

  /* ==================================================================
     IMPORT d'un plan (image ou PDF)
     ================================================================== */
  async function importerFichier(fichier) {
    if (!fichier) return;
    indicateurPlan.hidden = false;

    try {
      if (fichier.type === 'application/pdf') {
        await importerPdf(fichier);          // une page = un plan
      } else if (fichier.type.startsWith('image/')) {
        await creerPlanDepuisImage(fichier, fichier.name);
      }
      await afficherGrillePlans();
    } catch (erreur) {
      console.error('Import du plan échoué :', erreur);
      alert("Impossible d'importer ce plan. Vérifiez le fichier.");
    } finally {
      indicateurPlan.hidden = true;
    }
  }

  /* Crée un plan à partir d'une image (compressée pour ne pas saturer) */
  async function creerPlanDepuisImage(source, nom) {
    // 'source' peut être un File ou un Blob (page PDF rendue)
    const image = await createImageBitmap(source);
    const coteMax = 2400; // les plans peuvent contenir du texte fin : on garde du détail
    const echelle = Math.min(1, coteMax / Math.max(image.width, image.height));

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.width * echelle);
    canvas.height = Math.round(image.height * echelle);
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();

    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));

    const plan = {
      id: crypto.randomUUID(),
      dossierId: dossierCourant.id,
      nom: nettoyerNom(nom),
      image: blob,
      reperes: [],
      dateCreation: Date.now(),
    };
    await DB.enregistrer('plans', plan);
  }

  /* Convertit un PDF en une ou plusieurs images (une par page) via pdf.js */
  async function importerPdf(fichier) {
    // Indique à pdf.js où trouver son "worker" (fichier de calcul en arrière-plan)
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';

    const donnees = await fichier.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: donnees }).promise;

    for (let numPage = 1; numPage <= pdf.numPages; numPage++) {
      const page = await pdf.getPage(numPage);
      // On rend la page à une échelle 2x pour un plan bien net
      const viewport = page.getViewport({ scale: 2 });

      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
      const nomPage = pdf.numPages > 1
        ? `${nettoyerNom(fichier.name)} — page ${numPage}`
        : nettoyerNom(fichier.name);

      await DB.enregistrer('plans', {
        id: crypto.randomUUID(),
        dossierId: dossierCourant.id,
        nom: nomPage,
        image: blob,
        reperes: [],
        dateCreation: Date.now() + numPage, // + numPage garde l'ordre des pages
      });
    }
  }

  /* Retire l'extension du nom de fichier pour un affichage propre */
  function nettoyerNom(nom) {
    return (nom || 'Plan').replace(/\.[^.]+$/, '').slice(0, 60);
  }

  /* ==================================================================
     AFFICHAGE d'un plan individuel + ses repères
     ================================================================== */
  async function ouvrirPlan(plan) {
    planCourant = plan;
    modePlacement = false;
    majBoutonMode();

    document.getElementById('plan-titre').textContent = plan.nom;

    libererUrls();
    const url = URL.createObjectURL(plan.image);
    urlsTemp.push(url);
    planImage.src = url;
    planImage.onload = () => dessinerReperes();

    App.montrerEcran('ecran-plan');
  }

  /* Calcule la couleur d'un repère selon la 1re remarque de sa photo */
  async function couleurRepere(repere) {
    const photo = await DB.obtenir('photos', repere.photoId);
    if (!photo || !photo.tags || photo.tags.length === 0) return COULEUR_SANS_REMARQUE;

    // Remarques du dossier (dans l'ordre), pour un mapping stable
    const remarquesDossier = (dossierCourant.tags || [])
      .filter((t) => t.type === 'remarque');

    // Première remarque cochée sur la photo
    const premiereRemarque = remarquesDossier.find((t) => photo.tags.includes(t.id));
    if (!premiereRemarque) return COULEUR_SANS_REMARQUE;

    const index = remarquesDossier.indexOf(premiereRemarque);
    return PALETTE[index % PALETTE.length];
  }

  /* Dessine toutes les pastilles de repères sur le plan */
  async function dessinerReperes() {
    // Retire les anciennes pastilles (garde l'image)
    planZone.querySelectorAll('.repere').forEach((r) => r.remove());

    for (const repere of (planCourant.reperes || [])) {
      const couleur = await couleurRepere(repere);
      const pastille = document.createElement('button');
      pastille.type = 'button';
      pastille.className = 'repere';
      pastille.style.left = (repere.x * 100) + '%';
      pastille.style.top = (repere.y * 100) + '%';
      pastille.style.background = couleur;
      pastille.textContent = repere.numero;
      pastille.dataset.id = repere.id;

      brancherRepere(pastille, repere);
      planZone.appendChild(pastille);
    }
  }

  /* Comportement d'une pastille : ouvrir la photo (consultation) ou
     la déplacer / supprimer (mode placement) */
  function brancherRepere(pastille, repere) {
    let deplace = false;
    let minuteurAppuiLong = null;  // pour détecter l'appui long tactile

    pastille.addEventListener('pointerdown', (e) => {
      if (modePlacement) {
        e.stopPropagation();           // n'ajoute pas un nouveau repère
        e.preventDefault();
        pastille.setPointerCapture(e.pointerId);
        deplace = false;
        return;
      }
      // Hors mode placement, sur écran tactile : appui long → aperçu.
      // (Sur souris, l'aperçu s'affiche au survol, géré plus bas.)
      if (e.pointerType === 'touch') {
        minuteurAppuiLong = setTimeout(() => {
          minuteurAppuiLong = null;
          afficherApercu(repere, pastille); // appui long détecté
        }, 450);
      }
    });

    pastille.addEventListener('pointermove', (e) => {
      if (!modePlacement || !pastille.hasPointerCapture(e.pointerId)) return;
      deplace = true;
      const rect = planImage.getBoundingClientRect();
      repere.x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      repere.y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
      pastille.style.left = (repere.x * 100) + '%';
      pastille.style.top = (repere.y * 100) + '%';
    });

    pastille.addEventListener('pointerup', async (e) => {
      // Si un appui long était en attente et qu'on relâche avant : c'était
      // un tap court → on annule le minuteur et on ouvre la photo.
      if (minuteurAppuiLong) {
        clearTimeout(minuteurAppuiLong);
        minuteurAppuiLong = null;
      }

      if (modePlacement) {
        if (deplace) {
          await DB.enregistrer('plans', planCourant); // sauvegarde la position
        } else {
          // Simple tap en mode placement → proposer de supprimer
          if (confirm(`Supprimer le repère ${repere.numero} ?`)) {
            planCourant.reperes = planCourant.reperes.filter((r) => r.id !== repere.id);
            renumeroter();
            await DB.enregistrer('plans', planCourant);
            await dessinerReperes();
          }
        }
        return;
      }

      // Hors mode placement :
      // - tactile : si l'aperçu est ouvert, un tap ailleurs le referme
      //   (géré globalement) ; ici un tap sur la pastille ne fait rien de
      //   plus (l'ouverture se fait via le bouton "Ouvrir la photo").
      // - souris : un clic ouvre directement la photo.
      if (e.pointerType !== 'touch') {
        const photo = await DB.obtenir('photos', repere.photoId);
        if (photo) Photos.ouvrirPhoto(photo);
      }
    });

    // Survol souris : affiche / masque l'aperçu
    pastille.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse' && !modePlacement) afficherApercu(repere, pastille);
    });
    pastille.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') masquerApercu();
    });
  }

  /* ==================================================================
     APERÇU AU SURVOL / APPUI LONG (miniature + numéro + remarques)
     ================================================================== */
  let photoApercuId = null; // photo actuellement montrée dans l'aperçu
  let urlApercu = null;     // URL temporaire de la miniature de l'aperçu

  async function afficherApercu(repere, pastille) {
    const photo = await DB.obtenir('photos', repere.photoId);
    if (!photo) return;
    photoApercuId = photo.id;

    const bulle = document.getElementById('apercu-repere');
    const img = document.getElementById('apercu-repere-img');

    // Miniature (URL dédiée, libérée à la fermeture — ne touche pas
    // à l'URL du plan de fond)
    if (urlApercu) URL.revokeObjectURL(urlApercu);
    urlApercu = URL.createObjectURL(photo.vignette);
    img.src = urlApercu;

    // Numéro
    document.getElementById('apercu-repere-num').textContent = 'Repère ' + repere.numero;

    // Remarques cochées sur la photo
    const zoneRem = document.getElementById('apercu-repere-remarques');
    zoneRem.innerHTML = '';
    const remarques = (dossierCourant.tags || [])
      .filter((t) => t.type === 'remarque' && photo.tags && photo.tags.includes(t.id));
    if (remarques.length === 0) {
      zoneRem.innerHTML = '<span class="apercu-repere__vide">Aucune remarque</span>';
    } else {
      for (const r of remarques) {
        const puce = document.createElement('span');
        puce.className = 'apercu-repere__tag';
        puce.textContent = r.libelle;
        zoneRem.appendChild(puce);
      }
    }

    // Positionne la bulle près de la pastille
    positionnerApercu(pastille);
    bulle.hidden = false;
  }

  /* Place la bulle au-dessus de la pastille, sans déborder de l'écran */
  function positionnerApercu(pastille) {
    const bulle = document.getElementById('apercu-repere');
    const rp = pastille.getBoundingClientRect();
    bulle.hidden = false; // nécessaire pour mesurer sa taille
    const largeur = bulle.offsetWidth;
    const hauteur = bulle.offsetHeight;

    let gauche = rp.left + rp.width / 2 - largeur / 2;
    let haut = rp.top - hauteur - 10; // au-dessus de la pastille

    // Garde la bulle dans l'écran
    gauche = Math.max(8, Math.min(gauche, window.innerWidth - largeur - 8));
    if (haut < 8) haut = rp.bottom + 10; // sinon en dessous

    bulle.style.left = gauche + 'px';
    bulle.style.top = haut + 'px';
  }

  function masquerApercu() {
    document.getElementById('apercu-repere').hidden = true;
    photoApercuId = null;
  }

  /* Renumérote les repères après une suppression (1, 2, 3…) */
  function renumeroter() {
    (planCourant.reperes || []).forEach((r, i) => { r.numero = i + 1; });
  }

  /* ==================================================================
     PLACEMENT d'un nouveau repère (clic sur le plan en mode placement)
     ================================================================== */
  function auClicPlan(e) {
    if (!modePlacement) return;
    // Ignore si on a cliqué sur une pastille existante (géré à part)
    if (e.target.classList.contains('repere')) return;

    const rect = planImage.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;

    // On mémorise la position et on demande à quoi associer le repère
    repereEnAttente = { x, y };
    document.getElementById('dialogue-repere').showModal();
  }

  let repereEnAttente = null;

  /* Crée le repère une fois la photo choisie/prise */
  async function finaliserRepere(photoId) {
    if (!repereEnAttente) return;
    if (!planCourant.reperes) planCourant.reperes = [];

    planCourant.reperes.push({
      id: crypto.randomUUID(),
      x: repereEnAttente.x,
      y: repereEnAttente.y,
      photoId,
      numero: planCourant.reperes.length + 1,
    });
    await DB.enregistrer('plans', planCourant);
    repereEnAttente = null;
    await dessinerReperes();
  }

  /* Choix "photo existante" : affiche une grille de photos du dossier */
  async function choisirPhotoExistante() {
    const dialogue = document.getElementById('dialogue-choix-photo');
    const grille = document.getElementById('choix-photo-grille');
    grille.innerHTML = '';

    const photos = await DB.obtenirParDossier('photos', dossierCourant.id);
    photos.sort((a, b) => a.dateCreation - b.dateCreation);

    if (photos.length === 0) {
      grille.innerHTML = '<p class="tags-vide">Aucune photo dans ce dossier. Prenez-en une d\'abord.</p>';
    }

    for (const photo of photos) {
      const url = URL.createObjectURL(photo.vignette);
      urlsTemp.push(url);
      const case_ = document.createElement('li');
      case_.className = 'grille-photos__case';
      case_.innerHTML = `<img src="${url}" alt="Vignette" loading="lazy">`;
      case_.addEventListener('click', async () => {
        dialogue.close();
        await finaliserRepere(photo.id);
      });
      grille.appendChild(case_);
    }
    dialogue.showModal();
  }

  /* Choix "nouvelle photo" : ouvre la caméra, crée la photo, lie le repère */
  function prendreNouvellePhoto() {
    Camera.ouvrir(async (fichiers) => {
      if (fichiers && fichiers[0]) {
        const photo = await Photos.creerPhotoDepuisFichier(fichiers[0]);
        Camera.fermer();
        App.montrerEcran('ecran-plan');
        await finaliserRepere(photo.id);
      }
    });
  }

  /* ==================================================================
     LÉGENDE : liste des remarques et leurs couleurs
     ================================================================== */
  function afficherLegende() {
    const liste = document.getElementById('legende-liste');
    liste.innerHTML = '';

    const remarques = (dossierCourant.tags || []).filter((t) => t.type === 'remarque');
    if (remarques.length === 0) {
      liste.innerHTML = '<p class="tags-vide">Aucune remarque définie dans ce dossier.</p>';
    }
    remarques.forEach((tag, i) => {
      const ligne = document.createElement('div');
      ligne.className = 'legende-ligne';
      ligne.innerHTML = `<span class="legende-pastille" style="background:${PALETTE[i % PALETTE.length]}"></span>
                         <span></span>`;
      ligne.querySelector('span:last-child').textContent = tag.libelle;
      liste.appendChild(ligne);
    });

    // Ligne "sans remarque"
    const ligne = document.createElement('div');
    ligne.className = 'legende-ligne';
    ligne.innerHTML = `<span class="legende-pastille" style="background:${COULEUR_SANS_REMARQUE}"></span>
                       <span>Sans remarque</span>`;
    liste.appendChild(ligne);

    document.getElementById('dialogue-legende').showModal();
  }

  /* ==================================================================
     BOUTONS / BRANCHEMENTS
     ================================================================== */
  function majBoutonMode() {
    const bouton = document.getElementById('btn-mode-repere');
    bouton.textContent = modePlacement ? '✓ Terminer' : '＋ Placer un repère';
    bouton.classList.toggle('btn--principal', !modePlacement);
    bouton.classList.toggle('btn--jaune', modePlacement);
    planZone.classList.toggle('plan-zone--placement', modePlacement);
  }

  function initialiser() {
    // Import de plan
    document.getElementById('btn-importer-plan')
      .addEventListener('click', () => entreePlan.click());
    entreePlan.addEventListener('change', async () => {
      await importerFichier(entreePlan.files[0]);
      entreePlan.value = '';
    });

    // Capture d'une carte comme plan
    document.getElementById('btn-capturer-carte')
      .addEventListener('click', () => {
        Carte.ouvrir(async (blob) => {
          // Le blob capturé devient un plan (même traitement qu'une image)
          const nom = 'Carte ' + new Date().toLocaleDateString('fr-FR');
          await creerPlanDepuisImage(blob, nom);
          App.montrerEcran('ecran-plans');
          await afficherGrillePlans();
        });
      });

    // Navigation
    document.getElementById('btn-retour-dossier-2')
      .addEventListener('click', () => App.montrerEcran('ecran-dossier'));
    document.getElementById('btn-retour-plans')
      .addEventListener('click', () => Plans.ouvrir(dossierCourant));

    // Mode placement de repères
    document.getElementById('btn-mode-repere').addEventListener('click', () => {
      modePlacement = !modePlacement;
      majBoutonMode();
    });

    // Clic sur le plan (placement)
    planZone.addEventListener('pointerdown', auClicPlan);

    // Fenêtre "type de repère"
    document.getElementById('btn-repere-existante').addEventListener('click', () => {
      document.getElementById('dialogue-repere').close();
      choisirPhotoExistante();
    });
    document.getElementById('btn-repere-nouvelle').addEventListener('click', () => {
      document.getElementById('dialogue-repere').close();
      prendreNouvellePhoto();
    });
    document.getElementById('btn-repere-annuler').addEventListener('click', () => {
      repereEnAttente = null;
      document.getElementById('dialogue-repere').close();
    });
    document.getElementById('btn-fermer-choix-photo').addEventListener('click', () => {
      document.getElementById('dialogue-choix-photo').close();
    });

    // Légende
    document.getElementById('btn-legende').addEventListener('click', afficherLegende);
    document.getElementById('btn-fermer-legende').addEventListener('click', () =>
      document.getElementById('dialogue-legende').close());

    // Aperçu au survol/appui long : bouton "Ouvrir la photo"
    document.getElementById('apercu-repere-ouvrir').addEventListener('click', async () => {
      if (photoApercuId) {
        const photo = await DB.obtenir('photos', photoApercuId);
        masquerApercu();
        if (photo) Photos.ouvrirPhoto(photo);
      }
    });

    // Un toucher/clic en dehors de la bulle la referme (comportement mobile :
    // premier appui long = aperçu, toucher ailleurs = referme)
    document.addEventListener('pointerdown', (e) => {
      const bulle = document.getElementById('apercu-repere');
      if (bulle.hidden) return;
      // Ne referme pas si on touche la bulle elle-même ou une pastille
      if (!bulle.contains(e.target) && !e.target.classList.contains('repere')) {
        masquerApercu();
      }
    });

    // Suppression d'un plan
    document.getElementById('btn-supprimer-plan').addEventListener('click', () => {
      planASupprimer = planCourant;
      document.getElementById('dialogue-supprimer-plan').showModal();
    });
    document.getElementById('btn-annuler-suppr-plan').addEventListener('click', () =>
      document.getElementById('dialogue-supprimer-plan').close());
    document.getElementById('btn-confirmer-suppr-plan').addEventListener('click', async () => {
      if (planASupprimer) {
        await DB.supprimer('plans', planASupprimer.id);
        planASupprimer = null;
      }
      document.getElementById('dialogue-supprimer-plan').close();
      await afficherGrillePlans();
      App.montrerEcran('ecran-plans');
    });
  }

  /* ==================================================================
     RELATION PHOTO → REPÈRES
     Renvoie la liste des repères (à travers tous les plans du dossier)
     qui pointent vers une photo donnée. Utilisé par l'écran photo pour
     afficher « Repère n°3 du plan RDC ».
     ================================================================== */
  async function reperesDeLaPhoto(dossierId, photoId) {
    const plans = await DB.obtenirParDossier('plans', dossierId);
    const resultat = [];
    for (const plan of plans) {
      for (const repere of (plan.reperes || [])) {
        if (repere.photoId === photoId) {
          resultat.push({ numero: repere.numero, nomPlan: plan.nom });
        }
      }
    }
    return resultat;
  }

  return { initialiser, ouvrir, reperesDeLaPhoto };

})();
