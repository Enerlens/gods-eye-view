/**
 * @module polygonDissolve
 * @description Turn a group of adjacent GeoJSON polygons into the ONE outline
 * they actually share, plus the two shape operations that outline then needs.
 *
 * Written for `franceEnergy.js`, which measures TWELVE régions and used to
 * draw them as NINETY-SIX extruded départements. The seams between the eight
 * départements of Île-de-France were real geometry and false information: they
 * looked like eight readings at one altitude, and the first person to look at
 * the layer read them as exactly that — « on n'arrive pas à distinguer un
 * département par rapport à un autre », about a map where no département is
 * measured at all. A mark per measurement is the fix, and a mark per
 * measurement needs the union of the shapes underneath it.
 *
 * ── Why a topological dissolve and not a boolean union ──────────────────────
 *
 * A general polygon union (Vatti, Greiner–Hormann, Martinez) handles arbitrary
 * overlapping input and costs a library. It is not needed here. The bundled
 * `departements.geojson` is a PLANAR SUBDIVISION cut from one IGN source: two
 * neighbouring départements do not merely touch, they share the identical
 * vertex list along their common boundary, in opposite directions. Measured on
 * the bundled file, across the thirteen régions: 14 335 points, 118 rings, and
 * every internal segment appears EXACTLY TWICE — zero segments appear three
 * times or more.
 *
 * So the union is a segment tally: a segment on the outside of the group is
 * used once, a segment inside it is used twice and cancels. Drop the cancelled
 * ones, stitch the rest end to end, and the result is the exterior — exact,
 * dependency-free, and O(n) instead of O(n log n) with a fragile predicate on
 * near-coincident edges.
 *
 * The tally is on the UNDIRECTED segment and the test is `count % 2 === 1`,
 * not `count === 1`. The measured data never needs the difference; the modulo
 * is what keeps a future file with a doubled coastline from producing a ring
 * that crosses itself.
 *
 * ── What this module deliberately does not do ───────────────────────────────
 *
 * It does not classify rings into shells and holes. A hole would come back as
 * one more ring with the opposite winding, and every caller here wants either
 * the largest ring (the mainland body) or all of them (the perimeter trace),
 * neither of which needs the classification. Adding it would be untested code
 * standing in for a case the bundled file does not contain: the thirteen
 * régions dissolve to a single shell each, plus small islands.
 */

/** Coordinate quantum for vertex identity, in degrees — 1e-6 ≈ 11 cm. */
const VERTEX_EPSILON_DEGREES = 1e-6;

/** Stable key for one vertex, tolerant of float noise but not of real gaps. */
function vertexKey(point) {
  const quantum = 1 / VERTEX_EPSILON_DEGREES;
  return `${Math.round(point[0] * quantum)},${Math.round(point[1] * quantum)}`;
}

/**
 * Every linear ring of one GeoJSON geometry, shells and holes alike.
 *
 * `Polygon` and `MultiPolygon` only: a dissolve of points or lines is not a
 * thing, and returning [] for them keeps a mixed FeatureCollection from
 * throwing halfway through.
 *
 * @param {object|null|undefined} geometry GeoJSON geometry.
 * @returns {Array<Array<number[]>>} Rings, each an array of `[lon, lat]`.
 */
export function geometryRings(geometry) {
  const type = geometry?.type;
  if (type === 'Polygon') return Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
  if (type !== 'MultiPolygon' || !Array.isArray(geometry.coordinates)) return [];
  const rings = [];
  for (const polygon of geometry.coordinates) {
    for (const ring of Array.isArray(polygon) ? polygon : []) rings.push(ring);
  }
  return rings;
}

/**
 * Dissolve a group of adjacent rings into the outline(s) of their union.
 *
 * The result is CLOSED (first point repeated last) and ordered largest first
 * by absolute area, which is what makes `[0]` mean "the mainland body" without
 * a second sort at every call site.
 *
 * A group whose parts do not touch — three islands, or the synthetic squares a
 * unit test builds — comes back as three rings, not one. That is the correct
 * answer and the callers rely on it.
 *
 * @param {Array<Array<number[]>>} rings Rings of every polygon in the group.
 * @returns {Array<Array<number[]>>} Merged closed rings, largest area first.
 */
