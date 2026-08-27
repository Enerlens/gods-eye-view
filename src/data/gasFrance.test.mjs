// The French gas-system layer's presentation contract.
//
// This layer draws three different kinds of claim on one globe, and the whole
// job is keeping them apart: a stroke is a deliberately SIMPLIFIED trace and
// not a pipe location, a power station is INSTALLED capacity and not live
// output, and an injection point that feeds the distribution network is not
// connected to the transmission stroke it happens to sit beside. Every test
// here is one of those three claims refusing to blur.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import gasFranceLayer, {
  buildGasSelectionLabel,
  createGasPlantOverlayEntry,
  createGasSelectedOverlayEntry,
  formatGwhPerYear,
  formatKm,
  formatMw,
  gasClassificationTypeForScene,
  gasClassificationTypeForStack,
  gasInjectionPointSize,
  gasPlantPointSize,
  mapGasAnalystRecord,
  resolveGasPickId,
  selectGasOverlayCohort,
  GAS_FR_LAYER_ID,
  GAS_FR_OVERLAY_COHORT_LIMIT,
  GAS_FR_SELECTED_OVERLAY_SOURCE_ID,
  _clearGasSelectionForTest,
  _gasDetectablesForTest,
  _gasRowControlsForTest,
  _gasSelectedIdForTest,
  _selectGasObjectForTest,
  _setGasStateForTest,
} from './gasFrance.js';
import { GAS_INJECTION_COLOR, GAS_NETWORK_OPERATORS, GAS_PLANT_COLOR } from './gasFranceFeed.js';
import { LAYER_STATE_REGISTRY } from './layerState.js';
import { SPRITE_LAYER_ORDER } from './spriteOrder.js';

const POSITION = Cesium.Cartesian3.fromDegrees(2.3, 48.8, 40);

function plantRecord(overrides = {}) {
  const site = {
    id: 'gas-plant:martigues@5.02173,43.35914',
    kind: 'plant',
    name: 'Martigues',
    lon: 5.02173,
    lat: 43.35914,
    mw: 930,
    operator: 'EDF',
    status: 'En service',
    inService: true,
    commissioned: '2012',
    edition: 2025,
    editions: [2019, 2020, 2021, 2022, 2023, 2024, 2025],
    supersededBy: [],
    ...overrides,
  };
  return {
    id: site.id,
    kind: 'plant',
    site,
    position: POSITION,
    point: { show: true, color: null, pixelSize: 0 },
    baseColor: Cesium.Color.fromCssColorString(GAS_PLANT_COLOR),
    baseSize: gasPlantPointSize(site.mw),
  };
}

function injectionRecord(overrides = {}) {
  const site = {
    id: 'gas-injection:550',
    kind: 'injection',
    name: 'BIOBEARN',
    lon: -0.61709,
    lat: 43.37404,
    gwh: 250.264,
    tier: 'transport',
    network: 'Teréga',
    feedstock: 'Agricole territorial',
    process: 'Méthanisation',
    commune: 'Mourenx',
    departement: 'Pyrénées-Atlantiques',
    commissioned: '2022-09-01',
    expanding: false,
    ...overrides,
  };
  return {
    id: site.id,
    kind: 'injection',
    site,
    position: POSITION,
    point: { show: true, color: null, pixelSize: 0 },
    baseColor: Cesium.Color.fromCssColorString(GAS_INJECTION_COLOR),
    baseSize: gasInjectionPointSize(site.gwh),
  };
}

function pipeRecord(overrides = {}) {
  const site = {
    operator: 'natran',
    departement: 'Moselle',
    region: 'Grand Est',
    km: 12.4,
    ...overrides,
  };
  return {
    id: 'gas-fr:pipe:42',
    kind: 'pipe',
    site,
    position: POSITION,
    entity: { polyline: { material: null, width: 0 } },
    baseMaterial: 'BASE',
  };
}

