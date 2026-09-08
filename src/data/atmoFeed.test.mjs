// src/data/atmoFeed.test.mjs
// Pins the ATMO federation against a real captured WFS answer holding all four
// traps at once: three spellings of `type_zone`, six Guyanese communes sharing
// one `code_zone`, a `x_wgs84` column carrying UTM metres, and a publisher
// whose forecast is one day shorter than its neighbours'.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ATMO_POLLUTANTS,
  ATMO_SCALE,
  ATMO_TYPENAME,
  atmoBand,
  buildAtmoBoxUrl,
  buildAtmoZoneUrl,
  drivingPollutants,
  fromWebMercator,
  normaliseAtmoFeature,
  pickAtmoZone,
  projectAtmo,
} from './atmoFeed.js';

const SAMPLE = JSON.parse(readFileSync(
  new URL('./fixtures/atmo-france-zones-sample.json', import.meta.url),
  'utf8',
));
const TODAY = '2026-09-08';

const rowsFor = (code) => SAMPLE.features
  .map(normaliseAtmoFeature)
  .filter((row) => row && row.code === code);

const only = (code) => ({
  type: 'FeatureCollection',
  features: SAMPLE.features.filter((f) => f.properties.code_zone === code),
});

test('the captured answer still carries every field the projection reads', () => {
  const properties = SAMPLE.features[0].properties;
  for (const key of ['code_zone', 'type_zone', 'lib_zone', 'code_qual', 'date_ech', 'source']) {
    assert.ok(Object.hasOwn(properties, key), `${key} must still be published`);
  }
  for (const pollutant of ATMO_POLLUTANTS) {
    assert.ok(Object.hasOwn(properties, pollutant.column));
  }
  assert.equal(SAMPLE.features.length, 23);
});

test('three spellings of type_zone are one scale', () => {
  // `commune`, `COMMUNE` and `Commune` all appear across the seventeen
  // publishers; a filter written against one of them loses a whole région.
  const declared = new Set(SAMPLE.features.map((f) => f.properties.type_zone));
  assert.ok(declared.size > 1);
  const scales = new Set(SAMPLE.features.map((f) => normaliseAtmoFeature(f).scale));
  assert.deepEqual([...scales].sort(), ['commune', 'epci']);
});

test('a nine-digit code_zone is an EPCI even when the publisher says commune', () => {
  const cayenne = rowsFor('249730045')[0];
  assert.equal(cayenne.declaredScale, 'commune');
  assert.equal(cayenne.scale, 'epci');
});

test('code_zone is not a key — six communes share one', () => {
  const guyane = rowsFor('249730045').filter((row) => row.date === TODAY);
  assert.equal(guyane.length, 6);
  assert.equal(new Set(guyane.map((row) => row.name)).size, 6);
});

test('the geometry is the only trustworthy position', () => {
  // Cayenne publishes x_wgs84 = 354028.19 — UTM metres — under a column named
  // for degrees, with epsg_reg claiming 4326. The geometry reprojects to the
  // real Cayenne.
  const raw = SAMPLE.features.find((f) => f.properties.lib_zone === 'Cayenne');
  assert.ok(raw.properties.x_wgs84 > 1000);
  const position = fromWebMercator(raw.geometry.coordinates);
  assert.ok(Math.abs(position.lon + 52.3165) < 0.01);
  assert.ok(Math.abs(position.lat - 4.9339) < 0.01);
  assert.equal(fromWebMercator([]), null);
});

test('among rows sharing one code, the nearest position wins', () => {
  const guyane = rowsFor('249730045').filter((row) => row.date === TODAY);
  const nearRoura = pickAtmoZone(guyane, { lat: 4.4614, lon: -52.5154 });
  assert.equal(nearRoura.name, 'Roura');
  assert.ok(nearRoura.distanceM < 1000);
});

test('a commune row beats the intercommunal one published at the same point', () => {
  const nantes = SAMPLE.features
    .map(normaliseAtmoFeature)
    .filter((row) => row.date === TODAY && ['44109', '244400404'].includes(row.code));
  assert.equal(nantes.length, 2);
  const picked = pickAtmoZone(nantes, { lat: 47.2333, lon: -1.5607 });
  assert.equal(picked.code, '44109');
  assert.equal(picked.scale, 'commune');
});

test('the verdict is read from code_qual, never from the published label', () => {
  // Publishers disagree about capitalisation of both `lib_qual` and
  // `coul_qual`; the scale here is the regulation's.
  const lyon = projectAtmo({ collection: only('69123'), today: TODAY });
  assert.equal(lyon.quality, 3);
  assert.equal(lyon.band.label, 'Dégradé');
  assert.equal(lyon.band.colour, '#F0E641');
  assert.equal(atmoBand(9), null);
  assert.equal(ATMO_SCALE.length, 6);
});

test('the overall index is the maximum of its sub-indices, and it names which', () => {
  const lyon = projectAtmo({ collection: only('69123'), today: TODAY });
  const worst = Math.max(...lyon.pollutants.map((p) => p.quality));
  assert.equal(worst, lyon.quality);
  assert.ok(lyon.driving.length >= 1);
  assert.equal(drivingPollutants({ quality: 3, pollutants: { o3: 3, no2: 1 } })[0], 'ozone');
});

test('the forecast horizon differs by publisher and is reported as found', () => {
  // Lyon publishes J, J+1 and J+2; Paris that day published J and J+1 only.
  const lyon = projectAtmo({ collection: only('69123'), today: TODAY });
  const paris = projectAtmo({ collection: only('75056'), today: TODAY });
  assert.equal(lyon.forecast.length, 2);
  assert.equal(paris.forecast.length, 1);
  assert.ok(lyon.forecast.every((day) => day.date > TODAY && day.band));
});

test('an intercommunal answer is flagged borrowed even without the box query', () => {
  const cayenne = projectAtmo({
    collection: only('249730045'),
    point: { lat: 4.9339, lon: -52.3165 },
    today: TODAY,
  });
  assert.equal(cayenne.zone.name, 'Cayenne');
  assert.equal(cayenne.borrowed, true);
  const nantes = projectAtmo({
    collection: only('44109'), point: { lat: 47.2333, lon: -1.5607 }, today: TODAY,
  });
  assert.equal(nantes.borrowed, false);
});

test('a day the agency has not published yet falls forward, not to nothing', () => {
  const lyon = projectAtmo({ collection: only('69123'), today: '2026-09-07' });
  assert.equal(lyon.date, '2026-09-08');
});

test('the URLs quote a validated code and ask the right layer', () => {
  const url = new URL(buildAtmoZoneUrl('2A004'));
  assert.equal(url.searchParams.get('typeNames'), ATMO_TYPENAME);
  assert.equal(url.searchParams.get('CQL_FILTER'), "code_zone='2A004'");
  assert.equal(buildAtmoZoneUrl("75056' OR '1'='1"), null);
  assert.equal(buildAtmoZoneUrl(''), null);
  const box = new URL(buildAtmoBoxUrl({ lat: 47.2333, lon: -1.5607 }, 0.25));
  assert.match(box.searchParams.get('CQL_FILTER'), /^BBOX\(the_geom,-1\.8107,46\.9833,-1\.3107,47\.4833,'EPSG:4326'\)$/);
  assert.equal(buildAtmoBoxUrl({ lat: NaN, lon: 0 }), null);
});

test('an empty answer is null, not a zero-quality index', () => {
  assert.equal(projectAtmo({ collection: { features: [] } }), null);
  assert.equal(projectAtmo({ collection: null }), null);
  assert.equal(normaliseAtmoFeature({ properties: { code_zone: '75056' } }), null);
});
