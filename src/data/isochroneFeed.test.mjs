// src/data/isochroneFeed.test.mjs
// Pins the UPSTREAM IGN isochrone shape against two real captured rings — one
// walking, one driving, same point, same 600 seconds. The pair is the fixture:
// the projection's only job is to make those two comparable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ISOCHRONE_MAX_RINGS,
  ISOCHRONE_MAX_SECONDS,
  ISOCHRONE_MIN_SECONDS,
  ISOCHRONE_PROFILES,
  ISOCHRONE_STEPS,
  buildIsochroneUrl,
  clampSeconds,
  equivalentRadiusM,
  parseSteps,
  projectIsochrone,
  resolveProfile,
  ringAreaKm2,
  ringExpansion,
} from './isochroneFeed.js';

const read = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const WALK = read('ign-isochrone-pedestrian-sample.json');
const DRIVE = read('ign-isochrone-car-sample.json');

test('the captured rings still carry every field the projection reads', () => {
  for (const sample of [WALK, DRIVE]) {
    for (const key of ['profile', 'costValue', 'costType', 'resourceVersion', 'geometry']) {
      assert.ok(Object.hasOwn(sample, key), `${key} must still be published`);
    }
    assert.equal(sample.geometry.type, 'Polygon');
    assert.equal(sample.costType, 'time');
  }
  assert.equal(WALK.profile, 'pedestrian');
  assert.equal(DRIVE.profile, 'car');
});

test('cycling is not offered, because this service does not have it', () => {
  // `bicycle` and `truck` are HTTP 400 upstream. Mapping `bike` onto
  // `pedestrian` would draw a walking ring and label it cycling.
  assert.equal(resolveProfile('bike'), null);
  assert.equal(resolveProfile('bicycle'), null);
  assert.throws(() => buildIsochroneUrl({ lon: 2.4, lat: 48.8, profile: 'bike', seconds: 600 }),
    /unsupported profile/);
  assert.deepEqual(Object.keys(ISOCHRONE_PROFILES), ['foot', 'car']);
});

test('both the app spelling and the IGN spelling resolve', () => {
  assert.equal(resolveProfile('foot'), 'pedestrian');
  assert.equal(resolveProfile('pedestrian'), 'pedestrian');
  assert.equal(resolveProfile('CAR'), 'car');
});

test('the URL carries the resource, the cost type and a clamped duration', () => {
  const url = new URL(buildIsochroneUrl({ lon: 2.3760, lat: 48.8300, profile: 'foot', seconds: 99_999 }));
  assert.equal(url.searchParams.get('point'), '2.376,48.83');
  assert.equal(url.searchParams.get('resource'), 'bdtopo-valhalla');
  assert.equal(url.searchParams.get('costType'), 'time');
  assert.equal(url.searchParams.get('profile'), 'pedestrian');
  assert.equal(url.searchParams.get('costValue'), String(ISOCHRONE_MAX_SECONDS));
  assert.equal(clampSeconds(1), ISOCHRONE_MIN_SECONDS);
  assert.equal(clampSeconds('x'), 600);
});

test('ten minutes on foot and ten minutes by car are not the same place', () => {
  const walk = projectIsochrone(WALK);
  const drive = projectIsochrone(DRIVE);
  assert.equal(walk.seconds, 600);
  assert.equal(drive.seconds, 600);
  // 0.97 km² against 16 km²: the same duration, sixteen times the reach. This
  // ratio is the whole argument for drawing reachability instead of circles.
  assert.equal(walk.areaKm2, 0.97);
  assert.equal(drive.areaKm2, 16);
  assert.ok(drive.ring.length > walk.ring.length * 10);
});

test('the resource version is relayed, never pinned', () => {
  // It moved between two probes on the same day (2026-08-26, then 2026-08-25),
  // so asserting a value would fail on a Tuesday for no reason. What must hold
  // is that the field arrives: it is the only evidence of which BD TOPO
  // edition the ring was cut from.
  const walk = projectIsochrone(WALK);
  assert.equal(typeof walk.resourceVersion, 'string');
  assert.match(walk.resourceVersion, /^\d{4}-\d{2}-\d{2}$/);
});

test('a non-polygon or degenerate answer projects to null, never to a stray ring', () => {
  assert.equal(projectIsochrone(null), null);
  assert.equal(projectIsochrone({ geometry: { type: 'LineString', coordinates: [] } }), null);
  assert.equal(projectIsochrone({ geometry: { type: 'Polygon', coordinates: [[[1, 2]]] } }), null);
});

test('area is spherical, signed-independent, and zero for a degenerate ring', () => {
  assert.equal(ringAreaKm2([]), 0);
  assert.equal(ringAreaKm2([[0, 0], [1, 0]]), 0);
  const square = [[0, 0], [0, 1], [1, 1], [1, 0]];
  const reversed = [...square].reverse();
  // Winding order must not change the magnitude — the upstream does not
  // promise one, and a negative area would render as an empty ring.
  assert.equal(ringAreaKm2(square), ringAreaKm2(reversed));
  assert.ok(ringAreaKm2(square) > 12_000);
});

test('an absent parameter takes the default, not the minimum', () => {
  // FOUND LIVE. `URLSearchParams.get()` returns `null` when a parameter is
  // absent, `Number(null)` is `0`, and `Number.isFinite(0)` is true — so the
  // clamp read "the caller said nothing" as "the caller said zero" and returned
  // its MINIMUM. `GET /api/dpe` with no radius scanned 50 m instead of 200 m and
  // reported `total: 0` for an address with 2,805 diagnostics around it.
  const absent = new URL('http://x/?other=1').searchParams.get('seconds');
  assert.equal(absent, null);
  assert.equal(clampSeconds(absent), 600);
  assert.equal(clampSeconds(''), 600);
  assert.equal(clampSeconds(undefined), 600);
  // An EXPLICIT zero is still a request, and is still clamped to the floor.
  assert.equal(clampSeconds('0'), 120);
});