function overlayHostSpy() {
  const calls = [];
  return {
    calls,
    setEntries(source, entries, options) { calls.push({ op: 'set', source, entries, options }); },
    clearSource(source) { calls.push({ op: 'clear', source }); },
    setVisible(source, visible) { calls.push({ op: 'visible', source, visible }); },
  };
}

function seed(records, extra = {}) {
  const host = overlayHostSpy();
  _setGasStateForTest({
    records: new Map(records.map((record) => [record.id, record])),
    overlayHost: host,
    ...extra,
  });
  return host;
}

test('the layer is registered everywhere a layer has to be registered', () => {
  assert.equal(gasFranceLayer.id, GAS_FR_LAYER_ID);
  assert.equal(GAS_FR_LAYER_ID, 'gas-fr');
  const entry = LAYER_STATE_REGISTRY.find((row) => row.id === GAS_FR_LAYER_ID);
  assert.ok(entry, 'missing from the share-link registry — the app would refuse to boot');
  assert.equal(entry.disposition, 'enabled-only');
  // A digit, deliberately: `z` is the token two existing tests use as their
  // canonical UNKNOWN token, and claiming it would turn "reject this link"
  // into "enable the gas layer".
  assert.match(entry.token, /^[a-z0-9]$/);
  assert.ok(SPRITE_LAYER_ORDER.includes(GAS_FR_LAYER_ID));
  // Below every moving contact: pipes and plants do not move, and a scooter
  // must never be hidden behind a pipeline.
  assert.ok(
    SPRITE_LAYER_ORDER.indexOf(GAS_FR_LAYER_ID) < SPRITE_LAYER_ORDER.indexOf('transit-fr'),
  );
});

// ── Sizing ──────────────────────────────────────────────────────────────────

test('a station is sized by nameplate power, on a √ ramp that never inverts', () => {
  assert.ok(gasPlantPointSize(930) > gasPlantPointSize(422));
  assert.ok(gasPlantPointSize(422) > gasPlantPointSize(210));
  // Beyond the fleet's largest machine the ramp saturates rather than growing
  // without bound — a future 2 GW station is the biggest dot, not a blob.
  assert.equal(gasPlantPointSize(930), gasPlantPointSize(4000));
});

test('an unpublished power draws at the floor size, not at zero', () => {
  const floor = gasPlantPointSize(null);
  assert.ok(floor > 0);
  assert.equal(gasPlantPointSize(undefined), floor);
  assert.equal(gasPlantPointSize(0), floor);
  assert.equal(gasPlantPointSize(-5), floor);
  // Present and visibly unquantified beats absent.
  assert.ok(gasPlantPointSize(210) >= floor);
});

test('injection points are sized by declared capacity and stay smaller than a station', () => {
  assert.ok(gasInjectionPointSize(268) > gasInjectionPointSize(15.6));
  assert.ok(gasInjectionPointSize(15.6) > 0);
  assert.equal(gasInjectionPointSize(null), gasInjectionPointSize(0));
  // The two channels must not be confusable by size alone: the biggest
  // injection site is smaller than the smallest station.
  assert.ok(gasInjectionPointSize(268) < gasPlantPointSize(210));
});

// ── Palette ─────────────────────────────────────────────────────────────────

test('the four channels are far enough apart to be told apart, and none reads as water', () => {
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const distance = (a, b) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));
  const channels = [
    GAS_NETWORK_OPERATORS.natran.color,
    GAS_NETWORK_OPERATORS.terega.color,
    GAS_PLANT_COLOR,
    GAS_INJECTION_COLOR,
  ];
  for (let i = 0; i < channels.length; i += 1) {
    for (let j = i + 1; j < channels.length; j += 1) {
      assert.ok(distance(channels[i], channels[j]) > 60,
        `${channels[i]} vs ${channels[j]} = ${Math.round(distance(channels[i], channels[j]))}`);
    }
  }
  // The failure this exists to stop is not a crash: a pipeline in any blue
  // renders perfectly and reads as a river. Measured against the OSM basemap,
  // the first steel-blue trace sat within 14/255 of its water colour on every
  // channel. Both network hues stay well clear of the blues a basemap uses.
  for (const water of ['#8ab4d8', '#aad3df', '#75cff0', '#b3d1ff']) {
    for (const network of [GAS_NETWORK_OPERATORS.natran.color, GAS_NETWORK_OPERATORS.terega.color]) {
      assert.ok(distance(network, water) > 60, `${network} vs basemap water ${water}`);
    }
  }
});

