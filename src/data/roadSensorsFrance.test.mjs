// src/data/roadSensorsFrance.test.mjs
// Covers the Capteurs trafic LAYER, whose whole job is refusing to overclaim:
// a measured speed is not a congestion level, a zero built from no samples is
// not a zero, and a reading's age is part of the reading. The upstream DATEX II
// shape is pinned separately in bisonFuteFeed.test.mjs.
//
// The proxy payload used here is produced by running the REAL projection over
// the REAL captured QTV document and its referential, so a drift in either the
// feed or the projection surfaces here too rather than being mocked away.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';
import {
  ROAD_SENSORS_FR_LAYER_ID,
  ROAD_SENSORS_FR_OVERLAY_COHORT_LIMIT,
  ROAD_SENSOR_DEFAULT_METRIC,
  ROAD_SENSOR_FLOW_BANDS,
  ROAD_SENSOR_METRICS,
  ROAD_SENSOR_MIN_SEGMENT_DEG,
  ROAD_SENSOR_NO_DATA_BAND,
  ROAD_SENSOR_SPEED_BANDS,
  ROAD_SENSOR_STALE_AGE_MS,
  createRoadSensorOverlayEntry,
  createRoadSensorSelectedEntry,
  createRoadSensorsFranceLayer,
  formatSensorAge,
  mapRoadSensorAnalystRecord,
  roadSensorAnchor,
  roadSensorBand,
  roadSensorClassificationForScene,
  roadSensorClassificationForStack,
  roadSensorDetails,
  roadSensorIsSegment,
  roadSensorIsStopped,
  roadSensorLegend,
  roadSensorTitle,
  selectRoadSensorOverlayCohort,
  summarizeRoadSensors,
} from './roadSensorsFrance.js';
import { projectRoadSensors } from './bisonFuteFeed.js';
import { LAYER_STATE_REGISTRY } from './layerState.js';

const read = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const QTV_XML = read('bison-fute-qtv-sample.xml');
const QTV_CSV = read('bison-fute-qtv-referentiel-sample.csv');
/** When the captured QTV file was actually written. */
const CAPTURE_MS = Date.parse('2026-08-31T22:11:52+02:00');

/** Build the payload the proxy would serve from the captured documents. */
function proxyPayload(overrides = {}) {
  const projected = projectRoadSensors(QTV_XML, QTV_CSV, { nowMs: CAPTURE_MS });
  return {
    fetchedAt: CAPTURE_MS,
    stale: false,
    ttlMs: 180_000,
    source: 'Bison Futé / Tipi (tipi.bison-fute.gouv.fr)',
    publishedAt: projected.publishedAt,
    publishedAtMs: projected.publishedAtMs,
    measuredAtMs: projected.measuredAtMs,
    ageMs: projected.ageMs,
    counts: projected.counts,
    stations: projected.stations,
    ...overrides,
  };
}

const PAYLOAD = proxyPayload();
const byId = (id) => PAYLOAD.stations.find((station) => station.id === id);

// ── Bands ───────────────────────────────────────────────────────────────────

test('the bands are contiguous, ordered, and distinctly coloured', () => {
  for (const bands of [ROAD_SENSOR_SPEED_BANDS, ROAD_SENSOR_FLOW_BANDS]) {
    for (let i = 1; i < bands.length; i++) {
      assert.equal(bands[i].min, bands[i - 1].max, 'bands must not leave a gap or overlap');
    }
    assert.equal(bands[0].min, 0);
    assert.equal(bands[bands.length - 1].max, Infinity);
    const colors = bands.map((band) => band.color.toLowerCase());
    assert.equal(new Set(colors).size, colors.length);
    assert.ok(!colors.includes(ROAD_SENSOR_NO_DATA_BAND.color.toLowerCase()));
  }
});

test('a speed band never claims a congestion level in words', () => {
  // The whole point of the layer's honesty: QTV publishes no reference speed,
  // so no label may say "fluide" or "congestionné". "À l'arrêt" is allowed
  // because it is arithmetic, not a judgement.
  const forbidden = /fluide|congestionn|dense|satur|bouchon/i;
  for (const band of ROAD_SENSOR_SPEED_BANDS) {
    assert.ok(!forbidden.test(band.label), `${band.label} claims a congestion level`);
    assert.ok(!forbidden.test(band.blurb), `${band.blurb} claims a congestion level`);
  }
});

