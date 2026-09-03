/**
 * INSEE Filosofi carroyage — the demand side of a location, as squares.
 *
 * WHY THIS SOURCE AND NOT A COMMUNE MAP. Every other French statistical layer
 * in this app answers at the commune or the département, and a commune is the
 * wrong unit for the only question this data is asked: *who lives within a
 * walk of this address*. Lyon 7e is one commune code and contains both the
 * Guillotière and Gerland; a commune average describes neither. INSEE's
 * carroyage cuts the country into 200 m squares that ignore administrative
 * boundaries entirely, which is the only geometry a catchment area can be
 * measured against.
 *
 * WHERE IT COMES FROM. The Géoplateforme relays the carroyage as a WFS feature
 * type — `INSEE.FILOSOFI.INDICATORS:carreaux_200m` and `:carreaux_1km` —
 * keyless, `application/json`, bbox-filterable. MEASURED on 2026-09-02:
 *
 *   - `RESULTTYPE=hits` over the whole extent: **2 314 836** carreaux at 200 m,
 *     **377 234** at 1 km. Metropolitan France, Martinique, La Réunion.
 *   - A 0.10° × 0.07° box over Lyon (roughly 8 × 8 km): 1 329 cells,
 *     1 632 930 bytes, 0.45 s. The same box with `PROPERTYNAME` restricted to
 *     the twelve fields below and no geometry: **311 274 bytes** — a fifth.
 *   - `BBOX=lon,lat,lon,lat,EPSG:4326` is read in GIS order; the URN spelling
 *     `urn:ogc:def:crs:EPSG::4326` is read LAT FIRST. Both answer 200 and they
 *     disagree about which square you asked for. This module always writes the
 *     plain suffix, and `buildCarreauxUrl` is the only place that spells it.
 *
 * THE IDENTIFIER IS THE POLYGON — which is why no geometry is transported.
 * Every cell is named `CRS3035RES200mN2529400E3919200`: the northing and
 * easting, in metres, of its south-west corner in EPSG:3035 (ETRS89 / LAEA
 * Europe). Inverting that projection reproduces the polygon the service would
 * have sent, and `filosofiFeed.test.mjs` asserts it against two captured
 * fixtures to the eighth decimal — 1e-8° is about a millimetre. So the wire
 * carries two integers instead of four coordinate pairs, and the client draws
 * a square that is exactly INSEE's square rather than a rounded copy of it.
 *
 * That claim was true over the mainland and FALSE over three of the four
 * overseas départements, where Snyder's truncated series drifted to 1,4e-8° —
 * still only 1,6 mm, but not what the sentence above says, and INSEE publishes
 * carroyage there too. `geodeticLatitude()` now refines the series and the
 * round trip is good to 8,3e-14° from Mayotte to Dunkerque.
 *
 * WHAT THE RELAY DROPS. INSEE's published file has an `ind_18_24` band; the
 * WFS `DescribeFeatureType` does not. The band is recoverable as the residual
 * of `ind` minus the nine published bands — checked on the Lyon 7e fixture:
 * 1 123.5 − 994.5 = 129 — and that is how `studentBand()` reports it, labelled
 * as a residual rather than as a published figure.
 *
 * WHAT `i_car_est` MEANS, AND WHY IT IS ON EVERY CARD. INSEE: "Vaut 1 si le
 * carreau est imputé par une valeur approchée, 0 sinon" — the cell's figures
 * were modelled, not observed, because publishing the observation would have
 * broken statistical confidentiality. In the 80 105-cell national sample this
 * module's ramps were measured on, **31 351 cells (39 %) are imputed**. A layer
 * that draws those identically to observed cells is drawing a model and calling
 * it a census, so the layer draws them as a smaller square inside their own
 * footprint — a visibly perforated grid — and the card says so in words.
 *
 * THE MILLÉSIME IS 2019, AND THE SERVICE DOES NOT SAY SO. Neither the WFS
 * capabilities, the `DescribeFeatureType`, nor the CSW record (`INSEE_DONNEES`,
 * dated 2024-12-24) names a year. The field set is the Filosofi carroyé layout
 * and INSEE's current 200 m edition is *Revenus, pauvreté et niveau de vie en
 * 2019* — so the vintage below is INFERRED from the product, not read off the
 * relay, and the card says which of the two it is.
 *
 * Dependency-free and side-effect-free. The `/api/filosofi` proxy imports it,
 * and so does the layer.
 *
 * @module data/filosofiFeed
 */

const SERVICE_URL = 'https://data.geopf.fr/wfs/ows';

/** The two grids the Géoplateforme relays, keyed by cell side in metres. */
export const FILOSOFI_TYPENAMES = Object.freeze({
  200: 'INSEE.FILOSOFI.INDICATORS:carreaux_200m',
  1000: 'INSEE.FILOSOFI.INDICATORS:carreaux_1km',
});

/**
 * Cell counts, from `RESULTTYPE=hits` over the whole extent on 2026-09-02.
 * Pinned so a collapse in the relay's coverage is visible as a test failure
 * rather than as a thinner map.
 */
export const FILOSOFI_PUBLISHED_CELLS = Object.freeze({ 200: 2_314_836, 1000: 377_234 });

/** The income year the figures describe. Inferred — see the module header. */
export const FILOSOFI_VINTAGE = 2019;

/**
 * Fields asked of the WFS, per grid — and THE TWO GRIDS DO NOT AGREE.
 *
 * Measured by diffing the two captured fixtures on 2026-09-02: 45 fields in
 * common, and five that are not. The 200 m grid carries `depcom` / `nom_com`
 * and flags imputation as `i_car_est`; the 1 km grid carries NEITHER commune
 * field and flags imputation as `i_est_1km`. Asking a grid for the other one's
 * column name is an HTTP 400, not an empty column, so the list has to be per
 * grid rather than a union — and the layer has to accept that a 1 km cell
 * cannot name its commune, because a square that wide belongs to several.
 *
 * `geom` is in neither list, on purpose: the geometry is rebuilt from
 * `id_inspire`. Everything else is drawn, put on a card, or decides how a cell
 * is drawn — nothing is fetched "in case".
 */
