/**
 * @module fraicheurTrees
 *
 * The 219 432 trees of Paris, and the one regime that can honestly draw them.
 *
 * `les-arbres` is the other half of `fraicheur-fr`: the green-space register in
 * `fraicheurFeed.js` measures how much canopy each park has, and this file is
 * the canopy itself, tree by tree, with the species, the height, the girth, the
 * development stage and the 183 the city calls remarkable.
 *
 * ── The regime, and why it is a bbox query and not a mesh ──────────────────
 *
 * The obvious move is `geoMeshThinning.js`, which every other big French point
 * set in this repo uses. It is the wrong tool here and the measurement says so
 * plainly. Thinning selects a representative per grid cell **from rows the
 * client already holds**, and the client can never hold these: measured
 * 2026-09-01 through the portal's own `exports/geojson`, the whole file is
 * **18 611 450 B gzipped on the wire, 111 448 515 B decoded, 39.7 s**. Moving
 * the thinning into the proxy does not help — it would mean buying 111 MB on
 * every cold cache to publish six hundred dots. And the dots would say nothing:
 * one representative per cell across a city 105 km² wide is a picture of "Paris
 * has trees", which is not a finding.
 *
 * So the viewport asks, and it asks in the right order. `in_bbox(geo_point_2d,
 * S,W,N,E)` works on `records` AND on `exports/geojson`, and `exports/*` is
 * subject to NEITHER of the two caps that make `records` useless here — 100 rows
 * per page (`limit=101` → HTTP 400) and 10 000 rows of paging in total
 * (`limit=100&offset=9999` → HTTP 400, *"Invalid value for sum of offset + limit
 * API parameter: 10099 was found but <= 10000 is expected."*). Measured on a
 * 0.02° × 0.03° central box: 5 287 trees, **231 618 B on the wire, 1 690 170 B
 * decoded, 0.65 s**; projected by this module and re-served, **119 302 B
 * gzipped** — the register publishes 16 decimal places of longitude, and five
 * of them survive the projection.
 *
 * ── The probe is the gate, and it costs 55 bytes ───────────────────────────
 *
 * Before the download there is a question worth asking: how many trees are
 * actually in this box? `records?where=in_bbox(…)&limit=0&select=count(*) as n`
 * answers it in **55 bytes and 0.16 s**, measured. That is the difference
 * between this layer and its neighbour: `cadastre-fr` has to buy an Api Carto
 * answer to discover it was truncated, and this one knows the price before it
 * pays. Over budget, nothing is fetched and the true count is printed.
 *
 * ── Where the budget comes from ────────────────────────────────────────────
 *
 * Every number in this chain was measured, and they chain:
 *   • the client asks for at most {@link FRAICHEUR_TREE_MAX_BOX_DEG} = 0.016°
 *     around the focus point, which is ~1.78 km of latitude and ~1.17 km of
 *     longitude at 48.86° N;
 *   • `snapBoxOutward` at a 0.002° cache grid moves each edge out by up to one
 *     step, so what reaches the portal is at most 0.020° on either axis;
 *   • the densest GRID-ALIGNED 0.020° × 0.020° window anywhere in the register
 *     holds **10 571 trees** — every aligned 10 × 10-cell window scored over
 *     all 219 432 published coordinates, downloaded whole through
 *     `exports/json?select=geo_point_2d` (15 737 120 B decoded), not sampled.
 *     It is 48.816,2.346 → 48.836,2.366, the 13e around the Parc de Choisy, and
 *     the live count probe on that exact box answers 10 571 to the tree. The
 *     proxy's own ceiling of {@link FRAICHEUR_TREE_REQUEST_MAX_BOX_DEG} = 0.022°
 *     admits an 11 × 11 window, whose worst case is **12 269**;
 *   • so {@link FRAICHEUR_TREE_BUDGET} is 12 500, just above the widest box the
 *     PROXY will accept rather than above the widest the client will ask for.
 *     A budget set on the client ceiling would have been 10 000 and would have
 *     refused the 13e — the one arrondissement with the most trees in it.
 *     Worst-case payload at the budget: about 282 KB gzipped, from the 22.57 B
 *     per tree measured on the 5 287-tree central box (1 071 812 B of JSON,
 *     119 316 B gzipped).
 *
 * For scale, the same probe over the whole city (48.815,2.25 → 48.905,2.42)
 * returns 183 025, and a 0.06° × 0.11° box measured **4 512 069 B on the wire /
 * 31 397 297 B decoded in 8.5 s**. That is the box this gate exists to refuse.
 *
 * ── What the drawing is careful about ──────────────────────────────────────
 *
 * • **`hauteurenm = 0` is "not measured", encoded as a number.** It is on
 *   19 407 of the 219 432 trees, and `circonferenceencm = 0` on 16 250 — the
 *   same trees, almost exactly: **16 123 carry both zeros**, so only 3 284 have
 *   a height without a girth and 127 the reverse. A layer that scaled a dot by
 *   height would draw 19 407 seedlings where the register meant silence. Here
 *   they get their own colour and the minimum size, and the legend says how
 *   many.
 * • **The top of the scale is 25 m, not 65 m.** The tallest tree published is
 *   65 m and there are exactly two over 40 m; the 99th percentile of the
 *   200 025 measured heights is 25 m and the median is 9 m. A ceiling at the
 *   maximum would spend the whole visible range on two dots.
 * • **`stadedeveloppement` contains a corrupt value and it is not rare.**
 *   `"Jeune (arbre)Adulte"` — two states concatenated upstream — is on **41 526
 *   trees, 18.9% of the register**, and it is on the very first row of the
 *   central bbox (idbase 216091). It is NOT silently mapped to either state; it
 *   gets its own label that says the register is broken here.
 * • **`remarquable` is three-state text.** `"NON"` 205 726, null 13 523,
 *   `"OUI"` 183. The null is not "no", and the 183 are the only trees the city
 *   itself singles out, so they are the one thing this layer draws bigger than
 *   the data alone would justify.
 * • **43 194 of these trees are not in a Paris arrondissement.** The
 *   `arrondissement` column has 25 values and five of them are not `PARIS NNE
 *   ARRDT`: SEINE-SAINT-DENIS 12 138, BOIS DE VINCENNES 11 755, VAL-DE-MARNE
 *   7 600, BOIS DE BOULOGNE 6 394, HAUTS-DE-SEINE 5 307. The two bois ARE Paris;
 *   the other three are the city's cemeteries beyond the périphérique. A "trees
 *   in Paris" count that trusts this column is wrong by 11%.
 * • **Half of Paris's trees are in the street.** `domanialite = "Alignement"`
 *   on **110 157 of 219 432, 50.20%** — against 56 427 in a garden and 31 982 in
 *   a cemetery. The shade this city actually has is mostly on the pavement, and
 *   the pavement is not on anybody's heatwave list.
 *
 * Dependency-free and side-effect-free (no Cesium, no DOM) so it runs
 * identically in the browser, in the Vite dev-server proxy, and under
 * `node --test`.
 */

