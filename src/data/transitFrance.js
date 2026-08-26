/**
 * @module transitFrance
 *
 * Live ground transit for France — the buses, trams, metros and interurban
 * coaches that are moving *right now*, from the GTFS-Realtime vehicle-position
 * feeds published on the Point d'Accès National (`transport.data.gouv.fr`).
 *
 * WHY THIS LAYER EXISTS: everything else on this globe flies, floats or orbits.
 * Ground transit is the one live layer where the contact is a vehicle a person
 * is sitting in, on a street you can descend to in the 3D scene — and France
 * publishes ~150 such feeds, keyless, under Licence Ouverte 2.0 or ODbL 1.0,
 * as an obligation of EU regulation 2017/1926.
 *
 * HOW IT LOADS: per viewport, never nationally. The dev-server proxy
 * (`/api/transit-fr/vehicles`, see `vite.config.js`) resolves which networks
 * intersect the camera's box, fetches only those protobuf bodies, decodes them
 * and returns the vehicles inside the box. Above {@link ACTIVATION_ALTITUDE_M}
 * the layer reports a `zoom-in` guidance state rather than fanning out over
 * every network in the country.
 *
 * WHAT IS REAL AND WHAT IS DISPLAY:
 *   - Position, bearing, speed, stop status and occupancy are the operator's
 *     own reported values, passed through unchanged.
 *   - The glyph GLIDES between two consecutive reported fixes, over the time
 *     the operator actually took to report them. Like the flights layer, the
 *     scene therefore renders one fix interval behind live, and never
 *     extrapolates past the newest fix: every drawn position lies on the
 *     segment between two things the feed actually said, travelled at the
 *     speed the feed implies. The card always prints the age of the real fix.
 *   - MODE is the network's declared service class (`urban`, `intercity`,
 *     `school`…), not the vehicle's. GTFS-Realtime carries no `route_type`, so
 *     a tram inside an urban network is coloured as urban until the matching
 *     GTFS *static* feed is loaded — which this layer deliberately does not do.
 *   - ROUTE is the feed's `route_id`, unwrapped from its NeTEx envelope when it
 *     has one. Networks that publish an opaque internal key show that key.
 */
import * as Cesium from 'cesium';
import {
  governorRequestRender,
  holdContinuousRender,
  releaseContinuousRender,
} from '../renderGovernor.js';
import {
  registerSpriteCollection,
  restoreSpriteOrder,
  unregisterSpriteCollection,
} from './spriteOrder.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import { cachedGroundFloor, warmGroundFloor } from './groundFloor.js';
import { cameraPoseSignature, horizonOccluder, screenProjectedRotation } from './iconOrientation.js';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { PAN_MAX_BOX_DEG, PAN_MODE_LABELS } from './panFeeds.js';

/** Layer id — also the share-link registry key and the voice-tool enum value. */
export const TRANSIT_FR_LAYER_ID = 'transit-fr';
/** Protected selected-vehicle card source on the shared world-overlay host. */
export const TRANSIT_FR_OVERLAY_SOURCE_ID = 'transit-fr-selected';
export const TRANSIT_FR_OVERLAY_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 0,
  moving: true,
});

// --- Activation / load gating ----------------------------------------------
/**
 * Altitude (m) below which the layer loads. At 300 km a 60° vertical FOV sees
 * roughly 3° of ground — comfortably inside the proxy's 6° request ceiling,
 * and about the height at which an individual bus glyph stops being a
 * sub-pixel speck.
 */
const ACTIVATION_ALTITUDE_M = 300_000;
/** Hysteresis so a camera hovering at the gate does not thrash the feed. */
const ACTIVATION_ENTER_ALTITUDE_M = ACTIVATION_ALTITUDE_M - 10_000;
const ACTIVATION_EXIT_ALTITUDE_M = ACTIVATION_ALTITUDE_M + 10_000;
/** Debounce (ms) on camera-driven viewport reloads. */
const CAMERA_DEBOUNCE_MS = 420;
/** Poll cadence (ms). French feeds republish every 10–60 s. */
const POLL_INTERVAL_MS = 15_000;
/** Request timeout (ms) for one viewport query. */
const REQUEST_TIMEOUT_MS = 20_000;
/**
 * Bounds on the glide window (ms) between two reported fixes. The floor keeps a
 * burst of fast refreshes from making the fleet stutter; the ceiling matches
 * the proxy's serve-stale window, past which a feed is not reporting at all.
 */