test('a zero built from no samples reads as no measurement, not as a jam', () => {
  // MYK69.K1: 7 114 véh/h counted, beside a 0.0 km/h computed from zero
  // samples. The projection nulls the speed; the band must not resurrect it.
  const trap = byId('MYK69.K1');
  assert.equal(trap.flow, 7114);
  assert.equal(trap.speed, null);
  assert.equal(roadSensorBand(trap, 'speed'), ROAD_SENSOR_NO_DATA_BAND);
  assert.equal(roadSensorIsStopped(trap), false);
  // Its FLOW is a real measurement and keeps its own band.
  assert.equal(roadSensorBand(trap, 'flow').id, 'saturated');
  assert.equal(roadSensorTitle(trap, 'speed'), 'N346 · vitesse non mesurée');
});

test('vehicles counted at zero speed is the one claim the data supports', () => {
  const stopped = byId('MYL42.U2');
  assert.equal(stopped.speed, 0);
  assert.equal(stopped.flow, 600);
  assert.equal(roadSensorIsStopped(stopped), true);
  assert.equal(roadSensorBand(stopped, 'speed').id, 'stopped');
  assert.equal(roadSensorTitle(stopped, 'speed'), 'A72 · à l’arrêt');
  assert.ok(roadSensorDetails(stopped).includes('Véhicules comptés à vitesse nulle — trafic arrêté'));
});

test('an empty road at night is not painted as a national traffic jam', () => {
  // MY269.C4: 0 km/h and 0 véh/h, both from 420 samples, on the A42 at 22:00.
  // Read as "0 km/h" it is the worst jam on the map; it is an empty road.
  const silent = byId('MY269.C4');
  assert.equal(silent.speed, 0);
  assert.equal(silent.flow, 0);
  assert.equal(roadSensorIsStopped(silent), false);
  assert.equal(roadSensorBand(silent, 'speed'), ROAD_SENSOR_NO_DATA_BAND);
  // Under the flow metric it is honestly "no vehicles", which is what happened.
  assert.equal(roadSensorBand(silent, 'flow').id, 'empty');
});

test('band edges land on the side the label promises', () => {
  const speedAt = (speed) => roadSensorBand({ speed, flow: 100 }, 'speed').id;
  assert.equal(speedAt(0), 'stopped');
  assert.equal(speedAt(29.9), 'crawl');
  assert.equal(speedAt(30), 'slow');
  assert.equal(speedAt(59.9), 'slow');
  assert.equal(speedAt(60), 'medium');
  assert.equal(speedAt(90), 'fast');
  assert.equal(speedAt(149), 'fast');
  const flowAt = (flow) => roadSensorBand({ flow }, 'flow').id;
  assert.equal(flowAt(0), 'empty');
  assert.equal(flowAt(499), 'light');
  assert.equal(flowAt(500), 'moderate');
  assert.equal(flowAt(5000), 'saturated');
  // A missing value is grey under either metric, and an unknown metric falls
  // back to the default rather than colouring by nothing.
  assert.equal(roadSensorBand({ speed: null, flow: null }, 'speed'), ROAD_SENSOR_NO_DATA_BAND);
  assert.equal(roadSensorBand({ speed: 100, flow: null }, 'inventé').id, 'fast');
  assert.equal(roadSensorBand(null, 'speed'), ROAD_SENSOR_NO_DATA_BAND);
});

// ── Cards ───────────────────────────────────────────────────────────────────

test('a card shows both readings, their sample counts, and the caveat', () => {
  const lines = roadSensorDetails(byId('MUM76.h1'), 12 * 60_000);
  assert.ok(lines.some((line) => line === 'Vitesse moyenne 108 km/h (11 mesures)'));
  assert.ok(lines.some((line) => line === 'Débit 110 véh/h (11 mesures)'));
  assert.ok(lines.some((line) => line === 'PR 76PR91D'));
  assert.ok(lines.some((line) => line === 'Mesure il y a 12 min'));
  assert.ok(lines.some((line) => line === 'Station MUM76.h1'));
  // The caveat is on EVERY card, because the legend it qualifies is always up.
  assert.ok(lines.some((line) => line.includes('pas un niveau de congestion')));
});

test('an unmeasured value says so instead of showing a zero', () => {
  const lines = roadSensorDetails(byId('MM713.O1'));
  assert.ok(lines.includes('Vitesse moyenne non mesurée sur cette période'));
  assert.ok(lines.includes('Débit non mesuré sur cette période'));
  assert.ok(!lines.some((line) => /0 km\/h|0 véh\/h/.test(line)));
});