import { finiteOrNull, text, FRAICHEUR_DECIMALS, readPoint } from './fraicheurFeed.js';

/** The register. 219 432 rows, ODbL, Direction des Espaces Verts et de l'Environnement. */
export const FRAICHEUR_TREE_DATASET = 'les-arbres';

/** Human-facing provenance for the tree half. */
export const FRAICHEUR_TREE_SOURCE = 'Les arbres — Ville de Paris, Direction des Espaces Verts '
  + 'et de l’Environnement (opendata.paris.fr)';

/**
 * Columns pulled from the register — 9 of its 16.
 *
 * `geo_point_2d` is deliberately NOT in the list: `exports/geojson` emits the
 * geometry either way and naming the field ships the coordinates twice.
 * `adresse` is left out for a measured reason rather than a taste one — on the
 * 5 287-tree central box it costs **57 602 B of wire, 24.9% of the response**,
 * for a line a map answers by being a map. `idemplacement`, `complementadresse`
 * and `varieteoucultivar` are internal keys and a cultivar name no card reads.
 */
export const FRAICHEUR_TREE_FIELDS = Object.freeze([
  'idbase', 'libellefrancais', 'genre', 'espece', 'hauteurenm',
  'circonferenceencm', 'stadedeveloppement', 'remarquable', 'domanialite',
]);

/**
 * Widest viewport that gets trees, in degrees on either axis. See the header
 * for the chain that fixes it at 0.016°.
 */
export const FRAICHEUR_TREE_MAX_BOX_DEG = 0.016;

