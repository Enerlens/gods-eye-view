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
 * ── What the colour claims, what the width claims, what the DASH claims ─────
 * COLOUR is the measured count: the arc's mean weekday hour, on a five-band
 * indigo → rose ramp at 100 / 250 / 500 / 1 000 véh/h, which splits the 1 730
 * counting arcs 196 / 620 / 519 / 238 / 157. It is deliberately not the
 * green → amber → red both other road layers use for congestion, and not one of
 * `idfm-network`'s four Paris hues.
 *
 * WIDTH repeats the same band, because a hue is not readable in a hairline at
 * 30 km and a boulevard should stay a boulevard.
 *
 * The DASH is the honest half. A third of this network measures nothing:
 * **891 of 2 977 arcs (29.9 %) published neither a count nor an occupancy for
 * all 168 hours**, and they are drawn as broken lines, never as the bottom of
 * the ramp. 356 more measure occupancy and never a count — a real measurement
 * in a unit the ramp does not speak — and get a solid steel stroke off the
 * scale. A quiet street and a dead loop are the two things this layer exists to
 * keep apart, and they are separated by stroke before they are separated by
 * colour.
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
  COMPTAGES_FLOW_COLORS,
  COMPTAGES_FLOW_WIDTHS,
  COMPTAGES_OCCUPANCY_COLOR,
  COMPTAGES_OCCUPANCY_WIDTH,
  COMPTAGES_SILENT_ALPHA,
  COMPTAGES_SILENT_COLOR,
  COMPTAGES_SILENT_DASH_LENGTH,
  COMPTAGES_SILENT_WIDTH,
  COMPTAGES_STATE_LABELS,
  COMPTAGES_STROKE_ALPHA,
  comptagesArcStyle,
  comptagesDayLine,
  comptagesFlowBandLabel,
  comptagesOccupancyBand,
  comptagesProfileReference,
  comptagesSaturatedHours,
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

/** One-line explanations behind each legend swatch. */
const BAND_BLURBS = Object.freeze([
  'Rues comptées à moins de 100 véhicules par heure en moyenne, l’heure ouvrée type.',
  'Le gros du réseau compté : 620 arcs sur les 1 730 qui publient un comptage.',
  'Axes de desserte. La médiane des arcs comptés est à 263 véh/h.',
  'Grands boulevards et quais.',
  'Boulevard périphérique et voies sur berges. Le maximum mesuré est 5 133 véh/h.',
]);

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
  for (const primitive of _primitives) {
    _viewer?.scene?.groundPrimitives?.remove?.(primitive);
  }
  _primitives = [];
  clearHighlight();
}

/**
 * Rebuild both batches for the whole city.
 *
 * TWO primitives and not one, and not one per band. Colour and width both
 * travel per geometry instance on a `PolylineColorAppearance`, so the five flow
 * bands and the occupancy-only stroke merge into a single batch — 2 086
 * instances, one draw call. The silent arcs cannot join it: a dash is a
 * MATERIAL and a material is per-primitive, which is the same constraint
 * `powerGrid.js` hits on its underground cables. So the 891 dashed strokes are
 * the second batch, and paying one extra draw call is what buys "no measurement
 * looks nothing like a measurement".
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
  const solid = [];
  const dashed = [];
  const warm = [];
  for (const arc of arcs) {
    const style = comptagesArcStyle(arc);
    const midpoint = comptagesMidpoint(arc.g);
    const id = `comptages-fr:${arc.a}`;
    // An unplaceable arc is still a record — the card cannot be opened from the
    // globe, but the counts are real and the row reports them.
    _records.set(id, { id, arc, style, midpoint });
    const positions = comptagesPositions(arc.g);
    if (!positions) continue;
    if (midpoint && warm.length < FLOOR_WARM_LIMIT) warm.push(midpoint);
    const instance = new Cesium.GeometryInstance({
      id,
      geometry: new Cesium.GroundPolylineGeometry({ positions, width: style.widthPx }),
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(
          Cesium.Color.fromCssColorString(style.color).withAlpha(style.alpha),
        ),
      },
    });
    (style.dashed ? dashed : solid).push(instance);
  }

  if (solid.length) {
    const primitive = _viewer.scene.groundPrimitives.add(new Cesium.GroundPolylinePrimitive({
      geometryInstances: solid,
      classificationType: _classificationType,
      appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
    }));
    primitive.show = _enabled;
    _primitives.push(primitive);
  }
  if (dashed.length) {
    const primitive = _viewer.scene.groundPrimitives.add(new Cesium.GroundPolylinePrimitive({
      geometryInstances: dashed,
      classificationType: _classificationType,
      appearance: new Cesium.PolylineMaterialAppearance({
        material: Cesium.Material.fromType('PolylineDash', {
          color: Cesium.Color.fromCssColorString(COMPTAGES_SILENT_COLOR)
            .withAlpha(COMPTAGES_SILENT_ALPHA),
          dashLength: COMPTAGES_SILENT_DASH_LENGTH,
        }),
      }),
    }));
    primitive.show = _enabled;
    _primitives.push(primitive);
  }
  if (warm.length) warmGroundFloor(warm);
  governorRequestRender('comptages-fr-draw');
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
export function buildComptagesSelectionLabel(record, payload = null) {
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
    details.push(`${fr(arc.mq ?? 0)} véh/h en moyenne, l’heure ouvrée type`);
    details.push(`${fr(arc.hq)} heures comptées sur ${fr(hours)}`);
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
  details.push(`Mesuré, J-2 · semaine ${week || '—'}`);
  details.push('Ville de Paris — ODbL');

  return [title, ...details.filter(Boolean)].join('\n');
}

/** Protected selected-arc entry for the shared overlay host. */
export function createComptagesSelectedOverlayEntry(record, payload = null) {
  const position = cardPosition(record);
  if (!record?.id || !position) return null;
  const [title, ...details] = buildComptagesSelectionLabel(record, payload).split('\n');
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
  const entry = createComptagesSelectedOverlayEntry(record, _payload);
  if (entry) {
    _overlayHost.setEntries(
      COMPTAGES_FR_OVERLAY_SOURCE_ID, [entry], COMPTAGES_FR_OVERLAY_SOURCE_OPTIONS,
    );
  }
  governorRequestRender('comptages-fr-select');
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
    // no position to hand the detector, and must not be invented one.
    if (record.midpoint && record.arc?.s === 'counted') records.push(record);
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
      id: `${fr(record.arc.mq ?? 0)} véh/h`,
      type: 'Counting arc',
      skipLabel: record.id === _selectedId,
    });
    if (result.length >= maxCount) break;
  }
  return result;
}

