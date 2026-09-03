/**
 * @module flightRouteArc
 * @description Draws the scheduled leg of the tracked flight: one dashed arc,
 * two named airport pins, one caption.
 *
 * ── The drawing rule this module exists to hold ─────────────────────────────
 * The aircraft already owns a solid cyan line: its trail, which is where it
 * has actually been. This arc is a timetable entry for the same aircraft, and
 * if the two were painted alike the operator would read a measurement off a
 * schedule. So the arc is deliberately *unlike* a track — dashed, thinner,
 * amber rather than cyan, bowed well above any cruise altitude, and captioned
 * ESTIMATED FLIGHT PLAN at its apex. Nothing here is a style preference; each
 * of those is one more thing that stops the arc reading as a trace.
 *
 * The arc is a pure entity drawing with no update loop: its two endpoints are
 * airports, which do not move. It is rebuilt only when the LEG changes (see
 * `plan.signature`), never on the aircraft's position refresh.
 */

import * as Cesium from 'cesium';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { greatCircleArc } from './greatCircleArc.js';
import { registerPickOwner } from './pickRegistry.js';
import {
  ROUTE_ARC_APEX_MAX_M,
  ROUTE_ARC_APEX_MIN_M,
  ROUTE_ARC_APEX_RATIO,
  ROUTE_ARC_SAMPLES,
  ROUTE_PLAN_KICKER,
} from './flightRoutePlan.js';

/** Overlay source owning the two airport captions and the arc's kicker. */
export const ROUTE_OVERLAY_SOURCE_ID = 'flight-route';
/** Entity id namespace, claimed in the pick registry so the arc never steals a click. */
export const ROUTE_ENTITY_PREFIX = 'gev-flight-route:';

// Same reasoning as the trail's registration: the arc hugs the aircraft it
// belongs to, so an unclaimed pick on it would read as "empty space" in every
// layer's click handler and deselect the plane whose route is being shown.
// Claiming the namespace makes a click on the arc or a pin a no-op everywhere.
registerPickOwner('flight-route', (pickedId) => String(pickedId).startsWith(ROUTE_ENTITY_PREFIX));

/** Amber, not the trail's cyan: a different colour for a different kind of fact. */
const ROUTE_COLOR = '#ffb454';
const ROUTE_WIDTH_PX = 2;
/** Long dashes read as "schedule" at globe scale; short ones alias into a solid line. */
const ROUTE_DASH_LENGTH_PX = 22;
/** Range within which a pin ignores depth. See the note at its use site. */
const ROUTE_PIN_DEPTH_FREE_M = 60_000;

/** @type {Cesium.Viewer|null} */
let _viewer = null;
/** @type {Cesium.Entity|null} */
let _arcEntity = null;
/** @type {Cesium.Entity[]} */
let _pinEntities = [];
/** @type {string|null} Signature of the leg currently drawn. */
let _signature = null;

const overlayHost = {
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
};

/**
 * Sample the arc for a plan. Exported for the geometry test; the ratio and the
 * two clamps are the "schematic, not a profile" decision made numeric.
 * @param {object} plan From `buildFlightRoutePlan`.
 * @returns {number[]} Flat `[lon, lat, height, …]`.
 */
export function routeArcPositions(plan) {
  return greatCircleArc(
    [plan.origin.lon, plan.origin.lat],
    [plan.destination.lon, plan.destination.lat],
    {
      samples: ROUTE_ARC_SAMPLES,
      apexRatio: ROUTE_ARC_APEX_RATIO,
      apexMinM: ROUTE_ARC_APEX_MIN_M,
      apexMaxM: ROUTE_ARC_APEX_MAX_M,
    },
  );
}

/**
 * The three overlay entries: an airport caption at each end, and the kicker at
 * the apex that says the whole drawing is a plan.
 * @param {object} plan From `buildFlightRoutePlan`.
 * @param {number[]} positions Flat arc samples from {@link routeArcPositions}.
 * @returns {object[]} Host entries.
 */
