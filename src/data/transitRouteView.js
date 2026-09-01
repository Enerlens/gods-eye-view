/**
 * @module transitRouteView
 *
 * The line under the vehicle you clicked: its trace on the ground, the ordered
 * stops of the run it is on, and when the operator expects it at each of them.
 *
 * WHAT A CLICK ASKS. A live transit contact answers "a bus is here". The next
 * question a person asks of it is "where is it going" — and that answer lives
 * in two places the browser cannot reach on its own: the network's static GTFS
 * (the line's geometry, its public name, its own colour) and the network's
 * GTFS-Realtime **TripUpdates** feed (this run's stops, in order, with the
 * operator's predicted times). Both are resolved by the dev-server proxy at
 * `/api/transit-fr/trip`; this module draws what comes back.
 *
 * WHAT IS DRAWN AND WHAT IT MEANS:
 *
 *   - THE TRACE is one of the line's published shape variants — the one the
 *     proxy measured this run's own stops against, when every stop lay on it.
 *     A line whose variants do not fit the run is drawn in FULL and the panel
 *     says so: "this is the line" is a weaker claim than "this is the run",
 *     and the drawing has to make clear which one is being made.
 *   - THE COLOUR is the operator's own `route_color` where the static feed
 *     publishes one — Bordeaux's Lianes 7 is drawn in Lianes 7's blue. A line
 *     with no published colour keeps the vehicle's class tint rather than
 *     borrowing a colour that would look equally official.
 *   - THE STOPS are the stops of THIS RUN, not of the line: a TripUpdate lists
 *     the trip's own sequence, so a short working that turns back early draws
 *     the stops it will actually serve. The one the vehicle is heading for is
 *     drawn larger and labelled first.
 *   - THE TIMES are the operator's predictions, printed as a countdown and, on
 *     the vehicle's card, as a schedule deviation. A stop with no published
 *     time gets no time — never a zero, and never the timetable's.
 *
 * The trace is a ground-clamped polyline so it follows terrain and buildings
 * are not drawn through; the stops are billboarded points with depth testing
 * off, for the same reason the vehicles are: a stop behind a building is still
 * a stop on this line.
 */
import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import { cachedGroundFloor, warmGroundFloor } from './groundFloor.js';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';

/** Overlay source for the stop labels along the drawn run. */
export const TRANSIT_ROUTE_OVERLAY_SOURCE_ID = 'transit-fr-route-stops';
/**
 * How many stop labels may be on screen at once.
 *
 * A Bordeaux run is 56 stops and a Normandy interurban run can be 90; every
 * name at once is a wall of text over the city. The cohort is ranked so the
 * ones that survive are the ones being asked about — the stop the vehicle is
 * heading for, the terminus, then outward along the run.
 */
export const TRANSIT_ROUTE_LABEL_LIMIT = 12;
export const TRANSIT_ROUTE_OVERLAY_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: TRANSIT_ROUTE_LABEL_LIMIT,
  collisionCapacity: 96,
  moving: false,
});

/** Widths (px) of the two passes the trace is drawn in. */
const TRACE_CASING_PX = 9;
const TRACE_STROKE_PX = 5;
/** Casing alpha — dark enough to separate the line from a bright basemap. */
const TRACE_CASING_ALPHA = 0.55;
const TRACE_STROKE_ALPHA = 0.95;
/** Fallback colour when the operator publishes no `route_color`. */
const DEFAULT_TRACE_COLOR = '#ffc93c';
/** The selection cyan, shared with the vehicle glyph it belongs to. */
const NEXT_STOP_COLOR = '#00ffff';

/** Stop dot sizes (px): the ordinary stop, and the one being approached. */
const STOP_PX = 7;
const STOP_NEXT_PX = 13;
const STOP_TERMINUS_PX = 10;
/** Metres above the resolved ground floor the stop dots sit. */
const STOP_LIFT_M = 3;

/** Runtime state — one drawn run at a time, matching one selected vehicle. */
let _viewer = null;
let _traceSource = null;
let _stopPoints = null;
let _payload = null;
let _visible = false;
let _overlayHost = {
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
};

// --- Pure readouts ----------------------------------------------------------

/**
 * The index of the stop the vehicle is heading for.
 *
 * Resolved from the vehicle's own reported `stopSequence` when the feed
 * publishes one — that is the operator saying where the bus is on its run —
 * and otherwise from the first stop whose predicted arrival is still ahead.
 * Returns -1 when neither is available, which is the honest answer for a run
 * whose last stop is already behind it.
 *
 * @param {Array<Object>} stops Ordered stops from the proxy.
 * @param {Object} [context]
 * @param {?number} [context.vehicleStopSequence] `current_stop_sequence`.
 * @param {number} [context.nowMs]
 * @returns {number} Index into `stops`, or -1.
 */
