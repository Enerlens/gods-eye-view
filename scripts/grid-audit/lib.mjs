/**
 * Minimal, dependency-free readers for the reference data used to audit the
 * OSM-backed power-grid layer:
 *
 *   - ESRI Shapefile (.shp polyline + .dbf attributes), because the official
 *     mirror of RTE's pre-2023 network is published as one, and this machine
 *     has neither GDAL nor pyproj.
 *   - Lambert-93 (EPSG:2154) -> WGS84, the IGN NT/G-71 inverse (ALG0004 +
 *     ALG0002), because the same mirror is projected and OSM is not.
 *
 * Nothing here is shipped: this is a measuring instrument, not a data source.
 */
import fs from 'node:fs';

// ---------------------------------------------------------------------------
// Lambert-93 inverse
// ---------------------------------------------------------------------------
// IGN constants for EPSG:2154 (RGF93 / Lambert-93), GRS80 ellipsoid,
// standard parallels 44N/49N, origin 46.5N 3E, false E/N 700000/6600000.
const L93 = Object.freeze({
  n: 0.725_607_765_053_267,
  C: 11_754_255.426_096,
  Xs: 700_000.0,
  Ys: 12_655_612.049_876,
  e: 0.081_819_191_06, // GRS80 first eccentricity
  lambdaC: (3 * Math.PI) / 180,
});

/**
 * Invert the isometric latitude (IGN ALG0002). Converges to well under a
 * millimetre in a handful of turns at French latitudes; the iteration cap is a
 * backstop, not the exit condition.
 * @param {number} L isometric latitude
 * @param {number} e first eccentricity
 * @returns {number} geodetic latitude, radians
 */
function latitudeFromIsometric(L, e) {
  const expL = Math.exp(L);
  let phi = 2 * Math.atan(expL) - Math.PI / 2;
  for (let i = 0; i < 32; i += 1) {
    const s = e * Math.sin(phi);
    const next = 2 * Math.atan(((1 + s) / (1 - s)) ** (e / 2) * expL) - Math.PI / 2;
    if (Math.abs(next - phi) < 1e-13) return next;
    phi = next;
  }
  return phi;
}

/**
 * Lambert-93 easting/northing -> [longitude, latitude] in degrees (WGS84;
 * RGF93 and WGS84 agree to well under a metre, far below anything this audit
 * measures).
 * @param {number} x metres
 * @param {number} y metres
 * @returns {[number, number]}
 */
export function l93ToWgs84(x, y) {
  const dx = x - L93.Xs;
  const dy = y - L93.Ys;
  const R = Math.hypot(dx, dy);
  const gamma = Math.atan2(dx, -dy);
  const lambda = L93.lambdaC + gamma / L93.n;
  const L = -(1 / L93.n) * Math.log(R / L93.C);
  const phi = latitudeFromIsometric(L, L93.e);
  return [(lambda * 180) / Math.PI, (phi * 180) / Math.PI];
}

// ---------------------------------------------------------------------------
// Shapefile geometry (.shp)
// ---------------------------------------------------------------------------
/** Shape types this audit knows how to read. */
const SHP_NULL = 0;
const SHP_POLYLINE = 3;
const SHP_POLYLINE_Z = 13;
const SHP_POLYLINE_M = 23;

/**
 * Read every polyline record of a .shp, reprojected to WGS84.
 * @param {string} file path to the .shp
 * @returns {{shapeType:number, bbox:number[], parts:Array<Array<[number,number]>>[]}}
 */
export function readPolylineShp(file) {
  const buf = fs.readFileSync(file);
  const code = buf.readInt32BE(0);
  if (code !== 9994) throw new Error(`${file}: not a shapefile (code ${code})`);
  const shapeType = buf.readInt32LE(32);
  const bbox = [buf.readDoubleLE(36), buf.readDoubleLE(44), buf.readDoubleLE(52), buf.readDoubleLE(60)];
  const end = buf.readInt32BE(24) * 2; // file length is in 16-bit words

  const shapes = [];
  let off = 100;
  while (off < end) {
    const contentWords = buf.readInt32BE(off + 4);
    const body = off + 8;
    const type = buf.readInt32LE(body);
    if (type === SHP_NULL) {
      shapes.push([]);
    } else if (type === SHP_POLYLINE || type === SHP_POLYLINE_Z || type === SHP_POLYLINE_M) {
      const numParts = buf.readInt32LE(body + 36);
      const numPoints = buf.readInt32LE(body + 40);
      const partsOff = body + 44;
      const pointsOff = partsOff + numParts * 4;
      const starts = [];
      for (let p = 0; p < numParts; p += 1) starts.push(buf.readInt32LE(partsOff + p * 4));
      const parts = [];
      for (let p = 0; p < numParts; p += 1) {
        const from = starts[p];
        const to = p + 1 < numParts ? starts[p + 1] : numPoints;
        const ring = [];
        for (let i = from; i < to; i += 1) {
          const px = buf.readDoubleLE(pointsOff + i * 16);
          const py = buf.readDoubleLE(pointsOff + i * 16 + 8);
          ring.push(l93ToWgs84(px, py));
        }
        parts.push(ring);
      }
      shapes.push(parts);
    } else {
      throw new Error(`${file}: unsupported shape type ${type}`);
    }
    off = body + contentWords * 2;
  }
  return { shapeType, bbox, shapes };
}