test('the age is phrased at the scale a reader thinks in', () => {
  assert.equal(formatSensorAge(0), 'à l’instant');
  assert.equal(formatSensorAge(59_000), 'à l’instant');
  assert.equal(formatSensorAge(12 * 60_000), 'il y a 12 min');
  assert.equal(formatSensorAge(3 * 3_600_000), 'il y a 3 h');
  assert.equal(formatSensorAge(50 * 3_600_000), 'il y a 2 j');
  assert.equal(formatSensorAge(null), null);
  assert.equal(formatSensorAge(-1), null);
});

// ── Geometry ────────────────────────────────────────────────────────────────

test('a station whose two ends coincide is drawn as a point, not a line', () => {
  // MY269.C4 publishes x_deb === x_fin. A zero-length clamped polyline is a
  // tessellation failure, not a drawing.
  const degenerate = byId('MY269.C4');
  assert.deepEqual(degenerate.from, degenerate.to);
  assert.equal(roadSensorIsSegment(degenerate), false);
  // MB333.O1 publishes only one end at all.
  assert.equal(byId('MB333.O1').to, null);
  assert.equal(roadSensorIsSegment(byId('MB333.O1')), false);
  // A real instrumented section is a line.
  assert.equal(roadSensorIsSegment(byId('MUM76.h1')), true);
  // Either ordinate clearing the threshold is enough; neither clearing it is a
  // point. (The bound is compared in degrees, so it is deliberately not tested
  // at exactly the threshold, where float subtraction decides the answer.)
  const just = ROAD_SENSOR_MIN_SEGMENT_DEG;
  assert.equal(roadSensorIsSegment({ from: [2, 48], to: [2 + just * 2, 48] }), true);
  assert.equal(roadSensorIsSegment({ from: [2, 48], to: [2, 48 + just * 2] }), true);
  assert.equal(roadSensorIsSegment({ from: [2, 48], to: [2 + just / 2, 48 + just / 2] }), false);
});

test('a station is anchored at its published start', () => {
  assert.deepEqual(roadSensorAnchor(byId('MUM76.h1')), byId('MUM76.h1').from);
  assert.equal(roadSensorAnchor({ from: null }), null);
  assert.equal(roadSensorAnchor(null), null);
});

// ── Summary, legend, overlay ────────────────────────────────────────────────

test('the legend counts drawn stations and separates the ones that measured nothing', () => {
  const summary = summarizeRoadSensors(PAYLOAD.stations, 'speed');
  assert.equal(summary.total, PAYLOAD.stations.length);
  assert.equal(summary.stopped, 1);
  assert.ok(summary.measured < summary.total, 'the fixture must hold an unmeasured station');
  const legend = roadSensorLegend(summary.byBand, 'speed');
  assert.equal(legend.reduce((total, row) => total + row.count, 0), summary.total);
  for (const row of legend) assert.ok(row.count > 0);
  // Grey sorts last, so a reader reads the measurements before the gaps.
  assert.equal(legend[legend.length - 1].label, ROAD_SENSOR_NO_DATA_BAND.label);
  // Switching metric re-tallies: the same stations, different bands.
  const flow = summarizeRoadSensors(PAYLOAD.stations, 'flow');
  assert.equal(flow.total, summary.total);
  assert.notDeepEqual(flow.byBand, summary.byBand);
});

test('the label cohort is bounded, stable, and led by the stopped roads', () => {
  const position = Cesium.Cartesian3.fromDegrees(2.3, 48.8);
  const entries = PAYLOAD.stations.map((station) => createRoadSensorOverlayEntry({
    id: station.id, position, station, metricId: 'speed',
  }));
  const cohort = selectRoadSensorOverlayCohort(entries, 2);
  assert.equal(cohort.length, 2);
  assert.ok(cohort[0].id.includes('MYL42.U2'), 'a stopped road outranks a busy one');
  assert.deepEqual(
    cohort.map((entry) => entry.id),
    selectRoadSensorOverlayCohort(entries.slice().reverse(), 2).map((entry) => entry.id),
  );
  assert.ok(selectRoadSensorOverlayCohort(entries, 999).length <= ROAD_SENSORS_FR_OVERLAY_COHORT_LIMIT);
  assert.equal(selectRoadSensorOverlayCohort(entries, 0).length, 0);
});