// ── The ring LIST, added when the service got a layer ───────────────────────

test('an absent seconds parameter means the three rings a brief asks for', () => {
  assert.deepEqual(parseSteps(undefined), [...ISOCHRONE_STEPS]);
  assert.deepEqual(parseSteps(null), [...ISOCHRONE_STEPS]);
  assert.deepEqual(parseSteps(''), [...ISOCHRONE_STEPS]);
  assert.deepEqual(parseSteps('   '), [...ISOCHRONE_STEPS]);
});

test('a single value still answers a single ring, because that is what shipped first', () => {
  // The route was a one-ring service before it had a layer, and a caller
  // reading the old docs must not silently get three requests' worth.
  assert.deepEqual(parseSteps('600'), [600]);
  assert.deepEqual(parseSteps(900), [900]);
});

test('the list is sorted, de-duplicated, clamped and bounded', () => {
  assert.deepEqual(parseSteps('900,300,600'), [300, 600, 900]);
  assert.deepEqual(parseSteps('600,600,600'), [600]);
  // Each ring is an upstream round trip against a service published at 5 req/s
  // with an explicit right to cut a client off, so the ceiling is a real limit
  // rather than a defensive one.
  assert.equal(parseSteps('120,180,240,300,360,420,480').length, ISOCHRONE_MAX_RINGS);
  // Out-of-range values are clamped rather than rejected, matching clampSeconds.
  assert.deepEqual(parseSteps('1,999999'), [ISOCHRONE_MIN_SECONDS, ISOCHRONE_MAX_SECONDS]);
  // Garbage clamps to the same default a bare `seconds=` would.
  assert.deepEqual(parseSteps('abc'), [600]);
  assert.deepEqual(parseSteps(',,,'), [...ISOCHRONE_STEPS]);
});

test('the expansion is measured area against measured area — no speed, no model', () => {
  // Free space: area grows with the square of time, so 300 → 600 quadruples.
  const free = ringExpansion([
    { seconds: 300, areaKm2: 1 },
    { seconds: 600, areaKm2: 4 },
    { seconds: 900, areaKm2: 9 },
  ]);
  assert.equal(free.length, 2);
  assert.equal(free[0].ratio, 4);
  assert.equal(free[0].freeSpaceRatio, 4);
  assert.equal(free[0].share, 100);
  assert.equal(free[1].share, 100);
});

test('the two real Lyon rings report the obstruction they actually have', () => {
  // Measured live over the Presqu'île, 2026-09-02: 0.28 / 0.94 / 2.16 km².
  const lyon = ringExpansion([
    { seconds: 300, areaKm2: 0.28 },
    { seconds: 600, areaKm2: 0.94 },
    { seconds: 900, areaKm2: 2.16 },
  ]);
  assert.equal(lyon[0].fromSeconds, 300);
  assert.equal(lyon[0].toSeconds, 600);
  assert.equal(lyon[0].share, 83.9, 'the first band frays — 84 % of free-space growth');
  // Above 100 is a real and meaningful state: the network OPENS UP past the
  // first block. It must not be clamped to 100, which would hide it.
  assert.ok(lyon[1].share > 100, `expected the outer band to open up, got ${lyon[1].share}`);
});

test('the expansion refuses rings it cannot compare, rather than dividing by zero', () => {
  assert.deepEqual(ringExpansion([]), []);
  assert.deepEqual(ringExpansion(null), []);
  assert.deepEqual(ringExpansion([{ seconds: 300, areaKm2: 1 }]), [], 'one ring is not a pair');
  assert.deepEqual(ringExpansion([
    { seconds: 300, areaKm2: 0 },
    { seconds: 600, areaKm2: 4 },
  ]), [], 'a zero-area ring is dropped, never used as a denominator');
  assert.deepEqual(ringExpansion([
    { seconds: null, areaKm2: 1 },
    { seconds: 600, areaKm2: 4 },
  ]), [], 'a ring with no duration cannot be placed in the sequence');
});

test('the expansion sorts what it is given, so a caller cannot invert it', () => {
  const out = ringExpansion([
    { seconds: 900, areaKm2: 9 },
    { seconds: 300, areaKm2: 1 },
    { seconds: 600, areaKm2: 4 },
  ]);
  assert.deepEqual(out.map((step) => step.fromSeconds), [300, 600]);
});

test('the equivalent radius is the circle this layer exists to refuse', () => {
  // A circle of 1 km² has a radius of 564 m; rounded to ten, 560.
  assert.equal(equivalentRadiusM(1), 560);
  // The measured Lyon 15-minute walk, 2.16 km² → 829 m, rounded to 830.
  assert.equal(equivalentRadiusM(2.16), 830);
  assert.equal(equivalentRadiusM(0), 0);
  assert.equal(equivalentRadiusM(-1), 0);
  assert.equal(equivalentRadiusM(null), 0);
});

test('the captured rings project and then compare as a set', () => {
  // The two fixtures are the SAME point and the SAME 600 s in two profiles, so
  // they are not a nested pair — but they still have to survive the pipeline
  // the layer runs them through.
  const walk = projectIsochrone(WALK);
  const drive = projectIsochrone(DRIVE);
  assert.ok(walk.areaKm2 > 0 && drive.areaKm2 > 0);
  assert.ok(drive.areaKm2 > walk.areaKm2, 'a car reaches further than a walk in the same time');
  assert.ok(equivalentRadiusM(drive.areaKm2) > equivalentRadiusM(walk.areaKm2));
});
