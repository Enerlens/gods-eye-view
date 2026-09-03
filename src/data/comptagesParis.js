/**
 * @module comptagesParis
 *
 * Comptages routiers permanents (Paris) — the only layer on this globe that
 * draws a MEASURED vehicle count, on the arc of street that measured it.
 *
 * `comptagesFeed.js` holds the reading of the 27 772 889 hourly rows and every
 * trap in them; `comptagesRhythm.js` holds the reading of one street's day.
 * This file is the drawing.
 *
 * ── Why this is not the two road layers already on the globe ────────────────
 * `traffic` is TomTom flow: its own header says a keyless build runs a
 * SIMULATION — "white dots at hardcoded per-road-class speeds" — and even keyed
 * it publishes a congestion RATIO, never a number of vehicles. `road-status-fr`
 * is DATEX II from the Directions Interdépartementales des Routes, and its own
 * header says "Île-de-France has no publisher at all": Paris is a hole in it.
 * This layer fills exactly that hole with exactly what neither can supply —
 * `q`, described upstream as *"nombre de véhicules comptés pendant l'heure"*,
 * on 2 946 placed arcs and 537.5 km of Paris street, keyless and ODbL.
 *
 * ── ONE regime, and the byte count is what settles it ───────────────────────
 * `schools-fr` and `irve-fr` need three regimes and `sup-fr` needs two, because
 * a national register is either too big to ship or too big to draw. Neither is
 * true here. Every arc this layer knows about fits in a box **0.1721° by
 * 0.0896°** — 12.6 km by 10.0 km, measured off the 7 449 published vertices —
 * and the complete pack, with both 24-hour profiles on every arc, measures
 * **1 374 229 bytes raw and 305 551 gzipped**, weighed by building it. That is
 * half of what `sup-fr` already ships whole (0.62 MB) and half of the
 * `schools-fr` maillage (0.63 MB).
 *
 * So there is no choropleth, no maillage, no bbox query and no thinning: one
 * fetch, one draw, and every zoom answered from what the browser already holds.
 * The only gate is geographic — the pack is not fetched while the camera cannot
 * see Paris, because an operator looking at Tokyo should not pay 0.3 MB for a
 * city off-screen.
 *
 * ── It is J-2. The word "live" appears nowhere ──────────────────────────────
 * A nightly batch lands the day before yesterday: measured 2026-09-01T21:02Z,
 * `data_processed` = 2026-09-01T01:02:50Z while the newest reading is
 * 2026-08-30T22:00Z. So the unit drawn is not an hour, it is the last COMPLETE
 * Monday–Sunday week — 2 977 arcs × 168 hours = 500 136 rows, every arc with
 * exactly 168. Every card and the row label say *mesuré, J-2* and name the week.
 *
 * ── An HOUR CURSOR, because one average was hiding 500 136 measurements ─────
 * The pack holds 2 977 arcs x 168 hours, folded upstream into two 24-hour
 * profiles per arc — 48 published means. Until 2026-09-03 this layer painted
 * exactly ONE of them, the weekday average, and the cost of that was measured:
 * only **932 of the 1 730 counting arcs (53.9 %)** are in the same width band
 * at 18 h as they are on that average, and only **124 (7.2 %)** hold one band
 * across all 48 slots. The single number misfiled 798 streets.
 *
 * So the panel row carries seven chips — the same mechanism `idfm-frequency`
 * proved, transposed — and they move the map through `mean`, `clock`, and four
 * pinned (day-type x hour) slots. `comptagesRhythm.js` owns the tokens, the
 * parsing and the labels; this file owns the repaint.
 *
 * The week is ARCHIVED and the chips must not pretend otherwise. `clock` reads
 * the Paris wall clock and looks that hour up in the last complete Monday to
 * Sunday week; it is labelled "A cette heure", never "maintenant", and the row
 * label names the week AND the slot on every state (rule E1). The word "live"
 * still appears nowhere.
 *
 * ── What the colour claims, what the WIDTH claims, what the DASHES claim ─────
 * COLOUR is the RHYTHM class: nocturne, week-end, pendulaire, pointe du matin,
 * pointe du soir, continu — six hues computed by `comptagesRhythm.js` on the 48
 * published means, plus one desaturated seventh for the 36 arcs whose coverage
 * is too thin to classify. It is a qualitative variable on a hue channel (B4),
 * inside B5's ceiling, and it does NOT move with the cursor: the rhythm is a
 * property of the week, not of the hour being read.
 *
 * WIDTH is the count, and it is the ONLY channel that carries it. Five bands at
 * 100 / 250 / 500 / 1 000 veh/h, frozen (C1), read at the SELECTED slot. Before
 * this change the hue carried the same band as the width — two channels for one
 * information, which is the defect rule A3 names, and it was the only free
 * channel this layer had.
 *
 * The DASHES are the honest half, and there are now two of them:
 *   • **891 of 2 977 arcs (29.9 %)** published neither a count nor an occupancy
 *     for all 168 hours. Long dark dash, never the bottom of the width scale.
 *   • an arc that DOES count can still publish nothing in the selected slot —
 *     at most 69 of the 1 730 do (weekend 10 h), 83 arcs can ever be in that
 *     state. Short pale dash: measured street, unmeasured hour. It is not the
 *     same absence as the first and it is not drawn like it (rule A1).
 * And 356 arcs measure occupancy and never a count — a real measurement in a
 * unit the scale does not speak — which keeps its solid steel stroke off the
 * scale at every slot.
 *
 * ── Why the cursor does not rebuild a single vertex ─────────────────────────
 * A stroke width is baked into `GroundPolylineGeometry`; only `color` and `show`
 * are per-instance on a built batch (verified in the embedded Cesium source:
 * `Primitive._appendShowToShader` is applied whatever the appearance, so `show`
 * works on the dashed material batches too). Rebuilding the batches on every
 * chip would be exactly the "filter that destroys the batch" rule G2 forbids.
 *
 * So the geometry is built ONCE, per width band, and the cursor only writes
 * `show`. The cost is bounded by what `comptagesReachableBands()` proves: an arc
 * only needs an instance in the bands it can actually reach across `mean` and
 * the 48 slots. Measured on the pack — 1 712 placed counting arcs, 8 560
 * instances if all five bands were built for each, **4 970 (58.1 %) built**,
 * spread 1 230 / 1 471 / 1 288 / 711 / 270 — plus 83 hour-gap instances, 355
 * occupancy and 879 silent. **6 287 instances in 8 draw calls**, against 2 946
 * in 2 before. A chip click writes at most two `show` attributes per arc that
 * moved, and no worker runs.
 *
 * ── What is NOT drawn, and is counted instead ───────────────────────────────
 * 31 arcs have no geometry — the same 31 whose `date_debut` and `date_fin` are
 * also null, and all 31 are absent from the 3 739-row referential, which has no
 * geometry for them either. **19 of them are actively measuring**, on
 * Bd_Magenta, Bd_Malesherbes, Av_Kleber, Pl_de_la_Nation. They are named on the
 * row and never placed at a centroid.
 */

