// src/data/franceEnergy.test.mjs
// Covers the éCO2mix LAYER: the région → département grouping, the inverted
// sign convention that decides who is painted which colour, Corsica's
// permanent exclusion, the border-arc direction, and the lifecycle. The
// upstream dataset shape is pinned separately in eco2mixFeed.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';
import {
  BALANCE_DEADBAND_MW,
  BALANCE_STYLES,
  BORDER_ANCHORS,
  ENERGY_OVERLAY_COHORT_LIMIT,
  ENERGY_OVERLAY_COLLISION_CAPACITY,
  REGION_DEPARTEMENTS,
  UNCOVERED_REGIONS,
  balanceLegend,
  balanceStyle,
  borderLabelText,
  buildBorderArcs,
  buildRegionRecords,
  createFranceEnergyLayer,
  departementRegionIndex,
  energyClassificationTypeForStack,
  formatMegawatts,
  greatCircleArc,
  mapAnalystRecord,
  regionAnchor,
  regionLabelText,
  selectEnergyOverlayCohort,
  summarizeNational,
} from './franceEnergy.js';
import { parseDepartements } from './meteoFranceVigilance.js';
import { projectEco2mix } from './eco2mixFeed.js';

const BUNDLED = JSON.parse(readFileSync(
  new URL('./local_data/france_departements/departements.geojson', import.meta.url),
  'utf8',
));
const PAYLOAD = projectEco2mix({
  national: JSON.parse(readFileSync(
    new URL('./fixtures/eco2mix-national-tr-sample.json', import.meta.url), 'utf8',
  )),
  regional: JSON.parse(readFileSync(
    new URL('./fixtures/eco2mix-regional-tr-sample.json', import.meta.url), 'utf8',
  )),
}, 'test');

// ── The grouping ────────────────────────────────────────────────────────────

test('the région grouping covers the 96 bundled départements exactly once', () => {
  // If this drifts, some département is painted by two régions or by none —
  // and "by none" is a silent hole, not a visible error.
  const grouped = Object.values(REGION_DEPARTEMENTS).flat();
  assert.equal(grouped.length, new Set(grouped).size, 'a département is listed twice');
  const bundled = BUNDLED.features.map((feature) => feature.properties.code).sort();
  assert.deepEqual(grouped.slice().sort(), bundled);
  assert.equal(bundled.length, 96);
});

test('the index resolves Corsica to a région that is declared uncovered', () => {
  const index = departementRegionIndex();
  assert.equal(index.size, 96);
  assert.equal(index.get('75'), '11');
  assert.equal(index.get('69'), '84');
  // Known, not missing — the distinction the header insists on.
  assert.equal(index.get('2A'), '94');
  assert.ok(UNCOVERED_REGIONS.includes('94'));
});

test('the 12 régions upstream are exactly the covered ones', () => {
  const covered = Object.keys(REGION_DEPARTEMENTS)
    .filter((code) => !UNCOVERED_REGIONS.includes(code)).sort();
  const upstream = PAYLOAD.regions.map((region) => region.code).sort();
  assert.deepEqual(upstream, covered);
});

// ── The sign convention ─────────────────────────────────────────────────────

test('POSITIVE netPhysical is an IMPORTER — the inverted convention', () => {
  // Upstream publishes consumption minus generation, so a positive number is a
  // deficit. Getting this backwards would colour the entire map wrong while
  // still looking plausible, which is why it is pinned here.
  assert.equal(balanceStyle(6478, 6851).style.key, 'importer');
  assert.equal(balanceStyle(-7781, 6448).style.key, 'exporter');
  assert.equal(BALANCE_STYLES.importer.verb, 'IMPORTE');
  assert.equal(BALANCE_STYLES.exporter.verb, 'EXPORTE');
});

test('a balance inside the deadband, or absent, is drawn as nothing', () => {
  assert.equal(balanceStyle(0, 5000), null);
  assert.equal(balanceStyle(BALANCE_DEADBAND_MW - 0.001, 5000), null);
  assert.equal(balanceStyle(null, 5000), null);
  assert.equal(balanceStyle(undefined, 5000), null);
  assert.equal(balanceStyle(Number.NaN, 5000), null);
  assert.ok(balanceStyle(BALANCE_DEADBAND_MW, 5000));
});

