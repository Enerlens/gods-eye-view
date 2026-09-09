// One cabinet, one dot — and only while somebody better is drawing it.
//
// `amenities-fr` draws BPE D265 (61 263 "médecin généraliste" rows) and
// `medecins-fr` draws the conventioned register (64 232 addresses). The same
// cabinet, from two registers, twice on the map. `amenities-fr` already
// applies the rule that settles it — one register per family, which is why it
// refuses the BPE's whole education domain — and `docs/PLAN-CROISEMENTS.md`
// recorded that it owes the same withdrawal here.
//
// The audit recorded the point as blocked on `AMENITY_FAMILIES` being a CACHE
// KEY: the mesh stores a family by its INDEX, so deleting one renames every
// row of every cached pack and forces a national rebuild. All true — and all
// of it the price of DELETING the family. The tests below pin down the
// cheaper answer: not drawing it while another layer does, which touches
// neither the array nor the packs, and gives every doctor back the moment the
// other row goes off.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  _amenitiesDeferredFamilyForTest,
  _amenitiesReconcileForTest,
  _amenitiesReconcileMeshForTest,
  _amenitiesRowControlsForTest,
  _amenitiesTruncatedForTest,
  _amenitiesWatchMedecinsForTest,
  _setAmenitiesStateForTest,
} from './amenitiesFrance.js';
import { AMENITY_FAMILIES } from './amenitiesFeed.js';
import { _resetJoinsForTest, hasJoin, publishJoin, watchJoin } from './layerJoins.js';

/** A stand-in for the PointPrimitiveCollection, with no WebGL anywhere. */
function stubPoints() {
  const added = [];
  return {
    added,
    show: true,
    add(options) { added.push(options); return { ...options, show: true }; },
    removeAll() { added.length = 0; },
  };
}

const site = (id, family, lat, lon) => ({
  id, family, lat, lon, name: id, precision: 'exact',
});

let points;

test.beforeEach(() => {
  _resetJoinsForTest();
  points = stubPoints();
  _setAmenitiesStateForTest({
    enabled: true, regime: 'sites', points, records: new Map(),
    medecinsDrawing: false, truncated: 0, meshPick: null,
  });
  _amenitiesWatchMedecinsForTest(true);
});

test.afterEach(() => {
  _amenitiesWatchMedecinsForTest(false);
  _resetJoinsForTest();
});

const PAYLOAD = {
  sites: [
    site('a', 'restaurant', 48.85, 2.35),
    site('b', 'medecin', 48.86, 2.34),
    site('c', 'pharmacie', 48.87, 2.33),
    site('d', 'medecin', 48.88, 2.32),
  ],
};

test('every family is drawn while the Médecins row is off', () => {
  assert.equal(hasJoin('medecins/drawn'), false);
  _amenitiesReconcileForTest(PAYLOAD);
  assert.equal(points.added.length, 4);
  assert.equal(_amenitiesDeferredFamilyForTest(), null);
});

test('the médecin family stands down while medecins-fr draws positions', () => {
  publishJoin('medecins/drawn', () => ({ regime: 'sites', sites: 120 }));
  _amenitiesReconcileForTest(PAYLOAD);
  assert.equal(points.added.length, 2, 'the two BPE doctors are left to the other register');
  assert.deepEqual(points.added.map((p) => p.id).sort(), ['a', 'c']);
  assert.equal(_amenitiesDeferredFamilyForTest(), 'medecin');
});

test('a deferred family is NOT truncation — the map is not cropped', () => {
  publishJoin('medecins/drawn', () => ({}));
  _amenitiesReconcileForTest(PAYLOAD);
  // Counting the two withdrawn rows here would report a bounded view that is
  // not bounded, and put a "2 non dessinés" warning under a complete map.
  assert.equal(_amenitiesTruncatedForTest(), 0);
});