const TWEEN_MIN_MS = 3_000;
const TWEEN_MAX_MS = 90_000;
/** A fix older than this is dropped: the vehicle stopped reporting. */
const MAX_FIX_AGE_MS = 10 * 60 * 1000;
/** Hard cap on rendered glyphs, independent of what the proxy returns. */
const MAX_RENDERED_VEHICLES = 4_000;
/** Metres above the resolved ground floor the glyph sits. */
const GLYPH_LIFT_M = 4;

// --- Presentation -----------------------------------------------------------
/** Rendered glyph size (px). Tracked/selected uses the larger box. */
const GLYPH_PX = 17;
const GLYPH_SELECTED_PX = 24;
/**
 * Per-mode tint. Amber-through-violet keeps ground transit visually separate
 * from aircraft (white/cyan) and vessels (teal) at a glance, and the ramp runs
 * warm (dense urban service) to cool (sparse, on-demand or seasonal).
 */
const MODE_COLORS = Object.freeze({
  urban: '#ffc93c',
  intercity: '#7ee787',
  school: '#ff8f3f',
  zonal_drt: '#c792ea',
  seasonal: '#5ec8f0',
  long_distance: '#8ab4f8',
});
const DEFAULT_MODE_COLOR = '#ffc93c';
const SELECTED_COLOR = '#00ffff';

/** Human labels for the GTFS-RT stop status enum. */
const STATUS_LABELS = Object.freeze({
  'in-transit': 'in transit',
  incoming: 'arriving',
  stopped: 'at stop',
});
/** Human labels for the GTFS-RT occupancy enum. */
const OCCUPANCY_LABELS = Object.freeze({
  empty: 'empty',
  'many-seats': 'many seats',
  'few-seats': 'few seats',
  'standing-room': 'standing room',
  crushed: 'crush load',
  full: 'full',
  'not-accepting': 'not boarding',
});

/**
 * Nose-up chevron, white so the billboard tint pipeline owns the colour —
 * identical convention to `aircraftIcons.js`. Drawn in a 96-unit box with the
 * point toward -Y, which is what `screenProjectedRotation` expects.
 */
const CHEVRON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <path d="M48,12 L74,78 L48,64 L22,78 Z" fill="white"
        stroke="rgba(0,0,0,0.42)" stroke-width="4" stroke-linejoin="round"/>
</svg>`;

/**
 * Fallback disc for a vehicle whose feed reports NO bearing. A chevron would
 * claim a heading the operator never published; a disc says "here, direction
 * unknown" — the same rule the CCTV pack applies to unposed cameras.
 */
const DISC_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <circle cx="48" cy="48" r="27" fill="white" stroke="rgba(0,0,0,0.42)" stroke-width="5"/>
</svg>`;

const CHEVRON_URI = `data:image/svg+xml;base64,${btoa(CHEVRON_SVG)}`;
const DISC_URI = `data:image/svg+xml;base64,${btoa(DISC_SVG)}`;

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});
let _overlayHost = DEFAULT_OVERLAY_HOST;

// --- Runtime state ----------------------------------------------------------
let _viewer = null;
let _billboards = null;
/** id -> render record */
let _records = new Map();
let _enabled = false;
let _clickHandler = null;
let _cameraChangedAttached = false;
let _cameraDebounceTimer = null;
let _preRenderRemover = null;
let _lastCameraPoseSignature = '';
let _selectedId = null;
let _inFlight = null;
let _requestGeneration = 0;
let _loading = false;
let _error = null;
let _status = 'idle';
let _count = 0;
let _lastUpdate = null;
let _feedSummaries = [];
let _feedsMatched = 0;
let _feedsTruncated = false;
let _vehiclesTruncated = false;
let _renderTruncated = false;
let _lastBox = null;

