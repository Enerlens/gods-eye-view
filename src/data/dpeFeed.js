/**
 * ADEME DPE feed projection — the energy label of the building, and of its
 * neighbours.
 *
 * WHAT THIS SOURCE IS. Every *diagnostic de performance énergétique* issued in
 * France since July 2021, published by the ADEME. A DPE is compulsory for any
 * sale, so the register is close to a census of what has changed hands — and
 * because it is geocoded against the BAN, it answers a question no listing
 * does: not just "what is this flat's label" but "what are the labels of the
 * whole street".
 *
 * MEASURED against the live API on 2026-09-01:
 *   - dataset `dpe03existant` (id `meg-83tjwtg8dyz4vv7h1dqe`), **15,476,290
 *     rows**, **230 fields**, `access-control-allow-origin: *`, keyless
 *   - `GET /lines?geo_distance=2.3760,48.8300,300` → 200, `total: 2805`
 *     within 300 m of one Paris 13e point
 *   - each row carries `_geo_distance` in METRES and `_geopoint` as the string
 *     `"lat,lon"` — latitude first, the inverse of the `geo_distance` argument
 *     order, which is `lon,lat,radius`
 *
 * WHY A PROXY FOR SOMETHING THIS SMALL. Not for CORS, and not for size: three
 * rows are 1,613 bytes. It exists to pin the FIELD SELECTION. A `select` naming
 * a field the schema does not have returns HTTP 400 with an ODSQL-style error
 * rather than ignoring it, so the 230-field surface has to be pinned somewhere
 * a unit test can see it — and the browser should not carry a list of 230
 * French column names to discover that.
 *
 * WHAT THE PROJECTION REFUSES TO DO. It does not average labels into a
 * "neighbourhood grade". A DPE describes one dwelling's envelope and heating
 * system; the mean of a street's letters is not a property of the street. The
 * distribution is returned instead, and the reader draws their own conclusion.
 *
 * Dependency-free and side-effect-free. The `/api/dpe` proxy imports this.
 */

const DATASET = 'dpe03existant';
const API_ROOT = `https://data.ademe.fr/data-fair/api/v1/datasets/${DATASET}`;

/** Default search radius in metres. */
export const DPE_DEFAULT_RADIUS_M = 200;
/** Ceiling on the radius. */
export const DPE_MAX_RADIUS_M = 1000;
/** Ceiling on rows served in one answer. */
export const DPE_MAX_ENTRIES = 500;

/**
 * The fields the projection reads, and the only ones requested.
 *
 * Pinned as an exported constant because naming a field this dataset does not
 * publish is an HTTP 400, not a silently ignored column: an edition that
 * renamed one of these would take the whole layer down rather than degrade it.
 */
export const DPE_FIELDS = Object.freeze([
  'numero_dpe',
  'etiquette_dpe',
  'etiquette_ges',
  'adresse_ban',
  'identifiant_ban',
  'annee_construction',
  'surface_habitable_logement',
  'cout_total_5_usages',
  'conso_5_usages_par_m2_ep',
  'emission_ges_5_usages_par_m2',
  'date_etablissement_dpe',
  '_geopoint',
]);

/** The seven labels, worst last, so a distribution keeps a meaningful order. */
export const DPE_LABELS = Object.freeze(['A', 'B', 'C', 'D', 'E', 'F', 'G']);

/**
 * Coerce a query value to a number, treating ABSENT as absent.
 *
 * `URLSearchParams.get()` returns `null` for a missing parameter, `Number(null)`
 * is `0`, and `Number.isFinite(0)` is true — so a plain `Number()` turns "the
 * caller said nothing" into "the caller said zero", and every clamp below then
 * returns its MINIMUM instead of its default. Measured live: `GET /api/dpe`
 * with no `radius` scanned 50 m rather than the documented 200 m, and returned
 * `total: 0` for an address with 2,805 diagnostics around it. Same root cause
 * as the `addressPoint` guard in `vite.config.js`.
 *
 * @param {unknown} value
 * @returns {number|null} A finite number, or null when nothing usable was given.
 */
function requestedNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Clamp a requested radius into the range this layer will serve.
 * @param {unknown} value @returns {number}
 */
