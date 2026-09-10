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
import { claimCameraSensitivity, releaseCameraSensitivity } from './cameraSensitivity.js';
import { markViewportRead, releaseCameraSettle, watchCameraSettle } from './cameraSettle.js';
import { governorRequestRender } from '../renderGovernor.js';
import { registerSpriteCollection, restoreSpriteOrder, unregisterSpriteCollection } from './spriteOrder.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import { cachedGroundFloor, warmGroundFloor } from './groundFloor.js';
import {
  provisionalFloor,
  provisionalFloorRetryDelayMs,
  sampleProvisionalFloors,
} from './provisionalFloor.js';
import { horizonOccluder } from './iconOrientation.js';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { GBFS_MAX_BOX_DEG, VEHICLE_KIND_LABELS } from './gbfsFeeds.js';
import { mobilityOperatorShortLabel, resolveMobilityOperator } from './mobilityOperators.js';
import { sharedMobilityGlyph, sharedMobilityGlyphKind } from './sharedMobilityIcons.js';

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
/**
 * Objects whose DEM floor is requested per reconcile.
 *
 * The DEM answers over the network and a Paris viewport holds 6,000 objects;
 * this is the courtesy budget on the terrain proxy, unchanged from the layer's
 * first cut. What it does not reach is NOT left on the ellipsoid — it keeps
 * the rendered-surface floor sampled below, which measured within ~1.3 m of
 * the DEM where both were read (`provisionalFloor.js`).
 */
const MAX_FLOOR_WARM = 600;
/**
 * How far a cell the probe budget did not reach may borrow a sampled floor
 * from, in km. Tighter than the fire layer's 25 km on purpose: a parked
 * scooter is a street-scale object and the view that holds one is a city, so
 * a borrowed floor stays inside one urban basin — where the relief is metres
 * and the ellipsoid is wrong by tens to hundreds. Wider would start borrowing
 * across a valley wall.
 */
const FLOOR_FILL_KM = 10;

// --- Presentation -----------------------------------------------------------
//
// TWO CHANNELS, TWO QUESTIONS. A viewport over Paris holds Lime, Dott and Voi
// in the same streets, publishing bikes, e-bikes, scooters and mopeds side by
// side. Those are independent facts, so they get independent channels:
//
//   SHAPE  — WHAT it is.  A vehicle wears its own silhouette
//            (`sharedMobilityIcons.js`); a station is a dot, because a place
//            is not a vehicle and should not be drawn as one.
//   COLOUR — WHO runs it. The operator's hue (`mobilityOperators.js`) is the
//            body of a vehicle and the RING of a station.
//
// A station keeps its FILL for availability, which is the reading someone acts
// on and which no vehicle has: how full it is. So the ring, not the fill,
// carries the operator there — the alternative was to spend the fill on the
// operator and lose the only actionable number the layer publishes.
/** Vehicle glyph footprint, in CSS px at the near end of the distance ramp. */
const VEHICLE_GLYPH_PX = 17;
/** Glyph scale ramp: recognisable up close, a coloured speck at gate altitude. */
const VEHICLE_GLYPH_SCALE = Object.freeze({ near: 500, nearValue: 1.15, far: 45_000, farValue: 0.4 });
const STATION_POINT_MIN_PX = 7;
const STATION_POINT_MAX_PX = 15;
/** Operator ring on a station dot. Two pixels is the thinnest that reads. */
const STATION_RING_PX = 2;
const SELECTED_POINT_PX = 18;
const SELECTED_GLYPH_PX = 24;
/** Legend glyph raster — small, and never tinted by an operator. */
const LEGEND_GLYPH_PX = 32;
/**
 * Legend tint for the SHAPE half of the key. Neutral on purpose: those rows
 * answer "what", and painting them a hue would claim an operator they do not
 * stand for.
 */
const KIND_LEGEND_TINT = '#cbd5e1';
/** Operators listed by name in the row legend before the tail is summarised. */
const MAX_OPERATOR_LEGEND_ROWS = 6;

const SELECTED_COLOR = '#00ffff';

/** Station fill-rate palette, matching the bikeshare layer's reading. */
const STATION_FULL = '#00ff88';
const STATION_MID = '#ffaa00';
const STATION_LOW = '#ff4444';
const STATION_UNKNOWN = '#91a4b4';
const STATION_CLOSED = '#687581';

