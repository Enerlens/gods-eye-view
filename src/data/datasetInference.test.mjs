import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyDatasetUrl,
  csvHeadSample,
  inferDatasetManifest,
  licenceLabel,
  slugifyDatasetId,
} from './datasetInference.js';

function response(body, { status = 200 } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { ok: status < 300, status, headers: { get: () => null }, text: async () => text, json: async () => JSON.parse(text) };
}

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    for (const [match, answer] of routes) {
      if (typeof match === 'string' ? url.startsWith(match) : match.test(url)) return typeof answer === 'function' ? answer(url) : answer;
    }
    return response({ error: 'no route' }, { status: 404 });
  };
  return { impl, calls };
}

test('classifies the addresses people actually paste', () => {
  assert.deepEqual(classifyDatasetUrl('https://www.data.gouv.fr/datasets/geodae-base-nationale-des-defibrillateurs/'), { platform: 'datagouv-dataset', url: 'https://www.data.gouv.fr/datasets/geodae-base-nationale-des-defibrillateurs/', datasetRef: 'geodae-base-nationale-des-defibrillateurs' });
  assert.equal(classifyDatasetUrl('https://www.data.gouv.fr/fr/datasets/abc/').datasetRef, 'abc');
  assert.equal(classifyDatasetUrl('https://www.data.gouv.fr/api/1/datasets/61556e1e9d6adb2df86eb0fc/').datasetRef, '61556e1e9d6adb2df86eb0fc');
  assert.equal(classifyDatasetUrl('https://www.data.gouv.fr/datasets/r/EDB6A9E1-2F16-4BBF-99E7-C3EB6B90794C').resourceId, 'edb6a9e1-2f16-4bbf-99e7-c3eb6b90794c');
  assert.equal(classifyDatasetUrl('https://www.data.gouv.fr/datasets/slug/#/resources/edb6a9e1-2f16-4bbf-99e7-c3eb6b90794c').platform, 'datagouv-resource');
  assert.equal(classifyDatasetUrl('https://tabular-api.data.gouv.fr/api/resources/edb6a9e1-2f16-4bbf-99e7-c3eb6b90794c/data/').platform, 'datagouv-resource');
  assert.equal(classifyDatasetUrl('edb6a9e1-2f16-4bbf-99e7-c3eb6b90794c').platform, 'datagouv-resource');
  assert.deepEqual(classifyDatasetUrl('https://opendata.paris.fr/explore/dataset/arbresremarquablesparis/information/'), { platform: 'opendatasoft', url: 'https://opendata.paris.fr/explore/dataset/arbresremarquablesparis/information/', portal: 'https://opendata.paris.fr', dataset: 'arbresremarquablesparis' });
  assert.equal(classifyDatasetUrl('https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/eco2mix-national-tr/records?limit=1').dataset, 'eco2mix-national-tr');
  const wfs = classifyDatasetUrl('https://data.geopf.fr/wfs/ows?SERVICE=WFS&REQUEST=GetFeature&TYPENAMES=BDTOPO_V3:aerodrome');
  assert.deepEqual(wfs, { platform: 'wfs', url: 'https://data.geopf.fr/wfs/ows', typeName: 'BDTOPO_V3:aerodrome' });
  assert.equal(classifyDatasetUrl('https://data.geopf.fr/wfs/ows').typeName, null);
  assert.equal(classifyDatasetUrl('https://raw.githubusercontent.com/x/y/main/a.geojson').platform, 'geojson');
  assert.equal(classifyDatasetUrl('https://x.test/a.ndjson').platform, 'geojsonl');
  assert.equal(classifyDatasetUrl('https://static.data.gouv.fr/resources/x/file.csv').platform, 'csv');
  assert.equal(classifyDatasetUrl('not a url at all !').platform, 'unknown');
});

