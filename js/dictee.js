/* ====================================================================
   dictee.js — Dictée vocale (reconnaissance vocale du navigateur)
   --------------------------------------------------------------------
   RÔLE : bouton micro qui transcrit la parole dans le champ observation.

   IMPORTANT — DÉPEND D'INTERNET : sur Chrome et Edge, la reconnaissance
   vocale (API SpeechRecognition) envoie l'audio aux serveurs de
   Google/Microsoft. Elle ne fonctionne donc PAS hors ligne. C'est la
   seule fonction de l'app qui nécessite une connexion. Hors ligne,
   l'opérateur peut toujours taper, ou utiliser la dictée native de
   Windows (touche Windows + H) qui, elle, écrit directement dans le
   champ actif.

   On ajoute le texte reconnu À LA SUITE de ce qui est déjà écrit,
   pour ne jamais effacer une saisie existante.
   ==================================================================== */

const Dictee = (() => {

  const champObservation = document.getElementById('champ-observation');
  const bouton = document.getElementById('btn-micro');
  const etat = document.getElementById('micro-etat');

  // L'API porte deux noms selon le navigateur
  const Reconnaissance = window.SpeechRecognition || window.webkitSpeechRecognition;

  let reconnaissance = null;
  let enEcoute = false;

  /* ------------------------------------------------------------------
     DÉMARRER / ARRÊTER l'écoute
     ------------------------------------------------------------------ */
  function demarrer() {
    // Pas d'API ou hors ligne : on prévient et on s'arrête
    if (!Reconnaissance) {
      afficherEtat("La dictée vocale n'est pas disponible sur ce navigateur. Utilisez Windows + H.", 'erreur');
      return;
    }
    if (!navigator.onLine) {
      afficherEtat("La dictée vocale nécessite une connexion internet. Utilisez Windows + H hors ligne.", 'erreur');
      return;
    }

    reconnaissance = new Reconnaissance();
    reconnaissance.lang = 'fr-FR';          // français
    reconnaissance.continuous = true;       // écoute prolongée
    reconnaissance.interimResults = false;  // uniquement le texte finalisé

    reconnaissance.onresult = (evenement) => {
      // Concatène les segments reconnus depuis le dernier événement
      let texte = '';
      for (let i = evenement.resultIndex; i < evenement.results.length; i++) {
        texte += evenement.results[i][0].transcript;
      }
      texte = texte.trim();
      if (!texte) return;

      // Ajoute à la suite du contenu existant (avec un espace propre)
      const actuel = champObservation.value.trim();
      champObservation.value = actuel ? (actuel + ' ' + texte) : texte;

      // Déclenche l'événement 'input' pour que photos.js enregistre
      champObservation.dispatchEvent(new Event('input'));
    };

    reconnaissance.onerror = (evenement) => {
      if (evenement.error === 'not-allowed') {
        afficherEtat("Micro refusé. Autorisez l'accès au microphone.", 'erreur');
      } else {
        afficherEtat("Erreur de dictée : " + evenement.error, 'erreur');
      }
      arreter();
    };

    reconnaissance.onend = () => {
      // La reconnaissance peut se couper seule : on remet le bouton au repos
      if (enEcoute) arreter();
    };

    reconnaissance.start();
    enEcoute = true;
    bouton.classList.add('bloc__micro--actif');
    afficherEtat('🎙️ Écoute en cours… touchez le micro pour arrêter.', 'ok');
  }

  function arreter() {
    if (reconnaissance) {
      try { reconnaissance.stop(); } catch (e) { /* déjà arrêté */ }
      reconnaissance = null;
    }
    enEcoute = false;
    bouton.classList.remove('bloc__micro--actif');
    etat.hidden = true;
  }

  function afficherEtat(message, genre) {
    etat.hidden = false;
    etat.textContent = message;
    etat.className = 'micro-etat micro-etat--' + genre;
  }

  /* ------------------------------------------------------------------
     BRANCHEMENTS
     ------------------------------------------------------------------ */
  function initialiser() {
    if (bouton) {
      bouton.addEventListener('click', () => {
        if (enEcoute) arreter(); else demarrer();
      });
    }
  }

  // 'arreter' est exposé pour couper le micro si on quitte l'écran photo
  return { initialiser, arreter };

})();
