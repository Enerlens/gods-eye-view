// What the WIDE regime of `idfm-frequency` is allowed to colour.
//
// The property under test is a division: every polygon this module paints
// carries a NUMERATOR the publisher aggregated and a DIVISOR this repo
// enumerated, and the two must come from the same partition and be present at
// the same time. Three ways that can go wrong, all held shut below:
//
//   1. NO DIVISOR IS NOT ZERO SERVICE. A bucket whose stop list never arrived
//      must produce no rate and no fill — not a rate of Infinity, and not the
//      bottom of the ladder, which would read "we counted, and almost nothing
//      runs" over a département nobody counted.
//   2. A THIN DIVISOR IS WORSE THAN NONE. The committed Paris census is a
//      six-stop slice, and dividing a whole département's courses by six gives
//      7 725 departures per hour per stop. That number is arithmetically
//      correct and completely false, which is exactly why `paint` requires a
//      thousand stops before a polygon is allowed a colour.
//   3. THE NULL BUCKET MUST NOT REACH THE MAP. 549 stops answer to no
//      département code and have no coordinate. They travel as their own field
//      so that no loop over `departements` can paint them.
//
// The second property is honesty about the cross-check: the published
// `code_departement` and the bundled IGN outlines disagree on 542 of the 35 953
// placed stops region-wide (1.51 %), and the fixture reproduces one of them.
// The map is NOT repartitioned on that; the disagreement is reported.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  IDFM_FREQ_BUCKETS,
  IDFM_FREQ_CORE_DEPARTEMENTS,
  IDFM_FREQ_REGION_MIN_STOPS,
  foldFrequencyRegion,
  paintedDepartements,
  regionBucketKey,
  regionDayTotal,
  regionRatePerStop,
} from './idfmFrequencyDepartements.js';
import { IDFM_FREQ_DATASET, IDFM_FREQ_LICENCE } from './idfmFrequencyFeed.js';
import { buildDepartementIndex } from './franceDepartements.js';

const read = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

const BANDS = read('idfm-frequence-region-sample.json');
const NO_COORDS = read('idfm-frequence-sans-coordonnees-sample.json');
const OISE = read('idfm-frequence-arrets-60-sample.json');
const PARIS_SLICE = read('idfm-frequence-identite-sample.json');
const DEPARTEMENTS = JSON.parse(readFileSync(
  new URL('./local_data/france_departements/departements.geojson', import.meta.url),
  'utf8',
));

const CENSUS = [
  { code: null, envelope: NO_COORDS },
  { code: '60', envelope: OISE },
  { code: '75', envelope: PARIS_SLICE },
];

const REGION = foldFrequencyRegion({ bands: BANDS, stops: CENSUS, geojson: DEPARTEMENTS });
const row = (code) => REGION.departements.find((entry) => entry.code === code);

test('the committed fixtures are the rows they claim to be', () => {
  // 96 rows = four buckets × 24 bands, trimmed from the 356-row / 73 723-byte
  // whole-région answer measured 2026-09-02.
  assert.equal(BANDS.total_count, 96);
  assert.equal(BANDS.results.length, 96);
  // The Oise enumeration is COMPLETE and untrimmed — its count is the datum.
  assert.equal(OISE.total_count, 87);
  assert.equal(OISE.results.length, 87);
  assert.equal(new Set(OISE.results.map((entry) => entry.id_arret)).size, 87);
});

test('the null bucket is one bucket however the portal spells it', () => {
  // The `is null` predicate answers with a JSON null; the portal's own facet UI
  // shows "None". Two buckets here would split 549 stops in half.
  assert.equal(regionBucketKey({ code_departement: null }), null);
  assert.equal(regionBucketKey({ code_departement: 'None' }), null);
  assert.equal(regionBucketKey({ code_departement: '  ' }), null);
  assert.equal(regionBucketKey({}), null);
  assert.equal(regionBucketKey({ code_departement: '75' }), '75');
  assert.equal(IDFM_FREQ_BUCKETS.length, 17);
  assert.equal(IDFM_FREQ_BUCKETS[0], null);
});

test('the no-département bucket never reaches the list of things to paint', () => {
  assert.equal(REGION.departements.some((entry) => entry.code === null), false);
  assert.deepEqual(REGION.departements.map((entry) => entry.code), ['60', '75', '77']);
  assert.equal(REGION.unplaced.code, null);
  assert.equal(REGION.unplaced.stops, 8);
  // Every one of them has a null coordinate. That is the whole bucket's
  // definition, and it is what makes them undrawable rather than merely
  // uncounted.
  assert.equal(REGION.unplaced.placed, 0);
  assert.equal(REGION.unplaced.paint, false);
  assert.equal(REGION.unplaced.bands, 24);
  assert.equal(REGION.unplaced.week, 538077);
});

test('the totals add each group exactly once', () => {
  // 93 placed + 8 unplaced. The first draft counted the null bucket in both
  // halves and reported 101 stops for 101 − 8 real ones.
  assert.equal(REGION.totals.placed, 93);
  assert.equal(REGION.totals.unplaced, 8);
  assert.equal(REGION.totals.stops, 101);
  assert.equal(REGION.totals.buckets, 4);
  assert.equal(REGION.totals.bandRows, 96);
  assert.equal(REGION.totals.outOfRangeRows, 0);
});

test('a bucket with no enumerated stop list has no rate at all', () => {
  // 77 is in the band fixture and not in the census.
  const seine = row('77');
  assert.equal(seine.stops, null);
  assert.equal(seine.placed, null);
  assert.equal(seine.paint, false);
  assert.equal(regionRatePerStop(seine, 'mardi', 8), null);
  // The numerator is still there and still true — the courses were published.
  assert.equal(Math.round(regionDayTotal(seine, 'mardi')), 258342);
  assert.equal(seine.week, 1500862);
});

