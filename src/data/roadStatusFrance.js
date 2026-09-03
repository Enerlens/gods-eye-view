/**
 * @module roadStatusFrance
 *
 * Live road status for France — the State's own sensors on the national
 * network, drawn as coloured segments of the road they measure.
 *
 * WHY THIS LAYER EXISTS ALONGSIDE THE TOMTOM ONE. `traffic.js` already tints
 * roads from TomTom flow tiles, and does it everywhere. But TomTom is
 * bring-your-own-key, quota-governed and not redistributable, so on a keyless
 * build the traffic layer runs a SIMULATION and the globe shows no measured
 * congestion at all. This layer is the measured alternative: keyless, Licence
 * Ouverte 2.0, published by the Directions Interdépartementales des Routes
 * through Bison Futé as DATEX II. It is also the only source in the app that
 * carries a VEHICLE COUNT — a probe-derived jam factor is a ratio, and no
 * amount of it adds up to 1 350 vehicles per hour.
 *
 * WHAT IT DRAWS, AND WHAT EACH THING IS:
 *   - A SEGMENT is one counting station's own extent — start and end pruned
 *     from the national referential — not a point and not a whole motorway.
 *     608 of them, 975 km, measured 2026-09-01, among 1 587 located sites.
 *     589 FOLLOW THE ROAD: the referential publishes two ends and nothing
 *     between, so a segment was a chord — sitting a median 56 m from its own
 *     tarmac and 142 m at p90, which on the Bordeaux rocade cut the inside of
 *     every curve. Each is now drawn along the SURVEYED CENTRE of its own
 *     carriageway (`scripts/lib/rrnCentreline.mjs`, a 26 m-resolution survey
 *     joined by the kilometre posts each of its sections names). A station
 *     published with a start equal to its end is a POINT, not a one-metre
 *     road, and is drawn as the 25 m stub `segmentPositions` gives it.
 *   - Its POSITION is a coordinate the DIR published (844 sites) or one
 *     resolved from the kilometre post the DIR published instead (743 sites,
 *     agreeing with the published ones to a median of 3.8 m where both exist).
 *     The card says which, because they are not the same claim.
 *   - Its COLOUR is the traffic-management centre's own `trafficStatusValue`,
 *     refreshed every 60 s at Bordeaux, Toulouse, Lyon and Limoges and every
 *     360 s at Marseille and Saint-Étienne. It is never derived from the
 *     count: a road with no centre watching it stays grey and says so.
 *   - Its CARD carries flow (veh/h) and average speed, from the separate
 *     six-minute national snapshot. Those two numbers are a SIX-MINUTE
 *     AVERAGE and the card says so; they are not a live speedometer.
 *
 * WHAT IT CANNOT DRAW, AND SAYS SO. Île-de-France has no publisher at all,
 * and Lille and Nancy–Metz publish a live colour for 431 sites whose position
 * nobody publishes and no address recovers. Those are two different kinds of
 * nothing and `roadStatusCoverage.js` keeps them apart, so an empty view over
 * Lille reads "357 states published without a position" rather than looking
 * like a bug. Nantes, Rennes, Saint-Brieuc and Lorient–Vannes were in that
 * sentence until 2026-09-01, when their site identifiers turned out to be
 * point-repère addresses rather than opaque codes.
 *
 * THE COMPLEMENT WORTH KNOWING. This layer is brightest exactly where
 * `transitFrance.js` is dark — Marseille, Toulouse, Lyon, Saint-Étienne
 * publish no live bus and 529 road sites between them — and blind exactly
 * where that layer has its one Parisian shuttle. Neither covers urban France;
 * together they nearly do.
 */
