/**
 * Île-de-France Mobilités feed projection — the Paris network as an OFFER,
 * because nobody publishes where its vehicles are.
 *
 * THE FACT THIS MODULE IS BUILT AROUND. `transitCoverage.js` records it in
 * full: IDFM publishes no GTFS-Realtime vehicle positions at all, and the
 * flagship live-transit layer measured **0 vehicles in Paris intra-muros**
 * against 453 in Bordeaux. No amount of waiting makes a bus appear. What IDFM
 * does publish, keylessly and completely, is the network itself — every stop,
 * every line, every mode, every official colour. For someone deciding where to
 * live that is the more useful half anyway: not "where is the bus right now"
 * but "which lines, in which directions, how far from the door".
 *
 * MEASURED against the live Opendatasoft API on 2026-09-01:
 *   - `datasets/arrets/records` → **37,956** stops, `access-control-allow-origin: *`
 *   - `datasets/referentiel-des-lignes/records` → **2,121** lines, each with
 *     `colourweb_hexa` and `textcolourweb_hexa` — the network's OFFICIAL
 *     colours are published, so none need inventing
 *   - a 1.2 km box around 2.3760,48.8300 held 43 stops: 32 bus, 7 rail,
 *     2 metro, 2 tram
 *
 * TWO LAT/LON ORDERS IN ONE API, WHICH IS WHY BOTH QUERIES ARE BUILT HERE.
 *   - `in_bbox(arrgeopoint, LAT_MIN, LON_MIN, LAT_MAX, LON_MAX)` — latitude first
 *   - `distance(arrgeopoint, geom'POINT(LON LAT)', 400m)` — longitude first,
 *     inside the WKT, space-separated rather than comma-separated
 * Both return 200 for a swapped pair; one just returns the wrong part of the
 * world. And `arrgeopoint` arrives as an OBJECT `{lon, lat}`, not the string
 * the sibling ADEME dataset uses.
 *
 * THE FIELD THAT DOES NOT EXIST. `arrpostalcode` is not published; asking for
 * it in a `select` is an HTTP 400 `ODSQLError`, not a silently-ignored column.
 * The arrondissement INSEE code lives in `arrpostalregion` (`"75113"`) and the
 * human label in `arrtown` (`"Paris 13e"`).
 *
 * Dependency-free and side-effect-free. The `/api/idfm` proxy imports this.
 */

const ODS_ROOT = 'https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets';

/** Ceiling on stops served for one viewport or address. */
export const IDFM_MAX_STOPS = 400;
/** Ceiling on rows the upstream is asked for in one page. */
export const IDFM_PAGE_LIMIT = 100;

/**
 * Transport modes the referential publishes, mapped to the app's vocabulary.
 * `rail` covers RER and Transilien alike — IDFM does not separate them here.
 */
export const IDFM_MODES = Object.freeze({
  metro: 'Métro',
  rail: 'RER / Transilien',
  tram: 'Tramway',
  bus: 'Bus',
  funicular: 'Funiculaire',
  // `cableway`, not `cablecar`: the referential's own spelling, found by
  // reading all 2,121 published lines rather than by guessing. Exactly one
  // line uses it (the Câble C1 to Créteil), and a wrong key would have shown a
  // rider the raw code.
  cableway: 'Téléphérique',
});

/**
 * Build the stops query for a bounding box.
 *
 * Latitude first — see the module header. The pair is ordered here rather than
 * at the call site so the two conventions never meet in the same file twice.
 *
 * @param {{west: number, south: number, east: number, north: number, limit?: number}} box
 * @returns {string}
 */
export function buildStopsBboxUrl({ west, south, east, north, limit }) {
  for (const value of [west, south, east, north]) {
    if (!Number.isFinite(value)) throw new Error('idfm: bbox bounds must be finite numbers');
  }
  const params = new URLSearchParams({
    where: `in_bbox(arrgeopoint, ${south}, ${west}, ${north}, ${east})`,
    limit: String(Math.min(IDFM_PAGE_LIMIT, Math.max(1, Math.round(Number(limit) || IDFM_PAGE_LIMIT)))),
  });
  return `${ODS_ROOT}/arrets/records?${params}`;
}

/**
 * Build the stops query for a radius around an address.
 *
 * Longitude first, space-separated, inside a WKT literal — the inverse of the
 * bounding-box call directly above it.
 *
 * @param {{lon: number, lat: number, radiusM?: number, limit?: number}} query
 * @returns {string}
 */
export function buildStopsRadiusUrl({ lon, lat, radiusM, limit }) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw new Error('idfm: lon/lat must be finite numbers');
  }
  const radius = Math.min(5000, Math.max(50, Math.round(Number(radiusM) || 500)));
  const params = new URLSearchParams({
    where: `distance(arrgeopoint, geom'POINT(${lon} ${lat})', ${radius}m)`,
    limit: String(Math.min(IDFM_PAGE_LIMIT, Math.max(1, Math.round(Number(limit) || IDFM_PAGE_LIMIT)))),
  });
  return `${ODS_ROOT}/arrets/records?${params}`;
}

