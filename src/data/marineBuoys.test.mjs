// src/data/marineBuoys.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';
import {
  BUOY_POINT_PX,
  NO_SEA_STATE_CSS,
  SEA_STATE_BANDS,
  SEA_STATE_LABELS_FR,
  SWELL_STEM_SCALE,
  buoyLegend,
  buoyOverlayCopy,
  buoyRingGlyph,
  coverageLabel,
  createBuoyOverlayEntry,
  createMarineBuoysLayer,
  mapAnalystRecord,
  msToKnots,
  seaState,
  seaStateBandIndex,
  seaStateBandLabel,
  selectBuoyOverlayCohort,
  summarizeSwellStems,
  swellStemHeightM,
  swellStemIsClipped,
  swellStemIsFloored,
} from './marineBuoys.js';
import { NDBC_BOUNDS } from './ndbcObservations.js';

const STATION = Object.freeze({
  station: '41001',
  lat: 34.7,
  lon: -72.7,
  observedAt: Date.UTC(2026, 7, 26, 19, 50),
  waveHeightM: 2.1,
  dominantPeriodS: 8,
  waveDirDeg: 195,
  seaTempC: 27.4,
  airTempC: 26.1,
  windSpeedMs: 7.2,
  windDirDeg: 210,
  pressureHpa: 1017.1,
});

test('sea state follows the WMO ladder at its boundaries', () => {
  assert.equal(seaState(0).label, 'Calm');
  assert.equal(seaState(0.1).label, 'Calm');
  assert.equal(seaState(0.11).label, 'Smooth');
  assert.equal(seaState(1.25).label, 'Slight');
  assert.equal(seaState(2.5).label, 'Moderate');
  assert.equal(seaState(4).label, 'Rough');
  assert.equal(seaState(6).label, 'Very rough');
  assert.equal(seaState(9).label, 'High');
  assert.equal(seaState(14).label, 'Very high');
  assert.equal(seaState(30).label, 'Phenomenal');
});

// The honesty rule the module header states: no wave sensor is not a flat sea.
test('an unmeasured wave height is neutral, not calm', () => {
  for (const value of [null, undefined, NaN, -1]) {
    const state = seaState(value);
    assert.equal(state.label, null, `${value} yields no label`);
    assert.equal(state.css, NO_SEA_STATE_CSS);
  }
  // A measured flat sea is genuinely Calm and must NOT collapse into the same
  // presentation as an absent reading.
  assert.equal(seaState(0).label, 'Calm');
  assert.notEqual(seaState(0).css, NO_SEA_STATE_CSS);
});

test('card copy omits the lines a station never measured', () => {
  const full = buoyOverlayCopy(STATION);
  assert.equal(full.title, '41001');
  assert.equal(full.details.length, 3);
  assert.match(full.details[0], /^2\.1 m SSW · 8s · Moderate$/);
  assert.match(full.details[1], /^Sea 27\.4 °C$/);
  assert.match(full.details[2], /^Wind SSW 14 kt$/);

  const windOnly = buoyOverlayCopy({
    station: '62148', windSpeedMs: 7.7, windDirDeg: 90,
    waveHeightM: null, seaTempC: null,
  });
  assert.equal(windOnly.details.length, 1);
  assert.match(windOnly.details[0], /^Wind E 15 kt$/);

  // A station that reported only a position and a timestamp gets no detail
  // lines at all — rather than a row of em-dashes that reads like data.
  const bare = buoyOverlayCopy({ station: '44098' });
  assert.equal(bare.title, '44098');
  assert.deepEqual(bare.details, []);
});

test('a measured flat sea still renders its reading', () => {
  const copy = buoyOverlayCopy({ station: '22101', waveHeightM: 0, dominantPeriodS: 0 });
  assert.equal(copy.details.length, 1);
  assert.match(copy.details[0], /^0\.0 m · 0s · Calm$/);
});

test('knot conversion matches the standard factor', () => {
  assert.equal(msToKnots(null), null);
  assert.ok(Math.abs(msToKnots(1) - 1.9438444924406) < 1e-9);
  assert.ok(Math.abs(msToKnots(10) - 19.438444924406) < 1e-9);
});

