/**
 * @file DATEX II road-status feed: the pure half.
 *
 * Bison Futé publishes the state of France's non-conceded national road
 * network (`tipi.bison-fute.gouv.fr`) as DATEX II 2.0, keyless, under Licence
 * Ouverte 2.0. Two publications matter here and they answer different
 * questions about the same tarmac:
 *
 *   **TRAFICOLOR-DIR** — `trafficStatusValue` per measurement site
 *     (`freeFlow` / `heavy` / `congested` / `impossible` / `unknown`), around
 *     the sixteen agglomerations whose ring roads a DIR operates a traffic
 *     centre for. This is the colour. Measured 2026-08-31 it refreshes every
 *     60 s at Bordeaux, Toulouse, Lyon and Limoges, 120 s at Rouen and Caen,
 *     180 s in Brittany and Lorraine, 360 s at Marseille and Saint-Étienne.
 *
 *   **QTV-DIR** — `vehicleFlowRate` (veh/h) and `averageVehicleSpeed` (km/h)
 *     per counting station, one snapshot every SIX MINUTES over a six-minute
 *     window. This is the count, and TomTom has no equivalent of it at any
 *     price: a probe-derived jam factor is a ratio, not a number of vehicles.
 *
 * ── WHY THIS IS NOT A REPLACEMENT FOR THE TOMTOM FLOW LAYER ─────────────────
 *
 * It covers 936 km of segments on motorways and trunk roads only, it is blind
 * in Île-de-France (the DIRIF publishes nothing here — no station, no status,
 * no agglomeration feed), and its cadence is a minute at best. What it is, and
 * TomTom is not, is open: no key, no quota, no redistribution clause, and a
 * measured vehicle count rather than a modelled ratio. On a build with no
 * `TOMTOM_API_KEY` it is the only real congestion data the app can show.
 *
 * ── WHAT THIS MODULE IS ─────────────────────────────────────────────────────
 *
 * Parsing, taxonomy and viewport arithmetic, Cesium-free and network-free, so
 * both the dev-server proxy (`/api/road-status-fr`, see `vite.config.js`) and
 * `roadStatusFrance.js` can share it and node:test can pin it against captured
 * bodies. The geometry it is joined to is built once, offline, by
 * `scripts/build-datex-traficolor-sites.mjs`.
 *
 * ── WHY THE XML IS SCANNED AND NOT DOM-PARSED ───────────────────────────────
 *
 * These bodies are machine-generated DATEX II with a fixed, flat shape — a
 * list of `siteMeasurements`, each carrying one site reference and one or two
 * `basicData` values — and the repository ships no XML parser. Adding one for
 * this would be a dependency to audit forever; `DOMParser` does not exist in
 * the Node half. So the payloads are scanned with anchored expressions over a
 * SIZE-BOUNDED string, no entity expansion is performed and no external entity
 * is ever resolved, which is also the only class of XML attack these documents
 * could carry. Anything that does not match is skipped, never guessed.
 *
 * @module data/datexRoadStatus
 */

/** Bison Futé's open DATEX II root. HTTP only — the host serves no TLS. */
export const TIPI_BASE = 'http://tipi.bison-fute.gouv.fr/bison-fute-ouvert/publicationsDIR';

/** Apache auto-index of the per-agglomeration traffic-status directories. */
export const TRAFICOLOR_INDEX_URL = `${TIPI_BASE}/TRAFICOLOR-DIR/`;

/** The six-minute national flow/speed snapshot. */
export const QTV_MEASUREMENTS_URL = `${TIPI_BASE}/QTV-DIR/qtvDir.xml`;

/** The counting-station referential the geometry is built from. */
export const QTV_REFERENTIAL_URL = `${TIPI_BASE}/QTV-DIR/refDir.csv`;

/** data.gouv.fr landing page for the dataset, for the attribution surface. */
export const DATASET_PAGE_URL = 'https://www.data.gouv.fr/fr/datasets/etat-de-circulation-en-temps-reel-sur-le-reseau-national-routier-non-concede/';

