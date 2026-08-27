// src/data/meteoFranceVigilance.test.mjs
// Covers the Vigilance LAYER: the join between the bundled département
// polygons and the bulletin, the whitelist that keeps non-départements off the
// map, the "green is absence" paint rule, and the lifecycle. The upstream
// product shape is pinned separately in meteoFranceVigilanceFeed.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';
import {
  VIGILANCE_ALERT_LEVEL,
  VIGILANCE_DRAWN_ECHEANCE,
  VIGILANCE_LEVELS,
  VIGILANCE_OVERLAY_COHORT_LIMIT,
  VIGILANCE_OVERLAY_COLLISION_CAPACITY,
  VIGILANCE_UNKNOWN_LEVEL,
  buildVigilanceRecords,
  createMeteoFranceVigilanceLayer,
  createVigilanceOverlayEntry,
  departementAnchor,
  mapAnalystRecord,
  parseDepartements,
  selectVigilanceOverlayCohort,
  summarizeVigilanceRecords,
  vigilanceClassificationTypeForScene,
  vigilanceClassificationTypeForStack,
  vigilanceLabelText,
  vigilanceLevel,
  vigilanceLevelLegend,
} from './meteoFranceVigilance.js';
import { projectVigilanceProduct } from './meteoFranceVigilanceFeed.js';

const DEPARTEMENTS = JSON.parse(readFileSync(
  new URL('./local_data/france_departements/departements.geojson', import.meta.url),
  'utf8',
));
const PRODUCT = JSON.parse(readFileSync(
  new URL('./fixtures/meteofrance-cartevigilance-sample.json', import.meta.url),
  'utf8',
));

/** The payload shape `/api/vigilance` serves, from the real projection. */
const PAYLOAD = { ...projectVigilanceProduct(PRODUCT, 'data.gouv.fr mirror'), stale: false };

// ── Bundled polygons ────────────────────────────────────────────────────────

test('the bundled polygons are the 96 metropolitan départements, no more, no less', () => {
  const byCode = parseDepartements(DEPARTEMENTS);
  assert.equal(byCode.size, 96);
  // Corsica is alphanumeric on both sides of the join, so no special case.
  assert.ok(byCode.has('2A') && byCode.has('2B'));
  assert.equal(byCode.get('2A').name, 'Corse-du-Sud');
  // The métropole vigilance product contains no data for the overseas
  // départements — shipping their polygons would add shapes that can never be
  // coloured, at 6.5x the file size.
  for (const overseas of ['971', '972', '973', '974', '976']) {
    assert.equal(byCode.has(overseas), false, `${overseas} must not be bundled`);
  }
  assert.equal(byCode.get('75').name, 'Paris');
  for (const record of byCode.values()) {
    assert.ok(Array.isArray(record.anchor), `${record.code} must have a label anchor`);
    assert.ok(Number.isFinite(record.anchor[0]) && Number.isFinite(record.anchor[1]));
  }
});

test('every bundled anchor falls inside the French bounding box', () => {
  for (const record of parseDepartements(DEPARTEMENTS).values()) {
    const [lon, lat] = record.anchor;
    assert.ok(lon > -5.5 && lon < 10, `${record.code} lon ${lon}`);
    assert.ok(lat > 41 && lat < 51.5, `${record.code} lat ${lat}`);
  }
});

test('departementAnchor is an area centroid, not a vertex average', () => {
  // A unit square with one finely-mapped edge: a vertex average is dragged
  // toward the dense edge, the area centroid stays at the middle.
  const dense = [[0, 0], [1, 0], [1, 1]];
  for (let x = 1; x > 0; x -= 0.05) dense.push([Number(x.toFixed(2)), 1]);
  dense.push([0, 1], [0, 0]);
  const anchor = departementAnchor({ type: 'Polygon', coordinates: [dense] });
  assert.ok(Math.abs(anchor[0] - 0.5) < 0.02, `lon ${anchor[0]}`);
  assert.ok(Math.abs(anchor[1] - 0.5) < 0.02, `lat ${anchor[1]}`);
});

test('a MultiPolygon anchors on its largest part, not its first', () => {
  const island = [[10, 10], [10.1, 10], [10.1, 10.1], [10, 10.1], [10, 10]];
  const mainland = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]];
  const anchor = departementAnchor({ type: 'MultiPolygon', coordinates: [[island], [mainland]] });
  assert.ok(Math.abs(anchor[0] - 1) < 1e-6 && Math.abs(anchor[1] - 1) < 1e-6);
});