export function dissolveRings(rings) {
  /** @type {Map<string, number>} undirected segment key → times used. */
  const tally = new Map();
  /** @type {Array<{from:string, to:string, a:number[], b:number[], key:string}>} */
  const directed = [];
  for (const ring of Array.isArray(rings) ? rings : []) {
    if (!Array.isArray(ring) || ring.length < 2) continue;
    for (let i = 0; i < ring.length - 1; i += 1) {
      const a = ring[i];
      const b = ring[i + 1];
      if (!Number.isFinite(a?.[0]) || !Number.isFinite(b?.[0])) continue;
      const from = vertexKey(a);
      const to = vertexKey(b);
      if (from === to) continue;
      const key = from < to ? `${from}|${to}` : `${to}|${from}`;
      tally.set(key, (tally.get(key) || 0) + 1);
      directed.push({ from, to, a, b, key });
    }
  }

  /** @type {Map<string, Array<{to:string, a:number[], b:number[], used:boolean}>>} */
  const adjacency = new Map();
  for (const segment of directed) {
    // Even means the segment is interior to the group and cancels; odd means
    // it survives on the boundary. See the header on why this is modulo.
    if (tally.get(segment.key) % 2 === 0) continue;
    const list = adjacency.get(segment.from);
    const edge = { to: segment.to, a: segment.a, b: segment.b, used: false };
    if (list) list.push(edge);
    else adjacency.set(segment.from, [edge]);
  }

  const merged = [];
  // Insertion order, so the same input always yields the same rings in the
  // same order — a dissolve that reshuffles between polls would rebuild
  // geometry for nothing.
  for (const [start, edges] of adjacency) {
    for (const seed of edges) {
      if (seed.used) continue;
      const ring = [seed.a];
      let edge = seed;
      edge.used = true;
      let node = edge.to;
      // One step per surviving segment at most: a walk that cannot close is a
      // broken input, and it must terminate rather than spin.
      for (let guard = directed.length; node !== start && guard > 0; guard -= 1) {
        ring.push(edge.b);
        const next = (adjacency.get(node) || []).find((candidate) => !candidate.used);
        if (!next) break;
        next.used = true;
        edge = next;
        node = edge.to;
      }
      if (ring.length < 3) continue;
      ring.push(ring[0]);
      merged.push(ring);
    }
  }
  return merged.sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)));
}

/**
 * Signed shoelace area of a closed ring, in SQUARE DEGREES.
 *
 * Square degrees, not square metres: every use here is a comparison between
 * two rings at the same latitude band (which is the largest, is this one an
 * island), and converting to metres would add a projection to a number nobody
 * displays. The sign is kept because it is the ring's winding.
 *
 * @param {Array<number[]>} ring
 * @returns {number}
 */
export function ringArea(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return 0;
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return sum / 2;
}

/**
 * Area-weighted centroid of a closed ring.
 *
 * The centroid of the AREA, not the mean of the vertices: a coastline carries
 * ten times the vertices of an inland border, and a vertex mean would drag the
 * centre of Bretagne out into the Atlantic. It is the point {@link scaleRing}
 * shrinks toward, so a wrong one would slide the prism off its own région.
 *
 * Degenerate rings (zero area) fall back to the vertex mean, which is the only
 * answer left and is right for the square a unit test hands in.
 *
 * @param {Array<number[]>} ring
 * @returns {number[]|null} `[lon, lat]`, or null for an unusable ring.
 */
export function ringCentroid(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return null;
  let twiceArea = 0;
  let lon = 0;
  let lat = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const cross = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    twiceArea += cross;
    lon += (ring[i][0] + ring[i + 1][0]) * cross;
    lat += (ring[i][1] + ring[i + 1][1]) * cross;
  }
  if (Math.abs(twiceArea) < 1e-12) {
    let sumLon = 0;
    let sumLat = 0;
    for (let i = 0; i < ring.length - 1; i += 1) {
      sumLon += ring[i][0];
      sumLat += ring[i][1];
    }
    const count = ring.length - 1;
    return [sumLon / count, sumLat / count];
  }
  return [lon / (3 * twiceArea), lat / (3 * twiceArea)];
}

