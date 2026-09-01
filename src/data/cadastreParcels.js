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
  CADASTRE_AREA_TOLERANCE,
  CADASTRE_BOX_STEP_DEG,
  CADASTRE_MAX_ALTITUDE_M,
  CADASTRE_MAX_BOX_DEG,
  CADASTRE_SCALE_BANDS,
  CADASTRE_UNKNOWN_BAND,
  cadastreAreaLines,
  cadastreCommuneLine,
  cadastreCoverageIntersects,
  cadastreLoadingLabel,
  cadastreParcelTitle,
  cadastreRequestBox,
  cadastreScaleBand,
  cadastreSheetLine,
  cadastreToleranceLine,
  finiteOrNull,
  formatSurfaceM2,
  summarizeCadastreParcels,
} from './cadastreFeed.js';

/**
 * Parcelles cadastrales (FR) — the lines France taxes land along, and what
 * they are actually worth.
 *
 * The Plan Cadastral Informatisé served through IGN's Api Carto: one polygon
 * per parcel, with its section, its number, its 14-character national
 * identifier and the surface the DGFiP has registered against it. Roughly 103
 * million parcels cover the country, so this layer never draws France — it is a
 * magnifying glass, and it says so by refusing to load above a 2 km viewport.
 *
 * ── The two things this layer is FOR ────────────────────────────────────────
 *
 * • **A cadastral boundary is a fiscal line, not a legal one.** France fixes a
 *   property limit by bornage — a géomètre-expert's survey — and the cadastre
 *   has no authority over it. Every card says so on its last line, because a
 *   crisp polygon on a photorealistic globe is exactly the thing a reader will
 *   otherwise take for a surveyed limit.
 *
 * • **How approximate a line is, is PUBLISHED, and nobody draws it.** Each
 *   parcel belongs to a feuille, and the feuille carries the scale of the plan
 *   it was drawn on — 1:250 in central Strasbourg, 1:5000 over the Landes
 *   forest, a twentyfold spread measured across 673 sheets on 2026-09-01. Half
 *   a millimetre of pen at those scales is ±0.13 m and ±2.5 m, and it is the
 *   same "boundary" in both cases. That number is the colour of every parcel on
 *   screen and a line on every card.
 *
 * ── What the drawing is careful about ───────────────────────────────────────
 *
 * • **The holes are the streets.** The cadastre parcels PRIVATE land and the
 *   public domain that has been given a parcel; roads, squares and rivers have
 *   none, so a correct answer over a city centre is full of gaps. Measured
 *   2026-09-01 with the parcels clipped to the view: 45.7% of Lyon's Presqu'île
 *   is cadastred, 32.7% around the Champ-de-Mars, against 98.6% of a Landes
 *   forest block. The row reports that fraction so the gaps read as the public
 *   realm rather than as a broken layer.
 *
 * • **A short answer is refused, not drawn.** Api Carto caps every request at
 *   5 000 features and reports the truncation only in `totalFeatures`. The
 *   missing parcels are scattered rather than cropped, so a truncated draw
 *   would be indistinguishable from the gaps above — the one failure that would
 *   turn the sentence before this one into a lie. Over the cap the layer draws
 *   nothing and prints the true count.
 *
 * • **Fills carry the sheet, outlines carry the parcel.** Neighbours on one
 *   feuille share a colour by construction, so a fill-only draw of a city block
 *   is one flat wash; the ground-clamped outline is what makes it a cadastre.
 *   Both are classification geometry, so they drape on IGN ortho, on Bing and
 *   on the Google photoreal tileset without a second code path.
 */

/** Layer id — also the share-link registry key and the voice-tool enum value. */
export const CADASTRE_LAYER_ID = 'cadastre-fr';
/** Selected-parcel card, on its own protected overlay source. */
export const CADASTRE_SELECTED_OVERLAY_SOURCE_ID = 'cadastre-fr-selected';

export const CADASTRE_SELECTED_OVERLAY_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 1,
  moving: false,
});

/** Proxy routes. Keyless and same-origin; see `cadastreFranceProxy` in vite.config.js. */
const PARCELS_URL = '/api/cadastre-fr/parcelles';

/** Debounce between the camera settling and the request that follows it. */
const REQUEST_DEBOUNCE_MS = 450;
/** First step of the failed-load backoff, and its ceiling. */
const RETRY_MIN_MS = 20_000;
const RETRY_CEIL_MS = 240_000;
/**
 * Idle refresh cadence. The PCI is republished monthly and a parcel outlives
 * most of the people who own it; this exists so a session left open for a day
 * is not holding an answer from before a division was registered, not because
 * anything moves.
 */
