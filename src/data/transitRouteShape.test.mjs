// The line under a vehicle: indexing a PAN GeoJSON conversion, and deciding
// which of a line's published traces a given run is on.
//
// The claim this module has to earn is the second one. A French bus line
// publishes several shape variants and the conversion drops the `shape_id`
// that would say which trip uses which, so the choice is made against the
// trip's own stops. What is pinned here is that the choice is EVIDENCE-driven:
// a run whose stops sit on one branch picks that branch, and a run whose stops
// sit on none of them picks nothing rather than the least-bad one.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseTripShape,
  distanceToPathMeters,
  gtfsColorToCss,
  haversineMeters,
  indexGtfsGeoJson,
  pathLengthMeters,
  simplifyPath,
  SHAPE_MATCH_MAX_M,
} from './transitRouteShape.js';

/** A straight west→east segment at Bordeaux's latitude, sampled every ~11 m. */
function eastwardPath(lon0, lat, steps = 40, stepDeg = 0.0001) {
  return Array.from({ length: steps }, (_unused, i) => [lon0 + i * stepDeg, lat]);
}

test('a GTFS colour is read from the converter\'s rgb() and from raw GTFS hex', () => {
  // What the PAN's converter actually emits.
  assert.equal(gtfsColorToCss('rgb(0,177,235)'), '#00b1eb');
  assert.equal(gtfsColorToCss('rgb(255, 255, 255)'), '#ffffff');
  // What raw `routes.txt` carries: six hex digits, no hash.
  assert.equal(gtfsColorToCss('00B1EB'), '#00b1eb');
  assert.equal(gtfsColorToCss('#0f0'), '#00ff00');
  // A line with no published colour gets NO colour — never a default that
  // would look as official as an operator's own.
  assert.equal(gtfsColorToCss(''), null);
  assert.equal(gtfsColorToCss(null), null);
  assert.equal(gtfsColorToCss('bleu'), null);
  assert.equal(gtfsColorToCss('rgb(0,300,0)'), null);
});

test('the index keeps a line\'s name, colour and every variant, and stops by id', () => {
  const document = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-0.543587, 44.859651] },
        properties: { id: '606', code: 'CHA03A', name: 'Chantiers de la Garonne' },
      },
      {
        // A stop whose code repeats its name carries no code: the panel would
        // print the same string twice.
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-0.56, 44.86] },
        properties: { id: 'BSCOQUA', code: 'Quatre Lagunes', name: 'Quatre Lagunes' },
      },
      // Null Island is where a converter puts a point it could not read.
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: { id: 'broken', name: 'nowhere' },
      },
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: eastwardPath(-0.6, 44.86) },
        properties: {
          route_id: '07',
          route_short_name: '7',
          route_long_name: 'Lianes 7',
          route_color: 'rgb(0,177,235)',
          route_text_color: 'rgb(255,255,255)',
        },
      },
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: eastwardPath(-0.6, 44.87) },
        properties: { route_id: '07', route_short_name: '7' },
      },
    ],
  };

  const { routes, stops, stats } = indexGtfsGeoJson(document);
  assert.equal(stats.routeCount, 1);
  assert.equal(stats.shapeCount, 2);
  assert.equal(stats.stopCount, 2);

  const line = routes['07'];
  assert.equal(line.shortName, '7');
  assert.equal(line.longName, 'Lianes 7');
  assert.equal(line.color, '#00b1eb');
  assert.equal(line.shapes.length, 2);

  assert.deepEqual(stops['606'], [-0.543587, 44.859651, 'Chantiers de la Garonne', 'CHA03A']);
  assert.equal(stops.BSCOQUA[3], null);
  assert.equal(stops.broken, undefined);
});

test('simplification keeps the endpoints and the corner, and drops the filler', () => {
  // A dogleg: 20 collinear points, a right-angle turn, 20 more.
  const path = [
    ...Array.from({ length: 20 }, (_unused, i) => [-0.6 + i * 0.0002, 44.86]),
    ...Array.from({ length: 20 }, (_unused, i) => [-0.6 + 19 * 0.0002, 44.86 + (i + 1) * 0.0002]),
  ];
  const simplified = simplifyPath(path, 2);
  assert.deepEqual(simplified[0], path[0]);
  assert.deepEqual(simplified[simplified.length - 1], path[path.length - 1]);
  // The corner survives — that is the point of the tolerance being in metres.
  assert.ok(simplified.some(([lon, lat]) => lon === path[19][0] && lat === path[19][1]));
  assert.ok(simplified.length < 8, `expected a handful of vertices, kept ${simplified.length}`);
  // And the line it describes is still the same line on the ground.
  assert.ok(Math.abs(pathLengthMeters(simplified) - pathLengthMeters(path)) < 1);
});

test('a two-point path and a zero tolerance are returned untouched', () => {
  const path = [[-0.6, 44.86], [-0.59, 44.87]];
  assert.deepEqual(simplifyPath(path, 5), path);
  const long = eastwardPath(-0.6, 44.86, 10);
  assert.equal(simplifyPath(long, 0).length, 10);
});

test('distance to a path is measured to the segment, not to the nearest vertex', () => {
  // Two vertices 1 km apart; a point beside the middle of the segment is 50 m
  // from the LINE and ~500 m from either end.
  const path = [[-0.6, 44.86], [-0.6, 44.869]];
  const beside = [-0.6 + 0.00063, 44.8645];
  const distance = distanceToPathMeters(beside, path);
  assert.ok(distance > 40 && distance < 60, `expected ~50 m, got ${distance}`);
  assert.ok(haversineMeters(beside, path[0]) > 400);
  assert.equal(distanceToPathMeters(beside, []), Infinity);
});

test('the variant a run is on is the one that carries every one of its stops', () => {
  const northBranch = eastwardPath(-0.6, 44.8700, 60);
  const southBranch = eastwardPath(-0.6, 44.8600, 60);
  // A run that stops along the south branch.
  const stops = [[-0.599, 44.8600], [-0.596, 44.86002], [-0.5945, 44.8600]];

  const choice = chooseTripShape([northBranch, southBranch], stops);
  assert.equal(choice.index, 1);
  assert.ok(choice.maxDeviationM <= 5, `expected metres, got ${choice.maxDeviationM}`);
  assert.equal(choice.medianDeviationM, 0);
});

test('a run whose worst stop is off every variant chooses none of them', () => {
  const branch = eastwardPath(-0.6, 44.8600, 60);
  // Two stops on the branch, one 1.1 km north of it — a different branch of
  // the same line. Averaging would hide it behind the two good matches.
  const stops = [[-0.599, 44.8600], [-0.596, 44.8600], [-0.5945, 44.8700]];

  const choice = chooseTripShape([branch], stops);
  assert.equal(choice.index, null);
  assert.ok(choice.maxDeviationM > SHAPE_MATCH_MAX_M);
  // The measurement is still reported: "no variant fits, and here is by how
  // much" is a more useful answer than a bare null.
  assert.ok(choice.medianDeviationM < choice.maxDeviationM);
});

test('with no traces or no stops there is no evidence, and nothing is chosen', () => {
  assert.deepEqual(
    chooseTripShape([], [[-0.6, 44.86]]),
    { index: null, maxDeviationM: null, medianDeviationM: null },
  );
  assert.deepEqual(
    chooseTripShape([eastwardPath(-0.6, 44.86)], []),
    { index: null, maxDeviationM: null, medianDeviationM: null },
  );
});
