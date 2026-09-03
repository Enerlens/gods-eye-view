import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OPENSKY_BASE_CACHE_MS,
  OPENSKY_MAX_TTL_MS,
  OPENSKY_STALE_MARGIN_MS,
  openSkyAdaptiveTtlMs,
  openSkySnapshotIsStale,
  openSkyStaleThresholdMs,
} from './openSkyFreshness.js';

test('the credit governor stretches the TTL as the daily budget thins', () => {
  assert.equal(openSkyAdaptiveTtlMs(4000), OPENSKY_BASE_CACHE_MS);
  assert.equal(openSkyAdaptiveTtlMs(2401), OPENSKY_BASE_CACHE_MS);
  assert.equal(openSkyAdaptiveTtlMs(2400), 30_000);
  assert.equal(openSkyAdaptiveTtlMs(1200), 90_000);
  assert.equal(openSkyAdaptiveTtlMs(400), OPENSKY_MAX_TTL_MS);
  assert.equal(openSkyAdaptiveTtlMs(0), OPENSKY_MAX_TTL_MS);
  // An absent header must not be read as an exhausted budget.
  assert.equal(openSkyAdaptiveTtlMs(Number.NaN), OPENSKY_BASE_CACHE_MS);
});

test('the staleness threshold moves WITH the TTL, which is the whole point', () => {
  // At the base TTL the behaviour is what the two hard-coded 120 s constants
  // gave: ~129 s, indistinguishable in the field.
  assert.equal(openSkyStaleThresholdMs(OPENSKY_BASE_CACHE_MS), 129_000);
  // At the governor's longest tier the threshold moves with it. The old fixed
  // 120 s was BELOW the 300 s cache: every body served from it was stale by
  // construction, which is what pinned the layer in FALLBACK.
  assert.equal(openSkyStaleThresholdMs(OPENSKY_MAX_TTL_MS), 420_000);
  assert.ok(openSkyStaleThresholdMs(OPENSKY_MAX_TTL_MS) > OPENSKY_MAX_TTL_MS);
  // Unknown TTL falls back to the base, never to "no threshold".
  assert.equal(openSkyStaleThresholdMs(null), 129_000);
  assert.equal(openSkyStaleThresholdMs(Number.NaN), 129_000);
  assert.equal(openSkyStaleThresholdMs(-5), 129_000);
});

test('the threshold is bounded, so this is never a licence to serve ancient positions', () => {
  // A TTL past the governor's own ceiling is clamped: a mis-set or malicious
  // header cannot buy unlimited tolerance.
  assert.equal(openSkyStaleThresholdMs(86_400_000), OPENSKY_MAX_TTL_MS + OPENSKY_STALE_MARGIN_MS);
});

test('a 5-minute-old snapshot is stale at the base TTL and fresh at the stretched one', () => {
  const nowMs = 1_700_000_000_000;
  const fiveMinutesOld = nowMs - 300_000;
  assert.equal(
    openSkySnapshotIsStale(fiveMinutesOld, { nowMs, ttlMs: OPENSKY_BASE_CACHE_MS }),
    true,
    'nine-second cache, five-minute body: something is wrong',
  );
  assert.equal(
    openSkySnapshotIsStale(fiveMinutesOld, { nowMs, ttlMs: OPENSKY_MAX_TTL_MS }),
    false,
    'a 300 s cache serving a 300 s body is doing exactly what it was told',
  );
  // Past the tolerance it is stale again even on the longest TTL.
  assert.equal(
    openSkySnapshotIsStale(nowMs - 500_000, { nowMs, ttlMs: OPENSKY_MAX_TTL_MS }),
    true,
  );
});

test('an unknown snapshot time is not evidence of staleness', () => {
  const nowMs = 1_700_000_000_000;
  assert.equal(openSkySnapshotIsStale(null, { nowMs }), false);
  assert.equal(openSkySnapshotIsStale(undefined, { nowMs }), false);
  assert.equal(openSkySnapshotIsStale(Number.NaN, { nowMs }), false);
});
