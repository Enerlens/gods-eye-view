// src/data/trafficBounds.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  greatCircleKm,
  deriveFetchCenter,
  clampBoundsAroundCenter,
  boundsOverlap,
  planarDistanceKm,
  roadFetchTier,
  roadRefetchNeeded,
  ROAD_ACTIVATION_ALTITUDE_M,
  ROAD_FETCH_TIERS,
  ROAD_REFETCH_OVERLAP_THRESHOLD,
} from './trafficBounds.js';

// Downtown Austin — matches the TomTom fixture tile neighbourhood.
const NADIR = { lat: 30.2672, lon: -97.7431 };

test('greatCircleKm sanity: Austin -> ~5 km north', () => {
  const d = greatCircleKm(NADIR.lat, NADIR.lon, NADIR.lat + 0.045, NADIR.lon);
  assert.ok(Math.abs(d - 5.0) < 0.1, `got ${d}`);
});

test('straight-down look: hit ~= nadir -> center unchanged (uses hit)', () => {
  const c = deriveFetchCenter({
    nadirLat: NADIR.lat, nadirLon: NADIR.lon,
    hitLat: NADIR.lat + 0.0001, hitLon: NADIR.lon - 0.0001,
    maxPullKm: 12,
  });
  assert.equal(c.source, 'hit');
  assert.ok(Math.abs(c.lat - (NADIR.lat + 0.0001)) < 1e-9);
  assert.ok(Math.abs(c.lon - (NADIR.lon - 0.0001)) < 1e-9);
});

test('oblique look within 12 km: uses the hit point verbatim', () => {
  const hit = { lat: NADIR.lat + 0.045, lon: NADIR.lon + 0.02 }; // ~5.3 km away
  const c = deriveFetchCenter({
    nadirLat: NADIR.lat, nadirLon: NADIR.lon,
    hitLat: hit.lat, hitLon: hit.lon,
    maxPullKm: 12,
  });
  assert.equal(c.source, 'hit');
  assert.equal(c.lat, hit.lat);
  assert.equal(c.lon, hit.lon);
});

test('horizon gaze: far hit is pulled back to 12 km along the bearing', () => {
  // Hit ~100 km due east of nadir.
  const hit = { lat: NADIR.lat, lon: NADIR.lon + 1.041 };
  assert.ok(greatCircleKm(NADIR.lat, NADIR.lon, hit.lat, hit.lon) > 90, 'precondition: far hit');
  const c = deriveFetchCenter({
    nadirLat: NADIR.lat, nadirLon: NADIR.lon,
    hitLat: hit.lat, hitLon: hit.lon,
    maxPullKm: 12,
  });
  assert.equal(c.source, 'pulled');
  const d = greatCircleKm(NADIR.lat, NADIR.lon, c.lat, c.lon);
  assert.ok(Math.abs(d - 12) < 0.05, `pulled distance ${d} km, expected ~12`);
  // Due-east bearing: latitude stays ~constant, longitude moves east but well
  // short of the hit.
  assert.ok(Math.abs(c.lat - NADIR.lat) < 0.01, `lat drifted: ${c.lat}`);
  assert.ok(c.lon > NADIR.lon && c.lon < hit.lon, `lon not between nadir and hit: ${c.lon}`);
});

test('pull cap is honored for other maxPullKm values', () => {
  const hit = { lat: NADIR.lat + 0.9, lon: NADIR.lon }; // ~100 km north
  const c = deriveFetchCenter({
    nadirLat: NADIR.lat, nadirLon: NADIR.lon,
    hitLat: hit.lat, hitLon: hit.lon,
    maxPullKm: 5,
  });
  assert.equal(c.source, 'pulled');
  const d = greatCircleKm(NADIR.lat, NADIR.lon, c.lat, c.lon);
  assert.ok(Math.abs(d - 5) < 0.05, `pulled distance ${d} km, expected ~5`);
});

test('pickEllipsoid failure (non-finite hit): falls back to the camera nadir', () => {
  for (const [hitLat, hitLon] of [[NaN, NaN], [undefined, undefined], [30.3, undefined]]) {
    const c = deriveFetchCenter({
      nadirLat: NADIR.lat, nadirLon: NADIR.lon,
      hitLat, hitLon,
      maxPullKm: 12,
    });
    assert.equal(c.source, 'nadir');
    assert.equal(c.lat, NADIR.lat);
    assert.equal(c.lon, NADIR.lon);
  }
});

test('span clamp: oversized bounds shrink to maxSpan centered on the given center', () => {
  const bounds = { south: 29.5, north: 30.5, west: -98.5, east: -97.5 }; // 1 degree spans
  const center = { lat: NADIR.lat, lon: NADIR.lon };
  const clamped = clampBoundsAroundCenter(bounds, center, 0.05);
  assert.ok(Math.abs((clamped.north - clamped.south) - 0.05) < 1e-12);
  assert.ok(Math.abs((clamped.east - clamped.west) - 0.05) < 1e-12);
  assert.ok(Math.abs((clamped.north + clamped.south) / 2 - center.lat) < 1e-12);
  assert.ok(Math.abs((clamped.east + clamped.west) / 2 - center.lon) < 1e-12);
});