test('licence labels and slugs', () => {
  assert.equal(licenceLabel('lov2'), 'Licence Ouverte 2.0');
  assert.equal(licenceLabel('odc-odbl'), 'ODbL');
  assert.equal(licenceLabel(null), 'non précisée');
  assert.equal(licenceLabel('Custom Terms'), 'Custom Terms');
  assert.equal(slugifyDatasetId('Base nationale des défibrillateurs (GeoDAE)'), 'base-nationale-des-defibrillateurs', 'cut on a word');
  assert.equal(slugifyDatasetId('Géo\'DAE - Base Nationale des Défibrillateurs'), 'geo-dae-base-nationale-des');
  assert.equal(slugifyDatasetId('x'.repeat(60)), 'x'.repeat(40), 'no word boundary: hard cut');
  assert.equal(slugifyDatasetId('!!'), 'jeu');
});

test('csvHeadSample drops the cut last record', () => {
  const peek = csvHeadSample('a;b\n1;2\n3;4\n5;');
  assert.deepEqual(peek.header, ['a', 'b']);
  assert.equal(peek.sample.length, 2, 'two whole records kept, the cut third dropped');
});

test('a data.gouv dataset page → the CSV resource, the Tabular profile, a guessed geometry and the licence note', async () => {
  const fetch = fakeFetch([
    ['https://www.data.gouv.fr/api/1/datasets/geodae/', response({
      id: '61556e1e9d6adb2df86eb0fc', title: 'Base nationale des défibrillateurs', license: 'lov2',
      organization: { name: 'Atlasanté' }, page: 'https://www.data.gouv.fr/datasets/geodae/',
      resources: [
        { id: 'AAAAAAAA-0000-0000-0000-000000000001', format: 'json', title: 'geodae.json', filesize: 2 },
        { id: 'aaaaaaaa-0000-0000-0000-000000000002', format: 'csv', title: 'geodae.csv', filesize: 84_000_000 },
      ],
    })],
    ['https://www.data.gouv.fr/api/2/datasets/resources/aaaaaaaa-0000-0000-0000-000000000002/', response({
      resource: { id: 'aaaaaaaa-0000-0000-0000-000000000002', format: 'csv', title: 'geodae.csv', latest: 'https://www.data.gouv.fr/api/1/datasets/r/aaaaaaaa-0000-0000-0000-000000000002' },
    })],
    [/tabular-api\.data\.gouv\.fr\/api\/resources\/aaaaaaaa-0000-0000-0000-000000000002\/profile/, response({ profile: { header: ['c_nom', 'c_lat_coor1', 'c_long_coor1', 'c_com_nom'] } })],
    [/tabular-api\.data\.gouv\.fr\/api\/resources\/aaaaaaaa-0000-0000-0000-000000000002\/data/, response({ data: [{ c_nom: 'DAE', c_lat_coor1: 47.75, c_long_coor1: -3.36, c_com_nom: 'Lorient' }] })],
  ]);
  const result = await inferDatasetManifest('https://www.data.gouv.fr/datasets/geodae/', { fetchImpl: fetch.impl, relay: null });
  assert.equal(result.platform, 'datagouv-dataset');
  assert.deepEqual(result.faults, []);
  assert.equal(result.manifest.source.kind, 'datagouv');
  assert.equal(result.manifest.source.resourceId, 'aaaaaaaa-0000-0000-0000-000000000002');
  assert.equal(result.manifest.source.scope, 'viewport');
  assert.deepEqual(result.manifest.geometry, { lon: 'c_long_coor1', lat: 'c_lat_coor1' });
  assert.equal(result.manifest.attribution.licence, 'Licence Ouverte 2.0');
  assert.equal(result.manifest.attribution.publisher, 'Atlasanté');
  assert.equal(result.manifest.id, 'base-nationale-des-defibrillateurs');
  assert.ok(result.notes.some((note) => /Ressource retenue/.test(note)));
  assert.ok(result.notes.some((note) => /à confirmer/.test(note)));
  assert.ok(result.notes.some((note) => /Géométrie déduite/.test(note)));
  assert.equal(result.resources.length, 2);
  assert.deepEqual(result.columns, ['c_nom', 'c_lat_coor1', 'c_long_coor1', 'c_com_nom']);
});

