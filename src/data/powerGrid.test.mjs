// src/data/powerGrid.test.mjs
// The Power Grid layer's own decisions — the ones that turn a projected
// document into something on screen. Everything here runs the REAL projection
// over the captured Overpass response, so a fixture can never drift from what
// the proxy serves; what it cannot run is WebGL, so the render state is seeded
// through `_setPowerGridStateForTest`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';
import {
  POWER_GRID_MAX_BOX_DEG,
  POWER_GRID_TIERS,
  POWER_GRID_TOWER_MAX_BOX_DEG,
  projectPowerGrid,
} from './powerGridFeed.js';
import powerGridLayer, {
  POWER_GRID_OVERLAY_COHORT_LIMIT,
  POWER_GRID_OVERLAY_SOURCE_ID,
  POWER_GRID_SELECTED_OVERLAY_SOURCE_ID,
  _clearPowerSelectionForTest,
  _powerDetectablesForTest,
  _powerRowControlsForTest,
  _powerSelectedIdForTest,
  _powerStatsForTest,
  _selectPowerObjectForTest,
  _setPowerGridStateForTest,
  buildPowerSelectionLabel,
  createSubstationOverlayEntry,
  formatGridKm,
  mapPowerAnalystRecord,
  powerClassificationTypeForScene,
  powerClassificationTypeForStack,
  powerRetryDelayMs,
  powerViewportBox,
  resolvePowerPickId,
  selectPowerOverlayCohort,
  substationPointSize,
} from './powerGrid.js';

const OSM = JSON.parse(readFileSync(
  new URL('./fixtures/power-grid-osm-sample.json', import.meta.url),
  'utf8',
));
const PAYLOAD = projectPowerGrid(OSM);

/** Stand in for the rendered scene: records keyed exactly as the layer keys them. */
function seedRenderState({ overlayHost, towersShown = true } = {}) {
  const records = new Map();
  for (const substation of PAYLOAD.substations) {
    const id = `power-grid:substation:${substation.id}`;
    records.set(id, {
      id,
      kind: 'substation',
      substation,
      position: Cesium.Cartesian3.fromDegrees(substation.lon, substation.lat, 2.5),
      point: { show: true, color: null, pixelSize: 0 },
      baseColor: Cesium.Color.WHITE,
      baseSize: 10,
    });
  }
  for (const tower of PAYLOAD.towers) {
    const id = `power-grid:tower:${tower.id}`;
    records.set(id, {
      id,
      kind: 'tower',
      tower,
      position: Cesium.Cartesian3.fromDegrees(tower.lon, tower.lat, 2.5),
      point: { show: true, color: null, pixelSize: 0 },
      baseColor: Cesium.Color.WHITE,
      baseSize: 4,
    });
  }
  for (const stroke of PAYLOAD.strokes) {
    const id = `power-grid:stroke:${stroke.id}`;
    records.set(id, {
      id,
      kind: 'stroke',
      stroke,
      // A stroke's card is anchored where the operator clicked; the click
      // handler sets this, so the seed does the same.
      position: Cesium.Cartesian3.fromDegrees(stroke.c[0], stroke.c[1], 2.5),
    });
  }
  _setPowerGridStateForTest({
    records, payload: PAYLOAD, overlayHost, towersShown, enabled: true,
  });
  return records;
}

function overlaySink() {
  const sources = new Map();
  return {
    sources,
    setEntries(sourceId, entries, options) { sources.set(sourceId, { entries, options }); },
    setVisible() {},
    clearSource(sourceId) { sources.delete(sourceId); },
  };
}

test('the layer contract the data manager and the share link both depend on', () => {
  assert.equal(powerGridLayer.id, 'power-grid');
  assert.equal(powerGridLayer.name, 'Power Grid');
  assert.equal(typeof powerGridLayer.init, 'function');
  assert.equal(typeof powerGridLayer.enable, 'function');
  assert.equal(typeof powerGridLayer.disable, 'function');
  assert.equal(typeof powerGridLayer.update, 'function');
  assert.equal(typeof powerGridLayer.destroy, 'function');
  assert.equal(typeof powerGridLayer.getStats, 'function');
  assert.ok(powerGridLayer.updateInterval > 0);
});

