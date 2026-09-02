// Overpass proxy Tier A hardening (voice-engine evaluation doc §4.1, field test
// 2026-07-23): region/state boundary pivots return multi-MB coastline geometry that
// blew the old 12 MB read cap and 16 s client budget (Sicily never traced). The proxy
// now simplifies giant `out geom` payloads server-side before caching/serving, and
// boundary-class queries (is_in / pivot) get a longer disk TTL — boundaries change
// ≈never. Pure-function tests, no network.
//
// Run with: npm test   (node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  simplifyOverpassPayloadBody,
  isOverpassBoundaryQuery,
  resolveOverpassPreflight,
  overpassAttemptDisposition,
  fetchOverpassPayload,
  OVERPASS_SLOT_LIMIT,
} from '../../vite.config.js';

test('preflight checks memory, in-flight, then disk before consuming limiter quota', async () => {
  const key = 'normalized query';
  const fresh = { id: 'memory', cachedAt: 900 };
  const joined = { id: 'inflight', cachedAt: 950 };
  const disk = { id: 'disk', cachedAt: 975 };
  let diskReads = 0;
  let limiterCalls = 0;
  const allowUpstream = () => { limiterCalls += 1; return true; };

  const memoryHit = await resolveOverpassPreflight({
    cacheKey: key,
    memoryCache: new Map([[key, fresh]]),
    inFlight: new Map([[key, Promise.resolve(joined)]]),
    readDisk: async () => { diskReads += 1; return disk; },
    allowUpstream,
    now: 1000,
    cacheMs: 200,
  });
  assert.equal(memoryHit.source, 'HIT');
  assert.equal(memoryHit.payload, fresh);
  assert.equal(diskReads, 0, 'memory hit must short-circuit before disk');
  assert.equal(limiterCalls, 0, 'memory hit must not consume limiter quota');

  const inFlightHit = await resolveOverpassPreflight({
    cacheKey: key,
    memoryCache: new Map([[key, { id: 'stale', cachedAt: 0 }]]),
    inFlight: new Map([[key, Promise.resolve(joined)]]),
    readDisk: async () => { diskReads += 1; return disk; },
    allowUpstream,
    now: 1000,
    cacheMs: 200,
  });
  assert.equal(inFlightHit.source, 'INFLIGHT');
  assert.equal(inFlightHit.payload, joined);
  assert.equal(diskReads, 0, 'in-flight join must short-circuit before disk');
  assert.equal(limiterCalls, 0, 'in-flight join must not consume limiter quota');

  const diskHit = await resolveOverpassPreflight({
    cacheKey: key,
    memoryCache: new Map(),
    inFlight: new Map(),
    readDisk: async () => { diskReads += 1; return disk; },
    allowUpstream,
  });
  assert.equal(diskHit.source, 'DISK');
  assert.equal(diskHit.payload, disk);
  assert.equal(diskReads, 1);
  assert.equal(limiterCalls, 0, 'disk hit must not consume limiter quota');

  const upstreamMiss = await resolveOverpassPreflight({
    cacheKey: key,
    memoryCache: new Map(),
    inFlight: new Map(),
    readDisk: async () => { diskReads += 1; return null; },
    allowUpstream,
  });
  assert.equal(upstreamMiss.source, 'UPSTREAM');
  assert.equal(diskReads, 2, 'disk must be checked before upstream admission');
  assert.equal(limiterCalls, 1, 'only a complete cache miss consumes quota');

  const denied = await resolveOverpassPreflight({
    cacheKey: key,
    memoryCache: new Map(),
    inFlight: new Map(),
    readDisk: async () => null,
    allowUpstream: () => false,
  });
  assert.equal(denied.source, 'RATE_LIMITED');
});

/** Synthetic dense ring: N points on a circle with sub-tolerance jitter. */
function denseRing(n, { latC = 37.5, lonC = 14.2, radiusDeg = 0.5 } = {}) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    // Jitter far below the simplification tolerance so the ring is genuinely
    // redundant — a correct simplifier should collapse most of it.
    const jitter = (i % 7) * 0.000004;
    pts.push({
      lat: latC + Math.sin(a) * (radiusDeg + jitter),
      lon: lonC + Math.cos(a) * (radiusDeg + jitter),
    });
  }
  pts.push({ ...pts[0] }); // closed ring
  return pts;
}