/** Licence of both publications, as declared on the dataset. */
export const ROAD_STATUS_LICENCE = 'Licence Ouverte 2.0';

/**
 * What each publishing directory is, in plain words.
 *
 * The names on the server are the operators' own system names — ALIENOR,
 * ERATO, MARIUS, MYRABEL — which say nothing to anyone who does not run a
 * French traffic-management centre. Each label below was established by
 * unprojecting the sites the feed actually publishes and measuring the
 * centroid against the nearest city (2026-08-31), not by guessing from the
 * name: ALIENOR's sites sit 2 km from Bordeaux city hall, ERATO's 2 km from
 * Toulouse, HYRONDELLE's 10 km from Saint-Étienne, GENTIANE's 2 km from
 * Grenoble.
 *
 * The registry is a LABEL table, not an allow-list. A directory that appears
 * on the server and is not named here is still read and still drawn, under its
 * raw directory name — a new agglomeration must not need a release to show up.
 */
export const AGGLOMERATION_LABELS = Object.freeze({
  ALIENOR: 'Bordeaux',
  TraficErato: 'Toulouse',
  TraficLyon: 'Lyon',
  TraficMarius: 'Marseille',
  TraficHyrondelle: 'Saint-Étienne',
  TraficRouen: 'Rouen',
  TraficLimoges: 'Limoges',
  TraficCaen: 'Caen',
  TraficGentiane: 'Grenoble',
  TraficLille: 'Lille',
  TraficDirmc: 'Massif central (A75)',
  TraficBreizhNantes: 'Nantes',
  TraficBreizhRennes: 'Rennes',
  TRAFIC_TraficStBrieuc: 'Saint-Brieuc',
  TRAFIC_TraficTriskell56: 'Lorient – Vannes',
  TraficMyrabel: 'Nancy – Metz',
});

/**
 * The DATEX II `TrafficStatusEnum` values, as this app draws them.
 *
 * The palette is deliberately the traffic layer's own green/amber/red
 * (`trafficFlowStyle.js`), so a segment coloured by a measured French sensor
 * and a road tinted by a TomTom flow tile mean the same thing on screen. Two
 * values extend it: `impossible` is DATEX's term for a road that is not
 * passable at all, which no TomTom level expresses, and `unknown` is the state
 * the publisher explicitly sends when its own sensors are down — drawn grey
 * and counted separately, never folded into free flow.
 *
 * `rank` orders the legend and decides which state wins when a segment is
 * reported by more than one agglomeration feed: the worse state is kept,
 * because a road reported congested by one centre and free by another is not a
 * road anyone should be told is free.
 */
export const ROAD_STATUS_LEVELS = Object.freeze({
  freeFlow: Object.freeze({
    id: 'freeFlow', rank: 0, label: 'Free flow', color: '#2ecc71', widthPx: 3.5,
  }),
  heavy: Object.freeze({
    id: 'heavy', rank: 1, label: 'Heavy', color: '#f0b23e', widthPx: 4.5,
  }),
  congested: Object.freeze({
    id: 'congested', rank: 2, label: 'Congested', color: '#e05252', widthPx: 5.5,
  }),
  impossible: Object.freeze({
    id: 'impossible', rank: 3, label: 'Impassable', color: '#8e2b2b', widthPx: 6,
  }),
  unknown: Object.freeze({
    id: 'unknown', rank: -1, label: 'Not reported', color: '#7c8794', widthPx: 2.5,
  }),
});

/** Legend order: the states worth reading, worst last, with `unknown` apart. */
export const ROAD_STATUS_LEGEND_ORDER = Object.freeze([
  'freeFlow', 'heavy', 'congested', 'impossible', 'unknown',
]);

/**
 * Style record for a DATEX status value.
 * @param {?string} status Raw `trafficStatusValue`.
 * @returns {{id:string, rank:number, label:string, color:string, widthPx:number}}
 */
