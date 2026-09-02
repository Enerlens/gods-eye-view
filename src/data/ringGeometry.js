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