const UPDATE_INTERVAL_MS = 60 * 60_000;
const REQUEST_TIMEOUT_MS = 45_000;
/**
 * How a camera that cannot yet answer "where am I looking?" is waited out.
 * 600 ms × 8 covers a ~5 s fly-to and then gives up, so a camera parked past
 * the limb — which never yields a rectangle — costs eight cheap checks and not
 * a permanent timer.
 */
const NO_VIEW_RETRY_MS = 600;
const NO_VIEW_MAX_RETRIES = 8;

/** Fill opacity. Low enough that the imagery underneath stays legible. */
const FILL_ALPHA = 0.28;
/** Outline colour — one neutral line for every band, so the fill carries the scale. */
const OUTLINE_COLOR = '#0b1a24';
const OUTLINE_ALPHA = 0.85;
const OUTLINE_WIDTH_PX = 1.2;
const SELECTED_COLOR = '#00ffff';

/**
 * `MAP_STACKS` ids that render imagery on the SHOWN Cesium globe. An explicit
 * allowlist, matching the cable and Vigilance layers: an unknown stack id must
 * reach the safe BOTH fallback rather than be asserted onto a surface that is
 * not there.
 */
const CADASTRE_GLOBE_STACK_IDS = Object.freeze(new Set(['bing-aerial', 'bing-labels', 'osm', 'ign-ortho', 'ign-plan']));

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});

let _viewer = null;
let _overlayHost = DEFAULT_OVERLAY_HOST;
let _enabled = false;
let _fills = null;
let _outlines = null;
/** @type {Map<string, object>} render id → parcel record. */
let _records = new Map();
let _payload = null;
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
let _noViewTimer = null;
let _noViewRetries = 0;
let _clickHandler = null;
let _moveEndRemover = null;
let _mapStackListener = null;
let _classificationType = Cesium.ClassificationType.BOTH;
let _fetchImpl = null;

/**
 * Ground-clamped classification for one map stack.
 * @param {string|null|undefined} activeId MapStackController stack id.
 * @returns {Cesium.ClassificationType}
 */
export function cadastreClassificationTypeForStack(activeId) {
  if (activeId === 'photoreal') return Cesium.ClassificationType.CESIUM_3D_TILE;
  if (CADASTRE_GLOBE_STACK_IDS.has(activeId)) return Cesium.ClassificationType.TERRAIN;
  return Cesium.ClassificationType.BOTH;
}

/**
 * Derive the active surface from live scene state. Boot settles the stack with
 * `{ silent: true }` and fires no 'gev:map-stack-changed'.
 * @param {Cesium.Scene|null|undefined} scene
 * @returns {Cesium.ClassificationType}
 */
export function cadastreClassificationTypeForScene(scene) {
  if (!scene?.globe) return Cesium.ClassificationType.BOTH;
  return scene.globe.show === false
    ? Cesium.ClassificationType.CESIUM_3D_TILE
    : Cesium.ClassificationType.TERRAIN;
}

/**
 * The point on the globe the middle of the screen is looking at.
 *
 * `pickEllipsoid` and not `globe.pick`: the ellipsoid always answers, terrain
 * may not have streamed yet, and a request box does not need centimetres — it
 * needs to be in the right kilometre. Null when the middle of the screen is
 * sky, which the caller handles rather than guessing.
 * @param {?Cesium.Viewer} viewer
 * @returns {?{lat:number, lon:number}}
 */