import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import { cachedGroundFloor, warmGroundFloor } from './groundFloor.js';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { powerClassificationTypeForScene, powerClassificationTypeForStack } from './powerGrid.js';
import {
  ROAD_STATUS_LEGEND_ORDER,
  ROAD_STATUS_LEVELS,
  ROAD_STATUS_MAX_BOX_DEG,
  agglomerationLabel,
  formatFlow,
  formatSpeed,
  roadStatusStyle,
} from './datexRoadStatus.js';
import { roadStatusCoverageNotice } from './roadStatusCoverage.js';

const SEGMENTS_URL = '/api/road-status-fr/segments';

/** Layer id — also the share-link registry key and the voice-tool enum value. */
export const ROAD_STATUS_FR_LAYER_ID = 'road-status-fr';
/** Selected-segment card, on its own protected overlay source. */
export const ROAD_STATUS_FR_OVERLAY_SOURCE_ID = 'road-status-fr-selected';
export const ROAD_STATUS_FR_OVERLAY_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 0,
  moving: false,
});

/**
 * Altitude (m) below which the layer loads.
 *
 * Far higher than the transit layer's 300 km, and deliberately: the whole
 * country is 830 segments, so "all of France at once" is a cheap and legible
 * picture rather than a smear. The ceiling exists only because above it the
 * camera rectangle stops being a French bounding box at all.
 */
const ACTIVATION_ALTITUDE_M = 2_000_000;
const ACTIVATION_ENTER_ALTITUDE_M = ACTIVATION_ALTITUDE_M - 100_000;
const ACTIVATION_EXIT_ALTITUDE_M = ACTIVATION_ALTITUDE_M + 100_000;
/** Debounce (ms) on camera-driven reloads. */
const CAMERA_DEBOUNCE_MS = 500;
/** Poll cadence (ms) — matches the fastest agglomeration's own republish rate. */
const POLL_INTERVAL_MS = 60_000;
/** Request timeout (ms). */
const REQUEST_TIMEOUT_MS = 25_000;
/** Alpha the segments are stroked at, over both terrain and photoreal tiles. */
const SEGMENT_ALPHA = 0.92;
/** Colour a selected segment is redrawn in. */
const SELECTED_COLOR = '#7fe3ff';
/** Extra width (px) the selection overlay stroke carries over the base one. */
const SELECTED_WIDTH_BONUS = 4;
/** Metres above the resolved ground floor the selection card is anchored. */
const CARD_LIFT_M = 18;
/** Ground-floor warm budget: enough for a dense agglomeration, not the country. */
const FLOOR_WARM_LIMIT = 240;

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});

/** @type {?Cesium.Viewer} */
let _viewer = null;
let _overlayHost = DEFAULT_OVERLAY_HOST;
let _enabled = false;
/** @type {Map<string, object>} instance id → segment record. */
let _records = new Map();
/** @type {Array<Cesium.GroundPolylinePrimitive>} */
let _primitives = [];
/** @type {?Cesium.GroundPolylinePrimitive} */
let _highlight = null;
/** @type {?string} */
let _selectedId = null;
/** @type {?object} Last `/segments` document. */
let _payload = null;
let _loading = false;
let _error = null;
let _status = 'idle';
let _lastUpdate = null;
let _stale = false;
let _notice = null;
let _altitudeGateOpen = false;
let _classificationType = Cesium.ClassificationType.BOTH;
/** @type {?boolean} `GroundPolylinePrimitive.isSupported`, checked once. */
let _groundLinesSupported = null;
/** @type {?Cesium.ScreenSpaceEventHandler} */
let _clickHandler = null;
let _moveEndRemover = null;
let _mapStackListener = null;
let _debounceTimer = null;
/** @type {?AbortController} */
let _abort = null;
let _lastBoxKey = '';

/**
 * The viewport this layer will ask for, or null when the camera is too high.
 *
 * A view wider than the proxy's own ceiling is not clipped to a smaller
 * centred box — that would show a slice and read as "this is everything" —
 * it returns null and the layer reports its `zoom-in` guidance state, the same
 * contract the transit and power-grid layers use.
 *
 * @param {?Cesium.Viewer} viewer
 * @returns {?{south:number, west:number, north:number, east:number}}
 */
