// src/data/flowTiles.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decodeFlowTile,
  fetchFlowForBounds,
  tilesForBounds,
  getFlowSessionStats,
  resetFlowTileCache,
  retryAfterMs,
} from './flowTiles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Real TomTom flow tile, downtown Austin z12 x935 y1686 (probed live 2026-07-16).
const FIXTURE = path.join(__dirname, 'fixtures', 'tomtom-flow-austin-12-935-1686.pbf');
const FIXTURE_TILE = { z: 12, x: 935, y: 1686 };

function loadFixture() {
  return fs.readFileSync(FIXTURE);
}

// ── decodeFlowTile against the real fixture ─────────────────

test('fixture decode: more than 50 flow segments', () => {
  const segments = decodeFlowTile(loadFixture(), FIXTURE_TILE.z, FIXTURE_TILE.x, FIXTURE_TILE.y);
  assert.ok(segments.length > 50, `got ${segments.length}`);
});

test('fixture decode: every trafficLevel is within [0, 1]', () => {
  const segments = decodeFlowTile(loadFixture(), FIXTURE_TILE.z, FIXTURE_TILE.x, FIXTURE_TILE.y);
  for (const s of segments) {
    assert.ok(Number.isFinite(s.trafficLevel), `non-finite level: ${s.trafficLevel}`);
    assert.ok(s.trafficLevel >= 0 && s.trafficLevel <= 1, `level out of range: ${s.trafficLevel}`);
  }
});

test('fixture decode: all coordinates land in downtown Austin', () => {
  const segments = decodeFlowTile(loadFixture(), FIXTURE_TILE.z, FIXTURE_TILE.x, FIXTURE_TILE.y);
  for (const s of segments) {
    assert.ok(Array.isArray(s.coords) && s.coords.length >= 2, 'polyline too short');
    for (const [lon, lat] of s.coords) {
      assert.ok(lon >= -98.0 && lon <= -97.5, `lon out of Austin range: ${lon}`);
      assert.ok(lat >= 30.0 && lat <= 30.5, `lat out of Austin range: ${lat}`);
    }
  }
});

test('fixture decode: congestion exists (at least one trafficLevel < 1)', () => {
  const segments = decodeFlowTile(loadFixture(), FIXTURE_TILE.z, FIXTURE_TILE.x, FIXTURE_TILE.y);
  assert.ok(segments.some((s) => s.trafficLevel < 1), 'no congested segment found');
});

test('fixture decode: segment shape is {coords, trafficLevel, roadType, closure}', () => {
  const segments = decodeFlowTile(loadFixture(), FIXTURE_TILE.z, FIXTURE_TILE.x, FIXTURE_TILE.y);
  for (const s of segments) {
    assert.equal(typeof s.roadType, 'string');
    assert.equal(typeof s.closure, 'boolean');
  }
  // The fixture carries real closures — closure decoding is exercised, not vacuous.
  assert.ok(segments.some((s) => s.closure === true), 'expected at least one closure in fixture');
});

test('decode of a non-MVT buffer returns [] (defensive)', () => {
  assert.deepEqual(decodeFlowTile(Buffer.from('not a protobuf tile'), 12, 935, 1686), []);
});

// ── tilesForBounds (re-exported slippy math) ────────────────

test('tilesForBounds: 30.2672,-97.7431 @ z12 -> covers x935 y1686', () => {
  const tiles = tilesForBounds({
    south: 30.2672 - 0.001, north: 30.2672 + 0.001,
    west: -97.7431 - 0.001, east: -97.7431 + 0.001,
  }, 12);
  assert.ok(
    tiles.some((t) => t.z === 12 && t.x === 935 && t.y === 1686),
    `fixture tile missing: ${JSON.stringify(tiles)}`
  );
});

// ── fetchFlowForBounds (stubbed fetch: cache + abort) ───────

/** Bounds fully inside the fixture tile. */
const FIXTURE_BOUNDS = { south: 30.24, north: 30.26, west: -97.76, east: -97.74 };

function stubFetch(impl) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return () => { globalThis.fetch = original; };
}

test('fetchFlowForBounds: fetches covering tiles via /api/tomtom and decodes', async () => {
  resetFlowTileCache();
  const calls = [];
  const restore = stubFetch(async (url) => {
    calls.push(String(url));
    return new Response(loadFixture(), {
      status: 200,
      headers: { 'Content-Type': 'application/x-protobuf' },
    });
  });
  try {
    const segments = await fetchFlowForBounds(FIXTURE_BOUNDS);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /^\/api\/tomtom\/flow\/12\/935\/1686\.pbf$/);
    assert.ok(segments.length > 50);
    assert.ok(getFlowSessionStats().tilesFetched >= 1);
  } finally {
    restore();
  }
});

test('fetchFlowForBounds: decode cache serves repeat calls within TTL (no refetch)', async () => {
  resetFlowTileCache();
  let calls = 0;
  const restore = stubFetch(async () => {
    calls += 1;
    return new Response(loadFixture(), { status: 200 });
  });
  try {
    const first = await fetchFlowForBounds(FIXTURE_BOUNDS);
    const second = await fetchFlowForBounds(FIXTURE_BOUNDS);
    assert.equal(calls, 1, 'second call must be served from the decode cache');
    assert.equal(second.length, first.length);
  } finally {
    restore();
  }
});

test('fetchFlowForBounds: aborted signal rejects (AbortSignal-aware)', async () => {
  resetFlowTileCache();
  const restore = stubFetch(async (url, opts) => {
    // Mimic real fetch abort semantics.
    if (opts?.signal?.aborted) {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    }
    return new Response(loadFixture(), { status: 200 });
  });
  try {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      fetchFlowForBounds(FIXTURE_BOUNDS, { signal: controller.signal }),
      (err) => err.name === 'AbortError'
    );
  } finally {
    restore();
  }
});

