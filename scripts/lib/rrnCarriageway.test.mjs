// scripts/lib/rrnCarriageway.test.mjs
//
// Putting a live road event on the tarmac it names.
//
// Two of these tests exist because the obvious implementation is wrong in a
// way that is invisible until you count: `traceAlongRoad()` next door looks
// like the right entry point and rejects 165 of 196 real events, and
// `parsePrAddress` silently drops the carriageway letter for 35% of them.
// Everything else here is about REFUSING — a publisher that contradicts itself
// must produce a chord, not a confident wrong road.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_DETOUR_FACTOR,
  MAX_END_ERROR_M,
  clipSection,
  haversineM,
  indexCarriagewayPack,
  polylineLengthM,
  resolvePrCumul,
  traceBetweenPr,
} from './rrnCarriageway.mjs';
import { lambert93ToWgs84, wgs84ToLambert93 } from './lambert93.mjs';

/**
 * A one-carriageway pack: a straight 10 km run of "N0126", side I, with posts
 * every kilometre. Straight on purpose — a synthetic curve would test the
 * fixture, and what needs testing is the addressing.
 */
function fixturePack({ side = 'I' } = {}) {
  const origin = wgs84ToLambert93(1.7, 43.6);
  const posts = {};
  for (let km = 0; km <= 10; km += 1) {
    posts[`N0126|81|${km}|${side}`] = km * 1000;
  }
  // One section per kilometre, two vertices each, delta-coded.
  const lines = { [`N0126|${side}`]: [] };
  for (let km = 0; km < 10; km += 1) {
    const x0 = Math.round(origin.x + km * 1000);
    const x1 = Math.round(origin.x + (km + 1) * 1000);
    const y = Math.round(origin.y);
    lines[`N0126|${side}`].push([km * 1000, (km + 1) * 1000, [x0, y, x1 - x0, 0]]);
  }
  return indexCarriagewayPack({ posts, lines, stats: { posts: 11, carriageways: 1 } });
}

/** Where the fixture's cumul `m` lands in WGS84. */
function fixturePoint(m) {
  const origin = wgs84ToLambert93(1.7, 43.6);
  const { lon, lat } = lambert93ToWgs84(origin.x + m, origin.y);
  return [lon, lat];
}

const trace = (pack, from, to, chord) => traceBetweenPr(pack, {
  roadNumber: 'N0126',
  from,
  to,
  chord,
  toWgs84: lambert93ToWgs84,
});

// ── Addressing ──────────────────────────────────────────────────────────────

test("DATEX's undivided 'U' is the bornage's 'I', and the letter must survive", () => {
  // THE TRAP. `parsePrAddress` keeps a side letter only if it is one of
  // D/G/I, so it returns side:null for every `U` — and `U` is 137 of the 392
  // side letters in the live feed. A null side falls through to whichever
  // carriageway the referential happens to hold first, which on a dual road is
  // the wrong side of the central reservation.
  const pack = fixturePack({ side: 'I' });
  const resolved = resolvePrCumul(pack, 'N0126', { referent: '81PR5U', distanceAlong: 394 });
  assert.ok(resolved, 'a U address must resolve');
  assert.equal(resolved.side, 'I');
  assert.equal(resolved.cumul, 5394, 'the abscissa is added to the post');
  // The letters the bornage already understands pass through untouched.
  const right = resolvePrCumul(fixturePack({ side: 'D' }), 'N0126', { referent: '81PR3D', distanceAlong: 0 });
  assert.equal(right.side, 'D');
  assert.equal(right.cumul, 3000);
});

test('an address the referential does not hold resolves to nothing, never to zero', () => {
  const pack = fixturePack();
  for (const referent of ['81PR99I', '99PR5I', 'nonsense', '', null, undefined]) {
    assert.equal(resolvePrCumul(pack, 'N0126', { referent, distanceAlong: 0 }), null, String(referent));
  }
  // A bare PR with no département cannot pick a carriageway either.
  assert.equal(resolvePrCumul(pack, 'N0126', { referent: '5', distanceAlong: 0 }), null);
});

// ── Clipping ────────────────────────────────────────────────────────────────

