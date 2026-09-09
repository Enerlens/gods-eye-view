// What a charge point is DOING, joined to where it is.
//
// The property under every test here is the one `qualichargeDynamic.js`
// measured nationally and this module applies per car park: **a row nobody has
// re-affirmed for a day is not a free plug.** Counting the file as it stands
// inflates France's free capacity by 44.4 %, in one direction — an operator
// that goes silent goes silent while its plugs are idle — so a stale row is
// counted as MUTE, named on the card, and never added to the free total.
//
// The second property is that an ambiguous placement is refused. 9.34 % of
// plug ids in the register are published at more than one coordinate, and the
// layer's render unit is the coordinate: putting a plug's state on one of two
// places 200 m apart is a coin toss printed as a fact.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  IRVE_PLACEMENT_TOLERANCE_M,
  buildIrvePlacements,
  foldIrveLiveBySite,
  irveDistanceM,
  irveLiveAgeLabel,
  irveLiveFromTuple,
  irveLiveLine,
  irveLiveTuple,
} from './irveLive.js';
import { irveSiteKey } from './irveFeed.js';
import { QUALICHARGE_FRESH_MS } from './qualichargeDynamic.js';

const HEADER = 'id_pdc_itinerance,consolidated_latitude,consolidated_longitude';

/** A QualiCharge row as `parseQualichargeDynamic` emits it. */
const row = (etat, occupation, ageMs, now) => ({
  e: etat, o: occupation, t: Math.round((now - ageMs) / 1000),
});

test('the placement table is built from three columns and nothing else', () => {
  const built = buildIrvePlacements([
    HEADER,
    'FRAAA1,48.85661,2.35222',
    'FRAAA2,45.76404,4.83566',
    '',
  ].join('\n'));
  assert.equal(built.rows, 2);
  assert.equal(built.ids, 2);
  assert.equal(built.ambiguous, 0);
  assert.equal(built.placements.get('FRAAA1'), irveSiteKey(48.85661, 2.35222));
  assert.equal(built.placements.get('FRAAA2'), irveSiteKey(45.76404, 4.83566));
});

test('the export ships a BOM, and a header lookup that misses places nothing', () => {
  const built = buildIrvePlacements(`﻿${HEADER}\nFRAAA1,48.85661,2.35222`);
  assert.equal(built.placements.size, 1);
  // A missing column is a REFUSAL, not a partial read: every plug would
  // silently go unplaced and the card would quietly stop saying anything.
  const broken = buildIrvePlacements('id_pdc_itinerance,lat,lon\nFRAAA1,48.8,2.3');
  assert.equal(broken.placements.size, 0);
  assert.equal(broken.rows, 0);
  assert.equal(buildIrvePlacements('').placements.size, 0);
  assert.equal(buildIrvePlacements(null).placements.size, 0);
});

test('a plug published twice within GPS scatter is one place', () => {
  // ~11 m apart: the same car park, surveyed twice.
  const built = buildIrvePlacements([
    HEADER,
    'FRAAA1,48.85661,2.35222',
    'FRAAA1,48.85671,2.35222',
  ].join('\n'));
  assert.ok(irveDistanceM(48.85661, 2.35222, 48.85671, 2.35222) < IRVE_PLACEMENT_TOLERANCE_M);
  assert.equal(built.ambiguous, 0);
  assert.equal(built.placements.get('FRAAA1'), irveSiteKey(48.85661, 2.35222));
});

test('a plug published at two PLACES is refused, not put at one of them', () => {
  const built = buildIrvePlacements([
    HEADER,
    'FRAAA1,48.85661,2.35222', // Paris
    'FRAAA1,43.29648,5.36978', // Marseille, 660 km away
    'FRAAA2,45.76404,4.83566',
  ].join('\n'));
  assert.equal(built.ambiguous, 1);
  assert.equal(built.placements.has('FRAAA1'), false);
  assert.equal(built.placements.has('FRAAA2'), true);
  // A third row agreeing with the first cannot un-refuse it: the id has
  // already been shown to name two places.
  const stubborn = buildIrvePlacements([
    HEADER,
    'FRAAA1,48.85661,2.35222',
    'FRAAA1,43.29648,5.36978',
    'FRAAA1,48.85661,2.35222',
  ].join('\n'));
  assert.equal(stubborn.placements.has('FRAAA1'), false);
});

