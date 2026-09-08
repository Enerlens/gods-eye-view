/**
 * Le barème national — comment une valeur mesurée à une adresse devient un rang
 * et, parfois seulement, une lettre.
 *
 * ── POURQUOI CE MODULE EXISTE ───────────────────────────────────────────────
 * La fiche implantation sait déjà dire « 4 210 habitants, niveau de vie moyen
 * 22 400 €/an, 1,04 km² atteignables à pied en dix minutes ». Un lecteur qui
 * découvre ces trois nombres n'a aucun moyen de savoir si c'est beaucoup. Le
 * produit que Cityscan vend n'est pas la mesure, c'est la POSITION de la mesure
 * dans le pays — la note sur 100 et la lettre A→E. Ce module est la position.
 *
 * ── CE QUE COÛTE UNE LETTRE, ET POURQUOI ELLE N'ÉTAIT PAS GRATUITE ──────────
 * Dire « A » suppose de connaître la distribution nationale de l'indicateur.
 * Il n'existe aucune source publiée pour « la surface atteignable à pied en dix
 * minutes depuis chez les Français » : cette distribution n'existe que si on la
 * MESURE. `scripts/build-bareme-fr.mjs` la mesure, sur un échantillon national
 * de résidents tiré au sort proportionnellement à la population, en faisant
 * tourner sur chacun exactement la composition que la fiche fait sur l'adresse
 * du lecteur. Les échelles ci-dessous sortent de là et de nulle part ailleurs.
 *
 * ── LE PIÈGE QUE CE MODULE EXISTE POUR REFUSER ──────────────────────────────
 * `filosofiFeed.js` porte déjà `FILOSOFI_RAMPS`, des quantiles nationaux des
 * mêmes indicateurs. Les réutiliser ici aurait été gratuit et FAUX : ce sont
 * les quantiles d'un CARREAU de 200 m, et la fiche calcule une moyenne pondérée
 * sur les ~30 carreaux d'un anneau de dix minutes. Moyenner trente carreaux
 * écrase les deux queues — c'est le même argument que `build-filosofi-ramp.mjs`
 * oppose aux déciles individuels de l'INSEE, un cran plus haut. Noter une
 * valeur d'anneau contre une échelle de carreau donne une lettre plausible et
 * fausse, et rien à l'écran ne le dirait. D'où `geometry` sur chaque échelle et
 * sur chaque appel : une géométrie qui ne correspond pas ne produit pas une
 * lettre, elle produit un refus nommé. L'écart mesuré entre les deux échelles
 * est reporté dans `BAREME_SAMPLE.ecartCarreau`.
 *
 * ── POURQUOI SI PEU D'INDICATEURS PORTENT UNE LETTRE ────────────────────────
 * Une lettre est un JUGEMENT : elle exige de savoir dans quel sens l'indicateur
 * est « bon ». Pour la surface atteignable à pied, personne ne conteste le sens.
 * Pour la part de logement social, la part de propriétaires, l'âge des
 * habitants ou le prix au m², le sens dépend entièrement de qui demande — un
 * prix élevé est une bonne nouvelle pour un vendeur et une mauvaise pour un
 * acheteur. Cityscan tranche quand même et ne dit pas au nom de qui. Ici, un
 * indicateur sans sens défendable porte `direction: null` : il reçoit son rang
 * national, jamais de lettre. Ajouter une lettre plus tard est une décision à
 * écrire dans `direction`, pas une machine à construire.
 *
 * ── LA LETTRE EST ELLE-MÊME UNE FOURCHETTE ──────────────────────────────────
 * Un centile lu sur un échantillon de quelques centaines de tirages porte une
 * erreur d'échantillonnage d'environ trois points au milieu de la distribution.
 * Une valeur qui tombe à 61 % n'est donc pas « B » plutôt que « C », c'est
 * « B ou C ». `scoreIndicator()` renvoie la fourchette et un drapeau `ferme` ;
 * la carte n'imprime une lettre nue que lorsqu'elle est ferme. C'est le même
 * geste que la fourchette de population de `implantationFeed.js`, appliqué au
 * rang plutôt qu'au comptage.
 *
 * Pur, sans dépendance et sans effet de bord.
 *
 * @module data/baremeNational
 */