const TEST_OPTS = { minBytes: 0, minPoints: 200, toleranceDeg: 0.0004 };

test('simplify: giant way geometry is decimated, endpoints preserved', () => {
  const ring = denseRing(4000);
  const body = JSON.stringify({ elements: [{ type: 'way', id: 1, geometry: ring }] });
  const out = JSON.parse(simplifyOverpassPayloadBody(body, TEST_OPTS));
  const g = out.elements[0].geometry;
  assert.ok(g.length < ring.length * 0.5, `should shed most redundant points, got ${g.length}/${ring.length}`);
  assert.ok(g.length >= 16, `must keep enough points to stay a ring, got ${g.length}`);
  assert.deepEqual(g[0], ring[0]);
  assert.deepEqual(g[g.length - 1], ring[ring.length - 1]);
});

test('simplify: relation member geometries are decimated too', () => {
  const ring = denseRing(3000);
  const body = JSON.stringify({
    elements: [{
      type: 'relation',
      id: 2,
      members: [
        { type: 'way', role: 'outer', geometry: ring },
        { type: 'node', role: 'admin_centre' }, // no geometry — must survive untouched
      ],
    }],
  });
  const out = JSON.parse(simplifyOverpassPayloadBody(body, TEST_OPTS));
  assert.ok(out.elements[0].members[0].geometry.length < ring.length * 0.5);
  assert.equal(out.elements[0].members[1].geometry, undefined);
});

test('simplify: small geometries (building footprints) pass through untouched', () => {
  const square = [
    { lat: 30.27, lon: -97.74 }, { lat: 30.271, lon: -97.74 },
    { lat: 30.271, lon: -97.741 }, { lat: 30.27, lon: -97.741 },
    { lat: 30.27, lon: -97.74 },
  ];
  const body = JSON.stringify({ elements: [{ type: 'way', id: 3, geometry: square }] });
  const out = JSON.parse(simplifyOverpassPayloadBody(body, TEST_OPTS));
  assert.deepEqual(out.elements[0].geometry, square);
});

test('simplify: geometry stays within tolerance of the original shape', () => {
  const ring = denseRing(4000);
  const body = JSON.stringify({ elements: [{ type: 'way', id: 4, geometry: ring }] });
  const out = JSON.parse(simplifyOverpassPayloadBody(body, TEST_OPTS));
  const g = out.elements[0].geometry;
  // Every original vertex must lie near SOME kept vertex — a circle of kept
  // points at spacing s has every dropped point within ~s/2 along the arc, and
  // DP guarantees perpendicular deviation ≤ tolerance. Loose sanity bound: no
  // original point farther than 8× tolerance from the nearest kept point pair
  // is possible for a smooth ring; check a sampled subset for speed.
  for (let i = 0; i < ring.length; i += 97) {
    const p = ring[i];
    let best = Infinity;
    for (let j = 1; j < g.length; j++) {
      const d = pointSegDistDeg(p, g[j - 1], g[j]);
      if (d < best) best = d;
    }
    assert.ok(best <= TEST_OPTS.toleranceDeg * 1.01, `vertex ${i} deviates ${best} deg`);
  }
});

test('simplify: sub-threshold bodies and non-JSON pass through byte-identical', () => {
  const tiny = JSON.stringify({ elements: [{ type: 'way', geometry: denseRing(3000) }] });
  assert.equal(simplifyOverpassPayloadBody(tiny, { ...TEST_OPTS, minBytes: tiny.length + 1 }), tiny);
  const junk = 'this is not json {';
  assert.equal(simplifyOverpassPayloadBody(junk, TEST_OPTS), junk);
});

test('boundary-class queries detected for the long disk TTL', () => {
  assert.equal(isOverpassBoundaryQuery(
    '[out:json][timeout:25];is_in(37.5,14.2)->.a;area.a["boundary"="administrative"]["admin_level"];out tags;',
  ), true);
  assert.equal(isOverpassBoundaryQuery(
    '[out:json][timeout:25];area(3600039152)->.x;rel(pivot.x);out geom;',
  ), true);
  // The enclosing-compound sweep and road fetches keep the default TTL.
  assert.equal(isOverpassBoundaryQuery(
    '[out:json][timeout:25];( way(around:1200,30.27,-97.74)["leisure"]["name"]; );out geom;',
  ), false);
  assert.equal(isOverpassBoundaryQuery(
    '[out:json][timeout:12];way["highway"~"motorway|trunk"](30.1,-97.9,30.5,-97.5);out geom;',
  ), false);
});

