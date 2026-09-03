/*
 * DAMS PACK — the shared vocabulary of the bundled OpenStreetMap dam snapshot.
 *
 * Two callers, one file, so they cannot drift:
 *   - scripts/build-osm-dams.mjs PROJECTS Overpass elements (and the retained
 *     world snapshot) into src/data/local_data/dams/dams.geojsonl.
 *   - src/data/localGeojson.js READS the shipped properties back to write the
 *     ambient card, the marker style and the label rank for `local-dams`.
 *
 * Everything here is pure — no Cesium, no fs, no network — so the build script
 * and the browser both import it as-is. Same contract as ./airportsPack.js next
 * door, and for the same reason: a field the build stops emitting has to become
 * a failing test, not a blank line on the globe.
 *
 * WHY THIS FILE EXISTS AT ALL
 * ---------------------------
 * The pack it describes used to be 704 features for the whole planet, decoded
 * out of an Open Infrastructure Map POWER-PLANT layer and filtered on a dam
 * tag. In France that left 44 objects — so in a France fork "Barrages" was a
 * row you switched on to watch nothing happen. The French half is now a direct
 * OSM extraction of the dam STRUCTURES themselves (5.5k of them, overseas
 * départements and collectivités included); the rest of the world is the old
 * snapshot, kept so that turning the layer on outside France does not empty it.
 * Both halves are OpenStreetMap, ODbL 1.0, and both pass through the projection
 * below — one shape, one card, one ladder.
 *
 * WHAT "BARRAGE" MEANS HERE, AND WHAT IT DOES NOT
 * -----------------------------------------------
 * It means `waterway=dam`, `man_made=dam` or `building=dam` in OpenStreetMap —
 * a volunteer's judgement about a structure, not an entry in a national
 * register. France's own register (the ROE, ~100k obstacles à l'écoulement) is
 * an order of magnitude larger and is NOT this. Nor is a dam a power station:
 * the usine that a barrage feeds is a different object, usually mapped
 * separately, and it is the subject of the `edf-power-plants`, `fr-hydro-plants`
 * and `rte-generation` layers. Nothing is joined between them.
 *
 * ── SIZE: WHAT THE PACK CAN CARRY, AND WHAT IT CANNOT ───────────────────────
 *
 * OSM publishes `height` and `length` on a `waterway=dam`, and the obvious move
 * was to put one of them on the size channel. Measured on the shipped pack
 * before writing a line of it:
 *
 *     heightM   171 of 7 432   2.30 %
 *     spanM   5 328 of 7 432  71.69 %
 *
 * `height` is REFUSED. At 2.3 % coverage a height-driven size would be a map
 * of 171 objects and 7 261 defaults, and the 171 are not a sample of anything —
 * they are the barrages somebody thought worth measuring, which is the ladder
 * `damTier` already reads. `length` is not shipped at all: the allowlist in
 * {@link damFeatureProperties} never carried it.
 *
 * What IS carried is `spanM` — the longest straight-line dimension, measured
 * off the mapped geometry at build time, on 71.7 % of the pack. It is a metre
 * count of the object itself rather than a tag somebody typed, and it spans
 * 25 m → 6 399 m (median 100, p95 539). That is the absolute quantity B1 asks
 * for, so it takes the size channel.
 *
 * The four classes are FROZEN DOMAIN thresholds (C1), never quantiles of what
 * is on screen — 100 m, 300 m and 1 000 m, with their measured populations:
 *
 *     ≥ 1 000 m       116   1.56 %
 *     300 – 999 m     439   5.91 %
 *     100 – 299 m   2 132  28.69 %
 *     25 – 99 m     2 641  35.54 %
 *     not measured  2 104  28.31 %   (of which 660 are the world snapshot,
 *                                     which shipped without geometry to measure)
 *
 * The 2 104 get a HOLLOW ring, not the smallest disc (A1): "not measured" and
 * "short" are not the same statement, and 28 % of the layer is too much of it
 * to leave silently indistinguishable.
 *
 * Constant PIXELS, not world units, and deliberately the opposite choice from
 * `datacentersPack.js` next door: a dam's span is a length along an axis this
 * pack does not ship — 5 583 of the features are a single point — so there is
 * no true-size shape to draw. A constant-pixel disc is then the only honest
 * quantitative mark, and it is safe here precisely because this renderer sets
 * `PointGraphics.pixelSize` and never a `scaleByDistance`: nothing composes
 * with it (B2).
 *
 * ── WHAT THE SIZE CHANNEL USED TO CARRY ─────────────────────────────────────
 *
 * The tier — 13 / 9 / 6 px for major / named / minor — and the stem width with
 * it. Both are gone. Importance was being said three times (dot size, stem
 * width, card range) and measured never, which is A3 twice over and B1 once.
 * Tier now lives entirely on the two channels that were already its own and
 * that no other variable competes for: the label ladder's priority and the
 * distance at which a card stops being offered ({@link DAM_TIERS} `priority`
 * and `cardMaxDistance`), plus the display chips. Colour is untouched — it
 * still says WHAT the structure is.
 */

/**
 * The Overpass tag filters the pack is extracted with. The selection policy IS
 * this query — plus one documented exclusion in the build script — so it lives
 * here beside the code that reads the result back.
 *
 * `man_made=dam` and `building=dam` are kept alongside the canonical
 * `waterway=dam` because 55 French structures carry only one of those two, and
 * dropping them would lose real barrages to a tagging preference.
 *
 * ── WHY DYKES ARE HERE NOW, AND WEIRS ARE NOT ───────────────────────────────
 *
 * A digue and a barrage are different objects. OSM says so unambiguously —
 * `waterway=dam` is "a barrier built ACROSS a river", `man_made=dyke` is "an
 * embankment built to restrict the flow of water", running PARALLEL to it —
 * and the layer was drawing them as one thing. Not hypothetically: 25 features
 * in the shipped pack already carry `man_made=dyke` (they got in because they
 * also carry `waterway=dam`), 26 are literally named "Digue …", and SEVEN of
 * those are promoted to the top tier and labelled "Grand barrage", because the
 * `name AND span ≥ 300 m` clause cannot tell a 1 106 m dyke from a dam.
 *
 * `embankment=dyke` is included alongside `man_made=dyke` because it is the
 * wiki-documented tag for a dyke that also carries a road, and ~96 French
 * dykes are findable only through it.
 *
 * WEIRS ARE DELIBERATELY LEFT OUT, for now. France has 7 704 `waterway=weir`
 * against 5 519 `waterway=dam`, so adding them would more than double a layer
 * called "Barrages" with objects most readers would not call one, and the
 * dam-versus-weir boundary is a mapper's judgement about overtopping rather
 * than a survey. That is a separate decision from the one this pack is making,
 * which is that a dyke is not a dam. See `DAM_STRUCTURES` for what the tier
 * label used to claim about weirs, and stopped claiming.
 *
 * `man_made=embankment` (14 169 in France) is NOT a dyke tag — the wiki lists
 * it as a raised bank carrying rail or road — and including it would bury the
 * layer under railway embankments.
 */
