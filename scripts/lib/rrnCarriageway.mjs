/**
 * Trace a road event onto the carriageway it names, from its PR addresses.
 *
 * The third module of the RRN family. `rrnBornage.mjs` reads the kilometre
 * posts, `rrnCentreline.mjs` reads the surveyed geometry and joins the two at
 * BUILD time for a fixed set of sensor sites — and this one answers the
 * question neither can: given a route number and two point-repère addresses,
 * where is that stretch of road? It runs at SERVE time, against the pack
 * `scripts/build-rrn-centreline-pack.mjs` commits, because a live event can be
 * anywhere on the network and there is no fixed set to precompute.
 *
 * ── WHY NOT `traceAlongRoad()` ──────────────────────────────────────────────
 *
 * That function exists next door and looks like the answer. It is not, and the
 * reason is worth stating because it is not obvious: `traceAlongRoad` takes
 * COORDINATES and snaps each end to the nearest kilometre post, refusing
 * anything beyond `CENTRELINE_SNAP_MAX_M` = 150 m. A PR address with an
 * abscissa of `+ 394 m` denotes a point 394 m from its own post — which that
 * gate then rejects as "not on this road". Measured over the live feed: 196
 * events resolve their two PR addresses, and only **31** of them survive
 * `traceAlongRoad`. The same 196 all trace when the work is done in cumulative
 * distance instead, because a PR address plus its abscissa IS a cumul and a
 * cumul indexes the polyline directly. No snapping, no gate, no loss.
 *
 * ── THE TWO GUARDS, AND WHY THEY ARE NOT OPTIONAL ───────────────────────────
 *
 * A PR address and a TPEG coordinate are two independent claims by the same
 * publisher about the same event, and 13 of the 196 disagree. The failure is
 * not subtle: `N2165` traces 82 614 m of rocade for a 218 m chord, `N0136`
 * 30 055 m for 258 m, and one `N0020` event lands 5 333 m from its own
 * published endpoint. Drawn unguarded, a 200 m worksite becomes a loop around
 * a city.
 *
 * So a trace is accepted only when it AGREES with the coordinates the same
 * record published: both traced ends within `MAX_END_ERROR_M` of the TPEG
 * endpoints, and traced length within `MAX_DETOUR_FACTOR` of the chord. 183 of
 * 196 pass. The 13 that fail keep the chord they have today — the layer is not
 * made worse by refusing to guess.
 *
 * ── THE 'U' TRAP ────────────────────────────────────────────────────────────
 *
 * DATEX writes the undivided carriageway as `U` (`81PR47U`). The bornage calls
 * it `I`, and `parsePrAddress` keeps a side letter only if it is one of
 * `BORNE_SIDES` = D/G/I — so it silently returns `side: null` for every `U`.
 * That is **137 of the 392** side letters in the live feed. A null side falls
 * through to whichever of D/G/I the referential happens to hold first, which on
 * a dual carriageway is the wrong side of the central reservation. The mapping
 * is done here, before the lookup, and a test pins it.
 *
 * @module scripts/lib/rrnCarriageway
 */

import { normaliseRouteCode, parsePrAddress } from './rrnBornage.mjs';

/**
 * How far a traced end may sit from the endpoint the SAME record published.
 *
 * 500 m is loose on purpose: the traced end is a point on the surveyed centre
 * of the carriageway and the TPEG endpoint is wherever the operator dropped a
 * pin, so tens of metres of honest disagreement is the normal case. This is
 * here to catch the eleven records whose two location systems name different
 * places, not to police ordinary error.
 */
export const MAX_END_ERROR_M = 500;

/**
 * How much longer than its own chord a traced event may be.
 *
 * Matches `CENTRELINE_DETOUR_FACTOR` next door. A road between two points is
 * longer than the line between them — p90 is 1.12× — but not three times
 * longer. Past that the addresses have been read onto the wrong stretch.
 */
export const MAX_DETOUR_FACTOR = 3;

/** DATEX's undivided-carriageway letter, and the bornage's name for it. */
const SIDE_ALIASES = Object.freeze({ U: 'I' });

/** Mean Earth radius, for the chord and end-error comparisons. */
const EARTH_RADIUS_M = 6371008.8;

/**
 * Rebuild one delta-coded section into flat Lambert-93 metres.
 * @param {Array<number>} deltas
 * @returns {Array<number>}
 */
function undelta(deltas) {
  const out = new Array(deltas.length);
  let x = 0;
  let y = 0;
  for (let i = 0; i < deltas.length; i += 2) {
    x += deltas[i];
    y += deltas[i + 1];
    out[i] = x;
    out[i + 1] = y;
  }
  return out;
}

/**
 * Index a built pack for lookup.
 *
 * Sections are decoded LAZILY — the pack holds 590 carriageways and a serve
 * touches a handful, so decoding all 167 110 vertices on load would be work
 * for nothing. Decoded carriageways are memoised on the index.
 *
 * @param {object} pack Parsed `config/rrn_centreline.json`.
 * @returns {{posts: Map<string, number>, carriageway: (key: string) => Array<object>|null, stats: object}}
 */
