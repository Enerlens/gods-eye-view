/**
 * National IRVE rollup — the 231 079 charge points folded onto the 96
 * département polygons, so the layer has something to say at national altitude
 * that is neither nothing nor 40 000 overlapping dots.
 *
 * ── Why a choropleth, and why départements ──────────────────────────────────
 * This is the technique `franceEnergy.js` and `meteoFranceVigilance.js` already
 * use, on the same bundled geometry: a scalar per département painted onto
 * shapes that are already in the bundle (IGN ADMIN EXPRESS via france-geojson,
 * `local_data/france_departements/`). Nothing new is downloaded to draw it, and
 * a reader who has seen Vigilance knows how to read it.
 *
 * ── Why the rollup cannot come from the file's own columns ──────────────────
 * `bornes-irve` HAS a `departement` and a `region` column. Both are **null on
 * all 231 079 rows** (measured 2026-08-27) — they exist in the schema and were
 * never filled. `code_insee_commune` is present on 165 245 rows (71.5%) and
 * `consolidated_code_postal` on 133 307 (57.7%), so neither can carry a
 * national total either. The département is therefore resolved from the
 * COORDINATE, by point-in-polygon against the bundled shapes — the only field
 * this dataset fills for every row.
 *
 * ── The trap that makes the sweep non-obvious: truncation is silent ─────────
 * Opendatasoft caps an aggregated query at `offset + limit <= 30000` and,
 * past it, **returns exactly `limit` rows with HTTP 200 and no error field**.
 * Measured: the whole dataset grouped at `limit=20000` comes back 200 OK with
 * 20 000 rows summing to 71 125 of 231 079 charge points. A national map built
 * on that would draw a third of France and look completely plausible.
 *
 * So the sweep is adaptive and self-verifying, twice over: a latitude stripe
 * whose result length REACHES the limit is presumed truncated and split in
 * half, and the assembled total is checked against the dataset's own
 * `total_count` at the end. Neither check alone is enough — the first cannot
 * see a stripe that truncated at exactly `limit - 1`, and the second cannot say
 * where the loss was.
 *
 * ── What the map shows, and what it deliberately does not ───────────────────
 * The painted scalar is the ABSOLUTE number of charge points, in quantile bins.
 * Not density: the range per 1 000 km² runs from 43.9 (Lozère) to 101 785
 * (Paris, which is 104 km²), a factor of 2 300 that leaves 95 départements
 * indistinguishable while saying nothing about where the infrastructure is.
 * The count runs 227 → 10 539, a factor of 46, and it answers the question
 * actually being asked. Quantile bins rather than linear ones for the same
 * reason: on a linear ramp Paris alone occupies the top fifth of the scale.
 *
 * Density IS computed — from the polygons' own spherical area, so it needs no
 * second dataset — and reported per département on the card, where an area
 * bias in the fill can be checked against it rather than hidden by it.
 *
 * ── What is not painted ─────────────────────────────────────────────────────
 * The bundled polygons are the 96 metropolitan départements including Corse.
 * There are no DOM shapes, so Guadeloupe, Martinique, Guyane, La Réunion and
 * Mayotte are counted as `unassigned` and reported as a number rather than
 * folded into a neighbour or silently dropped — the same rule the Mix élec
 * layer applies to Corse, in the other direction. The file's foreign stations
 * (Belgium, Luxembourg, Germany) land in the same bucket.
 *
 * ── One thing the map moves, and says it moved ──────────────────────────────
 * Those shapes are the SIMPLIFIED outlines, so a point on a real coastline can
 * fall in the sea: 886 charge points do, including the centre of Ajaccio. Any
 * point that misses every polygon but lies within `IRVE_COAST_SNAP_KM` of one
 * is counted there, and counted again in `pdcSnapped` — see that constant for
 * where the 2 km came from, and why it cannot reach Belgium.
 *
 * Dependency-free and side-effect-free (no Cesium, no DOM) so it runs
 * identically in the browser, in the Vite dev-server proxy, and under
 * `node --test`.
 */
import {
  IRVE_BAND_KEYS,
  IRVE_SITE_DECIMALS,
  irveCoordinateVerdict,
  irvePowerBand,
  irveSiteKey,
} from './irveFeed.js';

/**
 * Band key → the small integer the mesh tuple carries. The middle regime
 * ships 39 859 sites in one document, and `"accelere"` costs ten bytes where
 * `2` costs one.
 */
const BAND_INDEX = Object.freeze(Object.fromEntries(
  IRVE_BAND_KEYS.map((band, index) => [band, index]),
));
/** Index of the out-of-envelope band, which is never a site's "top" band. */
const UNKNOWN_BAND_INDEX = IRVE_BAND_KEYS.length - 1;

