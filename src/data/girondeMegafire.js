/**
 * @module girondeMegafire
 *
 * **Mégafeu de Gironde · juillet 2026** — one closed event, replayed on the
 * globe along a cursor. The first layer in this repo whose subject is a thing
 * that already finished.
 *
 * ── WHAT IS ON SCREEN, AND WHO MEASURED IT ──────────────────────────────────
 *
 * Five perimeters, each one a Copernicus EMS delineation drawn by human
 * photo-interpreters on a dated satellite frame — four Airbus Pléiades Neo
 * passes at 0.3 m and one Sentinel-2. Their fire FRONTS (lines) and ACTIVE
 * FLAMES (points) come from the same products and the same interpreters. Under
 * them, 9 524 NASA FIRMS thermal detections carry the two days nobody
 * photographed. Over them, EFFIS's closing perimeter — 37 191 ha, the number
 * this fire will be remembered by.
 *
 * Nothing here is modelled, simulated or interpolated. Every polygon on screen
 * was traced off an image, and every dot is a satellite radiometer reading a
 * pixel that was hotter than its neighbours. The one thing the layer invents is
 * the FADE on an old detection, and it fades to a floor rather than to nothing
 * precisely so that no reader can mistake "no longer detected" for "no longer
 * burnt" — see `megafireClock.js`.
 *
 * ── WHY THIS IS NOT A SECOND `local-firms` ──────────────────────────────────
 *
 * The repo's rule is one subject, one row. `local-firms` draws NASA FIRMS
 * detections from the last 24 hours anywhere on Earth, live, and is empty
 * without a server key. Switch it on over Gironde today and it draws nothing —
 * the fire has been out since 1 August 2026. The two rows share a sensor and
 * not a subject: one is a smoke alarm, this is a post-mortem. Only this one has
 * perimeters, fronts, flames, hectares and a clock; only that one has the rest
 * of the planet and the present tense.
 *
 * ── THE THREE FIGURES, ALL THREE SHOWN ──────────────────────────────────────
 *
 * 31 602 ha (Copernicus, 29 July), 37 191 ha (EFFIS, final), 47 910 ha (GDACS
 * alert). Three institutions, three methods, three answers to three different
 * questions — see the `megafirePack.js` header. The card names the first two
 * and says which is which; hiding the disagreement would be the only dishonest
 * option on the table.
 *
 * ── RENDERING NOTES ─────────────────────────────────────────────────────────
 *
 * ONE COLOUR PER `GroundPrimitive`. Cesium classifies a batch in one stencil
 * pass and then keeps the first instance whose axis-aligned BOUNDING RECTANGLE
 * contains the pixel — never consulting the polygon — so a batch carrying two
 * colours repaints itself along rectangle edges. Here that is free: exactly one
 * step is ever drawn, and a step is exactly one colour.
 *
 * THE PERIMETER IS NOT STACKED. Only the current step's polygons are drawn, and
 * that is not a simplification: a Copernicus delineation is CUMULATIVE — the
 * 29 July product contains everything that had burnt by 29 July. Drawing five
 * translucent perimeters on top of each other would show the same ground five
 * times and read as five fires.
 */

import * as Cesium from 'cesium';
import { governorRequestRender, holdContinuousRender, releaseContinuousRender } from '../renderGovernor.js';
import { powerClassificationTypeForScene } from './powerGrid.js';
import {
  MEGAFIRE_EFFIS_COLOR,
  MEGAFIRE_FILL_ALPHA,
  MEGAFIRE_FLAME_COLOR,
  MEGAFIRE_FRONT_COLOR,
  MEGAFIRE_FRP_LADDER,
  MEGAFIRE_LAYER_ID,
  MEGAFIRE_STEP_COLORS,
  megafireFrpLevel,
} from './megafirePack.js';
import {
  MEGAFIRE_PLAY_SECONDS,
  advanceMegafireClock,
  createMegafireClock,
  megafireClockState,
  megafireCursorLabel,
  megafireEmberStrength,
  seekMegafireClock,
  setMegafirePlaying,
} from './megafireClock.js';