/** Cache grid the request box is snapped onto. 0.002° ≈ 220 m of latitude. */
export const FRAICHEUR_TREE_BOX_STEP_DEG = 0.002;

/**
 * The ceiling the PROXY accepts, deliberately wider than the one the client
 * asks for.
 *
 * `snapBoxOutward` moves each edge outward by up to a full grid step, so a box
 * already at the client ceiling arrives up to TWO steps wider; a third step
 * covers the floating-point noise of comparing two six-decimal edges against an
 * exact bound. The cadastre layer paid for this margin with a 400 at 400 m and
 * 800 m over Paris, and there is no reason to pay for it twice.
 */
export const FRAICHEUR_TREE_REQUEST_MAX_BOX_DEG = FRAICHEUR_TREE_MAX_BOX_DEG
  + 3 * FRAICHEUR_TREE_BOX_STEP_DEG;

/**
 * Camera altitude above which trees are not asked for, in metres.
 *
 * The gate is ALTITUDE and not the view rectangle's span, and the distinction
 * is not this layer's discovery: `cadastreFeed.js` measured it in this app on
 * 2026-09-01 and the numbers are a fact about this globe's camera rather than
 * about either dataset — at 240 m over Paris the view rectangle is 0.0038° of
 * longitude looking straight down and 0.0397° at a 25° pitch, a tenfold spread
 * at one altitude, because a tilted camera can see the horizon. This globe
 * defaults to an oblique view, so a span gate refuses the layer in the street.
 *
 * 1 500 m is the altitude at which that same measurement puts a nadir view at
 * 0.0157° of longitude — which is {@link FRAICHEUR_TREE_MAX_BOX_DEG} to within
 * a rounding. Below it the drawn tree window is most of what is on screen
 * rather than a patch in the middle of it.
 */
export const FRAICHEUR_TREE_MAX_ALTITUDE_M = 1500;

/**
 * Trees the layer will draw for one box.
 *
 * Above the worst case the PROXY can be asked for, not above the worst case the
 * client asks for. See the header: the densest grid-aligned 0.020° window in
 * the register holds 10 571 trees and the densest 0.022° one holds 12 269, both
 * scored over all 219 432 published coordinates and the first of them confirmed
 * against the portal's own count probe. A budget under 12 269 turns the refusal
 * path from a guard into the normal experience of the 13e.
 */
export const FRAICHEUR_TREE_BUDGET = 12_500;

/**
 * Where the scale tops out, in metres.
 *
 * 25 m is the 99th percentile of the 200 025 published heights above zero
 * (median 9 m, p75 14, p90 18, p95 20). 1 074 trees are taller, 80 are over
 * 30 m and exactly two are over 40 m; the tallest is 65 m. Square-rooted below,
 * because the eye reads area.
 */
export const FRAICHEUR_TREE_HEIGHT_CEILING_M = 25;

/**
 * The three readings a tree dot carries.
 *
 * Deliberately NOT the five development stages. At five thousand dots in a
 * viewport a five-way categorical scale is a texture, not a legend, and the
 * stage is on the card where it can be read one tree at a time. What the colour
 * carries instead is the distinction that a size channel would otherwise
 * destroy: whether the height it is drawn from was measured at all.
 */
export const FRAICHEUR_TREE_BANDS = Object.freeze([
  Object.freeze({
    id: 'remarquable',
    label: 'Arbre remarquable',
    color: '#f0b429',
    blurb: '183 arbres sur 219 432 portent remarquable = « OUI ». Le champ a trois états : « NON » 205 726, null 13 523 — le null n’est pas un non.',
  }),
  Object.freeze({
    id: 'mesure',
    label: 'Hauteur publiée',
    // Brighter and more saturated than EVERY step of the canopy ramp in
    // `fraicheurFeed.js`, which is the whole constraint: a tree dot is drawn
    // ON TOP of a green-space polygon, and this band used to be #2f8b43 —
    // exactly the ramp's `dense` (40-55 %) fill. A dot painted in its own
    // background is not a dot, and 164 of the 984 spaces carry that fill.
    color: '#7fe046',
    blurb: 'Taille du point = hauteur publiée, plafonnée à 25 m (99ᵉ centile des 200 025 hauteurs relevées ; médiane 9 m, maximum 65 m).',
  }),
  Object.freeze({
    id: 'sans-mesure',
    label: 'Hauteur non mesurée',
    // The SAME grey as `FRAICHEUR_CANOPY_UNKNOWN` and as the fountain whose
    // availability was never published, and that is deliberate rather than a
    // clash: across this whole layer grey means one thing only — the register
    // did not measure this. No other channel may take it.
    color: '#8a93a6',
    blurb: 'hauteurenm = 0 sur 19 407 arbres — un zéro qui veut dire « non relevé ». Tracés à la taille minimale, jamais mis à l’échelle.',
  }),
]);