import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import { cachedGroundFloor, warmGroundFloor } from './groundFloor.js';
import { boxesIntersect } from './viewportBox.js';
import { cameraViewBox } from './viewGate.js';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { powerClassificationTypeForScene, powerClassificationTypeForStack } from './powerGrid.js';
import {
  COMPTAGES_BARRE_LABELS,
  COMPTAGES_FLOW_WIDTHS,
  COMPTAGES_HOUR_GAP_ALPHA,
  COMPTAGES_HOUR_GAP_COLOR,
  COMPTAGES_HOUR_GAP_DASH_LENGTH,
  COMPTAGES_HOUR_GAP_LABEL,
  COMPTAGES_HOUR_GAP_WIDTH,
  COMPTAGES_MOMENTS,
  COMPTAGES_OCCUPANCY_COLOR,
  COMPTAGES_OCCUPANCY_WIDTH,
  COMPTAGES_RHYTHM_BLURBS,
  COMPTAGES_RHYTHM_CLASSES,
  COMPTAGES_RHYTHM_COLORS,
  COMPTAGES_RHYTHM_THRESHOLDS,
  COMPTAGES_SILENT_ALPHA,
  COMPTAGES_SILENT_COLOR,
  COMPTAGES_SILENT_DASH_LENGTH,
  COMPTAGES_SILENT_WIDTH,
  COMPTAGES_SLOT_MEAN,
  COMPTAGES_STATE_LABELS,
  COMPTAGES_STROKE_ALPHA,
  COMPTAGES_WIDTH_INK,
  comptagesArcFlow,
  comptagesArcStyle,
  comptagesDayLine,
  comptagesFlowBandGlyph,
  comptagesFlowBandLabel,
  comptagesHasHourGap,
  comptagesOccupancyBand,
  comptagesParseSlot,
  comptagesProfileReference,
  comptagesReachableBands,
  comptagesResolveSlot,
  comptagesRhythmClass,
  comptagesRhythmLabel,
  comptagesRhythmMetrics,
  comptagesSaturatedHours,
  comptagesSlotLabel,
  comptagesStrokeGlyph,
} from './comptagesRhythm.js';

/** Layer id — also the share-link registry key and the voice-tool enum value. */
export const COMPTAGES_FR_LAYER_ID = 'comptages-fr';

/** Selected-arc card, on its own protected overlay source. */
export const COMPTAGES_FR_OVERLAY_SOURCE_ID = 'comptages-fr-selected';
export const COMPTAGES_FR_OVERLAY_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 1,
  moving: false,
});

/** Keyless, same-origin. See `comptagesParisProxy` in vite.config.js. */
const ARCS_URL = '/api/comptages-fr/arcs';

/**
 * The layer's whole extent, measured off the 7 449 published vertices of the
 * week 2026-08-24 → 2026-08-30 and padded by 0.05° (~4 km).
 *
 * Real bounds: lon 2.24928 → 2.42141, lat 48.81257 → 48.90216. The padding is
 * there so an operator panning towards Paris has the pack in hand before the
 * first arc is on screen, not so the box means anything.
 */
export const COMPTAGES_PARIS_BOX = Object.freeze({
  south: 48.76, west: 2.20, north: 48.95, east: 2.47,
});

/**
 * Idle refresh. The upstream batch is nightly and the EDITION is a whole week,
 * so anything faster asks a question whose answer cannot have changed. The
 * proxy's own TTL is what actually spares the portal.
 */
const POLL_INTERVAL_MS = 6 * 60 * 60_000;
const REQUEST_TIMEOUT_MS = 45_000;
const CAMERA_DEBOUNCE_MS = 400;
/** Card anchor lift above the ground floor, in metres. */
const CARD_LIFT_M = 3;
/** Ground-floor warm-up budget — the card anchors, not the strokes. */
const FLOOR_WARM_LIMIT = 400;
const SELECTED_COLOR = '#00ffff';
const SELECTED_WIDTH_BONUS = 3;

/**
 * One-line explanations behind each WIDTH swatch.
 *
 * They describe the band, not the moment: the counts move with the cursor and
 * are printed beside the swatch, so a blurb that quoted one slot's tally would
 * be wrong on the other six.
 */
const BAND_BLURBS = Object.freeze([
  'Moins de 100 véhicules comptés dans l’heure. Le trait le plus fin. '
    + 'Sur la moyenne ouvrée 196 arcs y sont ; à 04 h en semaine, 1 174.',
  'De 100 à 250 véh/h. Le gros du réseau compté sur la moyenne ouvrée : 620 arcs.',
  'De 250 à 500 véh/h. Axes de desserte — la médiane des arcs comptés est à 263 véh/h.',
  'De 500 à 1 000 véh/h. Grands boulevards et quais.',
  '1 000 véh/h et plus, le trait le plus large. Boulevard périphérique et voies '
    + 'sur berges ; le maximum mesuré de la semaine est 5 133 véh/h.',
]);

/** Blurbs for the three strokes that are not on the count scale. */
const OCCUPANCY_BLURB = 'La boucle publie un taux d’occupation et jamais un comptage. '
  + 'C’est une mesure réelle, dans une autre unité — elle n’a pas de place sur l’échelle en véh/h, '
  + 'et elle ne bouge pas avec le curseur horaire.';
const SILENT_BLURB_HEAD = 'Trait pointillé long : 168 h sans comptage ni occupation.';
const HOUR_GAP_BLURB = 'Trait pointillé court : cet arc compte bien dans la semaine, '
  + 'mais il n’a rien publié pour la tranche sélectionnée. Ce n’est pas une heure creuse — '
  + 'une heure creuse mesurée prend le trait le plus fin, pas un pointillé.';

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});
let _overlayHost = DEFAULT_OVERLAY_HOST;

// --- Runtime state ----------------------------------------------------------
let _viewer = null;
let _enabled = false;
let _records = new Map();
let _payload = null;
/** @type {Array<Cesium.GroundPolylinePrimitive>} */
let _primitives = [];
/**
 * One primitive per width band, index = band. Built once, never rebuilt by the
 * cursor — the cursor only writes `show` on the instances inside them.
 * @type {Array<?Cesium.GroundPolylinePrimitive>}
 */
let _bandPrimitives = new Array(COMPTAGES_FLOW_WIDTHS.length).fill(null);
/** The short-dash batch: arcs that count, in a slot they published nothing for. */
let _gapPrimitive = null;
/** Slot token as asked for (`mean` / `clock` / `w18`…), and its resolution. */
let _slotToken = COMPTAGES_SLOT_MEAN;
let _slot = comptagesResolveSlot(COMPTAGES_SLOT_MEAN);
/** Injectable clock, so a test can stand at 01:30 on a Saturday. */
const DEFAULT_NOW = () => Date.now();
let _now = DEFAULT_NOW;
/** True while a `show` write could not land because a batch was not ready. */
let _stylePending = false;
let _styleRetryRemover = null;
let _styleRetryFrames = 0;
/** @type {?Cesium.GroundPolylinePrimitive} */
let _highlight = null;
let _selectedId = null;
let _clickHandler = null;
let _moveEndRemover = null;
let _debounceTimer = null;
let _abort = null;
let _mapStackListener = null;
let _classificationType = Cesium.ClassificationType.BOTH;
/** @type {?boolean} `GroundPolylinePrimitive.isSupported`, checked once. */
let _groundLinesSupported = null;
let _loading = false;
let _error = null;
let _status = 'idle';
let _stale = false;
let _lastUpdate = null;
let _inView = false;