// ── Formatting ──────────────────────────────────────────────────────────────

test('figures are formatted in the units their own file publishes', () => {
  assert.equal(formatMw(930), '930 MW');
  assert.equal(formatMw(7196), '7.2 GW');
  assert.equal(formatMw(null), '—');
  assert.equal(formatGwhPerYear(15.6), '15.6 GWh/an');
  assert.equal(formatGwhPerYear(268.14), '268 GWh/an');
  assert.equal(formatGwhPerYear(16311), '16.3 TWh/an');
  assert.equal(formatGwhPerYear(null), '—');
  assert.equal(formatKm(36106), '36,106 km');
  assert.equal(formatKm(undefined), '—');
});

// ── The three claims, on the card ───────────────────────────────────────────

test('a pipe card says it is a SIMPLIFIED trace, every time', () => {
  const label = buildGasSelectionLabel(pipeRecord());
  assert.match(label, /NaTran \(ex-GRTgaz\)/);
  assert.match(label, /Moselle/);
  assert.match(label, /Grand Est/);
  assert.match(label, /12\.4 km/);
  // The one line that must never be droppable: this is not where the pipe is.
  assert.match(label, /simplifié/i);
  assert.match(label, /250 m/);
});

test('a station card says INSTALLED capacity and names the edition it read', () => {
  const label = buildGasSelectionLabel(plantRecord());
  assert.match(label, /^Martigues/);
  assert.match(label, /930 MW installed/);
  assert.match(label, /EDF/);
  assert.match(label, /Edition 2025/);
  assert.match(label, /installed capacity, not live output/i);
});

test('a station whose earlier editions disagreed says so on the card', () => {
  const label = buildGasSelectionLabel(plantRecord({
    name: 'Landivisiau',
    mw: 422,
    supersededBy: ['En projet'],
    commissioned: '2022',
  }));
  assert.match(label, /earlier editions said: En projet/);
  // And a station that never changed says nothing of the sort.
  assert.doesNotMatch(buildGasSelectionLabel(plantRecord()), /earlier editions/);
});

test('an injection card names its network tier, and warns when it is not the drawn one', () => {
  const transport = buildGasSelectionLabel(injectionRecord());
  assert.match(transport, /^BIOBEARN/);
  assert.match(transport, /250 GWh\/an/);
  assert.match(transport, /Transport/);
  assert.doesNotMatch(transport, /not the trace drawn here/);

  const distribution = buildGasSelectionLabel(injectionRecord({
    tier: 'distribution', network: 'GRDF', name: 'IDF - Claye Souilly',
  }));
  assert.match(distribution, /Distribution/);
  // The whole point of keeping the tier: this dot is NOT on the drawn network.
  assert.match(distribution, /not the trace drawn here/);
});

test('a card prints only what its record published — no invented lines', () => {
  const sparse = buildGasSelectionLabel(injectionRecord({
    feedstock: null, commune: null, departement: null, commissioned: null, network: null,
  }));
  assert.doesNotMatch(sparse, /null|undefined|NaN/);
  const sparsePlant = buildGasSelectionLabel(plantRecord({
    operator: null, commissioned: null, status: null, mw: null, edition: null,
  }));
  assert.doesNotMatch(sparsePlant, /null|undefined|NaN/);
});

// ── Selection ───────────────────────────────────────────────────────────────