export function roadStatusViewportBox(viewer) {
  const rectangle = viewer?.camera?.computeViewRectangle?.();
  if (!rectangle) return null;
  const south = Cesium.Math.toDegrees(rectangle.south);
  const north = Cesium.Math.toDegrees(rectangle.north);
  const west = Cesium.Math.toDegrees(rectangle.west);
  const east = Cesium.Math.toDegrees(rectangle.east);
  if (![south, west, north, east].every(Number.isFinite)) return null;
  // west > east is an antimeridian-crossing rectangle. France never straddles
  // it, so that is a horizon-scale view: guidance, not a query.
  if (west >= east || south >= north) return null;
  if (north - south > ROAD_STATUS_MAX_BOX_DEG || east - west > ROAD_STATUS_MAX_BOX_DEG) return null;
  return {
    south, west, north, east,
  };
}

/** Stable key so an unchanged viewport does not re-fetch on every camera stop. */
function boxKey(box) {
  if (!box) return '';
  return [box.south, box.west, box.north, box.east].map((v) => v.toFixed(3)).join(',');
}

/** Camera altitude above the ellipsoid, in metres. */
function cameraAltitudeM(viewer) {
  const carto = viewer?.camera?.positionCartographic;
  return Number.isFinite(carto?.height) ? carto.height : Infinity;
}

/** Hysteresis gate so a camera hovering at the ceiling does not thrash. */
function updateAltitudeGate(viewer) {
  const altitude = cameraAltitudeM(viewer);
  if (_altitudeGateOpen) {
    if (altitude > ACTIVATION_EXIT_ALTITUDE_M) _altitudeGateOpen = false;
  } else if (altitude < ACTIVATION_ENTER_ALTITUDE_M) {
    _altitudeGateOpen = true;
  }
  return _altitudeGateOpen;
}

/**
 * Midpoint of a segment, in degrees — where its card is anchored.
 *
 * Taken across the WHOLE vertex list rather than the first pair, because 180
 * segments now thread the kilometre posts of a curving road: anchoring a card
 * to the midpoint of the first hop would pin it near one end of a 5 km bend
 * and point the leader line at the wrong kilometre.
 */
export function segmentMidpoint(coords) {
  if (!Array.isArray(coords) || coords.length < 2) return null;
  if (coords.length < 4) return { lon: coords[0], lat: coords[1] };
  const vertices = coords.length / 2;
  const half = Math.floor(vertices / 2);
  if (vertices % 2) return { lon: coords[half * 2], lat: coords[half * 2 + 1] };
  const a = (half - 1) * 2;
  return {
    lon: (coords[a] + coords[a + 2]) / 2,
    lat: (coords[a + 1] + coords[a + 3]) / 2,
  };
}

/**
 * Ground-clamped positions for one segment.
 *
 * A one-point site — a station whose referential row carries a start and no
 * end, 2 of 832 on 2026-08-31 — is drawn as a short stub along the meridian
 * rather than skipped, because a measured road with a known position is worth
 * showing. The stub length is deliberately tiny (25 m) so it never implies a
 * direction or an extent the source did not give.
 */
function segmentPositions(coords) {
  if (!Array.isArray(coords) || coords.length < 2) return null;
  if (coords.length >= 4) return Cesium.Cartesian3.fromDegreesArray(coords);
  const [lon, lat] = coords;
  const stubDeg = 0.000225; // ~25 m of latitude
  return Cesium.Cartesian3.fromDegreesArray([lon, lat - stubDeg, lon, lat + stubDeg]);
}

/** Drop every drawn batch. */
function clearPrimitives() {
  for (const primitive of _primitives) {
    _viewer?.scene?.groundPrimitives?.remove?.(primitive);
  }
  _primitives = [];
  clearHighlight();
}