const EVENT_URL = new URL('./local_data/gironde_megafire_2026/event.json', import.meta.url).href;
const HOTSPOTS_URL = new URL('./local_data/gironde_megafire_2026/hotspots.json', import.meta.url).href;

/** @constant {string} Shown on the row before anything is loaded. */
const SOURCE_LABEL = 'Copernicus EMS · EFFIS · NASA FIRMS';

/** @constant {number} Flame marker size, px. */
const FLAME_PX = 9;
/** @constant {number} Hotspot marker size at full strength, px. */
const HOTSPOT_PX = 6;
/** @constant {number} Hotspot marker size at the ember floor, px. */
const EMBER_PX = 3;
/** @constant {number} Fire-front stroke width, px. */
const FRONT_WIDTH_PX = 3;
/** @constant {number} EFFIS closing-outline stroke width, px. */
const EFFIS_WIDTH_PX = 2;

/**
 * @constant {number} Milliseconds of event time between two hotspot repaints.
 *
 * Repainting 9 524 point primitives every frame is ~570 k attribute writes a
 * second at 60 fps for a field that changes meaningfully about once an hour of
 * event time. Ten minutes of event time is finer than the VIIRS revisit that
 * feeds it, so nothing visible is lost.
 */
const HOTSPOT_REPAINT_MS = 10 * 60_000;

let _viewer = null;
let _enabled = false;
let _event = null;
let _hotspots = null;
/** @type {?ReturnType<createMegafireClock>} */
let _clock = null;
let _loading = false;
let _error = null;
let _status = 'idle';
let _lastPaintedCursor = null;
let _drawnStepIndex = null;
let _tickRemover = null;
let _lastTickMs = null;
let _classificationType = Cesium.ClassificationType.BOTH;

/** @type {?Cesium.GroundPrimitive} */
let _perimeter = null;
/** @type {?Cesium.GroundPolylinePrimitive} */
let _fronts = null;
/** @type {?Cesium.GroundPolylinePrimitive} */
let _effisOutline = null;
/** @type {?Cesium.PointPrimitiveCollection} */
let _flames = null;
/** @type {?Cesium.PointPrimitiveCollection} */
let _embers = null;
/** @type {Array<{ms: number, level: number}>} Parallel to `_embers`, by index. */
let _emberMeta = [];

/** @returns {boolean} Whether ground polylines can be drawn at all here. */
let _groundLinesSupported = null;
function groundLinesSupported() {
  if (_groundLinesSupported === null && _viewer?.scene) {
    _groundLinesSupported = Cesium.GroundPolylinePrimitive.isSupported(_viewer.scene);
    if (!_groundLinesSupported) {
      console.warn('[Data:Mégafeu FR] GroundPolylinePrimitive unsupported — fronts and the EFFIS outline are off');
    }
  }
  return _groundLinesSupported !== false;
}

/**
 * Flat `[lon, lat, ...]` → Cartesian positions.
 * @param {ArrayLike<number>} flat
 * @returns {Cesium.Cartesian3[]}
 */
function ringPositions(flat) {
  const positions = [];
  for (let i = 0; i < flat.length; i += 2) {
    positions.push(Cesium.Cartesian3.fromDegrees(flat[i], flat[i + 1]));
  }
  return positions;
}

/** Tear down every primitive this layer owns, leaving the collections alive. */
function clearSurfaces() {
  const ground = _viewer?.scene?.groundPrimitives;
  for (const key of ['_perimeter', '_fronts', '_effisOutline']) {
    const primitive = { _perimeter, _fronts, _effisOutline }[key];
    if (!primitive) continue;
    if (ground?.contains(primitive)) ground.remove(primitive);
    else if (!primitive.isDestroyed?.()) primitive.destroy?.();
  }
  _perimeter = null;
  _fronts = null;
  _effisOutline = null;
  _drawnStepIndex = null;
}

