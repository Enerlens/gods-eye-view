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
  MODELS_BASE_DIR,
  acceptsBrotli,
  isCesiumFreePage,
  parseGeoidQuery,
  precompressibleAsset,
  staticAssetHeaders,
  stripCesiumAssets,
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

test('the vendored webfonts may promise a year, because they carry their hash', () => {
  // `npm run fonts:build` hashes these itself: they live in `public/`, which
  // Vite copies verbatim, so nothing else would.
  for (const p of ['/fonts/inter-latin.c9407645.woff2', '/fonts/material-symbols-outlined-subset.b9fe254e.woff2']) {
    assert.equal(staticAssetHeaders(p)['Cache-Control'], 'public, max-age=31536000, immutable', p);
  }
});

test('the content-hashed aircraft GLBs may promise a year', () => {
  // 3.5 MB of hangar fleet. Served under `/models/` it is `no-cache`, which
  // the Cloudflare edge reads as "store nothing" — so every visitor's first
  // aircraft comes out of Paris, and every redeploy's fresh mtimes invalidate
  // the weak ETag that would otherwise have made it a 304.
  for (const p of [`/${MODELS_BASE_DIR}/airplane.glb`, `/${MODELS_BASE_DIR}/b789.glb`]) {
    assert.equal(staticAssetHeaders(p)['Cache-Control'], 'public, max-age=31536000, immutable', p);
  }
});

test('an unhashed font, and the stylesheet that names them, are not frozen', () => {
  // `fonts.css` is to the faces what index.html is to the bundle: the map from
  // stable names to hashed ones. Freezing it would pin a returning visitor to a
  // face that no longer exists — the same class of failure, one layer down.
  for (const p of ['/fonts/fonts.css', '/fonts/inter-latin.woff2', '/fonts/inter.woff2']) {
    assert.equal(staticAssetHeaders(p)['Cache-Control'], undefined, p);
  }
});

test('the unhashed model path cannot claim immutability', () => {
  // The pre-change path, and the one the dev server still serves. If a future
  // change drops the hashed directory, this fails rather than freezing a
  // mutable URL for a year.
  assert.equal(staticAssetHeaders('/models/airplane.glb')['Cache-Control'], undefined);
});

