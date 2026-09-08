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
 * OurAirports publishes 86,050 rows. Shipped whole that is roughly 25 MB of
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

import { sizeBarGlyph, sizeDiscGlyph, sizeRingGlyph } from './sizeLegendGlyphs.js';

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
 * Surface FAMILIES, not surface values. The upstream column is free text — 627
 * distinct spellings across 48,230 runways, from `ASP` and `ASPH-G` to
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
 * OurAirports fills `icao_code` for only 10,823 of its 86,050 rows, yet its own
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

/* ══════════════════════════════════════════════════════════════════════════
 * RUNWAY GEOMETRY — the shape an airport has, and the two rows that are refused
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `runways.csv` publishes BOTH thresholds of a strip — the `le_latitude_deg` /
 * `le_longitude_deg` pair and the `he_` pair — plus its width. That is a real
 * oriented metric object: the one thing an airport IS and a dot is not. The
 * layer draws it, so the pack has to carry it.
 *
 * Measured on the 2026-09-07 retrieval, over the 7 464 rows the policy keeps:
 *
 *     open runway rows                 8 418
 *     … with two distinct thresholds   6 830   81.1 %
 *     … surviving the two refusals     6 698   79.6 %
 *     airports with ≥ 1 kept runway    4 790   64.2 %  (1 478 of them multi-runway)
 *     … in France + territories          279   20.9 %
 *
 * BY TIER — AND THE ASYMMETRY IS THE WHOLE DESIGN CONSTRAINT
 *
 *     Grand aéroport         1 091 / 1 173   93.0 %
 *     Aéroport sans ligne    1 539 / 1 990   77.3 %
 *     Aéroport de ligne      2 071 / 3 175   65.2 %
 *     Aérodrome & aéroclub       89 / 1 126    7.9 %   ← every one of them French
 *
 * The French long tail — the half of this pack that no global source answers,
 * and the reason clause (c) exists — is exactly the half upstream never
 * georeferenced. So the runway can NEVER be the only sign this layer knows:
 * drawn as the sole mark it would erase 92 % of the aéroclubs from a layer
 * whose entire argument is that they are there. What survives for them is the
 * anchor pastille, and it carries a measurement of its own — see
 * {@link AIRPORT_LENGTH_CLASSES}, which is fed by `length_ft` and covers 82 %.
 *
 * ── THE TWO REFUSALS ────────────────────────────────────────────────────────
 *
 * They live here, not in the build script, because they are claims about what
 * a mark may assert — and this is the module that owns those. Both are cheap
 * consistency tests between two independently published numbers:
 *
 *   1. LENGTH DISAGREEMENT. The distance between the two thresholds and the
 *      published `length_ft` are separate fields, and they should agree. On
 *      6 826 rows the median disagreement is 0.36 % — but 467 rows are more
 *      than 10 % apart and 20 are more than 50 %. Beyond
 *      {@link RUNWAY_GEOM_LENGTH_TOLERANCE} one of the two is simply wrong,
 *      and a runway drawn from a wrong threshold is a runway drawn in the
 *      wrong place. 128 rows refused.
 *   2. ANCHOR OFFSET. A runway belongs to the field it is joined to. Measured
 *      offsets from the airport's own point: median 130 m, p95 1 184 m,
 *      p99 2 170 m — and a maximum of 36 008 m, which is a bad join, not a
 *      long taxiway. Beyond {@link RUNWAY_GEOM_MAX_ANCHOR_OFFSET_M} the row is
 *      refused. 1 row, and it is the 36 km one.
 *
 * Note what is NOT refused: the 440 m grass helicopter lane `08H/26H` that
 * makes Charles de Gaulle report `count: 5`. The file header apologises for
 * that number in prose. Drawn to scale beside four strips of 2 700 to 4 215 m,
 * it explains itself — which is the better fix.
 */

/** Mean Earth radius (IUGG), for the two consistency tests above. */
const EARTH_RADIUS_M = 6_371_008.8;

/** Coordinate precision the pack emits — 5 decimals, about 1 m. */
const GEOM_DECIMALS = 5;

