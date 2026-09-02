/**
 * IGN isochrone feed projection — where you can actually get to, rather than
 * how far away things are.
 *
 * WHY THIS EXISTS AT ALL. A circle drawn at 800 m around an address is a lie
 * told by a map: it crosses railways, rivers and motorways as if they were
 * pavement. The Géoplateforme runs Valhalla over IGN's own BD TOPO road and
 * path network and returns the polygon actually reachable in a given time —
 * the difference between "1 km away" and "eleven minutes on foot, because the
 * only bridge is upstream".
 *
 * MEASURED against the live service on 2026-09-01:
 *   - `GET data.geopf.fr/navigation/isochrone?point=LON,LAT&resource=bdtopo-valhalla
 *     &costValue=600&costType=time&profile=pedestrian`
 *     → 200, 716 bytes, `access-control-allow-origin: *`, keyless,
 *       `cache-control: private, max-age=1814400` and a strong ETag
 *   - the answer is a `Polygon`; a 600 s pedestrian ring came back with 24
 *     vertices
 *   - `resourceVersion` moved between two probes on the SAME day
 *     (`2026-08-26`, then `2026-08-25`), so it is relayed, never pinned
 *
 * THE PROFILE THE DESIGN WANTED AND THIS SOURCE DOES NOT HAVE. Only `car` and
 * `pedestrian` are accepted; `bicycle` and `truck` are rejected with HTTP 400
 * and an error that enumerates the valid set. So walking and driving rings are
 * real here and a CYCLING ring is not available from this service at all. The
 * app's existing `/api/route` proxy does carry an OSRM `bike` profile, but that
 * answers a route between two points, not a reachable area. Offering a cycling
 * isochrone would mean modelling one, and a modelled ring drawn beside two
 * measured ones is exactly the false precision the mission design forbids.
 *
 * Dependency-free and side-effect-free. The `/api/isochrone` proxy imports this.
 */

const SERVICE_URL = 'https://data.geopf.fr/navigation/isochrone';

/** The Valhalla graph the Géoplateforme exposes over IGN's own network. */
export const ISOCHRONE_RESOURCE = 'bdtopo-valhalla';

/**
 * The profiles this service accepts, keyed by the app's own vocabulary.
 *
 * `bike` is deliberately absent — see the module header. Mapping it onto
 * `pedestrian` would draw a walking ring and label it cycling.
 */
export const ISOCHRONE_PROFILES = Object.freeze({ foot: 'pedestrian', car: 'car' });

/** Shortest ring worth drawing, in seconds. */
export const ISOCHRONE_MIN_SECONDS = 120;
/** Longest ring this proxy will ask for, in seconds. */
export const ISOCHRONE_MAX_SECONDS = 3600;

/**
 * Resolve an app profile name to the upstream one.
 * @param {unknown} value
 * @returns {string|null} Upstream profile, or null when unsupported.
 */
export function resolveProfile(value) {
  const key = String(value ?? '').trim().toLowerCase();
  if (Object.hasOwn(ISOCHRONE_PROFILES, key)) return ISOCHRONE_PROFILES[key];
  // Accept the upstream spelling too, so a caller reading the IGN docs is not
  // silently wrong.
  if (Object.values(ISOCHRONE_PROFILES).includes(key)) return key;
  return null;
}

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
 * Clamp a requested duration into the range this proxy will ask for.
 * @param {unknown} value Seconds.
 * @returns {number}
 */
export function clampSeconds(value) {
  const requested = requestedNumber(value);
  if (requested === null) return 600;
  return Math.min(ISOCHRONE_MAX_SECONDS, Math.max(ISOCHRONE_MIN_SECONDS, Math.round(requested)));
}

/**
 * Build the upstream URL for one ring.
 * @param {{lon: number, lat: number, profile: string, seconds: number}} query
 * @returns {string}
 */
export function buildIsochroneUrl({ lon, lat, profile, seconds }) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw new Error('isochrone: lon/lat must be finite numbers');
  }
  const resolved = resolveProfile(profile);
  if (!resolved) throw new Error(`isochrone: unsupported profile ${profile}`);
  const params = new URLSearchParams({
    point: `${lon},${lat}`,
    resource: ISOCHRONE_RESOURCE,
    costValue: String(clampSeconds(seconds)),
    costType: 'time',
    profile: resolved,
  });
  return `${SERVICE_URL}?${params}`;
}

/**
 * Spherical polygon area in square kilometres.
 *
 * Reported because it is the one number that makes two rings comparable at a
 * glance: a fifteen-minute walk covering 1.9 km² and one covering 0.6 km² is
 * the difference between a connected address and a severed one, and neither
 * ring's outline says that on its own.
 *
 * @param {Array<number[]>} ring `[lon, lat]` pairs.
 * @returns {number} Area in km², rounded to two decimals.
 */
export function ringAreaKm2(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  const R = 6371.0088;
  const toRad = Math.PI / 180;
  let total = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[(i + 1) % ring.length];
    total += (lon2 - lon1) * toRad * (2 + Math.sin(lat1 * toRad) + Math.sin(lat2 * toRad));
  }
  return Math.round(Math.abs(total * R * R / 2) * 100) / 100;
}

