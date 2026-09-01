// src/data/vigicrues.test.mjs
// Covers the Vigicrues LAYER: how it joins the proxy's geometry and level
// documents, its label policy, the static-geometry rule clamped ground
// polylines must obey, and its lifecycle. The upstream feed shape itself is
// pinned separately in vigicruesFeed.test.mjs.
//
// The proxy payloads used here are produced by running the REAL projection
// over the REAL captured upstream response, so a drift in either the feed or
// the projection surfaces here too rather than being mocked away.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';
import {
  VIGICRUES_ALERT_LEVEL,
  VIGICRUES_LEVELS,
  VIGICRUES_OVERLAY_COHORT_LIMIT,
  VIGICRUES_OVERLAY_COLLISION_CAPACITY,
  VIGICRUES_UNKNOWN_LEVEL,
  buildVigicruesRecords,
  createVigicruesLayer,
  createVigicruesOverlayEntry,
  mapAnalystRecord,
  parseVigicruesPublication,
  selectVigicruesOverlayCohort,
  summarizeVigicruesRecords,
  vigicruesClassificationTypeForScene,
  vigicruesClassificationTypeForStack,
  vigicruesLabelAnchor,
  vigicruesLevel,
  vigicruesLevelLegend,
  vigicruesStateSignature,
  vigicruesTimestampMs,
} from './vigicrues.js';
import { projectVigicruesFeed } from './vigicruesFeed.js';

const UPSTREAM = JSON.parse(readFileSync(
  new URL('./fixtures/vigicrues-infovigicru-sample.geojson', import.meta.url),
  'utf8',
));

/**
 * Run the real projection over the captured upstream response, optionally
 * forcing each reach to a level, and split the result the way the proxy does.
 * @param {Array<number|null>} [levels] Per-feature `NivInfViCr` overrides.
 * @returns {{levelsDoc: object, geometryDoc: object, projected: object}}
 */
function proxyDocuments(levels = []) {
  const clone = JSON.parse(JSON.stringify(UPSTREAM));
  levels.forEach((level, index) => {
    if (clone.features[index]) clone.features[index].properties.NivInfViCr = level;
  });
  const projected = projectVigicruesFeed(clone);
  return {
    projected,
    levelsDoc: {
      fetchedAt: 1_787_731_034_120,
      stale: false,
      ttlMs: 600_000,
      updateTime: projected.updateTime,
      reference: projected.reference,
      geometryVersion: projected.geometryVersion,
      levels: projected.levels,
    },
    geometryDoc: {
      geometryVersion: projected.geometryVersion,
      reaches: projected.reaches,
    },
  };
}

const CALM = proxyDocuments([1, 1, 1]);
const REACH_IDS = CALM.projected.reaches.map((reach) => reach.id);

// ── Level vocabulary ────────────────────────────────────────────────────────

test('the four level colours are the ones Vigicrues itself publishes', () => {
  // Read verbatim from the service's own legend swatches
  // (vigicrues.gouv.fr /assets/images/.../rect-{green,yellow,orange,red}.svg).
  // Licence Ouverte 2.0 forbids distorting the meaning of the information, and
  // recolouring a public-safety signal is exactly that — these are not a
  // designer's choice.
  assert.equal(VIGICRUES_LEVELS[1].color, '#009245');
  assert.equal(VIGICRUES_LEVELS[2].color, '#fcff19');
  assert.equal(VIGICRUES_LEVELS[3].color, '#ee5e2e');
  assert.equal(VIGICRUES_LEVELS[4].color, '#ff0000');
  // Severity must be monotonic in stroke weight as well as hue.
  const widths = [1, 2, 3, 4].map((level) => VIGICRUES_LEVELS[level].width);
  assert.deepEqual(widths, [...widths].sort((a, b) => a - b));
});