const SHARED_FIELDS = Object.freeze([
  'id_inspire',
  'ind',
  'men',
  'ind_snv_div_ind',
  'men_pauv_div_men',
  'part_log_soc_div_men',
  'men_surf_div_men',
  'part_ind_0_17_div_ind',
  'part_ind_65p_div_ind',
  'men_prop_div_men',
  'men_1ind_div_men',
  'part_men_coll_div_men',
]);

export const FILOSOFI_FIELDS = Object.freeze({
  200: Object.freeze([...SHARED_FIELDS, 'depcom', 'nom_com', 'i_car_est']),
  1000: Object.freeze([...SHARED_FIELDS, 'i_est_1km']),
});

/** The imputation flag each grid publishes under its own name. */
export const FILOSOFI_IMPUTED_FIELD = Object.freeze({ 200: 'i_car_est', 1000: 'i_est_1km' });

/**
 * Row ceiling per request — THE SERVICE'S OWN, not a choice.
 *
 * Measured 2026-09-02 against a 1.2° × 0.9° box over Île-de-France holding
 * 6 283 cells at 1 km: `COUNT=4000` returns 4 000, and `COUNT=5000`, `6000` and
 * `10000` all return exactly **5 000**. The Géoplateforme caps a page at five
 * thousand features whatever is asked for, so a larger number here would be a
 * ceiling the layer reports on `/status` and the service never honours — the
 * map would truncate 1 283 cells earlier than every comment claimed.
 *
 * `numberMatched` is still published on a capped answer (6 283 against 5 000
 * returned), which is what keeps the truncation flag honest rather than a
 * guess from the row count.
 */
export const FILOSOFI_MAX_CELLS = 5000;

// ---------------------------------------------------------------------------
// EPSG:3035 — ETRS89-extended / LAEA Europe, inverted
// ---------------------------------------------------------------------------
/**
 * Snyder's ellipsoidal Lambert Azimuthal Equal-Area inverse, GRS80.
 *
 * Written out rather than pulled from proj4 because it is forty lines, the app
 * carries no projection dependency, and a wrong inverse here would misplace
 * every square in the country by a plausible-looking amount — the kind of bug a
 * library dependency hides and a fixture catches.
 */
const LAEA = Object.freeze({
  a: 6378137.0,
  e2: 0.00669438002290, // GRS80 first eccentricity squared, f = 1/298.257222101
  lat0: 52 * Math.PI / 180,
  lon0: 10 * Math.PI / 180,
  x0: 4_321_000.0,
  y0: 3_210_000.0,
});

const _E = Math.sqrt(LAEA.e2);

/** Snyder's authalic `q` for a geodetic latitude. */
function authalicQ(phi) {
  const s = Math.sin(phi);
  return (1 - LAEA.e2) * (
    s / (1 - LAEA.e2 * s * s)
    - (1 / (2 * _E)) * Math.log((1 - _E * s) / (1 + _E * s))
  );
}

const _QP = authalicQ(Math.PI / 2);
const _RQ = LAEA.a * Math.sqrt(_QP / 2);
const _BETA0 = Math.asin(authalicQ(LAEA.lat0) / _QP);
const _M0 = Math.cos(LAEA.lat0) / Math.sqrt(1 - LAEA.e2 * Math.sin(LAEA.lat0) ** 2);
const _D = LAEA.a * _M0 / (_RQ * Math.cos(_BETA0));

/**
 * EPSG:3035 metres → WGS84 degrees.
 *
 * @param {number} easting Metres, EPSG:3035.
 * @param {number} northing Metres, EPSG:3035.
 * @returns {[number, number]} `[lon, lat]` in degrees.
 */
export function laeaToWgs84(easting, northing) {
  const x = easting - LAEA.x0;
  const y = northing - LAEA.y0;
  const rho = Math.hypot(x / _D, _D * y);
  if (rho === 0) return [LAEA.lon0 * 180 / Math.PI, LAEA.lat0 * 180 / Math.PI];
  const ce = 2 * Math.asin(rho / (2 * _RQ));
  const sinCe = Math.sin(ce);
  const cosCe = Math.cos(ce);
  const beta = Math.asin(cosCe * Math.sin(_BETA0) + (_D * y * sinCe * Math.cos(_BETA0)) / rho);
  const lambda = LAEA.lon0 + Math.atan2(
    x * sinCe,
    _D * rho * Math.cos(_BETA0) * cosCe - _D * _D * y * Math.sin(_BETA0) * sinCe,
  );
  return [lambda * 180 / Math.PI, geodeticLatitude(beta) * 180 / Math.PI];
}

/**
 * Authalic latitude β → geodetic latitude φ, to the last bit.
 *
 * Snyder's series in e² is the textbook inversion and it is what shipped, but
 * it is truncated at e⁶ and its error grows with the distance from the
 * projection's own latitude of origin (52° N). Measured round trips:
 *
 *   · mainland and Corsica — worst 5,9e-9°, 0,66 mm
 *   · Guadeloupe 1,3e-8° · Martinique 1,3e-8° · Mayotte 1,2e-8° ·
 *     La Réunion **1,4e-8°**, 1,58 mm
 *
 * Three of the four overseas départements therefore breached the 1e-8° this
 * module's header promises, and INSEE publishes carroyage for all of them. One
 * Newton step on the exact authalic relation `q(φ) = qₚ sin β` closes it: worst
 * residual 8,3e-14° — nine nanometres — everywhere from Mayotte to Dunkerque.
 *
 * It costs about 18 ns per call, which is 0,5 ms over a full 5 000-cell
 * viewport at five points a cell.
 *
 * @param {number} beta Authalic latitude, radians.
 * @returns {number} Geodetic latitude, radians.
 */
