import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MEGAFIRE_FLAME,
  MEGAFIRE_PLUME_MIN_MW,
  MEGAFIRE_PLUME_HOURS,
  MEGAFIRE_PLUME_TELEPORT_M,
  MEGAFIRE_SMOKE,
  MEGAFIRE_SMOKE_DRIFT_MS,
  megafireAssignPlumes,
  megafireDriftVectors,
  megafireEmitParticle,
  megafireFireClusters,
  megafireGroundDistanceM,
  megafireParticleAppearance,
  megafirePlumeBudget,
  megafirePlumeIntensity,
  megafireRandom,
  megafireSlidePlume,
  megafireStepParticle,
} from './megafireFireMath.js';

const HOUR = 3600_000;
const T0 = Date.parse('2026-07-26T00:00:00Z');

/** A detection, with sane defaults. */
const detection = (lon, lat, frp, hoursBefore, at = T0) => ({
  lon, lat, frp, ms: at - hoursBefore * HOUR,
});

test('a plume only stands where FIRMS saw something recently enough', () => {
  const detections = [
    detection(-1.0, 44.9, 100, 1),
    // Just outside the freshness window: the fire moved on hours ago.
    detection(-1.2, 45.0, 500, MEGAFIRE_PLUME_HOURS + 0.5),
    // In the FUTURE of the cursor — the replay must never leak forwards.
    detection(-0.9, 44.8, 900, -3),
  ];
  const clusters = megafireFireClusters(detections, T0);
  assert.equal(clusters.length, 1, 'only the fresh, past detection survives');
  assert.ok(Math.abs(clusters[0].lon - (-1.0)) < 1e-6);
  assert.equal(clusters[0].count, 1);
});

test('an empty instant produces no plumes at all — the quiet days stay quiet', () => {
  const detections = [detection(-1.0, 44.9, 100, 40)];
  assert.deepEqual(megafireFireClusters(detections, T0), []);
  assert.deepEqual(megafireFireClusters([], T0), []);
});

test('a cooling pixel or two does not raise a smoke column', () => {
  // Exactly the state the layer OPENS in: at the close of the window the pack
  // still carries two detections worth 4 MW between them. A plume there would
  // hold the render governor for the whole session over a fire declared out.
  assert.deepEqual(megafireFireClusters([
    detection(-1.0, 44.9, 2.5, 6),
    detection(-1.0002, 44.9002, 2.1, 5),
  ], T0), []);
  const real = megafireFireClusters([
    detection(-1.0, 44.9, 40, 1),
    detection(-1.0001, 44.9001, 60, 1),
  ], T0);
  assert.equal(real.length, 1, 'a hundred megawatts at the head is a fire');
  assert.ok(real[0].weight >= MEGAFIRE_PLUME_MIN_MW);
});

test('clusters are ranked by radiative power, not by detection count', () => {
  const detections = [];
  // Forty cool pixels on a flank, 2 MW each.
  for (let i = 0; i < 40; i += 1) detections.push(detection(-1.30 + i * 0.0001, 44.70, 2, 2));
  // Six hot pixels at the head, 300 MW each.
  for (let i = 0; i < 6; i += 1) detections.push(detection(-1.00 + i * 0.0001, 45.00, 300, 1));
  const clusters = megafireFireClusters(detections, T0, { maxClusters: 4 });
  assert.equal(clusters.length, 2);
  assert.ok(clusters[0].lat > 44.9, 'the head leads, though it has 6 pixels against 40');
  assert.ok(clusters[0].weight > clusters[1].weight * 5);
});

test('clustering is deterministic — same input, same order, twice', () => {
  const detections = [];
  const random = megafireRandom(7);
  for (let i = 0; i < 400; i += 1) {
    detections.push(detection(-1.4 + random() * 0.8, 44.5 + random() * 0.5, random() * 200, random() * 10));
  }
  const first = megafireFireClusters(detections, T0);
  const second = megafireFireClusters([...detections].reverse(), T0);
  assert.deepEqual(
    first.map((c) => [c.count, Math.round(c.lon * 1e4), Math.round(c.lat * 1e4)]),
    second.map((c) => [c.count, Math.round(c.lon * 1e4), Math.round(c.lat * 1e4)]),
    'iteration order must not decide which head is drawn',
  );
});