test('every level draws wide enough, and opaque enough, to reach the screen', () => {
  // The four hues cannot move — Licence Ouverte 2.0, see the module header — so
  // width and alpha are the only levers, and a level that is thin AND faint is
  // a level nobody sees. 2 px is the floor because a thinner stroke under this
  // scene's `msaaSamples: 4` plus FXAA is largely edge-blend, and its own
  // colour stops reaching the canvas — the effect the gas layer measured.
  const levels = [...Object.values(VIGICRUES_LEVELS), VIGICRUES_UNKNOWN_LEVEL];
  for (const level of levels) {
    assert.ok(level.width >= 2, `${level.key} is ${level.width}px`);
    assert.ok(level.alpha >= 0.7, `${level.key} draws at ${level.alpha}`);
  }
  // Not published must never out-shout published-as-calm.
  assert.ok(VIGICRUES_UNKNOWN_LEVEL.width < VIGICRUES_LEVELS[1].width);
  assert.ok(VIGICRUES_UNKNOWN_LEVEL.alpha < VIGICRUES_LEVELS[1].alpha);
  // And the step into "something is happening" is the widest on the ladder.
  const steps = [
    VIGICRUES_LEVELS[2].width - VIGICRUES_LEVELS[1].width,
    VIGICRUES_LEVELS[3].width - VIGICRUES_LEVELS[2].width,
    VIGICRUES_LEVELS[4].width - VIGICRUES_LEVELS[3].width,
  ];
  assert.equal(steps[0], Math.max(...steps), 'green→yellow must be the loudest step');
});

test('the alert threshold is yellow — the first level that means "something is happening"', () => {
  assert.equal(VIGICRUES_ALERT_LEVEL, 2);
  assert.equal(VIGICRUES_LEVELS[VIGICRUES_ALERT_LEVEL].key, 'yellow');
});

test('vigicruesLevel resolves 1..4 and refuses to invent green for anything else', () => {
  assert.equal(vigicruesLevel(1), VIGICRUES_LEVELS[1]);
  assert.equal(vigicruesLevel(4), VIGICRUES_LEVELS[4]);
  // The level survives the proxy as a number, but a numeric string must not
  // become UNKNOWN if the projection ever passes one through.
  assert.equal(vigicruesLevel('3'), VIGICRUES_LEVELS[3]);
  for (const bad of [null, undefined, 0, 5, -1, 2.5, '', 'vert', {}, []]) {
    assert.equal(vigicruesLevel(bad), VIGICRUES_UNKNOWN_LEVEL, `${JSON.stringify(bad)} must be UNKNOWN`);
  }
});

test('vigicruesTimestampMs parses the reach stamp and nulls anything malformed', () => {
  assert.equal(vigicruesTimestampMs('2020/09/15 09:00:00.000'), Date.UTC(2020, 8, 15, 9, 0, 0));
  assert.equal(vigicruesTimestampMs('2026/08/26T07:30:00'), Date.UTC(2026, 7, 26, 7, 30, 0));
  for (const bad of [null, undefined, '', '  ', 'hier', '15/09/2020 09:00:00']) {
    assert.equal(vigicruesTimestampMs(bad), null, `${JSON.stringify(bad)} must be null`);
  }
});

test('the publication stamp the licence obliges us to show is read from the level document', () => {
  const publication = parseVigicruesPublication(CALM.levelsDoc);
  assert.equal(publication.reference, '25082026_16');
  assert.equal(publication.publishedAtMs, Date.parse('2026-08-25T13:55:59+00:00'));
  assert.deepEqual(parseVigicruesPublication({}), { publishedAtMs: null, reference: null });
  assert.deepEqual(parseVigicruesPublication(null), { publishedAtMs: null, reference: null });
  assert.equal(parseVigicruesPublication({ updateTime: 'jamais' }).publishedAtMs, null);
});

// ── Joining geometry to levels ──────────────────────────────────────────────

