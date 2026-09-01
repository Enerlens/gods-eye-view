// src/data/hubeauHydrometry.test.mjs
// Pins the Hub'Eau contract against a real captured observations_tr response —
// unit conversion, the site-level duplicate filter, the silently-failing bbox
// order, and the layer's viewport gate and lifecycle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';
import {
  HUBEAU_MAX_VIEWPORT_DEGREES,
  HUBEAU_OBSERVATION_WINDOW_MS,
  HUBEAU_OVERLAY_COHORT_LIMIT,
  HUBEAU_OVERLAY_COLLISION_CAPACITY,
  HUBEAU_QUALIFICATION_DOUBTFUL,
  buildHubeauRecords,
  createHubeauHydrometryLayer,
  createHubeauOverlayEntry,
  formatHubeauDischarge,
  formatHubeauStage,
  hubeauBboxParam,
  hubeauDischargeM3s,
  hubeauFreshness,
  hubeauObservationsRequestUrl,
  hubeauPixelSize,
  hubeauReading,
  hubeauStageM,
  hubeauStationsRequestUrl,
  hubeauViewportBox,
  mapAnalystRecord,
  parseHubeauObservations,
  parseHubeauStations,
  selectHubeauOverlayCohort,
  summarizeHubeauRecords,
  HUBEAU_HISTORY_WINDOW_MS,
  HUBEAU_LAYER_ID,
  HUBEAU_SELECTED_OVERLAY_SOURCE_ID,
  HUBEAU_SELECTED_OVERLAY_SOURCE_OPTIONS,
  HUBEAU_SELECTED_COLOR,
  buildHubeauCard,
  createHubeauSelectedOverlayEntry,
  hubeauHistoryRequestUrl,
  parseHubeauHistory,
} from './hubeauHydrometry.js';

const OBSERVATIONS = JSON.parse(readFileSync(
  new URL('./fixtures/hubeau-observations-tr-sample.json', import.meta.url),
  'utf8',
));

/** Timestamp of the captured rows, so freshness tests are deterministic. */
const CAPTURE_MS = Date.parse('2026-08-26T07:35:00Z');

const STATIONS_GEOJSON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        code_station: 'F447000302',
        libelle_station: "L'Yerres à Courtomer",
        libelle_cours_eau: "L'Yerres",
      },
      geometry: { type: 'Point', coordinates: [2.81, 48.61] },
    },
    {
      type: 'Feature',
      properties: { code_station: 'F459000101', libelle_station: '', libelle_cours_eau: null },
      geometry: { type: 'Point', coordinates: [2.6, 48.7] },
    },
    // Rejected: no code.
    { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [2, 48] } },
  ],
};

// ── Units ───────────────────────────────────────────────────────────────────

test('Q is litres per second and H is millimetres — both divided by 1000', () => {
  // Le Rhône à Tarascon read 717000 L/s on 2026-08-26. As m³/s that is 717,
  // right for the lower Rhône; read as m³/s it would be 3.4 Amazons.
  assert.equal(hubeauDischargeM3s(717000), 717);
  assert.equal(hubeauStageM(978), 0.978);
  // 15% of live stage readings are negative — a real drawdown, not an error.
  assert.equal(hubeauStageM(-17180), -17.18);
});

test('display formatting keeps precision sensible across four orders of magnitude', () => {
  assert.equal(formatHubeauDischarge(0.42), '0.42 m³/s');
  assert.equal(formatHubeauDischarge(72.2), '72.2 m³/s');
  assert.equal(formatHubeauDischarge(717), '717 m³/s');
  assert.equal(formatHubeauDischarge(-3.5), '-3.5 m³/s');
  // Named "gauge" because it is a staff reading against a local zero.
  assert.equal(formatHubeauStage(0.978), 'gauge 0.98 m');
  assert.equal(formatHubeauStage(-17.18), 'gauge -17.18 m');
});

// ── Request building ────────────────────────────────────────────────────────

test('bbox is lon_min,lat_min,lon_max,lat_max — the order that fails silently if swapped', () => {
  assert.equal(
    hubeauBboxParam({ south: 48.5, west: 2, north: 49.1, east: 2.9 }),
    '2.0000,48.5000,2.9000,49.1000',
  );
});