test('selecting a site recolours the dot and publishes exactly one protected card', () => {
  const record = plantRecord();
  const host = seed([record]);
  _selectGasObjectForTest(record.id);

  assert.equal(_gasSelectedIdForTest(), record.id);
  const published = host.calls.filter((call) => call.op === 'set');
  assert.equal(published.length, 1);
  assert.equal(published[0].source, GAS_FR_SELECTED_OVERLAY_SOURCE_ID);
  assert.equal(published[0].entries.length, 1);
  assert.equal(published[0].entries[0].protected, true);
  assert.notEqual(record.point.pixelSize, 0);
});

test('deselecting restores the published styling rather than a guess at it', () => {
  const record = plantRecord();
  const host = seed([record]);
  _selectGasObjectForTest(record.id);
  _clearGasSelectionForTest();

  assert.equal(_gasSelectedIdForTest(), null);
  assert.equal(record.point.pixelSize, record.baseSize);
  assert.equal(record.point.color, record.baseColor);
  assert.ok(host.calls.some((call) => call.op === 'clear'
    && call.source === GAS_FR_SELECTED_OVERLAY_SOURCE_ID));
});

test('selecting a pipe restores its SHARED material, not a per-stroke copy', () => {
  const record = pipeRecord();
  seed([record]);
  _selectGasObjectForTest(record.id);
  assert.notEqual(record.entity.polyline.material, 'BASE');
  assert.ok(record.entity.polyline.width > 1.8);
  _clearGasSelectionForTest();
  // One material instance is shared by every stroke of an operator; restoring
  // anything else would quietly fork 6 074 materials out of one.
  assert.equal(record.entity.polyline.material, 'BASE');
});

test('selecting a second object never leaves the first one highlighted', () => {
  const first = plantRecord();
  const second = injectionRecord();
  seed([first, second]);
  _selectGasObjectForTest(first.id);
  _selectGasObjectForTest(second.id);
  assert.equal(_gasSelectedIdForTest(), second.id);
  assert.equal(first.point.pixelSize, first.baseSize);
});

test('selecting something this layer does not own is inert', () => {
  const record = plantRecord();
  seed([record]);
  _selectGasObjectForTest('some-other-layer:1');
  assert.equal(_gasSelectedIdForTest(), null);
});

test('a pick resolves through the point id, the entity id, or nothing at all', () => {
  const has = (id) => id === 'gas-plant:x' || id === 'gas-fr:pipe:7';
  assert.equal(resolveGasPickId({ primitive: { id: 'gas-plant:x' } }, has), 'gas-plant:x');
  assert.equal(resolveGasPickId({ id: 'gas-plant:x' }, has), 'gas-plant:x');
  // A clamped ground polyline comes back as the Entity, not as a string.
  assert.equal(resolveGasPickId({ id: { id: 'gas-fr:pipe:7' } }, has), 'gas-fr:pipe:7');
  assert.equal(resolveGasPickId({ id: { id: 'someone-else:3' } }, has), null);
  assert.equal(resolveGasPickId(null, has), null);
  assert.equal(resolveGasPickId({}, has), null);
});

// ── Overlay ─────────────────────────────────────────────────────────────────

test('the ambient labels are the power stations, ranked by the machine they name', () => {
  const big = createGasPlantOverlayEntry({ id: 'a', name: 'Martigues', mw: 930 }, POSITION);
  const small = createGasPlantOverlayEntry({ id: 'b', name: 'Gennevilliers', mw: 210 }, POSITION);
  assert.ok(big.priority > small.priority);
  assert.match(big.title, /Martigues · 930 MW/);
  assert.equal(big.accent, GAS_PLANT_COLOR);
  assert.equal(big.interactive, false);

  const cohort = selectGasOverlayCohort([small, big]);
  assert.deepEqual(cohort.map((entry) => entry.id), ['gas-fr-label:a', 'gas-fr-label:b']);
});

