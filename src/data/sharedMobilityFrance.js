/**
 * @module sharedMobilityFrance
 *
 * French shared mobility — the bikes, e-bikes, scooters, mopeds and shared
 * cars waiting to be picked up, from the GBFS feeds published on the Point
 * d'Accès National (`transport.data.gouv.fr`).
 *
 * WHAT THIS IS, AND WHAT IT IS NOT. This is an INVENTORY, not a track. The
 * GBFS spec is explicit: *"Vehicles that are part of an active rental MUST NOT
 * appear in this feed."* A vehicle being ridden is invisible — it disappears
 * when unlocked and reappears wherever it is parked. So nothing here glides
 * the way a bus does in `transitFrance.js`; the fleet BLINKS, and pretending
 * otherwise by interpolating between two sightings would be inventing a
 * journey that the feed deliberately does not publish.
 *
 * HOW IT AVOIDS DRAWING THE SAME THING TWICE. Three separate redundancies are
 * resolved before a point reaches the screen, all of them measured rather than
 * assumed (see `gbfsFeeds.js` and `scripts/build-gbfs-fr-index.mjs`):
 *
 *   1. The catalog lists one system many times — 165 resources, 135 distinct
 *      systems. Duplicates are identified by the SET OF PLACES a system
 *      reports, which survives different URLs, hosts and GBFS versions.
 *   2. Four systems are already drawn by `bikeshare.js` (Vélib', Vélo'v,
 *      vélÔToulouse, Le Vélo TBM) and are excluded here rather than doubled.
 *   3. Free-floating operators republish the city's own parking bays as their
 *      "stations" — 26,259 rows over Paris alone, near-identical between
 *      operators. Those are not drawn per operator; the fleet is.
 *
 * FRESHNESS IS UNEVEN AND SAID SO. Measured 2026-08-26: Lime republishes every
 * ~50 s, Dott's median fix is 8 minutes old with a tail past 2 hours. The card
 * prints the age of the vehicle's own last report, never the age of the poll.
 */
import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import { registerSpriteCollection, restoreSpriteOrder, unregisterSpriteCollection } from './spriteOrder.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import { cachedGroundFloor, warmGroundFloor } from './groundFloor.js';
import { horizonOccluder } from './iconOrientation.js';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { GBFS_MAX_BOX_DEG, VEHICLE_KIND_LABELS } from './gbfsFeeds.js';

/** Layer id — also the share-link registry key and the voice-tool enum value. */
export const SHARED_MOBILITY_FR_LAYER_ID = 'shared-mobility-fr';
/** Protected selected-object card source on the shared world-overlay host. */
export const SHARED_MOBILITY_FR_OVERLAY_SOURCE_ID = 'shared-mobility-fr-selected';
export const SHARED_MOBILITY_FR_OVERLAY_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 0,
  moving: false,
});

// --- Activation / load gating ----------------------------------------------
/**
 * Altitude (m) below which the layer loads. A parked scooter is a street-scale
 * object: above this it is a sub-pixel speck and the request would stop being
 * a viewport query.
 */
const ACTIVATION_ALTITUDE_M = 80_000;
const ACTIVATION_ENTER_ALTITUDE_M = ACTIVATION_ALTITUDE_M - 4_000;
const ACTIVATION_EXIT_ALTITUDE_M = ACTIVATION_ALTITUDE_M + 4_000;
/** Debounce (ms) on camera-driven viewport reloads. */
const CAMERA_DEBOUNCE_MS = 450;
/**
 * Poll cadence (ms). Slower than the transit layer on purpose: an inventory
 * changes when someone rents or returns something — measured at ~1% of a
 * 6,700-bike fleet per two minutes — and several operators publish data that
 * is already minutes old.
 */
const POLL_INTERVAL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 30_000;
/** Hard cap on rendered points, independent of what the proxy returns. */
const MAX_RENDERED_OBJECTS = 6_000;
/** Metres above the resolved ground floor a point sits. */
const POINT_LIFT_M = 2.5;

