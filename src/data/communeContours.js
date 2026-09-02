/**
 * @module communeContours
 *
 * Commune outlines from `geo.api.gouv.fr`, decimated to something a browser
 * can draw, for any layer that needs to fill French ground rather than mark it.
 *
 * Extracted from `delinquanceFeed.js` when the childcare layer became the
 * second caller. Nothing here knows what the polygons will be coloured by:
 * one département at a time is the only shape `geo.api.gouv.fr` will answer
 * (an unfiltered contour request is refused), and that constraint — not any
 * one dataset — is what this module encodes.
 *
 * ── What it refuses to do ───────────────────────────────────────────────────
 * OUTER rings only. A commune's interior ring is an enclave belonging to
 * ANOTHER commune, which the same request already returned and which is drawn
 * in its own right — so cutting the hole would leave a gap where a polygon
 * already sits.
 *
 * ── What it admits to doing ─────────────────────────────────────────────────
 * A ring is rounded, deduped and strided; a multi-part commune keeps its
 * biggest pieces. Both are reported per commune (`simplified`) and per pack
 * (`droppedParts`), because a commune limit is a legal object and a decimated
 * one must never be presented as the boundary itself.
 */

/** Coordinate precision kept on a commune ring. 4 dp is ~11 m of latitude. */
export const COMMUNE_COORDINATE_DECIMALS = 4;
/**
 * Vertices kept per commune ring.
 *
 * Measured against the real contours on 2026-09-01. Pas-de-Calais is the worst
 * case at **887 communes and 4 135 420 bytes** of raw GeoJSON; at 64 vertices
 * and 4 dp it becomes 770 051 bytes of wire JSON (249 869 gzipped), against
 * 1 260 072 (392 454) at 128. A commune is a few dozen pixels wide at the zoom
 * these regimes are entered at, so the extra 64 vertices buy nothing a reader
 * can see and cost 57% more payload on the largest département in France.
 */
export const COMMUNE_MAX_RING_VERTICES = 64;
/**
 * Separate PIECES of one commune kept, largest first. Islands and exclaves
 * beyond the third are dropped; the count of what was dropped is reported so
 * the simplification is visible rather than silent.
 */
export const COMMUNE_MAX_PARTS = 3;

export const GEO_API_ROOT = 'https://geo.api.gouv.fr';

/** Default properties asked of `geo.api.gouv.fr` alongside the geometry. */
export const COMMUNE_CONTOUR_FIELDS = 'code,nom,population';

/** A département code the API will accept: 01–95, 2A/2B, 971–976. */
const DEP_CODE = /^(?:[0-9][0-9AB]|97[1-6])$/;

/**
 * The field list, left UNENCODED on purpose.
 *
 * A comma is legal in a query value and both this API and the URLs already in
 * the repository carry it raw, so percent-encoding it would only make the
 * request unreadable in a log. The charset guard is what keeps a caller from
 * smuggling anything else into the query string.
 */
function assertFields(fields) {
  const value = String(fields || '').trim();
  if (!/^[a-zA-Z]+(?:,[a-zA-Z]+)*$/.test(value)) throw new Error(`communeContours: invalid fields ${fields}`);
  return value;
}

/** Guarded département code, upper-cased, or a throw naming the offender. */
function assertDep(departement, who) {
  const code = String(departement || '').trim().toUpperCase();
  if (!DEP_CODE.test(code)) throw new Error(`${who}: invalid département code ${departement}`);
  return code;
}

/**
 * Contours of every commune of one département.
 *
 * @param {string} departement
 * @param {{fields?:string}} [options]
 * @returns {string}
 */
export function communeContoursUrl(departement, { fields = COMMUNE_CONTOUR_FIELDS } = {}) {
  const code = assertDep(departement, 'communeContours');
  return `${GEO_API_ROOT}/departements/${code}/communes`
    + `?format=geojson&geometry=contour&fields=${assertFields(fields)}`;
}

/**
 * Contours of one département's ARRONDISSEMENTS MUNICIPAUX.
 *
 * A second call, and not an oversight in the first: `type` defaults to
 * `commune-actuelle` on `geo.api.gouv.fr`, so Paris comes back as one polygon
 * and its twenty arrondissements come back from nowhere. Only three
 * départements have any — 75, 69 and 13 — and only a caller whose data is
 * published at that grain should pay for the second request.
 *
 * @param {string} departement
 * @param {{fields?:string}} [options]
 * @returns {string}
 */
export function arrondissementContoursUrl(departement, { fields = COMMUNE_CONTOUR_FIELDS } = {}) {
  const code = assertDep(departement, 'arrondissementContours');
  return `${GEO_API_ROOT}/communes`
    + `?codeDepartement=${code}&type=arrondissement-municipal`
    + `&format=geojson&geometry=contour&fields=${assertFields(fields)}`;
}

/** The three départements that publish arrondissements municipaux. */
export const ARRONDISSEMENT_DEPARTEMENTS = Object.freeze(['75', '69', '13']);

