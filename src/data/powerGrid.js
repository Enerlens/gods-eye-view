import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import { registerSpriteCollection, restoreSpriteOrder, unregisterSpriteCollection } from './spriteOrder.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import { cachedGroundFloor, warmGroundFloor } from './groundFloor.js';
import { horizonOccluder } from './iconOrientation.js';
import {
  clearOverlaySource,
  hitTestWorldOverlay,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { pickOverlayLabelId } from './overlayLabelPick.js';
import {
  POWER_GRID_MAX_BOX_DEG,
  POWER_GRID_TIERS,
  POWER_GRID_TOWER_MAX_BOX_DEG,
  POWER_SUBSTATION_ROLE_UNSTATED,
  formatKilovolts,
  powerBoxTooWide,
  powerTierById,
} from './powerGridFeed.js';
import { applyViewGate } from './viewGate.js';

/**
 * Power Grid — the high-voltage network as OpenStreetMap has mapped it, for the
 * viewport you are looking at.
 *
 * Three things, drawn together because the grid only reads as a system when
 * they are:
 *
 *   **the routes**  — `power=line` and `power=cable` ways at 50 kV and above,
 *                     clamped to the ground, coloured by voltage band, with the
 *                     underground half dashed so it is never mistaken for a
 *                     pylon route
 *   **the nodes**   — `power=substation` yards at the same voltages, sized by
 *                     band, which is where those routes actually terminate
 *   **the pylons**  — `power=tower` / `power=portal`, but only once you are
 *                     close enough for a pylon to be a thing rather than a dot
 *
 * Keyless, ODbL 1.0, all through the `/api/power-grid` proxy. The upstream traps
 * live in `powerGridFeed.js` under test against a captured Overpass response;
 * this module is the drawing.
 *
 * ── What the drawing is careful about ───────────────────────────────────────
 *
 * • **A stroke is on the ground because the height is not published.** A 400 kV
 *   conductor hangs 20-40 m up and OSM records that for about a third of pylons
 *   and for no line at all. So the routes are clamped ground polylines — the
 *   mapped ROUTE, drawn where it is known to be — and the card says so. Lifting
 *   them to a plausible catenary would be inventing the one number the data
 *   withholds.
 *
 * • **This is volunteer mapping, not a grid register.** RTE publishes no public
 *   geometry, which is why this layer exists at all; OSM's coverage of it is
 *   excellent in France and uneven elsewhere. An empty viewport means nothing is
 *   MAPPED there, and the empty state says exactly that rather than "no grid".
 *
 * • **Voltage is the filter because voltage is the evidence.** Anything OSM has
 *   not given a voltage is not drawn — not demoted, not guessed. That is also
 *   why the legend counts by band rather than by feature type.
 *
 * • **A stroke is not a line.** OSM splits one named liaison across dozens of
 *   ways at every junction and attribute change, so the layer reports both: the
 *   stroke count it drew, and the distinct mapped ROUTE names behind them.
 *
 * • **The ground is where these objects are.** Substations and pylons sit on the
 *   local ground floor, and strokes are clamped ground polylines classified
 *   against ONLY the active surface — the rule the submarine-cable, Vigicrues
 *   and gas layers established, with BOTH as the safe fallback for an unknown
 *   stack.
 */

const GRID_URL = '/api/power-grid';

/** Layer id — also the share-link registry key and the voice-tool enum value. */
export const POWER_GRID_LAYER_ID = 'power-grid';
/** Ambient labels: the named high-voltage yards, which are the readable nodes. */
export const POWER_GRID_OVERLAY_SOURCE_ID = 'power-grid';
/** Selected-object card, on its own protected source. */
export const POWER_GRID_SELECTED_OVERLAY_SOURCE_ID = 'power-grid-selected';
/** Ambient-label entry-id prefix — the click surface the yard's NAME provides. */
export const POWER_GRID_LABEL_PREFIX = 'power-grid-label:';
/** Ambient-label cohort ceiling — the grid nodes worth naming at a glance. */
export const POWER_GRID_OVERLAY_COHORT_LIMIT = 14;
/** Shared ambient-label paint budget, matching the sibling infrastructure layers. */
export const POWER_GRID_OVERLAY_COLLISION_CAPACITY = 14;

export const POWER_GRID_SELECTED_OVERLAY_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 1,
  moving: false,
});

/** Debounce between the camera settling and the request that follows it. */
const REQUEST_DEBOUNCE_MS = 500;
/** First step of the failed-load backoff, and its ceiling. */
const RETRY_MIN_MS = 20_000;
const RETRY_CEIL_MS = 240_000;
/**
 * Idle refresh cadence. A transmission line is built over a decade and mapped
 * once; this exists so a session left open overnight picks up an edit, not
 * because anything is expected to move. The proxy holds 10 min in memory and
 * 7 days on disk in front of Overpass.
 */
const UPDATE_INTERVAL_MS = 20 * 60_000;
const REQUEST_TIMEOUT_MS = 60_000;

/** Points sit this far above the local ground floor. */
const POINT_LIFT_M = 2.5;

/** Pylons: small, dim, and never competing with the routes they carry. */
const TOWER_COLOR = '#9fb0c4';
const TOWER_POINT_PX = 4;
const PORTAL_POINT_PX = 5;

const SELECTED_COLOR = '#00ffff';
const SELECTED_POINT_PX = 20;
const SELECTED_STROKE_WIDTH = 6;

/** Stroke opacity — quiet infrastructure, not a warning. */
const STROKE_ALPHA = 0.9;
/** Underground strokes are dashed AND slightly dimmer: they are not overhead. */
const UNDERGROUND_ALPHA = 0.72;
const UNDERGROUND_DASH_LENGTH = 14;

/** Substation outline, so a yard reads as a node rather than a fat line vertex. */
const SUBSTATION_OUTLINE_ALPHA = 0.65;

/**
 * `MAP_STACKS` ids that render imagery on the SHOWN Cesium globe. An explicit
 * allowlist for the same reason the cable and gas layers keep one: a stack id
 * this module has never heard of must reach the documented BOTH fallback rather
 * than be asserted onto a surface that is not there.
 */
const POWER_GLOBE_STACK_IDS = Object.freeze(new Set(['bing-aerial', 'bing-labels', 'osm', 'ign-ortho', 'ign-plan']));