test('the station request keeps the coordinate fields that geometry depends on', () => {
  const url = hubeauStationsRequestUrl({ south: 48.5, west: 2, north: 49.1, east: 2.9 });
  const params = new URL(url).searchParams;
  assert.equal(params.get('en_service'), 'true');
  assert.equal(params.get('format'), 'geojson');
  // Asking for `fields` without these two makes every feature's geometry null.
  assert.match(params.get('fields'), /longitude_station/);
  assert.match(params.get('fields'), /latitude_station/);
});

test('the observation request carries the hour window and no fields trap', () => {
  const since = Date.parse('2026-08-26T06:35:00Z');
  const url = hubeauObservationsRequestUrl({ south: 48.5, west: 2, north: 49.1, east: 2.9 }, since);
  const params = new URL(url).searchParams;
  assert.equal(params.get('date_debut_obs'), '2026-08-26T06:35:00.000Z');
  assert.equal(params.get('sort'), 'desc');
  // `fields` is 5x slower on this hot path for 21% less wire.
  assert.equal(params.get('fields'), null);
});

// ── Parsing ─────────────────────────────────────────────────────────────────

test('site-level rows with a null code_station are dropped as duplicates', () => {
  // The captured fixture contains a real pair: a station row for F447000302
  // and a null-code_station site row carrying the identical value.
  const rawNullRows = OBSERVATIONS.data.filter((row) => !row.code_station);
  assert.ok(rawNullRows.length >= 1, 'the fixture must still exercise the duplicate case');
  const parsed = parseHubeauObservations(OBSERVATIONS);
  assert.equal(parsed.size, 3, 'three real stations, the site duplicate discarded');
  assert.ok(parsed.has('F447000302'));
  assert.equal(parsed.get('F447000302').Q.value, 42600);
  assert.deepEqual([...parsed.keys()].filter((key) => !key), []);
});

test('parsing carries the producer doubt flag through', () => {
  const parsed = parseHubeauObservations(OBSERVATIONS);
  assert.equal(parsed.get('F459000101').Q.doubtful, true, 'qualification 12 is Douteuse');
  assert.equal(parsed.get('F447000302').Q.doubtful, false);
  assert.equal(HUBEAU_QUALIFICATION_DOUBTFUL, 12);
});

test('parsing keeps the newest reading per station and grandeur', () => {
  const parsed = parseHubeauObservations({
    data: [
      { code_station: 'A1', grandeur_hydro: 'Q', resultat_obs: 100, date_obs: '2026-08-26T07:00:00Z', longitude: 1, latitude: 2 },
      { code_station: 'A1', grandeur_hydro: 'Q', resultat_obs: 200, date_obs: '2026-08-26T07:30:00Z', longitude: 1, latitude: 2 },
      { code_station: 'A1', grandeur_hydro: 'H', resultat_obs: 50, date_obs: '2026-08-26T07:30:00Z', longitude: 1, latitude: 2 },
    ],
  });
  assert.equal(parsed.get('A1').Q.value, 200);
  assert.equal(parsed.get('A1').H.value, 50);
});

test('parsing refuses rows it cannot place or read', () => {
  const parsed = parseHubeauObservations({
    data: [
      { code_station: 'B1', grandeur_hydro: 'V', resultat_obs: 1, date_obs: '2026-08-26T07:00:00Z', longitude: 1, latitude: 2 },
      { code_station: 'B2', grandeur_hydro: 'Q', resultat_obs: null, date_obs: '2026-08-26T07:00:00Z', longitude: 1, latitude: 2 },
      { code_station: 'B3', grandeur_hydro: 'Q', resultat_obs: 1, date_obs: 'never', longitude: 1, latitude: 2 },
    ],
  });
  assert.equal(parsed.size, 0);
  assert.deepEqual(parseHubeauObservations(null).size, 0);
});

test('station reference parsing falls back to the code when the label is blank', () => {
  const stations = parseHubeauStations(STATIONS_GEOJSON);
  assert.equal(stations.size, 2);
  assert.equal(stations.get('F447000302').name, "L'Yerres à Courtomer");
  assert.equal(stations.get('F459000101').name, 'F459000101');
  assert.equal(stations.get('F459000101').river, null);
});

// ── Reading selection ───────────────────────────────────────────────────────