export function roadStatusStyle(status) {
  return ROAD_STATUS_LEVELS[status] || ROAD_STATUS_LEVELS.unknown;
}

/**
 * The worse of two status values, by legend rank.
 *
 * `unknown` never wins against a real reading: its rank is negative precisely
 * so a site one centre cannot see and another can is drawn from the centre
 * that can see it.
 *
 * @param {?string} a First status.
 * @param {?string} b Second status.
 * @returns {string} The status to draw.
 */
export function worseRoadStatus(a, b) {
  const left = roadStatusStyle(a);
  const right = roadStatusStyle(b);
  return right.rank > left.rank ? right.id : left.id;
}

// ---------------------------------------------------------------------------
// Apache auto-index
// ---------------------------------------------------------------------------

/** Only ever accept the shapes this server actually emits. */
const DIR_HREF = /<a href="([A-Za-z0-9_.-]+)\/">/g;
const XML_HREF = /<a href="([A-Za-z0-9_.-]+\.xml)"/g;

/**
 * Sub-directory names in one Apache auto-index page.
 *
 * The parent link is `/publication/...` and therefore contains a slash, which
 * the expression's character class already excludes; nothing else on the page
 * matches.
 *
 * @param {string} html Auto-index body.
 * @returns {Array<string>} Directory names, in page order, de-duplicated.
 */
export function parseIndexDirectories(html) {
  if (typeof html !== 'string') return [];
  const names = new Set();
  for (const match of html.matchAll(DIR_HREF)) names.add(match[1]);
  return [...names];
}

/**
 * The newest publication file in one agglomeration's auto-index.
 *
 * Every file is named `<system>_DataTRT_<YYYYMMDD>_<HHMMSS>.xml`, so lexical
 * order IS chronological order and the last name is the freshest snapshot.
 * The directory keeps a rolling history — 281 files at Bordeaux, about four
 * and a half hours — which this layer does not use but which is why the newest
 * has to be chosen rather than assumed to be alone.
 *
 * @param {string} html Auto-index body.
 * @returns {?string} File name, or null when the directory is empty.
 */
export function latestPublicationFile(html) {
  if (typeof html !== 'string') return null;
  let latest = null;
  for (const match of html.matchAll(XML_HREF)) {
    if (latest === null || match[1] > latest) latest = match[1];
  }
  return latest;
}

// ---------------------------------------------------------------------------
// DATEX II payloads
// ---------------------------------------------------------------------------

/** One `siteMeasurements` block, whichever whitespace style the publisher uses. */
const SITE_BLOCK = /<siteMeasurements>([\s\S]*?)<\/siteMeasurements>/g;
const SITE_ID = /<measurementSiteReference\b[^>]*\bid="([^"]+)"/;
const SITE_TIME = /<measurementTimeDefault>([^<]+)<\/measurementTimeDefault>/;
const STATUS_VALUE = /<trafficStatusValue>([^<]+)<\/trafficStatusValue>/;
const FLOW_VALUE = /<vehicleFlowRate>(-?\d+)<\/vehicleFlowRate>/;
const FLOW_INPUTS = /<vehicleFlow\b[^>]*numberOfInputValuesUsed="(\d+)"/;
const SPEED_VALUE = /<speed>(-?\d+(?:\.\d+)?)<\/speed>/;
const PUBLICATION_TIME = /<publicationTime>([^<]+)<\/publicationTime>/;
const SUBSCRIPTION_START = /<subscriptionStartTime>([^<]+)<\/subscriptionStartTime>/;
const SUBSCRIPTION_STOP = /<subscriptionStopTime>([^<]+)<\/subscriptionStopTime>/;

/**
 * Largest body this module will scan (bytes of UTF-16 string length).
 *
 * The national flow snapshot is 1.2 MB and the biggest agglomeration file is
 * 172 KB; 16 MB is far above anything the publisher sends and far below what
 * would wedge the dev server if the URL ever answered with something else.
 */
export const MAX_PAYLOAD_CHARS = 16 * 1024 * 1024;