test('a plume follows the head it is already on rather than its rank', () => {
  const slots = [
    { lon: -1.30, lat: 44.70, active: true },
    { lon: -1.00, lat: 45.00, active: true },
  ];
  // The southern cluster is now the STRONGER one. A rank-order assignment
  // would hand it slot 0... which happens to be right here, so the test that
  // matters is the other one: the weaker northern cluster must keep slot 1.
  const clusters = [
    { lon: -1.301, lat: 44.701, weight: 900 },
    { lon: -1.001, lat: 45.001, weight: 40 },
  ];
  const assignment = megafireAssignPlumes(slots, clusters);
  assert.equal(assignment[0].weight, 900);
  assert.equal(assignment[1].weight, 40);

  // Now swap the clusters' order in the array: the assignment must not move.
  const swapped = megafireAssignPlumes(slots, [clusters[1], clusters[0]]);
  assert.equal(swapped[0].weight, 900);
  assert.equal(swapped[1].weight, 40);
});

test('a slot with no cluster is told to stop, not reassigned', () => {
  const slots = [
    { lon: -1.0, lat: 45.0, active: true },
    { lon: -1.2, lat: 44.8, active: true },
    { lon: -1.4, lat: 44.6, active: true },
  ];
  const assignment = megafireAssignPlumes(slots, [{ lon: -1.0, lat: 45.0, weight: 10 }]);
  assert.equal(assignment.filter(Boolean).length, 1);
  assert.equal(assignment[0].weight, 10, 'the nearest slot keeps its head');
  assert.equal(assignment[1], null);
  assert.equal(assignment[2], null);
});

test('an idle slot is preferred over stealing a live one that is far away', () => {
  const slots = [
    { lon: -1.0, lat: 45.0, active: true },
    { lon: 0, lat: 0, active: false },
  ];
  const assignment = megafireAssignPlumes(slots, [{ lon: -1.30, lat: 44.60, weight: 10 }]);
  assert.equal(assignment[0], null, 'the live plume 50 km away is left alone');
  assert.ok(assignment[1], 'the idle slot takes the new head');
});

test('a plume slides to a nearby head and teleports to a distant one', () => {
  const near = { lon: -1.0, lat: 45.0 };
  const teleported = megafireSlidePlume(near, { lon: -1.02, lat: 45.0 }, 0.05);
  assert.equal(teleported, false);
  assert.ok(near.lon < -1.0 && near.lon > -1.02, 'it moved part of the way, not all of it');

  const far = { lon: -1.0, lat: 45.0 };
  const jumped = megafireSlidePlume(far, { lon: -0.5, lat: 44.5 }, 0.05);
  assert.equal(jumped, true);
  assert.equal(far.lon, -0.5, 'a different fire is arrived at, not crossed to');
});

test('the slide covers the teleport distance in the advertised time', () => {
  const plume = { lon: -1.0, lat: 45.0 };
  const target = { lon: -1.0, lat: 45.0 };
  // A target exactly one teleport-distance away, walked in one long step.
  target.lat = 45.0 + (MEGAFIRE_PLUME_TELEPORT_M * 0.99) / 111132;
  megafireSlidePlume(plume, target, 2);
  assert.ok(megafireGroundDistanceM(plume, target) < 1, 'two seconds is more than enough');
});

test('the smoke leans the way the fire actually ran', () => {
  const steps = [
    { flames: [[-1.00, 44.80]] },
    // Second frame: the flames have moved north-west.
    { flames: [[-1.20, 44.95]] },
    { flames: [] },
  ];
  const vectors = megafireDriftVectors(steps);
  assert.equal(vectors.length, 3);
  assert.ok(vectors[1].east < 0, 'west');
  assert.ok(vectors[1].north > 0, 'and north');
  assert.ok(Math.abs(Math.hypot(vectors[1].east, vectors[1].north) - 1) < 1e-9, 'unit vector');
  // The first step has no predecessor and the last has no flames: both borrow
  // the one direction anybody measured, rather than inventing one.
  assert.deepEqual(vectors[0], vectors[1]);
  assert.deepEqual(vectors[2], vectors[1]);
});

test('a pack with no flames anywhere still yields a usable direction', () => {
  const vectors = megafireDriftVectors([{ flames: [] }, { flames: [] }]);
  assert.equal(vectors.length, 2);
  for (const vector of vectors) {
    assert.ok(Math.abs(Math.hypot(vector.east, vector.north) - 1) < 1e-6);
  }
});