export function indexCarriagewayPack(pack) {
  const posts = new Map(Object.entries(pack?.posts || {}).map(([k, v]) => [k, Number(v)]));
  const raw = pack?.lines || {};
  const decoded = new Map();
  return {
    posts,
    stats: pack?.stats || null,
    bornageEdition: pack?.bornageEdition || null,
    centrelineEdition: pack?.centrelineEdition || null,
    carriageway(key) {
      if (decoded.has(key)) return decoded.get(key);
      const sections = raw[key];
      if (!Array.isArray(sections)) {
        decoded.set(key, null);
        return null;
      }
      const built = sections.map(([from, to, deltas]) => ({
        from: Number(from),
        to: Number(to),
        points: undelta(deltas),
      })).sort((a, b) => a.from - b.from);
      decoded.set(key, built);
      return built;
    },
  };
}

/**
 * The cumul a PR address plus its abscissa denotes, on a given carriageway.
 * @param {object} index From {@link indexCarriagewayPack}.
 * @param {string} route Canonical route code.
 * @param {{referent: string, distanceAlong: number}} address
 * @returns {{cumul: number, side: string|null, dep: string|null}|null}
 */
export function resolvePrCumul(index, route, address) {
  const parsed = parsePrAddress(address?.referent);
  if (!parsed) return null;
  // The letter `parsePrAddress` dropped, recovered from the raw string.
  const rawSide = /([A-Z])[CN]?$/.exec(String(address?.referent || '').trim().toUpperCase());
  const side = parsed.side
    || (rawSide ? (SIDE_ALIASES[rawSide[1]] || null) : null);
  const dep = parsed.dep;
  if (!dep || !side) return null;
  const cumul = index.posts.get(`${route}|${dep}|${parsed.pr}|${side}`);
  if (!Number.isFinite(cumul)) return null;
  const along = Number(address?.distanceAlong);
  return { cumul: cumul + (Number.isFinite(along) ? along : 0), side, dep };
}

/** Cumulative arc length of a flat point list. */
function arcLengths(points) {
  const lengths = [0];
  for (let i = 2; i < points.length; i += 2) {
    lengths.push(lengths[lengths.length - 1] + Math.hypot(
      points[i] - points[i - 2],
      points[i + 1] - points[i - 1],
    ));
  }
  return lengths;
}

/**
 * Clip one section's polyline to the [from, to] window of its own cumul range,
 * by PROPORTIONAL arc length.
 *
 * The pack stores a section's two cumul bounds and its drawn shape; it does not
 * store a cumul per vertex, and storing one would roughly double the file. The
 * survey's vertices are ~26 m apart and evenly spaced along the road, so
 * proportional interpolation inside a section is accurate to a fraction of that
 * spacing — far inside the 4 m simplification already applied.
 *
 * @param {{from:number,to:number,points:Array<number>}} section
 * @param {number} from Window start, cumul metres.
 * @param {number} to Window end, cumul metres.
 * @returns {Array<number>} Flat Lambert-93, possibly empty.
 */
export function clipSection(section, from, to) {
  const span = section.to - section.from;
  if (!(span > 0) || section.points.length < 4) return [];
  const lo = Math.max(from, section.from);
  const hi = Math.min(to, section.to);
  if (hi <= lo) return [];
  const lengths = arcLengths(section.points);
  const total = lengths[lengths.length - 1];
  if (!(total > 0)) return [];
  const at = (cumul) => ((cumul - section.from) / span) * total;
  const startS = at(lo);
  const endS = at(hi);
  const pointAt = (s) => {
    if (s <= 0) return [section.points[0], section.points[1]];
    if (s >= total) return [section.points[section.points.length - 2], section.points[section.points.length - 1]];
    let i = 1;
    while (i < lengths.length && lengths[i] < s) i += 1;
    const before = lengths[i - 1];
    const after = lengths[i];
    const t = after > before ? (s - before) / (after - before) : 0;
    const ax = section.points[(i - 1) * 2];
    const ay = section.points[(i - 1) * 2 + 1];
    const bx = section.points[i * 2];
    const by = section.points[i * 2 + 1];
    return [ax + (bx - ax) * t, ay + (by - ay) * t];
  };
  const out = pointAt(startS);
  for (let i = 0; i < lengths.length; i += 1) {
    if (lengths[i] <= startS) continue;
    if (lengths[i] >= endS) break;
    out.push(section.points[i * 2], section.points[i * 2 + 1]);
  }
  const end = pointAt(endS);
  out.push(end[0], end[1]);
  return out;
}

/** Great-circle distance between two `[lon, lat]` pairs, metres. */
export function haversineM(a, b) {
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLon = (b[0] - a[0]) * toRad;
  const lat = ((a[1] + b[1]) / 2) * toRad;
  return EARTH_RADIUS_M * Math.hypot(dLat, Math.cos(lat) * dLon);
}