test('span clamp: small bounds keep their span, recentered', () => {
  const bounds = { south: 30.0, north: 30.02, west: -98.0, east: -97.97 };
  const center = { lat: 30.30, lon: -97.70 };
  const clamped = clampBoundsAroundCenter(bounds, center, 0.05);
  assert.ok(Math.abs((clamped.north - clamped.south) - 0.02) < 1e-12);
  assert.ok(Math.abs((clamped.east - clamped.west) - 0.03) < 1e-12);
  assert.ok(Math.abs((clamped.north + clamped.south) / 2 - 30.30) < 1e-12);
  assert.ok(Math.abs((clamped.east + clamped.west) / 2 + 97.70) < 1e-12);
});

test('span clamp is idempotent on already-clamped bounds (loadRoadsForBounds re-clamp)', () => {
  const center = { lat: NADIR.lat, lon: NADIR.lon };
  const once = clampBoundsAroundCenter({ south: 29.5, north: 30.5, west: -98.5, east: -97.5 }, center, 0.05);
  const midpoint = { lat: (once.south + once.north) / 2, lon: (once.west + once.east) / 2 };
  const twice = clampBoundsAroundCenter(once, midpoint, 0.05);
  assert.deepEqual(twice, once);
});

// ─── Altitude bands ───────────────────────────────────────────────────────
// The reason these exist: with one 0.05° box at every altitude, the animated
// roads and the live transit fleet could not share a camera position. Bordeaux
// Métropole is 23 × 26 km; the old box showed 5.5 km of it.

test('each altitude lands in exactly one band, and the boundaries are inclusive', () => {
  assert.equal(roadFetchTier(0)?.id, 'street');
  assert.equal(roadFetchTier(4500)?.id, 'street', 'a boundary belongs to the finer band');
  assert.equal(roadFetchTier(4501)?.id, 'district');
  assert.equal(roadFetchTier(8000)?.id, 'district');
  assert.equal(roadFetchTier(8001)?.id, 'metro');
  assert.equal(roadFetchTier(30000)?.id, 'metro');
});

test('above the coarsest band there is no band at all — the clear signal', () => {
  assert.equal(roadFetchTier(30001), null);
  assert.equal(roadFetchTier(ROAD_ACTIVATION_ALTITUDE_M + 1), null);
  assert.equal(roadFetchTier(NaN), null);
  assert.equal(roadFetchTier(-1), null);
  assert.equal(roadFetchTier(undefined), null);
});

test('the bands coarsen monotonically — box grows, classes shrink', () => {
  for (let i = 1; i < ROAD_FETCH_TIERS.length; i++) {
    const finer = ROAD_FETCH_TIERS[i - 1];
    const coarser = ROAD_FETCH_TIERS[i];
    assert.ok(coarser.maxAltitudeM > finer.maxAltitudeM, `${coarser.id} must sit above ${finer.id}`);
    assert.ok(coarser.spanDeg >= finer.spanDeg, `${coarser.id} must not shrink the box`);
    assert.ok(coarser.pullKm >= finer.pullKm, `${coarser.id} must not tighten the look-at pull`);
    assert.ok(coarser.minShiftKm >= finer.minShiftKm, `${coarser.id} must not re-fetch more eagerly`);
    assert.ok(
      coarser.classes.length <= finer.classes.length,
      `${coarser.id} must not fetch more road classes than ${finer.id}`,
    );
  }
});

test('only the street band fetches the full graph, and it is a superset', () => {
  const [street, ...rest] = ROAD_FETCH_TIERS;
  assert.ok(street.fullClasses, 'street scale draws residential roads');
  for (const cls of street.classes) {
    assert.ok(street.fullClasses.includes(cls), `${cls} must survive into the full pass`);
  }
  for (const tier of rest) {
    assert.equal(tier.fullClasses, null, `${tier.id} must not ask for a full graph`);
  }
});

test('the metro band actually covers a French metropolis', () => {
  // Bordeaux Métropole's observed transit footprint is 0.21° x 0.33°. The band
  // that shows all 460 of its live vehicles has to be at least that wide, or
  // the whole point of raising the ceiling is lost.
  const metro = ROAD_FETCH_TIERS.at(-1);
  assert.ok(metro.spanDeg >= 0.21, `metro box ${metro.spanDeg}° must span Bordeaux`);
  // And the fetch centre must be allowed to sit far enough out to reach the
  // edge of that box at an oblique pitch.
  assert.ok(metro.pullKm >= (metro.spanDeg * 111) / 2);
});

