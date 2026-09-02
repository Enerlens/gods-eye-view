// src/data/meteoStationsFrance.test.mjs
// Covers the Stations météo LAYER: the palette that carries the layer's whole
// argument, the card an instrument-poor station still gets, the ring that
// promises a public reading, the filter chips, and the lifecycle — including
// the laziness that keeps a 22 MB server-side fetch off the path of a reader
// who never opens a card. The upstream shapes are pinned separately in
// meteoStationsFrFeed.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  METEO_STATIONS_LAYER_ID,
  METEO_STATIONS_OVERLAY_SOURCE_ID,
  METEO_STATION_FILTERS,
  STATION_PIXEL_MAX,
  STATION_PIXEL_MIN,
  buildNormalsLines,
  buildObservationLines,
  buildStationCard,
  createMeteoStationsFranceLayer,
  formatObservationTime,
  mapStationAnalystRecord,
  stationColor,
  stationDisplayName,
  stationLabelText,
  stationLegend,
  stationPixelSize,
} from './meteoStationsFrance.js';
import { STATION_CLASSES } from './meteoStationsFrFeed.js';

const REGISTRY = JSON.parse(readFileSync(
  new URL('./local_data/meteo_stations_fr/stations.json', import.meta.url),
  'utf8',
));

const byName = (name) => REGISTRY.stations.find((station) => station.name === name);
const TOULOUSE = byName('TOULOUSE-BLAGNAC');
const AIGUILLE = byName('AIGUILLE DU MIDI');
const MARSILLARGUES = byName('MARSILLARGUES');
const ALBA = byName('ALBA LA ROMAINE');
const BOULOGNE = byName('BOULOGNE-SEM');
const CAP_CEPET = byName('CAP CEPET');

// ── The shipped network is the thing this layer promises ────────────────────

test('the whole real-time network ships, and it is the real-time one', () => {
  assert.ok(REGISTRY.stations.length > 2000, `expected the whole network, got ${REGISTRY.stations.length}`);
  assert.equal(REGISTRY.stats.stations, REGISTRY.stations.length);
  assert.equal(REGISTRY.stats.metropole + REGISTRY.stats.overseas, REGISTRY.stations.length);
  // NOT the 14 751 climatological postes, and not the 699 complémentaires.
  // The file states what it excludes so nobody has to infer it from a count.
  assert.ok(REGISTRY.excluded.closedPostes > 10_000);
  assert.match(REGISTRY.excluded.complementary, /compl[ée]mentaires/);
  assert.match(REGISTRY.excluded.infoclimat, /CC BY-NC/);
});

test('the layer’s whole argument survives into the file: most stations measure little', () => {
  // If this ever stops being true the layer's palette stops meaning anything,
  // so it is asserted rather than left in a comment.
  const { byClass, byFamily, stations } = REGISTRY.stats;
  assert.ok(byClass['temp-rain'] > stations / 2, 'the majority measure only temperature and rain');
  assert.ok(byFamily.wind < stations / 2, 'fewer than half have an anemometer');
  assert.ok(byFamily.pressure < byFamily.wind / 2, 'a barometer is rarer still');
  assert.ok(byClass.synoptic < stations / 5, 'the complete station is the exception');
});

test('the SYNOP list and the SYNOP archive disagree, and the file keeps both', () => {
  // Météo-France's own station list names 62; the archive it describes carries
  // 190. The layer counts the archive, and the discrepancy is recorded so the
  // next person does not "fix" it back to the list.
  assert.ok(REGISTRY.synop.live > REGISTRY.synop.listed * 2);
  assert.equal(REGISTRY.stats.live, REGISTRY.synop.live);
  // BOULOGNE-SEM publishes hourly and is not on the list…
  assert.equal(BOULOGNE.live, true);
  assert.equal(BOULOGNE.synop, false);
  // …and CAP CEPET is on the list and has written nothing all year.
  assert.equal(CAP_CEPET.synop, true);
  assert.equal(CAP_CEPET.live, false);
});

