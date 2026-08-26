// The live French transit layer's presentation contract.
//
// What is pinned here is the honesty of the surfaces a person reads: the
// viewport gate refuses a question it cannot answer instead of cropping it,
// the card prints the age of the REPORTED fix (not of the glyph, which is
// mid-glide between two fixes), and the selected entry keeps the protected
// paint lane so a moving card cannot be decluttered out from under a click.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import transitFranceLayer, {
  buildTransitSelectionLabel,
  cameraTransitBox,
  createTransitSelectedOverlayEntry,
  glideDurationMs,
  transitModeColor,
  transitModeLabel,
  _clearTransitSelectionForTest,
  _selectTransitVehicleForTest,
  _setTransitStateForTest,
  TRANSIT_FR_OVERLAY_SOURCE_ID,
  TRANSIT_FR_OVERLAY_SOURCE_OPTIONS,
} from './transitFrance.js';
import { PAN_MAX_BOX_DEG } from './panFeeds.js';

/** A viewer stub whose camera reports one view rectangle. */
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

function makeRecord(overrides = {}) {
  const vehicle = {
    id: 'pan-84094:2481',
    feed: 'pan-84094',
    lat: 44.8755,
    lon: -0.5691,
    bearing: 146,
    speedMps: 8.333,
    route: '07',
    label: 'TBM 2481',
    status: 'in-transit',
    occupancy: 'few-seats',
    mode: 'urban',
    timestampMs: 1787765215000,
    ...(overrides.vehicle || {}),
  };
  return {
    id: vehicle.id,
    vehicle,
    feed: {
      id: 'pan-84094',
      network: 'TBM',
      licence: 'Licence Ouverte 2.0',
      ...(overrides.feed || {}),
    },
    hasBearing: Number.isFinite(vehicle.bearing),
    renderPosition: Cesium.Cartesian3.fromDegrees(vehicle.lon, vehicle.lat, 40),
    billboard: { color: null, width: 0, height: 0, rotation: 0, image: '' },
  };
}

test('the camera gate answers a city view and refuses a continental one', () => {
  const paris = { south: 48.80, west: 2.25, north: 48.92, east: 2.45 };
  const box = cameraTransitBox(viewerWithView(paris));
  assert.ok(Math.abs(box.south - paris.south) < 1e-6);
  assert.ok(Math.abs(box.east - paris.east) < 1e-6);

  // Wider than the proxy ceiling: the layer reports zoom-in guidance rather
  // than fetching a centred slice and presenting it as the whole picture.
  assert.equal(cameraTransitBox(viewerWithView({ south: 41, west: -5, north: 51, east: 9 })), null);
  // A horizon view has no usable rectangle at all.
  assert.equal(cameraTransitBox(viewerWithView(null)), null);
  assert.equal(cameraTransitBox(null), null);
  // Exactly at the ceiling is still answerable.
  assert.ok(cameraTransitBox(viewerWithView({
    south: 44, west: 0, north: 44 + PAN_MAX_BOX_DEG - 0.001, east: 1,
  })));
});

