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
  return Math.round(rawRingAreaKm2(ring) * 100) / 100;
}

/**
 * The same area, unrounded, for arithmetic that happens BEFORE the rounding.
 *
 * A polygon's area is its exterior less its holes, and a courtyard of 0,004 km²
 * rounds to 0,00 on its own — so subtracting rounded holes from a rounded
 * exterior silently keeps every small hole in the catchment. Round once, at the
 * end.
 *
 * @param {Array<number[]>} ring
 * @returns {number}
 */
export function rawRingAreaKm2(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  const R = 6371.0088;
  const toRad = Math.PI / 180;
  let total = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[(i + 1) % ring.length];
    total += (lon2 - lon1) * toRad * (2 + Math.sin(lat1 * toRad) + Math.sin(lat2 * toRad));
  }
  return Math.abs(total * R * R / 2);
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
 * A GeoJSON geometry as a list of polygons, each a list of rings.
 *
 * `Polygon` and `MultiPolygon` only. A `GeometryCollection` or a line is not an
 * isochrone and is refused rather than coerced into one.
 *
 * @param {object|null|undefined} geometry
 * @returns {Array<Array<Array<number[]>>>}
 */
function geometryPolygons(geometry) {
  const coordinates = geometry?.coordinates;
  if (geometry?.type === 'Polygon' && Array.isArray(coordinates?.[0])) return [coordinates];
  if (geometry?.type === 'MultiPolygon' && Array.isArray(coordinates)) {
    return coordinates.filter((polygon) => Array.isArray(polygon?.[0]));
  }
  return [];
}

/**
 * One ring, rounded to five decimals — or null if any vertex is unusable.
 *
 * Five decimals is about a metre, which is finer than BD TOPO's own geometry
 * and coarse enough to halve the payload.
 *
 * `Number()` is deliberately NOT used to parse: `Number(null)` is 0 and
 * `Number([])` is 0, so a coordinate that is missing or malformed passes
 * `Number.isFinite` as a point on the null island. Only an actual number is
 * accepted.
 *
 * @param {unknown} raw
 * @returns {Array<number[]>|null}
 */
function cleanRing(raw) {
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const ring = [];
  for (const point of raw) {
    if (!Array.isArray(point)) return null;
    const [lon, lat] = point;
    if (typeof lon !== 'number' || typeof lat !== 'number') return null;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
    ring.push([Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5]);
  }
  return ring.length >= 3 ? ring : null;
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
 *   ring: Array<number[]>, holes: Array<Array<number[]>>,
 *   parts: Array<{ring: Array<number[]>, holes: Array<Array<number[]>>}>,
 *   areaKm2: number}|null} Null when unusable.
 */
export function projectIsochrone(payload) {
  const geometry = payload?.geometry;
  const polygons = geometryPolygons(geometry);
  if (!polygons.length) return null;

  const parts = [];
  for (const polygon of polygons) {
    const rings = [];
    for (const raw of polygon) {
      const ring = cleanRing(raw);
      // A RING IS ALL OR NOTHING. The old loop skipped bad vertices and closed
      // the gap by joining their neighbours, which silently redraws the shape
      // across whatever was wrong — and `Number(null)` is 0, so a null
      // longitude did not even get skipped: it planted a vertex in the Gulf of
      // Guinea and the ring was drawn to it and back.
      if (!ring) return null;
      rings.push(ring);
    }
    if (!rings.length) continue;
    parts.push({ ring: rings[0], holes: rings.slice(1) });
  }
  if (!parts.length) return null;

  // Largest part first, so the single `ring` a renderer or a card reads is the
  // main body of the shape rather than whichever piece the service listed
  // first. The area, however, is the WHOLE thing, holes subtracted.
  parts.sort((a, b) => rawRingAreaKm2(b.ring) - rawRingAreaKm2(a.ring));
  const areaKm2 = parts.reduce(
    (total, part) => total + rawRingAreaKm2(part.ring)
      - part.holes.reduce((cut, hole) => cut + rawRingAreaKm2(hole), 0),
    0,
  );

  const seconds = Number(payload?.costValue);
  return {
    profile: payload?.profile ?? null,
    seconds: Number.isFinite(seconds) ? seconds : null,
    resourceVersion: payload?.resourceVersion ?? null,
    ring: parts[0].ring,
    // The interior rings, kept rather than dropped: a courtyard with no way in,
    // a fenced railway yard and a walled works are ground the isochrone does
    // NOT reach, and `coordinates[0]` alone sells them as catchment. The fiche
    // joins population against these too.
    holes: parts[0].holes,
    // Every piece, when the reachable ground comes in more than one. The old
    // code refused a MultiPolygon outright and the layer reported a missing
    // ring; refusing is safe but it is not an answer.
    parts,
    areaKm2: Math.round(areaKm2 * 100) / 100,
  };
}

