/*
 * AIRPORTS PACK — the shared vocabulary of the bundled OurAirports snapshot.
 *
 * Two callers, one file, so they cannot drift:
 *   - scripts/build-ourairports.mjs SELECTS and PROJECTS rows into
 *     src/data/local_data/airports/airports.geojsonl.
 *   - src/data/localGeojson.js READS the shipped properties back to write the
 *     ambient card for the `local-airports` layer.
 *
 * If the selection policy and the card copy lived apart, a field the build
 * stopped emitting would quietly become a blank line on the globe instead of a
 * failing test. Everything here is pure — no Cesium, no fs, no network — so the
 * build script and the browser both import it as-is.
 *
 * WHY THE PACK IS NOT THE WHOLE CATALOG
 * -------------------------------------
 * OurAirports publishes 86,002 rows. Shipped whole that is roughly 25 MB of
 * committed JSON, and 23,196 of those rows are heliports — in France, almost
 * every one of them a hospital landing pad with no ICAO code and no published
 * status. `isPackedAirport()` states the four clauses that survive instead, and
 * each one is a claim the layer can defend on screen.
 *
 * "GRAND AÉROPORT" IS A SIZE CLASS, NOT A LEGAL CATEGORY
 * -----------------------------------------------------
 * `large_airport` / `medium_airport` / `small_airport` are OurAirports' own
 * editorial size buckets, driven mostly by traffic and runway length. They are
 * NOT the French regulatory ladder (aérodrome d'intérêt national / régional /
 * local) and they do not map onto it. The labels below translate the bucket;
 * they do not upgrade it into a legal status.
 */

/**
 * ISO 3166-1 codes OurAirports uses for France and the French overseas
 * territories. `FR` alone is metropolitan France only — it would leave Roland
 * Garros, Fa'a'ā and Maryse Condé out of "les aérodromes français" — so the
 * territories are listed explicitly rather than inferred from a `LF`/`NT`/`TF`
 * ICAO prefix, which is not a reliable proxy either way (`LFVP` is Saint-Pierre,
 * but `LF` also covers nothing in Nouvelle-Calédonie).
 *
 * Order is alphabetical, not political.
 */
export const FRENCH_TERRITORY_CODES = Object.freeze([
  'BL', // Saint-Barthélemy
  'FR', // France métropolitaine
  'GF', // Guyane
  'GP', // Guadeloupe
  'MF', // Saint-Martin
  'MQ', // Martinique
  'NC', // Nouvelle-Calédonie
  'PF', // Polynésie française
  'PM', // Saint-Pierre-et-Miquelon
  'RE', // La Réunion
  'TF', // Terres australes et antarctiques françaises
  'WF', // Wallis-et-Futuna
  'YT', // Mayotte
]);

const FRENCH_TERRITORY_SET = new Set(FRENCH_TERRITORY_CODES);

/**
 * The types that describe a place an aircraft lands on a prepared surface or a
 * water lane. Deliberately excludes `heliport` (clause (d) of the policy admits
 * those one at a time) and `closed`, which means the field no longer exists.
 */
const FRENCH_LONG_TAIL_TYPES = new Set(['small_airport', 'seaplane_base', 'balloonport']);

/** OurAirports size/kind buckets, in French. See the header before "fixing" these. */
export const AIRPORT_TYPE_LABELS = Object.freeze({
  large_airport: 'Grand aéroport',
  medium_airport: 'Aéroport',
  small_airport: 'Aérodrome',
  heliport: 'Hélistation',
  seaplane_base: 'Hydrobase',
  balloonport: 'Base de ballons',
});

/**
 * Surface FAMILIES, not surface values. The upstream column is free text — 557
 * distinct spellings across 48,203 runways, from `ASP` and `ASPH-G` to
 * `PIÇARRA` and `ASPH/ CONC` — so quoting it verbatim on a card would ship the
 * data-entry history of a volunteer database as if it were a specification.
 * Three families is what the text can honestly support.
 */
export const RUNWAY_SURFACE_FAMILIES = Object.freeze({
  paved: 'revêtue',
  unpaved: 'non revêtue',
  water: 'eau',
});

/**
 * Substrings tested against the upper-cased surface text, most specific first.
 * A row matching nothing here yields '' — the card then omits the word rather
 * than guessing, which is the whole point of having a family table.
 */
