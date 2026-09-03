import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { boxKey, snapBoxOutward } from './viewportBox.js';
import {
  TERRITORY_SELECTED_OVERLAY_SOURCE_ID,
  createTerritorySelectedOverlayEntry,
  fillTerritoryCollection,
  joinTerritories,
  loadTerritoryAnchors,
  resolveTerritoryPickId,
  territoryChips,
  territoryLegend,
  territoryStats,
} from './filosofiTerritoires.js';
import {
  TERRITORY_VINTAGE,
  levelForBox,
  resolveTerritoryMetric,
} from './filosofiTerritoiresFeed.js';
import {
  FILOSOFI_METRICS,
  FILOSOFI_RAMPS,
  FILOSOFI_SIZE_BREAKS,
  FILOSOFI_RAMP_SAMPLE,
  FILOSOFI_VINTAGE,
  cellCentre,
  cellClearanceM,
  cellColor,
  cellDisc,
  cellSymbol,
  metricBand,
  resolutionForBox,
  resolveMetric,
} from './filosofiFeed.js';

/**
 * Carroyage INSEE — the demand side of a location, drawn as ground you can
 * stand a business on.
 *
 * WHY THIS LAYER EXISTS. Everything the app already draws over France is
 * SUPPLY: where the schools are, where the doctors are, what sold, what the
 * PLU allows. None of it says how many people live within a walk of the plot,
 * or what they earn. A commune average cannot answer that — Lyon 7e is one
 * code covering both the Guillotière and Gerland — so the unit has to be
 * smaller than the administration, and INSEE's 200 m carroyage is the only
 * national grid that is.
 *
 * A CELL IS A PLACE TO PUT A SYMBOL, NOT A TILE TO PAINT, AND THAT IS THE FIRST
 * RULE. The carroyage is 2.3 million contiguous squares; drawing each one edge
 * to edge turns a populated département into an opaque quilt with the map
 * underneath it — no streets, no place names, no marker from any other layer,
 * nothing to locate the statistic against. A layer that hides the map is not a
 * layer, it is a replacement. So each cell carries one flat translucent DISC at
 * its centre, capped at `FILOSOFI_MAX_FILL` of the cell, and both the gap
 * around it and the alpha through it are the map. See `cellSymbol` in
 * `filosofiFeed.js` for the ceiling and its price.
 *
 * FLAT, AND THAT WAS A CORRECTION. The count was the EXTRUSION first, which
 * failed three ways: a camera looking down reads no height at all, paying for
 * the tower with the cell's whole footprint cost the basemap, and a field of
 * prisms stands in front of the streets it is describing. Nothing here stands
 * up. The discs are laid a few metres clear of the terrain, which is all the
 * third dimension a statistic about people needs.
 *
 * TWO CHANNELS, AND THE SIZE IS NOT THE INDICATOR. Colour carries the chosen
 * indicator; AREA carries the COUNT that indicator was computed on. That is the
 * whole design and it is a correctness decision, not a style one: "27 100 € per
 * person" has no extent, and the eye reads extent as quantity, so a symbol
 * sized by an average is a picture of nothing.
 *
 * SIX SIZE CLASSES, on national quantiles of the count — the same shape as the
 * six-band colour ramp, and the same argument: the eye cannot read a continuous
 * magnitude back into a number, and the card carries the number anyway. A
 * strictly proportional scale was tried first and it cannot survive the range —
 * see `FILOSOFI_SIZE_BREAKS`, where the arithmetic is written down against a
 * measured viewport.
 *
 * THE HOLLOW DISCS ARE IMPUTED. INSEE publishes a flag meaning "this cell's
 * figures were modelled, because publishing the observation would have broken
 * confidentiality". In the 80 105-cell national sample the ramps were measured
 * on, 39 % of cells carry it. Drawing those identically to observed cells would
 * be drawing a model and calling it a census, so an imputed cell is drawn as a
 * RING — the map shows through where the data was inferred — and the legend
 * says so. The ring is grown to keep the area it loses to its hole, because the
 * hollow is a claim about PROVENANCE and must not double as a quieter claim
 * about the count.
 *
 * THE BREAKS ARE NATIONAL AND ABSOLUTE. A viewport-relative ramp would make
 * Neuilly and Roubaix the same picture, which is the opposite of the point.
 * `filosofiFeed.js` carries the measurement: population-weighted quantiles over
 * a 42-box national sample, so a colour means the same thing wherever the
 * camera is.
 *
 * ABOVE THE GRID'S CEILING THE LAYER CHANGES DATASET RATHER THAN GOING BLANK.
 * The carroyage refuses a box wider than 0.9°, and that refusal is right — 2.3
 * million squares sampled down to a page is a picture of the sample. It also
 * left the map empty at the altitude the app opens at. So past that ceiling the
 * layer draws INSEE's own aggregates instead: one disc per département, then
 * per région, from a second keyless API. It is a DIFFERENT DATASET — a median
 * where the grid has a mean, people where it has households, 2023 where the
 * relayed grid is 2019 — and `filosofiTerritoires.js` puts that on every card,
 * because a reader who thinks they are seeing the same numbers from further
 * away is being misled by the zoom.
 *
 * @module data/filosofiCarreaux
 */

/** Layer id — share-link registry key and voice-tool enum value. */
export const FILOSOFI_LAYER_ID = 'filosofi-fr';
export const FILOSOFI_LAYER_NAME = 'Carroyage INSEE';
export const FILOSOFI_SELECTED_OVERLAY_SOURCE_ID = 'filosofi-fr-selected';
export const FILOSOFI_SELECTED_OVERLAY_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 1,
  moving: false,
});

/**
 * Widest view that still draws symbols, in degrees of latitude.
 *
 * Beyond this the 1 km grid hits its row ceiling and the map becomes a SAMPLE
 * of the country wearing the clothes of a picture of it. Refusing is the
 * honest answer, and `ensureViewGate` flies the camera in rather than leaving
 * the operator to guess how far.
 */
export const FILOSOFI_MAX_BOX_DEG = 0.9;

