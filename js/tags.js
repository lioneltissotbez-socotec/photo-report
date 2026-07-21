/* ====================================================================
   tags.js — Gestion des tags
   --------------------------------------------------------------------
   DEUX TYPES DE TAGS :
   - "localisation" : propres à chaque dossier (Bâtiment A, Logement 12…)
   - "remarque"     : Amiante, Fissure, Infiltration… Ces remarques ont
     en plus une BIBLIOTHÈQUE COMMUNE partagée entre tous les dossiers,
     stockée dans le magasin 'remarques' (créé dès l'étape 1). Quand
     l'opérateur crée une remarque dans un dossier, on l'ajoute aussi à
     la bibliothèque pour la resuggérer dans les dossiers suivants.

   OÙ SONT STOCKÉS LES TAGS ?
   - La liste des tags d'un dossier est dans dossier.tags (tableau
     d'objets { id, libelle, type }).
   - Les tags COCHÉS sur une photo sont dans photo.tags (tableau d'id).
   ==================================================================== */

const Tags = (() => {

  // Raccourcis HTML (fenêtre de gestion)
  const dialogue = document.getElementById('dialogue-tags');
  const champNouveau = document.getElementById('champ-nouveau-tag');
  const listeDossier = document.getElementById('liste-tags-dossier');
  const zoneSuggestions = document.getElementById('suggestions-remarques');
  const listeSuggestions = document.getElementById('suggestions-liste');

  let dossierCourant = null;   // dossier dont on gère les tags
  let typeActif = 'localisation'; // onglet sélectionné dans la fenêtre
  let surFermeture = null;     // callback appelé quand on ferme (rafraîchit la photo)

  /* ------------------------------------------------------------------
     BIBLIOTHÈQUE COMMUNE DE REMARQUES
     Le magasin 'remarques' contient des objets { id, libelle }.
     ------------------------------------------------------------------ */
  async function chargerBibliotheque() {
    return DB.obtenirTous('remarques');
  }

  async function ajouterABibliotheque(libelle) {
    const existantes = await chargerBibliotheque();
    // Évite les doublons (comparaison insensible à la casse)
    const dejaLa = existantes.some(
      (r) => r.libelle.toLowerCase() === libelle.toLowerCase());
    if (!dejaLa) {
      await DB.enregistrer('remarques', { id: crypto.randomUUID(), libelle });
    }
  }

  /* ------------------------------------------------------------------
     OUVERTURE de la fenêtre de gestion des tags
     ------------------------------------------------------------------ */
  async function ouvrirGestion(dossier, callback) {
    dossierCourant = dossier;
    surFermeture = callback;
    typeActif = 'localisation';
    majOngletActif();
    await afficherListeGestion();
    dialogue.showModal();
    champNouveau.focus();
  }

  /* Bascule d'onglet (Localisation / Remarque) */
  function majOngletActif() {
    dialogue.querySelectorAll('.onglet').forEach((o) => {
      o.classList.toggle('onglet--actif', o.dataset.type === typeActif);
    });
    // Les suggestions de bibliothèque ne concernent que les remarques
    zoneSuggestions.hidden = (typeActif !== 'remarque');
    champNouveau.placeholder = (typeActif === 'localisation')
      ? 'Ex. : Logement 12 – Cuisine' : 'Ex. : Amiante';
  }

  /* ------------------------------------------------------------------
     AFFICHAGE de la liste des tags du dossier (dans la fenêtre)
     ------------------------------------------------------------------ */
  async function afficherListeGestion() {
    // Tags du type actif uniquement
    const tags = (dossierCourant.tags || []).filter((t) => t.type === typeActif);

    listeDossier.innerHTML = '';
    for (const tag of tags) {
      const puce = document.createElement('div');
      puce.className = 'tag-gestion';
      puce.innerHTML = `<span class="tag-gestion__libelle"></span>
                        <button class="tag-gestion__suppr" type="button" aria-label="Supprimer">✕</button>`;
      puce.querySelector('.tag-gestion__libelle').textContent = tag.libelle;
      puce.querySelector('.tag-gestion__suppr')
        .addEventListener('click', () => supprimerTag(tag.id));
      listeDossier.appendChild(puce);
    }

    // Suggestions de la bibliothèque commune (pour les remarques)
    if (typeActif === 'remarque') await afficherSuggestions();
  }

  /* Affiche les remarques de la bibliothèque pas encore dans le dossier */
  async function afficherSuggestions() {
    const bibliotheque = await chargerBibliotheque();
    const dejaDansDossier = (dossierCourant.tags || [])
      .filter((t) => t.type === 'remarque')
      .map((t) => t.libelle.toLowerCase());

    listeSuggestions.innerHTML = '';
    const aProposer = bibliotheque.filter(
      (r) => !dejaDansDossier.includes(r.libelle.toLowerCase()));

    if (aProposer.length === 0) {
      zoneSuggestions.hidden = true;
      return;
    }
    zoneSuggestions.hidden = false;

    for (const remarque of aProposer) {
      const puce = document.createElement('button');
      puce.type = 'button';
      puce.className = 'tag-puce tag-puce--suggestion';
      puce.textContent = '+ ' + remarque.libelle;
      puce.addEventListener('click', () => creerTag(remarque.libelle));
      listeSuggestions.appendChild(puce);
    }
  }

  /* ------------------------------------------------------------------
     CRÉER un tag dans le dossier
     ------------------------------------------------------------------ */
  async function creerTag(libelle) {
    libelle = libelle.trim();
    if (!libelle) return;

    // Évite les doublons dans le dossier (même type, même libellé)
    const existe = (dossierCourant.tags || []).some(
      (t) => t.type === typeActif && t.libelle.toLowerCase() === libelle.toLowerCase());
    if (existe) return;

    if (!dossierCourant.tags) dossierCourant.tags = [];
    dossierCourant.tags.push({
      id: crypto.randomUUID(),
      libelle,
      type: typeActif,
    });

    await DB.enregistrer('dossiers', dossierCourant);

    // Une remarque créée alimente aussi la bibliothèque commune
    if (typeActif === 'remarque') await ajouterABibliotheque(libelle);

    champNouveau.value = '';
    await afficherListeGestion();
  }

  /* SUPPRIMER un tag du dossier (retire aussi ce tag des photos qui
     l'avaient coché, pour ne pas laisser de références mortes) */
  async function supprimerTag(idTag) {
    dossierCourant.tags = (dossierCourant.tags || []).filter((t) => t.id !== idTag);
    await DB.enregistrer('dossiers', dossierCourant);

    const photos = await DB.obtenirParDossier('photos', dossierCourant.id);
    for (const photo of photos) {
      if (photo.tags && photo.tags.includes(idTag)) {
        photo.tags = photo.tags.filter((id) => id !== idTag);
        await DB.enregistrer('photos', photo);
      }
    }
    await afficherListeGestion();
  }

  /* ------------------------------------------------------------------
     AFFICHAGE DES TAGS SUR UNE PHOTO (écran photo)
     Rend les puces cochables. 'photo.tags' contient les id cochés.
     Chaque clic coche/décoche et sauvegarde aussitôt.
     ------------------------------------------------------------------ */
  function afficherTagsPhoto(dossier, photo) {
    const parType = (type, conteneurId) => {
      const conteneur = document.getElementById(conteneurId);
      conteneur.innerHTML = '';

      const tags = (dossier.tags || []).filter((t) => t.type === type);

      if (tags.length === 0) {
        conteneur.innerHTML =
          '<span class="tags-vide">Aucun tag. Touchez « Gérer les tags ».</span>';
        return;
      }

      for (const tag of tags) {
        const coche = photo.tags && photo.tags.includes(tag.id);
        const puce = document.createElement('button');
        puce.type = 'button';
        puce.className = 'tag-puce' + (coche ? ' tag-puce--coche' : '');
        puce.textContent = tag.libelle;
        puce.addEventListener('click', async () => {
          await basculerTagPhoto(photo, tag.id);
          afficherTagsPhoto(dossier, photo); // redessine l'état coché
        });
        conteneur.appendChild(puce);
      }
    };

    parType('localisation', 'tags-localisation');
    parType('remarque', 'tags-remarque');
  }

  /* Coche/décoche un tag sur une photo et enregistre */
  async function basculerTagPhoto(photo, idTag) {
    if (!photo.tags) photo.tags = [];
    if (photo.tags.includes(idTag)) {
      photo.tags = photo.tags.filter((id) => id !== idTag);
    } else {
      photo.tags.push(idTag);
    }
    await DB.enregistrer('photos', photo);
  }

  /* ------------------------------------------------------------------
     BRANCHEMENTS
     ------------------------------------------------------------------ */
  function initialiser() {
    // Onglets de la fenêtre
    dialogue.querySelectorAll('.onglet').forEach((onglet) => {
      onglet.addEventListener('click', async () => {
        typeActif = onglet.dataset.type;
        majOngletActif();
        await afficherListeGestion();
      });
    });

    document.getElementById('btn-ajouter-tag')
      .addEventListener('click', () => creerTag(champNouveau.value));

    // Entrée clavier = ajouter (pratique)
    champNouveau.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); creerTag(champNouveau.value); }
    });

    document.getElementById('btn-fermer-tags')
      .addEventListener('click', () => {
        dialogue.close();
        if (surFermeture) surFermeture(); // rafraîchit l'affichage de la photo
      });
  }

  return { initialiser, ouvrirGestion, afficherTagsPhoto };

})();