export const FRAICHEUR_TREE_BAND_IDS = Object.freeze(FRAICHEUR_TREE_BANDS.map((band) => band.id));

/**
 * The five published `stadedeveloppement` values, in the words a card can use.
 *
 * The fourth entry is the point of this table. `"Jeune (arbre)Adulte"` is two
 * states concatenated by whatever wrote the export, and it is on 41 526 trees.
 * Mapping it to `Jeune` or to `Adulte` would be inventing a fact on 18.9% of
 * the register; leaving it raw would print a bug on the card without saying it
 * is one. So it is named as what it is.
 */
export const FRAICHEUR_TREE_STAGE_LABELS = Object.freeze({
  'Jeune (arbre)': 'Jeune',
  Adulte: 'Adulte',
  Mature: 'Mature',
  'Jeune (arbre)Adulte': 'Stade illisible (deux valeurs concaténées dans le registre)',
});

/** The published stage in readable French, or null when nothing was published. */
export function fraicheurTreeStage(value) {
  const raw = text(value);
  if (!raw) return null;
  return FRAICHEUR_TREE_STAGE_LABELS[raw] || raw;
}

/**
 * The `domanialite` codes, which are Ville de Paris directorate abbreviations
 * and mean nothing on a card.
 *
 * Measured counts over the whole register: Alignement 110 157, Jardin 56 427,
 * CIMETIERE 31 982, DASCO 8 554, PERIPHERIQUE 5 687, DJS 4 888, DFPE 1 589,
 * DAC 119, DASES 28, null 1. Five of those ten are internal acronyms, and
 * "DFPE" on a card is a worse answer than none.
 */
export const FRAICHEUR_TREE_DOMAIN_LABELS = Object.freeze({
  Alignement: 'Arbre d’alignement (voirie)',
  Jardin: 'Jardin ou square',
  CIMETIERE: 'Cimetière',
  DASCO: 'École (DASCO)',
  PERIPHERIQUE: 'Abords du périphérique',
  DJS: 'Équipement sportif (DJS)',
  DFPE: 'Crèche (DFPE)',
  DAC: 'Équipement culturel (DAC)',
  DASES: 'Établissement social (DASES)',
});

/** The domain in readable French; an unmapped code is printed as published. */
export function fraicheurTreeDomain(value) {
  const raw = text(value);
  if (!raw) return null;
  return FRAICHEUR_TREE_DOMAIN_LABELS[raw] || raw;
}

/** The band one projected tree belongs to. */
export function fraicheurTreeBand(tree) {
  if (tree?.remarquable === true) return 'remarquable';
  return tree?.height === null || tree?.height === undefined ? 'sans-mesure' : 'mesure';
}

/** The `where` clause for one box. Latitude first — that is the portal's order. */
export function fraicheurTreeWhere(box) {
  if (!box) return null;
  const { south, west, north, east } = box;
  if (![south, west, north, east].every(Number.isFinite)) return null;
  return `in_bbox(geo_point_2d,${south},${west},${north},${east})`;
}

/**
 * Dot size for one tree, by published height.
 *
 * Square-rooted and capped at {@link FRAICHEUR_TREE_HEIGHT_CEILING_M}. A null
 * height — which is what a published `0` becomes in the projection — returns
 * the minimum and is drawn in the grey band, so a dot's size is never a
 * statement the register did not make.
 * @param {?number} height Metres, or null.
 * @param {number} [min]
 * @param {number} [max]
 * @returns {number} Pixels.
 */
export function fraicheurTreeSize(height, min = 3, max = 11) {
  const metres = finiteOrNull(height);
  if (metres === null || metres <= 0) return min;
  const scale = Math.sqrt(Math.min(metres, FRAICHEUR_TREE_HEIGHT_CEILING_M))
    / Math.sqrt(FRAICHEUR_TREE_HEIGHT_CEILING_M);
  return min + (max - min) * scale;
}