test('plume intensity is logarithmic, because radiative power is', () => {
  assert.equal(megafirePlumeIntensity(0), 0);
  assert.equal(megafirePlumeIntensity(NaN), 0);
  const small = megafirePlumeIntensity(5);
  const medium = megafirePlumeIntensity(50);
  const large = megafirePlumeIntensity(400);
  assert.ok(small > 0.2, `5 MW must still be visible, got ${small}`);
  assert.ok(medium > small && large > medium);
  assert.ok(large <= 1 && megafirePlumeIntensity(5000) <= 1, 'clamped at the top');
});

test('a smoke particle rises, leans downwind, and dies on schedule', () => {
  const random = megafireRandom(11);
  const particle = {};
  const plume = { drift: { east: 1, north: 0 } };
  megafireEmitParticle(particle, plume, MEGAFIRE_SMOKE, random);
  assert.equal(particle.alive, true);
  assert.equal(particle.age, 0);

  const startEast = particle.east;
  let steps = 0;
  while (megafireStepParticle(particle, 1 / 60, MEGAFIRE_SMOKE, MEGAFIRE_SMOKE_DRIFT_MS)) {
    steps += 1;
    assert.ok(steps < 2000, 'a particle that never dies is a leak');
  }
  assert.equal(particle.alive, false);
  assert.ok(steps / 60 > MEGAFIRE_SMOKE.life - MEGAFIRE_SMOKE.lifeJitter);
  assert.ok(steps / 60 < MEGAFIRE_SMOKE.life + MEGAFIRE_SMOKE.lifeJitter);
  assert.ok(particle.up > 2500, `it built a column, got ${Math.round(particle.up)} m`);
  assert.ok(particle.east > startEast + 3000, 'and it leaned downwind');
});

test('a flame particle stays put and stays low', () => {
  const random = megafireRandom(3);
  const particle = {};
  megafireEmitParticle(particle, { drift: { east: 1, north: 0 } }, MEGAFIRE_FLAME, random);
  const startEast = particle.east;
  while (megafireStepParticle(particle, 1 / 60, MEGAFIRE_FLAME, 0)) { /* burn */ }
  assert.equal(particle.east, startEast, 'flame does not drift — only the smoke does');
  // An order of magnitude under the column above it, whatever the jitter draws.
  assert.ok(particle.up < 400, `a flame that climbs past 400 m is a column, got ${particle.up}`);
});

test('a particle fades in and out, and is never born opaque', () => {
  const random = megafireRandom(5);
  const particle = {};
  megafireEmitParticle(particle, { drift: { east: 0, north: 1 } }, MEGAFIRE_SMOKE, random);
  const born = megafireParticleAppearance(particle, MEGAFIRE_SMOKE, 1);
  assert.equal(born.alpha, 0, 'a puff that appears at full opacity pops');

  particle.age = particle.life * 0.2;
  const young = megafireParticleAppearance(particle, MEGAFIRE_SMOKE, 1);
  particle.age = particle.life * 0.95;
  const old = megafireParticleAppearance(particle, MEGAFIRE_SMOKE, 1);
  assert.ok(young.alpha > old.alpha);
  assert.ok(old.size > young.size, 'smoke spreads as it ages');
  assert.ok(young.alpha <= MEGAFIRE_SMOKE.startAlpha);
});

test('intensity scales opacity and nothing else', () => {
  const random = megafireRandom(9);
  const particle = {};
  megafireEmitParticle(particle, { drift: { east: 0, north: 1 } }, MEGAFIRE_SMOKE, random);
  particle.age = particle.life * 0.4;
  const full = megafireParticleAppearance(particle, MEGAFIRE_SMOKE, 1);
  const half = megafireParticleAppearance(particle, MEGAFIRE_SMOKE, 0.5);
  assert.equal(half.size, full.size);
  assert.ok(Math.abs(half.alpha - full.alpha / 2) < 1e-12);
});

test('the seeded generator replays the same fire twice', () => {
  const a = megafireRandom(42);
  const b = megafireRandom(42);
  for (let i = 0; i < 50; i += 1) assert.equal(a(), b());
  const c = megafireRandom(43);
  assert.notEqual(megafireRandom(42)(), c());
});

test('lite draws fewer plumes than full', () => {
  assert.ok(megafirePlumeBudget(true) < megafirePlumeBudget(false));
  assert.ok(megafirePlumeBudget(true) >= 1);
});
