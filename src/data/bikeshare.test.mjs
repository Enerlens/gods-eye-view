import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  BIKESHARE_SELECTED_OVERLAY_SOURCE_OPTIONS,
  _clearBikeshareSelectionForTest,
  _parseStationInformationForTest,
  _parseStationStatusForTest,
  _selectBikeshareStationForTest,
  _setBikeshareSelectionStateForTest,
  createBikeshareSelectedOverlayEntry,
} from './bikeshare.js';

function makeRecord() {
  return {
    stationId: '3790',
    stationName: 'Congress & 6th',
    bikesAvailable: 7,
    docksAvailable: 4,
    capacity: 11,
    isInstalled: true,
    isRenting: false,
    isReturning: true,
    point: {
      position: Cesium.Cartesian3.fromDegrees(-97.7431, 30.2672, 2),
      show: true,
    },
  };
}

test('selected bikeshare entry preserves source copy and protected-lane policy', () => {
  const record = makeRecord();
  const entry = createBikeshareSelectedOverlayEntry('austin-capmetro:3790', record);
  assert.equal(entry.position, record.point.position);
  assert.equal(entry.title, 'Congress & 6th');
  assert.deepEqual(entry.details, [
    '🚲 7 avail · 4 docks · 11 cap',
    '⚠️ Not renting',
  ]);
  assert.equal(entry.variant, 'selected');
  assert.equal(entry.selected, true);
  assert.equal(entry.protected, true);
  assert.equal(entry.paintLane, 'selected');
  assert.equal(entry.collisionGroup, 'ambient-card');
  assert.equal(entry.edgeFade, 'keyhole');
  assert.equal(entry.horizonCull, true);
});

test('real station select/clear path publishes one card and creates no native label graphic', () => {
  const calls = [];
  const overlayHost = {
    setEntries: (...args) => calls.push(['entries', ...args]),
    setVisible: (...args) => calls.push(['visible', ...args]),
    clearSource: (...args) => calls.push(['clear', ...args]),
  };
  const key = 'austin-capmetro:3790';
  const record = makeRecord();
  const viewer = { entities: new Cesium.EntityCollection() };
  _setBikeshareSelectionStateForTest({ viewer, key, record, overlayHost });
  try {
    _selectBikeshareStationForTest(key);
    assert.equal(record.point.show, false);
    assert.equal(viewer.entities.values.length, 1, 'runtime guard requires a real selected entity');
    assert.equal(viewer.entities.values[0].label, undefined);
    assert.ok(viewer.entities.values[0].point, 'selected point highlight remains native');

    const publication = calls.find(([type]) => type === 'entries');
    assert.ok(publication);
    assert.equal(publication[1], 'bikeshare-selected');
    assert.equal(publication[2].length, 1);
    assert.equal(publication[2][0].position, record.point.position);
    assert.deepEqual(publication[3], BIKESHARE_SELECTED_OVERLAY_SOURCE_OPTIONS);

    _clearBikeshareSelectionForTest();
    assert.equal(record.point.show, true);
    assert.equal(viewer.entities.values.length, 0);
    assert.deepEqual(calls.at(-1), ['clear', 'bikeshare-selected']);
  } finally {
    _clearBikeshareSelectionForTest();
  }
});

// The French operators added alongside the US systems do not all speak the same
// GBFS dialect: Vélib' still serves a 1.x-era payload, JCDecaux Cyclocity serves
// 2.3, and Bordeaux Métropole serves 3.0 only. Each shape below is copied from a
// live response, because 3.0's two renames fail silently — a localized name array
// stringifies to "[object Object]" and a missing num_bikes_available reads as a
// station with no bikes rather than as a parse error.
test('station_information parses 1.x, 2.x and 3.0 name shapes', () => {
  const info = _parseStationInformationForTest({
    data: {
      stations: [
        // Vélib' Métropole: numeric station_id, plain-string name.
        { station_id: 213688169, name: 'Benjamin Godard - Victor Hugo', lat: 48.865983, lon: 2.275725, capacity: 35 },
        // Vélo'v (GBFS 2.3): string station_id, plain-string name.
        { station_id: '1024', name: 'ROUVILLE', lat: 45.769684, lon: 4.824607, capacity: 17 },
        // Le Vélo par TBM (GBFS 3.0): name is an array of localized objects.
        { station_id: '1', name: [{ text: 'Meriadeck', language: 'fr' }], lat: 44.83803, lon: -0.58437, capacity: 41 },
        // Multilingual 3.0 feed — the French entry wins over feed order.
        { station_id: '2', name: [{ text: 'Town Hall', language: 'en' }, { text: 'Hôtel de Ville', language: 'fr' }], lat: 44.8, lon: -0.6 },
      ],
    },
  });

  assert.equal(info.get('213688169').name, 'Benjamin Godard - Victor Hugo');
  assert.equal(info.get('1024').name, 'ROUVILLE');
  assert.equal(info.get('1').name, 'Meriadeck');
  assert.equal(info.get('2').name, 'Hôtel de Ville');
  assert.equal(info.get('213688169').capacity, 35);
  assert.equal(info.get('1024').lat, 45.769684);
});

test('station_status reads both num_bikes_available and the 3.0 rename', () => {
  const status = _parseStationStatusForTest({
    data: {
      stations: [
        // Vélib': availability integers plus 0/1 booleans.
        { station_id: 213688169, num_bikes_available: 10, num_docks_available: 25, is_installed: 1, is_renting: 1 },
        // Vélo'v (2.3): real booleans.
        { station_id: '1024', num_bikes_available: 11, num_docks_available: 6, is_installed: true },
        // Le Vélo par TBM (3.0): num_bikes_available is gone.
        { station_id: '1', num_vehicles_available: 2, num_docks_available: 39, is_installed: true },
      ],
    },
  });

  assert.equal(status.get('213688169').bikesAvailable, 10);
  assert.equal(status.get('213688169').isInstalled, true);
  assert.equal(status.get('1024').bikesAvailable, 11);
  assert.equal(status.get('1').bikesAvailable, 2, '3.0 feeds must not read as empty stations');
  assert.equal(status.get('1').docksAvailable, 39);
});