/* ========================================================================== *
 * CYCLING — a second service, because the first one does not have the answer.
 * ========================================================================== */

/**
 * WHY A CYCLING RING NEEDED A DIFFERENT SOURCE ENTIRELY.
 *
 * Re-probed 2026-09-02, and the refusal has not moved: `profile=bicycle`,
 * `bike`, `cycle` and `cycling` all answer HTTP 400 from the Géoplateforme with
 * `value should be one of car,pedestrian`, on `bdtopo-valhalla` and on
 * `bdtopo-pgr` alike. BD TOPO has no cycling cost model, so there is nothing to
 * ask it for. A cycling ring therefore has to come from a network that knows
 * what a cycle track is, and in France that is OpenStreetMap.
 *
 * FOSSGIS runs the Valhalla instance that WOULD answer this in one call. It was
 * unreachable from two networks on 2026-09-02 (TCP connect timeout to
 * valhalla1.openstreetmap.de:443, twice, while DNS resolved), so it is not a
 * dependency this can rest on. Its sibling — the OSRM cluster at
 * `routing.openstreetmap.de/routed-bike` — answered in 0.6 s, and this
 * repository already routes through it for `/api/route`.
 *
 * WHAT OSRM CAN AND CANNOT GIVE. OSRM has no isochrone endpoint. It has
 * `/table`, which answers the travel time from one origin to up to ~400
 * destinations in ONE request. So the ring is measured rather than modelled —
 * every vertex is a real routed cycling duration on the OSM network — but it is
 * measured ALONG SPOKES: 36 bearings, 11 samples each, and the reachable
 * distance on each bearing is the point where the measured duration crosses the
 * budget. What is drawn between two neighbouring spokes is a straight line
 * nobody measured.
 *
 * SO IT IS AN ENVELOPE, AND IT IS LABELLED ONE. A star polygon cannot express
 * the two things the IGN polygon can: a pocket you cannot reach, and a
 * catchment in disconnected pieces. It fills them in, so its area is an UPPER
 * BOUND, never the "surface réellement atteignable" the other two rings report.
 * Measured 2026-09-02, running this exact method on the WALKING network and
 * comparing it against the IGN walking polygon at the same point:
 *
 *   Lyon Presqu'île   5/10/15 min   +1 %   +17 %   +19 %
 *   Paris 11e                       +14 %  +11 %   +14 %
 *   Bordeaux centre                 −24 %  +2 %    +9 %
 *   Ustaritz (64)                   −32 %  −12 %   +40 %
 *   Cantal, rural                   +117 % +69 %   +69 %
 *
 * The rural row is the honest worst case and the reason the label matters:
 * where the network is a handful of roads, the true shape is a spider and any
 * envelope around it is mostly ground you cannot reach. That table is printed
 * on the card, not buried here.
 *
 * The two figures also differ because the NETWORKS differ — OSM against BD
 * TOPO — and the comparison deliberately does not try to separate the two: what
 * a reader wants to know is whether the drawn shape is the right size, and that
 * is the combined question.
 */
export const OSRM_BIKE_TABLE_URL = 'https://routing.openstreetmap.de/routed-bike/table/v1/driving';

/**
 * Spokes, and samples along each.
 *
 * 36 × 11 + the origin is 397 coordinates. Measured: 401 coordinates answer in
 * 0.6 s; 601 answer HTTP 414, the URL being the limit rather than the engine.
 * More bearings were tried and bought nothing — at 24, 32, 48 and 64 spokes the
 * Lyon walking envelope stayed within a point of +19 %, because the error is
 * the star SHAPE and not its angular resolution. 36 is where the drawn outline
 * stops looking faceted: 10° is 600 m between vertices at a 3.5 km reach.
 */
export const BIKE_ENVELOPE_BEARINGS = 36;
export const BIKE_ENVELOPE_SAMPLES = 11;

/** Hard cap on one OSRM table request. See above: 601 coordinates is a 414. */
export const OSRM_TABLE_MAX_POINTS = 400;

/**
 * The speed the SAMPLE LADDER is laid out with — not a speed anything is
 * measured at.
 *
 * 22 km/h is deliberately faster than anyone rides: its only job is to put the
 * outermost sample beyond the furthest reachable point, so the crossing is
 * bracketed instead of clipped. Every duration in between comes from OSRM's own
 * cycling cost model, gradients, one-ways and traffic signals included.
 */
export const BIKE_LADDER_KMH = 22;

/**
 * How the samples are spaced along a spoke.
 *
 * Above 1 they crowd the near end, where a five-minute ring lands, and spread
 * at the far end, where the fifteen-minute crossing is found by interpolating
 * between two measured durations rather than by the sample spacing.
 */
const BIKE_LADDER_CURVE = 1.3;