test('a viewport wider than the proxy will answer is refused, not truncated', () => {
  const viewerFor = (south, west, north, east) => ({
    scene: { globe: { ellipsoid: Cesium.Ellipsoid.WGS84 } },
    camera: {
      computeViewRectangle: () => Cesium.Rectangle.fromDegrees(west, south, east, north),
    },
  });
  assert.deepEqual(powerViewportBox(viewerFor(48.6, 2.1, 48.8, 2.4)), {
    south: 48.6, west: 2.1, north: 48.8, east: 2.4,
  });
  // One hair over the ceiling on either axis is a zoom-in, not a partial answer.
  const over = POWER_GRID_MAX_BOX_DEG + 0.01;
  assert.equal(powerViewportBox(viewerFor(48, 2, 48 + over, 2.4)), null);
  assert.equal(powerViewportBox(viewerFor(48, 2, 48.4, 2 + over)), null);
  // A global / cross-dateline view has no bounded box to ask for.
  assert.equal(powerViewportBox({ camera: { computeViewRectangle: () => null }, scene: { globe: {} } }), null);
  assert.equal(powerViewportBox(null), null);
});

test('ground strokes classify against ONLY the active surface, with BOTH as fallback', () => {
  assert.equal(powerClassificationTypeForStack('photoreal'), Cesium.ClassificationType.CESIUM_3D_TILE);
  assert.equal(powerClassificationTypeForStack('osm'), Cesium.ClassificationType.TERRAIN);
  assert.equal(powerClassificationTypeForStack('bing-aerial'), Cesium.ClassificationType.TERRAIN);
  // A stack id this module has never heard of must not be asserted onto a
  // surface that may not be there.
  assert.equal(powerClassificationTypeForStack('some-future-stack'), Cesium.ClassificationType.BOTH);
  assert.equal(powerClassificationTypeForStack(undefined), Cesium.ClassificationType.BOTH);

  // The boot-time settle fires no event, so live scene state has to answer too.
  assert.equal(
    powerClassificationTypeForScene({ globe: { show: false } }),
    Cesium.ClassificationType.CESIUM_3D_TILE,
  );
  assert.equal(
    powerClassificationTypeForScene({ globe: { show: true } }),
    Cesium.ClassificationType.TERRAIN,
  );
  assert.equal(powerClassificationTypeForScene(null), Cesium.ClassificationType.BOTH);
});

test('a substation card states its voltage, its role, and where the dot actually is', () => {
  seedRenderState();
  const villejust = PAYLOAD.substations.find((s) => s.ref === 'VLEJU');
  const card = buildPowerSelectionLabel(
    { kind: 'substation', substation: villejust }, PAYLOAD,
  );
  assert.match(card, /^Poste électrique de Villejust\n/);
  // The classifying reading AND the full mapped list, because the yard really
  // does step 400 down to 225 and 90.
  assert.match(card, /400 kV · mapped as 400000;225000;90000/);
  assert.match(card, /Transmission substation/);
  assert.match(card, /RTE/);
  // The dot is the centre of a fenced yard, never a claim about a building.
  assert.match(card, /Position is the mapped yard’s centre/);
  assert.match(card, /OpenStreetMap contributors \(ODbL 1\.0\)/);

  // A traction feed says what it is rather than being rounded into the grid.
  const carres = PAYLOAD.substations.find((s) => s.ref === 'CARR5');
  assert.match(
    buildPowerSelectionLabel({ kind: 'substation', substation: carres }, PAYLOAD),
    /Railway traction substation/,
  );
  // A yard with no `substation` subtype says exactly that.
  const provence = PAYLOAD.substations.find((s) => s.ref === 'PROVE');
  assert.match(
    buildPowerSelectionLabel({ kind: 'substation', substation: provence }, PAYLOAD),
    /Substation \(role not stated\)/,
  );
});