function geodeticLatitude(beta) {
  const e2 = LAEA.e2;
  // The series, as the first guess.
  let phi = beta
    + (e2 / 3 + 31 * e2 ** 2 / 180 + 517 * e2 ** 3 / 5040) * Math.sin(2 * beta)
    + (23 * e2 ** 2 / 360 + 251 * e2 ** 3 / 3780) * Math.sin(4 * beta)
    + (761 * e2 ** 3 / 45360) * Math.sin(6 * beta);
  const target = _QP * Math.sin(beta);
  const sinPhi = Math.sin(phi);
  const denominator = 1 - e2 * sinPhi * sinPhi;
  // dq/dφ = 2(1 − e²)cos φ / (1 − e² sin²φ)². Halving this factor — an easy
  // slip — makes the step overshoot by exactly two and the iteration oscillates
  // around the answer forever instead of converging to it.
  const slope = (2 * (1 - e2) * Math.cos(phi)) / (denominator * denominator);
  if (slope !== 0) phi += (target - authalicQ(phi)) / slope;
  return phi;
}

/**
 * The overseas grids, which are NOT in EPSG:3035 and never were.
 *
 * THIS IS THE BUG THIS TABLE EXISTS TO FIX. The layer has declared coverage for
 * Martinique and La Réunion since it shipped, and drew neither: the WFS names
 * their cells `CRS5490…` and `CRS2975…`, the identifier grammar accepted
 * `CRS3035` alone, and every one of their cells was dropped without a word.
 * Measured 2026-09-03 over Saint-Denis de La Réunion: `numberMatched: 2 502`,
 * cells drawn **0**.
 *
 * INSEE grids each territory in its own UTM zone rather than reprojecting them,
 * which is the right call — LAEA Europe is a projection for Europe and a
 * Réunion carreau expressed in it would not be square on the ground. So the app
 * carries the inverse of both, for the same reason it carries the LAEA one: a
 * projection dependency for three closed-form formulas is a dependency for
 * three closed-form formulas.
 *
 * RGR92 and RGAF09 are both GRS80-based, like ETRS89 — the same ellipsoid the
 * LAEA constants above use. The datum differences from WGS84 are centimetric
 * and this draws 200 m squares.
 */
export const FILOSOFI_UTM_CRS = Object.freeze({
  2975: Object.freeze({ zone: 40, south: true, label: 'RGR92 / UTM 40S — La Réunion' }),
  5490: Object.freeze({ zone: 20, south: false, label: 'RGAF09 / UTM 20N — Antilles' }),
});

/** Universal Transverse Mercator constants. Both zones share them. */
const UTM = Object.freeze({
  a: 6378137.0,
  e2: 0.00669438002290,
  k0: 0.9996,
  falseEasting: 500_000,
  falseNorthingSouth: 10_000_000,
});

/**
 * UTM metres → WGS84 degrees, Snyder's inverse series.
 *
 * The footpoint latitude is found from the meridional arc by the standard e₁
 * series, then the position by the sixth-order expansion in `D`. Truncation
 * error inside a UTM zone is well under a millimetre — the projection is only
 * defined to 3° either side of its central meridian, and both French zones use
 * about a degree of that.
 *
 * @param {number} easting Metres.
 * @param {number} northing Metres.
 * @param {{zone: number, south: boolean}} grid
 * @returns {[number, number]} `[lon, lat]` in degrees.
 */
export function utmToWgs84(easting, northing, { zone, south }) {
  const { a, e2, k0 } = UTM;
  const ep2 = e2 / (1 - e2);
  const x = easting - UTM.falseEasting;
  const y = south ? northing - UTM.falseNorthingSouth : northing;

  const m = y / k0;
  const mu = m / (a * (1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 = mu
    + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu)
    + ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
    + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu)
    + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);

  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const tanPhi1 = Math.tan(phi1);
  const c1 = ep2 * cosPhi1 * cosPhi1;
  const t1 = tanPhi1 * tanPhi1;
  const sin2 = sinPhi1 * sinPhi1;
  const n1 = a / Math.sqrt(1 - e2 * sin2);
  const r1 = (a * (1 - e2)) / ((1 - e2 * sin2) ** 1.5);
  const d = x / (n1 * k0);

  const lat = phi1 - ((n1 * tanPhi1) / r1) * (
    (d ** 2) / 2
    - ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * ep2) * d ** 4) / 24
    + ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * ep2 - 3 * c1 * c1) * d ** 6) / 720
  );
  const lon0 = ((6 * zone) - 183) * Math.PI / 180;
  const lon = lon0 + (
    d
    - ((1 + 2 * t1 + c1) * d ** 3) / 6
    + ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * ep2 + 24 * t1 * t1) * d ** 5) / 120
  ) / cosPhi1;

  return [(lon * 180) / Math.PI, (lat * 180) / Math.PI];
}

/**
 * One cell's projection, whichever grid it belongs to.
 *
 * @param {number} crs EPSG code from the cell identifier.
 * @param {number} easting @param {number} northing
 * @returns {[number, number]} `[lon, lat]` in degrees.
 */
export function gridToWgs84(crs, easting, northing) {
  const utm = FILOSOFI_UTM_CRS[crs];
  return utm ? utmToWgs84(easting, northing, utm) : laeaToWgs84(easting, northing);
}

/** Every grid the carroyage is published on. */
export const FILOSOFI_GRID_CRS = Object.freeze([3035, 2975, 5490]);

/** `CRS3035RES200mN2529400E3919200` → its parts, INCLUDING which grid it is on. */
const ID_GRAMMAR = /^CRS(\d+)RES(\d+)mN(\d+)E(\d+)$/;

/**
 * Read a cell identifier.
 * @param {unknown} id
 * @returns {{res: number, n: number, e: number}|null} Null when unparseable.
 */
export function parseCellId(id) {
  const match = ID_GRAMMAR.exec(String(id ?? '').trim());
  if (!match) return null;
  const crs = Number(match[1]);
  const res = Number(match[2]);
  const n = Number(match[3]);
  const e = Number(match[4]);
  if (![crs, res, n, e].every(Number.isFinite)) return null;
  // A grid this app cannot invert is refused HERE rather than drawn at
  // coordinates read in the wrong projection — a Réunion northing of 7 679 200
  // read as LAEA lands in the Arctic.
  if (!FILOSOFI_GRID_CRS.includes(crs)) return null;
  return { crs, res, n, e };
}