/** Whether one département has arrondissements municipaux at all. */
export function hasArrondissements(departement) {
  return ARRONDISSEMENT_DEPARTEMENTS.includes(String(departement || '').trim().toUpperCase());
}

/** A trimmed string, or `''`. */
function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

/**
 * Round, dedupe and stride one ring down to a drawable outline.
 *
 * Returns `simplified` per ring rather than pretending the result is an
 * administrative boundary: it is not, and a commune limit is a legal object.
 *
 * @param {Array<Array<number>>} ring `[lon, lat]` pairs.
 * @param {{maxVertices?:number, decimals?:number}} [options]
 * @returns {{ring:Array<number>, simplified:boolean}} Flat `[lon, lat, …]`.
 */
export function decimateCommuneRing(ring, {
  maxVertices = COMMUNE_MAX_RING_VERTICES,
  decimals = COMMUNE_COORDINATE_DECIMALS,
} = {}) {
  const scale = 10 ** decimals;
  const points = [];
  let previousLon = NaN;
  let previousLat = NaN;
  for (const point of Array.isArray(ring) ? ring : []) {
    const lon = Math.round(Number(point?.[0]) * scale) / scale;
    const lat = Math.round(Number(point?.[1]) * scale) / scale;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (lon === previousLon && lat === previousLat) continue;
    points.push([lon, lat]);
    previousLon = lon;
    previousLat = lat;
  }
  if (points.length < 4) return { ring: [], simplified: false };
  if (points.length <= maxVertices) return { ring: points.flat(), simplified: false };
  const stride = Math.ceil(points.length / maxVertices);
  const kept = [];
  for (let i = 0; i < points.length; i += stride) kept.push(points[i]);
  // A stride can drop the closing vertex, and an unclosed ring is the one
  // simplification whose failure mode is a visible gash across the commune.
  const last = points[points.length - 1];
  const tail = kept[kept.length - 1];
  if (tail[0] !== last[0] || tail[1] !== last[1]) kept.push(last);
  return { ring: kept.flat(), simplified: true };
}

/**
 * Project one `geo.api.gouv.fr` FeatureCollection into the wire shape.
 *
 * `epci` rides along when the caller asked for `codeEpci` — an intercommunal
 * territory has no contour of its own on this API, and the only honest way to
 * draw one is as the communes that compose it.
 *
 * @param {object} geojson FeatureCollection.
 * @param {{maxVertices?:number, decimals?:number, maxParts?:number}} [options]
 * @returns {{communes:Array<object>, vertices:number, simplified:number, droppedParts:number}}
 */
export function projectCommuneContours(geojson, options = {}) {
  const maxParts = Number.isFinite(options.maxParts)
    ? Math.max(1, Math.floor(options.maxParts))
    : COMMUNE_MAX_PARTS;
  const features = Array.isArray(geojson?.features) ? geojson.features : [];
  const communes = [];
  let vertices = 0;
  let simplified = 0;
  let droppedParts = 0;
  for (const feature of features) {
    const code = text(feature?.properties?.code);
    if (!code) continue;
    const geometry = feature?.geometry;
    const polygons = geometry?.type === 'Polygon'
      ? [geometry.coordinates]
      : (geometry?.type === 'MultiPolygon' ? geometry.coordinates : []);
    const ordered = polygons
      .filter((polygon) => Array.isArray(polygon?.[0]))
      .sort((a, b) => b[0].length - a[0].length);
    if (ordered.length > maxParts) droppedParts += ordered.length - maxParts;
    const parts = [];
    let anySimplified = false;
    for (const polygon of ordered.slice(0, maxParts)) {
      const result = decimateCommuneRing(polygon[0], options);
      if (result.ring.length < 8) continue;
      parts.push(result.ring);
      vertices += result.ring.length / 2;
      anySimplified = anySimplified || result.simplified;
    }
    if (!parts.length) continue;
    if (anySimplified) simplified += 1;
    communes.push({
      code,
      name: text(feature?.properties?.nom) || code,
      population: Number(feature?.properties?.population) || null,
      epci: text(feature?.properties?.codeEpci) || null,
      parts,
      simplified: anySimplified,
    });
  }
  communes.sort((a, b) => a.code.localeCompare(b.code));
  return { communes, vertices, simplified, droppedParts };
}

/**
 * Centroid of a flat `[lon, lat, …]` ring — the anchor a card hangs from.
 *
 * The mean of the vertices and NOT a true area centroid: the ring is already
 * decimated, so a precise centroid of an imprecise outline would be false
 * precision, and every caller uses this to place a label, never to measure.
 *
 * @param {Array<number>} flat
 * @returns {?Array<number>} `[lon, lat]`
 */
export function ringAnchor(flat) {
  if (!Array.isArray(flat) || flat.length < 6) return null;
  let lon = 0;
  let lat = 0;
  const points = flat.length / 2;
  for (let i = 0; i < flat.length; i += 2) {
    lon += flat[i];
    lat += flat[i + 1];
  }
  return [lon / points, lat / points];
}