/**
 * Draw one step's perimeter, fronts and flames, replacing whatever was there.
 *
 * Called only when the step CHANGES — five times in a playthrough, not sixty
 * times a second. The hotspot field is repainted separately and far more often;
 * these two cadences are the whole reason the layer stays cheap while playing.
 *
 * @param {?number} stepIndex - Index into `_event.steps`, or null for "before
 *   the first frame", which draws no perimeter at all.
 */
function drawStep(stepIndex) {
  clearSurfaces();
  drawEffisOutline();
  if (!_viewer?.scene?.groundPrimitives || stepIndex === null || !_event) {
    if (_flames) _flames.removeAll();
    return;
  }
  const step = _event.steps[stepIndex];
  if (!step) return;

  const color = Cesium.Color.fromCssColorString(MEGAFIRE_STEP_COLORS[stepIndex]
    ?? MEGAFIRE_STEP_COLORS[MEGAFIRE_STEP_COLORS.length - 1]).withAlpha(MEGAFIRE_FILL_ALPHA);
  const instances = [];
  step.rings.forEach((rings, index) => {
    const outer = ringPositions(rings[0]);
    if (outer.length < 3) return;
    const holes = [];
    for (let i = 1; i < rings.length; i += 1) {
      const hole = ringPositions(rings[i]);
      // 4 565 ha of unburnt ground on the 29 July product alone. Dropped, the
      // fire on screen is 14 % bigger than the one that happened.
      if (hole.length >= 3) holes.push(new Cesium.PolygonHierarchy(hole));
    }
    instances.push(new Cesium.GeometryInstance({
      // A stable id per polygon, so `getGeometryInstanceAttributes` can read a
      // colour back out of the batch — which is how the QA harness proves the
      // one-colour rule below on the real scene rather than on this source.
      id: `${MEGAFIRE_LAYER_ID}:perimeter:${step.id}:${index}`,
      geometry: new Cesium.PolygonGeometry({
        polygonHierarchy: new Cesium.PolygonHierarchy(outer, holes),
        vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
      }),
      attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(color) },
    }));
  });
  if (instances.length) {
    _perimeter = _viewer.scene.groundPrimitives.add(new Cesium.GroundPrimitive({
      geometryInstances: instances,
      classificationType: _classificationType,
      appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true }),
      // Retained rather than released, which is the non-default choice and
      // costs ONE step's geometry — at most ~42 000 vertices, the 26 July
      // product. It buys the only way to check, on a live scene, that this
      // batch carries a single colour and that the interior rings survived the
      // trip: `qa-gironde-megafire.mjs` reads both back off the primitive.
      // Cesium's own default would drop the instances the moment it is ready,
      // and the invariant would be unprovable outside this file.
      releaseGeometryInstances: false,
      asynchronous: true,
    }));
  }

  if (step.fronts?.length && groundLinesSupported()) {
    const frontInstances = [];
    step.fronts.forEach((flat, index) => {
      const positions = ringPositions(flat);
      if (positions.length < 2) return;
      frontInstances.push(new Cesium.GeometryInstance({
        id: `${MEGAFIRE_LAYER_ID}:front:${step.id}:${index}`,
        geometry: new Cesium.GroundPolylineGeometry({ positions, width: FRONT_WIDTH_PX }),
        attributes: {
          color: Cesium.ColorGeometryInstanceAttribute.fromColor(
            Cesium.Color.fromCssColorString(MEGAFIRE_FRONT_COLOR),
          ),
        },
      }));
    });
    if (frontInstances.length) {
      _fronts = _viewer.scene.groundPrimitives.add(new Cesium.GroundPolylinePrimitive({
        geometryInstances: frontInstances,
        classificationType: _classificationType,
        appearance: new Cesium.PolylineColorAppearance({ translucent: false }),
        // Retained for the same reason as the fill above: 50 lines at their
        // busiest, and it is what lets a harness name this primitive in a
        // minified bundle, where every class is called something like `$o`.
        releaseGeometryInstances: false,
        asynchronous: true,
      }));
    }
  }

  if (_flames) {
    _flames.removeAll();
    const flameColor = Cesium.Color.fromCssColorString(MEGAFIRE_FLAME_COLOR);
    for (const [lon, lat] of step.flames || []) {
      _flames.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat),
        color: flameColor,
        pixelSize: FLAME_PX,
        outlineColor: Cesium.Color.fromCssColorString('#7c2d12'),
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      });
    }
  }
  _drawnStepIndex = stepIndex;
}