/**
 * The four corners of a cell, in the winding the service publishes.
 *
 * A LAEA square is NOT axis-aligned in WGS84 — over Paris its north edge is
 * about 0.0003° west of its south edge — so the polygon has to carry four real
 * corners. Drawing an axis-aligned rectangle from the centre would rotate every
 * square by a fraction of a degree and leave visible seams between neighbours.
 *
 * @param {{res: number, n: number, e: number}} cell
 * @returns {Array<[number, number]>} Four `[lon, lat]` corners, SW → NW → NE → SE.
 */
export function cellCorners({ res, n, e, crs = 3035 }) {
  return [
    gridToWgs84(crs, e, n),
    gridToWgs84(crs, e, n + res),
    gridToWgs84(crs, e + res, n + res),
    gridToWgs84(crs, e + res, n),
  ];
}

/**
 * The cell's centre, which is where a label or a marker belongs.
 * @param {{res: number, n: number, e: number}} cell
 * @returns {[number, number]} `[lon, lat]`.
 */
export function cellCentre({ res, n, e, crs = 3035 }) {
  return gridToWgs84(crs, e + res / 2, n + res / 2);
}

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------
/**
 * Pick the grid a view should be drawn at.
 *
 * The 200 m grid is 2.3 million squares; a view wide enough to want them all
 * wants none of them, because a 200 m square is a third of a pixel. The switch
 * is at 0.12° of latitude — about 13 km, or a large city — measured against the
 * row ceiling: a 0.12° box over Paris returns roughly 4 000 cells, which is
 * inside `FILOSOFI_MAX_CELLS` with room for a denser one.
 *
 * @param {{south: number, north: number, west: number, east: number}} box
 * @returns {200|1000}
 */
export function resolutionForBox(box) {
  if (!box) return 1000;
  const span = Math.max(
    Math.abs(box.north - box.south),
    Math.abs(box.east - box.west) * 0.66,
  );
  return span <= 0.12 ? 200 : 1000;
}

/**
 * Build the WFS URL for one box.
 *
 * @param {{box: object, resolution?: number, count?: number}} query
 * @returns {string}
 */
export function buildCarreauxUrl({ box, resolution = 200, count = FILOSOFI_MAX_CELLS }) {
  const typename = FILOSOFI_TYPENAMES[resolution];
  if (!typename) throw new Error(`filosofi: unsupported resolution ${resolution}`);
  for (const key of ['south', 'west', 'north', 'east']) {
    if (!Number.isFinite(box?.[key])) throw new Error(`filosofi: box.${key} must be finite`);
  }
  const params = new URLSearchParams({
    SERVICE: 'WFS',
    VERSION: '2.0.0',
    REQUEST: 'GetFeature',
    TYPENAMES: typename,
    OUTPUTFORMAT: 'application/json',
    PROPERTYNAME: FILOSOFI_FIELDS[resolution].join(','),
    COUNT: String(Math.max(1, Math.round(count))),
    // GIS order — see the module header. Never the URN spelling.
    BBOX: [
      box.west.toFixed(5), box.south.toFixed(5),
      box.east.toFixed(5), box.north.toFixed(5),
      'EPSG:4326',
    ].join(','),
  });
  return `${SERVICE_URL}?${params}`;
}

// ---------------------------------------------------------------------------
// The projection
// ---------------------------------------------------------------------------
/** Coerce a WFS decimal, treating an absent or unparseable value as null. */
function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Round a share to one decimal; the source publishes no more than that. */
function share(value) {
  const parsed = num(value);
  return parsed === null ? null : Math.round(parsed * 10) / 10;
}

/**
 * Read INSEE's imputation flag without inventing an answer.
 *
 * `i_car_est` / `i_est_1km` is 1 when the cell's figures were MODELLED because
 * publishing the real ones would breach statistical secrecy, and 0 when they
 * were observed. A column that is absent, null, empty or unparseable answers
 * NEITHER, and the difference matters: "observed" is a claim the layer prints
 * on every card, and two cells in five are imputed nationally, so defaulting to
 * 0 would silently promote modelled figures to measured ones.
 *
 * @param {unknown} raw
 * @returns {0|1|null}
 */
function imputationFlag(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const parsed = Number(raw);
  if (parsed === 1) return 1;
  if (parsed === 0) return 0;
  return null;
}

/**
 * Project a WFS answer into the wire shape the layer draws.
 *
 * Commune names are dictionary-encoded rather than repeated: over a Lyon
 * viewport the same nine strings appear on 1 329 cells, which is 30 KB of
 * "Lyon 7e Arrondissement" for nine distinct values.
 *
 * @param {object|null|undefined} payload A WFS FeatureCollection.
 * @param {{resolution?: number}} [options]
 * @param {{resolution?: number, count?: number}} [options] `count` is the row
 *   ceiling the request was made with; a page that reaches it is a page the
 *   service cut short.
 * @returns {{cells: Array<object>, communes: Object<string,string>,
 *   matched: number|null, returned: number, requested: number|null,
 *   capped: boolean, truncated: boolean, estUnknown: number}}
 */