// --- Presentation -----------------------------------------------------------
const VEHICLE_POINT_PX = 6;
const STATION_POINT_MIN_PX = 5;
const STATION_POINT_MAX_PX = 13;
const SELECTED_POINT_PX = 16;

/**
 * Per-kind tint. Deliberately a cool/green family so shared mobility reads as
 * a different class from the warm amber of live transit vehicles, which can be
 * on screen at the same time in the same street.
 */
const KIND_COLORS = Object.freeze({
  bike: '#5bd6a0',
  ebike: '#31c7e8',
  scooter: '#a78bfa',
  moped: '#f472b6',
  car: '#facc15',
  other: '#94a3b8',
  station: '#38bdf8',
});
const SELECTED_COLOR = '#00ffff';
const OUTLINE_COLOR = Cesium.Color.BLACK.withAlpha(0.3);

/** Station fill-rate palette, matching the bikeshare layer's reading. */
const STATION_FULL = '#00ff88';
const STATION_MID = '#ffaa00';
const STATION_LOW = '#ff4444';
const STATION_UNKNOWN = '#91a4b4';
const STATION_CLOSED = '#687581';

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});
let _overlayHost = DEFAULT_OVERLAY_HOST;

// --- Runtime state ----------------------------------------------------------
let _viewer = null;
let _points = null;
let _records = new Map();
let _enabled = false;
let _clickHandler = null;
let _cameraChangedAttached = false;
let _cameraDebounceTimer = null;
let _preRenderRemover = null;
let _selectedId = null;
let _inFlight = null;
let _requestGeneration = 0;
let _loading = false;
let _error = null;
let _status = 'idle';
let _count = 0;
let _lastUpdate = null;
let _systems = [];
let _systemsMatched = 0;
let _truncated = false;
let _altitudeGateOpen = false;
let _lastBox = null;

/** Colour for a vehicle kind. */
export function vehicleKindColor(kind) {
  return KIND_COLORS[kind] || KIND_COLORS.other;
}

/** Display label for a vehicle kind. */
export function vehicleKindLabel(kind) {
  return VEHICLE_KIND_LABELS[kind] || (kind ? String(kind) : 'Vehicle');
}

/**
 * Colour for a station, by how full it is.
 *
 * A station with no availability data is NOT drawn as empty — it takes the
 * neutral tint, because "we do not know" and "there are no bikes" are
 * different facts and the second one is actionable.
 *
 * @param {{available:?number, capacity:?number, docks:?number, renting:?boolean}} station
 * @returns {string}
 */
export function stationColor(station) {
  if (station?.renting === false) return STATION_CLOSED;
  // `Number(null)` is 0, not NaN — so a plain Number() coercion here would
  // paint every station whose feed omits availability as EMPTY, which is the
  // one reading a person acts on. The absence has to be checked first.
  const raw = station?.available;
  if (raw === null || raw === undefined || raw === '') return STATION_UNKNOWN;
  const available = Number(raw);
  if (!Number.isFinite(available)) return STATION_UNKNOWN;
  const capacity = Number(station?.capacity)
    || (Number.isFinite(Number(station?.docks)) ? available + Number(station.docks) : NaN);
  if (!Number.isFinite(capacity) || capacity <= 0) {
    return available > 0 ? STATION_FULL : STATION_LOW;
  }
  const ratio = available / capacity;
  if (ratio > 0.6) return STATION_FULL;
  if (ratio >= 0.3) return STATION_MID;
  return STATION_LOW;
}

/** Rendered size for a station, scaled by capacity. */
export function stationPointSize(station) {
  const capacity = station?.capacity === null || station?.capacity === undefined
    ? Number.NaN
    : Number(station.capacity);
  if (!Number.isFinite(capacity) || capacity <= 0) return STATION_POINT_MIN_PX + 2;
  const scaled = STATION_POINT_MIN_PX + Math.sqrt(Math.min(capacity, 60)) * 1.1;
  return Math.min(STATION_POINT_MAX_PX, scaled);
}

