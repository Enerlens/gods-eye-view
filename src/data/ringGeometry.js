/**
 * @module ringGeometry
 *
 * Polygon-ring arithmetic shared by the layers that draw published French
 * polygons — the cadastre (`cadastreFeed.js`) and the Géoportail de
 * l'urbanisme (`gpuFeed.js`).
 *
 * Both hold their shapes in the same form, which is GeoJSON's: a feature is a
 * list of PARTS, and a part is `[outerRing, ...interiorRings]` with each ring
 * a list of `[lon, lat]`. Both then need the same three answers of it — is
 * this point on the shape, how big is its bounding box, and where inside it
 * can a label stand — and the cadastre had already paid for the first two when
 * the urbanism layer needed them.
 *
 * Dependency-free and side-effect-free (no Cesium, no DOM) so it runs
 * identically in the browser, in the Vite dev-server proxy, and under
 * `node --test`.
 */

/** How many horizontal scanlines {@link ringLabelAnchor} tries. */
const LABEL_SCANLINES = 17;

/**
 * Axis-aligned bounds of a shape's OUTER rings, as a cheap rejection test.
 *
 * Precomputed once per record and checked before any ray casting: a click has
 * to be resolved against every shape on screen, and four comparisons each is
 * the difference between a hit test and a stutter.
 * @param {Array<Array<Array<number[]>>>} parts
 * @returns {?{south:number, west:number, north:number, east:number}}
 */
export function polygonsBounds(parts) {
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const part of parts || []) {
    for (const point of part?.[0] || []) {
      if (!Array.isArray(point)) continue;
      const lon = point[0];
      const lat = point[1];
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
      if (lon < west) west = lon;
      if (lon > east) east = lon;
    }
  }
  return Number.isFinite(south) && Number.isFinite(west) ? {
    south, west, north, east,
  } : null;
}

/**
 * Ray-casting point-in-ring. `ring` is `[[lon, lat], …]`, open or closed.
 * @param {number} lon
 * @param {number} lat
 * @param {Array<number[]>} ring
 * @returns {boolean}
 */
export function pointInRing(lon, lat, ring) {
  if (!Array.isArray(ring) || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[j];
    const b = ring[i];
    if (!Array.isArray(a) || !Array.isArray(b)) continue;
    const intersects = ((b[1] > lat) !== (a[1] > lat))
      && (lon < ((a[0] - b[0]) * (lat - b[1])) / (a[1] - b[1]) + b[0]);
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Whether a point falls on a shape — inside one of its outer rings and inside
 * none of that ring's holes.
 *
 * The hole test is not a nicety. On a cadastral parcel, click inside the
 * Palais-Royal's courtyard and the honest answer is that you have not clicked
 * the parcel. On a PLU zone it is the difference between the rule that applies
 * to this house and the one that applies to the school next door.
 * @param {Array<Array<Array<number[]>>>} parts
 * @param {number} lon
 * @param {number} lat
 * @returns {boolean}
 */
export function pointInPolygons(parts, lon, lat) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
  for (const part of parts || []) {
    if (!Array.isArray(part) || !pointInRing(lon, lat, part[0])) continue;
    let inHole = false;
    for (let h = 1; h < part.length; h += 1) {
      if (pointInRing(lon, lat, part[h])) { inHole = true; break; }
    }
    if (!inHole) return true;
  }
  return false;
}

/**
 * Longitudes at which the rings of one part cross a given latitude.
 * @param {Array<Array<number[]>>} rings
 * @param {number} lat
 * @returns {number[]} Sorted ascending.
 */
function crossingsAt(rings, lat) {
  const xs = [];
  for (const ring of rings || []) {
    if (!Array.isArray(ring) || ring.length < 3) continue;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const a = ring[j];
      const b = ring[i];
      if (!Array.isArray(a) || !Array.isArray(b)) continue;
      if ((b[1] > lat) === (a[1] > lat)) continue;
      xs.push(((a[0] - b[0]) * (lat - b[1])) / (a[1] - b[1]) + b[0]);
    }
  }
  return xs.sort((x, y) => x - y);
}