/**
 * Les quantiles auxquels chaque échelle est relevée.
 *
 * Onze points plutôt que les cinq de `FILOSOFI_RAMPS`, parce qu'une échelle de
 * couleur a six bandes à border et qu'un rang a cent positions à interpoler :
 * entre p50 et p90 une échelle à cinq points impose une droite sur quarante
 * centiles, et le rang rendu au lecteur serait celui de la droite, pas celui du
 * pays. Bornée à p05/p95 et pas à p01/p99 : sur quelques centaines de tirages,
 * le centième point de la queue repose sur trois observations et ne mesure que
 * le tirage.
 */
export const BAREME_LADDER_Q = Object.freeze([
  0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95,
]);

/**
 * Les géométries de mesure, et pourquoi c'en est une clé de jointure.
 *
 * Deux nombres portant la même unité et le même nom ne sont comparables que
 * s'ils ont été mesurés sur la même forme. « 22 400 €/an » relevé sur un carreau
 * de 200 m et « 22 400 €/an » moyenné sur un anneau de dix minutes sont deux
 * mesures différentes ; les comparer est la panne silencieuse que ce module
 * rend impossible. La géométrie voyage donc avec l'échelle ET avec l'appel.
 */
export const BAREME_GEOMETRIES = Object.freeze({
  /** Anneau piéton de 600 s, isochrone IGN — la forme que la fiche dessine. */
  RING_FOOT_600: 'ring-foot-600',
  /** Disque de 300 m — le rayon que la couche DVF balaie. */
  DISC_300: 'disc-300',
  /** Carreau INSEE de 200 m — la géométrie de `FILOSOFI_RAMPS`, pas la nôtre. */
  CARREAU_200: 'carreau-200',
});

/**
 * Les bornes des lettres, en note sur 100.
 *
 * Des quintiles, et rien de plus savant : A est le meilleur cinquième de
 * France, E le pire. C'est la convention que Cityscan a empruntée au DPE, et
 * elle a le mérite d'être vérifiable — un lecteur peut demander « combien de
 * Français sont en A » et la réponse est « un sur cinq, par construction ».
 * Une découpe non uniforme (A = les 10 % du haut) est défendable aussi, mais
 * elle doit alors être affichée, sinon la lettre ment sur sa propre rareté.
 */
export const BAREME_LETTER_FLOORS = Object.freeze([
  Object.freeze({ letter: 'A', floor: 80 }),
  Object.freeze({ letter: 'B', floor: 60 }),
  Object.freeze({ letter: 'C', floor: 40 }),
  Object.freeze({ letter: 'D', floor: 20 }),
  Object.freeze({ letter: 'E', floor: 0 }),
]);

/**
 * Les motifs de refus, nommés.
 *
 * Un refus nommé est la moitié du produit : « pas d'échelle pour cet
 * indicateur » et « échelle mesurée sur une autre forme » sont deux phrases
 * différentes, et un lecteur mérite la seconde plutôt qu'un tiret.
 *
 * SORTIR DE L'ÉCHELLE N'EST PAS UN REFUS et n'a donc pas de motif ici. Une
 * valeur au-dessus du plus haut point mesuré est parfaitement notable — elle
 * est même la plus facile à noter — elle est seulement connue par un côté, ce
 * que `beyond` dit à part.
 */
export const BAREME_REASONS = Object.freeze({
  NO_REFERENCE: 'aucune échelle nationale pour cet indicateur',
  GEOMETRY: 'échelle mesurée sur une autre géométrie',
  NOT_A_NUMBER: 'aucune valeur à situer',
  NO_DIRECTION: 'pas de sens défendable — rang seulement, sans lettre',
});

/**
 * Ce que la fiche sait situer, et au nom de qui.
 *
 * La table des CHOIX, séparée de la table des MESURES (`BAREME_FR`) juste en
 * dessous. Le script de mesure ne réécrit que la seconde ; le sens d'un
 * indicateur est une décision éditoriale et se relit dans un diff.
 *
 * `direction` :
 *   `'up'`   — plus il y en a, mieux c'est, du point de vue nommé ;
 *   `'down'` — moins il y en a, mieux c'est ;
 *   `null`   — aucun sens défendable : rang national, jamais de lettre.
 */