test('discharge wins over stage — it is the only reading comparable between stations', () => {
  const reading = hubeauReading({
    Q: { value: 42600, atMs: CAPTURE_MS, doubtful: false },
    H: { value: 978, atMs: CAPTURE_MS, doubtful: false },
  }, CAPTURE_MS);
  assert.equal(reading.kind, 'Q');
  assert.equal(reading.text, '42.6 m³/s');
});

test('a doubtful reading is shown but marked, never silently laundered', () => {
  const reading = hubeauReading({
    Q: { value: 5090, atMs: CAPTURE_MS, doubtful: true },
  }, CAPTURE_MS);
  assert.equal(reading.doubtful, true);
  assert.equal(reading.text, '5.1 m³/s ?');
});

test('an expired reading yields no reading at all', () => {
  const ancient = CAPTURE_MS - 30 * 86400000; // Réunion was 25 days stale
  const reading = hubeauReading({ H: { value: 100, atMs: ancient, doubtful: false } }, CAPTURE_MS);
  assert.equal(reading.kind, null);
  assert.equal(reading.text, null);
  assert.equal(hubeauReading(null, CAPTURE_MS).freshness, 'none');
});

test('freshness bands', () => {
  assert.equal(hubeauFreshness(CAPTURE_MS - 60000, CAPTURE_MS), 'live');
  assert.equal(hubeauFreshness(CAPTURE_MS - 4 * 3600000, CAPTURE_MS), 'stale');
  assert.equal(hubeauFreshness(CAPTURE_MS - 30 * 86400000, CAPTURE_MS), 'expired');
  assert.equal(hubeauFreshness(null, CAPTURE_MS), 'none');
});

test('only a trustworthy discharge scales a dot — stage and doubt do not', () => {
  const base = hubeauPixelSize({ kind: 'H', value: 0.98, doubtful: false });
  assert.equal(base, 5);
  assert.equal(hubeauPixelSize({ kind: 'Q', value: 717, doubtful: true }), 5);
  assert.equal(hubeauPixelSize(null), 5);
  const small = hubeauPixelSize({ kind: 'Q', value: 0.5, doubtful: false });
  const big = hubeauPixelSize({ kind: 'Q', value: 2400, doubtful: false });
  assert.ok(big > small, 'the Rhône must draw larger than a brook');
  assert.ok(big <= 15, 'the ramp stays bounded');
  // A negative (tidal) discharge must not produce NaN.
  assert.ok(Number.isFinite(hubeauPixelSize({ kind: 'Q', value: -3, doubtful: false })));
});

// ── Records ─────────────────────────────────────────────────────────────────

test('only reporting stations are drawn, named from the reference set', () => {
  const records = buildHubeauRecords(
    parseHubeauObservations(OBSERVATIONS),
    parseHubeauStations(STATIONS_GEOJSON),
    CAPTURE_MS,
  );
  assert.equal(records.length, 3);
  const byCode = new Map(records.map((record) => [record.code, record]));
  assert.equal(byCode.get('F447000302').name, "L'Yerres à Courtomer");
  // A reporting station absent from the reference page still gets drawn,
  // under its code — silence in one feed must not delete a real measurement.
  assert.equal(byCode.get('F490000105').name, 'F490000105');
});

test('records without coordinates are not drawn', () => {
  const observations = new Map([['X1', {
    code: 'X1', lon: null, lat: null, Q: { value: 1000, atMs: CAPTURE_MS, doubtful: false }, H: null,
  }]]);
  assert.deepEqual(buildHubeauRecords(observations, new Map(), CAPTURE_MS), []);
});

test('summary separates live, stale, doubtful and discharge counts', () => {
  const records = buildHubeauRecords(
    parseHubeauObservations(OBSERVATIONS),
    parseHubeauStations(STATIONS_GEOJSON),
    CAPTURE_MS,
  );
  const summary = summarizeHubeauRecords(records);
  assert.equal(summary.total, 3);
  assert.equal(summary.doubtful, 1);
  assert.equal(summary.live + summary.stale, 3);
  assert.deepEqual(summarizeHubeauRecords(null), {
    total: 0, live: 0, stale: 0, doubtful: 0, discharge: 0,
  });
});

// ── Overlay ─────────────────────────────────────────────────────────────────

