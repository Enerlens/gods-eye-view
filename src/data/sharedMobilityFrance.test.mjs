// The French shared-mobility layer's presentation contract.
//
// The property this layer has to keep straight is that it draws an INVENTORY,
// not a track: GBFS never publishes a vehicle during a rental, so the card
// must say what it is looking at and must date the vehicle's own report rather
// than the poll. The rest is the usual honesty: an unknown count is not zero,
// and a viewport too wide to answer is refused rather than cropped.
//
// It also has to keep TWO CHANNELS straight, because a Paris street holds
// several operators running several kinds of vehicle at once: shape says what
// an object is, colour says who runs it, and a station's fill stays spent on
// the one number a person acts on — how full it is.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import sharedMobilityFranceLayer, {
  buildSharedMobilitySelectionLabel,
  cameraSharedMobilityBox,
  createSharedMobilitySelectedOverlayEntry,
  sharedMobilityOperator,
  stationColor,
  stationPointSize,
  vehicleKindLabel,
  _clearSharedMobilitySelectionForTest,
  _selectSharedMobilityObjectForTest,
  _setSharedMobilityStateForTest,
  SHARED_MOBILITY_FR_OVERLAY_SOURCE_ID,
  SHARED_MOBILITY_FR_OVERLAY_SOURCE_OPTIONS,
} from './sharedMobilityFrance.js';
import { GBFS_MAX_BOX_DEG } from './gbfsFeeds.js';
import { resolveMobilityOperator } from './mobilityOperators.js';
import { sharedMobilityGlyph } from './sharedMobilityIcons.js';

function viewerWithView(degrees) {
  return {
    camera: {
      computeViewRectangle: () => (degrees ? Cesium.Rectangle.fromDegrees(
        degrees.west, degrees.south, degrees.east, degrees.north,
      ) : undefined),
    },
    entities: { remove() {} },
  };
}

function vehicleRecord(overrides = {}) {
  const object = {
    id: 'gbfs-84153:abc',
    system: 'gbfs-84153',
    lat: 48.8875,
    lon: 2.3042,
    kind: 'ebike',
    rangeMeters: 13102,
    lastReported: 1787812339,
    ...(overrides.object || {}),
  };
  const system = { id: 'gbfs-84153', name: 'Lime Paris', licence: 'Licence Ouverte 2.0', ...(overrides.system || {}) };
  const operator = resolveMobilityOperator(system.name);
  return {
    id: object.id,
    type: 'vehicle',
    object,
    system,
    operator,
    position: Cesium.Cartesian3.fromDegrees(object.lon, object.lat, 12),
    // A vehicle is a glyph, not a dot: the silhouette is what says "scooter".
    billboard: { color: null, width: 0, height: 0, show: true },
    baseColor: operator.color,
    baseSize: 17,
  };
}

function stationRecord(overrides = {}) {
  const object = {
    id: 'gbfs-1:42',
    system: 'gbfs-1',
    lat: 47.21,
    lon: -1.55,
    name: 'Commerce',
    available: 7,
    docks: 4,
    capacity: 11,
    renting: true,
    byKind: { bike: 5, ebike: 2 },
    ...(overrides.object || {}),
  };
  const system = { id: 'gbfs-1', name: 'Naolib Nantes', licence: 'ODbL 1.0', ...(overrides.system || {}) };
  return {
    id: object.id,
    type: 'station',
    object,
    system,
    operator: resolveMobilityOperator(system.name),
    position: Cesium.Cartesian3.fromDegrees(object.lon, object.lat, 12),
    point: { color: null, pixelSize: 0, show: true },
    baseColor: stationColor(object),
    baseSize: stationPointSize(object),
  };
}

test('the camera gate answers a city view and refuses a regional one', () => {
  const paris = { south: 48.84, west: 2.30, north: 48.88, east: 2.38 };
  const box = cameraSharedMobilityBox(viewerWithView(paris));
  assert.ok(Math.abs(box.south - paris.south) < 1e-6);
  assert.equal(cameraSharedMobilityBox(viewerWithView({ south: 43, west: -2, north: 50, east: 6 })), null);
  assert.equal(cameraSharedMobilityBox(viewerWithView(null)), null);
  assert.equal(cameraSharedMobilityBox(null), null);
  assert.ok(cameraSharedMobilityBox(viewerWithView({
    south: 44, west: 0, north: 44 + GBFS_MAX_BOX_DEG - 0.001, east: 1,
  })));
});

test('every vehicle kind draws a distinct silhouette and keeps a readable label', () => {
  // Colour is spent on the OPERATOR, so the kind has to survive on shape
  // alone. A shared glyph between two kinds would silently merge them.
  const kinds = ['bike', 'ebike', 'scooter', 'moped', 'car', 'other'];
  const glyphs = kinds.map((kind) => sharedMobilityGlyph(kind));
  assert.equal(new Set(glyphs).size, kinds.length);
  assert.ok(glyphs.every((glyph) => glyph.startsWith('data:image/svg+xml;base64,')));
  assert.equal(vehicleKindLabel('ebike'), 'E-bike');
  assert.equal(vehicleKindLabel('moped'), 'Moped');
  // An unmapped kind is shown verbatim, not silently relabelled.
  assert.equal(vehicleKindLabel('funicular'), 'funicular');
});

