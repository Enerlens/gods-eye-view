// The live French road-status layer's presentation contract.
//
// What is pinned here is the honesty of the surfaces a person reads: the card
// labels flow and speed as the six-minute averages they are rather than as a
// live speedometer, a station that counted nothing does not read as a jam, the
// legend keeps its severity order instead of reshuffling as cars clear a ramp,
// and the viewport gate refuses a question it cannot answer instead of
// cropping it.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';

import roadStatusFranceLayer, {
  ROAD_STATUS_FR_OVERLAY_SOURCE_ID,
  ROAD_STATUS_FR_OVERLAY_SOURCE_OPTIONS,
  buildRoadStatusSelectionLabel,
  createRoadStatusSelectedOverlayEntry,
  roadStatusViewportBox,
  segmentMidpoint,
  _roadStatusRowControlsForTest,
  _roadStatusStatsForTest,
  _setRoadStatusNoticeForTest,
  _setRoadStatusStateForTest,
} from './roadStatusFrance.js';
import { ROAD_STATUS_LEVELS, ROAD_STATUS_MAX_BOX_DEG } from './datexRoadStatus.js';

/** A viewer stub whose camera reports one view rectangle. */
function viewerWithView(degrees) {
  return {
    camera: {
      computeViewRectangle: () => (degrees ? Cesium.Rectangle.fromDegrees(
        degrees.west, degrees.south, degrees.east, degrees.north,
      ) : undefined),
    },
  };
}

/** One record shaped exactly as the proxy sends it, from the Bordeaux ring. */
function makeRecord(overrides = {}) {
  const segment = {
    id: 'MB133.I1',
    c: [-0.62269, 44.8835, -0.63265, 44.87688],
    s: 'freeFlow',
    d: 'DIRA',
    a: 'A630',
    z: 'BX33',
    src: ['ALIENOR'],
    at: new Date(Date.now() - 42_000).toISOString(),
    f: 410,
    v: 88.666664,
    n: 53,
    ...overrides,
  };
  return { id: `road-status-fr:${segment.id}`, segment, midpoint: segmentMidpoint(segment.c) };
}

test('the card names the road, the state, and the window the numbers cover', () => {
  const label = buildRoadStatusSelectionLabel(makeRecord());
  const [title, ...details] = label.split('\n');
  assert.match(title, /^A630 · MB133\.I1$/);
  assert.ok(details.some((line) => line.includes('Free flow')));
  // The whole point: "89 km/h" beside a live-looking colour would read as an
  // instantaneous speed, and it is a six-minute average of a loop detector.
  const measurement = details.find((line) => line.includes('veh/h'));
  assert.match(measurement, /410 veh\/h · 89 km\/h \(6-min average\)/);
  assert.ok(details.some((line) => line.includes('Bordeaux')), 'the reporting centre is named');
  assert.ok(details.some((line) => /Licence Ouverte 2\.0/.test(line)), 'attribution travels with the card');
});

test('a station that counted nothing says so, and prints no speed', () => {
  const label = buildRoadStatusSelectionLabel(makeRecord({ f: 0, v: 0 }));
  assert.match(label, /no vehicle counted in the last 6-min window/);
  assert.ok(!/km\/h/.test(label), 'a zero speed must never be drawn as stationary traffic');
});

test('a located station nobody watches is drawn, and the card does not invent a state', () => {
  const label = buildRoadStatusSelectionLabel(
    makeRecord({ s: 'unknown', src: [], at: null }),
    { flow: { windowEnd: '2026-08-31T21:00:00.000Z' } },
  );
  assert.match(label, /Not reported/);
  assert.match(label, /state not reported for this site/);
  // The count is still real and still shown: no state does not mean no data.
  assert.match(label, /410 veh\/h/);
});