test('cohort keeps the roughest seas and caps at the limit', () => {
  const entries = [];
  for (let i = 0; i < 200; i += 1) {
    entries.push(createBuoyOverlayEntry({
      id: `S${String(i).padStart(3, '0')}`,
      position: {},
      station: { station: `S${i}`, waveHeightM: i / 10 },
      accent: '#fff',
    }));
  }
  const cohort = selectBuoyOverlayCohort(entries);
  assert.equal(cohort.length, 96);
  assert.equal(cohort[0].title, 'S199', 'roughest sea wins the top slot');
  assert.ok(cohort.every((entry) => entry.priority >= cohort.at(-1).priority));
});

// Unmeasured stations must not outrank measured ones for a scarce label slot.
test('stations with no wave reading sort below every measured station', () => {
  const measured = createBuoyOverlayEntry({
    id: 'M', position: {}, station: { station: 'M', waveHeightM: 0 }, accent: '#fff',
  });
  const unmeasured = createBuoyOverlayEntry({
    id: 'U', position: {}, station: { station: 'U', waveHeightM: null }, accent: '#fff',
  });
  assert.ok(unmeasured.priority < measured.priority);
  const cohort = selectBuoyOverlayCohort([unmeasured, measured], 1);
  assert.equal(cohort[0].id, 'M');
});

// manager.js interpolates `coverage` straight into chip text and into the
// fallback-detection source string, so it must be a string — an object would
// print "[object Object]" on the control chip.
test('coverage renders as a chip-ready string, never an object', () => {
  assert.equal(coverageLabel({ stations: 892, marine: 533 }), '533 of 892 measuring sea');
  assert.equal(coverageLabel({ stations: 12 }), '12 stations');
  assert.equal(coverageLabel(null), '');
  assert.equal(coverageLabel({ stations: 0, marine: 0 }), '');
  assert.equal(typeof coverageLabel({ stations: 892, marine: 533 }), 'string');
  // The regexes manager.js runs over this string must not be tripped by it.
  assert.ok(!/\bfallback\b/i.test(coverageLabel({ stations: 892, marine: 533 })));
});

test('analyst records keep missing fields null, never NaN', () => {
  const record = mapAnalystRecord(STATION);
  assert.equal(record.id, '41001');
  assert.equal(record.waveHeightM, 2.1);
  assert.equal(record.seaState, 'Moderate');

  const sparse = mapAnalystRecord({ station: '44098', lat: 42.8, lon: -70.169 }, 3);
  assert.equal(sparse.id, '44098');
  assert.equal(sparse.waveHeightM, null);
  assert.equal(sparse.seaState, null);
  for (const [key, value] of Object.entries(sparse)) {
    assert.ok(!Number.isNaN(value), `${key} is not NaN`);
    assert.notEqual(value, undefined, `${key} is not undefined`);
  }

  // A station with no id at all still gets a stable, index-derived one.
  assert.equal(mapAnalystRecord({}, 7).id, 'BUOY-0007');
});


// ---------------------------------------------------------------------------
// The swell stem — the size channel
// ---------------------------------------------------------------------------

// C1. Every number in the scale is a published literal, and the two that must
// agree are checked where an author sees the failure rather than a reader.
test('the stem scale is internally consistent and inside the parser bound', () => {
  assert.equal(
    SWELL_STEM_SCALE.maxStemM,
    SWELL_STEM_SCALE.domainMaxM * SWELL_STEM_SCALE.exaggeration,
  );
  // The frozen domain must sit INSIDE what the parser can hand over, or the
  // clipping band would be unreachable and the legend would promise a
  // behaviour that can never occur.
  assert.ok(SWELL_STEM_SCALE.domainMaxM < NDBC_BOUNDS.waveHeightM[1]);
  // The domain top is a WMO boundary, not an arbitrary round number: hue and
  // height have to clip at the same place.
  assert.ok(SEA_STATE_BANDS.some((band) => band.maxM === SWELL_STEM_SCALE.domainMaxM));
  assert.equal(Object.isFrozen(SWELL_STEM_SCALE), true);
  assert.equal(SWELL_STEM_SCALE.ticksM.length, 3, 'D1 asks for two or three marks');
});