/** Colour for a service mode, falling back to the urban tint. */
export function transitModeColor(mode) {
  return MODE_COLORS[mode] || DEFAULT_MODE_COLOR;
}

/** Display label for a service mode. */
export function transitModeLabel(mode) {
  return PAN_MODE_LABELS[mode] || (mode ? String(mode) : 'Transit');
}

/**
 * Camera view box, clamped to the proxy's request ceiling.
 *
 * A view wider than {@link PAN_MAX_BOX_DEG} is NOT clipped down to a smaller
 * centred box: that would silently show a slice of the screen's worth of
 * vehicles and read as "this is everything". It returns null, and the layer
 * reports its `zoom-in` guidance state instead.
 *
 * @param {Cesium.Viewer} viewer
 * @returns {?{south:number, west:number, north:number, east:number}}
 */
export function cameraTransitBox(viewer) {
  const rectangle = viewer?.camera?.computeViewRectangle?.();
  if (!rectangle) return null;
  const south = Cesium.Math.toDegrees(rectangle.south);
  const north = Cesium.Math.toDegrees(rectangle.north);
  const west = Cesium.Math.toDegrees(rectangle.west);
  const east = Cesium.Math.toDegrees(rectangle.east);
  if (![south, west, north, east].every(Number.isFinite)) return null;
  // A rectangle crossing the antimeridian comes back with west > east. France
  // never straddles it, so this is a horizon-scale view: guidance, not a query.
  if (west >= east || south >= north) return null;
  if (north - south > PAN_MAX_BOX_DEG || east - west > PAN_MAX_BOX_DEG) return null;
  return { south, west, north, east };
}

/**
 * How long a glyph should take to travel between two reported fixes.
 *
 * The honest answer is "as long as the operator took to report them". A single
 * poll-interval glide looks right only for vehicles that report on that
 * cadence: a coach reporting once a minute moves ~1.9 km between fixes, and
 * sliding that across 15 s renders a bus doing 460 km/h, then parking for 45 s.
 * Using the fix delta instead makes the drawn speed the reported speed, and
 * leaves the scene exactly one fix interval behind live — the same convention
 * the flights layer uses, generalized per vehicle rather than per layer.
 *
 * Falls back to the poll interval when a feed publishes no per-vehicle
 * timestamps, and refuses a non-positive delta (a clock that went backwards).
 *
 * @param {?number} previousFixMs Epoch ms of the fix currently drawn.
 * @param {?number} nextFixMs Epoch ms of the fix just received.
 * @returns {number} Glide duration in ms, inside [TWEEN_MIN_MS, TWEEN_MAX_MS].
 */
export function glideDurationMs(previousFixMs, nextFixMs) {
  const delta = (Number.isFinite(previousFixMs) && Number.isFinite(nextFixMs))
    ? nextFixMs - previousFixMs
    : null;
  const span = delta !== null && delta > 0 ? delta : POLL_INTERVAL_MS;
  return Math.min(TWEEN_MAX_MS, Math.max(TWEEN_MIN_MS, span));
}

/** Camera altitude above the ellipsoid, in metres. */
function cameraAltitudeM(viewer) {
  const carto = viewer?.camera?.positionCartographic;
  return Number.isFinite(carto?.height) ? carto.height : Infinity;
}

let _altitudeGateOpen = false;

/** Hysteresis gate on camera altitude. */
function updateAltitudeGate(viewer) {
  const altitude = cameraAltitudeM(viewer);
  if (_altitudeGateOpen) {
    if (altitude > ACTIVATION_EXIT_ALTITUDE_M) _altitudeGateOpen = false;
  } else if (altitude < ACTIVATION_ENTER_ALTITUDE_M) {
    _altitudeGateOpen = true;
  }
  return _altitudeGateOpen;
}

/** World position for a vehicle, on the shared coarse ground floor when warm. */
function vehiclePosition(vehicle) {
  const floor = cachedGroundFloor(vehicle.lat, vehicle.lon);
  const height = (Number.isFinite(floor) ? floor : 0) + GLYPH_LIFT_M;
  return Cesium.Cartesian3.fromDegrees(vehicle.lon, vehicle.lat, height);
}