test('records join the cached geometry to the polled levels', () => {
  const records = buildVigicruesRecords(CALM.geometryDoc.reaches, CALM.levelsDoc.levels);
  assert.equal(records.length, 3);
  const golo = records.find((record) => record.id === 'CO1');
  assert.equal(golo.name, 'Golo aval');
  assert.equal(golo.level, VIGICRUES_LEVELS[1]);
  assert.equal(golo.updatedAtMs, Date.UTC(2020, 8, 15, 9, 0, 0));
  assert.ok(Array.isArray(golo.parts) && golo.parts.length >= 1);
});

test('raised reaches are ordered last so their strokes win the depth tie', () => {
  const raised = proxyDocuments([4, 1, 2]);
  const records = buildVigicruesRecords(raised.geometryDoc.reaches, raised.levelsDoc.levels);
  assert.deepEqual(records.map((record) => record.level.level), [1, 2, 4]);
});

test('a reach the level document does not mention is UNKNOWN, never green', () => {
  const records = buildVigicruesRecords(CALM.geometryDoc.reaches, {});
  assert.deepEqual(records.map((record) => record.level), [
    VIGICRUES_UNKNOWN_LEVEL, VIGICRUES_UNKNOWN_LEVEL, VIGICRUES_UNKNOWN_LEVEL,
  ]);
  assert.deepEqual(buildVigicruesRecords(CALM.geometryDoc.reaches, null)
    .map((record) => record.level.key), ['unknown', 'unknown', 'unknown']);
});

test('reaches with no id or no drawable parts are dropped', () => {
  const records = buildVigicruesRecords([
    { id: '', name: 'nameless', parts: [[[1, 2], [3, 4]]] },
    { id: 'E1', name: 'empty', parts: [] },
    { id: 'N1', name: 'no parts' },
    { id: 'OK', name: 'fine', parts: [[[1, 2], [3, 4]]] },
  ], { OK: 2 });
  assert.deepEqual(records.map((record) => record.id), ['OK']);
  assert.deepEqual(buildVigicruesRecords(null, {}), []);
});

test('summary counts every level and the alert total', () => {
  const mixed = proxyDocuments([3, 1, null]);
  const summary = summarizeVigicruesRecords(
    buildVigicruesRecords(mixed.geometryDoc.reaches, mixed.levelsDoc.levels),
  );
  assert.equal(summary.total, 3);
  assert.equal(summary.alerts, 1);
  assert.equal(summary.byKey.orange, 1);
  assert.equal(summary.byKey.green, 1);
  assert.equal(summary.byKey.unknown, 1);
  assert.deepEqual(summarizeVigicruesRecords(null), {
    total: 0,
    alerts: 0,
    byKey: { green: 0, yellow: 0, orange: 0, red: 0, unknown: 0 },
  });
});

test('an UNKNOWN reach is never counted as an alert nor as green', () => {
  const unknown = proxyDocuments([null, null, null]);
  const summary = summarizeVigicruesRecords(
    buildVigicruesRecords(unknown.geometryDoc.reaches, unknown.levelsDoc.levels),
  );
  assert.equal(summary.byKey.unknown, 3);
  assert.equal(summary.byKey.green, 0);
  assert.equal(summary.alerts, 0);
});

test('state signature changes only when a level moves', () => {
  const records = (levels) => {
    const docs = proxyDocuments(levels);
    return buildVigicruesRecords(docs.geometryDoc.reaches, docs.levelsDoc.levels);
  };
  assert.equal(
    vigicruesStateSignature(records([1, 1, 1])),
    vigicruesStateSignature(records([1, 1, 1])),
  );
  assert.notEqual(
    vigicruesStateSignature(records([1, 1, 1])),
    vigicruesStateSignature(records([1, 3, 1])),
  );
  assert.equal(vigicruesStateSignature([]), '0');
  assert.equal(vigicruesStateSignature(null), '0');
});

