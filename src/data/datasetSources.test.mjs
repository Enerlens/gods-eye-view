import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDatasetManifest } from './datasetManifest.js';
import {
  DatasetSourceError,
  TABULAR_PAGE_SIZE,
  datagouvResourceLatestUrl,
  featuresFromGeoJson,
  fetchDatasetText,
  loadDatasetFeatures,
  normalizeBbox,
  opendatasoftExportUrl,
  relayUrl,
  tabularColumnsFor,
  tabularDataUrl,
  wfsGetFeatureUrl,
} from './datasetSources.js';

const ATTRIBUTION = { publisher: 'P', licence: 'L' };

function response(body, { status = 200, headers = {} } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}

/** A fetch that answers by URL, recording every call. */
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    for (const [match, answer] of routes) {
      if (typeof match === 'string' ? url.startsWith(match) : match.test(url)) {
        return typeof answer === 'function' ? answer(url) : answer;
      }
    }
    return response({ error: 'no route' }, { status: 404 });
  };
  return { impl, calls };
}

test('URL builders: tabular pages with bbox filters and columns, WFS in CRS:84, ODS in_bbox', () => {
  const geometry = { shape: 'lonlat', lon: 'lng', lat: 'lat' };
  const url = new URL(tabularDataUrl('abc', { page: 2, columns: ['nom', 'lng', 'lat'], bbox: { west: 2, south: 48, east: 3, north: 49 }, geometry }));
  assert.equal(url.searchParams.get('page'), '2');
  assert.equal(url.searchParams.get('page_size'), String(TABULAR_PAGE_SIZE));
  assert.equal(url.searchParams.get('columns'), 'nom,lng,lat');
  assert.equal(url.searchParams.get('lng__greater'), '2');
  assert.equal(url.searchParams.get('lat__less'), '49');
  const noBox = new URL(tabularDataUrl('abc', { bbox: { west: 2, south: 48, east: 3, north: 49 }, geometry: { shape: 'point', point: 'p' } }));
  assert.equal(noBox.searchParams.has('p__greater'), false, 'a point cell cannot be range-filtered');

  const wfs = new URL(wfsGetFeatureUrl({ url: 'https://data.geopf.fr/wfs/ows', typeName: 'BDTOPO_V3:aerodrome', maxFeatures: 500 }, { bbox: { west: 2.25, south: 48.81, east: 2.42, north: 48.9 } }));
  assert.equal(wfs.searchParams.get('typeNames'), 'BDTOPO_V3:aerodrome');
  assert.equal(wfs.searchParams.get('srsName'), 'CRS:84');
  assert.equal(wfs.searchParams.get('bbox'), '2.25,48.81,2.42,48.9,CRS:84');
  assert.equal(wfs.searchParams.get('count'), '500');

  const ods = new URL(opendatasoftExportUrl({ url: 'https://opendata.paris.fr/', dataset: 'arbres', geoField: 'geom', maxFeatures: 100 }, { bbox: { west: 2.33, south: 48.85, east: 2.37, north: 48.87 } }));
  assert.equal(ods.pathname, '/api/explore/v2.1/catalog/datasets/arbres/exports/geojson');
  assert.equal(ods.searchParams.get('where'), 'in_bbox(geom, 48.85, 2.33, 48.87, 2.37)');
  assert.equal(ods.searchParams.get('limit'), '100');
  assert.equal(datagouvResourceLatestUrl('x-y'), 'https://www.data.gouv.fr/api/1/datasets/r/x-y');
  assert.equal(relayUrl('https://a.b/c?d=1'), '/api/plug?url=https%3A%2F%2Fa.b%2Fc%3Fd%3D1');
});

test('normalizeBbox refuses a degenerate or out-of-range box', () => {
  assert.deepEqual(normalizeBbox({ west: 1, south: 2, east: 3, north: 4 }), { west: 1, south: 2, east: 3, north: 4 });
  assert.equal(normalizeBbox({ west: 3, south: 2, east: 1, north: 4 }), null);
  assert.equal(normalizeBbox({ west: -200, south: 2, east: 1, north: 4 }), null);
  assert.equal(normalizeBbox(null), null);
});