export function clampDpeRadius(value) {
  const requested = requestedNumber(value);
  if (requested === null) return DPE_DEFAULT_RADIUS_M;
  return Math.min(DPE_MAX_RADIUS_M, Math.max(50, Math.round(requested)));
}

/**
 * Build the upstream URL for one address scan.
 *
 * `geo_distance` takes LONGITUDE, LATITUDE, RADIUS — while the `_geopoint` it
 * returns is latitude-first. The two orders are built and parsed in this one
 * module so the inconsistency is handled once.
 *
 * No `sort` is sent, and that is deliberate rather than an omission:
 * `sort=_geo_distance` is rejected with HTTP 400 — the distance is computed per
 * query, not stored — while `geo_distance` already returns rows nearest-first.
 * Asking for the sort explicitly takes the whole layer down.
 *
 * @param {{lon: number, lat: number, radiusM?: number, limit?: number}} query
 * @returns {string}
 */
export function buildDpeUrl({ lon, lat, radiusM, limit }) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw new Error('dpe: lon/lat must be finite numbers');
  }
  const radius = clampDpeRadius(radiusM);
  const size = Math.min(DPE_MAX_ENTRIES, Math.max(1, Math.round(Number(limit) || 100)));
  const params = new URLSearchParams({
    size: String(size),
    geo_distance: `${lon},${lat},${radius}`,
    select: DPE_FIELDS.join(','),
  });
  return `${API_ROOT}/lines?${params}`;
}

/**
 * Parse the `"lat,lon"` geopoint string into a pair.
 * @param {unknown} value @returns {{lon: number, lat: number}|null}
 */
export function parseGeopoint(value) {
  const parts = String(value ?? '').split(',');
  if (parts.length !== 2) return null;
  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lon, lat };
}

/** Normalise a label to one of the seven, or null. */
function label(value) {
  const letter = String(value ?? '').trim().toUpperCase();
  return DPE_LABELS.includes(letter) ? letter : null;
}

/** Coerce to a finite number, or null. Absent is not zero. */
function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Project the upstream page into the entries the client draws.
 *
 * `total` is the upstream's own count of matching diagnostics and is kept
 * separate from `entries.length`: the difference between "2,805 DPE within
 * 300 m" and "here are the 100 nearest" is the whole honesty of the layer.
 *
 * @param {object|null|undefined} payload Upstream `/lines` body.
 * @param {{radiusM: number}} context
 * @returns {{total: number|null, entries: Array<object>, truncated: boolean,
 *   distribution: Record<string, number>, medianCoutAnnuel: number|null}}
 */
export function projectDpe(payload, { radiusM } = {}) {
  const rows = Array.isArray(payload?.results) ? payload.results : [];
  const total = Number.isFinite(payload?.total) ? payload.total : null;
  const entries = [];
  const distribution = Object.fromEntries(DPE_LABELS.map((letter) => [letter, 0]));
  const costs = [];
  for (const row of rows) {
    const point = parseGeopoint(row?._geopoint);
    const dpe = label(row?.etiquette_dpe);
    if (dpe) distribution[dpe] += 1;
    const cost = num(row?.cout_total_5_usages);
    if (cost !== null) costs.push(cost);
    entries.push({
      id: String(row?.numero_dpe ?? `dpe-${entries.length}`),
      etiquetteDpe: dpe,
      etiquetteGes: label(row?.etiquette_ges),
      address: row?.adresse_ban ?? null,
      banId: row?.identifiant_ban ?? null,
      builtYear: num(row?.annee_construction),
      surfaceM2: num(row?.surface_habitable_logement),
      annualCostEur: cost,
      consoKwhM2: num(row?.conso_5_usages_par_m2_ep),
      gesKgM2: num(row?.emission_ges_5_usages_par_m2),
      issuedOn: row?.date_etablissement_dpe ?? null,
      lon: point ? point.lon : null,
      lat: point ? point.lat : null,
      distanceM: Number.isFinite(row?._geo_distance) ? Math.round(row._geo_distance) : null,
    });
  }
  costs.sort((a, b) => a - b);
  return {
    radiusM,
    total,
    entries,
    truncated: total !== null && total > entries.length,
    distribution,
    medianCoutAnnuel: costs.length ? Math.round(costs[Math.floor((costs.length - 1) / 2)]) : null,
  };
}