export function projectCarreaux(payload, { resolution = 200, count = FILOSOFI_MAX_CELLS } = {}) {
  const features = Array.isArray(payload?.features) ? payload.features : [];
  const communes = {};
  const cells = [];
  for (const feature of features) {
    const props = feature?.properties || {};
    const parsed = parseCellId(props.id_inspire);
    if (!parsed) continue;
    // A cell whose grid does not match the one that was asked for is a relay
    // mistake, not a cell to draw at the wrong size.
    if (parsed.res !== resolution) continue;
    const code = props.depcom ? String(props.depcom) : null;
    if (code && props.nom_com && !communes[code]) communes[code] = String(props.nom_com);
    cells.push({
      n: parsed.n,
      e: parsed.e,
      // The grid this cell is on. Métropole is EPSG:3035; INSEE publishes
      // Martinique and La Réunion in their own UTM zones, and a cell drawn
      // without knowing which would be drawn in the wrong ocean.
      crs: parsed.crs,
      // `ind` and `men` arrive with a half — INSEE's imputation splits people
      // between cells — and the halves are kept. Rounding them here would make
      // the layer's own totals disagree with the source's.
      ind: num(props.ind),
      men: num(props.men),
      niveau: num(props.ind_snv_div_ind) === null
        ? null : Math.round(num(props.ind_snv_div_ind)),
      pauvrete: share(props.men_pauv_div_men),
      social: share(props.part_log_soc_div_men),
      surface: share(props.men_surf_div_men),
      jeunes: share(props.part_ind_0_17_div_ind),
      aines: share(props.part_ind_65p_div_ind),
      proprietaires: share(props.men_prop_div_men),
      solo: share(props.men_1ind_div_men),
      collectif: share(props.part_men_coll_div_men),
      // 1 imputed, 0 observed, NULL when the service did not say. The old
      // `=== 1 ? 1 : 0` turned every absent, renamed or null flag into the
      // assertion "observed", which is the one claim this field exists to
      // make and the one a missing column cannot support.
      est: imputationFlag(props[FILOSOFI_IMPUTED_FIELD[resolution]]),
      com: code,
    });
  }
  const matched = num(payload?.numberMatched);
  // The page came back FULL. On its own that is not proof of truncation — a box
  // can hold exactly the ceiling — but it is the only signal left when the
  // service declines to count, and the WFS is documented to answer `"unknown"`.
  const capped = Number.isFinite(count) && count > 0 && features.length >= count;
  return {
    cells,
    communes,
    matched,
    returned: cells.length,
    requested: Number.isFinite(count) ? count : null,
    capped,
    // The service answers `numberMatched` for the WHOLE box and `numberReturned`
    // for what fitted under COUNT. Saying "truncated" from the cell count alone
    // would call a box that happens to hold exactly the ceiling complete — but
    // the OPPOSITE mistake is worse and was the one shipped: with
    // `numberMatched` absent or `"unknown"`, a page capped at exactly 5 000 rows
    // reported `truncated: false` and a partial catchment was sold as a whole
    // one. A full page with no count is now assumed truncated.
    truncated: matched !== null
      ? cells.length > 0 && matched > cells.length
      : capped,
    // How many cells refused to say whether they were imputed. Zero is the
    // normal answer and the only one that lets a card claim "aucun carreau
    // imputé"; anything else means the question was not answered.
    estUnknown: cells.reduce((total, cell) => total + (cell.est === null ? 1 : 0), 0),
  };
}

// ---------------------------------------------------------------------------
// The indicators
// ---------------------------------------------------------------------------
/**
 * Population-weighted national quantiles, measured by
 * `scripts/build-filosofi-ramp.mjs` on 2026-09-02 over **80 105 carreaux** in
 * 42 boxes — 12 285 745 people, 31 351 of the cells imputed.
 *
 * WEIGHTED, and that is the whole point. A carreau is not an observation: a
 * 6-person square in the Cantal and a 2 818-person square in Paris 19e each
 * answer for a very different number of people, and unweighted quantiles let
 * the empty half of the country set the scale for the full half.
 *
 * NOT INSEE'S PUBLISHED DECILES, either, and that is the second point. INSEE
 * publishes deciles of niveau de vie PER PERSON; a carreau carries a MEAN over
 * its inhabitants, and averaging a hundred people flattens both tails. Colouring
 * cell means against individual deciles would paint most of the country in the
 * middle bands and call it a map.
 *
 * Values are p10 / p25 / p50 / p75 / p90.
 */
export const FILOSOFI_RAMPS = Object.freeze({
  niveau: Object.freeze([15_300, 18_700, 22_700, 27_100, 32_400]),
  pauvrete: Object.freeze([5.3, 9.3, 14.2, 21.4, 31.6]),
  social: Object.freeze([0, 0, 6.9, 35.7, 76.4]),
  surface: Object.freeze([51, 58, 68, 79, 97]),
  jeunes: Object.freeze([13.3, 16.4, 20.3, 25.1, 30.5]),
  aines: Object.freeze([7.9, 11.6, 16.1, 21.5, 28.1]),
  proprietaires: Object.freeze([10.2, 25.9, 40.8, 58.8, 79.5]),
  solo: Object.freeze([23.1, 33.3, 43.6, 52.2, 58.6]),
  population: Object.freeze([89, 193, 426, 895, 1522]),
  menages: Object.freeze([42, 98, 215, 433, 744]),
});

/** The sample the ramps were read off, reported on the layer's card. */
export const FILOSOFI_RAMP_SAMPLE = Object.freeze({
  measuredAt: '2026-09-02',
  boxes: 42,
  cells: 80_105,
  people: 12_285_745,
  imputedCells: 31_351,
  // The same 42 boxes read at 1 km, which is where the SIZE classes for the
  // coarse grid come from. Fewer cells for more people: a coarse carreau is the
  // aggregate of up to 25 fine ones, and the empty ones do not exist in either.
  coarse: Object.freeze({ cells: 6_727, people: 12_941_533, imputedCells: 1_665 }),
});

/**
 * A six-step ramp, cold to warm.
 *
 * Six steps and not a continuous gradient, because the eye cannot read a
 * continuous hue back into a number and the card carries the number anyway.
 * The steps ARE the national quantile bands, so a colour means the same thing
 * in Roubaix and in Neuilly — which is the entire reason the breaks are
 * absolute rather than stretched over whatever is on screen.
 */
const RAMP_COLD = Object.freeze(['#2c5d8f', '#4f97c4', '#8fd0d8', '#f2e18c', '#f0a145', '#d1442f']);
/** The same six steps, reversed, for indicators where MORE is the darker fact. */
const RAMP_WARM = Object.freeze([...RAMP_COLD].reverse());

/**
 * What the layer can colour by.
 *
 * `weight` is the count the indicator is computed ON, and it drives the SIZE of
 * the symbol — see `cellSymbol`. Every entry states its unit in words because
 * "27 100" is meaningless without "€ per person per year", and a legend that
 * omits the unit is a legend that invites the wrong reading.
 */