test('a section is clipped by proportional arc length, and an empty window is empty', () => {
  const section = { from: 0, to: 1000, points: [0, 0, 1000, 0] };
  const half = clipSection(section, 0, 500);
  assert.equal(half[0], 0);
  assert.ok(Math.abs(half[half.length - 2] - 500) < 1, `${half[half.length - 2]}`);
  // Windows that miss the section entirely produce nothing rather than a
  // degenerate two-point line at its edge.
  assert.deepEqual(clipSection(section, 2000, 3000), []);
  assert.deepEqual(clipSection({ from: 0, to: 0, points: [0, 0, 1, 0] }, 0, 1), []);
  assert.deepEqual(clipSection({ from: 0, to: 100, points: [0, 0] }, 0, 100), []);
});

// ── Tracing ─────────────────────────────────────────────────────────────────

test('a trace follows the road between two PR addresses', () => {
  const pack = fixturePack();
  const from = fixturePoint(2000);
  const to = fixturePoint(7000);
  const result = trace(
    pack,
    { referent: '81PR2U', distanceAlong: 0 },
    { referent: '81PR7U', distanceAlong: 0 },
    [...from, ...to],
  );
  assert.equal(result.reason, null);
  assert.ok(result.coordinates.length >= 4);
  // 5 km of road for a 5 km chord, on a straight fixture.
  assert.ok(Math.abs(result.lengthM - 5000) < 50, `${result.lengthM} m`);
  assert.ok(result.endErrorM < 5, `${result.endErrorM} m from the published ends`);
});

test('the trace is emitted in the direction the publisher wrote the event', () => {
  // The road's direction of measurement and the record's from/to are
  // independent: the N126 case publishes fromPoint PR47 and toPoint PR5, i.e.
  // descending. The drawn line must still start where the record's own first
  // coordinate is, or the card's direction and the map disagree.
  const pack = fixturePack();
  const head = fixturePoint(7000);
  const tail = fixturePoint(2000);
  const result = trace(
    pack,
    { referent: '81PR7U', distanceAlong: 0 },
    { referent: '81PR2U', distanceAlong: 0 },
    [...head, ...tail],
  );
  assert.equal(result.reason, null);
  assert.ok(haversineM([result.coordinates[0], result.coordinates[1]], head) < 5);
  assert.ok(haversineM(
    [result.coordinates[result.coordinates.length - 2], result.coordinates[result.coordinates.length - 1]],
    tail,
  ) < 5);
});

test('a trace that disagrees with the published coordinates is refused', () => {
  // The guard that stops a 200 m worksite being drawn as a loop around a city.
  // In the live feed eleven records place their PR address and their TPEG
  // coordinates more than 500 m apart, one of them by 5 333 m.
  const pack = fixturePack();
  const elsewhere = [2.9, 44.4];
  const result = trace(
    pack,
    { referent: '81PR2U', distanceAlong: 0 },
    { referent: '81PR7U', distanceAlong: 0 },
    [...elsewhere, ...fixturePoint(7000)],
  );
  assert.equal(result.coordinates, null);
  assert.match(result.reason, /disagree/);
  assert.ok(result.endErrorM > MAX_END_ERROR_M);
});

test('a trace implausibly longer than its own chord is refused', () => {
  // `N2165` traces 82 614 m of rocade for a 218 m chord in the live feed:
  // both published ends are honoured and the ROAD between them is absurd,
  // because the PR addresses wrap the far side of a ring road. Reproduced with
  // a carriageway that goes out 5 km and comes back to where it started, so
  // the ends agree and only the length is wrong.
  const origin = wgs84ToLambert93(1.7, 43.6);
  const out = [];
  const back = [];
  for (let km = 0; km <= 5; km += 1) out.push(Math.round(origin.x + km * 1000), Math.round(origin.y));
  for (let km = 5; km >= 0; km -= 1) back.push(Math.round(origin.x + km * 1000), Math.round(origin.y));
  const delta = (flat) => {
    const d = [];
    let px = 0; let py = 0;
    for (let i = 0; i < flat.length; i += 2) {
      d.push(flat[i] - px, flat[i + 1] - py);
      px = flat[i]; py = flat[i + 1];
    }
    return d;
  };
  const pack = indexCarriagewayPack({
    posts: { 'N0126|81|0|I': 0, 'N0126|81|10|I': 10_000 },
    lines: { 'N0126|I': [[0, 5000, delta(out)], [5000, 10_000, delta(back)]] },
  });
  const here = fixturePoint(0);
  const result = traceBetweenPr(pack, {
    roadNumber: 'N0126',
    from: { referent: '81PR0U', distanceAlong: 0 },
    to: { referent: '81PR10U', distanceAlong: 0 },
    // Both ends are the same place — a 218 m chord, in the live case.
    chord: [here[0], here[1], here[0] + 0.0025, here[1]],
    toWgs84: lambert93ToWgs84,
  });
  assert.equal(result.coordinates, null);
  assert.match(result.reason, /longer than its chord/);
  assert.ok(result.lengthM > 9000, `${result.lengthM} m of road`);
  assert.ok(result.endErrorM < MAX_END_ERROR_M, 'the ends agree — only the length is absurd');
  assert.ok(MAX_DETOUR_FACTOR > 1);
});