export const DAM_TAG_FILTERS = Object.freeze([
  Object.freeze(['waterway', 'dam']),
  Object.freeze(['man_made', 'dam']),
  Object.freeze(['building', 'dam']),
  Object.freeze(['man_made', 'dyke']),
  Object.freeze(['embankment', 'dyke']),
]);

/**
 * What the structure IS, as a closed vocabulary.
 *
 * This is the field the pack never had. `damFeatureProperties` emitted eleven
 * properties and not one of them said what the object was, so the raw tag that
 * SELECTED each feature was discarded at build time and nothing downstream
 * could tell a barrage from a digue.
 *
 * `dam+dyke` is not a hedge, it is the honest answer for the 25 features whose
 * mapper applied both tags. Picking a side for them silently would file 25
 * objects under a category nobody intended; naming the ambiguity costs one
 * value and states it.
 */
export const DAM_STRUCTURES = Object.freeze([
  Object.freeze({
    key: 'dam',
    label: 'Barrage',
    blurb: 'Ouvrage en travers du cours d’eau, qui le retient.',
  }),
  Object.freeze({
    key: 'dyke',
    label: 'Digue',
    // The limit of what OSM can say, stated where a reader will see it: there
    // is no tag anywhere that separates a flood-defence dyke from a pond bund
    // (`dyke:type` has ONE use worldwide), and the register that does cover
    // French flood dykes — SIOUH, décret 2015-526 — is not open bulk data.
    blurb: 'Remblai le long de l’eau, qui la contient. OpenStreetMap ne '
      + 'distingue pas une digue de protection d’une digue d’étang.',
  }),
  Object.freeze({
    key: 'dam+dyke',
    label: 'Barrage-digue',
    blurb: 'Porte les deux tags dans OpenStreetMap — le cartographe n’a pas '
      + 'tranché, et cette couche ne tranche pas à sa place.',
  }),
]);

/** One index, two jobs: membership for `isDamStructureKind`, label for the title. */
const STRUCTURE_BY_KEY = new Map(DAM_STRUCTURES.map((entry) => [entry.key, entry]));

/**
 * The structure one element's tags describe.
 *
 * Returns `''` when nothing matches, which is NOT the same as `dam`: the world
 * half of the pack was carried over from an older snapshot and has no raw tags
 * left, so those features are unclassified and must say so. Defaulting them to
 * `dam` would re-create the exact conflation this field exists to end, outside
 * France where nobody would notice.
 *
 * @param {object} tags Raw OSM tags.
 * @returns {string} A key of {@link DAM_STRUCTURES}, or ''.
 */
export function damStructureKind(tags) {
  const source = tags && typeof tags === 'object' ? tags : {};
  const isDam = source.waterway === 'dam' || source.man_made === 'dam' || source.building === 'dam';
  const isDyke = source.man_made === 'dyke' || source.embankment === 'dyke';
  if (isDam && isDyke) return 'dam+dyke';
  if (isDyke) return 'dyke';
  if (isDam) return 'dam';
  return '';
}

/** Whether a `kind` string is one this pack knows. */
export function isDamStructureKind(value) {
  return STRUCTURE_BY_KEY.has(String(value ?? ''));
}

/**
 * What a feature carrying no `kind` is called: an ouvrage, and nothing more
 * precise. Same reasoning as the grey ramp in {@link STRUCTURE_RAMPS} —
 * unclassified must not read as "dam".
 */
export const UNCLASSIFIED_STRUCTURE_LABEL = 'Ouvrage';

/**
 * The title for one packed structure that OpenStreetMap never named.
 *
 * 5 948 of the pack's 7 432 features have no `name`, so this string — not the
 * mapper's — is what 80% of the cards and globe labels actually say. The host
 * used to fall through to the LAYER's title there, which titled 1 198 digues,
 * 24 `dam+dyke` and 88 unclassified world features "Barrage": the same
 * conflation `kind` was added to end, re-created one layer downstream, on the
 * one surface a reader reads. `kind` already decides the colour and the chips;
 * it decides the word too.
 *
 * @param {object} props Shipped feature properties.
 * @returns {string} A {@link DAM_STRUCTURES} label, or `Ouvrage`.
 */
export function damStructureTitle(props) {
  const kind = props && typeof props === 'object' ? props.kind : null;
  return STRUCTURE_BY_KEY.get(String(kind ?? ''))?.label || UNCLASSIFIED_STRUCTURE_LABEL;
}

/**
 * Build the Overpass QL query for one area selector.
 *
 * `nwr` and not `way`: 291 French dams are mapped as a single node and 19 as a
 * multipolygon relation, and a way-only query would silently ship neither.
 *
 * @param {string} areaSelector Overpass area filter, e.g. `["ISO3166-1"="FR"][admin_level=2]`.
 * @param {number} [timeoutSeconds=600] Server-side timeout.
 * @returns {string} A complete Overpass QL program.
 */
export function damOverpassQuery(areaSelector, timeoutSeconds = 600) {
  const clauses = DAM_TAG_FILTERS
    .map(([key, value]) => `  nwr["${key}"="${value}"](area.scope);`)
    .join('\n');
  return [
    `[out:json][timeout:${timeoutSeconds}];`,
    `area${areaSelector}->.scope;`,
    '(',
    clauses,
    ');',
    'out geom;',
    '',
  ].join('\n');
}

