/**
 * The search box's geocoder for a build with no Google Maps API key.
 *
 * Thin by design: `/api/geocode` (vite.config.js) already answers in the shape
 * `searchAndFlyTo()` frames on — a location, a viewport, and Google-shaped
 * `types` — because it is the side that may hold the OpenStreetMap usage
 * policy's User-Agent, the one-request-per-second queue, and the cache. This
 * module builds the request, bounds how long a search may hang, and refuses a
 * malformed answer rather than flying the camera to NaN.
 */

/**
 * Two Nominatim passes serialized at ~1.1 s apart, plus a Géoplateforme
 * backstop, is the worst case behind one search. The ceiling is generous
 * because giving up early on a slow-but-working lookup reads as "not found".
 */
const KEYLESS_GEOCODE_TIMEOUT_MS = 15000;

/**
 * `viewportBias()` formats the current view as Google's geocoding bounds —
 * "swLat,swLng|neLat,neLng". Nominatim's viewbox is the same rectangle written
 * corner-first in the other order: "west,south,east,north".
 * @param {string|null} bias
 * @returns {string|null}
 */
export function viewboxFromBias(bias) {
  const [southwest, northeast] = String(bias || '').split('|');
  const [south, west] = String(southwest || '').split(',').map(Number);
  const [north, east] = String(northeast || '').split(',').map(Number);
  if (![south, west, north, east].every(Number.isFinite)) return null;
  if (!(north > south) || !(east > west)) return null;
  return [west, south, east, north].join(',');
}

/** A {lat,lng} corner, or null if either number is missing. */
function corner(point) {
  const lat = Number(point?.lat);
  const lng = Number(point?.lng);
  return (Number.isFinite(lat) && Number.isFinite(lng)) ? { lat, lng } : null;
}

/**
 * Validate one `/api/geocode` payload into the geocode shape `searchAndFlyTo()`
 * consumes (`lng`, like Google, not the `lon` the proxy speaks). A result with
 * no usable location is no result; a result with a broken viewport keeps its
 * location and loses only the framing box.
 * @returns {{lat:number, lng:number, label:string|null, types:string[],
 *   viewport:{southwest:{lat:number,lng:number}, northeast:{lat:number,lng:number}}|null,
 *   source:string|null} | null}
 */
export function normalizeKeylessGeocodeResponse(payload) {
  const result = payload?.result;
  const lat = Number(result?.lat);
  const lng = Number(result?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const southwest = corner(result?.viewport?.southwest);
  const northeast = corner(result?.viewport?.northeast);
  return {
    lat,
    lng,
    label: result.label ? String(result.label) : null,
    types: Array.isArray(result.types) ? result.types.filter((type) => typeof type === 'string') : [],
    viewport: (southwest && northeast) ? { southwest, northeast } : null,
    source: result.source ? String(result.source) : null,
  };
}

/**
 * Geocode a place name without a Google key. Returns null for "no such place"
 * AND for a failed lookup — the caller's next step is the same either way, and
 * the proxy has already logged which one it was.
 * @param {string} query
 * @param {{bias?: string|null, signal?: AbortSignal}} [options]
 */
export async function keylessGeocode(query, { bias = null, signal } = {}) {
  const q = String(query || '').trim();
  if (!q) return null;

  const params = new URLSearchParams({ q });
  const viewbox = viewboxFromBias(bias);
  if (viewbox) params.set('viewbox', viewbox);
  // Place names come back in the page's own language where OSM has one.
  const lang = String(globalThis.navigator?.language || '').slice(0, 2).toLowerCase();
  if (/^[a-z]{2}$/.test(lang)) params.set('lang', lang);

  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener?.('abort', abort);
  const timeout = setTimeout(abort, KEYLESS_GEOCODE_TIMEOUT_MS);
  try {
    const response = await fetch(`/api/geocode?${params}`, { signal: controller.signal });
    if (!response.ok) return null;
    return normalizeKeylessGeocodeResponse(await response.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener?.('abort', abort);
  }
}