test('overlay entry ranks big rivers above doubtful and stage-only stations', () => {
  const position = Cesium.Cartesian3.fromDegrees(2.35, 48.85);
  const big = createHubeauOverlayEntry(
    { code: 'A', name: 'Le Rhône', reading: { kind: 'Q', value: 717, doubtful: false, freshness: 'live', text: '717 m³/s' } },
    position,
  );
  const gauge = createHubeauOverlayEntry(
    { code: 'B', name: 'Un ru', reading: { kind: 'H', value: 0.3, doubtful: false, freshness: 'live', text: 'gauge 0.30 m' } },
    position,
  );
  assert.equal(big.title, 'Le Rhône · 717 m³/s');
  assert.ok(big.priority > gauge.priority);
  assert.equal(big.interactive, false);
  assert.equal(big.paintLane, 'ambient-label');
  assert.equal(big.id, 'hubeau:A');
});

test('overlay cohort honours the cap and orders by priority', () => {
  const entries = Array.from({ length: 400 }, (_, i) => ({ id: `s${i}`, priority: i }));
  const cohort = selectHubeauOverlayCohort(entries, 1000);
  assert.equal(cohort.length, HUBEAU_OVERLAY_COHORT_LIMIT);
  assert.equal(cohort[0].id, 's399');
  assert.deepEqual(selectHubeauOverlayCohort(null), []);
  assert.deepEqual(selectHubeauOverlayCohort(entries, 0), []);
});

// ── Viewport gate ───────────────────────────────────────────────────────────

test('the viewport gate admits France and refuses a global camera', () => {
  const france = { south: 41.3, west: -5.2, north: 51.1, east: 9.6 };
  assert.deepEqual(hubeauViewportBox(france), france);
  assert.equal(hubeauViewportBox({ south: -80, west: -170, north: 80, east: 170 }), null);
  assert.equal(hubeauViewportBox({ south: 48, west: 2, north: 48 + HUBEAU_MAX_VIEWPORT_DEGREES + 0.1, east: 3 }), null);
  assert.equal(hubeauViewportBox({ south: 40, west: 0, north: 50, east: HUBEAU_MAX_VIEWPORT_DEGREES + 0.1 }), null);
  // A dateline-wrapping view reports east <= west.
  assert.equal(hubeauViewportBox({ south: 40, west: 170, north: 50, east: -170 }), null);
  assert.equal(hubeauViewportBox({ south: NaN, west: 2, north: 49, east: 3 }), null);
  assert.equal(hubeauViewportBox(null), null);
});

// ── Analyst seam ────────────────────────────────────────────────────────────

test('analyst records report SI values under names that say what they are', () => {
  const record = {
    code: 'V720001002',
    name: 'Le Rhône à Tarascon',
    river: 'Le Rhône',
    lat: 43.8,
    lon: 4.66,
    reading: { kind: 'Q', value: 717, atMs: CAPTURE_MS, doubtful: false, freshness: 'live', text: '717 m³/s' },
  };
  const mapped = mapAnalystRecord(record, 0);
  assert.equal(mapped.dischargeM3s, 717);
  assert.equal(mapped.localGaugeM, null);
  assert.equal(mapped.producerFlaggedDoubtful, false);
  assert.deepEqual(JSON.parse(JSON.stringify(mapped)), mapped);

  const empty = mapAnalystRecord(undefined, 4);
  assert.equal(empty.id, 'STATION-0004');
  for (const [key, value] of Object.entries(empty)) {
    assert.notEqual(value, undefined, `${key} must not be undefined`);
    if (typeof value === 'number') assert.ok(Number.isFinite(value), `${key} must not be NaN`);
  }
});

// ── Lifecycle ───────────────────────────────────────────────────────────────