export function cadastreFocusPoint(viewer) {
  const scene = viewer?.scene;
  const camera = viewer?.camera;
  if (!scene || typeof camera?.pickEllipsoid !== 'function') return null;
  const width = scene.canvas?.clientWidth;
  const height = scene.canvas?.clientHeight;
  if (!width || !height) return null;
  const ellipsoid = scene.globe?.ellipsoid || Cesium.Ellipsoid.WGS84;
  const hit = camera.pickEllipsoid(new Cesium.Cartesian2(width / 2, height / 2), ellipsoid);
  if (!hit) return null;
  const carto = ellipsoid.cartesianToCartographic(hit);
  if (!carto) return null;
  const lat = Cesium.Math.toDegrees(carto.latitude);
  const lon = Cesium.Math.toDegrees(carto.longitude);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

/**
 * The viewport this layer will ask for, or null when there is nothing to ask.
 *
 * The gate is the camera's ALTITUDE and the request is a box around what the
 * camera is looking AT — deliberately, and it took a bug report to get here.
 * The first version gated on the span of `computeViewRectangle`, which on a
 * TILTED camera reaches the horizon: measured at 240 m over Paris, the same
 * altitude yields 0.0038° of longitude looking straight down and 0.0397° at a
 * 25° pitch. This globe defaults to an oblique view, so the layer refused to
 * load while the operator stood in the street with the parcels in front of
 * them, and the row told them to zoom in when they already had.
 *
 * Four distinct "no" answers, kept distinct because each needs a different
 * thing said: no camera rectangle at all, a camera too high for a parcel to be
 * worth a pixel, a view outside the country this data describes, and a
 * degenerate camera whose focus point falls outside its own view. Coverage is
 * checked BEFORE altitude, or a high view of the Atlantic is told to descend —
 * advice that would still find nothing at sea level.
 * @param {?Cesium.Viewer} viewer
 * @returns {{box: ?object, reason: ?string}}
 */
export function cadastreViewportBox(viewer) {
  const rectangle = viewer?.camera?.computeViewRectangle?.(viewer?.scene?.globe?.ellipsoid);
  if (!rectangle) return { box: null, reason: 'no-view' };
  const view = {
    south: Cesium.Math.toDegrees(rectangle.south),
    north: Cesium.Math.toDegrees(rectangle.north),
    west: Cesium.Math.toDegrees(rectangle.west),
    east: Cesium.Math.toDegrees(rectangle.east),
  };
  if (![view.south, view.west, view.north, view.east].every(Number.isFinite)) {
    return { box: null, reason: 'no-view' };
  }
  if (view.west >= view.east || view.south >= view.north) return { box: null, reason: 'no-view' };
  if (!cadastreCoverageIntersects(view)) return { box: null, reason: 'off-coverage' };

  const altitude = viewer?.camera?.positionCartographic?.height;
  if (!Number.isFinite(altitude)) return { box: null, reason: 'no-view' };
  if (altitude > CADASTRE_MAX_ALTITUDE_M) return { box: null, reason: 'too-high' };

  const box = cadastreRequestBox(view, cadastreFocusPoint(viewer));
  if (!box) return { box: null, reason: 'no-view' };
  return { box, reason: null };
}

/** The band a parcel's sheet puts it in. */
export function parcelBand(parcel, sheets = {}) {
  const sheet = parcel?.k ? sheets[parcel.k] : null;
  return sheet ? cadastreScaleBand(sheet.e) : CADASTRE_UNKNOWN_BAND;
}

/**
 * The selected-parcel card.
 *
 * Ordered as an answer to "what am I looking at": what it is called, where it
 * is, its national key, how big both sources say it is, which sheet drew it,
 * how much slack that sheet's lines carry, and — last, always — what the whole
 * thing is legally worth. The identifier gets its own line because 14 digits
 * inside a sentence is not readable, and because it is the key that joins this
 * parcel to DVF's record of what it last sold for.
 * @param {object} record
 * @param {object} [communes]
 * @param {object} [sheets]
 * @returns {?object}
 */
export function createCadastreSelectedOverlayEntry(record, communes = {}, sheets = {}) {
  if (!record?.id || !record.position) return null;
  const parcel = record.parcel || {};
  const sheet = parcel.k ? sheets[parcel.k] : null;
  const details = [cadastreCommuneLine(parcel, communes)];

  if (parcel.u) details.push(`IDU ${parcel.u}`);
  // Only when it is not the `000` that most of France carries: a line saying
  // "préfixe 000" is a line spent on the absence of a subdivision.
  if (parcel.b && parcel.b !== '000') details.push(`Préfixe de section ${parcel.b}`);

  details.push(...cadastreAreaLines(parcel));
  details.push(cadastreSheetLine(sheet, parcel));
  details.push(cadastreToleranceLine(sheet));
  details.push('Document fiscal — la limite de propriété se fixe par bornage');

  return {
    id: String(record.id),
    position: record.position,
    variant: 'selected',
    selected: true,
    protected: true,
    paintLane: 'selected',
    collisionGroup: 'ambient-card',
    priority: Number.MAX_SAFE_INTEGER,
    title: cadastreParcelTitle(parcel),
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

/** Drop the drawn primitives and everything that indexes into them. */
function clearPrimitives() {
  const primitives = _viewer?.scene?.primitives;
  if (primitives) {
    if (_fills) primitives.remove(_fills);
    if (_outlines) primitives.remove(_outlines);
  }
  _fills = null;
  _outlines = null;
  _records = new Map();
  _selectedId = null;
}

/** Cesium positions for one ring, dropping the repeated closing vertex. */
function ringPositions(ring) {
  const degrees = [];
  const last = ring.length - 1;
  const closed = last > 0
    && ring[0][0] === ring[last][0]
    && ring[0][1] === ring[last][1];
  const stop = closed ? last : ring.length;
  for (let i = 0; i < stop; i += 1) {
    const point = ring[i];
    if (!Array.isArray(point)) continue;
    degrees.push(point[0], point[1]);
  }
  return degrees.length >= 6 ? Cesium.Cartesian3.fromDegreesArray(degrees) : null;
}

/**
 * Build both primitives for the whole payload.
 *
 * One `GroundPrimitive` and one `GroundPolylinePrimitive` for the entire box,
 * not one per parcel: at two thousand parcels the per-primitive overhead is the
 * whole cost, and a batched primitive still supports per-instance picking and
 * per-instance recolouring, which is how selection works without a second draw.
 * @param {Array<object>} records
 */
function drawRecords(records) {
  clearPrimitives();
  if (!records.length || !_viewer) return;

  const fillInstances = [];
  const outlineInstances = [];
  for (const record of records) {
    _records.set(record.id, record);
    const color = Cesium.Color.fromCssColorString(record.color).withAlpha(FILL_ALPHA);
    for (const polygon of record.polygons) {
      const outer = ringPositions(polygon[0]);
      if (!outer) continue;
      const holes = [];
      for (let h = 1; h < polygon.length; h += 1) {
        const hole = ringPositions(polygon[h]);
        // Interior rings are courtyards and light wells. Dropped, they are
        // filled in, and the card's area stops matching what is on screen.
        if (hole) holes.push(new Cesium.PolygonHierarchy(hole));
      }
      fillInstances.push(new Cesium.GeometryInstance({
        id: record.id,
        geometry: new Cesium.PolygonGeometry({
          polygonHierarchy: new Cesium.PolygonHierarchy(outer, holes),
          vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
        }),
        attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(color) },
      }));
      // Every ring, interior ones included — a courtyard has a boundary too.
      for (const ring of polygon) {
        const positions = ringPositions(ring);
        if (!positions) continue;
        outlineInstances.push(new Cesium.GeometryInstance({
          id: record.id,
          geometry: new Cesium.GroundPolylineGeometry({
            positions: [...positions, positions[0]],
            width: OUTLINE_WIDTH_PX,
          }),
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(
              Cesium.Color.fromCssColorString(OUTLINE_COLOR).withAlpha(OUTLINE_ALPHA),
            ),
          },
        }));
      }
    }
  }
  if (!fillInstances.length) return;

  _fills = new Cesium.GroundPrimitive({
    geometryInstances: fillInstances,
    appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true }),
    classificationType: _classificationType,
    // Tessellating two thousand classification polygons on the render thread
    // drops frames for most of a second; Cesium's worker pool does it without.
    asynchronous: true,
    // Selection recolours one instance in place, which needs the per-instance
    // attribute table to survive the build.
    releaseGeometryInstances: false,
  });
  _fills.show = _enabled;
  _viewer.scene.primitives.add(_fills);

  if (outlineInstances.length) {
    _outlines = new Cesium.GroundPolylinePrimitive({
      geometryInstances: outlineInstances,
      appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
      classificationType: _classificationType,
      asynchronous: true,
      releaseGeometryInstances: false,
    });
    _outlines.show = _enabled;
    _viewer.scene.primitives.add(_outlines);
  }
  governorRequestRender('cadastre-draw');
}

