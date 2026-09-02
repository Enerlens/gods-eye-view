import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { boxKey, snapBoxOutward } from './viewportBox.js';
import { applyViewGate } from './viewGate.js';
import {
  FILOSOFI_METRICS,
  FILOSOFI_RAMPS,
  FILOSOFI_RAMP_SAMPLE,
  FILOSOFI_VINTAGE,
  cellCentre,
  cellColor,
  cellCorners,
  cellHeightM,
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
 * TWO CHANNELS, AND THE HEIGHT IS NOT THE INDICATOR. Colour carries the chosen
 * indicator; height carries the COUNT that indicator was computed on. That is
 * the whole design and it is a correctness decision, not a style one: a stack
 * of "27 100 € per person" has no volume, and the eye reads volume as quantity.
 * A block whose volume is its population is a true statement; the same block
 * scaled by an average is a picture of nothing. The consequence is on screen
 * and on every card — a brilliantly coloured square one pixel tall is four
 * households, and switching indicators recolours the city without relaying it.
 *
 * THE PERFORATED SQUARES ARE IMPUTED. INSEE publishes a flag meaning "this
 * cell's figures were modelled, because publishing the observation would have
 * broken confidentiality". In the 80 105-cell national sample the ramps were
 * measured on, 39 % of cells carry it. Drawing those identically to observed
 * cells would be drawing a model and calling it a census, so they are drawn as
 * a smaller square inside their own footprint — the grid visibly loses its
 * mortar where the data is inferred — and the legend says so.
 *
 * THE BREAKS ARE NATIONAL AND ABSOLUTE. A viewport-relative ramp would make
 * Neuilly and Roubaix the same picture, which is the opposite of the point.
 * `filosofiFeed.js` carries the measurement: population-weighted quantiles over
 * a 42-box national sample, so a colour means the same thing wherever the
 * camera is.
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
 * Widest view that still draws squares, in degrees of latitude.
 *
 * Beyond this the 1 km grid hits its row ceiling and the map becomes a SAMPLE
 * of the country wearing the clothes of a picture of it. Refusing is the
 * honest answer, and `ensureViewGate` flies the camera in rather than leaving
 * the operator to guess how far.
 */
export const FILOSOFI_MAX_BOX_DEG = 0.9;

/** Where the carroyage exists. Outside these, every request is a certain zero. */
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

/**
 * How much of its own footprint an imputed cell keeps.
 *
 * 0.6 rather than something subtler: at 200 m and a city-wide zoom a cell is a
 * few pixels across, and a 10 % inset is invisible. At 0.6 the grid reads as
 * perforated at every altitude the layer draws at.
 */
const IMPUTED_INSET = 0.6;

/** Selection accent, matching the app's other selected-object cards. */
const SELECTED_COLOR = '#00ffff';

/** Reused so a 6 000-cell payload does not mint 6 000 Cartographics. */
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
  if (!filosofiCoverageIntersects(box)) return { box: null, reason: 'off-coverage' };
  if (filosofiBoxTooWide(box)) return { box: null, reason: 'too-wide' };
  return { box, reason: null };
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
 * The corners a cell is drawn with — its own, or an inset square when the
 * figures were imputed.
 *
 * The inset is applied in EPSG:3035 metres, BEFORE the projection, so the
 * smaller square is concentric with the real one at every latitude. Insetting
 * after projection would shear it, because a LAEA square is not axis-aligned
 * in WGS84.
 *
 * @param {object} cell
 * @param {number} resolution
 * @returns {Array<[number, number]>}
 */
export function drawnCorners(cell, resolution) {
  if (cell.est !== 1) return cellCorners({ res: resolution, n: cell.n, e: cell.e });
  const inset = (resolution * (1 - IMPUTED_INSET)) / 2;
  return cellCorners({
    res: resolution * IMPUTED_INSET,
    n: cell.n + inset,
    e: cell.e + inset,
  });
}

/** A stable, human-readable id for one drawn cell. */
export function cellId(cell, resolution) {
  return `filosofi:${resolution}:${cell.n}:${cell.e}`;
}

function clearPrimitive() {
  if (_primitive && _viewer?.scene) _viewer.scene.primitives.remove(_primitive);
  _primitive = null;
  _records = new Map();
  _selectedId = null;
}

/**
 * The base every square stands on.
 *
 * Terrain under a city is not flat — Fourvière is 130 m above the Rhône — and a
 * grid drawn on the ellipsoid would bury half of Lyon. Sampled per cell where
 * the globe can answer, falling back to the viewport's own first answer so a
 * cold tile does not drop a square to sea level next to its neighbours.
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
    const height = cellHeightM(cell, _metric, { resolution });
    if (height <= 0) continue;
    const [lon, lat] = cellCentre({ res: resolution, n: cell.n, e: cell.e });
    let baseM = renderedGroundM(lat, lon);
    if (baseM === null) {
      coldGround += 1;
      baseM = fallbackM ?? 0;
    } else if (fallbackM === null) {
      fallbackM = baseM;
    }
    const color = cellColor(cell, _metric);
    if (!color) continue;
    records.push({
      id: cellId(cell, resolution),
      cell,
      resolution,
      color,
      heightM: height,
      baseM,
      lon,
      lat,
      corners: drawnCorners(cell, resolution),
      position: Cesium.Cartesian3.fromDegrees(lon, lat, baseM + height),
    });
  }
  return { records, coldGround };
}

/** Build one batched primitive for the whole viewport. */
function drawRecords(records) {
  clearPrimitive();
  if (!records.length || !_viewer) return;

  const instances = [];
  for (const record of records) {
    _records.set(record.id, record);
    const degrees = [];
    for (const [lon, lat] of record.corners) degrees.push(lon, lat);
    instances.push(new Cesium.GeometryInstance({
      id: record.id,
      geometry: new Cesium.PolygonGeometry({
        polygonHierarchy: new Cesium.PolygonHierarchy(
          Cesium.Cartesian3.fromDegreesArray(degrees),
        ),
        height: record.baseM,
        extrudedHeight: record.baseM + record.heightM,
        vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
        closeTop: true,
        closeBottom: false,
      }),
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(instanceColor(record)),
      },
    }));
  }

  _primitive = new Cesium.Primitive({
    geometryInstances: instances,
    // Lit rather than flat, for the same reason the building layer is: without
    // normals a field of one-colour boxes reads as a single mass and the shape
    // — which is half the information — disappears.
    appearance: new Cesium.PerInstanceColorAppearance({ closed: false, translucent: false }),
    asynchronous: true,
    releaseGeometryInstances: false,
  });
  _primitive.show = _enabled;
  _viewer.scene.primitives.add(_primitive);
  governorRequestRender('filosofi-fr');
}