test('every refusal names itself, and none of them throws', () => {
  const pack = fixturePack();
  const chord = [...fixturePoint(0), ...fixturePoint(1000)];
  const cases = [
    [{ roadNumber: 'bretelle 01A803903CD' }, /not a numbered route/],
    [{ from: { referent: '81PR99U', distanceAlong: 0 } }, /not in the referential/],
    [{ roadNumber: 'A0007' }, /not in the referential/],
    [
      { from: { referent: '81PR3U', distanceAlong: 0 }, to: { referent: '81PR3U', distanceAlong: 0 } },
      /same point/,
    ],
  ];
  for (const [override, expected] of cases) {
    const result = traceBetweenPr(pack, {
      roadNumber: 'N0126',
      from: { referent: '81PR0U', distanceAlong: 0 },
      to: { referent: '81PR1U', distanceAlong: 0 },
      chord,
      toWgs84: lambert93ToWgs84,
      ...override,
    });
    assert.equal(result.coordinates, null, JSON.stringify(override));
    assert.match(result.reason, expected);
  }
});

test('a carriageway with no surveyed geometry refuses rather than inventing one', () => {
  // 17 939 slip roads and unnumbered axes are rejected by the pack build. An
  // event on one must produce a chord, and say why.
  const pack = indexCarriagewayPack({ posts: { 'N0126|81|0|I': 0, 'N0126|81|1|I': 1000 }, lines: {} });
  const result = trace(
    pack,
    { referent: '81PR0U', distanceAlong: 0 },
    { referent: '81PR1U', distanceAlong: 0 },
    [...fixturePoint(0), ...fixturePoint(1000)],
  );
  assert.equal(result.coordinates, null);
  assert.match(result.reason, /no surveyed centreline/);
});

test('the two ends must be on the same carriageway, and I wins a tie', () => {
  // The two sides of a dual road are separate polylines; mixing them makes a
  // segment zigzag across the central reservation. Ten live records resolve
  // their two ends to different sides.
  const pack = indexCarriagewayPack({
    posts: { 'N0126|81|0|D': 0, 'N0126|81|5|G': 5000 },
    lines: {},
  });
  const result = trace(
    pack,
    { referent: '81PR0D', distanceAlong: 0 },
    { referent: '81PR5G', distanceAlong: 0 },
    [...fixturePoint(0), ...fixturePoint(5000)],
  );
  assert.equal(result.coordinates, null);
  assert.match(result.reason, /different carriageways/);
});

test('an empty or malformed pack degrades to refusals, not to exceptions', () => {
  for (const pack of [{}, { posts: null, lines: null }, null, undefined]) {
    const index = indexCarriagewayPack(pack);
    assert.equal(index.posts.size, 0);
    assert.equal(index.carriageway('N0126|I'), null);
    const result = trace(
      index,
      { referent: '81PR0U', distanceAlong: 0 },
      { referent: '81PR1U', distanceAlong: 0 },
      [1.7, 43.6, 1.71, 43.6],
    );
    assert.equal(result.coordinates, null);
    assert.ok(result.reason);
  }
});

test('polyline length is measured along the line, not across it', () => {
  // A traced road is longer than its chord and the card prints the road. A
  // helper that measured end to end would describe a different line than the
  // one on screen.
  const zig = [1.70, 43.60, 1.71, 43.61, 1.72, 43.60];
  assert.ok(polylineLengthM(zig) > haversineM([1.70, 43.60], [1.72, 43.60]));
  assert.equal(polylineLengthM([1.7, 43.6]), 0);
  assert.equal(polylineLengthM([]), 0);
});