/**
 * Build the multi-line label for the selected vehicle's card.
 * Every line is a value the feed published; nothing is inferred.
 *
 * @param {Object} record Render record.
 * @param {number} [nowMs]
 * @returns {string} Newline-separated card copy.
 */
export function buildTransitSelectionLabel(record, nowMs = Date.now()) {
  const vehicle = record?.vehicle || {};
  const feed = record?.feed || {};
  const route = vehicle.route ? `LINE ${vehicle.route}` : 'LINE —';
  const title = vehicle.label ? `${route} · ${vehicle.label}` : route;

  const details = [];
  if (feed.network) details.push(`🚍 ${feed.network}`);

  const motion = [];
  if (Number.isFinite(vehicle.speedMps)) {
    motion.push(`${Math.round(vehicle.speedMps * 3.6)} km/h`);
  }
  if (Number.isFinite(vehicle.bearing)) motion.push(`${Math.round(vehicle.bearing)}°`);
  if (vehicle.status) motion.push(STATUS_LABELS[vehicle.status] || vehicle.status);
  if (motion.length) details.push(motion.join(' · '));

  if (vehicle.occupancy) {
    details.push(`👥 ${OCCUPANCY_LABELS[vehicle.occupancy] || vehicle.occupancy}`);
  }

  // Fix age, not render age: the glyph is mid-glide between two real fixes, and
  // the card must report the newest one the operator actually published.
  if (Number.isFinite(vehicle.timestampMs)) {
    const ageSec = Math.max(0, Math.round((nowMs - vehicle.timestampMs) / 1000));
    details.push(ageSec < 60 ? `⏱ fix ${ageSec}s ago` : `⏱ fix ${Math.round(ageSec / 60)}m ago`);
  }

  const provenance = [transitModeLabel(vehicle.mode)];
  if (hasText(feed.licence)) provenance.push(feed.licence);
  details.push(provenance.join(' · '));

  return [title, ...details].join('\n');
}

/** Tiny guard kept local so the label builder reads as one expression. */
function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Protected selected-vehicle entry for the shared overlay host.
 * @param {Object} record Render record.
 * @param {number} [nowMs]
 * @returns {?Object}
 */
export function createTransitSelectedOverlayEntry(record, nowMs = Date.now()) {
  const position = record?.renderPosition;
  if (!record?.id || !position) return null;
  const [title, ...details] = buildTransitSelectionLabel(record, nowMs).split('\n');
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

/** Clear the selection, restoring the base glyph. */
function clearSelection() {
  if (_selectedId) {
    const record = _records.get(_selectedId);
    if (record?.billboard) {
      record.billboard.color = Cesium.Color.fromCssColorString(transitModeColor(record.vehicle.mode));
      record.billboard.width = GLYPH_PX;
      record.billboard.height = GLYPH_PX;
    }
  }
  _selectedId = null;
  _overlayHost.clearSource(TRANSIT_FR_OVERLAY_SOURCE_ID);
}

/** Select a vehicle by render id. */
function selectVehicle(id) {
  clearSelection();
  const record = _records.get(id);
  if (!record || !_viewer) return;
  _selectedId = id;
  if (record.billboard) {
    record.billboard.color = Cesium.Color.fromCssColorString(SELECTED_COLOR);
    record.billboard.width = GLYPH_SELECTED_PX;
    record.billboard.height = GLYPH_SELECTED_PX;
  }
  publishSelectionCard(record);
  governorRequestRender('transit-fr-select');
}

/** Push (or refresh) the selected card. Called on select and on every glide tick. */
function publishSelectionCard(record) {
  const entry = createTransitSelectedOverlayEntry(record);
  if (!entry) return;
  _overlayHost.setEntries(
    TRANSIT_FR_OVERLAY_SOURCE_ID,
    [entry],
    TRANSIT_FR_OVERLAY_SOURCE_OPTIONS,
  );
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
        selectVehicle(primitiveId);
        return;
      }
      if (typeof picked.id === 'string' && _records.has(picked.id)) {
        selectVehicle(picked.id);
        return;
      }
    }
    if (_selectedId) clearSelection();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  document.addEventListener('keydown', onKeyDown);
}

