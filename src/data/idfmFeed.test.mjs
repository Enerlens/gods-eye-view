// src/data/idfmFeed.test.mjs
// Pins the UPSTREAM Île-de-France Mobilités shapes against real captured
// Opendatasoft answers. The two query builders are the fragile part: this one
// API uses TWO different coordinate orders, and both return 200 for a swapped
// pair — they just answer about the wrong part of the world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  IDFM_MODES,
  buildLinesUrl,
  buildStopsBboxUrl,
  buildStopsRadiusUrl,
  normalizeAccessibility,
  normalizeColour,
  projectLines,
  projectStops,
} from './idfmFeed.js';

const read = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const STOPS = read('idfm-arrets-sample.json');
const LINES = read('idfm-lignes-sample.json');
/** The point the stop fixture was captured around — avenue de France, Paris 13e. */
const ORIGIN = { lon: 2.3760, lat: 48.8300 };

test('the captured answers still carry every field the projection reads', () => {
  const stop = STOPS.results[0];
  for (const key of ['arrid', 'arrname', 'arrtype', 'arrtown', 'arrpostalregion',
    'arraccessibility', 'arrfarezone', 'zdaid', 'arrgeopoint']) {
    assert.ok(Object.hasOwn(stop, key), `${key} must still be published`);
  }
  // `arrpostalcode` does NOT exist; naming it in a select is HTTP 400.
  assert.equal(Object.hasOwn(stop, 'arrpostalcode'), false);
  // The geopoint is an OBJECT here, unlike the ADEME dataset's "lat,lon" string.
  assert.equal(typeof stop.arrgeopoint, 'object');
  assert.equal(typeof stop.arrgeopoint.lon, 'number');

  const line = LINES.results[0];
  for (const key of ['id_line', 'name_line', 'transportmode', 'colourweb_hexa', 'status']) {
    assert.ok(Object.hasOwn(line, key), `${key} must still be published`);
  }
});

test('the same API takes latitude first in one query and longitude first in the other', () => {
  const bbox = decodeURIComponent(buildStopsBboxUrl({
    west: 2.370, south: 48.825, east: 2.382, north: 48.835,
  }));
  // in_bbox: SOUTH, WEST, NORTH, EAST — latitude leads.
  assert.match(bbox, /in_bbox\(arrgeopoint,\+48\.825,\+2\.37,\+48\.835,\+2\.382\)/);

  const radius = decodeURIComponent(buildStopsRadiusUrl({ lon: 2.3760, lat: 48.8300, radiusM: 400 }));
  // distance: a WKT POINT, longitude first, SPACE-separated inside the literal.
  assert.match(radius, /distance\(arrgeopoint,\+geom'POINT\(2\.376\+48\.83\)',\+400m\)/);
});

test('a non-finite bound is refused rather than sent as NaN', () => {
  assert.throws(() => buildStopsBboxUrl({ west: 2, south: 48, east: NaN, north: 49 }),
    /bounds must be finite/);
  assert.throws(() => buildStopsRadiusUrl({ lon: 2, lat: undefined }), /must be finite/);
});

test('the line referential is paged, and the page size is bounded', () => {
  const url = new URL(buildLinesUrl({ offset: 200, limit: 9999 }));
  assert.equal(url.searchParams.get('offset'), '200');
  assert.equal(url.searchParams.get('limit'), '100');
});

test('stops are projected with the arrondissement code every other source hides', () => {
  const { stops, total, truncated, byMode } = projectStops(STOPS, ORIGIN);
  assert.equal(total, 43);
  assert.equal(truncated, true, '12 of 43 kept in the fixture');
  assert.deepEqual(byMode, { bus: 7, metro: 2, tram: 1, rail: 2 });
  const nearest = stops[0];
  assert.equal(nearest.distanceM, 12);
  // 75113 — the arrondissement — where geo.api.gouv.fr and Géorisques both
  // answer 75056. This is the code DVF needs and this dataset simply has it.
  assert.equal(nearest.communeCode, '75113');
  assert.equal(nearest.town, 'Paris 13e');
  for (let i = 1; i < stops.length; i += 1) {
    assert.ok(stops[i].distanceM >= stops[i - 1].distanceM, 'sorted by distance');
  }
});

test('a metro station 30 m from the door is what this layer exists to say', () => {
  const { stops } = projectStops(STOPS, ORIGIN);
  const metro = stops.find((stop) => stop.mode === 'metro');
  assert.equal(metro.name, 'Bibliothèque François Mitterrand');
  assert.equal(metro.modeLabel, 'Métro');
  assert.ok(metro.distanceM <= 35);
  assert.equal(metro.accessible, true);
});

test('an unsurveyed stop is not a stop known to be inaccessible', () => {
  // All four published values appeared in one 43-stop box.
  assert.equal(normalizeAccessibility('true'), true);
  assert.equal(normalizeAccessibility('false'), false);
  assert.equal(normalizeAccessibility('partial'), 'partial');
  assert.equal(normalizeAccessibility('unknown'), null);
  assert.equal(normalizeAccessibility(undefined), null);
  const { stops } = projectStops(STOPS, ORIGIN);
  assert.ok(stops.some((stop) => stop.accessible === null));
  assert.ok(stops.some((stop) => stop.accessible === 'partial'));
});

test('a stop with no position is dropped rather than drawn at null island', () => {
  const projected = projectStops({
    total_count: 2,
    results: [
      { arrid: '1', arrtype: 'bus', arrgeopoint: null },
      { arrid: '2', arrtype: 'bus', arrgeopoint: { lon: 2.3, lat: 48.8 } },
    ],
  });
  assert.equal(projected.stops.length, 1);
  assert.equal(projected.stops[0].id, '2');
});

test('line colours come from the publication and are never generated', () => {
  const { lines, total } = projectLines(LINES);
  assert.equal(total, 2120);
  const five = lines.find((line) => line.shortName === '5');
  assert.equal(five.mode, 'metro');
  assert.equal(five.colour, '#ff5a00');
  assert.equal(five.textColour, '#000000', 'black on orange — the real livery of line 5');
  for (const line of lines) {
    assert.ok(line.colour === null || /^#[0-9a-f]{6}$/.test(line.colour));
  }
});

test('a malformed colour becomes null rather than a broken CSS string', () => {
  assert.equal(normalizeColour('0055c8'), '#0055c8');
  assert.equal(normalizeColour('#0055C8'), '#0055c8');
  assert.equal(normalizeColour('red'), null);
  assert.equal(normalizeColour(null), null);
});

test('every published mode has a French label, and an unknown one keeps its code', () => {
  const { lines } = projectLines(LINES);
  for (const line of lines) {
    assert.equal(typeof line.modeLabel, 'string');
    assert.ok(line.modeLabel.length > 0);
  }
  assert.equal(IDFM_MODES.rail, 'RER / Transilien');
  const odd = projectLines({ results: [{ id_line: 'x', transportmode: 'hovercraft' }] });
  assert.equal(odd.lines[0].modeLabel, 'hovercraft');
});

test('an empty or missing payload projects to an empty answer, never a throw', () => {
  assert.deepEqual(projectStops(null).stops, []);
  assert.deepEqual(projectLines(undefined).lines, []);
  assert.equal(projectStops(null).total, null);
});