// --- Geometry ---------------------------------------------------------------

/** Cartesian positions for one arc, or null when it has no published line. */
export function comptagesPositions(line) {
  if (!Array.isArray(line) || line.length < 2) return null;
  const degrees = [];
  for (const point of line) {
    if (!Array.isArray(point)) continue;
    const [lon, lat] = point;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    degrees.push(lon, lat);
  }
  return degrees.length >= 4 ? Cesium.Cartesian3.fromDegreesArray(degrees) : null;
}

/**
 * The arc's midpoint by LENGTH, not its middle vertex.
 *
 * 2 229 of the 2 946 placed arcs are bare two-vertex chords, where the two
 * agree; on the 717 that are not, the middle vertex can sit at one end of a
 * ramp and the card would then hang off the tip of the thing it describes.
 */
export function comptagesMidpoint(line) {
  if (!Array.isArray(line) || line.length < 2) return null;
  let total = 0;
  const spans = [];
  for (let i = 1; i < line.length; i += 1) {
    const dx = (line[i][0] - line[i - 1][0]) * Math.cos((line[i][1] * Math.PI) / 180);
    const dy = line[i][1] - line[i - 1][1];
    const span = Math.hypot(dx, dy);
    spans.push(span);
    total += span;
  }
  if (!(total > 0)) return { lon: line[0][0], lat: line[0][1] };
  let walked = 0;
  for (let i = 0; i < spans.length; i += 1) {
    if (walked + spans[i] >= total / 2) {
      const t = spans[i] > 0 ? (total / 2 - walked) / spans[i] : 0;
      return {
        lon: line[i][0] + (line[i + 1][0] - line[i][0]) * t,
        lat: line[i][1] + (line[i + 1][1] - line[i][1]) * t,
      };
    }
    walked += spans[i];
  }
  const last = line[line.length - 1];
  return { lon: last[0], lat: last[1] };
}

/** Whether the camera can currently see any of Paris. */
export function comptagesInView(viewer) {
  const box = cameraViewBox(viewer);
  if (!box) return false;
  // cameraViewBox unwraps east past 180 across the dateline; the coverage box
  // is at +2°, so a view that crossed the seam has to be tested folded back.
  if (boxesIntersect(box, COMPTAGES_PARIS_BOX)) return true;
  return boxesIntersect({ ...box, west: box.west - 360, east: box.east - 360 }, COMPTAGES_PARIS_BOX);
}

// --- Drawing ----------------------------------------------------------------

function clearHighlight() {
  if (_highlight) {
    _viewer?.scene?.groundPrimitives?.remove?.(_highlight);
    _highlight = null;
  }
}

function clearPrimitives() {
  stopStyleRetry();
  for (const primitive of _primitives) {
    _viewer?.scene?.groundPrimitives?.remove?.(primitive);
  }
  _primitives = [];
  _bandPrimitives = new Array(COMPTAGES_FLOW_WIDTHS.length).fill(null);
  _gapPrimitive = null;
  clearHighlight();
}

/** Add one ground-polyline batch to the scene and register it. */
function addBatch(instances, appearance) {
  if (!instances.length || !_viewer?.scene?.groundPrimitives?.add) return null;
  const primitive = _viewer.scene.groundPrimitives.add(new Cesium.GroundPolylinePrimitive({
    geometryInstances: instances,
    classificationType: _classificationType,
    appearance,
    // The attribute table is what the cursor writes to. Releasing the instances
    // is the documented default and does not take the table with it, but the
    // repo's one other per-instance writer (`bdtopoBuildings.js`) keeps them,
    // and a batch this layer rewrites on every chip is not the place to differ.
    releaseGeometryInstances: false,
  }));
  primitive.show = _enabled;
  _primitives.push(primitive);
  return primitive;
}

/** A dashed material, one colour for the whole batch — materials are not per-instance. */
function dashedAppearance(color, alpha, dashLength) {
  return new Cesium.PolylineMaterialAppearance({
    material: Cesium.Material.fromType('PolylineDash', {
      color: Cesium.Color.fromCssColorString(color).withAlpha(alpha),
      dashLength,
    }),
  });
}

/** One geometry instance for one arc, at one baked width. */
function arcInstance(record, widthPx, attributes) {
  return new Cesium.GeometryInstance({
    id: record.id,
    // The positions array is SHARED between an arc's band instances: Cesium
    // packs it into the worker payload, so five instances of one arc cost five
    // wrappers and one coordinate list.
    geometry: new Cesium.GroundPolylineGeometry({ positions: record.positions, width: widthPx }),
    attributes,
  });
}

/**
 * Rebuild every batch for the whole city.
 *
 * EIGHT primitives, and the count is forced by two Cesium facts, not chosen:
 * a dash is a MATERIAL and a material is per-primitive (the constraint
 * `powerGrid.js` hits on its underground cables), and a stroke WIDTH is baked
 * into the geometry, so a width band is a primitive too. What is per-instance —
 * `color` and `show` — is exactly what the hour cursor needs, which is why the
 * cursor never comes back here.
 *
 * See the module header for the measured instance counts: 4 970 band instances
 * rather than 8 560, because an arc is only given geometry in the bands it can
 * actually reach.
 */