test('every declared PAN service mode has a distinct tint and a readable label', () => {
  const modes = ['urban', 'intercity', 'school', 'zonal_drt', 'seasonal'];
  const colors = modes.map(transitModeColor);
  assert.equal(new Set(colors).size, modes.length);
  assert.ok(colors.every((color) => /^#[0-9a-f]{6}$/i.test(color)));
  assert.equal(transitModeLabel('zonal_drt'), 'On-demand');
  assert.equal(transitModeLabel('intercity'), 'Intercity');
  // An unmapped mode is shown verbatim, not silently relabelled "Urban".
  assert.equal(transitModeLabel('funicular'), 'funicular');
  assert.equal(transitModeColor('funicular'), transitModeColor('urban'));
});

test('the card reports operator values, in the units a person reads', () => {
  const record = makeRecord();
  const lines = buildTransitSelectionLabel(record, 1787765245000).split('\n');
  assert.equal(lines[0], 'LINE 07 · TBM 2481');
  assert.equal(lines[1], '🚍 TBM');
  // 8.333 m/s is 30 km/h. GTFS-RT publishes m/s; nobody reads a bus in m/s.
  assert.equal(lines[2], '30 km/h · 146° · in transit');
  assert.equal(lines[3], '👥 few seats');
  // 30 s after the fix — the age of what the OPERATOR said, not of the glyph,
  // which is mid-glide between this fix and the previous one.
  assert.equal(lines[4], '⏱ fix 30s ago');
  assert.equal(lines[5], 'Urban · Licence Ouverte 2.0');
});

test('missing values are omitted, never filled in with a plausible default', () => {
  const record = makeRecord({
    vehicle: {
      bearing: null, speedMps: null, route: null, label: null,
      status: null, occupancy: null, timestampMs: null,
    },
    feed: { network: null, licence: null },
  });
  const lines = buildTransitSelectionLabel(record).split('\n');
  assert.equal(lines[0], 'LINE —', 'an unknown line is dashed out, not guessed');
  assert.deepEqual(lines.slice(1), ['Urban']);
});

test('the selected entry takes the protected lane a moving card needs', () => {
  const record = makeRecord();
  const entry = createTransitSelectedOverlayEntry(record, 1787765245000);
  assert.equal(entry.id, 'pan-84094:2481');
  assert.equal(entry.position, record.renderPosition);
  assert.equal(entry.title, 'LINE 07 · TBM 2481');
  assert.deepEqual(entry.details, [
    '🚍 TBM',
    '30 km/h · 146° · in transit',
    '👥 few seats',
    '⏱ fix 30s ago',
    'Urban · Licence Ouverte 2.0',
  ]);
  assert.equal(entry.protected, true);
  assert.equal(entry.paintLane, 'selected');
  assert.equal(entry.collisionGroup, 'ambient-card');
  assert.equal(entry.horizonCull, true);
  assert.equal(entry.edgeFade, 'keyhole');
  assert.equal(createTransitSelectedOverlayEntry({ id: 'x' }), null);
});

test('the shared overlay source is declared as a moving, single-entry lane', () => {
  // A bus card tracks a target that never stops moving; declaring the source
  // static would let the host cache a screen rect that is already wrong.
  assert.equal(TRANSIT_FR_OVERLAY_SOURCE_OPTIONS.moving, true);
  assert.equal(TRANSIT_FR_OVERLAY_SOURCE_OPTIONS.cohortLimit, 1);
});

test('selecting and clearing drives the real host seam and restores the glyph', () => {
  const record = makeRecord();
  const calls = [];
  const host = {
    setEntries: (sourceId, entries, options) => calls.push(['set', sourceId, entries, options]),
    setVisible: (sourceId, visible) => calls.push(['visible', sourceId, visible]),
    clearSource: (sourceId) => calls.push(['clear', sourceId]),
  };
  _setTransitStateForTest({ viewer: viewerWithView(null), record, overlayHost: host });

  _selectTransitVehicleForTest(record.id);
  const set = calls.find((call) => call[0] === 'set');
  assert.equal(set[1], TRANSIT_FR_OVERLAY_SOURCE_ID);
  assert.equal(set[2].length, 1);
  assert.equal(set[2][0].id, record.id);
  assert.equal(set[3], TRANSIT_FR_OVERLAY_SOURCE_OPTIONS);
  // The glyph is promoted, not hidden: a selected bus stays a bus on the map.
  assert.equal(record.billboard.color.toCssHexString(), '#00ffff');
  assert.ok(record.billboard.width > 17);

  _clearTransitSelectionForTest();
  assert.ok(calls.some((call) => call[0] === 'clear' && call[1] === TRANSIT_FR_OVERLAY_SOURCE_ID));
  assert.equal(record.billboard.color.toCssHexString(), transitModeColor('urban'));
});

test('the row legend counts what is on screen, and omits what is not', () => {
  const records = [
    makeRecord({ vehicle: { id: 'a', mode: 'urban' } }),
    makeRecord({ vehicle: { id: 'b', mode: 'urban' } }),
    makeRecord({ vehicle: { id: 'c', mode: 'intercity' } }),
  ];
  _setTransitStateForTest({ viewer: viewerWithView(null), records });

  const { legend, chips } = transitFranceLayer.getRowControls();
  assert.deepEqual(chips, []);
  assert.deepEqual(legend.map((item) => [item.label, item.count]), [['Urban', 2], ['Intercity', 1]]);
  assert.equal(legend[0].color, transitModeColor('urban'));
  // Nothing reads "School 0": an entry with no vehicles implies coverage this
  // viewport does not have.
  assert.ok(legend.every((item) => item.count > 0));
  // The blurb has to carry the caveat, because the colour cannot: the class is
  // the NETWORK's, and a tram inside an urban network is coloured urban.
  assert.match(legend[0].blurb, /route_type/);

  _setTransitStateForTest({ viewer: null, records: [] });
  assert.deepEqual(transitFranceLayer.getRowControls().legend, []);
});

test('a glyph travels between two fixes at the speed the feed implies', () => {
  const fix = 1787765200000;
  // The common case: a vehicle reporting on the poll cadence.
  assert.equal(glideDurationMs(fix, fix + 15_000), 15_000);
  // A coach reporting once a minute moves ~1.9 km between fixes. Sliding that
  // across one 15 s poll would render a bus doing 460 km/h, then parking.
  assert.equal(glideDurationMs(fix, fix + 60_000), 60_000);
  // Feeds without per-vehicle timestamps fall back to the poll cadence.
  assert.equal(glideDurationMs(null, fix), 15_000);
  assert.equal(glideDurationMs(fix, null), 15_000);
  // A clock that went backwards is not a travel time.
  assert.equal(glideDurationMs(fix, fix - 5_000), 15_000);
  // Bounded at both ends: a burst of refreshes cannot make the fleet stutter,
  // and nothing creeps past the window in which a feed is still reporting.
  assert.equal(glideDurationMs(fix, fix + 200), 3_000);
  assert.equal(glideDurationMs(fix, fix + 10 * 60_000), 90_000);
});