test('the selected card is anchored, accented and complete', () => {
  const entry = createRoadSensorSelectedEntry({
    id: 'x',
    position: Cesium.Cartesian3.fromDegrees(2.3, 48.8),
    station: byId('MYL42.U2'),
    metricId: 'speed',
    ageMs: 12 * 60_000,
  });
  assert.equal(entry.variant, 'selected');
  assert.equal(entry.accent, ROAD_SENSOR_SPEED_BANDS[0].color);
  assert.ok(entry.details.length >= 5);
  assert.equal(createRoadSensorSelectedEntry({ id: null, position: null, station: {} }), null);
});

test('the analyst record is JSON-safe and never NaN', () => {
  for (const [index, station] of PAYLOAD.stations.entries()) {
    const record = mapRoadSensorAnalystRecord(station, index);
    assert.equal(JSON.parse(JSON.stringify(record)).id, record.id);
    for (const [key, value] of Object.entries(record)) {
      assert.ok(!Number.isNaN(value), `${key} is NaN`);
      assert.notEqual(value, undefined, `${key} is undefined`);
    }
    assert.ok(record.lat > 41 && record.lat < 52);
  }
  const empty = mapRoadSensorAnalystRecord(null, 3);
  assert.equal(empty.id, 'QTV-0003');
  assert.equal(empty.speedKmh, null);
  assert.equal(empty.stopped, false);
});

test('ground lines classify against the active surface, and fall back to BOTH', () => {
  assert.equal(roadSensorClassificationForStack('photoreal'), Cesium.ClassificationType.CESIUM_3D_TILE);
  assert.equal(roadSensorClassificationForStack('osm'), Cesium.ClassificationType.TERRAIN);
  assert.equal(roadSensorClassificationForStack('a-stack-from-2030'), Cesium.ClassificationType.BOTH);
  assert.equal(roadSensorClassificationForScene({ globe: { show: false } }), Cesium.ClassificationType.CESIUM_3D_TILE);
  assert.equal(roadSensorClassificationForScene(null), Cesium.ClassificationType.BOTH);
});

// ── Lifecycle ───────────────────────────────────────────────────────────────

function createHarness(responses = [PAYLOAD]) {
  const dataSources = [];
  const hostCalls = [];
  let poll = 0;
  const overlayHost = {
    setEntries: (...args) => hostCalls.push(['entries', ...args]),
    setVisible: (...args) => hostCalls.push(['visible', ...args]),
    clearSource: (...args) => hostCalls.push(['clear', ...args]),
  };
  const viewer = {
    scene: { globe: { show: true }, requestRender() {} },
    dataSources: {
      add(dataSource) { dataSources.push(dataSource); return dataSource; },
      remove(dataSource) {
        const index = dataSources.indexOf(dataSource);
        if (index >= 0) dataSources.splice(index, 1);
        return index >= 0;
      },
    },
  };
  const fetchImpl = async () => {
    const payload = responses[Math.min(poll++, responses.length - 1)];
    if (payload instanceof Error) throw payload;
    if (typeof payload?.status === 'number') return { ok: false, status: payload.status };
    return { ok: true, status: 200, json: async () => payload };
  };
  const layer = createRoadSensorsFranceLayer({
    overlayHost,
    fetchImpl,
    mapStackEventTarget: new EventTarget(),
  });
  return { layer, viewer, dataSources, hostCalls, entities: () => dataSources[0]?.entities.values ?? [] };
}

test('lifecycle draws every placed station, as a line or as a point', async () => {
  const h = createHarness();
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  assert.equal(await h.layer.update(), true);

  assert.equal(h.entities().length, PAYLOAD.stations.length);
  const lines = h.entities().filter((entity) => entity.polyline).length;
  const points = h.entities().filter((entity) => entity.point).length;
  assert.ok(lines > 0 && points > 0, 'the fixture must hold both shapes');
  assert.equal(lines + points, PAYLOAD.stations.length);
  for (const entity of h.entities()) {
    if (entity.polyline) {
      assert.equal(entity.polyline.clampToGround.getValue(), true);
      assert.ok(entity.polyline.material instanceof Cesium.ColorMaterialProperty);
    } else {
      assert.equal(entity.point.heightReference.getValue(), Cesium.HeightReference.CLAMP_TO_GROUND);
    }
  }

  const stats = h.layer.getStats();
  assert.equal(stats.count, PAYLOAD.stations.length);
  // The census behind the drawn set: nine reported, seven placeable.
  assert.equal(stats.published, PAYLOAD.counts.published);
  assert.ok(stats.published > stats.count, 'the gap must be visible, not silent');
  assert.equal(stats.metric, ROAD_SENSOR_DEFAULT_METRIC);
  assert.equal(stats.stopped, 1);
  assert.equal(stats.coverage, 'RRN non concédé');
  h.layer.destroy(h.viewer);
});