/**
 * Project one bbox answer into the viewport payload.
 *
 * `totalInBox` is the count probe's own answer for the SAME box, and it is not
 * decoration: it is how this module knows whether the export it just read is
 * the whole box or a portion of one. They match on every measurement taken, and
 * a mismatch is reported rather than drawn — a tree map with scattered holes
 * looks exactly like a street with no trees on it.
 *
 * @param {object} options
 * @param {?object} options.features Raw `exports/geojson` FeatureCollection.
 * @param {?number} options.totalInBox The probe's `total_count` for the same box.
 * @param {?object} options.box The snapped box that was asked for.
 * @param {number} [options.budget]
 * @returns {object}
 */
export function projectFraicheurTrees({
  features = null, totalInBox = null, box = null, budget = FRAICHEUR_TREE_BUDGET,
} = {}) {
  const rows = Array.isArray(features?.features) ? features.features : [];
  const counted = finiteOrNull(totalInBox);

  // Over budget the box is refused WHOLE. Nothing is drawn short, for the same
  // reason the cadastre refuses a truncated parcel answer: a partial tree map
  // is indistinguishable from a treeless street.
  if (counted !== null && counted > budget) {
    return {
      box, trees: [], truncated: true, totalInBox: counted, returned: 0, budget,
      summary: summarizeFraicheurTrees([]),
      dataset: FRAICHEUR_TREE_DATASET,
      source: FRAICHEUR_TREE_SOURCE,
    };
  }

  const trees = [];
  let unplaced = 0;
  for (const feature of rows) {
    const point = readPoint(feature?.geometry);
    if (!point) { unplaced += 1; continue; }
    const properties = feature?.properties || {};
    const idbase = finiteOrNull(properties.idbase);
    const heightRaw = finiteOrNull(properties.hauteurenm);
    const girthRaw = finiteOrNull(properties.circonferenceencm);
    const remarquableRaw = text(properties.remarquable);
    trees.push({
      // `idbase` IS a key here, and that was checked rather than assumed:
      // 219 432 rows, 219 432 distinct values, 0 duplicates, verified over the
      // whole downloaded export. `count(distinct idbase)` on this portal
      // answers 211 523 — an approximate HyperLogLog cardinality that
      // undercounts by ~3.6% and must never be used for an integrity check.
      id: `tr:${idbase ?? `${point[0]},${point[1]}`}`,
      idbase,
      name: text(properties.libellefrancais),
      genus: text(properties.genre),
      species: text(properties.espece),
      // A published 0 is an ABSENCE of measurement and becomes null here, once,
      // so nothing downstream has to remember that.
      height: heightRaw && heightRaw > 0 ? heightRaw : null,
      girth: girthRaw && girthRaw > 0 ? girthRaw : null,
      stage: text(properties.stadedeveloppement),
      // Three-state, and the null stays null.
      remarquable: remarquableRaw === 'OUI' ? true : (remarquableRaw === 'NON' ? false : null),
      domain: text(properties.domanialite),
      p: point,
    });
  }

  const returned = trees.length;
  return {
    box,
    trees,
    truncated: false,
    totalInBox: counted ?? returned,
    returned,
    unplaced,
    budget,
    // The probe and the export disagreeing means one of them is describing a
    // different box. Reported, never smoothed over.
    countMismatch: counted !== null && counted !== returned + unplaced,
    decimals: FRAICHEUR_DECIMALS,
    summary: summarizeFraicheurTrees(trees),
    dataset: FRAICHEUR_TREE_DATASET,
    source: FRAICHEUR_TREE_SOURCE,
  };
}

/**
 * Everything the row and the legend need from one viewport of trees.
 * @param {Array<object>} trees
 * @returns {object}
 */