test('departementAnchor refuses geometry it cannot centre', () => {
  assert.equal(departementAnchor(null), null);
  assert.equal(departementAnchor({ type: 'Point', coordinates: [1, 2] }), null);
  assert.equal(departementAnchor({ type: 'Polygon', coordinates: [] }), null);
  assert.equal(departementAnchor({ type: 'Polygon', coordinates: [[[0, 0], [1, 1]]] }), null);
  // A zero-area ring falls back to the vertex average rather than dividing by
  // zero and emitting NaN into a Cartesian3.
  const degenerate = departementAnchor({
    type: 'Polygon',
    coordinates: [[[0, 0], [1, 1], [2, 2], [0, 0]]],
  });
  assert.ok(Number.isFinite(degenerate[0]) && Number.isFinite(degenerate[1]));
});

test('parseDepartements skips features with no code', () => {
  const byCode = parseDepartements({
    features: [
      { properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
      { properties: { code: '75', nom: '' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
    ],
  });
  assert.deepEqual([...byCode.keys()], ['75']);
  assert.equal(byCode.get('75').name, '75', 'a blank name falls back to the code');
  assert.equal(parseDepartements(null).size, 0);
});

// ── Level vocabulary ────────────────────────────────────────────────────────

test('the four level colours are Météo-France\'s own, and green fills nothing', () => {
  // Quoted from the spec's "Valeurs du champ risk_color" table. Third-party
  // clients substitute prettier values; those are not the state's signal.
  assert.equal(VIGILANCE_LEVELS[1].color, '#15ed13');
  assert.equal(VIGILANCE_LEVELS[2].color, '#f9ff00');
  assert.equal(VIGILANCE_LEVELS[3].color, '#f7a401');
  assert.equal(VIGILANCE_LEVELS[4].color, '#e71919');
  // Green means "nothing to report" — painting it would claim the opposite.
  assert.equal(VIGILANCE_LEVELS[1].fillAlpha, 0);
  const ramp = [2, 3, 4].map((level) => VIGILANCE_LEVELS[level].fillAlpha);
  assert.deepEqual(ramp, [...ramp].sort((a, b) => a - b));
  assert.ok(ramp[0] > 0);
});

test('vigilanceLevel refuses to invent green for an unassessed domain', () => {
  assert.equal(vigilanceLevel(1), VIGILANCE_LEVELS[1]);
  assert.equal(vigilanceLevel('3'), VIGILANCE_LEVELS[3]);
  for (const bad of [null, undefined, 0, 5, -1, 2.5, 'orange', {}]) {
    assert.equal(vigilanceLevel(bad), VIGILANCE_UNKNOWN_LEVEL, `${JSON.stringify(bad)} must be UNKNOWN`);
  }
  assert.equal(VIGILANCE_ALERT_LEVEL, 2);
  assert.equal(VIGILANCE_DRAWN_ECHEANCE, 'J');
});

// ── The join ────────────────────────────────────────────────────────────────

test('only real départements survive the join', () => {
  const byCode = parseDepartements(DEPARTEMENTS);
  const records = buildVigilanceRecords(PAYLOAD, byCode);
  const codes = records.map((record) => record.code).sort();
  // The fixture carries FRA, 3010 and six départements. The polygon code set
  // is the whitelist, so the national roll-up and the coastal strip are gone
  // without needing to enumerate what a non-département looks like.
  assert.deepEqual(codes, ['10', '14', '2A', '35']);
  assert.equal(records.find((record) => record.code === 'FRA'), undefined);
  assert.equal(records.find((record) => record.code === '3010'), undefined);
});

test('Andorra\'s 99 cannot reach the map, though it looks like a département', () => {
  const byCode = parseDepartements(DEPARTEMENTS);
  assert.equal(byCode.has('99'), false, 'the whitelist has no 99');
  const withAndorra = {
    periods: { J: { domains: { 99: { c: 3, p: [['8', 3]] }, 75: { c: 2, p: [['3', 2]] } } } },
  };
  const records = buildVigilanceRecords(withAndorra, byCode);
  assert.deepEqual(records.map((record) => record.code), ['75']);
});

test('records carry the phenomenon names, resolved from the spec table', () => {
  const records = buildVigilanceRecords(PAYLOAD, parseDepartements(DEPARTEMENTS));
  const orange = records.find((record) => record.code === '35');
  assert.equal(orange.level, VIGILANCE_LEVELS[3]);
  assert.deepEqual(orange.phenomena.map((p) => p.name), ['Orages']);
  const corsica = records.find((record) => record.code === '2A');
  assert.deepEqual(corsica.phenomena.map((p) => p.name), ['Canicule']);
  // A green département is assessed and joined, it just is not painted.
  const green = records.find((record) => record.code === '10');
  assert.equal(green.level, VIGILANCE_LEVELS[1]);
  assert.deepEqual(green.phenomena, []);
});

test('an unrecognised phenomenon id is named, not dropped', () => {
  const records = buildVigilanceRecords(
    { periods: { J: { domains: { 75: { c: 3, p: [['42', 3]] } } } } },
    parseDepartements(DEPARTEMENTS),
  );
  assert.equal(records[0].phenomena[0].name, 'Phénomène 42');
});

test('records are ordered so the most severe fill is painted last', () => {
  const records = buildVigilanceRecords(PAYLOAD, parseDepartements(DEPARTEMENTS));
  const levels = records.map((record) => record.level.level);
  assert.deepEqual(levels, [...levels].sort((a, b) => a - b));
});

test('a missing or malformed period joins to nothing rather than throwing', () => {
  const byCode = parseDepartements(DEPARTEMENTS);
  assert.deepEqual(buildVigilanceRecords(null, byCode), []);
  assert.deepEqual(buildVigilanceRecords({}, byCode), []);
  assert.deepEqual(buildVigilanceRecords({ periods: { J: {} } }, byCode), []);
  assert.deepEqual(buildVigilanceRecords(PAYLOAD, null), []);
  // The J1 block exists in this bulletin and joins independently.
  assert.ok(buildVigilanceRecords(PAYLOAD, byCode, 'J1').length > 0);
});

test('summary separates assessed départements from raised ones', () => {
  const summary = summarizeVigilanceRecords(
    buildVigilanceRecords(PAYLOAD, parseDepartements(DEPARTEMENTS)),
  );
  assert.equal(summary.total, 4);
  assert.equal(summary.alerts, 3, 'three of the four are raised; the vert one is not');
  assert.equal(summary.byKey.orange, 1);
  assert.equal(summary.byKey.yellow, 2);
  assert.equal(summary.byKey.green, 1);
  assert.deepEqual(summarizeVigilanceRecords(null), {
    total: 0, alerts: 0, byKey: { green: 0, yellow: 0, orange: 0, red: 0, unknown: 0 },
  });
});

test('the row legend lists only levels that are actually painted', () => {
  assert.deepEqual(
    vigilanceLevelLegend({ green: 57, yellow: 27, orange: 12, red: 1 })
      .map((entry) => [entry.label, entry.count]),
    [['ROUGE', 1], ['ORANGE', 12], ['JAUNE', 27]],
  );
  // Green is never drawn, so a swatch for it would describe a map that is not
  // on screen — even with 57 départements carrying it.
  assert.deepEqual(vigilanceLevelLegend({ green: 96 }), []);
  assert.deepEqual(vigilanceLevelLegend(null), []);
  for (const entry of vigilanceLevelLegend({ yellow: 1, orange: 1, red: 1 })) {
    assert.match(entry.color, /^#[0-9a-f]{6}$/);
    assert.ok(entry.blurb.length > 0, 'each swatch carries the level meaning');
  }
});

// ── Labels ──────────────────────────────────────────────────────────────────

test('the label carries the level WORD and the driving phenomenon, not just a hue', () => {
  // #f9ff00 is nearly invisible on a bright globe and orange/red is a common
  // colour-vision collision, so the meaning must not live in the colour alone.
  const records = buildVigilanceRecords(PAYLOAD, parseDepartements(DEPARTEMENTS));
  const orange = records.find((record) => record.code === '35');
  assert.equal(vigilanceLabelText(orange), 'Ille-et-Vilaine · ORANGE · Orages');
});

test('the label names the phenomenon that actually drives the level', () => {
  const record = {
    name: 'Isère',
    level: VIGILANCE_LEVELS[4],
    phenomena: [
      { id: '2', name: 'Pluie-inondation', level: VIGILANCE_LEVELS[2] },
      { id: '8', name: 'Avalanches', level: VIGILANCE_LEVELS[4] },
    ],
  };
  assert.equal(vigilanceLabelText(record), 'Isère · ROUGE · Avalanches');
  assert.equal(
    vigilanceLabelText({ name: 'Ain', level: VIGILANCE_LEVELS[2], phenomena: [] }),
    'Ain · JAUNE',
  );
});

test('overlay entry ranks by severity and stays non-interactive', () => {
  const position = Cesium.Cartesian3.fromDegrees(2.35, 48.85);
  const entry = createVigilanceOverlayEntry(
    { code: '75', name: 'Paris', level: VIGILANCE_LEVELS[3], phenomena: [] },
    position,
  );
  assert.equal(entry.id, 'vigilance:75');
  assert.equal(entry.accent, VIGILANCE_LEVELS[3].color);
  assert.equal(entry.priority, 3000);
  assert.equal(entry.interactive, false);
  assert.equal(entry.paintLane, 'ambient-label');
  assert.equal(entry.position, position);
});

test('overlay cohort honours the cap, most severe first', () => {
  const entries = Array.from({ length: 200 }, (_, i) => ({ id: `d${i}`, priority: i }));
  const cohort = selectVigilanceOverlayCohort(entries, 1000);
  assert.equal(cohort.length, VIGILANCE_OVERLAY_COHORT_LIMIT);
  assert.equal(cohort[0].id, 'd199');
  assert.deepEqual(selectVigilanceOverlayCohort(null), []);
  assert.deepEqual(selectVigilanceOverlayCohort(entries, 0), []);
});

// ── Analyst seam ────────────────────────────────────────────────────────────

test('analyst records are JSON-safe with nulls, never NaN or undefined', () => {
  const records = buildVigilanceRecords(PAYLOAD, parseDepartements(DEPARTEMENTS));
  const mapped = mapAnalystRecord(records.find((record) => record.code === '35'), 0);
  assert.equal(mapped.id, '35');
  assert.equal(mapped.level, 3);
  assert.deepEqual(mapped.phenomena, [{ name: 'Orages', level: 3 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(mapped)), mapped);

  const empty = mapAnalystRecord(undefined, 7);
  assert.equal(empty.id, 'DEPT-0007');
  for (const [key, value] of Object.entries(empty)) {
    assert.notEqual(value, undefined, `${key} must not be undefined`);
    if (typeof value === 'number') assert.ok(Number.isFinite(value), `${key} must not be NaN`);
  }
});

// ── Surface classification ──────────────────────────────────────────────────

test('classification follows the active surface and falls back to BOTH', () => {
  assert.equal(vigilanceClassificationTypeForStack('photoreal'), Cesium.ClassificationType.CESIUM_3D_TILE);
  assert.equal(vigilanceClassificationTypeForStack('osm'), Cesium.ClassificationType.TERRAIN);
  assert.equal(vigilanceClassificationTypeForStack('bing-labels'), Cesium.ClassificationType.TERRAIN);
  assert.equal(vigilanceClassificationTypeForStack('future'), Cesium.ClassificationType.BOTH);
  assert.equal(vigilanceClassificationTypeForScene(null), Cesium.ClassificationType.BOTH);
  assert.equal(
    vigilanceClassificationTypeForScene({ globe: { show: false } }),
    Cesium.ClassificationType.CESIUM_3D_TILE,
  );
  assert.equal(
    vigilanceClassificationTypeForScene({ globe: { show: true } }),
    Cesium.ClassificationType.TERRAIN,
  );
});

// ── Lifecycle ───────────────────────────────────────────────────────────────

/**
 * A four-département stand-in, so the harness does not tessellate all 96.
 * `35` is a MultiPolygon — 10 of the 96 real départements are, and Cesium
 * makes one ENTITY PER PART, so this is the shape that catches an island
 * being left unpainted while its mainland shows the warning.
 */
const TEST_SHAPES = {
  type: 'FeatureCollection',
  features: ['35', '14', '10', '2A'].map((code, index) => {
    const square = (x, y, size) => [[
      [x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y],
    ]];
    return {
      type: 'Feature',
      properties: { code, nom: `Test ${code}` },
      geometry: code === '35'
        ? { type: 'MultiPolygon', coordinates: [square(index, 45, 0.8), square(index, 46.5, 0.2)] }
        : { type: 'Polygon', coordinates: square(index, 45, 0.8) },
    };
  }),
};

test('the harness fixture still exercises the MultiPolygon case', () => {
  const multi = TEST_SHAPES.features.find((feature) => feature.geometry.type === 'MultiPolygon');
  assert.ok(multi, 'one département must have islands');
  assert.equal(multi.properties.code, '35');
});

function createHarness(polls, shapes = TEST_SHAPES) {
  const dataSources = [];
  const hostCalls = [];
  const fetchUrls = [];
  let poll = 0;
  const overlayHost = {
    setEntries: (...args) => hostCalls.push(['entries', ...args]),
    setVisible: (...args) => hostCalls.push(['visible', ...args]),
    clearSource: (...args) => hostCalls.push(['clear', ...args]),
  };
  const viewer = {
    scene: { globe: { show: false }, requestRender() {} },
    dataSources: {
      add(dataSource) { dataSources.push(dataSource); return Promise.resolve(dataSource); },
      remove(dataSource) {
        const index = dataSources.indexOf(dataSource);
        if (index >= 0) dataSources.splice(index, 1);
        return index >= 0;
      },
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    fetchUrls.push(String(url));
    const payload = polls[Math.min(poll++, polls.length - 1)];
    if (payload instanceof Error) throw payload;
    if (typeof payload?.status === 'number') return { ok: false, status: payload.status };
    return { ok: true, status: 200, json: async () => payload };
  };
  const mapStackEventTarget = new EventTarget();
  const layer = createMeteoFranceVigilanceLayer({
    overlayHost,
    departementsGeoJson: shapes,
    mapStackEventTarget,
  });
  return {
    layer,
    viewer,
    dataSources,
    hostCalls,
    fetchUrls,
    mapStackEventTarget,
    entities: () => dataSources[0]?.entities?.values || [],
    restore() { globalThis.fetch = originalFetch; },
  };
}

test('only raised départements are painted — green is drawn as absence', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    assert.equal(await h.layer.update(h.viewer), true);

    const shown = h.entities().filter((entity) => entity.show);
    // 35 is a MultiPolygon, so it contributes TWO entities — both must paint,
    // or an island shows clear while its mainland is orange.
    assert.equal(shown.length, 4, 'the vert département is not painted');
    const codes = shown.map((entity) => entity.properties.code.getValue()).sort();
    assert.deepEqual(codes, ['14', '2A', '35', '35']);
    for (const entity of shown) {
      assert.equal(entity.polygon.outline.getValue(), false, 'polygon outlines are expensive');
      assert.ok(!(entity.polygon.material instanceof Cesium.CallbackProperty));
      assert.equal(
        entity.polygon.classificationType.getValue(),
        Cesium.ClassificationType.CESIUM_3D_TILE,
      );
    }

    const stats = h.layer.getStats();
    assert.equal(stats.count, 3, 'the count reported is RAISED départements');
    assert.equal(stats.assessed, 4);
    assert.equal(stats.national, 3);
    assert.equal(stats.updateTime, '2026-08-26T04:00:28Z');
    assert.equal(stats.feedSource, 'data.gouv.fr mirror');
    assert.equal(stats.error, null);
    assert.ok(Number.isFinite(stats.tomorrowAlerts));

    const controls = h.layer.getRowControls();
    assert.deepEqual(controls.chips, []);
    assert.deepEqual(controls.legend.map((entry) => [entry.label, entry.count]),
      [['ORANGE', 1], ['JAUNE', 2]]);
  } finally {
    h.restore();
  }
});

test('labels are published only for raised départements', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    const publication = h.hostCalls.filter(([type]) => type === 'entries').pop();
    // One label per raised DÉPARTEMENT, not per polygon part.
    assert.equal(publication[2].length, 3);
    assert.ok(publication[2].every((entry) => /· (JAUNE|ORANGE|ROUGE)/.test(entry.title)));
    assert.deepEqual(publication[3], {
      cohortLimit: VIGILANCE_OVERLAY_COHORT_LIMIT,
      collisionCapacity: VIGILANCE_OVERLAY_COLLISION_CAPACITY,
      moving: false,
    });
  } finally {
    h.restore();
  }
});

test('an all-green bulletin paints and labels nothing, without erroring', async () => {
  const calm = {
    ...PAYLOAD,
    national: 1,
    periods: { J: { domains: { 35: { c: 1, p: [] }, 14: { c: 1, p: [] } } } },
  };
  const h = createHarness([calm]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    assert.equal(await h.layer.update(h.viewer), true);
    assert.equal(h.entities().filter((entity) => entity.show).length, 0);
    assert.deepEqual(h.hostCalls.filter(([type]) => type === 'entries').pop()[2], []);
    assert.equal(h.layer.getStats().count, 0);
    assert.equal(h.layer.getStats().assessed, 2);
    assert.equal(h.layer.getStats().error, null);
  } finally {
    h.restore();
  }
});

test('the polygons are loaded once, not once per bulletin', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    await h.layer.update(h.viewer);
    await h.layer.update(h.viewer);
    assert.equal(h.dataSources.length, 1, 'one data source for the whole session');
  } finally {
    h.restore();
  }
});