/* ══════════════════════════════════════════════════════════════════════════
 * TAG READING — the shipped properties, derived once
 * ══════════════════════════════════════════════════════════════════════════ */

function text(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/** Upper-cased, unaccented, punctuation-collapsed — for comparing operator names. */
function normalizeOperator(value) {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/**
 * The électriciens whose name on a barrage means the structure belongs to the
 * French hydroelectric fleet.
 *
 * An EXPLICIT list, not a pattern, and deliberately a short one. `operator` is
 * free text: 83 distinct spellings sit on 502 French dams, and most of the tail
 * is a single independent producer with five weirs. Claiming those would mean
 * guessing from a company name; these four do not need guessing, and they carry
 * 369 of the 502. Everything else is simply not claimed — a dam operated by
 * Serhy lands in "Barrage nommé", which is true, rather than in a tier that
 * asserts a turbine nobody mapped.
 *
 * VNF is absent on purpose: Voies Navigables de France operates navigation
 * weirs, not power stations.
 */
export const HYDRO_OPERATORS = Object.freeze([
  'EDF',                          // Électricité de France (335 dams)
  'ELECTRICITE DE FRANCE',        // the same, spelt out (5)
  'EDF PEI',                      // the overseas production subsidiary (5)
  'CNR',                          // Compagnie Nationale du Rhône (15)
  'COMPAGNIE NATIONALE DU RHONE', // the same, spelt out (1)
  'SHEM',                         // Société Hydro-Électrique du Midi (8)
]);

const HYDRO_OPERATOR_SET = new Set(HYDRO_OPERATORS);

/**
 * The same three companies by Wikidata QID. `operator:wikidata` is on 167
 * French dams and is immune to spelling, so it is checked first.
 * Q274591 EDF · Q1121170 Compagnie Nationale du Rhône · Q3488393 SHEM.
 */
const HYDRO_OPERATOR_QIDS = new Set(['Q274591', 'Q1121170', 'Q3488393']);

/**
 * Tags that prove the structure is part of an electricity generating unit,
 * whoever runs it. `ref:EU:ENTSOE_EIC` is in the list because a European
 * energy-market identifier is not issued to an irrigation pond.
 */
const POWER_TAG_KEYS = Object.freeze([
  'plant:source',
  'plant:method',
  'plant:output:electricity',
  'generator:source',
  'generator:type',
  'generator:output:electricity',
  'ref:EU:ENTSOE_EIC',
]);

/**
 * Whether OSM says this structure generates electricity.
 *
 * Two independent kinds of evidence, either sufficient: power/plant tagging on
 * the dam itself (44 French features — most hydro plants are mapped as their
 * own object beside the dam, which is why this number is so low), or one of the
 * fleet operators above (369). Neither is inferred from the name.
 *
 * @param {Record<string,string>} tags Raw OSM tags.
 * @returns {boolean}
 */
export function damIsHydro(tags) {
  const source = tags && typeof tags === 'object' ? tags : {};
  const power = text(source.power);
  if (power === 'plant' || power === 'generator') return true;
  if (POWER_TAG_KEYS.some((key) => text(source[key]) !== '')) return true;
  if (HYDRO_OPERATOR_QIDS.has(text(source['operator:wikidata']))) return true;
  return HYDRO_OPERATOR_SET.has(normalizeOperator(source.operator));
}

/**
 * Dam height in metres, or null.
 *
 * OSM `height` is free text: `12`, `12 m`, `12,5`. Values are bounded to
 * (0, 400] — the tallest dam on earth is 305 m — so a mis-keyed `1200` becomes
 * null instead of promoting a farm weir into the top tier.
 *
 * @param {Record<string,string>} tags Raw OSM tags.
 * @returns {number|null} Height in metres, one decimal at most.
 */
export function damHeightM(tags) {
  const source = tags && typeof tags === 'object' ? tags : {};
  for (const key of ['dam:height', 'height']) {
    const raw = text(source[key]).replace(',', '.').replace(/\s*m$/i, '').trim();
    if (!raw) continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0 || value > 400) continue;
    return Math.round(value * 10) / 10;
  }
  return null;
}

/**
 * Material FAMILIES, not material values — same reasoning as the airport pack's
 * runway surfaces. The upstream tag is free text and it is spelt in at least
 * two languages (`beton` beside `concrete`); six families is what it can
 * honestly support, and anything else yields '' rather than a guess.
 */
export const DAM_MATERIAL_FAMILIES = Object.freeze({
  concrete: 'béton',
  earth: 'terre',
  masonry: 'maçonnerie',
  stone: 'pierre',
  metal: 'métal',
  wood: 'bois',
});

/** Upper-cased substrings, most specific first. `''` when nothing matches. */
const MATERIAL_PATTERNS = Object.freeze([
  [DAM_MATERIAL_FAMILIES.concrete, ['CONCRETE', 'BETON', 'CIMENT', 'CEMENT']],
  [DAM_MATERIAL_FAMILIES.masonry, ['MASONRY', 'MACONNERIE', 'BRICK', 'BRIQUE']],
  [DAM_MATERIAL_FAMILIES.stone, ['STONE', 'PIERRE', 'ROCK', 'ENROCHEMENT', 'GRANITE']],
  [DAM_MATERIAL_FAMILIES.metal, ['METAL', 'STEEL', 'ACIER', 'IRON', 'FER']],
  [DAM_MATERIAL_FAMILIES.wood, ['WOOD', 'BOIS', 'TIMBER']],
  [DAM_MATERIAL_FAMILIES.earth, ['SOIL', 'EARTH', 'TERRE', 'CLAY', 'ARGILE', 'GRAVEL', 'SAND', 'REMBLAI']],
]);

/**
 * Classify one free-text material into a family.
 * @param {string} raw Upstream `material` text.
 * @returns {string} A DAM_MATERIAL_FAMILIES value, or ''.
 */
export function damMaterialFamily(raw) {
  const upper = text(raw).toUpperCase();
  if (!upper) return '';
  for (const [family, needles] of MATERIAL_PATTERNS) {
    if (needles.some((needle) => upper.includes(needle))) return family;
  }
  return '';
}

/**
 * Installed electrical output in MW, or null.
 *
 * `plant:output:electricity` is written as `330KW`, `12 MW`, `1.5 megawatts`
 * and occasionally as bare watts. Anything that does not resolve to a unit and
 * a finite number is dropped: a card line reading "0 MW" would be a claim.
 *
 * @param {Record<string,string>} tags Raw OSM tags.
 * @returns {number|null} Megawatts, three decimals at most.
 */
export function damOutputMw(tags) {
  const source = tags && typeof tags === 'object' ? tags : {};
  const raw = text(source['plant:output:electricity'])
    || text(source['generator:output:electricity']);
  if (!raw || /^(yes|auto)$/i.test(raw)) return null;
  const match = raw.replace(',', '.').match(/^([0-9]*\.?[0-9]+)\s*(k|m|g)?w?/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const scale = { k: 1e-3, m: 1, g: 1e3 }[text(match[2]).toLowerCase()];
  // No unit letter means watts — `1200000` is 1.2 MW, not 1.2 million.
  const mw = scale === undefined ? value / 1e6 : value * scale;
  if (!Number.isFinite(mw) || mw <= 0 || mw > 25_000) return null;
  return Math.round(mw * 1000) / 1000;
}

/**
 * Commissioning year, or null. `start_date` is ISO-ish (`1951`, `2006-01-12`)
 * and only the year is kept; anything outside 1000–2100 is a typo, not a date.
 * @param {Record<string,string>} tags Raw OSM tags.
 * @returns {number|null}
 */
export function damBuiltYear(tags) {
  const source = tags && typeof tags === 'object' ? tags : {};
  const raw = text(source.start_date) || text(source.construction_date);
  const match = raw.match(/(1[0-9]{3}|20[0-9]{2}|2100)/);
  if (!match) return null;
  return Number(match[1]);
}

/**
 * The dam's display name, or ''. `name` first, then the French and English
 * localized names — a Breton-only `name:br` is a real name for a real barrage,
 * but it is not the one this app's readers are looking up.
 * @param {Record<string,string>} tags Raw OSM tags.
 * @returns {string}
 */
export function damName(tags) {
  const source = tags && typeof tags === 'object' ? tags : {};
  return text(source.name)
    || text(source['name:fr'])
    || text(source['name:en'])
    || text(source.official_name)
    || '';
}

/**
 * Shortest span worth shipping. Below it the number says nothing a reader can
 * use and is dominated by how carefully one volunteer traced a sketch.
 */
export const DAM_MIN_SPAN_M = 25;

/**
 * Project one element's tags plus its measured geometry into the properties
 * that ship in the pack.
 *
 * This is an ALLOWLIST, and that is the privacy transform: `operator:phone`,
 * `contact:*`, `note`, `description` and every other free-text field a mapper
 * may have pasted an email into simply never reach the file. Nothing is emitted
 * empty — an absent field is absent, so the card can omit a line rather than
 * print a placeholder.
 *
 * @param {object} options
 * @param {Record<string,string>} options.tags Raw OSM tags.
 * @param {string} options.osm Compact element id, e.g. `w123456`.
 * @param {number|null} [options.spanM] Longest straight-line dimension, metres.
 * @returns {object} Shipped feature properties.
 */
export function damFeatureProperties({ tags, osm, spanM = null }) {
  const source = tags && typeof tags === 'object' ? tags : {};
  const properties = {};

  const name = damName(source);
  if (name) properties.name = name;
  const id = text(osm);
  if (id) properties.osm = id;

  // Emitted even when it is the boring value, unlike every other field here:
  // an ABSENT `kind` has to keep meaning "unclassified" (the carried-over world
  // half), so it cannot double as shorthand for "dam".
  const kind = damStructureKind(source);
  if (kind) properties.kind = kind;

  const operator = text(source.operator) || text(source['operator:short']);
  if (operator) properties.operator = operator;

  // Only the world snapshot carries this: the French extraction is of dam
  // structures, and OSM does not tag the watercourse on the dam itself.
  const river = text(source.associated_river) || text(source.river);
  if (river) properties.river = river;

  const height = damHeightM(source);
  if (height !== null) properties.heightM = height;

  const span = Number(spanM);
  if (Number.isFinite(span) && span >= DAM_MIN_SPAN_M) properties.spanM = Math.round(span);

  const material = damMaterialFamily(source.material);
  if (material) properties.material = material;

  const year = damBuiltYear(source);
  if (year !== null) properties.builtYear = year;

  const output = damOutputMw(source);
  if (output !== null) properties.outputMw = output;

  if (damIsHydro(source)) properties.hydro = true;
  // `abandoned=yes` means the structure stands but is no longer maintained —
  // it is not a demolished dam, and the card says so rather than hiding it.
  if (/^(yes|true|1)$/i.test(text(source.abandoned))) properties.abandoned = true;

  return properties;
}

/* ══════════════════════════════════════════════════════════════════════════
 * IMPORTANCE — the ladder that separates Serre-Ponçon from a farm weir
 * ══════════════════════════════════════════════════════════════════════════
 *
 * 5,529 identical dots over France is a wall, not a map, and the wall is mostly
 * pond outlets: 4,300 of them carry no name, no height and no operator. Three
 * facts in the pack decide how much a structure matters, and the top rung takes
 * either of the first two, because they are two different ways of being a real
 * barrage rather than two grades of one:
 *
 *   `heightM`  — 15 m is the international threshold for a "large dam" (ICOLD).
 *                Present on 119 French features; where it is present it is the
 *                best single fact in the file, and the list it produces reads
 *                like the list a French reader would write from memory:
 *                Chevril 181 m, Roselend 150, Monteynard 135, Serre-Ponçon 124.
 *   `hydro`    — the structure generates electricity (see `damIsHydro`). ~380.
 *   `name`     — someone thought the object was worth naming. ~870.
 *
 * WHY SIZE ONLY COUNTS WITH A NAME ON IT
 * --------------------------------------
 * `spanM` is measured for 69% of the pack and it is the obvious fourth clause,
 * but on its own it ranks the wrong things: at 300 m it admits 286 French
 * features of which 165 carry no name at all, because the long objects in this
 * dataset are canal embankments and étang dykes — the longest is 6.4 km. Paired
 * with a name it stops being noise and starts catching the barrages OSM simply
 * never gave a height to: 49 more, Vouglans and Saint-Cassien and Matemale
 * among them. So the clause is `name AND span ≥ 300 m`, never span alone.
 */

/**
 * The three tiers, most important first. This array IS the order: the chips
 * read it top-down and `DAM_DISPLAY_FLOORS` slices it.
 *
 * It carries NO `pixelSize` and no `stemWidth` any more — see "WHAT THE SIZE
 * CHANNEL USED TO CARRY" at the top of this file. What is left is what tier
 * legitimately owns: a label-grid priority and the distance at which the card
 * stops being offered.
 *
 * Colours are one blue ramp — these are three grades of one thing — around the
 * layer's historical `#0088ff`, and clear of cyan (datacenters), amber (ports)
 * and violet (airports), which share the one `ambient-card` collision group.
 */
export const DAM_TIERS = Object.freeze([
  Object.freeze({
    key: 'major',
    label: 'Grand barrage',
    color: '#9ad9ff',
    priority: 240,
    // Readable from orbit: the shared local-layer ceiling, unchanged.
    cardMaxDistance: 14_000_000,
    blurb: 'Au moins 15 m de haut — le seuil international du grand barrage — '
      + 'ou exploité pour l’électricité (EDF, CNR, SHEM), ou nommé et long de 300 m.',
  }),
  Object.freeze({
    key: 'named',
    label: 'Barrage nommé',
    color: '#3fa4e0',
    priority: 110,
    // Regional scale: the name arrives once a région fills the screen.
    cardMaxDistance: 1_200_000,
    blurb: 'Porte un nom dans OpenStreetMap, sans hauteur, exploitant ni '
      + 'envergure qui le hisse au-dessus.',
  }),
  Object.freeze({
    key: 'minor',
    // NOT 'Seuil & petit ouvrage'. `waterway=weir` is not in DAM_TAG_FILTERS,
    // so this tier has never contained a single OSM-tagged weir — the label
    // named a thing the pack does not hold. It names the tier's actual rule
    // instead: no name, no height, no operator.
    label: 'Petit ouvrage',
    color: '#2b6c96',
    priority: 30,
    // Départemental scale. The marker is always drawn; only its CARD waits
    // until you are close enough for an unnamed weir to be the point.
    cardMaxDistance: 200_000,
    blurb: 'Sans nom, sans hauteur et sans exploitant : sorties d’étang et '
      + 'ouvrages de dérivation, pour l’essentiel.',
  }),
]);

const TIER_BY_KEY = new Map(DAM_TIERS.map((tier) => [tier.key, tier]));

/**
 * ── THREE FACTS, THREE CHANNELS ─────────────────────────────────────────────
 *
 * WHAT the structure is, HOW BIG it is, and HOW MUCH it matters are three
 * independent facts and they get three independent channels:
 *
 *     COLOUR   what it is        dam / dyke / both / unclassified (this ramp)
 *     SIZE     how long it is    the measured span, in constant pixels
 *     RANGE    how much it weighs the card's `cardMaxDistance` and priority
 *
 * A 1 106 m dyke and a 1 106 m barrage are the same size on screen because
 * they are the same size in the world; they are different colours because they
 * are different objects; and whichever of the two is named keeps its card
 * further out. Nothing is said twice.
 *
 * The colour/tier split is forced by the renderer as much as chosen:
 * `createLocalGeoJsonLayer` resolves ONE group key per feature at load and
 * bakes its colour into the Cesium primitives, so anything that must vary per
 * feature has to live in that key. Hence a composite `kind:tier`. Size does
 * NOT travel in it — it comes from {@link damRenderSpec}, per feature.
 *
 * The dyke ramp is ochre — earth, which is what a dyke is made of — and stays
 * clear of the blues this layer already spends on dams, of cyan (datacenters),
 * amber (ports) and violet (airports), which share the one `ambient-card`
 * collision group.
 */
const STRUCTURE_RAMPS = Object.freeze({
  dam: Object.freeze({ major: '#9ad9ff', named: '#3fa4e0', minor: '#2b6c96' }),
  dyke: Object.freeze({ major: '#f0c46a', named: '#c99a3c', minor: '#8d6b26' }),
  // Both tags at once: the blue-green between the two ramps, so it reads as
  // neither one nor the other — which is exactly its situation.
  'dam+dyke': Object.freeze({ major: '#7fd9c0', named: '#3fa48d', minor: '#2b6c5e' }),
  // The carried-over world half, which has no tags left to classify. Grey, not
  // blue: unclassified must not look like "dam".
  '': Object.freeze({ major: '#b9c4cf', named: '#8b98a6', minor: '#5d6a77' }),
});

/**
 * The group key one feature draws under: what it is, then how much it matters.
 * @param {object} props Shipped feature properties.
 * @returns {string} `"<kind>:<tier>"`.
 */
export function damGroupKey(props) {
  const kind = isDamStructureKind(props?.kind) ? String(props.kind) : '';
  return `${kind}:${damTier(props)}`;
}

/** Split a composite key back into its two axes. */
export function damGroupParts(key) {
  const raw = String(key ?? '');
  const at = raw.lastIndexOf(':');
  if (at < 0) return { kind: '', tier: raw || 'minor' };
  return { kind: raw.slice(0, at), tier: raw.slice(at + 1) || 'minor' };
}

/**
 * Per-group styling, in the shape `createLocalGeoJsonLayer` reads.
 *
 * Two keys only: the colour (from the structure) and the card range (from the
 * tier). `pixelSize` and `stemWidth` are deliberately absent — the dot's size
 * is a per-feature measurement now, handed over by {@link damRenderSpec}, and
 * leaving a tier-shaped size here would silently win the merge for any feature
 * whose span was never measured.
 */
export const DAM_TIER_STYLES = Object.freeze(Object.fromEntries(
  Object.entries(STRUCTURE_RAMPS).flatMap(([kind, ramp]) => DAM_TIERS.map((tier) => [
    `${kind}:${tier.key}`,
    Object.freeze({
      color: ramp[tier.key],
      cardMaxDistance: tier.cardMaxDistance,
    }),
  ])),
));

/** The ICOLD threshold, in metres, that puts a dam in the top tier. */
export const LARGE_DAM_HEIGHT_M = 15;

/**
 * How long a NAMED structure has to be to reach the top tier without a height.
 * See "WHY SIZE ONLY COUNTS WITH A NAME ON IT" above before lowering it.
 */
export const MAJOR_DAM_SPAN_M = 300;

/**
 * Which tier one packed dam belongs to.
 *
 * Read top-down, first match wins. Serre-Ponçon is tall AND hydroelectric AND
 * named; it is a `major`, because putting it lower for also being named would
 * empty the top tier.
 *
 * @param {object} props Shipped feature properties.
 * @returns {string} A DAM_TIERS key. Always one of the three.
 */
export function damTier(props) {
  const source = props && typeof props === 'object' ? props : {};
  const name = text(source.name);
  const height = Number(source.heightM);
  const span = Number(source.spanM);
  if (Number.isFinite(height) && height >= LARGE_DAM_HEIGHT_M) return 'major';
  if (source.hydro === true) return 'major';
  if (name && Number.isFinite(span) && span >= MAJOR_DAM_SPAN_M) return 'major';
  if (name) return 'named';
  return 'minor';
}

/**
 * The display floors offered as row chips, from "show everything" downward.
 *
 * `keep` is written out per floor rather than derived from an index, so that
 * reordering DAM_TIERS can never silently redefine what a chip does. These are
 * RUNTIME params, not share-link state: the pack always ships whole and
 * `getStats().count` keeps reporting the total, so a floor hides markers
 * without losing them.
 */
export const DAM_DISPLAY_FLOORS = Object.freeze([
  Object.freeze({
    id: 'all',
    label: 'TOUS',
    keep: Object.freeze(['major', 'named', 'minor']),
    title: 'Tous les ouvrages du paquet',
  }),
  Object.freeze({
    id: 'named',
    label: 'NOMMÉS',
    keep: Object.freeze(['major', 'named']),
    title: 'Masquer les seuils et petits ouvrages sans nom',
  }),
  Object.freeze({
    id: 'major',
    label: 'GRANDS',
    keep: Object.freeze(['major']),
    title: 'Ne garder que les grands barrages et les ouvrages hydroélectriques',
  }),
]);

const FLOOR_BY_ID = new Map(DAM_DISPLAY_FLOORS.map((floor) => [floor.id, floor]));

/** The floor a params object selects, falling back to "show everything". */
export function damDisplayFloor(floorId) {
  return FLOOR_BY_ID.get(text(floorId)) || DAM_DISPLAY_FLOORS[0];
}

/**
 * Whether a tier is drawn under the given floor.
 * @param {string} tierKey A DAM_TIERS key.
 * @param {{floor?: string}} [params] Layer runtime params.
 * @returns {boolean}
 */
export function damTierVisible(groupKey, params = {}) {
  const { kind, tier } = damGroupParts(groupKey);
  if (!damDisplayFloor(params?.floor).keep.includes(tier)) return false;
  return damStructureVisible(kind, params);
}

/**
 * The structure chips — the second, orthogonal axis.
 *
 * Runtime params MERGE rather than replace in `createLocalGeoJsonLayer`, so
 * this row coexists with the importance floors without touching the share-link
 * grammar: `local-dams` keeps its single token and the floors stay runtime-only,
 * exactly as documented for `DAM_DISPLAY_FLOORS`.
 */
export const DAM_STRUCTURE_CHIPS = Object.freeze([
  Object.freeze({
    id: 'all',
    label: 'TOUS',
    keep: null,
    title: 'Barrages et digues ensemble',
  }),
  Object.freeze({
    id: 'dams',
    label: 'BARRAGES',
    // The ambiguous double-tagged features are kept by BOTH chips rather than
    // assigned to one: they genuinely are both, and hiding them from either
    // view would make a filter lie about what it excludes.
    keep: Object.freeze(['dam', 'dam+dyke', '']),
    title: 'Ouvrages en travers du cours d’eau (et non classés)',
  }),
  Object.freeze({
    id: 'dykes',
    label: 'DIGUES',
    keep: Object.freeze(['dyke', 'dam+dyke']),
    title: 'Remblais le long de l’eau — protection ou étang, OSM ne dit pas',
  }),
]);

const STRUCTURE_CHIP_BY_ID = new Map(DAM_STRUCTURE_CHIPS.map((chip) => [chip.id, chip]));

/** The structure chip a params object selects, falling back to "show everything". */
export function damStructureChip(chipId) {
  return STRUCTURE_CHIP_BY_ID.get(text(chipId)) || DAM_STRUCTURE_CHIPS[0];
}

/**
 * Whether a structure is drawn under the given chip.
 * @param {string} kind A key of DAM_STRUCTURES, or '' for unclassified.
 * @param {{kinds?: string}} [params]
 * @returns {boolean}
 */
export function damStructureVisible(kind, params = {}) {
  const chip = damStructureChip(params?.kinds);
  return chip.keep === null || chip.keep.includes(String(kind ?? ''));
}

/**
 * Build the row legend from a live per-tier tally.
 *
 * The count is what is DRAWN, not what is loaded: a legend still claiming 4,300
 * seuils while the NOMMÉS floor hides every one of them is a lie the panel
 * tells at a glance.
 *
 * @param {Map<string,{total:number, visible:number}>|object} tally Per-tier counts.
 * @returns {Array<{label:string,color:string,blurb:string,count:number}>}
 */
export function damTierLegend(tally) {
  const entries = tally instanceof Map ? [...tally] : Object.entries(tally || {});
  // The tally arrives keyed by the COMPOSITE `kind:tier`, and is folded onto
  // the STRUCTURE only. "How many of these are big" is no longer a legend
  // question — it is a size question, and the size rows answer it with the
  // metre bounds that produced them.
  const byKind = new Map();
  for (const [key, bucket] of entries) {
    if (!bucket?.total) continue;
    const { kind } = damGroupParts(key);
    const seen = byKind.get(kind) || { total: 0, visible: 0 };
    seen.total += bucket.total;
    seen.visible += bucket.visible ?? bucket.total;
    byKind.set(kind, seen);
  }
  const legend = [];
  const row = (label, color, blurb, bucket) => {
    if (!bucket?.total) return;
    const hidden = bucket.total - bucket.visible;
    legend.push({
      label,
      color,
      blurb: hidden > 0 ? `${blurb} — ${hidden} masqué${hidden > 1 ? 's' : ''}` : blurb,
      count: bucket.visible,
    });
  };
  // Structure first: it is the distinction this layer was getting wrong.
  for (const structure of DAM_STRUCTURES) {
    row(structure.label, STRUCTURE_RAMPS[structure.key].named, structure.blurb, byKind.get(structure.key));
  }
  row(
    'Non classé',
    STRUCTURE_RAMPS[''].named,
    'Hors de France : reprise d’un instantané plus ancien, dont les tags OSM ne sont plus disponibles.',
    byKind.get(''),
  );
  // The TIER rows used to follow, one per rung, each with its own blue. They
  // are gone with the tier's pixel sizes: a legend row is a promise that the
  // reader will find that sign on the map, and after the size handover there
  // is no mark on the globe that says "Grand barrage" — the three blues in the
  // old rows were the same three blues as the structure rows above, printed
  // twice. What tier still does — decide how far out a card is offered, and
  // what the TOUS/NOMMÉS/GRANDS chips keep — is stated by the chips' own
  // titles, right beside them. The size rows that follow in the panel come
  // from `damSpanLegend`, and every one of them names a mark on the globe.
  return legend;
}

/* ══════════════════════════════════════════════════════════════════════════
 * SIZE — the measured span, on the channel B1 reserves for it
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * The four span classes, longest first, with the pixel diameter each draws at.
 *
 * Thresholds are FROZEN DOMAIN values (C1): 100 m, 300 m and 1 000 m are round
 * metre counts a reader can hold, not quantiles of the visible sample, so a dam
 * never changes size because the camera moved. 300 m is also the threshold
 * `MAJOR_DAM_SPAN_M` already uses, which keeps the two ladders commensurable.
 *
 * Diameters are 6 / 9 / 13 / 18 px. They are NOT proportional to the span —
 * they cannot be: 25 m to 6 399 m is a factor 256, and an honest diameter would
 * need either 1 500 px or a floor of a quarter of a pixel. What is proportional
 * is the ORDER, and the classes are declared as classes, with their bounds
 * printed in the legend, rather than dressed up as a continuous scale.
 *
 * `count` is the shipped pack's population, quoted so a re-extraction that
 * moves it shows up as a stale comment.
 */
export const DAM_SPAN_CLASSES = Object.freeze([
  Object.freeze({ key: 'span1000', minM: 1000, label: '1 000 m et plus', pixelSize: 18, count: 116 }),
  Object.freeze({ key: 'span300', minM: 300, label: '300 – 999 m', pixelSize: 13, count: 439 }),
  Object.freeze({ key: 'span100', minM: 100, label: '100 – 299 m', pixelSize: 9, count: 2132 }),
  Object.freeze({ key: 'span25', minM: DAM_MIN_SPAN_M, label: '25 – 99 m', pixelSize: 6, count: 2641 }),
]);

/**
 * The class for a structure whose span was never measured — 2 104 features,
 * 28.3 % of the pack, 660 of them the tag-less world snapshot.
 *
 * A HOLLOW ring at 8 px: hollow because A1 forbids "unmeasured" from wearing
 * the same mark as a measurement, and 8 px because a ring smaller than the
 * smallest disc would still be read as "short".
 */
export const DAM_SPAN_UNKNOWN = Object.freeze({
  key: 'nospan',
  label: 'Longueur non mesurée',
  pixelSize: 8,
  count: 2104,
});

const SPAN_CLASS_BY_KEY = new Map([
  ...DAM_SPAN_CLASSES.map((entry) => [entry.key, entry]),
  [DAM_SPAN_UNKNOWN.key, DAM_SPAN_UNKNOWN],
]);

/**
 * Which span class one packed dam draws at.
 *
 * A span below {@link DAM_MIN_SPAN_M} is treated as unmeasured, not as tiny:
 * the build already refuses to ship one, and the reasoning is the same — below
 * 25 m the number says more about how carefully one volunteer traced a sketch
 * than about the structure.
 *
 * @param {object} props Shipped feature properties.
 * @returns {string} A {@link DAM_SPAN_CLASSES} key, or `nospan`.
 */
export function damSpanClass(props) {
  const span = Number(props && typeof props === 'object' ? props.spanM : NaN);
  if (!Number.isFinite(span) || span < DAM_MIN_SPAN_M) return DAM_SPAN_UNKNOWN.key;
  for (const entry of DAM_SPAN_CLASSES) {
    if (span >= entry.minM) return entry.key;
  }
  return DAM_SPAN_UNKNOWN.key;
}

/**
 * The render contract this pack hands `createLocalGeoJsonLayer` — one object
 * per feature, resolved once at load, in the shape documented there.
 *
 * `surface` is null on purpose: the 1 849 dam polygons keep the flat clamped
 * fill they have always had. A dam wall is a linear object mapped as a thin
 * sliver, and extruding it by a height 97.7 % of the pack does not publish
 * would be exactly the invention this module refuses above.
 *
 * @param {object} props Shipped feature properties.
 * @returns {object} Render spec.
 */
export function damRenderSpec(props) {
  const key = damSpanClass(props);
  const entry = SPAN_CLASS_BY_KEY.get(key) || DAM_SPAN_UNKNOWN;
  return {
    key,
    pixelSize: entry.pixelSize,
    hollow: key === DAM_SPAN_UNKNOWN.key,
    color: null,
    surface: null,
    fillAlpha: null,
    extrudedHeightM: null,
  };
}

/* ── Legend glyphs ─────────────────────────────────────────────────────────
 * Masked by the panel, so the fill written here is discarded and the row's
 * `color` shows through. Only the SHAPE survives, which is the point: these
 * rows encode size, and a hue that moved with them would be a second, false
 * encoding.
 */

const _b64 = (value) => (typeof btoa === 'function'
  ? btoa(value)
  : Buffer.from(value, 'utf8').toString('base64'));

const GLYPH_BOX = 18;
/** @type {Map<string,string>} shape key → data URI. */
const _glyphCache = new Map();

/** A filled disc of the given screen diameter, drawn 1:1 in the swatch box. */
function spanDiscGlyph(pixelSize) {
  const key = `disc:${pixelSize}`;
  const cached = _glyphCache.get(key);
  if (cached) return cached;
  const radius = Math.max(1, Math.min(GLYPH_BOX / 2, Number(pixelSize) / 2 || 1));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GLYPH_BOX} ${GLYPH_BOX}">`
    + `<circle cx="9" cy="9" r="${radius.toFixed(2)}" fill="#000"/></svg>`;
  const uri = `data:image/svg+xml;base64,${_b64(svg)}`;
  _glyphCache.set(key, uri);
  return uri;
}

/** The hollow ring the unmeasured class draws. */
function spanRingGlyph() {
  const cached = _glyphCache.get('ring');
  if (cached) return cached;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GLYPH_BOX} ${GLYPH_BOX}">`
    + '<circle cx="9" cy="9" r="3.4" fill="none" stroke="#000" stroke-width="1.6"/></svg>';
  const uri = `data:image/svg+xml;base64,${_b64(svg)}`;
  _glyphCache.set('ring', uri);
  return uri;
}