function createHarness({ rectangle, responses } = {}) {
  const primitives = [];
  const hostCalls = [];
  const fetchUrls = [];
  const moveEndListeners = new Set();
  const overlayHost = {
    setEntries: (...args) => hostCalls.push(['entries', ...args]),
    setVisible: (...args) => hostCalls.push(['visible', ...args]),
    clearSource: (...args) => hostCalls.push(['clear', ...args]),
  };
  const viewer = {
    scene: {
      globe: { ellipsoid: Cesium.Ellipsoid.WGS84 },
      requestRender() {},
      primitives: {
        add(primitive) { primitives.push(primitive); return primitive; },
        remove(primitive) {
          const index = primitives.indexOf(primitive);
          if (index >= 0) primitives.splice(index, 1);
          return index >= 0;
        },
      },
    },
    camera: {
      computeViewRectangle: () => (rectangle === null ? null : Cesium.Rectangle.fromDegrees(
        rectangle.west, rectangle.south, rectangle.east, rectangle.north,
      )),
      moveEnd: {
        addEventListener(listener) {
          moveEndListeners.add(listener);
          return () => moveEndListeners.delete(listener);
        },
      },
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const text = String(url);
    fetchUrls.push(text);
    const payload = text.includes('referentiel') ? responses.stations : responses.observations;
    if (typeof payload?.status === 'number') return { ok: false, status: payload.status };
    return { ok: true, status: 206, json: async () => payload };
  };
  const layer = createHubeauHydrometryLayer({ overlayHost, now: () => CAPTURE_MS });
  return {
    layer,
    viewer,
    primitives,
    hostCalls,
    fetchUrls,
    moveEndListeners,
    restore() { globalThis.fetch = originalFetch; },
  };
}

const IDF = { south: 48.5, west: 2, north: 49.1, east: 2.9 };

test('a bounded view fetches, draws only reporting stations, and publishes labels', async () => {
  const h = createHarness({
    rectangle: IDF,
    responses: { stations: STATIONS_GEOJSON, observations: OBSERVATIONS },
  });
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    assert.equal(await h.layer.update(h.viewer), true);

    assert.equal(h.primitives.length, 1);
    assert.equal(h.primitives[0].length, 3, 'one dot per reporting station');
    const publication = h.hostCalls.filter(([type]) => type === 'entries').pop();
    assert.equal(publication[2].length, 3);
    assert.deepEqual(publication[3], {
      cohortLimit: HUBEAU_OVERLAY_COHORT_LIMIT,
      collisionCapacity: HUBEAU_OVERLAY_COLLISION_CAPACITY,
      moving: false,
    });

    const stats = h.layer.getStats();
    assert.equal(stats.count, 3);
    assert.equal(stats.status, 'nominal');
    assert.equal(stats.error, null);
    // Two stations in the reference page, three reporting: the honest read is
    // that neither feed is the whole truth, and both numbers are surfaced.
    assert.equal(stats.activeStationsInView, 2);
    assert.equal(stats.doubtfulReadings, 1);
    assert.equal(stats.truncated, false);
  } finally {
    h.restore();
  }
});

test('an unbounded camera asks for a zoom instead of asking Hub\'Eau for the world', async () => {
  const h = createHarness({
    rectangle: { south: -80, west: -170, north: 80, east: 170 },
    responses: { stations: STATIONS_GEOJSON, observations: OBSERVATIONS },
  });
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    // Asking for a zoom is guidance, not a failed refresh: reporting it as one
    // made the manager tear the layer back down the moment it was turned on.
    assert.equal(await h.layer.update(h.viewer), true);
    assert.equal(h.fetchUrls.length, 0, 'no request is made at all');
    assert.equal(h.layer.getStats().status, 'zoom-in');
    assert.equal(h.layer.getStats().count, 0);
  } finally {
    h.restore();
  }
});

test('the observation window asked for is exactly the documented hour', async () => {
  const h = createHarness({
    rectangle: IDF,
    responses: { stations: STATIONS_GEOJSON, observations: OBSERVATIONS },
  });
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    const observationUrl = h.fetchUrls.find((url) => url.includes('observations_tr'));
    const since = new URL(observationUrl).searchParams.get('date_debut_obs');
    assert.equal(Date.parse(since), CAPTURE_MS - HUBEAU_OBSERVATION_WINDOW_MS);
  } finally {
    h.restore();
  }
});

test('a truncated observation page is reported rather than passed off as complete', async () => {
  const h = createHarness({
    rectangle: IDF,
    responses: {
      stations: STATIONS_GEOJSON,
      observations: { ...OBSERVATIONS, next: 'https://hubeau.eaufrance.fr/...cursor=abc' },
    },
  });
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    assert.equal(h.layer.getStats().truncated, true);
  } finally {
    h.restore();
  }
});