/** The EFFIS closing perimeter, as an outline. Always on; never filled. */
function drawEffisOutline() {
  if (!_event?.effis?.main?.rings?.length || !groundLinesSupported()) return;
  if (!_viewer?.scene?.groundPrimitives) return;
  const instances = [];
  _event.effis.main.rings.forEach((rings, index) => {
    // Outline only the OUTER ring: an EFFIS hole is an artefact of a MODIS
    // burnt-area classifier, not an observed island of green, and drawing it
    // would claim a precision the source does not have.
    const positions = ringPositions(rings[0]);
    if (positions.length < 2) return;
    instances.push(new Cesium.GeometryInstance({
      id: `${MEGAFIRE_LAYER_ID}:effis:${index}`,
      geometry: new Cesium.GroundPolylineGeometry({
        positions: [...positions, positions[0]],
        width: EFFIS_WIDTH_PX,
      }),
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(
          Cesium.Color.fromCssColorString(MEGAFIRE_EFFIS_COLOR).withAlpha(0.8),
        ),
      },
    }));
  });
  if (!instances.length) return;
  _effisOutline = _viewer.scene.groundPrimitives.add(new Cesium.GroundPolylinePrimitive({
    geometryInstances: instances,
    classificationType: _classificationType,
    appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
    releaseGeometryInstances: false,
    asynchronous: true,
  }));
}

/**
 * Build the ember field once — one point primitive per detection, all hidden.
 *
 * The set never changes size, so this runs on load and never again; playback
 * only rewrites `color`, `pixelSize` and `show` in place.
 */