/**
 * A point INSIDE a shape, wide of its edges, to stand a label on.
 *
 * NOT the centroid. A PLU zone is routinely a long meander following a village
 * street, or a ring around a hamlet, and the centroid of either lands outside
 * the shape — a label sitting on ground its own colour does not cover is a
 * lie, and a worse one than no label at all.
 *
 * So: the midpoint of the LONGEST INTERIOR CHORD found across a fixed set of
 * horizontal scanlines. Crossings are collected from the outer ring and its
 * holes together and read even-odd, which is exact for a shape whose holes lie
 * inside its outer ring and do not overlap — the form a published polygon
 * takes. The result is always strictly inside, and it is naturally in the
 * FATTEST part of the shape, which is where a label has room. Scanning rather
 * than solving keeps it linear in vertices and free of the tolerance choices a
 * true pole-of-inaccessibility needs.
 *
 * Ties are broken toward the first scanline, so the anchor is stable across
 * redraws rather than flickering between two equal chords.
 *
 * @param {Array<Array<number[]>>} rings One part: `[outer, ...holes]`.
 * @returns {?{lon:number, lat:number, widthDeg:number}} Null when no scanline
 *   found interior width — a sliver, which gets no label rather than a guess.
 */
export function ringLabelAnchor(rings) {
  const outer = rings?.[0];
  if (!Array.isArray(outer) || outer.length < 3) return null;
  let south = Infinity;
  let north = -Infinity;
  for (const point of outer) {
    const lat = Number(point?.[1]);
    if (!Number.isFinite(lat)) continue;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  if (!Number.isFinite(south) || north <= south) return null;

  let best = null;
  for (let i = 1; i <= LABEL_SCANLINES; i += 1) {
    const lat = south + ((north - south) * i) / (LABEL_SCANLINES + 1);
    const xs = crossingsAt(rings, lat);
    // Even-odd: spans between crossings 0-1, 2-3, … are inside the shape.
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const width = xs[k + 1] - xs[k];
      if (width <= 0 || (best && width <= best.widthDeg)) continue;
      best = { lon: (xs[k] + xs[k + 1]) / 2, lat, widthDeg: width };
    }
  }
  if (!best) return null;
  // Rounded like the rings themselves. This is a place to stand a label, not a
  // measurement: seventeen digits of it are noise, and they are noise that
  // rides on every zone in every response.
  return {
    lon: Number(best.lon.toFixed(5)),
    lat: Number(best.lat.toFixed(5)),
    widthDeg: Number(best.widthDeg.toFixed(6)),
  };
}

/**
 * The AUTHALIC radius of WGS84, in metres — the radius of the sphere with the
 * same surface area as the ellipsoid, which is the one an area formula wants.
 * Not the equatorial 6 378 137, which is the semi-major axis and overstates
 * every area here by 0.22%: on parcel `33063000KD0112`, whose legal cadastral
 * `contenance` at the IGN is 45 m², this returns 45.04 and the equatorial
 * radius returns 45.14.
 */
const EARTH_RADIUS_M = 6371007.181;

/**
 * The area a ring encloses, in square metres, unsigned.
 *
 * Spherical excess rather than a planar shoelace, so the same function is
 * honest for a parcel in Bordeaux and a commune in Guyane without anyone
 * choosing a projection first. At parcel scale the two agree to well under a
 * square metre; the point of the spherical form is that it does not quietly
 * stop agreeing as the shape or the latitude grows.
 *
 * Two callers, two uses. The permit layer prints it — the ground an emprise
 * covers, measured off the outline actually drawn rather than copied from a
 * column that disagrees with it on 2% of rows. {@link sanitisePolygonParts}
 * uses it as a floor, to refuse a ring that encloses nothing.
 *
 * It is not a collinearity test and must not be used as one: three points on
 * a lon/lat straight line still bound a real spherical area, because a
 * lon/lat straight line is not a geodesic. At degree scale that is 1.9 km²;
 * at the parcel scale this runs at it is two millionths of a square metre.
 *
 * @param {Array<number[]>} ring `[[lon, lat], …]`, open or closed.
 * @returns {number} Square metres, 0 for anything degenerate.
 */
export function ringAreaM2(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  const toRad = Math.PI / 180;
  let total = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[j];
    const b = ring[i];
    if (!Array.isArray(a) || !Array.isArray(b)) return 0;
    const lon1 = Number(a[0]) * toRad;
    const lat1 = Number(a[1]) * toRad;
    const lon2 = Number(b[0]) * toRad;
    const lat2 = Number(b[1]) * toRad;
    if (!Number.isFinite(lon1) || !Number.isFinite(lat1)
      || !Number.isFinite(lon2) || !Number.isFinite(lat2)) return 0;
    total += (lon2 - lon1) * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  return Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
}

/**
 * How close two published vertices have to be to be the same vertex, in
 * degrees. 1e-9° is about 0.1 mm — below any cadastral survey, and far below
 * the 1 cm the seven-decimal sources here publish at.
 */
const VERTEX_EPSILON_DEG = 1e-9;