export const BAREME_INDICATORS = Object.freeze([
  Object.freeze({
    id: 'acces',
    short: 'accès à pied',
    label: 'Surface atteignable à pied',
    unit: 'km² en 10 min',
    geometry: BAREME_GEOMETRIES.RING_FOOT_600,
    direction: 'up',
    round: 0.01,
    // Le seul indicateur de cette liste dont le sens ne se discute pas. Plus de
    // sol atteignable en dix minutes de marche, c'est plus de tout ce qui est
    // dessus, pour n'importe quel lecteur. C'est aussi une mesure de la trame
    // viaire — une impasse pavillonnaire et un centre-bourg à la même densité
    // ne donnent pas la même surface.
    directionNote: 'Sens non contesté : plus de sol accessible à pied est plus '
      + 'd’accès, pour tout lecteur.',
  }),
  Object.freeze({
    id: 'niveau',
    short: 'niveau de vie',
    label: 'Niveau de vie du voisinage',
    unit: '€/an par personne',
    geometry: BAREME_GEOMETRIES.RING_FOOT_600,
    direction: 'up',
    round: 100,
    // LE CHOIX CONTESTABLE DE CE MODULE, écrit ici plutôt que sous-entendu.
    // C'est la convention d'une radiographie d'adresse vendue à quelqu'un qui
    // achète pour habiter, et c'est le proxy que le marché lui-même utilise.
    // Un opérateur social, un commerce discount ou un bailleur la retourneraient
    // — et auraient raison. La carte nomme donc le point de vue à côté de la
    // lettre au lieu de la présenter comme une propriété du lieu.
    directionNote: 'Point de vue du résident acheteur, et lui seul. Un bailleur '
      + 'social ou une enseigne discount liraient l’échelle à l’envers.',
  }),
  Object.freeze({
    id: 'pauvrete',
    short: 'pauvreté',
    label: 'Ménages sous le seuil de pauvreté',
    unit: '% des ménages',
    geometry: BAREME_GEOMETRIES.RING_FOOT_600,
    direction: 'down',
    round: 0.1,
    directionNote: 'Même point de vue, et donc même réserve, que le niveau de vie.',
  }),
  Object.freeze({
    id: 'habitants',
    short: 'habitants',
    label: 'Habitants dans l’anneau',
    unit: 'habitants',
    geometry: BAREME_GEOMETRIES.RING_FOOT_600,
    direction: null,
    round: 10,
    directionNote: 'La densité est une préférence, pas une qualité : elle est '
      + 'la clientèle d’un commerce et le bruit d’un riverain.',
  }),
  Object.freeze({
    id: 'menages',
    short: 'ménages',
    label: 'Ménages dans l’anneau',
    unit: 'ménages',
    geometry: BAREME_GEOMETRIES.RING_FOOT_600,
    direction: null,
    round: 10,
    directionNote: 'Même raison que les habitants : un nombre de ménages est '
      + 'une clientèle ou une pression, selon qui lit.',
  }),
  Object.freeze({
    id: 'social',
    short: 'logement social',
    label: 'Logement social',
    unit: '% des ménages',
    geometry: BAREME_GEOMETRIES.RING_FOOT_600,
    direction: null,
    round: 0.1,
    // Refuser la lettre ici est un choix et non un oubli. Une part de logement
    // social est le résultat d'une politique publique ; la noter revient à
    // noter la politique, et une note E accolée à un quartier d'habitat social
    // est exactement l'usage que ce module ne veut pas rendre facile.
    directionNote: 'Résultat d’une politique publique, pas une qualité du lieu — '
      + 'rang seulement.',
  }),
  Object.freeze({
    id: 'jeunes',
    short: 'moins de 18 ans',
    label: 'Moins de 18 ans',
    unit: '% des habitants',
    geometry: BAREME_GEOMETRIES.RING_FOOT_600,
    direction: null,
    round: 0.1,
    directionNote: 'La part d’enfants décrit qui habite là, pas si le lieu est '
      + 'bon : elle est une école pleine et une cour bruyante à la fois.',
  }),
  Object.freeze({
    id: 'aines',
    short: '65 ans et plus',
    label: '65 ans et plus',
    unit: '% des habitants',
    geometry: BAREME_GEOMETRIES.RING_FOOT_600,
    direction: null,
    round: 0.1,
    directionNote: 'La part d’aînés décrit qui habite là. Elle est du calme pour '
      + 'les uns et un marché qui se retire pour les autres.',
  }),
  Object.freeze({
    id: 'solo',
    short: 'personnes seules',
    label: 'Personnes seules',
    unit: '% des ménages',
    geometry: BAREME_GEOMETRIES.RING_FOOT_600,
    direction: null,
    round: 0.1,
    directionNote: 'Vivre seul n’est ni bien ni mal ; c’est une structure de '
      + 'ménages, et elle se lit différemment selon ce qu’on vient y faire.',
  }),
  Object.freeze({
    id: 'proprietaires',
    short: 'propriétaires',
    label: 'Propriétaires',
    unit: '% des ménages',
    geometry: BAREME_GEOMETRIES.RING_FOOT_600,
    direction: null,
    round: 0.1,
    directionNote: 'La part de propriétaires est une stabilité pour un riverain '
      + 'et un marché fermé pour un agent. Rang seulement.',
  }),
  Object.freeze({
    id: 'prixM2',
    short: 'prix au m²',
    label: 'Prix médian au m²',
    unit: '€/m²',
    geometry: BAREME_GEOMETRIES.DISC_300,
    direction: null,
    round: 10,
    // Le cas d'école du sens qui dépend du lecteur, et la raison pour laquelle
    // `direction` existe : un prix élevé est une bonne nouvelle pour celui qui
    // vend et une mauvaise pour celui qui achète. Le rang répond aux deux.
    directionNote: 'Bonne nouvelle pour un vendeur, mauvaise pour un acheteur — '
      + 'la même mesure, deux lectures.',
  }),
]);

