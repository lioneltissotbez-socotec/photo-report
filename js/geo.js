/* ====================================================================
   geo.js — Géolocalisation et adresse
   --------------------------------------------------------------------
   RÔLE : récupérer la position GPS de l'appareil, et — si internet est
   disponible — la convertir en adresse lisible via OpenStreetMap.

   FONCTIONNEMENT HORS LIGNE : le GPS de l'appareil fonctionne SANS
   réseau, donc on obtient toujours les coordonnées (latitude/longitude).
   En revanche, transformer ces coordonnées en adresse texte
   ("12 rue de la Paix") demande d'interroger un service en ligne
   (Nominatim). Sans connexion, on conserve donc les coordonnées et on
   laisse l'adresse à compléter manuellement.

   SERVICE UTILISÉ : Nominatim (OpenStreetMap), gratuit et sans clé.
   Sa règle d'usage : au plus 1 requête/seconde — largement respecté
   ici puisqu'on l'appelle seulement quand l'opérateur clique.
   ==================================================================== */

const Geo = (() => {

  /* ------------------------------------------------------------------
     OBTENIR LA POSITION GPS
     Renvoie une Promesse qui donne { latitude, longitude, precision }.
     'enableHighAccuracy' demande le GPS le plus précis (utile en
     extérieur) ; 'timeout' évite d'attendre indéfiniment.
     ------------------------------------------------------------------ */
  function obtenirPosition() {
    return new Promise((resoudre, rejeter) => {
      if (!('geolocation' in navigator)) {
        rejeter(new Error("La géolocalisation n'est pas disponible sur cet appareil."));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => resoudre({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          precision: position.coords.accuracy, // en mètres
        }),
        (erreur) => rejeter(erreur),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    });
  }

  /* ------------------------------------------------------------------
     CONVERTIR DES COORDONNÉES EN ADRESSE (géocodage inversé)
     Interroge Nominatim. Peut échouer si hors ligne : dans ce cas
     l'appelant garde simplement les coordonnées.
     ------------------------------------------------------------------ */
  async function adresseDepuisCoordonnees(latitude, longitude) {
    const url = 'https://nominatim.openstreetmap.org/reverse'
      + `?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`;

    const reponse = await fetch(url, {
      headers: {
        // Nominatim exige un identifiant d'application
        'Accept': 'application/json',
      },
    });

    if (!reponse.ok) throw new Error('Service d\'adresse indisponible.');

    const donnees = await reponse.json();
    // 'display_name' est l'adresse complète formatée par Nominatim
    return donnees.display_name || '';
  }

  /* ------------------------------------------------------------------
     FONCTION PRINCIPALE utilisée par le formulaire.
     Renvoie { latitude, longitude, adresse } ; 'adresse' peut être
     vide si on est hors ligne (les coordonnées, elles, sont toujours là).
     ------------------------------------------------------------------ */
  async function localiser() {
    const position = await obtenirPosition();

    let adresse = '';
    if (navigator.onLine) {
      try {
        adresse = await adresseDepuisCoordonnees(position.latitude, position.longitude);
      } catch (erreur) {
        console.warn('Adresse non récupérée (réseau ?) :', erreur);
      }
    }

    return {
      latitude: position.latitude,
      longitude: position.longitude,
      precision: position.precision,
      adresse,
    };
  }

  return { localiser };

})();