test('a divisor too thin to trust does not get to paint a département', () => {
  // Six real Paris stops against the whole of Paris's courses: 7 725 departures
  // per hour per stop. Arithmetically exact, and a lie about the city.
  const paris = row('75');
  assert.equal(paris.stops, 6);
  assert.ok(regionRatePerStop(paris, 'mardi', 8) > 7000);
  assert.equal(paris.paint, false);
  assert.ok(paris.stops < IDFM_FREQ_REGION_MIN_STOPS);
  assert.equal(IDFM_FREQ_REGION_MIN_STOPS, 1000);
  // Against the real enumeration the same code paints: 3 506 stops, 13.22/h.
  // The threshold sits in a 2 884-stop gap between the smallest Île-de-France
  // bucket (94, 2 971 stops) and the largest fringe one (60, 87).
  assert.ok(IDFM_FREQ_REGION_MIN_STOPS > 87 && IDFM_FREQ_REGION_MIN_STOPS < 2971);
});

test('a département outside Île-de-France is counted and never painted', () => {
  const oise = row('60');
  assert.equal(oise.stops, 87);
  assert.equal(oise.placed, 87);
  assert.equal(oise.paint, false);
  assert.equal(IDFM_FREQ_CORE_DEPARTEMENTS.includes('60'), false);
  assert.deepEqual([...IDFM_FREQ_CORE_DEPARTEMENTS], ['75', '77', '78', '91', '92', '93', '94', '95']);
  assert.deepEqual(REGION.fringeCodes, ['60', '75', '77']);
  assert.deepEqual(REGION.paintedCodes, []);
  assert.equal(paintedDepartements(REGION).size, 0);
  // It still carries a real, readable rate — 0.69 departures per hour per stop
  // at 08:00 — which is why it is on the card and not in the bin.
  assert.equal(Number(regionRatePerStop(oise, 'mardi', 8).toFixed(2)), 0.69);
});

test('the point-in-polygon cross-check reports, and does not correct', () => {
  assert.equal(REGION.crosscheck.polygons, 96);
  assert.equal(REGION.crosscheck.checked, 93);
  assert.equal(REGION.crosscheck.agree, 92);
  assert.equal(REGION.crosscheck.disagree, 1);
  assert.equal(REGION.crosscheck.outsideAll, 0);
  // One of the 87 stops published in the Oise falls inside the Val-d'Oise
  // outline. The stop stays in bucket 60 — repartitioning the divisor while the
  // numerator stays on the published code would divide one partition by
  // another — and the disagreement is a number instead.
  assert.equal(row('60').stops, 87);
  assert.equal(row('60').inside, 86);
  assert.deepEqual(REGION.insideByPolygon, { 60: 86, 75: 6, 95: 1 });
});

test('a cross-check that did not run reports nulls, never zeroes', () => {
  // Zero disagreements would read as "checked, and everything agreed", which is
  // the opposite of "not checked".
  const blind = foldFrequencyRegion({ bands: BANDS, stops: CENSUS });
  assert.deepEqual(blind.crosscheck, {
    checked: null, agree: null, disagree: null, outsideAll: null, polygons: null,
  });
  assert.equal(blind.insideByPolygon, null);
  // The divisor still works without the outlines: the cross-check is a report,
  // not a dependency.
  assert.equal(blind.departements.find((entry) => entry.code === '60').stops, 87);
  assert.equal(blind.departements.find((entry) => entry.code === '60').inside, null);
});

test('an already-built polygon index is used instead of re-indexing the bundle', () => {
  // The dev-server proxy holds one memoized `buildDepartementIndex` result for
  // the whole process (`loadSchoolsDepartementIndex`). Re-reading and
  // re-indexing the 254 KB bundle per build would be the same 96 polygons a
  // second time, and the two copies could drift apart between restarts.
  const index = buildDepartementIndex(DEPARTEMENTS);
  const viaIndex = foldFrequencyRegion({ bands: BANDS, stops: CENSUS, index });
  assert.deepEqual(viaIndex.crosscheck, REGION.crosscheck);
  assert.deepEqual(viaIndex.insideByPolygon, REGION.insideByPolygon);
  // A malformed index is not an index: it falls back rather than throwing.
  const broken = foldFrequencyRegion({ bands: BANDS, stops: CENSUS, index: { list: null } });
  assert.equal(broken.crosscheck.checked, null);
});

test('the rate is per stop, and per stop is a different ranking from the total', () => {
  const oise = row('60');
  const paris = row('75');
  // Paris runs 4 520 451 courses a week against the Oise's 3 447 — a factor of
  // 1 311 — but the per-stop rate is what a reader standing at one stop feels.
  assert.ok(paris.week > oise.week * 1000);
  assert.equal(regionRatePerStop(oise, 'mardi', 22) < regionRatePerStop(oise, 'mardi', 8), true);
  // Out-of-range and unknown inputs are nothing, never band 4 or Monday.
  assert.equal(regionRatePerStop(oise, 'mardi', null), null);
  assert.equal(regionRatePerStop(oise, 'mardi', 3), null);
  assert.equal(regionRatePerStop(oise, 'monday', 8), null);
  assert.equal(regionRatePerStop({ stops: 0, profile: oise.profile }, 'mardi', 8), null);
  assert.equal(regionDayTotal(oise, 'monday'), 0);
});

test('the payload carries its own provenance', () => {
  assert.equal(REGION.dataset, IDFM_FREQ_DATASET);
  assert.equal(REGION.licence, IDFM_FREQ_LICENCE);
  assert.equal(REGION.year, '2025');
  assert.equal(typeof REGION.edition, 'string');
  assert.equal(REGION.totals.week, 6562837);
});