test('a route card never implies the line is drawn at conductor height', () => {
  const overhead = PAYLOAD.strokes.find((s) => !s.u);
  const card = buildPowerSelectionLabel({ kind: 'stroke', stroke: overhead }, PAYLOAD);
  assert.match(card, /Overhead line — drawn on the ground, not at conductor height/);
  assert.doesNotMatch(card, /height not published|estimated/);

  // And an underground cable says the opposite thing, so the dashes are never
  // read as "a line we could not place".
  const cable = PAYLOAD.strokes.find((s) => s.u);
  const cableCard = buildPowerSelectionLabel({ kind: 'stroke', stroke: cable }, PAYLOAD);
  assert.match(cableCard, /Underground cable — no pylons on this route/);
});

test('a pylon card reports its mapped height and stays silent when there is none', () => {
  const measured = PAYLOAD.towers.find((t) => Number.isFinite(t.h));
  assert.match(
    buildPowerSelectionLabel({ kind: 'tower', tower: measured }, PAYLOAD),
    new RegExp(`↕ ${measured.h} m tall`),
  );
  const unmeasured = PAYLOAD.towers.find((t) => t.h === null);
  const card = buildPowerSelectionLabel({ kind: 'tower', tower: unmeasured }, PAYLOAD);
  assert.match(card, /height not mapped/);
  // No prior, no "typical", no number at all.
  assert.doesNotMatch(card, /\d+ m tall/);
});

test('selection is exclusive, restores the previous style, and Escape clears it', () => {
  const host = overlaySink();
  const records = seedRenderState({ overlayHost: host });
  const [firstId, secondId] = [...records.keys()].filter(
    (id) => records.get(id).kind === 'substation',
  );

  _selectPowerObjectForTest(firstId);
  assert.equal(_powerSelectedIdForTest(), firstId);
  const card = host.sources.get(POWER_GRID_SELECTED_OVERLAY_SOURCE_ID);
  assert.equal(card.entries.length, 1);
  assert.equal(card.entries[0].protected, true);
  assert.equal(records.get(firstId).point.pixelSize, 20);

  _selectPowerObjectForTest(secondId);
  assert.equal(_powerSelectedIdForTest(), secondId);
  // The first one is back to its own size and colour, not left highlighted.
  assert.equal(records.get(firstId).point.pixelSize, records.get(firstId).baseSize);
  assert.equal(records.get(firstId).point.color, records.get(firstId).baseColor);

  _clearPowerSelectionForTest();
  assert.equal(_powerSelectedIdForTest(), null);
  assert.equal(host.sources.has(POWER_GRID_SELECTED_OVERLAY_SOURCE_ID), false);
  assert.equal(records.get(secondId).point.pixelSize, records.get(secondId).baseSize);

  // An id this layer does not own is ignored rather than half-selected.
  _selectPowerObjectForTest('power-grid:substation:does-not-exist');
  assert.equal(_powerSelectedIdForTest(), null);
});

test('a batched ground-line pick resolves through the GeometryInstance id', () => {
  const records = seedRenderState();
  const strokeId = [...records.keys()].find((id) => records.get(id).kind === 'stroke');
  const has = (id) => records.has(id);
  // What a GroundPolylinePrimitive actually reports: the instance id on `.id`.
  assert.equal(resolvePowerPickId({ id: strokeId, primitive: {} }, has), strokeId);
  // A point primitive reports it on `.primitive.id`.
  const pointId = [...records.keys()].find((id) => records.get(id).kind === 'substation');
  assert.equal(resolvePowerPickId({ primitive: { id: pointId } }, has), pointId);
  // An Entity-shaped pick still resolves, and a foreign pick never does.
  assert.equal(resolvePowerPickId({ id: { id: pointId } }, has), pointId);
  assert.equal(resolvePowerPickId({ id: 'flights:abc123' }, has), null);
  assert.equal(resolvePowerPickId(null, has), null);
});