/**
 * Where the carroyage exists. Outside these, every request is a certain zero.
 *
 * All three are drawn, which was not true until 2026-09-03: INSEE grids
 * Martinique in EPSG:5490 and La Réunion in EPSG:2975 — their own UTM zones —
 * and the identifier parser accepted EPSG:3035 alone, so both territories were
 * declared here and silently dropped every cell. `filosofiFeed.js` now inverts
 * all three grids.
 */
const FILOSOFI_COVERAGE = Object.freeze([
  Object.freeze({ south: 41.2, west: -5.3, north: 51.2, east: 9.7 }), // métropole + Corse
  Object.freeze({ south: 14.3, west: -61.3, north: 15.0, east: -60.7 }), // Martinique
  Object.freeze({ south: -21.5, west: 55.1, north: -20.8, east: 55.9 }), // La Réunion
]);

const REQUEST_DEBOUNCE_MS = 450;
const REQUEST_TIMEOUT_MS = 45_000;
const RETRY_MIN_MS = 20_000;
const RETRY_CEIL_MS = 240_000;
/**
 * Idle refresh cadence. A statistical millésime does not move; this exists so a
 * session left open across a new INSEE edition eventually notices, not because
 * anything changes hourly.
 */
const UPDATE_INTERVAL_MS = 60 * 60_000;
/** Cache grid the box is snapped onto — matches the proxy's own step. */
const BOX_SNAP_DEG = 0.01;

/** Selection accent, matching the app's other selected-object cards. */
const SELECTED_COLOR = '#00ffff';

/**
 * How opaque a disc is drawn.
 *
 * The second half of "never hide the map": the gaps let it through BETWEEN the
 * discs, this lets it through UNDER them. 0.7 is where the band still reads as
 * its own colour over a busy basemap — much below it and the ramp starts
 * borrowing the hue of whatever it is lying on, which would make the indicator
 * a function of the map style.
 *
 * The cost is real and worth knowing: translucent geometry does not write
 * depth, so two symbols overlapping on screen blend in whatever order they were
 * batched. Flat discs on a shared plane never overlap from above and barely do
 * at a grazing angle, which is what makes the alpha affordable here and made it
 * unaffordable when every cell was an extruded tower.
 */
const DISC_ALPHA = 0.7;

/** Reused so a 5 000-cell payload does not mint 5 000 Cartographics. */
const _groundScratch = new Cesium.Cartographic();

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});

let _viewer = null;
let _overlayHost = DEFAULT_OVERLAY_HOST;
let _enabled = false;
let _primitive = null;
/** cell id -> drawn record */
let _records = new Map();
let _payload = null;
let _metric = FILOSOFI_METRICS[0];
let _selectedId = null;
let _loading = false;
let _error = null;
let _status = 'idle';
let _lastUpdate = null;
let _loadedKey = null;
let _abort = null;
let _debounceTimer = null;
let _retryTimer = null;
let _retryDelayMs = 0;
let _clickHandler = null;
let _moveEndRemover = null;

// --- The national regime ---------------------------------------------------
/** `'carreaux'` below the grid's ceiling, `'territoires'` above it. */
let _regime = 'carreaux';
let _level = 'DEP';
let _points = null;
/** territory id -> drawn record */
let _territoryRecords = new Map();
let _territoryPayload = null;
let _territoryMetric = resolveTerritoryMetric('niveau');
let _territoryLoadedKey = null;
let _territoryAnchors = null;

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------
/**
 * @param {{south:number, west:number, north:number, east:number}} box
 * @returns {boolean} Whether the box touches carroyage coverage.
 */
export function filosofiCoverageIntersects(box) {
  if (!box) return false;
  return FILOSOFI_COVERAGE.some((area) => box.south <= area.north && box.north >= area.south
    && box.west <= area.east && box.east >= area.west);
}

/** @param {object} box @returns {boolean} */
export function filosofiBoxTooWide(box) {
  if (!box) return true;
  return (box.north - box.south) > FILOSOFI_MAX_BOX_DEG
    || (box.east - box.west) > FILOSOFI_MAX_BOX_DEG * 1.6;
}

/**
 * The viewport this layer will ask for, or null with the reason it will not.
 *
 * Coverage BEFORE width, so a wide view of the Atlantic is told it is outside
 * the country rather than told to zoom in — advice that would find nothing at
 * any altitude.
 *
 * @param {?Cesium.Viewer} viewer
 * @returns {{box: ?object, reason: ?string}}
 */