/**
 * Ground-line classification for one map stack.
 * @param {string|null|undefined} activeId MapStackController stack id.
 * @returns {Cesium.ClassificationType}
 */
export function powerClassificationTypeForStack(activeId) {
  if (activeId === 'photoreal') return Cesium.ClassificationType.CESIUM_3D_TILE;
  if (POWER_GLOBE_STACK_IDS.has(activeId)) return Cesium.ClassificationType.TERRAIN;
  return Cesium.ClassificationType.BOTH;
}

/**
 * Derive the active surface from live scene state, for the boot-time stack
 * settle that fires no `gev:map-stack-changed` event.
 * @param {Cesium.Scene|null|undefined} scene
 * @returns {Cesium.ClassificationType}
 */
export function powerClassificationTypeForScene(scene) {
  if (!scene?.globe) return Cesium.ClassificationType.BOTH;
  return scene.globe.show === false
    ? Cesium.ClassificationType.CESIUM_3D_TILE
    : Cesium.ClassificationType.TERRAIN;
}

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
  hitTest: hitTestWorldOverlay,
});

/**
 * The viewport this layer will ask for, or null when the camera is too high.
 *
 * A view wider than the proxy's own ceiling is a continental one, where every
 * mapped way in France would be a single grey smear and the element caps would
 * truncate arbitrarily. Rather than serve a truncated smear, the layer says
 * "zoom in" — the same contract the mapped-installation layer uses.
 *
 * @param {Cesium.Viewer|null} viewer
 * @returns {?{south:number, west:number, north:number, east:number}}
 */
export function powerViewportBox(viewer) {
  const rectangle = viewer?.camera?.computeViewRectangle(viewer.scene.globe.ellipsoid);
  if (!rectangle) return null;
  const south = Cesium.Math.toDegrees(rectangle.south);
  const north = Cesium.Math.toDegrees(rectangle.north);
  const west = Cesium.Math.toDegrees(rectangle.west);
  const east = Cesium.Math.toDegrees(rectangle.east);
  if (!Number.isFinite(south + north + west + east)) return null;
  // A cross-dateline or global view requires a zoom before a bounded request.
  if (east <= west || north <= south) return null;
  // Shares the proxy's own tolerant comparison, so the client can never ask for
  // a box the proxy will then refuse on a floating-point hair.
  if (powerBoxTooWide({ south, west, north, east })) return null;
  return { south, west, north, east };
}

/**
 * Pixel size for a substation, from its voltage band.
 * A yard whose band is somehow unknown still draws, at the floor size, so it is
 * present and visibly unquantified rather than absent.
 * @param {?string} tierId
 * @returns {number}
 */
export function substationPointSize(tierId) {
  return powerTierById(tierId)?.pointPx ?? POWER_GRID_TIERS.at(-1).pointPx;
}

/**
 * Format a network length the way a control room writes it.
 * @param {?number} km
 * @returns {string}
 */
export function formatGridKm(km) {
  if (!Number.isFinite(km)) return '—';
  if (km >= 100) return `${Math.round(km).toLocaleString('en-US')} km`;
  return `${km.toFixed(1)} km`;
}

/**
 * Card copy for a selected object. Every line is a mapped value or a stated
 * limit of the data — never an inference from one.
 *
 * @param {object} record Render record (`kind` is `stroke`, `substation` or `tower`).
 * @param {object} payload The loaded document, for its dictionaries.
 * @returns {string} Newline-separated card copy.
 */
export function buildPowerSelectionLabel(record, payload = {}) {
  const operators = Array.isArray(payload.operators) ? payload.operators : [];
  const routes = Array.isArray(payload.routes) ? payload.routes : [];
  const voltages = Array.isArray(payload.voltages) ? payload.voltages : [];
  const details = [];
  const operatorOf = (item) => (item?.o >= 0 ? operators[item.o] : null);

  if (record?.kind === 'stroke') {
    const stroke = record.stroke || {};
    const voltage = voltages[stroke.vi] || {};
    const name = stroke.n >= 0 ? routes[stroke.n] : null;
    const title = name || `${formatKilovolts(voltage.v)} ${stroke.u ? 'cable' : 'line'}`;
    details.push(`⚡ ${formatKilovolts(voltage.v)}${
      voltage.all?.length > 1 ? ` · mapped as ${voltage.raw}` : ''
    }`);
    const operator = operatorOf(stroke);
    if (operator) details.push(`🏢 ${operator}`);
    if (Number.isFinite(stroke.circuits)) details.push(`⌇ ${stroke.circuits} circuits mapped`);
    details.push(stroke.u
      ? '⌄ Underground cable — no pylons on this route'
      : '⌃ Overhead line — drawn on the ground, not at conductor height');
    if (Number.isFinite(stroke.km)) details.push(`↔ ${formatGridKm(stroke.km)} of this mapped way`);
    details.push('© OpenStreetMap contributors (ODbL 1.0)');
    return [title, ...details].join('\n');
  }

  if (record?.kind === 'tower') {
    const tower = record.tower || {};
    const title = tower.portal ? 'Portal' : 'Pylon';
    if (tower.ref) details.push(`# ${tower.ref}`);
    if (tower.design) details.push(`△ ${String(tower.design).replaceAll('_', ' ')}`);
    // Height is mapped for about a third of pylons; the rest say nothing and
    // this card says nothing rather than a prior.
    details.push(Number.isFinite(tower.h) ? `↕ ${tower.h} m tall` : '↕ height not mapped');
    const operator = operatorOf(tower);
    if (operator) details.push(`🏢 ${operator}`);
    details.push('© OpenStreetMap contributors (ODbL 1.0)');
    return [title, ...details].join('\n');
  }

  const substation = record?.substation || {};
  const voltage = voltages[substation.vi] || {};
  const title = substation.name || (substation.ref ? `Substation ${substation.ref}` : 'Substation');
  details.push(`⚡ ${formatKilovolts(voltage.v)}${
    voltage.all?.length > 1 ? ` · mapped as ${voltage.raw}` : ''
  }`);
  details.push(`▣ ${substation.roleLabel || POWER_SUBSTATION_ROLE_UNSTATED}`);
  const operator = operatorOf(substation);
  if (operator) details.push(`🏢 ${operator}`);
  if (substation.ref) details.push(`# ${substation.ref}`);
  details.push('Position is the mapped yard’s centre');
  details.push('© OpenStreetMap contributors (ODbL 1.0)');
  return [title, ...details].join('\n');
}