/**
 * Camera view box, clamped to the proxy's ceiling.
 * A wider view returns null and the layer reports zoom-in guidance instead of
 * a quietly cropped answer.
 * @param {Cesium.Viewer} viewer
 * @returns {?{south:number, west:number, north:number, east:number}}
 */
export function cameraSharedMobilityBox(viewer) {
  const rectangle = viewer?.camera?.computeViewRectangle?.();
  if (!rectangle) return null;
  const south = Cesium.Math.toDegrees(rectangle.south);
  const north = Cesium.Math.toDegrees(rectangle.north);
  const west = Cesium.Math.toDegrees(rectangle.west);
  const east = Cesium.Math.toDegrees(rectangle.east);
  if (![south, west, north, east].every(Number.isFinite)) return null;
  if (west >= east || south >= north) return null;
  if (north - south > GBFS_MAX_BOX_DEG || east - west > GBFS_MAX_BOX_DEG) return null;
  return { south, west, north, east };
}

function cameraAltitudeM(viewer) {
  const carto = viewer?.camera?.positionCartographic;
  return Number.isFinite(carto?.height) ? carto.height : Infinity;
}

function updateAltitudeGate(viewer) {
  const altitude = cameraAltitudeM(viewer);
  if (_altitudeGateOpen) {
    if (altitude > ACTIVATION_EXIT_ALTITUDE_M) _altitudeGateOpen = false;
  } else if (altitude < ACTIVATION_ENTER_ALTITUDE_M) {
    _altitudeGateOpen = true;
  }
  return _altitudeGateOpen;
}

function objectPosition(object) {
  const floor = cachedGroundFloor(object.lat, object.lon);
  const height = (Number.isFinite(floor) ? floor : 0) + POINT_LIFT_M;
  return Cesium.Cartesian3.fromDegrees(object.lon, object.lat, height);
}

/**
 * Build the card copy for a selected object. Every line is a published value.
 * @param {Object} record Render record.
 * @param {number} [nowMs]
 * @returns {string} Newline-separated card copy.
 */
export function buildSharedMobilitySelectionLabel(record, nowMs = Date.now()) {
  const object = record?.object || {};
  const system = record?.system || {};
  const details = [];

  let title;
  if (record.type === 'station') {
    title = object.name || 'Station';
    const counts = [];
    if (Number.isFinite(object.available)) counts.push(`${object.available} avail`);
    if (Number.isFinite(object.docks)) counts.push(`${object.docks} docks`);
    if (Number.isFinite(object.capacity)) counts.push(`${object.capacity} cap`);
    if (counts.length) details.push(`🚲 ${counts.join(' · ')}`);
    if (object.byKind) {
      const split = Object.entries(object.byKind)
        .filter(([, count]) => Number(count) > 0)
        .map(([kind, count]) => `${count} ${vehicleKindLabel(kind).toLowerCase()}`);
      if (split.length) details.push(`↳ ${split.join(' · ')}`);
    }
    if (object.renting === false) details.push('⚠️ Not renting');
  } else {
    title = vehicleKindLabel(object.kind);
    if (Number.isFinite(object.rangeMeters)) {
      details.push(`🔋 ${(object.rangeMeters / 1000).toFixed(1)} km range`);
    }
    // Age of the vehicle's OWN last report — several operators publish fixes
    // that are minutes to hours old, and the poll time would hide that.
    if (Number.isFinite(object.lastReported)) {
      const seconds = Math.max(0, Math.round(nowMs / 1000 - object.lastReported));
      details.push(seconds < 90
        ? `⏱ reported ${seconds}s ago`
        : `⏱ reported ${Math.round(seconds / 60)}m ago`);
    }
    details.push('Parked and available — a rented vehicle is not published');
  }

  if (system.name) details.push(`🅿️ ${system.name}`);
  if (system.licence) details.push(system.licence);
  return [title, ...details].join('\n');
}

/**
 * Protected selected-object entry for the shared overlay host.
 * @param {Object} record
 * @param {number} [nowMs]
 * @returns {?Object}
 */
