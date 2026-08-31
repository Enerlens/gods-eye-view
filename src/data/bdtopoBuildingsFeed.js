// src/data/bdtopoBuildingsFeed.js — the BD TOPO building schema, and the
// arithmetic that decides where a building's floor goes.
//
// Everything here is pure and node-testable. The Cesium drawing lives in
// `bdtopoBuildings.js`; this file is where the upstream traps are held down,
// under test against a real captured IGN vector tile.
//
// ── The four traps ──────────────────────────────────────────────────────────
//
// 1. **`precision_altimetrique: 9999` is not a precision.** It is the IGN
//    sentinel for "this building has no Z at all" — `methode_d_acquisition_
//    altimetrique: "Pas de Z"`. Read literally it says ±10 km, which would let
//    any building pass any altimetric check ever written.
//
// 2. **Half of France publishes roof altitudes and half does not.** Lyon,
//    Marseille and Grenoble carry `altitude_maximale_toit` and
//    `altitude_maximale_sol` (photogrammetry / correlation). Paris carries
//    NEITHER — its buildings come from the cadastre with an interpolated Z, so
//    only `altitude_minimale_sol`, `altitude_minimale_toit` and `hauteur` are
//    there. Measured 2026-08-31 on z16 tiles: roof altitude present for 96% of
//    Lyon, 0% of Paris. A seating rule that assumes the roof altitude erases
//    Paris; one that assumes only `hauteur` throws away the better data
//    everywhere else. Hence the hierarchy in `seatBuilding`.
//
// 3. **The altitudes are NGF-IGN69, the globe is WGS84.** Orthometric, not
//    ellipsoidal: h = H + N, N ≈ +44 m over Paris and +51 m over Grenoble.
//    Forget it and the whole city sinks 45 m into the terrain.
//
// 4. **One building can be several features.** A building straddling two tiles
//    appears cut in both, each piece carrying the same `cleabs`. Both pieces
//    must be DRAWN (they re-join) and the building COUNTED once.

/** IGN Géoplateforme vector tiles: keyless, CORS-open, 21-day browser cache. */
export const BDTOPO_TILE_BASE = 'https://data.geopf.fr/tms/1.0.0/BDTOPO';
/** The vector-tile layer that carries the buildings. */
export const BDTOPO_LAYER_NAME = 'batiment';

/**
 * Tile zoom.
 *
 * z15, not z16, and the difference was measured rather than assumed. Over the
 * same 1.3 x 1.2 km window at Fourvière on 2026-08-31: z16 needed 12 tiles for
 * 1 336 distinct buildings, z15 needed 4 for 1 335 of the same ones, byte for
 * byte the same payload size and attribute for attribute identical on every
 * building sampled. IGN does not simplify the `batiment` layer between the two,
 * so z16 buys nothing and costs three times the requests. (z14 does not serve
 * the layer at all — the tile parses and `batiment` is absent.)
 */
export const BDTOPO_ZOOM = 15;

/**
 * Widest viewport that gets buildings, in degrees of the LONGER side.
 * Beyond roughly this, a building is smaller than a pixel and the layer is
 * paying for tiles nobody can see. 0.08° ≈ 6 km of longitude in France.
 */
export const BDTOPO_MAX_BOX_DEG = 0.08;

/**
 * Hard ceiling on tiles per load. A z15 tile is ~1.2 km across in France, so 64
 * covers roughly 9 km square — comfortably more than `BDTOPO_MAX_BOX_DEG` asks
 * for, which is the point: the box gate should be what stops a load, not a cap
 * that silently cuts a city in half.
 */
export const BDTOPO_MAX_TILES = 64;

/**
 * Ceiling on drawn volumes. Marseille's densest square kilometre alone is
 * ~20 000 footprints; past this the tessellation cost stops buying anything
 * legible, so the layer truncates and SAYS it truncated.
 */
export const BDTOPO_VOLUME_CAP = 14000;

/** `precision_altimetrique` when the BD TOPO has no Z for this building. */
export const NO_Z_SENTINEL = 9999;

/**
 * How far the base of a volume is pushed below its floor.
 *
 * BD TOPO declares 1.5–2.5 m of altimetric precision on its buildings, and the
 * surface underneath is a separate measurement with its own error. Without a
 * margin, a building whose declared floor lands 40 cm above the rendered ground
 * shows daylight under its walls. Only the buried part grows; the visible
 * height is untouched.
 */
export const BASE_SINK_M = 2.5;

/** Default height for a building with no published height at all. */
export const DEFAULT_HEIGHT_M = 6;

/**
 * Usage bands. These are the values IGN actually puts in `usage_1`; anything
 * else lands in `other`, which is why `other` is grey rather than a colour
 * that would imply a category.
 */