/**
 * Per-frame glide + icon-orientation pass.
 *
 * Two jobs, both cheap: advance each record along the segment between its two
 * most recent REPORTED fixes, and — only when the camera pose actually changed
 * — recompute the screen-space rotation that points a chevron along its
 * real-world bearing.
 */
function onPreRender() {
  if (!_enabled || !_records.size) return;
  const scene = _viewer?.scene;
  const camera = _viewer?.camera;
  if (!scene || !camera) return;

  const now = Date.now();
  const poseSignature = cameraPoseSignature(camera);
  const poseChanged = poseSignature !== _lastCameraPoseSignature;
  if (poseChanged) _lastCameraPoseSignature = poseSignature;
  // Glyphs draw with depth testing disabled so a bus is never swallowed by the
  // building next to it — which also means a bus on the FAR side of the planet
  // would otherwise paint straight through the globe at horizon-scale pitch.
  const occluder = poseChanged ? horizonOccluder(camera) : null;

  let moving = false;
  for (const record of _records.values()) {
    const billboard = record.billboard;
    if (!billboard) continue;

    if (record.tweenMs > 0 && record.from && record.to) {
      const t = Math.min(1, (now - record.tweenStart) / record.tweenMs);
      if (t < 1) moving = true;
      Cesium.Cartesian3.lerp(record.from, record.to, t, record.renderPosition);
      billboard.position = record.renderPosition;
    }

    if (occluder) {
      billboard.show = occluder.isPointVisible(record.renderPosition);
    }
    if (!billboard.show) continue;

    if (poseChanged && record.hasBearing) {
      const rotation = screenProjectedRotation(
        scene, record.renderPosition, record.vehicle.bearing, billboard.rotation,
      );
      if (rotation !== null && Math.abs(rotation - billboard.rotation) > 0.002) {
        billboard.rotation = rotation;
      }
    }
  }

  if (_selectedId) {
    const record = _records.get(_selectedId);
    if (record) {
      publishSelectionCard(record);
    }
  }

  // Belt-and-braces with the enable-time hold: a frame requested here also
  // covers the window between a reconcile and the hold being observed.
  if (moving) governorRequestRender('transit-fr-glide');
}

/**
 * Reconcile a viewport answer against the rendered fleet.
 *
 * Identity is the proxy's `feedId:vehicleId`, so a vehicle keeps its record —
 * and therefore its glide and its selection — across polls.
 *
 * @param {Array<Object>} vehicles Wire records.
 * @param {Map<string, Object>} feedsById Feed metadata by id.
 * @param {number} nowMs
 */