/**
 * Drop a ring's repeated vertices, returning it open.
 *
 * @param {Array<number[]>} ring
 * @returns {Array<number[]>} Possibly empty.
 */
function distinctVertices(ring) {
  const out = [];
  for (const point of ring || []) {
    if (!Array.isArray(point)) continue;
    const lon = Number(point[0]);
    const lat = Number(point[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - lon) < VERTEX_EPSILON_DEG
      && Math.abs(last[1] - lat) < VERTEX_EPSILON_DEG) continue;
    out.push([lon, lat]);
  }
  // GeoJSON closes its rings; an open ring is what the renderers here take.
  while (out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.abs(first[0] - last[0]) >= VERTEX_EPSILON_DEG
      || Math.abs(first[1] - last[1]) >= VERTEX_EPSILON_DEG) break;
    out.pop();
  }
  return out;
}

/**
 * Make published polygon parts safe to hand a renderer, or reject them.
 *
 * WHY THIS EXISTS AT ALL. A published polygon is not a valid one. Bordeaux
 * Métropole's permit file ships its emprises straight out of Oracle Spatial
 * and carries the validator's own verdict alongside them: 428 of its 309 094
 * rows are flagged (`ORA-13349` boundary crosses itself, `13350` rings touch,
 * `13356` adjacent points redundant), and 108 of those are published with no
 * geometry at all. Measured 2026-09-02.
 *
 * WHAT THE FLAG IS NOT. It is tempting to drop every flagged row. Measured
 * against each row's own published `superficie`, the 320 flagged rows that DO
 * carry a geometry draw it at a median 0.997 of their stated area — they are
 * very nearly all correct. Dropping them would discard three hundred true
 * emprises to avoid a handful of bad ones. So the flag is not the test, and
 * this function does not read it.
 *
 * WHAT IT DOES INSTEAD, measured over that file's 134 413 rows that carry a
 * geometry — 136 570 parts, 137 916 rings, 2 736 112 vertices:
 *
 * - **Opens every ring.** GeoJSON closes its rings and all 137 916 here are
 *   closed; the renderers in this repo take open ones and close them
 *   themselves. That alone is most of the 5% of vertices this removes.
 * - **Drops consecutive duplicates.** 45 rings, in 45 rows, repeat a vertex
 *   back to back — 187 vertices in all. A zero-length segment is a degenerate
 *   triangle in tessellation, and it is what makes a ring read as
 *   "self-intersecting" to any test that does not special-case it. This is
 *   what `ORA-13356` names.
 * - **Refuses rings that enclose nothing**, as a floor rather than a filter —
 *   fewer than three distinct vertices, or no area at all. No ring in that
 *   file trips it: parts in and parts out are both 136 570, rings in and out
 *   both 137 916, and not one row is left with no polygon. It is here for the
 *   next publisher, not for this one.
 *
 * A REPAIR DELIBERATELY NOT MADE. Every ring after the first in a part IS a
 * hole, so the obvious next check is that a hole lies inside its own outer
 * ring — and it was written, measured, and removed. None of the file's 1 346
 * inner rings lies entirely outside. Fourteen lie PARTLY outside, and they are
 * not misplaced: they share an edge with the outer ring, which is a boundary
 * case a point-in-ring test decides by floating-point luck. Three of the
 * fourteen are courtyards of 787, 754 and 249 m², and the publisher flagged
 * none of them. Requiring containment would have filled them in —
 * silently, and looking exactly like a parcel with no courtyard.
 *
 * A part whose OUTER ring does not survive is dropped whole: a hole without
 * the land around it is not a smaller truth, it is a different shape.
 *
 * @param {Array<Array<Array<number[]>>>} parts `[[outer, ...holes], …]`.
 * @returns {Array<Array<Array<number[]>>>} The same shape, cleaned. Empty when
 *   nothing survived, which callers must read as "no polygon" and fall back.
 */
export function sanitisePolygonParts(parts) {
  const clean = [];
  for (const part of parts || []) {
    if (!Array.isArray(part) || !part.length) continue;
    const outer = distinctVertices(part[0]);
    // Three distinct vertices is the least that can enclose anything; the area
    // is a second floor for the paths that get there with unusable numbers.
    if (outer.length < 3 || ringAreaM2(outer) <= 0) continue;
    const rings = [outer];
    for (let h = 1; h < part.length; h += 1) {
      const hole = distinctVertices(part[h]);
      if (hole.length < 3 || ringAreaM2(hole) <= 0) continue;
      rings.push(hole);
    }
    clean.push(rings);
  }
  return clean;
}