test('the metric chip recolours the same stations without refetching', async () => {
  const h = createHarness();
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  await h.layer.update();
  const drawn = h.entities().length;

  let repaints = 0;
  h.layer.setRowControlsListener(() => { repaints += 1; });
  assert.equal(h.layer.setParams({ metric: 'flow' }), true);
  assert.equal(repaints, 1);
  assert.equal(h.entities().length, drawn, 'a metric switch is a recolour, not a refetch');
  assert.equal(h.layer.getStats().metric, 'flow');

  const { chips, legend } = h.layer.getRowControls();
  assert.deepEqual(chips.map((chip) => chip.id), ROAD_SENSOR_METRICS.map((metric) => metric.id));
  assert.equal(chips.filter((chip) => chip.active).length, 1);
  assert.ok(legend.some((row) => row.label.includes('véh/h')), 'the legend follows the metric');

  assert.equal(h.layer.setParams({ metric: 'flow' }), false);
  assert.equal(h.layer.setParams({ metric: 'inventé' }), false);
  assert.equal(h.layer.setParams({}), false);
  h.layer.destroy(h.viewer);
});

test('an old reading is stale even when the proxy says it is fresh', async () => {
  const old = proxyPayload({ stale: false, ageMs: ROAD_SENSOR_STALE_AGE_MS + 60_000 });
  const h = createHarness([old]);
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  await h.layer.update();
  // The proxy is honestly serving a fresh fetch; the FEED simply stopped
  // moving. Both are staleness to a reader.
  assert.equal(h.layer.getStats().stale, true);
  assert.equal(h.layer.getStats().ageMs, ROAD_SENSOR_STALE_AGE_MS + 60_000);
  h.layer.destroy(h.viewer);

  const fresh = createHarness([proxyPayload({ ageMs: 12 * 60_000 })]);
  fresh.layer.init(fresh.viewer);
  fresh.layer.enable(fresh.viewer);
  await fresh.layer.update();
  assert.equal(fresh.layer.getStats().stale, false);
  fresh.layer.destroy(fresh.viewer);
});

test('a failed poll keeps the last good readings', async () => {
  const h = createHarness([PAYLOAD, { status: 502 }, new Error('offline')]);
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  assert.equal(await h.layer.update(), true);
  const drawn = h.entities().length;
  assert.equal(await h.layer.update(), false);
  assert.equal(h.entities().length, drawn);
  assert.match(h.layer.getStats().error, /HTTP 502/);
  assert.equal(await h.layer.update(), false);
  assert.equal(h.entities().length, drawn);
  h.layer.destroy(h.viewer);
});

test('a malformed payload is refused rather than drawn as an empty network', async () => {
  const h = createHarness([{ ...PAYLOAD, stations: null }]);
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  assert.equal(await h.layer.update(), false);
  assert.equal(h.entities().length, 0);
  assert.equal(h.layer.getStats().error, 'Réponse QTV malformée');
  h.layer.destroy(h.viewer);
});

test('a disabled layer draws nothing, answers nothing, and polls nothing', async () => {
  const h = createHarness();
  h.layer.init(h.viewer);
  h.layer.enable(h.viewer);
  await h.layer.update();
  assert.ok(h.layer.getAnalystRecords().length > 0);

  h.layer.disable();
  assert.equal(h.dataSources[0].show, false);
  assert.deepEqual(h.layer.getAnalystRecords(), []);
  assert.equal(await h.layer.update(), false);
  assert.ok(h.hostCalls.some(([kind, source]) => kind === 'clear' && source === ROAD_SENSORS_FR_LAYER_ID));

  h.layer.destroy(h.viewer);
  assert.equal(h.dataSources.length, 0);
});

test('the layer is registered with exactly one share disposition', () => {
  const entries = LAYER_STATE_REGISTRY.filter((entry) => entry.id === ROAD_SENSORS_FR_LAYER_ID);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].disposition, 'enabled-only');
});