/** Apply a classification surface to whatever is currently drawn. */
function applyClassification(next) {
  if (next === undefined || next === _classificationType) return;
  _classificationType = next;
  // `classificationType` is read when a ground primitive is built, so an
  // already-built one has to be rebuilt rather than mutated. The payload is
  // still in hand, so this costs a re-tessellation and no network at all.
  if (_payload?.parcels?.length) drawRecords(buildRecords(_payload));
  governorRequestRender('cadastre-map-stack');
}

/**
 * Recolour one instance inside a batched primitive.
 *
 * Safe only because `releaseGeometryInstances: false` keeps the per-instance
 * attribute table alive after the build. Before the primitive is ready there is
 * no table, which is a no-op rather than an error.
 * @param {Cesium.Primitive} primitive
 * @param {string} id
 * @param {?Cesium.Color} color
 * @returns {boolean}
 */
function applyInstanceColor(primitive, id, color) {
  if (!primitive || !primitive.ready || !color) return false;
  try {
    const attributes = primitive.getGeometryInstanceAttributes(id);
    if (!attributes) return false;
    attributes.color = Cesium.ColorGeometryInstanceAttribute.toValue(color);
    return true;
  } catch {
    return false;
  }
}

function clearSelection() {
  if (_selectedId) {
    const record = _records.get(_selectedId);
    if (record) {
      applyInstanceColor(_fills, _selectedId, Cesium.Color.fromCssColorString(record.color).withAlpha(FILL_ALPHA));
      applyInstanceColor(
        _outlines,
        _selectedId,
        Cesium.Color.fromCssColorString(OUTLINE_COLOR).withAlpha(OUTLINE_ALPHA),
      );
    }
  }
  _selectedId = null;
  _overlayHost.clearSource(CADASTRE_SELECTED_OVERLAY_SOURCE_ID);
}