export function createSharedMobilitySelectedOverlayEntry(record, nowMs = Date.now()) {
  const position = record?.position;
  if (!record?.id || !position) return null;
  const [title, ...details] = buildSharedMobilitySelectionLabel(record, nowMs).split('\n');
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
    anchorRadiusPx: 9,
    minAnchorGapPx: 11,
    verticalOnly: true,
    placement: 'above',
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
  };
}

function restoreRecordStyle(record) {
  if (!record?.point) return;
  record.point.color = Cesium.Color.fromCssColorString(record.baseColor);
  record.point.pixelSize = record.baseSize;
}

function clearSelection() {
  if (_selectedId) {
    restoreRecordStyle(_records.get(_selectedId));
  }
  _selectedId = null;
  _overlayHost.clearSource(SHARED_MOBILITY_FR_OVERLAY_SOURCE_ID);
}

function selectObject(id) {
  clearSelection();
  const record = _records.get(id);
  if (!record || !_viewer) return;
  _selectedId = id;
  if (record.point) {
    record.point.color = Cesium.Color.fromCssColorString(SELECTED_COLOR);
    record.point.pixelSize = SELECTED_POINT_PX;
  }
  const entry = createSharedMobilitySelectedOverlayEntry(record);
  if (entry) {
    _overlayHost.setEntries(
      SHARED_MOBILITY_FR_OVERLAY_SOURCE_ID,
      [entry],
      SHARED_MOBILITY_FR_OVERLAY_SOURCE_OPTIONS,
    );
  }
  governorRequestRender('shared-mobility-fr-select');
}

function onKeyDown(event) {
  if (event.key === 'Escape' && _selectedId) clearSelection();
}