test('the models directory is named after the bytes it holds', async () => {
  // The whole promise above rests on this: change a GLB, and the URL moves.
  const { createHash } = await import('node:crypto');
  const { readdirSync, readFileSync } = await import('node:fs');
  const hash = createHash('sha256');
  for (const name of readdirSync('public/models').filter((f) => f.endsWith('.glb')).sort()) {
    hash.update(name).update(readFileSync(`public/models/${name}`));
  }
  assert.equal(MODELS_BASE_DIR, `models-${hash.digest('hex').slice(0, 8)}`);
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

// ── Pre-compressed delivery ────────────────────────────────────────────────
//
// Two judgements, and both have a silent wrong answer. Saying yes to a URL
// that revalidates hands back a 200 where a 304 was due, forever; saying yes
// to a client that cannot decode brotli hands it a body it will render as
// mojibake or refuse to parse, with no error anywhere.

test('the two scripts a cold boot cannot avoid are pre-compressible', () => {
  // Measured through the server: 1 098 → 824 kB for the engine chunk,
  // 248 → 204 kB for the entry. Cesium's Workers are here too — they are
  // fetched at runtime from the version-pinned directory, not bundled.
  for (const p of ['/assets/cesium-engine-Dq9Fo31T.js', '/assets/index-BlPAiXAf.js', `/${CESIUM_DIR}/Workers/chunk-3CDICLGN.js`]) {
    assert.equal(precompressibleAsset(p)?.contentType, 'text/javascript; charset=utf-8', p);
  }
});

test('the extension map doubles as the content-type table', () => {
  // Ending the response here means sirv never runs, so nothing else would set
  // the type — a stylesheet served as `application/octet-stream` is not applied.
  assert.equal(precompressibleAsset('/assets/index-x.css').contentType, 'text/css; charset=utf-8');
  assert.equal(precompressibleAsset('/assets/regions-x.json').contentType, 'application/json; charset=utf-8');
  assert.equal(precompressibleAsset('/assets/airports-x.geojsonl').contentType, 'application/json; charset=utf-8');
  assert.equal(precompressibleAsset(`/${CESIUM_DIR}/ThirdParty/draco_decoder.wasm`).contentType, 'application/wasm');
});

test('an already-compressed format is left alone', () => {
  // Brotli over a JPEG or a woff2 costs build time and returns bytes.
  for (const p of [`/${CESIUM_DIR}/Assets/Textures/SkyBox/tycho2t3_80_px.jpg`, '/assets/logo-x.png', '/assets/b789-x.glb']) {
    assert.equal(precompressibleAsset(p), null, p);
  }
});

test('a url that revalidates is never served pre-compressed', () => {
  // This middleware answers 200 with a full body and never 304. That is free
  // for a content-addressed URL and a regression for every other one.
  for (const p of ['/', '/index.html', '/fiche.html', '/style.css', '/fonts/fonts.css', '/models/b789.glb']) {
    assert.equal(precompressibleAsset(p), null, p);
  }
});

test('the same allowlist as the cache policy, so the two cannot drift', () => {
  // A file compressed but not served is wasted build time; a URL served but
  // not compressed is a 404 on a path that worked yesterday.
  for (const p of ['/uploads/assets/evil.js', '/cesium/Cesium.js', '/api/proxy?to=/assets/x.js']) {
    assert.equal(precompressibleAsset(p), null, p);
    assert.equal(staticAssetHeaders(p)['Cache-Control'], undefined, p);
  }
});

test('a traversal cannot climb out of the build output', () => {
  for (const p of ['/assets/../../../etc/passwd.js', '/assets/%2e%2e/%2e%2e/etc/shadow.js', '/assets/..%2f..%2fetc%2fx.js']) {
    assert.equal(precompressibleAsset(p), null, p);
  }
});

test('a malformed escape is refused rather than thrown on', () => {
  assert.equal(precompressibleAsset('/assets/%E0%A4%A.js'), null);
  assert.equal(precompressibleAsset(undefined), null);
});

test('a query string neither hides nor invents an extension', () => {
  assert.equal(precompressibleAsset('/assets/index-x.js?v=2').pathname, '/assets/index-x.js');
  assert.equal(precompressibleAsset('/assets/logo-x.png?as=.js'), null);
});

test('brotli is accepted when the client says so, in any of its spellings', () => {
  for (const h of ['br', 'gzip, deflate, br', 'br;q=1.0, gzip;q=0.8', ' BR ', 'gzip, br, zstd']) {
    assert.equal(acceptsBrotli(h), true, h);
  }
});

test('a client that cannot decode brotli is never handed one', () => {
  // `br` is a substring of `brotli` and of any future token containing it, and
  // `br;q=0` is an explicit refusal — both are silent wrong answers to
  // `includes('br')`.
  for (const h of ['gzip, deflate', 'gzip', '', undefined, 'identity', 'br;q=0', 'gzip, br;q=0', 'brotli']) {
    assert.equal(acceptsBrotli(h), false, JSON.stringify(h));
  }
});

// ── Cesium script defer — deleted, and why ─────────────────────────────────
//
// Three tests lived here, all about rewriting `vite-plugin-cesium`'s injected
// `<script src=".../Cesium.js">` with `defer` so the HTML parser did not stop
// dead at a 5.6 MB blocking script. The plugin now runs with
// `rebuildCesium: true` (2026-09-09): the engine comes through the module graph
// as tree-shaken ESM, vite announces its chunk with `<link rel=modulepreload>`,
// and no such tag is emitted by any build. A test that pinned the rewrite would
// be pinning a string no build produces.

// ── Cesium-free document pages ─────────────────────────────────────────────

test('the address radiography is a document page, the globe is not', () => {
  assert.equal(isCesiumFreePage('fiche.html'), true);
  assert.equal(isCesiumFreePage('/abs/path/to/fiche.html'), true);
  assert.equal(isCesiumFreePage('index.html'), false);
  assert.equal(isCesiumFreePage(null), false);
});

test('the injected Cesium stylesheet is removed from a document page', () => {
  // The sheet is not inert: it carries Cesium's own type and button rules, so a
  // printable page that kept it would render differently from the one dev
  // shows. The engine itself no longer reaches these pages at all — `fiche.js`
  // imports no Cesium, so Rollup gives it none.
  const html = `<head><link rel="stylesheet" href="/${CESIUM_DIR}/Widgets/widgets.css"></head>`;
  const { html: out, changed } = stripCesiumAssets(html);
  assert.equal(changed, true);
  assert.ok(!out.includes('widgets.css'));
});

test('a page with nothing to strip is reported, never silently accepted', () => {
  const { html: out, changed } = stripCesiumAssets('<head><script src="/assets/fiche.js"></script></head>');
  assert.equal(changed, false);
  assert.equal(out, '<head><script src="/assets/fiche.js"></script></head>');
});

test('the module bundle is left alone', () => {
  const html = '<script type="module" crossorigin src="/assets/index-x.js"></script>';
  assert.equal(stripCesiumAssets(html).html, html);
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