export const BDTOPO_USAGE_TIERS = Object.freeze([
  Object.freeze({
    id: 'residential', label: 'Résidentiel', color: '#e8b96a',
    usages: Object.freeze(['Résidentiel']),
    blurb: 'Logement. Le nombre de logements, quand il est renseigné, vient des fichiers fonciers.',
  }),
  Object.freeze({
    id: 'commercial', label: 'Commercial et services', color: '#6ad0e8',
    usages: Object.freeze(['Commercial et services']),
    blurb: 'Commerce, bureaux, équipements publics et de service.',
  }),
  Object.freeze({
    id: 'industrial', label: 'Industriel', color: '#e87d7d',
    usages: Object.freeze(['Industriel']),
    blurb: 'Bâti industriel déclaré comme tel par l\'IGN.',
  }),
  Object.freeze({
    id: 'agricultural', label: 'Agricole', color: '#9ee87d',
    usages: Object.freeze(['Agricole']),
    blurb: 'Bâti agricole — hangars, serres, exploitations.',
  }),
  Object.freeze({
    id: 'civic', label: 'Sportif, religieux, annexe', color: '#b9a7e8',
    usages: Object.freeze(['Sportif', 'Religieux', 'Annexe']),
    blurb: 'Les trois usages rares, regroupés parce qu\'aucun ne remplit une légende seul.',
  }),
  Object.freeze({
    id: 'other', label: 'Indifférencié', color: '#8d9aa6',
    usages: Object.freeze([]),
    blurb: 'Usage non renseigné ou hors nomenclature. Gris parce qu\'une couleur '
      + 'affirmerait une catégorie que la donnée ne donne pas.',
  }),
]);

const TIER_BY_USAGE = new Map();
for (const tier of BDTOPO_USAGE_TIERS) {
  for (const usage of tier.usages) TIER_BY_USAGE.set(usage, tier);
}
const OTHER_TIER = BDTOPO_USAGE_TIERS[BDTOPO_USAGE_TIERS.length - 1];

/**
 * @param {string|null|undefined} usage1 - BD TOPO `usage_1`.
 * @returns {object} One of {@link BDTOPO_USAGE_TIERS}; never null.
 */
export function bdtopoUsageTier(usage1) {
  return TIER_BY_USAGE.get(usage1) || OTHER_TIER;
}

/**
 * @param {?{west:number,south:number,east:number,north:number}} box
 * @param {number} [maxDeg]
 * @returns {boolean} true when the viewport is too wide to be worth loading.
 */
export function bdtopoBoxTooWide(box, maxDeg = BDTOPO_MAX_BOX_DEG) {
  if (!box) return true;
  const width = Math.abs(box.east - box.west);
  const height = Math.abs(box.north - box.south);
  return Math.max(width, height) > maxDeg;
}

/** Web-Mercator tile column for a longitude. @returns {number} */
export function lonToTileX(lon, zoom) {
  return Math.floor(((lon + 180) / 360) * 2 ** zoom);
}