// The exaggeration is linear, so it must be invertible by eye at every tick.
test('stem height is the swell, times the published exaggeration', () => {
  for (const hs of [0.5, 1, 2, 4, 8, 13.9]) {
    assert.equal(swellStemHeightM(hs), hs * SWELL_STEM_SCALE.exaggeration);
  }
  // Twice as tall is twice the swell — the sentence the legend prints.
  assert.equal(swellStemHeightM(4) / swellStemHeightM(2), 2);
});

// A1, in one assertion: a measured flat sea and an absent sensor are different
// marks. Zero gets the floor stem; "no sensor" gets no stem at all.
test('no wave sensor means no stem, but a measured 0 m still gets one', () => {
  for (const absent of [null, undefined, NaN, -1, '2.0']) {
    assert.equal(swellStemHeightM(absent), null, `${absent} draws nothing`);
  }
  assert.equal(swellStemHeightM(0), SWELL_STEM_SCALE.minStemM);
  assert.notEqual(swellStemHeightM(0), null);
});

// A5, the floor: it exists, it bites below a stated value, and it is a floor
// rather than a scale — everything under it renders the same height.
test('the floor bites below the published value and is declared', () => {
  const floorHs = SWELL_STEM_SCALE.minStemM / SWELL_STEM_SCALE.exaggeration;
  assert.equal(floorHs, 0.2);
  assert.equal(swellStemHeightM(0.1), SWELL_STEM_SCALE.minStemM);
  assert.equal(swellStemHeightM(0.19), SWELL_STEM_SCALE.minStemM);
  assert.equal(swellStemHeightM(0.2), SWELL_STEM_SCALE.minStemM);
  assert.ok(swellStemIsFloored(0.1));
  assert.ok(!swellStemIsFloored(0.2), 'exactly at the floor is measured, not floored');
  assert.ok(!swellStemIsFloored(null));
});

// A5, the ceiling: above the frozen domain the mark stops measuring, and that
// is a countable state rather than a silent saturation.
test('the ceiling clips at the frozen domain and says so', () => {
  assert.equal(swellStemHeightM(14), SWELL_STEM_SCALE.maxStemM);
  assert.equal(swellStemHeightM(20), SWELL_STEM_SCALE.maxStemM);
  assert.equal(swellStemHeightM(40), SWELL_STEM_SCALE.maxStemM);
  assert.ok(!swellStemIsClipped(14), 'the boundary itself is still measured');
  assert.ok(swellStemIsClipped(14.1));
  assert.ok(!swellStemIsClipped(null));
});

const REPORT = Object.freeze([
  { station: 'A', waveHeightM: 0 },      // measured flat sea → floored stem
  { station: 'B', waveHeightM: 0.1 },    // floored stem
  { station: 'C', waveHeightM: 0.8 },    // the 2026-09-03 median
  { station: 'D', waveHeightM: 2.4 },
  { station: 'E', waveHeightM: 8.2 },    // the Biscay storm case
  { station: 'F', waveHeightM: 17 },     // above the frozen domain
  { station: 'G', waveHeightM: null },   // no wave sensor
  { station: 'H' },                      // no wave sensor
]);

test('the render tally counts stems, floors, clips and the sensorless', () => {
  const summary = summarizeSwellStems(REPORT);
  assert.equal(summary.stations, 8);
  assert.equal(summary.stems, 6);
  assert.equal(summary.noStem, 2);
  assert.equal(summary.stems + summary.noStem, summary.stations);
  assert.equal(summary.floored, 2);
  assert.equal(summary.clipped, 1);
  assert.equal(summary.tallestHsM, 17);
  // Cumulative, in tick order [8, 2, 0.5].
  assert.deepEqual(summary.atOrAbove, [2, 3, 4]);
  const bandTotal = summary.bands.reduce((sum, band) => sum + band.count, 0);
  assert.equal(bandTotal, summary.stems, 'every stem lands in exactly one band');
  assert.deepEqual(summarizeSwellStems(null), summarizeSwellStems([]));
});

