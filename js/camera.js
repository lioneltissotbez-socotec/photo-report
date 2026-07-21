/* ====================================================================
   camera.js — Prise de vue en direct (getUserMedia)
   --------------------------------------------------------------------
   POURQUOI CE FICHIER ? Sur ordinateur (Surface Pro incluse),
   l'attribut HTML capture="environment" est ignoré : le navigateur
   ouvre l'explorateur de fichiers. La seule façon d'accéder à la
   caméra sur desktop est l'API getUserMedia.

   POURQUOI SI COMPLIQUÉ ? Sur la Surface, la contrainte
   facingMode:'environment' n'est qu'une PRÉFÉRENCE, pas un ordre :
   Windows renvoie souvent la caméra avant quand même. La méthode
   fiable est donc :
     1. lister toutes les caméras réelles (enumerateDevices),
     2. les sélectionner par leur identifiant exact (deviceId),
     3. faire tourner le bouton bascule sur cette liste.
   Les caméras de la Surface s'appellent "Microsoft Camera Front" et
   "Microsoft Camera Rear" : on repère l'arrière par son libellé.

   SECOURS : si getUserMedia échoue (aucune caméra, permission
   refusée, contexte non sécurisé), on retombe sur le champ <input
   capture> — utile sur d'anciens mobiles.

   NOTE SÉCURITÉ : getUserMedia n'est disponible que sur localhost ou
   en HTTPS (Live Server et GitHub Pages conviennent).
   ==================================================================== */

const Camera = (() => {

  const video = document.getElementById('camera-flux');
  const messageErreur = document.getElementById('camera-erreur');
  const entreeSecours = document.getElementById('entree-camera-secours');
  const btnBasculer = document.getElementById('btn-basculer-camera');

  let flux = null;              // le MediaStream actif
  let camerasDispo = [];        // liste des caméras détectées [{deviceId, label}]
  let indexCamera = 0;          // index de la caméra actuellement utilisée
  let surCapture = null;        // fonction appelée quand une photo est prise

  /* ------------------------------------------------------------------
     LISTER LES CAMÉRAS
     enumerateDevices ne révèle les libellés ("...Rear") qu'APRÈS avoir
     obtenu au moins une fois la permission caméra. On démarre donc un
     flux provisoire, on liste, puis on coupe ce flux provisoire.
     On classe la caméra "arrière/rear/back" en tête, pour l'utiliser
     par défaut.
     ------------------------------------------------------------------ */
  async function listerCameras() {
    // Flux provisoire juste pour débloquer les libellés
    const provisoire = await navigator.mediaDevices.getUserMedia({ video: true });
    provisoire.getTracks().forEach((piste) => piste.stop());

    const appareils = await navigator.mediaDevices.enumerateDevices();
    camerasDispo = appareils.filter((a) => a.kind === 'videoinput');

    // On place la caméra arrière en premier (libellés variables selon
    // la langue/l'appareil : "rear", "back", "arrière", "environment")
    const estArriere = (label) =>
      /rear|back|arri|environment/i.test(label || '');

    camerasDispo.sort((a, b) =>
      (estArriere(b.label) ? 1 : 0) - (estArriere(a.label) ? 1 : 0));

    indexCamera = 0;

    // Le bouton bascule n'a de sens que s'il y a au moins 2 caméras
    btnBasculer.hidden = camerasDispo.length < 2;
  }

  /* ------------------------------------------------------------------
     DÉMARRER LE FLUX d'une caméra précise (par son deviceId).
     'exact' force réellement cette caméra (contrairement à facingMode).
     ------------------------------------------------------------------ */
  async function demarrerFlux() {
    arreterFlux();

    const camera = camerasDispo[indexCamera];
    const contraintes = {
      video: {
        deviceId: camera ? { exact: camera.deviceId } : undefined,
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    };

    flux = await navigator.mediaDevices.getUserMedia(contraintes);
    video.srcObject = flux;
    messageErreur.hidden = true;
    video.hidden = false;
  }

  /* Coupe la caméra proprement (éteint le voyant, libère le matériel) */
  function arreterFlux() {
    if (flux) {
      flux.getTracks().forEach((piste) => piste.stop());
      flux = null;
    }
  }

  /* ------------------------------------------------------------------
     OUVERTURE : appelée par photos.js. 'callback' reçoit le fichier capturé.
     ------------------------------------------------------------------ */
  async function ouvrir(callback) {
    surCapture = callback;
    App.montrerEcran('ecran-camera');

    try {
      await listerCameras();
      await demarrerFlux();
    } catch (erreur) {
      // Échec : bascule sur le champ <input capture> en secours
      console.warn('getUserMedia indisponible, secours input file :', erreur);
      fermer();
      entreeSecours.click();
    }
  }

  /* ------------------------------------------------------------------
     CAPTURE : fige l'image courante sur un canvas → fichier JPEG
     transmis à photos.js (qui compresse et enregistre).
     ------------------------------------------------------------------ */
  function capturer() {
    if (!flux) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);

    canvas.toBlob((blob) => {
      if (blob && surCapture) {
        const fichier = new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' });
        surCapture([fichier]);
      }
    }, 'image/jpeg', 0.95);
  }

  /* ------------------------------------------------------------------
     BASCULER : passe à la caméra suivante de la liste (en boucle).
     Le modulo (%) fait revenir à 0 après la dernière caméra.
     ------------------------------------------------------------------ */
  async function basculer() {
    if (camerasDispo.length < 2) return;
    indexCamera = (indexCamera + 1) % camerasDispo.length;
    try {
      await demarrerFlux();
    } catch (erreur) {
      messageErreur.textContent = "Impossible d'accéder à cette caméra.";
      messageErreur.hidden = false;
    }
  }

  /* Ferme l'écran caméra et coupe le flux */
  function fermer() {
    arreterFlux();
    video.srcObject = null;
  }

  /* ------------------------------------------------------------------
     BRANCHEMENTS
     ------------------------------------------------------------------ */
  function initialiser() {
    document.getElementById('btn-capturer')
      .addEventListener('click', capturer);

    btnBasculer.addEventListener('click', basculer);

    document.getElementById('btn-fermer-camera')
      .addEventListener('click', () => {
        fermer();
        App.montrerEcran('ecran-dossier');
      });

    // Secours : si getUserMedia a échoué, ce champ prend le relais
    entreeSecours.addEventListener('change', () => {
      if (surCapture) surCapture(entreeSecours.files);
      entreeSecours.value = '';
    });
  }

  return { initialiser, ouvrir, fermer };

})();