function clearHighlight() {
  if (_highlight) {
    _viewer?.scene?.groundPrimitives?.remove?.(_highlight);
    _highlight = null;
  }
}

/**
 * Rebuild the clamped ground strokes for one loaded viewport.
 *
 * ONE BATCH for every segment at every status. Colour AND width both travel
 * per geometry instance — `GroundPolylineGeometry` bakes its own width and
 * `PolylineColorAppearance` reads a per-instance colour attribute — so there
 * is no reason to split by state the way the power grid has to split by
 * material. A dense agglomeration is ~190 segments and that is one draw call.
 *
 * @param {object} payload `/api/road-status-fr/segments` document.
 */
function buildSegments(payload) {
  clearPrimitives();
  _records = new Map();
  if (!_viewer) return;
  if (_groundLinesSupported === null) {
    _groundLinesSupported = Cesium.GroundPolylinePrimitive.isSupported(_viewer.scene);
    if (!_groundLinesSupported) {
      console.warn('[Data:Road Status FR] GroundPolylinePrimitive unsupported — segments disabled');
    }
  }
  if (!_groundLinesSupported) return;

  const segments = Array.isArray(payload?.segments) ? payload.segments : [];
  const instances = [];
  const warm = [];
  for (const segment of segments) {
    const positions = segmentPositions(segment?.c);
    if (!positions) continue;
    const style = roadStatusStyle(segment.s);
    const id = `road-status-fr:${segment.id}`;
    instances.push(new Cesium.GeometryInstance({
      id,
      geometry: new Cesium.GroundPolylineGeometry({ positions, width: style.widthPx }),
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(
          Cesium.Color.fromCssColorString(style.color).withAlpha(SEGMENT_ALPHA),
        ),
      },
    }));
    const midpoint = segmentMidpoint(segment.c);
    _records.set(id, { id, segment, midpoint });
    if (midpoint && warm.length < FLOOR_WARM_LIMIT) warm.push(midpoint);
  }

  if (instances.length) {
    const primitive = _viewer.scene.groundPrimitives.add(new Cesium.GroundPolylinePrimitive({
      geometryInstances: instances,
      classificationType: _classificationType,
      appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
    }));
    primitive.show = _enabled;
    _primitives.push(primitive);
  }
  if (warm.length) warmGroundFloor(warm);
}

/** Re-classify against the active surface, rebuilding the baked batches. */
function applyClassification(next) {
  if (next === undefined || next === _classificationType) return;
  _classificationType = next;
  if (_payload) buildSegments(_payload);
  _viewer?.scene?.requestRender?.();
}

/** Cartesian anchor for a segment's card, on the shared coarse ground floor. */
function cardPosition(record) {
  const midpoint = record?.midpoint;
  if (!midpoint) return null;
  const floor = cachedGroundFloor(midpoint.lat, midpoint.lon);
  return Cesium.Cartesian3.fromDegrees(
    midpoint.lon,
    midpoint.lat,
    (Number.isFinite(floor) ? floor : 0) + CARD_LIFT_M,
  );
}

/**
 * Build the card copy for a selected segment.
 *
 * Every line is a value a publisher sent. Flow and speed are labelled with the
 * six-minute window they are averaged over rather than printed bare, because
 * "88 km/h" next to a live-looking colour would read as an instantaneous
 * speed, and it is not one. A station that reported no vehicle in the window
 * prints neither number — its zero speed means "nothing passed", not
 * "stationary traffic".
 *
 * @param {object} record Render record.
 * @param {object} [payload] The document the record came from.
 * @returns {string} Newline-separated card copy.
 */