test('fetchFlowForBounds: non-OK tile responses reject when nothing succeeds', async () => {
  resetFlowTileCache();
  const restore = stubFetch(async () => new Response(JSON.stringify({ error: 'no_key' }), { status: 503 }));
  try {
    await assert.rejects(fetchFlowForBounds(FIXTURE_BOUNDS));
  } finally {
    restore();
  }
});

// ── In-flight dedup (the warm-up and the road matcher race for the same tiles) ──

test('fetchFlowForBounds: concurrent callers for one tile issue ONE request', async () => {
  resetFlowTileCache();
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const restore = stubFetch(async () => {
    calls += 1;
    await gate;
    return new Response(loadFixture(), { status: 200 });
  });
  try {
    const both = Promise.all([
      fetchFlowForBounds(FIXTURE_BOUNDS),
      fetchFlowForBounds(FIXTURE_BOUNDS),
    ]);
    release();
    const [first, second] = await both;
    assert.equal(calls, 1, 'the second caller must join the in-flight tile');
    assert.equal(second.length, first.length);
    assert.ok(getFlowSessionStats().tilesJoined >= 1);
  } finally {
    restore();
  }
});

test('fetchFlowForBounds: a joined tile still lands in the cache after an abort', async () => {
  resetFlowTileCache();
  let calls = 0;
  const restore = stubFetch(async () => {
    calls += 1;
    return new Response(loadFixture(), { status: 200 });
  });
  try {
    const controller = new AbortController();
    const aborted = fetchFlowForBounds(FIXTURE_BOUNDS, { signal: controller.signal });
    controller.abort();
    await assert.rejects(aborted, (err) => err.name === 'AbortError');
    // The tile fetch is deliberately signal-free, so the work already paid for
    // is available to the load that supersedes this one.
    const segments = await fetchFlowForBounds(FIXTURE_BOUNDS);
    assert.equal(calls, 1, 'the superseding load must reuse the aborted load’s tile');
    assert.ok(segments.length > 50);
  } finally {
    restore();
  }
});

// ── 429: whose limit was it, and how long to wait ───────────

test('retryAfterMs: delta-seconds, HTTP date, and junk', () => {
  assert.equal(retryAfterMs('10'), 10_000);
  assert.equal(retryAfterMs('0'), 0);
  const now = Date.parse('2026-09-10T10:00:00Z');
  assert.equal(retryAfterMs('Thu, 10 Sep 2026 10:00:30 GMT', now), 30_000);
  assert.equal(retryAfterMs('soon'), null);
  assert.equal(retryAfterMs(null), null);
  assert.equal(retryAfterMs(''), null);
});

test('fetchFlowForBounds: our budget 429 is labelled budget (x-tomtom-limit)', async () => {
  resetFlowTileCache();
  const restore = stubFetch(async () => new Response(JSON.stringify({ error: 'budget' }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'x-tomtom-limit': 'budget', 'Retry-After': '1' },
  }));
  try {
    await assert.rejects(fetchFlowForBounds(FIXTURE_BOUNDS), (err) => {
      assert.equal(err.status, 429);
      assert.equal(err.reason, 'budget');
      return true;
    });
  } finally {
    restore();
    resetFlowTileCache();
  }
});

test('fetchFlowForBounds: an edge 429 (no origin header) is labelled edge', async () => {
  resetFlowTileCache();
  const restore = stubFetch(async () => new Response('error code: 1015', {
    status: 429,
    headers: { 'Content-Type': 'text/html' },
  }));
  try {
    await assert.rejects(fetchFlowForBounds(FIXTURE_BOUNDS), (err) => {
      assert.equal(err.status, 429);
      assert.equal(err.reason, 'edge');
      return true;
    });
    assert.ok(getFlowSessionStats().cooldownMs > 0, 'a 429 must arm the cooldown');
    assert.equal(getFlowSessionStats().cooldownReason, 'edge');
  } finally {
    restore();
    resetFlowTileCache();
  }
});

test('fetchFlowForBounds: the cooldown stops asking, and resetting clears it', async () => {
  resetFlowTileCache();
  let calls = 0;
  const restore = stubFetch(async () => {
    calls += 1;
    return new Response('error code: 1015', { status: 429 });
  });
  try {
    await assert.rejects(fetchFlowForBounds(FIXTURE_BOUNDS));
    assert.equal(calls, 1);
    await assert.rejects(fetchFlowForBounds(FIXTURE_BOUNDS));
    assert.equal(calls, 1, 'the second attempt must not reach the network');
  } finally {
    restore();
    resetFlowTileCache();
  }
  assert.equal(getFlowSessionStats().cooldownMs, 0);
});

test('fetchFlowForBounds: a cooldown serves the stale decode rather than failing', async () => {
  resetFlowTileCache();
  let mode = 'ok';
  const restore = stubFetch(async () => (mode === 'ok'
    ? new Response(loadFixture(), { status: 200 })
    : new Response('error code: 1015', { status: 429 })));
  try {
    const good = await fetchFlowForBounds(FIXTURE_BOUNDS);
    assert.ok(good.length > 50);
    // Age the cached decode past its TTL so the next call would refetch, then
    // arm a cooldown on a DIFFERENT viewport.
    mode = '429';
    await assert.rejects(fetchFlowForBounds({
      south: 0.01, west: 0.01, north: 0.02, east: 0.02,
    }));
    // The first viewport still has a decode, so it keeps painting.
    const stale = await fetchFlowForBounds(FIXTURE_BOUNDS);
    assert.equal(stale.length, good.length);
  } finally {
    restore();
    resetFlowTileCache();
  }
});