export const FILOSOFI_METRICS = Object.freeze([
  Object.freeze({
    id: 'niveau',
    label: 'Niveau de vie',
    short: 'NIVEAU DE VIE',
    unit: '€/an par personne',
    field: 'niveau',
    weight: 'ind',
    ramp: RAMP_COLD,
    // Higher is warmer here: the ramp runs cold→warm and money runs low→high.
    reversed: false,
    blurb: 'Moyenne winsorisée du niveau de vie des habitants du carreau.',
  }),
  Object.freeze({
    id: 'pauvrete',
    label: 'Ménages pauvres',
    short: 'PAUVRETÉ',
    unit: '% des ménages',
    field: 'pauvrete',
    weight: 'men',
    ramp: RAMP_COLD,
    reversed: false,
    blurb: 'Part des ménages sous le seuil de pauvreté (60 % du niveau de vie médian).',
  }),
  Object.freeze({
    id: 'population',
    label: 'Population',
    short: 'POPULATION',
    unit: 'habitants',
    field: 'ind',
    weight: 'ind',
    ramp: RAMP_COLD,
    reversed: false,
    blurb: 'Individus recensés dans le carreau — la seule grandeur qui s’additionne.',
  }),
  Object.freeze({
    id: 'social',
    label: 'Logement social',
    short: 'LOG. SOCIAL',
    unit: '% des ménages',
    field: 'social',
    weight: 'men',
    ramp: RAMP_COLD,
    reversed: false,
    blurb: 'Part des ménages en logement social.',
  }),
  Object.freeze({
    id: 'jeunes',
    label: 'Moins de 18 ans',
    short: '– 18 ANS',
    unit: '% des habitants',
    field: 'jeunes',
    weight: 'ind',
    ramp: RAMP_COLD,
    reversed: false,
    blurb: 'Part des habitants de moins de 18 ans.',
  }),
  Object.freeze({
    id: 'aines',
    label: '65 ans et plus',
    short: '65 ANS +',
    unit: '% des habitants',
    field: 'aines',
    weight: 'ind',
    ramp: RAMP_COLD,
    reversed: false,
    blurb: 'Part des habitants de 65 ans et plus.',
  }),
  Object.freeze({
    id: 'proprietaires',
    label: 'Propriétaires',
    short: 'PROPRIÉTAIRES',
    unit: '% des ménages',
    field: 'proprietaires',
    weight: 'men',
    ramp: RAMP_COLD,
    reversed: false,
    blurb: 'Part des ménages propriétaires de leur logement.',
  }),
  Object.freeze({
    id: 'solo',
    label: 'Personnes seules',
    short: 'PERS. SEULES',
    unit: '% des ménages',
    field: 'solo',
    weight: 'men',
    ramp: RAMP_COLD,
    reversed: false,
    blurb: 'Part des ménages d’une seule personne.',
  }),
]);

/** @type {Object<string, object>} */
const METRIC_BY_ID = Object.freeze(Object.fromEntries(
  FILOSOFI_METRICS.map((metric) => [metric.id, metric]),
));

/** The metric a chip id names, or the default. */
export function resolveMetric(id) {
  return METRIC_BY_ID[String(id ?? '').trim()] || METRIC_BY_ID.niveau;
}

/** The ramp key a metric reads its breaks from. */
function rampKeyFor(metric) {
  return metric.id === 'population' ? 'population' : metric.id;
}

/**
 * Which of the six bands a value falls in.
 * @param {number|null} value
 * @param {object} metric
 * @returns {number} 0..5, or -1 when there is no value to band.
 */
export function metricBand(value, metric) {
  if (!Number.isFinite(value)) return -1;
  const breaks = FILOSOFI_RAMPS[rampKeyFor(metric)];
  if (!breaks) return -1;
  let band = 0;
  for (const edge of breaks) {
    if (value < edge) break;
    band += 1;
  }
  return Math.min(band, metric.ramp.length - 1);
}

/**
 * The CSS colour for one cell under one metric.
 * @param {object} cell
 * @param {object} metric
 * @returns {string|null} Null when the cell has no value for this metric.
 */
export function cellColor(cell, metric) {
  const value = cell?.[metric.field];
  const band = metricBand(value, metric);
  if (band < 0) return null;
  const ramp = metric.reversed ? RAMP_WARM : metric.ramp;
  return ramp[band];
}

/**
 * The six size classes, as the national quantiles of the count itself.
 *
 * SIX STEPS AND NOT A CONTINUOUS SCALE — the same decision the colour ramp
 * makes, for the same reason and one more. The shared reason: the eye cannot
 * read a continuous magnitude back into a number, and the card carries the
 * number anyway. The extra one is arithmetic. A screen showing the 1 km grid
 * gives each cell about 35 pixels; a symbol has to be at least 8 across to be
 * seen and at most ~28 to stay inside its cell, so the drawable range is 3:1 in
 * diameter. The DATA spans 100:1 in count — median 109 people per coarse
 * carreau against 11 690 in the densest square over Bordeaux. A strictly
 * proportional scale has to spend that mismatch somewhere, and it did:
 * **65 % of that viewport's 1 907 cells landed on the floor**, the channel went
 * flat, and a région holding a million people read as empty. Six classes spend
 * it deliberately instead, and every class is visible.
 *
 * ONE SET OF BREAKS PER GRID, measured, not derived. Scaling the 200 m breaks
 * by 25 — a 1 km cell holds 25 times the people at the same density — is the
 * arithmetic answer and it is 33 % too high at the top: the coarse grid's own
 * national p90 is **28 652 people**, not 25 × 1 522 = 38 050, because the 200 m
 * cells inside a dense square are not all dense. `build-filosofi-ramp.mjs
 * --resolution 1000` measured it on 2026-09-02 over **6 727 coarse carreaux in
 * the same 42 boxes**, 12 941 533 people.
 *
 * The fine grid's breaks ARE the population ramp's, deliberately: the size
 * classes and the `population` indicator's colour bands are the same measured
 * quantiles, so a square drawn one class larger is also one band warmer when
 * that is what you are colouring by.
 */