function reconcile(vehicles, feedsById, nowMs) {
  const seen = new Set();
  let rendered = 0;
  _renderTruncated = false;

  for (const vehicle of vehicles) {
    if (rendered >= MAX_RENDERED_VEHICLES) {
      // The proxy answered with more than this client will draw. Say so rather
      // than quietly presenting a partial fleet as the whole viewport.
      _renderTruncated = true;
      break;
    }
    if (Number.isFinite(vehicle.timestampMs) && nowMs - vehicle.timestampMs > MAX_FIX_AGE_MS) continue;
    const id = vehicle.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    rendered += 1;

    const position = vehiclePosition(vehicle);
    const feed = feedsById.get(vehicle.feed) || {};
    let record = _records.get(id);

    if (!record) {
      const billboard = _billboards.add({
        id,
        position,
        image: Number.isFinite(vehicle.bearing) ? CHEVRON_URI : DISC_URI,
        width: GLYPH_PX,
        height: GLYPH_PX,
        color: Cesium.Color.fromCssColorString(transitModeColor(vehicle.mode)),
        rotation: 0,
        alignedAxis: Cesium.Cartesian3.ZERO,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        translucencyByDistance: new Cesium.NearFarScalar(1_000, 1.0, 260_000, 0.35),
      });
      record = {
        id,
        billboard,
        vehicle,
        feed,
        hasBearing: Number.isFinite(vehicle.bearing),
        from: position.clone(),
        to: position.clone(),
        renderPosition: position.clone(),
        tweenStart: nowMs,
        tweenMs: 0,
        fixMs: Number.isFinite(vehicle.timestampMs) ? vehicle.timestampMs : null,
      };
      _records.set(id, record);
      // A brand-new glyph has no rotation and no visibility decision yet, and
      // the per-frame pass only runs those when the CAMERA moved. Invalidate
      // the pose signature so the next frame treats this as a fresh scene.
      _lastCameraPoseSignature = '';
      continue;
    }

    // Existing contact: glide from where it is being DRAWN to the new fix, so
    // a mid-glide refresh redirects smoothly instead of snapping back.
    const moved = !Cesium.Cartesian3.equalsEpsilon(record.renderPosition, position, 0, 0.5);
    const previousFixMs = record.fixMs;
    const nextFixMs = Number.isFinite(vehicle.timestampMs) ? vehicle.timestampMs : null;
    record.vehicle = vehicle;
    record.feed = feed;
    const hasBearing = Number.isFinite(vehicle.bearing);
    if (hasBearing !== record.hasBearing) {
      record.hasBearing = hasBearing;
      record.billboard.image = hasBearing ? CHEVRON_URI : DISC_URI;
      if (!hasBearing) record.billboard.rotation = 0;
    }
    if (id !== _selectedId) {
      record.billboard.color = Cesium.Color.fromCssColorString(transitModeColor(vehicle.mode));
    }
    if (moved) {
      Cesium.Cartesian3.clone(record.renderPosition, record.from);
      Cesium.Cartesian3.clone(position, record.to);
      record.tweenStart = nowMs;
      record.tweenMs = glideDurationMs(previousFixMs, nextFixMs);
    } else {
      record.tweenMs = 0;
      Cesium.Cartesian3.clone(position, record.renderPosition);
      record.billboard.position = record.renderPosition;
    }
    if (nextFixMs !== null) record.fixMs = nextFixMs;
  }

  for (const [id, record] of [..._records]) {
    if (seen.has(id)) continue;
    if (id === _selectedId) clearSelection();
    _billboards.remove(record.billboard);
    _records.delete(id);
  }

  _count = _records.size;
  // Warm the shared ground-floor cells for what is on screen; the next poll
  // reads them synchronously and the fleet settles onto the real surface.
  warmGroundFloor(vehicles.slice(0, 600));
  governorRequestRender('transit-fr-reconcile');
}

/** Drop every rendered glyph without touching feed/loading state. */
function clearFleet() {
  clearSelection();
  if (_billboards) _billboards.removeAll();
  _records.clear();
  _count = 0;
}

/**
 * Load the vehicles for the current camera box.
 * @param {Object} [options]
 * @param {boolean} [options.force] Bypass the "box did not change" short-circuit.
 * @returns {Promise<void>}
 */
async function loadViewport({ force = false } = {}) {
  if (!_enabled || !_viewer) return;

  if (!updateAltitudeGate(_viewer)) {
    _status = 'zoom-in';
    _error = null;
    _loading = false;
    if (_records.size) clearFleet();
    return;
  }

  const box = cameraTransitBox(_viewer);
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
    const response = await fetch(`/api/transit-fr/vehicles?${params}`, { signal: controller.signal });
    if (generation !== _requestGeneration) return;
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const body = await response.json();
        if (body?.error) detail = body.missingIndex ? 'feed index missing' : String(body.error);
      } catch { /* keep the status-code detail */ }
      throw new Error(detail);
    }
    const payload = await response.json();
    if (generation !== _requestGeneration || !_enabled) return;

    const feedsById = new Map((payload.feeds || []).map((feed) => [feed.id, feed]));
    reconcile(Array.isArray(payload.vehicles) ? payload.vehicles : [], feedsById, Date.now());

    _feedSummaries = payload.feeds || [];
    _feedsMatched = Number(payload.feedsMatched) || 0;
    _feedsTruncated = payload.feedsTruncated === true;
    _vehiclesTruncated = payload.vehiclesTruncated === true;
    _lastUpdate = Date.now();
    _error = null;
    _status = _count > 0 ? 'ready' : 'empty';
  } catch (error) {
    if (error?.name === 'AbortError') return;
    if (generation !== _requestGeneration) return;
    console.warn('[Data:TransitFR] viewport load failed:', error?.message || error);
    _error = error?.message || 'transit feed unavailable';
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

/** Deterministic subsample of rendered vehicles for the detection overlay. */
function collectDetectableVehicles(options = {}) {
  if (!_enabled || !_billboards?.show || !_records.size) return [];
  const records = [];
  for (const record of _records.values()) {
    if (!record.billboard?.show && record.id !== _selectedId) continue;
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
      position: record.renderPosition,
      sourceId: record.id,
      id: record.vehicle.route ? `LN ${record.vehicle.route}` : 'TRANSIT',
      type: 'VEH',
      skipLabel: record.id === _selectedId,
    });
    if (result.length >= maxCount) break;
  }
  return result;
}