test('band indices and their French labels follow the frozen ladder', () => {
  assert.equal(seaStateBandIndex(null), -1);
  assert.equal(seaStateBandIndex(0), 0);
  assert.equal(seaStateBandIndex(20), SEA_STATE_BANDS.length - 1);
  assert.equal(SEA_STATE_LABELS_FR.length, SEA_STATE_BANDS.length);
  assert.equal(seaStateBandLabel(0), 'Calme · ≤ 0,1 m');
  assert.equal(seaStateBandLabel(3), 'Agitée · 1,25 – 2,5 m');
  assert.equal(seaStateBandLabel(8), 'Énorme · > 14 m');
  assert.equal(seaStateBandLabel(99), '');
});

// ---------------------------------------------------------------------------
// D1 — a size without a ruler is unreadable
// ---------------------------------------------------------------------------

test('the legend publishes the exaggeration, the domain and three marks', () => {
  const legend = buoyLegend(summarizeSwellStems(REPORT));
  const height = legend[0];
  assert.match(height.label, /^Hauteur/);
  assert.match(height.blurb, /×10 000/, 'the factor is published as a number');
  assert.match(height.blurb, /ÉCHELLE DE LECTURE/, 'and named as a reading scale');
  assert.match(height.blurb, /linéaire/);
  assert.match(height.blurb, /14 m/, 'the frozen domain top is published');
  assert.match(height.blurb, /17 m/, 'and the tallest reading of the report in hand');

  const ticks = legend.filter((entry) => /^\d+(,\d+)? m$/.test(entry.label));
  assert.equal(ticks.length, 3);
  assert.deepEqual(ticks.map((entry) => entry.label), ['8 m', '2 m', '0,5 m']);
  for (const tick of ticks) {
    assert.match(tick.glyph, /^data:image\/svg\+xml;base64,/);
    assert.equal(tick.color, ticks[0].color, 'one constant colour on the ruler (A3)');
  }
  assert.deepEqual(ticks.map((entry) => entry.count), [2, 3, 4]);
});

test('the legend counts the floor, the clip and the stations with no stem', () => {
  const legend = buoyLegend(summarizeSwellStems(REPORT));
  const floored = legend.find((entry) => /plancher/.test(entry.label));
  assert.equal(floored.count, 2);
  assert.match(floored.label, /sous 0,2 m/);

  const clipped = legend.find((entry) => /écrêtée/.test(entry.label));
  assert.equal(clipped.count, 1);
  assert.match(clipped.blurb, /TIRETS/, 'the clipped mark declares itself on the map too');

  const noStem = legend.find((entry) => /Pas de capteur/.test(entry.label));
  assert.equal(noStem.count, 2);
  assert.equal(noStem.color, NO_SEA_STATE_CSS);
  assert.equal(noStem.glyph, buoyRingGlyph(), 'a shape, not a tint (D3)');
  assert.match(noStem.blurb, /pas de tige/);
});

// A5 again: the ceiling row is a count of a state, so it appears only when
// something is actually in that state — but the ceiling itself is announced in
// the height blurb regardless, or a calm day would hide the clip entirely.
test('the clip row appears only when it bites, the ceiling is always stated', () => {
  const calm = buoyLegend(summarizeSwellStems([{ station: 'A', waveHeightM: 1.2 }]));
  assert.equal(calm.find((entry) => /écrêtée/.test(entry.label)), undefined);
  assert.match(calm[0].blurb, /14 m/);
  assert.match(calm[0].blurb, /tirets/);
});

// A3 — the doubled channel is declared in the legend, not left to be found.
test('the legend declares the hue/height redundancy and argues it', () => {
  const legend = buoyLegend(summarizeSwellStems(REPORT));
  const colour = legend.find((entry) => /^Couleur/.test(entry.label));
  assert.match(colour.blurb, /REDONDANCE DÉLIBÉRÉE/);
  assert.match(colour.blurb, /nadir/, 'and gives the globe-specific reason');
});