function drawArcs(payload) {
  clearPrimitives();
  _records = new Map();
  if (!_viewer) return;
  if (_groundLinesSupported === null) {
    _groundLinesSupported = Cesium.GroundPolylinePrimitive.isSupported(_viewer.scene);
    if (!_groundLinesSupported) {
      console.warn('[Data:Comptages FR] GroundPolylinePrimitive unsupported — arcs disabled');
    }
  }
  if (!_groundLinesSupported) return;

  const arcs = Array.isArray(payload?.arcs) ? payload.arcs : [];
  const counted = [];
  const occupancy = [];
  const silent = [];
  const warm = [];
  for (const arc of arcs) {
    const style = comptagesArcStyle(arc, _slot);
    const midpoint = comptagesMidpoint(arc.g);
    const id = `comptages-fr:${arc.a}`;
    const positions = comptagesPositions(arc.g);
    // An unplaceable arc is still a record — the card cannot be opened from the
    // globe, but the counts are real and the row reports them.
    const record = {
      id,
      arc,
      style,
      midpoint,
      positions,
      bands: comptagesReachableBands(arc),
      hasGap: comptagesHasHourGap(arc),
      painted: null,
    };
    _records.set(id, record);
    if (!positions) continue;
    if (midpoint && warm.length < FLOOR_WARM_LIMIT) warm.push(midpoint);
    if (arc.s === 'counted') counted.push(record);
    else if (arc.s === 'occupancy') occupancy.push(record);
    else silent.push(record);
  }

  // The five width bands. Colour is the rhythm hue and is written once here,
  // because the class is a property of the WEEK — the cursor never changes it.
  for (let band = 0; band < COMPTAGES_FLOW_WIDTHS.length; band += 1) {
    const instances = [];
    for (const record of counted) {
      if (!record.bands.includes(band)) continue;
      const visible = !record.style.gap && record.style.bin === band;
      if (visible) record.painted = band;
      instances.push(arcInstance(record, COMPTAGES_FLOW_WIDTHS[band], {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(
          Cesium.Color.fromCssColorString(record.style.color).withAlpha(COMPTAGES_STROKE_ALPHA),
        ),
        show: new Cesium.ShowGeometryInstanceAttribute(visible),
      }));
    }
    _bandPrimitives[band] = addBatch(
      instances, new Cesium.PolylineColorAppearance({ translucent: true }),
    );
  }

  // Occupancy: one steel colour, one width, never on the count scale and never
  // moved by the cursor. It shares the colour appearance so it costs no extra
  // material, and it is a separate batch only because its width is its own.
  const occupancyInstances = occupancy.map((record) => arcInstance(
    record, COMPTAGES_OCCUPANCY_WIDTH, {
      color: Cesium.ColorGeometryInstanceAttribute.fromColor(
        Cesium.Color.fromCssColorString(COMPTAGES_OCCUPANCY_COLOR).withAlpha(COMPTAGES_STROKE_ALPHA),
      ),
    },
  ));
  addBatch(occupancyInstances, new Cesium.PolylineColorAppearance({ translucent: true }));

  // The two absences, one dashed material each.
  addBatch(
    silent.map((record) => arcInstance(record, COMPTAGES_SILENT_WIDTH, {})),
    dashedAppearance(COMPTAGES_SILENT_COLOR, COMPTAGES_SILENT_ALPHA, COMPTAGES_SILENT_DASH_LENGTH),
  );
  const gapInstances = [];
  for (const record of counted) {
    if (!record.hasGap) continue;
    if (record.style.gap) record.painted = 'gap';
    gapInstances.push(arcInstance(record, COMPTAGES_HOUR_GAP_WIDTH, {
      show: new Cesium.ShowGeometryInstanceAttribute(record.style.gap),
    }));
  }
  _gapPrimitive = addBatch(
    gapInstances,
    dashedAppearance(
      COMPTAGES_HOUR_GAP_COLOR, COMPTAGES_HOUR_GAP_ALPHA, COMPTAGES_HOUR_GAP_DASH_LENGTH,
    ),
  );

  if (warm.length) warmGroundFloor(warm);
  governorRequestRender('comptages-fr-draw');
}

// --- The hour cursor --------------------------------------------------------

/** The batch an arc is drawn in for a given target — a band index, or the gap. */
function primitiveForTarget(target) {
  return target === 'gap' ? _gapPrimitive : _bandPrimitives[target] ?? null;
}

/**
 * Write one instance's `show`, or report that the batch was not ready.
 *
 * `getGeometryInstanceAttributes` throws before the primitive's first update,
 * which is a NOT-YET and not a failure: the caller re-tries on the next frame
 * rather than leaving the map showing the previous slot.
 */
function setInstanceShow(primitive, id, visible) {
  if (!primitive) return true;
  if (!primitive.ready) return false;
  try {
    const attributes = primitive.getGeometryInstanceAttributes(id);
    if (!attributes) return true;
    attributes.show = Cesium.ShowGeometryInstanceAttribute.toValue(visible);
    return true;
  } catch {
    return false;
  }
}

/**
 * Frames the retry is allowed before it gives up and rebuilds instead.
 *
 * A chip pressed while the batches are still on the geometry worker cannot
 * write `show` yet, and Cesium's async pipeline settles in a handful of frames.
 * Four seconds at 60 fps is two orders of magnitude of head-room; past it the
 * batch is not coming, and spinning an O(2 977) pass every frame forever would
 * be a worse failure than the one it is waiting on.
 */
const STYLE_RETRY_FRAME_BUDGET = 240;

/** Retry the pending `show` writes once the batches finish building. */
function scheduleStyleRetry() {
  if (_styleRetryRemover || !_viewer?.scene?.postRender?.addEventListener) return;
  _styleRetryFrames = 0;
  _styleRetryRemover = _viewer.scene.postRender.addEventListener(() => {
    if (!_stylePending) {
      stopStyleRetry();
      return;
    }
    _styleRetryFrames += 1;
    if (_styleRetryFrames > STYLE_RETRY_FRAME_BUDGET) {
      // Correctness over the batch: rebuilding bakes the right attributes at
      // construction, so the map cannot be left showing one slot under a label
      // that names another. Expensive, and it has never been reached.
      stopStyleRetry();
      if (_payload) drawArcs(_payload);
      return;
    }
    applySlotStyles({ force: true });
  });
}

function stopStyleRetry() {
  if (_styleRetryRemover) {
    _styleRetryRemover();
    _styleRetryRemover = null;
  }
  _styleRetryFrames = 0;
  _stylePending = false;
}

/**
 * Repaint the city for the current slot — WITHOUT touching a vertex.
 *
 * Two `show` writes per arc that moved band, and nothing at all for an arc that
 * did not. This is the whole reason the geometry is banded: rebuilding the
 * batches here would drop the vertex arrays and freeze the globe during exactly
 * the gesture the chips exist to make fluid (rule G2).
 */
function applySlotStyles({ force = false } = {}) {
  let pending = false;
  let moved = 0;
  for (const record of _records.values()) {
    const style = comptagesArcStyle(record.arc, _slot);
    record.style = style;
    if (!record.positions || record.arc?.s !== 'counted') continue;
    const target = style.gap ? 'gap' : style.bin;
    if (!force && record.painted === target) continue;
    let ok = true;
    if (force) {
      for (const band of record.bands) {
        ok = setInstanceShow(_bandPrimitives[band], record.id, band === target) && ok;
      }
      if (record.hasGap) ok = setInstanceShow(_gapPrimitive, record.id, target === 'gap') && ok;
    } else {
      if (record.painted !== null) {
        ok = setInstanceShow(primitiveForTarget(record.painted), record.id, false) && ok;
      }
      ok = setInstanceShow(primitiveForTarget(target), record.id, true) && ok;
    }
    if (ok) {
      record.painted = target;
      moved += 1;
    } else {
      pending = true;
    }
  }
  _stylePending = pending;
  if (pending) scheduleStyleRetry();
  else stopStyleRetry();
  if (moved || force) governorRequestRender('comptages-fr-slot');
  return moved;
}

/**
 * Re-resolve `clock` and repaint when the Paris hour has rolled over.
 *
 * Called from the two surfaces the panel already polls, rather than adding a
 * timer: `updateInterval` here is six hours because the DATA changes weekly,
 * and shortening it to follow a clock would re-fetch 0.3 MB to move a chip.
 */
function syncClockSlot() {
  if (_slotToken !== 'clock') return;
  const next = comptagesResolveSlot('clock', _now());
  if (next.day === _slot.day && next.hour === _slot.hour) return;
  _slot = next;
  applySlotStyles();
  if (_selectedId) repaintSelectedCard(_selectedId);
}

/** Re-classify against the active surface, rebuilding the baked batches. */
function applyClassification(next) {
  if (next === undefined || next === _classificationType) return;
  _classificationType = next;
  if (_payload) drawArcs(_payload);
  _viewer?.scene?.requestRender?.();
}

/** Cartesian anchor for an arc's card, on the shared coarse ground floor. */
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

// --- Cards ------------------------------------------------------------------

/** French thousands separator, matching the rest of the French packs. */
function fr(value) {
  return Number(value).toLocaleString('fr-FR');
}

