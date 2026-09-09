import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDatasetManifest } from './datasetManifest.js';
import {
  PLUGGED_DATASETS_STORAGE_KEY,
  readPluggedDatasets,
  removePluggedDataset,
  setPluggedDatasetEnabled,
  upsertPluggedDataset,
  writePluggedDatasets,
} from './datasetStore.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    dump: () => Object.fromEntries(map),
  };
}

const manifest = normalizeDatasetManifest({
  id: 'aa', label: 'A', attribution: { publisher: 'P', licence: 'L' },
  source: { kind: 'geojson', url: 'https://x.test/a.geojson' },
});

test('round-trips entries, re-validating each manifest and dropping the broken ones', () => {
  const storage = memoryStorage();
  const entries = upsertPluggedDataset([], manifest, { enabled: true, now: 42 });
  assert.equal(writePluggedDatasets(entries, storage), true);
  const stored = JSON.parse(storage.dump()[PLUGGED_DATASETS_STORAGE_KEY]);
  stored.datasets.push({ manifest: { id: 'broken' }, enabled: true });
  stored.datasets.push({ manifest: { ...manifest, id: 'aa' }, enabled: false, addedAt: 7 });
  storage.setItem(PLUGGED_DATASETS_STORAGE_KEY, JSON.stringify(stored));
  const read = readPluggedDatasets(storage);
  assert.equal(read.length, 1, 'the broken one is dropped and the duplicate id is ignored');
  assert.equal(read[0].manifest.id, 'aa');
  assert.equal(read[0].enabled, true);
  assert.equal(read[0].addedAt, 42);
});

test('fails open on missing, refused or garbage storage', () => {
  assert.deepEqual(readPluggedDatasets(null), []);
  assert.deepEqual(readPluggedDatasets(memoryStorage({ [PLUGGED_DATASETS_STORAGE_KEY]: '{not json' })), []);
  assert.deepEqual(readPluggedDatasets(memoryStorage({ [PLUGGED_DATASETS_STORAGE_KEY]: JSON.stringify({ version: 99, datasets: [] }) })), []);
  const refusing = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
  assert.equal(writePluggedDatasets([], refusing), false);
  assert.equal(writePluggedDatasets([], null), false);
});

test('upsert keeps position and flag, remove and setEnabled do what they say', () => {
  const b = normalizeDatasetManifest({ ...manifest, id: 'bb', label: 'B' });
  let entries = upsertPluggedDataset([], manifest, { enabled: true, now: 1 });
  entries = upsertPluggedDataset(entries, b, { now: 2 });
  assert.deepEqual(entries.map((e) => [e.manifest.id, e.enabled, e.addedAt]), [['aa', true, 1], ['bb', false, 2]]);
  const replaced = normalizeDatasetManifest({ ...manifest, label: 'A bis' });
  entries = upsertPluggedDataset(entries, replaced, { now: 3 });
  assert.deepEqual(entries.map((e) => [e.manifest.label, e.enabled, e.addedAt]), [['A bis', true, 1], ['B', false, 2]]);
  entries = setPluggedDatasetEnabled(entries, 'bb', true);
  assert.equal(entries[1].enabled, true);
  entries = removePluggedDataset(entries, 'aa');
  assert.deepEqual(entries.map((e) => e.manifest.id), ['bb']);
});
