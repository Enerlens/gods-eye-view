import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DATASET_DEFAULT_CATEGORY,
  DATASET_DEFAULT_MAX_FEATURES,
  DATASET_MAX_FEATURES_CEILING,
  DatasetManifestError,
  datasetCredit,
  datasetGeometryShape,
  datasetLayerId,
  datasetManifestFaults,
  datasetPaletteColor,
  datasetSourceLine,
  datasetTaxonomyEntry,
  exportableManifest,
  isDatasetLayerId,
  normalizeDatasetManifest,
} from './datasetManifest.js';

const VALID_CSV = Object.freeze({
  id: 'bornes-test',
  label: 'Bornes de test',
  source: { kind: 'csv', url: 'https://example.org/bornes.csv' },
  geometry: { lon: 'longitude', lat: 'latitude' },
  attribution: { publisher: 'Example', licence: 'Licence Ouverte 2.0' },
});

test('a minimal CSV manifest validates and receives its defaults', () => {
  assert.deepEqual(datasetManifestFaults(VALID_CSV), []);
  const manifest = normalizeDatasetManifest(VALID_CSV);
  assert.equal(manifest.category, DATASET_DEFAULT_CATEGORY);
  assert.equal(manifest.coverage, 'fr');
  assert.equal(manifest.cadence, 'static');
  assert.equal(manifest.source.maxFeatures, DATASET_DEFAULT_MAX_FEATURES);
  assert.equal(manifest.source.scope, 'all');
  assert.equal(manifest.geometry.shape, 'lonlat');
  assert.equal(manifest.name, 'Bornes de test');
  assert.equal(manifest.icon, '◆');
  assert.equal(manifest.color, datasetPaletteColor('bornes-test'));
  assert.ok(Object.isFrozen(manifest));
  assert.ok(Object.isFrozen(manifest.source));
});

test('every fault is reported at once, and normalize throws them all', () => {
  const faults = datasetManifestFaults({ id: 'Bad Id', source: { kind: 'nope' } });
  assert.ok(faults.some((fault) => fault.includes('`id`')));
  assert.ok(faults.some((fault) => fault.includes('`label`')));
  assert.ok(faults.some((fault) => fault.includes('`source.kind`')));
  assert.ok(faults.some((fault) => fault.includes('`attribution`')));
  assert.throws(() => normalizeDatasetManifest({ id: 'Bad Id' }), (error) => {
    assert.ok(error instanceof DatasetManifestError);
    assert.ok(error.faults.length >= 3);
    return true;
  });
});

test('a tabular source without a geometry block is refused, a native one is not', () => {
  const csvWithout = { ...VALID_CSV, geometry: undefined };
  assert.ok(datasetManifestFaults(csvWithout).some((fault) => fault.includes('`geometry`')));
  const geojson = { ...VALID_CSV, geometry: undefined, source: { kind: 'geojson', url: 'https://example.org/a.geojson' } };
  assert.deepEqual(datasetManifestFaults(geojson), []);
  assert.equal(normalizeDatasetManifest(geojson).geometry, null);
});

test('geometry shapes are recognised one at a time, and projected needs a supported CRS', () => {
  assert.equal(datasetGeometryShape({ lon: 'a', lat: 'b' }), 'lonlat');
  assert.equal(datasetGeometryShape({ point: 'c' }), 'point');
  assert.equal(datasetGeometryShape({ wkt: 'g' }), 'wkt');
  assert.equal(datasetGeometryShape({ x: 'x', y: 'y', crs: 'EPSG:2154' }), 'projected');
  assert.equal(datasetGeometryShape({ geojson: 'geom' }), 'geojson');
  assert.equal(datasetGeometryShape({}), null);
  const projected = { ...VALID_CSV, geometry: { x: 'x', y: 'y' } };
  assert.ok(datasetManifestFaults(projected).some((fault) => fault.includes('`geometry.crs`')));
  const exotic = { ...VALID_CSV, geometry: { x: 'x', y: 'y', crs: 'EPSG:3857' } };
  assert.ok(datasetManifestFaults(exotic).some((fault) => fault.includes('EPSG:2154')));
});

test('viewport scope is reserved to bbox-capable sources and the ceiling holds', () => {
  const viewportCsv = { ...VALID_CSV, source: { ...VALID_CSV.source, scope: 'viewport' } };
  assert.ok(datasetManifestFaults(viewportCsv).some((fault) => fault.includes('viewport')));
  const tooMany = { ...VALID_CSV, source: { ...VALID_CSV.source, maxFeatures: DATASET_MAX_FEATURES_CEILING + 1 } };
  assert.ok(datasetManifestFaults(tooMany).some((fault) => fault.includes('`source.maxFeatures`')));
  const wfs = {
    ...VALID_CSV,
    geometry: undefined,
    source: { kind: 'wfs', url: 'https://data.geopf.fr/wfs/ows', typeName: 'BDTOPO_V3:aerodrome', scope: 'viewport' },
  };
  assert.deepEqual(datasetManifestFaults(wfs), []);
  const normalized = normalizeDatasetManifest(wfs);
  assert.equal(normalized.source.scope, 'viewport');
  assert.equal(normalized.cadence, 'periodic', 'a viewport source defaults to periodic, not static');
});