test('the fill alpha ramps on the ratio to LOAD, not on the field maximum', () => {
  // Normalising against the current maximum would repaint every région every
  // time one of them moved, and would make two snapshots incomparable.
  const small = balanceStyle(-100, 10_000);
  const large = balanceStyle(-7781, 6448);
  assert.ok(large.alpha > small.alpha);
  assert.ok(large.ratio > 1.2 && large.ratio < 1.25);
  // Saturation clamps rather than clipping to a flat country-wide colour.
  const absurd = balanceStyle(-100_000, 1000);
  assert.equal(absurd.alpha, balanceStyle(-1500, 1000).alpha);
  // A missing load must not produce NaN alpha.
  const noLoad = balanceStyle(-500, null);
  assert.equal(noLoad.ratio, 0);
  assert.ok(Number.isFinite(noLoad.alpha));
});

// ── The join ────────────────────────────────────────────────────────────────

test('buildRegionRecords whitelists on the grouping and drops Corsica', () => {
  const departements = parseDepartements(BUNDLED);
  const records = buildRegionRecords(PAYLOAD, departements);
  assert.equal(records.length, 12);
  const codes = records.map((record) => record.code);
  assert.ok(!codes.includes('94'));

  // A DOM région appearing upstream must not land on a metropolitan map.
  const withDom = buildRegionRecords({
    regions: [...PAYLOAD.regions, { code: '04', name: 'La Réunion', load: 400, netPhysical: 0 }],
  }, departements);
  assert.equal(withDom.length, 12);

  // Even if Corsica did appear upstream, it stays unpainted.
  const withCorse = buildRegionRecords({
    regions: [...PAYLOAD.regions, { code: '94', name: 'Corse', load: 300, netPhysical: -50 }],
  }, departements);
  assert.equal(withCorse.length, 12);
  assert.ok(!withCorse.some((record) => record.code === '94'));
});

test('records are ordered so the heaviest balance paints last', () => {
  const records = buildRegionRecords(PAYLOAD, parseDepartements(BUNDLED));
  const magnitudes = records.map((record) => Math.abs(record.netPhysical));
  assert.deepEqual(magnitudes, magnitudes.slice().sort((a, b) => a - b));
  assert.equal(records.at(-1).code, '84', 'Auvergne-Rhône-Alpes had the largest balance');
});

test('every région carries its full département list', () => {
  const records = buildRegionRecords(PAYLOAD, parseDepartements(BUNDLED));
  const idf = records.find((record) => record.code === '11');
  assert.deepEqual(idf.departements.slice().sort(), REGION_DEPARTEMENTS[11].slice().sort());
  assert.equal(idf.departements.length, 8);
});

test('the région label anchor lands inside its own région', () => {
  const departements = parseDepartements(BUNDLED);
  // Île-de-France is the tightest test: a mean that drifted would leave the
  // capital's label sitting in a neighbouring région.
  const idf = regionAnchor(REGION_DEPARTEMENTS[11], departements);
  assert.ok(idf[0] > 1.6 && idf[0] < 3.2, `IDF anchor lon ${idf[0]}`);
  assert.ok(idf[1] > 48.4 && idf[1] < 49.3, `IDF anchor lat ${idf[1]}`);
  // Bretagne sits well west; a swapped lon/lat would fail here loudly.
  const bretagne = regionAnchor(REGION_DEPARTEMENTS[53], departements);
  assert.ok(bretagne[0] < -1.5 && bretagne[1] > 47.5);
  assert.equal(regionAnchor(['zz'], departements), null);
  assert.equal(regionAnchor([], departements), null);
});

// ── The arcs ────────────────────────────────────────────────────────────────

test('the great-circle arc touches down exactly on both endpoints', () => {
  const from = [2.60, 46.60];
  const to = [-3.70, 40.42];
  const arc = greatCircleArc(from, to, { samples: 9 });
  assert.equal(arc.length, 27);
  assert.ok(Math.abs(arc[0] - from[0]) < 1e-6 && Math.abs(arc[1] - from[1]) < 1e-6);
  assert.equal(arc[2], 0, 'the arc starts on the ground');
  assert.ok(Math.abs(arc.at(-3) - to[0]) < 1e-6 && Math.abs(arc.at(-2) - to[1]) < 1e-6);
  assert.equal(Math.round(arc.at(-1)), 0, 'the arc lands on the ground');
  // Apex in the middle, and higher than every other sample.
  const heights = [];
  for (let i = 2; i < arc.length; i += 3) heights.push(arc[i]);
  assert.equal(heights.indexOf(Math.max(...heights)), (heights.length - 1) / 2);
});

