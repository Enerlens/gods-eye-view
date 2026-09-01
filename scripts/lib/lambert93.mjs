/**
 * Lambert-93 (EPSG:2154) ⇄ WGS84, derived rather than copied.
 *
 * WHY THIS EXISTS. Bison Futé publishes the geometry of France's road
 * counting stations in projected metres — `refDir.csv` carries `x_deb/y_deb`
 * and `x_fin/y_fin` around 700 000 / 6 600 000, which is Lambert-93, the legal
 * French projection. Nothing on a globe can use those numbers. Every other
 * French source this app reads (the PAN, IGN's geocoder, ODRÉ, Hub'Eau) ships
 * WGS84 already, so this is the one place a reprojection is needed, and it is
 * needed at BUILD time only: `config/datex_traficolor_sites.json` is committed
 * in degrees and neither the proxy nor the browser ever sees a metre.
 *
 * WHY NOT proj4. A dependency for one conic projection whose parameters are
 * published by IGN and whose inverse is fourteen lines is a dependency to
 * audit, ship and update forever. It is also unverifiable in the way that
 * matters here: `proj4('EPSG:2154')` would give an answer with no statement of
 * whether the constants behind it are the legal ones.
 *
 * SO THE CONSTANTS ARE COMPUTED, NOT PASTED. `n`, `C` and `Ys` below are
 * derived from the seven defining parameters of the projection (GRS80's
 * flattening, the two standard parallels, the origin, the false easting and
 * northing) and the accompanying test asserts that the derivation reproduces
 * the values IGN publishes in NTG_71 to the millimetre. A typo in a pasted
 * constant is a silent kilometre; a typo in a derivation fails that test.
 *
 * Reference: IGN, "Projection cartographique conique conforme de Lambert",
 * NTG_71 (algorithme ALG0003/ALG0004), and decree 2000-1276 which makes
 * RGF93 / Lambert-93 the legal projection for mainland France.
 *
 * The RGF93 and WGS84 datums differ by centimetres in France — under the
 * ~metre at which a counting station's own position is published — so no datum
 * shift is applied and none is implied.
 *
 * @module scripts/lib/lambert93
 */

/** GRS80 semi-major axis (m) — the RGF93 ellipsoid. */
const A = 6378137.0;
/** GRS80 inverse flattening. */
const INVERSE_FLATTENING = 298.257222101;
/** First eccentricity, from the flattening rather than quoted. */
const E = Math.sqrt(2 / INVERSE_FLATTENING - 1 / (INVERSE_FLATTENING * INVERSE_FLATTENING));

const DEG = Math.PI / 180;
/** Longitude of origin: 3° E of Greenwich (not Paris — Lambert-93 is Greenwich-based). */
const LON0 = 3 * DEG;
/** Latitude of origin. */
const LAT0 = 46.5 * DEG;
/** The two standard parallels the cone is secant on. */
const LAT1 = 44 * DEG;
const LAT2 = 49 * DEG;
/** False easting / northing (m). */
const X0 = 700000.0;
const Y0 = 6600000.0;

/** Conformal-sphere scale term m(φ) of NTG_71. */
function conformalScale(lat) {
  const s = E * Math.sin(lat);
  return Math.cos(lat) / Math.sqrt(1 - s * s);
}

/** Isometric-latitude term t(φ) of NTG_71. */
function isometricTerm(lat) {
  const s = E * Math.sin(lat);
  return Math.tan(Math.PI / 4 - lat / 2) / (((1 - s) / (1 + s)) ** (E / 2));
}

/** Cone constant. IGN publishes 0.725 607 765. */
export const N = (Math.log(conformalScale(LAT1)) - Math.log(conformalScale(LAT2)))
  / (Math.log(isometricTerm(LAT1)) - Math.log(isometricTerm(LAT2)));

/** Projection constant C = a·F (m). IGN publishes 11 754 255.426. */
export const C = A * (conformalScale(LAT1) / (N * isometricTerm(LAT1) ** N));

/** Northing of the cone apex (m). IGN publishes 12 655 612.050. */
export const YS = Y0 + C * isometricTerm(LAT0) ** N;

/** Easting of the cone apex (m) — the false easting, the cone being centred on it. */
export const XS = X0;

/**
 * Project geographic degrees to Lambert-93 metres.
 *
 * Present so the inverse can be round-trip tested against it; the build script
 * only ever calls {@link lambert93ToWgs84}.
 *
 * @param {number} lon Longitude in degrees (east positive).
 * @param {number} lat Latitude in degrees (north positive).
 * @returns {{x: number, y: number}} Easting/northing in metres.
 */
export function wgs84ToLambert93(lon, lat) {
  const phi = lat * DEG;
  const rho = C * isometricTerm(phi) ** N;
  const gamma = N * (lon * DEG - LON0);
  return {
    x: XS + rho * Math.sin(gamma),
    y: YS - rho * Math.cos(gamma),
  };
}

/**
 * Unproject Lambert-93 metres to geographic degrees.
 *
 * The latitude comes out of an isometric latitude, which has no closed form,
 * so it is iterated. NTG_71 stops at 1e-11 radians (~0.06 mm); the fixed
 * twelve passes below reach that everywhere in France in well under half of
 * them, and a fixed count keeps the function branch-free and total.
 *
 * @param {number} x Easting in metres.
 * @param {number} y Northing in metres.
 * @returns {{lon: number, lat: number}} Degrees, east/north positive.
 */
export function lambert93ToWgs84(x, y) {
  const dx = x - XS;
  const dy = y - YS;
  const rho = Math.hypot(dx, dy);
  // atan2(dx, -dy): the apex is NORTH of the whole projected zone, so the
  // radius vector points down-screen and the sign of dy is inverted here.
  const gamma = Math.atan2(dx, -dy);
  const lon = LON0 + gamma / N;
  // Isometric latitude L such that rho = C·exp(-nL).
  const L = -Math.log(rho / C) / N;
  let phi = 2 * Math.atan(Math.exp(L)) - Math.PI / 2;
  for (let i = 0; i < 12; i += 1) {
    const s = E * Math.sin(phi);
    phi = 2 * Math.atan((((1 + s) / (1 - s)) ** (E / 2)) * Math.exp(L)) - Math.PI / 2;
  }
  return { lon: lon / DEG, lat: phi / DEG };
}

/**
 * Bounding box Lambert-93 is defined for, in degrees — mainland France plus
 * Corsica, with the margin EPSG quotes for the CRS's area of use.
 *
 * Used as a SANITY GATE, not a clip: a reprojected station that lands outside
 * it means the source row was not Lambert-93 (a swapped column, a zero, a
 * metre value pasted into a degree field), and the build drops it and says so
 * rather than drawing a road in the Atlantic.
 */
export const LAMBERT93_VALID_BBOX = Object.freeze({
  west: -9.9, south: 41.1, east: 10.3, north: 51.6,
});

/**
 * Whether a reprojected point falls inside the CRS's area of use.
 * @param {number} lon Degrees.
 * @param {number} lat Degrees.
 * @returns {boolean}
 */
export function isPlausibleFrenchPoint(lon, lat) {
  return Number.isFinite(lon) && Number.isFinite(lat)
    && lon >= LAMBERT93_VALID_BBOX.west && lon <= LAMBERT93_VALID_BBOX.east
    && lat >= LAMBERT93_VALID_BBOX.south && lat <= LAMBERT93_VALID_BBOX.north;
}