test('only the sea-state bands actually drawn get a legend row', () => {
  const legend = buoyLegend(summarizeSwellStems(REPORT));
  const bands = legend.filter((entry) => /·/.test(entry.label));
  // 0 and 0.1 share the Calme band, so the eight-row report lands in five.
  assert.equal(bands.length, 5, 'five of the nine bands are represented');
  for (const band of bands) {
    assert.ok(band.count > 0);
    assert.ok(SEA_STATE_BANDS.some((entry) => entry.css === band.color));
  }
  assert.deepEqual(buoyLegend(summarizeSwellStems([])), []);
  assert.deepEqual(buoyLegend(null), []);
});

// manager.js appends `_formatCount(item.count)` unconditionally in the panel
// row, and `_formatCount(undefined)` renders the string "undefined". Every row
// here carries a real tally, so this layer cannot hit that known defect.
test('every legend row carries a finite count', () => {
  for (const entry of buoyLegend(summarizeSwellStems(REPORT))) {
    assert.ok(Number.isFinite(entry.count), `${entry.label} has a count`);
  }
});

// C1 — the ruler is a property of the layer, never of the sample. Two very
// different reports must yield the same marks, or two readers of one share
// link would read two different keys.
test('the ruler does not move with the sample', () => {
  const calm = buoyLegend(summarizeSwellStems([{ station: 'A', waveHeightM: 0.3 }]));
  const storm = buoyLegend(summarizeSwellStems([{ station: 'B', waveHeightM: 12 }]));
  const marks = (legend) => legend
    .filter((entry) => /^\d+(,\d+)? m$/.test(entry.label))
    .map((entry) => [entry.label, entry.glyph]);
  assert.deepEqual(marks(calm), marks(storm));
});

test('the ring glyph is a stable, cached data URI', () => {
  assert.match(buoyRingGlyph(), /^data:image\/svg\+xml;base64,/);
  assert.equal(buoyRingGlyph(), buoyRingGlyph());
  const svg = Buffer.from(buoyRingGlyph().split(',')[1], 'base64').toString('utf8');
  assert.match(svg, /fill="none"/, 'hollow — that is the whole message');
});

// ---------------------------------------------------------------------------
// What the layer actually draws
// ---------------------------------------------------------------------------

function stubViewer() {
  const sources = [];
  return {
    sources,
    dataSources: {
      add(source) { sources.push(source); return source; },
      remove(source) { sources.splice(sources.indexOf(source), 1); return true; },
    },
  };
}

function silentOverlayHost() {
  return { setEntries() {}, setVisible() {}, clearSource() {} };
}

async function renderReport(stations) {
  const layer = createMarineBuoysLayer({
    overlayHost: silentOverlayHost(),
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        stations,
        coverage: { stations: stations.length, marine: stations.length },
        fetchedAt: Date.UTC(2026, 8, 3, 12, 0),
      }),
    }),
  });
  const viewer = stubViewer();
  layer.init(viewer);
  layer.enable();
  assert.equal(await layer.update(), true);
  const source = viewer.sources[0];
  const byId = new Map(source.entities.values.map((entity) => [entity.id, entity]));
  return { layer, entities: source.entities.values, byId };
}

const AT_SEA = REPORT.map((row, index) => ({
  ...row, lat: 40 + index, lon: -30 - index, observedAt: Date.UTC(2026, 8, 3, 11, 0),
}));

test('a station with a wave sensor gets a stem, one without gets none', async () => {
  const { byId } = await renderReport(AT_SEA);
  assert.equal(byId.get('marine-buoy:C').polyline !== undefined, true);
  assert.equal(byId.get('marine-buoy:G').polyline, undefined, 'no sensor, no stem');
  assert.equal(byId.get('marine-buoy:H').polyline, undefined);
  // A1: the flat sea is drawn, at the floor, and is NOT the sensorless case.
  assert.equal(byId.get('marine-buoy:A').polyline !== undefined, true);
});

