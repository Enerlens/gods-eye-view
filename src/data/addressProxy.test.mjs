// src/data/addressProxy.test.mjs
// Guards the two request-parsing helpers shared by the six address-scan
// proxies in `vite.config.js`. Both bugs pinned here were found by calling the
// running dev server, not by reading the code — and neither one throws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressCacheKey, addressPoint } from '../../vite.config.js';

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