export function routeOverlayEntries(plan, positions) {
  const apex = (Math.floor(positions.length / 3 / 2)) * 3;
  const caption = (suffix, label, lon, lat, height, priority) => ({
    id: `${plan.id}:${suffix}`,
    position: Cesium.Cartesian3.fromDegrees(lon, lat, height),
    variant: 'label',
    title: label,
    accent: ROUTE_COLOR,
    priority,
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    // Captions on a schedule, not click surfaces: the aircraft is what the
    // operator selects, and an airport pin that stole the click would swap the
    // selection out from under the very arc it belongs to.
    interactive: false,
    gapPx: 14,
    verticalOnly: true,
    placement: 'above',
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
  });
  return [
    caption('kicker', ROUTE_PLAN_KICKER, positions[apex], positions[apex + 1], positions[apex + 2], 3),
    caption('origin', plan.origin.label, plan.origin.lon, plan.origin.lat, 0, 2),
    caption('destination', plan.destination.label, plan.destination.lon, plan.destination.lat, 0, 1),
  ];
}

function removeEntity(entity) {
  if (!entity || !_viewer || _viewer.isDestroyed()) return;
  try { _viewer.entities.remove(entity); } catch { /* already torn down */ }
}

/**
 * Draw (or redraw) the scheduled leg.
 *
 * @param {Cesium.Viewer} viewer Active viewer.
 * @param {object} plan From `buildFlightRoutePlan`.
 * @returns {boolean} Whether an arc is on screen afterwards.
 */
export function showFlightRouteArc(viewer, plan) {
  if (!viewer || viewer.isDestroyed() || !plan) return false;
  if (_viewer && _viewer !== viewer) hideFlightRouteArc();
  _viewer = viewer;
  if (_signature === plan.signature && _arcEntity) return true;
  hideFlightRouteArc();
  _viewer = viewer;

  const positions = routeArcPositions(plan);
  const color = Cesium.Color.fromCssColorString(ROUTE_COLOR);
  _arcEntity = viewer.entities.add({
    id: `${ROUTE_ENTITY_PREFIX}arc:${plan.id}`,
    polyline: {
      positions: Cesium.Cartesian3.fromDegreesArrayHeights(positions),
      width: ROUTE_WIDTH_PX,
      material: new Cesium.PolylineDashMaterialProperty({
        color: color.withAlpha(0.9),
        dashLength: ROUTE_DASH_LENGTH_PX,
      }),
      // The samples already ride the great circle at their own heights;
      // GEODESIC would re-project them onto the ellipsoid and flatten the bow.
      arcType: Cesium.ArcType.NONE,
    },
  });
  _pinEntities = [plan.origin, plan.destination].map((airport, index) => viewer.entities.add({
    id: `${ROUTE_ENTITY_PREFIX}pin:${plan.id}:${index}`,
    position: Cesium.Cartesian3.fromDegrees(airport.lon, airport.lat, 0),
    point: {
      pixelSize: 9,
      color: color.withAlpha(0.95),
      outlineColor: Cesium.Color.BLACK.withAlpha(0.6),
      outlineWidth: 2,
      // FINITE, deliberately. `POSITIVE_INFINITY` here would draw an airport on
      // the far side of the planet straight through it — the exact defect the
      // marine buoys were reported for. Within 60 km the pin ignores depth so
      // it cannot be buried in the mesh of the airport it marks; past that the
      // globe occludes it, so a destination over the horizon is simply not
      // drawn, and its caption is horizon-culled for the same reason.
      disableDepthTestDistance: ROUTE_PIN_DEPTH_FREE_M,
    },
  }));
  overlayHost.setEntries(
    ROUTE_OVERLAY_SOURCE_ID,
    routeOverlayEntries(plan, positions),
    { cohortLimit: 3, collisionCapacity: 3, moving: false },
  );
  overlayHost.setVisible(ROUTE_OVERLAY_SOURCE_ID, true);
  _signature = plan.signature;
  viewer.scene?.requestRender?.();
  return true;
}

/** Remove the arc, its pins and its captions. Idempotent. */
export function hideFlightRouteArc() {
  removeEntity(_arcEntity);
  for (const pin of _pinEntities) removeEntity(pin);
  _arcEntity = null;
  _pinEntities = [];
  _signature = null;
  overlayHost.clearSource(ROUTE_OVERLAY_SOURCE_ID);
  overlayHost.setVisible(ROUTE_OVERLAY_SOURCE_ID, false);
  _viewer?.scene?.requestRender?.();
  _viewer = null;
}

/** Signature of the leg currently drawn, or null when nothing is drawn. */
export function drawnFlightRouteSignature() {
  return _signature;
}