test('the row legend lists non-empty levels, most severe first', () => {
  assert.deepEqual(
    vigicruesLevelLegend({ green: 300, yellow: 27, orange: 10, red: 0, unknown: 0 })
      .map((entry) => [entry.label, entry.count]),
    [['ORANGE', 10], ['JAUNE', 27], ['VERT', 300]],
  );
  // A calm day still reports the monitored network rather than an empty row.
  assert.deepEqual(
    vigicruesLevelLegend({ green: 337, yellow: 0, orange: 0, red: 0, unknown: 0 })
      .map((entry) => entry.label),
    ['VERT'],
  );
  assert.deepEqual(vigicruesLevelLegend({ unknown: 4 }).map((entry) => entry.label), ['INCONNU']);
  assert.deepEqual(vigicruesLevelLegend(null), []);
  for (const entry of vigicruesLevelLegend({ green: 1, yellow: 1, orange: 1, red: 1 })) {
    assert.match(entry.color, /^#[0-9a-f]{6}$/);
    assert.ok(entry.blurb.length > 0, 'each swatch carries the level meaning');
  }
});

// ── Label policy ────────────────────────────────────────────────────────────

test('label anchor is the midpoint vertex of the longest part', () => {
  assert.deepEqual(vigicruesLabelAnchor([[[0, 0], [1, 1]], [[5, 5], [6, 6], [7, 7]]]), [6, 6]);
  assert.equal(vigicruesLabelAnchor([]), null);
  assert.equal(vigicruesLabelAnchor(null), null);
  assert.equal(vigicruesLabelAnchor([[['x', 'y'], ['x', 'y']]]), null);
});

test('overlay entry carries the level accent and a severity-ranked priority', () => {
  const position = Cesium.Cartesian3.fromDegrees(2.35, 48.85);
  const entry = createVigicruesOverlayEntry({
    id: 'SO12',
    position,
    title: 'La Seine · ORANGE',
    level: VIGICRUES_LEVELS[3],
  });
  assert.equal(entry.title, 'La Seine · ORANGE');
  assert.equal(entry.accent, VIGICRUES_LEVELS[3].color);
  assert.equal(entry.priority, 3000);
  assert.equal(entry.variant, 'label');
  assert.equal(entry.paintLane, 'ambient-label');
  assert.equal(entry.collisionGroup, 'ambient-label');
  assert.equal(entry.interactive, false);
  assert.equal(entry.horizonCull, true);
  assert.equal(entry.position, position);
});

test('overlay cohort keeps the most severe reaches and honours the cap', () => {
  const entries = [
    { id: 'b', priority: 2000 },
    { id: 'a', priority: 4000 },
    { id: 'c', priority: 2000 },
    { id: 'd', priority: 3000 },
  ];
  assert.deepEqual(selectVigicruesOverlayCohort(entries).map((e) => e.id), ['a', 'd', 'b', 'c']);
  assert.deepEqual(selectVigicruesOverlayCohort(entries, 2).map((e) => e.id), ['a', 'd']);
  assert.deepEqual(selectVigicruesOverlayCohort(entries, 0), []);
  assert.deepEqual(selectVigicruesOverlayCohort(null), []);
  assert.equal(
    selectVigicruesOverlayCohort(
      Array.from({ length: 500 }, (_, i) => ({ id: `x${i}`, priority: i })),
      1000,
    ).length,
    VIGICRUES_OVERLAY_COHORT_LIMIT,
  );
});

// ── Analyst seam ────────────────────────────────────────────────────────────

test('analyst record is JSON-safe with nulls, never NaN or undefined', () => {
  const records = buildVigicruesRecords(CALM.geometryDoc.reaches, CALM.levelsDoc.levels);
  const record = mapAnalystRecord(records[0], 0);
  assert.deepEqual(JSON.parse(JSON.stringify(record)), record);
  assert.ok(Number.isFinite(record.lat) && Number.isFinite(record.lon));
  const empty = mapAnalystRecord(undefined, 2);
  assert.equal(empty.id, 'TRONCON-0002');
  for (const [key, value] of Object.entries(empty)) {
    assert.notEqual(value, undefined, `${key} must not be undefined`);
    if (typeof value === 'number') assert.ok(Number.isFinite(value), `${key} must not be NaN`);
  }
});

// ── Surface classification ──────────────────────────────────────────────────

test('classification follows the active surface and falls back to BOTH when unknown', () => {
  assert.equal(vigicruesClassificationTypeForStack('photoreal'), Cesium.ClassificationType.CESIUM_3D_TILE);
  assert.equal(vigicruesClassificationTypeForStack('osm'), Cesium.ClassificationType.TERRAIN);
  assert.equal(vigicruesClassificationTypeForStack('bing-aerial'), Cesium.ClassificationType.TERRAIN);
  assert.equal(vigicruesClassificationTypeForStack('some-future-stack'), Cesium.ClassificationType.BOTH);
  assert.equal(vigicruesClassificationTypeForStack(null), Cesium.ClassificationType.BOTH);

  assert.equal(vigicruesClassificationTypeForScene(null), Cesium.ClassificationType.BOTH);
  assert.equal(vigicruesClassificationTypeForScene({}), Cesium.ClassificationType.BOTH);
  assert.equal(
    vigicruesClassificationTypeForScene({ globe: { show: false } }),
    Cesium.ClassificationType.CESIUM_3D_TILE,
  );
  assert.equal(
    vigicruesClassificationTypeForScene({ globe: { show: true } }),
    Cesium.ClassificationType.TERRAIN,
  );
});

// ── Lifecycle ───────────────────────────────────────────────────────────────

/**
 * @param {Array<object>} polls Level documents (or {status}) served in order;
 *   the last one repeats. Geometry is served from `geometry`.
 */
function createHarness(polls, geometry = CALM.geometryDoc) {
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
      add(dataSource) { dataSources.push(dataSource); return dataSource; },
      remove(dataSource) {
        const index = dataSources.indexOf(dataSource);
        if (index >= 0) dataSources.splice(index, 1);
        return index >= 0;
      },
    },
  };
  const originalFetch = globalThis.fetch;
  const respond = (payload) => {
    if (payload instanceof Error) throw payload;
    if (typeof payload?.status === 'number') return { ok: false, status: payload.status };
    return { ok: true, status: 200, json: async () => payload };
  };
  globalThis.fetch = async (url) => {
    const text = String(url);
    fetchUrls.push(text);
    if (text.endsWith('/geometry')) return respond(geometry);
    return respond(polls[Math.min(poll++, polls.length - 1)]);
  };
  const mapStackEventTarget = new EventTarget();
  const layer = createVigicruesLayer({ overlayHost, mapStackEventTarget });
  return {
    layer,
    viewer,
    dataSources,
    hostCalls,
    fetchUrls,
    mapStackEventTarget,
    geometryFetches: () => fetchUrls.filter((url) => url.endsWith('/geometry')).length,
    restore() { globalThis.fetch = originalFetch; },
  };
}