test('a card on a curving segment is anchored to its middle, not to its first hop', () => {
  // 180 segments now thread the kilometre posts of a bend. Taking the first
  // pair would pin the A75's card 2 km up the road from the sensor.
  const straight = segmentMidpoint([-0.62269, 44.8835, -0.63265, 44.87688]);
  assert.ok(Math.abs(straight.lon - -0.62767) < 1e-6);

  // Five vertices: the middle one is the answer, exactly.
  const odd = segmentMidpoint([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  assert.deepEqual(odd, { lon: 2, lat: 2 });
  // Four vertices: the midpoint of the middle hop.
  const even = segmentMidpoint([0, 0, 1, 1, 3, 3, 4, 4]);
  assert.deepEqual(even, { lon: 2, lat: 2 });
  // A one-point site is still its own midpoint.
  assert.deepEqual(segmentMidpoint([5, 6]), { lon: 5, lat: 6 });
  assert.equal(segmentMidpoint([]), null);
});

test('a position resolved from a kilometre post says so; a published one does not', () => {
  // The two are drawn identically and are not the same claim. A viewer told
  // "A84 · 35A0084T096_00D, congested" over Rennes deserves to know that dot
  // came from the national bornage, because no DIR published it.
  assert.equal(/kilometre post/.test(buildRoadStatusSelectionLabel(makeRecord())), false);
  const derived = buildRoadStatusSelectionLabel(makeRecord({
    id: '35A0084T096_00D', a: 'A84', d: null, g: 'pr', src: ['TraficBreizhRennes'],
  }));
  assert.match(derived, /position resolved from its kilometre post \(PR\), median 4 m/);
  assert.match(derived, /⌖ Rennes/);
  // And it does not claim an operator the referential never named.
  assert.equal(/Operator/.test(derived), false);
});

test('the age printed is the age of the reported state', () => {
  const label = buildRoadStatusSelectionLabel(makeRecord());
  const age = /state reported (\d+)s ago/.exec(label);
  assert.ok(age, label);
  assert.ok(Number(age[1]) >= 41 && Number(age[1]) <= 45, `age was ${age[1]}s`);
});

test('the selected entry keeps the protected paint lane a clickable card needs', () => {
  const entry = createRoadStatusSelectedOverlayEntry(makeRecord());
  assert.equal(entry.id, 'road-status-fr:MB133.I1');
  assert.equal(entry.protected, true);
  assert.equal(entry.paintLane, 'selected');
  assert.equal(entry.priority, Number.MAX_SAFE_INTEGER);
  assert.ok(entry.position instanceof Cesium.Cartesian3);
  // The card sits over the middle of the segment it describes.
  const carto = Cesium.Cartographic.fromCartesian(entry.position);
  assert.ok(Math.abs(Cesium.Math.toDegrees(carto.longitude) - -0.62767) < 1e-4);
  assert.ok(Math.abs(Cesium.Math.toDegrees(carto.latitude) - 44.88019) < 1e-4);
  assert.equal(ROAD_STATUS_FR_OVERLAY_SOURCE_OPTIONS.cohortLimit, 1);
  assert.equal(ROAD_STATUS_FR_OVERLAY_SOURCE_ID, 'road-status-fr-selected');
});

test('a record with no geometry produces no card rather than a card at null island', () => {
  assert.equal(createRoadStatusSelectedOverlayEntry({ id: 'x', segment: { c: [] } }), null);
  assert.equal(createRoadStatusSelectedOverlayEntry(null), null);
});

test('a one-point station is still placeable', () => {
  // 2 of 832 referential rows carry a start and no end.
  assert.deepEqual(segmentMidpoint([1.42, 43.64]), { lon: 1.42, lat: 43.64 });
  assert.equal(segmentMidpoint([]), null);
});

test('the legend reads in severity order and omits states with nothing on screen', () => {
  _setRoadStatusStateForTest({
    payload: {
      counts: {
        freeFlow: 134, heavy: 0, congested: 2, impossible: 0, unknown: 10,
      },
    },
  });
  const { legend } = _roadStatusRowControlsForTest();
  assert.deepEqual(legend.map((row) => row.label), ['Free flow', 'Congested', 'Not reported']);
  assert.deepEqual(legend.map((row) => row.count), [134, 2, 10]);
  assert.equal(legend[0].color, ROAD_STATUS_LEVELS.freeFlow.color);
  // The one entry a viewer has to be told the meaning of.
  assert.match(legend[2].blurb, /no traffic-management centre publishes a state/);
});

test('the stats surface the coverage numbers rather than burying them', () => {
  _setRoadStatusStateForTest({
    records: new Map([['a', makeRecord()]]),
    payload: {
      counts: {},
      nationalSegments: 832,
      sitesLocated: 832,
      sitesUnlocated: 363,
      lengthKm: 918.1,
      feedsFailed: 0,
      flow: { windowEnd: '2026-08-31T21:00:00.000Z' },
    },
  });
  const stats = _roadStatusStatsForTest();
  assert.equal(stats.count, 1);
  assert.equal(stats.sitesUnlocated, 363, 'how much of the network withholds its position is a stat, not a footnote');
  assert.equal(stats.lengthKm, 918.1);
  assert.equal(stats.status, 'ok');

  _setRoadStatusNoticeForTest({ text: 'DIRIF publishes neither…' });
  const empty = _roadStatusStatsForTest();
  assert.equal(empty.status, 'empty');
  assert.match(empty.notice, /DIRIF/);
});

test('the viewport gate refuses a view wider than the proxy will answer', () => {
  const bordeaux = roadStatusViewportBox(viewerWithView({
    south: 44.7, west: -0.8, north: 44.95, east: -0.35,
  }));
  assert.ok(bordeaux);
  assert.ok(bordeaux.north > bordeaux.south);

  // All of France fits on purpose — 830 segments is a legible national picture.
  assert.ok(roadStatusViewportBox(viewerWithView({
    south: 41.3, west: -5.2, north: 51.2, east: 9.6,
  })), 'the whole country is inside the ceiling');

  // A hemisphere is not, and is not silently cropped to a centred slice.
  assert.equal(roadStatusViewportBox(viewerWithView({
    south: -10, west: -60, north: 60, east: 60,
  })), null);
  assert.equal(roadStatusViewportBox(viewerWithView(null)), null);
  assert.equal(roadStatusViewportBox(null), null);
  assert.ok(ROAD_STATUS_MAX_BOX_DEG >= 20);
});

test('the layer declares the contract the manager and the share link rely on', () => {
  assert.equal(roadStatusFranceLayer.id, 'road-status-fr');
  assert.equal(typeof roadStatusFranceLayer.init, 'function');
  assert.equal(typeof roadStatusFranceLayer.enable, 'function');
  assert.equal(typeof roadStatusFranceLayer.disable, 'function');
  assert.equal(typeof roadStatusFranceLayer.update, 'function');
  assert.equal(typeof roadStatusFranceLayer.destroy, 'function');
  assert.equal(typeof roadStatusFranceLayer.getStats, 'function');
  assert.ok(roadStatusFranceLayer.updateInterval >= 60_000, 'never poll faster than the fastest publisher');
  assert.match(roadStatusFranceLayer.source, /Bison Fut/);
});