/**
 * Build one page of the line referential.
 * @param {{offset?: number, limit?: number}} [page]
 * @returns {string}
 */
export function buildLinesUrl({ offset = 0, limit = IDFM_PAGE_LIMIT } = {}) {
  const params = new URLSearchParams({
    limit: String(Math.min(IDFM_PAGE_LIMIT, Math.max(1, Math.round(limit)))),
    offset: String(Math.max(0, Math.round(offset))),
  });
  return `${ODS_ROOT}/referentiel-des-lignes/records?${params}`;
}

/**
 * Normalise the tri-state accessibility flag the stops carry.
 *
 * The dataset publishes `"true"`, `"false"`, `"partial"` and `"unknown"` as
 * strings, and all four appeared in a single 43-stop box. `"unknown"` becomes
 * `null` rather than `false`: a stop nobody has surveyed is not a stop known to
 * be inaccessible, and for the reader this distinction is the whole point.
 *
 * @param {unknown} value
 * @returns {boolean|'partial'|null}
 */
export function normalizeAccessibility(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'partial') return 'partial';
  return null;
}

/** Great-circle distance in metres. */
function haversineM(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Project a stops page.
 * @param {object|null|undefined} payload Upstream `arrets` body.
 * @param {{lon: number, lat: number}|null} [origin] Point to measure from.
 * @returns {{total: number|null, truncated: boolean, stops: Array<object>,
 *   byMode: Record<string, number>}}
 */
export function projectStops(payload, origin = null) {
  const rows = Array.isArray(payload?.results) ? payload.results : [];
  const total = Number.isFinite(payload?.total_count) ? payload.total_count : null;
  const stops = [];
  const byMode = {};
  for (const row of rows) {
    const point = row?.arrgeopoint;
    const lon = Number(point?.lon);
    const lat = Number(point?.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const mode = String(row?.arrtype ?? '').trim().toLowerCase() || 'unknown';
    byMode[mode] = (byMode[mode] || 0) + 1;
    stops.push({
      id: String(row?.arrid ?? `stop-${stops.length}`),
      name: row?.arrname ?? null,
      mode,
      modeLabel: IDFM_MODES[mode] ?? mode,
      town: row?.arrtown ?? null,
      // The arrondissement INSEE code — 75113, not the 75056 every
      // commune-level source answers with. See dvfFeed.js.
      communeCode: row?.arrpostalregion ?? null,
      zoneId: row?.zdaid ?? null,
      fareZone: row?.arrfarezone ?? null,
      accessible: normalizeAccessibility(row?.arraccessibility),
      lon,
      lat,
      distanceM: origin && Number.isFinite(origin.lon) && Number.isFinite(origin.lat)
        ? Math.round(haversineM(origin.lat, origin.lon, lat, lon))
        : null,
    });
  }
  if (origin) stops.sort((a, b) => a.distanceM - b.distanceM);
  const served = stops.slice(0, IDFM_MAX_STOPS);
  return {
    total,
    truncated: total !== null && total > served.length,
    stops: served,
    byMode,
  };
}

/** Normalise a published hex colour to a `#rrggbb` string, or null. */
export function normalizeColour(value) {
  const raw = String(value ?? '').trim().replace(/^#/, '');
  return /^[0-9a-f]{6}$/i.test(raw) ? `#${raw.toLowerCase()}` : null;
}

/**
 * Project a page of the line referential.
 *
 * Colours are taken from the publication, never generated. IDFM owns the
 * livery of line 14; a palette invented here would be recognisably wrong to
 * every Parisian looking at the screen.
 *
 * @param {object|null|undefined} payload Upstream `referentiel-des-lignes` body.
 * @returns {{total: number|null, lines: Array<object>}}
 */
export function projectLines(payload) {
  const rows = Array.isArray(payload?.results) ? payload.results : [];
  const lines = [];
  for (const row of rows) {
    const mode = String(row?.transportmode ?? '').trim().toLowerCase() || 'unknown';
    lines.push({
      id: String(row?.id_line ?? `line-${lines.length}`),
      name: row?.name_line ?? null,
      shortName: row?.shortname_line ?? null,
      mode,
      modeLabel: IDFM_MODES[mode] ?? mode,
      subMode: row?.transportsubmode ?? null,
      operator: row?.operatorname ?? null,
      network: row?.networkname ?? null,
      colour: normalizeColour(row?.colourweb_hexa),
      textColour: normalizeColour(row?.textcolourweb_hexa),
      accessible: normalizeAccessibility(row?.accessibility),
      status: row?.status ?? null,
      validFrom: row?.valid_fromdate ?? null,
      validTo: row?.valid_todate ?? null,
    });
  }
  return { total: Number.isFinite(payload?.total_count) ? payload.total_count : null, lines };
}