/** `du 24 au 30 août 2026`, from the two ISO dates the pack carries. */
export function comptagesWeekLabel(week) {
  if (!week?.start || !week?.end) return null;
  const month = (iso) => new Date(`${iso}T12:00:00Z`)
    .toLocaleDateString('fr-FR', { month: 'long', timeZone: 'UTC' });
  const day = (iso) => Number(iso.slice(8, 10));
  const year = week.end.slice(0, 4);
  const from = month(week.start) === month(week.end)
    ? `${day(week.start)}`
    : `${day(week.start)} ${month(week.start)}`;
  return `du ${from} au ${day(week.end)} ${month(week.end)} ${year}`;
}

/**
 * The silence, named.
 *
 * Three different things share one appearance on the map and must not share one
 * sentence: 724 of the 891 silent arcs are declared `Invalide` by the operator,
 * 26 are `Barré` — the road is shut, not the sensor — and 141 are declared
 * `Ouvert` and publish nothing anyway. The last is the only one that is
 * genuinely unexplained, and the card says so instead of implying a fault the
 * city never claimed.
 */
export function comptagesSilenceLine(arc, hours = 168) {
  if (arc?.s !== 'silent') return null;
  if (arc.b === 'i') return `Aucune mesure sur ${hours} h — capteur déclaré invalide par la Ville`;
  if (arc.b === 'b') return `Aucune mesure sur ${hours} h — arc déclaré barré à la circulation`;
  if (arc.b === 'o') return `Aucune mesure sur ${hours} h — arc pourtant déclaré ouvert`;
  return `Aucune mesure sur ${hours} h — aucun état publié pour cet arc`;
}

/**
 * The numbers behind the hue, in one parenthesis.
 *
 * The class is a waterfall over four measured ratios, and the card prints the
 * one that decided it rather than asserting the class on its own authority. An
 * arc that could not be classified says which day-type is short of hours — the
 * refusal is a fact about the data, so it gets a number too.
 */
function rhythmEvidence(arc) {
  const metrics = comptagesRhythmMetrics(arc);
  if (!metrics) return '';
  const pct = (value) => `${(value * 100).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} %`;
  const times = (value) => `×${value.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}`;
  const T = COMPTAGES_RHYTHM_THRESHOLDS;
  if (metrics.weekdayHours < T.coverage || metrics.weekendHours < T.coverage) {
    return ` (${metrics.weekdayHours}/24 h en semaine, ${metrics.weekendHours}/24 h le week-end)`;
  }
  if (Number.isFinite(metrics.nightShare) && metrics.nightShare >= T.night) {
    return ` (${pct(metrics.nightShare)} du trafic entre 00 et 04 h)`;
  }
  if (Number.isFinite(metrics.weekendRatio) && metrics.weekendRatio >= T.weekend) {
    return ` (${times(metrics.weekendRatio)} l’heure de semaine, le week-end)`;
  }
  const parts = [];
  if (Number.isFinite(metrics.morningShoulder) && metrics.morningShoulder >= T.shoulder) {
    parts.push(`matin ${times(metrics.morningShoulder)}`);
  }
  if (Number.isFinite(metrics.eveningShoulder) && metrics.eveningShoulder >= T.shoulder) {
    parts.push(`soir ${times(metrics.eveningShoulder)}`);
  }
  return parts.length ? ` (${parts.join(', ')} le creux de midi)` : '';
}

/**
 * Card copy for one selected arc.
 *
 * Every line is a published value, a count of published values, or a stated
 * absence of one. The two sparklines share ONE scale so the weekend can be read
 * against the week rather than against itself, and both come from the shared
 * `textSparkline`, which draws a gap as `·` and a measured zero as `▁`.
 *
 * @param {object} record Render record.
 * @param {object} [payload] The document the record came from.
 * @returns {string} Newline-separated card copy.
 */
export function buildComptagesSelectionLabel(record, payload = null, slot = _slot) {
  const arc = record?.arc || {};
  const details = [];
  const title = arc.n ? `${arc.n} · arc ${arc.a}` : `Arc ${arc.a}`;
  const hours = Number(payload?.hours) || 168;

  // Which stretch of the street this is. 2 977 arcs carry 892 distinct names,
  // so the two junction labels are the only thing that identifies the segment.
  if (arc.f && arc.t) details.push(`de ${arc.f} à ${arc.t}`);

  if (arc.s === 'silent') {
    details.push(comptagesSilenceLine(arc, hours));
  } else if (arc.s === 'occupancy') {
    details.push(`Occupation mesurée sur ${fr(arc.hk)} h — aucun véhicule compté`);
  } else {
    // The selected slot FIRST, because it is what the width on screen is
    // showing. A gap here is stated as a gap and never as a low count.
    const flow = comptagesArcFlow(arc, slot);
    if (slot?.kind === 'mean') {
      details.push(`${fr(arc.mq ?? 0)} véh/h en moyenne, l’heure ouvrée type`);
    } else if (flow === null) {
      details.push(`Aucun comptage publié — ${comptagesSlotLabel(slot)}`);
    } else {
      details.push(`${fr(Math.round(flow))} véh/h — ${comptagesSlotLabel(slot)}`);
      details.push(`${fr(arc.mq ?? 0)} véh/h en moyenne, l’heure ouvrée type`);
    }
    details.push(`${fr(arc.hq)} heures comptées sur ${fr(hours)}`);
    // WHY the arc is the colour it is. A hue the reader has to take on trust is
    // not a legend, and the four numbers behind it are already computed.
    // Read off the ARC and not off the render record: the class is a pure
    // function of the pack, and a card built for an arc that is not currently
    // drawn (an unplaced one, say) must say the same thing as one that is.
    const rhythm = comptagesRhythmLabel(comptagesRhythmClass(arc));
    if (rhythm) details.push(`Rythme : ${rhythm.toLowerCase()}${rhythmEvidence(arc)}`);
  }

  const reference = comptagesProfileReference(arc.wq, arc.eq);
  const weekday = comptagesDayLine({
    label: 'Sem.', profile: arc.wq, reference, days: 5,
  });
  const weekend = comptagesDayLine({
    label: 'W-E ', profile: arc.eq, reference, days: 2,
  });
  if (weekday) details.push(weekday);
  if (weekend) details.push(weekend);

  // Occupancy, in the operator's OWN bands — the thresholds are published on
  // the `k` field itself and `etat_trafic` is a pure function of them.
  if (Number.isFinite(arc.mk)) {
    const band = comptagesOccupancyBand(arc.mk);
    const saturated = comptagesSaturatedHours(arc.wk) + comptagesSaturatedHours(arc.ek);
    const line = [`Occupation ${fr(arc.mk)} % — ${band ? band.label.toLowerCase() : '—'}`];
    if (saturated > 0) line.push(`${saturated} h saturées ou pire`);
    details.push(line.join(' · '));
  }

  if (arc.s !== 'silent' && arc.b && arc.b !== 'o') {
    details.push(`Arc ${COMPTAGES_BARRE_LABELS[arc.b]} ${fr(arc.bh ?? 0)} h sur ${fr(hours)}`);
  }
  if (!arc.g) details.push('⚠ Aucune géométrie publiée pour cet arc — non tracé');

  const week = comptagesWeekLabel(payload?.week);
  details.push(`Mesuré, J-2 · semaine ${week || '—'} · ${comptagesSlotLabel(slot)}`);
  details.push('Ville de Paris — ODbL');

  return [title, ...details.filter(Boolean)].join('\n');
}