export const FILOSOFI_SIZE_BREAKS = Object.freeze({
  200: Object.freeze({ ind: FILOSOFI_RAMPS.population, men: FILOSOFI_RAMPS.menages }),
  1000: Object.freeze({
    ind: Object.freeze([1_343, 3_147, 6_587, 13_666, 28_652]),
    men: Object.freeze([642, 1_563, 3_237, 6_850, 14_532]),
  }),
});

/**
 * The most of its own cell a symbol may ever take, as a fraction of the side.
 *
 * THIS IS THE WHOLE POINT OF THE LAYER'S REDRAW, so it is a hard ceiling and
 * not a suggestion. At 0.68 the densest carreau in France still leaves a 47 m
 * margin of untouched ground on the 200 m grid — the street the basemap draws,
 * the label it prints, the marker another layer stands there — and the
 * carroyage stops being an opaque quilt laid over the map. A layer that hides
 * the map is not a layer, it is a replacement.
 *
 * Stated as a fraction of the SIDE even though the symbol is a disc: the
 * ceiling is about how much of the cell is spent, and `cellDisc` converts. A
 * disc at the ceiling covers 36 % of its cell, where a square at the same
 * fraction covered 46 % — the shape is the cheapest 10 points of basemap here.
 */
export const FILOSOFI_MAX_FILL = 0.68;
/**
 * The smallest class, and it is a floor with a job.
 *
 * Below about eight pixels a disc has no size a viewer can compare — two of
 * them differing by half their area read as two dots — so the bottom class has
 * to be at least that. 0.26 of the cell is a 59 m disc on the 200 m grid and a
 * 293 m disc on the 1 km one: eight to ten pixels at the altitude each grid
 * draws at, enough to see, enough to click, far too small to read as a
 * neighbourhood.
 */
export const FILOSOFI_MIN_FILL = 0.26;
/**
 * The hole an imputed cell's ring carries, as a fraction of its own diameter.
 *
 * Half, which removes a quarter of the area — and the ring is grown by
 * `1/√(1−0.5²)` to give it back, so a ring and a disc of the same count cover
 * the same amount of ground. The hollow is a statement about PROVENANCE;
 * letting it shrink the symbol would make it a statement about the count, which
 * would be a second, false, claim.
 */
export const FILOSOFI_HOLE_SCALE = 0.5;
const HOLLOW_COMPENSATION = 1 / Math.sqrt(1 - FILOSOFI_HOLE_SCALE ** 2);

/**
 * How big a cell's symbol is drawn, and whether it is a ring.
 *
 * THE SIZE IS THE DENOMINATOR, NEVER THE INDICATOR — the layer's one real
 * design decision, and it is the AREA that carries it. Sizing by a mean is a
 * category error: "27 100 € per person" has no extent, and the eye reads extent
 * as quantity. Sizing by the COUNT the indicator was computed on gives every
 * symbol a meaning that adds up, and leaves colour free to carry the indicator.
 *
 * Six measured classes rather than a proportion — see `FILOSOFI_SIZE_BREAKS`
 * for the arithmetic that forced it. A disc says "national class 4 of 6 for
 * population", which is a claim the eye can read back; a strictly proportional
 * one said "population" and, at the altitudes this grid is drawn at, was
 * unreadable at both ends at once.
 *
 * IT USED TO BE THE HEIGHT, and that was wrong twice over. A camera looking
 * down reads no height at all, so on the view this app opens with the channel
 * carried nothing; and paying for it with the full footprint of every cell
 * meant a populated département erased its own basemap — no streets, no place
 * names, no other layer. Both faults have the same fix: spend the count on area
 * inside the cell rather than on a tower above it.
 *
 * The consequence stays the honest one: a brilliantly coloured speck is four
 * households, and it should not be read as a neighbourhood.
 *
 * @param {object} cell
 * @param {object} metric
 * @param {{resolution?: number}} [options]
 * @returns {{fill: number, hole: number}} Fractions of the cell's side; `fill`
 *   is 0 for a cell with nobody in it, and `hole` is 0 unless the cell is
 *   imputed.
 */
export function cellSymbol(cell, metric, { resolution = 200 } = {}) {
  const count = metric.weight === 'men' ? cell?.men : cell?.ind;
  if (!Number.isFinite(count) || count <= 0) return { fill: 0, hole: 0 };
  const grid = FILOSOFI_SIZE_BREAKS[resolution] || FILOSOFI_SIZE_BREAKS[200];
  const breaks = metric.weight === 'men' ? grid.men : grid.ind;
  let band = 0;
  for (const edge of breaks) {
    if (count < edge) break;
    band += 1;
  }
  // Even steps in DIAMETER, not in area: the classes are ordinal — "one class
  // up" — and an eye compares widths far better than it compares areas. The
  // steps are +75 % of area at the bottom of the ramp and +30 % at the top,
  // both well past the threshold where two discs read as different sizes rather
  // than as noise; stepping the AREA evenly instead would make the first jump
  // nearly imperceptible, which is where most of the country's cells are.
  const step = (FILOSOFI_MAX_FILL - FILOSOFI_MIN_FILL) / breaks.length;
  const clamped = FILOSOFI_MIN_FILL + (band * step);
  if (cell?.est !== 1) return { fill: clamped, hole: 0 };
  const fill = clamped * HOLLOW_COMPENSATION;
  return { fill, hole: fill * FILOSOFI_HOLE_SCALE };
}

/**
 * Diameter of a disc that covers the same ground as a square of the same side.
 *
 * The symbol is a disc, and the scale is stated in squares — `cellSymbol`
 * returns a fraction of the CELL SIDE. Reading that fraction as a diameter
 * would quietly shrink every count by π/4, so the diameter is grown by 2/√π and
 * the disc covers exactly what the scale promises.
 */
export const FILOSOFI_DISC_DIAMETER = 2 / Math.sqrt(Math.PI);