export function nextStopIndex(stops, { vehicleStopSequence = null, nowMs = Date.now() } = {}) {
  const list = Array.isArray(stops) ? stops : [];
  if (!list.length) return -1;
  if (Number.isFinite(vehicleStopSequence)) {
    const found = list.findIndex((stop) => stop.sequence >= vehicleStopSequence);
    if (found >= 0) return found;
  }
  const upcoming = list.findIndex((stop) => {
    const time = Number.isFinite(stop.arrivalMs) ? stop.arrivalMs : stop.departureMs;
    return Number.isFinite(time) && time >= nowMs;
  });
  return upcoming;
}

/**
 * Countdown to a stop, in the register a rider uses.
 *
 * Seconds are not printed: an operator's arrival prediction is not accurate to
 * the second and printing one would claim it is. A time already past reads as
 * "due", not as a negative number.
 *
 * @param {Object} stop One stop record.
 * @param {number} [nowMs]
 * @returns {?string}
 */
export function stopEtaLabel(stop, nowMs = Date.now()) {
  const time = Number.isFinite(stop?.arrivalMs) ? stop.arrivalMs : stop?.departureMs;
  if (!Number.isFinite(time)) return null;
  const deltaMin = Math.round((time - nowMs) / 60000);
  if (deltaMin <= 0) return 'due';
  if (deltaMin === 1) return '1 min';
  if (deltaMin < 60) return `${deltaMin} min`;
  const hours = Math.floor(deltaMin / 60);
  return `${hours} h ${String(deltaMin % 60).padStart(2, '0')}`;
}

/**
 * Schedule deviation at a stop, in the operator's own sign convention
 * (positive = late). Null when the feed published none, which is not the same
 * as on time and is never printed as such.
 *
 * @param {Object} stop One stop record.
 * @returns {?string}
 */
export function stopDelayLabel(stop) {
  const delay = stop?.delaySec;
  if (!Number.isFinite(delay)) return null;
  const minutes = Math.round(Math.abs(delay) / 60);
  if (minutes === 0) return 'on time';
  return delay > 0 ? `${minutes} min late` : `${minutes} min early`;
}

/**
 * Ranking for the bounded label cohort: what a viewer is actually asking about.
 *
 * The stop being approached first, then the terminus of the run, then stops
 * outward from the vehicle — so a 56-stop run labels the part of itself the
 * bus is in rather than an arbitrary dozen names.
 *
 * @param {number} index Stop index.
 * @param {number} count Total stops.
 * @param {number} nextIndex Index from {@link nextStopIndex}.
 * @returns {number} Higher draws first.
 */
export function stopLabelPriority(index, count, nextIndex) {
  if (index === nextIndex) return 1_000_000;
  if (index === count - 1) return 900_000;
  if (index === 0) return 800_000;
  const anchor = nextIndex >= 0 ? nextIndex : 0;
  return 500_000 - Math.abs(index - anchor);
}

/**
 * The line's name, as it is written on the front of the vehicle.
 *
 * `route_short_name` is what a rider calls the line ("7"); the vehicle feed's
 * own `route_id` is the fallback, and it is what the layer printed before any
 * of this existed. `route_long_name` is the descriptive name and is carried
 * separately rather than concatenated, because the two are different lengths
 * of the same answer.
 *
 * @param {Object} payload `/api/transit-fr/trip` document.
 * @param {?string} [fallbackRoute] The vehicle's own display route label.
 * @returns {{short: ?string, long: ?string, color: ?string}}
 */
export function routeReadout(payload, fallbackRoute = null) {
  const route = payload?.route || null;
  return {
    short: route?.shortName || route?.id || fallbackRoute || null,
    long: route?.longName || null,
    color: route?.color || null,
  };
}

/**
 * The extra card lines a resolved line contributes to the selected vehicle.
 *
 * Returns an empty list while the request is still in flight, so the card
 * never flickers a placeholder; every line it does return is a value some feed
 * published.
 *
 * @param {Object} payload `/api/transit-fr/trip` document.
 * @param {Object} [context]
 * @param {?number} [context.vehicleStopSequence]
 * @param {number} [context.nowMs]
 * @returns {string[]}
 */
