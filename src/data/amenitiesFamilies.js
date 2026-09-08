/**
 * @module data/amenitiesFamilies
 *
 * The seven family names of `amenities-fr`, and nothing else.
 *
 * Extracted from `amenitiesFeed.js` for one measured reason: the address
 * radiography prints "Supermarché, supérette" beside a distance, and importing
 * that one string from the feed module pulled its **166 889 bytes** of BPE and
 * FINESS parsing into `fiche.html` — a text page whose own bundle is 21 kB.
 * The labels are a vocabulary; the parsing is a program, and a document should
 * not have to load the second to say the first.
 *
 * `amenitiesFeed.js` re-exports both maps, so every existing importer is
 * untouched and there is still exactly one definition.
 */

export const AMENITY_FAMILY_LABELS = Object.freeze({
  medecin: 'Médecin généraliste',
  courses: 'Supermarché, supérette',
  pharmacie: 'Pharmacie',
  poste: 'La Poste',
  piscine: 'Bassin de natation',
  gendarmerie: 'Gendarmerie, police',
  hopital: 'Hôpital',
});

/** Singular/plural head-word for a card, keyed the same way. */
export const AMENITY_FAMILY_PLURALS = Object.freeze({
  medecin: 'médecins généralistes',
  courses: 'commerces alimentaires',
  pharmacie: 'pharmacies',
  poste: 'points de contact La Poste',
  piscine: 'bassins de natation',
  gendarmerie: 'unités de gendarmerie et de police',
  hopital: 'hôpitaux',
});
