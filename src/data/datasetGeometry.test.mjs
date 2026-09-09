import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDatasetManifest } from './datasetManifest.js';
import {
  detectGeometry,
  normalizeColumnName,
  parseDecimal,
  parsePointCell,
  parseWktPoint,
  rowPosition,
  rowTitle,
  rowToFeature,
} from './datasetGeometry.js';

test('column names normalize across case, accents and separators', () => {
  assert.equal(normalizeColumnName('Coordonnées XY'), 'coordonnees_xy');
  assert.equal(normalizeColumnName('Geo Point 2D'), 'geo_point_2d');
  assert.equal(normalizeColumnName('  LATITUDE '), 'latitude');
});

test('decimals read the French comma and thin spaces', () => {
  assert.equal(parseDecimal('48,86'), 48.86);
  assert.equal(parseDecimal('1 234,5'), 1234.5);
  assert.equal(parseDecimal('2.35'), 2.35);
  assert.ok(Number.isNaN(parseDecimal('')));
  assert.ok(Number.isNaN(parseDecimal(null)));
});

test('WKT points, with and without Z, in any case', () => {
  assert.deepEqual(parseWktPoint('POINT (2.35 48.86)'), [2.35, 48.86]);
  assert.deepEqual(parseWktPoint('point(2.35 48.86)'), [2.35, 48.86]);
  assert.deepEqual(parseWktPoint('POINT Z (2.35 48.86 35)'), [2.35, 48.86]);
  assert.deepEqual(parseWktPoint('SRID=4326;POINT(2.35 48.86)'), [2.35, 48.86]);
  assert.equal(parseWktPoint('POLYGON ((0 0, 1 0, 1 1, 0 0))'), null);
  assert.equal(parseWktPoint('POINT (200 48)'), null);
});

test('point cells: JSON array is lon-first, bare pair is lat-first, objects by key', () => {
  assert.deepEqual(parsePointCell('[2.367618, 49.877237]'), [2.367618, 49.877237]);
  assert.deepEqual(parsePointCell([2.367618, 49.877237]), [2.367618, 49.877237]);
  assert.deepEqual(parsePointCell('49.877237, 2.367618'), [2.367618, 49.877237]);
  assert.deepEqual(parsePointCell('49.877237,2.367618'), [2.367618, 49.877237]);
  assert.deepEqual(parsePointCell({ lon: 2.36, lat: 48.87 }), [2.36, 48.87]);
  assert.deepEqual(parsePointCell('{"lon":2.36,"lat":48.87}'), [2.36, 48.87]);
  // A Channel point: both numbers under 51 — syntax decides, not magnitude.
  assert.deepEqual(parsePointCell('[1.2, 50.1]'), [1.2, 50.1]);
  assert.deepEqual(parsePointCell('50.1, 1.2'), [1.2, 50.1]);
  assert.equal(parsePointCell(''), null);
  assert.equal(parsePointCell('abc'), null);
});

test('detects lon/lat pairs, point cells, WKT and Lambert-93 from names and values', () => {
  assert.deepEqual(detectGeometry(['nom', 'Longitude', 'Latitude']), {
    geometry: { lon: 'Longitude', lat: 'Latitude' }, reason: 'colonnes Longitude / Latitude',
  });
  assert.deepEqual(detectGeometry(['nom', 'consolidated_longitude', 'consolidated_latitude'], [
    { consolidated_longitude: 2.36, consolidated_latitude: 48.87 },
  ]).geometry, { lon: 'consolidated_longitude', lat: 'consolidated_latitude' });
  assert.deepEqual(detectGeometry(['nom_station', 'coordonneesXY'], [{ coordonneesXY: '[2.36, 48.87]' }]).geometry, { point: 'coordonneesXY' });
  assert.deepEqual(detectGeometry(['id', 'geo_point_2d'], [{ geo_point_2d: '48.87, 2.36' }]).geometry, { point: 'geo_point_2d' });
  assert.deepEqual(detectGeometry(['id', 'geom'], [{ geom: 'POINT (2.36 48.87)' }]).geometry, { wkt: 'geom' });
  const lambert = detectGeometry(['nom', 'x', 'y'], [{ x: '652000', y: '6862000' }]);
  assert.deepEqual(lambert.geometry, { x: 'x', y: 'y', crs: 'EPSG:2154' });
  assert.match(lambert.reason, /Lambert-93/);
  assert.deepEqual(detectGeometry(['nom', 'x', 'y'], [{ x: '2.36', y: '48.87' }]).geometry, { lon: 'x', lat: 'y' });
  assert.equal(detectGeometry(['nom', 'x', 'y']), null, 'bare x/y with no sample is not guessed');
  assert.equal(detectGeometry(['nom', 'adresse']), null);
});