export function buildRoadStatusSelectionLabel(record, payload = null) {
  const segment = record?.segment || {};
  const style = roadStatusStyle(segment.s);
  const axis = segment.a || 'Voie sans nom';
  const details = [];

  details.push(`● ${style.label}`);

  const flow = formatFlow(segment.f);
  const speed = formatSpeed(segment.v, segment.f);
  if (segment.f === 0) {
    // Checked BEFORE the formatted pair, because "0 veh/h" is a true sentence
    // that reads like a broken sensor. It is neither: 114 of 1 192 stations
    // counted nothing at 22:30, and that is a fact about the hour.
    details.push('aucun véhicule compté sur la dernière fenêtre de 6 min');
  } else if (flow || speed) {
    details.push(`${[flow, speed].filter(Boolean).join(' · ')} (moyenne sur 6 min)`);
  }

  const reporters = Array.isArray(segment.src) ? segment.src.map(agglomerationLabel) : [];
  if (reporters.length) details.push(`⌖ ${reporters.join(' · ')}`);
  if (segment.d) details.push(`Exploitant ${segment.d}`);
  // Where the dot on the globe comes from. A published coordinate needs no
  // sentence; one this app resolved from a kilometre post does, because the
  // reader is entitled to know the position is derived and to how much.
  if (segment.g === 'pr') details.push('position déduite de son point de repère (PR), médiane 4 m');
  if (segment.at) {
    const age = Math.max(0, Math.round((Date.now() - new Date(segment.at).getTime()) / 1000));
    details.push(`état relevé il y a ${age} s`);
  } else if (payload?.flow?.windowEnd) {
    details.push('état non communiqué pour ce site');
  }
  details.push('Bison Futé / DIR — Licence Ouverte 2.0');

  return [`${axis} · ${segment.id}`, ...details].join('\n');
}

/**
 * Overlay entry for the selected segment.
 * @param {object} record Render record.
 * @param {object} [payload] Document the record came from.
 * @returns {?object}
 */
export function createRoadStatusSelectedOverlayEntry(record, payload = null) {
  const position = cardPosition(record);
  if (!record?.id || !position) return null;
  const [title, ...details] = buildRoadStatusSelectionLabel(record, payload).split('\n');
  return {
    id: String(record.id),
    position,
    variant: 'selected',
    selected: true,
    protected: true,
    paintLane: 'selected',
    collisionGroup: 'ambient-card',
    priority: Number.MAX_SAFE_INTEGER,
    title,
    details,
    accent: SELECTED_COLOR,
    interactive: false,
    anchorRadiusPx: 10,
    minAnchorGapPx: 12,
    verticalOnly: true,
    placement: 'above',
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
  };
}

function selectSegment(id) {
  clearSelection();
  const record = _records.get(id);
  if (!record || !_viewer) return;
  _selectedId = id;
  const positions = segmentPositions(record.segment?.c);
  if (positions) {
    // A batched instance cannot be restyled without rebuilding the batch, so
    // the selection is a SECOND stroke drawn over the first, wider and in the
    // selection colour — the same technique the power grid uses on its ways.
    const style = roadStatusStyle(record.segment?.s);
    _highlight = _viewer.scene.groundPrimitives.add(new Cesium.GroundPolylinePrimitive({
      geometryInstances: new Cesium.GeometryInstance({
        geometry: new Cesium.GroundPolylineGeometry({
          positions,
          width: style.widthPx + SELECTED_WIDTH_BONUS,
        }),
        attributes: {
          color: Cesium.ColorGeometryInstanceAttribute.fromColor(
            Cesium.Color.fromCssColorString(SELECTED_COLOR).withAlpha(0.55),
          ),
        },
      }),
      classificationType: _classificationType,
      appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
    }));
  }
  const entry = createRoadStatusSelectedOverlayEntry(record, _payload);
  if (entry) {
    _overlayHost.setEntries(
      ROAD_STATUS_FR_OVERLAY_SOURCE_ID,
      [entry],
      ROAD_STATUS_FR_OVERLAY_SOURCE_OPTIONS,
    );
  }
  governorRequestRender('road-status-fr-select');
}

function clearSelection() {
  clearHighlight();
  if (_selectedId) {
    _selectedId = null;
    _overlayHost.clearSource(ROAD_STATUS_FR_OVERLAY_SOURCE_ID);
    governorRequestRender('road-status-fr-deselect');
  }
}