test('each source kind demands its own address', () => {
  const noTypeName = { ...VALID_CSV, geometry: undefined, source: { kind: 'wfs', url: 'https://x.test/wfs' } };
  assert.ok(datasetManifestFaults(noTypeName).some((fault) => fault.includes('`source.typeName`')));
  const noDataset = { ...VALID_CSV, geometry: undefined, source: { kind: 'opendatasoft', url: 'https://x.test' } };
  assert.ok(datasetManifestFaults(noDataset).some((fault) => fault.includes('`source.dataset`')));
  const badResource = { ...VALID_CSV, source: { kind: 'datagouv', resourceId: 'not-a-uuid' } };
  assert.ok(datasetManifestFaults(badResource).some((fault) => fault.includes('`source.resourceId`')));
  const goodResource = { ...VALID_CSV, source: { kind: 'datagouv', resourceId: 'EB76D20A-8501-400E-B336-D85724DE5435' } };
  assert.deepEqual(datasetManifestFaults(goodResource), []);
  assert.equal(normalizeDatasetManifest(goodResource).source.resourceId, 'eb76d20a-8501-400e-b336-d85724de5435');
});

test('feature block: titles, details and a graded group normalize', () => {
  const graded = {
    ...VALID_CSV,
    feature: {
      title: ['nom', 'enseigne'],
      details: ['adresse', { field: 'puissance', label: 'Puissance', unit: 'kW' }],
      group: { field: 'type', styles: { Voirie: { color: '#FFAA00' }, Parking: { color: '#00aaff', label: 'Parc' } }, other: { color: '#888888' } },
    },
  };
  assert.deepEqual(datasetManifestFaults(graded), []);
  const manifest = normalizeDatasetManifest(graded);
  assert.deepEqual([...manifest.feature.title], ['nom', 'enseigne']);
  assert.deepEqual(manifest.feature.details.map((d) => [d.field, d.label, d.unit]), [
    ['adresse', null, null],
    ['puissance', 'Puissance', 'kW'],
  ]);
  assert.equal(manifest.feature.group.styles.Voirie.label, 'Voirie', 'a style without a label is labelled by its value');
  assert.equal(manifest.feature.group.styles.Parking.label, 'Parc');
  assert.equal(manifest.feature.group.other.label, 'Autre');
  const badDetail = { ...VALID_CSV, feature: { details: [{ label: 'x' }] } };
  assert.ok(datasetManifestFaults(badDetail).some((fault) => fault.includes('`feature.details[0]`')));
  const badStyle = { ...VALID_CSV, feature: { group: { field: 'f', styles: { a: { color: 'red' } } } } };
  assert.ok(datasetManifestFaults(badStyle).some((fault) => fault.includes('styles["a"]')));
});

test('derived registry entries: id, taxonomy row, source line, credit', () => {
  const manifest = normalizeDatasetManifest({ ...VALID_CSV, attribution: { ...VALID_CSV.attribution, url: 'https://example.org/jeu' } });
  assert.equal(datasetLayerId(manifest), 'ds-bornes-test');
  assert.ok(isDatasetLayerId('ds-bornes-test'));
  assert.ok(!isDatasetLayerId('flights'));
  const row = datasetTaxonomyEntry(manifest, (coverage) => (coverage === 'fr' ? 'FR' : null));
  assert.deepEqual(row, {
    id: 'ds-bornes-test', category: 'plugged', label: 'Bornes de test', kind: 'dataset',
    coverage: 'fr', auth: 'none', cadence: 'static', scopeChip: 'FR',
  });
  assert.equal(datasetSourceLine(manifest), 'Example · Licence Ouverte 2.0');
  const credit = datasetCredit(manifest);
  assert.equal(credit.key, 'ds-bornes-test');
  assert.match(credit.html, /^<a href="https:\/\/example\.org\/jeu"/);
  assert.match(credit.html, /Bornes de test : Example \(Licence Ouverte 2\.0\)/);
  const hostile = normalizeDatasetManifest({ ...VALID_CSV, attribution: { publisher: '<b>x</b>', licence: 'L' } });
  assert.ok(!datasetCredit(hostile).html.includes('<b>'), 'credit markup escapes the manifest');
});

test('a normalized manifest validates again — storage and export round-trip', () => {
  const manifest = normalizeDatasetManifest({
    ...VALID_CSV,
    feature: { title: ['nom'], details: ['adresse', { field: 'kw', unit: 'kW' }] },
  });
  assert.deepEqual(datasetManifestFaults(manifest), []);
  assert.deepEqual(datasetManifestFaults(JSON.parse(JSON.stringify(manifest))), []);
  const again = normalizeDatasetManifest(manifest);
  assert.deepEqual(again, manifest);
});

test('exportableManifest reads like a hand-written file and validates again', () => {
  const manifest = normalizeDatasetManifest(VALID_CSV);
  const file = exportableManifest(manifest);
  assert.equal(file.version, undefined);
  assert.equal(file.name, undefined, 'a name equal to the label is not written');
  assert.equal(file.icon, undefined);
  assert.equal(file.refreshMs, undefined);
  assert.equal(file.feature, undefined, 'an empty feature block is not written');
  assert.deepEqual(file.geometry, { lon: 'longitude', lat: 'latitude' });
  assert.equal(JSON.stringify(file).includes('null'), false);
  assert.deepEqual(datasetManifestFaults(file), []);
  assert.deepEqual(normalizeDatasetManifest(file), manifest);
  const rich = normalizeDatasetManifest({ ...VALID_CSV, name: 'Test bollards', icon: '⚡', refreshMs: 60000, feature: { title: ['nom'] } });
  const richFile = exportableManifest(rich);
  assert.equal(richFile.name, 'Test bollards');
  assert.equal(richFile.icon, '⚡');
  assert.equal(richFile.refreshMs, 60000);
  assert.deepEqual(richFile.feature, { title: ['nom'] });
});

test('the palette colour is stable per id', () => {
  assert.equal(datasetPaletteColor('abc'), datasetPaletteColor('abc'));
  assert.match(datasetPaletteColor('abc'), /^#[0-9a-f]{6}$/);
});