test('a stale row is MUTE, never free — the 44.4 % trap, per car park', () => {
  const now = Date.UTC(2026, 8, 9, 17, 0, 0);
  const placements = new Map([['A', 'K'], ['B', 'K'], ['C', 'K']]);
  const rows = new Map([
    ['A', row('S', 'L', 60_000, now)], // free, a minute ago
    ['B', row('S', 'L', QUALICHARGE_FRESH_MS + 60_000, now)], // "free" since last week
    ['C', row('S', 'O', 60_000, now)],
  ]);
  const { sites, joined, unplaced } = foldIrveLiveBySite(rows, placements, { now });
  assert.equal(joined, 3);
  assert.equal(unplaced, 0);
  assert.deepEqual(sites.get('K'), { free: 1, busy: 1, other: 0, down: 0, mute: 1 });
});

test('out of service is a measured state, not an unknown one', () => {
  const now = Date.now();
  const sites = foldIrveLiveBySite(
    new Map([
      ['A', row('H', 'L', 60_000, now)], // the operator says broken AND free
      ['B', row('S', 'R', 60_000, now)], // reserved
      ['C', row('S', '?', 60_000, now)],
    ]),
    new Map([['A', 'K'], ['B', 'K'], ['C', 'K']]),
    { now },
  ).sites;
  // Broken wins over free: a plug the operator says is out of service is not
  // one a reader can plug into, whatever the occupation column also says.
  assert.deepEqual(sites.get('K'), { free: 0, busy: 0, other: 2, down: 1, mute: 0 });
});

test('a clock running ahead loses no rows either', () => {
  const now = Date.now();
  const ahead = new Map([['A', { e: 'S', o: 'L', t: Math.round((now + 120_000) / 1000) }]]);
  const sites = foldIrveLiveBySite(ahead, new Map([['A', 'K']]), { now }).sites;
  assert.equal(sites.get('K').free, 1, 'a stamp two minutes in the future is still fresh');
  // …but a row with no stamp at all is mute rather than trusted.
  const undated = foldIrveLiveBySite(new Map([['A', { e: 'S', o: 'L', t: 0 }]]), new Map([['A', 'K']]), { now }).sites;
  assert.equal(undated.get('K').mute, 1);
});

test('an unplaced plug is counted, not silently dropped', () => {
  const now = Date.now();
  const folded = foldIrveLiveBySite(
    new Map([['A', row('S', 'L', 0, now)], ['ZZ', row('S', 'L', 0, now)]]),
    new Map([['A', 'K']]),
    { now },
  );
  assert.equal(folded.joined, 1);
  assert.equal(folded.unplaced, 1);
  assert.equal(folded.sites.size, 1);
});

test('mangled inputs are inert', () => {
  assert.equal(foldIrveLiveBySite(null, new Map()).sites.size, 0);
  assert.equal(foldIrveLiveBySite(new Map(), null).sites.size, 0);
  assert.equal(irveLiveFromTuple(null), null);
  assert.equal(irveLiveFromTuple(['K']).free, 0);
});

test('the wire tuple round-trips', () => {
  const site = { free: 3, busy: 1, other: 0, down: 2, mute: 7 };
  const back = irveLiveFromTuple(irveLiveTuple('48.85661,2.35222', site));
  assert.equal(back.key, '48.85661,2.35222');
  assert.deepEqual(
    { free: back.free, busy: back.busy, other: back.other, down: back.down, mute: back.mute },
    site,
  );
});

test('the denominator is what the feed spoke for, never what is installed', () => {
  const now = Date.UTC(2026, 8, 9, 17, 0, 0);
  const at = now - 8 * 60_000;
  assert.equal(
    irveLiveLine({ free: 3, busy: 1, other: 0, down: 0, mute: 0 }, { at, now }),
    '3 libres sur 4 · relevé il y a 8 min',
  );
  assert.equal(
    irveLiveLine({ free: 26, busy: 3, other: 0, down: 1, mute: 188 }, { at, now }),
    '26 libres sur 30 · 1 hors service · 188 muettes · relevé il y a 8 min',
  );
});

test('a car park nobody has spoken about says THAT, rather than nothing', () => {
  const now = Date.now();
  assert.equal(
    irveLiveLine({ free: 0, busy: 0, other: 0, down: 0, mute: 14 }, { at: now, now }),
    '14 bornes sans état publié depuis plus de 24 h',
  );
  // Nothing joined at all is the one case with nothing to say.
  assert.equal(irveLiveLine({ free: 0, busy: 0, other: 0, down: 0, mute: 0 }, { at: now, now }), null);
  assert.equal(irveLiveLine(null), null);
});

test('the age is an age, never a clock time', () => {
  assert.equal(irveLiveAgeLabel(20_000), "à l'instant");
  assert.equal(irveLiveAgeLabel(8 * 60_000), 'il y a 8 min');
  assert.equal(irveLiveAgeLabel(3 * 3600_000), 'il y a 3 h');
  assert.equal(irveLiveAgeLabel(50 * 3600_000), 'il y a 2 j');
});