// --- Filtering --------------------------------------------------------------
/**
 * THE TWO HALVES OF THE FLEET, AS A FILTER.
 *
 * A city viewport holds bikes, e-bikes, trottinettes, scooters and shared cars
 * in the same streets, and the reader who came for one of those reads the
 * other four as noise. The shape channel already says which is which; these
 * two chips are what let someone act on it.
 *
 * A PARTITION, NOT TWO OVERLAPPING SETS. Every object belongs to exactly one
 * side, so pressing one chip and then the other shows the whole fleet with
 * nothing invisible under both. That is the property that makes the pair
 * trustworthy, and it is why `other` — a form factor GBFS declines to name —
 * sits with the rest rather than nowhere.
 *
 * A VAE IS A BIKE. `vehicleKindFromType()` splits `bicycle` by propulsion, so
 * `bike` and `ebike` are the same silhouette on two power sources; a chip
 * labelled "Vélos" that hid every Vélib' électrique would be lying about its
 * own name. The tooltip says both are in there.
 *
 * There is no third "everything" chip: pressing the lit one releases the
 * filter, and a row with neither lit already reads as unfiltered. The strip
 * this shares with the fusion chips is a control strip, not a second list of
 * names, and a third chip would have spent a quarter of it saying "no".
 */
export const SHARED_MOBILITY_KIND_FILTERS = Object.freeze([
  Object.freeze({
    id: 'velo',
    label: 'Vélos',
    /** Vehicle kinds on this side of the split. */
    kinds: Object.freeze(['bike', 'ebike']),
  }),
  Object.freeze({
    id: 'autres',
    label: 'Le reste',
    kinds: Object.freeze(['scooter', 'moped', 'car', 'other']),
  }),
]);

/**
 * Whether a station holds bicycles.
 *
 * Three cases, and the middle one is the reason this is a function rather than
 * a lookup. A 2.x feed publishes a mechanical/ebike split that
 * `parseGbfsStationStatus` normalises to `bike`/`ebike`, so it answers
 * directly. A 3.0 feed publishes `vehicle_types_available`, whose keys are the
 * system's OWN vehicle_type_ids — opaque strings this layer cannot resolve —
 * so a station carrying only those tells us nothing about what is in it. And a
 * station with no availability breakdown at all tells us nothing either.
 *
 * Both of those unknowns fall back to YES, following the GBFS spec's own
 * default: a system that publishes no vehicle types "is assumed to operate
 * non-motorized bicycles" (the same fallback `vehicleKindLookup` documents).
 * A dock that turns out to hold scooters is then shown under "Vélos", which is
 * the failure worth having — the alternative hides half the docks in France
 * from the chip that names them.
 *
 * @param {{byKind?: ?Object<string, number>}} station Wire station.
 * @returns {boolean}
 */
export function stationHoldsBikes(station) {
  const byKind = station?.byKind;
  if (!byKind) return true;
  let recognised = false;
  for (const [key, count] of Object.entries(byKind)) {
    if (!(Number(count) > 0)) continue;
    if (key === 'bike' || key === 'ebike') return true;
    if (key in VEHICLE_KIND_LABELS) recognised = true;
  }
  return !recognised;
}

/**
 * Whether one wire object survives a filter. A null filter keeps everything.
 * @param {?string} filterId One of {@link SHARED_MOBILITY_KIND_FILTERS}' ids.
 * @param {'station'|'vehicle'} type
 * @param {object} object Wire station or vehicle.
 * @returns {boolean}
 */
export function matchesKindFilter(filterId, type, object) {
  if (!filterId) return true;
  const bike = type === 'station' ? stationHoldsBikes(object) : isBikeKind(object?.kind);
  return filterId === 'velo' ? bike : !bike;
}

/** A bicycle form factor, powered either way. */
function isBikeKind(kind) {
  return kind === 'bike' || kind === 'ebike';
}

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});
let _overlayHost = DEFAULT_OVERLAY_HOST;

// --- Runtime state ----------------------------------------------------------
let _viewer = null;
/** Station dots: fill = availability, ring = operator. */
let _points = null;
/** Vehicle glyphs: silhouette = kind, tint = operator. */
let _billboards = null;
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
/** The last viewport answer, kept so a filter change repaints without a
 *  refetch — and so the chips can count the half they are hiding. */
let _lastPayload = null;
/** Active kind filter id, or null for the whole fleet. */
let _kindFilter = null;
/** Memo of `kindFilterTally()`, keyed on the payload it was counted from. */
let _tallyPayload = null;
let _tally = { velo: 0, autres: 0 };
let _rowControlsListener = null;
/** Deferred floor pass: timer handle and retries already spent (see
 *  `scheduleFloorRetry`). */
let _floorRetryTimer = null;
let _floorRetries = 0;

/**
 * The operator behind a render record.
 *
 * Derived from the system title rather than stored on the wire object: the
 * proxy already sends one `systems` row per feed and duplicating the operator
 * onto every one of 6,000 vehicles would be the same string 6,000 times.
 * @param {Object} record Render record.
 * @returns {{id:string, label:string, color:string, curated:boolean}}
 */
export function sharedMobilityOperator(record) {
  return record?.operator || resolveMobilityOperator(record?.system?.name);
}

