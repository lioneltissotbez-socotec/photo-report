/* ====================================================================
   annotate.js — Éditeur d'annotation sur photo
   --------------------------------------------------------------------
   PRINCIPE CLÉ : les annotations ne sont PAS peintes définitivement sur
   la photo. Elles sont conservées comme une LISTE D'OBJETS (formes),
   par ex. { type:'fleche', x1,y1,x2,y2, couleur, épaisseur… }. À chaque
   image, on efface le canvas, on redessine la photo, puis toutes les
   formes par-dessus. Conséquence : on peut rouvrir la photo plus tard
   et déplacer ou supprimer une forme précise. La photo d'origine reste
   toujours intacte.

   COORDONNÉES : le canvas a la taille réelle de l'image (ex. 1600 px).
   Le CSS le met à l'échelle pour tenir à l'écran. On convertit donc les
   coordonnées du doigt/stylet (écran) vers les coordonnées de l'image,
   pour que les annotations restent correctes quel que soit le zoom.

   DOIGT & STYLET : on utilise les "pointer events" (pointerdown/move/up),
   l'API web unifiée qui traite souris, doigt et stylet de la même façon.
   ==================================================================== */

const Annotate = (() => {

  const canvas = document.getElementById('canvas-annotation');
  const ctx = canvas.getContext('2d');

  let image = null;            // l'image de fond (Image chargée)
  let annotations = [];        // la liste des formes
  let photoCourante = null;    // la photo en cours d'édition
  let surEnregistrement = null; // callback appelé après enregistrement

  // Réglages courants (modifiables via la barre d'outils)
  let outil = 'selection';
  let couleur = '#E53935';
  let epaisseur = 6;
  let styleTrait = 'plein';    // 'plein' ou 'pointille'
  let typePointe = 'triangle'; // 'triangle', 'simple' ou 'double'

  // État du geste en cours
  let enCours = false;
  let formeEnCours = null;     // la forme qu'on est en train de dessiner
  let selection = null;        // la forme sélectionnée (mode sélection)
  let pointDepart = null;      // point de départ du glissement

  // Historique pour annuler/refaire (piles d'états successifs)
  let historique = [];
  let positionHistorique = -1;

  /* ==================================================================
     OUVERTURE DE L'ÉDITEUR
     ================================================================== */
  function ouvrir(photo, callback) {
    photoCourante = photo;
    surEnregistrement = callback;

    // Copie profonde des annotations existantes (pour pouvoir annuler
    // sans toucher aux données tant qu'on n'a pas enregistré)
    annotations = photo.annotations ? JSON.parse(JSON.stringify(photo.annotations)) : [];

    // Réinitialise l'historique avec l'état de départ
    historique = [copie(annotations)];
    positionHistorique = 0;
    selection = null;

    // Charge l'image de fond depuis le Blob stocké
    const url = URL.createObjectURL(photo.image);
    image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      // Le canvas prend la taille réelle de l'image
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      redessiner();
    };
    image.src = url;

    majBarreOutils();
    App.montrerEcran('ecran-annotation');
  }

  /* ==================================================================
     RENDU : efface tout, dessine la photo puis les annotations
     ================================================================== */
  function redessiner() {
    if (!image) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);

    for (const forme of annotations) dessinerForme(forme);
    if (formeEnCours) dessinerForme(formeEnCours);

    // Cadre autour de la forme sélectionnée
    if (selection) dessinerCadreSelection(selection);
  }

  /* Applique les réglages de trait (couleur, épaisseur, pointillé) */
  function appliquerStyle(forme) {
    ctx.strokeStyle = forme.couleur;
    ctx.fillStyle = forme.couleur;
    ctx.lineWidth = forme.epaisseur;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Pointillé : segments proportionnels à l'épaisseur
    ctx.setLineDash(forme.style === 'pointille'
      ? [forme.epaisseur * 2.5, forme.epaisseur * 2] : []);
  }

  /* Dessine une forme selon son type */
  function dessinerForme(f) {
    appliquerStyle(f);

    if (f.type === 'trace') {
      ctx.beginPath();
      f.points.forEach((p, i) =>
        i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.stroke();

    } else if (f.type === 'rectangle') {
      ctx.beginPath();
      ctx.rect(f.x1, f.y1, f.x2 - f.x1, f.y2 - f.y1);
      ctx.stroke();

    } else if (f.type === 'ellipse') {
      const cx = (f.x1 + f.x2) / 2, cy = (f.y1 + f.y2) / 2;
      const rx = Math.abs(f.x2 - f.x1) / 2, ry = Math.abs(f.y2 - f.y1) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();

    } else if (f.type === 'fleche') {
      dessinerFleche(f);

    } else if (f.type === 'texte') {
      ctx.setLineDash([]);
      ctx.font = `bold ${f.taille}px system-ui, sans-serif`;
      ctx.textBaseline = 'top';
      ctx.fillText(f.texte, f.x, f.y);
    }
    ctx.setLineDash([]); // remet à plein pour la suite
  }

  /* Dessine une flèche avec sa pointe */
  function dessinerFleche(f) {
    // Le corps
    ctx.beginPath();
    ctx.moveTo(f.x1, f.y1);
    ctx.lineTo(f.x2, f.y2);
    ctx.stroke();

    // La pointe : calcul de l'angle du trait
    const angle = Math.atan2(f.y2 - f.y1, f.x2 - f.x1);
    const taillePointe = Math.max(15, f.epaisseur * 3.5);
    ctx.setLineDash([]); // la pointe n'est jamais en pointillé

    const dessinerPointe = (x, y, sens) => {
      const a = angle + (sens === 'arriere' ? Math.PI : 0);
      const gx1 = x - taillePointe * Math.cos(a - 0.4);
      const gy1 = y - taillePointe * Math.sin(a - 0.4);
      const gx2 = x - taillePointe * Math.cos(a + 0.4);
      const gy2 = y - taillePointe * Math.sin(a + 0.4);

      if (f.pointe === 'triangle' || f.pointe === 'double') {
        // Pointe pleine (triangle rempli)
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(gx1, gy1);
        ctx.lineTo(gx2, gy2);
        ctx.closePath();
        ctx.fill();
      } else {
        // Pointe simple (deux traits)
        ctx.beginPath();
        ctx.moveTo(gx1, gy1); ctx.lineTo(x, y); ctx.lineTo(gx2, gy2);
        ctx.stroke();
      }
    };

    dessinerPointe(f.x2, f.y2, 'avant');
    if (f.pointe === 'double') dessinerPointe(f.x1, f.y1, 'arriere');
  }

  /* Cadre en pointillés autour de la forme sélectionnée */
  function dessinerCadreSelection(f) {
    const b = boiteEnglobante(f);
    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = '#0B5CAB';
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x - 8, b.y - 8, b.w + 16, b.h + 16);
    ctx.setLineDash([]);
  }

  /* ==================================================================
     CONVERSION des coordonnées écran → coordonnées image
     ================================================================== */
  function pointDepuisEvenement(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  /* ==================================================================
     GESTES : début, déplacement, fin
     ================================================================== */
  function auDebut(e) {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const p = pointDepuisEvenement(e);
    pointDepart = p;
    enCours = true;

    if (outil === 'selection') {
      // On cherche la forme sous le doigt (de la plus récente à la plus ancienne)
      selection = trouverFormeSous(p);
      majBoutonSupprimer();
      redessiner();
      return;
    }

    if (outil === 'texte') {
      // Saisie du texte via une invite simple
      const saisie = prompt('Texte à ajouter :');
      enCours = false;
      if (saisie && saisie.trim()) {
        annotations.push({
          id: crypto.randomUUID(), type: 'texte',
          x: p.x, y: p.y, texte: saisie.trim(),
          couleur, taille: Math.max(24, epaisseur * 6), style: 'plein',
        });
        enregistrerEtape();
        redessiner();
      }
      return;
    }

    // Outils de dessin : on démarre une nouvelle forme
    if (outil === 'trace') {
      formeEnCours = { id: crypto.randomUUID(), type: 'trace',
        points: [p], couleur, epaisseur, style: styleTrait };
    } else {
      formeEnCours = { id: crypto.randomUUID(), type: outil,
        x1: p.x, y1: p.y, x2: p.x, y2: p.y,
        couleur, epaisseur, style: styleTrait,
        pointe: outil === 'fleche' ? typePointe : undefined };
    }
  }

  function auDeplacement(e) {
    if (!enCours) return;
    e.preventDefault();
    const p = pointDepuisEvenement(e);

    if (outil === 'selection') {
      if (selection && pointDepart) {
        // Déplace la forme du delta parcouru
        deplacerForme(selection, p.x - pointDepart.x, p.y - pointDepart.y);
        pointDepart = p;
        redessiner();
      }
      return;
    }

    if (!formeEnCours) return;
    if (formeEnCours.type === 'trace') {
      formeEnCours.points.push(p);
    } else {
      formeEnCours.x2 = p.x;
      formeEnCours.y2 = p.y;
    }
    redessiner();
  }

  function auFin(e) {
    if (!enCours) return;
    enCours = false;

    if (outil === 'selection') {
      // Si on a déplacé une forme, on enregistre l'étape
      if (selection) enregistrerEtape();
      return;
    }

    if (formeEnCours) {
      // On ignore les formes trop petites (clic sans glissement)
      if (formeSignificative(formeEnCours)) {
        annotations.push(formeEnCours);
        enregistrerEtape();
      }
      formeEnCours = null;
      redessiner();
    }
  }

  /* Vraie forme (évite d'ajouter un point isolé par accident) */
  function formeSignificative(f) {
    if (f.type === 'trace') return f.points.length > 2;
    const dx = Math.abs(f.x2 - f.x1), dy = Math.abs(f.y2 - f.y1);
    return (dx + dy) > 10;
  }

  /* ==================================================================
     SÉLECTION & DÉPLACEMENT
     ================================================================== */
  function deplacerForme(f, dx, dy) {
    if (f.type === 'trace') {
      f.points.forEach((p) => { p.x += dx; p.y += dy; });
    } else if (f.type === 'texte') {
      f.x += dx; f.y += dy;
    } else {
      f.x1 += dx; f.y1 += dy; f.x2 += dx; f.y2 += dy;
    }
  }

  /* Cherche la forme la plus proche sous un point (ordre inverse :
     la dernière dessinée est au-dessus) */
  function trouverFormeSous(p) {
    for (let i = annotations.length - 1; i >= 0; i--) {
      if (pointDansForme(annotations[i], p)) return annotations[i];
    }
    return null;
  }

  /* Test de proximité entre un point et une forme */
  function pointDansForme(f, p) {
    const marge = Math.max(12, f.epaisseur || 12);

    if (f.type === 'texte') {
      const largeur = (f.texte.length * f.taille) * 0.55;
      return p.x >= f.x - 8 && p.x <= f.x + largeur
          && p.y >= f.y - 8 && p.y <= f.y + f.taille + 8;
    }
    if (f.type === 'trace') {
      return f.points.some((pt, i) => i > 0
        && distancePointSegment(p, f.points[i - 1], pt) < marge);
    }
    if (f.type === 'fleche') {
      return distancePointSegment(p, { x: f.x1, y: f.y1 }, { x: f.x2, y: f.y2 }) < marge;
    }
    if (f.type === 'rectangle') {
      const b = boiteEnglobante(f);
      const surBord = (p.x > b.x - marge && p.x < b.x + b.w + marge
        && p.y > b.y - marge && p.y < b.y + b.h + marge)
        && !(p.x > b.x + marge && p.x < b.x + b.w - marge
          && p.y > b.y + marge && p.y < b.y + b.h - marge);
      return surBord;
    }
    if (f.type === 'ellipse') {
      const cx = (f.x1 + f.x2) / 2, cy = (f.y1 + f.y2) / 2;
      const rx = Math.abs(f.x2 - f.x1) / 2, ry = Math.abs(f.y2 - f.y1) / 2;
      if (rx < 1 || ry < 1) return false;
      // Distance normalisée : ~1 sur le bord de l'ellipse
      const d = ((p.x - cx) ** 2) / (rx ** 2) + ((p.y - cy) ** 2) / (ry ** 2);
      return d > 0.7 && d < 1.4;
    }
    return false;
  }

  /* Distance d'un point à un segment (pour tracé et flèche) */
  function distancePointSegment(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const long2 = dx * dx + dy * dy;
    if (long2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / long2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  /* Boîte englobante d'une forme (pour le cadre de sélection) */
  function boiteEnglobante(f) {
    if (f.type === 'trace') {
      const xs = f.points.map((p) => p.x), ys = f.points.map((p) => p.y);
      const x = Math.min(...xs), y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
    if (f.type === 'texte') {
      const largeur = (f.texte.length * f.taille) * 0.55;
      return { x: f.x, y: f.y, w: largeur, h: f.taille };
    }
    const x = Math.min(f.x1, f.x2), y = Math.min(f.y1, f.y2);
    return { x, y, w: Math.abs(f.x2 - f.x1), h: Math.abs(f.y2 - f.y1) };
  }

  function supprimerSelection() {
    if (!selection) return;
    annotations = annotations.filter((f) => f !== selection);
    selection = null;
    majBoutonSupprimer();
    enregistrerEtape();
    redessiner();
  }

  /* ==================================================================
     HISTORIQUE (annuler / refaire)
     ================================================================== */
  function copie(liste) { return JSON.parse(JSON.stringify(liste)); }

  function enregistrerEtape() {
    // On tronque tout ce qui était "en avant" (après un annuler)
    historique = historique.slice(0, positionHistorique + 1);
    historique.push(copie(annotations));
    positionHistorique++;
    majBoutonsHistorique();
  }

  function annuler() {
    if (positionHistorique <= 0) return;
    positionHistorique--;
    annotations = copie(historique[positionHistorique]);
    selection = null;
    majBoutonSupprimer();
    majBoutonsHistorique();
    redessiner();
  }

  function refaire() {
    if (positionHistorique >= historique.length - 1) return;
    positionHistorique++;
    annotations = copie(historique[positionHistorique]);
    selection = null;
    majBoutonSupprimer();
    majBoutonsHistorique();
    redessiner();
  }

  /* ==================================================================
     ENREGISTREMENT : sauvegarde les annotations dans la photo
     ================================================================== */
  async function enregistrer() {
    photoCourante.annotations = annotations;

    // On retire le cadre de sélection avant de générer l'aperçu, sinon
    // il serait capturé dans l'image enregistrée.
    selection = null;
    formeEnCours = null;
    redessiner();

    // On régénère la vignette AVEC les annotations, pour que la grille
    // et l'aperçu montrent le résultat. On dessine sur un petit canvas.
    photoCourante.vignette = await genererApercu(320, 0.75);
    photoCourante.apercu = await genererApercu(1600, 0.85);

    await DB.enregistrer('photos', photoCourante);
    if (surEnregistrement) surEnregistrement(photoCourante);
    App.montrerEcran('ecran-photo');
  }

  /* Génère une image (photo + annotations) à la taille voulue */
  function genererApercu(coteMax, qualite) {
    return new Promise((resoudre) => {
      const echelle = Math.min(1, coteMax / Math.max(canvas.width, canvas.height));
      const c = document.createElement('canvas');
      c.width = Math.round(canvas.width * echelle);
      c.height = Math.round(canvas.height * echelle);
      const cx = c.getContext('2d');
      // On réutilise le canvas d'édition (déjà photo + annotations dessinées)
      cx.drawImage(canvas, 0, 0, c.width, c.height);
      c.toBlob(resoudre, 'image/jpeg', qualite);
    });
  }

  /* ==================================================================
     BARRE D'OUTILS : mise à jour de l'apparence + branchements
     ================================================================== */
  function majBarreOutils() {
    document.querySelectorAll('.outil').forEach((b) =>
      b.classList.toggle('outil--actif', b.dataset.outil === outil));
    // Le type de pointe ne concerne que la flèche
    document.getElementById('btn-type-pointe').hidden = (outil !== 'fleche');
  }

  function majBoutonSupprimer() {
    document.getElementById('btn-annot-supprimer').disabled = !selection;
  }

  function majBoutonsHistorique() {
    document.getElementById('btn-annot-undo').disabled = (positionHistorique <= 0);
    document.getElementById('btn-annot-redo').disabled =
      (positionHistorique >= historique.length - 1);
  }

  function initialiser() {
    // --- Événements de dessin (doigt/stylet/souris unifiés) ---
    canvas.addEventListener('pointerdown', auDebut);
    canvas.addEventListener('pointermove', auDeplacement);
    canvas.addEventListener('pointerup', auFin);
    canvas.addEventListener('pointercancel', auFin);

    // --- Sélection d'outil ---
    document.querySelectorAll('.outil[data-outil]').forEach((bouton) => {
      bouton.addEventListener('click', () => {
        outil = bouton.dataset.outil;
        selection = null;
        majBoutonSupprimer();
        majBarreOutils();
        redessiner();
      });
    });

    document.getElementById('btn-annot-supprimer')
      .addEventListener('click', supprimerSelection);

    // --- Couleurs ---
    document.querySelectorAll('.pastille-couleur').forEach((pastille) => {
      pastille.addEventListener('click', () => {
        couleur = pastille.dataset.couleur;
        document.querySelectorAll('.pastille-couleur').forEach((p) =>
          p.classList.toggle('pastille-couleur--active', p === pastille));
        // Applique aussi à la forme sélectionnée
        if (selection) { selection.couleur = couleur; enregistrerEtape(); redessiner(); }
      });
    });

    // --- Épaisseur ---
    document.querySelectorAll('.epaisseur').forEach((bouton) => {
      bouton.addEventListener('click', () => {
        epaisseur = parseInt(bouton.dataset.epaisseur, 10);
        document.querySelectorAll('.epaisseur').forEach((b) =>
          b.classList.toggle('epaisseur--active', b === bouton));
        if (selection) { selection.epaisseur = epaisseur; enregistrerEtape(); redessiner(); }
      });
    });

    // --- Style de trait (plein / pointillé) ---
    document.getElementById('btn-style-trait').addEventListener('click', (e) => {
      styleTrait = (styleTrait === 'plein') ? 'pointille' : 'plein';
      e.currentTarget.textContent = (styleTrait === 'plein') ? '─ Plein' : '┄ Pointillé';
      e.currentTarget.dataset.style = styleTrait;
      if (selection) { selection.style = styleTrait; enregistrerEtape(); redessiner(); }
    });

    // --- Type de pointe de flèche ---
    document.getElementById('btn-type-pointe').addEventListener('click', (e) => {
      // Cycle : triangle (pleine) → simple → double
      typePointe = typePointe === 'triangle' ? 'simple'
        : typePointe === 'simple' ? 'double' : 'triangle';
      const libelles = { triangle: '▶ Pleine', simple: '➤ Simple', double: '↔ Double' };
      e.currentTarget.textContent = libelles[typePointe];
      if (selection && selection.type === 'fleche') {
        selection.pointe = typePointe; enregistrerEtape(); redessiner();
      }
    });

    // --- Historique ---
    document.getElementById('btn-annot-undo').addEventListener('click', annuler);
    document.getElementById('btn-annot-redo').addEventListener('click', refaire);

    // --- Enregistrer / Quitter ---
    document.getElementById('btn-annot-enregistrer').addEventListener('click', enregistrer);
    document.getElementById('btn-annot-annuler-tout').addEventListener('click', () => {
      if (annotations.length === 0
          || confirm('Quitter sans enregistrer les modifications ?')) {
        App.montrerEcran('ecran-photo');
      }
    });
  }

  return { initialiser, ouvrir };

})();
