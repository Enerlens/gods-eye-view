// src/data/isochroneFeed.test.mjs
// Pins the UPSTREAM IGN isochrone shape against two real captured rings — one
// walking, one driving, same point, same 600 seconds. The pair is the fixture:
// the projection's only job is to make those two comparable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ISOCHRONE_MAX_SECONDS,
  ISOCHRONE_MIN_SECONDS,
  ISOCHRONE_PROFILES,
  buildIsochroneUrl,
  clampSeconds,
  projectIsochrone,
  resolveProfile,
  ringAreaKm2,
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