/** The single primitive a record draws — a glyph for a vehicle, a dot for a station. */
function recordPrimitive(record) {
  return record?.billboard || record?.point || null;
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

/**
 * The floor one object stands on: the shared DEM/mesh cell when it is warm,
 * the PROVISIONAL rendered-surface read when it is not, and null when neither
 * has an answer.
 *
 * WHY THE SECOND SOURCE EXISTS. The DEM answers over the network. Until it
 * does, this returned 0 — the WGS84 ellipsoid, which under a French city is
 * tens to hundreds of metres below the street. The points draw with
 * `disableDepthTestDistance: Infinity` so a scooter is not swallowed by the
 * kerb it sits on, so a buried point is painted anyway, and its screen
 * position then follows the CAMERA POSE: drag the map and the whole fleet
 * slides across the rooftops before snapping back. That is the reported
 * "the points move with the map instead of being fixed to it", and it
 * recurred on every viewport the session had not visited — which, on a layer
 * that refetches on every camera move, is most of them.
 * @param {{lat: number, lon: number}} object
 * @returns {?number} Ellipsoidal floor in metres, or null.
 */
function objectFloor(object) {
  const floor = cachedGroundFloor(object.lat, object.lon);
  if (Number.isFinite(floor)) return floor;
  const provisional = provisionalFloor(object.lat, object.lon);
  return Number.isFinite(provisional) ? provisional : null;
}

function objectPosition(object) {
  const floor = objectFloor(object);
  const height = (floor ?? 0) + POINT_LIFT_M;
  return Cesium.Cartesian3.fromDegrees(object.lon, object.lat, height);
}

/**
 * One shared-mobility object — a docking station or a parked vehicle — in the
 * words a spoken answer uses.
 *
 * Mirrors `buildSharedMobilitySelectionLabel` field for field, so the card the
 * operator reads and the payload the brain reads cannot disagree about the same
 * dot. The card formats; this one names.
 *
 * A parked vehicle is exactly that: GBFS free-floating feeds publish AVAILABLE
 * vehicles only, never a track. `moving` is therefore absent rather than false —
 * a field the feed does not answer must not be answered here.
 *
 * @param {object|null} record Render record.
 * @returns {object|null}
 */
export function sharedMobilityReadout(record) {
  const object = record?.object;
  if (!object) return null;
  const num = (value) => (Number.isFinite(value) ? value : null);
  const operator = sharedMobilityOperator(record);
  const base = {
    id: record.id,
    lat: num(object.lat),
    lon: num(object.lon),
    operator: operator?.id === 'unknown' ? null : (operator?.label || null),
    system: record.system?.name || null,
    source: 'GBFS (transport.data.gouv.fr)',
  };
  if (record.type === 'station') {
    return {
      ...base,
      kind: 'shared-mobility-station',
      name: object.name || null,
      vehiclesAvailable: num(object.available),
      docksAvailable: num(object.docks),
      capacity: num(object.capacity),
      byKind: object.byKind && Object.keys(object.byKind).length ? { ...object.byKind } : null,
      renting: object.renting !== false,
    };
  }
  return {
    ...base,
    kind: 'shared-mobility-vehicle',
    vehicleKind: vehicleKindLabel(object.kind),
    rangeKm: Number.isFinite(object.rangeMeters) ? Math.round(object.rangeMeters / 100) / 10 : null,
    // GBFS `last_reported` is epoch SECONDS; the readout speaks milliseconds
    // like every other timestamp the voice payload carries.
    lastReportedMs: Number.isFinite(object.lastReported) && object.lastReported > 0
      ? object.lastReported * 1000
      : null,
  };
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
    // "Lime E-bike", not "E-bike": the operator is half of what the glyph on
    // screen is saying, and the card is where that colour gets a name.
    const operator = sharedMobilityOperator(record);
    const kind = vehicleKindLabel(object.kind);
    title = operator.id === 'unknown' ? kind : `${operator.label} ${kind}`;
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
  const color = Cesium.Color.fromCssColorString(record?.baseColor || SELECTED_COLOR);
  if (record?.billboard) {
    record.billboard.color = color;
    record.billboard.width = record.baseSize;
    record.billboard.height = record.baseSize;
    return;
  }
  if (!record?.point) return;
  record.point.color = color;
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
  const selected = Cesium.Color.fromCssColorString(SELECTED_COLOR);
  if (record.billboard) {
    record.billboard.color = selected;
    record.billboard.width = SELECTED_GLYPH_PX;
    record.billboard.height = SELECTED_GLYPH_PX;
  } else if (record.point) {
    // The ring is left alone: losing the operator colour at the moment someone
    // asks "whose is this?" would be exactly backwards.
    record.point.color = selected;
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
    const primitive = recordPrimitive(record);
    if (!primitive) continue;
    primitive.show = occluder.isPointVisible(record.position);
  }
}

/**
 * Replace the rendered set with a viewport answer.
 *
 * Order matters twice here. The FILTER runs before the render cap, so a chip
 * means "draw only bikes" and not "draw fewer bikes" — spending a 6,000-object
 * budget on vehicles the reader just asked to hide would be the second. And
 * the FLOOR pass runs before any position is computed, because a position is
 * written into a primitive once and nothing recomputes it per frame.
 */
function reconcile(payload) {
  const stations = Array.isArray(payload.stations) ? payload.stations : [];
  const vehicles = Array.isArray(payload.vehicles) ? payload.vehicles : [];
  const systemsById = new Map((payload.systems || []).map((system) => [system.id, system]));

  clearSelection();
  _points.removeAll();
  _billboards.removeAll();
  _records.clear();
  // A new set is a new situation: the deferred floor pass gets its budget back.
  resetFloorRetries();

  const drawn = [];
  const seen = new Set();
  for (const station of stations) {
    if (drawn.length >= MAX_RENDERED_OBJECTS) break;
    const id = station.id;
    if (!id || seen.has(id)) continue;
    if (!matchesKindFilter(_kindFilter, 'station', station)) continue;
    seen.add(id);
    drawn.push({ type: 'station', id, object: station });
  }
  for (const vehicle of vehicles) {
    if (drawn.length >= MAX_RENDERED_OBJECTS) break;
    const id = vehicle.id || `${vehicle.system}:${vehicle.lat},${vehicle.lon}`;
    if (seen.has(id)) continue;
    if (!matchesKindFilter(_kindFilter, 'vehicle', vehicle)) continue;
    seen.add(id);
    drawn.push({ type: 'vehicle', id, object: vehicle });
  }

  const objects = drawn.map((entry) => entry.object);
  // Ground the cold cells against the surface actually being DRAWN before the
  // positions below are taken. Synchronous, no network of ours, ≤40 probes and
  // nothing at all above 25 km of camera (`provisionalFloor.js`).
  const { pending } = sampleProvisionalFloors(_viewer?.scene, objects, { fillKm: FLOOR_FILL_KM });

  // One resolve per system, not per object: a Paris viewport holds ~6,000
  // vehicles across a handful of operators.
  const operatorsBySystem = new Map();
  const operatorFor = (systemId) => {
    let operator = operatorsBySystem.get(systemId);
    if (!operator) {
      operator = resolveMobilityOperator(systemsById.get(systemId)?.name);
      operatorsBySystem.set(systemId, operator);
    }
    return operator;
  };

  for (const entry of drawn) {
    const { id, object } = entry;
    const position = objectPosition(object);
    const operator = operatorFor(object.system);
    if (entry.type === 'station') {
      const color = stationColor(object);
      const size = stationPointSize(object);
      const point = _points.add({
        id,
        position,
        color: Cesium.Color.fromCssColorString(color),
        pixelSize: size,
        // Fill answers "how full", ring answers "whose".
        outlineColor: Cesium.Color.fromCssColorString(operator.color),
        outlineWidth: STATION_RING_PX,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        translucencyByDistance: new Cesium.NearFarScalar(500, 1.0, 90_000, 0.35),
      });
      _records.set(id, {
        id, type: 'station', object, system: systemsById.get(object.system) || {},
        operator, point, position, baseColor: color, baseSize: size,
      });
      continue;
    }
    const billboard = _billboards.add({
      id,
      position,
      image: sharedMobilityGlyph(object.kind),
      width: VEHICLE_GLYPH_PX,
      height: VEHICLE_GLYPH_PX,
      color: Cesium.Color.fromCssColorString(operator.color),
      // A glyph big enough to read at street level is a blanket over a whole
      // city, so it rides a distance ramp down to roughly the speck the layer
      // drew before it had shapes.
      scaleByDistance: new Cesium.NearFarScalar(
        VEHICLE_GLYPH_SCALE.near, VEHICLE_GLYPH_SCALE.nearValue,
        VEHICLE_GLYPH_SCALE.far, VEHICLE_GLYPH_SCALE.farValue,
      ),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      translucencyByDistance: new Cesium.NearFarScalar(500, 1.0, 90_000, 0.3),
    });
    _records.set(id, {
      id, type: 'vehicle', object, system: systemsById.get(object.system) || {},
      operator, billboard, position, baseColor: operator.color, baseSize: VEHICLE_GLYPH_PX,
    });
  }

  _count = _records.size;
  warmGroundFloor(objects.slice(0, MAX_FLOOR_WARM));
  // Two reasons to come back, and neither of them produces a frame on its own:
  // the tiles under a cell may not have streamed yet, and the DEM warm above
  // is fire-and-forget — nothing repositions what it resolves.
  if (pending || hasColdFloor(objects)) scheduleFloorRetry();
  governorRequestRender('shared-mobility-fr-reconcile');
}

/** True when any object is still standing on no measured floor at all. */
function hasColdFloor(objects) {
  for (const object of objects) {
    if (objectFloor(object) == null) return true;
  }
  return false;
}

/**
 * Re-place every rendered object on the best floor now known for its cell.
 *
 * A position is baked into a primitive once, so a floor that lands after the
 * reconcile changes nothing until something walks the set — which is what this
 * is. Cheap: no network, no allocation beyond the new Cartesians, and it exits
 * on the first pass where nothing moved.
 * @returns {number} How many objects actually moved.
 */
function reanchor() {
  let moved = 0;
  for (const record of _records.values()) {
    const next = objectPosition(record.object);
    // 5 cm: below this the move is not a pixel anywhere, and rewriting the
    // primitive would only cost the collection a dirty flag.
    if (Cesium.Cartesian3.equalsEpsilon(record.position, next, 0, 0.05)) continue;
    record.position = next;
    const primitive = recordPrimitive(record);
    if (primitive) primitive.position = next;
    moved += 1;
  }
  // The selected card is anchored on the record's position, so it has to be
  // told too — otherwise the card stays where the buried point used to be.
  if (moved && _selectedId) {
    const entry = createSharedMobilitySelectedOverlayEntry(_records.get(_selectedId));
    if (entry) {
      _overlayHost.setEntries(
        SHARED_MOBILITY_FR_OVERLAY_SOURCE_ID,
        [entry],
        SHARED_MOBILITY_FR_OVERLAY_SOURCE_OPTIONS,
      );
    }
  }
  return moved;
}

/** One deferred floor pass: sample again, re-place, and decide whether to
 *  come back. Never fetches — the DEM warm runs on its own underneath. */
function refreshFloors() {
  if (!_enabled || !_viewer || !_records.size) return;
  const objects = [];
  for (const record of _records.values()) objects.push(record.object);
  const { pending } = sampleProvisionalFloors(_viewer.scene, objects, { fillKm: FLOOR_FILL_KM });
  if (reanchor()) governorRequestRender('shared-mobility-fr-reanchor');
  if (pending || hasColdFloor(objects)) scheduleFloorRetry();
}

/**
 * Come back for the objects the surface could not place yet.
 *
 * A probe misses when the tiles under a vehicle have not streamed — the
 * ordinary state for the second or two after arriving somewhere — and a parked
 * camera produces no rebuild, so nothing would ask again. Bounded on purpose:
 * five doubling wakeups (~37 s in total, `provisionalFloor.js`), refilled
 * whenever the situation is new, so ground with no photoreal coverage cannot
 * undo the render governor's idle parking.
 */
function scheduleFloorRetry() {
  if (_floorRetryTimer != null) return;
  const delay = provisionalFloorRetryDelayMs(_floorRetries);
  if (delay == null) return; // budget spent — wait for the camera to move
  _floorRetries += 1;
  _floorRetryTimer = setTimeout(() => {
    _floorRetryTimer = null;
    refreshFloors();
  }, delay);
}

/** Drops a pending pass and refills its budget (a new situation gets a new one). */
function resetFloorRetries() {
  if (_floorRetryTimer != null) {
    clearTimeout(_floorRetryTimer);
    _floorRetryTimer = null;
  }
  _floorRetries = 0;
}

function clearFleet() {
  clearSelection();
  resetFloorRetries();
  if (_points) _points.removeAll();
  if (_billboards) _billboards.removeAll();
  _records.clear();
  _count = 0;
}

async function loadViewport({ force = false } = {}) {
  if (!_enabled || !_viewer) return;
  // Whatever this call concludes — a fleet, a zoom-in verdict or a failure —
  // it concludes it about the view the camera is showing right now. See
  // `cameraSettle.js`: an arrival on any other view has to be read afresh.
  markViewportRead(_viewer, SHARED_MOBILITY_FR_LAYER_ID);

  if (!updateAltitudeGate(_viewer)) {
    _status = 'zoom-in';
    _error = null;
    _loading = false;
    _lastPayload = null;
    if (_records.size) clearFleet();
    return;
  }
  const box = cameraSharedMobilityBox(_viewer);
  if (!box) {
    _status = 'zoom-in';
    _error = null;
    _loading = false;
    _lastPayload = null;
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

    _lastPayload = payload;
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
  // A camera that moved is a NEW situation for the floor pass: closer tiles
  // read finer, and a load that turns out to be a no-op (same box, request
  // already in flight) would otherwise leave the fleet on whatever floor the
  // last view could see.
  resetFloorRetries();
  clearTimeout(_cameraDebounceTimer);
  _cameraDebounceTimer = setTimeout(() => {
    scheduleFloorRetry();
    void loadViewport();
  }, CAMERA_DEBOUNCE_MS);
}

/**
 * The camera has come to REST — read the view it stopped on.
 *
 * `camera.changed` goes quiet before an eased flight lands (measured Paris →
 * Rouen: last `changed` t=2.5 s, `moveEnd` t=3.3 s), so the load a flight
 * triggers describes a camera still in the air. See `cameraSettle.js`, which
 * also holds the "did we already read this view" short-circuit that keeps an
 * ordinary pan down to one load.
 *
 * It SUPERSEDES the pending debounce rather than racing it: on a hand pan
 * `moveEnd` arrives while that timer is still armed, and letting both run
 * would ask the proxy the same question twice.
 */
function onCameraSettled() {
  if (!_enabled) return;
  clearTimeout(_cameraDebounceTimer);
  _cameraDebounceTimer = null;
  resetFloorRetries();
  scheduleFloorRetry();
  void loadViewport();
}

/** Deterministic subsample of rendered objects for the detection overlay. */
function collectDetectableObjects(options = {}) {
  if (!_enabled || !(_points?.show || _billboards?.show) || !_records.size) return [];
  const records = [];
  for (const record of _records.values()) {
    if (!recordPrimitive(record)?.show && record.id !== _selectedId) continue;
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
        : `${mobilityOperatorShortLabel(record.system?.name, 10)} ${vehicleKindLabel(record.object.kind)}`
          .toUpperCase().slice(0, 22),
      type: 'VEH',
      skipLabel: record.id === _selectedId,
    });
    if (result.length >= maxCount) break;
  }
  return result;
}