// ── Colour is capability, size is instrument count ──────────────────────────

test('colour is the class and never the pack', () => {
  assert.equal(
    stationColor(TOULOUSE).toCssColorString(),
    Cesiumless(STATION_CLASSES.synoptic.color),
  );
  // A station nobody documented is drawn in the neutral grey, not as a station
  // that measures nothing — those are different facts and different colours.
  assert.equal(ALBA.klass, 'unknown');
  assert.equal(stationColor(ALBA).toCssColorString(), Cesiumless(STATION_CLASSES.unknown.color));
  assert.notEqual(STATION_CLASSES.unknown.color, STATION_CLASSES.other.color);
});

/** Cesium normalises `#rrggbb` to `rgb(r,g,b)`; compare through the same path. */
function Cesiumless(css) {
  const r = parseInt(css.slice(1, 3), 16);
  const g = parseInt(css.slice(3, 5), 16);
  const b = parseInt(css.slice(5, 7), 16);
  return `rgb(${r},${g},${b})`;
}

test('size is how many instrument families the station carries', () => {
  assert.equal(stationPixelSize({ fam: [] }), STATION_PIXEL_MIN);
  // Unknown is not small — it takes the minimum because there is nothing to
  // size on, and the colour is what says so.
  assert.equal(stationPixelSize({ fam: null }), STATION_PIXEL_MIN);
  assert.equal(
    stationPixelSize({ fam: Array.from({ length: 14 }, (_, i) => `f${i}`) }),
    STATION_PIXEL_MAX,
  );
  assert.ok(stationPixelSize(TOULOUSE) > stationPixelSize({ fam: ['temp', 'rain'] }));
  for (const station of REGISTRY.stations) {
    const size = stationPixelSize(station);
    assert.ok(size >= STATION_PIXEL_MIN && size <= STATION_PIXEL_MAX, `${station.name}: ${size}px`);
  }
});

// ── The card ────────────────────────────────────────────────────────────────

test('the card leads with what the station can and cannot answer', () => {
  const card = buildStationCard(byName('VERIZIEU'));
  const lines = card.split('\n');
  assert.equal(lines[0], 'VERIZIEU');
  assert.match(lines[1], /^◈ mesure .*température/);
  assert.match(lines[2], /^⊘ ne mesure pas .*vent à 10 m.*pression/);
});

test('a station that does not publish says so, and is not shown as missing data', () => {
  const card = buildStationCard(byName('VERIZIEU'));
  // "There is no reading here" and "this reading exists behind a credential"
  // are different sentences, and only the second is true.
  assert.match(card, /🔒 relevés non publiés en accès libre/);
  assert.doesNotMatch(card, /indisponible/);
});

test('a station that does publish waits for its reading and then shows it', () => {
  assert.match(buildStationCard(BOULOGNE), /🌡 relevé en cours de chargement/);
  assert.match(buildStationCard(BOULOGNE, { pending: false }), /🌡 relevé public indisponible/);
  const card = buildStationCard(BOULOGNE, {
    pending: false,
    observation: {
      at: '2026-09-01T21:00:00Z', tempC: 17.4, humidity: 81, pressureHpa: 1019.1,
      windMs: 6.5, windDir: 260, gustMs: 9.2, rain1hMm: 0, visibilityM: 26_000, snowM: null,
    },
  });
  assert.match(card, /17,4 °C/);
  assert.match(card, /81 % HR/);
  assert.match(card, /1 019,1 hPa/);
  // m/s in the message, km/h on the card — no French forecast is in m/s.
  assert.match(card, /23 km\/h de secteur O/);
  assert.match(card, /rafale 33 km\/h/);
  assert.match(card, /01\/09 à 21 h 00 UTC/);
});