/**
 * Protected selected-object entry for the shared overlay host.
 * @param {object} record
 * @param {object} payload
 * @returns {?object}
 */
export function createPowerSelectedOverlayEntry(record, payload) {
  const position = record?.position;
  if (!record?.id || !position) return null;
  const [title, ...details] = buildPowerSelectionLabel(record, payload).split('\n');
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

/**
 * Ambient label for one substation.
 * @param {object} substation
 * @param {Cesium.Cartesian3} position
 * @param {object} payload
 * @returns {object}
 */
export function createSubstationOverlayEntry(substation, position, payload = {}) {
  const voltage = payload.voltages?.[substation.vi] || {};
  const tier = powerTierById(voltage.tier);
  const name = substation.name || `Poste ${substation.ref || ''}`.trim();
  return {
    id: `${POWER_GRID_LABEL_PREFIX}${substation.id}`,
    position,
    variant: 'label',
    title: `${name} · ${formatKilovolts(voltage.v)}`,
    accent: tier?.color || POWER_GRID_TIERS.at(-1).color,
    // The highest-voltage yard wins the collision; ties break on id.
    priority: Number.isFinite(voltage.v) ? Math.round(voltage.v) : 0,
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    // The yard's name is a click surface, not a caption — see
    // `overlayLabelPick.js` for the mechanism and the pick-ordering rule.
    interactive: true,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 15,
    verticalOnly: true,
    placement: 'above',
  };
}

/**
 * Which substations get a name on screen: the highest-voltage NAMED ones.
 *
 * An unnamed yard is excluded rather than labelled from its reference code — a
 * floating "SACL5" reads as noise, and the code is on the card for anyone who
 * clicks. Stable identity is the tie-break so the same yards keep their labels
 * across a pan.
 *
 * @param {Array<object>} entries
 * @param {number} [limit]
 * @returns {Array<object>}
 */
export function selectPowerOverlayCohort(entries, limit = POWER_GRID_OVERLAY_COHORT_LIMIT) {
  const cap = Math.max(0, Math.min(
    POWER_GRID_OVERLAY_COHORT_LIMIT,
    Math.floor(Number(limit) || 0),
  ));
  if (!Array.isArray(entries) || cap === 0) return [];
  return entries.slice().sort((a, b) => (
    b.priority - a.priority || String(a.id).localeCompare(String(b.id))
  )).slice(0, cap);
}

/**
 * Map one substation to a JSON-safe analyst record. Pure — no Cesium types.
 *
 * Only substations: a stroke is a fragment of a route and a pylon is a pole,
 * and neither is an object anyone asks a question about.
 *
 * @param {object|null|undefined} substation
 * @param {object} [payload]
 * @param {number} [index=0]
 * @returns {object}
 */
export function mapPowerAnalystRecord(substation, payload = {}, index = 0) {
  const str = (value) => {
    const trimmed = String(value ?? '').trim();
    return trimmed || null;
  };
  const voltage = payload.voltages?.[substation?.vi] || {};
  const operators = Array.isArray(payload.operators) ? payload.operators : [];
  return {
    id: str(substation?.id) || `GRID-${String(index).padStart(4, '0')}`,
    name: str(substation?.name),
    kind: 'substation',
    lat: Number.isFinite(substation?.lat) ? substation.lat : null,
    lon: Number.isFinite(substation?.lon) ? substation.lon : null,
    voltageV: Number.isFinite(voltage.v) ? voltage.v : null,
    voltageKv: Number.isFinite(voltage.v) ? Math.round(voltage.v / 1000) : null,
    role: str(substation?.role),
    roleLabel: str(substation?.roleLabel),
    operator: substation?.o >= 0 ? str(operators[substation.o]) : null,
    ref: str(substation?.ref),
  };
}

// --- Module state -----------------------------------------------------------

let _viewer = null;
let _points = null;
let _overlayHost = DEFAULT_OVERLAY_HOST;
let _enabled = false;
let _classificationType = Cesium.ClassificationType.BOTH;
let _mapStackListener = null;
let _clickHandler = null;
let _preRenderRemover = null;
let _moveEndRemover = null;
let _debounceTimer = null;
let _abort = null;
/** Pending timed retry while the last load failed (see scheduleUnavailableRetry). */
let _retryTimer = null;
/** Current backoff step for that retry; 0 = the next failure starts at the minimum. */
let _retryDelayMs = 0;
/** @type {?boolean} `GroundPolylinePrimitive.isSupported`, checked once. */
let _groundLinesSupported = null;

/** @type {Array<Cesium.GroundPolylinePrimitive>} The stroke batches on screen. */
let _strokePrimitives = [];
/**
 * What was handed to Cesium for each batch, paired with the live primitive.
 *
 * Cesium RELEASES `geometryInstances` once a primitive is built
 * (`releaseGeometryInstances` defaults to true), so after the first frame the
 * scene can no longer say what went into a batch — only that a batch exists.
 * This keeps the composition beside the object it describes, so a QA probe can
 * read the live `show` / `classificationType` / material off the real primitive
 * AND check what it was built from. It is a build record, not a second model:
 * it is written in the same loop that creates the instances.
 * @type {Array<{primitive: object, tierId: string, underground: boolean,
 *   widthPx: number, color: string, strokeIds: Array<string>}>}
 */
let _batchManifest = [];
/** @type {Map<string, object>} render id → record (strokes, substations, pylons). */
let _records = new Map();
/** @type {?string} */
let _selectedId = null;

/** @type {object} The loaded document — dictionaries included. */
let _payload = null;
let _loading = false;
let _error = null;
let _status = 'idle';
let _lastUpdate = null;
let _stale = false;
let _towersShown = false;

function setStatus(status, error = null) {
  if (_status === status && _error === error) return;
  _status = status;
  _error = error;
  governorRequestRender('power-grid-status');
}

function pointPosition(lat, lon) {
  const floor = cachedGroundFloor(lat, lon);
  const height = (Number.isFinite(floor) ? floor : 0) + POINT_LIFT_M;
  return Cesium.Cartesian3.fromDegrees(lon, lat, height);
}

function clearStrokePrimitives() {
  for (const primitive of _strokePrimitives) {
    _viewer?.scene?.groundPrimitives?.remove?.(primitive);
  }
  _strokePrimitives = [];
  _batchManifest = [];
}

/**
 * Rebuild the clamped ground strokes for one loaded box.
 *
 * BATCHED, not one entity per way: a dense viewport is 2,200 strokes, and
 * 2,200 entity polylines is 2,200 collection-changed events and 2,200 draw
 * calls on every pan. `GroundPolylinePrimitive` merges them into a handful of
 * batches, which is what makes this layer pannable at all — the same technique
 * the traffic layer's congestion underlay uses.
 *
 * The split is by what has to differ: overhead strokes share ONE primitive and
 * carry their band colour as a per-instance attribute, while underground ones
 * need a dashed material and a material is per-primitive, so they get one batch
 * per band. Five batches at most, whatever the stroke count.
 *
 * @param {object} payload Projected `/api/power-grid` document.
 */
function buildStrokes(payload) {
  clearStrokePrimitives();
  if (!_viewer) return;
  if (_groundLinesSupported === null) {
    _groundLinesSupported = Cesium.GroundPolylinePrimitive.isSupported(_viewer.scene);
    if (!_groundLinesSupported) {
      console.warn('[Data:Power Grid] GroundPolylinePrimitive unsupported — routes disabled');
    }
  }
  if (!_groundLinesSupported) return;

  const strokes = Array.isArray(payload?.strokes) ? payload.strokes : [];
  const voltages = Array.isArray(payload?.voltages) ? payload.voltages : [];
  const overhead = [];
  /** @type {Map<string, Array<Cesium.GeometryInstance>>} tier id → dashed instances. */
  const underground = new Map();
  /** Per-bucket build record; see `_batchManifest`. */
  const overheadIds = [];
  const undergroundIds = new Map();
  const overheadWidths = new Map();

  for (let i = 0; i < strokes.length; i += 1) {
    const stroke = strokes[i];
    const coords = stroke?.c;
    if (!Array.isArray(coords) || coords.length < 4) continue;
    const voltage = voltages[stroke.vi];
    const tier = powerTierById(voltage?.tier);
    if (!tier) continue;
    const id = `power-grid:stroke:${stroke.id || i}`;
    const instance = new Cesium.GeometryInstance({
      id,
      geometry: new Cesium.GroundPolylineGeometry({
        positions: Cesium.Cartesian3.fromDegreesArray(coords),
        width: tier.widthPx,
      }),
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(
          Cesium.Color.fromCssColorString(tier.color).withAlpha(STROKE_ALPHA),
        ),
      },
    });
    _records.set(id, { id, kind: 'stroke', stroke, tierId: tier.id });
    if (stroke.u) {
      const bucket = underground.get(tier.id);
      if (bucket) bucket.push(instance);
      else underground.set(tier.id, [instance]);
      const ids = undergroundIds.get(tier.id);
      if (ids) ids.push(id);
      else undergroundIds.set(tier.id, [id]);
    } else {
      overhead.push(instance);
      overheadIds.push(id);
      overheadWidths.set(tier.id, tier.widthPx);
    }
  }

  if (overhead.length) {
    // One batch for every overhead stroke at every voltage: the band colour and
    // the band width travel per instance, so merging them costs no fidelity.
    const primitive = _viewer.scene.groundPrimitives.add(new Cesium.GroundPolylinePrimitive({
      geometryInstances: overhead,
      classificationType: _classificationType,
      appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
    }));
    _strokePrimitives.push(primitive);
    _batchManifest.push({
      primitive,
      tierId: null,
      underground: false,
      // Mixed by design — the per-instance widths this batch was built from.
      widthPx: [...overheadWidths.values()],
      color: null,
      strokeIds: overheadIds,
    });
  }
  for (const [tierId, instances] of underground) {
    const tier = powerTierById(tierId);
    // A dashed material is per-primitive, so underground strokes cannot share
    // the overhead batch and get one batch per band instead.
    const primitive = _viewer.scene.groundPrimitives.add(new Cesium.GroundPolylinePrimitive({
      geometryInstances: instances,
      classificationType: _classificationType,
      appearance: new Cesium.PolylineMaterialAppearance({
        material: Cesium.Material.fromType('PolylineDash', {
          color: Cesium.Color.fromCssColorString(tier.color).withAlpha(UNDERGROUND_ALPHA),
          dashLength: UNDERGROUND_DASH_LENGTH,
        }),
      }),
    }));
    _strokePrimitives.push(primitive);
    _batchManifest.push({
      primitive,
      tierId,
      underground: true,
      widthPx: [tier.widthPx],
      color: tier.color,
      strokeIds: undergroundIds.get(tierId) || [],
    });
  }
  for (const primitive of _strokePrimitives) primitive.show = _enabled;
}