test('ambient labels name the highest-voltage NAMED yards and nothing else', () => {
  seedRenderState({ overlayHost: overlaySink() });
  // publishOverlay() runs inside enable(), which needs a live scene; the
  // decisions it delegates are these two, and they are what this pins.
  const entries = PAYLOAD.substations
    .filter((substation) => substation.name)
    .map((substation) => createSubstationOverlayEntry(
      substation,
      Cesium.Cartesian3.fromDegrees(substation.lon, substation.lat, 2.5),
      PAYLOAD,
    ));
  const cohort = selectPowerOverlayCohort(entries);
  assert.ok(cohort.length > 0);
  assert.ok(cohort.length <= POWER_GRID_OVERLAY_COHORT_LIMIT);
  // Highest voltage first — the yard that matters most keeps its label when
  // labels collide.
  const priorities = cohort.map((entry) => entry.priority);
  assert.deepEqual(priorities, [...priorities].sort((a, b) => b - a));
  assert.match(cohort[0].title, / · \d+ kV$/);
  // An unnamed yard is never labelled from its reference code.
  assert.equal(entries.length, PAYLOAD.substations.filter((s) => s.name).length);
  assert.ok(PAYLOAD.substations.some((s) => !s.name), 'the box holds unnamed yards');
  // Ties break on identity, so the same yards keep their labels across a pan.
  const tied = [
    { id: 'b', priority: 225000 }, { id: 'a', priority: 225000 },
  ];
  assert.deepEqual(selectPowerOverlayCohort(tied, 2).map((e) => e.id), ['a', 'b']);
  assert.deepEqual(selectPowerOverlayCohort(entries, 0), []);
  assert.deepEqual(selectPowerOverlayCohort(null), []);
});