/** Web-Mercator tile row for a latitude. @returns {number} */
export function latToTileY(lat, zoom) {
  const clamped = Math.min(Math.max(lat, -85.05112878), 85.05112878);
  const rad = (clamped * Math.PI) / 180;
  return Math.floor(((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * 2 ** zoom);
}

/**
 * The tiles covering a viewport.
 *
 * Returns `overflow` rather than silently trimming: a truncated tile list looks
 * exactly like a city that stops at a straight line, and the layer has to be
 * able to say which one the user is looking at.
 * @param {{west:number,south:number,east:number,north:number}} box
 * @param {number} [zoom]
 * @param {number} [cap]
 * @returns {{tiles: Array<{z:number,x:number,y:number}>, wanted: number, overflow: boolean}}
 */
export function bdtopoTiles(box, zoom = BDTOPO_ZOOM, cap = BDTOPO_MAX_TILES) {
  const x0 = lonToTileX(box.west, zoom);
  const x1 = lonToTileX(box.east, zoom);
  const y0 = latToTileY(box.north, zoom);
  const y1 = latToTileY(box.south, zoom);
  const wanted = (x1 - x0 + 1) * (y1 - y0 + 1);
  const tiles = [];
  for (let x = x0; x <= x1 && tiles.length < cap; x += 1) {
    for (let y = y0; y <= y1 && tiles.length < cap; y += 1) tiles.push({ z: zoom, x, y });
  }
  return { tiles, wanted, overflow: wanted > cap };
}

/** @param {{z:number,x:number,y:number}} tile @returns {string} */
export function bdtopoTileUrl({ z, x, y }) {
  return `${BDTOPO_TILE_BASE}/${z}/${x}/${y}.pbf`;
}

/**
 * @returns {?number} the value if it is a usable finite number, else null.
 *
 * The null/empty guard is not defensive noise: `Number(null)` and `Number('')`
 * are both `0`, and BD TOPO does emit empty strings (`identifiants_sources`).
 * Without it, an absent `hauteur` becomes a zero-height building instead of an
 * absent one, and the seating hierarchy silently skips a rung.
 */
export function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * The altimetric precision BD TOPO claims for a building, with the "no Z"
 * sentinel removed.
 * @param {object} props
 * @returns {?number} metres, or null when the building has no Z.
 */
export function declaredAltimetricPrecisionM(props) {
  const declared = finiteOrNull(props?.precision_altimetrique);
  if (declared === null) return null;
  return declared >= NO_Z_SENTINEL ? null : declared;
}

/**
 * Where a building's floor and roof go, in ELLIPSOIDAL metres, and on what
 * evidence.
 *
 * The order is a hierarchy of evidence, not a rendering preference:
 *
 *   `published`  both altitudes are in the data — the building states its own
 *                floor and its own roof, and neither is inferred.
 *   `height`     floor stated, roof deduced from the published `hauteur`.
 *                This is all of Paris.
 *   `surface`    nothing altimetric survived; the floor is the surface the
 *                globe is actually drawing and only the height is IGN's.
 *   `default`    not even a height. `DEFAULT_HEIGHT_M`, and counted apart so
 *                the legend can admit how many of these there are.
 *
 * `offsetM` re-anchors IGN's absolute altitudes onto the surface the globe
 * renders (see {@link datumOffsetsByCell}). It is zero until that offset is
 * known, which is correct rather than merely safe: with no offset the building
 * sits at its true NGF altitude, which is where it really is.
 *
 * @param {object} props - BD TOPO attributes.
 * @param {object} options
 * @param {number} options.geoidN - Geoid undulation N at the building, metres.
 * @param {?number} [options.surfaceM] - Rendered ellipsoidal ground, if warm.
 * @param {number} [options.offsetM] - Rendered-surface minus IGN datum, metres.
 * @returns {{baseM: number, topM: number, basis: 'published'|'height'|'surface'|'default'}}
 */
export function seatBuilding(props, { geoidN, surfaceM = null, offsetM = 0 }) {
  const minSol = finiteOrNull(props?.altitude_minimale_sol);
  const maxToit = finiteOrNull(props?.altitude_maximale_toit);
  const hauteur = finiteOrNull(props?.hauteur);
  const shift = (Number.isFinite(geoidN) ? geoidN : 0) + (Number.isFinite(offsetM) ? offsetM : 0);

  if (minSol !== null && maxToit !== null && maxToit > minSol) {
    const floor = minSol + shift;
    return { baseM: floor - BASE_SINK_M, topM: maxToit + shift, basis: 'published' };
  }
  if (minSol !== null && hauteur !== null && hauteur > 0) {
    const floor = minSol + shift;
    return { baseM: floor - BASE_SINK_M, topM: floor + hauteur, basis: 'height' };
  }
  if (Number.isFinite(surfaceM)) {
    const height = hauteur !== null && hauteur > 0 ? hauteur : DEFAULT_HEIGHT_M;
    return {
      baseM: surfaceM - BASE_SINK_M,
      topM: surfaceM + height,
      basis: hauteur !== null && hauteur > 0 ? 'surface' : 'default',
    };
  }
  // No altitude, no surface: the building cannot be placed. The caller drops it
  // rather than inventing a floor at zero, which would put it under the sea.
  return { baseM: NaN, topM: NaN, basis: 'default' };
}

/** Median of a numeric array. Sorts a COPY. @returns {?number} */
export function medianOf(values) {
  if (!values?.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Side of the datum-offset cell, in degrees. ~1.1 km.
 *
 * Deliberately much coarser than the shared 111 m floor grid, and the reason is
 * arithmetic rather than taste: a 0.08 degree viewport holds 6 400 of the fine
 * cells, and asking the terrain resolver for 6 400 heights to correct a metre
 * of datum error would be a denial-of-service written as a feature. At 1.1 km
 * the same viewport is 64 samples, and the error being corrected — a global
 * 30 m terrain disagreeing with a national survey — varies on the kilometre
 * scale anyway.
 */
export const OFFSET_CELL_DEG = 0.01;

/** @returns {string} Stable key for the datum-offset cell holding a point. */
export function offsetCellKey(lat, lon) {
  return `${Math.floor(lat / OFFSET_CELL_DEG)},${Math.floor(lon / OFFSET_CELL_DEG)}`;
}

/**
 * The centre of a point's offset cell — the ONE place the rendered surface is
 * sampled for that cell, so every building in it is corrected against the same
 * measurement rather than against its own noisy neighbour.
 * @returns {{lat: number, lon: number}}
 */
export function offsetCellCentre(lat, lon) {
  return {
    lat: (Math.floor(lat / OFFSET_CELL_DEG) + 0.5) * OFFSET_CELL_DEG,
    lon: (Math.floor(lon / OFFSET_CELL_DEG) + 0.5) * OFFSET_CELL_DEG,
  };
}

/**
 * Minimum buildings in a cell before its own datum offset is trusted.
 * Two buildings can both be wrong in the same direction; three is where a
 * median starts meaning something.
 */
export const OFFSET_MIN_SAMPLES = 3;

/**
 * The gap between where IGN says the ground is and where the globe draws it,
 * per ~111 m cell.
 *
 * This is the whole reason French buildings can sit on a 30 m global terrain
 * without floating or drowning. IGN's per-building altitudes are exact and
 * finely varied; the rendered surface underneath is coarse and, in hills, off
 * by several metres. Taking IGN's altitudes and shifting them by the LOCAL
 * difference keeps the fine relief between neighbours and still lands the block
 * on the ground the user can see.
 *
 * A cell with too few buildings falls back to the viewport median, and a
 * viewport with no warm cells at all falls back to zero — which puts the city
 * at its true altitude, the honest answer when the surface is unknown.
 *
 * @param {Array<{cellKey: string, ignM: number, renderedM: ?number}>} samples
 * @param {object} [options]
 * @param {number} [options.minSamples]
 * @returns {{byCell: Map<string, number>, medianM: number, cells: number, samples: number}}
 */
export function datumOffsetsByCell(samples, { minSamples = OFFSET_MIN_SAMPLES } = {}) {
  const perCell = new Map();
  let used = 0;
  for (const sample of samples || []) {
    if (!sample || !Number.isFinite(sample.ignM) || !Number.isFinite(sample.renderedM)) continue;
    const list = perCell.get(sample.cellKey);
    const delta = sample.renderedM - sample.ignM;
    if (list) list.push(delta); else perCell.set(sample.cellKey, [delta]);
    used += 1;
  }

  const byCell = new Map();
  const cellMedians = [];
  for (const [key, deltas] of perCell) {
    const value = medianOf(deltas);
    if (value === null) continue;
    cellMedians.push(value);
    if (deltas.length >= minSamples) byCell.set(key, value);
  }
  const medianM = medianOf(cellMedians) ?? 0;
  return { byCell, medianM, cells: byCell.size, samples: used };
}

/**
 * The offset to apply at a point: its own cell's if that cell is trusted, the
 * viewport median otherwise.
 * @param {{byCell: Map<string, number>, medianM: number}} offsets
 * @param {string} cellKey
 * @returns {number}
 */
export function offsetForCell(offsets, cellKey) {
  if (!offsets) return 0;
  const own = offsets.byCell?.get(cellKey);
  return Number.isFinite(own) ? own : (Number.isFinite(offsets.medianM) ? offsets.medianM : 0);
}

/**
 * Roll a drawn payload up into the numbers the legend and the status chip read.
 * @param {Array<object>} records - one entry per distinct building.
 * @param {object} [extra]
 * @returns {object}
 */
export function summarizeBuildings(records, extra = {}) {
  const byTier = new Map(BDTOPO_USAGE_TIERS.map((tier) => [tier.id, 0]));
  const basis = { published: 0, height: 0, surface: 0, default: 0 };
  let dwellings = 0;
  let tallestM = 0;
  let tallestName = null;
  let withHeight = 0;
  let withRnb = 0;

  for (const record of records || []) {
    byTier.set(record.tierId, (byTier.get(record.tierId) || 0) + 1);
    if (basis[record.basis] !== undefined) basis[record.basis] += 1;
    dwellings += Number(record.dwellings) || 0;
    if (Number.isFinite(record.heightM)) {
      withHeight += 1;
      if (record.heightM > tallestM) { tallestM = record.heightM; tallestName = record.label; }
    }
    if (record.rnb) withRnb += 1;
  }

  const count = records?.length || 0;
  return {
    count,
    dwellings,
    tallestM,
    tallestName,
    heightCoverage: count ? withHeight / count : 0,
    rnbCoverage: count ? withRnb / count : 0,
    basis,
    tiers: BDTOPO_USAGE_TIERS.map((tier) => ({
      id: tier.id,
      label: tier.label,
      color: tier.color,
      blurb: tier.blurb,
      count: byTier.get(tier.id) || 0,
    })),
    ...extra,
  };
}

/** @param {number} metres @returns {string} */
export function formatMetres(metres) {
  if (!Number.isFinite(metres)) return '—';
  return metres >= 100 ? `${Math.round(metres)} m` : `${metres.toFixed(1)} m`;
}

/** @param {number} value @returns {string} A count with thin-space grouping. */
export function formatCount(value) {
  const n = Number(value) || 0;
  return n.toLocaleString('fr-FR');
}