function selectParcel(id) {
  clearSelection();
  const record = _records.get(id);
  if (!record) return;
  _selectedId = id;
  const highlight = Cesium.Color.fromCssColorString(SELECTED_COLOR);
  applyInstanceColor(_fills, id, highlight.withAlpha(0.55));
  applyInstanceColor(_outlines, id, highlight);
  const entry = createCadastreSelectedOverlayEntry(record, _payload?.communes, _payload?.sheets);
  if (entry) {
    _overlayHost.setEntries(
      CADASTRE_SELECTED_OVERLAY_SOURCE_ID,
      [entry],
      CADASTRE_SELECTED_OVERLAY_SOURCE_OPTIONS,
    );
  }
  governorRequestRender('cadastre-select');
}

/** Resolve a Cesium pick into one of this layer's render ids. */
export function resolveCadastrePickId(picked, has = (id) => _records.has(id)) {
  if (!picked) return null;
  if (typeof picked.id === 'string' && has(picked.id)) return picked.id;
  const nested = picked.id?.id;
  if (typeof nested === 'string' && has(nested)) return nested;
  return null;
}

function onKeyDown(event) {
  if (event.key === 'Escape' && _selectedId) clearSelection();
}

function installClickHandler(viewer) {
  if (_clickHandler) return;
  _clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  _clickHandler.setInputAction((click) => {
    const id = resolveCadastrePickId(viewer.scene.pick(click.position));
    if (id) selectParcel(id);
    else if (_selectedId) clearSelection();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  if (typeof document !== 'undefined') document.addEventListener('keydown', onKeyDown);
}

/**
 * Turn a proxy payload into drawable records.
 *
 * Pure enough to run under `node --test`: it touches Cesium only for the card
 * anchor, which is the one thing the selection path needs a Cartesian for.
 * @param {object} payload
 * @returns {Array<object>}
 */
export function buildRecords(payload) {
  const sheets = payload?.sheets || {};
  const records = [];
  for (const parcel of payload?.parcels || []) {
    if (!Array.isArray(parcel?.g) || !parcel.g.length) continue;
    const band = parcelBand(parcel, sheets);
    const anchor = Array.isArray(parcel.p) ? parcel.p : null;
    records.push({
      // The IDU where there is one. The `p`/index fallback is not decoration:
      // a parcel with no published identifier still has to be pickable, and two
      // records sharing a render id would make one of them unselectable.
      id: `cadastre:${parcel.u || `${parcel.m || '?'}:${records.length}`}`,
      parcel,
      polygons: parcel.g,
      bandId: band.id,
      color: band.color,
      position: anchor
        ? Cesium.Cartesian3.fromDegrees(anchor[0], anchor[1])
        : null,
    });
  }
  return records;
}

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

/** Fetch and draw the parcels for the current viewport. */
async function load() {
  if (!_enabled || !_viewer) return false;

  const { box, reason } = cadastreViewportBox(_viewer);
  if (!box) {
    clearPrimitives();
    _payload = null;
    _loadedKey = null;
    _error = null;
    _status = reason === 'too-high' ? 'too-high' : (reason === 'off-coverage' ? 'off-coverage' : 'idle');
    governorRequestRender('cadastre-clear');
    // `no-view` is the ONE gate that resolves without the operator doing
    // anything: the camera is mid-flight and Cesium cannot give a rectangle
    // yet. Everything else here — too high, off coverage — is a stable state a
    // camera move re-triggers through `moveEnd`, but a flight can END before
    // this layer is ever asked, so enabling during a fly-to would otherwise
    // leave the layer silently idle until something else moved. Voice does
    // exactly that: "fly to Lyon and show the parcels" enables the layer while
    // the camera is still moving.
    //
    // BOUNDED, and that is the whole design of it: a camera parked past the
    // limb yields no rectangle either, and that state is permanent. An
    // unbounded retry would poll it forever for a view that is never coming.
    // Eight attempts covers a long fly-to and then stops, and any successful
    // box resets the budget, so the next flight gets a full one.
    if (reason === 'no-view' && _noViewRetries < NO_VIEW_MAX_RETRIES) {
      _noViewRetries += 1;
      clearTimeout(_noViewTimer);
      _noViewTimer = setTimeout(() => { void load(); }, NO_VIEW_RETRY_MS);
    }
    return false;
  }

  _noViewRetries = 0;
  clearTimeout(_noViewTimer);
  _noViewTimer = null;

  const snapped = snapBoxOutward(box, CADASTRE_BOX_STEP_DEG);
  const key = boxKey(snapped, 3);
  if (key === _loadedKey && _payload && !_error) return false;

  _abort?.abort();
  _abort = new AbortController();
  const signal = _abort.signal;
  const timeout = setTimeout(() => _abort?.abort(), REQUEST_TIMEOUT_MS);
  _loading = true;
  _status = 'loading';
  _error = null;

  try {
    const params = new URLSearchParams({
      south: String(snapped.south),
      west: String(snapped.west),
      north: String(snapped.north),
      east: String(snapped.east),
    });
    const fetchImpl = _fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!fetchImpl) throw new Error('no fetch available');
    const response = await fetchImpl(`${PARCELS_URL}?${params}`, { signal });
    if (!response.ok) throw new Error(`cadastre proxy HTTP ${response.status}`);
    const payload = await response.json();
    if (signal.aborted) return false;

    _payload = payload;
    _lastUpdate = Date.now();
    _retryDelayMs = 0;
    clearRetry();

    // A truncated box is the one case where "we have an answer" and "we can
    // draw it" come apart. The proxy already withheld the parcels; the layer
    // clears whatever the previous box left on screen so the operator is not
    // reading a neighbouring viewport's cadastre under a refusal message.
    if (payload?.truncated) {
      clearPrimitives();
      _status = 'too-dense';
      _loadedKey = key;
      governorRequestRender('cadastre-too-dense');
      return true;
    }

    drawRecords(buildRecords(payload));
    _loadedKey = key;
    // `empty` is a real answer and not a fault. Two things produce it, and both
    // are worth the operator seeing rather than a blank row: a view of ground
    // that carries no parcel at all (a lake, a motorway interchange, the middle
    // of the Champ-de-Mars), and a view inside the coarse coverage rectangle
    // but outside France — Geneva and Basel both sit in it.
    _status = payload?.parcels?.length ? 'ready' : 'empty';
    return true;
  } catch (error) {
    if (error?.name === 'AbortError') return false;
    _error = error?.message || String(error);
    _status = 'unavailable';
    _loadedKey = null;
    scheduleRetry();
    console.warn('[Data:Parcelles] load failed:', error);
    return false;
  } finally {
    clearTimeout(timeout);
    _loading = false;
  }
}

/** Parcelles cadastrales (FR) layer. @type {Object} */
const cadastreParcelsLayer = {
  id: CADASTRE_LAYER_ID,
  name: 'Parcelles (FR)',
  icon: '▦',
  source: 'IGN Api Carto — cadastre PCI vecteur',
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
    _classificationType = cadastreClassificationTypeForScene(viewer?.scene);

    if (typeof window !== 'undefined' && !_mapStackListener) {
      _mapStackListener = (event) => applyClassification(
        event?.detail?.activeId
          ? cadastreClassificationTypeForStack(event.detail.activeId)
          : cadastreClassificationTypeForScene(_viewer?.scene),
      );
      window.addEventListener('gev:map-stack-changed', _mapStackListener);
    }
    _overlayHost.setVisible(CADASTRE_SELECTED_OVERLAY_SOURCE_ID, false);
    console.log('[Data:Parcelles] Initialized');
  },

  enable(viewer) {
    _enabled = true;
    _error = null;
    _noViewRetries = 0;
    // The boot-time stack settle fires no event, so re-derive from the scene
    // rather than trusting whatever the last event left behind.
    applyClassification(cadastreClassificationTypeForScene(viewer?.scene));
    if (_fills) _fills.show = true;
    if (_outlines) _outlines.show = true;
    _overlayHost.setVisible(CADASTRE_SELECTED_OVERLAY_SOURCE_ID, true);
    installClickHandler(viewer);
    registerPickOwner(CADASTRE_LAYER_ID, (pickedId) => _records.has(pickedId));
    if (!_moveEndRemover) {
      _moveEndRemover = viewer.camera.moveEnd.addEventListener(scheduleLoad);
    }
    // DataLayerManager invokes update() immediately after enable(), which owns
    // the first fetch. Avoid racing it with a second aborting request here.
  },

  disable() {
    _enabled = false;
    clearSelection();
    clearRetry();
    clearTimeout(_noViewTimer);
    _noViewTimer = null;
    _noViewRetries = 0;
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
    _abort?.abort();
    _abort = null;
    if (_fills) _fills.show = false;
    if (_outlines) _outlines.show = false;
    _overlayHost.setVisible(CADASTRE_SELECTED_OVERLAY_SOURCE_ID, false);
    if (_clickHandler) { _clickHandler.destroy(); _clickHandler = null; }
    if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeyDown);
    unregisterPickOwner(CADASTRE_LAYER_ID);
    if (_moveEndRemover) { _moveEndRemover(); _moveEndRemover = null; }
    _loading = false;
    _status = 'idle';
  },

  async update() {
    if (!_enabled) return false;
    // An idle refresh has to actually refetch, so drop the box memo first.
    _loadedKey = null;
    await load();
    // `load()` answers "did I fetch", which is false at BOTH gates, on an
    // unchanged viewport, and on an aborted request. None of those is a refusal
    // of the lifecycle transition — but `DataLayerManager` reads a literal
    // `false` from update() as exactly that, fails the enable, and leaves the
    // layer switched off with a LifecycleRejectedError the operator sees as
    // "échec de chargement". Since this layer refuses any view wider than
    // 0.02°, returning `load()` directly meant switching it on from anywhere
    // but street level turned itself back off. Only a disabled layer refuses
    // here; the load's own outcome is reported through `getStats()`.
    return true;
  },

  /**
   * Parcels are not contacts. They do not move, they are not tracked, and a
   * detection reticle over every plot in Lyon would drown every layer that does
   * have something moving to report.
   * @returns {Array}
   */
  getDetectableObjects() {
    return [];
  },

  /**
   * What is actually on the globe right now, as plain JSON.
   *
   * Distinct from `getStats()`, which reports what the PAYLOAD said: this reads
   * the record map the primitives were built from, so a payload that arrived
   * and a payload that drew are distinguishable. That is the difference the QA
   * harness exists to check, and it is the one `getStats()` structurally cannot
   * see.
   * @returns {Array<object>}
   */
  getDrawnParcels() {
    const sheets = _payload?.sheets || {};
    return [..._records.values()].map((record) => ({
      id: record.id,
      idu: record.parcel.u,
      section: record.parcel.s,
      numero: record.parcel.n,
      commune: record.parcel.m,
      arrondissement: record.parcel.r,
      bandId: record.bandId,
      color: record.color,
      echelle: record.parcel.k ? (sheets[record.parcel.k]?.e ?? null) : null,
      declaredM2: record.parcel.c,
      drawnM2: record.parcel.a,
      lon: record.parcel.p?.[0] ?? null,
      lat: record.parcel.p?.[1] ?? null,
      parts: record.polygons.length,
    }));
  },

  /**
   * Select one parcel by render id, from outside the click handler.
   *
   * The seam a share link, a voice command or the QA harness selects through.
   * Returns false for an id this layer does not own rather than clearing the
   * current selection — a caller naming someone else's object has made a
   * mistake, and silently deselecting is the least useful response to it.
   * @param {string} id
   * @returns {boolean}
   */
  selectParcel(id) {
    if (!_records.has(id)) return false;
    selectParcel(id);
    return true;
  },

  /** The selected parcel's card lines, or null. @returns {?object} */
  getSelectedParcel() {
    if (!_selectedId) return null;
    const record = _records.get(_selectedId);
    if (!record) return null;
    const entry = createCadastreSelectedOverlayEntry(record, _payload?.communes, _payload?.sheets);
    return entry ? { id: _selectedId, idu: record.parcel.u, title: entry.title, details: entry.details } : null;
  },

  /**
   * The legend: the four scale bands and the unknown one, in tolerance order.
   * @returns {{chips: Array<object>, legend: Array<object>}}
   */
  getRowControls() {
    const bands = _payload?.summary?.bands
      || summarizeCadastreParcels([]).bands;
    const legend = bands.map((band) => ({
      label: band.label,
      color: band.color,
      count: band.count,
      blurb: band.blurb,
    }));
    return { chips: [], legend };
  },

  getStats() {
    const summary = _payload?.summary || null;
    const result = {
      count: summary?.parcels ?? 0,
      communes: summary?.communes ?? null,
      sheets: summary?.sheets ?? null,
      // The layer's headline, as a percentage rather than a fraction: the
      // uncadastred remainder is the public domain, not a gap in the feed.
      cadastredPercent: Number.isFinite(summary?.cadastredFraction)
        ? Math.round(summary.cadastredFraction * 1000) / 10
        : null,
      declaredM2: summary?.declaredM2 ?? null,
      drawnM2: summary?.drawnM2 ?? null,
      areaChecked: summary?.areaChecked ?? null,
      areaDisagreeing: summary?.areaDisagreeing ?? null,
      areaTolerancePercent: Math.round(CADASTRE_AREA_TOLERANCE * 100),
      noContenance: summary?.noContenance ?? null,
      multipart: summary?.multipart ?? null,
      withHoles: summary?.withHoles ?? null,
      arrondissementIdu: summary?.arrondissementIdu ?? null,
      smallestM2: summary?.smallestM2 ?? null,
      largestM2: summary?.largestM2 ?? null,
      editions: summary?.editions ?? null,
      totalInBox: finiteOrNull(_payload?.totalInBox),
      truncated: Boolean(_payload?.truncated),
      sheetsTruncated: Boolean(_payload?.sheetsTruncated),
      stale: Boolean(_payload?.stale),
      lastUpdate: _lastUpdate,
      loading: _loading,
      status: _status === 'ready' ? 'ok' : _status,
      feedSource: 'IGN Api Carto (PCI vecteur, DGFiP) — Licence Ouverte 2.0',
    };
    // Guidance states are normal operation, not feed faults: `layerFeedState`
    // reads `zoom-in`/`empty`/`idle` as nominal, so a refusal to draw has to
    // present as one of those with its reason in the label rather than as a
    // status the chip would paint DEGRADED.
    if (_status === 'too-high' || _status === 'too-dense') {
      result.status = 'zoom-in';
      result.loadingLabel = cadastreLoadingLabel({
        status: _status,
        totalInBox: result.totalInBox,
      });
    } else if (_status === 'off-coverage') {
      result.status = 'ok';
      result.loadingLabel = cadastreLoadingLabel({ status: 'off-coverage' });
    } else if (_status === 'empty') {
      result.status = 'empty';
      result.loadingLabel = cadastreLoadingLabel({ status: 'empty' });
    } else if (_loading) {
      result.loadingLabel = cadastreLoadingLabel({ status: 'loading' });
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
      unregisterPickOwner(CADASTRE_LAYER_ID);
    }
    if (typeof window !== 'undefined' && _mapStackListener) {
      window.removeEventListener('gev:map-stack-changed', _mapStackListener);
      _mapStackListener = null;
    }
    if (_moveEndRemover) { _moveEndRemover(); _moveEndRemover = null; }
    clearTimeout(_noViewTimer);
    _noViewTimer = null;
    clearPrimitives();
    _payload = null;
    _viewer = null;
  },
};

/** Seed rendered records so selection/card/legend paths run without WebGL. */
export function _setCadastreStateForTest({
  viewer, records, payload, overlayHost, enabled = true, status = 'ready', fetchImpl,
} = {}) {
  _viewer = viewer || null;
  if (records) _records = records instanceof Map ? records : new Map(Object.entries(records));
  if (payload !== undefined) _payload = payload;
  _overlayHost = overlayHost || DEFAULT_OVERLAY_HOST;
  _enabled = enabled;
  _selectedId = null;
  _status = status;
  _fetchImpl = fetchImpl || null;
  _fills = null;
  _outlines = null;
  _error = null;
  _loading = false;
}

/** @returns {?string} */
export function _cadastreSelectedIdForTest() {
  return _selectedId;
}

export function _selectCadastreParcelForTest(id) {
  selectParcel(id);
}

export function _clearCadastreSelectionForTest() {
  clearSelection();
}

export function _cadastreRowControlsForTest() {
  return cadastreParcelsLayer.getRowControls();
}

export function _cadastreStatsForTest() {
  return cadastreParcelsLayer.getStats();
}

export { CADASTRE_MAX_BOX_DEG, CADASTRE_SCALE_BANDS };

export default cadastreParcelsLayer;