test('tabularColumnsFor asks only for what the manifest names, geometry included', () => {
  const manifest = normalizeDatasetManifest({
    id: 'x1', label: 'X', attribution: ATTRIBUTION,
    source: { kind: 'datagouv', resourceId: 'eb76d20a-8501-400e-b336-d85724de5435' },
    geometry: { lon: 'lng', lat: 'lat' },
    feature: { title: ['nom'], details: ['adresse', { field: 'kw' }], group: { field: 'type', styles: { a: { color: '#000000' } } } },
  });
  assert.deepEqual(tabularColumnsFor(manifest), ['lng', 'lat', 'nom', 'adresse', 'kw', 'type']);
  const bare = normalizeDatasetManifest({
    id: 'x1', label: 'X', attribution: ATTRIBUTION,
    source: { kind: 'datagouv', resourceId: 'eb76d20a-8501-400e-b336-d85724de5435' },
    geometry: { lon: 'lng', lat: 'lat' },
  });
  assert.equal(tabularColumnsFor(bare), null, 'no fields declared means every column');
});

test('featuresFromGeoJson accepts a collection, a feature and an array, refuses the rest', () => {
  const feature = { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} };
  assert.equal(featuresFromGeoJson({ type: 'FeatureCollection', features: [feature] }).length, 1);
  assert.equal(featuresFromGeoJson(feature).length, 1);
  assert.equal(featuresFromGeoJson([feature, { type: 'Nope' }]).length, 1);
  assert.throws(() => featuresFromGeoJson({ hello: 'world' }), DatasetSourceError);
});

test('fetchDatasetText goes direct, and through the relay only on a CORS-shaped failure', async () => {
  const direct = fakeFetch([['https://ok.test/', response('hello')]]);
  const got = await fetchDatasetText('https://ok.test/a', { fetchImpl: direct.impl });
  assert.equal(got.text, 'hello');
  assert.equal(got.via, 'direct');

  const blocked = fakeFetch([
    ['https://insee.test/', () => { throw new TypeError('Failed to fetch'); }],
    ['/api/plug?url=', response('relayed')],
  ]);
  const relayed = await fetchDatasetText('https://insee.test/x.csv', { fetchImpl: blocked.impl });
  assert.equal(relayed.text, 'relayed');
  assert.equal(relayed.via, 'relay');
  assert.equal(blocked.calls[1], '/api/plug?url=https%3A%2F%2Finsee.test%2Fx.csv');

  const forbidden = fakeFetch([
    ['https://insee.test/', response('', { status: 403 })],
    ['/api/plug?url=', response('relayed')],
  ]);
  assert.equal((await fetchDatasetText('https://insee.test/y', { fetchImpl: forbidden.impl })).via, 'relay');

  const notFound = fakeFetch([['https://ok.test/', response('', { status: 404 })]]);
  await assert.rejects(fetchDatasetText('https://ok.test/missing', { fetchImpl: notFound.impl }), (error) => error.status === 404);

  const noRelay = fakeFetch([['https://insee.test/', () => { throw new TypeError('Failed to fetch'); }]]);
  await assert.rejects(fetchDatasetText('https://insee.test/x', { fetchImpl: noRelay.impl, relay: null }), DatasetSourceError);
  assert.equal(noRelay.calls.length, 1, 'no relay means no second attempt');
});

test('fetchDatasetText refuses a declared size above the ceiling before reading', async () => {
  const big = fakeFetch([['https://ok.test/', response('x', { headers: { 'content-length': String(200 * 1024 * 1024) } })]]);
  await assert.rejects(fetchDatasetText('https://ok.test/big.csv', { fetchImpl: big.impl }), /trop volumineux/);
});

test('a CSV manifest loads, clips at maxFeatures and counts what it could not place', async () => {
  const manifest = normalizeDatasetManifest({
    id: 'csv-test', label: 'CSV', attribution: ATTRIBUTION,
    source: { kind: 'csv', url: 'https://files.test/a.csv', maxFeatures: 2 },
    geometry: { lon: 'lon', lat: 'lat' },
    feature: { title: ['nom'] },
  });
  const csv = 'nom;lon;lat\nA;2.35;48.86\nB;;\nC;2.36;48.87\nD;2.37;48.88\n';
  const fetch = fakeFetch([['https://files.test/', response(csv)]]);
  const result = await loadDatasetFeatures(manifest, { fetchImpl: fetch.impl, relay: null });
  assert.equal(result.features.length, 1, 'two rows read (cap), one of them unplaced');
  assert.equal(result.unplaced, 1);
  assert.equal(result.total, 4);
  assert.equal(result.truncated, true);
  assert.equal(result.features[0].properties.name, 'A');
});