// --- Row label --------------------------------------------------------------

/** One line under the layer's toggle: what this view actually contains. */
export function buildComptagesLoadingLabel({
  payload = _payload, loading = _loading, inView = _inView, error = _error,
} = {}) {
  if (loading) return 'lecture de la semaine mesurée...';
  if (!inView) return 'Paris intra-muros uniquement — hors de la vue';
  if (!payload) return error ? '' : '';
  const parts = [];
  const week = comptagesWeekLabel(payload.week);
  parts.push(`${fr(payload.states?.counted || 0)} arcs comptés${week ? ` · semaine ${week}` : ''}`);
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
    return { ...summary, drawn: _records.size, inView: _inView };
  },

  /**
   * Colour legend for the control-panel row.
   *
   * Tallied over the whole pack, because the whole pack is what is drawn —
   * there is no viewport here. The five flow bands come first in magnitude
   * order; the two non-ramp states come last and are kept even at zero, because
   * "a dashed line means nobody measured this street" is the entry a reader has
   * to be given.
   */
  getRowControls() {
    if (!_payload) return { chips: [], legend: [] };
    const bands = new Array(COMPTAGES_FLOW_COLORS.length).fill(0);
    for (const record of _records.values()) {
      if (record.style.bin !== null) bands[record.style.bin] += 1;
    }
    const legend = bands
      .map((count, bin) => ({
        label: comptagesFlowBandLabel(bin),
        color: COMPTAGES_FLOW_COLORS[bin],
        count,
        blurb: BAND_BLURBS[bin],
      }))
      .filter((row) => row.count > 0);
    const states = _payload.states || {};
    if (states.occupancy > 0) {
      legend.push({
        label: COMPTAGES_STATE_LABELS.occupancy,
        color: COMPTAGES_OCCUPANCY_COLOR,
        count: states.occupancy,
        blurb: 'La boucle publie un taux d’occupation et jamais un comptage. '
          + 'C’est une mesure réelle, dans une autre unité — elle n’a pas de place sur l’échelle en véh/h.',
      });
    }
    if (states.silent > 0) {
      legend.push({
        label: COMPTAGES_STATE_LABELS.silent,
        color: COMPTAGES_SILENT_COLOR,
        count: states.silent,
        blurb: `Tracé en pointillés : 168 h sans comptage ni occupation. `
          + `${fr(_payload.silentBy?.i || 0)} sont déclarés invalides par la Ville, `
          + `${fr(_payload.silentBy?.b || 0)} barrés, et ${fr(_payload.silentBy?.o || 0)} déclarés ouverts.`,
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
    clearPrimitives();
    _records.clear();
    _payload = null;
    _viewer = null;
  },
};

/** Seed rendered records so selection/card/legend paths run without WebGL. */
export function _setComptagesStateForTest({
  viewer, payload, overlayHost, enabled = true, inView = true,
} = {}) {
  _viewer = viewer || null;
  _overlayHost = overlayHost || DEFAULT_OVERLAY_HOST;
  _payload = payload || null;
  _records = new Map();
  for (const arc of payload?.arcs || []) {
    const id = `comptages-fr:${arc.a}`;
    _records.set(id, {
      id, arc, style: comptagesArcStyle(arc), midpoint: comptagesMidpoint(arc.g),
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
  _overlayHost = DEFAULT_OVERLAY_HOST;
  _payload = null;
  _records = new Map();
  _enabled = false;
  _inView = false;
  _status = 'idle';
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

export default comptagesParisLayer;