/** Protected selected-arc entry for the shared overlay host. */
export function createComptagesSelectedOverlayEntry(record, payload = null, slot = _slot) {
  const position = cardPosition(record);
  if (!record?.id || !position) return null;
  const [title, ...details] = buildComptagesSelectionLabel(record, payload, slot).split('\n');
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

// --- Selection --------------------------------------------------------------

function clearSelection() {
  clearHighlight();
  if (_selectedId) {
    _selectedId = null;
    _overlayHost.clearSource(COMPTAGES_FR_OVERLAY_SOURCE_ID);
    governorRequestRender('comptages-fr-deselect');
  }
}

function selectArc(id) {
  clearSelection();
  const record = _records.get(id);
  if (!record || !_viewer) return;
  _selectedId = id;
  const positions = comptagesPositions(record.arc?.g);
  if (positions) {
    // A batched instance cannot be restyled without rebuilding the batch — and
    // the dashed batch shares one material, so it could not be restyled at all.
    // The selection is a SECOND stroke over the first, which works identically
    // for both, the same technique road-status-fr and the power grid use.
    _highlight = _viewer.scene.groundPrimitives.add(new Cesium.GroundPolylinePrimitive({
      geometryInstances: new Cesium.GeometryInstance({
        geometry: new Cesium.GroundPolylineGeometry({
          positions,
          width: record.style.widthPx + SELECTED_WIDTH_BONUS,
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
  repaintSelectedCard(id);
  governorRequestRender('comptages-fr-select');
}

/**
 * Rewrite the open card for the current slot.
 *
 * The card quotes the selected hour, so a chip pressed while a card is open has
 * to move the card too — otherwise the panel and the map would be reading two
 * different hours of the same street.
 */
function repaintSelectedCard(id) {
  const record = _records.get(id);
  if (!record) return;
  const entry = createComptagesSelectedOverlayEntry(record, _payload, _slot);
  if (!entry) return;
  _overlayHost.setEntries(
    COMPTAGES_FR_OVERLAY_SOURCE_ID, [entry], COMPTAGES_FR_OVERLAY_SOURCE_OPTIONS,
  );
}

function onKeyDown(event) {
  if (event.key === 'Escape' && _selectedId) clearSelection();
}

function installClickHandler(viewer) {
  if (_clickHandler) return;
  _clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  _clickHandler.setInputAction((movement) => {
    const picked = viewer.scene.pick(movement.position);
    // A batched GroundPolylinePrimitive reports the GeometryInstance id.
    const id = typeof picked?.id === 'string' ? picked.id : null;
    if (id && _records.has(id)) {
      selectArc(id);
      return;
    }
    if (_selectedId) clearSelection();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  if (typeof document !== 'undefined') document.addEventListener('keydown', onKeyDown);
}

// --- Loading ----------------------------------------------------------------

/**
 * Fetch the week, once.
 *
 * There is no viewport in the request and no cache key: the answer is the same
 * 0.3 MB whatever the camera is doing, and it changes once a week. `force` is
 * what `update()` uses to re-ask after the poll interval; everything else that
 * moves the camera only decides whether to ask at all.
 */
async function load({ force = false } = {}) {
  if (!_enabled || !_viewer) return false;
  _inView = comptagesInView(_viewer);
  if (!_inView) {
    // Not an error and not an empty dataset — the operator is looking
    // somewhere else. Keep whatever is drawn; it is still true.
    _status = 'empty';
    _loading = false;
    return false;
  }
  if (_payload && !force) return false;

  _abort?.abort();
  const controller = new AbortController();
  _abort = controller;
  _loading = !_payload;
  _error = null;
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(ARCS_URL, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload?.arcs)) throw new Error('malformed payload');
    if (controller.signal.aborted || !_enabled) return false;
    _payload = payload;
    _stale = !!payload.stale;
    _lastUpdate = Number(payload.fetchedAt) || Date.now();
    _error = null;
    drawArcs(payload);
    _status = _records.size > 0 ? 'ready' : 'empty';
    return true;
  } catch (error) {
    if (error?.name === 'AbortError') return false;
    console.warn('[Data:Comptages FR] arcs unavailable:', error?.message || error);
    // A week-old pack is still the same week. Keep drawing it and say the
    // refresh failed rather than blanking a city.
    _error = _payload
      ? 'rafraîchissement des comptages indisponible'
      : 'comptages routiers de Paris indisponibles';
    _status = _payload ? 'ready' : 'error';
    return false;
  } finally {
    clearTimeout(timer);
    _loading = false;
    if (_abort === controller) _abort = null;
  }
}

function scheduleLoad() {
  clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(() => { void load(); }, CAMERA_DEBOUNCE_MS);
}

// --- Detection --------------------------------------------------------------

function collectDetectableObjects(options = {}) {
  if (!_enabled || !_records.size) return [];
  const records = [];
  for (const record of _records.values()) {
    // Only what is actually on the globe. An arc with no published geometry has
    // no position to hand the detector, and must not be invented one. And only
    // what the SELECTED slot measured: a callout reading "0 véh/h" on an hour
    // nobody published would be the same lie the dash exists to prevent.
    if (record.midpoint && record.arc?.s === 'counted' && !record.style?.gap) records.push(record);
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
    const floor = cachedGroundFloor(record.midpoint.lat, record.midpoint.lon);
    result.push({
      position: Cesium.Cartesian3.fromDegrees(
        record.midpoint.lon,
        record.midpoint.lat,
        (Number.isFinite(floor) ? floor : 0) + CARD_LIFT_M,
      ),
      sourceId: record.id,
      id: `${fr(Math.round(record.style?.flow ?? record.arc.mq ?? 0))} véh/h`,
      type: 'Counting arc',
      skipLabel: record.id === _selectedId,
    });
    if (result.length >= maxCount) break;
  }
  return result;
}

// --- Row label --------------------------------------------------------------

/**
 * One line under the layer's toggle: what this view actually contains.
 *
 * It names the WEEK and the SLOT on every state that draws anything, because a
 * screenshot of this layer has to be readable on its own (rule E1) and the slot
 * is now the difference between two very different maps of the same street.
 */
export function buildComptagesLoadingLabel({
  payload = _payload, loading = _loading, inView = _inView, error = _error, slot = _slot,
} = {}) {
  if (loading) return 'lecture de la semaine mesurée...';
  if (!inView) return 'Paris intra-muros uniquement — hors de la vue';
  if (!payload) return error ? '' : '';
  const parts = [];
  const week = comptagesWeekLabel(payload.week);
  parts.push(`${fr(payload.states?.counted || 0)} arcs comptés${week ? ` · semaine ${week}` : ''}`);
  parts.push(comptagesSlotLabel(slot));
  const silent = payload.states?.silent || 0;
  if (silent > 0) parts.push(`${fr(silent)} sans aucune mesure`);
  // The arcs that count and cannot be drawn. Stated here because the map
  // cannot state it: there is nothing on screen to click.
  if (payload.unplacedMeasuring > 0) {
    parts.push(`${fr(payload.unplacedMeasuring)} arcs mesurés sans géométrie publiée`);
  }
  return parts.join(' · ');
}

// --- Layer ------------------------------------------------------------------

const comptagesParisLayer = {
  id: COMPTAGES_FR_LAYER_ID,
  name: 'Comptages routiers (Paris)',
  // NOT the 🚗 the taxonomy group uses, not `traffic`'s and not
  // `road-status-fr`'s: those two draw congestion and this one draws a count.
  icon: '🚦',
  source: 'Comptages routiers permanents — Ville de Paris',
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
    _stale = false;
    _lastUpdate = null;
    _inView = false;
    _bandPrimitives = new Array(COMPTAGES_FLOW_WIDTHS.length).fill(null);
    _gapPrimitive = null;
    _slotToken = COMPTAGES_SLOT_MEAN;
    _slot = comptagesResolveSlot(COMPTAGES_SLOT_MEAN, _now());
    _classificationType = powerClassificationTypeForScene(viewer?.scene);

    if (typeof window !== 'undefined' && !_mapStackListener) {
      _mapStackListener = (event) => {
        applyClassification(event?.detail?.activeId !== undefined
          ? powerClassificationTypeForStack(event.detail.activeId)
          : powerClassificationTypeForScene(_viewer?.scene));
      };
      window.addEventListener('gev:map-stack-changed', _mapStackListener);
    }
    _overlayHost.setVisible(COMPTAGES_FR_OVERLAY_SOURCE_ID, false);
    console.log('[Data:Comptages FR] Initialized');
  },

  enable(viewer) {
    _enabled = true;
    _error = null;
    for (const primitive of _primitives) primitive.show = true;
    // The boot-time stack settle fires no event, so re-derive on every enable
    // rather than trusting whatever the last event left behind.
    applyClassification(powerClassificationTypeForScene(viewer?.scene || _viewer?.scene));
    _overlayHost.setVisible(COMPTAGES_FR_OVERLAY_SOURCE_ID, true);
    installClickHandler(viewer);
    registerPickOwner(COMPTAGES_FR_LAYER_ID, (pickedId) => _records.has(pickedId));
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
    stopStyleRetry();
    for (const primitive of _primitives) primitive.show = false;
    _overlayHost.setVisible(COMPTAGES_FR_OVERLAY_SOURCE_ID, false);
    if (_clickHandler) {
      _clickHandler.destroy();
      _clickHandler = null;
    }
    if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeyDown);
    unregisterPickOwner(COMPTAGES_FR_LAYER_ID);
    if (_moveEndRemover) {
      _moveEndRemover();
      _moveEndRemover = null;
    }
    _loading = false;
    _status = 'idle';
  },

  async update() {
    if (!_enabled) return false;
    // `load()` answers "did I fetch", which is false when the camera is not on
    // Paris and false on an unchanged pack. Neither is a refusal of the
    // lifecycle transition, and DataLayerManager reads a literal `false` from
    // update() as exactly that.
    await load({ force: true });
    return true;
  },

  getDetectableObjects(options = {}) {
    return collectDetectableObjects(options);
  },

  getStats() {
    syncClockSlot();
    const stats = {
      count: _records.size,
      lastUpdate: _lastUpdate,
      loading: _loading,
      status: _status === 'ready' ? 'ok' : _status,
      stale: _stale,
      // The layer's own honesty numbers, surfaced rather than buried.
      arcsCounted: _payload?.states?.counted ?? null,
      arcsOccupancyOnly: _payload?.states?.occupancy ?? null,
      arcsSilent: _payload?.states?.silent ?? null,
      arcsUnplaced: _payload?.unplaced ?? null,
      arcsUnplacedMeasuring: _payload?.unplacedMeasuring ?? null,
      week: _payload?.week ?? null,
      processedAt: _payload?.processedAt ?? null,
      // The instant represented, published rather than implied (rule E1).
      slot: _slotToken,
      slotLabel: comptagesSlotLabel(_slot),
    };
    const label = buildComptagesLoadingLabel();
    if (label) stats.loadingLabel = label;
    if (_error) stats.error = _error;
    return stats;
  },

  /** Provenance for the attribution popover and the analyst surfaces. */
  getViewportSummary() {
    if (!_payload) return null;
    const { arcs, ...summary } = _payload;
    return {
      ...summary,
      drawn: _records.size,
      inView: _inView,
      slot: _slotToken,
      slotDay: _slot.day,
      slotHour: _slot.hour,
    };
  },

  /**
   * Seven hour chips, and a legend for BOTH channels of a bivariate map.
   *
   * The chips are not serialized into the share link — the layer is registered
   * `enabled-only` in `layerState.js`, a shared file this module does not own —
   * so a shared view always opens on `mean`, the aggregate the layer has always
   * drawn. That is the right default anyway: `mean` is reproducible for two
   * readers opening the same link at different times of day, which `clock`
   * would not be.
   *
   * The legend has three blocks and it needs all three, because the map now
   * encodes two variables at once (rule D1 applies to the hue; C1 requires the
   * width cuts to be published):
   *   1. the RHYTHM classes, in colour, counted over the whole pack;
   *   2. the DÉBIT bands, in width, counted at the SELECTED slot — the swatch is
   *      a masked stroke of the real width, so the key shows the thing itself;
   *   3. the three strokes that are off the count scale.
   * Every count is tallied over the whole pack because the whole pack is drawn:
   * there is no viewport and no cap here, so `n affiché / N connu` are the same
   * number and rule A5 has nothing to declare beyond the 31 unplaced arcs the
   * row label already names.
   */
  getRowControls() {
    syncClockSlot();
    const chips = COMPTAGES_MOMENTS.map((moment) => {
      const active = _slotToken === moment.slot;
      return {
        id: moment.id,
        label: moment.label,
        active,
        state: active ? 'active' : 'idle',
        title: moment.slot === 'clock'
          ? `Suivre l’horloge de Paris — actuellement ${comptagesSlotLabel(comptagesResolveSlot('clock', _now()))}, `
            + `lu dans la semaine archivée ${comptagesWeekLabel(_payload?.week) || '—'}`
          : `${comptagesSlotLabel(comptagesResolveSlot(moment.slot, _now()))} — `
            + `semaine archivée ${comptagesWeekLabel(_payload?.week) || '—'}`,
        params: { slot: moment.slot },
      };
    });
    if (!_payload) return { chips, legend: [] };

    const legend = [];
    // 1. The hue: the shape of the week. Counted over every arc that has one,
    // drawn or not, because the class does not depend on the slot.
    const rhythms = new Map();
    const bands = new Array(COMPTAGES_FLOW_WIDTHS.length).fill(0);
    let gaps = 0;
    for (const record of _records.values()) {
      const style = record.style;
      if (style.rhythm) rhythms.set(style.rhythm, (rhythms.get(style.rhythm) || 0) + 1);
      if (style.gap) gaps += 1;
      else if (style.bin !== null) bands[style.bin] += 1;
    }
    for (const rhythm of COMPTAGES_RHYTHM_CLASSES) {
      const count = rhythms.get(rhythm) || 0;
      if (!count) continue;
      legend.push({
        label: comptagesRhythmLabel(rhythm),
        color: COMPTAGES_RHYTHM_COLORS[rhythm],
        count,
        blurb: COMPTAGES_RHYTHM_BLURBS[rhythm],
      });
    }
    // 2. The width: the count, at this slot. A band at zero is dropped, but the
    // thresholds themselves are frozen and never re-cut from what is on screen.
    bands.forEach((count, bin) => {
      if (!count) return;
      legend.push({
        label: comptagesFlowBandLabel(bin),
        color: COMPTAGES_WIDTH_INK,
        glyph: comptagesFlowBandGlyph(bin),
        count,
        blurb: BAND_BLURBS[bin],
      });
    });
    // 3. The three strokes that are not on the count scale. The silent row is
    // kept even at zero: "a dashed line means nobody measured this street" is
    // the entry a reader has to be given before they can read the map at all.
    const states = _payload.states || {};
    if (states.occupancy > 0) {
      legend.push({
        label: COMPTAGES_STATE_LABELS.occupancy,
        color: COMPTAGES_OCCUPANCY_COLOR,
        glyph: comptagesStrokeGlyph({ widthPx: COMPTAGES_OCCUPANCY_WIDTH }),
        count: states.occupancy,
        blurb: OCCUPANCY_BLURB,
      });
    }
    if (gaps > 0) {
      legend.push({
        label: COMPTAGES_HOUR_GAP_LABEL,
        color: COMPTAGES_HOUR_GAP_COLOR,
        glyph: comptagesStrokeGlyph({
          widthPx: COMPTAGES_HOUR_GAP_WIDTH, dashLength: COMPTAGES_HOUR_GAP_DASH_LENGTH,
        }),
        count: gaps,
        blurb: HOUR_GAP_BLURB,
      });
    }
    if (states.silent > 0) {
      legend.push({
        label: COMPTAGES_STATE_LABELS.silent,
        color: COMPTAGES_SILENT_COLOR,
        glyph: comptagesStrokeGlyph({
          widthPx: COMPTAGES_SILENT_WIDTH, dashLength: COMPTAGES_SILENT_DASH_LENGTH,
        }),
        count: states.silent,
        blurb: `${SILENT_BLURB_HEAD} `
          + `${fr(_payload.silentBy?.i || 0)} sont déclarés invalides par la Ville, `
          + `${fr(_payload.silentBy?.b || 0)} barrés, et ${fr(_payload.silentBy?.o || 0)} déclarés ouverts.`,
      });
    }
    return { chips, legend };
  },

  /**
   * Move the hour cursor.
   *
   * An unknown token is IGNORED rather than clamped or defaulted: a chip that
   * silently moved the reader to 04:00 because a caller sent nonsense would be
   * worse than a chip that did nothing — the same rule `idfm-frequency` wrote
   * down for its bands.
   */
  setParams(params = {}) {
    const parsed = comptagesParseSlot(params?.slot);
    if (!parsed) return;
    const token = parsed.kind === 'clock' ? 'clock' : parsed.token;
    if (token === _slotToken) return;
    _slotToken = token;
    _slot = comptagesResolveSlot(token, _now());
    applySlotStyles();
    if (_selectedId) repaintSelectedCard(_selectedId);
  },

  getParams() {
    return { slot: _slotToken, day: _slot.day, hour: _slot.hour };
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
      unregisterPickOwner(COMPTAGES_FR_LAYER_ID);
    }
    if (typeof window !== 'undefined' && _mapStackListener) {
      window.removeEventListener('gev:map-stack-changed', _mapStackListener);
      _mapStackListener = null;
    }
    if (_moveEndRemover) {
      _moveEndRemover();
      _moveEndRemover = null;
    }
    stopStyleRetry();
    clearPrimitives();
    _records.clear();
    _payload = null;
    _viewer = null;
  },
};

/** Seed rendered records so selection/card/legend paths run without WebGL. */
export function _setComptagesStateForTest({
  viewer, payload, overlayHost, enabled = true, inView = true,
  slot = COMPTAGES_SLOT_MEAN, now = null,
} = {}) {
  _viewer = viewer || null;
  _overlayHost = overlayHost || DEFAULT_OVERLAY_HOST;
  _payload = payload || null;
  _now = typeof now === 'function' ? now : DEFAULT_NOW;
  _slotToken = comptagesParseSlot(slot) ? slot : COMPTAGES_SLOT_MEAN;
  _slot = comptagesResolveSlot(_slotToken, _now());
  _records = new Map();
  for (const arc of payload?.arcs || []) {
    const id = `comptages-fr:${arc.a}`;
    _records.set(id, {
      id,
      arc,
      style: comptagesArcStyle(arc, _slot),
      midpoint: comptagesMidpoint(arc.g),
      positions: null,
      bands: comptagesReachableBands(arc),
      hasGap: comptagesHasHourGap(arc),
      painted: null,
    });
  }
  _enabled = enabled;
  _inView = inView;
  _selectedId = null;
  _loading = false;
  _error = null;
  _stale = !!payload?.stale;
  _status = 'ready';
}

/** Exercise the production selection path in focused runtime tests. */
export function _selectComptagesForTest(id) {
  selectArc(id);
}

/** Exercise the production clear path and restore the production host seam. */
export function _clearComptagesSelectionForTest() {
  clearSelection();
  stopStyleRetry();
  _overlayHost = DEFAULT_OVERLAY_HOST;
  _now = DEFAULT_NOW;
  _payload = null;
  _records = new Map();
  _enabled = false;
  _inView = false;
  _status = 'idle';
  _slotToken = COMPTAGES_SLOT_MEAN;
  _slot = comptagesResolveSlot(COMPTAGES_SLOT_MEAN);
}

/** @returns {?string} */
export function _comptagesSelectedIdForTest() {
  return _selectedId;
}

/** Row-control legend, for tests that do not construct a viewer. */
export function _comptagesRowControlsForTest() {
  return comptagesParisLayer.getRowControls();
}

/** Stats, for tests that do not construct a viewer. */
export function _comptagesStatsForTest() {
  return comptagesParisLayer.getStats();
}

/** Detection candidates, for tests that do not construct a viewer. */
export function _comptagesDetectablesForTest(options = {}) {
  return collectDetectableObjects(options);
}

/**
 * Run the production batch build against a stub scene.
 *
 * `GroundPolylineGeometry`, `GeometryInstance`, `Material` and both appearances
 * are pure JS — only `GroundPolylinePrimitive.isSupported` reaches for a GL
 * context, and it reads exactly one flag. So the batching decisions (how many
 * primitives, which arc gets an instance in which band) are testable without
 * WebGL, which is where the cursor's whole cost argument lives.
 */
export function _drawComptagesForTest(payload) {
  _groundLinesSupported = null;
  drawArcs(payload);
  return {
    primitives: _primitives,
    bands: _bandPrimitives,
    gap: _gapPrimitive,
    records: _records,
  };
}

/** Drive the production `setParams` path, chip-style. */
export function _comptagesSetParamsForTest(params) {
  comptagesParisLayer.setParams(params);
}

/** The slot the layer is currently drawing. */
export function _comptagesSlotForTest() {
  return { token: _slotToken, ..._slot };
}

/** The record index, so a test can read what each arc would be painted. */
export function _comptagesRecordsForTest() {
  return _records;
}

export default comptagesParisLayer;