test('an upstream failure is reported and does not blank the last good map', async () => {
  const h = createHarness({
    rectangle: IDF,
    responses: { stations: STATIONS_GEOJSON, observations: OBSERVATIONS },
  });
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    const drawn = h.primitives[0].length;

    h.restore();
    globalThis.fetch = async (url) => (String(url).includes('observations_tr')
      ? { ok: false, status: 503 }
      : { ok: true, status: 200, json: async () => STATIONS_GEOJSON });
    assert.equal(await h.layer.update(h.viewer), false);
    assert.equal(h.layer.getStats().error, "Hub'Eau observations HTTP 503");
    assert.equal(h.primitives[0].length, drawn, 'the last good snapshot survives');
  } finally {
    h.restore();
  }
});

test('camera motion refreshes through a debounce, and disable unsubscribes', async () => {
  const h = createHarness({
    rectangle: IDF,
    responses: { stations: STATIONS_GEOJSON, observations: OBSERVATIONS },
  });
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    assert.equal(h.moveEndListeners.size, 1, 'enable subscribes to camera settle');
    const disableFrom = h.hostCalls.length;
    h.layer.disable(h.viewer);
    assert.equal(h.moveEndListeners.size, 0, 'disable unsubscribes');
    assert.equal(h.primitives[0].show, false);
    // Asserted by INTENT rather than by tail position: disable now also tears
    // down the selected-card source, so "the last two calls" stopped being a
    // stable way to say "the layer let go of the overlay". What matters is that
    // both sources end up cleared and hidden, in any order.
    const onDisable = h.hostCalls.slice(disableFrom).map((call) => call.join(':'));
    assert.ok(onDisable.includes('clear:hubeau-hydro'), onDisable.join(' | '));
    assert.ok(onDisable.includes('visible:hubeau-hydro:false'), onDisable.join(' | '));
    assert.ok(
      onDisable.includes('clear:hubeau-hydro-selected'),
      `the selected card must not survive a disabled layer — ${onDisable.join(' | ')}`,
    );
    assert.ok(onDisable.includes('visible:hubeau-hydro-selected:false'), onDisable.join(' | '));
  } finally {
    h.restore();
  }
});

test('analyst records follow the enabled state, and destroy tears the layer down', async () => {
  const h = createHarness({
    rectangle: IDF,
    responses: { stations: STATIONS_GEOJSON, observations: OBSERVATIONS },
  });
  try {
    h.layer.init(h.viewer);
    assert.deepEqual(h.layer.getAnalystRecords(), []);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    assert.equal(h.layer.getAnalystRecords().length, 3);
    assert.equal(h.layer.getAnalystRecords(1).length, 1);
    h.layer.destroy(h.viewer);
    assert.equal(h.primitives.length, 0);
    assert.deepEqual(h.layer.getAnalystRecords(), []);
  } finally {
    h.restore();
  }
});

// ── The card the layer never had ────────────────────────────────────────────

const TARASCON = Object.freeze({
  code: 'V720001002',
  name: 'Le Rhône à Tarascon',
  river: 'Le Rhône',
  commune: 'TARASCON',
  departement: 'BOUCHES-DU-RHONE',
  openedYear: 1994,
  influence: 'Nulle',
  qualification: 'Donnée brute / Non qualifiée',
  gaugeZeroM: null,
  reading: { kind: 'Q', value: 617, text: '617 m³/s', freshness: 'live', doubtful: false },
});

test('the reference request asks for the fields a card needs, and none it must not show', () => {
  const url = hubeauStationsRequestUrl({ south: 48, west: 2, north: 49, east: 3 });
  const fields = new URL(url).searchParams.get('fields').split(',');
  // Without the two coordinate fields the API returns geometry:null for every
  // feature and silently empties the layer.
  assert.ok(fields.includes('longitude_station') && fields.includes('latitude_station'));
  for (const needed of [
    'code_site', 'libelle_commune', 'libelle_departement', 'date_ouverture_station',
  ]) {
    assert.ok(fields.includes(needed), `missing ${needed}`);
  }
  // `type_station` is 91.7% the single value STD and its documented enum does
  // not match the data; `descriptif_station` is 33.9%-filled free text whose
  // commonest values are 'Aval', 'Pont' and '2'. Neither is an operator or a
  // hardware description, however much they look like one.
  assert.ok(!fields.includes('type_station'));
  assert.ok(!fields.includes('descriptif_station'));
});

