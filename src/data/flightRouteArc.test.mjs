import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFlightRoutePlan, ROUTE_PLAN_KICKER } from './flightRoutePlan.js';
import { routeArcPositions, routeOverlayEntries } from './flightRouteArc.js';

const PLAN = buildFlightRoutePlan({
  icao24: 'abc123',
  route: {
    origin: { code: 'CDG', name: 'Paris', lat: 49.0097, lon: 2.5479 },
    destination: { code: 'JFK', name: 'New York', lat: 40.6398, lon: -73.7789 },
  },
  latitude: 51.5,
  longitude: -20,
});

test('the arc touches down on both airports', () => {
  const positions = routeArcPositions(PLAN);
  assert.ok(Math.abs(positions[0] - PLAN.origin.lon) < 1e-6);
  assert.ok(Math.abs(positions[1] - PLAN.origin.lat) < 1e-6);
  assert.equal(positions[2], 0);
  assert.ok(Math.abs(positions.at(-3) - PLAN.destination.lon) < 1e-6);
  assert.ok(Math.abs(positions.at(-2) - PLAN.destination.lat) < 1e-6);
  assert.ok(Math.abs(positions.at(-1)) < 1e-6);
});

test('the bow rides well above any cruise altitude, so it cannot read as a flown track', () => {
  const heights = [];
  const positions = routeArcPositions(PLAN);
  for (let i = 2; i < positions.length; i += 3) heights.push(positions[i]);
  const apex = Math.max(...heights);
  assert.ok(apex > 100_000, `a transatlantic leg should bow past 100 km, got ${apex}`);
  assert.ok(apex <= 220_000);
  // Odd sample count, so a vertex lands exactly on the apex — that vertex is
  // what carries the ESTIMATED FLIGHT PLAN caption.
  assert.equal(heights.length % 2, 1);
  assert.equal(heights.indexOf(apex), (heights.length - 1) / 2);
});

test('the three captions are the two airports and the honesty kicker at the apex', () => {
  const positions = routeArcPositions(PLAN);
  const entries = routeOverlayEntries(PLAN, positions);
  assert.deepEqual(entries.map((entry) => entry.title), [
    ROUTE_PLAN_KICKER,
    'CDG · Paris',
    'JFK · New York',
  ]);
  assert.deepEqual(entries.map((entry) => entry.id), [
    'abc123:kicker',
    'abc123:origin',
    'abc123:destination',
  ]);
  // The kicker outranks the airports in the collision cohort: if only one
  // caption survives, it must be the one that says this is a schedule.
  assert.ok(entries[0].priority > entries[1].priority);
  // A caption is not a click surface — selecting the aircraft must not be
  // stealable by the pins of its own route.
  assert.ok(entries.every((entry) => entry.interactive === false));
});