const SURFACE_PATTERNS = Object.freeze([
  [RUNWAY_SURFACE_FAMILIES.water, ['WATER', 'WAT']],
  // FIRST, and not merged into the unpaved list below: `UNPAVED` CONTAINS
  // `PAVED`. Tested in the other order, every strip whose surface is spelt out
  // in full would ship as its own opposite.
  [RUNWAY_SURFACE_FAMILIES.unpaved, ['UNPAVED', 'UNPVD']],
  [RUNWAY_SURFACE_FAMILIES.paved, [
    'ASP', 'CON', 'BIT', 'PEM', 'TARMAC', 'PAVED', 'MACADAM', 'BRICK',
  ]],
  [RUNWAY_SURFACE_FAMILIES.unpaved, [
    'TURF', 'GRAS', 'GRS', 'GRE', 'GVL', 'GRV', 'GRAVEL', 'DIRT', 'EARTH', 'SAND',
    'CLAY', 'CORAL', 'ICE', 'SNOW', 'SOD', 'SOIL', 'LATER', 'PIÇARRA', 'PICARRA',
    'GROUND',
  ]],
]);

/** A published ICAO location indicator: exactly four letters. */
const ICAO_SHAPE = /^[A-Z]{4}$/;

const FEET_TO_METRES = 0.3048;