test('the arc is a great circle, not a lon/lat lerp', () => {
  const arc = greatCircleArc([2.60, 46.60], [-3.70, 40.42], { samples: 3 });
  // The midpoint of a lon/lat lerp would be exactly (-0.55, 43.51); a real
  // great circle bows away from it.
  assert.ok(Math.abs(arc[3] - -0.55) > 0.05 || Math.abs(arc[4] - 43.51) > 0.05);
});

test('coincident endpoints degrade to a point instead of dividing by zero', () => {
  const arc = greatCircleArc([2.6, 46.6], [2.6, 46.6], { samples: 5 });
  for (let i = 0; i < arc.length; i += 3) {
    assert.ok(Number.isFinite(arc[i]) && Number.isFinite(arc[i + 1]) && Number.isFinite(arc[i + 2]));
    assert.ok(Math.abs(arc[i] - 2.6) < 1e-6);
  }
});

test('an import arc ends on France and an export arc starts there', () => {
  // The arrow head is at the END of the polyline, so this IS the direction the
  // user reads off the globe.
  const [imported] = buildBorderArcs([{ key: 'espagne', label: 'Espagne', mw: 500 }]);
  assert.equal(imported.importing, true);
  assert.equal(imported.style.key, 'importer');
  assert.ok(Math.abs(imported.positions[0] - BORDER_ANCHORS.espagne[0]) < 1e-6);
  assert.ok(Math.abs(imported.positions.at(-3) - BORDER_ANCHORS.france[0]) < 1e-6);

  const [exported] = buildBorderArcs([{ key: 'italie', label: 'Italie', mw: -2537 }]);
  assert.equal(exported.importing, false);
  assert.equal(exported.style.key, 'exporter');
  assert.ok(Math.abs(exported.positions[0] - BORDER_ANCHORS.france[0]) < 1e-6);
  assert.ok(Math.abs(exported.positions.at(-3) - BORDER_ANCHORS.italie[0]) < 1e-6);
});

test('a zero border is no arc at all, and an unknown border is dropped', () => {
  assert.deepEqual(buildBorderArcs([{ key: 'suisse', label: 'Suisse', mw: 0 }]), []);
  assert.deepEqual(buildBorderArcs([{ key: 'lune', label: 'Lune', mw: 900 }]), []);
  assert.deepEqual(buildBorderArcs([{ key: 'suisse', label: 'Suisse', mw: null }]), []);
  assert.deepEqual(buildBorderArcs(null), []);
});

test('arc width ramps with the flow and saturates', () => {
  const [thin] = buildBorderArcs([{ key: 'suisse', label: 'Suisse', mw: 50 }]);
  const [thick] = buildBorderArcs([{ key: 'suisse', label: 'Suisse', mw: 2900 }]);
  const [clamped] = buildBorderArcs([{ key: 'suisse', label: 'Suisse', mw: 25_000 }]);
  assert.ok(thick.width > thin.width);
  assert.ok(clamped.width >= thick.width && clamped.width <= 15);
});

test('the five real borders all resolve, Allemagne+Belgique as one arc', () => {
  const arcs = buildBorderArcs(PAYLOAD.national.exchanges);
  assert.equal(arcs.length, 5);
  const combined = arcs.find((arc) => arc.key === 'allemagne_belgique');
  assert.ok(combined);
  assert.match(borderLabelText(combined), /Allemagne \+ Belgique/);
});

// ── Presentation ────────────────────────────────────────────────────────────

test('labels carry the verb and the megawatts, never colour alone', () => {
  const records = buildRegionRecords(PAYLOAD, parseDepartements(BUNDLED));
  const idf = records.find((record) => record.code === '11');
  const text = regionLabelText(idf);
  assert.match(text, /Île-de-France/);
  assert.match(text, /IMPORTE/);
  assert.match(text, /MW$/);
  // No minus sign leaks into the figure: the verb carries the sign. (Checked
  // on the value alone — "Île-de-France" is full of hyphens.)
  const figure = text.split('·')[1];
  assert.ok(!figure.includes('-') && !figure.includes('\u2212'), figure);

  const [arc] = buildBorderArcs([{ key: 'italie', label: 'Italie', mw: -2537 }]);
  assert.equal(borderLabelText(arc), '2 537 MW vers Italie');
  const [inbound] = buildBorderArcs([{ key: 'suisse', label: 'Suisse', mw: 750 }]);
  assert.equal(borderLabelText(inbound), '750 MW depuis Suisse');
});