/** Total length of a flat `[lon, lat, …]` list, metres. */
export function polylineLengthM(flat) {
  let total = 0;
  for (let i = 2; i < flat.length; i += 2) {
    total += haversineM([flat[i - 2], flat[i - 1]], [flat[i], flat[i + 1]]);
  }
  return total;
}

/**
 * Trace the stretch of carriageway an event's two PR addresses denote.
 *
 * @param {object} index From {@link indexCarriagewayPack}.
 * @param {object} request
 * @param {string} request.roadNumber DATEX `roadNumber`, e.g. `N0126`.
 * @param {{referent:string, distanceAlong:number}} request.from
 * @param {{referent:string, distanceAlong:number}} request.to
 * @param {Array<number>} request.chord Published `[lon, lat, lon, lat]`.
 * @param {(x:number, y:number) => {lon:number, lat:number}} request.toWgs84 Lambert-93 → WGS84.
 * @param {(flat:Array<number>, tol:number) => Array<number>} [request.simplify]
 * @param {number} [request.toleranceM]
 * @returns {{coordinates: Array<number>|null, reason: string|null, lengthM: number, endErrorM: number}}
 */
export function traceBetweenPr(index, {
  roadNumber, from, to, chord, toWgs84, simplify = null, toleranceM = 4,
}) {
  const refuse = (reason) => ({ coordinates: null, reason, lengthM: 0, endErrorM: 0 });
  const route = normaliseRouteCode(roadNumber);
  if (!route) return refuse('road number not a numbered route');

  const a = resolvePrCumul(index, route, from);
  const b = resolvePrCumul(index, route, to);
  if (!a || !b) return refuse('PR address not in the referential');
  // The two ends must be on the SAME carriageway: the two sides of a dual
  // road are separate polylines, and mixing them makes a segment zigzag across
  // the central reservation. When they disagree the undivided side wins if
  // either claims it, because that is the only side that can hold both.
  const side = a.side === b.side ? a.side : ((a.side === 'I' || b.side === 'I') ? 'I' : null);
  if (!side) return refuse('the two ends name different carriageways');

  const sections = index.carriageway(`${route}|${side}`);
  if (!sections?.length) return refuse('no surveyed centreline for that carriageway');

  const lo = Math.min(a.cumul, b.cumul);
  const hi = Math.max(a.cumul, b.cumul);
  if (!(hi > lo)) return refuse('the two ends are the same point');

  const flatL93 = [];
  for (const section of sections) {
    if (section.to < lo || section.from > hi) continue;
    const clipped = clipSection(section, lo, hi);
    for (let i = 0; i < clipped.length; i += 2) {
      // Drop a vertex that merely repeats the previous one at a section join.
      const n = flatL93.length;
      if (n >= 2 && Math.abs(flatL93[n - 2] - clipped[i]) < 0.5
        && Math.abs(flatL93[n - 1] - clipped[i + 1]) < 0.5) continue;
      flatL93.push(clipped[i], clipped[i + 1]);
    }
  }
  if (flatL93.length < 4) return refuse('no section covers that stretch');

  const simplified = simplify ? simplify(flatL93, toleranceM) : flatL93;
  const coordinates = [];
  for (let i = 0; i < simplified.length; i += 2) {
    const { lon, lat } = toWgs84(simplified[i], simplified[i + 1]);
    coordinates.push(lon, lat);
  }

  // ── The two guards. See the module header for what they catch.
  const publishedStart = [chord[0], chord[1]];
  const publishedEnd = [chord[2], chord[3]];
  const tracedStart = [coordinates[0], coordinates[1]];
  const tracedEnd = [coordinates[coordinates.length - 2], coordinates[coordinates.length - 1]];
  // The road's direction of measurement and the publisher's from/to are
  // independent, so the trace may run either way against the chord. Take
  // whichever pairing agrees better rather than declaring a false mismatch.
  const forward = Math.max(
    haversineM(tracedStart, publishedStart),
    haversineM(tracedEnd, publishedEnd),
  );
  const backward = Math.max(
    haversineM(tracedStart, publishedEnd),
    haversineM(tracedEnd, publishedStart),
  );
  const endErrorM = Math.min(forward, backward);
  const lengthM = polylineLengthM(coordinates);
  const chordM = haversineM(publishedStart, publishedEnd);

  if (endErrorM > MAX_END_ERROR_M) {
    return { coordinates: null, reason: 'traced ends disagree with the published ones', lengthM, endErrorM };
  }
  if (chordM > 0 && lengthM > chordM * MAX_DETOUR_FACTOR) {
    return { coordinates: null, reason: 'traced road is implausibly longer than its chord', lengthM, endErrorM };
  }

  // Run the trace the way the publisher wrote the event, so the card's
  // direction and the drawn line agree.
  if (backward < forward) {
    const reversed = [];
    for (let i = coordinates.length - 2; i >= 0; i -= 2) reversed.push(coordinates[i], coordinates[i + 1]);
    return { coordinates: reversed, reason: null, lengthM, endErrorM };
  }
  return { coordinates, reason: null, lengthM, endErrorM };
}