/** @type {Object<string, object>} */
const INDICATOR_BY_ID = Object.freeze(Object.fromEntries(
  BAREME_INDICATORS.map((indicator) => [indicator.id, indicator]),
));

/** La déclaration d'un indicateur, ou null. */
export function resolveIndicator(id) {
  return INDICATOR_BY_ID[String(id ?? '').trim()] || null;
}

/**
 * LES ÉCHELLES MESURÉES. Réécrites par `npm run bareme:fr` ; tout le reste de
 * ce fichier est un choix, ce bloc est une mesure.
 *
 * Onze valeurs par indicateur : p05, p10, p20, p30, p40, p50, p60, p70, p80,
 * p90, p95 de la distribution CHEZ LES RÉSIDENTS FRANÇAIS — « 30 % des Français
 * ont moins que ça », pas « 30 % des communes ». C'est le tirage qui porte la
 * pondération, pas le calcul.
 *
 * `measured` est le nombre d'anneaux qui ont pu répondre, et il n'égale pas
 * toujours `BAREME_SAMPLE.rings` : 151 anneaux sur 1 200 n'avaient aucune vente
 * comparable dans leurs 300 m, et l'échelle du prix décrit donc une France plus
 * urbaine que la France. La carte le dit quand elle s'en sert.
 */
export const BAREME_FR = Object.freeze({
  acces: Object.freeze({ geometry: 'ring-foot-600', measured: 1200,
    ladder: Object.freeze([0.32, 0.38, 0.46, 0.53, 0.59, 0.65, 0.69, 0.75, 0.82, 0.9, 0.95]) }),
  niveau: Object.freeze({ geometry: 'ring-foot-600', measured: 1200,
    ladder: Object.freeze([15_700, 17_200, 18_900, 19_800, 20_800, 21_600, 22_500, 23_600,
      25_200, 28_100, 31_100]) }),
  pauvrete: Object.freeze({ geometry: 'ring-foot-600', measured: 1200,
    ladder: Object.freeze([4.3, 5.5, 7.3, 9.2, 11, 12.7, 14.8, 17.2, 21.2, 26.8, 33.5]) }),
  habitants: Object.freeze({ geometry: 'ring-foot-600', measured: 1200,
    ladder: Object.freeze([50, 90, 250, 490, 800, 1290, 2050, 3200, 5150, 9340, 15_520]) }),
  menages: Object.freeze({ geometry: 'ring-foot-600', measured: 1200,
    ladder: Object.freeze([20, 40, 100, 200, 340, 570, 880, 1400, 2210, 4090, 6970]) }),
  social: Object.freeze({ geometry: 'ring-foot-600', measured: 1200,
    ladder: Object.freeze([0, 0, 0, 1.2, 5.1, 9.4, 14.2, 21.7, 31.8, 46.6, 60.9]) }),
  jeunes: Object.freeze({ geometry: 'ring-foot-600', measured: 1200,
    ladder: Object.freeze([14, 16.1, 18.1, 19.6, 21.1, 22.1, 23.5, 24.8, 26.4, 29.1, 31.2]) }),
  aines: Object.freeze({ geometry: 'ring-foot-600', measured: 1200,
    ladder: Object.freeze([8.7, 10.4, 13, 14.6, 16.1, 17.9, 19.4, 21.2, 23.4, 28.2, 32.5]) }),
  solo: Object.freeze({ geometry: 'ring-foot-600', measured: 1200,
    ladder: Object.freeze([15.8, 18.4, 22, 25.3, 28.6, 31.9, 34.8, 38.8, 42.9, 49.1, 52.7]) }),
  proprietaires: Object.freeze({ geometry: 'ring-foot-600', measured: 1200,
    ladder: Object.freeze([22.5, 30.1, 37.9, 44.7, 51.3, 60.4, 67.4, 74.1, 80.2, 86.5, 90.5]) }),
  prixM2: Object.freeze({ geometry: 'disc-300', measured: 1049,
    ladder: Object.freeze([970, 1280, 1660, 1940, 2230, 2530, 2930, 3400, 3960, 5280, 7350]) }),
});