/**
 * A cell's drawn colour: its band, darkened towards the ground.
 *
 * Opaque, always. An alpha below 1 moves the geometry into Cesium's translucent
 * pass, which does not write depth, and the grid then renders as one sheet with
 * everything showing through everything.
 *
 * The brightness carries HEIGHT because the band does not carry enough: a
 * quartier is usually one band wide, so two neighbours almost always share a
 * hue and with no outline between them a whole arrondissement reads as one
 * polygon. Population varies between adjacent squares and is the channel that
 * separates them.
 *
 * @param {object} record
 * @returns {Cesium.Color}
 */
export function instanceColor(record) {
  const base = Cesium.Color.fromCssColorString(record.color);
  const t = Math.min(Math.max(record.heightM / 120, 0), 1);
  return base.darken(0.35 * (1 - t), new Cesium.Color());
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
 * The card for one selected square.
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

  details.push(cell.est === 1
    // The one line that must never be dropped.
    ? 'Carreau IMPUTÉ : valeurs approchées, pas observées (secret statistique)'
    : 'Carreau observé, non imputé');
  details.push(`Carreau ${side} · revenus ${FILOSOFI_VINTAGE} · INSEE Filosofi`);
  // Height is the count, not the indicator — stated on the card because it is
  // the one thing a viewer cannot read off the picture.
  details.push(`Hauteur = ${_metric.weight === 'men' ? 'ménages' : 'habitants'}, couleur = ${_metric.label.toLowerCase()}`);

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
  applyInstanceColor(id, Cesium.Color.fromCssColorString(SELECTED_COLOR));
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
    const id = resolveFilosofiPickId(picked);
    if (id) { selectCell(id); return; }
    if (!picked && _selectedId) clearSelection();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  if (typeof document !== 'undefined') document.addEventListener('keydown', onKeyDown);
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

  const { box, reason } = filosofiViewportBox(_viewer);
  if (!box) {
    clearPrimitive();
    _payload = null;
    _loadedKey = null;
    _error = null;
    _status = reason === 'too-wide' ? 'zoom-in' : (reason === 'off-coverage' ? 'off-coverage' : 'idle');
    governorRequestRender('filosofi-clear');
    return false;
  }

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
 * Not a refetch: the same 146 squares carry every indicator at once, and the
 * only thing that changed is which column drives the colour and which count
 * drives the height. Asking the proxy again would buy the same bytes twice.
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
 * The six bands, with the break that opens each and how many cells are in it.
 *
 * The break VALUES are on the legend rather than "faible / élevé", because the
 * whole claim of an absolute ramp is that the numbers travel with it.
 *
 * @param {object} metric
 * @param {Array<object>} cells
 * @returns {Array<object>}
 */
export function filosofiLegend(metric, cells = []) {
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
    _overlayHost.setVisible(FILOSOFI_SELECTED_OVERLAY_SOURCE_ID, false);
    console.log('[Data:Carroyage INSEE] Initialized');
  },

  enable(viewer) {
    _enabled = true;
    _error = null;
    if (viewer) _viewer = viewer;
    if (_primitive) _primitive.show = true;
    _overlayHost.setVisible(FILOSOFI_SELECTED_OVERLAY_SOURCE_ID, true);
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
    _overlayHost.setVisible(FILOSOFI_SELECTED_OVERLAY_SOURCE_ID, false);
    if (_clickHandler) { _clickHandler.destroy(); _clickHandler = null; }
    if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeyDown);
    unregisterPickOwner(FILOSOFI_LAYER_ID);
    if (_moveEndRemover) { _moveEndRemover(); _moveEndRemover = null; }
    _loading = false;
    _status = 'idle';
  },

  /**
   * Bring the camera inside the box this layer draws at.
   * @param {?Cesium.Viewer} viewer
   * @param {{signal?: ?AbortSignal}} [options]
   * @returns {Promise<boolean>}
   */
  async ensureViewGate(viewer, { signal } = {}) {
    const target = viewer || _viewer;
    if (!target) return false;
    const { box, reason } = filosofiViewportBox(target);
    if (reason !== 'too-wide') return Boolean(box);
    return applyViewGate(target, {
      fits: () => Boolean(filosofiViewportBox(target).box),
      maxDeg: FILOSOFI_MAX_BOX_DEG,
      coverage: FILOSOFI_COVERAGE,
      signal,
      reason: 'filosofi-view-gate',
    });
  },

  async update() {
    if (!_enabled) return false;
    _loadedKey = null;
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
    const next = resolveMetric(params.metric);
    if (next.id === _metric.id) return false;
    _metric = next;
    redrawForMetric();
    governorRequestRender('filosofi-metric');
    return true;
  },

  /**
   * The runtime state a share link has to carry.
   *
   * Without this the manager has nothing to serialize and `lo=` comes back
   * empty: the link would restore the carroyage coloured by niveau de vie
   * whatever the sender was looking at, which is a different map with the same
   * squares. Measured in `scripts/qa-filosofi.mjs`, which reads the hash.
   * @returns {{metric: string}}
   */
  getParams() {
    return { metric: _metric.id };
  },

  /**
   * A square is not a contact. Nothing here moves, and a detection reticle over
   * every carreau in Paris would drown every layer that does.
   * @returns {Array}
   */
  getDetectableObjects() {
    return [];
  },

  getRowControls() {
    const cells = _payload?.cells || [];
    const chips = FILOSOFI_METRICS.map((metric) => ({
      id: metric.id,
      label: metric.short,
      active: _metric.id === metric.id,
      state: _metric.id === metric.id ? 'active' : 'idle',
      title: `${metric.label} — ${metric.blurb} (${metric.unit})`,
      params: { metric: metric.id },
    }));
    return { chips, legend: filosofiLegend(_metric, cells) };
  },

  getStats() {
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
      truncated: Boolean(_payload?.truncated),
      matched: _payload?.matched ?? null,
      metric: _metric.id,
      metricLabel: _metric.label,
      vintage: FILOSOFI_VINTAGE,
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
    } else if (_status === 'zoom-in') {
      result.status = 'ok';
      result.loadingLabel = `Zoome sous ${FILOSOFI_MAX_BOX_DEG}° pour charger le carroyage`;
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
    _payload = null;
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
