import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { datasetManifestFaults, normalizeDatasetManifest } from './datasetManifest.js';
import { LAYER_CATEGORIES } from './layerTaxonomy.js';
import { normalizeCatalog } from './datasetsCatalog.js';

const DATASETS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../datasets');

function readCatalogFiles() {
  return readdirSync(DATASETS_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => [name, JSON.parse(readFileSync(path.join(DATASETS_DIR, name), 'utf8'))]);
}

test('every shipped manifest validates, names an existing category and is named after its id', () => {
  const files = readCatalogFiles();
  assert.ok(files.length >= 1, 'the catalog ships at least one example');
  const categories = new Set(LAYER_CATEGORIES.map((category) => category.id));
  const ids = new Set();
  for (const [name, candidate] of files) {
    assert.deepEqual(datasetManifestFaults(candidate), [], `${name} does not validate`);
    const manifest = normalizeDatasetManifest(candidate);
    assert.equal(`${manifest.id}.json`, name, `${name} must be named after its id`);
    assert.ok(categories.has(manifest.category), `${name}: unknown category ${manifest.category}`);
    assert.ok(!ids.has(manifest.id), `${name}: duplicate id`);
    ids.add(manifest.id);
    assert.ok(manifest.attribution.url, `${name}: a shipped manifest links its dataset page`);
  }
});

test('normalizeCatalog drops what does not pass and says which file', () => {
  const warnings = [];
  const catalog = normalizeCatalog({
    '/a.json': { id: 'aa', label: 'A', attribution: { publisher: 'P', licence: 'L' }, source: { kind: 'geojson', url: 'https://x.test/a.geojson' } },
    '/b.json': { id: 'bad id' },
    '/c.json': { id: 'aa', label: 'A again', attribution: { publisher: 'P', licence: 'L' }, source: { kind: 'geojson', url: 'https://x.test/c.geojson' } },
  }, (message) => warnings.push(message));
  assert.deepEqual(catalog.map((manifest) => manifest.id), ['aa']);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /b\.json/);
  assert.match(warnings[1], /déjà pris/);
});