test('a de-escalation hides the département it painted', async () => {
  const calmer = {
    ...PAYLOAD,
    periods: { J: { domains: { 35: { c: 1, p: [] }, 14: { c: 2, p: [['3', 2]] } } } },
  };
  const h = createHarness([PAYLOAD, calmer]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    assert.equal(h.entities().filter((entity) => entity.show).length, 4);
    await h.layer.update(h.viewer);
    const shown = h.entities().filter((entity) => entity.show);
    // Both parts of 35 must go dark together when it de-escalates to vert.
    assert.deepEqual(shown.map((entity) => entity.properties.code.getValue()), ['14']);
  } finally {
    h.restore();
  }
});

test('an HTTP failure is reported without discarding the painted map', async () => {
  const h = createHarness([PAYLOAD, { status: 502 }]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    const painted = h.entities().filter((entity) => entity.show).length;
    assert.equal(await h.layer.update(h.viewer), false);
    assert.equal(h.layer.getStats().error, 'Vigilance HTTP 502');
    assert.equal(h.entities().filter((entity) => entity.show).length, painted);
  } finally {
    h.restore();
  }
});

test('a malformed bulletin is refused rather than painted as a calm France', async () => {
  for (const bad of [{}, { periods: {} }, { periods: { J: {} } }, { periods: { J1: { domains: {} } } }]) {
    const h = createHarness([bad]);
    try {
      h.layer.init(h.viewer);
      h.layer.enable(h.viewer);
      assert.equal(await h.layer.update(h.viewer), false);
      assert.equal(h.layer.getStats().error, 'Malformed vigilance response');
    } finally {
      h.restore();
    }
  }
});