/** Perpendicular distance (deg, planar approx) from p to segment a-b. */
function pointSegDistDeg(p, a, b) {
  const vx = b.lon - a.lon;
  const vy = b.lat - a.lat;
  const wx = p.lon - a.lon;
  const wy = p.lat - a.lat;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return Math.hypot(wx, wy);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return Math.hypot(p.lon - b.lon, p.lat - b.lat);
  const t = c1 / c2;
  return Math.hypot(wx - t * vx, wy - t * vy);
}

// ---------------------------------------------------------------------------
// Mirror rotation (field test 2026-09-01: "Sites militaires — Error loading")
//
// overpass-api.de's front-end answered 406 Not Acceptable to the proxy's old
// agent string on most requests. The rotation accepted 4xx as a final answer,
// so mirrors 2-4 were never tried and the mapped-installations layer — which
// reads `status >= 400` as a failure — went dark while three mirrors were fine.
// ---------------------------------------------------------------------------

/** One Overpass mirror answer, shaped for the injected fetch below. */
function mirrorResponse(status, body = '{"elements":[]}') {
  return new Response(body, { status, headers: { 'content-type': 'application/json' } });
}

const FOUR_MIRRORS = ['https://a.test/i', 'https://b.test/i', 'https://c.test/i', 'https://d.test/i'];

test('disposition: a 4xx refusal is a mirror verdict, not a query verdict', () => {
  const at = (status, extra = {}) => overpassAttemptDisposition({
    status, rateLimited: false, runtimeError: false, ...extra,
  });
  assert.equal(at(200), 'accept');
  assert.equal(at(406), 'client-error', '406 must rotate, not terminate');
  assert.equal(at(403), 'client-error');
  assert.equal(at(400), 'client-error');
  assert.equal(at(502), 'server-error');
  assert.equal(at(200, { runtimeError: true }), 'runtime-error');
  assert.equal(at(429, { rateLimited: true }), 'rate-limited');
  // Rate limiting outranks the status code: a mirror can rate-limit inside a 200.
  assert.equal(at(200, { rateLimited: true }), 'rate-limited');
});

test('a 406 from the first mirror falls through to a healthy one', async () => {
  const tried = [];
  const payload = await fetchOverpassPayload('data=[out:json];out;', 1024, {
    endpoints: FOUR_MIRRORS,
    outage: { until: 0 },
    fetchImpl: async (endpoint) => {
      tried.push(endpoint);
      return endpoint === FOUR_MIRRORS[0]
        ? mirrorResponse(406, '<html><title>406 Not Acceptable</title></html>')
        : mirrorResponse(200, '{"elements":[{"type":"node","id":1}]}');
    },
  });
  assert.deepEqual(tried, FOUR_MIRRORS.slice(0, 2), 'must try mirror 2 after the 406');
  assert.equal(payload.status, 200);
  assert.equal(payload.endpoint, FOUR_MIRRORS[1]);
  assert.match(payload.body, /"id":1/);
});

test('every mirror refusing surfaces the 4xx, so a malformed query is still reported', async () => {
  const tried = [];
  const payload = await fetchOverpassPayload('data=nonsense', 1024, {
    endpoints: FOUR_MIRRORS,
    outage: { until: 0 },
    fetchImpl: async (endpoint) => {
      tried.push(endpoint);
      return mirrorResponse(400, 'line 1: parse error');
    },
  });
  assert.equal(tried.length, 4, 'all mirrors get a turn before giving up');
  assert.equal(payload.status, 400);
  assert.equal(payload.body, 'line 1: parse error');
});

test('a rate-limited mirror outranks a refusing one when all fail', async () => {
  const payload = await fetchOverpassPayload('data=[out:json];out;', 1024, {
    endpoints: FOUR_MIRRORS,
    outage: { until: 0 },
    sleep: async () => {},
    fetchImpl: async (endpoint) => (endpoint === FOUR_MIRRORS[3]
      ? mirrorResponse(429, 'rate_limited')
      : mirrorResponse(406, '<html>406 Not Acceptable</html>')),
  });
  assert.equal(payload.status, 429, 'the actionable answer wins over the opaque refusal');
  assert.equal(payload.rateLimited, true);
});