export function filosofiViewportBox(viewer) {
  const rectangle = viewer?.camera?.computeViewRectangle(viewer.scene?.globe?.ellipsoid);
  if (!rectangle) return { box: null, reason: 'no-view' };
  const box = {
    south: Cesium.Math.toDegrees(rectangle.south),
    north: Cesium.Math.toDegrees(rectangle.north),
    west: Cesium.Math.toDegrees(rectangle.west),
    east: Cesium.Math.toDegrees(rectangle.east),
  };
  if (!Number.isFinite(box.south) || !Number.isFinite(box.west)) return { box: null, reason: 'no-view' };
  if (box.west >= box.east || box.south >= box.north) return { box: null, reason: 'no-view' };
  if (!filosofiCoverageIntersects(box)) return { box: null, reason: 'off-coverage', raw: box };
  if (filosofiBoxTooWide(box)) return { box: null, reason: 'too-wide', raw: box };
  return { box, reason: null, raw: box };
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------
/** Terrain height the globe is actually rendering under a point, or null. */
function renderedGroundM(lat, lon) {
  const globe = _viewer?.scene?.globe;
  if (!globe?.getHeight) return null;
  _groundScratch.longitude = Cesium.Math.toRadians(lon);
  _groundScratch.latitude = Cesium.Math.toRadians(lat);
  _groundScratch.height = 0;
  const height = globe.getHeight(_groundScratch);
  return Number.isFinite(height) ? height : null;
}

/**
 * The outline of one drawn symbol, concentric with its cell.
 *
 * Serves both the disc and the hole an imputed disc carries: they differ only
 * by the fraction handed in.
 *
 * @param {object} cell
 * @param {number} resolution
 * @param {number} fraction Diameter as a share of the cell's side.
 * @returns {Array<[number, number]>}
 */
export function drawnOutline(cell, resolution, fraction) {
  return cellDisc({
    res: resolution, n: cell.n, e: cell.e, crs: cell.crs ?? 3035,
  }, fraction);
}

/**
 * A stable, human-readable id for one drawn cell.
 *
 * The GRID is part of the identity, not decoration: métropole is EPSG:3035 and
 * the overseas grids are their own UTM zones, so two cells in two territories
 * can carry the same northing and easting and mean different places.
 */
export function cellId(cell, resolution) {
  return `filosofi:${cell.crs ?? 3035}:${resolution}:${cell.n}:${cell.e}`;
}

function clearPrimitive() {
  if (_primitive && _viewer?.scene) _viewer.scene.primitives.remove(_primitive);
  _primitive = null;
  _records = new Map();
  _selectedId = null;
}

/**
 * What the layer draws, one record per populated cell.
 *
 * Falls back to the viewport's own first answer where the globe has no tile
 * yet, so a cold tile does not drop one symbol to sea level next to its
 * neighbours.
 *
 * @param {Array<object>} cells
 * @param {number} resolution
 * @returns {{records: Array<object>, coldGround: number}}
 */
function buildRecords(cells, resolution) {
  const records = [];
  let coldGround = 0;
  let fallbackM = null;
  for (const cell of cells) {
    const symbol = cellSymbol(cell, _metric, { resolution });
    if (symbol.fill <= 0) continue;
    const [lon, lat] = cellCentre({
      res: resolution, n: cell.n, e: cell.e, crs: cell.crs ?? 3035,
    });
    // ONE sample, at the centre. Probing the footprint instead was measured at
    // 400 ms per redraw against 85 ms for the same 484 cells; the clearance
    // below absorbs the relief that costs.
    let groundM = renderedGroundM(lat, lon);
    if (groundM === null) {
      coldGround += 1;
      groundM = fallbackM ?? 0;
    } else if (fallbackM === null) {
      fallbackM = groundM;
    }
    const color = cellColor(cell, _metric);
    if (!color) continue;
    const baseM = groundM + cellClearanceM(resolution, symbol.fill);
    records.push({
      id: cellId(cell, resolution),
      cell,
      resolution,
      vintage: _payload?.vintage ?? FILOSOFI_VINTAGE,
      color,
      fill: symbol.fill,
      baseM,
      lon,
      lat,
      corners: drawnOutline(cell, resolution, symbol.fill),
      holeCorners: symbol.hole > 0 ? drawnOutline(cell, resolution, symbol.hole) : null,
      position: Cesium.Cartesian3.fromDegrees(lon, lat, baseM),
    });
  }
  return { records, coldGround };
}

/**
 * The polygon one record draws: its disc, with the hole an imputed cell has.
 *
 * A hole rather than a second, smaller instance in the basemap's colour: the
 * ring has to be genuinely open, or the map does not show through it and the
 * hollow means nothing.
 *
 * @param {object} record
 * @returns {Cesium.PolygonHierarchy}
 */
function symbolHierarchy(record) {
  const ring = [];
  for (const [lon, lat] of record.corners) ring.push(lon, lat);
  const positions = Cesium.Cartesian3.fromDegreesArray(ring);
  if (!record.holeCorners) return new Cesium.PolygonHierarchy(positions);
  const hole = [];
  for (const [lon, lat] of record.holeCorners) hole.push(lon, lat);
  return new Cesium.PolygonHierarchy(positions, [
    new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(hole)),
  ]);
}

/** Build one batched primitive for the whole viewport. */
function drawRecords(records) {
  clearPrimitive();
  if (!records.length || !_viewer) return;

  const instances = [];
  for (const record of records) {
    _records.set(record.id, record);
    instances.push(new Cesium.GeometryInstance({
      id: record.id,
      geometry: new Cesium.PolygonGeometry({
        polygonHierarchy: symbolHierarchy(record),
        // FLAT, and at one height: no extrusion, no walls, nothing standing up
        // off the map. The count is the disc's area; a prism would say it twice
        // and stand in front of the streets it is describing.
        height: record.baseM,
        vertexFormat: Cesium.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT,
      }),
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(instanceColor(record)),
      },
    }));
  }

  _primitive = new Cesium.Primitive({
    geometryInstances: instances,
    // Flat shading, because there is no form left to shade and a headlight on a
    // horizontal disc only tints it: `flat` puts the exact band colour on the
    // map, which is what the panel's legend swatch promises.
    appearance: new Cesium.PerInstanceColorAppearance({
      flat: true, closed: false, translucent: true,
    }),
    asynchronous: true,
    releaseGeometryInstances: false,
  });
  _primitive.show = _enabled;
  _viewer.scene.primitives.add(_primitive);
  governorRequestRender('filosofi-fr');
}

/**
 * A cell's drawn colour: its band, at the layer's one alpha.
 *
 * The brightness used to carry the extrusion, to separate two neighbours in the
 * same band that shared an edge. Nothing shares an edge now: every symbol
 * stands inside its own cell with a gutter around it, so the band can be the
 * band, and two cells of the same colour are two cells with the same value.
 *
 * One alpha for every disc, and that matters: varying it per cell would make
 * transparency a third data channel nobody declared, and the map underneath
 * would read as part of the statistic.
 *
 * @param {object} record
 * @returns {Cesium.Color}
 */
export function instanceColor(record) {
  return Cesium.Color.fromCssColorString(record.color).withAlpha(DISC_ALPHA);
}

function applyInstanceColor(id, color) {
  if (!_primitive?.ready) return;
  const attributes = _primitive.getGeometryInstanceAttributes(id);
  if (!attributes) return;
  attributes.color = Cesium.ColorGeometryInstanceAttribute.toValue(color, attributes.color);
  governorRequestRender('filosofi-recolor');
}

function clearSelection() {
  if (_selectedId) {
    const record = _records.get(_selectedId);
    if (record) applyInstanceColor(_selectedId, instanceColor(record));
  }
  _selectedId = null;
  _overlayHost.clearSource(FILOSOFI_SELECTED_OVERLAY_SOURCE_ID);
  _overlayHost.clearSource(TERRITORY_SELECTED_OVERLAY_SOURCE_ID);
}