/**
 * La campagne : ce qu'elle a coûté, ce qu'elle couvre et ce qu'elle vaut.
 *
 * `marginPt` est la demi-largeur de l'erreur d'échantillonnage au milieu de la
 * distribution, `2·√(0,25/n)` en points de centile. Elle est publiée ici parce
 * que la carte l'imprime : un rang sans son incertitude invite à lire un 61ᵉ
 * centile comme un fait et non comme une estimation.
 *
 * `refusals` est vide, et c'est une information : les 1 200 tirages ont tous
 * reçu un anneau, un carroyage complet et une population non nulle. La première
 * campagne, elle, avait refusé seize fois de suite sur La Réunion — voir le
 * commentaire du CRS dans `implantationFeed.js`.
 */
export const BAREME_SAMPLE = Object.freeze({
  measuredAt: '2026-09-08',
  rings: 1200,
  drawn: 1200,
  marginPt: 2.9,
  frameCells: 377_234,
  framePeople: 64_089_848,
  frameBuiltAt: '2026-09-08',
  seconds: 600,
  dvfRadiusM: 300,
  seed: 20260908,
  refusals: Object.freeze({}),
  /**
   * Les mêmes indicateurs mesurés AU CARREAU de 200 m, sur le même échantillon.
   *
   * Publié parce que c'est la preuve chiffrée que ce module ne pouvait pas
   * emprunter `FILOSOFI_RAMPS`. L'intervalle interdécile d'un anneau vaut
   * **74 % de celui d'un carreau** en moyenne sur les sept indicateurs
   * communs — moyenner une trentaine de carreaux rentre les deux queues. La
   * conséquence n'est pas académique : noté sur l'échelle de carreau, un
   * anneau assis au 10ᵉ centile national remonte au 22ᵉ et un anneau au 90ᵉ
   * redescend au 84ᵉ. C'est une bande de lettre entière aux deux extrémités,
   * et rien à l'écran ne l'aurait dit.
   */
  ecartCarreau: Object.freeze({
    interdecileRatio: 0.74,
    p10ReadAt: 22,
    p50ReadAt: 53,
    p90ReadAt: 84,
    carreau: Object.freeze({
      niveau: Object.freeze([14_400, 16_000, 18_200, 19_600, 20_900, 21_900, 22_900, 24_300,
        26_200, 29_400, 32_900]),
      pauvrete: Object.freeze([0, 2.2, 5, 7.1, 9.3, 11.7, 14.3, 17.6, 22.4, 30.4, 37.6]),
      social: Object.freeze([0, 0, 0, 0, 0, 0, 0, 10.8, 31.8, 67.3, 91.5]),
      jeunes: Object.freeze([10, 13.2, 15.8, 18, 19.8, 21.6, 23.5, 25.6, 28.4, 32.3, 35.4]),
      aines: Object.freeze([4.6, 6.9, 10, 12.9, 15.3, 17.7, 20, 22.5, 26.2, 32.1, 40]),
      solo: Object.freeze([7.3, 12.3, 17.9, 22, 26.5, 30.7, 34.7, 39.3, 44.4, 51.7, 57.1]),
      proprietaires: Object.freeze([5.6, 16.9, 32.3, 44.6, 57.1, 66.7, 75.9, 82.8, 88, 93.3,
        96.8]),
    }),
  }),
});

