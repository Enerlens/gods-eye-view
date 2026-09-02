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
  const e2 = LAEA.e2;
  const phi = beta
    + (e2 / 3 + 31 * e2 ** 2 / 180 + 517 * e2 ** 3 / 5040) * Math.sin(2 * beta)
    + (23 * e2 ** 2 / 360 + 251 * e2 ** 3 / 3780) * Math.sin(4 * beta)
    + (761 * e2 ** 3 / 45360) * Math.sin(6 * beta);
  return [lambda * 180 / Math.PI, phi * 180 / Math.PI];
}

/** `CRS3035RES200mN2529400E3919200` → its parts. */
const ID_GRAMMAR = /^CRS3035RES(\d+)mN(\d+)E(\d+)$/;

/**
 * Read a cell identifier.
 * @param {unknown} id
 * @returns {{res: number, n: number, e: number}|null} Null when unparseable.
 */
export function parseCellId(id) {
  const match = ID_GRAMMAR.exec(String(id ?? '').trim());
  if (!match) return null;
  const res = Number(match[1]);
  const n = Number(match[2]);
  const e = Number(match[3]);
  if (!Number.isFinite(res) || !Number.isFinite(n) || !Number.isFinite(e)) return null;
  return { res, n, e };
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
export function cellCorners({ res, n, e }) {
  return [
    laeaToWgs84(e, n),
    laeaToWgs84(e, n + res),
    laeaToWgs84(e + res, n + res),
    laeaToWgs84(e + res, n),
  ];
}

/**
 * The cell's centre, which is where a label or a marker belongs.
 * @param {{res: number, n: number, e: number}} cell
 * @returns {[number, number]} `[lon, lat]`.
 */
export function cellCentre({ res, n, e }) {
  return laeaToWgs84(e + res / 2, n + res / 2);
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
 * Project a WFS answer into the wire shape the layer draws.
 *
 * Commune names are dictionary-encoded rather than repeated: over a Lyon
 * viewport the same nine strings appear on 1 329 cells, which is 30 KB of
 * "Lyon 7e Arrondissement" for nine distinct values.
 *
 * @param {object|null|undefined} payload A WFS FeatureCollection.
 * @param {{resolution?: number}} [options]
 * @returns {{cells: Array<object>, communes: Object<string,string>,
 *   matched: number|null, returned: number, truncated: boolean}}
 */
export function projectCarreaux(payload, { resolution = 200 } = {}) {
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
      est: Number(props[FILOSOFI_IMPUTED_FIELD[resolution]]) === 1 ? 1 : 0,
      com: code,
    });
  }
  const matched = num(payload?.numberMatched);
  return {
    cells,
    communes,
    matched,
    returned: cells.length,
    // The service answers `numberMatched` for the WHOLE box and `numberReturned`
    // for what fitted under COUNT. Saying "truncated" from the cell count alone
    // would call a box that happens to hold exactly the ceiling complete.
    truncated: matched !== null && cells.length > 0 && matched > cells.length,
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
 * `weight` is the count the indicator is computed ON, and it drives the
 * EXTRUSION — see `cellHeightM`. Every entry states its unit in words because
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
 * How tall a cell stands.
 *
 * THE HEIGHT IS THE DENOMINATOR, NEVER THE INDICATOR — and this is the layer's
 * one real design decision. Extruding a mean is a category error: a stack of
 * "27 100 € per person" has no volume, and the eye reads volume as quantity.
 * Extruding the COUNT the indicator was computed on gives every block a
 * meaning that adds up — the volume of a city block of squares really is its
 * population — and leaves colour free to carry the indicator.
 *
 * The consequence is the honest one: a brilliantly coloured cell one pixel tall
 * is four households, and it should not be read as a neighbourhood.
 *
 * Metres per person, not a normalised scale: a fixed conversion means two
 * viewports are comparable, and a relative one would make Paris and Aurillac
 * the same height.
 *
 * @param {object} cell
 * @param {object} metric
 * @param {{resolution?: number}} [options]
 * @returns {number} Metres, always ≥ MIN_EXTRUSION_M when the cell is populated.
 */
/**
 * Metres of extrusion per person and per household.
 *
 * Set against the CELL, not by taste: 0.12 m per person puts the densest
 * carreau measured anywhere in the country — Paris 19e, 2 818 people — at
 * 338 m, about 1.7 times the 200 m square it stands on, and a typical urban
 * cell of 500 people at 60 m. Past roughly 2× the cell width a block hides its
 * neighbours behind it and the grid stops being readable from any oblique
 * angle, which is the only angle this layer is worth looking at from.
 *
 * The household figure is 2.3× the person one because a French household is
 * about 2.2 people: the two scales have to agree, or switching from a
 * per-person indicator to a per-household one would relayout the city and read
 * as a change in the country.
 */
export const FILOSOFI_METRES_PER_PERSON = 0.12;
export const FILOSOFI_METRES_PER_HOUSEHOLD = 0.28;
/** Floor, so a four-household square is visible AND still visibly tiny. */
export const FILOSOFI_MIN_EXTRUSION_M = 6;

export function cellHeightM(cell, metric, { resolution = 200 } = {}) {
  const count = metric.weight === 'men' ? cell?.men : cell?.ind;
  if (!Number.isFinite(count) || count <= 0) return 0;
  const perUnit = metric.weight === 'men'
    ? FILOSOFI_METRES_PER_HOUSEHOLD
    : FILOSOFI_METRES_PER_PERSON;
  // A 1 km cell holds 25 times the people of a 200 m cell at the same density.
  // Without this the coarse grid would tower over the fine one and read as a
  // change in the country rather than a change in the grid.
  const gridScale = resolution === 1000 ? 1 / 25 : 1;
  return Math.max(FILOSOFI_MIN_EXTRUSION_M, count * perUnit * gridScale);
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
  for (const cell of list) {
    if (Number.isFinite(cell.ind)) people += cell.ind;
    if (Number.isFinite(cell.men)) households += cell.men;
    if (cell.est === 1) imputed += 1;
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