/** Replace the drawn substations and pylons for one loaded box. */
function buildPoints(payload) {
  if (!_points) return;
  _points.removeAll();

  const substations = Array.isArray(payload?.substations) ? payload.substations : [];
  const towers = Array.isArray(payload?.towers) ? payload.towers : [];
  const voltages = Array.isArray(payload?.voltages) ? payload.voltages : [];
  const warm = [];

  // Pylons first, so a substation sharing a coordinate with one paints over it.
  for (const tower of towers) {
    if (!Number.isFinite(tower?.lat) || !Number.isFinite(tower?.lon)) continue;
    const id = `power-grid:tower:${tower.id}`;
    const position = pointPosition(tower.lat, tower.lon);
    const size = tower.portal ? PORTAL_POINT_PX : TOWER_POINT_PX;
    const color = Cesium.Color.fromCssColorString(TOWER_COLOR).withAlpha(0.85);
    const point = _points.add({
      id,
      position,
      color,
      pixelSize: size,
      outlineWidth: 0,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
    _records.set(id, { id, kind: 'tower', tower, position, point, baseColor: color, baseSize: size });
    warm.push({ lat: tower.lat, lon: tower.lon });
  }

  for (const substation of substations) {
    if (!Number.isFinite(substation?.lat) || !Number.isFinite(substation?.lon)) continue;
    const id = `power-grid:substation:${substation.id}`;
    const position = pointPosition(substation.lat, substation.lon);
    const tier = powerTierById(voltages[substation.vi]?.tier);
    const size = substationPointSize(tier?.id);
    const color = Cesium.Color.fromCssColorString(tier?.color || POWER_GRID_TIERS.at(-1).color);
    const point = _points.add({
      id,
      position,
      color,
      pixelSize: size,
      outlineColor: Cesium.Color.BLACK.withAlpha(SUBSTATION_OUTLINE_ALPHA),
      outlineWidth: 1.5,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
    _records.set(id, {
      id, kind: 'substation', substation, position, point, baseColor: color, baseSize: size,
    });
    warm.push({ lat: substation.lat, lon: substation.lon });
  }

  warmGroundFloor(warm.slice(0, 600));
}

/** Ambient labels: the named yards only. 2,000 pylon labels is not a map. */
function publishOverlay() {
  if (!_enabled || !_payload) {
    _overlayHost.clearSource(POWER_GRID_OVERLAY_SOURCE_ID);
    return;
  }
  const entries = [];
  for (const substation of _payload.substations || []) {
    if (!substation.name) continue;
    const record = _records.get(`power-grid:substation:${substation.id}`);
    if (!record?.position) continue;
    entries.push(createSubstationOverlayEntry(substation, record.position, _payload));
  }
  _overlayHost.setEntries(
    POWER_GRID_OVERLAY_SOURCE_ID,
    selectPowerOverlayCohort(entries),
    {
      cohortLimit: POWER_GRID_OVERLAY_COHORT_LIMIT,
      collisionCapacity: POWER_GRID_OVERLAY_COLLISION_CAPACITY,
      moving: false,
    },
  );
}

/**
 * Re-classify every stroke batch against the active surface, in one pass.
 * @param {Cesium.ClassificationType|undefined} next
 */
function applyClassification(next) {
  if (next === undefined || next === _classificationType) return;
  _classificationType = next;
  // `classificationType` is baked into a built GroundPolylinePrimitive, so the
  // batches are rebuilt rather than mutated — the geometry is already in hand,
  // and this happens only when the operator switches map stacks.
  if (_payload) buildStrokes(_payload);
  _viewer?.scene?.requestRender?.();
}

function restoreRecordStyle(record) {
  if (!record) return;
  if (record.kind === 'stroke') {
    // A batched instance cannot be restyled without rebuilding the batch, so
    // the selected stroke is drawn as its own overlay primitive instead; the
    // batch underneath was never touched.
    if (record.highlight) {
      _viewer?.scene?.groundPrimitives?.remove?.(record.highlight);
      record.highlight = null;
    }
    return;
  }
  if (!record.point) return;
  record.point.color = record.baseColor;
  record.point.pixelSize = record.baseSize;
}

function clearSelection() {
  if (_selectedId) restoreRecordStyle(_records.get(_selectedId));
  _selectedId = null;
  _overlayHost.clearSource(POWER_GRID_SELECTED_OVERLAY_SOURCE_ID);
}

function selectObject(id) {
  clearSelection();
  const record = _records.get(id);
  if (!record) return;
  _selectedId = id;
  if (record.kind === 'stroke') {
    if (_groundLinesSupported && Array.isArray(record.stroke?.c)) {
      record.highlight = _viewer.scene.groundPrimitives.add(new Cesium.GroundPolylinePrimitive({
        geometryInstances: new Cesium.GeometryInstance({
          geometry: new Cesium.GroundPolylineGeometry({
            positions: Cesium.Cartesian3.fromDegreesArray(record.stroke.c),
            width: SELECTED_STROKE_WIDTH,
          }),
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(
              Cesium.Color.fromCssColorString(SELECTED_COLOR).withAlpha(0.85),
            ),
          },
        }),
        classificationType: _classificationType,
        appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
      }));
    }
  } else if (record.point) {
    record.point.color = Cesium.Color.fromCssColorString(SELECTED_COLOR);
    record.point.pixelSize = SELECTED_POINT_PX;
  }
  const entry = createPowerSelectedOverlayEntry(record, _payload || {});
  if (entry) {
    _overlayHost.setEntries(
      POWER_GRID_SELECTED_OVERLAY_SOURCE_ID,
      [entry],
      POWER_GRID_SELECTED_OVERLAY_SOURCE_OPTIONS,
    );
  }
  governorRequestRender('power-grid-select');
}

function onKeyDown(event) {
  if (event.key === 'Escape' && _selectedId) clearSelection();
}

/** Resolve a Cesium pick into one of this layer's render ids. */
export function resolvePowerPickId(picked, has = (id) => _records.has(id)) {
  if (!picked) return null;
  const primitiveId = picked.primitive?.id;
  if (typeof primitiveId === 'string' && has(primitiveId)) return primitiveId;
  // A batched GroundPolylinePrimitive reports the GeometryInstance id.
  if (typeof picked.id === 'string' && has(picked.id)) return picked.id;
  const entityId = picked.id?.id;
  if (typeof entityId === 'string' && has(entityId)) return entityId;
  return null;
}

function installClickHandler(viewer) {
  if (_clickHandler) return;
  _clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  _clickHandler.setInputAction((click) => {
    const id = resolvePowerPickId(viewer.scene.pick(click.position));
    if (id) {
      // A stroke has no single position, so its card is anchored where the user
      // clicked rather than at a midpoint that could be a département away.
      const record = _records.get(id);
      if (record?.kind === 'stroke') {
        record.position = viewer.scene.pickPosition?.(click.position)
          || viewer.camera.pickEllipsoid?.(click.position)
          || record.position;
        if (!record.position) return;
      }
      selectObject(id);
      return;
    }
    // The label plane the depth buffer knows nothing about, resolved after the
    // native pick so a name drawn across a neighbouring yard cannot steal it.
    const labelled = pickOverlayLabelId(click.position, {
      sourceId: POWER_GRID_OVERLAY_SOURCE_ID,
      prefix: POWER_GRID_LABEL_PREFIX,
      has: (recordId) => _records.has(recordId),
      hitTest: _overlayHost.hitTest,
    });
    if (labelled) {
      selectObject(labelled);
      return;
    }
    if (_selectedId) clearSelection();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  if (typeof document !== 'undefined') document.addEventListener('keydown', onKeyDown);
}

/**
 * Per-frame horizon pass for the point primitives.
 *
 * Points draw with depth testing disabled so a substation is not swallowed by
 * the terrain it sits on, which also means one on the far side of the planet
 * would paint straight through the globe. Nothing here animates — a grid does
 * not move — so this is the layer's only per-frame work. The strokes are
 * clamped ground geometry and need none of it.
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

/**
 * Backoff progression for the failed-load retry: 20 s, doubling to a 240 s
 * ceiling. Pure so the progression is pinnable without booting the layer.
 * @param {number} prevDelayMs
 * @returns {number}
 */
export function powerRetryDelayMs(prevDelayMs) {
  if (!Number.isFinite(prevDelayMs) || prevDelayMs <= 0) return RETRY_MIN_MS;
  return Math.min(prevDelayMs * 2, RETRY_CEIL_MS);
}

/**
 * A failed load must not strand the layer until the idle refresh.
 *
 * Fetches otherwise fire only on enable, on camera moveEnd, and every
 * UPDATE_INTERVAL_MS — so a parked camera whose request died would show an
 * error for twenty minutes while the proxy sat healthy. This is not
 * hypothetical: the first live request of 2026-08-27 got 504 / 502 / 504 and a
 * timeout from four public mirrors in a row, and the one after it succeeded in
 * 2.2 s. While the layer is enabled and failing, retry on a 20 s → 240 s
 * backoff; any success, user-driven load, zoom-out, or disable cancels it.
 */
function scheduleUnavailableRetry() {
  if (!_enabled) return;
  clearTimeout(_retryTimer);
  _retryDelayMs = powerRetryDelayMs(_retryDelayMs);
  _retryTimer = setTimeout(() => {
    _retryTimer = null;
    if (_enabled && !_loading) void load();
  }, _retryDelayMs);
}

function clearUnavailableRetry({ resetBackoff = true } = {}) {
  clearTimeout(_retryTimer);
  _retryTimer = null;
  if (resetBackoff) _retryDelayMs = 0;
}

function scheduleLoad() {
  if (!_enabled) return;
  // A camera-driven load supersedes any pending retry; the load reschedules on
  // failure, so the backoff step is KEPT rather than reset — a viewport that
  // keeps failing must not reset itself to 20 s on every pan.
  clearUnavailableRetry({ resetBackoff: false });
  clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(() => { void load(); }, REQUEST_DEBOUNCE_MS);
}

function clearRendered() {
  clearSelection();
  clearStrokePrimitives();
  _points?.removeAll();
  _records.clear();
  _payload = null;
  _overlayHost.clearSource(POWER_GRID_OVERLAY_SOURCE_ID);
}

async function load() {
  if (!_enabled || !_viewer) return false;
  const box = powerViewportBox(_viewer);
  if (!box) {
    _abort?.abort();
    _abort = null;
    _loading = false;
    clearRendered();
    clearUnavailableRetry();
    // NULL, not the prompt. `setStatus`'s second argument is `_error`, and the
    // Data Layers row prints a non-empty `error` in its FAULT slot — under a
    // green ON chip, because `layerFeedState()` has always carved `zoom-in` out
    // as guidance. The two halves of one row contradicted each other and the
    // layer read as broken while doing exactly its job. The prompt itself is
    // `buildLoadingLabel()`'s, which is the guidance slot the row also reads.
    setStatus('zoom-in', null);
    governorRequestRender('power-grid-zoom-out');
    return false;
  }

  _abort?.abort();
  const requestAbort = new AbortController();
  _abort = requestAbort;
  _loading = true;
  const timer = setTimeout(() => requestAbort.abort(), REQUEST_TIMEOUT_MS);
  try {
    const query = new URLSearchParams(
      Object.entries(box).map(([key, value]) => [key, value.toFixed(5)]),
    );
    const response = await fetch(`${GRID_URL}?${query}`, { signal: requestAbort.signal });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error || `Power-grid feed HTTP ${response.status}`);
    if (!Array.isArray(payload?.strokes)) throw new Error('malformed power-grid document');
    // A newer request already superseded this one; its answer is stale by
    // definition and must not overwrite what the newer one is about to draw.
    if (requestAbort.signal.aborted || _abort !== requestAbort || !_enabled) return false;

    clearRendered();
    _payload = payload;
    buildStrokes(payload);
    buildPoints(payload);
    publishOverlay();
    _stale = payload.status === 'stale';
    _towersShown = Boolean(payload.towersRequested);
    _lastUpdate = Date.now();
    clearUnavailableRetry();
    const drawn = payload.stats?.strokes || 0;
    setStatus(drawn || payload.stats?.substations ? (_stale ? 'stale' : 'ready') : 'empty', null);
    governorRequestRender('power-grid-load');
    console.log(
      `[Data:Power Grid] ${drawn} strokes / ${formatGridKm(payload.stats?.lengthKm)},`
      + ` ${payload.stats?.substations ?? 0} substations,`
      + ` ${payload.stats?.towers ?? 0} pylons`,
    );
    return true;
  } catch (error) {
    if (error?.name === 'AbortError') return false;
    console.warn('[Data:Power Grid] load error:', error);
    setStatus('error', error?.message || 'Mapped power grid unavailable');
    scheduleUnavailableRetry();
    return false;
  } finally {
    clearTimeout(timer);
    // An older aborted request must not clear a newer request's busy state.
    if (_abort === requestAbort) {
      _abort = null;
      _loading = false;
    }
  }
}

/** Deterministic subsample of drawn substations for the detection overlay. */
function collectDetectableObjects(options = {}) {
  if (!_enabled || !_payload) return [];
  const yards = [];
  for (const record of _records.values()) {
    if (record.kind !== 'substation') continue;
    if (!record.point?.show && record.id !== _selectedId) continue;
    yards.push(record);
  }
  if (!yards.length) return [];

  const maxCount = Number.isFinite(options.maxCount)
    ? Math.max(1, Math.floor(options.maxCount))
    : yards.length;
  const seed = Number.isFinite(options.seed) ? Math.floor(options.seed) : 0;
  const stride = Math.max(1, Math.ceil(yards.length / maxCount));
  const start = ((seed % stride) + stride) % stride;

  const result = [];
  for (let i = start; i < yards.length; i += stride) {
    const record = yards[i];
    const voltage = _payload.voltages?.[record.substation.vi] || {};
    result.push({
      position: record.position,
      sourceId: record.id,
      id: String(record.substation.name || record.substation.ref || 'POSTE')
        .toUpperCase().slice(0, 22),
      type: Number.isFinite(voltage.v) ? `${Math.round(voltage.v / 1000)}KV` : 'SUB',
      skipLabel: record.id === _selectedId,
    });
    if (result.length >= maxCount) break;
  }
  return result;
}

function buildLoadingLabel() {
  if (_loading) return 'loading the mapped grid for this view...';
  if (_status === 'zoom-in') return `zoom in below ${POWER_GRID_MAX_BOX_DEG}° to load the mapped grid`;
  if (_status === 'error') return _error || 'unavailable';
  if (_status === 'empty') return 'nothing high-voltage mapped in this view';
  const stats = _payload?.stats;
  if (!stats) return '';
  const parts = [`${formatGridKm(stats.lengthKm)} of mapped route`];
  if (stats.substations) parts.push(`${stats.substations} substations`);
  if (_towersShown && stats.towers) parts.push(`${stats.towers} pylons`);
  const truncated = Object.entries(_payload?.saturated || {})
    .filter(([, value]) => value)
    .map(([key]) => key);
  if (truncated.length) parts.push(`${truncated.join(' + ')} truncated — zoom in`);
  if (_stale) parts.push('serving cached geometry');
  return parts.join(' · ');
}

/**
 * What the stroke batches on screen were built from, beside what they ARE now.
 *
 * The composition fields come from the build record: Cesium RELEASES
 * `geometryInstances` once a primitive is built, so after the first frame the
 * scene can no longer say what went into a batch — only that a batch exists.
 * `show`, `ready`, `classificationType` and the material are read LIVE off the
 * primitive the record points at, so the two halves cannot drift apart.
 *
 * @returns {Array<object>}
 */
function renderDiagnostics() {
  return _batchManifest.map((entry) => ({
    tierId: entry.tierId,
    underground: entry.underground,
    widthPx: entry.widthPx,
    color: entry.color,
    strokes: entry.strokeIds.length,
    strokeIds: entry.strokeIds,
    // Live, off the real Cesium object.
    show: entry.primitive?.show !== false,
    ready: entry.primitive?.ready === true,
    classificationType: String(entry.primitive?.classificationType ?? ''),
    materialType: entry.primitive?.appearance?.material?.type ?? null,
    // Membership in `scene.groundPrimitives` is itself the proof that a batch is
    // draped rather than drawn at a height — a ground primitive has no height to
    // set, which is exactly why this layer uses one.
    inGroundCollection: (() => {
      const ground = _viewer?.scene?.groundPrimitives;
      if (!ground) return null;
      for (let i = 0; i < ground.length; i += 1) {
        if (ground.get(i) === entry.primitive) return true;
      }
      return false;
    })(),
  }));
}

/** Power Grid layer. @type {Object} */
const powerGridLayer = {
  id: POWER_GRID_LAYER_ID,
  name: 'Power Grid',
  icon: '⌁',
  source: 'OpenStreetMap (Overpass)',
  updateInterval: UPDATE_INTERVAL_MS,

  init(viewer) {
    _viewer = viewer;
    _points = new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.OPAQUE_AND_TRANSLUCENT });
    _points.show = false;
    viewer.scene.primitives.add(_points);
    registerSpriteCollection(POWER_GRID_LAYER_ID, _points);

    _enabled = false;
    _records = new Map();
    _strokePrimitives = [];
    _selectedId = null;
    _payload = null;
    _loading = false;
    _error = null;
    _status = 'idle';
    _lastUpdate = null;
    _stale = false;
    _towersShown = false;
    _retryDelayMs = 0;
    _classificationType = powerClassificationTypeForScene(viewer?.scene);

    if (typeof window !== 'undefined' && !_mapStackListener) {
      _mapStackListener = (event) => {
        applyClassification(event?.detail?.activeId !== undefined
          ? powerClassificationTypeForStack(event.detail.activeId)
          : powerClassificationTypeForScene(_viewer?.scene));
      };
      window.addEventListener('gev:map-stack-changed', _mapStackListener);
    }

    _overlayHost.setVisible(POWER_GRID_OVERLAY_SOURCE_ID, false);
    _overlayHost.setVisible(POWER_GRID_SELECTED_OVERLAY_SOURCE_ID, false);
    restoreSpriteOrder(viewer);
    console.log('[Data:Power Grid] Initialized');
  },

  enable(viewer) {
    _enabled = true;
    _error = null;
    if (_points) _points.show = true;
    for (const primitive of _strokePrimitives) primitive.show = true;
    // The boot-time stack settle fires no event, so re-derive on every enable
    // rather than trusting whatever the last event left behind.
    applyClassification(powerClassificationTypeForScene(viewer?.scene || _viewer?.scene));
    _overlayHost.setVisible(POWER_GRID_OVERLAY_SOURCE_ID, true);
    _overlayHost.setVisible(POWER_GRID_SELECTED_OVERLAY_SOURCE_ID, true);
    installClickHandler(viewer);
    registerPickOwner(POWER_GRID_LAYER_ID, (pickedId) => _records.has(pickedId));
    if (!_preRenderRemover) {
      _preRenderRemover = viewer.scene.preRender.addEventListener(onPreRender);
    }
    if (!_moveEndRemover) {
      _moveEndRemover = viewer.camera.moveEnd.addEventListener(scheduleLoad);
    }
    publishOverlay();
    restoreSpriteOrder(viewer);
    // DataLayerManager invokes update() immediately after enable(), which owns
    // the first fetch. Avoid racing it with a second aborting request here.
  },

  disable() {
    _enabled = false;
    clearSelection();
    clearUnavailableRetry();
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
    _abort?.abort();
    _abort = null;
    if (_points) _points.show = false;
    for (const primitive of _strokePrimitives) primitive.show = false;
    _overlayHost.clearSource(POWER_GRID_OVERLAY_SOURCE_ID);
    _overlayHost.setVisible(POWER_GRID_OVERLAY_SOURCE_ID, false);
    _overlayHost.setVisible(POWER_GRID_SELECTED_OVERLAY_SOURCE_ID, false);
    if (_clickHandler) {
      _clickHandler.destroy();
      _clickHandler = null;
    }
    if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeyDown);
    unregisterPickOwner(POWER_GRID_LAYER_ID);
    if (_preRenderRemover) {
      _preRenderRemover();
      _preRenderRemover = null;
    }
    if (_moveEndRemover) {
      _moveEndRemover();
      _moveEndRemover = null;
    }
    _loading = false;
    _status = 'idle';
  },

  /**
   * Bring the camera inside the box this layer loads behind, on the way in.
   * The grid is wherever the camera is, so the view centre is the target and
   * there is no coverage table to pull it towards.
   * @param {?Cesium.Viewer} viewer
   * @param {{signal?: ?AbortSignal}} [options]
   * @returns {Promise<boolean>} Whether the camera ended inside the gate.
   */
  async ensureViewGate(viewer, { signal } = {}) {
    const target = viewer || _viewer;
    if (!target) return false;
    return applyViewGate(target, {
      fits: () => Boolean(powerViewportBox(target)),
      maxDeg: POWER_GRID_MAX_BOX_DEG,
      signal,
      reason: 'power-grid-view-gate',
    });
  },

  async update() {
    if (!_enabled) return false;
    const loaded = await load();
    // A load that fetched nothing because the camera is too wide asked for a
    // zoom, and asking is not failing. Only the error state is a failed refresh
    // — reporting the guidance state as one tore the layer back down on enable.
    return loaded || _status !== 'error';
  },

  getDetectableObjects(options = {}) {
    return collectDetectableObjects(options);
  },

  /**
   * Snapshot the substations for the analyst query engine. On-demand only, and
   * the strokes are deliberately absent: a way is a fragment of a route, not an
   * object anyone can ask a question about.
   * @param {number} [maxCount=400]
   * @returns {Array<Object>}
   */
  getAnalystRecords(maxCount = 400) {
    if (!_enabled || !_payload) return [];
    const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 400;
    const result = [];
    for (const substation of _payload.substations || []) {
      if (result.length >= limit) break;
      result.push(mapPowerAnalystRecord(substation, _payload, result.length));
    }
    return result;
  },

  /**
   * The key to what is on screen: the voltage bands, in order.
   *
   * Bands rather than feature types, because voltage is what this layer filters
   * on and therefore the only thing the colours can honestly mean. The rows
   * carry the two limits that matter — the routes are drawn on the ground and
   * are not at conductor height, and an empty band means nothing MAPPED at that
   * voltage here.
   * @returns {{chips: Array<object>, legend: Array<object>}}
   */
  getRowControls() {
    const legend = [];
    for (const tier of _payload?.tiers || []) {
      const parts = [tier.blurb];
      if (tier.lengthKm) parts.push(`${formatGridKm(tier.lengthKm)} of mapped route in view`);
      if (tier.undergroundKm) {
        parts.push(`${formatGridKm(tier.undergroundKm)} of it underground, drawn dashed`);
      }
      if (tier.substations) parts.push(`${tier.substations} substations`);
      legend.push({
        label: tier.label,
        color: tier.color,
        count: tier.strokes + tier.substations,
        blurb: `${parts.join(' · ')}. Routes are drawn on the ground — the mapped route, `
          + 'not the conductor height, which OpenStreetMap does not publish.',
      });
    }
    if (_towersShown && _payload?.stats?.towers) {
      legend.push({
        label: 'Pylons',
        color: TOWER_COLOR,
        count: _payload.stats.towers,
        blurb: 'Mapped pylons and portals, shown only below '
          + `${POWER_GRID_TOWER_MAX_BOX_DEG}° of view. Height is mapped for a minority of them `
          + 'and is never inferred for the rest.',
      });
    }
    return { chips: [], legend };
  },

  /**
   * The stroke batches on screen: what each was built from, and what it is now.
   * Read by `scripts/qa-power-grid.mjs`, which cannot ask the scene directly
   * because Cesium releases a primitive's geometry instances once it is built.
   * @returns {Array<object>}
   */
  getRenderDiagnostics() {
    return renderDiagnostics();
  },

  getStats() {
    const stats = _payload?.stats;
    const result = {
      count: (stats?.substations || 0) + (stats?.strokes || 0),
      lastUpdate: _lastUpdate,
      loading: _loading,
      status: _status === 'ready' ? 'ok' : _status,
      stale: _stale,
      strokes: stats?.strokes ?? null,
      // OSM splits one liaison across many ways, so the honest "how many lines"
      // answer is the distinct mapped route names, reported beside the strokes.
      routes: stats?.routes ?? null,
      lengthKm: stats?.lengthKm ?? null,
      undergroundKm: stats?.undergroundKm ?? null,
      substations: stats?.substations ?? null,
      towers: _towersShown ? (stats?.towers ?? null) : null,
      saturated: Boolean(_payload?.saturated
        && Object.values(_payload.saturated).some(Boolean)),
      feedSource: _payload?.source || null,
    };
    const label = buildLoadingLabel();
    if (label) result.loadingLabel = label;
    if (_error) result.error = _error;
    return result;
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
      unregisterPickOwner(POWER_GRID_LAYER_ID);
    }
    if (typeof window !== 'undefined' && _mapStackListener) {
      window.removeEventListener('gev:map-stack-changed', _mapStackListener);
      _mapStackListener = null;
    }
    if (_preRenderRemover) {
      _preRenderRemover();
      _preRenderRemover = null;
    }
    if (_moveEndRemover) {
      _moveEndRemover();
      _moveEndRemover = null;
    }
    clearStrokePrimitives();
    if (_points) {
      unregisterSpriteCollection(POWER_GRID_LAYER_ID, _points);
      viewer?.scene?.primitives?.remove?.(_points);
      _points = null;
    }
    _records.clear();
    _payload = null;
    _viewer = null;
  },
};

/** Seed rendered records so selection/card/legend paths run without WebGL. */
export function _setPowerGridStateForTest({
  viewer, records, payload, overlayHost, towersShown = true, enabled = true,
} = {}) {
  _viewer = viewer || null;
  if (records) _records = records instanceof Map ? records : new Map(Object.entries(records));
  if (payload !== undefined) _payload = payload;
  _overlayHost = overlayHost || DEFAULT_OVERLAY_HOST;
  _enabled = enabled;
  _towersShown = towersShown;
  _selectedId = null;
  _status = 'ready';
}

/** @returns {?string} */
export function _powerSelectedIdForTest() {
  return _selectedId;
}

export function _selectPowerObjectForTest(id) {
  selectObject(id);
}

export function _clearPowerSelectionForTest() {
  clearSelection();
}

export function _powerRowControlsForTest() {
  return powerGridLayer.getRowControls();
}

export function _powerDetectablesForTest(options) {
  return collectDetectableObjects(options);
}

export function _powerStatsForTest() {
  return powerGridLayer.getStats();
}

/** @returns {Array<object>} See `powerGridLayer.getRenderDiagnostics`. */
export function _powerBatchesForTest() {
  return renderDiagnostics();
}

export default powerGridLayer;