test('the operator is read from the system title, and shared with the bikeshare layer', () => {
  // The user-visible promise: Vélib' is not Voi is not Lime.
  const velib = resolveMobilityOperator("Vélib' Métropole");
  const voi = resolveMobilityOperator('Voi Paris');
  const lime = resolveMobilityOperator('Lime Paris');
  assert.equal(new Set([velib.color, voi.color, lime.color]).size, 3);
  assert.equal(lime.label, 'Lime');
  // Resolved off the record's own system, so a record built without a cached
  // operator still paints and still names the right one.
  assert.equal(sharedMobilityOperator(vehicleRecord()).id, 'lime');
  assert.equal(sharedMobilityOperator({ system: { name: 'Dott Paris' } }).id, 'dott');
  assert.equal(sharedMobilityOperator({}).id, 'unknown');
});

test('a station with no availability data is neutral, not empty', () => {
  // "We do not know" and "there are no bikes" are different facts, and only
  // the second one is actionable for someone deciding where to walk.
  const unknown = stationColor({ available: null, capacity: 20 });
  const empty = stationColor({ available: 0, capacity: 20 });
  assert.notEqual(unknown, empty);
  assert.equal(stationColor({ available: 18, capacity: 20 }), stationColor({ available: 20, capacity: 20 }));
  assert.notEqual(stationColor({ available: 1, capacity: 20 }), stationColor({ available: 18, capacity: 20 }));
  // A closed station reads closed whatever it holds.
  assert.equal(stationColor({ available: 18, capacity: 20, renting: false }),
    stationColor({ available: 0, capacity: 20, renting: false }));
  // Size never collapses to nothing when capacity is missing.
  assert.ok(stationPointSize({ capacity: null }) > 0);
  assert.ok(stationPointSize({ capacity: 60 }) > stationPointSize({ capacity: 5 }));
});

test('a vehicle card dates the operator\'s own report and says what it is looking at', () => {
  const record = vehicleRecord();
  const lines = buildSharedMobilitySelectionLabel(record, 1787812399000).split('\n');
  // Whose it is leads the card: the glyph on screen is Lime-coloured, and
  // this is where that hue gets a name.
  assert.equal(lines[0], 'Lime E-bike');
  assert.equal(lines[1], '🔋 13.1 km range');
  // 60 s after the vehicle reported — not 60 s after the layer polled.
  assert.equal(lines[2], '⏱ reported 60s ago');
  assert.equal(lines[3], 'Parked and available — a rented vehicle is not published');
  assert.equal(lines[4], '🅿️ Lime Paris');
  assert.equal(lines[5], 'Licence Ouverte 2.0');
});

test('a station card prints the counts and the per-kind split it was given', () => {
  const lines = buildSharedMobilitySelectionLabel(stationRecord()).split('\n');
  assert.equal(lines[0], 'Commerce');
  assert.equal(lines[1], '🚲 7 avail · 4 docks · 11 cap');
  assert.equal(lines[2], '↳ 5 bike · 2 e-bike');
  assert.equal(lines[3], '🅿️ Naolib Nantes');
});

test('missing values are omitted rather than filled in', () => {
  const bare = vehicleRecord({
    object: { kind: 'bike', rangeMeters: null, lastReported: null },
    system: { name: null, licence: null },
  });
  const lines = buildSharedMobilitySelectionLabel(bare).split('\n');
  assert.deepEqual(lines, ['Bike', 'Parked and available — a rented vehicle is not published']);

  const closed = stationRecord({ object: { name: null, available: null, docks: null, capacity: null, byKind: null, renting: false } });
  const closedLines = buildSharedMobilitySelectionLabel(closed).split('\n');
  assert.equal(closedLines[0], 'Station');
  assert.ok(closedLines.includes('⚠️ Not renting'));
});

test('the selected entry takes the protected lane, and the source is a static one', () => {
  const record = vehicleRecord();
  const entry = createSharedMobilitySelectedOverlayEntry(record, 1787812399000);
  assert.equal(entry.id, record.id);
  assert.equal(entry.position, record.position);
  assert.equal(entry.title, 'Lime E-bike');
  assert.equal(entry.protected, true);
  assert.equal(entry.paintLane, 'selected');
  assert.equal(entry.horizonCull, true);
  assert.equal(createSharedMobilitySelectedOverlayEntry({ id: 'x' }), null);
  // A parked vehicle does not move, so the host may cache its screen rect.
  assert.equal(SHARED_MOBILITY_FR_OVERLAY_SOURCE_OPTIONS.moving, false);
  assert.equal(SHARED_MOBILITY_FR_OVERLAY_SOURCE_OPTIONS.cohortLimit, 1);
});

