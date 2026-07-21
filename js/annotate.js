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

  /* ---- Zoom / déplacement de la vue ----
     La vue est positionnée par une transformation CSS appliquée au canvas :
       translate(vueX, vueY) puis scale(vueEchelle), origine en haut-gauche.
     Le canvas garde sa résolution réelle (taille de l'image) ; seule son
     apparence à l'écran change. La conversion doigt→image continue de
     fonctionner car getBoundingClientRect reflète cette transformation. */
  let vueEchelle = 1;   // 1 = image ajustée à la zone
  let vueX = 0;         // décalage horizontal à l'écran (px)
  let vueY = 0;         // décalage vertical à l'écran (px)
  let ajustEchelle = 1; // échelle d'ajustement de base (image → zone)
  let ajustL = 0, ajustH = 0; // dimensions ajustées de base

  // Suivi des doigts/pointeurs actifs (pour distinguer 1 doigt = dessin,
  // 2 doigts = navigation pincer/déplacer)
  const pointeurs = new Map();
  let pincementDepart = null; // état au début d'un geste à deux doigts
  let espaceEnfonce = false;  // touche Espace maintenue (déplacement souris)

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
    pointeurs.clear();
    pincementDepart = null;
    masquerLoupe();

    // Charge l'image de fond depuis le Blob stocké
    const url = URL.createObjectURL(photo.image);
    image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      // Le canvas prend la taille réelle de l'image
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      reinitialiserVue();   // ajuste et centre l'image dans la zone
      redessiner();
    };
    image.src = url;

    majBarreOutils();
    App.montrerEcran('ecran-annotation');
  }

  /* ==================================================================
     VUE : ajustement, centrage, zoom, déplacement
     ================================================================== */

  /* Calcule l'échelle d'ajustement (image → zone) et centre l'image */
  function reinitialiserVue() {
    const zone = document.querySelector('.zone-dessin');
    const rz = zone.getBoundingClientRect();

    // Échelle pour que l'image entière tienne dans la zone
    ajustEchelle = Math.min(rz.width / canvas.width, rz.height / canvas.height);
    ajustL = canvas.width * ajustEchelle;
    ajustH = canvas.height * ajustEchelle;

    vueEchelle = 1;
    // Centre l'image dans la zone
    vueX = (rz.width - ajustL) / 2;
    vueY = (rz.height - ajustH) / 2;
    appliquerVue();
  }

  /* Applique la transformation CSS au canvas.
     Taille affichée = ajustL × vueEchelle (idem hauteur). */
  function appliquerVue() {
    // Largeur/hauteur CSS de base (avant zoom) : l'image ajustée
    canvas.style.width = ajustL + 'px';
    canvas.style.height = ajustH + 'px';
    canvas.style.transformOrigin = '0 0';
    canvas.style.transform =
      `translate(${vueX}px, ${vueY}px) scale(${vueEchelle})`;
  }

  /* Zoom autour d'un point d'ancrage (en pixels écran relatifs à la zone),
     pour que ce point reste immobile pendant le zoom. */
  function zoomerVue(facteur, ancreX, ancreY) {
    const nouvelleEchelle = Math.max(1, Math.min(8, vueEchelle * facteur));
    const ratio = nouvelleEchelle / vueEchelle;
    // Ajuste le décalage pour garder le point d'ancrage fixe
    vueX = ancreX - (ancreX - vueX) * ratio;
    vueY = ancreY - (ancreY - vueY) * ratio;
    vueEchelle = nouvelleEchelle;
    contraindreVue();
    appliquerVue();
  }

  /* Empêche de trop faire glisser l'image hors de la zone */
  function contraindreVue() {
    const zone = document.querySelector('.zone-dessin');
    const rz = zone.getBoundingClientRect();
    const largeurAff = ajustL * vueEchelle;
    const hauteurAff = ajustH * vueEchelle;

    // Marge autorisée : au moins un quart de la zone reste couvert
    if (largeurAff <= rz.width) {
      vueX = (rz.width - largeurAff) / 2; // recentre si plus petit que la zone
    } else {
      vueX = Math.min(0, Math.max(rz.width - largeurAff, vueX));
    }
    if (hauteurAff <= rz.height) {
      vueY = (rz.height - hauteurAff) / 2;
    } else {
      vueY = Math.min(0, Math.max(rz.height - hauteurAff, vueY));
    }
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

  /* Vrai seulement si le point est à l'intérieur de l'image. Empêche de
     créer une annotation en touchant en dehors (marges, barre d'outils). */
  function pointDansImage(p) {
    return p.x >= 0 && p.x <= canvas.width && p.y >= 0 && p.y <= canvas.height;
  }

  /* Point d'un événement en coordonnées ÉCRAN relatives à la zone */
  function pointEcran(e) {
    const zone = document.querySelector('.zone-dessin').getBoundingClientRect();
    return { x: e.clientX - zone.left, y: e.clientY - zone.top };
  }

  /* ==================================================================
     GESTES : début, déplacement, fin
     Un doigt = dessin (ou déplacement de forme). Deux doigts = navigation
     (pincer pour zoomer + glisser pour déplacer). Sur souris : Espace
     maintenu = déplacement.
     ================================================================== */
  function auDebut(e) {
    // Enregistre ce pointeur (pour compter les doigts)
    pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });

    // Deux doigts → on démarre/rafraîchit le geste de navigation
    if (pointeurs.size === 2) {
      demarrerPincement();
      annulerFormeEnCours();
      return;
    }
    if (pointeurs.size > 2) return;

    // Souris + Espace → déplacement de la vue (pas de dessin)
    if (espaceEnfonce && e.pointerType === 'mouse') {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      pointDepart = pointEcran(e);
      enCours = 'pan';
      return;
    }

    const p = pointDepuisEvenement(e);
    // Ignore tout geste qui commence en dehors de l'image
    if (!pointDansImage(p)) { enCours = false; return; }

    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    pointDepart = p;
    enCours = true;

    if (outil === 'selection') {
      const dejaSelectionne = selection;
      selection = trouverFormeSous(p);
      majBoutonSupprimer();
      // Si on retouche un TEXTE déjà sélectionné → on le modifie
      if (selection && selection.type === 'texte' && selection === dejaSelectionne) {
        enCours = false;
        ouvrirSaisieTexte(null, selection);
        return;
      }
      redessiner();
      return;
    }

    // L'outil texte agit au relâchement (auFin)
    if (outil === 'texte') { majLoupe(e, p); return; }

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
    majLoupe(e, p);
  }

  function auDeplacement(e) {
    // Met à jour la position mémorisée de ce pointeur
    if (pointeurs.has(e.pointerId)) {
      const info = pointeurs.get(e.pointerId);
      info.x = e.clientX; info.y = e.clientY;
    }

    // Navigation à deux doigts
    if (pointeurs.size === 2) { majPincement(); return; }

    if (!enCours) return;
    e.preventDefault();

    // Déplacement de la vue (souris + Espace)
    if (enCours === 'pan') {
      const pe = pointEcran(e);
      vueX += pe.x - pointDepart.x;
      vueY += pe.y - pointDepart.y;
      pointDepart = pe;
      contraindreVue();
      appliquerVue();
      return;
    }

    const p = pointDepuisEvenement(e);

    if (outil === 'selection') {
      if (selection && pointDepart) {
        deplacerForme(selection, p.x - pointDepart.x, p.y - pointDepart.y);
        pointDepart = p;
        redessiner();
      }
      return;
    }

    if (outil === 'texte') { majLoupe(e, p); return; }

    if (!formeEnCours) return;
    if (formeEnCours.type === 'trace') {
      formeEnCours.points.push(p);
    } else {
      formeEnCours.x2 = p.x;
      formeEnCours.y2 = p.y;
    }
    redessiner();
    majLoupe(e, p);
  }

  function auFin(e) {
    pointeurs.delete(e.pointerId);
    // Fin d'un geste à deux doigts
    if (pointeurs.size < 2) pincementDepart = null;

    if (!enCours) { masquerLoupe(); return; }
    const etait = enCours;
    enCours = false;
    masquerLoupe();

    if (etait === 'pan') return;

    if (outil === 'selection') {
      if (selection) enregistrerEtape();
      return;
    }

    // Outil texte : ouvre la fenêtre de saisie (au lieu de prompt, peu
    // fiable sur mobile). Le texte est créé à la validation.
    if (outil === 'texte') {
      const p = pointDepart;
      if (!p || !pointDansImage(p)) return;
      ouvrirSaisieTexte(p);
      return;
    }

    if (formeEnCours) {
      if (formeSignificative(formeEnCours)) {
        annotations.push(formeEnCours);
        enregistrerEtape();
      }
      formeEnCours = null;
      redessiner();
    }
  }

  function annulerFormeEnCours() {
    // Quand on passe à deux doigts, on abandonne un éventuel tracé commencé
    formeEnCours = null;
    enCours = false;
    masquerLoupe();
    redessiner();
  }

  /* ---- Navigation à deux doigts (pincer + déplacer) ---- */
  function deuxPoints() {
    const pts = [...pointeurs.values()];
    return pts.slice(0, 2);
  }
  function demarrerPincement() {
    const [a, b] = deuxPoints();
    const zone = document.querySelector('.zone-dessin').getBoundingClientRect();
    pincementDepart = {
      distance: Math.hypot(a.x - b.x, a.y - b.y),
      centreX: (a.x + b.x) / 2 - zone.left,
      centreY: (a.y + b.y) / 2 - zone.top,
      echelle: vueEchelle,
    };
  }
  function majPincement() {
    if (!pincementDepart) { demarrerPincement(); return; }
    const [a, b] = deuxPoints();
    const zone = document.querySelector('.zone-dessin').getBoundingClientRect();
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    const centreX = (a.x + b.x) / 2 - zone.left;
    const centreY = (a.y + b.y) / 2 - zone.top;

    // Zoom relatif au pincement de départ, autour du centre des deux doigts
    const facteur = distance / pincementDepart.distance;
    const cible = Math.max(1, Math.min(8, pincementDepart.echelle * facteur));
    const ratio = cible / vueEchelle;
    vueX = centreX - (centreX - vueX) * ratio;
    vueY = centreY - (centreY - vueY) * ratio;
    vueEchelle = cible;

    // Déplacement (glissement des deux doigts)
    vueX += centreX - pincementDepart.centreX;
    vueY += centreY - pincementDepart.centreY;
    pincementDepart.centreX = centreX;
    pincementDepart.centreY = centreY;
    pincementDepart.distance = distance;
    pincementDepart.echelle = vueEchelle;

    contraindreVue();
    appliquerVue();
  }

  /* ==================================================================
     LOUPE DÉPORTÉE : montre la zone sous le doigt, agrandie, avec un
     réticule. N'apparaît qu'au doigt ou au stylet (pas à la souris,
     qui ne cache rien). Se place dans le coin opposé au doigt.
     ================================================================== */
  const loupe = document.getElementById('loupe');
  const loupeCtx = loupe ? loupe.getContext('2d') : null;
  const LOUPE_TAILLE = 140;      // taille affichée de la loupe (px)
  const LOUPE_SOURCE = 90;       // portion d'image copiée (px image) → agrandissement

  function majLoupe(e, pImage) {
    // Uniquement au doigt/stylet
    if (!loupe || (e.pointerType !== 'touch' && e.pointerType !== 'pen')) return;

    loupe.hidden = false;
    loupeCtx.clearRect(0, 0, LOUPE_TAILLE, LOUPE_TAILLE);
    loupeCtx.save();

    // Copie une portion du canvas (photo + annotations en cours) centrée
    // sur le point visé, agrandie dans la loupe.
    const sx = pImage.x - LOUPE_SOURCE / 2;
    const sy = pImage.y - LOUPE_SOURCE / 2;
    // Fond blanc au cas où on déborde de l'image
    loupeCtx.fillStyle = '#FFFFFF';
    loupeCtx.fillRect(0, 0, LOUPE_TAILLE, LOUPE_TAILLE);
    loupeCtx.drawImage(canvas, sx, sy, LOUPE_SOURCE, LOUPE_SOURCE,
      0, 0, LOUPE_TAILLE, LOUPE_TAILLE);

    // Réticule de visée au centre
    loupeCtx.strokeStyle = 'rgba(192,57,43,0.9)';
    loupeCtx.lineWidth = 1.5;
    loupeCtx.beginPath();
    loupeCtx.moveTo(LOUPE_TAILLE / 2, LOUPE_TAILLE / 2 - 12);
    loupeCtx.lineTo(LOUPE_TAILLE / 2, LOUPE_TAILLE / 2 + 12);
    loupeCtx.moveTo(LOUPE_TAILLE / 2 - 12, LOUPE_TAILLE / 2);
    loupeCtx.lineTo(LOUPE_TAILLE / 2 + 12, LOUPE_TAILLE / 2);
    loupeCtx.stroke();
    loupeCtx.restore();

    // Place la loupe dans le coin opposé au doigt (pour ne pas être cachée)
    const zone = document.querySelector('.zone-dessin').getBoundingClientRect();
    const doigtX = e.clientX - zone.left;
    const aGauche = doigtX < zone.width / 2;
    loupe.style.left = aGauche ? 'auto' : '12px';
    loupe.style.right = aGauche ? '12px' : 'auto';
  }

  function masquerLoupe() {
    if (loupe) loupe.hidden = true;
  }

  /* Vrai si l'écran d'annotation est actuellement affiché */
  function estEcranAnnotationVisible() {
    return document.getElementById('ecran-annotation').classList.contains('ecran--visible');
  }

  /* ==================================================================
     SAISIE DE TEXTE (fenêtre dédiée, fiable sur mobile)
     Sert à créer un nouveau texte (on passe un point) ou à modifier un
     texte existant (on passe la forme à éditer).
     ================================================================== */
  let texteEnCours = null;   // { point } pour création, ou { forme } pour édition

  function ouvrirSaisieTexte(point, formeExistante) {
    texteEnCours = { point, forme: formeExistante || null };
    const champ = document.getElementById('champ-texte-annot');
    champ.value = formeExistante ? formeExistante.texte : '';
    document.getElementById('dialogue-texte').showModal();
    // Petit délai avant focus : laisse le temps au dialogue de s'afficher
    setTimeout(() => champ.focus(), 50);
  }

  function validerSaisieTexte() {
    const champ = document.getElementById('champ-texte-annot');
    const valeur = champ.value.trim();
    document.getElementById('dialogue-texte').close();

    if (!valeur) { texteEnCours = null; return; }

    if (texteEnCours.forme) {
      // Modification d'un texte existant
      texteEnCours.forme.texte = valeur;
    } else {
      // Création d'un nouveau texte
      const p = texteEnCours.point;
      annotations.push({
        id: crypto.randomUUID(), type: 'texte',
        x: p.x, y: p.y, texte: valeur,
        couleur, taille: Math.max(24, epaisseur * 6), style: 'plein',
      });
    }
    texteEnCours = null;
    enregistrerEtape();
    redessiner();
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

    // --- Fenêtre de saisie de texte ---
    document.getElementById('btn-texte-valider')
      .addEventListener('click', validerSaisieTexte);
    document.getElementById('btn-texte-annuler')
      .addEventListener('click', () => {
        document.getElementById('dialogue-texte').close();
        texteEnCours = null;
      });
    document.getElementById('champ-texte-annot')
      .addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); validerSaisieTexte(); }
      });

    // --- Zoom : boutons +/− et réinitialisation ---
    const zone = () => document.querySelector('.zone-dessin').getBoundingClientRect();
    document.getElementById('btn-zoom-plus').addEventListener('click', () => {
      const z = zone(); zoomerVue(1.4, z.width / 2, z.height / 2);
    });
    document.getElementById('btn-zoom-moins').addEventListener('click', () => {
      const z = zone(); zoomerVue(1 / 1.4, z.width / 2, z.height / 2);
    });
    document.getElementById('btn-zoom-reset').addEventListener('click', reinitialiserVue);

    // --- Zoom à la molette (souris) ---
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const z = document.querySelector('.zone-dessin').getBoundingClientRect();
      zoomerVue(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - z.left, e.clientY - z.top);
    }, { passive: false });

    // --- Touche Espace maintenue = déplacement à la souris ---
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && estEcranAnnotationVisible()) {
        espaceEnfonce = true;
        canvas.style.cursor = 'grab';
        e.preventDefault();
      }
    });
    document.addEventListener('keyup', (e) => {
      if (e.code === 'Space') { espaceEnfonce = false; canvas.style.cursor = ''; }
    });

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

    // --- Épaisseur (= taille de police pour un texte sélectionné) ---
    document.querySelectorAll('.epaisseur').forEach((bouton) => {
      bouton.addEventListener('click', () => {
        epaisseur = parseInt(bouton.dataset.epaisseur, 10);
        document.querySelectorAll('.epaisseur').forEach((b) =>
          b.classList.toggle('epaisseur--active', b === bouton));
        if (selection) {
          if (selection.type === 'texte') {
            // Pour un texte, l'épaisseur choisie définit la taille de police
            selection.taille = Math.max(24, epaisseur * 6);
          } else {
            selection.epaisseur = epaisseur;
          }
          enregistrerEtape();
          redessiner();
        }
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