/**
 * The three durations a catchment area is read at, in seconds.
 *
 * Five, ten and fifteen minutes because that is the vocabulary the question is
 * asked in — a retail brief says "dix minutes à pied", never "800 metres" — and
 * three rings are the most that stay legible nested inside one another.
 */
export const ISOCHRONE_STEPS = Object.freeze([300, 600, 900]);

/** How many rings one request may ask for. Each is an upstream round trip. */
export const ISOCHRONE_MAX_RINGS = 4;

/**
 * Parse a `seconds=300,600,900` list into the durations to fetch.
 *
 * A SINGLE value is still valid and still answers a single ring: the route
 * shipped that way first and a caller reading the old shape must not break.
 *
 * @param {unknown} value
 * @returns {number[]} Sorted, de-duplicated, clamped, never empty.
 */
export function parseSteps(value) {
  const text = String(value ?? '').trim();
  if (!text) return [...ISOCHRONE_STEPS];
  const seen = new Set();
  for (const part of text.split(',')) {
    if (part.trim() === '') continue;
    seen.add(clampSeconds(part));
    if (seen.size >= ISOCHRONE_MAX_RINGS) break;
  }
  return seen.size ? [...seen].sort((a, b) => a - b) : [...ISOCHRONE_STEPS];
}

/**
 * How much of the free-space expansion a ring actually achieved.
 *
 * In open ground a reachable area grows with the SQUARE of time, so doubling
 * the budget quadruples the area. Every shortfall is the network: a river with
 * one bridge, a railway, a motorway, a cul-de-sac. The ratio of the measured
 * growth to that 4× is therefore an obstruction reading that needs NO assumed
 * speed and no model — it is two measured areas divided by each other, which
 * is the only reason it is on the card.
 *
 * Reported per consecutive pair, so a 5→10 that is fine and a 10→15 that is not
 * are two different sentences.
 *
 * @param {Array<{seconds: number|null, areaKm2: number}>} rings Ascending.
 * @returns {Array<{fromSeconds: number, toSeconds: number, ratio: number,
 *   freeSpaceRatio: number, share: number}>}
 */
export function ringExpansion(rings) {
  const usable = (Array.isArray(rings) ? rings : [])
    .filter((ring) => Number.isFinite(ring?.seconds) && ring.seconds > 0 && ring.areaKm2 > 0)
    .sort((a, b) => a.seconds - b.seconds);
  const out = [];
  for (let i = 1; i < usable.length; i += 1) {
    const previous = usable[i - 1];
    const ring = usable[i];
    const ratio = ring.areaKm2 / previous.areaKm2;
    const freeSpaceRatio = (ring.seconds / previous.seconds) ** 2;
    out.push({
      fromSeconds: previous.seconds,
      toSeconds: ring.seconds,
      ratio: Math.round(ratio * 100) / 100,
      freeSpaceRatio: Math.round(freeSpaceRatio * 100) / 100,
      share: Math.round((ratio / freeSpaceRatio) * 1000) / 10,
    });
  }
  return out;
}

/**
 * The radius of the circle with the same area as a ring.
 *
 * On the card BESIDE the outline, never instead of it: it is the honest way to
 * say "how big" in one number, and it is exactly the circle this layer exists
 * to refuse — an address whose fifteen-minute walk covers 1.9 km² and one
 * whose covers 0.6 km² read identically as "1 km away".
 *
 * @param {number} areaKm2
 * @returns {number} Metres, rounded to ten.
 */
export function equivalentRadiusM(areaKm2) {
  if (!Number.isFinite(areaKm2) || areaKm2 <= 0) return 0;
  return Math.round(Math.sqrt((areaKm2 * 1e6) / Math.PI) / 10) * 10;
}

/**
 * Project the upstream answer into the ring the client draws.
 *
 * `resourceVersion` is relayed rather than pinned: it moved between two probes
 * on the same day, so a test asserting a value would fail on a Tuesday for no
 * reason. What IS pinned is that the field arrives at all — it is the only
 * evidence of which BD TOPO edition the ring was cut from.
 *
 * @param {object|null|undefined} payload
 * @returns {{profile: string|null, seconds: number|null, resourceVersion: string|null,
 *   ring: Array<number[]>, areaKm2: number}|null} Null when unusable.
 */
export function projectIsochrone(payload) {
  const geometry = payload?.geometry;
  if (geometry?.type !== 'Polygon' || !Array.isArray(geometry.coordinates?.[0])) return null;
  const ring = [];
  for (const point of geometry.coordinates[0]) {
    const lon = Number(point?.[0]);
    const lat = Number(point?.[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    ring.push([Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5]);
  }
  if (ring.length < 3) return null;
  const seconds = Number(payload?.costValue);
  return {
    profile: payload?.profile ?? null,
    seconds: Number.isFinite(seconds) ? seconds : null,
    resourceVersion: payload?.resourceVersion ?? null,
    ring,
    areaKm2: ringAreaKm2(ring),
  };
}