test('the stem stands in world metres, at the published exaggeration', async () => {
  const { byId } = await renderReport(AT_SEA);
  const now = Cesium.JulianDate.now();
  const stem = (id) => byId.get(`marine-buoy:${id}`).polyline.positions.getValue(now);
  const topOf = (id) => Cesium.Cartographic.fromCartesian(stem(id)[1]).height;
  const baseOf = (id) => Cesium.Cartographic.fromCartesian(stem(id)[0]).height;

  assert.ok(Math.abs(baseOf('C')) < 1, 'the stem starts at the sea surface');
  assert.ok(Math.abs(topOf('C') - 8_000) < 1, '0.8 m × 10 000 = 8 km');
  assert.ok(Math.abs(topOf('E') - 82_000) < 1, '8.2 m × 10 000 = 82 km');
  assert.ok(Math.abs(topOf('F') - SWELL_STEM_SCALE.maxStemM) < 1, '17 m clips at 140 km');
  assert.ok(Math.abs(topOf('A') - SWELL_STEM_SCALE.minStemM) < 1, '0 m sits on the floor');
  // Two vertices only — the geodesic default would subdivide a segment whose
  // ends share a longitude.
  assert.equal(byId.get('marine-buoy:C').polyline.positions.getValue(now).length, 2);
  assert.equal(byId.get('marine-buoy:C').polyline.arcType.getValue(now), Cesium.ArcType.NONE);
});

// A5 on the map, not only in the legend: a clipped stem stops asserting its
// top, and the repo's existing sign for that is a dash.
test('a clipped stem is dashed, a measured one is solid', async () => {
  const { byId } = await renderReport(AT_SEA);
  const material = (id) => byId.get(`marine-buoy:${id}`).polyline.material;
  assert.ok(material('F') instanceof Cesium.PolylineDashMaterialProperty, '17 m is clipped');
  assert.ok(!(material('E') instanceof Cesium.PolylineDashMaterialProperty), '8.2 m is measured');
});

// B2 — the stem is world units, so nothing may also scale it on screen, and
// the dot must stop being a size channel of its own.
test('the dot is one constant size for every station, and shape tells them apart', async () => {
  const { byId } = await renderReport(AT_SEA);
  const now = Cesium.JulianDate.now();
  const sizes = new Set(
    [...byId.values()].map((entity) => entity.point.pixelSize.getValue(now)),
  );
  assert.deepEqual([...sizes], [BUOY_POINT_PX], 'one size, carrying nothing');

  const measured = byId.get('marine-buoy:C').point;
  const sensorless = byId.get('marine-buoy:G').point;
  assert.ok(measured.color.getValue(now).alpha > 0.9, 'filled disc');
  assert.ok(sensorless.color.getValue(now).alpha < 0.2, 'hollow ring');
  assert.ok(
    sensorless.outlineWidth.getValue(now) > measured.outlineWidth.getValue(now),
    'the ring is drawn by its outline',
  );
});

test('the layer never composes a screen scale with the world-unit stem', () => {
  const source = readFileSync(new URL('./marineBuoys.js', import.meta.url), 'utf8');
  // The property, not the word — the header discusses `scaleByDistance` at
  // length precisely to explain why the layer must never set one.
  assert.equal(/scaleByDistance\s*:/.test(source), false, 'B2: no size composition');
  // One `pixelSize`, and it is the shared constant rather than a literal, so a
  // second size encoding cannot be reintroduced without this failing.
  assert.equal((source.match(/pixelSize\s*:/g) || []).length, 1);
  assert.match(source, /pixelSize: BUOY_POINT_PX/);
});

test('stats and row controls publish what the size channel drew', async () => {
  const { layer } = await renderReport(AT_SEA);
  const stats = layer.getStats();
  assert.equal(stats.count, AT_SEA.length, 'one entity per station, stem included');
  assert.equal(stats.swell.stems, 6);
  assert.equal(stats.swell.noStem, 2);
  assert.equal(stats.swell.clipped, 1);

  const controls = layer.getRowControls();
  assert.ok(Array.isArray(controls.legend) && controls.legend.length > 0);
  assert.deepEqual(controls.chips, []);
});

test('row controls stay silent before anything is drawn', () => {
  const layer = createMarineBuoysLayer({ overlayHost: silentOverlayHost() });
  assert.equal(layer.getRowControls(), null);
  assert.equal(layer.getStats().swell, null);
});
