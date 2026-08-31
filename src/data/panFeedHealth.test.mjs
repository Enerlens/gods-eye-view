// Two things the PAN catalog does not say and the index measures: which
// resources are one body published twice, and which have stopped answering.
// Both verdicts REMOVE a network from the map, so the tests that matter are
// the ones pinning when a verdict is refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyProbeHealth,
  duplicateFeedGroups,
  feedIsSelectable,
  fleetFingerprint,
  fleetRoster,
  localVehicleId,
  partitionFeedsByHealth,
  sameFleet,
  PAN_QUARANTINE_AFTER_FAILURES,
} from './panFeedHealth.js';

/** Vehicles shaped as `vehiclePositionsFromBytes` returns them. */
function fleet(feedId, entries) {
  return entries.map(([local, lat, lon]) => ({ id: `${feedId}:${local}`, lat, lon }));
}

test('the feed-id prefix is stripped so two mirrors can be compared at all', () => {
  assert.equal(localVehicleId('pan-82095:VM:1234', 'pan-82095'), 'VM:1234');
  // A record decoded without a feed id keeps its bare local id.
  assert.equal(localVehicleId('VM:1234', ''), 'VM:1234');
  // A prefix that is not this feed's own is left alone rather than half-eaten.
  assert.equal(localVehicleId('pan-84047:VM:1234', 'pan-82095'), 'pan-84047:VM:1234');
});

test('a fingerprint is order-independent but position-sensitive', () => {
  const a = fleetFingerprint(fleet('a', [['1', 47.65, -2.76], ['2', 47.66, -2.75]]), 'a');
  const b = fleetFingerprint(fleet('b', [['2', 47.66, -2.75], ['1', 47.65, -2.76]]), 'b');
  assert.ok(sameFleet(a, b), 'the same vehicles in a different entity order are the same fleet');
  assert.equal(a.size, 2);

  const moved = fleetFingerprint(fleet('b', [['1', 47.65, -2.76], ['2', 47.66, -2.7501]]), 'b');
  assert.equal(sameFleet(a, moved), false, 'one vehicle a metre away is a different fleet');
});

test('the roster survives the fleet moving, which is the whole point of it', () => {
  // The confirmation pass runs minutes after the candidate pass. Kicéo's real
  // twin was rejected by the first build because 62 buses had driven on in
  // between; the roster is what makes the second question answerable.
  const before = fleet('a', [['1', 47.65, -2.76], ['2', 47.66, -2.75]]);
  const after = fleet('b', [['2', 47.70, -2.70], ['1', 47.69, -2.71]]);
  assert.equal(sameFleet(fleetFingerprint(before, 'a'), fleetFingerprint(after, 'b')), false);
  assert.ok(sameFleet(fleetRoster(before, 'a'), fleetRoster(after, 'b')));

  // A roster is still a set of ids: a feed that lost a vehicle is not a match.
  const shrunk = fleet('b', [['1', 47.69, -2.71]]);
  assert.equal(sameFleet(fleetRoster(before, 'a'), fleetRoster(shrunk, 'b')), false);
  assert.equal(fleetRoster([], 'a'), null);
});

test('an empty or unusable fleet is never a fingerprint', () => {
  assert.equal(fleetFingerprint([], 'a'), null);
  assert.equal(fleetFingerprint(null, 'a'), null);
  // Junk coordinates and ids are dropped before the digest, and a fleet made
  // only of junk produces no fingerprint at all.
  assert.equal(fleetFingerprint([{ id: 'a:', lat: 1, lon: 2 }], 'a'), null);
  assert.equal(fleetFingerprint([{ id: 'a:1', lat: NaN, lon: 2 }], 'a'), null);
  assert.equal(sameFleet(null, null), false, 'two silences are not an agreement');
});

test('duplicate groups keep the lowest resource id and name the rest', () => {
  const print = fleetFingerprint(fleet('x', [['1', 47.65, -2.76]]), 'x');
  const groups = duplicateFeedGroups([
    { id: 'pan-84047', resourceId: 84047, fingerprint: print },
    { id: 'pan-82095', resourceId: 82095, fingerprint: print },
    { id: 'pan-83000', resourceId: 83000, fingerprint: fleetFingerprint(fleet('y', [['9', 1, 2]]), 'y') },
  ]);
  assert.equal(groups.length, 1, 'a fingerprint seen once is not a group');
  assert.equal(groups[0].keeper, 'pan-82095');
  assert.deepEqual(groups[0].duplicates, ['pan-84047']);
});

test('feeds that reported nothing are never grouped as duplicates of each other', () => {
  // Two networks that were both asleep at probe time look identical and are
  // not: an off-peak school service and a seasonal shuttle both report zero.
  const groups = duplicateFeedGroups([
    { id: 'pan-1', resourceId: 1, fingerprint: null },
    { id: 'pan-2', resourceId: 2, fingerprint: null },
  ]);
  assert.deepEqual(groups, []);
});

test('a failure run quarantines, and any success clears it outright', () => {
  const first = applyProbeHealth(null, { ok: false, error: 'HTTP 403' }, '2026-08-31T00:00:00Z');
  assert.equal(first.consecutiveFailures, 1);
  assert.equal(first.quarantined, false, 'one bad probe is a bad afternoon');

  const second = applyProbeHealth(first, { ok: false, error: 'HTTP 403' }, '2026-09-01T00:00:00Z');
  assert.equal(second.consecutiveFailures, PAN_QUARANTINE_AFTER_FAILURES);
  assert.equal(second.quarantined, true);
  assert.equal(second.quarantinedSince, '2026-09-01T00:00:00Z');

  const third = applyProbeHealth(second, { ok: false, error: 'HTTP 500' }, '2026-09-02T00:00:00Z');
  assert.equal(third.quarantinedSince, '2026-09-01T00:00:00Z', 'the since-date is the first one, not the latest');
  assert.equal(third.lastError, 'HTTP 500');

  const revived = applyProbeHealth(third, { ok: true }, '2026-09-03T00:00:00Z');
  assert.deepEqual(revived, {
    consecutiveFailures: 0,
    quarantined: false,
    quarantinedSince: null,
    lastError: null,
    lastOkAt: '2026-09-03T00:00:00Z',
  });
});

test('selection skips duplicates and quarantined feeds, and nothing else', () => {
  assert.equal(feedIsSelectable({ url: 'https://example.test/a' }), true);
  assert.equal(feedIsSelectable({ url: 'https://example.test/a', duplicateOf: 'pan-1' }), false);
  assert.equal(feedIsSelectable({ url: 'https://example.test/a', health: { quarantined: true } }), false);
  // A feed that has failed once but is not quarantined is still offered: the
  // proxy's own backoff and serve-stale are the right tool at that scale.
  assert.equal(
    feedIsSelectable({ url: 'https://example.test/a', health: { consecutiveFailures: 1, quarantined: false } }),
    true,
  );
  assert.equal(feedIsSelectable({}), false, 'a feed with no url can never be fetched');
});

test('the partition reports why shipped and queryable differ', () => {
  const summary = partitionFeedsByHealth([
    { id: 'a', url: 'u' },
    { id: 'b', url: 'u', duplicateOf: 'a' },
    { id: 'c', url: 'u', health: { quarantined: true } },
    { id: 'd', url: 'u' },
    { id: 'e' },
  ]);
  assert.deepEqual(summary.selectable.map((feed) => feed.id), ['a', 'd']);
  assert.equal(summary.duplicates, 1);
  assert.equal(summary.quarantined, 1);
});