test('formatMegawatts is sign-free, grouped, and honest about absence', () => {
  assert.equal(formatMegawatts(6478), '6 478 MW');
  assert.equal(formatMegawatts(-6478), '6 478 MW');
  assert.equal(formatMegawatts(0), '0 MW');
  assert.equal(formatMegawatts(null), '— MW');
  assert.equal(formatMegawatts(Number.NaN), '— MW');
  // No exotic space codepoints survive into the label.
  assert.ok(!/[  ]/.test(formatMegawatts(1_234_567)));
});

test('border labels outrank régions in the collision cohort', () => {
  const records = buildRegionRecords(PAYLOAD, parseDepartements(BUNDLED));
  const arcs = buildBorderArcs(PAYLOAD.national.exchanges);
  const entries = [
    ...records.map((r) => ({ id: `r${r.code}`, priority: Math.abs(r.netPhysical) })),
    ...arcs.map((a) => ({ id: `b${a.key}`, priority: 1_000_000 + Math.abs(a.mw) })),
  ];
  const cohort = selectEnergyOverlayCohort(entries);
  assert.equal(cohort.length, Math.min(entries.length, ENERGY_OVERLAY_COHORT_LIMIT));
  assert.ok(cohort.slice(0, 5).every((entry) => entry.id.startsWith('b')));
  assert.deepEqual(selectEnergyOverlayCohort(entries, 0), []);
  assert.deepEqual(selectEnergyOverlayCohort(null), []);
});

test('the legend counts régions per side and omits an empty side', () => {
  const records = buildRegionRecords(PAYLOAD, parseDepartements(BUNDLED));
  const legend = balanceLegend(records);
  assert.equal(legend.length, 2);
  assert.equal(legend.reduce((sum, entry) => sum + entry.count, 0), 12);
  assert.deepEqual(balanceLegend([]), []);
  const onlyExporters = balanceLegend(records.filter((r) => r.balance.style.key === 'exporter'));
  assert.equal(onlyExporters.length, 1);
  assert.equal(onlyExporters[0].label, BALANCE_STYLES.exporter.label);
});

test('the low-carbon share is taken against GENERATION, not consumption', () => {
  // On an export hour, dividing by consumption reports a share above 100%.
  const summary = summarizeNational(PAYLOAD.national);
  assert.ok(summary.lowCarbonShare > 0 && summary.lowCarbonShare <= 100);
  assert.ok(PAYLOAD.national.generation > PAYLOAD.national.load, 'the captured hour was an export hour');
  const naive = (PAYLOAD.national.lowCarbon / PAYLOAD.national.load) * 100;
  assert.ok(naive > 100, 'the naive denominator really does overflow here');
  assert.equal(summary.topFiliere.key, 'nucleaire');

  const empty = summarizeNational(null);
  assert.equal(empty.lowCarbonShare, null);
  assert.equal(empty.topFiliere, null);
  assert.equal(summarizeNational({ generation: 0, lowCarbon: 0 }).lowCarbonShare, null);
});

test('the analyst record restates the balance in the direction a human asks it', () => {
  const records = buildRegionRecords(PAYLOAD, parseDepartements(BUNDLED));
  const aura = mapAnalystRecord(records.find((record) => record.code === '84'));
  // Upstream −7 781 (consumption minus generation) → "sent 7 781 MW out".
  assert.equal(aura.netExportMw, 7781);
  assert.equal(aura.balance, 'exporter');
  assert.equal(aura.name, 'Auvergne-Rhône-Alpes');
  assert.ok(Number.isFinite(aura.lat) && Number.isFinite(aura.lon));

  const idf = mapAnalystRecord(records.find((record) => record.code === '11'));
  assert.equal(idf.netExportMw, -6478);

  const blank = mapAnalystRecord(null, 3);
  assert.equal(blank.id, 'REGION-0003');
  for (const key of ['name', 'loadMw', 'netExportMw', 'lat', 'lon']) {
    assert.equal(blank[key], null, key);
  }
});

test('the fill classifies against the ACTIVE surface only', () => {
  assert.equal(
    energyClassificationTypeForStack('google-photorealistic'),
    Cesium.ClassificationType.CESIUM_3D_TILE,
  );
  assert.equal(energyClassificationTypeForStack('osm-globe'), Cesium.ClassificationType.TERRAIN);
  // An unknown stack falls back to BOTH rather than risking drawing nothing.
  assert.equal(energyClassificationTypeForStack(null), Cesium.ClassificationType.BOTH);
  assert.equal(energyClassificationTypeForStack(''), Cesium.ClassificationType.BOTH);
});