test('a genuine zero of rain is printed as a fact, not dropped as a falsy value', () => {
  const lines = buildObservationLines({ at: '2026-09-01T21:00:00Z', rain1hMm: 0 });
  assert.ok(lines.some((line) => /pas de pluie sur la dernière heure/.test(line)));
  assert.ok(buildObservationLines({ at: 'x', rain1hMm: 2.4 })
    .some((line) => /2,4 mm/.test(line)));
});

test('each observation field is optional on its own', () => {
  // A station can publish a temperature and no pressure in one message; a card
  // that dropped the block because one field was empty would hide the reading
  // the reader came for.
  const lines = buildObservationLines({ at: '2026-09-01T21:00:00Z', tempC: 3.2 });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /3,2 °C/);
  assert.deepEqual(buildObservationLines(null), []);
});

test('a record is printed with the window it stands in', () => {
  const lines = buildNormalsLines({
    high: { value: 42.4, date: '2023' },
    low: { value: -19.2, date: '1956' },
    period: '01-01-1947 → 02-08-2026',
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /record 42,4 °C en 2023/);
  assert.match(lines[0], /-19,2 °C en 1956/);
  // Without the window, 42,4 °C at a station open since 2004 reads the same as
  // 42,4 °C at one open since 1947.
  assert.match(lines[0], /records établis sur 01-01-1947/);
  assert.deepEqual(buildNormalsLines(null), []);
  assert.deepEqual(buildNormalsLines({ high: { value: 1, date: '2020' } }), []);
});

test('a closed station leads with its closure and is kept', () => {
  assert.ok(MARSILLARGUES, 'a closed station is still in the shipped file');
  const card = buildStationCard(MARSILLARGUES);
  assert.match(card.split('\n')[1], /station FERMÉE le 01\/01\/2026/);
  assert.match(card, /toujours présente/);
});

test('a station with no published inventory says that, not that it measures nothing', () => {
  const card = buildStationCard(ALBA);
  assert.match(card, /inventaire non publié/);
  assert.doesNotMatch(card, /aucun paramètre/);
});

test('names are shown as published, not prettified into something that stops matching', () => {
  assert.equal(stationDisplayName(TOULOUSE), 'TOULOUSE-BLAGNAC');
  assert.equal(stationDisplayName({ commune: 'Arbent' }), 'Station météo à Arbent');
  assert.match(stationLabelText(AIGUILLE), /AIGUILLE DU MIDI · 3 845 m/);
});

test('the observation time is a French hour, or nothing', () => {
  assert.equal(formatObservationTime('2026-09-01T21:00:00Z'), '01/09 à 21 h 00 UTC');
  assert.equal(formatObservationTime('not a time'), null);
  assert.equal(formatObservationTime(null), null);
});

// ── Legend, analyst records, lifecycle ──────────────────────────────────────

test('the legend explains the ring and the hollow disc, because colour alone cannot', () => {
  const legend = stationLegend(REGISTRY.stations);
  const labels = legend.map((entry) => entry.label);
  assert.ok(labels.includes('Synoptique complète'));
  assert.ok(labels.includes('Anneau = relevés publics'));
  assert.ok(labels.includes('Disque creux = station fermée'));
  const ring = legend.find((entry) => entry.label === 'Anneau = relevés publics');
  assert.equal(ring.count, REGISTRY.stats.live);
  assert.match(ring.blurb, /190/);
  for (const entry of legend) assert.ok(entry.blurb && entry.color && entry.count > 0);
});

test('an analyst can tell an undocumented station from an instrument-free one', () => {
  const known = mapStationAnalystRecord(TOULOUSE);
  assert.equal(known.stationClass, 'synoptic');
  assert.equal(known.measuresWind, true);
  assert.equal(known.measuresPressure, true);
  assert.equal(known.instrumentCount, TOULOUSE.fam.length);

  const unknown = mapStationAnalystRecord(ALBA);
  // Null, not false and not zero: "nobody documented this" must be testable.
  assert.equal(unknown.instruments, null);
  assert.equal(unknown.instrumentCount, null);
  assert.equal(unknown.measuresWind, null);

  assert.equal(mapStationAnalystRecord(BOULOGNE).publishesOpenly, true);
  assert.equal(mapStationAnalystRecord(BOULOGNE).listedAsSynop, false);
  assert.equal(mapStationAnalystRecord({}, 7).id, 'METEO-0007');
});

/** Serve the shipped network the way Vite will; `fetch` cannot read a `file:` URL. */
function harness({ observations = {}, fiche = null, failObservations = false } = {}) {
  const calls = { observations: 0, normals: 0 };
  const fetchImpl = async (url) => {
    const href = String(url);
    if (href === 'registry') return { ok: true, status: 200, json: async () => REGISTRY };
    if (href.startsWith('/api/meteo-stations/observations')) {
      calls.observations += 1;
      if (failObservations) return { ok: false, status: 502 };
      return { ok: true, status: 200, json: async () => ({ observations, newest: '2026-09-01T21:00:00Z' }) };
    }
    if (href.startsWith('/api/meteo-stations/normals')) {
      calls.normals += 1;
      return { ok: true, status: 200, json: async () => ({ fiche }) };
    }
    return { ok: false, status: 404 };
  };
  const overlay = { entries: new Map(), visible: new Map(), cleared: [] };
  const overlayHost = {
    setEntries: (id, entries, options) => overlay.entries.set(id, { entries, options }),
    setVisible: (id, value) => overlay.visible.set(id, value),
    clearSource: (id) => { overlay.cleared.push(id); overlay.entries.delete(id); },
    hitTest: () => null,
  };
  const primitives = [];
  const viewer = {
    scene: {
      canvas: { addEventListener() {}, removeEventListener() {}, setAttribute() {} },
      primitives: { add: (p) => primitives.push(p), remove: (p) => primitives.splice(primitives.indexOf(p), 1) },
      pick: () => undefined,
      requestRender() {},
    },
  };
  const layer = createMeteoStationsFranceLayer({ overlayHost, registryUrl: 'registry', fetchImpl });
  return { layer, viewer, overlay, primitives, calls };
}

test('the layer boots, loads the network and draws it', async () => {
  const { layer, viewer, overlay, primitives } = harness();
  assert.equal(layer.id, METEO_STATIONS_LAYER_ID);
  layer.init(viewer);
  assert.equal(primitives.length, 1);
  layer.enable(viewer);
  assert.equal(await layer.update(), true);

  const stats = layer.getStats();
  assert.equal(stats.stations, REGISTRY.stats.stations);
  assert.equal(stats.count, REGISTRY.stations.length);
  assert.equal(stats.live, REGISTRY.stats.live);
  assert.equal(stats.listedSynop, REGISTRY.stats.synop);
  assert.equal(stats.error, null);
  assert.ok(overlay.entries.has(METEO_STATIONS_OVERLAY_SOURCE_ID));

  layer.destroy(viewer);
  assert.equal(primitives.length, 0);
});

test('a filter chip hides stations without losing the network behind them', async () => {
  const { layer, viewer } = harness();
  layer.init(viewer);
  layer.enable(viewer);
  await layer.update();
  const all = layer.getStats().count;

  assert.equal(layer.setParams({ filter: 'wind' }), true);
  const wind = layer.getStats();
  // Pressing VENT deletes 60 % of the map. That IS the layer's argument.
  assert.ok(wind.count < all / 2, `expected fewer than half, got ${wind.count} of ${all}`);
  assert.equal(wind.count, REGISTRY.stats.byFamily.wind);
  assert.equal(wind.hidden, all - wind.count);
  // The network's own totals are untouched by a display filter.
  assert.equal(wind.stations, REGISTRY.stats.stations);
  assert.equal(wind.live, REGISTRY.stats.live);

  assert.equal(layer.setParams({ filter: 'live' }), true);
  assert.equal(layer.getStats().count, REGISTRY.stats.live);
  assert.equal(layer.setParams({ filter: 'wind' }), true);
  assert.equal(layer.setParams({ filter: 'wind' }), false, 'a no-op filter is not a repaint');
  assert.equal(layer.setParams({ filter: 'nonsense' }), false);
  assert.equal(layer.setParams({}), false);

  const { chips } = layer.getRowControls();
  assert.deepEqual(chips.map((chip) => chip.id), METEO_STATION_FILTERS.map((f) => f.id));
  assert.equal(chips.find((chip) => chip.id === 'wind').active, true);
  layer.destroy(viewer);
});

test('the card has a local state and a network state, and nothing is fetched until asked', async () => {
  const observation = { at: '2026-09-01T21:00:00Z', tempC: 17.4, windMs: 6.5, windDir: 260 };
  const { layer, viewer, calls } = harness({ observations: { [BOULOGNE.omm]: observation } });
  layer.init(viewer);
  layer.enable(viewer);
  await layer.update();

  // THE LAZINESS IS THE POINT. Behind the observations endpoint is a 22 MB
  // server-side fetch of the SYNOP archive; a visitor who turns the layer on,
  // looks at the map and never clicks must not pay for it. Booting, drawing
  // 2 144 markers and filtering to the 190 live ones costs zero requests.
  layer.setParams({ filter: 'live' });
  assert.equal(layer.getStats().count, REGISTRY.stats.live);
  assert.equal(calls.observations, 0, 'drawing the network fetches no observation');
  assert.equal(calls.normals, 0, 'drawing the network fetches no fiche');

  // The card's two states. The first is painted from the shipped pack alone,
  // which is why a reader never waits: everything that identifies the station
  // is already local, and only the reading and the records arrive later.
  const local = buildStationCard(BOULOGNE, {});
  assert.match(local, /◈ mesure/);
  assert.match(local, /📍/);
  assert.match(local, /en cours de chargement/);

  const resolved = buildStationCard(BOULOGNE, { observation, pending: false });
  assert.match(resolved, /17,4 °C/);
  assert.doesNotMatch(resolved, /en cours de chargement/);
  // The local half is unchanged by the network half arriving — the card grows,
  // it does not get rebuilt into something else under the reader.
  for (const line of local.split('\n').filter((l) => !/chargement/.test(l))) {
    assert.ok(resolved.includes(line), `the second paint dropped: ${line}`);
  }

  layer.destroy(viewer);
});

test('a failed observation fetch degrades to a stated absence, not a spinner', async () => {
  const { layer, viewer } = harness({ failObservations: true });
  layer.init(viewer);
  layer.enable(viewer);
  await layer.update();
  // The card contract: `pending: false` with no observation says the public
  // reading is unavailable, which is what a failed fetch resolves to.
  const card = buildStationCard(BOULOGNE, { pending: false });
  assert.match(card, /relevé public indisponible/);
  assert.doesNotMatch(card, /en cours de chargement/);
  layer.destroy(viewer);
});

test('a broken registry leaves the layer empty and says why', async () => {
  const broken = createMeteoStationsFranceLayer({
    overlayHost: {
      setEntries() {}, setVisible() {}, clearSource() {}, hitTest: () => null,
    },
    registryUrl: 'registry',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ nope: true }) }),
  });
  const viewer = {
    scene: {
      canvas: { addEventListener() {}, removeEventListener() {}, setAttribute() {} },
      primitives: { add() {}, remove() {} },
      pick: () => undefined,
      requestRender() {},
    },
  };
  broken.init(viewer);
  broken.enable(viewer);
  assert.equal(await broken.update(), false);
  assert.equal(broken.getStats().count, 0);
  assert.match(broken.getStats().error, /malformé/);
  broken.destroy(viewer);
});