const DEG = Math.PI / 180;
const EARTH_KM = 6371.0088;

/**
 * The point `distanceKm` away from another on a given bearing.
 *
 * Spherical rather than the flat `dlat = km / 111.32` shortcut, which is off by
 * the cosine of the latitude on the east-west axis and would draw an oval
 * envelope over Dunkerque and a rounder one over Perpignan — a shape artefact
 * that looks exactly like a finding.
 *
 * @param {number} lon Degrees.
 * @param {number} lat Degrees.
 * @param {number} bearingDeg Clockwise from north.
 * @param {number} distanceKm
 * @returns {number[]} `[lon, lat]`.
 */
export function destinationPoint(lon, lat, bearingDeg, distanceKm) {
  const delta = distanceKm / EARTH_KM;
  const theta = bearingDeg * DEG;
  const phi1 = lat * DEG;
  const lambda1 = lon * DEG;
  const sinPhi2 = Math.sin(phi1) * Math.cos(delta)
    + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta);
  const phi2 = Math.asin(Math.min(1, Math.max(-1, sinPhi2)));
  const lambda2 = lambda1 + Math.atan2(
    Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
    Math.cos(delta) - Math.sin(phi1) * sinPhi2,
  );
  return [
    Math.round((((lambda2 / DEG + 540) % 360) - 180) * 1e5) / 1e5,
    Math.round((phi2 / DEG) * 1e5) / 1e5,
  ];
}

/**
 * The sample radii along one spoke, in kilometres, near to far.
 * @param {number} maxSeconds The longest ring the fan has to bracket.
 * @param {number} [samples]
 * @returns {number[]}
 */
export function bikeLadderKm(maxSeconds, samples = BIKE_ENVELOPE_SAMPLES) {
  const outerKm = Math.max(0.5, (BIKE_LADDER_KMH * clampSeconds(maxSeconds)) / 3600);
  const out = [];
  for (let i = 1; i <= samples; i += 1) {
    out.push(Math.round(outerKm * ((i / samples) ** BIKE_LADDER_CURVE) * 1000) / 1000);
  }
  return out;
}

/**
 * The fan of points one table request measures.
 *
 * The ORIGIN IS FIRST and is the table's only source, so the answer is one row
 * of durations in exactly this order — bearing-major, near to far within each
 * bearing.
 *
 * @param {{lon: number, lat: number, seconds: number, bearings?: number,
 *   samples?: number}} query
 * @returns {{origin: number[], bearings: number, radiiKm: number[], points: Array<number[]>}}
 */
export function bikeFanPoints({
  lon, lat, seconds,
  bearings = BIKE_ENVELOPE_BEARINGS,
  samples = BIKE_ENVELOPE_SAMPLES,
}) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw new Error('isochrone: lon/lat must be finite numbers');
  }
  if (!Number.isInteger(bearings) || bearings < 8) throw new Error('isochrone: need at least 8 bearings');
  const radiiKm = bikeLadderKm(seconds, samples);
  const total = bearings * radiiKm.length + 1;
  if (total > OSRM_TABLE_MAX_POINTS) {
    throw new Error(`isochrone: fan of ${total} points exceeds the ${OSRM_TABLE_MAX_POINTS} the table accepts`);
  }
  const origin = [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5];
  const points = [origin];
  for (let b = 0; b < bearings; b += 1) {
    const bearingDeg = (b * 360) / bearings;
    for (const km of radiiKm) points.push(destinationPoint(lon, lat, bearingDeg, km));
  }
  return { origin, bearings, radiiKm, points };
}

/**
 * The OSRM table URL for a fan.
 *
 * `sources=0` asks for ONE row — the origin against everything — rather than
 * the full 397² matrix, which is the difference between a 100 KB answer and an
 * upstream that would rightly refuse.
 *
 * @param {Array<number[]>} points `[lon, lat]`, origin first.
 * @returns {string}
 */
export function buildBikeTableUrl(points) {
  if (!Array.isArray(points) || points.length < 2) {
    throw new Error('isochrone: bike table needs an origin and at least one destination');
  }
  if (points.length > OSRM_TABLE_MAX_POINTS) {
    throw new Error(`isochrone: bike table capped at ${OSRM_TABLE_MAX_POINTS} points`);
  }
  const coords = points.map((point) => {
    const [lon, lat] = Array.isArray(point) ? point : [];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      throw new Error('isochrone: bike table point must be a finite [lon, lat]');
    }
    return `${lon.toFixed(5)},${lat.toFixed(5)}`;
  }).join(';');
  return `${OSRM_BIKE_TABLE_URL}/${coords}?sources=0&annotations=duration`;
}