test('the station parser carries the new reference fields, and tolerates their absence', () => {
  const parsed = parseHubeauStations({
    features: [
      {
        properties: {
          code_station: 'V720001002',
          libelle_station: 'Le Rhône à Tarascon',
          libelle_cours_eau: 'Le Rhône',
          code_site: 'V7200010',
          libelle_commune: 'TARASCON',
          libelle_departement: 'BOUCHES-DU-RHONE',
          date_ouverture_station: '1994-03-01T00:00:00Z',
          influence_locale_station: 'Nulle',
          altitude_ref_alti_station: 6.5,
        },
      },
      { properties: { code_station: 'BARE' } },
    ],
  });
  const full = parsed.get('V720001002');
  assert.equal(full.commune, 'TARASCON');
  assert.equal(full.siteCode, 'V7200010');
  // A YEAR, not a timestamp: "gauging since 1994" is the claim the field
  // supports; a day and an hour would suggest an unbroken record from that
  // instant, which a hydrometric station does not have.
  assert.equal(full.openedYear, 1994);
  assert.equal(full.gaugeZeroM, 6.5);
  const bare = parsed.get('BARE');
  assert.equal(bare.name, 'BARE', 'a nameless station falls back to its code');
  for (const key of ['river', 'commune', 'departement', 'openedYear', 'gaugeZeroM']) {
    assert.equal(bare[key], null, key);
  }
});

test('the history request is bounded, ordered, and asks for no field list', () => {
  const since = Date.UTC(2026, 7, 31, 15, 0, 0);
  const url = new URL(hubeauHistoryRequestUrl('V720001002', 'Q', since));
  assert.equal(url.searchParams.get('code_entite'), 'V720001002');
  assert.equal(url.searchParams.get('grandeur_hydro'), 'Q');
  // Left to right, like a hydrograph.
  assert.equal(url.searchParams.get('sort'), 'asc');
  // The endpoint keeps a rolling ~30-day archive per station; without a lower
  // bound this pages through a month to show a day.
  assert.equal(url.searchParams.get('date_debut_obs'), new Date(since).toISOString());
  // `fields` measured 2.18 s / 17 KB against 0.49 s / 146 KB without it —
  // bandwidth is not the scarce thing on this call.
  assert.equal(url.searchParams.get('fields'), null);
  // Anything that is not H is discharge.
  assert.equal(new URL(hubeauHistoryRequestUrl('X', 'H', since)).searchParams.get('grandeur_hydro'), 'H');
  assert.equal(new URL(hubeauHistoryRequestUrl('X', null, since)).searchParams.get('grandeur_hydro'), 'Q');
});

test('history is converted into the reading own unit, and a null stays a gap', () => {
  // The API publishes discharge in litres per second and stage in millimetres,
  // exactly as the live census does. A series left raw would draw the right
  // SHAPE under a wrong axis and print nonsense either side of it.
  const q = parseHubeauHistory({
    data: [
      { resultat_obs: 617000 },
      { resultat_obs: null },
      { resultat_obs: 683000 },
      { resultat_obs: 'nope' },
    ],
  }, 'Q');
  assert.deepEqual(q.values, [617, null, 683, null]);
  assert.equal(q.min, 617);
  assert.equal(q.max, 683);
  assert.equal(q.count, 2, 'gaps are kept in place but never counted as readings');
  const h = parseHubeauHistory({ data: [{ resultat_obs: 1500 }] }, 'H');
  assert.deepEqual(h.values, [1.5]);
  for (const bad of [null, undefined, {}, { data: 'rows' }]) {
    assert.deepEqual(parseHubeauHistory(bad, 'Q'), { values: [], min: null, max: null, count: 0 });
  }
});

test('the card answers more than the one number it used to', () => {
  const lines = buildHubeauCard(TARASCON).split('\n');
  assert.equal(lines[0], 'Le Rhône à Tarascon');
  const body = lines.slice(1).join('\n');
  assert.match(body, /617 m³\/s · débit/);
  assert.match(body, /Le Rhône/);
  assert.match(body, /TARASCON · BOUCHES-DU-RHONE/);
  assert.match(body, /station ouverte en 1994/);
  // Raw and unqualified, and Vigicrues is the official channel — the module
  // header has always said so, and now the card says it where it matters.
  assert.match(body, /Vigicrues reste le canal officiel/);
});