// ---------------------------------------------------------------------------
// Shapefile attributes (.dbf)
// ---------------------------------------------------------------------------
/**
 * Read a dBASE III+ table as an array of plain objects. Deleted records are
 * returned as null so indexes stay aligned with the .shp.
 * @param {string} file path to the .dbf
 * @param {string} [encoding] from the sidecar .cpg
 * @returns {Array<?Object>}
 */
export function readDbf(file, encoding = 'utf8') {
  const buf = fs.readFileSync(file);
  const numRecords = buf.readInt32LE(4);
  const headerLen = buf.readInt16LE(8);
  const recordLen = buf.readInt16LE(10);

  const fields = [];
  for (let off = 32; buf[off] !== 0x0d && off < headerLen; off += 32) {
    const name = buf.toString('latin1', off, off + 11).replace(/\0.*$/, '').trim();
    fields.push({ name, type: String.fromCharCode(buf[off + 11]), length: buf[off + 16] });
  }

  const dec = (b) => (encoding === 'utf8' ? b.toString('utf8') : b.toString('latin1'));
  const rows = [];
  for (let r = 0; r < numRecords; r += 1) {
    let off = headerLen + r * recordLen;
    const deleted = buf[off] === 0x2a;
    off += 1;
    const row = {};
    for (const f of fields) {
      const raw = dec(buf.subarray(off, off + f.length)).trim();
      off += f.length;
      if (f.type === 'N' || f.type === 'F') row[f.name] = raw === '' ? null : Number(raw);
      else if (f.type === 'L') row[f.name] = /^[YyTt]$/.test(raw);
      else row[f.name] = raw === '' ? null : raw;
    }
    rows.push(deleted ? null : row);
  }
  return rows;
}

/** Field names of a .dbf, without reading the records. */
export function dbfFields(file) {
  const buf = fs.readFileSync(file);
  const headerLen = buf.readInt16LE(8);
  const out = [];
  for (let off = 32; buf[off] !== 0x0d && off < headerLen; off += 32) {
    out.push({
      name: buf.toString('latin1', off, off + 11).replace(/\0.*$/, '').trim(),
      type: String.fromCharCode(buf[off + 11]),
      length: buf[off + 16],
    });
  }
  return { numRecords: buf.readInt32LE(4), fields: out };
}

// ---------------------------------------------------------------------------
// Geodesy shared by both sides of the comparison
// ---------------------------------------------------------------------------
const EARTH_R = 6_371_008.8;

/**
 * Great-circle distance in metres.
 * @param {number} lon1 @param {number} lat1 @param {number} lon2 @param {number} lat2
 */
export function haversine(lon1, lat1, lon2, lat2) {
  const d = Math.PI / 180;
  const dLat = (lat2 - lat1) * d;
  const dLon = (lon2 - lon1) * d;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * d) * Math.cos(lat2 * d) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Total great-circle length of a [lon,lat][] path, in metres. */
export function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += haversine(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
  }
  return total;
}

/**
 * A coarse lon/lat bucket index for nearest-neighbour queries. At French
 * latitudes a 0.02 degree cell is roughly 1.5 x 2.2 km, so a 2 km search
 * radius needs only the 3x3 neighbourhood.
 */
export class GridIndex {
  constructor(cellDeg = 0.02) {
    this.cell = cellDeg;
    this.buckets = new Map();
  }

  /** @param {number} lon @param {number} lat @param {*} value */
  add(lon, lat, value) {
    const key = `${Math.floor(lon / this.cell)}:${Math.floor(lat / this.cell)}`;
    let bucket = this.buckets.get(key);
    if (!bucket) this.buckets.set(key, (bucket = []));
    bucket.push({ lon, lat, value });
  }

  /**
   * Every entry within `radius` metres, nearest first.
   * @param {number} lon @param {number} lat @param {number} radius
   */
  near(lon, lat, radius) {
    const span = Math.max(1, Math.ceil(radius / (this.cell * 111_320 * Math.cos((lat * Math.PI) / 180))));
    const spanLat = Math.max(1, Math.ceil(radius / (this.cell * 110_574)));
    const cx = Math.floor(lon / this.cell);
    const cy = Math.floor(lat / this.cell);
    const found = [];
    for (let dx = -span; dx <= span; dx += 1) {
      for (let dy = -spanLat; dy <= spanLat; dy += 1) {
        const bucket = this.buckets.get(`${cx + dx}:${cy + dy}`);
        if (!bucket) continue;
        for (const entry of bucket) {
          const d = haversine(lon, lat, entry.lon, entry.lat);
          if (d <= radius) found.push({ ...entry, distance: d });
        }
      }
    }
    return found.sort((a, b) => a.distance - b.distance);
  }
}

/**
 * Parse the voltages out of an OSM `voltage` tag or an RTE `tension` string.
 * OSM gives volts in a `;` list; RTE gives "225kV", "<45kV", "COURANT CONTINU".
 * @param {?string} raw
 * @returns {number[]} volts, descending, junk removed
 */
export function parseVolts(raw) {
  if (!raw) return [];
  const text = String(raw).trim();
  const kv = text.match(/^<?\s*(\d+(?:[.,]\d+)?)\s*kv$/i);
  if (kv) return [Math.round(Number(kv[1].replace(',', '.')) * 1000)];
  const out = [];
  for (const piece of text.split(';')) {
    const n = Number(piece.trim());
    if (Number.isFinite(n) && n > 0) out.push(n);
  }
  return [...new Set(out)].sort((a, b) => b - a);
}