function installClickHandler(viewer) {
  if (_clickHandler) return;
  _clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  _clickHandler.setInputAction((click) => {
    const picked = viewer.scene.pick(click.position);
    if (picked) {
      const primitiveId = picked.primitive?.id;
      if (typeof primitiveId === 'string' && _records.has(primitiveId)) {
        selectObject(primitiveId);
        return;
      }
      if (typeof picked.id === 'string' && _records.has(picked.id)) {
        selectObject(picked.id);
        return;
      }
    }
    if (_selectedId) clearSelection();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  document.addEventListener('keydown', onKeyDown);
}

/**
 * Per-frame horizon pass.
 *
 * Points draw with depth testing disabled so a scooter is not swallowed by the
 * kerb it sits on, which also means one on the far side of the planet would
 * paint straight through the globe. Nothing here animates — an inventory does
 * not move — so this is the layer's only per-frame work.
 */
function onPreRender() {
  if (!_enabled || !_records.size) return;
  const camera = _viewer?.camera;
  if (!camera) return;
  const occluder = horizonOccluder(camera);
  for (const record of _records.values()) {
    if (!record.point) continue;
    record.point.show = occluder.isPointVisible(record.position);
  }
}

/** Replace the rendered set with a viewport answer. */
function reconcile(payload) {
  const stations = Array.isArray(payload.stations) ? payload.stations : [];
  const vehicles = Array.isArray(payload.vehicles) ? payload.vehicles : [];
  const systemsById = new Map((payload.systems || []).map((system) => [system.id, system]));

  clearSelection();
  _points.removeAll();
  _records.clear();

  let rendered = 0;
  const positions = [];

  for (const station of stations) {
    if (rendered >= MAX_RENDERED_OBJECTS) break;
    const id = station.id;
    if (!id || _records.has(id)) continue;
    const position = objectPosition(station);
    const color = stationColor(station);
    const size = stationPointSize(station);
    const point = _points.add({
      id,
      position,
      color: Cesium.Color.fromCssColorString(color),
      pixelSize: size,
      outlineColor: OUTLINE_COLOR,
      outlineWidth: 1,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      translucencyByDistance: new Cesium.NearFarScalar(500, 1.0, 90_000, 0.35),
    });
    _records.set(id, {
      id, type: 'station', object: station, system: systemsById.get(station.system) || {},
      point, position, baseColor: color, baseSize: size,
    });
    positions.push(station);
    rendered += 1;
  }

  for (const vehicle of vehicles) {
    if (rendered >= MAX_RENDERED_OBJECTS) break;
    const id = vehicle.id || `${vehicle.system}:${vehicle.lat},${vehicle.lon}`;
    if (_records.has(id)) continue;
    const position = objectPosition(vehicle);
    const color = vehicleKindColor(vehicle.kind);
    const point = _points.add({
      id,
      position,
      color: Cesium.Color.fromCssColorString(color),
      pixelSize: VEHICLE_POINT_PX,
      outlineColor: OUTLINE_COLOR,
      outlineWidth: 1,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      translucencyByDistance: new Cesium.NearFarScalar(500, 1.0, 90_000, 0.3),
    });
    _records.set(id, {
      id, type: 'vehicle', object: vehicle, system: systemsById.get(vehicle.system) || {},
      point, position, baseColor: color, baseSize: VEHICLE_POINT_PX,
    });
    positions.push(vehicle);
    rendered += 1;
  }

  _count = _records.size;
  warmGroundFloor(positions.slice(0, 600));
  governorRequestRender('shared-mobility-fr-reconcile');
}

function clearFleet() {
  clearSelection();
  if (_points) _points.removeAll();
  _records.clear();
  _count = 0;
}

async function loadViewport({ force = false } = {}) {
  if (!_enabled || !_viewer) return;

  if (!updateAltitudeGate(_viewer)) {
    _status = 'zoom-in';
    _error = null;
    _loading = false;
    if (_records.size) clearFleet();
    return;
  }
  const box = cameraSharedMobilityBox(_viewer);
  if (!box) {
    _status = 'zoom-in';
    _error = null;
    _loading = false;
    if (_records.size) clearFleet();
    return;
  }

  const boxKey = [box.south, box.west, box.north, box.east].map((v) => v.toFixed(3)).join(',');
  if (!force && boxKey === _lastBox && _inFlight) return;
  _lastBox = boxKey;

  const generation = ++_requestGeneration;
  _inFlight?.abort?.();
  const controller = new AbortController();
  _inFlight = controller;
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  _loading = true;

  try {
    const params = new URLSearchParams({
      south: box.south.toFixed(5),
      west: box.west.toFixed(5),
      north: box.north.toFixed(5),
      east: box.east.toFixed(5),
    });
    const response = await fetch(`/api/shared-mobility-fr/objects?${params}`, { signal: controller.signal });
    if (generation !== _requestGeneration) return;
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const body = await response.json();
        if (body?.error) detail = body.missingIndex ? 'system index missing' : String(body.error);
      } catch { /* keep the status-code detail */ }
      throw new Error(detail);
    }
    const payload = await response.json();
    if (generation !== _requestGeneration || !_enabled) return;

    reconcile(payload);
    _systems = payload.systems || [];
    _systemsMatched = Number(payload.systemsMatched) || 0;
    _truncated = payload.objectsTruncated === true || payload.systemsTruncated === true;
    _lastUpdate = Date.now();
    _error = null;
    _status = _count > 0 ? 'ready' : 'empty';
  } catch (error) {
    if (error?.name === 'AbortError') return;
    if (generation !== _requestGeneration) return;
    console.warn('[Data:SharedMobilityFR] viewport load failed:', error?.message || error);
    _error = error?.message || 'shared-mobility feed unavailable';
    _status = 'error';
  } finally {
    clearTimeout(timer);
    if (generation === _requestGeneration) {
      _loading = false;
      _inFlight = null;
    }
  }
}

function onCameraChanged() {
  if (!_enabled) return;
  clearTimeout(_cameraDebounceTimer);
  _cameraDebounceTimer = setTimeout(() => { void loadViewport(); }, CAMERA_DEBOUNCE_MS);
}

