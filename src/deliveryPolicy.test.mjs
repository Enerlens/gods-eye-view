// The delivery layer's three judgements, pinned as pure functions.
//
// All three exist because a hosted GEV is not a static site: it runs
// `vite preview`, which hardcodes `Cache-Control: no-cache` on every file it
// serves. Measured on gev.enerlens.com before this landed, that meant
// `cf-cache-status: BYPASS` on every asset — the Cloudflare edge stored
// nothing and each cold visitor pulled 5.06 MB out of the Paris origin.
//
// What makes the fix safe is entirely in these three decisions: WHICH urls may
// claim to be immutable (a wrong yes serves a stale bundle for a year), which
// content types the compressor will actually recognise, and whether the Cesium
// tag was really rewritten. Each is a pure function of a string, so each is
// pinned here rather than behind a socket.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deferCesiumScriptTag,
  parseGeoidQuery,
  staticAssetHeaders,
} from '../vite.config.js';

// Read from the same source of truth the config uses, so this file cannot rot
// into asserting a version nobody ships.
const CESIUM_DIR = `cesium-${JSON.parse(
  await import('node:fs').then((fs) => fs.readFileSync('node_modules/cesium/package.json', 'utf8')),
).version}`;

// ── Cache policy ───────────────────────────────────────────────────────────

test('content-hashed bundle assets may promise a year', () => {
  const h = staticAssetHeaders('/assets/index-BlPAiXAf.js');
  assert.equal(h['Cache-Control'], 'public, max-age=31536000, immutable');
});

test('the version-pinned Cesium payload may promise a year', () => {
  // The whole reason the directory carries a version: without it this URL
  // names different bytes after every engine upgrade, and `immutable` would be
  // a lie that lasts twelve months.
  for (const p of [`/${CESIUM_DIR}/Cesium.js`, `/${CESIUM_DIR}/Workers/chunk-3CDICLGN.js`, `/${CESIUM_DIR}/Assets/Textures/SkyBox/tycho2t3_80_px.jpg`]) {
    assert.equal(staticAssetHeaders(p)['Cache-Control'], 'public, max-age=31536000, immutable', p);
  }
});

test('index.html is never frozen — it is the map to every hashed name', () => {
  for (const p of ['/', '/index.html', '/lidar-bdtopo.html']) {
    assert.equal(staticAssetHeaders(p)['Cache-Control'], undefined, p);
  }
});

test('an unversioned Cesium path cannot claim immutability', () => {
  // The pre-change path. If a future refactor reverts the version pin, this
  // fails rather than silently freezing a mutable URL for a year.
  assert.equal(staticAssetHeaders('/cesium/Cesium.js')['Cache-Control'], undefined);
});

test('the version dots are literal, not regex wildcards', () => {
  const wildcarded = `/${CESIUM_DIR.replace(/\./g, 'X')}/Cesium.js`;
  assert.notEqual(wildcarded, `/${CESIUM_DIR}/Cesium.js`, 'guard needs a version containing dots');
  assert.equal(staticAssetHeaders(wildcarded)['Cache-Control'], undefined);
});

test('the allowlist is anchored — a nested path cannot smuggle itself in', () => {
  assert.equal(staticAssetHeaders('/api/proxy?to=/assets/x.js')['Cache-Control'], undefined);
  assert.equal(staticAssetHeaders('/uploads/assets/evil.js')['Cache-Control'], undefined);
});

test('a query string never hides the extension or the prefix', () => {
  assert.equal(staticAssetHeaders('/assets/x-abc.js?t=1')['Cache-Control'], 'public, max-age=31536000, immutable');
  assert.equal(staticAssetHeaders('/assets/d.geojson?v=2')['Content-Type'], 'application/json; charset=utf-8');
});

test('geojson is relabelled so the compressor recognises it', () => {
  // mrmime types these `application/geo+json`, and vite's compression filter
  // tests /text|javascript|\/json|xml/i — `+json` is not `/json`, so the file
  // went out raw. Measured: 254 348 bytes for departements.geojson, 83 593 after.
  for (const p of ['/assets/departements-ByJNRmn5.geojson', '/assets/airports-x.geojsonl']) {
    assert.equal(staticAssetHeaders(p)['Content-Type'], 'application/json; charset=utf-8', p);
  }
});

