// src/data/vigicruesFeed.test.mjs
// Pins the UPSTREAM Vigicrues shape against a real captured InfoVigiCru
// response. This is the projection the dev-server proxy runs, so it is the
// code that breaks first if the SCHAPI changes the feed — and the only part
// of the Vigicrues path a browser test would never see.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  VIGICRUES_COORDINATE_DECIMALS,
  projectVigicruesFeed,
} from './vigicruesFeed.js';

const SAMPLE = JSON.parse(readFileSync(
  new URL('./fixtures/vigicrues-infovigicru-sample.geojson', import.meta.url),
  'utf8',
));

test('the captured upstream response still carries every field the projection reads', () => {
  assert.equal(SAMPLE.type, 'FeatureCollection');
  assert.equal(typeof SAMPLE.DtHrInfoVigiCru, 'string');
  assert.equal(typeof SAMPLE.RefInfoVigiCru, 'string');
  assert.ok(SAMPLE.features.length >= 3);
  for (const feature of SAMPLE.features) {
    assert.equal(feature.geometry.type, 'MultiLineString');
    for (const key of ['NivInfViCr', 'CdEntCru', 'lbentcru', 'dhmentcru']) {
      assert.ok(Object.hasOwn(feature.properties, key), `${key} must still be published`);
    }
  }
});

test('projection splits the feed into levels, geometry, and a publication stamp', () => {
  const projected = projectVigicruesFeed(SAMPLE);
  assert.equal(projected.updateTime, '2026-08-25T13:55:59+00:00');
  assert.equal(projected.reference, '25082026_16');
  assert.equal(projected.reaches.length, 3);
  assert.equal(Object.keys(projected.levels).length, 3);
  assert.equal(projected.levels.CO1, 1);
  const reach = projected.reaches.find((entry) => entry.id === 'CO1');
  assert.equal(reach.name, 'Golo aval');
  assert.equal(reach.updatedAt, '2020/09/15 09:00:00.000');
  assert.ok(Array.isArray(reach.parts[0]));
});

test('an absent or out-of-domain level projects to null, never to green', () => {
  const mutate = (value) => {
    const clone = JSON.parse(JSON.stringify(SAMPLE));
    clone.features[0].properties.NivInfViCr = value;
    return projectVigicruesFeed(clone).levels.CO1;
  };
  assert.equal(mutate(1), 1);
  assert.equal(mutate(4), 4);
  for (const bad of [null, undefined, 0, 5, -1, 'vert', 2.5]) {
    assert.equal(mutate(bad), null, `${JSON.stringify(bad)} must project to null`);
  }
});

test('geometryVersion tracks the drawn shape, not the bulletin', () => {
  const baseline = projectVigicruesFeed(SAMPLE).geometryVersion;
  assert.match(baseline, /^[0-9a-f]{16}$/);

  // A new bulletin with different colours is the common case, and it must NOT
  // invalidate the client's cached geometry.
  const recoloured = JSON.parse(JSON.stringify(SAMPLE));
  recoloured.RefInfoVigiCru = '26082026_10';
  recoloured.DtHrInfoVigiCru = '2026-08-26T07:55:23+00:00';
  recoloured.features[0].properties.NivInfViCr = 3;
  assert.equal(projectVigicruesFeed(recoloured).geometryVersion, baseline);

  // A redrawn reach must.
  const redrawn = JSON.parse(JSON.stringify(SAMPLE));
  redrawn.features[0].geometry.coordinates[0].push([9.3, 42.5]);
  assert.notEqual(projectVigicruesFeed(redrawn).geometryVersion, baseline);

  // So must a reach appearing or disappearing.
  const dropped = JSON.parse(JSON.stringify(SAMPLE));
  dropped.features.pop();
  assert.notEqual(projectVigicruesFeed(dropped).geometryVersion, baseline);
});

test('coordinates are rounded to metre precision and nothing else is thinned', () => {
  const projected = projectVigicruesFeed({
    features: [{
      properties: { CdEntCru: 'X1', lbentcru: 'Test', NivInfViCr: 2 },
      geometry: {
        type: 'LineString',
        coordinates: [
          [9.195252341, 42.482751234],
          [9.200084999, 42.481741111],
          [9.203850000, 42.475910000],
        ],
      },
    }],
  });
  assert.equal(VIGICRUES_COORDINATE_DECIMALS, 5);
  assert.deepEqual(projected.reaches[0].parts[0], [
    [9.19525, 42.48275],
    [9.20008, 42.48174],
    [9.20385, 42.47591],
  ]);
  // No Douglas-Peucker: every published vertex survives. On this feed a 25 m
  // tolerance removes 60 of 56,110 vertices, and the only tolerance that pays
  // visibly straightens rivers.
  assert.equal(projected.reaches[0].parts[0].length, 3);
});

test('undrawable geometry is dropped rather than emitted as an empty reach', () => {
  const projected = projectVigicruesFeed({
    features: [
      { properties: { CdEntCru: 'P1' }, geometry: { type: 'Point', coordinates: [1, 2] } },
      { properties: { CdEntCru: 'E1' }, geometry: { type: 'MultiLineString', coordinates: [] } },
      { properties: { CdEntCru: 'S1' }, geometry: { type: 'LineString', coordinates: [[1, 2]] } },
      { properties: { CdEntCru: 'N1' }, geometry: { type: 'LineString', coordinates: [['a', 'b'], ['c', 'd']] } },
      { properties: { CdEntCru: 'OK' }, geometry: { type: 'LineString', coordinates: [[1, 2], [3, 4]] } },
    ],
  });
  assert.deepEqual(projected.reaches.map((reach) => reach.id), ['OK']);
  assert.deepEqual(Object.keys(projected.levels), ['OK']);
});

test('a reach with no code falls back to a stable index id', () => {
  const projected = projectVigicruesFeed({
    features: [
      {}, // dropped: no geometry
      { properties: {}, geometry: { type: 'LineString', coordinates: [[1, 2], [3, 4]] } },
    ],
  });
  assert.deepEqual(projected.reaches.map((reach) => reach.id), ['troncon-1']);
});

test('an empty or malformed body projects to an empty, non-throwing document', () => {
  for (const input of [null, undefined, {}, { features: null }, 'nope']) {
    const projected = projectVigicruesFeed(input);
    assert.deepEqual(projected.reaches, []);
    assert.deepEqual(projected.levels, {});
    assert.equal(projected.updateTime, null);
    assert.equal(projected.reference, null);
    assert.equal(typeof projected.geometryVersion, 'string');
  }
});