/**
 * Graphite for every size row. ONE colour, because in these rows the datum is
 * the swatch's diameter; a hue that moved with it would encode the same fact
 * twice (A3). The structure rows above are where colour means something.
 */
export const DAM_SIZE_SWATCH_COLOR = '#c3ccd8';

/**
 * Build the size legend from a live tally keyed by {@link damRenderSpec}.
 *
 * This is the scale the size channel cannot do without (D1): four classes with
 * their metre bounds printed, plus the hollow ring that says a quarter of the
 * layer was never measured. Counts are what is DRAWN, so a floor that hides
 * the small ouvrages empties these rows rather than lying about them.
 *
 * @param {Map<string,{total:number, visible:number}>|object} tally
 * @returns {Array<{label:string,color:string,glyph:string,blurb:string,count:number}>}
 */
export function damSpanLegend(tally) {
  const entries = tally instanceof Map ? [...tally] : Object.entries(tally || {});
  const byClass = new Map();
  for (const [key, bucket] of entries) {
    if (!bucket?.total) continue;
    const seen = byClass.get(String(key)) || { total: 0, visible: 0 };
    seen.total += bucket.total;
    seen.visible += bucket.visible ?? bucket.total;
    byClass.set(String(key), seen);
  }
  const legend = [];
  const blurb = 'Plus longue dimension mesurée sur la géométrie OSM. Seuils '
    + 'de domaine gelés (100, 300, 1 000 m), jamais recalculés sur ce qui est '
    + 'à l’écran.';
  for (const entry of DAM_SPAN_CLASSES) {
    const bucket = byClass.get(entry.key);
    if (!bucket?.total) continue;
    legend.push({
      label: entry.label,
      color: DAM_SIZE_SWATCH_COLOR,
      glyph: spanDiscGlyph(entry.pixelSize),
      blurb,
      count: bucket.visible,
    });
  }
  const unknown = byClass.get(DAM_SPAN_UNKNOWN.key);
  if (unknown?.total) {
    legend.push({
      label: DAM_SPAN_UNKNOWN.label,
      color: DAM_SIZE_SWATCH_COLOR,
      glyph: spanRingGlyph(),
      blurb: 'Anneau creux, jamais un petit disque : OpenStreetMap ne publie '
        + 'ici ni géométrie exploitable ni longueur. 28 % du paquet, dont '
        + 'l’instantané mondial repris sans géométrie.',
      count: unknown.visible,
    });
  }
  return legend;
}

