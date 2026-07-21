/* ====================================================================
   photos.js — Gestion des photos d'un dossier
   --------------------------------------------------------------------
   RÔLE : ajouter des photos (caméra ou galerie), les compresser,
   afficher la grille de vignettes, ouvrir une photo en plein écran
   et la supprimer.

   POURQUOI COMPRESSER ? Une photo de smartphone fait 3 à 8 Mo.
   À 200 photos par dossier, on saturerait le stockage et les exports
   PDF seraient énormes. On redimensionne donc chaque photo à
   1600 px maximum (~300-500 Ko, largement suffisant pour un rapport)
   et on génère en plus une petite vignette de 320 px pour que la
   grille s'affiche instantanément sans charger les grandes images.
   ==================================================================== */

const Photos = (() => {

  /* Réglages de compression, regroupés pour être faciles à ajuster */
  const COTE_MAX_IMAGE = 1600;   // grand côté de l'image conservée (px)
  const QUALITE_IMAGE = 0.85;    // qualité JPEG (0 à 1)
  const COTE_MAX_VIGNETTE = 320;
  const QUALITE_VIGNETTE = 0.75;

  // Raccourcis vers les éléments HTML
  const grille = document.getElementById('grille-photos');
  const etatVide = document.getElementById('etat-vide-photos');
  const indicateurAjout = document.getElementById('indicateur-ajout');
  const entreeGalerie = document.getElementById('entree-galerie');
  const dialogueSupprimer = document.getElementById('dialogue-supprimer-photo');

  let dossierCourant = null;  // le dossier actuellement ouvert
  let photoCourante = null;   // la photo affichée dans la visionneuse

  /* Les images stockées en base sont des Blobs (données binaires).
     Pour les afficher dans une balise <img>, on crée des adresses
     temporaires avec URL.createObjectURL(). Il faut les libérer
     ensuite (revokeObjectURL), sinon la mémoire se remplit à chaque
     affichage de la grille. On les garde donc dans cette liste. */
  let urlsTemporaires = [];

  function libererUrls() {
    urlsTemporaires.forEach((url) => URL.revokeObjectURL(url));
    urlsTemporaires = [];
  }

  /* ------------------------------------------------------------------
     OUVERTURE D'UN DOSSIER : appelée par dossiers.js
     ------------------------------------------------------------------ */
  async function ouvrir(dossier) {
    dossierCourant = dossier;
    await afficherGrille();
    App.montrerEcran('ecran-dossier');
  }

  /* ------------------------------------------------------------------
     COMPRESSION : redimensionne une image et la ré-encode en JPEG.
     Fonctionnement : on dessine l'image sur un <canvas> (une toile
     de dessin invisible) à la taille voulue, puis on demande au
     canvas de produire un fichier JPEG.
     'imageOrientation: from-image' corrige automatiquement les photos
     prises en mode portrait (sinon elles apparaîtraient couchées).
     ------------------------------------------------------------------ */
  async function compresser(fichier, coteMax, qualite) {
    const image = await createImageBitmap(fichier, { imageOrientation: 'from-image' });

    // Échelle de réduction (jamais d'agrandissement : Math.min avec 1)
    const echelle = Math.min(1, coteMax / Math.max(image.width, image.height));

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.width * echelle);
    canvas.height = Math.round(image.height * echelle);
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close(); // libère la mémoire de l'image d'origine

    return new Promise((resoudre) =>
      canvas.toBlob(resoudre, 'image/jpeg', qualite));
  }

  /* ------------------------------------------------------------------
     AJOUT : traite les fichiers choisis (caméra ou galerie)
     ------------------------------------------------------------------ */
  /* Crée une photo à partir d'un fichier image : compresse, enregistre
     et RENVOIE la photo créée. Réutilisé par l'ajout classique ET par
     les plans (pour lier un repère à une nouvelle photo). */
  async function creerPhotoDepuisFichier(fichier) {
    const photo = {
      id: crypto.randomUUID(),
      dossierId: dossierCourant.id,   // lien vers le dossier parent
      dateCreation: Date.now(),
      image: await compresser(fichier, COTE_MAX_IMAGE, QUALITE_IMAGE),
      vignette: await compresser(fichier, COTE_MAX_VIGNETTE, QUALITE_VIGNETTE),
      tags: [],          // rempli à l'étape 3
      observation: '',   // rempli à l'étape 3
      annotations: [],   // rempli à l'étape 4
    };
    await DB.enregistrer('photos', photo);

    // Met à jour la date de modification du dossier (sert au tri d'accueil)
    dossierCourant.dateModification = Date.now();
    await DB.enregistrer('dossiers', dossierCourant);

    return photo;
  }

  async function ajouterFichiers(fichiers) {
    if (!fichiers || fichiers.length === 0) return;

    indicateurAjout.hidden = false; // "Ajout des photos en cours…"

    for (const fichier of fichiers) {
      if (!fichier.type.startsWith('image/')) continue; // ignore les non-images
      await creerPhotoDepuisFichier(fichier);
    }

    indicateurAjout.hidden = true;
    await afficherGrille();

    // Si la photo venait de l'écran caméra, on le ferme et on revient
    // à la grille du dossier pour voir la nouvelle vignette.
    Camera.fermer();
    App.montrerEcran('ecran-dossier');
  }

  /* ------------------------------------------------------------------
     GRILLE : affiche les vignettes du dossier courant
     ------------------------------------------------------------------ */
  async function afficherGrille() {
    libererUrls(); // libère les adresses de l'affichage précédent

    const photos = await DB.obtenirParDossier('photos', dossierCourant.id);
    photos.sort((a, b) => a.dateCreation - b.dateCreation); // ordre de prise

    grille.innerHTML = '';
    etatVide.hidden = photos.length > 0;

    for (const photo of photos) {
      const url = URL.createObjectURL(photo.vignette);
      urlsTemporaires.push(url);

      const element = document.createElement('li');
      element.className = 'grille-photos__case';
      element.innerHTML = `<img src="${url}" alt="Vignette" loading="lazy">`;
      element.addEventListener('click', () => ouvrirPhoto(photo));
      grille.appendChild(element);
    }
  }

  /* ------------------------------------------------------------------
     VISIONNEUSE : affiche une photo, ses tags et son observation
     ------------------------------------------------------------------ */
  function ouvrirPhoto(photo) {
    photoCourante = photo;

    // Affiche l'aperçu annoté s'il existe (photo + annotations), sinon
    // l'image d'origine. L'original n'est jamais modifié.
    const source = photo.apercu || photo.image;
    const url = URL.createObjectURL(source);
    urlsTemporaires.push(url);
    document.getElementById('photo-pleine').src = url;

    document.getElementById('photo-date').textContent =
      new Date(photo.dateCreation).toLocaleString('fr-FR', {
        day: 'numeric', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });

    // Tags cochables (localisation + remarque) et observation existante
    Tags.afficherTagsPhoto(dossierCourant, photo);
    document.getElementById('champ-observation').value = photo.observation || '';

    // Repères de plan pointant vers cette photo (chargement asynchrone)
    afficherReperesLies(photo);

    App.montrerEcran('ecran-photo');
  }

  /* Affiche les repères de plan qui pointent vers cette photo */
  async function afficherReperesLies(photo) {
    const zone = document.getElementById('photo-reperes');
    const reperes = await Plans.reperesDeLaPhoto(dossierCourant.id, photo.id);

    if (reperes.length === 0) {
      zone.hidden = true;
      return;
    }
    zone.hidden = false;
    zone.innerHTML = '<span class="photo-reperes__titre">📍 Repère(s) sur plan :</span>';
    for (const r of reperes) {
      const puce = document.createElement('span');
      puce.className = 'photo-reperes__puce';
      // Numéro dans une pastille + nom du plan
      puce.innerHTML = `<span class="photo-reperes__num">${r.numero}</span>`;
      puce.appendChild(document.createTextNode(' ' + r.nomPlan));
      zone.appendChild(puce);
    }
  }

  /* ------------------------------------------------------------------
     SUPPRESSION d'une photo (avec confirmation)
     ------------------------------------------------------------------ */
  async function confirmerSuppressionPhoto() {
    Dictee.arreter();
    if (photoCourante) {
      await DB.supprimer('photos', photoCourante.id);
      photoCourante = null;
    }
    dialogueSupprimer.close();
    await afficherGrille();
    App.montrerEcran('ecran-dossier'); // retour à la grille
  }

  /* ------------------------------------------------------------------
     BRANCHEMENTS : appelé une seule fois au démarrage par app.js
     ------------------------------------------------------------------ */
  function initialiser() {
    // "Prendre une photo" ouvre l'écran caméra en direct (getUserMedia).
    // Camera.ouvrir reçoit ajouterFichiers en callback : la ou les
    // images capturées sont donc traitées exactement comme un import.
    document.getElementById('btn-prendre-photo')
      .addEventListener('click', () => Camera.ouvrir(ajouterFichiers));

    document.getElementById('btn-importer-photos')
      .addEventListener('click', () => entreeGalerie.click());

    // Import galerie. 'entree.value = ""' remet le champ à zéro : sans
    // cela, réimporter exactement le même fichier ne déclencherait pas
    // l'événement 'change'.
    entreeGalerie.addEventListener('change', async () => {
      await ajouterFichiers(entreeGalerie.files);
      entreeGalerie.value = '';
    });

    // Visionneuse : retour au dossier (en coupant le micro si actif)
    document.getElementById('btn-retour-dossier')
      .addEventListener('click', () => {
        Dictee.arreter();
        App.montrerEcran('ecran-dossier');
      });

    // Bouton "Annoter" : ouvre l'éditeur ; au retour, on rouvre la
    // photo pour afficher le nouvel aperçu annoté
    document.getElementById('btn-annoter')
      .addEventListener('click', () => {
        Dictee.arreter();
        if (photoCourante) {
          Annotate.ouvrir(photoCourante, (photoMaj) => {
            photoCourante = photoMaj;
            ouvrirPhoto(photoMaj);   // rafraîchit l'aperçu
          });
        }
      });

    // Bouton "Gérer les tags" : ouvre la fenêtre de gestion, puis
    // rafraîchit l'affichage des tags de la photo à la fermeture
    document.getElementById('btn-gerer-tags')
      .addEventListener('click', () => {
        Tags.ouvrirGestion(dossierCourant, () => {
          if (photoCourante) Tags.afficherTagsPhoto(dossierCourant, photoCourante);
        });
      });

    // Observation : enregistrement automatique à chaque frappe/dictée.
    // On attend un court instant après la dernière frappe (anti-rebond)
    // pour ne pas écrire en base à chaque lettre.
    const champObs = document.getElementById('champ-observation');
    let minuteur = null;
    champObs.addEventListener('input', () => {
      clearTimeout(minuteur);
      minuteur = setTimeout(async () => {
        if (photoCourante) {
          photoCourante.observation = champObs.value;
          await DB.enregistrer('photos', photoCourante);
        }
      }, 400);
    });

    document.getElementById('btn-supprimer-photo')
      .addEventListener('click', () => dialogueSupprimer.showModal());
    document.getElementById('btn-annuler-suppression-photo')
      .addEventListener('click', () => dialogueSupprimer.close());
    document.getElementById('btn-confirmer-suppression-photo')
      .addEventListener('click', confirmerSuppressionPhoto);

    // Bouton "Plans du dossier" : ouvre l'écran des plans
    document.getElementById('btn-ouvrir-plans')
      .addEventListener('click', () => Plans.ouvrir(dossierCourant));
  }

  // Fonctions exposées. 'dossierActuel' et 'creerPhotoDepuisFichier'
  // servent au module Plans (associer un repère à une nouvelle photo).
  return {
    initialiser,
    ouvrir,
    ouvrirPhoto,
    creerPhotoDepuisFichier,
    dossierActuel: () => dossierCourant,
  };

})();