export function transitRouteCardLines(payload, context = {}) {
  if (!payload) return [];
  const nowMs = Number.isFinite(context.nowMs) ? context.nowMs : Date.now();
  const stops = Array.isArray(payload.stops) ? payload.stops : [];
  const lines = [];

  const next = nextStopIndex(stops, { ...context, nowMs });
  if (next >= 0) {
    const stop = stops[next];
    const parts = [`▸ ${stop.name}`];
    const eta = stopEtaLabel(stop, nowMs);
    if (eta) parts.push(eta);
    const delay = stopDelayLabel(stop);
    if (delay) parts.push(delay);
    lines.push(parts.join(' · '));
  }

  if (stops.length) {
    const terminus = stops[stops.length - 1];
    const remaining = next >= 0 ? stops.length - next : 0;
    const tail = [`⇥ ${terminus.name}`];
    if (remaining > 1) tail.push(`${remaining} stops`);
    lines.push(tail.join(' · '));
  } else if (payload.stopsReported > 0) {
    // The run's stops exist but none of them could be placed — say which of
    // the two feeds fell short rather than showing an empty line.
    lines.push(`⇥ ${payload.stopsReported} stops published, none in the static feed`);
  }

  if (payload.shapeMatch?.matched === false && payload.shapeMatch?.variants > 1) {
    lines.push(`⌁ whole line drawn (${payload.shapeMatch.variants} variants published)`);
  }
  return lines;
}

// --- Rendering --------------------------------------------------------------

/** World position for a stop, on the shared coarse ground floor when warm. */
function stopPosition(stop) {
  const floor = cachedGroundFloor(stop.lat, stop.lon);
  const height = (Number.isFinite(floor) ? floor : 0) + STOP_LIFT_M;
  return Cesium.Cartesian3.fromDegrees(stop.lon, stop.lat, height);
}

/** Colour the trace and its stops draw in. */
export function traceColor(payload, fallback = DEFAULT_TRACE_COLOR) {
  return payload?.route?.color || fallback || DEFAULT_TRACE_COLOR;
}

/**
 * Create the collections. Called once per viewer, from the transit layer's
 * own `init` so the two share a lifecycle.
 * @param {Cesium.Viewer} viewer
 */
export function initTransitRouteView(viewer) {
  _viewer = viewer;
  _traceSource = new Cesium.CustomDataSource('transit-fr-route');
  _traceSource.show = false;
  viewer.dataSources.add(_traceSource);

  _stopPoints = new Cesium.PointPrimitiveCollection();
  _stopPoints.show = false;
  viewer.scene.primitives.add(_stopPoints);

  _payload = null;
  _visible = false;
  _overlayHost.setVisible(TRANSIT_ROUTE_OVERLAY_SOURCE_ID, false);
}

/** Whether a run is currently drawn. */
export function transitRouteShown() {
  return _visible;
}

/** The document currently drawn, for tests and for the card. */
export function transitRoutePayload() {
  return _payload;
}

/**
 * Draw one run: its trace, its stops, and their labels.
 *
 * @param {Object} payload `/api/transit-fr/trip` document.
 * @param {Object} [context]
 * @param {?number} [context.vehicleStopSequence] The vehicle's reported stop.
 * @param {?string} [context.fallbackColor] The vehicle's class tint.
 */