test('a lone lat-like / lon-like pair is accepted by resemblance when the values are degrees', () => {
  const guess = detectGeometry(['c_nom', 'c_lat_coor1', 'c_long_coor1'], [{ c_lat_coor1: 47.75, c_long_coor1: -3.36 }]);
  assert.deepEqual(guess.geometry, { lon: 'c_long_coor1', lat: 'c_lat_coor1' });
  assert.match(guess.reason, /ressemblance/);
  assert.equal(detectGeometry(['c_lat_coor1', 'c_long_coor1']), null, 'no sample, no resemblance guess');
  assert.equal(detectGeometry(['lat_a', 'lat_b', 'lon_a'], [{ lat_a: 1, lat_b: 2, lon_a: 3 }]), null, 'two lat-like columns is ambiguous');
});

test('a lon/lat header whose sample is out of range is not trusted', () => {
  assert.equal(detectGeometry(['lon', 'lat'], [{ lon: '652000', lat: '6862000' }]), null);
});

function manifestWith(geometry, feature) {
  return normalizeDatasetManifest({
    id: 'geo-test',
    label: 'Geo test',
    source: { kind: 'csv', url: 'https://example.org/x.csv' },
    geometry,
    feature,
    attribution: { publisher: 'P', licence: 'L' },
  });
}

test('rowPosition under each shape, including Lambert-93 reprojection', () => {
  assert.deepEqual(rowPosition({ lon: '2,35', lat: '48,86' }, manifestWith({ lon: 'lon', lat: 'lat' }).geometry), [2.35, 48.86]);
  assert.deepEqual(rowPosition({ p: '[2.35, 48.86]' }, manifestWith({ point: 'p' }).geometry), [2.35, 48.86]);
  assert.deepEqual(rowPosition({ g: 'POINT (2.35 48.86)' }, manifestWith({ wkt: 'g' }).geometry), [2.35, 48.86]);
  const paris = rowPosition({ x: '652469', y: '6862035' }, manifestWith({ x: 'x', y: 'y', crs: 'EPSG:2154' }).geometry);
  assert.ok(Math.abs(paris[0] - 2.35) < 0.02 && Math.abs(paris[1] - 48.85) < 0.02, `Lambert-93 Paris → ${paris}`);
  assert.deepEqual(rowPosition({ g: '{"type":"Point","coordinates":[2.35,48.86]}' }, manifestWith({ geojson: 'g' }).geometry), [2.35, 48.86]);
  assert.equal(rowPosition({ lon: '', lat: '' }, manifestWith({ lon: 'lon', lat: 'lat' }).geometry), null);
});

test('rowTitle honours the manifest order, then the default ladder', () => {
  assert.equal(rowTitle({ nom: '', enseigne: 'Total' }, ['nom', 'enseigne']), 'Total');
  assert.equal(rowTitle({ Libellé: ' Gare  du Nord ' }), 'Gare du Nord');
  assert.equal(rowTitle({ foo: 'x' }), '');
});

test('rowToFeature writes the title into properties.name and keeps the row', () => {
  const manifest = manifestWith({ lon: 'lon', lat: 'lat' }, { title: ['nom'], details: ['adresse'] });
  const feature = rowToFeature({ nom: 'Borne A', lon: '2.35', lat: '48.86', adresse: '1 rue X' }, manifest, 7);
  assert.equal(feature.id, 'geo-test:7');
  assert.deepEqual(feature.geometry, { type: 'Point', coordinates: [2.35, 48.86] });
  assert.equal(feature.properties.name, 'Borne A');
  assert.equal(feature.properties.adresse, '1 rue X');
  assert.equal(rowToFeature({ nom: 'Nowhere', lon: '', lat: '' }, manifest, 8), null);
  const polygon = manifestWith({ geojson: 'geom' });
  const shaped = rowToFeature({ geom: '{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}' }, polygon, 1);
  assert.equal(shaped.geometry.type, 'Polygon');
});