test('a stale proxy response is painted but reported as stale', async () => {
  const h = createHarness([{ ...PAYLOAD, stale: true }]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    assert.equal(h.layer.getStats().stale, true);
    assert.equal(h.layer.getStats().count, 3);
  } finally {
    h.restore();
  }
});

test('a map-stack switch re-classifies every polygon exactly once', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    h.mapStackEventTarget.dispatchEvent(new CustomEvent('gev:map-stack-changed', {
      detail: { activeId: 'osm' },
    }));
    for (const entity of h.entities()) {
      assert.equal(
        entity.polygon.classificationType.getValue(),
        Cesium.ClassificationType.TERRAIN,
      );
    }
  } finally {
    h.restore();
  }
});

test('analyst records follow the enabled state, and destroy tears the layer down', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    assert.deepEqual(h.layer.getAnalystRecords(), []);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    assert.equal(h.layer.getAnalystRecords().length, 4, 'green départements are still reportable');
    assert.equal(h.layer.getAnalystRecords(1).length, 1);

    h.layer.disable(h.viewer);
    assert.deepEqual(h.layer.getAnalystRecords(), []);
    assert.deepEqual(h.hostCalls.slice(-2), [
      ['clear', 'meteofrance-vigilance'],
      ['visible', 'meteofrance-vigilance', false],
    ]);

    h.layer.destroy(h.viewer);
    assert.equal(h.dataSources.length, 0);
    // A post-destroy stack event must not throw against the torn-down layer.
    h.mapStackEventTarget.dispatchEvent(new CustomEvent('gev:map-stack-changed', {
      detail: { activeId: 'photoreal' },
    }));
  } finally {
    h.restore();
  }
});