/** Repaint every instance after the metric changed, without refetching. */
function recolorAll() {
  for (const [id, record] of _records) {
    if (id === _selectedId) continue;
    applyInstanceColor(id, instanceColor(record));
  }
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------
const _fr = new Intl.NumberFormat('fr-FR');

/** @param {?number} value @returns {string} */
function count(value) {
  return Number.isFinite(value) ? _fr.format(Math.round(value)) : '—';
}

/** @param {?number} value @param {string} unit @returns {string} */
function measure(value, unit) {
  if (!Number.isFinite(value)) return 'non publié';
  return `${_fr.format(value)} ${unit}`;
}

/**
 * The card for one selected cell.
 *
 * Every line is either a published value or an explicit statement that the
 * value is absent — and the imputation line is never omitted, because a
 * modelled figure that looks like a measured one is the single way this layer
 * could mislead.
 *
 * @param {object} record
 * @param {Object<string,string>} communes
 * @returns {?object}
 */
export function createFilosofiSelectedOverlayEntry(record, communes = {}) {
  if (!record?.id || !record.position) return null;
  const cell = record.cell;
  const side = record.resolution === 1000 ? '1 km' : '200 m';
  const commune = cell.com ? communes[cell.com] : null;
  const details = [];

  details.push(`${count(cell.ind)} habitants · ${count(cell.men)} ménages`);
  details.push(cell.niveau !== null
    ? `Niveau de vie moyen ${measure(cell.niveau, '€/an')}`
    : 'Niveau de vie non publié pour ce carreau');
  if (cell.pauvrete !== null) details.push(`${cell.pauvrete} % de ménages pauvres`);
  if (cell.social !== null) details.push(`${cell.social} % en logement social`);
  if (cell.jeunes !== null || cell.aines !== null) {
    details.push(`${cell.jeunes ?? '—'} % de moins de 18 ans · ${cell.aines ?? '—'} % de 65 ans et plus`);
  }
  if (cell.proprietaires !== null) details.push(`${cell.proprietaires} % de propriétaires`);
  if (cell.solo !== null) details.push(`${cell.solo} % de personnes seules`);
  if (cell.surface !== null) details.push(`${cell.surface} m² par logement en moyenne`);

  // The one line that must never be dropped — and never guessed either: with
  // the flag absent the card says the flag is absent, because "observé" is a
  // claim and a missing column does not support it.
  if (cell.est === 1) {
    details.push('Carreau IMPUTÉ : valeurs approchées, pas observées (secret statistique)');
  } else if (cell.est === 0) {
    details.push('Carreau observé, non imputé');
  } else {
    details.push('Imputation non renseignée par l’INSEE pour ce carreau');
  }
  // THE MILLÉSIME IS READ, NOT ASSERTED. The relay serves 2019 and a local pack
  // serves 2021, and Martinique and La Réunion stay on the relay even when
  // métropole has moved — so the year belongs to the ANSWER this cell came in,
  // not to the layer. A constant here is one upstream refresh away from
  // captioning 2021 figures with "2019".
  const vintage = record.vintage ?? FILOSOFI_VINTAGE;
  details.push(`Carreau ${side} · revenus ${vintage} · INSEE Filosofi`);
  // Size is the count, not the indicator — stated on the card because it is the
  // one thing a viewer cannot read off the picture, and because a disc that
  // stops short of its cell must say what the space around it means: nobody
  // there, not no data there.
  details.push(`Aire du disque = ${_metric.weight === 'men' ? 'ménages' : 'habitants'}, couleur = ${_metric.label.toLowerCase()}`);

  return {
    id: String(record.id),
    position: record.position,
    variant: 'selected',
    selected: true,
    protected: true,
    paintLane: 'selected',
    collisionGroup: 'ambient-card',
    priority: Number.MAX_SAFE_INTEGER,
    title: commune || (cell.com ? `Commune ${cell.com}` : `Carreau ${side}`),
    details,
    accent: SELECTED_COLOR,
    interactive: false,
    anchorRadiusPx: 9,
    minAnchorGapPx: 11,
    verticalOnly: true,
    placement: 'above',
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
  };
}

/** @param {*} picked @param {(id:string)=>boolean} has @returns {?string} */
export function resolveFilosofiPickId(picked, has = (id) => _records.has(id)) {
  const id = typeof picked?.id === 'string' ? picked.id : picked?.id?.id;
  return typeof id === 'string' && has(id) ? id : null;
}

function selectCell(id) {
  const record = _records.get(id);
  if (!record) return false;
  clearSelection();
  _selectedId = id;
  applyInstanceColor(id, Cesium.Color.fromCssColorString(SELECTED_COLOR).withAlpha(DISC_ALPHA));
  const entry = createFilosofiSelectedOverlayEntry(record, _payload?.communes || {});
  if (entry) {
    _overlayHost.setVisible(FILOSOFI_SELECTED_OVERLAY_SOURCE_ID, true);
    _overlayHost.setEntries(
      FILOSOFI_SELECTED_OVERLAY_SOURCE_ID, [entry], FILOSOFI_SELECTED_OVERLAY_SOURCE_OPTIONS,
    );
  }
  governorRequestRender('filosofi-select');
  return true;
}

function onKeyDown(event) {
  if (event.key === 'Escape' && _selectedId) clearSelection();
}

function installClickHandler(viewer) {
  if (_clickHandler || !viewer?.scene?.canvas) return;
  _clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  _clickHandler.setInputAction((click) => {
    const picked = viewer.scene.pick(click.position);
    const territory = resolveTerritoryPickId(picked, (id) => _territoryRecords.has(id));
    if (territory) { selectTerritory(territory); return; }
    const id = resolveFilosofiPickId(picked);
    if (id) { selectCell(id); return; }
    if (!picked && _selectedId) clearSelection();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  if (typeof document !== 'undefined') document.addEventListener('keydown', onKeyDown);
}

// ---------------------------------------------------------------------------
// The national regime
// ---------------------------------------------------------------------------
function clearPoints() {
  if (_points && _viewer?.scene) _viewer.scene.primitives.remove(_points);
  _points = null;
  _territoryRecords = new Map();
}

/** Drop whatever the other regime had drawn, so only one is ever on screen. */
function leaveRegime(next) {
  if (_regime === next) return;
  clearSelection();
  if (next === 'territoires') clearPrimitive();
  else clearPoints();
  _regime = next;
}

function drawTerritories(records) {
  if (!_viewer?.scene) return;
  if (!_points) {
    _points = new Cesium.PointPrimitiveCollection();
    _viewer.scene.primitives.add(_points);
  }
  const drawn = fillTerritoryCollection(_points, records, _territoryMetric);
  _territoryRecords = new Map(drawn.map((record) => [record.id, record]));
  _points.show = _enabled;
  governorRequestRender('filosofi-territoires');
}

/**
 * Fetch and draw one level of the national view.
 *
 * The anchors and the figures are fetched INDEPENDENTLY and cached
 * independently: the anchors are a bundled file that never changes within a
 * release, the figures are a millésime behind a month-long proxy cache. Tying
 * them into one request would re-download the outlines every time INSEE's
 * cache expired.
 *
 * @param {'DEP'|'REG'} level
 * @returns {Promise<boolean>} Whether anything new was drawn.
 */
async function loadTerritories(level) {
  const key = `territoires:${level}`;
  if (key === _territoryLoadedKey && _territoryPayload && !_error) {
    // Same level, same figures — but the metric may have changed under us.
    drawTerritories([..._territoryRecords.values()].length
      ? [..._territoryRecords.values()]
      : joinTerritories(_territoryPayload.territories, _territoryAnchors, level).records);
    return false;
  }

  _abort?.abort();
  _abort = new AbortController();
  const signal = _abort.signal;
  const timeout = setTimeout(() => _abort?.abort(), REQUEST_TIMEOUT_MS);
  _loading = true;
  _status = 'loading';
  _error = null;
  try {
    const [payload, anchors] = await Promise.all([
      fetch(`/api/filosofi/territoires?level=${level}`, { signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(`territoires HTTP ${response.status}`);
          const body = await response.json();
          if (!Array.isArray(body?.territories)) throw new Error('Réponse territoires illisible');
          return body;
        }),
      _territoryAnchors ? Promise.resolve(_territoryAnchors) : loadTerritoryAnchors(),
    ]);
    if (signal.aborted) return false;
    _territoryAnchors = anchors;
    const { records, unanchored } = joinTerritories(payload.territories, anchors, level);
    // The carreau millésime the proxy says it would serve, carried onto every
    // record so the card can name it without the client assuming a year.
    for (const record of records) record.carroyageVintage = payload.vintage?.carroyage ?? null;
    drawTerritories(records);
    _territoryPayload = { ...payload, unanchored, drawn: records.length };
    _level = level;
    _territoryLoadedKey = key;
    _lastUpdate = Date.now();
    _retryDelayMs = 0;
    clearRetry();
    _status = 'ready';
    return true;
  } catch (error) {
    if (error?.name === 'AbortError') return false;
    _error = error?.message || String(error);
    _status = 'unavailable';
    _territoryLoadedKey = null;
    scheduleRetry();
    console.warn('[Data:Carroyage INSEE] national view failed:', error);
    return false;
  } finally {
    clearTimeout(timeout);
    _loading = false;
  }
}

function selectTerritory(id) {
  const record = _territoryRecords.get(id);
  if (!record) return false;
  clearSelection();
  _selectedId = id;
  const entry = createTerritorySelectedOverlayEntry(record, _territoryMetric);
  if (entry) {
    _overlayHost.setVisible(TERRITORY_SELECTED_OVERLAY_SOURCE_ID, true);
    _overlayHost.setEntries(
      TERRITORY_SELECTED_OVERLAY_SOURCE_ID, [entry], FILOSOFI_SELECTED_OVERLAY_SOURCE_OPTIONS,
    );
  }
  governorRequestRender('filosofi-territory-select');
  return true;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------
function clearRetry() {
  if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }
}

function scheduleLoad() {
  clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(() => { void load(); }, REQUEST_DEBOUNCE_MS);
}

function scheduleRetry() {
  clearRetry();
  _retryDelayMs = _retryDelayMs ? Math.min(_retryDelayMs * 2, RETRY_CEIL_MS) : RETRY_MIN_MS;
  _retryTimer = setTimeout(() => { void load(); }, _retryDelayMs);
}

/** Fetch and draw the carroyage for the current viewport. */
async function load() {
  if (!_enabled || !_viewer) return false;

  const { box, reason, raw } = filosofiViewportBox(_viewer);
  if (!box) {
    // TOO WIDE IS NOT NOTHING. The grid cannot answer here, but INSEE can: the
    // layer changes dataset rather than going blank, and says which one it is
    // on. Off-coverage and no-view still clear — there is no French aggregate
    // for a view of the Atlantic either.
    if (reason === 'too-wide') {
      leaveRegime('territoires');
      _payload = null;
      _loadedKey = null;
      return loadTerritories(levelForBox(raw));
    }
    leaveRegime('carreaux');
    clearPrimitive();
    _payload = null;
    _loadedKey = null;
    _error = null;
    _status = reason === 'off-coverage' ? 'off-coverage' : 'idle';
    governorRequestRender('filosofi-clear');
    return false;
  }
  leaveRegime('carreaux');

  const snapped = snapBoxOutward(box, BOX_SNAP_DEG);
  const resolution = resolutionForBox(snapped);
  const key = `${resolution}:${boxKey(snapped, 3)}`;
  if (key === _loadedKey && _payload && !_error) return false;

  _abort?.abort();
  _abort = new AbortController();
  const signal = _abort.signal;
  const timeout = setTimeout(() => _abort?.abort(), REQUEST_TIMEOUT_MS);
  _loading = true;
  _status = 'loading';
  _error = null;

  try {
    const query = new URLSearchParams({
      south: snapped.south.toFixed(5),
      west: snapped.west.toFixed(5),
      north: snapped.north.toFixed(5),
      east: snapped.east.toFixed(5),
      resolution: String(resolution),
    });
    const response = await fetch(`/api/filosofi/carreaux?${query}`, { signal });
    if (!response.ok) throw new Error(`carroyage HTTP ${response.status}`);
    const payload = await response.json();
    if (signal.aborted) return false;
    if (!payload || payload.error) throw new Error(payload?.error || 'Réponse carroyage illisible');

    const { records, coldGround } = buildRecords(payload.cells || [], resolution);
    drawRecords(records);
    _payload = { ...payload, drawn: records.length, coldGround };
    _lastUpdate = Date.now();
    _loadedKey = key;
    _retryDelayMs = 0;
    clearRetry();
    _status = 'ready';
    return true;
  } catch (error) {
    if (error?.name === 'AbortError') return false;
    _error = error?.message || String(error);
    _status = 'unavailable';
    _loadedKey = null;
    scheduleRetry();
    console.warn('[Data:Carroyage INSEE] load failed:', error);
    return false;
  } finally {
    clearTimeout(timeout);
    _loading = false;
  }
}

/**
 * Redraw the payload ALREADY IN HAND under a new indicator.
 *
 * Not a refetch: the same 146 cells carry every indicator at once, and the
 * only thing that changed is which column drives the colour and which count
 * drives the size. Asking the proxy again would buy the same bytes twice.
 *
 * @returns {boolean}
 */
function redrawForMetric() {
  if (!_payload?.cells || !_viewer) return false;
  clearSelection();
  const { records, coldGround } = buildRecords(_payload.cells, _payload.resolution);
  drawRecords(records);
  _payload = { ..._payload, drawn: records.length, coldGround };
  return true;
}

// ---------------------------------------------------------------------------
// The legend
// ---------------------------------------------------------------------------
/**
 * The two rows whose channel is SHAPE, drawn as the glyph they describe.
 *
 * Colour is the only channel a colour legend can explain, and this layer has
 * three. Without these rows the size of a disc — the population, the whole
 * denominator — is a thing the map states and the panel never mentions, and the
 * rings look like a rendering fault.
 */
const SHAPE_LEGEND_TINT = '#9ec8e0';
const svgGlyph = (body) => `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 13 13">${body}</svg>`,
)}`;
/** Three discs, small to large: the size channel, shown as itself. */
const SIZE_GLYPH = svgGlyph(
  '<circle cx="1.6" cy="10.4" r="1.6"/>'
  + '<circle cx="5.6" cy="9.4" r="2.6"/>'
  + '<circle cx="11.3" cy="8" r="4"/>',
);
/** A ring: an imputed cell, shown as itself. */
const HOLLOW_GLYPH = svgGlyph(
  '<path fill-rule="evenodd" d="M6.5 0.8a5.7 5.7 0 1 0 0 11.4a5.7 5.7 0 1 0 0-11.4z'
  + 'M6.5 3.65a2.85 2.85 0 1 1 0 5.7a2.85 2.85 0 1 1 0-5.7z"/>',
);

/**
 * The six bands, with the break that opens each and how many cells are in it.
 *
 * The break VALUES are on the legend rather than "faible / élevé", because the
 * whole claim of an absolute ramp is that the numbers travel with it.
 *
 * @param {object} metric
 * @param {Array<object>} cells
 * @returns {Array<object>}
 */
export function filosofiLegend(metric, cells = [], resolution = 200) {
  const breaks = FILOSOFI_RAMPS[metric.id === 'population' ? 'population' : metric.id];
  const counts = new Array(metric.ramp.length).fill(0);
  let unknown = 0;
  for (const cell of cells) {
    const band = metricBand(cell[metric.field], metric);
    if (band < 0) unknown += 1;
    else counts[band] += 1;
  }
  const suffix = metric.unit.startsWith('%') ? ' %' : '';
  const legend = metric.ramp.map((color, index) => {
    const low = index === 0 ? null : breaks[index - 1];
    const high = index < breaks.length ? breaks[index] : null;
    const label = low === null
      ? `< ${_fr.format(high)}${suffix}`
      : high === null
        ? `≥ ${_fr.format(low)}${suffix}`
        : `${_fr.format(low)} – ${_fr.format(high)}${suffix}`;
    return {
      label,
      color,
      count: counts[index],
      blurb: index === 0
        ? `Décile national bas — ${metric.unit}`
        : index === metric.ramp.length - 1
          ? `Décile national haut — ${metric.unit}`
          : `${metric.unit}`,
    };
  });
  if (unknown > 0) {
    legend.push({
      label: 'Non publié',
      color: '#4a5568',
      count: unknown,
      blurb: 'Le carreau existe mais l’indicateur n’y est pas diffusé.',
    });
  }

  // The shape channels, after the colour ramp they qualify. Each carries the
  // count it is a legend FOR — the people the discs are sized on, and the
  // cells whose figures were modelled — so neither row is a caption without a
  // number.
  const weightField = metric.weight === 'men' ? 'men' : 'ind';
  let weightTotal = 0;
  let imputed = 0;
  for (const cell of cells) {
    if (Number.isFinite(cell?.[weightField])) weightTotal += cell[weightField];
    if (cell?.est === 1) imputed += 1;
  }
  // The class breaks, in words, because "six sizes" without the numbers is a
  // scale nobody can read back. Fine grid unless the payload says otherwise —
  // the legend is drawn before the first answer arrives.
  const sizeBreaks = (FILOSOFI_SIZE_BREAKS[resolution] || FILOSOFI_SIZE_BREAKS[200])[
    metric.weight === 'men' ? 'men' : 'ind'
  ];
  const unit = metric.weight === 'men' ? 'ménages' : 'habitants';
  const gridLabel = resolution === 1000 ? '1 km' : '200 m';
  legend.push({
    label: metric.weight === 'men' ? 'Aire = ménages' : 'Aire = habitants',
    color: SHAPE_LEGEND_TINT,
    glyph: SIZE_GLYPH,
    count: Math.round(weightTotal),
    blurb: `Six tailles, sur les quantiles nationaux du carroyage ${gridLabel} :`
      + ` ${sizeBreaks.map((edge) => _fr.format(edge)).join(' · ')} ${unit}.`
      + ' Six paliers et pas une échelle continue, pour la raison qui donne six'
      + ' paliers à la couleur : l’œil ne relit pas une grandeur continue en'
      + ' nombre, et la fiche porte le chiffre exact. Le disque ne remplit jamais'
      + ' son carreau : le vide autour de lui est le fond de carte, pas une'
      + ' absence de données.',
  });
  if (imputed > 0) {
    legend.push({
      label: 'Évidé = imputé',
      color: SHAPE_LEGEND_TINT,
      glyph: HOLLOW_GLYPH,
      count: imputed,
      blurb: 'Valeurs modélisées par l’INSEE au titre du secret statistique, pas'
        + ' observées. L’anneau garde l’aire que son trou lui enlève : l’évidement dit'
        + ' d’où vient le chiffre, pas combien il vaut.',
    });
  }
  return legend;
}

// ---------------------------------------------------------------------------
// The layer
// ---------------------------------------------------------------------------
const filosofiCarreauxLayer = {
  id: FILOSOFI_LAYER_ID,
  name: FILOSOFI_LAYER_NAME,
  icon: '▩',
  source: 'INSEE Filosofi (Géoplateforme)',
  updateInterval: UPDATE_INTERVAL_MS,

  init(viewer) {
    _viewer = viewer;
    _enabled = false;
    _records = new Map();
    _payload = null;
    _selectedId = null;
    _loading = false;
    _error = null;
    _status = 'idle';
    _lastUpdate = null;
    _loadedKey = null;
    _retryDelayMs = 0;
    _metric = FILOSOFI_METRICS[0];
    _regime = 'carreaux';
    _level = 'DEP';
    _territoryPayload = null;
    _territoryRecords = new Map();
    _territoryLoadedKey = null;
    _territoryMetric = resolveTerritoryMetric('niveau');
    _overlayHost.setVisible(FILOSOFI_SELECTED_OVERLAY_SOURCE_ID, false);
    _overlayHost.setVisible(TERRITORY_SELECTED_OVERLAY_SOURCE_ID, false);
    console.log('[Data:Carroyage INSEE] Initialized');
  },

  enable(viewer) {
    _enabled = true;
    _error = null;
    if (viewer) _viewer = viewer;
    if (_primitive) _primitive.show = true;
    if (_points) _points.show = true;
    _overlayHost.setVisible(FILOSOFI_SELECTED_OVERLAY_SOURCE_ID, true);
    _overlayHost.setVisible(TERRITORY_SELECTED_OVERLAY_SOURCE_ID, true);
    installClickHandler(_viewer);
    registerPickOwner(FILOSOFI_LAYER_ID, (pickedId) => _records.has(pickedId));
    if (!_moveEndRemover && _viewer?.camera?.moveEnd) {
      _moveEndRemover = _viewer.camera.moveEnd.addEventListener(scheduleLoad);
    }
    // The manager calls update() immediately after enable(); no fetch here, or
    // the two race and one aborts the other.
  },

  disable() {
    _enabled = false;
    clearSelection();
    clearRetry();
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
    _abort?.abort();
    _abort = null;
    if (_primitive) _primitive.show = false;
    if (_points) _points.show = false;
    _overlayHost.setVisible(FILOSOFI_SELECTED_OVERLAY_SOURCE_ID, false);
    _overlayHost.setVisible(TERRITORY_SELECTED_OVERLAY_SOURCE_ID, false);
    if (_clickHandler) { _clickHandler.destroy(); _clickHandler = null; }
    if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeyDown);
    unregisterPickOwner(FILOSOFI_LAYER_ID);
    if (_moveEndRemover) { _moveEndRemover(); _moveEndRemover = null; }
    _loading = false;
    _status = 'idle';
  },

  // NO `ensureViewGate`, and its removal is the point. The layer used to fly
  // the camera down to a city when it was switched on from a national view,
  // because a wide box drew nothing. It now draws the country's départements
  // there, so moving the operator would be taking a decision away from them to
  // solve a problem that no longer exists. Zooming is how you ask for the grid.

  async update() {
    if (!_enabled) return false;
    _loadedKey = null;
    _territoryLoadedKey = null;
    const loaded = await load();
    return loaded || !_error;
  },

  /**
   * Runtime params. `metric` recolours what is already drawn; it never refetches,
   * because every indicator arrived in the same answer.
   * @param {{metric?: string}} [params]
   * @returns {boolean} Whether anything was accepted.
   */
  setParams(params = {}) {
    if (params.metric === undefined) return false;
    // BOTH regimes are updated, always, whichever one is on screen. The chips
    // the operator can see belong to the regime they are in, but a share link
    // carries one id and the camera it restores decides which regime reads it —
    // so `niveau` has to mean the right thing on both sides of the threshold.
    const nextCarreau = resolveMetric(params.metric);
    const nextTerritory = resolveTerritoryMetric(params.metric);
    const changed = nextCarreau.id !== _metric.id || nextTerritory.id !== _territoryMetric.id;
    if (!changed) return false;
    _metric = nextCarreau;
    _territoryMetric = nextTerritory;
    if (_regime === 'territoires') {
      const rebuilt = _territoryPayload && _territoryAnchors
        ? joinTerritories(_territoryPayload.territories, _territoryAnchors, _level).records
        : [];
      for (const record of rebuilt) {
        record.carroyageVintage = _territoryPayload?.vintage?.carroyage ?? null;
      }
      const records = rebuilt;
      clearSelection();
      drawTerritories(records);
    } else {
      redrawForMetric();
    }
    governorRequestRender('filosofi-metric');
    return true;
  },

  /**
   * The runtime state a share link has to carry.
   *
   * Without this the manager has nothing to serialize and `lo=` comes back
   * empty: the link would restore the carroyage coloured by niveau de vie
   * whatever the sender was looking at, which is a different map with the same
   * cells. Measured in `scripts/qa-filosofi.mjs`, which reads the hash.
   * @returns {{metric: string}}
   */
  getParams() {
    // The regime on screen owns the answer: the national view has two
    // indicators the grid does not have at all, and serialising the carreau
    // chip while the operator is looking at Gini would share a different map.
    return { metric: _regime === 'territoires' ? _territoryMetric.id : _metric.id };
  },

  /**
   * A carreau is not a contact. Nothing here moves, and a detection reticle over
   * every carreau in Paris would drown every layer that does.
   * @returns {Array}
   */
  getDetectableObjects() {
    return [];
  },

  getRowControls() {
    if (_regime === 'territoires') {
      const records = [..._territoryRecords.values()];
      return {
        chips: territoryChips(_territoryMetric),
        legend: territoryLegend(_territoryMetric, records, _level),
      };
    }
    const cells = _payload?.cells || [];
    const chips = FILOSOFI_METRICS.map((metric) => ({
      id: metric.id,
      label: metric.short,
      active: _metric.id === metric.id,
      state: _metric.id === metric.id ? 'active' : 'idle',
      title: `${metric.label} — ${metric.blurb} (${metric.unit})`,
      params: { metric: metric.id },
    }));
    return { chips, legend: filosofiLegend(_metric, cells, _payload?.resolution || 200) };
  },

  getStats() {
    if (_regime === 'territoires') {
      const records = [..._territoryRecords.values()];
      const stats = territoryStats(records, _level);
      const result = {
        count: records.length,
        regime: 'territoires',
        level: _level,
        levelLabel: stats.levelLabel,
        cells: stats.territories,
        resolution: null,
        people: stats.people,
        niveau: stats.niveau,
        metric: _territoryMetric.id,
        metricLabel: _territoryMetric.label,
        // The year belongs to the number, and the two regimes disagree about
        // it. Publishing the vintage of the regime ON SCREEN is what stops the
        // panel from captioning a 2023 median with the grid's 2019.
        vintage: _territoryMetric.year,
        vintages: TERRITORY_VINTAGE,
        scope: stats.scope,
        withoutFigures: stats.withoutFigures,
        lastUpdate: _lastUpdate,
        loading: _loading,
        status: _status === 'ready' ? 'ok' : _status,
        stale: Boolean(_territoryPayload?.stale),
        feedSource: 'INSEE Filosofi, recensement et base Tous salariés — API Melodi',
      };
      if (_territoryPayload?.partial) {
        result.degraded = true;
        result.loadingLabel = 'Vue nationale incomplète : une des trois sources INSEE n’a pas répondu';
      } else if (_loading) {
        result.loadingLabel = `Agrégats ${stats.levelLabel.toLowerCase()}…`;
      } else if (records.length) {
        result.loadingLabel = `${stats.levelLabel} · Filosofi ${TERRITORY_VINTAGE.filosofi}`
          + ' — zoome pour le carroyage 200 m';
      }
      if (_error) result.error = _error;
      return result;
    }
    const summary = _payload?.summary || null;
    const result = {
      count: _payload?.drawn ?? 0,
      cells: summary?.cells ?? 0,
      resolution: _payload?.resolution ?? null,
      people: summary?.people ?? null,
      households: summary?.households ?? null,
      niveau: summary?.niveau ?? null,
      pauvrete: summary?.pauvrete ?? null,
      // The share of what is on screen that was modelled rather than observed.
      // Reported next to the totals, never below them: the totals are only as
      // good as this number.
      imputedCells: summary?.imputedCells ?? null,
      imputedShare: summary?.imputedShare ?? null,
      // A 0 % imputed share is only good news when nothing was left unsaid.
      imputedUnknown: summary?.imputedUnknown ?? null,
      truncated: Boolean(_payload?.truncated),
      matched: _payload?.matched ?? null,
      metric: _metric.id,
      metricLabel: _metric.label,
      regime: 'carreaux',
      // Whatever answered, not what the module was compiled believing.
      vintage: _payload?.vintage ?? FILOSOFI_VINTAGE,
      vintageSource: _payload?.source ?? null,
      rampSample: FILOSOFI_RAMP_SAMPLE.cells,
      lastUpdate: _lastUpdate,
      loading: _loading,
      status: _status === 'ready' ? 'ok' : _status,
      stale: Boolean(_payload?.stale),
      feedSource: 'INSEE Filosofi — Licence Ouverte 2.0',
    };
    if (_payload?.truncated) {
      result.degraded = true;
      result.loadingLabel = `${_fr.format(_payload.matched)} carreaux dans la vue,`
        + ` ${_fr.format(_payload.returned)} dessinés — zoome pour les avoir tous`;
    } else if (_status === 'off-coverage') {
      result.status = 'ok';
      result.loadingLabel = 'Hors couverture INSEE (métropole, Martinique, La Réunion)';
    } else if (_loading) {
      result.loadingLabel = 'Carreaux INSEE…';
    }
    if (_error) result.error = _error;
    return result;
  },

  destroy(viewer) {
    if (_enabled) this.disable(viewer);
    else {
      clearSelection();
      if (_clickHandler) { _clickHandler.destroy(); _clickHandler = null; }
      if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeyDown);
      unregisterPickOwner(FILOSOFI_LAYER_ID);
    }
    if (_moveEndRemover) { _moveEndRemover(); _moveEndRemover = null; }
    clearRetry();
    clearPrimitive();
    clearPoints();
    _payload = null;
    _territoryPayload = null;
    _territoryLoadedKey = null;
    _viewer = null;
  },
};

/** Seed drawn state so selection, card and legend paths run without WebGL. */
export function _setFilosofiStateForTest({
  viewer, records, payload, overlayHost, metric, enabled = true,
} = {}) {
  _viewer = viewer || null;
  if (records) _records = records instanceof Map ? records : new Map(Object.entries(records));
  if (payload !== undefined) _payload = payload;
  _overlayHost = overlayHost || DEFAULT_OVERLAY_HOST;
  if (metric) _metric = resolveMetric(metric);
  _enabled = enabled;
  _selectedId = null;
  _status = 'ready';
}

/** @returns {?string} */
export function _filosofiSelectedIdForTest() {
  return _selectedId;
}

export function _selectFilosofiCellForTest(id) {
  return selectCell(id);
}

export function _clearFilosofiSelectionForTest() {
  clearSelection();
}

export function _filosofiRowControlsForTest() {
  return filosofiCarreauxLayer.getRowControls();
}

export function _filosofiStatsForTest() {
  return filosofiCarreauxLayer.getStats();
}

export function _filosofiSetParamsForTest(params) {
  return filosofiCarreauxLayer.setParams(params);
}

export function _filosofiMetricForTest() {
  return _metric;
}

export default filosofiCarreauxLayer;