/**
 * How many objects sit on each side of the split, in the answer currently
 * held — INCLUDING the half a chip is hiding. A control that says what it
 * costs is the difference between a filter and a disappearance.
 * @returns {{velo: number, autres: number}}
 */
function kindFilterTally() {
  const payload = _lastPayload;
  if (!payload) return { velo: 0, autres: 0 };
  // Memoised on the payload's own identity: the panel asks for the row's
  // controls on every refresh, and this walks up to 6,000 objects for an
  // answer that cannot change until the next viewport answer replaces them.
  if (_tallyPayload === payload) return _tally;
  const tally = { velo: 0, autres: 0 };
  for (const station of Array.isArray(payload.stations) ? payload.stations : []) {
    tally[stationHoldsBikes(station) ? 'velo' : 'autres'] += 1;
  }
  for (const vehicle of Array.isArray(payload.vehicles) ? payload.vehicles : []) {
    tally[isBikeKind(vehicle?.kind) ? 'velo' : 'autres'] += 1;
  }
  _tallyPayload = payload;
  _tally = tally;
  return tally;
}

const fr = (value) => Number(value).toLocaleString('fr-FR');

/**
 * The tooltip for one filter chip.
 *
 * It carries the count on BOTH sides, and — on the bikes chip — the one place
 * the split is a judgement rather than a reading: a dock that publishes no
 * inventory is counted as a bike dock, following the GBFS default.
 * @param {{id: string}} filter
 * @param {number} kept Objects this chip would keep.
 * @param {number} total Objects in the answer.
 * @param {boolean} active Whether this chip is the lit one.
 * @returns {string}
 */