/** Deterministic subsample of rendered objects for the detection overlay. */
function collectDetectableObjects(options = {}) {
  if (!_enabled || !_points?.show || !_records.size) return [];
  const records = [];
  for (const record of _records.values()) {
    if (!record.point?.show && record.id !== _selectedId) continue;
    records.push(record);
  }
  if (!records.length) return [];

  const maxCount = Number.isFinite(options.maxCount)
    ? Math.max(1, Math.floor(options.maxCount))
    : records.length;
  const seed = Number.isFinite(options.seed) ? Math.floor(options.seed) : 0;
  const stride = Math.max(1, Math.ceil(records.length / maxCount));
  const start = ((seed % stride) + stride) % stride;

  const result = [];
  for (let i = start; i < records.length; i += stride) {
    const record = records[i];
    result.push({
      position: record.position,
      sourceId: record.id,
      id: record.type === 'station'
        ? (record.object.name || 'STATION').slice(0, 22)
        : vehicleKindLabel(record.object.kind).toUpperCase(),
      type: 'VEH',
      skipLabel: record.id === _selectedId,
    });
    if (result.length >= maxCount) break;
  }
  return result;
}

function buildLoadingLabel() {
  if (_status === 'zoom-in') return 'zoom in to load shared vehicles';
  if (_loading) return _records.size ? 'refreshing operators...' : 'resolving operators...';
  if (_status === 'empty') {
    return _systemsMatched > 0 ? 'no vehicles reporting here' : 'no PAN system covers this view';
  }
  const active = _systems.filter((s) => s.stationsInView > 0 || s.vehiclesInView > 0).length;
  const parts = [`${active} operator${active === 1 ? '' : 's'}`];
  if (_truncated) parts.push('capped');
  const suppressed = _systems.reduce((sum, s) => sum + (s.stationsSuppressed || 0), 0);
  if (suppressed) parts.push(`${suppressed.toLocaleString('en-US')} shared bays merged out`);
  const stale = _systems.filter((s) => s.stale).length;
  if (stale) parts.push(`${stale} stale`);
  return parts.join(' · ');
}

/**
 * French shared-mobility layer.
 * @type {Object}
 */