test('a mirror that throws does not end the rotation', async () => {
  const payload = await fetchOverpassPayload('data=[out:json];out;', 1024, {
    endpoints: FOUR_MIRRORS,
    outage: { until: 0 },
    fetchImpl: async (endpoint) => {
      if (endpoint !== FOUR_MIRRORS[2]) throw new Error('ECONNREFUSED');
      return mirrorResponse(200, '{"elements":[]}');
    },
  });
  assert.equal(payload.endpoint, FOUR_MIRRORS[2]);
});

test('all mirrors unreachable still throws rather than inventing an answer', async () => {
  await assert.rejects(
    fetchOverpassPayload('data=[out:json];out;', 1024, {
      endpoints: FOUR_MIRRORS,
      outage: { until: 0 },
      fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
    }),
    /ECONNREFUSED/,
  );
});

// A 429 is a verdict on the IP, not on the mirror: every mirror in the rotation
// resolves to one per-IP slot budget (overpass-api.de and lz4 even announce the
// same backend), so walking to the next one answers the same 429. Waiting is
// the only move that works, and not making it was what turned a busy upstream
// into "Mapped installation context is temporarily unavailable".
test('a rate limit is waited out, not rotated away', async () => {
  const rounds = [];
  const waits = [];
  let round = 0;
  const payload = await fetchOverpassPayload('data=[out:json];out;', 1024, {
    endpoints: FOUR_MIRRORS,
    outage: { until: 0 },
    sleep: async (ms) => { waits.push(ms); round += 1; },
    fetchImpl: async (endpoint) => {
      rounds.push(`${round}:${endpoint}`);
      // Busy for the whole first pass, answering once the wait has happened.
      return round === 0
        ? mirrorResponse(429, 'rate_limited')
        : mirrorResponse(200, '{"elements":[{"type":"node","id":7}]}');
    },
  });
  assert.equal(waits.length, 1, 'one wait was enough; no further rotation');
  assert.ok(waits[0] > 0, 'the retry actually waits rather than spinning');
  assert.equal(rounds.filter((r) => r.startsWith('0:')).length, 4, 'first pass tries every mirror');
  assert.equal(payload.status, 200);
  assert.match(payload.body, /"id":7/);
});

test('a rotation with no rate limit is never re-run', async () => {
  let waited = 0;
  let attempts = 0;
  await assert.rejects(
    fetchOverpassPayload('data=[out:json];out;', 1024, {
      endpoints: FOUR_MIRRORS,
      outage: { until: 0 },
      sleep: async () => { waited += 1; },
      fetchImpl: async () => { attempts += 1; throw new Error('ECONNREFUSED'); },
    }),
    /ECONNREFUSED/,
  );
  assert.equal(waited, 0, 'unreachable mirrors are not a rate limit — no backoff');
  assert.equal(attempts, 4, 'exactly one pass over the rotation');
});

test('a rate limit that never clears still gives back the actionable 429', async () => {
  const waits = [];
  const payload = await fetchOverpassPayload('data=[out:json];out;', 1024, {
    endpoints: FOUR_MIRRORS,
    outage: { until: 0 },
    sleep: async (ms) => { waits.push(ms); },
    fetchImpl: async () => mirrorResponse(429, 'rate_limited'),
  });
  assert.ok(waits.length >= 1, 'it retried before giving up');
  assert.ok(
    waits.every((ms, i) => i === 0 || ms >= waits[i - 1]),
    'each wait is at least as long as the one before it',
  );
  assert.equal(payload.status, 429, 'the caller still learns it was rate-limited');
  assert.equal(payload.rateLimited, true);
});

// The queue is what stops the 429 being manufactured in the first place: panning
// the globe with the installations layer on fired a burst straight past the
// mirrors' 2-slot budget, because that proxy called through with no gate at all.
test('concurrent requests never exceed the mirrors\' slot budget', async () => {
  let live = 0;
  let peak = 0;
  const oneRequest = () => fetchOverpassPayload('data=[out:json];out;', 1024, {
    endpoints: FOUR_MIRRORS,
    outage: { until: 0 },
    fetchImpl: async () => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((resolve) => { setTimeout(resolve, 5); });
      live -= 1;
      return mirrorResponse(200, '{"elements":[]}');
    },
  });
  const answers = await Promise.all(Array.from({ length: 6 }, oneRequest));
  assert.equal(peak, OVERPASS_SLOT_LIMIT, 'the gate holds the burst at the budget');
  assert.equal(answers.length, 6, 'and every queued request is still served');
  assert.ok(answers.every((a) => a.status === 200));
});