/**
 * The outline of the disc drawn in a cell, as `[lon, lat]` points.
 *
 * Built in EPSG:3035 metres and projected point by point, for the same reason
 * the squares were: a circle of a given radius in LAEA is not a circle in
 * WGS84, and drawing one from a projected centre would flatten it by a percent
 * or so at the top of the country and not at the bottom.
 *
 * 32 segments: at the widest the layer draws — a 1 km disc filling most of its
 * cell on a 4 K screen — the chord error is under a third of a pixel, and the
 * count is the AREA, so a visibly polygonal disc would also be a disc of the
 * wrong size.
 *
 * @param {{res: number, n: number, e: number}} cell
 * @param {number} fraction Diameter as a share of the cell's side, before the
 *   square-to-disc correction.
 * @param {number} [segments]
 * @returns {Array<[number, number]>}
 */
export function cellDisc({ res, n, e, crs = 3035 }, fraction, segments = 32) {
  const centreN = n + res / 2;
  const centreE = e + res / 2;
  const radius = (res * fraction * FILOSOFI_DISC_DIAMETER) / 2;
  const points = [];
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2;
    points.push(gridToWgs84(
      crs,
      centreE + (radius * Math.cos(angle)),
      centreN + (radius * Math.sin(angle)),
    ));
  }
  return points;
}

/**
 * The slope a disc is expected to survive on one terrain sample.
 *
 * Sampling the whole footprint instead — five probes per cell — was measured at
 * **400 ms per redraw against 85 ms** for a Lyon viewport of 484 cells, because
 * `Globe.getHeight` walks the tile tree and costs about 0.16 ms a call. Paying
 * five times over for relief the clearance can absorb is not a trade worth
 * making on every metric switch.
 */
const SLOPE_TOLERANCE = 0.2;

/**
 * How far above its terrain sample a disc is laid.
 *
 * The discs are FLAT — there is no volume left to read, because the count is
 * the area, and extruding it a second time would make volume grow as count^1.5.
 * What is left is a clearance, and it is not decoration: the ground is sampled
 * at the cell's CENTRE, and a disc pinned to that height on a hillside has its
 * uphill half swallowed by the terrain it is describing — Fourvière is 130 m
 * above the Saône inside a few hundred metres.
 *
 * So the clearance scales with the symbol's own radius: a fifth of it, which
 * keeps any disc whole on a slope up to 20 % and lifts a big disc higher than a
 * small one because it spans more ground. The floor is what stops the smallest
 * symbols from z-fighting the imagery they are lying on.
 *
 * @param {number} resolution
 * @param {number} [fill] Diameter as a share of the cell's side.
 * @returns {number} Metres above the sampled ground.
 */
export function cellClearanceM(resolution = 200, fill = FILOSOFI_MAX_FILL) {
  const radius = (resolution * fill * FILOSOFI_DISC_DIAMETER) / 2;
  return Math.max(resolution === 1000 ? 20 : 6, radius * SLOPE_TOLERANCE);
}

// ---------------------------------------------------------------------------
// The summary
// ---------------------------------------------------------------------------
/**
 * Population-weighted mean of a field over cells.
 *
 * Weighted, for the same reason the ramps are: the unweighted mean of a
 * viewport's cells is the mean of its SQUARES, and nobody lives in a square.
 *
 * @param {Array<object>} cells
 * @param {string} field
 * @param {string} weightField
 * @returns {number|null}
 */
export function weightedMean(cells, field, weightField) {
  let total = 0;
  let weight = 0;
  for (const cell of cells) {
    const value = cell?.[field];
    const w = cell?.[weightField];
    if (!Number.isFinite(value) || !Number.isFinite(w) || w <= 0) continue;
    total += value * w;
    weight += w;
  }
  return weight > 0 ? total / weight : null;
}

/**
 * What the drawn squares add up to.
 * @param {Array<object>} cells
 * @returns {object}
 */
export function summarizeCells(cells) {
  const list = Array.isArray(cells) ? cells : [];
  let people = 0;
  let households = 0;
  let imputed = 0;
  let imputedUnknown = 0;
  for (const cell of list) {
    if (Number.isFinite(cell.ind)) people += cell.ind;
    if (Number.isFinite(cell.men)) households += cell.men;
    if (cell.est === 1) imputed += 1;
    else if (cell.est !== 0) imputedUnknown += 1;
  }
  const niveau = weightedMean(list, 'niveau', 'ind');
  const pauvrete = weightedMean(list, 'pauvrete', 'men');
  return {
    cells: list.length,
    people: Math.round(people),
    households: Math.round(households),
    // The count and the share, because "1 042 imputed" and "39 % imputed" are
    // read by different people and neither derives the other at a glance.
    imputedCells: imputed,
    // Cells whose flag the service did not answer, kept apart from the imputed
    // count: a share of 0 % means "none imputed" only when this is 0 too.
    imputedUnknown,
    imputedShare: list.length ? Math.round((imputed / list.length) * 1000) / 10 : null,
    niveau: niveau === null ? null : Math.round(niveau),
    pauvrete: pauvrete === null ? null : Math.round(pauvrete * 10) / 10,
  };
}

/**
 * The 18-24 band, recovered as a residual.
 *
 * The relay drops `ind_18_24` even though INSEE publishes it, so it is only
 * available as `ind` minus the nine bands that survive — and only when the
 * caller has those bands, which the layer's own request deliberately does not.
 * Exported for the proxy's benefit and for anyone who widens `FILOSOFI_FIELDS`.
 *
 * @param {object} props Raw WFS properties.
 * @returns {number|null} People aged 18–24, or null when the bands are absent.
 */
export function studentBand(props) {
  const total = num(props?.ind);
  if (total === null) return null;
  const bands = ['ind_0_3', 'ind_4_5', 'ind_6_10', 'ind_11_17', 'ind_25_39',
    'ind_40_54', 'ind_55_64', 'ind_65_79', 'ind_80p'];
  let sum = 0;
  for (const band of bands) {
    const value = num(props?.[band]);
    if (value === null) return null;
    sum += value;
  }
  const residual = total - sum;
  return residual >= 0 ? Math.round(residual * 10) / 10 : null;
}