/** Short provenance line for the control-panel row. */
function buildLoadingLabel() {
  if (_status === 'zoom-in') return 'zoom in to load live transit';
  if (_loading) return _records.size ? 'refreshing networks...' : 'resolving networks...';
  if (_status === 'empty') {
    return _feedsMatched > 0 ? 'no vehicles reporting here' : 'no PAN feed covers this view';
  }
  const networks = _feedSummaries.filter((feed) => feed.inView > 0).length;
  const parts = [`${networks} network${networks === 1 ? '' : 's'}`];
  if (_feedsTruncated) parts.push(`${_feedsMatched} in range`);
  if (_vehiclesTruncated || _renderTruncated) parts.push('capped');
  const stale = _feedSummaries.filter((feed) => feed.stale).length;
  if (stale) parts.push(`${stale} stale`);
  return parts.join(' · ');
}

/**
 * Live French ground-transit layer.
 * @type {Object}
 */
const transitFranceLayer = {
  id: TRANSIT_FR_LAYER_ID,
  name: 'Transit FR',
  icon: '🚌',
  source: 'transport.data.gouv.fr',
  updateInterval: POLL_INTERVAL_MS,

  /** Create the billboard collection and reset all state. */
  init(viewer) {
    _viewer = viewer;
    _billboards = new Cesium.BillboardCollection({
      blendOption: Cesium.BlendOption.TRANSLUCENT,
    });
    _billboards.show = false;
    viewer.scene.primitives.add(_billboards);
    registerSpriteCollection(TRANSIT_FR_LAYER_ID, _billboards);

    _enabled = false;
    _records = new Map();
    _selectedId = null;
    _count = 0;
    _lastUpdate = null;
    _loading = false;
    _error = null;
    _status = 'idle';
    _feedSummaries = [];
    _feedsMatched = 0;
    _feedsTruncated = false;
    _vehiclesTruncated = false;
    _renderTruncated = false;
    _lastBox = null;
    _altitudeGateOpen = false;

    _overlayHost.setVisible(TRANSIT_FR_OVERLAY_SOURCE_ID, false);
    restoreSpriteOrder(viewer);
  },

  /** Show the fleet, attach camera + frame listeners, and load the viewport. */
  enable(viewer) {
    _enabled = true;
    _error = null;
    _lastCameraPoseSignature = '';
    _billboards.show = true;
    // A fleet mid-glide is a per-frame animation, and the glide is driven from
    // preRender — which only fires when a frame renders. Under the idle render
    // governor that is circular: no frame, no preRender, no motion, nothing to
    // ask for the next frame. So the layer takes an explicit continuous-render
    // hold for as long as it is on, exactly like the satellite animator.
    holdContinuousRender('transit-fr');
    _overlayHost.setVisible(TRANSIT_FR_OVERLAY_SOURCE_ID, true);
    installClickHandler(viewer);
    registerPickOwner(TRANSIT_FR_LAYER_ID, (pickedId) => _records.has(pickedId));

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

  /** Hide the fleet, detach every listener, abort in-flight work. */
  disable(viewer) {
    _enabled = false;
    _requestGeneration += 1;
    _altitudeGateOpen = false;
    clearTimeout(_cameraDebounceTimer);
    _cameraDebounceTimer = null;
    _inFlight?.abort?.();
    _inFlight = null;

    clearFleet();
    _overlayHost.setVisible(TRANSIT_FR_OVERLAY_SOURCE_ID, false);

    if (_clickHandler) {
      _clickHandler.destroy();
      _clickHandler = null;
    }
    document.removeEventListener('keydown', onKeyDown);
    unregisterPickOwner(TRANSIT_FR_LAYER_ID);

    if (_cameraChangedAttached) {
      viewer.camera.changed.removeEventListener(onCameraChanged);
      _cameraChangedAttached = false;
    }
    if (_preRenderRemover) {
      _preRenderRemover();
      _preRenderRemover = null;
    }

    _billboards.show = false;
    _loading = false;
    _status = 'idle';
    _feedSummaries = [];
    _lastBox = null;
    releaseContinuousRender('transit-fr');
  },

  /** Poll tick — re-read the current viewport. */
  async update() {
    if (!_enabled) return;
    await loadViewport({ force: true });
  },

  getDetectableObjects(options = {}) {
    return collectDetectableVehicles(options);
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
    if (_feedSummaries.some((feed) => feed.stale)) stats.stale = true;
    if (_error) stats.error = _error;
    return stats;
  },

  /** Feed provenance for the attribution popover and the analyst surfaces. */
  getFeedSummaries() {
    return _feedSummaries.map((feed) => ({ ...feed }));
  },

  /**
   * Colour legend for the control-panel row.
   *
   * The tally counts RENDERED vehicles per declared service class, so the
   * legend describes what is on screen right now rather than what the PAN
   * catalog says exists. Modes with nothing in view are omitted — an entry
   * reading "Intercity 0" implies coverage that this viewport does not have.
   * @returns {{ chips: Array<object>, legend: Array<object> }}
   */
  getRowControls() {
    const tally = new Map();
    for (const record of _records.values()) {
      const mode = record.vehicle?.mode || 'urban';
      tally.set(mode, (tally.get(mode) || 0) + 1);
    }
    const legend = [...tally.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([mode, count]) => ({
        label: transitModeLabel(mode),
        color: transitModeColor(mode),
        count,
        blurb: 'Service class declared by the network, not the vehicle type — '
          + 'GTFS-Realtime carries no route_type.',
      }));
    return { chips: [], legend };
  },

  destroy(viewer) {
    if (_enabled) this.disable(viewer);
    else {
      clearSelection();
      _overlayHost.setVisible(TRANSIT_FR_OVERLAY_SOURCE_ID, false);
      if (_clickHandler) {
        _clickHandler.destroy();
        _clickHandler = null;
      }
      document.removeEventListener('keydown', onKeyDown);
      unregisterPickOwner(TRANSIT_FR_LAYER_ID);
    }
    if (_preRenderRemover) {
      _preRenderRemover();
      _preRenderRemover = null;
    }
    if (_billboards) {
      unregisterSpriteCollection(TRANSIT_FR_LAYER_ID, _billboards);
      viewer.scene.primitives.remove(_billboards);
      _billboards = null;
    }
    releaseContinuousRender('transit-fr');
    _records.clear();
    _viewer = null;
  },
};

/** Seed rendered records so selection/card/legend paths run without WebGL. */
export function _setTransitStateForTest({ viewer, record, records, overlayHost }) {
  const seeded = records || (record ? [record] : []);
  _viewer = viewer || null;
  _records = new Map(seeded.map((entry) => [entry.id, entry]));
  _selectedId = null;
  _overlayHost = overlayHost || DEFAULT_OVERLAY_HOST;
}

/** Exercise the production selection path in focused runtime tests. */
export function _selectTransitVehicleForTest(id) {
  selectVehicle(id);
}

/** Exercise the production clear path and restore the production host seam. */
export function _clearTransitSelectionForTest() {
  clearSelection();
  _overlayHost = DEFAULT_OVERLAY_HOST;
}

export default transitFranceLayer;