/**
 * La lettre d'une note sur 100.
 * @param {number} note
 * @returns {string|null}
 */
export function letterFor(note) {
  if (!Number.isFinite(note)) return null;
  const clamped = Math.max(0, Math.min(100, note));
  for (const band of BAREME_LETTER_FLOORS) {
    if (clamped >= band.floor) return band.letter;
  }
  return BAREME_LETTER_FLOORS.at(-1).letter;
}

/**
 * Où une valeur tombe dans une échelle, en fourchette de quantiles.
 *
 * TROIS CAS, ET LE DEUXIÈME EST CELUI QUI COMPTE.
 *
 *   i.   la valeur tombe strictement entre deux points de l'échelle : on
 *        interpole, et la fourchette est un point ;
 *   ii.  la valeur ÉGALE un ou plusieurs points de l'échelle. C'est le cas des
 *        indicateurs à plancher — la part de logement social vaut 0 sur tout le
 *        bas de la distribution — et il n'a pas de réponse ponctuelle : 0 % est
 *        « quelque part dans le premier tiers », pas « au 14ᵉ centile ».
 *        Interpoler ici invente une précision que la donnée refuse, et c'est la
 *        façon la plus facile de mentir avec une échelle ;
 *   iii. la valeur sort par le bas ou par le haut : la fourchette est ouverte
 *        jusqu'à la borne, et `beyond` dit de quel côté.
 *
 * @param {number} value
 * @param {number[]} ladder Valeurs, croissantes, une par entrée de `BAREME_LADDER_Q`.
 * @param {number[]} [quantiles]
 * @returns {{low: number, high: number, beyond: ('below'|'above'|null)}|null}
 *   `low`/`high` en fraction 0..1.
 */
export function ladderBracket(value, ladder, quantiles = BAREME_LADDER_Q) {
  if (!Number.isFinite(value)) return null;
  if (!Array.isArray(ladder) || ladder.length !== quantiles.length) return null;
  const points = ladder.map((v, i) => ({ v: Number(v), q: quantiles[i] }))
    .filter((p) => Number.isFinite(p.v));
  if (!points.length) return null;

  if (value < points[0].v) return { low: 0, high: points[0].q, beyond: 'below' };
  const last = points.at(-1);
  if (value > last.v) return { low: last.q, high: 1, beyond: 'above' };

  let lowIndex = -1;
  for (let i = 0; i < points.length; i += 1) {
    if (points[i].v < value) lowIndex = i; else break;
  }
  let highIndex = points.length;
  for (let i = points.length - 1; i >= 0; i -= 1) {
    if (points[i].v > value) highIndex = i; else break;
  }
  // Une égalité exacte avec au moins un point laisse un trou entre `lowIndex`
  // et `highIndex` : c'est le palier, et il est rendu tel quel.
  if (highIndex - lowIndex > 1) {
    return {
      low: lowIndex < 0 ? 0 : points[lowIndex].q,
      high: highIndex >= points.length ? 1 : points[highIndex].q,
      beyond: null,
    };
  }
  const a = points[lowIndex];
  const b = points[lowIndex + 1];
  const span = b.v - a.v;
  const q = span > 0 ? a.q + ((value - a.v) / span) * (b.q - a.q) : a.q;
  return { low: q, high: q, beyond: null };
}

/**
 * L'erreur d'échantillonnage d'un centile, en points.
 *
 * L'écart-type de la proportion, `sqrt(p(1-p)/n)`, parce que le centile d'une
 * valeur EST une proportion : la part de l'échantillon en dessous d'elle. Deux
 * écarts-types de chaque côté, soit environ 95 %. Sur les 1 200 tirages de la
 * campagne, cela fait ±2,9 points au milieu de la distribution et ±1,3 aux
 * extrêmes — de quoi rendre une lettre incertaine dès qu'une valeur approche
 * une borne de quintile, ce que la carte doit dire plutôt que trancher.
 *
 * @param {number} q Fraction 0..1.
 * @param {number} n Taille de l'échantillon.
 * @returns {number} Demi-largeur, en points de centile.
 */