test('lifecycle draws static clamped polylines and labels only the raised reaches', async () => {
  const raised = proxyDocuments([1, 3, 1]);
  const h = createHarness([raised.levelsDoc], raised.geometryDoc);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    assert.equal(await h.layer.update(h.viewer), true);

    const entities = h.dataSources[0].entities.values;
    assert.ok(entities.length >= 3, 'every reach part gets an entity');
    for (const entity of entities) {
      assert.ok(entity.polyline, 'reaches are polylines');
      // Static geometry: a CallbackProperty here re-tessellates the clamped
      // ground primitive on every frame — the earthquake-layer lesson.
      assert.ok(!(entity.polyline.positions instanceof Cesium.CallbackProperty));
      assert.ok(!(entity.polyline.width instanceof Cesium.CallbackProperty));
      assert.ok(!(entity.polyline.material instanceof Cesium.CallbackProperty));
      assert.equal(entity.polyline.clampToGround.getValue(), true);
      assert.equal(entity.label, undefined, 'labels live in the shared overlay host');
    }

    // One shared material instance per level, not one per reach.
    const materials = new Set(entities.map((entity) => entity.polyline.material));
    const levels = new Set(entities.map((entity) => entity.properties.level.getValue()));
    assert.equal(materials.size, levels.size, 'materials are shared per level');

    const publication = h.hostCalls.filter(([type]) => type === 'entries').pop();
    assert.ok(publication, 'the update must publish the overlay source');
    assert.equal(publication[2].length, 1, 'only the ORANGE reach is labelled');
    assert.match(publication[2][0].title, /ORANGE$/);
    assert.deepEqual(publication[3], {
      cohortLimit: VIGICRUES_OVERLAY_COHORT_LIMIT,
      collisionCapacity: VIGICRUES_OVERLAY_COLLISION_CAPACITY,
      moving: false,
    });

    const stats = h.layer.getStats();
    assert.equal(stats.count, 3);
    assert.equal(stats.alerts, 1);
    assert.equal(stats.error, null);
    assert.equal(stats.stale, false);
    assert.equal(stats.reference, '25082026_16');
    assert.equal(stats.publishedAt, Date.parse('2026-08-25T13:55:59+00:00'));
    assert.ok(Number.isFinite(stats.lastUpdate));

    const controls = h.layer.getRowControls();
    assert.deepEqual(controls.chips, []);
    assert.deepEqual(controls.legend.map((entry) => [entry.label, entry.count]),
      [['ORANGE', 1], ['VERT', 2]]);
  } finally {
    h.restore();
  }
});