test('a data.gouv CSV the Tabular API never indexed is peeked raw, and a missing geometry is a fault', async () => {
  const fetch = fakeFetch([
    ['https://www.data.gouv.fr/api/2/datasets/resources/bbbbbbbb-0000-0000-0000-000000000001/', response({
      resource: { id: 'bbbbbbbb-0000-0000-0000-000000000001', format: 'csv', title: 'liste.csv', latest: 'https://www.data.gouv.fr/api/1/datasets/r/bbbbbbbb-0000-0000-0000-000000000001' },
      dataset_id: 'dsid',
    })],
    ['https://www.data.gouv.fr/api/1/datasets/dsid/', response({ title: 'Liste', license: 'odc-odbl', organization: { name: 'Ville' }, page: 'https://www.data.gouv.fr/datasets/liste/' })],
    [/tabular-api/, response({ detail: 'nope' }, { status: 404 })],
    ['https://www.data.gouv.fr/api/1/datasets/r/bbbbbbbb-0000-0000-0000-000000000001', response('nom;adresse\nA;1 rue\nB;2 rue\nC;3 r')],
  ]);
  const result = await inferDatasetManifest('https://www.data.gouv.fr/datasets/r/bbbbbbbb-0000-0000-0000-000000000001', { fetchImpl: fetch.impl, relay: null });
  assert.equal(result.manifest.source.kind, 'csv');
  assert.equal(result.manifest.source.delimiter, ';');
  assert.equal(result.manifest.attribution.licence, 'ODbL');
  assert.equal(result.manifest.geometry, undefined);
  assert.ok(result.faults.some((fault) => fault.includes('`geometry`')));
  assert.deepEqual(result.columns, ['nom', 'adresse']);
  assert.ok(result.notes.some((note) => /non indexée/.test(note)));
});

test('an Opendatasoft page → the geo field, the count-driven scope and the portal licence', async () => {
  const fetch = fakeFetch([
    ['https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/arbres', response({
      metas: { default: { title: 'Les arbres remarquables', license: 'Open Database License (ODbL)', publisher: 'Ville de Paris', records_count: 185 } },
      fields: [{ name: 'geom_x_y', type: 'geo_point_2d' }, { name: 'arbres_genre', type: 'text' }],
    })],
  ]);
  const result = await inferDatasetManifest('https://opendata.paris.fr/explore/dataset/arbres/information/', { fetchImpl: fetch.impl, relay: null });
  assert.deepEqual(result.faults, []);
  assert.equal(result.manifest.source.kind, 'opendatasoft');
  assert.equal(result.manifest.source.geoField, 'geom_x_y');
  assert.equal(result.manifest.source.scope, 'all', '185 rows fit under the default cap');
  assert.equal(result.manifest.attribution.publisher, 'Ville de Paris');
  assert.equal(result.total, 185);
});

test('a WFS address with a typeName needs no request; without one it is refused', async () => {
  const result = await inferDatasetManifest('https://data.geopf.fr/wfs/ows?service=WFS&typeNames=BDTOPO_V3:aerodrome', { fetchImpl: async () => { throw new Error('no request expected'); }, relay: null });
  assert.deepEqual(result.faults, []);
  assert.equal(result.manifest.source.kind, 'wfs');
  assert.equal(result.manifest.source.scope, 'viewport');
  assert.equal(result.manifest.attribution.publisher, 'IGN — Géoplateforme');
  await assert.rejects(inferDatasetManifest('https://data.geopf.fr/wfs/ows', { fetchImpl: async () => response('') }), /typeNames/);
});

test('an unknown address is refused with the list of what is accepted', async () => {
  await assert.rejects(inferDatasetManifest('https://example.org/page.html', { fetchImpl: async () => response('') }), /non reconnue/);
});