export function percentileMarginPt(q, n) {
  if (!Number.isFinite(q) || !Number.isFinite(n) || n <= 0) return 0;
  const p = Math.max(0, Math.min(1, q));
  return 2 * Math.sqrt((p * (1 - p)) / n) * 100;
}

/**
 * Situer une valeur dans le pays.
 *
 * Renvoie TOUJOURS un objet, jamais null et jamais d'exception : un indicateur
 * qu'on n'a pas su situer est une ligne de carte qui dit pourquoi, pas une
 * ligne absente. `reason` est le refus ; `beyond` n'en est pas un — une valeur
 * au-dessus du plus haut point mesuré est parfaitement notable, elle est juste
 * connue par un côté seulement.
 *
 * @param {string} id
 * @param {number|null} value
 * @param {{geometry?: string, bareme?: object, sampleSize?: number}} [options]
 *   `geometry` est la forme sur laquelle l'APPELANT a mesuré. Elle est comparée
 *   à celle de l'échelle, et l'absence de comparaison est le bug que ce
 *   paramètre existe pour rendre impossible.
 * @returns {object}
 */
export function scoreIndicator(id, value, options = {}) {
  const {
    geometry = null,
    bareme = BAREME_FR,
    sampleSize = BAREME_SAMPLE.rings,
  } = options;
  const indicator = resolveIndicator(id);
  const base = {
    id: String(id ?? ''),
    label: indicator?.label ?? null,
    short: indicator?.short ?? null,
    unit: indicator?.unit ?? null,
    value: Number.isFinite(value) ? value : null,
    geometry: indicator?.geometry ?? null,
    direction: indicator?.direction ?? null,
    directionNote: indicator?.directionNote ?? null,
    percentile: null,
    percentileLow: null,
    percentileHigh: null,
    note: null,
    letter: null,
    letterLow: null,
    letterHigh: null,
    ferme: false,
    beyond: null,
    reason: null,
  };
  const scale = bareme?.[base.id] ?? null;
  if (!indicator || !scale || !Array.isArray(scale.ladder)) {
    return { ...base, reason: BAREME_REASONS.NO_REFERENCE };
  }
  if (!Number.isFinite(value)) return { ...base, reason: BAREME_REASONS.NOT_A_NUMBER };
  // LA COMPARAISON QUI JUSTIFIE TOUT LE MODULE. Un appelant qui ne dit pas sur
  // quelle forme il a mesuré ne reçoit pas de rang : le silence n'est pas un
  // accord, c'est l'absence de la seule vérification qui compte.
  if (geometry !== indicator.geometry) {
    return { ...base, reason: BAREME_REASONS.GEOMETRY };
  }

  const bracket = ladderBracket(value, scale.ladder);
  if (!bracket) return { ...base, reason: BAREME_REASONS.NO_REFERENCE };

  const margin = percentileMarginPt((bracket.low + bracket.high) / 2, sampleSize);
  const low = Math.max(0, bracket.low * 100 - margin);
  const high = Math.min(100, bracket.high * 100 + margin);
  const mid = (low + high) / 2;
  // Le sens retourne la note, jamais le centile : le centile reste la position
  // dans le pays — « 30 % des Français ont moins » veut dire la même chose pour
  // un taux de pauvreté que pour un revenu — et la note seule porte le jugement.
  const orient = (p) => (indicator.direction === 'down' ? 100 - p : p);
  const noteLow = indicator.direction ? Math.min(orient(low), orient(high)) : null;
  const noteHigh = indicator.direction ? Math.max(orient(low), orient(high)) : null;
  const letterLow = indicator.direction ? letterFor(noteLow) : null;
  const letterHigh = indicator.direction ? letterFor(noteHigh) : null;

  return {
    ...base,
    percentile: Math.round(mid),
    percentileLow: Math.round(low),
    percentileHigh: Math.round(high),
    note: indicator.direction ? Math.round(orient(mid)) : null,
    // La lettre nue n'existe que si les deux bouts de la fourchette tombent
    // dans la même bande. Sinon la carte imprime « B ou C », et c'est la vérité.
    letter: letterLow && letterLow === letterHigh ? letterLow : null,
    letterLow,
    letterHigh,
    ferme: Boolean(letterLow) && letterLow === letterHigh,
    beyond: bracket.beyond,
    reason: indicator.direction
      ? null
      : BAREME_REASONS.NO_DIRECTION,
  };
}
