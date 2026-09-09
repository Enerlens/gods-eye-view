// src/data/layerManifest.test.mjs
//
// The drift guard for the generated layer manifest.
//
// `main.js` no longer imports a single layer module: it registers stubs built
// from `LAYER_MANIFEST`, and the toggle panel draws each layer's name, icon and
// source from that table long before the module behind it is fetched. So the
// table is a COPY of something, and a copy that is allowed to go stale renders
// a plausible wrong panel with nothing thrown — the exact failure mode the
// icon-font subset produced when a glyph went missing.
//
// Every test below re-derives the manifest from the real modules and compares.
// A layer that is renamed, that gains a `setParams`, that changes a default, or
// that moves file, fails `npm test` here rather than shipping a stub that lies.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LAYER_MANIFEST } from './layerManifest.js';
import { LAZY_LAYER_CAPABILITIES, LAZY_LAYER_REQUIRED_METHODS } from './lazyLayer.js';
import { LAYER_STATE_REGISTRY } from './layerState.js';
import { LAYER_TAXONOMY } from './layerTaxonomy.js';
import {
  LAYER_MANIFEST_SOURCES,
  describeLayerModule,
  installViteAssetStubHooks,
} from '../../scripts/lib/layerManifestSources.mjs';

// `localLayers.js` imports four `.geojsonl` packs through Vite's `?url`, which
// plain node refuses. The stub keeps those specifiers resolvable; nothing this
// file reads depends on their contents.
installViteAssetStubHooks();

/** Every layer module, loaded through the manifest's own `load()`. */
const loaded = await Promise.all(
  LAYER_MANIFEST.map(async (descriptor) => ({ descriptor, layer: await descriptor.load() })),
);

test('every manifest entry loads the layer it claims', () => {
  for (const { descriptor, layer } of loaded) {
    assert.ok(layer, `${descriptor.id} loaded nothing`);
    assert.equal(layer.id, descriptor.id);
  }
});

test('manifest identity matches the modules field for field', () => {
  for (const { descriptor, layer } of loaded) {
    const derived = describeLayerModule(layer, LAZY_LAYER_CAPABILITIES);
    const shipped = {
      id: descriptor.id,
      name: descriptor.name,
      icon: descriptor.icon,
      source: descriptor.source,
      ...(descriptor.showInTogglePanel === false ? { showInTogglePanel: false } : {}),
      capabilities: [...descriptor.capabilities],
      ...(descriptor.defaultParams ? { defaultParams: { ...descriptor.defaultParams } } : {}),
    };
    assert.deepEqual(shipped, derived, `manifest is stale for ${descriptor.id}`);
  }
});

test('every layer implements the four lifecycle methods the manager always calls', () => {
  for (const { descriptor, layer } of loaded) {
    for (const method of LAZY_LAYER_REQUIRED_METHODS) {
      assert.equal(
        typeof layer[method],
        'function',
        `${descriptor.id} has no ${method}()`,
      );
    }
  }
});

test('the manifest covers exactly the layers the boot seal demands', () => {
  // `finalizeRegistrations()` refuses a registered set that does not match
  // `LAYER_STATE_REGISTRY` exactly, in both directions. Asserting the same
  // equality here turns "forgot to add it to layerManifestSources.mjs" into a
  // failing unit test instead of a dead boot.
  const manifestIds = LAYER_MANIFEST.map((entry) => entry.id).sort();
  const registryIds = LAYER_STATE_REGISTRY.map((entry) => entry.id).sort();
  const taxonomyIds = LAYER_TAXONOMY.map((entry) => entry.id).sort();
  assert.deepEqual(manifestIds, registryIds);
  assert.deepEqual(manifestIds, taxonomyIds);
});

test('manifest ids are unique and match the ordered source list', () => {
  const ids = LAYER_MANIFEST.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate layer id in the manifest');
  assert.equal(LAYER_MANIFEST.length, LAYER_MANIFEST_SOURCES.length);
});

test('the generator would write the file that is checked in', async () => {
  const { readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const { renderLayerManifest } = await import('../../scripts/build-layer-manifest.mjs');
  const rendered = await renderLayerManifest(repoRoot);
  const onDisk = await readFile(path.join(repoRoot, 'src', 'data', 'layerManifest.js'), 'utf8');
  assert.equal(onDisk, rendered, 'run `npm run layers:manifest`');
});