// ── Lifecycle ───────────────────────────────────────────────────────────────

/** Four real départements spanning three régions, one of them Corsican. */
const TEST_SHAPES = {
  type: 'FeatureCollection',
  features: ['75', '95', '69', '2A'].map((code, index) => {
    const square = (x, y, size) => [[
      [x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y],
    ]];
    return {
      type: 'Feature',
      properties: { code, nom: `Test ${code}` },
      geometry: code === '69'
        ? { type: 'MultiPolygon', coordinates: [square(index, 45, 0.8), square(index, 46.5, 0.2)] }
        : { type: 'Polygon', coordinates: square(index, 45, 0.8) },
    };
  }),
};

test('the harness fixture still spans three régions and a MultiPolygon', () => {
  const index = departementRegionIndex();
  const regions = new Set(TEST_SHAPES.features.map((f) => index.get(f.properties.code)));
  assert.deepEqual([...regions].sort(), ['11', '84', '94']);
  assert.equal(TEST_SHAPES.features.find((f) => f.geometry.type === 'MultiPolygon').properties.code, '69');
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
  const layer = createFranceEnergyLayer({
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

test('a région paints all of its départements, and Corsica stays dark', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    assert.equal(await h.layer.update(h.viewer), true);

    const painted = h.entities().filter((entity) => entity.polygon && entity.show);
    const codes = painted.map((entity) => entity.properties.code.getValue()).sort();
    // 69 is a MultiPolygon, so it contributes TWO entities — both must paint,
    // or an island shows clear while its mainland is coloured.
    assert.deepEqual(codes, ['69', '69', '75', '95']);
    assert.ok(!codes.includes('2A'), 'Corsica is never painted');

    // Both Île-de-France départements share ONE material: they are one
    // measurement, not two.
    const idf = painted.filter((entity) => ['75', '95'].includes(entity.properties.code.getValue()));
    assert.equal(idf[0].polygon.material, idf[1].polygon.material);
    assert.equal(idf[0].polygon.outline.getValue(), false, 'polygon outlines are expensive');

    // Île-de-France imports → amber; Auvergne-Rhône-Alpes exports → teal.
    const colorOf = (code) => painted
      .find((entity) => entity.properties.code.getValue() === code)
      .polygon.material.color.getValue();
    const amber = Cesium.Color.fromCssColorString(BALANCE_STYLES.importer.color);
    const teal = Cesium.Color.fromCssColorString(BALANCE_STYLES.exporter.color);
    assert.ok(colorOf('75').red === amber.red && colorOf('75').green === amber.green);
    assert.ok(colorOf('69').red === teal.red && colorOf('69').green === teal.green);
  } finally {
    h.restore();
  }
});

test('the five border arcs are drawn as raised polylines', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);

    const arcs = h.entities().filter((entity) => entity.polyline);
    assert.equal(arcs.length, 5);
    for (const arc of arcs) {
      assert.ok(arc.show);
      assert.equal(arc.polyline.arcType.getValue(), Cesium.ArcType.NONE);
      assert.ok(arc.polyline.material instanceof Cesium.PolylineArrowMaterialProperty);
      assert.ok(arc.polyline.positions.getValue().length > 2);
    }
  } finally {
    h.restore();
  }
});

test('a border that falls to zero hides its arc rather than drawing a hairline', async () => {
  const zeroed = {
    ...PAYLOAD,
    national: {
      ...PAYLOAD.national,
      exchanges: PAYLOAD.national.exchanges.map((entry) => (
        entry.key === 'suisse' ? { ...entry, mw: 0 } : entry
      )),
    },
  };
  const h = createHarness([PAYLOAD, zeroed]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    assert.equal(h.entities().filter((e) => e.polyline && e.show).length, 5);

    await h.layer.update(h.viewer);
    const shown = h.entities().filter((e) => e.polyline && e.show);
    assert.equal(shown.length, 4);
    // The entity is kept and hidden, not destroyed — the next refresh reuses it.
    assert.equal(h.entities().filter((e) => e.polyline).length, 5);
    assert.equal(h.layer.getStats().borders, 4);
  } finally {
    h.restore();
  }
});

