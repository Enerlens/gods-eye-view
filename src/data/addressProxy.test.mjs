// src/data/addressProxy.test.mjs
// Guards the two request-parsing helpers shared by the six address-scan
// proxies in `vite.config.js`. Both bugs pinned here were found by calling the
// running dev server, not by reading the code — and neither one throws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressCacheKey, addressPoint, gpuRequestBox } from '../../vite.config.js';
import {
  GPU_BOX_STEP_DEG,
  GPU_MAX_BOX_DEG,
  GPU_REQUEST_MAX_BOX_DEG,
} from './gpuFeed.js';
import { snapBoxOutward } from './viewportBox.js';

const params = (query) => new URL(`http://localhost/?${query}`).searchParams;

test('a request with no coordinates is refused, not silently scanned at 0,0', () => {
  // FOUND LIVE. `searchParams.get('lon')` is `null` when the parameter is
  // absent, `Number(null)` is `0`, and `Number.isFinite(0)` is true — so
  // `GET /api/gpu` with no query string returned HTTP 200 and an empty result
  // for a point in the Gulf of Guinea. To a reader that is indistinguishable
  // from "there is nothing at your address".
  assert.equal(addressPoint(params('')), null);
  assert.equal(addressPoint(params('lat=48.83')), null);
  assert.equal(addressPoint(params('lon=2.376')), null);
});

test('an empty or blank coordinate is refused for the same reason', () => {
  assert.equal(addressPoint(params('lat=48.83&lon=')), null);
  assert.equal(addressPoint(params('lat=&lon=2.376')), null);
  assert.equal(addressPoint(params('lat=48.83&lon=%20')), null);
});

test('a non-numeric or out-of-domain coordinate is refused', () => {
  assert.equal(addressPoint(params('lat=48.83&lon=paris')), null);
  assert.equal(addressPoint(params('lat=91&lon=2.376')), null);
  assert.equal(addressPoint(params('lat=48.83&lon=181')), null);
});

test('a real coordinate parses, including a legitimate zero', () => {
  assert.deepEqual(addressPoint(params('lat=48.83&lon=2.376')), { lon: 2.376, lat: 48.83 });
  // 0 is a valid longitude — Greenwich — so the guard must be presence-based
  // rather than truthiness-based.
  assert.deepEqual(addressPoint(params('lat=51.48&lon=0')), { lon: 0, lat: 51.48 });
});

test('two clicks on the same doorway share one cache entry', () => {
  // Rounded to four decimals, ~11 m. Without this the cache never hits for the
  // one workload it exists for: a user nudging the same address twice.
  const a = addressCacheKey('dvf', { lon: 2.3760123, lat: 48.8300456 }, 300);
  const b = addressCacheKey('dvf', { lon: 2.3760456, lat: 48.8300111 }, 300);
  assert.equal(a, b);
  assert.equal(a, 'dvf|2.3760,48.8300|300');
});

test('the rounding is a grid, not a radius, and does not pretend otherwise', () => {
  // Two points 7 m apart fall either side of a cell boundary and get separate
  // entries. That is a cache miss, not a wrong answer — worth stating so the
  // four decimals are never mistaken for a proximity match.
  assert.notEqual(
    addressCacheKey('dvf', { lon: 2.3760123, lat: 48.83 }, 300),
    addressCacheKey('dvf', { lon: 2.3760789, lat: 48.83 }, 300),
  );
});

test('a different radius or a different street is a different entry', () => {
  const base = addressCacheKey('dvf', { lon: 2.3760, lat: 48.8300 }, 300);
  assert.notEqual(base, addressCacheKey('dvf', { lon: 2.3760, lat: 48.8300 }, 600));
  assert.notEqual(base, addressCacheKey('dvf', { lon: 2.3800, lat: 48.8300 }, 300));
  assert.notEqual(base, addressCacheKey('dpe', { lon: 2.3760, lat: 48.8300 }, 300));
});

// ── The urbanism layer's optional bbox ──────────────────────────────────────

const query = (obj) => new URLSearchParams(obj);

test('no bbox at all is the POINT regime, not a bad request', () => {
  // The urbanism layer sends a box only below its own altitude; above it the
  // point answer is correct and much cheaper, and it arrives as a request with
  // no box in it.
  assert.equal(gpuRequestBox(query({ lat: '48.83', lon: '2.376' })), null);
  assert.equal(gpuRequestBox(query({ south: '', west: '', north: '', east: '' })), null);
});

test('a complete, bounded bbox is accepted and returned as numbers', () => {
  const box = gpuRequestBox(query({
    south: '43.385', west: '-1.464', north: '43.405', east: '-1.444',
  }));
  assert.deepEqual(box, {
    south: 43.385, west: -1.464, north: 43.405, east: -1.444,
  });
});

test('a PARTIAL bbox is refused rather than quietly answered as a point', () => {
  // Half a box is a client bug, and answering a different question than the
  // one asked is how a layer ends up drawing the wrong block.
  assert.throws(() => gpuRequestBox(query({ south: '43.385', west: '-1.464' })), /bbox/);
});

test('a bbox wider than the server accepts is refused, with the ceiling named', () => {
  assert.throws(() => gpuRequestBox(query({
    south: '43', west: '-2', north: '44', east: '-1',
  })), new RegExp(GPU_REQUEST_MAX_BOX_DEG.toFixed(3)));
  // Inverted is not a small request, it is a broken one.
  assert.throws(() => gpuRequestBox(query({
    south: '43.405', west: '-1.444', north: '43.385', east: '-1.464',
  })), /bbox/);
});

test('the server ceiling leaves room for the outward snap the client cannot see', () => {
  // `snapBoxOutward` moves each edge out by up to a full grid step, so a box
  // already at the client ceiling arrives up to two steps wider; a snapped edge
  // rounded to six decimals is then compared against an exact ceiling by
  // floating-point noise. A one-step margin 400'd the cadastre layer at the
  // altitudes where its box first stops being view-sized.
  assert.ok(GPU_REQUEST_MAX_BOX_DEG >= GPU_MAX_BOX_DEG + 2 * GPU_BOX_STEP_DEG);
  const atCeiling = {
    south: 43.385, west: -1.464, north: 43.385 + GPU_MAX_BOX_DEG, east: -1.464 + GPU_MAX_BOX_DEG,
  };
  const snapped = snapBoxOutward(atCeiling, GPU_BOX_STEP_DEG);
  assert.ok((snapped.north - snapped.south) <= GPU_REQUEST_MAX_BOX_DEG);
  assert.ok((snapped.east - snapped.west) <= GPU_REQUEST_MAX_BOX_DEG);
});

test('a box and a point at the same address are different cache entries', () => {
  // They are different answers to different questions, and sharing a slot
  // would tell a reader at 9 km that they can see their neighbours' zoning.
  const point = { lon: 2.376, lat: 48.83 };
  assert.notEqual(addressCacheKey('gpu', point, 'pt'), addressCacheKey('gpu', point, '43.385,-1.464,43.405,-1.444'));
});
