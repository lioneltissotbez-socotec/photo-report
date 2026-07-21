/* ====================================================================
   predefinis.js — Listes de tags prédéfinis (suggestions usuelles)
   --------------------------------------------------------------------
   RÔLE : fournir des suggestions prêtes à l'emploi pour le diagnostic
   immobilier. L'opérateur touche celles qu'il veut pour les ajouter au
   dossier ; il peut toujours en créer d'autres à la main.

   POUR MODIFIER CES LISTES : il suffit d'ajouter ou retirer une ligne
   ci-dessous. Aucune autre modification n'est nécessaire ailleurs.
   ==================================================================== */

const Predefinis = {

  // Suggestions de LOCALISATION (où la photo a été prise)
  localisation: [
    // Extérieur / abords
    'Façade', 'Toiture', 'Combles', 'Sous-sol', 'Cave', 'Garage',
    'Cour', 'Jardin', 'Terrasse', 'Balcon',
    // Parties communes
    "Hall d'entrée", 'Cage d\'escalier', 'Palier', 'Couloir', 'Ascenseur',
    'Local technique', 'Local poubelles', 'Local vélos', 'Chaufferie', 'Parking',
    // Circulation / accès
    'Entrée', 'Dégagement',
    // Pièces d'un logement
    'Séjour', 'Salon', 'Cuisine', 'Chambre', 'Salle de bains', "Salle d'eau",
    'WC', 'Buanderie', 'Cellier', 'Placard',
  ],

  // Suggestions de REMARQUE (nature de l'observation)
  remarque: [
    // Diagnostics réglementaires
    'Amiante', 'Plomb', 'Termites', 'Gaz', 'Électricité', 'DPE', 'Mérule', 'Radon',
    // Constats / observations terrain
    'Sondage', 'Prélèvement', 'Défaut', 'Fissure', 'Infiltration', 'Humidité',
    'Moisissure', 'Corrosion', 'Vétusté', 'Non-conformité',
    // Repérage
    'Point de sondage', 'Zone à risque', 'Matériau suspect',
    'Accès impossible', 'Non vérifiable',
  ],

};