test('a GeoJSON manifest decorates native features and keeps their ids', async () => {
  const manifest = normalizeDatasetManifest({
    id: 'gj', label: 'GJ', attribution: ATTRIBUTION,
    source: { kind: 'geojson', url: 'https://files.test/a.geojson' },
    feature: { title: ['libelle'] },
  });
  const collection = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', id: 'k1', geometry: { type: 'Point', coordinates: [2, 48] }, properties: { libelle: 'Un' } },
      { type: 'Feature', geometry: null, properties: { libelle: 'Sans géométrie' } },
    ],
  };
  const fetch = fakeFetch([['https://files.test/', response(collection)]]);
  const result = await loadDatasetFeatures(manifest, { fetchImpl: fetch.impl, relay: null });
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].id, 'gj:k1');
  assert.equal(result.features[0].properties.name, 'Un');
  assert.equal(result.total, 1);
});

test('a data.gouv manifest pages through the Tabular API with the view box, and stops at the cap', async () => {
  const manifest = normalizeDatasetManifest({
    id: 'dg', label: 'DG', attribution: ATTRIBUTION,
    source: { kind: 'datagouv', resourceId: 'eb76d20a-8501-400e-b336-d85724de5435', scope: 'viewport', maxFeatures: 3 },
    geometry: { lon: 'lng', lat: 'lat' },
    feature: { title: ['nom'] },
  });
  const rows = (page) => ({
    data: [
      { nom: `A${page}`, lng: 2.3, lat: 48.8 },
      { nom: `B${page}`, lng: 2.31, lat: 48.81 },
    ],
    meta: { page, page_size: 200, total: 10 },
    links: { next: page < 5 ? 'next' : null },
  });
  const fetch = fakeFetch([[/tabular-api\.data\.gouv\.fr/, (url) => response(rows(Number(new URL(url).searchParams.get('page'))))]]);
  const result = await loadDatasetFeatures(manifest, {
    fetchImpl: fetch.impl, relay: null, bbox: { west: 2, south: 48, east: 3, north: 49 },
  });
  assert.equal(fetch.calls.length, 2, 'three rows wanted, two per page → two pages');
  assert.ok(fetch.calls[0].includes('lng__greater=2'));
  assert.ok(fetch.calls[0].includes('columns=lng%2Clat%2Cnom'));
  assert.equal(result.features.length, 3);
  assert.equal(result.total, 10);
  assert.equal(result.truncated, true);
  assert.equal(result.via, 'tabular');
});

test('a data.gouv resource the Tabular API never indexed falls back to the raw file', async () => {
  const manifest = normalizeDatasetManifest({
    id: 'raw', label: 'Raw', attribution: ATTRIBUTION,
    source: { kind: 'datagouv', resourceId: 'eb76d20a-8501-400e-b336-d85724de5435' },
    geometry: { point: 'coordonneesXY' },
  });
  const fetch = fakeFetch([
    [/tabular-api\.data\.gouv\.fr/, response({ detail: 'not found' }, { status: 404 })],
    ['https://www.data.gouv.fr/api/1/datasets/r/', response('nom,coordonneesXY\nA,"[2.3, 48.8]"\n')],
  ]);
  const result = await loadDatasetFeatures(manifest, { fetchImpl: fetch.impl, relay: null });
  assert.equal(result.via, 'raw');
  assert.equal(result.features.length, 1);
  assert.deepEqual(result.features[0].geometry.coordinates, [2.3, 48.8]);
});

test('a WFS manifest reports numberMatched as the total and clipping honestly', async () => {
  const manifest = normalizeDatasetManifest({
    id: 'wfs', label: 'WFS', attribution: ATTRIBUTION,
    source: { kind: 'wfs', url: 'https://data.geopf.fr/wfs/ows', typeName: 'BDTOPO_V3:aerodrome', scope: 'viewport', maxFeatures: 1 },
    feature: { title: ['toponyme'] },
  });
  const payload = {
    type: 'FeatureCollection',
    numberMatched: 4,
    features: [{ type: 'Feature', id: 'aerodrome.1', geometry: { type: 'Point', coordinates: [2.3, 48.8] }, properties: { toponyme: 'X' } }],
  };
  const fetch = fakeFetch([[/data\.geopf\.fr/, response(payload)]]);
  const result = await loadDatasetFeatures(manifest, { fetchImpl: fetch.impl, relay: null, bbox: { west: 2, south: 48, east: 3, north: 49 } });
  assert.equal(result.total, 4);
  assert.equal(result.truncated, true);
  assert.equal(result.features[0].id, 'wfs:aerodrome.1');
  assert.ok(fetch.calls[0].includes('bbox=2%2C48%2C3%2C49%2CCRS%3A84'));
});

test('an unknown kind is refused before any request', async () => {
  await assert.rejects(loadDatasetFeatures({ source: { kind: 'nope' } }, { fetchImpl: async () => { throw new Error('must not fetch'); } }), DatasetSourceError);
});
