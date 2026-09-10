// One bus, one glyph, when two feeds publish the same run.
//
// The case these tests are written from was measured on 2026-09-10: `Semo Bus`
// and the `Atoumod` Normandy aggregate publish the same eight buses around
// Pont-de-l'Arche, with identical trip ids, identical coordinates and identical
// timestamps under two different id prefixes. What has to be pinned is not just
// that they collapse, but that the SURVIVOR is stable — a merge that hands the
// glyph a new id whenever the two publishers overtake each other trades a
// double glyph for a flickering one.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fleetMergeKey,
  mergeDuplicateRuns,
  MERGE_MIN_TRIP_ID_LENGTH,
} from './transitFleetMerge.js';

/** The real shape of the pair, straight off the two feeds. */
function pair({ trip = 'ATOUMOD006:ServiceJourney:3x4510409:LOC', ts = 1_789_000_000_000 } = {}) {
  return [
    { id: `pan-82296:4181`, feed: 'pan-82296', tripId: trip, lat: 49.3165, lon: 1.2181, timestampMs: ts, route: '5' },
    { id: `pan-83285:4181`, feed: 'pan-83285', tripId: trip, lat: 49.3165, lon: 1.2181, timestampMs: ts, route: '5' },
  ];
}

test('the same run published by two feeds is drawn once', () => {
  const { vehicles, merged, mergedByFeed } = mergeDuplicateRuns(pair());
  assert.equal(vehicles.length, 1);
  assert.equal(merged, 1);
  // The aggregate's id sorts first, so it is the one that survives.
  assert.equal(vehicles[0].id, 'pan-82296:4181');
  assert.equal(vehicles[0].feed, 'pan-82296');
  assert.equal(vehicles[0].mergedFeeds, 2);
  assert.deepEqual(mergedByFeed, { 'pan-83285': 1 });
});

test('the survivor is the same one whichever order the feeds answered in', () => {
  const forwards = mergeDuplicateRuns(pair()).vehicles[0];
  const backwards = mergeDuplicateRuns([...pair()].reverse()).vehicles[0];
  assert.equal(forwards.id, backwards.id);
  // And it does not change when the OTHER feed is the fresher one, which is
  // what would make a glyph flicker between two identities poll after poll.
  const [aggregate, local] = pair();
  const overtaken = mergeDuplicateRuns([aggregate, { ...local, timestampMs: aggregate.timestampMs + 30_000 }]);
  assert.equal(overtaken.vehicles[0].id, 'pan-82296:4181');
  assert.equal(overtaken.vehicles[0].feed, 'pan-82296');
});

test('the survivor keeps its identity but takes the freshest position', () => {
  const [aggregate, local] = pair();
  const { vehicles } = mergeDuplicateRuns([
    { ...aggregate, lat: 49.30, lon: 1.20, timestampMs: 1_789_000_000_000, bearing: 90 },
    { ...local, lat: 49.31, lon: 1.21, timestampMs: 1_789_000_060_000, bearing: 275, stopSequence: 14 },
  ]);
  assert.equal(vehicles.length, 1);
  assert.equal(vehicles[0].id, 'pan-82296:4181');
  assert.equal(vehicles[0].lat, 49.31);
  assert.equal(vehicles[0].lon, 1.21);
  assert.equal(vehicles[0].timestampMs, 1_789_000_060_000);
  assert.equal(vehicles[0].bearing, 275);
  assert.equal(vehicles[0].stopSequence, 14);
  // Where that position came from is on the record rather than implied.
  assert.equal(vehicles[0].positionFeed, 'pan-83285');
});

test('a field the fresher record does not publish is dropped, never inherited', () => {
  const [aggregate, local] = pair();
  const { vehicles } = mergeDuplicateRuns([
    { ...aggregate, bearing: 90, speedMps: 7.5, timestampMs: 1_789_000_000_000 },
    { ...local, timestampMs: 1_789_000_060_000 },
  ]);
  // The old record's heading belongs to the old position. Carrying it over
  // would draw a wedge that points where the bus was going a minute ago.
  assert.equal('bearing' in vehicles[0], false);
  assert.equal('speedMps' in vehicles[0], false);
  // A field that is not part of the position is the survivor's own.
  assert.equal(vehicles[0].route, '5');
});

test('a feed that repeats a run inside its own body is not two buses', () => {
  const [aggregate] = pair();
  const { vehicles, merged } = mergeDuplicateRuns([aggregate, { ...aggregate }]);
  assert.equal(vehicles.length, 1);
  assert.equal(merged, 1);
  // One feed, so nothing to advertise.
  assert.equal(vehicles[0].mergedFeeds, undefined);
});

test('two different runs are two buses, however close together they are', () => {
  const [a] = pair({ trip: 'ATOUMOD006:ServiceJourney:3x4510409:LOC' });
  const [b] = pair({ trip: 'ATOUMOD006:ServiceJourney:3x4510385:LOC' });
  const { vehicles, merged } = mergeDuplicateRuns([a, { ...b, id: 'pan-82296:4202' }]);
  assert.equal(vehicles.length, 2);
  assert.equal(merged, 0);
});

test('a vehicle with no usable run id is never merged into anything', () => {
  assert.equal(fleetMergeKey({ tripId: 'ATOUMOD006:ServiceJourney:3x4510409:LOC' }),
    'ATOUMOD006:ServiceJourney:3x4510409:LOC');
  assert.equal(fleetMergeKey({ tripId: '   ' }), null);
  assert.equal(fleetMergeKey({}), null);
  assert.equal(fleetMergeKey({ tripId: 'x'.repeat(MERGE_MIN_TRIP_ID_LENGTH - 1) }), null);
  assert.equal(fleetMergeKey({ tripId: 'x'.repeat(MERGE_MIN_TRIP_ID_LENGTH) }),
    'x'.repeat(MERGE_MIN_TRIP_ID_LENGTH));

  // Two networks that both publish short opaque ids stay two buses.
  const { vehicles, merged } = mergeDuplicateRuns([
    { id: 'pan-1:a', feed: 'pan-1', tripId: '12', lat: 1, lon: 1 },
    { id: 'pan-2:b', feed: 'pan-2', tripId: '12', lat: 40, lon: 3 },
  ]);
  assert.equal(vehicles.length, 2);
  assert.equal(merged, 0);
});

test('the order of the answer survives the merge', () => {
  const [aggregate, local] = pair();
  const before = { id: 'pan-82296:1', feed: 'pan-82296', tripId: 'ATOUMOD006:X:1', lat: 1, lon: 1 };
  const after = { id: 'pan-82296:2', feed: 'pan-82296', tripId: 'ATOUMOD006:X:2', lat: 2, lon: 2 };
  const { vehicles } = mergeDuplicateRuns([before, aggregate, after, local]);
  assert.deepEqual(vehicles.map((v) => v.id), ['pan-82296:1', 'pan-82296:4181', 'pan-82296:2']);
});

test('an empty or absent fleet merges to nothing', () => {
  assert.deepEqual(mergeDuplicateRuns([]), { vehicles: [], merged: 0, mergedByFeed: {} });
  assert.deepEqual(mergeDuplicateRuns(null), { vehicles: [], merged: 0, mergedByFeed: {} });
});