test('the legend is by voltage band and carries the ground-route limit on every row', () => {
  seedRenderState();
  const { chips, legend } = _powerRowControlsForTest();
  assert.deepEqual(chips, []);
  assert.ok(legend.length >= 2);
  // Bands in fixed order, so panning never reshuffles the key.
  const order = POWER_GRID_TIERS.map((tier) => tier.label);
  assert.deepEqual(
    legend.filter((row) => order.includes(row.label)).map((row) => row.label),
    order.filter((label) => legend.some((row) => row.label === label)),
  );
  // The limit that would otherwise be invisible, on every band row.
  for (const row of legend.filter((r) => order.includes(r.label))) {
    assert.match(row.blurb, /not the conductor height, which OpenStreetMap does not publish/);
    assert.ok(row.count > 0);
    assert.match(row.color, /^#[0-9a-f]{6}$/i);
  }
  // The pylon row states its own zoom gate rather than looking like an outage.
  const pylons = legend.find((row) => row.label === 'Pylons');
  assert.ok(pylons);
  assert.match(pylons.blurb, new RegExp(`below ${POWER_GRID_TOWER_MAX_BOX_DEG}° of view`));
  assert.match(pylons.blurb, /never inferred/);

  // Pylons out of range: the row disappears instead of reporting zero.
  seedRenderState({ towersShown: false });
  assert.equal(_powerRowControlsForTest().legend.some((row) => row.label === 'Pylons'), false);
});

test('stats report strokes and mapped ROUTES separately, and say when truncated', () => {
  seedRenderState();
  const stats = _powerStatsForTest();
  assert.equal(stats.status, 'ok');
  assert.equal(stats.strokes, PAYLOAD.stats.strokes);
  // The number a human means by "how many lines" is not the way count.
  assert.equal(stats.routes, PAYLOAD.stats.routes);
  assert.ok(stats.routes <= stats.strokes);
  assert.equal(stats.substations, PAYLOAD.substations.length);
  assert.equal(stats.towers, PAYLOAD.towers.length);
  assert.equal(stats.saturated, false);
  assert.match(stats.loadingLabel, /of mapped route/);

  // A truncated class must reach the readout, because a truncated stroke set
  // has GAPS in it and looks like a complete answer otherwise.
  const truncated = projectPowerGrid(OSM, {
    caps: {
      strokes: 2, substationWays: 2, substationNodes: 1, substationRelations: 1, towers: 2,
    },
  });
  _setPowerGridStateForTest({ payload: truncated, records: new Map(), enabled: true });
  const hot = _powerStatsForTest();
  assert.equal(hot.saturated, true);
  assert.match(hot.loadingLabel, /truncated — zoom in/);

  // And pylons that were never requested are reported as absent, not as zero.
  _setPowerGridStateForTest({ payload: PAYLOAD, records: new Map(), towersShown: false });
  assert.equal(_powerStatsForTest().towers, null);
});

test('detection contacts are substations only, deterministic, and voltage-typed', () => {
  seedRenderState();
  const all = _powerDetectablesForTest({});
  assert.equal(all.length, PAYLOAD.substations.length);
  // A stroke is a fragment and a pylon is a pole; neither is a contact.
  assert.ok(all.every((item) => item.sourceId.startsWith('power-grid:substation:')));
  assert.ok(all.every((item) => /^\d+KV$|^SUB$/.test(item.type)));
  assert.ok(all.some((item) => item.type === '400KV'));

  // Same seed, same subsample — the overlay must not shimmer between frames.
  const a = _powerDetectablesForTest({ maxCount: 5, seed: 3 });
  const b = _powerDetectablesForTest({ maxCount: 5, seed: 3 });
  assert.deepEqual(a.map((i) => i.sourceId), b.map((i) => i.sourceId));
  // A stride never OVERSHOOTS the budget; it can land under it, which is the
  // documented cost of a subsample that stays stable between frames.
  assert.ok(a.length > 0 && a.length <= 5);
  assert.notDeepEqual(
    a.map((i) => i.sourceId),
    _powerDetectablesForTest({ maxCount: 5, seed: 4 }).map((i) => i.sourceId),
  );

  // A disabled layer contributes nothing at all.
  _setPowerGridStateForTest({ payload: PAYLOAD, records: new Map(), enabled: false });
  assert.deepEqual(_powerDetectablesForTest({}), []);
});

test('analyst records resolve the dictionaries and never invent a field', () => {
  const villejust = PAYLOAD.substations.find((s) => s.ref === 'VLEJU');
  const record = mapPowerAnalystRecord(villejust, PAYLOAD, 0);
  assert.equal(record.name, 'Poste électrique de Villejust');
  assert.equal(record.kind, 'substation');
  assert.equal(record.voltageV, 400_000);
  assert.equal(record.voltageKv, 400);
  assert.equal(record.operator, 'RTE');
  assert.equal(record.role, 'transmission');
  assert.equal(record.ref, 'VLEJU');
  assert.ok(Number.isFinite(record.lat) && Number.isFinite(record.lon));

  // An absent operator resolves to null, never to an index or an empty string.
  const anonymous = mapPowerAnalystRecord(
    { id: 'w1', lat: 1, lon: 2, vi: 0, o: -1 }, PAYLOAD, 0,
  );
  assert.equal(anonymous.operator, null);
  assert.equal(anonymous.name, null);
  assert.equal(mapPowerAnalystRecord(null, PAYLOAD, 7).id, 'GRID-0007');
});

test('substation size follows the voltage band, with a floor for an unknown one', () => {
  for (const tier of POWER_GRID_TIERS) {
    assert.equal(substationPointSize(tier.id), tier.pointPx);
  }
  const sizes = POWER_GRID_TIERS.map((tier) => substationPointSize(tier.id));
  assert.deepEqual(sizes, [...sizes].sort((a, b) => b - a));
  // Present and visibly unquantified beats absent.
  assert.equal(substationPointSize(null), POWER_GRID_TIERS.at(-1).pointPx);
  assert.equal(substationPointSize('nope'), POWER_GRID_TIERS.at(-1).pointPx);
});

test('lengths read the way a control room writes them', () => {
  assert.equal(formatGridKm(1234.6), '1,235 km');
  assert.equal(formatGridKm(12.34), '12.3 km');
  assert.equal(formatGridKm(0), '0.0 km');
  assert.equal(formatGridKm(NaN), '—');
  assert.equal(formatGridKm(null), '—');
});

test('an empty box is an empty MAP, and the layer says so in those words', () => {
  const empty = projectPowerGrid({ elements: [] });
  assert.deepEqual(empty.strokes, []);
  assert.deepEqual(empty.substations, []);
  assert.deepEqual(empty.tiers, []);
  assert.equal(empty.stats.lengthKm, 0);
  _setPowerGridStateForTest({ payload: empty, records: new Map(), enabled: true });
  assert.deepEqual(_powerRowControlsForTest().legend, []);
  const stats = _powerStatsForTest();
  assert.equal(stats.count, 0);
  assert.equal(stats.saturated, false);
  // Not "no grid here" — "nothing mapped here", which is the only thing the
  // data supports.
  _setPowerGridStateForTest({ payload: empty, records: new Map(), enabled: true });
  assert.equal(_powerStatsForTest().status, 'ok');
});

test('a failed load backs off instead of stranding the layer until the idle refresh', () => {
  // The observed failure: four public mirrors returned 504 / 502 / 504 and a
  // timeout, and the very next request succeeded in 2.2 s. Without a retry the
  // layer would have shown that error for twenty minutes.
  assert.equal(powerRetryDelayMs(0), 20_000);
  assert.equal(powerRetryDelayMs(NaN), 20_000);
  assert.equal(powerRetryDelayMs(-1), 20_000);
  assert.equal(powerRetryDelayMs(20_000), 40_000);
  assert.equal(powerRetryDelayMs(120_000), 240_000);
  // It doubles, and then it stops: a wedged mirror must not become a poll.
  assert.equal(powerRetryDelayMs(240_000), 240_000);
  assert.equal(powerRetryDelayMs(10 ** 9), 240_000);
});

test('the overlay source ids stay distinct so a card cannot evict its own labels', () => {
  assert.notEqual(POWER_GRID_OVERLAY_SOURCE_ID, POWER_GRID_SELECTED_OVERLAY_SOURCE_ID);
  assert.equal(POWER_GRID_OVERLAY_SOURCE_ID, 'power-grid');
});

test('a camera too wide for the grid is flown in, not told off', async () => {
  // The bug this replaces: enabling the layer from a continental view returned
  // false from update(), which the manager reads as the layer REJECTING its
  // lifecycle — the toggle flipped straight back to OFF under "could not start
  // cleanly", with a perfectly healthy feed behind it.
  const state = { box: { south: 40, west: -6, north: 52, east: 10 } };
  const flights = [];
  const viewer = {
    scene: { globe: { ellipsoid: Cesium.Ellipsoid.WGS84, getHeight: () => 0 } },
    camera: {
      frustum: { fov: Math.PI / 3, aspectRatio: 1.7 },
      heading: 0,
      pitch: -Math.PI / 2,
      positionCartographic: { height: 4_000_000 },
      computeViewRectangle: () => Cesium.Rectangle.fromDegrees(
        state.box.west, state.box.south, state.box.east, state.box.north,
      ),
      flyTo(options) {
        const carto = Cesium.Cartographic.fromCartesian(options.destination);
        const lat = Cesium.Math.toDegrees(carto.latitude);
        const lon = Cesium.Math.toDegrees(carto.longitude);
        flights.push({ lat, lon, heightM: carto.height });
        // Whatever the solve asked for, the camera arrives somewhere bounded.
        state.box = { south: lat - 0.1, west: lon - 0.1, north: lat + 0.1, east: lon + 0.1 };
        options.complete?.();
      },
    },
  };

  const fetchBefore = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('the gate must run before any request'); };
  try {
    _setPowerGridStateForTest({ viewer, payload: null, enabled: true });
    assert.equal(powerViewportBox(viewer), null, 'the continental view is outside the gate');
    assert.equal(await powerGridLayer.update(), true,
      'a load that only wanted a zoom is not a failed refresh');
    assert.equal(powerGridLayer.getStats().status, 'zoom-in');

    assert.equal(await powerGridLayer.ensureViewGate(viewer), true);
    assert.equal(flights.length, 1, 'one flight, straight to a box the proxy will answer');
    assert.ok(powerViewportBox(viewer), 'and the camera lands inside the gate');
  } finally {
    globalThis.fetch = fetchBefore;
    _setPowerGridStateForTest({ viewer: null, payload: null, enabled: false });
  }
});