/**
 * How far one spoke reaches inside a time budget.
 *
 * The furthest sample that CAME IN UNDER the budget wins, not the first one
 * that went over — OSRM's answers are not monotonic along a ray, because a
 * sample 200 m further out can snap onto a cycle track and come back quicker
 * than its neighbour. Taking the first crossing would cut the spoke at that
 * dip and report a catchment smaller than the one measured.
 *
 * The crossing itself is then interpolated between the last sample under and
 * the next one over, in DURATION rather than in distance, so the answer is not
 * quantised to the sample ladder.
 *
 * @param {Array<{km: number, sec: number|null}>} samples Ascending by km.
 * @param {number} seconds Budget.
 * @returns {{reachKm: number, clipped: boolean}} `clipped` when the ladder ran
 *   out while the spoke was still inside the budget — the reach is a floor.
 */
export function bearingReachKm(samples, seconds) {
  const usable = Array.isArray(samples) ? samples : [];
  let anchor = { km: 0, sec: 0 };
  for (const sample of usable) {
    if (Number.isFinite(sample?.sec) && sample.sec <= seconds && sample.km > anchor.km) {
      anchor = { km: sample.km, sec: sample.sec };
    }
  }
  const beyond = usable.find(
    (sample) => sample?.km > anchor.km && Number.isFinite(sample?.sec) && sample.sec > seconds,
  );
  if (beyond && beyond.sec > anchor.sec) {
    const share = (seconds - anchor.sec) / (beyond.sec - anchor.sec);
    return { reachKm: Math.round((anchor.km + share * (beyond.km - anchor.km)) * 1000) / 1000, clipped: false };
  }
  const outermost = usable.length ? usable[usable.length - 1].km : 0;
  // No sample over the budget beyond the anchor: either the ladder ended while
  // still inside it (clipped, and the ring is a floor), or everything further
  // out was unroutable, which is a real edge and not a clip.
  return { reachKm: anchor.km, clipped: anchor.km > 0 && anchor.km >= outermost };
}

/**
 * Project one OSRM table row into the rings the client draws.
 *
 * Shaped exactly like {@link projectIsochrone}'s output — `ring`, `holes`,
 * `parts`, `areaKm2` — so the renderer and the fiche need no second code path,
 * plus the fields that say this one is an envelope and must not be read as the
 * IGN polygon.
 *
 * @param {object} query
 * @param {Array<number|null>} query.durations The table's first row, WITHOUT
 *   the origin-to-origin zero.
 * @param {{origin: number[], bearings: number, radiiKm: number[]}} query.fan
 * @param {number[]} query.steps Ascending budgets, in seconds.
 * @param {number|null} [query.snapM] Distance the origin was snapped onto the
 *   cycling network, from the table's own `sources[0].distance`.
 * @returns {Array<object>} One entry per step that produced a shape.
 */
export function projectBikeEnvelope({ durations, fan, steps, snapM = null }) {
  const { origin, bearings, radiiKm } = fan || {};
  const row = Array.isArray(durations) ? durations : [];
  if (!Array.isArray(origin) || !bearings || !Array.isArray(radiiKm) || !radiiKm.length) return [];
  if (row.length !== bearings * radiiKm.length) return [];

  const rings = [];
  for (const seconds of steps) {
    const reaches = [];
    let clippedBearings = 0;
    for (let b = 0; b < bearings; b += 1) {
      const samples = radiiKm.map((km, i) => {
        const sec = row[b * radiiKm.length + i];
        return { km, sec: typeof sec === 'number' && Number.isFinite(sec) ? sec : null };
      });
      const { reachKm, clipped } = bearingReachKm(samples, seconds);
      if (clipped) clippedBearings += 1;
      reaches.push(reachKm);
    }
    // Nothing reachable at all — an origin OSRM could not attach to the cycling
    // network, most often a pin dropped on water. Dropped rather than drawn as
    // a point, for the same reason a failed IGN ring is dropped.
    if (!reaches.some((km) => km > 0)) continue;
    const ring = reaches.map((km, b) => destinationPoint(origin[0], origin[1], (b * 360) / bearings, km));
    const sorted = [...reaches].sort((a, b) => a - b);
    rings.push({
      profile: 'bike',
      seconds,
      resourceVersion: null,
      ring,
      holes: [],
      parts: [{ ring, holes: [] }],
      areaKm2: ringAreaKm2(ring),
      // Everything below this line exists so the card can refuse to be read as
      // an IGN measurement.
      envelope: true,
      bearings,
      clippedBearings,
      reachKm: {
        min: Math.round(sorted[0] * 100) / 100,
        median: Math.round(sorted[Math.floor(sorted.length / 2)] * 100) / 100,
        max: Math.round(sorted[sorted.length - 1] * 100) / 100,
      },
      snapM: Number.isFinite(snapM) ? Math.round(snapM) : null,
    });
  }
  return rings;
}