test('selecting and clearing drives the real host seam and restores the point', () => {
  const record = vehicleRecord();
  const calls = [];
  const host = {
    setEntries: (...args) => calls.push(['set', ...args]),
    setVisible: (...args) => calls.push(['visible', ...args]),
    clearSource: (...args) => calls.push(['clear', ...args]),
  };
  _setSharedMobilityStateForTest({ viewer: viewerWithView(null), records: [record], overlayHost: host });

  _selectSharedMobilityObjectForTest(record.id);
  const set = calls.find((call) => call[0] === 'set');
  assert.equal(set[1], SHARED_MOBILITY_FR_OVERLAY_SOURCE_ID);
  assert.equal(set[2][0].id, record.id);
  assert.equal(record.billboard.color.toCssHexString(), '#00ffff');
  assert.ok(record.billboard.width > record.baseSize);

  _clearSharedMobilitySelectionForTest();
  assert.ok(calls.some((call) => call[0] === 'clear' && call[1] === SHARED_MOBILITY_FR_OVERLAY_SOURCE_ID));
  // Restored to the OPERATOR's colour — the channel survives a selection.
  assert.equal(record.billboard.color.toCssHexString(), resolveMobilityOperator('Lime Paris').color);
  assert.equal(record.billboard.width, record.baseSize);
});

test('the row legend carries both channels — shapes, then the operators in view', () => {
  _setSharedMobilityStateForTest({
    viewer: viewerWithView(null),
    records: [
      vehicleRecord({ object: { id: 'a', kind: 'ebike' } }),
      vehicleRecord({ object: { id: 'b', kind: 'ebike' } }),
      vehicleRecord({ object: { id: 'c', kind: 'scooter' } }),
      vehicleRecord({ object: { id: 'e', kind: 'scooter' }, system: { name: 'Dott Paris' } }),
      stationRecord({ object: { id: 'd' } }),
    ],
  });
  const { legend, chips } = sharedMobilityFranceLayer.getRowControls();
  assert.deepEqual(chips, []);
  assert.deepEqual(legend.map((item) => [item.label, item.count]), [
    // What is on screen, by kind...
    ['E-bike', 2], ['Scooter', 2], ['Stations', 1],
    // ...then who is running it.
    ['Lime', 3], ['Dott', 1], ['Naolib', 1],
  ]);
  assert.ok(legend.every((item) => item.count > 0), 'a kind with nothing in view is omitted');

  // The shape rows carry the map's own glyph and a neutral tint — they answer
  // "what", so painting them an operator hue would claim something false.
  const kindRows = legend.slice(0, 3);
  assert.equal(new Set(kindRows.map((item) => item.glyph)).size, 3);
  assert.equal(new Set(kindRows.map((item) => item.color)).size, 1);
  assert.equal(kindRows.find((item) => item.label === 'Scooter').glyph, sharedMobilityGlyph('scooter', 32));

  // The operator rows carry the exact colour their objects are drawn in, and
  // no glyph — they answer "who".
  const operatorRows = legend.slice(3);
  assert.equal(operatorRows.find((item) => item.label === 'Lime').color, resolveMobilityOperator('Lime Paris').color);
  assert.ok(operatorRows.every((item) => item.glyph === undefined));
  assert.equal(new Set(operatorRows.map((item) => item.color)).size, 3, 'three operators, three hues');

  // The two caveats a colour cannot carry.
  assert.match(legend.find((item) => item.label === 'Stations').blurb, /Municipal bays/);
  assert.match(legend.find((item) => item.label === 'E-bike').blurb, /never publishes a vehicle during a rental/);
  // A derived hue says it is derived rather than passing itself off as livery.
  assert.match(operatorRows.find((item) => item.label === 'Naolib').blurb, /no French feed publishes a brand colour/);

  _setSharedMobilityStateForTest({ viewer: null, records: [] });
  assert.deepEqual(sharedMobilityFranceLayer.getRowControls().legend, []);
});

test('a crowded viewport names six operators and declares the tail it did not name', () => {
  // Silently dropping the seventh would read as "these are the operators here".
  const names = ['Lime Paris', 'Dott Paris', 'Voi Paris', 'Pony Paris', 'Bird Paris',
    'Citiz Paris', 'Cityscoot Paris', 'YEGO Paris'];
  _setSharedMobilityStateForTest({
    viewer: viewerWithView(null),
    records: names.flatMap((name, index) => Array.from(
      { length: names.length - index },
      (unused, copy) => vehicleRecord({ object: { id: `${index}:${copy}` }, system: { name } }),
    )),
  });
  const operatorRows = sharedMobilityFranceLayer.getRowControls().legend
    .filter((item) => item.glyph === undefined);
  assert.equal(operatorRows.length, 7, 'six named operators plus one tail row');
  assert.deepEqual(operatorRows.slice(0, 6).map((item) => item.label),
    ['Lime', 'Dott', 'Voi', 'Pony', 'Bird', 'Citiz']);
  const tail = operatorRows[6];
  assert.equal(tail.label, '+2 operators');
  assert.equal(tail.count, 2 + 1, 'the tail counts the objects it stands for');
  assert.match(tail.blurb, /Cityscoot/);
  assert.match(tail.blurb, /YEGO/);

  _setSharedMobilityStateForTest({ viewer: null, records: [] });
});