test('the box span follows the band, not a fixed constant', () => {
  const bounds = { south: 44.0, west: -1.0, north: 45.0, east: 0.0 };
  const centre = { lat: 44.8378, lon: -0.5792 };
  const street = clampBoundsAroundCenter(bounds, centre, ROAD_FETCH_TIERS[0].spanDeg);
  const metro = clampBoundsAroundCenter(bounds, centre, ROAD_FETCH_TIERS.at(-1).spanDeg);
  assert.ok(
    (metro.north - metro.south) > (street.north - street.south) * 5,
    'the metro box must be a different order of size, not a nudge',
  );
  assert.ok(Math.abs((street.north + street.south) / 2 - centre.lat) < 1e-9, 'both stay centred');
  assert.ok(Math.abs((metro.north + metro.south) / 2 - centre.lat) < 1e-9);
});

// ─── The re-fetch gate ────────────────────────────────────────────────────

const BORDEAUX = { lat: 44.8378, lon: -0.5792 };
const [STREET] = ROAD_FETCH_TIERS;
const METRO = ROAD_FETCH_TIERS.at(-1);
const boxFor = (tier, centre = BORDEAUX) => clampBoundsAroundCenter(
  { south: -90, west: -180, north: 90, east: 180 }, centre, tier.spanDeg,
);

test('descending a band always re-fetches, however well the boxes overlap', () => {
  // THE REGRESSION THIS PINS. A street box sits entirely inside a metro box
  // centred on the same point: 100% overlap, zero centre shift. Judged on
  // geometry alone the layer would skip the fetch and leave a user at 2 km
  // looking at motorways-only roads fetched for a view 36× wider.
  const metroBox = boxFor(METRO);
  const streetBox = boxFor(STREET);
  assert.ok(
    boundsOverlap(streetBox, metroBox, ROAD_REFETCH_OVERLAP_THRESHOLD),
    'the trap only exists because the finer box IS covered by the coarser one',
  );
  assert.equal(planarDistanceKm(BORDEAUX, BORDEAUX), 0);

  assert.equal(roadRefetchNeeded({
    tier: STREET,
    box: streetBox,
    center: BORDEAUX,
    last: { tierId: METRO.id, bounds: metroBox, center: BORDEAUX },
  }), true);
});

test('holding still inside one band does not re-fetch', () => {
  const box = boxFor(METRO);
  assert.equal(roadRefetchNeeded({
    tier: METRO,
    box,
    center: BORDEAUX,
    last: { tierId: METRO.id, bounds: box, center: BORDEAUX },
  }), false);
});

test('a pan large for the band re-fetches; a pan small for it does not', () => {
  const last = { tierId: METRO.id, bounds: boxFor(METRO), center: BORDEAUX };
  // 1 km is a rounding error at metro scale (minShiftKm 3), and the box still
  // overlaps almost completely.
  const near = { lat: BORDEAUX.lat + 0.009, lon: BORDEAUX.lon };
  assert.ok(planarDistanceKm(near, BORDEAUX) < METRO.minShiftKm);
  assert.equal(roadRefetchNeeded({ tier: METRO, box: boxFor(METRO, near), center: near, last }), false);

  // 20 km is a different city edge.
  const far = { lat: BORDEAUX.lat + 0.18, lon: BORDEAUX.lon };
  assert.equal(roadRefetchNeeded({ tier: METRO, box: boxFor(METRO, far), center: far, last }), true);
});

test('the same pan is small at metro scale and large at street scale', () => {
  // The shift floor is per-band, and this is the reason it has to be.
  const moved = { lat: BORDEAUX.lat + 0.009, lon: BORDEAUX.lon }; // ~1 km
  assert.equal(roadRefetchNeeded({
    tier: METRO,
    box: boxFor(METRO, moved),
    center: moved,
    last: { tierId: METRO.id, bounds: boxFor(METRO), center: BORDEAUX },
  }), false);
  assert.equal(roadRefetchNeeded({
    tier: STREET,
    box: boxFor(STREET, moved),
    center: moved,
    last: { tierId: STREET.id, bounds: boxFor(STREET), center: BORDEAUX },
  }), true);
});

test('with nothing held, the first fetch always happens', () => {
  const box = boxFor(STREET);
  assert.equal(roadRefetchNeeded({ tier: STREET, box, center: BORDEAUX, last: null }), true);
  assert.equal(roadRefetchNeeded({
    tier: STREET, box, center: BORDEAUX, last: { tierId: 'street', bounds: null, center: null },
  }), true);
});

test('disjoint boxes never count as covered', () => {
  const here = boxFor(STREET);
  const elsewhere = boxFor(STREET, { lat: 48.85, lon: 2.35 });
  assert.equal(boundsOverlap(here, elsewhere, ROAD_REFETCH_OVERLAP_THRESHOLD), false);
  assert.equal(boundsOverlap(here, here, 0), true);
});
