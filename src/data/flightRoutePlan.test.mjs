import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROUTE_PLAN_KICKER,
  buildFlightRoutePlan,
  routeAirportLabel,
  routeFitsOneView,
  routeFrameHeightM,
  routeFrameOffsetEnu,
} from './flightRoutePlan.js';

const CDG = { code: 'CDG', name: 'Paris', lat: 49.0097, lon: 2.5479 };
const JFK = { code: 'JFK', name: 'New York', lat: 40.6398, lon: -73.7789 };
const LYS = { code: 'LYS', name: 'Lyon', lat: 45.7256, lon: 5.0811 };

test('an airport reads as code · city, and either half alone still reads', () => {
  assert.equal(routeAirportLabel(CDG), 'CDG · Paris');
  assert.equal(routeAirportLabel({ code: 'LFPG' }), 'LFPG');
  assert.equal(routeAirportLabel({ name: 'Lyon' }), 'Lyon');
  assert.equal(routeAirportLabel(null), '');
});

test('a route with no coordinates yields no plan — there is nothing to draw or frame', () => {
  const at = { latitude: 47, longitude: 3.5 };
  assert.equal(buildFlightRoutePlan({ icao24: 'abc123', route: null, ...at }), null);
  assert.equal(buildFlightRoutePlan({
    icao24: 'abc123',
    route: { origin: { code: 'CDG' }, destination: JFK },
    ...at,
  }), null, 'a named origin without a position is not a position');
  assert.equal(buildFlightRoutePlan({ icao24: '', route: { origin: CDG, destination: JFK }, ...at }), null);
  assert.equal(buildFlightRoutePlan({
    icao24: 'abc123',
    route: { origin: CDG, destination: JFK },
    latitude: Number.NaN,
    longitude: 3.5,
  }), null, 'the aircraft position sets the framing height, so it is required');
});

test('the plan carries both labelled endpoints and the leg length', () => {
  const plan = buildFlightRoutePlan({
    icao24: 'ABC123',
    route: { origin: CDG, destination: JFK },
    latitude: 51.5,
    longitude: -20,
  });
  assert.equal(plan.id, 'ABC123');
  assert.equal(plan.origin.label, 'CDG · Paris');
  assert.equal(plan.destination.label, 'JFK · New York');
  assert.ok(Math.abs(plan.legKm - 5837) < 40, `CDG→JFK is ~5837 km, got ${plan.legKm}`);
});

test('the signature is the identity of the DRAWING, so a position refresh never redraws it', () => {
  const route = { origin: CDG, destination: JFK };
  const a = buildFlightRoutePlan({ icao24: 'abc123', route, latitude: 51.5, longitude: -20 });
  const b = buildFlightRoutePlan({ icao24: 'abc123', route, latitude: 50.9, longitude: -24 });
  assert.equal(a.signature, b.signature);
  const rerouted = buildFlightRoutePlan({
    icao24: 'abc123',
    route: { origin: CDG, destination: LYS },
    latitude: 51.5,
    longitude: -20,
  });
  assert.notEqual(a.signature, rerouted.signature);
});

test('the framing height puts the farther endpoint 15° off the boresight', () => {
  // 500 km away → tan(15°) · h = 500 km.
  assert.ok(Math.abs(routeFrameHeightM(500) - 1_866_025) < 2000, String(routeFrameHeightM(500)));
  // …and clears the horizon by a wide margin at that height, which is the
  // whole reason one formula covers both constraints.
  const R = 6_371_000;
  const horizonHeight = R / Math.cos(500_000 / R) - R;
  assert.ok(routeFrameHeightM(500) > horizonHeight * 4);
  // 15° also leaves the endpoint inside the VERTICAL half-angle, which on a
  // 16:10 canvas is only ~20° — the constraint that put Málaga on the bottom
  // edge of the very first live run.
  const verticalHalfAngleDeg = Math.atan(Math.tan(30 * Math.PI / 180) / 1.6) * 180 / Math.PI;
  assert.ok(verticalHalfAngleDeg > 15 && verticalHalfAngleDeg < 21, String(verticalHalfAngleDeg));
});