function text(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/**
 * The ICAO location indicator for a row, or '' when it has none.
 *
 * OurAirports fills `icao_code` for only 10,473 of its 86,002 rows, yet its own
 * documentation says `ident` "will be the ICAO code if available" and falls back
 * to a local code otherwise. Paris Issy-les-Moulineaux is the case that decides
 * the rule: `icao_code` is empty, `ident` is `LFPI`, and `LFPI` is a real
 * published indicator. So `ident` is trusted — but ONLY when it is four letters
 * AND is not itself the local code, because `ident === local_code` is exactly
 * upstream telling us this is a national identifier, not an ICAO one.
 *
 * @param {{icao_code?:string, ident?:string, local_code?:string}} row Raw CSV row.
 * @returns {string} Four-letter indicator, or ''.
 */
export function airportIcaoCode(row) {
  const declared = text(row?.icao_code).toUpperCase();
  if (ICAO_SHAPE.test(declared)) return declared;
  const ident = text(row?.ident).toUpperCase();
  if (!ICAO_SHAPE.test(ident)) return '';
  if (ident === text(row?.local_code).toUpperCase()) return '';
  return ident;
}

/**
 * Classify one free-text runway surface into a family.
 * @param {string} raw Upstream `surface` text.
 * @returns {string} A RUNWAY_SURFACE_FAMILIES value, or '' when unclassifiable.
 */
export function runwaySurfaceFamily(raw) {
  const upper = text(raw).toUpperCase();
  if (!upper) return '';
  for (const [family, needles] of SURFACE_PATTERNS) {
    if (needles.some((needle) => upper.includes(needle))) return family;
  }
  return '';
}

/**
 * THE SELECTION POLICY. Four clauses, each defensible on screen:
 *
 *   (a) every `large_airport` and `medium_airport`, worldwide — the airports a
 *       reader means by the word;
 *   (b) anything with scheduled service, worldwide, whatever its size — if a
 *       ticket is sold to it, it belongs on an intelligence globe (this is what
 *       keeps Monaco's heliport and the Greenland strips);
 *   (c) the French long tail — every small aerodrome, hydrobase and ballon
 *       field in France and the territories, which is the half of this request
 *       no global-only pack answers;
 *   (d) a French heliport ONLY when it carries an ICAO indicator. That admits
 *       Issy-les-Moulineaux and Toulon and rejects the other 456 rows, which are
 *       hospital pads carrying synthetic `FR-00xx` idents.
 *
 * `closed` is refused before any clause runs: the type means the aerodrome no
 * longer exists, and 13,482 ghost fields would be the third-largest layer in
 * the app.
 *
 * @param {object} row Raw OurAirports `airports.csv` row.
 * @returns {boolean} Whether the row ships in the pack.
 */
export function isPackedAirport(row) {
  const type = text(row?.type);
  if (!type || type === 'closed') return false;
  if (type === 'large_airport' || type === 'medium_airport') return true;
  if (text(row?.scheduled_service).toLowerCase() === 'yes') return true;
  if (!FRENCH_TERRITORY_SET.has(text(row?.iso_country).toUpperCase())) return false;
  if (FRENCH_LONG_TAIL_TYPES.has(type)) return true;
  return type === 'heliport' && airportIcaoCode(row) !== '';
}

/**
 * Reduce an airport's runways to the one line a card can carry.
 *
 * Closed runways are excluded from every field including the count: a field
 * with one open and two closed runways has one runway, and reporting three
 * would make a shuttered airfield look like a hub. The longest OPEN runway is
 * the number that matters — it is what says whether an A350 can land — and its
 * surface family travels with it rather than with some other strip.
 *
 * @param {object[]} runways Raw `runways.csv` rows already filtered to one airport.
 * @returns {{count:number, longestM?:number, surface?:string, lighted?:boolean}}
 */
export function summarizeRunways(runways) {
  const open = (Array.isArray(runways) ? runways : []).filter((row) => text(row?.closed) !== '1');
  const summary = { count: open.length };
  if (open.length === 0) return summary;

  let longest = null;
  let longestFeet = -1;
  for (const row of open) {
    const feet = Number(text(row?.length_ft));
    if (!Number.isFinite(feet) || feet <= 0) continue;
    if (feet > longestFeet) {
      longestFeet = feet;
      longest = row;
    }
  }
  if (longest) {
    summary.longestM = Math.round(longestFeet * FEET_TO_METRES);
    const surface = runwaySurfaceFamily(longest.surface);
    if (surface) summary.surface = surface;
  }
  if (open.some((row) => text(row?.lighted) === '1')) summary.lighted = true;
  return summary;
}

/**
 * Format a metre count the way French reads it — `4 215 m`, with an ordinary
 * space. `toLocaleString` emits U+202F/U+00A0 depending on the ICU build, and
 * an invisible character that varies by runtime is a test that fails on one
 * machine and passes on another.
 * @param {number} metres
 * @returns {string}
 */
function metresText(metres) {
  return `${Math.round(metres).toLocaleString('fr-FR').replace(/[\u00a0\u202f]/g, ' ')} m`;
}

/**
 * The card body for one packed airport — up to three lines, in the order a
 * reader wants them: who it is, what it is, where it is.
 *
 * The title is NOT produced here; the shared local-layer host already derives it
 * from `name`. Lines are returned unclamped, because the host owns the width.
 *
 * @param {object} props Shipped feature properties.
 * @returns {string[]} 0–3 detail lines, French, empty entries already dropped.
 */
export function airportCardDetails(props) {
  const source = props && typeof props === 'object' ? props : {};
  const lines = [];

  // Identity. `localCode` only ever ships when there is no ICAO and no IATA, so
  // it can join the same line without ever crowding the codes that matter.
  const identity = [
    text(source.icao),
    text(source.iata),
    text(source.localCode),
    source.scheduled === true ? 'vols réguliers' : '',
  ].filter(Boolean).join(' · ');
  if (identity) lines.push(identity);

  // Kind, then the number that says what can land. An unknown type is dropped
  // rather than echoed: the pack only ever writes the six keys above.
  const kind = AIRPORT_TYPE_LABELS[text(source.type)] || '';
  const runways = source.runways && typeof source.runways === 'object' ? source.runways : {};
  const longest = Number(runways.longestM);
  const runwayText = Number.isFinite(longest) && longest > 0
    ? `piste ${metresText(longest)}${runways.surface ? ` ${runways.surface}` : ''}`
    : '';
  const shape = [kind, runwayText].filter(Boolean).join(' · ');
  if (shape) lines.push(shape);

  // Place. The municipality is dropped when it merely repeats the title.
  const title = text(source.name).toLocaleLowerCase('fr-FR');
  const municipality = text(source.municipality);
  const place = [
    municipality && title.includes(municipality.toLocaleLowerCase('fr-FR')) ? '' : municipality,
    text(source.country),
  ].filter(Boolean).join(' · ');
  if (place) lines.push(place);

  return lines;
}

/*
 * ══════════════════════════════════════════════════════════════════════════
 * IMPORTANCE — the ladder that separates Roissy from an aéroclub
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Seven thousand identical dots is a wall, not a map. The pack already carries
 * the two facts that decide how much an airfield matters, and they are
 * INDEPENDENT of each other:
 *
 *   `type`      — OurAirports' editorial SIZE class. Large means a lot of
 *                 traffic on a long runway. It is not a legal status (see the
 *                 file header) but it is a real, curated size signal.
 *   `scheduled` — whether a timetabled service calls there. This one is a hard
 *                 fact rather than an editorial judgement: a ticket is sold, or
 *                 it is not.
 *
 * Crossing them gives four tiers a reader can actually name. Ordered most to
 * least important, because that order drives the dot size, the label ladder and
 * the display floors below — one ladder, not three that can drift apart.
 *
 * WHY `airfield` IS ENTIRELY FRENCH, AND WHY THAT IS NOT A BUG
 * -----------------------------------------------------------
 * Clause (c) of the selection policy is the ONLY one that admits a small field
 * with no scheduled service, and it is France-only. So every one of the 1,126
 * `airfield` markers is French — the tier ladder ends up separating "the
 * world's airports" from "France's flying clubs" almost exactly. That is the
 * shape of the pack, stated rather than hidden.
 */

/**
 * The four importance tiers, most important first. This array IS the order: the
 * legend renders it top-down and `AIRPORT_DISPLAY_FLOORS` slices it by index.
 *
 * Colours are one violet ramp rather than four unrelated hues, because these
 * are four grades of ONE thing. Brightness and size carry the ranking together
 * — brightness alone disappears against a light IGN basemap, size alone
 * disappears against a dark one.
 */
export const AIRPORT_TIERS = Object.freeze([
  Object.freeze({
    key: 'hub',
    label: 'Grand aéroport',
    color: '#f0e6ff',
    pixelSize: 14,
    stemWidth: 3.5,
    priority: 240,
    // Readable from orbit: the shared local-layer ceiling, unchanged.
    cardMaxDistance: 14_000_000,
    blurb: 'Classe « large » d’OurAirports — le trafic et la longueur de piste. Roissy, Heathrow, JFK.',
  }),
  Object.freeze({
    key: 'airline',
    label: 'Aéroport de ligne',
    color: '#c8a6ff',
    pixelSize: 10.5,
    stemWidth: 3,
    priority: 170,
    // Continental scale — the card arrives once a country fills the screen.
    cardMaxDistance: 3_000_000,
    blurb: 'Dessert au moins une ligne régulière — un billet s’y achète.',
  }),
  Object.freeze({
    key: 'airport',
    label: 'Aéroport sans ligne',
    color: '#9a7ad1',
    pixelSize: 8,
    stemWidth: 2.5,
    priority: 110,
    // Regional scale.
    cardMaxDistance: 1_200_000,
    blurb: 'Classe « medium » sans service régulier : bases aériennes, aviation d’affaires, terrains de fret.',
  }),
  Object.freeze({
    key: 'airfield',
    label: 'Aérodrome & aéroclub',
    color: '#6d5a94',
    pixelSize: 6,
    stemWidth: 2,
    // Départemental scale, and the number that stops Île-de-France reading as
    // fifteen aéroclubs and three airports. The marker is always drawn; only
    // its CARD waits until you are close enough for the name to be the point.
    cardMaxDistance: 200_000,
    blurb: 'Terrain sans ligne régulière — aéroclubs, altisurfaces, hydrobases. France uniquement dans ce paquet.',
    priority: 30,
  }),
]);

const TIER_BY_KEY = new Map(AIRPORT_TIERS.map((tier) => [tier.key, tier]));

/** Per-tier point/stem styling, in the shape `createLocalGeoJsonLayer` reads. */
export const AIRPORT_TIER_STYLES = Object.freeze(Object.fromEntries(
  AIRPORT_TIERS.map((tier) => [tier.key, Object.freeze({
    color: tier.color,
    pixelSize: tier.pixelSize,
    stemWidth: tier.stemWidth,
    cardMaxDistance: tier.cardMaxDistance,
  })]),
));

/**
 * Which tier one packed airport belongs to.
 *
 * Read top-down; the first match wins, which is why `large_airport` is tested
 * before `scheduled`. Roissy is both, and it is a hub — putting it in
 * "aéroport de ligne" because it also sells seats would empty the top tier.
 *
 * @param {object} props Shipped feature properties.
 * @returns {string} An `AIRPORT_TIERS` key. Always one of the four.
 */
export function airportTier(props) {
  const source = props && typeof props === 'object' ? props : {};
  if (text(source.type) === 'large_airport') return 'hub';
  if (source.scheduled === true) return 'airline';
  if (text(source.type) === 'medium_airport') return 'airport';
  return 'airfield';
}

/**
 * The display floors offered as row chips, from "show everything" downward.
 *
 * `keep` is the set of tiers that survive. It is written out per floor rather
 * than derived from an index so that reordering `AIRPORT_TIERS` can never
 * silently redefine what a chip does.
 *
 * These are RUNTIME params, not share-link state: the pack always ships whole
 * and `getStats().count` keeps reporting the total, so a floor hides markers
 * without ever losing them. Same contract as the hydro layer's `floorKw`.
 */
export const AIRPORT_DISPLAY_FLOORS = Object.freeze([
  Object.freeze({
    id: 'all',
    label: 'TOUS',
    keep: Object.freeze(['hub', 'airline', 'airport', 'airfield']),
    title: 'Tous les terrains du paquet',
  }),
  Object.freeze({
    id: 'airports',
    label: 'AÉROPORTS',
    keep: Object.freeze(['hub', 'airline', 'airport']),
    title: 'Masquer les aérodromes et aéroclubs',
  }),
  Object.freeze({
    id: 'airlines',
    label: 'LIGNES',
    keep: Object.freeze(['hub', 'airline']),
    title: 'Ne garder que les terrains desservis par une ligne régulière',
  }),
  Object.freeze({
    id: 'hubs',
    label: 'GRANDS',
    keep: Object.freeze(['hub']),
    title: 'Ne garder que les grands aéroports',
  }),
]);

const FLOOR_BY_ID = new Map(AIRPORT_DISPLAY_FLOORS.map((floor) => [floor.id, floor]));

/** The floor a params object selects, falling back to "show everything". */
export function airportDisplayFloor(floorId) {
  return FLOOR_BY_ID.get(text(floorId)) || AIRPORT_DISPLAY_FLOORS[0];
}

/**
 * Whether a tier is drawn under the given floor.
 * @param {string} tierKey An AIRPORT_TIERS key.
 * @param {{floor?: string}} [params] Layer runtime params.
 * @returns {boolean}
 */
export function airportTierVisible(tierKey, params = {}) {
  return airportDisplayFloor(params?.floor).keep.includes(tierKey);
}

/**
 * Build the row legend from a live per-tier tally.
 *
 * Only tiers actually present are listed, and the count is what is DRAWN, not
 * what is loaded — a legend that keeps claiming 1,126 aéroclubs while the
 * AÉROPORTS floor hides every one of them is a lie the panel tells at a glance.
 *
 * @param {Map<string,{total:number, visible:number}>|object} tally Per-tier counts.
 * @returns {Array<{label:string,color:string,blurb:string,count:number}>}
 */
export function airportTierLegend(tally) {
  const read = (key) => (tally instanceof Map ? tally.get(key) : tally?.[key]) || null;
  const legend = [];
  for (const tier of AIRPORT_TIERS) {
    const bucket = read(tier.key);
    if (!bucket?.total) continue;
    const hidden = bucket.total - (bucket.visible ?? bucket.total);
    legend.push({
      label: tier.label,
      color: tier.color,
      blurb: hidden > 0 ? `${tier.blurb} — ${hidden} masqué${hidden > 1 ? 's' : ''}` : tier.blurb,
      count: bucket.visible ?? bucket.total,
    });
  }
  return legend;
}

/**
 * Label-grid priority for one packed airport.
 *
 * When the screen is crowded the arbiter keeps the higher score, so the ladder
 * has to be the one a reader would draw: Roissy outranks the grass strip beside
 * it. It is the TIER ladder and nothing else — a second, parallel scoring of
 * IATA codes and scheduled flags would eventually disagree with the dot sizes
 * the same tiers pick, and then the biggest dot would not be the labelled one.
 *
 * The base and the top step (70 + 240 = 310) deliberately match the ports
 * ladder next door: both layers publish into the one shared `ambient-card`
 * collision group, so scales that drift apart would silently decide which
 * layer wins a cell.
 *
 * @param {object} props Shipped feature properties.
 * @returns {number} Additive contribution to the shared label priority.
 */
export function airportLabelPriority(props) {
  return 70 + (TIER_BY_KEY.get(airportTier(props))?.priority ?? 0);
}
