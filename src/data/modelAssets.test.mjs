// The one indirection between a model's NAME and its URL.
//
// It exists so the deployed GLBs can sit under a content-hashed directory
// without renaming the identity that keys the model specs, the visual-anchor
// tables and the model cache. Two ways that can go wrong, and both are silent:
// a rewrite that mangles a URL fails as a missing aircraft rather than an
// error, and a logical name nobody maps 404s only once someone flies that
// class. Both are pinned here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { MODELS_BASE, modelAssetUrl } from './modelAssets.js';
import { CLASS_MODEL_URL, CLASS_MODEL_REAL } from './aircraftClass.js';

test('outside a build the logical name IS the url', () => {
  // `__GEV_MODELS_BASE__` is a define, not an import: under node it does not
  // exist, and the fallback has to be the path `vite dev` serves.
  assert.equal(MODELS_BASE, '/models');
  assert.equal(modelAssetUrl('/models/c172.glb'), '/models/c172.glb');
});

test('a name that is not a model passes through untouched', () => {
  // This sits directly in front of Model.fromGltfAsync. A URL it rewrote by
  // accident would come back as an aircraft that never appears, not an error.
  for (const url of [
    'https://example.test/models/x.glb',
    '/assets/other-BlPAiXAf.glb',
    '/modelsfoo/x.glb',
    '',
  ]) {
    assert.equal(modelAssetUrl(url), url, url);
  }
  assert.equal(modelAssetUrl(undefined), '');
  assert.equal(modelAssetUrl(null), '');
});

test('only the prefix moves — the filename is carried across verbatim', () => {
  // Simulate a build's define without one: the substitution is the only thing
  // that differs, so re-deriving it here pins the shape of the rewrite.
  const rebase = (url, base) => url.replace(/^\/models\//, `${base}/`);
  assert.equal(rebase('/models/b789.glb', '/models-1a2b3c4d'), '/models-1a2b3c4d/b789.glb');
  assert.equal(modelAssetUrl('/models/b789.glb'), rebase('/models/b789.glb', MODELS_BASE));
});

test('every model this app can ask for exists on disk', () => {
  // The failure this catches is a rename: `public/models` is copied verbatim
  // and then moved by the build, so nothing type-checks these strings. A class
  // pointing at a file that is not there shows up as one silently missing
  // aircraft type, at the zoom level where models replace billboards.
  const names = new Set([
    ...Object.values(CLASS_MODEL_URL),
    ...Object.values(CLASS_MODEL_REAL).map((spec) => spec.url),
  ]);
  assert.ok(names.size > 0, 'no model urls found — the registries moved');
  for (const name of names) {
    assert.ok(name.startsWith('/models/'), `${name}: not a logical model name`);
    assert.ok(existsSync(`public${name}`), `${name}: no such file under public/`);
  }
});

test('the hangar holds no GLB the code never names', () => {
  // 3.5 MB ships to every deployment. `ship.glb` is the standing exception:
  // it is in the upstream tree and its provenance is recorded in
  // public/models/README.md, but nothing in src/ has ever loaded it.
  const KNOWN_UNUSED = new Set(['ship.glb']);
  const referenced = new Set([
    ...Object.values(CLASS_MODEL_URL),
    ...Object.values(CLASS_MODEL_REAL).map((spec) => spec.url),
    // Named directly rather than through a registry.
    '/models/airplane.glb', '/models/jet.glb',
  ].map((url) => url.slice('/models/'.length)));
  const onDisk = readdirSync('public/models').filter((f) => f.endsWith('.glb'));
  const orphans = onDisk.filter((f) => !referenced.has(f) && !KNOWN_UNUSED.has(f));
  assert.deepEqual(orphans, [], `unreferenced GLBs shipping to every visitor: ${orphans.join(', ')}`);
});