/**
 * Group key for the national sweep — deliberately five columns and not the
 * viewport regime's eighteen.
 *
 * Every extra column multiplies the group count, and this query has to cover
 * all of France rather than one city: these five come to 72 106 groups for
 * 231 073 charge points (measured), where the viewport key would come to
 * several hundred thousand and could not be swept at all. `puissance_nominale`
 * earns its place by giving every département its own band split; the two
 * verification columns earn theirs by letting the sweep apply the SAME
 * three-way coordinate verdict the viewport regime applies, so a national
 * total and a city view can never disagree about which points are real.
 */
export const IRVE_SWEEP_FIELDS = Object.freeze([
  'consolidated_latitude',
  'consolidated_longitude',
  'puissance_nominale',
  'consolidated_is_lon_lat_correct',
  'consolidated_commune',
]);

/**
 * Rows requested per grouped stripe. Opendatasoft refuses `offset + limit`
 * above 30 000; 20 000 leaves headroom and matches the per-viewport cap.
 */
export const IRVE_SWEEP_LIMIT = 20000;
/**
 * Latitude span of the first pass, in degrees. The sweep covers the whole
 * globe rather than a French bounding box — the file puts a Gironde station at
 * −44.996 and a Guadeloupe one at +61.520, and a sweep that assumed France
 * would silently fail its own total check on those.
 */
export const IRVE_SWEEP_SEED_SPAN_DEG = 10;
/**
 * Narrowest latitude stripe the sweep will split down to, in degrees.
 *
 * A floor is needed because the split is a recursion on a value the upstream
 * controls: without it, a dataset that put more than `IRVE_SWEEP_LIMIT`
 * distinct coordinates on a single latitude would halve for ever. At 1/64° the
 * recursion is bounded at 15 levels from the full globe, and a stripe that
 * still truncates there is reported rather than subdivided.
 */
export const IRVE_SWEEP_MIN_SPAN_DEG = 1 / 64;
/** Number of quantile bins on the choropleth ramp. */
export const IRVE_DEPARTEMENT_BINS = 6;
/**
 * How far outside every polygon a charge point may sit and still be counted in
 * the nearest département, in km.
 *
 * The bundled shapes are the SIMPLIFIED IGN outlines — 14 335 vertices for all
 * of France, so the whole of Corse-du-Sud is 152 points and the Gulf of
 * Ajaccio is cut straight across. Without a tolerance, 886 real French charge
 * points fall in the sea: 62 at Antibes, 40 at La Rochelle, and the centre of
 * Ajaccio itself.
 *
 * 2 km is not a taste; it is where the measured distribution breaks. Of those
 * 886, 601 are within 500 m of a boundary, 778 within 2 km, and then there is
 * a gap — 8 between 2 and 5 km, and 100 beyond 5 km which are genuinely in
 * Belgium, Luxembourg and Germany. Snapping at 2 km recovers the simplification
 * error and reaches no foreign station.
 *
 * Snapped charge points are counted separately and reported, because moving a
 * point is a thing the map did rather than a thing the file said.
 */
export const IRVE_COAST_SNAP_KM = 2;
/** Mean Earth radius (km), for the polygons' own spherical area. */
const EARTH_RADIUS_KM = 6371.0088;

/**
 * Whether a stripe's grouped answer has to be presumed incomplete.
 *
 * Reaching the limit is the only signal Opendatasoft gives — there is no error,
 * no flag, and no `total_count` on an aggregated response. See the header.
 *
 * @param {number} resultLength Rows the stripe returned.
 * @param {number} [limit]
 * @returns {boolean}
 */
export function sweepStripeTruncated(resultLength, limit = IRVE_SWEEP_LIMIT) {
  return Number(resultLength) >= Number(limit);
}

/**
 * Signed spherical area of one closed ring, in km².
 *
 * The polygons are simplified 1:*, so this is the area of the SHAPE THAT IS
 * DRAWN rather than the département's official area — which is the right one
 * to divide by, because it is what the reader is looking at.
 *
 * @param {Array<Array<number>>} ring `[lon, lat]` pairs.
 * @returns {number} Area in km², always positive.
 */
export function ringAreaKm2(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return 0;
  let total = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[i + 1];
    if (![lon1, lat1, lon2, lat2].every(Number.isFinite)) continue;
    total += toRadians(lon2 - lon1)
      * (2 + Math.sin(toRadians(lat1)) + Math.sin(toRadians(lat2)));
  }
  return Math.abs(total * EARTH_RADIUS_KM * EARTH_RADIUS_KM / 2);
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