export function summarizeFraicheurTrees(trees) {
  const list = Array.isArray(trees) ? trees : [];
  const bands = new Map(FRAICHEUR_TREE_BAND_IDS.map((id) => [id, 0]));
  const species = new Map();
  const domains = new Map();
  let remarquable = 0;
  let remarquableUnknown = 0;
  let noHeight = 0;
  let noGirth = 0;
  let noSpecies = 0;
  let corruptStage = 0;
  let heightSum = 0;
  let heightCount = 0;
  let tallest = null;

  for (const tree of list) {
    bands.set(fraicheurTreeBand(tree), (bands.get(fraicheurTreeBand(tree)) || 0) + 1);
    if (tree.remarquable === true) remarquable += 1;
    else if (tree.remarquable === null) remarquableUnknown += 1;
    if (tree.height === null) noHeight += 1;
    else {
      heightSum += tree.height;
      heightCount += 1;
      if (!tallest || tree.height > tallest.height) tallest = tree;
    }
    if (tree.girth === null) noGirth += 1;
    if (!tree.name) noSpecies += 1;
    else species.set(tree.name, (species.get(tree.name) || 0) + 1);
    if (tree.stage === 'Jeune (arbre)Adulte') corruptStage += 1;
    if (tree.domain) domains.set(tree.domain, (domains.get(tree.domain) || 0) + 1);
  }

  const topSpecies = [...species.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'))
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  return {
    trees: list.length,
    bands: FRAICHEUR_TREE_BANDS.map((band) => ({
      id: band.id,
      label: band.label,
      color: band.color,
      blurb: band.blurb,
      count: bands.get(band.id) || 0,
    })),
    remarquable,
    remarquableUnknown,
    noHeight,
    noGirth,
    noSpecies,
    corruptStage,
    // Over the trees that published one, never over the whole set — averaging
    // 19 407 zeros into it would report a shorter city than the one that exists.
    meanHeightM: heightCount > 0 ? Number((heightSum / heightCount).toFixed(1)) : null,
    measuredHeights: heightCount,
    tallest: tallest ? { name: tallest.name, height: tallest.height, id: tallest.id } : null,
    topSpecies,
    alignement: domains.get('Alignement') || 0,
  };
}

/**
 * The card for one tree.
 * @param {object} tree
 * @returns {{title:string, details:string[]}}
 */
export function treeCardLines(tree) {
  const details = [];
  const latin = [tree?.genus, tree?.species].filter(Boolean).join(' ');
  if (latin) details.push(latin);

  if (tree?.height === null || tree?.height === undefined) {
    details.push('Hauteur non mesurée (le registre publie 0)');
  } else {
    details.push(`${tree.height.toLocaleString('fr-FR')} m de haut`);
  }
  if (tree?.girth) {
    details.push(`${tree.girth.toLocaleString('fr-FR')} cm de circonférence`);
    // The register contradicts itself on 136 trees nationally: a two-metre girth
    // on a six-metre trunk. Naming it beats drawing it as if it were consistent.
    if (tree.height !== null && tree.height !== undefined && tree.girth >= 200 && tree.height <= 8) {
      details.push('⚠ Hauteur et circonférence publiées ne s’accordent pas');
    }
  } else {
    details.push('Circonférence non mesurée (le registre publie 0)');
  }

  const stage = fraicheurTreeStage(tree?.stage);
  if (stage) details.push(stage);
  const domain = fraicheurTreeDomain(tree?.domain);
  if (domain) details.push(domain);
  if (tree?.remarquable === true) details.push('⭐ Arbre remarquable (Ville de Paris)');
  else if (tree?.remarquable === null) details.push('Caractère remarquable non renseigné');
  if (tree?.idbase !== null && tree?.idbase !== undefined) details.push(`idbase ${tree.idbase}`);

  return { title: tree?.name || 'Arbre (essence non publiée)', details };
}

/**
 * The status line for the tree half of the row.
 * @param {object} state
 * @returns {?string}
 */
export function fraicheurTreeLabel({ status, totalInBox, drawn, budget = FRAICHEUR_TREE_BUDGET } = {}) {
  if (status === 'too-high') {
    return `Descends sous ${FRAICHEUR_TREE_MAX_ALTITUDE_M.toLocaleString('fr-FR')} m pour charger les arbres`;
  }
  if (status === 'too-dense') {
    const count = finiteOrNull(totalInBox);
    return count === null
      ? 'Vue trop large pour les arbres — zoome'
      : `${count.toLocaleString('fr-FR')} arbres dans cette vue — au-delà des ${budget.toLocaleString('fr-FR')} que cette couche trace. Zoome.`;
  }
  if (status === 'loading') return 'comptage des arbres…';
  if (status === 'empty') return 'Aucun arbre référencé dans cette vue';
  if (status === 'ready' && Number.isFinite(drawn)) {
    return `${drawn.toLocaleString('fr-FR')} arbres tracés`;
  }
  return null;
}