test('a calm France publishes no labels but still draws and reports the network', async () => {
  const h = createHarness([CALM.levelsDoc]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    const publication = h.hostCalls.filter(([type]) => type === 'entries').pop();
    assert.deepEqual(publication[2], [], 'green reaches carry no ambient label');
    assert.ok(h.dataSources[0].entities.values.length >= 3, 'the reach network is still drawn');
    assert.equal(h.layer.getStats().alerts, 0);
    assert.equal(h.layer.getStats().count, 3);
  } finally {
    h.restore();
  }
});

test('the 1.1 MB geometry document is fetched once, not once per poll', async () => {
  const raised = proxyDocuments([1, 4, 1]);
  const h = createHarness([CALM.levelsDoc, CALM.levelsDoc, raised.levelsDoc]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    assert.equal(h.geometryFetches(), 1);
    await h.layer.update(h.viewer);
    await h.layer.update(h.viewer);
    // Same geometryVersion across all three polls — colours moved, shape did not.
    assert.equal(h.geometryFetches(), 1, 'an unchanged geometryVersion must reuse the cache');
    assert.equal(h.layer.getStats().alerts, 1);
  } finally {
    h.restore();
  }
});

test('a redrawn reach network re-fetches the geometry', async () => {
  const h = createHarness([
    CALM.levelsDoc,
    { ...CALM.levelsDoc, geometryVersion: 'a-different-shape' },
  ]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    assert.equal(h.geometryFetches(), 1);
    await h.layer.update(h.viewer);
    assert.equal(h.geometryFetches(), 2, 'a moved geometryVersion must invalidate the cache');
  } finally {
    h.restore();
  }
});

test('an unchanged poll does not rebuild the clamped ground geometry', async () => {
  const raised = proxyDocuments([1, 4, 1]);
  const h = createHarness([CALM.levelsDoc, CALM.levelsDoc, raised.levelsDoc]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    const first = h.dataSources[0].entities.values[0];
    await h.layer.update(h.viewer);
    assert.equal(h.dataSources[0].entities.values[0], first, 'identical levels must reuse the entities');
    await h.layer.update(h.viewer);
    assert.notEqual(h.dataSources[0].entities.values[0], first, 'a level change rebuilds');
  } finally {
    h.restore();
  }
});

test('a stale proxy response is drawn but reported as stale', async () => {
  const h = createHarness([{ ...CALM.levelsDoc, stale: true }]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    assert.equal(await h.layer.update(h.viewer), true);
    assert.equal(h.layer.getStats().stale, true);
    assert.equal(h.layer.getStats().count, 3);
  } finally {
    h.restore();
  }
});