const sharedMobilityFranceLayer = {
  id: SHARED_MOBILITY_FR_LAYER_ID,
  name: 'Shared Mobility FR',
  icon: '🛴',
  source: 'transport.data.gouv.fr',
  updateInterval: POLL_INTERVAL_MS,

  init(viewer) {
    _viewer = viewer;
    _points = new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT });
    _points.show = false;
    viewer.scene.primitives.add(_points);
    registerSpriteCollection(SHARED_MOBILITY_FR_LAYER_ID, _points);

    _enabled = false;
    _records = new Map();
    _selectedId = null;
    _count = 0;
    _lastUpdate = null;
    _loading = false;
    _error = null;
    _status = 'idle';
    _systems = [];
    _systemsMatched = 0;
    _truncated = false;
    _altitudeGateOpen = false;
    _lastBox = null;

    _overlayHost.setVisible(SHARED_MOBILITY_FR_OVERLAY_SOURCE_ID, false);
    restoreSpriteOrder(viewer);
  },

  enable(viewer) {
    _enabled = true;
    _error = null;
    _points.show = true;
    _overlayHost.setVisible(SHARED_MOBILITY_FR_OVERLAY_SOURCE_ID, true);
    installClickHandler(viewer);
    registerPickOwner(SHARED_MOBILITY_FR_LAYER_ID, (pickedId) => _records.has(pickedId));

    if (!_cameraChangedAttached) {
      viewer.camera.changed.addEventListener(onCameraChanged);
      viewer.camera.percentageChanged = Math.min(viewer.camera.percentageChanged || 1, 0.05);
      _cameraChangedAttached = true;
    }
    if (!_preRenderRemover) {
      _preRenderRemover = viewer.scene.preRender.addEventListener(onPreRender);
    }
    void loadViewport({ force: true });
    restoreSpriteOrder(viewer);
  },

  disable(viewer) {
    _enabled = false;
    _requestGeneration += 1;
    _altitudeGateOpen = false;
    clearTimeout(_cameraDebounceTimer);
    _cameraDebounceTimer = null;
    _inFlight?.abort?.();
    _inFlight = null;

    clearFleet();
    _overlayHost.setVisible(SHARED_MOBILITY_FR_OVERLAY_SOURCE_ID, false);

    if (_clickHandler) {
      _clickHandler.destroy();
      _clickHandler = null;
    }
    document.removeEventListener('keydown', onKeyDown);
    unregisterPickOwner(SHARED_MOBILITY_FR_LAYER_ID);

    if (_cameraChangedAttached) {
      viewer.camera.changed.removeEventListener(onCameraChanged);
      _cameraChangedAttached = false;
    }
    if (_preRenderRemover) {
      _preRenderRemover();
      _preRenderRemover = null;
    }

    _points.show = false;
    _loading = false;
    _status = 'idle';
    _systems = [];
    _lastBox = null;
  },

  async update() {
    if (!_enabled) return;
    await loadViewport({ force: true });
  },

  getDetectableObjects(options = {}) {
    return collectDetectableObjects(options);
  },

  getStats() {
    const stats = {
      count: _count,
      lastUpdate: _lastUpdate,
      loading: _loading,
      status: _status === 'ready' ? 'ok' : _status,
    };
    const label = buildLoadingLabel();
    if (label) stats.loadingLabel = label;
    if (_systems.some((system) => system.stale)) stats.stale = true;
    if (_error) stats.error = _error;
    return stats;
  },

  /** Operator provenance for the attribution popover and analyst surfaces. */
  getSystemSummaries() {
    return _systems.map((system) => ({ ...system }));
  },

  /**
   * Colour legend for the control-panel row: what is on screen right now, by
   * vehicle kind, plus stations as their own entry. Kinds with nothing in view
   * are omitted rather than listed as zero.
   * @returns {{ chips: Array<object>, legend: Array<object> }}
   */
  getRowControls() {
    const tally = new Map();
    for (const record of _records.values()) {
      const key = record.type === 'station' ? 'station' : (record.object?.kind || 'other');
      tally.set(key, (tally.get(key) || 0) + 1);
    }
    const legend = [...tally.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([key, count]) => ({
        label: key === 'station' ? 'Stations' : vehicleKindLabel(key),
        color: key === 'station' ? KIND_COLORS.station : vehicleKindColor(key),
        count,
        blurb: key === 'station'
          ? 'Operator-owned docks. Municipal bays that every operator republishes are merged out.'
          : 'Parked and available — GBFS never publishes a vehicle during a rental.',
      }));
    return { chips: [], legend };
  },

  destroy(viewer) {
    if (_enabled) this.disable(viewer);
    else {
      clearSelection();
      _overlayHost.setVisible(SHARED_MOBILITY_FR_OVERLAY_SOURCE_ID, false);
      if (_clickHandler) {
        _clickHandler.destroy();
        _clickHandler = null;
      }
      document.removeEventListener('keydown', onKeyDown);
      unregisterPickOwner(SHARED_MOBILITY_FR_LAYER_ID);
    }
    if (_preRenderRemover) {
      _preRenderRemover();
      _preRenderRemover = null;
    }
    if (_points) {
      unregisterSpriteCollection(SHARED_MOBILITY_FR_LAYER_ID, _points);
      viewer.scene.primitives.remove(_points);
      _points = null;
    }
    _records.clear();
    _viewer = null;
  },
};

/** Seed rendered records so selection/card/legend paths run without WebGL. */
export function _setSharedMobilityStateForTest({ viewer, records, overlayHost }) {
  _viewer = viewer || null;
  _records = new Map((records || []).map((record) => [record.id, record]));
  _selectedId = null;
  _overlayHost = overlayHost || DEFAULT_OVERLAY_HOST;
}

/** Exercise the production selection path in focused runtime tests. */
export function _selectSharedMobilityObjectForTest(id) {
  selectObject(id);
}

/** Exercise the production clear path and restore the production host seam. */
export function _clearSharedMobilitySelectionForTest() {
  clearSelection();
  _overlayHost = DEFAULT_OVERLAY_HOST;
}

/** Row-control legend, for tests that do not construct a viewer. */
export function _sharedMobilityRowControlsForTest() {
  return sharedMobilityFranceLayer.getRowControls();
}

export default sharedMobilityFranceLayer;
