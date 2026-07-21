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
  async function ajouterFichiers(fichiers) {
    if (!fichiers || fichiers.length === 0) return;

    indicateurAjout.hidden = false; // "Ajout des photos en cours…"

    for (const fichier of fichiers) {
      if (!fichier.type.startsWith('image/')) continue; // ignore les non-images

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
    }

    // Le dossier vient de changer : on met à jour sa date de modification
    // (c'est elle qui sert au tri de l'écran d'accueil)
    dossierCourant.dateModification = Date.now();
    await DB.enregistrer('dossiers', dossierCourant);

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
     VISIONNEUSE : affiche une photo en plein écran
     ------------------------------------------------------------------ */
  function ouvrirPhoto(photo) {
    photoCourante = photo;

    const url = URL.createObjectURL(photo.image);
    urlsTemporaires.push(url);
    document.getElementById('photo-pleine').src = url;

    document.getElementById('photo-date').textContent =
      new Date(photo.dateCreation).toLocaleString('fr-FR', {
        day: 'numeric', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });

    App.montrerEcran('ecran-photo');
  }

  /* ------------------------------------------------------------------
     SUPPRESSION d'une photo (avec confirmation)
     ------------------------------------------------------------------ */
  async function confirmerSuppressionPhoto() {
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

    // Visionneuse : retour et suppression
    document.getElementById('btn-retour-dossier')
      .addEventListener('click', () => App.montrerEcran('ecran-dossier'));

    document.getElementById('btn-supprimer-photo')
      .addEventListener('click', () => dialogueSupprimer.showModal());
    document.getElementById('btn-annuler-suppression-photo')
      .addEventListener('click', () => dialogueSupprimer.close());
    document.getElementById('btn-confirmer-suppression-photo')
      .addEventListener('click', confirmerSuppressionPhoto);
  }

  return { initialiser, ouvrir };

})();