function scannable(text) {
  return typeof text === 'string' && text.length > 0 && text.length <= MAX_PAYLOAD_CHARS;
}

/** ISO string, or null. DATEX sends local time with an offset; `Date` keeps it. */
function isoOrNull(text) {
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Traffic-status readings in one TRAFICOLOR publication.
 *
 * @param {string} xml Publication body.
 * @returns {{publishedAt: ?string, statuses: Map<string, {status: string, at: ?string}>}}
 */
export function parseTraficolorStatuses(xml) {
  const statuses = new Map();
  if (!scannable(xml)) return { publishedAt: null, statuses };
  for (const block of xml.matchAll(SITE_BLOCK)) {
    const body = block[1];
    const id = SITE_ID.exec(body)?.[1];
    if (!id) continue;
    const raw = STATUS_VALUE.exec(body)?.[1];
    if (!raw) continue;
    // An unrecognised enum member is recorded as `unknown` rather than passed
    // through: the drawing has no colour for a value it has never seen, and
    // inventing one would put a state on screen nobody can read.
    const status = Object.hasOwn(ROAD_STATUS_LEVELS, raw) ? raw : 'unknown';
    statuses.set(id, { status, at: isoOrNull(SITE_TIME.exec(body)?.[1]) });
  }
  return { publishedAt: isoOrNull(PUBLICATION_TIME.exec(xml)?.[1]), statuses };
}

/**
 * Flow and speed readings in the national QTV snapshot.
 *
 * `vehicleFlowRate` is an HOURLY rate extrapolated from a six-minute count:
 * where the publisher declares `numberOfInputValuesUsed`, the rate is exactly
 * ten times it for 701 of 1 192 stations (measured 2026-08-31) and larger for
 * the rest, which aggregate several lanes into one site. Both the rate and the
 * declared sample count are carried through so the card can say which it is
 * showing rather than implying a per-lane figure.
 *
 * @param {string} xml `qtvDir.xml` body.
 * @returns {{publishedAt: ?string, windowStart: ?string, windowEnd: ?string,
 *            measurements: Map<string, {flowVehH: ?number, speedKph: ?number,
 *                                       samples: ?number, at: ?string}>}}
 */
export function parseQtvMeasurements(xml) {
  const measurements = new Map();
  if (!scannable(xml)) {
    return {
      publishedAt: null, windowStart: null, windowEnd: null, measurements,
    };
  }
  for (const block of xml.matchAll(SITE_BLOCK)) {
    const body = block[1];
    const id = SITE_ID.exec(body)?.[1];
    if (!id) continue;
    const flow = FLOW_VALUE.exec(body)?.[1];
    const speed = SPEED_VALUE.exec(body)?.[1];
    const samples = FLOW_INPUTS.exec(body)?.[1];
    // A station that reports neither is a station that reported nothing; it is
    // dropped rather than stored as two nulls that later read as a measurement.
    if (flow === undefined && speed === undefined) continue;
    measurements.set(id, {
      flowVehH: flow === undefined ? null : Number(flow),
      speedKph: speed === undefined ? null : Number(speed),
      samples: samples === undefined ? null : Number(samples),
      at: isoOrNull(SITE_TIME.exec(body)?.[1]),
    });
  }
  return {
    publishedAt: isoOrNull(PUBLICATION_TIME.exec(xml)?.[1]),
    windowStart: isoOrNull(SUBSCRIPTION_START.exec(xml)?.[1]),
    windowEnd: isoOrNull(SUBSCRIPTION_STOP.exec(xml)?.[1]),
    measurements,
  };
}

// ---------------------------------------------------------------------------
// The counting-station referential
// ---------------------------------------------------------------------------

/**
 * Columns `refDir.csv` DECLARES, in order.
 *
 * It declares twenty and publishes nineteen — every row, without exception,
 * measured over successive cycles on 2026-08-31. The missing member is
 * `code_insee_commune`: rows run `code_pme;source;source_2;axe;…`, so a reader
 * that trusts the header shifts every field from the fourth onward and ends up
 * reading `nb_voies` as an easting and the traficolor zone as a northing. That
 * mis-read is not theoretical — it is what makes the file look as though only
 * a fraction of the stations are locatable and as though `code_traficolor` is
 * never filled in. Both are artefacts.
 *
 * So the parser below is POSITIONAL from the end and validates the field
 * count, rather than zipping against this list. The list is kept because it is
 * the publisher's own contract, and the divergence from it is the finding.
 */
export const REFERENTIAL_DECLARED_COLUMNS = Object.freeze([
  'code_pme', 'source', 'source_2', 'code_insee_commune', 'axe',
  'pr_debut', 'abscisse_debut', 'pr_fin', 'abscisse_fin',
  'sens_gestionnaire', 'sens_cardinal', 'sens_migratoire', 'sens_giratoire',
  'longueur', 'nb_voies', 'x_deb', 'y_deb', 'x_fin', 'y_fin', 'code_traficolor',
]);

/** Field count the rows actually carry. */
export const REFERENTIAL_ROW_COLUMNS = 19;

function finiteOrNull(text) {
  const value = Number(text);
  return Number.isFinite(value) && value !== 0 ? value : null;
}

/**
 * Parse `refDir.csv` into station records, in Lambert-93 metres.
 *
 * Reprojection is NOT done here: this module is shared with the browser, which
 * must never see a metre, and the projection lives in the build script that
 * does the conversion once (`scripts/lib/lambert93.mjs`).
 *
 * The point-repère columns are read even though most rows that carry them
 * carry a coordinate too, because the rows that DON'T are the interesting
 * ones: 525 of 1 368 rows publish no `x_deb` at all (2026-09-01) and 153 of
 * those publish a PR, which `scripts/lib/rrnBornage.mjs` resolves against the
 * State's kilometre-post referential to a median 3.9 m of where the DIRs put
 * the stations that publish both.
 *
 * Rows whose field count is neither the declared 20 nor the published 19 are
 * skipped and counted — a third shape would mean the publisher changed the
 * file, and guessing which column is which at that point is how a station ends
 * up in the sea.
 *
 * @param {string} csv File body.
 * @returns {{stations: Array<object>, rows: number, skipped: number, headerColumns: number}}
 */
export function parseStationReferential(csv) {
  const out = { stations: [], rows: 0, skipped: 0, headerColumns: 0 };
  if (typeof csv !== 'string' || !csv) return out;
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/);
  const header = (lines[0] || '').split(';');
  out.headerColumns = header.length;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    out.rows += 1;
    const fields = line.split(';');
    // Accept both widths: 19 is what ships today, 20 is what the header
    // promises, and a file that started honouring its own header must not
    // silently stop parsing.
    const offset = fields.length === REFERENTIAL_ROW_COLUMNS ? 0
      : (fields.length === REFERENTIAL_DECLARED_COLUMNS.length ? 1 : null);
    if (offset === null) {
      out.skipped += 1;
      continue;
    }
    const id = fields[0]?.trim();
    if (!id) {
      out.skipped += 1;
      continue;
    }
    out.stations.push({
      id,
      dir: fields[1]?.trim() || null,
      axis: fields[3 + offset]?.trim() || null,
      // The point-repère address, kept verbatim: it is the only geometry 525
      // of today's 1 368 rows publish, and the four DIRs that write it each
      // write it differently. Interpretation belongs to the build script's
      // `scripts/lib/rrnBornage.mjs`, not here.
      prStart: fields[4 + offset]?.trim() || null,
      abscisseStartM: Number(fields[5 + offset]) || 0,
      prEnd: fields[6 + offset]?.trim() || null,
      abscisseEndM: Number(fields[7 + offset]) || 0,
      lanes: Number(fields[13 + offset]) || null,
      lengthM: Number(fields[12 + offset]) || null,
      xStart: finiteOrNull(fields[14 + offset]),
      yStart: finiteOrNull(fields[15 + offset]),
      xEnd: finiteOrNull(fields[16 + offset]),
      yEnd: finiteOrNull(fields[17 + offset]),
      zone: fields[18 + offset]?.trim() || null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Viewport arithmetic
// ---------------------------------------------------------------------------

/**
 * Largest box the segment endpoint will answer for.
 *
 * Generous — 20° is the whole country plus Corsica — because unlike the
 * transit and Overpass proxies there is no per-viewport upstream cost here:
 * the proxy holds ONE national snapshot of at most a couple of thousand
 * segments and filters it in memory, so a wide box costs a filter pass, not a
 * fan-out. The cap exists to reject a malformed request, not to ration work.
 */
export const ROAD_STATUS_MAX_BOX_DEG = 20;

/** Hard ceiling on segments in one answer, whatever the box. */
export const ROAD_STATUS_MAX_SEGMENTS = 4000;

/**
 * Validate a requested bounding box.
 * @param {{south:*, west:*, north:*, east:*}} input Raw query values.
 * @returns {?{south:number, west:number, north:number, east:number}} Null when unusable.
 */
export function validRoadStatusBox(input) {
  const south = Number(input?.south);
  const west = Number(input?.west);
  const north = Number(input?.north);
  const east = Number(input?.east);
  if (![south, west, north, east].every(Number.isFinite)) return null;
  if (south < -90 || north > 90 || west < -180 || east > 180) return null;
  if (north <= south || east <= west) return null;
  if (north - south > ROAD_STATUS_MAX_BOX_DEG) return null;
  if (east - west > ROAD_STATUS_MAX_BOX_DEG) return null;
  return {
    south, west, north, east,
  };
}

/**
 * Whether a segment's drawn extent touches a box.
 *
 * Tested as the segment's own bounding box against the request box rather than
 * as a point: a station on the Bordeaux ring is a 979 m median segment, and
 * one whose midpoint is outside the view can still cross it.
 *
 * @param {{c: Array<number>}} segment Segment with `[lon1, lat1, lon2, lat2]`.
 * @param {{south:number, west:number, north:number, east:number}} box Request box.
 * @returns {boolean}
 */
export function segmentIntersectsBox(segment, box) {
  const c = segment?.c;
  if (!Array.isArray(c) || c.length < 2) return false;
  let minLon = Infinity; let maxLon = -Infinity;
  let minLat = Infinity; let maxLat = -Infinity;
  for (let i = 0; i + 1 < c.length; i += 2) {
    const lon = c[i];
    const lat = c[i + 1];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return maxLon >= box.west && minLon <= box.east
    && maxLat >= box.south && minLat <= box.north;
}

/**
 * Human label for a publishing directory.
 * @param {string} directory Directory name on the TIPI server.
 * @returns {string}
 */
export function agglomerationLabel(directory) {
  return AGGLOMERATION_LABELS[directory] || directory;
}

/**
 * Format an hourly flow rate for a card.
 * @param {?number} flowVehH Vehicles per hour.
 * @returns {?string}
 */
export function formatFlow(flowVehH) {
  if (!Number.isFinite(flowVehH) || flowVehH < 0) return null;
  return `${Math.round(flowVehH).toLocaleString('en-US').replace(/,/g, ' ')} veh/h`;
}

/**
 * Format an average speed for a card.
 *
 * Zero is not printed as "0 km/h": on this feed a zero speed almost always
 * accompanies a zero count — 114 of 1 192 stations at 22:30 — and means the
 * station saw no vehicle in the window, not that traffic was stationary.
 *
 * @param {?number} speedKph Average speed.
 * @param {?number} flowVehH The station's flow in the same window.
 * @returns {?string}
 */
export function formatSpeed(speedKph, flowVehH) {
  if (!Number.isFinite(speedKph) || speedKph <= 0) return null;
  if (Number.isFinite(flowVehH) && flowVehH <= 0) return null;
  return `${Math.round(speedKph)} km/h`;
}