// A slot leaked on the failure path starves every later request — the layer would
// go quiet minutes after one bad rotation rather than at the moment of failure.
test('a failed rotation releases its slot', async () => {
  await assert.rejects(
    fetchOverpassPayload('data=[out:json];out;', 1024, {
      endpoints: FOUR_MIRRORS,
      outage: { until: 0 },
      fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
    }),
    /ECONNREFUSED/,
  );
  let live = 0;
  let peak = 0;
  const answers = await Promise.all(Array.from({ length: 4 }, () => fetchOverpassPayload(
    'data=[out:json];out;',
    1024,
    {
      endpoints: FOUR_MIRRORS,
      outage: { until: 0 },
      fetchImpl: async () => {
        live += 1;
        peak = Math.max(peak, live);
        await new Promise((resolve) => { setTimeout(resolve, 5); });
        live -= 1;
        return mirrorResponse(200, '{"elements":[]}');
      },
    },
  )));
  assert.equal(peak, OVERPASS_SLOT_LIMIT, 'the budget survived the failure intact');
  assert.ok(answers.every((a) => a.status === 200));
});

// The cooldown exists because overpass-api.de answers a noisy IP with silence,
// not a 429: every mirror times out, and each fresh rotation spends ~45 s
// relearning that while keeping the offending traffic flowing.
test('a total outage parks the rotation instead of re-timing-out', async () => {
  const outage = { until: 0 };
  let clock = 1_000;
  const call = (fetchImpl) => fetchOverpassPayload('data=[out:json];out;', 1024, {
    endpoints: FOUR_MIRRORS,
    outage,
    now: () => clock,
    outageCooldownMs: 60_000,
    fetchImpl,
  });

  let attempts = 0;
  await assert.rejects(call(async () => { attempts += 1; throw new Error('ETIMEDOUT'); }), /ETIMEDOUT/);
  assert.equal(attempts, 4, 'the first caller pays for the full rotation');

  // Second caller, one second later: no mirror is touched at all.
  clock += 1_000;
  let touched = 0;
  await assert.rejects(
    call(async () => { touched += 1; return mirrorResponse(200); }),
    /cooldown for another 59s/,
  );
  assert.equal(touched, 0, 'the parked rotation contacts nobody');

  // Once it lapses, a healthy mirror is reached again and clears the park.
  clock += 60_000;
  const payload = await call(async () => mirrorResponse(200, '{"elements":[{"type":"node","id":3}]}'));
  assert.equal(payload.status, 200);
  assert.equal(outage.until, 0, 'success un-parks the rotation');
});

test('a rate limit is not treated as an outage', async () => {
  const outage = { until: 0 };
  const payload = await fetchOverpassPayload('data=[out:json];out;', 1024, {
    endpoints: FOUR_MIRRORS,
    outage,
    sleep: async () => {},
    fetchImpl: async () => mirrorResponse(429, 'rate_limited'),
  });
  assert.equal(payload.status, 429);
  assert.equal(outage.until, 0, 'a recoverable wait must not blind the layer for a minute');
});

// A heavy query times out INSIDE a healthy mirror, which answers 200 with a
// `remark`. Parking the whole Overpass path on that would let one over-broad
// boundary pivot blind every other layer for a minute.
test('a query too heavy for the mirrors does not park them', async () => {
  const outage = { until: 0 };
  await assert.rejects(
    fetchOverpassPayload('data=[out:json];out;', 1024, {
      endpoints: FOUR_MIRRORS,
      outage,
      now: () => 1_000,
      fetchImpl: async () => mirrorResponse(
        200,
        '{"version":0.6,"remark":"runtime error: Query timed out in \"query\" at line 1"}',
      ),
    }),
    /runtime error/,
  );
  assert.equal(outage.until, 0, 'the mirrors answered — they are not down');
});