function kindFilterChipTitle(filter, kept, total, active) {
  // Nothing has arrived yet, so there is no share to quote — and a chip that
  // said "0 sur 0" would look like an answer instead of an absence.
  const share = total > 0
    ? ` — ${fr(kept)} objet${kept > 1 ? 's' : ''} sur ${fr(total)}`
    : '';
  if (active) return `${filter.label} seuls${share}. Appuyer à nouveau pour tout revoir.`;
  if (filter.id === 'velo') {
    return `Ne garder que les vélos${share}. Vélo mécanique et VAE, plus les stations`
      + ' qui en tiennent ; une station qui ne publie pas son inventaire est comptée ici,'
      + ' comme le veut le défaut GBFS.';
  }
  return `Ne garder que le reste${share}. Trottinettes, scooters, voitures partagées`
    + ' et formes non nommées, plus les stations sans vélo.';
}

function buildLoadingLabel() {
  if (_status === 'zoom-in') return 'zoom in to load shared vehicles';
  if (_loading) return _records.size ? 'refreshing operators...' : 'resolving operators...';
  if (_status === 'empty') {
    // A chip that hides everything has to own it: "no vehicles reporting here"
    // would blame the feed for the reader's own filter.
    const tally = kindFilterTally();
    if (_kindFilter && tally.velo + tally.autres > 0) {
      return _kindFilter === 'velo'
        ? 'no bikes in this view — the rest is filtered out'
        : 'nothing but bikes in this view — they are filtered out';
    }
    return _systemsMatched > 0 ? 'no vehicles reporting here' : 'no PAN system covers this view';
  }
  const active = _systems.filter((s) => s.stationsInView > 0 || s.vehiclesInView > 0).length;
  const parts = [`${active} operator${active === 1 ? '' : 's'}`];
  if (_kindFilter) parts.push(_kindFilter === 'velo' ? 'bikes only' : 'bikes hidden');
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
    _billboards = new Cesium.BillboardCollection({ scene: viewer.scene });
    _billboards.show = false;
    viewer.scene.primitives.add(_billboards);
    // Registered in this order so a vehicle glyph paints OVER the dock dot it
    // is parked next to, and both stay inside this layer's sprite slot.
    registerSpriteCollection(SHARED_MOBILITY_FR_LAYER_ID, _points);
    registerSpriteCollection(SHARED_MOBILITY_FR_LAYER_ID, _billboards);

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
    _lastPayload = null;
    resetFloorRetries();

    _overlayHost.setVisible(SHARED_MOBILITY_FR_OVERLAY_SOURCE_ID, false);
    restoreSpriteOrder(viewer);
  },

  enable(viewer) {
    _enabled = true;
    _error = null;
    _points.show = true;
    _billboards.show = true;
    _overlayHost.setVisible(SHARED_MOBILITY_FR_OVERLAY_SOURCE_ID, true);
    installClickHandler(viewer);
    registerPickOwner(SHARED_MOBILITY_FR_LAYER_ID, (pickedId) => _records.has(pickedId));

    if (!_cameraChangedAttached) {
      viewer.camera.changed.addEventListener(onCameraChanged);
      claimCameraSensitivity(viewer, SHARED_MOBILITY_FR_LAYER_ID);
      // Arrival, as opposed to motion — see `onCameraSettled`.
      watchCameraSettle(viewer, SHARED_MOBILITY_FR_LAYER_ID, onCameraSettled);
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
      releaseCameraSensitivity(viewer, SHARED_MOBILITY_FR_LAYER_ID);
      releaseCameraSettle(viewer, SHARED_MOBILITY_FR_LAYER_ID);
      _cameraChangedAttached = false;
    }
    if (_preRenderRemover) {
      _preRenderRemover();
      _preRenderRemover = null;
    }

    _points.show = false;
    _billboards.show = false;
    _loading = false;
    _status = 'idle';
    _systems = [];
    _lastBox = null;
    _lastPayload = null;
  },

  async update() {
    if (!_enabled) return;
    await loadViewport({ force: true });
  },

  /**
   * Runtime params. `kinds` hides half the fleet without losing it: the
   * viewport answer is kept whole, so the chips keep counting what they hide
   * and releasing the filter costs no request.
   *
   * DECLARATIVE, NOT A TOGGLE. `velo` always means "show bikes" and never
   * "show bikes unless you already were" — the lit chip publishes `all` as its
   * own params, so the release is a value and not a repeat. A parameter that
   * inverted on re-application would flip the filter off the moment anything
   * replayed it (`lazyLayer`'s buffered calls, a params intent re-applied on
   * enable), and nothing about that would look like a bug from the outside.
   * @param {{kinds?: ?string}} [params] `velo`, `autres`, `all`/null to clear.
   * @returns {boolean} Whether anything changed.
   */
  setParams(params = {}) {
    if (params.kinds === undefined) return false;
    const next = params.kinds === null || params.kinds === 'all' ? null : String(params.kinds);
    if (next !== null && !SHARED_MOBILITY_KIND_FILTERS.some((f) => f.id === next)) return false;
    if (next === _kindFilter) return false;
    _kindFilter = next;
    // Repaint from the answer already in hand. A filter is a view of what
    // arrived, not a different question to ask the proxy.
    if (_lastPayload) {
      reconcile(_lastPayload);
      _status = _count > 0 ? 'ready' : 'empty';
    } else {
      clearFleet();
    }
    _rowControlsListener?.();
    return true;
  },

  /** @returns {{kinds: ?string}} */
  getParams() {
    return { kinds: _kindFilter };
  },

  setRowControlsListener(listener) {
    _rowControlsListener = typeof listener === 'function' ? listener : null;
  },

  getDetectableObjects(options = {}) {
    return collectDetectableObjects(options);
  },

  /** The station or vehicle the operator clicked, ready to be spoken. */
  getSelectedInfo() {
    if (!_enabled || !_selectedId) return null;
    return sharedMobilityReadout(_records.get(_selectedId) || null);
  },

  /**
   * Loaded stations and vehicles as plain records for the analyst engine.
   * @param {number} [maxCount=2000]
   * @returns {Array<object>}
   */
  getAnalystRecords(maxCount = 2000) {
    if (!_enabled) return [];
    const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 2000;
    const out = [];
    for (const record of _records.values()) {
      if (out.length >= limit) break;
      const readout = sharedMobilityReadout(record);
      if (readout && Number.isFinite(readout.lat) && Number.isFinite(readout.lon)) out.push(readout);
    }
    return out;
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
   * The row's controls and the key to both channels.
   *
   * TWO CHIPS, which are a filter and not a second legend: a city viewport
   * holds bikes, trottinettes, scooters and shared cars in the same streets,
   * and the reader who came for one of them reads the other three as noise.
   * They partition the fleet, so pressing one and then the other shows
   * everything; pressing the lit one releases the filter. There is no third
   * "everything" chip — a row with neither lit already reads as unfiltered.
   *
   * Two legend groups, because the map is saying two things at once:
   *
   *   SHAPE rows — what is on screen, by kind, each showing its own silhouette
   *     in a neutral tint. Kinds with nothing in view are omitted rather than
   *     listed as zero.
   *   COLOUR rows — the operators in view, each in the hue it is drawn in.
   *     This is the half a colour cannot explain by itself, and it is also the
   *     answer to two municipal networks that happen to hash to one hue: the
   *     names are the authority, the hue only groups.
   *
   * @returns {{ chips: Array<object>, legend: Array<object> }}
   */
  getRowControls() {
    const kinds = new Map();
    const operators = new Map();
    for (const record of _records.values()) {
      const kind = record.type === 'station' ? 'station' : (record.object?.kind || 'other');
      kinds.set(kind, (kinds.get(kind) || 0) + 1);
      const operator = sharedMobilityOperator(record);
      const seen = operators.get(operator.id);
      if (seen) seen.count += 1;
      else operators.set(operator.id, { operator, count: 1 });
    }

    const shapes = [...kinds.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([kind, count]) => ({
        label: kind === 'station' ? 'Stations' : vehicleKindLabel(kind),
        color: KIND_LEGEND_TINT,
        // The legend swatch IS the map glyph, at legend size.
        glyph: sharedMobilityGlyph(kind === 'station' ? 'station' : sharedMobilityGlyphKind(kind), LEGEND_GLYPH_PX),
        count,
        blurb: kind === 'station'
          ? 'Operator-owned docks — filled by availability, ringed by operator. Municipal bays that every operator republishes are merged out.'
          : 'Parked and available — GBFS never publishes a vehicle during a rental.',
      }));

    const ranked = [...operators.values()]
      .sort((a, b) => b.count - a.count || a.operator.label.localeCompare(b.operator.label));
    const listed = ranked.slice(0, MAX_OPERATOR_LEGEND_ROWS).map(({ operator, count }) => ({
      label: operator.label,
      color: operator.color,
      count,
      blurb: operator.curated
        ? `${operator.label} — one hue nationwide, so this operator reads the same in every city.`
        : `${operator.label} — hue derived from the published title; no French feed publishes a brand colour.`,
    }));
    // Never silently truncate: say how many operators the row is not naming.
    const hidden = ranked.slice(MAX_OPERATOR_LEGEND_ROWS);
    if (hidden.length) {
      listed.push({
        label: `+${hidden.length} operators`,
        color: KIND_LEGEND_TINT,
        count: hidden.reduce((sum, entry) => sum + entry.count, 0),
        blurb: `Also in view: ${hidden.map((entry) => entry.operator.label).join(', ')}.`,
      });
    }

    const tally = kindFilterTally();
    const total = tally.velo + tally.autres;
    const chips = SHARED_MOBILITY_KIND_FILTERS.map((filter) => {
      const active = _kindFilter === filter.id;
      const kept = tally[filter.id];
      return {
        id: filter.id,
        label: filter.label,
        active,
        state: active ? 'active' : 'idle',
        // A chip that would blank the map is refused rather than allowed to
        // look broken — but never the lit one, which is the way back.
        disabled: kept === 0 && !active,
        title: kindFilterChipTitle(filter, kept, total, active),
        // The lit chip IS the way back, and it says so as a value rather than
        // as "press me twice" — see `setParams`.
        params: { kinds: active ? 'all' : filter.id },
      };
    });

    return { chips, legend: [...shapes, ...listed] };
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
    if (_billboards) {
      unregisterSpriteCollection(SHARED_MOBILITY_FR_LAYER_ID, _billboards);
      viewer.scene.primitives.remove(_billboards);
      _billboards = null;
    }
    resetFloorRetries();
    _records.clear();
    _lastPayload = null;
    _rowControlsListener = null;
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

/** Drive the production re-anchor pass over the seeded records. */
export function _reanchorSharedMobilityForTest() {
  return reanchor();
}

/** Seed the viewport answer the chips count and a filter repaints from. */
export function _setSharedMobilityPayloadForTest(payload) {
  _lastPayload = payload;
}

/** Row-control legend, for tests that do not construct a viewer. */
export function _sharedMobilityRowControlsForTest() {
  return sharedMobilityFranceLayer.getRowControls();
}

export default sharedMobilityFranceLayer;