test('the ambient cohort is bounded, and an unpublished power does not become NaN priority', () => {
  const entries = Array.from({ length: 40 }, (unused, index) => createGasPlantOverlayEntry(
    { id: `p${index}`, name: `P${index}`, mw: index === 0 ? null : index },
    POSITION,
  ));
  const cohort = selectGasOverlayCohort(entries);
  assert.ok(cohort.length <= GAS_FR_OVERLAY_COHORT_LIMIT);
  for (const entry of entries) assert.ok(Number.isFinite(entry.priority));
  assert.deepEqual(selectGasOverlayCohort(entries, 0), []);
  assert.deepEqual(selectGasOverlayCohort(null), []);
});

test('a selected entry with no position is refused rather than drawn at the origin', () => {
  assert.equal(createGasSelectedOverlayEntry({ id: 'x', kind: 'plant', site: {} }), null);
  assert.equal(createGasSelectedOverlayEntry({ position: POSITION, kind: 'plant', site: {} }), null);
  const entry = createGasSelectedOverlayEntry(plantRecord());
  assert.equal(entry.variant, 'selected');
  assert.ok(entry.details.length > 0);
});

// ── Surface classification ──────────────────────────────────────────────────

test('strokes classify against ONLY the active surface, with BOTH as the safe fallback', () => {
  assert.equal(gasClassificationTypeForStack('photoreal'), Cesium.ClassificationType.CESIUM_3D_TILE);
  for (const stack of ['bing-aerial', 'bing-labels', 'osm']) {
    assert.equal(gasClassificationTypeForStack(stack), Cesium.ClassificationType.TERRAIN);
  }
  // A stack this module has never heard of must reach BOTH — visible on every
  // surface — rather than being asserted onto one that is not there.
  for (const unknown of ['some-future-stack', null, undefined, '']) {
    assert.equal(gasClassificationTypeForStack(unknown), Cesium.ClassificationType.BOTH);
  }
});

test('the boot-time settle reads the scene, because it fires no stack event', () => {
  assert.equal(
    gasClassificationTypeForScene({ globe: { show: false } }),
    Cesium.ClassificationType.CESIUM_3D_TILE,
  );
  assert.equal(
    gasClassificationTypeForScene({ globe: { show: true } }),
    Cesium.ClassificationType.TERRAIN,
  );
  assert.equal(gasClassificationTypeForScene(null), Cesium.ClassificationType.BOTH);
  assert.equal(gasClassificationTypeForScene({}), Cesium.ClassificationType.BOTH);
});

// ── Row controls ────────────────────────────────────────────────────────────

test('the legend splits injection points by tier, because that split is the honesty', () => {
  seed([], {
    plants: [{ id: 'p1', name: 'Martigues', mw: 930 }],
    injections: [
      { id: 'i1', tier: 'transport', gwh: 250 },
      { id: 'i2', tier: 'distribution', gwh: 100 },
      { id: 'i3', tier: 'distribution', gwh: 50 },
    ],
    operators: [
      { id: 'natran', label: 'NaTran (ex-GRTgaz)', color: '#9d7ae6', strokes: 6074, lengthKm: 31420, departements: 80 },
      { id: 'terega', label: 'Teréga', color: '#e87ad0', strokes: 1125, lengthKm: 4686, departements: 15 },
    ],
    siteStats: { plants: { fleetMw: 7196 } },
  });
  const { chips, legend } = _gasRowControlsForTest();
  assert.deepEqual(chips, []);
  const labels = legend.map((row) => row.label);
  assert.deepEqual(labels, [
    'NaTran (ex-GRTgaz)',
    'Teréga',
    'Centrales gaz',
    'Injection · transport',
    'Injection · distribution',
  ]);
  assert.equal(legend[3].count, 1);
  assert.equal(legend[4].count, 2);
  // The two networks report their own lengths; neither is a share of a total.
  assert.match(legend[0].blurb, /31,420 km/);
  assert.match(legend[1].blurb, /4,686 km/);
  assert.match(legend[2].blurb, /7\.2 GW/);
  assert.match(legend[4].blurb, /does not draw/);
});