/**
 * How far the threshold-to-threshold distance may sit from the published
 * `length_ft` before the row is refused, as a fraction of the published value.
 */
export const RUNWAY_GEOM_LENGTH_TOLERANCE = 0.25;

/** How far a runway's midpoint may sit from its airport's point, in metres. */
export const RUNWAY_GEOM_MAX_ANCHOR_OFFSET_M = 10_000;

/**
 * Great-circle distance between two lon/lat pairs, in metres.
 *
 * Haversine on a sphere: at runway scale (kilometres) the difference from a
 * WGS84 geodesic is millimetres, and this module must stay dependency-free so
 * the build script and the browser can both import it as-is.
 *
 * @param {number} lon1
 * @param {number} lat1
 * @param {number} lon2
 * @param {number} lat2
 * @returns {number} Metres.
 */
export function greatCircleMetres(lon1, lat1, lon2, lat2) {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Round to {@link GEOM_DECIMALS} without `-0` or `4.20000000001`. */
function roundCoord(value) {
  return Number(Number(value).toFixed(GEOM_DECIMALS)) + 0;
}

/** A finite number from a CSV cell, or null — `''` must not become 0. */
function coordinate(raw) {
  const value = text(raw);
  if (value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The drawable runways of one airport, longest first.
 *
 * Each entry is `[lon1, lat1, lon2, lat2]`, with the metre width appended as a
 * fifth element when upstream publishes one — which it does on 99.9 % of the
 * rows that survive here (median 45 m). The width is OMITTED rather than
 * defaulted: A1 forbids a mark whose thickness claims a measurement nobody
 * made, so the renderer strokes an unwidthed runway at its minimum instead.
 *
 * Longest first is not cosmetic. The layer draws `geom[0]` alone at range and
 * opens the rest of the field only close in, so index 0 has to be the strip a
 * reader means when they say "the runway".
 *
 * @param {object[]} runways Raw `runways.csv` rows already filtered to one airport.
 * @param {{lon:number, lat:number}|null} [anchor] The airport's own point, for
 *   the offset refusal. Omitted, that refusal simply does not run.
 * @returns {Array<number[]>} 0..n segments, longest first. Never null.
 */
export function runwayGeometry(runways, anchor = null) {
  const rows = Array.isArray(runways) ? runways : [];
  const kept = [];
  for (const row of rows) {
    if (text(row?.closed) === '1') continue;
    const lon1 = coordinate(row?.le_longitude_deg);
    const lat1 = coordinate(row?.le_latitude_deg);
    const lon2 = coordinate(row?.he_longitude_deg);
    const lat2 = coordinate(row?.he_latitude_deg);
    if (lon1 === null || lat1 === null || lon2 === null || lat2 === null) continue;
    if (Math.abs(lat1) > 90 || Math.abs(lat2) > 90) continue;
    if (Math.abs(lon1) > 180 || Math.abs(lon2) > 180) continue;
    // Null Island is a missing coordinate, not a threshold in the Gulf of
    // Guinea — the same rule the build applies to the airport's own point.
    if ((lon1 === 0 && lat1 === 0) || (lon2 === 0 && lat2 === 0)) continue;
    // A zero-length "runway" is one threshold entered twice.
    if (lon1 === lon2 && lat1 === lat2) continue;

    const span = greatCircleMetres(lon1, lat1, lon2, lat2);
    if (!(span > 0)) continue;

    // Refusal 1 — the two published numbers must agree.
    const feet = Number(text(row?.length_ft));
    if (Number.isFinite(feet) && feet > 0) {
      const published = feet * FEET_TO_METRES;
      if (Math.abs(span - published) / published > RUNWAY_GEOM_LENGTH_TOLERANCE) continue;
    }

    // Refusal 2 — the runway must belong to the field it is joined to.
    if (anchor && Number.isFinite(anchor.lon) && Number.isFinite(anchor.lat)) {
      const offset = greatCircleMetres(
        anchor.lon, anchor.lat, (lon1 + lon2) / 2, (lat1 + lat2) / 2,
      );
      if (offset > RUNWAY_GEOM_MAX_ANCHOR_OFFSET_M) continue;
    }

    const segment = [roundCoord(lon1), roundCoord(lat1), roundCoord(lon2), roundCoord(lat2)];
    const widthFeet = Number(text(row?.width_ft));
    if (Number.isFinite(widthFeet) && widthFeet > 0) {
      segment.push(Math.round(widthFeet * FEET_TO_METRES));
    }
    // Ordered on the SHIPPED coordinates, not on the full-precision ones the
    // refusals were tested against. Kamina Air Base has two strips 2.4 cm
    // apart: rounding to 5 decimals flips them, and the renderer — which only
    // ever sees the rounded pair — would then disagree with the order in the
    // file about which one is "the runway".
    kept.push({ span: greatCircleMetres(segment[0], segment[1], segment[2], segment[3]), segment });
  }
  // Longest first. The tie-break is the serialized coordinates rather than the
  // upstream row order, because this file is committed: two runs over the same
  // input have to produce the same bytes whatever order the CSV arrived in.
  kept.sort((a, b) => (b.span - a.span)
    || (String(a.segment) < String(b.segment) ? -1 : String(a.segment) > String(b.segment) ? 1 : 0));
  return kept.map((entry) => entry.segment);
}

/**
 * Read the shipped runway geometry back, defensively.
 *
 * The renderer calls this per feature at load, so it has to survive a pack
 * built by an older script (no `geom` at all) and a hand-edited fixture, and
 * it must never hand the scene a half-parsed segment.
 *
 * @param {object} props Shipped feature properties.
 * @returns {Array<{lon1:number,lat1:number,lon2:number,lat2:number,widthM:number|null}>}
 */
export function airportRunwaySegments(props) {
  const runways = props && typeof props === 'object' ? props.runways : null;
  const geom = runways && typeof runways === 'object' ? runways.geom : null;
  if (!Array.isArray(geom)) return [];
  const out = [];
  for (const entry of geom) {
    if (!Array.isArray(entry) || entry.length < 4) continue;
    const [lon1, lat1, lon2, lat2, widthM] = entry;
    if (![lon1, lat1, lon2, lat2].every((value) => Number.isFinite(value))) continue;
    out.push({
      lon1,
      lat1,
      lon2,
      lat2,
      // Null, never a default: an unwidthed runway is stroked at the minimum,
      // and must not be able to claim the median 45 m it never published.
      widthM: Number.isFinite(widthM) && widthM > 0 ? widthM : null,
    });
  }
  return out;
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
 * `geom` rides along in the same object because it answers the same question
 * from the same rows — what can land here, and where. It is the ONLY field of
 * this summary the card never prints: it is drawn, not written.
 *
 * @param {object[]} runways Raw `runways.csv` rows already filtered to one airport.
 * @param {{lon:number, lat:number}|null} [anchor] The airport's point, for
 *   {@link runwayGeometry}'s offset refusal.
 * @returns {{count:number, longestM?:number, surface?:string, lighted?:boolean, geom?:Array<number[]>}}
 */
export function summarizeRunways(runways, anchor = null) {
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
  // Last, so the shipped object reads identity-then-shape and the diff of a
  // rebuild puts the long array at the end of the line rather than the middle.
  const geom = runwayGeometry(open, anchor);
  if (geom.length > 0) summary.geom = geom;
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
 * are four grades of ONE thing, and an ordered series must vary in VALUE and
 * not only in hue (B4). Against a light IGN basemap the brightest step needs
 * help, which is what the renderer's black point outline is for — it was
 * already there, and it is the reason the size channel could be freed.
 *
 * ── WHAT THE SIZE CHANNEL USED TO CARRY, AND WHY IT DOES NOT ANY MORE ───────
 *
 * The tier: 14 / 10.5 / 8 / 6 px. So the dot's diameter and the dot's
 * brightness said the same four-valued thing, which is A3 — one canal, one
 * information — and the pack's own README says why it was wrong on top of
 * that: `type` is "OurAirports' editorial SIZE bucket … driven mostly by
 * traffic and RUNWAY LENGTH". The layer was painting the proxy while carrying
 * the measurement, on 82 % of its features, unused.
 *
 * Size now carries `longestM` ({@link AIRPORT_LENGTH_CLASSES}). Tier keeps the
 * three channels that are its own and that nothing competes for: colour, the
 * label ladder's priority, and the two distances below. Same move
 * `damsPack.js` made next door, for the same reason — which is why
 * `pixelSize` and `stemWidth` are absent from {@link AIRPORT_TIER_STYLES}: a
 * tier-shaped size left there would silently win the merge against a feature
 * whose runway was never measured.
 *
 * ── THE TWO DISTANCES ───────────────────────────────────────────────────────
 *
 * `cardMaxDistance` is how far out the NAME is still offered. `markerMaxDistance`
 * is how far out the MARK is drawn at all, and it is new. It exists because
 * the `airfield` tier is 100 % French — clause (c) is the only one that admits
 * a small field with no scheduled service, and it is France-only — so a globe
 * that draws all four tiers from orbit reports a French aerodrome density that
 * is an artefact of the SELECTION, not of the world. That is the second of A4's
 * three empties, and it was undeclared.
 *
 * 900 km for `airfield` is derived, not chosen: France spans about 1 000 km, and
 * at ~870 km a 1 000 km span fills a 1080 px viewport. The aéroclubs therefore
 * arrive exactly when France is the subject of the frame, and not before. The
 * others are set to about 2.5× their card range, so the mark always precedes
 * the name it belongs to rather than arriving with it.
 */
export const AIRPORT_TIERS = Object.freeze([
  Object.freeze({
    key: 'hub',
    label: 'Grand aéroport',
    color: '#f0e6ff',
    stemWidth: 3.5,
    priority: 240,
    // Readable from orbit: the shared local-layer ceiling, unchanged.
    cardMaxDistance: 14_000_000,
    markerMaxDistance: 14_000_000,
    blurb: 'Classe « large » d’OurAirports — le trafic et la longueur de piste. Roissy, Heathrow, JFK.',
  }),
  Object.freeze({
    key: 'airline',
    label: 'Aéroport de ligne',
    color: '#c8a6ff',
    stemWidth: 3,
    priority: 170,
    // Continental scale — the card arrives once a country fills the screen.
    cardMaxDistance: 3_000_000,
    markerMaxDistance: 7_500_000,
    blurb: 'Dessert au moins une ligne régulière — un billet s’y achète.',
  }),
  Object.freeze({
    key: 'airport',
    label: 'Aéroport sans ligne',
    color: '#9a7ad1',
    stemWidth: 2.5,
    priority: 110,
    // Regional scale.
    cardMaxDistance: 1_200_000,
    markerMaxDistance: 3_000_000,
    blurb: 'Classe « medium » sans service régulier : bases aériennes, aviation d’affaires, terrains de fret.',
  }),
  Object.freeze({
    key: 'airfield',
    label: 'Aérodrome & aéroclub',
    color: '#6d5a94',
    stemWidth: 2,
    // Départemental scale, and the number that stops Île-de-France reading as
    // fifteen aéroclubs and three airports. Only the CARD waits this long; the
    // mark itself arrives at `markerMaxDistance`, which is where France stops
    // overflowing the frame.
    cardMaxDistance: 200_000,
    markerMaxDistance: 900_000,
    blurb: 'Terrain sans ligne régulière — aéroclubs, altisurfaces, hydrobases. France uniquement dans ce paquet.',
    priority: 30,
  }),
]);

const TIER_BY_KEY = new Map(AIRPORT_TIERS.map((tier) => [tier.key, tier]));

/**
 * Per-tier styling, in the shape `createLocalGeoJsonLayer` reads.
 *
 * `pixelSize` is deliberately absent — see the ladder's header. The dot's size
 * is a per-feature measurement now, handed over by {@link airportRenderSpec},
 * and a tier-shaped size left here would win the merge for every feature whose
 * runway length was never published.
 */
export const AIRPORT_TIER_STYLES = Object.freeze(Object.fromEntries(
  AIRPORT_TIERS.map((tier) => [tier.key, Object.freeze({
    color: tier.color,
    stemWidth: tier.stemWidth,
    cardMaxDistance: tier.cardMaxDistance,
    markerMaxDistance: tier.markerMaxDistance,
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
    // A5: an écrêtage declares its CRITERION, not only its count. The marker
    // range is one, and it is invisible by construction — a reader who never
    // descends below 900 km has no way of learning that the aéroclubs exist.
    const range = tier.markerMaxDistance < 14_000_000
      ? ` Marque affichée sous ${Math.round(tier.markerMaxDistance / 1000).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} km.`
      : '';
    legend.push({
      label: tier.label,
      color: tier.color,
      blurb: `${tier.blurb}${range}${hidden > 0 ? ` — ${hidden} masqué${hidden > 1 ? 's' : ''}` : ''}`,
      count: bucket.visible ?? bucket.total,
    });
  }
  return legend;
}

/* ══════════════════════════════════════════════════════════════════════════
 * SIZE — the published runway length, on the channel B1 reserves for it
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `longestM` is the longest OPEN runway, in metres, on 6 150 of the 7 464
 * features (82 %). Deciles over the shipped pack: 1 000 / 1 297 / 1 531 /
 * 1 829 / 2 100 / 2 435 / 2 601 / 3 000 / 3 353, min 8, max 5 120. It is an
 * absolute quantity — the one B1 says must take the size channel — and it is
 * the number that answers what a reader actually asks of an airfield: what can
 * land here.
 *
 * ── WHY CLASSES AND NOT A CONTINUOUS RADIUS ─────────────────────────────────
 *
 * The same reason `damsPack.js` gives: a disc's AREA is what a reader decodes,
 * so an honest continuous scale would need √, and over a 1:640 domain that
 * leaves the bottom half of the pack inside two pixels of each other. Four
 * declared classes with their bounds printed beat a continuous scale nobody
 * can read back. What is proportional is the ORDER.
 *
 * The bounds are FROZEN DOMAIN values (C1) — never quantiles of what is on
 * screen — and they are operational rather than statistical, so a reader can
 * hold them:
 *
 *     ≥ 3 000 m       1 280   17.2 %   long-courrier / gros-porteur
 *     1 800 – 2 999 m 2 577   34.5 %   moyen-courrier (l'A320 demande ~1 800 m)
 *     1 000 – 1 799 m 1 690   22.6 %   turbopropulseur, aviation d'affaires
 *     < 1 000 m         603    8.1 %   aviation légère
 *     non publiée     1 314   17.6 %
 *
 * Constant PIXELS, never world units: the renderer sets `PointGraphics.pixelSize`
 * and no `scaleByDistance`, so nothing composes with the 1/z the perspective
 * already applies (B2).
 *
 * ── THE PASTILLE IS THE RUNWAY SEEN WITHOUT ITS BEARING ─────────────────────
 *
 * The diameters here are the SAME ladder the renderer uses as the minimum
 * screen length of the drawn runway. That is not a coincidence to be tidied
 * away: far out, the pastille's diameter IS the runway's floored length, and
 * as the camera closes the runway grows out of it and takes over. One
 * measurement, one ladder, two ranges — LOD, not the duplicate encoding A3
 * forbids, because at any given distance only one of the two is legible.
 *
 * 8 px for the unmeasured ring sits between the 6 and the 9 on purpose: a ring
 * smaller than the smallest disc would still be read as "short", and "not
 * published" is not a short runway.
 */

/** The four length classes, longest first, with the pixel diameter each draws. */
export const AIRPORT_LENGTH_CLASSES = Object.freeze([
  Object.freeze({ key: 'len3000', minM: 3000, label: '3 000 m et plus', pixelSize: 18, count: 1280 }),
  Object.freeze({ key: 'len1800', minM: 1800, label: '1 800 – 2 999 m', pixelSize: 13, count: 2577 }),
  Object.freeze({ key: 'len1000', minM: 1000, label: '1 000 – 1 799 m', pixelSize: 9, count: 1690 }),
  Object.freeze({ key: 'len0', minM: 0, label: 'moins de 1 000 m', pixelSize: 6, count: 603 }),
]);

/** The class for a field whose runway length OurAirports never published. */
export const AIRPORT_LENGTH_UNKNOWN = Object.freeze({
  key: 'nolength',
  label: 'Longueur non publiée',
  pixelSize: 8,
  count: 1314,
});

/**
 * Suffix marking a feature whose runway is also DRAWN, not only sized.
 *
 * It rides on the render-spec key because the renderer tallies exactly one key
 * per feature, and the legend needs two different counts out of that one tally:
 * how many fields are in each length class, and how many of them upstream
 * georeferenced. Stripped by {@link airportLengthClassOf} before any lookup.
 */
export const AIRPORT_DRAWN_RUNWAY_SUFFIX = '+rw';

const LENGTH_CLASS_BY_KEY = new Map([
  ...AIRPORT_LENGTH_CLASSES.map((entry) => [entry.key, entry]),
  [AIRPORT_LENGTH_UNKNOWN.key, AIRPORT_LENGTH_UNKNOWN],
]);

/** The length class inside a render-spec key, with the drawn-runway suffix off. */
export function airportLengthClassOf(key) {
  const raw = String(key ?? '');
  return raw.endsWith(AIRPORT_DRAWN_RUNWAY_SUFFIX)
    ? raw.slice(0, -AIRPORT_DRAWN_RUNWAY_SUFFIX.length)
    : raw;
}

/**
 * Which length class one packed airport draws at.
 *
 * A non-positive or absent `longestM` is unmeasured, never zero-length. The 42
 * features under 300 m are kept in the bottom class rather than refused: unlike
 * a span traced off volunteer geometry, `length_ft` is a PUBLISHED attribute,
 * and a 440 m helicopter lane really is under 1 000 m.
 *
 * @param {object} props Shipped feature properties.
 * @returns {string} An {@link AIRPORT_LENGTH_CLASSES} key, or `nolength`.
 */
export function airportLengthClass(props) {
  const runways = props && typeof props === 'object' ? props.runways : null;
  const longest = Number(runways && typeof runways === 'object' ? runways.longestM : NaN);
  if (!Number.isFinite(longest) || longest <= 0) return AIRPORT_LENGTH_UNKNOWN.key;
  for (const entry of AIRPORT_LENGTH_CLASSES) {
    if (longest >= entry.minM) return entry.key;
  }
  return AIRPORT_LENGTH_UNKNOWN.key;
}

/**
 * The render contract this pack hands `createLocalGeoJsonLayer` — one object
 * per feature, resolved once at load, in the shape documented there.
 *
 * `surface` stays null: an airport is not a footprint this pack ships, and the
 * runway it DOES ship is drawn as a line by the renderer, not as a polygon
 * here. `lines` is the pack's own extension to the contract, and the renderer
 * is the only reader of it.
 *
 * @param {object} props Shipped feature properties.
 * @returns {object} Render spec.
 */
export function airportRenderSpec(props) {
  const classKey = airportLengthClass(props);
  const entry = LENGTH_CLASS_BY_KEY.get(classKey) || AIRPORT_LENGTH_UNKNOWN;
  const lines = airportRunwaySegments(props);
  return {
    key: lines.length > 0 ? `${classKey}${AIRPORT_DRAWN_RUNWAY_SUFFIX}` : classKey,
    pixelSize: entry.pixelSize,
    hollow: classKey === AIRPORT_LENGTH_UNKNOWN.key,
    color: null,
    surface: null,
    fillAlpha: null,
    extrudedHeightM: null,
    /** Minimum screen length of the drawn runway — the pastille's own diameter. */
    lineFloorPx: entry.pixelSize,
    /**
     * Where the runway stands before the terrain sample lands.
     *
     * `elevationM` is the PUBLISHED field elevation (95.8 % of the pack) and is
     * the right number for a runway by definition. It is orthometric, and the
     * globe wants ellipsoidal, so it is short by the local geoid undulation —
     * about 48 m in France, at most ~106 m anywhere. That is 0.6 px at the 80 km
     * where it still matters, against the ~2 000 m an alpine field would sink
     * without it, and it costs no lookup: correcting it properly would mean
     * blocking the layer on a 2.7 MB EGM96 chunk for less than a pixel.
     */
    lineBaseM: Number.isFinite(Number(props?.elevationM)) ? Number(props.elevationM) : 0,
    lines,
  };
}

/**
 * Graphite for every size row. ONE colour, because in these rows the datum is
 * the swatch's diameter; a hue that moved with it would encode the same fact
 * twice (A3). The tier rows above are where colour means something.
 */
export const AIRPORT_SIZE_SWATCH_COLOR = '#c3ccd8';

/**
 * Build the size legend from a live tally keyed by {@link airportRenderSpec}.
 *
 * This is the scale the size channel cannot do without (D1): four classes with
 * their metre bounds printed, the hollow ring that says a sixth of the layer
 * was never published, and one row for the runway mark itself — because a line
 * drawn at a true length and a true bearing is a measurement on the map, and
 * D1 applies to it exactly as it applies to a colour.
 *
 * Counts are what is DRAWN, so a display chip that hides four fifths of the
 * pack empties these rows rather than lying about them.
 *
 * @param {Map<string,{total:number, visible:number}>|object} tally
 * @returns {Array<{label:string,color:string,glyph:string,blurb:string,count:number}>}
 */
export function airportLengthLegend(tally) {
  const entries = tally instanceof Map ? [...tally] : Object.entries(tally || {});
  const byClass = new Map();
  let drawnRunways = 0;
  for (const [key, bucket] of entries) {
    if (!bucket?.total) continue;
    const raw = String(key);
    const visible = bucket.visible ?? bucket.total;
    if (raw.endsWith(AIRPORT_DRAWN_RUNWAY_SUFFIX)) drawnRunways += visible;
    const classKey = airportLengthClassOf(raw);
    const seen = byClass.get(classKey) || { total: 0, visible: 0 };
    seen.total += bucket.total;
    seen.visible += visible;
    byClass.set(classKey, seen);
  }

  const legend = [];
  const blurb = 'Plus longue piste OUVERTE publiée par OurAirports. Seuils de '
    + 'domaine gelés (1 000, 1 800, 3 000 m), jamais recalculés sur ce qui est '
    + 'à l’écran. Le diamètre est aussi la longueur minimale du tracé de piste.';
  for (const entry of AIRPORT_LENGTH_CLASSES) {
    const bucket = byClass.get(entry.key);
    if (!bucket?.total) continue;
    legend.push({
      label: entry.label,
      color: AIRPORT_SIZE_SWATCH_COLOR,
      glyph: sizeDiscGlyph(entry.pixelSize),
      blurb,
      count: bucket.visible,
    });
  }

  const unknown = byClass.get(AIRPORT_LENGTH_UNKNOWN.key);
  if (unknown?.total) {
    legend.push({
      label: AIRPORT_LENGTH_UNKNOWN.label,
      color: AIRPORT_SIZE_SWATCH_COLOR,
      glyph: sizeRingGlyph(),
      blurb: 'Anneau creux, jamais un petit disque : OurAirports ne publie ici '
        + 'aucune longueur de piste ouverte. 1 314 terrains sur 7 464.',
      count: unknown.visible,
    });
  }

  if (drawnRunways > 0) {
    legend.push({
      label: 'Piste tracée',
      color: AIRPORT_SIZE_SWATCH_COLOR,
      glyph: sizeBarGlyph(16, 2),
      blurb: 'Le trait EST la piste : ses deux seuils publiés, donc sa longueur '
        + 'et son cap vrais, et son épaisseur vraie une fois assez près. Il ne '
        + 'descend jamais sous le diamètre de sa pastille. 4 790 terrains sur '
        + '7 464 sont géoréférencés en amont — 279 seulement en France, où le '
        + 'long tail des aéroclubs n’a pas de coordonnées de seuil.',
      count: drawnRunways,
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