test('an unchanged snapshot does not republish the overlay', async () => {
  const h = createHarness([PAYLOAD, PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    const after = h.hostCalls.filter((call) => call[0] === 'entries').length;
    await h.layer.update(h.viewer);
    assert.equal(h.hostCalls.filter((call) => call[0] === 'entries').length, after);
  } finally {
    h.restore();
  }
});

test('the overlay publishes one entry per painted région plus one per arc', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);

    const [, sourceId, entries, options] = h.hostCalls.findLast((call) => call[0] === 'entries');
    assert.equal(sourceId, 'france-energy');
    assert.equal(options.cohortLimit, ENERGY_OVERLAY_COHORT_LIMIT);
    assert.equal(options.collisionCapacity, ENERGY_OVERLAY_COLLISION_CAPACITY);
    assert.equal(options.moving, false);
    // 12 régions (all have an anchor from the real bundled shapes? no — the
    // harness only bundles four départements, so only the régions whose
    // départements are present get an anchor) + 5 borders.
    const borders = entries.filter((entry) => entry.id.startsWith('energy-fr:border:'));
    const regions = entries.filter((entry) => entry.id.startsWith('energy-fr:region:'));
    assert.equal(borders.length, 5);
    assert.equal(regions.length, 2, 'only IDF and AURA have shapes in the harness');
    for (const entry of entries) assert.equal(entry.interactive, false);
  } finally {
    h.restore();
  }
});

test('an HTTP error keeps the last good paint instead of blanking the map', async () => {
  const h = createHarness([PAYLOAD, { status: 503 }]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    const before = h.entities().filter((entity) => entity.show).length;

    assert.equal(await h.layer.update(h.viewer), false);
    assert.equal(h.entities().filter((entity) => entity.show).length, before);
    assert.match(h.layer.getStats().error, /503/);
  } finally {
    h.restore();
  }
});

test('a thrown fetch is reported, not swallowed as an empty grid', async () => {
  const h = createHarness([new Error('offline')]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    assert.equal(await h.layer.update(h.viewer), false);
    assert.equal(h.layer.getStats().error, 'éCO2mix network error');
    assert.equal(h.layer.getStats().count, 0);
  } finally {
    h.restore();
  }
});

test('getStats restates the national balance as an EXPORT figure', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);

    const stats = h.layer.getStats();
    assert.equal(stats.count, 12);
    assert.equal(stats.netExportMw, -PAYLOAD.national.netPhysical);
    assert.ok(stats.netExportMw > 0, 'France was exporting on the captured snapshot');
    // Physical and commercial are reported under distinct names because they
    // are different numbers — see the module header.
    assert.notEqual(stats.netExportMw, stats.netCommercialExportMw);
    assert.equal(stats.co2gPerKwh, PAYLOAD.national.co2);
    assert.equal(stats.topFiliere, 'Nucléaire');
    assert.equal(stats.updateTime, PAYLOAD.national.at);
    assert.equal(stats.feedSource, 'test');
    assert.equal(stats.borders, 5);
  } finally {
    h.restore();
  }
});

test('analyst records are gated on the layer being enabled', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    assert.equal(h.layer.getAnalystRecords().length, 12);
    assert.equal(h.layer.getAnalystRecords(3).length, 3);

    h.layer.disable(h.viewer);
    assert.deepEqual(h.layer.getAnalystRecords(), []);
  } finally {
    h.restore();
  }
});

test('the map-stack event reclassifies the fills in place', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);

    h.mapStackEventTarget.dispatchEvent(new CustomEvent('gev:map-stack-changed', {
      detail: { activeId: 'google-photorealistic' },
    }));
    for (const entity of h.entities()) {
      if (!entity.polygon) continue;
      assert.equal(
        entity.polygon.classificationType.getValue(),
        Cesium.ClassificationType.CESIUM_3D_TILE,
      );
    }
  } finally {
    h.restore();
  }
});

test('destroy releases the data source, the overlay, and the listener', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    assert.equal(h.dataSources.length, 1);

    h.layer.destroy(h.viewer);
    assert.equal(h.dataSources.length, 0);
    assert.ok(h.hostCalls.some((call) => call[0] === 'clear' && call[1] === 'france-energy'));
    assert.equal(h.layer.getStats().count, 0);
    assert.equal(h.layer.getStats().borders, 0);
    // The listener is gone: a later stack change must not touch a dead layer.
    h.mapStackEventTarget.dispatchEvent(new CustomEvent('gev:map-stack-changed', {
      detail: { activeId: 'osm-globe' },
    }));
  } finally {
    h.restore();
  }
});