test('a tier with nothing in it is omitted rather than listed as zero', () => {
  seed([], {
    plants: [],
    injections: [{ id: 'i1', tier: 'transport', gwh: 10 }],
    operators: [],
    siteStats: null,
  });
  const labels = _gasRowControlsForTest().legend.map((row) => row.label);
  assert.deepEqual(labels, ['Injection · transport']);
});

// ── Detection + analyst seams ───────────────────────────────────────────────

test('the detection cohort offers sites and never a pipe', () => {
  const records = [plantRecord(), injectionRecord(), pipeRecord()];
  seed(records);
  const detectables = _gasDetectablesForTest();
  assert.equal(detectables.length, 2);
  for (const item of detectables) {
    assert.ok(item.position);
    assert.ok(item.type === 'PWR' || item.type === 'GAS');
    assert.ok(item.id.length <= 22);
  }
});

test('the detection cohort honours its cap and is deterministic for a seed', () => {
  const records = Array.from({ length: 30 }, (unused, index) => injectionRecord({
    id: `gas-injection:${index}`, name: `SITE ${index}`,
  }));
  seed(records);
  const first = _gasDetectablesForTest({ maxCount: 7, seed: 3 });
  const again = _gasDetectablesForTest({ maxCount: 7, seed: 3 });
  // A stride sample is capped BY maxCount, not padded up to it.
  assert.ok(first.length > 0 && first.length <= 7, `${first.length}`);
  assert.deepEqual(first.map((item) => item.sourceId), again.map((item) => item.sourceId));
});

test('analyst records are JSON-safe and never mix the two capacity units', () => {
  const plant = mapGasAnalystRecord(plantRecord().site, 0);
  assert.equal(plant.kind, 'gas-power-station');
  assert.equal(plant.installedMw, 930);
  assert.equal(plant.capacityGwhPerYear, null);

  const injection = mapGasAnalystRecord(injectionRecord().site, 1);
  assert.equal(injection.kind, 'biomethane-injection');
  assert.equal(injection.installedMw, null);
  assert.equal(injection.capacityGwhPerYear, 250.264);
  assert.equal(injection.networkTier, 'transport');

  const empty = mapGasAnalystRecord(null, 4);
  assert.equal(empty.id, 'GAS-0004');
  for (const value of Object.values(empty)) {
    assert.ok(value === null || typeof value === 'string');
  }
  assert.deepEqual(JSON.parse(JSON.stringify(injection)), injection);
});

test('the analyst seam stays shut while the layer is off', () => {
  _setGasStateForTest({ plants: [plantRecord().site], injections: [], records: new Map() });
  assert.equal(gasFranceLayer.getAnalystRecords().length, 1);
  // Off means off: an on-demand seam must not answer from the last enabled
  // session's inventory.
  _setGasStateForTest({ plants: [plantRecord().site], injections: [], records: new Map(), enabled: false });
  assert.deepEqual(gasFranceLayer.getAnalystRecords(), []);
  assert.deepEqual(_gasDetectablesForTest(), []);
});

test('getStats reports the data date the licence obliges, and never a fake count', () => {
  seed([], {
    plants: [{ id: 'p1', name: 'Martigues', mw: 930 }],
    injections: [{ id: 'i1', tier: 'transport', gwh: 250 }],
    operators: [],
    siteStats: { plants: { fleetMw: 7196, editionTo: 2025 }, injections: { capacityGwh: 16311 } },
    networkStats: { strokes: 7199, lengthKm: 36106 },
  });
  const stats = gasFranceLayer.getStats();
  assert.equal(stats.count, 2);
  assert.equal(stats.networkKm, 36106);
  assert.equal(stats.plantMw, 7196);
  assert.equal(stats.injectionGwhPerYear, 16311);
  // Licence Ouverte 2.0 obliges the data's own update date. The ODRÉ catalogue
  // reports 2019-11-30 for a file carrying a 2025 edition, so what is reported
  // is the edition actually read.
  assert.equal(stats.plantEdition, 2025);
});