test('the withdrawal reaches the mesh regime too', () => {
  publishJoin('medecins/drawn', () => ({}));
  const familyIndex = (family) => AMENITY_FAMILIES.indexOf(family);
  // Mesh rows are positional tuples — [lat, lon, precisionRank, familyIndex] —
  // and the family index IS the cache key the audit was worried about.
  _setAmenitiesStateForTest({
    regime: 'maillage',
    mesh: {
      rows: [
        [48.85, 2.35, 0, familyIndex('restaurant')],
        [48.86, 2.34, 0, familyIndex('medecin')],
        [48.87, 2.33, 0, familyIndex('pharmacie')],
      ],
    },
  });
  _amenitiesReconcileMeshForTest({ south: 48.8, west: 2.3, north: 48.9, east: 2.4 });
  const families = points.added.map((p) => p.id);
  assert.equal(points.added.length, 2, `drew ${families.join(', ')}`);
});

test('the legend says where the doctors went, and only while they are gone', () => {
  _amenitiesReconcileForTest(PAYLOAD);
  const before = _amenitiesRowControlsForTest();
  assert.equal(before.legend.some((row) => /Médecins/.test(row.label)), false);

  publishJoin('medecins/drawn', () => ({}));
  _amenitiesReconcileForTest(PAYLOAD);
  const after = _amenitiesRowControlsForTest();
  const row = after.legend.find((entry) => /Médecins/.test(entry.label));
  assert.ok(row, 'a reader who came looking for doctors must be told where they are');
  assert.match(row.blurb, /medecins-fr/);
  assert.match(row.blurb, /revient ici/);
  // …and the family itself no longer has a swatch of its own.
  assert.equal(after.legend.some((entry) => entry.label === 'Médecin généraliste'), false);
});

test('turning the Médecins row off gives every doctor straight back', () => {
  const stop = publishJoin('medecins/drawn', () => ({}));
  _amenitiesReconcileForTest(PAYLOAD);
  assert.equal(points.added.length, 2);
  stop();
  assert.equal(_amenitiesDeferredFamilyForTest(), null, 'the watcher fired on the take-down');
  _amenitiesReconcileForTest(PAYLOAD);
  assert.equal(points.added.length, 4);
});

test('the family array is untouched — no index moves, no pack is renamed', () => {
  // The whole reason this is a withdrawal and not a deletion. The mesh stores
  // a family by its INDEX in this array; the audit was right that removing an
  // element renames every cached row, and this change does not remove one.
  publishJoin('medecins/drawn', () => ({}));
  assert.deepEqual([...AMENITY_FAMILIES], [
    'restaurant', 'boulangerie', 'commerce', 'medecin', 'banque', 'sport', 'culture',
    'courses', 'pharmacie', 'poste', 'carburant', 'gendarmerie', 'piscine', 'hopital',
  ]);
  assert.equal(AMENITY_FAMILIES.indexOf('medecin'), 3);
});

// --- The push the board needed ---------------------------------------------

test('a watcher fires on presence transitions, never on a re-publish', () => {
  const seen = [];
  watchJoin('k', (present) => seen.push(present));
  const first = publishJoin('k', () => 1);
  publishJoin('k', () => 2); // same key, new owner — not a transition
  assert.deepEqual(seen, [true]);
  // The stale take-down of the FIRST provider must not announce an absence
  // the second provider contradicts.
  first();
  assert.deepEqual(seen, [true]);
  assert.equal(hasJoin('k'), true);
});

test('a broken watcher cannot break a layer toggle, and is warned once', () => {
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    watchJoin('k', () => { throw new Error('nope'); });
    let good = 0;
    watchJoin('k', () => { good += 1; });
    const stop = publishJoin('k', () => 1);
    stop();
    publishJoin('k', () => 1);
    assert.equal(good, 3);
    assert.equal(warnings.filter((line) => line.includes('watcher for k')).length, 1);
  } finally {
    console.warn = realWarn;
  }
});