function buildEmbers() {
  if (!_embers || !_hotspots) return;
  _embers.removeAll();
  _emberMeta = [];
  const epoch = Date.parse(_hotspots.epoch);
  const index = Object.fromEntries(_hotspots.columns.map((name, i) => [name, i]));
  for (const row of _hotspots.rows) {
    const ms = epoch + row[index.minutes] * 60_000;
    const level = megafireFrpLevel(row[index.frp]);
    _embers.add({
      position: Cesium.Cartesian3.fromDegrees(row[index.lon], row[index.lat]),
      color: Cesium.Color.fromCssColorString(MEGAFIRE_FRP_LADDER[level].color),
      pixelSize: HOTSPOT_PX,
      show: false,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
    _emberMeta.push({ ms, level });
  }
}

/**
 * Repaint the ember field for an instant.
 *
 * Walks all 9 524 primitives. That is deliberate rather than lazy: the
 * alternative — a sorted index and a moving window — has to handle a cursor
 * that jumps BACKWARDS (every chip does), and the walk costs ~0.2 ms.
 *
 * @param {number} cursorMs
 */
function paintEmbers(cursorMs) {
  if (!_embers || !_emberMeta.length) return;
  for (let i = 0; i < _emberMeta.length; i += 1) {
    const point = _embers.get(i);
    const meta = _emberMeta[i];
    const strength = megafireEmberStrength(meta.ms, cursorMs);
    if (strength <= 0) {
      if (point.show) point.show = false;
      continue;
    }
    point.show = true;
    point.color = Cesium.Color.fromCssColorString(MEGAFIRE_FRP_LADDER[meta.level].color)
      .withAlpha(strength);
    point.pixelSize = EMBER_PX + (HOTSPOT_PX - EMBER_PX) * strength;
  }
  _lastPaintedCursor = cursorMs;
}

/** Re-render everything that depends on the cursor, cheaply. */
function syncToCursor({ force = false } = {}) {
  if (!_clock || !_enabled) return;
  const state = megafireClockState(_clock, _event?.steps);
  if (force || state.stepIndex !== _drawnStepIndex) drawStep(state.stepIndex);
  if (force || _lastPaintedCursor === null
    || Math.abs(state.cursorMs - _lastPaintedCursor) >= HOTSPOT_REPAINT_MS) {
    paintEmbers(state.cursorMs);
  }
  governorRequestRender('gironde-megafire');
}

/** One playback frame. Wall-clock dt — the app clock freezes when idle. */
function onTick() {
  if (!_clock?.playing) return;
  const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const dt = (nowMs - (_lastTickMs ?? nowMs)) / 1000;
  _lastTickMs = nowMs;
  const moved = advanceMegafireClock(_clock, dt);
  // The clock stops ITSELF at the end of the window, and the frame it stops on
  // is one that also MOVED — so "did it move" and "is it still playing" are
  // independent questions, and reading only the first left the render governor
  // held open for the rest of the session (caught by qa-gironde-megafire).
  if (!_clock.playing) {
    stopPlayback();
    return;
  }
  if (moved) syncToCursor();
}

/**
 * Start the per-frame tick and hold the render governor open.
 *
 * `scene.postRender` and NOT `clock.onTick`: this app runs the scene in
 * request-render mode, and the app clock is not animating, so `onTick` fires
 * only when something else happens to tick it — measured in a headless run,
 * that was never. `postRender` fires exactly when a frame is drawn, which the
 * continuous-render hold taken on the line above guarantees for as long as
 * playback lasts. It is also the only cadence that can be right: advancing a
 * cursor nobody is rendering would be work with no picture at the end of it.
 */
function startPlayback() {
  if (!_viewer?.scene || _tickRemover) return;
  _lastTickMs = null;
  holdContinuousRender(MEGAFIRE_LAYER_ID);
  _tickRemover = _viewer.scene.postRender.addEventListener(onTick);
}

/** Stop the tick and release the hold. Safe when never started. */
function stopPlayback() {
  if (_tickRemover) {
    _tickRemover();
    _tickRemover = null;
  }
  releaseContinuousRender(MEGAFIRE_LAYER_ID);
  _lastTickMs = null;
  syncToCursor();
}

/** Fetch the two pack files, once per session. */
async function load() {
  if (_event && _hotspots) return;
  if (_loading) return;
  _loading = true;
  _status = 'loading';
  _error = null;
  try {
    const [event, hotspots] = await Promise.all([
      fetch(EVENT_URL).then((response) => {
        if (!response.ok) throw new Error(`event.json → HTTP ${response.status}`);
        return response.json();
      }),
      fetch(HOTSPOTS_URL).then((response) => {
        if (!response.ok) throw new Error(`hotspots.json → HTTP ${response.status}`);
        return response.json();
      }),
    ]);
    _event = event;
    _hotspots = hotspots;
    _clock = createMegafireClock({
      startMs: Date.parse(event.window.start),
      endMs: Date.parse(event.window.end),
    });
    buildEmbers();
    _status = 'ready';
  } catch (error) {
    _error = error?.message || String(error);
    _status = 'error';
    console.warn('[Data:Mégafeu FR]', _error);
  } finally {
    _loading = false;
  }
}

// --- Layer ------------------------------------------------------------------

const girondeMegafireLayer = {
  id: MEGAFIRE_LAYER_ID,
  name: 'Mégafeu de Gironde (juil. 2026)',
  // 🔥 belongs to `local-firms`, which is the LIVE fire row; this one is the
  // record of a fire that stopped, so it takes the burn scar rather than the
  // flame.
  icon: '🜂',
  source: SOURCE_LABEL,

  init(viewer) {
    _viewer = viewer;
    _enabled = false;
    _classificationType = powerClassificationTypeForScene(viewer?.scene);
    _flames = new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT });
    _embers = new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT });
    // Embers under flames: 9 524 thermal pixels must never hide the 11 places a
    // human being looked at an image and wrote "there are flames here".
    _embers.show = false;
    _flames.show = false;
    viewer.scene.primitives.add(_embers);
    viewer.scene.primitives.add(_flames);
  },

  async enable() {
    _enabled = true;
    await load();
    if (!_enabled) return;
    if (_embers) _embers.show = true;
    if (_flames) _flames.show = true;
    syncToCursor({ force: true });
  },

  /**
   * There is nothing to refresh.
   *
   * The lifecycle requires the method, and this layer is the one row in the
   * repo where a poll would be meaningless: the fire ended on 1 August 2026 and
   * every byte it draws is committed. `true` and not `false`, because
   * `DataLayerManager` reads a literal `false` as a REFUSED transition, and
   * nothing here is refusing anything.
   *
   * @returns {boolean}
   */
  async update() {
    return _enabled;
  },

  disable() {
    _enabled = false;
    stopPlayback();
    if (_clock) _clock.playing = false;
    if (_embers) _embers.show = false;
    if (_flames) _flames.show = false;
    clearSurfaces();
    governorRequestRender('gironde-megafire-off');
  },

  /**
   * What the row says while the layer is on.
   *
   * `count` is the number of detections the cursor has REACHED, not the pack
   * size, because the row's job is to describe what is on screen.
   */
  getStats() {
    if (!_clock || !_event) {
      return { count: 0, loading: _loading, status: _status === 'ready' ? 'ok' : _status, error: _error };
    }
    const state = megafireClockState(_clock, _event.steps);
    const step = state.stepIndex === null ? null : _event.steps[state.stepIndex];
    let reached = 0;
    for (const meta of _emberMeta) if (meta.ms <= state.cursorMs) reached += 1;
    return {
      count: reached,
      loading: _loading,
      status: _status === 'ready' ? 'ok' : _status,
      error: _error,
      cursor: megafireCursorLabel(state.cursorMs),
      playing: state.playing,
      // The perimeter's hectares are Copernicus's own published figure for the
      // frame on screen — never measured off the drawing.
      burntHa: step?.burntHa ?? null,
      sensor: step?.sensor ?? null,
      acquired: step ? megafireCursorLabel(Date.parse(step.acq)) : null,
      fronts: step?.fronts?.length ?? 0,
      flames: step?.flames?.length ?? 0,
      detections: _emberMeta.length,
      effisHa: _event.effis?.main?.areaHa ?? null,
      gdacsHa: 47910,
    };
  },

  /**
   * The cursor, as a row of chips: play, then the five measured frames.
   *
   * The chips are NOT serialized into the share link — the layer is registered
   * `enabled-only` — so a shared view always opens on the closing frame. That
   * is the right default: the last frame is the only one still true.
   */
  getRowControls() {
    if (!_clock || !_event) return { chips: [], legend: [] };
    const state = megafireClockState(_clock, _event.steps);
    const chips = [{
      id: 'play',
      label: state.playing ? '❚❚ Pause' : '▶ Rejouer',
      active: state.playing,
      state: state.playing ? 'active' : 'idle',
      title: `Rejouer les 10 jours en ${MEGAFIRE_PLAY_SECONDS} s — `
        + `curseur sur ${megafireCursorLabel(state.cursorMs)}`,
      params: { play: !state.playing },
    }];
    _event.steps.forEach((step, index) => {
      const active = !state.playing && state.stepIndex === index;
      chips.push({
        id: step.id,
        label: step.label,
        active,
        state: active ? 'active' : 'idle',
        title: `${step.sensor} · ${step.resolution} — `
          + `${step.burntHa.toLocaleString('fr-FR')} ha brûlés à cette image`,
        params: { step: step.id },
      });
    });

    const legend = [];
    const step = state.stepIndex === null ? null : _event.steps[state.stepIndex];
    if (step) {
      legend.push({
        label: `périmètre au ${step.label}`,
        color: MEGAFIRE_STEP_COLORS[state.stepIndex] ?? MEGAFIRE_STEP_COLORS[0],
        count: Math.round(step.burntHa),
        blurb: `${step.burntHa.toLocaleString('fr-FR')} ha brûlés, relevés par Copernicus EMS sur `
          + `une image ${step.sensor} du ${step.label} UTC. Le chiffre est celui du publieur, `
          + 'jamais recalculé sur le dessin.',
      });
      if (step.fronts?.length) {
        legend.push({
          label: 'front de feu actif',
          color: MEGAFIRE_FRONT_COLOR,
          count: step.fronts.length,
          blurb: 'Lignes photo-interprétées sur l’image, là où le feu avançait encore à l’heure de la prise de vue.',
        });
      }
      if (step.flames?.length) {
        legend.push({
          label: 'flammes visibles',
          color: MEGAFIRE_FLAME_COLOR,
          count: step.flames.length,
          blurb: 'Points où un interprète a vu des flammes sur une image à 30 cm.',
        });
      }
    }
    const counts = new Array(MEGAFIRE_FRP_LADDER.length).fill(0);
    for (const meta of _emberMeta) if (meta.ms <= state.cursorMs) counts[meta.level] += 1;
    MEGAFIRE_FRP_LADDER.forEach((rung, level) => {
      if (!counts[level]) return;
      legend.push({
        label: `point chaud ${rung.label}`,
        color: rung.color,
        count: counts[level],
        blurb: 'Détection thermique VIIRS ou MODIS. La puissance radiative est celle du pixel, '
          + 'pas celle du feu : un pixel VIIRS mesure 375 m de côté.',
      });
    });
    if (_event.effis?.main) {
      legend.push({
        label: 'périmètre final EFFIS',
        color: MEGAFIRE_EFFIS_COLOR,
        count: Math.round(_event.effis.main.areaHa),
        blurb: `${_event.effis.main.areaHa.toLocaleString('fr-FR')} ha — la détection automatique `
          + 'd’EFFIS, sans zone d’intérêt ni échéance, continue après l’arrêt des cartographes. '
          + 'GDACS, qui note une ALERTE et non une surface, en annonce 47 910.',
      });
    }
    return { chips, legend };
  },

  /**
   * Press a chip.
   *
   * A step chip SEEKS and pauses; the play chip toggles, rewinding when the
   * cursor is already parked on the closing frame.
   *
   * @param {{play?: boolean, step?: string}} [params]
   */
  setParams(params = {}) {
    if (!_clock || !_event) return;
    if (typeof params.step === 'string') {
      const step = _event.steps.find((candidate) => candidate.id === params.step);
      if (!step) return;
      stopPlayback();
      seekMegafireClock(_clock, Date.parse(step.acq));
      syncToCursor({ force: true });
      return;
    }
    if (params.play !== undefined) {
      const playing = setMegafirePlaying(_clock, params.play);
      if (playing) startPlayback();
      else stopPlayback();
      syncToCursor({ force: true });
    }
  },

  /** @returns {{cursorMs: ?number, playing: boolean}} */
  getParams() {
    return { cursorMs: _clock?.cursorMs ?? null, playing: Boolean(_clock?.playing) };
  },

  destroy(viewer) {
    if (_enabled) this.disable();
    stopPlayback();
    clearSurfaces();
    for (const collection of [_embers, _flames]) {
      if (!collection) continue;
      if (viewer?.scene?.primitives?.contains(collection)) viewer.scene.primitives.remove(collection);
      else if (!collection.isDestroyed?.()) collection.destroy?.();
    }
    _embers = null;
    _flames = null;
    _emberMeta = [];
    _event = null;
    _hotspots = null;
    _clock = null;
    _viewer = null;
    _groundLinesSupported = null;
    _lastPaintedCursor = null;
    _status = 'idle';
  },
};

export default girondeMegafireLayer;