test('an HTTP failure is reported without discarding the drawn network', async () => {
  const raised = proxyDocuments([1, 2, 1]);
  const h = createHarness([raised.levelsDoc, { status: 503 }]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    const drawn = h.dataSources[0].entities.values.length;
    assert.equal(await h.layer.update(h.viewer), false);
    assert.equal(h.layer.getStats().error, 'Vigicrues HTTP 503');
    assert.equal(h.dataSources[0].entities.values.length, drawn, 'a failed poll keeps the last good map');
  } finally {
    h.restore();
  }
});

test('a malformed level document is refused rather than drawn as an empty France', async () => {
  for (const bad of [{}, { geometryVersion: 'abc' }, { levels: {} }, { geometryVersion: 'abc', levels: 'nope' }]) {
    const h = createHarness([bad]);
    try {
      h.layer.init(h.viewer);
      h.layer.enable(h.viewer);
      assert.equal(await h.layer.update(h.viewer), false);
      assert.equal(h.layer.getStats().error, 'Malformed Vigicrues response');
      assert.equal(h.dataSources[0].entities.values.length, 0);
    } finally {
      h.restore();
    }
  }
});

test('a malformed geometry document is refused too', async () => {
  const h = createHarness([CALM.levelsDoc], { geometryVersion: 'x', reaches: 'nope' });
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    assert.equal(await h.layer.update(h.viewer), false);
    assert.equal(h.layer.getStats().error, 'Malformed Vigicrues geometry');
  } finally {
    h.restore();
  }
});

test('a map-stack switch re-classifies every reach exactly once, never per frame', async () => {
  const raised = proxyDocuments([1, 2, 1]);
  const h = createHarness([raised.levelsDoc], raised.geometryDoc);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    const entities = h.dataSources[0].entities.values;
    assert.ok(entities.every((e) => e.polyline.classificationType.getValue()
      === Cesium.ClassificationType.CESIUM_3D_TILE));

    h.mapStackEventTarget.dispatchEvent(new CustomEvent('gev:map-stack-changed', {
      detail: { activeId: 'osm' },
    }));
    assert.ok(entities.every((e) => e.polyline.classificationType.getValue()
      === Cesium.ClassificationType.TERRAIN));
  } finally {
    h.restore();
  }
});

test('analyst records are empty while the layer is off and populated while it is on', async () => {
  const raised = proxyDocuments([1, 2, 4]);
  const h = createHarness([raised.levelsDoc], raised.geometryDoc);
  try {
    h.layer.init(h.viewer);
    assert.deepEqual(h.layer.getAnalystRecords(), []);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    const records = h.layer.getAnalystRecords();
    assert.equal(records.length, 3);
    assert.deepEqual(records.map((r) => r.level), [1, 2, 4]);
    assert.deepEqual(records.map((r) => r.id).sort(), [...REACH_IDS].sort());
    assert.equal(h.layer.getAnalystRecords(1).length, 1);
    h.layer.disable(h.viewer);
    assert.deepEqual(h.layer.getAnalystRecords(), []);
  } finally {
    h.restore();
  }
});

test('destroy removes the data source, the overlay source, and the stack listener', async () => {
  const raised = proxyDocuments([1, 2, 1]);
  const h = createHarness([raised.levelsDoc], raised.geometryDoc);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    h.layer.destroy(h.viewer);
    assert.equal(h.dataSources.length, 0);
    assert.deepEqual(h.hostCalls.slice(-2), [
      ['clear', 'vigicrues'],
      ['visible', 'vigicrues', false],
    ]);
    // A post-destroy stack event must not throw against the torn-down layer.
    h.mapStackEventTarget.dispatchEvent(new CustomEvent('gev:map-stack-changed', {
      detail: { activeId: 'photoreal' },
    }));
  } finally {
    h.restore();
  }
});
