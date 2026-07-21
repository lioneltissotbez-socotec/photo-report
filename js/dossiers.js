/* ====================================================================
   dossiers.js — Écran d'accueil : gestion des dossiers
   --------------------------------------------------------------------
   RÔLE : afficher la liste des dossiers, en créer, en supprimer,
   et ouvrir l'écran d'un dossier. Ce fichier ne parle jamais
   directement à IndexedDB : il passe par DB.* (défini dans db.js).
   ==================================================================== */

const Dossiers = (() => {

  // Raccourcis vers les éléments HTML manipulés par cet écran
  const liste = document.getElementById('liste-dossiers');
  const etatVide = document.getElementById('etat-vide');
  const dialogueNouveau = document.getElementById('dialogue-nouveau-dossier');
  const formulaire = document.getElementById('formulaire-dossier');
  const dialogueSupprimer = document.getElementById('dialogue-supprimer');

  // Mémorise l'id du dossier en attente de suppression (le temps que
  // l'utilisateur confirme ou annule dans la fenêtre de confirmation)
  let idASupprimer = null;

  /* ------------------------------------------------------------------
     AFFICHAGE : reconstruit la liste des dossiers à l'écran.
     Appelée au démarrage et après chaque création/suppression.
     ------------------------------------------------------------------ */
  async function afficherListe() {
    const dossiers = await DB.obtenirTous('dossiers');

    // Tri : le dossier modifié le plus récemment en premier
    dossiers.sort((a, b) => b.dateModification - a.dateModification);

    liste.innerHTML = '';
    etatVide.hidden = dossiers.length > 0;

    for (const dossier of dossiers) {
      // Nombre de photos du dossier (0 pour l'instant, utile dès l'étape 2)
      const photos = await DB.obtenirParDossier('photos', dossier.id);

      const carte = document.createElement('li');
      carte.className = 'dossier-carte';

      // Détail affiché sous le nom : référence et/ou adresse si renseignées
      const details = [dossier.reference, dossier.adresse]
        .filter(Boolean).join(' · ');
      const dateTexte = new Date(dossier.dateCreation)
        .toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

      carte.innerHTML = `
        <div class="dossier-carte__infos">
          <div class="dossier-carte__nom"></div>
          <div class="dossier-carte__detail"></div>
        </div>
        <span class="dossier-carte__compteur">${photos.length} photo${photos.length > 1 ? 's' : ''}</span>
        <button class="dossier-carte__supprimer" type="button" aria-label="Supprimer le dossier">🗑</button>
      `;

      // On remplit le nom et le détail via textContent (et non innerHTML) :
      // ainsi, un nom contenant des caractères spéciaux ne casse rien
      carte.querySelector('.dossier-carte__nom').textContent = dossier.nom;
      carte.querySelector('.dossier-carte__detail').textContent =
        details ? `${details} — créé le ${dateTexte}` : `Créé le ${dateTexte}`;

      // Clic sur la carte → ouvre le dossier
      carte.addEventListener('click', () => ouvrirDossier(dossier.id));

      // Clic sur la corbeille → demande confirmation
      // stopPropagation : empêche le clic de "remonter" à la carte,
      // sinon le dossier s'ouvrirait en même temps
      carte.querySelector('.dossier-carte__supprimer')
        .addEventListener('click', (evenement) => {
          evenement.stopPropagation();
          demanderSuppression(dossier.id);
        });

      liste.appendChild(carte);
    }
  }

  /* ------------------------------------------------------------------
     CRÉATION : validation du formulaire "Nouveau dossier"
     ------------------------------------------------------------------ */
  async function creerDossier(evenement) {
    evenement.preventDefault(); // empêche le rechargement de la page

    const maintenant = Date.now();
    const dossier = {
      // crypto.randomUUID() génère un identifiant unique, ex :
      // "b3e1c9d0-...". Fiable même hors ligne, contrairement à un
      // compteur qui pourrait entrer en conflit lors d'un futur export.
      id: crypto.randomUUID(),
      nom: document.getElementById('champ-nom').value.trim(),
      reference: document.getElementById('champ-reference').value.trim(),
      adresse: document.getElementById('champ-adresse').value.trim(),
      // Tags du dossier : rempli à l'étape 3.
      // Chaque tag aura la forme { id, libelle, type: 'localisation' | 'remarque' }
      tags: [],
      dateCreation: maintenant,
      dateModification: maintenant,
    };

    await DB.enregistrer('dossiers', dossier);

    formulaire.reset();
    dialogueNouveau.close();
    await afficherListe();
  }

  /* ------------------------------------------------------------------
     SUPPRESSION : en deux temps (demande → confirmation)
     ------------------------------------------------------------------ */
  function demanderSuppression(id) {
    idASupprimer = id;
    dialogueSupprimer.showModal();
  }

  async function confirmerSuppression() {
    if (idASupprimer) {
      await DB.supprimerDossierComplet(idASupprimer);
      idASupprimer = null;
    }
    dialogueSupprimer.close();
    await afficherListe();
  }

  /* ------------------------------------------------------------------
     OUVERTURE : bascule sur l'écran du dossier
     (le contenu réel arrivera à l'étape 2)
     ------------------------------------------------------------------ */
  async function ouvrirDossier(id) {
    const dossier = await DB.obtenir('dossiers', id);
    if (!dossier) return;

    document.getElementById('dossier-titre').textContent = dossier.nom;
    document.getElementById('dossier-infos').textContent =
      [dossier.reference, dossier.adresse].filter(Boolean).join(' · ');

    // Photos.ouvrir charge la grille de vignettes puis affiche l'écran
    await Photos.ouvrir(dossier);
  }

  /* ------------------------------------------------------------------
     BRANCHEMENTS : relie les boutons aux fonctions ci-dessus.
     Appelé une seule fois au démarrage par app.js.
     ------------------------------------------------------------------ */
  function initialiser() {
    document.getElementById('btn-nouveau-dossier')
      .addEventListener('click', () => {
        dialogueNouveau.showModal();
        document.getElementById('champ-nom').focus();
      });

    document.getElementById('btn-annuler-dossier')
      .addEventListener('click', () => { formulaire.reset(); dialogueNouveau.close(); });

    formulaire.addEventListener('submit', creerDossier);

    document.getElementById('btn-annuler-suppression')
      .addEventListener('click', () => { idASupprimer = null; dialogueSupprimer.close(); });

    document.getElementById('btn-confirmer-suppression')
      .addEventListener('click', confirmerSuppression);

    document.getElementById('btn-retour-accueil')
      .addEventListener('click', async () => {
        App.montrerEcran('ecran-accueil');
        await afficherListe(); // rafraîchit les compteurs au retour
      });
  }

  // Fonctions accessibles depuis les autres fichiers
  return { initialiser, afficherListe };

})();