test('the hydrograph arrives into a card that was already complete without it', () => {
  const values = Array.from({ length: 144 }, (_, i) => 600 + i);
  const withHistory = buildHubeauCard(TARASCON, {
    values, min: 600, max: 743, count: 144,
  });
  assert.match(withHistory, /↻ 24 h [▁-█·▽]+/u);
  // The sparkline is zero-based, so a flat river reads flat and hides its
  // amplitude. This line is where the amplitude goes.
  assert.match(withHistory, /de 600 m³\/s à 743 m³\/s sur 24 h/);
  // Pending and failed are both states a reader can act on, and neither
  // removes anything above them.
  assert.match(buildHubeauCard(TARASCON, { pending: true }), /↻ 24 h …/);
  assert.match(buildHubeauCard(TARASCON, { failed: true }), /historique 24 h indisponible/);
  for (const history of [null, { pending: true }, { failed: true }]) {
    assert.match(buildHubeauCard(TARASCON, history), /station ouverte en 1994/);
  }
});

test('the card refuses an absolute altitude and a historical percentile', () => {
  const stage = buildHubeauCard({
    ...TARASCON,
    gaugeZeroM: 6.5,
    reading: { kind: 'H', value: 2.4, text: '2,40 m', freshness: 'live', doubtful: false },
  });
  // The gauge zero is shown as the DATUM the stage is counted from, never
  // added to it: checked over 1 756 stations, gauge zero + stage disagrees with
  // the site altitude by a median 1.1 m but a p90 of 30.8 m and a max of 20 km,
  // across at least six altimetric systems.
  assert.match(stage, /zéro de l'échelle à 6\.5 m/);
  assert.doesNotMatch(stage, /altitude absolue|au-dessus du niveau de la mer/i);
  // A percentile is two cheap requests away and would compare an INSTANTANEOUS
  // reading against a distribution of DAILY MEANS across all seasons.
  assert.doesNotMatch(stage, /percentile|centile|record|plus haut depuis/i);
  // A discharge station is not asked about its stage datum.
  assert.doesNotMatch(buildHubeauCard({ ...TARASCON, gaugeZeroM: 6.5 }), /zéro de l'échelle/);
});

test('the producer own doubt and its own caveats reach the card', () => {
  const doubtful = buildHubeauCard({
    ...TARASCON,
    reading: { ...TARASCON.reading, doubtful: true },
  });
  assert.match(doubtful, /signalé douteux par le producteur/);
  const influenced = buildHubeauCard({ ...TARASCON, influence: 'Forte' });
  assert.match(influenced, /influence locale : Forte/);
  // 'Nulle' is the majority value and says nothing.
  assert.doesNotMatch(buildHubeauCard(TARASCON), /influence locale/);
});

test('a station with nothing but a code still yields a card', () => {
  const lines = buildHubeauCard({ code: 'X000000001', reading: {} }).split('\n');
  assert.equal(lines[0], 'X000000001');
  for (const line of lines) assert.ok(!/undefined|null|NaN/.test(line), line);
  assert.ok(buildHubeauCard(null).length > 0);
});

test('the selected entry is protected, on its own source, and one card deep', () => {
  const position = Cesium.Cartesian3.fromDegrees(4.66, 43.79);
  const entry = createHubeauSelectedOverlayEntry(TARASCON, position);
  assert.equal(entry.id, 'hubeau:V720001002');
  assert.equal(entry.variant, 'selected');
  assert.equal(entry.protected, true);
  assert.equal(entry.priority, Number.MAX_SAFE_INTEGER);
  assert.equal(entry.accent, HUBEAU_SELECTED_COLOR);
  assert.equal(entry.title, 'Le Rhône à Tarascon');
  assert.ok(entry.details.length >= 3);
  assert.equal(createHubeauSelectedOverlayEntry(null, position), null);
  assert.equal(createHubeauSelectedOverlayEntry(TARASCON, null), null);
  assert.equal(HUBEAU_SELECTED_OVERLAY_SOURCE_ID, 'hubeau-hydro-selected');
  assert.deepEqual({ ...HUBEAU_SELECTED_OVERLAY_SOURCE_OPTIONS }, {
    cohortLimit: 1, collisionCapacity: 1, moving: false,
  });
  assert.equal(HUBEAU_LAYER_ID, 'hubeau-hydro');
  assert.equal(HUBEAU_HISTORY_WINDOW_MS, 24 * 60 * 60_000);
});
