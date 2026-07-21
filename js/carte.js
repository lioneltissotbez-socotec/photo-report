/* ====================================================================
   carte.js — Capture d'un fond de carte comme plan
   --------------------------------------------------------------------
   PRINCIPE : les fonds de carte sont faits de "tuiles", de petites
   images de 256×256 px numérotées par (zoom, x, y). Pour afficher une
   carte, on télécharge les tuiles visibles et on les dessine côte à
   côte sur un canvas. Comme c'est NOTRE canvas, on peut ensuite le
   convertir en image sans aucune restriction — c'est ce qui permet la
   "capture comme plan".

   SOURCES (libres de droits, sans clé) :
   - Plan      : IGN Plan V2 (Géoplateforme)
   - Satellite : IGN Orthophotos (photos aériennes)
   Ces couches sont en projection Web Mercator (EPSG:3857), le standard
   des tuiles web — mêmes formules que OpenStreetMap.

   IMPORTANT : la capture nécessite une connexion (les tuiles se
   téléchargent à ce moment). Une fois capturé, le plan est une image
   stockée qui fonctionne hors ligne comme n'importe quel plan importé.
   ==================================================================== */

const Carte = (() => {

  const TAILLE_TUILE = 256;

  // Définition des fonds disponibles (URL + attribution obligatoire)
  const FONDS = {
    plan: {
      url: (z, x, y) => `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}`,
      attribution: '© IGN / Géoplateforme — Plan IGN',
      zoomMax: 19,
    },
    satellite: {
      url: (z, x, y) => `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}`,
      attribution: '© IGN / Géoplateforme — Orthophotos',
      zoomMax: 19,
    },
  };

  const canvas = document.getElementById('carte-canvas');
  const ctx = canvas.getContext('2d');

  // État de la vue : centre (lat/lon) + niveau de zoom
  let centre = { lat: 46.6, lon: 2.5 }; // centre de la France par défaut
  let zoom = 15;
  let fondActif = 'plan';
  let surCapture = null; // callback recevant l'image capturée (Blob)

  // Cache mémoire des tuiles déjà chargées (évite de retélécharger)
  const cacheTuiles = new Map();

  // Pour la navigation au doigt/souris
  let glisse = false;
  let dernierPoint = null;

  /* ==================================================================
     CONVERSIONS géographiques ↔ tuiles (formules Web Mercator standard)
     ================================================================== */
  function lonEnX(lon, z) {
    return (lon + 180) / 360 * Math.pow(2, z);
  }
  function latEnY(lat, z) {
    const rad = lat * Math.PI / 180;
    return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * Math.pow(2, z);
  }
  function xEnLon(x, z) {
    return x / Math.pow(2, z) * 360 - 180;
  }
  function yEnLat(y, z) {
    const n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
    return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  }

  /* ==================================================================
     OUVERTURE de l'écran carte
     ================================================================== */
  function ouvrir(callback) {
    surCapture = callback;
    App.montrerEcran('ecran-carte');
    // Ajuste la taille du canvas à la zone d'affichage, puis dessine
    setTimeout(() => { ajusterTaille(); dessiner(); }, 50);
  }

  /* Ajuste la résolution interne du canvas à sa taille affichée */
  function ajusterTaille() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width);
    canvas.height = Math.round(rect.height);
  }

  /* ==================================================================
     DESSIN : calcule les tuiles visibles et les assemble
     ================================================================== */
  function dessiner() {
    if (canvas.width === 0) return;
    ctx.fillStyle = '#DDE4EA';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Position (en pixels monde) du centre de la vue au zoom courant
    const centreX = lonEnX(centre.lon, zoom) * TAILLE_TUILE;
    const centreY = latEnY(centre.lat, zoom) * TAILLE_TUILE;

    // Coin haut-gauche de la vue, en pixels monde
    const origineX = centreX - canvas.width / 2;
    const origineY = centreY - canvas.height / 2;

    // Plage de tuiles à couvrir
    const tuileMinX = Math.floor(origineX / TAILLE_TUILE);
    const tuileMinY = Math.floor(origineY / TAILLE_TUILE);
    const tuileMaxX = Math.ceil((origineX + canvas.width) / TAILLE_TUILE);
    const tuileMaxY = Math.ceil((origineY + canvas.height) / TAILLE_TUILE);

    const nbTuiles = Math.pow(2, zoom);

    for (let tx = tuileMinX; tx < tuileMaxX; tx++) {
      for (let ty = tuileMinY; ty < tuileMaxY; ty++) {
        // Ignore les tuiles hors des limites du monde
        if (tx < 0 || ty < 0 || tx >= nbTuiles || ty >= nbTuiles) continue;

        const posX = tx * TAILLE_TUILE - origineX;
        const posY = ty * TAILLE_TUILE - origineY;
        chargerEtDessinerTuile(tx, ty, zoom, posX, posY);
      }
    }

    document.getElementById('carte-niveau').textContent = 'z' + zoom;
    document.getElementById('carte-attribution').textContent = FONDS[fondActif].attribution;
  }

  /* Charge une tuile (depuis le cache ou le réseau) et la dessine */
  function chargerEtDessinerTuile(tx, ty, z, posX, posY) {
    const cle = `${fondActif}/${z}/${tx}/${ty}`;

    if (cacheTuiles.has(cle)) {
      const img = cacheTuiles.get(cle);
      if (img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, posX, posY, TAILLE_TUILE, TAILLE_TUILE);
      }
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous'; // indispensable pour pouvoir capturer le canvas
    img.onload = () => {
      // Redessine tout quand la tuile arrive (position recalculée)
      dessiner();
    };
    img.onerror = () => {
      afficherMessage("Certaines tuiles n'ont pas pu être chargées. Vérifiez la connexion.");
    };
    img.src = FONDS[fondActif].url(z, tx, ty);
    cacheTuiles.set(cle, img);
  }

  /* ==================================================================
     NAVIGATION : glisser pour déplacer, boutons pour zoomer
     ================================================================== */
  function auDebut(e) {
    glisse = true;
    dernierPoint = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  }

  function auDeplacement(e) {
    if (!glisse) return;
    const dx = e.clientX - dernierPoint.x;
    const dy = e.clientY - dernierPoint.y;
    dernierPoint = { x: e.clientX, y: e.clientY };

    // Convertit le déplacement pixels en déplacement géographique
    const centreX = lonEnX(centre.lon, zoom) * TAILLE_TUILE - dx;
    const centreY = latEnY(centre.lat, zoom) * TAILLE_TUILE - dy;
    centre.lon = xEnLon(centreX / TAILLE_TUILE, zoom);
    centre.lat = yEnLat(centreY / TAILLE_TUILE, zoom);
    dessiner();
  }

  function auFin() { glisse = false; }

  function zoomer(delta) {
    const nouveau = zoom + delta;
    if (nouveau < 3 || nouveau > FONDS[fondActif].zoomMax) return;
    zoom = nouveau;
    dessiner();
  }

  /* ==================================================================
     POSITIONNEMENT : par adresse (Nominatim) ou par GPS
     ================================================================== */
  async function chercherAdresse() {
    const texte = document.getElementById('carte-adresse').value.trim();
    if (!texte) return;
    afficherMessage('Recherche…');

    try {
      const url = 'https://nominatim.openstreetmap.org/search'
        + `?format=jsonv2&limit=1&q=${encodeURIComponent(texte)}`;
      const reponse = await fetch(url, { headers: { 'Accept': 'application/json' } });
      const resultats = await reponse.json();

      if (resultats.length === 0) {
        afficherMessage('Adresse introuvable.');
        return;
      }
      centre.lat = parseFloat(resultats[0].lat);
      centre.lon = parseFloat(resultats[0].lon);
      zoom = 18; // on se rapproche sur l'adresse trouvée
      cacherMessage();
      dessiner();
    } catch (erreur) {
      afficherMessage('Recherche impossible (connexion ?).');
    }
  }

  async function allerGPS() {
    afficherMessage('Localisation…');
    try {
      const pos = await Geo.localiser();
      centre.lat = pos.latitude;
      centre.lon = pos.longitude;
      zoom = 18;
      cacherMessage();
      dessiner();
    } catch (erreur) {
      afficherMessage("Position GPS indisponible.");
    }
  }

  /* ==================================================================
     CAPTURE : convertit la vue actuelle en image (plan)
     ================================================================== */
  function capturer() {
    // On incruste l'attribution en bas de l'image (obligation légale)
    const attribution = FONDS[fondActif].attribution;
    ctx.save();
    ctx.font = 'bold 13px system-ui, sans-serif';
    const largeurTexte = ctx.measureText(attribution).width + 16;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(0, canvas.height - 24, largeurTexte, 24);
    ctx.fillStyle = '#111111';
    ctx.textBaseline = 'middle';
    ctx.fillText(attribution, 8, canvas.height - 12);
    ctx.restore();

    canvas.toBlob((blob) => {
      if (blob && surCapture) surCapture(blob);
    }, 'image/jpeg', 0.9);
  }

  /* ==================================================================
     MESSAGES
     ================================================================== */
  function afficherMessage(texte) {
    const m = document.getElementById('carte-message');
    m.textContent = texte;
    m.hidden = false;
  }
  function cacherMessage() {
    document.getElementById('carte-message').hidden = true;
  }

  /* ==================================================================
     BRANCHEMENTS
     ================================================================== */
  function initialiser() {
    canvas.addEventListener('pointerdown', auDebut);
    canvas.addEventListener('pointermove', auDeplacement);
    canvas.addEventListener('pointerup', auFin);
    canvas.addEventListener('pointercancel', auFin);

    document.getElementById('btn-carte-plus').addEventListener('click', () => zoomer(1));
    document.getElementById('btn-carte-moins').addEventListener('click', () => zoomer(-1));

    document.getElementById('btn-carte-chercher').addEventListener('click', chercherAdresse);
    document.getElementById('carte-adresse').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); chercherAdresse(); }
    });
    document.getElementById('btn-carte-gps').addEventListener('click', allerGPS);

    // Choix du fond (plan / satellite)
    document.querySelectorAll('.carte-fond').forEach((bouton) => {
      bouton.addEventListener('click', () => {
        fondActif = bouton.dataset.fond;
        document.querySelectorAll('.carte-fond').forEach((b) =>
          b.classList.toggle('carte-fond--actif', b === bouton));
        // Respecte le zoom max du nouveau fond
        if (zoom > FONDS[fondActif].zoomMax) zoom = FONDS[fondActif].zoomMax;
        dessiner();
      });
    });

    document.getElementById('btn-carte-capturer').addEventListener('click', capturer);
    document.getElementById('btn-fermer-carte').addEventListener('click', () =>
      App.montrerEcran('ecran-plans'));
  }

  return { initialiser, ouvrir };

})();