test('the framing height is clamped at both ends, and says when the clamp bit', () => {
  assert.equal(routeFrameHeightM(0), 40_000);
  assert.equal(routeFrameHeightM(Number.NaN), 40_000);
  assert.equal(routeFrameHeightM(5), 40_000, 'a 5 km leg is not a 19 km view');
  assert.equal(routeFrameHeightM(50_000), 12_000_000);
  assert.equal(routeFitsOneView(3000), true);
  assert.equal(routeFitsOneView(9000), false, 'half the planet away is not one view');
  // The clamp bites at ~3215 km, which is where fitsOneView must flip.
  assert.equal(routeFitsOneView(3200), true);
  assert.equal(routeFitsOneView(3300), false);
});

test('a Sydney-length leg reports honestly instead of pretending to frame it', () => {
  const plan = buildFlightRoutePlan({
    icao24: 'abc123',
    route: { origin: CDG, destination: { code: 'SYD', name: 'Sydney', lat: -33.94, lon: 151.18 } },
    latitude: 49.0,
    longitude: 2.5,
  });
  assert.equal(plan.fitsOneView, false);
  assert.equal(plan.frameHeightM, 12_000_000);
});

test('the route camera is pitched down, not straight overhead', () => {
  const offset = routeFrameOffsetEnu(1_000_000, 0);
  assert.equal(offset.up, 1_000_000);
  // 75° elevation: the camera stands back about a quarter of its own height,
  // so the arc's bow still reads as a bow rather than flattening into a line.
  const ground = Math.hypot(offset.east, offset.north);
  assert.ok(Math.abs(ground / offset.up - 1 / Math.tan(75 * Math.PI / 180)) < 1e-9);
  // A missing or absurd height falls back to the floor rather than to NaN.
  assert.equal(routeFrameOffsetEnu(Number.NaN, 0).up, 40_000);
  assert.equal(routeFrameOffsetEnu(-5, 0).up, 40_000);
});

test('the camera stands off the FLANK of the leg, whichever way the flight runs', () => {
  // Due north leg → the camera stands due east of the aircraft, so the leg
  // runs across the screen rather than into it.
  const northbound = routeFrameOffsetEnu(1_000_000, 0);
  assert.ok(northbound.east > 0 && Math.abs(northbound.north) < 1e-6);
  // Due east leg → camera due south. Rotating the leg rotates the standoff
  // with it; a fixed standoff is what put a southbound destination off the
  // bottom of the frame in the first live run.
  const eastbound = routeFrameOffsetEnu(1_000_000, 90);
  assert.ok(eastbound.north < 0 && Math.abs(eastbound.east) < 1e-6);
  // Height is unchanged by the azimuth — only the direction of the standoff is.
  assert.equal(northbound.up, eastbound.up);
  assert.ok(Math.abs(
    Math.hypot(northbound.east, northbound.north) - Math.hypot(eastbound.east, eastbound.north),
  ) < 1e-6);
  // A leg with no computable bearing still yields a finite offset.
  const missing = routeFrameOffsetEnu(1_000_000, Number.NaN);
  assert.ok(Number.isFinite(missing.east) && Number.isFinite(missing.north));
});

test('the plan carries the bearing of the LEG, not of the aircraft', () => {
  const plan = buildFlightRoutePlan({
    icao24: 'abc123',
    route: { origin: CDG, destination: LYS },
    latitude: 47.5,
    longitude: 3.8,
  });
  // CDG → LYS runs south-southeast.
  assert.ok(plan.bearingDeg > 140 && plan.bearingDeg < 165, String(plan.bearingDeg));
});

test('the caption says the arc is a plan, in the words the cockpit already uses', () => {
  assert.equal(ROUTE_PLAN_KICKER, 'ESTIMATED FLIGHT PLAN');
});