/**
 * Label-grid priority for one packed dam.
 *
 * The base and the top step (70 + 240 = 310) deliberately match the ports and
 * airports ladders: all three publish into the one shared `ambient-card`
 * collision group, so scales that drift apart would silently decide which layer
 * wins a cell.
 *
 * @param {object} props Shipped feature properties.
 * @returns {number} Additive contribution to the shared label priority.
 */
export function damLabelPriority(props) {
  return 70 + (TIER_BY_KEY.get(damTier(props))?.priority ?? 0);
}

/**
 * Format a metre count the way French reads it — `1 205 m`, with an ordinary
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
 * The card body for one packed dam — up to three lines, in the order a reader
 * wants them: who runs it, what it is made of and how big, what it sits on.
 *
 * The title is NOT produced here; the shared local-layer host derives it from
 * `name`. Lines are returned unclamped, because the host owns the width.
 *
 * @param {object} props Shipped feature properties.
 * @returns {string[]} 0–3 detail lines, French, empty entries already dropped.
 */
export function damCardDetails(props) {
  const source = props && typeof props === 'object' ? props : {};
  const title = text(source.name).toLocaleLowerCase('fr-FR');
  const lines = [];

  // Who and what it does. `hydroélectrique` is only spelt out when there is no
  // operator to say it — "EDF · hydroélectrique" tells a French reader nothing
  // the first word did not.
  const operator = text(source.operator);
  const output = Number(source.outputMw);
  const identity = [
    source.abandoned === true ? 'Désaffecté' : '',
    operator && operator.toLocaleLowerCase('fr-FR') !== title ? operator : '',
    !operator && source.hydro === true ? 'hydroélectrique' : '',
    Number.isFinite(output) && output > 0
      ? `${output >= 10 ? Math.round(output) : output} MW`
      : '',
  ].filter(Boolean).join(' · ');
  if (identity) lines.push(identity);

  // How big, then what of. Height is the fact the tier ladder turns on, so it
  // leads; span is measured off the mapped geometry and follows it.
  const height = Number(source.heightM);
  const span = Number(source.spanM);
  const shape = [
    Number.isFinite(height) && height > 0 ? `${metresText(height)} de haut` : '',
    Number.isFinite(span) && span >= DAM_MIN_SPAN_M ? `${metresText(span)} de long` : '',
    text(source.material),
  ].filter(Boolean).join(' · ');
  if (shape) lines.push(shape);

  // Where and when. The river is dropped when it merely repeats the title —
  // "Barrage de la Rance" over "La Rance" is one fact printed twice.
  const river = text(source.river);
  const year = Number(source.builtYear);
  const place = [
    river && !title.includes(river.toLocaleLowerCase('fr-FR')) ? river : '',
    Number.isFinite(year) && year > 0 ? String(year) : '',
  ].filter(Boolean).join(' · ');
  if (place) lines.push(place);

  return lines;
}