/** Axis-aligned bounds of a ring, as `[west, south, east, north]`. */
function ringBbox(ring) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const point of ring) {
    const lon = Number(point?.[0]);
    const lat = Number(point?.[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return [west, south, east, north];
}

function bboxHas(bbox, lon, lat) {
  return lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}

/**
 * Even-odd ray cast against one ring.
 *
 * @param {number} lon
 * @param {number} lat
 * @param {Array<Array<number>>} ring
 * @returns {boolean}
 */
export function pointInRing(lon, lat, ring) {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if ((yi > lat) !== (yj > lat)
      && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Index the bundled département polygons for repeated point lookups.
 *
 * Every part of a `MultiPolygon` keeps its own bbox: ten départements carry
 * islands, and a single bbox around Finistère plus Ouessant would admit a
 * large patch of sea as a candidate on every point tested.
 *
 * @param {object} geojson The bundled `departements.geojson`.
 * @returns {{list:Array<object>, byCode:Map<string,object>}}
 */
export function buildDepartementIndex(geojson) {
  const features = Array.isArray(geojson?.features) ? geojson.features : [];
  const list = [];
  for (const feature of features) {
    const code = String(feature?.properties?.code ?? '').trim();
    const geometry = feature?.geometry;
    if (!code || !geometry) continue;
    const polygons = geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : (geometry.type === 'MultiPolygon' ? geometry.coordinates : []);
    const parts = [];
    let areaKm2 = 0;
    for (const polygon of polygons) {
      if (!Array.isArray(polygon) || !polygon.length) continue;
      const rings = polygon.filter((ring) => Array.isArray(ring) && ring.length >= 4);
      if (!rings.length) continue;
      parts.push({ rings, bbox: ringBbox(rings[0]) });
      areaKm2 += ringAreaKm2(rings[0]);
      for (const hole of rings.slice(1)) areaKm2 -= ringAreaKm2(hole);
    }
    if (!parts.length) continue;
    const bbox = [
      Math.min(...parts.map((part) => part.bbox[0])),
      Math.min(...parts.map((part) => part.bbox[1])),
      Math.max(...parts.map((part) => part.bbox[2])),
      Math.max(...parts.map((part) => part.bbox[3])),
    ];
    list.push({
      code,
      name: String(feature?.properties?.nom ?? '').trim() || code,
      parts,
      bbox,
      areaKm2: Math.max(0, areaKm2),
    });
  }
  list.sort((a, b) => a.code.localeCompare(b.code));
  return { list, byCode: new Map(list.map((entry) => [entry.code, entry])) };
}

/**
 * Resolve a coordinate to a département code.
 *
 * @param {{list:Array<object>}} index From `buildDepartementIndex`.
 * @param {number} lat
 * @param {number} lon
 * @returns {?string} INSEE code, or null when the point is outside all 96.
 */
export function locateDepartement(index, lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  for (const entry of index?.list || []) {
    if (!bboxHas(entry.bbox, lon, lat)) continue;
    for (const part of entry.parts) {
      if (!bboxHas(part.bbox, lon, lat)) continue;
      if (!pointInRing(lon, lat, part.rings[0])) continue;
      let inHole = false;
      for (let i = 1; i < part.rings.length; i += 1) {
        if (pointInRing(lon, lat, part.rings[i])) { inHole = true; break; }
      }
      if (!inHole) return entry.code;
    }
  }
  return null;
}

/** Local metres-per-degree, adequate over the few km this is used across. */
function degreeScale(lat) {
  return { kx: 111.320 * Math.cos((lat * Math.PI) / 180), ky: 110.574 };
}

/** Distance in km from a point to one great-circle-ish segment. */
function segmentDistanceKm(lat, lon, a, b) {
  const { kx, ky } = degreeScale(lat);
  const px = (lon - a[0]) * kx;
  const py = (lat - a[1]) * ky;
  const vx = (b[0] - a[0]) * kx;
  const vy = (b[1] - a[1]) * ky;
  const length = vx * vx + vy * vy;
  const t = length > 0 ? Math.max(0, Math.min(1, (px * vx + py * vy) / length)) : 0;
  return Math.hypot(px - vx * t, py - vy * t);
}

/**
 * Nearest département to a point that is outside all of them, within a bound.
 *
 * Only ever called for a point that already missed every polygon, so the cost
 * is paid by the ~300 coastal groups in a national sweep rather than by the
 * 39 859 that resolve directly.
 *
 * @param {{list:Array<object>}} index
 * @param {number} lat
 * @param {number} lon
 * @param {number} [maxKm]
 * @returns {?{code:string, km:number}} Null when nothing is close enough.
 */
export function nearestDepartementWithin(index, lat, lon, maxKm = IRVE_COAST_SNAP_KM) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const padDeg = maxKm / 100;
  let best = null;
  let bestKm = Infinity;
  for (const entry of index?.list || []) {
    if (lon < entry.bbox[0] - padDeg || lon > entry.bbox[2] + padDeg
      || lat < entry.bbox[1] - padDeg || lat > entry.bbox[3] + padDeg) continue;
    for (const part of entry.parts) {
      const ring = part.rings[0];
      for (let i = 0; i < ring.length - 1; i += 1) {
        const km = segmentDistanceKm(lat, lon, ring[i], ring[i + 1]);
        if (km < bestKm) {
          bestKm = km;
          best = entry.code;
        }
      }
    }
  }
  return best && bestKm <= maxKm ? { code: best, km: bestKm } : null;
}

/** Linear-interpolated quantile of a pre-sorted numeric array. */
function quantile(sorted, p) {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/**
 * Quantile thresholds for the choropleth ramp.
 *
 * Returns `binCount - 1` ascending upper bounds: a value at or below
 * `thresholds[i]` belongs to bin `i`, and anything above the last belongs to
 * the top bin. Départements with no charge point at all are excluded from the
 * distribution — they are drawn as absence, not as the bottom of a scale.
 *
 * @param {Array<number>} counts
 * @param {number} [binCount]
 * @returns {Array<number>}
 */
export function irveCountBins(counts, binCount = IRVE_DEPARTEMENT_BINS) {
  const bins = Math.max(2, Math.floor(binCount));
  const sorted = (counts || [])
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (!sorted.length) return new Array(bins - 1).fill(0);
  const thresholds = [];
  for (let i = 1; i < bins; i += 1) {
    thresholds.push(Math.round(quantile(sorted, i / bins)));
  }
  // Ties can collapse two thresholds onto one value, which would leave an
  // empty bin in the middle of the legend. Keeping them strictly ascending
  // costs nothing and keeps every legend row reachable.
  for (let i = 1; i < thresholds.length; i += 1) {
    if (thresholds[i] <= thresholds[i - 1]) thresholds[i] = thresholds[i - 1] + 1;
  }
  return thresholds;
}

/**
 * Bin index for one count.
 *
 * @param {number} count
 * @param {Array<number>} thresholds From `irveCountBins`.
 * @returns {number} 0-based bin, or -1 for a département with nothing in it.
 */
export function irveCountBin(count, thresholds) {
  const value = Number(count);
  if (!Number.isFinite(value) || value <= 0) return -1;
  const bounds = Array.isArray(thresholds) ? thresholds : [];
  for (let i = 0; i < bounds.length; i += 1) {
    if (value <= bounds[i]) return i;
  }
  return bounds.length;
}

/**
 * Fold a national sweep onto the départements.
 *
 * @param {object} input
 * @param {Array<object>} input.groups Grouped rows: the coordinate columns,
 *   `puissance_nominale`, the verification columns, and a `pdc` count.
 * @param {{list:Array<object>, byCode:Map}} input.index From `buildDepartementIndex`.
 * @param {?number} [input.totalCount] The dataset's own national count.
 * @param {number} [input.binCount]
 * @returns {object} National rollup.
 */
export function projectIrveDepartements({
  groups,
  index,
  totalCount = null,
  binCount = IRVE_DEPARTEMENT_BINS,
  snapKm = IRVE_COAST_SNAP_KM,
} = {}) {
  const rows = Array.isArray(groups) ? groups : [];
  const tally = new Map();
  /** Coordinate → département, so a 224-charge-point car park is located once. */
  const located = new Map();
  /** Coordinate → `[lat, lon, pdc, band]`, the middle regime's point set. */
  const meshBySite = new Map();

  let pdcSwept = 0;
  let pdcWithheld = 0;
  let pdcInvalid = 0;
  let pdcUnassigned = 0;
  let pdcSnapped = 0;

  for (const row of rows) {
    const count = Math.max(0, Math.trunc(Number(row?.pdc)) || 0);
    if (!count) continue;
    pdcSwept += count;

    // The same three-way verdict the viewport regime uses, so the national
    // total and a city view can never disagree about which points are real.
    const verdict = irveCoordinateVerdict(row);
    if (verdict === 'invalid') { pdcInvalid += count; continue; }
    if (verdict === 'contradicted') { pdcWithheld += count; continue; }

    const lat = Number(row.consolidated_latitude);
    const lon = Number(row.consolidated_longitude);
    const key = irveSiteKey(lat, lon);
    let hitCode;
    if (located.has(key)) {
      hitCode = located.get(key);
    } else {
      // Inside a polygon, or — for the 886 charge points the simplified
      // coastline leaves in the sea — within `IRVE_COAST_SNAP_KM` of one.
      const inside = locateDepartement(index, lat, lon);
      hitCode = inside
        ? { code: inside, snapped: false }
        : (() => {
          const near = nearestDepartementWithin(index, lat, lon, snapKm);
          return near ? { code: near.code, snapped: true } : null;
        })();
      located.set(key, hitCode);
    }
    if (!hitCode) { pdcUnassigned += count; continue; }
    const code = hitCode.code;
    if (hitCode.snapped) pdcSnapped += count;

    let entry = tally.get(code);
    if (!entry) {
      entry = {
        pdc: 0,
        sites: new Set(),
        bands: Object.fromEntries(IRVE_BAND_KEYS.map((band) => [band, 0])),
      };
      tally.set(code, entry);
    }
    const band = irvePowerBand(row.puissance_nominale);
    entry.pdc += count;
    entry.sites.add(key);
    entry.bands[band] += count;

    // The same pass also builds the middle regime's point set. It is free
    // here — every site is already visited — and it is the ONLY place it can
    // be built without a second national sweep.
    let site = meshBySite.get(key);
    if (!site) {
      site = [Number(lat.toFixed(IRVE_SITE_DECIMALS)), Number(lon.toFixed(IRVE_SITE_DECIMALS)), 0, -1];
      meshBySite.set(key, site);
    }
    site[2] += count;
    const bandIndex = BAND_INDEX[band];
    // `inconnue` never becomes a site's top band: a car park whose only
    // readable reading is 7 kW is a 7 kW site even when the row beside it
    // publishes 7 360. Same rule as the per-viewport projection.
    if (bandIndex !== UNKNOWN_BAND_INDEX && bandIndex > site[3]) site[3] = bandIndex;
  }

  const thresholds = irveCountBins(
    [...tally.values()].map((entry) => entry.pdc),
    binCount,
  );

  const departements = [];
  for (const entry of index?.list || []) {
    const hit = tally.get(entry.code);
    const pdc = hit ? hit.pdc : 0;
    const areaKm2 = Math.round(entry.areaKm2);
    departements.push({
      code: entry.code,
      name: entry.name,
      pdc,
      sites: hit ? hit.sites.size : 0,
      bands: hit ? hit.bands : Object.fromEntries(IRVE_BAND_KEYS.map((band) => [band, 0])),
      areaKm2,
      // Derived from the polygon that is actually drawn, so a reader can check
      // the fill's area bias against a rate rather than having to trust it.
      per1000Km2: areaKm2 > 0 ? Math.round((pdc / areaKm2) * 1000 * 10) / 10 : null,
      bin: irveCountBin(pdc, thresholds),
    });
  }
  departements.sort((a, b) => b.pdc - a.pdc || a.code.localeCompare(b.code));

  const pdcAssigned = departements.reduce((sum, entry) => sum + entry.pdc, 0);
  const expected = totalCount === null || totalCount === undefined || totalCount === ''
    ? NaN
    : Number(totalCount);

  // A site with no readable power at all keeps the out-of-envelope band
  // rather than the -1 sentinel, so the client never has to know about it.
  const mesh = [...meshBySite.values()];
  for (const site of mesh) {
    if (site[3] < 0) site[3] = UNKNOWN_BAND_INDEX;
  }
  mesh.sort((a, b) => b[2] - a[2] || a[0] - b[0] || a[1] - b[1]);

  return {
    departements,
    mesh,
    thresholds,
    binCount: Math.max(2, Math.floor(binCount)),
    painted: departements.filter((entry) => entry.pdc > 0).length,
    pdcAssigned,
    pdcSwept,
    pdcWithheld,
    pdcInvalid,
    // Overseas départements, and the foreign stations this file carries —
    // Belgium, Luxembourg and Germany are all 5+ km outside the nearest
    // French boundary, well past the snap. Reported, never folded in.
    pdcUnassigned,
    // Charge points the simplified coastline put in the sea, moved to the
    // département they are within 2 km of. Counted, because that is something
    // the map did rather than something the file said.
    pdcSnapped,
    pdcTotal: Number.isFinite(expected) ? expected : null,
    // Sites actually counted into a département — NOT `located.size`, which
    // also counts the overseas and foreign coordinates the sweep resolved to
    // nothing. The two differ by ~280, and reporting the larger one would
    // claim the map draws sites it does not.
    siteCount: mesh.length,
    truncated: Number.isFinite(expected) && expected > 0 && pdcSwept < expected,
  };
}