/**
 * Shrink a ring toward a point by a uniform factor.
 *
 * A UNIFORM SCALE, deliberately, and not a buffer at a constant distance. An
 * inward buffer is the operation a cartographer would name, and it is the one
 * that fails: it self-intersects wherever the shape is narrower than twice the
 * offset — the Cotentin, the Gironde estuary, the Alpine valleys — and
 * repairing that is the polygon-clipping library this module exists to avoid.
 * A scale about an interior point cannot self-intersect at any factor, so the
 * shrunk ring is always a valid polygon.
 *
 * What it costs, stated: the pull-back is proportional to the région's own
 * size, so at 0.90 it is a measured 6.3 km for Île-de-France and 17.2 km for
 * Nouvelle-Aquitaine — a small région keeps more of its ground than a big one
 * does, which is the trade a constant-distance offset would have inverted. The
 * shape is preserved exactly; only the scale of the footprint is not. The
 * caller draws the true perimeter separately, which is what keeps this from
 * being a lie about where a région ends.
 *
 * @param {Array<number[]>} ring Closed ring.
 * @param {number} factor 1 leaves it alone; 0.9 pulls it in a tenth.
 * @param {number[]|null} [about] Centre, defaulting to the ring's centroid.
 * @returns {Array<number[]>} A new closed ring.
 */
export function scaleRing(ring, factor, about = null) {
  if (!Array.isArray(ring) || ring.length < 4) return Array.isArray(ring) ? ring.slice() : [];
  const centre = about || ringCentroid(ring);
  if (!centre || !Number.isFinite(factor) || factor === 1) return ring.slice();
  return ring.map((point) => [
    centre[0] + (point[0] - centre[0]) * factor,
    centre[1] + (point[1] - centre[1]) * factor,
  ]);
}

/**
 * The vertex of a ring set nearest to a point, by great-circle distance.
 *
 * Great-circle and not a lon/lat Pythagoras: at 46° north a degree of
 * longitude is 77 km against 111 km for a degree of latitude, and the naive
 * distance picks the wrong end of the Pyrénées by that ratio.
 *
 * The point is expected OUTSIDE the union the rings describe, which is what
 * makes the answer meaningful: the nearest vertex of a set of shapes to an
 * outside point necessarily lies on the outer boundary, so no separate
 * boundary extraction is needed to find it.
 *
 * @param {Array<Array<number[]>>} rings
 * @param {ReadonlyArray<number>} target `[lon, lat]`.
 * @returns {number[]|null} `[lon, lat]` of the nearest vertex.
 */
export function nearestRingVertex(rings, target) {
  if (!Array.isArray(rings) || !Number.isFinite(target?.[0]) || !Number.isFinite(target?.[1])) {
    return null;
  }
  const toRad = Math.PI / 180;
  const lat0 = target[1] * toRad;
  const lon0 = target[0] * toRad;
  const sin0 = Math.sin(lat0);
  const cos0 = Math.cos(lat0);
  let best = null;
  let bestDot = -Infinity;
  for (const ring of rings) {
    for (const point of Array.isArray(ring) ? ring : []) {
      if (!Number.isFinite(point?.[0]) || !Number.isFinite(point?.[1])) continue;
      const lat = point[1] * toRad;
      const lon = point[0] * toRad;
      // Cosine of the central angle — monotonically DEcreasing in distance,
      // so the largest dot product is the nearest vertex, and no acos is paid.
      const dot = sin0 * Math.sin(lat) + cos0 * Math.cos(lat) * Math.cos(lon - lon0);
      if (dot > bestDot) {
        bestDot = dot;
        best = point;
      }
    }
  }
  return best ? [best[0], best[1]] : null;
}

/** Flatten a closed ring into the `[lon, lat, lon, lat, …]` Cesium wants. */
export function flattenRing(ring) {
  const flat = [];
  for (const point of Array.isArray(ring) ? ring : []) {
    if (!Number.isFinite(point?.[0]) || !Number.isFinite(point?.[1])) continue;
    flat.push(point[0], point[1]);
  }
  return flat;
}