function onKeyDown(event) {
  if (event.key === 'Escape' && _selectedId) clearSelection();
}

function installClickHandler(viewer) {
  if (_clickHandler) return;
  _clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  _clickHandler.setInputAction((click) => {
    const picked = viewer.scene.pick(click.position);
    // A batched GroundPolylinePrimitive reports the GeometryInstance id.
    if (typeof picked?.id === 'string' && _records.has(picked.id)) {
      selectSegment(picked.id);
      return;
    }
    if (_selectedId) clearSelection();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  document.addEventListener('keydown', onKeyDown);
}

function scheduleLoad() {
  clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(() => { void load(); }, CAMERA_DEBOUNCE_MS);
}

/** Fetch and draw the current viewport. */
async function load({ force = false } = {}) {
  if (!_enabled || !_viewer) return false;
  if (!updateAltitudeGate(_viewer)) {
    _status = 'zoom-in';
    _notice = null;
    return false;
  }
  const box = roadStatusViewportBox(_viewer);
  if (!box) {
    _status = 'zoom-in';
    _notice = null;
    return false;
  }
  const key = boxKey(box);
  if (!force && key === _lastBoxKey && _payload) return false;

  _abort?.abort();
  _abort = new AbortController();
  const controller = _abort;
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  _loading = true;
  _error = null;
  try {
    const query = new URLSearchParams({
      south: String(box.south),
      west: String(box.west),
      north: String(box.north),
      east: String(box.east),
    });
    const response = await fetch(`${SEGMENTS_URL}?${query}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (!_enabled || controller.signal.aborted) return false;
    _payload = payload;
    _lastBoxKey = key;
    _lastUpdate = payload.retrievedAt ? new Date(payload.retrievedAt) : new Date();
    _stale = Boolean(payload.stale);
    _status = payload.status === 'ready' ? 'ready' : payload.status || 'ready';
    _notice = roadStatusCoverageNotice(box, { segments: payload.segments?.length || 0 });
    if (_notice) _status = 'empty';
    // The selection survives a refresh only if the same station is still in
    // view; otherwise the card would keep describing a road nobody is looking
    // at, with a reading from a box that is no longer the box.
    const previousSelection = _selectedId;
    buildSegments(payload);
    if (previousSelection && _records.has(previousSelection)) selectSegment(previousSelection);
    else clearSelection();
    governorRequestRender('road-status-fr-load');
    return true;
  } catch (error) {
    if (error?.name === 'AbortError') return false;
    _error = String(error?.message || error);
    _status = 'degraded';
    console.warn('[Data:Road Status FR]', _error);
    return false;
  } finally {
    clearTimeout(timer);
    if (_abort === controller) _abort = null;
    _loading = false;
  }
}

const roadStatusFranceLayer = {
  id: ROAD_STATUS_FR_LAYER_ID,
  name: 'Road Status FR',
  icon: '🛣',
  source: 'Bison Futé / DIR (DATEX II)',
  updateInterval: POLL_INTERVAL_MS,

  init(viewer) {
    _viewer = viewer;
    _enabled = false;
    _records = new Map();
    _primitives = [];
    _highlight = null;
    _selectedId = null;
    _payload = null;
    _loading = false;
    _error = null;
    _status = 'idle';
    _lastUpdate = null;
    _stale = false;
    _notice = null;
    _altitudeGateOpen = false;
    _lastBoxKey = '';
    _classificationType = powerClassificationTypeForScene(viewer?.scene);

    if (typeof window !== 'undefined' && !_mapStackListener) {
      _mapStackListener = (event) => {
        applyClassification(event?.detail?.activeId !== undefined
          ? powerClassificationTypeForStack(event.detail.activeId)
          : powerClassificationTypeForScene(_viewer?.scene));
      };
      window.addEventListener('gev:map-stack-changed', _mapStackListener);
    }

    _overlayHost.setVisible(ROAD_STATUS_FR_OVERLAY_SOURCE_ID, false);
    console.log('[Data:Road Status FR] Initialized');
  },

  enable(viewer) {
    _enabled = true;
    _error = null;
    for (const primitive of _primitives) primitive.show = true;
    // The boot-time stack settle fires no event, so re-derive on every enable
    // rather than trusting whatever the last event left behind.
    applyClassification(powerClassificationTypeForScene(viewer?.scene || _viewer?.scene));
    _overlayHost.setVisible(ROAD_STATUS_FR_OVERLAY_SOURCE_ID, true);
    installClickHandler(viewer);
    registerPickOwner(ROAD_STATUS_FR_LAYER_ID, (pickedId) => _records.has(pickedId));
    if (!_moveEndRemover) {
      _moveEndRemover = viewer.camera.moveEnd.addEventListener(scheduleLoad);
    }
    // DataLayerManager calls update() immediately after enable(), which owns
    // the first fetch. Avoid racing it with a second aborting request here.
  },

  disable() {
    _enabled = false;
    clearSelection();
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
    _abort?.abort();
    _abort = null;
    for (const primitive of _primitives) primitive.show = false;
    _overlayHost.setVisible(ROAD_STATUS_FR_OVERLAY_SOURCE_ID, false);
    if (_clickHandler) {
      _clickHandler.destroy();
      _clickHandler = null;
    }
    if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeyDown);
    unregisterPickOwner(ROAD_STATUS_FR_LAYER_ID);
    if (_moveEndRemover) {
      _moveEndRemover();
      _moveEndRemover = null;
    }
    _loading = false;
    _status = 'idle';
  },

  async update() {
    if (!_enabled) return false;
    // `load()` answers "did I fetch", which is false at the altitude gate and
    // on an unchanged viewport. Neither is a refusal of the lifecycle
    // transition, and `DataLayerManager` reads a literal `false` from update()
    // as exactly that — it would fail the enable and leave the layer switched
    // off with no visible reason. Only a disabled layer refuses here.
    await load({ force: true });
    return true;
  },

  getStats() {
    const stats = {
      count: _records.size,
      lastUpdate: _lastUpdate,
      loading: _loading,
      status: _status === 'ready' ? 'ok' : _status,
      stale: _stale,
      // The layer's own honesty numbers, surfaced rather than buried: how much
      // of the country publishes a position at all, and how much of what is on
      // screen carries a measured count.
      nationalSegments: _payload?.nationalSegments ?? null,
      sitesLocated: _payload?.sitesLocated ?? null,
      sitesUnlocated: _payload?.sitesUnlocated ?? null,
      sitesFromPointRepere: _payload?.sitesFromPointRepere ?? null,
      lengthKm: _payload?.lengthKm ?? null,
      feedsFailed: _payload?.feedsFailed ?? null,
      flowWindowEnd: _payload?.flow?.windowEnd ?? null,
    };
    if (_notice) stats.notice = _notice.text;
    if (_error) stats.error = _error;
    // Same phrasing as the other viewport-gated layers (`bdtopoBuildings`,
    // `filosofiFeed`): the threshold is named, and the prompt uses the
    // tutoiement those layers settled on rather than the vouvoiement two
    // others use.
    if (_status === 'zoom-in') stats.loadingLabel = `Zoome sous ${ROAD_STATUS_MAX_BOX_DEG}° pour charger l’état du réseau`;
    return stats;
  },

  /**
   * What actually reached the scene, for `scripts/qa-road-status-fr.mjs`.
   *
   * Cesium releases a primitive's geometry instances once it is built
   * (`releaseGeometryInstances` defaults to true), so the instance count is
   * recorded at build time and the mutable fields are read LIVE off the
   * primitive — the only way a browser harness can tell "830 segments were
   * drawn" from "830 segments were computed and never added".
   *
   * @returns {{batches: Array<object>, records: number, statuses: object}}
   */
  getRenderDiagnostics() {
    const statuses = {};
    for (const record of _records.values()) {
      const key = record.segment?.s || 'unknown';
      statuses[key] = (statuses[key] || 0) + 1;
    }
    return {
      records: _records.size,
      statuses,
      batches: _primitives.map((primitive) => ({
        show: Boolean(primitive.show),
        ready: Boolean(primitive.ready),
        classificationType: String(primitive.classificationType ?? ''),
      })),
      highlighted: Boolean(_highlight),
      selectedId: _selectedId,
    };
  },

  /** Feed provenance for the attribution popover. */
  getFeedSummaries() {
    const feeds = Array.isArray(_payload?.feeds) ? _payload.feeds : [];
    return feeds.map((feed) => ({
      id: feed.directory,
      network: feed.label,
      licence: _payload?.licence || null,
      publisher: 'Bison Futé / DIR',
      inView: feed.drawable,
      reported: feed.sites,
      retrievedAt: feed.publishedAt,
      error: feed.error || null,
    }));
  },

  /**
   * Colour legend for the control-panel row.
   *
   * Tallied over the segments actually on screen, in severity order rather
   * than by count: a legend whose rows reshuffle as three cars clear a ramp is
   * a legend nobody can read. States with nothing in view are omitted, except
   * `Not reported`, which is kept whenever it has members because "grey means
   * nobody is watching this road" is the one entry a viewer has to be told.
   *
   * @returns {{ chips: Array<object>, legend: Array<object> }}
   */
  getRowControls() {
    const counts = _payload?.counts || {};
    const legend = [];
    for (const key of ROAD_STATUS_LEGEND_ORDER) {
      const count = counts[key] || 0;
      if (!count) continue;
      const level = ROAD_STATUS_LEVELS[key];
      legend.push({
        label: level.label,
        color: level.color,
        count,
        blurb: key === 'unknown'
          ? 'The station is located and measured, but no traffic-management centre publishes a state for it.'
          : `Published by the operating DIR as DATEX II \`${key}\`, refreshed every 60–360 s.`,
      });
    }
    return { chips: [], legend };
  },

  destroy(viewer) {
    if (_enabled) this.disable(viewer);
    else {
      clearSelection();
      if (_clickHandler) {
        _clickHandler.destroy();
        _clickHandler = null;
      }
      if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeyDown);
      unregisterPickOwner(ROAD_STATUS_FR_LAYER_ID);
    }
    if (typeof window !== 'undefined' && _mapStackListener) {
      window.removeEventListener('gev:map-stack-changed', _mapStackListener);
      _mapStackListener = null;
    }
    if (_moveEndRemover) {
      _moveEndRemover();
      _moveEndRemover = null;
    }
    clearPrimitives();
    _records.clear();
    _payload = null;
    _viewer = null;
  },
};

/** Seed rendered records so selection/card/legend paths run without WebGL. */
export function _setRoadStatusStateForTest({
  viewer, records, payload, overlayHost, enabled = true,
} = {}) {
  _viewer = viewer || null;
  if (records) _records = records instanceof Map ? records : new Map(Object.entries(records));
  if (payload !== undefined) _payload = payload;
  _overlayHost = overlayHost || DEFAULT_OVERLAY_HOST;
  _enabled = enabled;
  _selectedId = null;
  _status = 'ready';
  _notice = null;
}

/** @returns {?string} */
export function _roadStatusSelectedIdForTest() {
  return _selectedId;
}

export function _roadStatusRowControlsForTest() {
  return roadStatusFranceLayer.getRowControls();
}

export function _roadStatusStatsForTest() {
  return roadStatusFranceLayer.getStats();
}

export function _setRoadStatusNoticeForTest(notice) {
  _notice = notice;
  if (notice) _status = 'empty';
}

export default roadStatusFranceLayer;