test('a file that is not geojson keeps whatever type the server picked', () => {
  for (const p of ['/assets/index-x.js', '/assets/regions-x.json', '/models/b789.glb']) {
    assert.equal(staticAssetHeaders(p)['Content-Type'], undefined, p);
  }
});

test('every response announces that the encoding was negotiated', () => {
  // vite's compression middleware sets Content-Encoding and never Vary.
  // Harmless while nothing caches; with an edge cache in front it invites a
  // gzip body to be handed to a client that never asked for one.
  for (const p of ['/', '/assets/index-x.js', '/api/geoid?lat=1&lon=2', '/models/b789.glb']) {
    assert.equal(staticAssetHeaders(p).Vary, 'Accept-Encoding', p);
  }
});

test('a missing or malformed url is answered, not thrown on', () => {
  for (const u of [undefined, null, '', '?onlyquery']) {
    assert.equal(staticAssetHeaders(u).Vary, 'Accept-Encoding');
  }
});

// ── Cesium script defer ────────────────────────────────────────────────────

test('the injected Cesium tag is deferred, keeping its src', () => {
  const html = `<head><script src="/${CESIUM_DIR}/Cesium.js"></script></head>`;
  const { html: out, changed } = deferCesiumScriptTag(html);
  assert.equal(changed, true);
  assert.equal(out, `<head><script defer src="/${CESIUM_DIR}/Cesium.js"></script></head>`);
});

test('a tag that is not there is reported, never silently accepted', () => {
  // The failure that must stay loud: returning the input unchanged would hand
  // back the 1.63 MB blocking script and nothing would say so.
  const { html: out, changed } = deferCesiumScriptTag('<head><script src="/other.js"></script></head>');
  assert.equal(changed, false);
  assert.equal(out, '<head><script src="/other.js"></script></head>');
});

test('an unversioned Cesium tag is not matched', () => {
  assert.equal(deferCesiumScriptTag('<script src="/cesium/Cesium.js"></script>').changed, false);
});

test('the module bundle is left alone', () => {
  const html = '<script type="module" crossorigin src="/assets/index-x.js"></script>';
  assert.equal(deferCesiumScriptTag(html).html, html);
});

// ── Geoid query parsing ────────────────────────────────────────────────────

test('a well-formed point is parsed and keyed', () => {
  assert.deepEqual(parseGeoidQuery('/api/geoid?lat=37.62&lon=-122.37'), {
    lat: 37.62, lon: -122.37, key: '37.62:-122.37',
  });
});

test('a missing coordinate is refused, never read as the equator', () => {
  // Number('') is 0 and Number(null) is 0. Without an explicit presence check
  // `/api/geoid?lat=48.86` would answer confidently about 0°E.
  for (const u of ['/api/geoid?lat=48.86', '/api/geoid?lon=2.29', '/api/geoid', '/api/geoid?lat=&lon=2']) {
    assert.equal(parseGeoidQuery(u), null, u);
  }
});

test('non-numeric and non-finite coordinates are refused', () => {
  for (const u of ['/api/geoid?lat=abc&lon=2', '/api/geoid?lat=NaN&lon=2', '/api/geoid?lat=Infinity&lon=2']) {
    assert.equal(parseGeoidQuery(u), null, u);
  }
});

test('latitude past the poles is refused; longitude is not bounded here', () => {
  assert.equal(parseGeoidQuery('/api/geoid?lat=91&lon=0'), null);
  assert.equal(parseGeoidQuery('/api/geoid?lat=-90.1&lon=0'), null);
  assert.deepEqual(parseGeoidQuery('/api/geoid?lat=90&lon=0'), { lat: 90, lon: 0, key: '90:0' });
  // meanSeaLevel normalizes longitude itself, so 190°E is a real question.
  assert.equal(parseGeoidQuery('/api/geoid?lat=0&lon=190')?.lon, 190);
});

test('the same point always produces the same memo key', () => {
  const a = parseGeoidQuery('/api/geoid?lat=48.86&lon=2.29');
  const b = parseGeoidQuery('/api/geoid?lon=2.29&lat=48.86');
  assert.equal(a.key, b.key, 'parameter order must not split the cache');
});