export function showTransitRoute(payload, context = {}) {
  if (!_traceSource || !_stopPoints) return;
  clearTransitRoute();
  if (!payload) return;
  _payload = payload;
  _visible = true;

  const css = traceColor(payload, context.fallbackColor);
  const stroke = Cesium.Color.fromCssColorString(css);
  const casing = Cesium.Color.BLACK.withAlpha(TRACE_CASING_ALPHA);
  const casingMaterial = new Cesium.ColorMaterialProperty(casing);
  const strokeMaterial = new Cesium.ColorMaterialProperty(stroke.withAlpha(TRACE_STROKE_ALPHA));

  const shapes = Array.isArray(payload.shapes) ? payload.shapes : [];
  _traceSource.entities.suspendEvents();
  try {
    for (let i = 0; i < shapes.length; i += 1) {
      const path = shapes[i];
      if (!Array.isArray(path) || path.length < 2) continue;
      const positions = Cesium.Cartesian3.fromDegreesArray(path.flat());
      // Two passes, casing first: a bare coloured line over aerial imagery
      // reads as a texture artefact rather than as a route.
      _traceSource.entities.add({
        id: `transit-fr:trace:${i}:casing`,
        polyline: {
          positions,
          width: TRACE_CASING_PX,
          material: casingMaterial,
          clampToGround: true,
        },
      });
      _traceSource.entities.add({
        id: `transit-fr:trace:${i}`,
        polyline: {
          positions,
          width: TRACE_STROKE_PX,
          material: strokeMaterial,
          clampToGround: true,
        },
      });
    }
  } finally {
    _traceSource.entities.resumeEvents();
  }

  const stops = Array.isArray(payload.stops) ? payload.stops : [];
  const nowMs = Date.now();
  const next = nextStopIndex(stops, { ...context, nowMs });
  // Warm the shared floor cells under the run so the dots settle onto the
  // surface on the next frame instead of hovering at the ellipsoid.
  warmGroundFloor(stops);

  const entries = [];
  for (let i = 0; i < stops.length; i += 1) {
    const stop = stops[i];
    const isNext = i === next;
    const isEnd = i === stops.length - 1;
    const position = stopPosition(stop);
    _stopPoints.add({
      id: `transit-fr:stop:${stop.id}:${i}`,
      position,
      // The approached stop takes the selection cyan so the eye can follow the
      // vehicle glyph straight to where it is going next.
      color: isNext ? Cesium.Color.fromCssColorString(NEXT_STOP_COLOR) : Cesium.Color.WHITE,
      outlineColor: stroke,
      outlineWidth: isNext ? 3 : 2,
      pixelSize: isNext ? STOP_NEXT_PX : (isEnd ? STOP_TERMINUS_PX : STOP_PX),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      translucencyByDistance: new Cesium.NearFarScalar(1_000, 1.0, 120_000, 0.0),
    });

    const details = [];
    const eta = stopEtaLabel(stop, nowMs);
    if (eta) details.push(eta);
    const delay = stopDelayLabel(stop);
    if (delay) details.push(delay);
    if (stop.relationship === 'skipped') details.push('not served');
    entries.push({
      id: `stop-${i}`,
      position,
      variant: 'label',
      title: stop.name,
      details: details.length ? [details.join(' · ')] : [],
      accent: isNext ? NEXT_STOP_COLOR : css,
      priority: stopLabelPriority(i, stops.length, next),
      collisionGroup: 'ambient-card',
      interactive: false,
      anchorRadiusPx: 8,
      minAnchorGapPx: 10,
      placement: 'above',
      horizonCull: true,
      terrainOcclusion: false,
      // A stop label is only useful at the altitude where the street it is on
      // is legible; above that the run is a shape, not a list of names.
      maxDistance: 40_000,
    });
  }

  _traceSource.show = true;
  _stopPoints.show = true;
  _overlayHost.setEntries(
    TRANSIT_ROUTE_OVERLAY_SOURCE_ID,
    entries,
    TRANSIT_ROUTE_OVERLAY_SOURCE_OPTIONS,
  );
  _overlayHost.setVisible(TRANSIT_ROUTE_OVERLAY_SOURCE_ID, true);
  governorRequestRender('transit-fr-route');
}

/** Remove the drawn run, leaving the collections in place. */
export function clearTransitRoute() {
  _payload = null;
  _visible = false;
  if (_traceSource) {
    _traceSource.entities.removeAll();
    _traceSource.show = false;
  }
  if (_stopPoints) {
    _stopPoints.removeAll();
    _stopPoints.show = false;
  }
  _overlayHost.clearSource(TRANSIT_ROUTE_OVERLAY_SOURCE_ID);
  _overlayHost.setVisible(TRANSIT_ROUTE_OVERLAY_SOURCE_ID, false);
  governorRequestRender('transit-fr-route-clear');
}

/** Tear the collections down with the layer that owns them. */
export function destroyTransitRouteView(viewer) {
  clearTransitRoute();
  if (_traceSource) {
    viewer?.dataSources?.remove(_traceSource, true);
    _traceSource = null;
  }
  if (_stopPoints) {
    viewer?.scene?.primitives?.remove(_stopPoints);
    _stopPoints = null;
  }
  _viewer = null;
}

/** Swap the overlay host so tests can observe what the run publishes. */
export function _setTransitRouteHostForTest(host) {
  _overlayHost = host || {
    setEntries: setOverlayEntries,
    setVisible: setOverlaySourceVisible,
    clearSource: clearOverlaySource,
  };
}

/** Seed the collections with stubs so the draw path runs without WebGL. */
export function _setTransitRouteCollectionsForTest({ traceSource, stopPoints }) {
  _traceSource = traceSource || null;
  _stopPoints = stopPoints || null;
  _payload = null;
  _visible = false;
}
