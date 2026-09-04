// src/data/franceEnergy.test.mjs
// Covers the éCO2mix LAYER: the région → département grouping, the inverted
// sign convention that decides which way a prism is coloured, the frozen
// height domain, the three marks A1 requires (prism / flat zero / striped
// absence), Corsica's permanent exclusion, the border-arc direction, and the
// lifecycle. The upstream dataset shape is pinned separately in
// eco2mixFeed.test.mjs, and the prism grammar itself in choroplethPrism.test.mjs.
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
  ENERGY_PRISM_DOMAIN_MAX_MW,
  ENERGY_PRISM_SCALE,
  REGION_DEPARTEMENTS,
  UNCOVERED_REGIONS,
  balanceStyle,
  borderLabelText,
  buildBorderArcs,
  buildRegionRecords,
  createFranceEnergyLayer,
  departementRegionIndex,
  energyClassificationTypeForStack,
  energyPrismLegend,
  energyPrismRow,
  formatMegawatts,
  mapAnalystRecord,
  regionAnchor,
  regionLabelHeightM,
  regionLabelText,
  selectEnergyOverlayCohort,
  summarizeNational,
} from './franceEnergy.js';
import { parseDepartements } from './meteoFranceVigilance.js';
import {
  PRISM_BODY_ALPHA,
  PRISM_MAX_HEIGHT_M,
  PRISM_MIN_HEIGHT_M,
  PRISM_NO_RATIO_COLOR,
  PRISM_TOP_ALPHA,
  prismApparentPx,
} from './choroplethPrism.js';
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

test('the deadband stops claiming a DIRECTION, not a measurement', () => {
  // The old contract returned null inside the deadband, which put "éCO2mix
  // published nothing" and "éCO2mix published zero" behind one absence — A1,
  // and far more dangerous now that absence means "no prism at all".
  assert.equal(balanceStyle(0, 5000).style.key, 'balanced');
  assert.equal(balanceStyle(BALANCE_DEADBAND_MW - 0.001, 5000).style.key, 'balanced');
  assert.equal(balanceStyle(-BALANCE_DEADBAND_MW + 0.001, 5000).style.key, 'balanced');
  assert.equal(balanceStyle(BALANCE_DEADBAND_MW, 5000).style.key, 'importer');
  assert.equal(balanceStyle(-BALANCE_DEADBAND_MW, 5000).style.key, 'exporter');
  // Null now means UNMEASURED and nothing else.
  assert.equal(balanceStyle(null, 5000), null);
  assert.equal(balanceStyle(undefined, 5000), null);
  assert.equal(balanceStyle(Number.NaN, 5000), null);
});

test('the ratio the fill alpha used to carry survives as a number', () => {
  // A3: alpha ramped 0.12 → 0.52 on |balance| / load. It carries nothing now,
  // but the variable is not lost — it travels to the analyst record.
  const large = balanceStyle(-7781, 6448);
  assert.ok(large.ratio > 1.2 && large.ratio < 1.25);
  assert.equal(large.alpha, undefined, 'alpha is not a channel any more');
  // A missing load must not produce NaN.
  assert.equal(balanceStyle(-500, null).ratio, 0);
  assert.equal(balanceStyle(-500, 0).ratio, 0);
});

// ── The prism ───────────────────────────────────────────────────────────────

test('the height domain is a frozen literal, and it is not the sample', () => {
  // C1. The largest balance ever measured here is 7 781 MW; the domain is
  // 12 000, deliberately above the fleet's plausible maximum, so a cold day
  // does not silently rescale the country.
  assert.equal(ENERGY_PRISM_SCALE.domainMax, ENERGY_PRISM_DOMAIN_MAX_MW);
  assert.equal(ENERGY_PRISM_DOMAIN_MAX_MW, 12_000);
  assert.equal(ENERGY_PRISM_SCALE.domainMin, 0);
  assert.equal(ENERGY_PRISM_SCALE.maxHeightM, PRISM_MAX_HEIGHT_M);
  const observed = Math.max(...PAYLOAD.regions.map((r) => Math.abs(r.netPhysical)));
  assert.ok(observed < ENERGY_PRISM_DOMAIN_MAX_MW, `observed max ${observed}`);
  assert.ok(Object.isFrozen(ENERGY_PRISM_SCALE));
});

test('the scale is LINEAR, and the measurement that justifies it', () => {
  // choroplethPrism only licenses 'sqrt' above a dynamic range of ~1:30, where
  // the floor starts doing the work. This layer runs 7 781 → 1 544 MW.
  const magnitudes = PAYLOAD.regions.map((r) => Math.abs(r.netPhysical));
  const range = Math.max(...magnitudes) / Math.min(...magnitudes);
  assert.equal(ENERGY_PRISM_SCALE.mode, 'linear');
  assert.ok(range < 30, `dynamic range ${range.toFixed(1)} would need declaring`);
  // And nothing is floored: the smallest région stands well clear of 4 km.
  const shortest = Math.min(...PAYLOAD.regions.map(
    (r) => energyPrismRow(r).heightM,
  ));
  assert.ok(shortest > PRISM_MIN_HEIGHT_M * 3, `${shortest} m is nearly the floor`);
});

test('height is |MW| and colour is the SIGN — the two channels never swap', () => {
  const aura = energyPrismRow({ code: '84', netPhysical: -7781 });
  const idf = energyPrismRow({ code: '11', netPhysical: 6478 });
  // Same ruler for both directions: 7 781 MW of export is taller than 6 478 MW
  // of import, which is the one comparison the flat fill could never make.
  assert.ok(aura.heightM > idf.heightM);
  assert.equal(Math.round(aura.heightM), Math.round(7781 / 12_000 * PRISM_MAX_HEIGHT_M));
  assert.equal(aura.color, BALANCE_STYLES.exporter.color);
  assert.equal(idf.color, BALANCE_STYLES.importer.color);
  // Equal magnitudes, opposite signs: same height, different colour. That is
  // the whole arbitration, in one assertion.
  const up = energyPrismRow({ code: 'a', netPhysical: 4000 });
  const down = energyPrismRow({ code: 'b', netPhysical: -4000 });
  assert.equal(up.heightM, down.heightM);
  assert.notEqual(up.color, down.color);
  assert.ok(up.heightM > 0, 'and neither of them goes below the datum');
});

test('an unmeasured balance is not a measured zero', () => {
  // `Math.abs(null)` is 0. Handing that to the scale would fabricate a
  // measured zero out of a région nobody published — the fault the whole
  // grammar exists to prevent.
  const missing = energyPrismRow({ code: '94', netPhysical: null });
  assert.equal(missing.heightM, null);
  assert.equal(missing.hasValue, false);
  assert.equal(missing.measuredZero, false);
  assert.equal(missing.color, null);

  const zero = energyPrismRow({ code: '11', netPhysical: 0 });
  assert.equal(zero.heightM, 0);
  assert.equal(zero.measuredZero, true);
  assert.equal(zero.extruded, false);
  assert.equal(zero.color, BALANCE_STYLES.balanced.color);

  for (const junk of [{}, { netPhysical: 'beaucoup' }, { netPhysical: [] }, { netPhysical: true }]) {
    assert.equal(energyPrismRow(junk).heightM, null, JSON.stringify(junk));
  }
});

test('a balance above the frozen domain is clipped, and says so', () => {
  // A5. 12 000 MW is above the fleet's plausible maximum, but a frozen domain
  // has a top by construction and the map has to admit when it hits it.
  const winter = energyPrismRow({ code: '84', netPhysical: -14_000 });
  assert.equal(winter.clipped, true);
  assert.equal(winter.heightM, PRISM_MAX_HEIGHT_M);
  assert.equal(energyPrismRow({ code: '84', netPhysical: -7781 }).clipped, false);
});

test('the calibration figures in the header are reproducible', () => {
  // The numbers the header quotes at the ~1 500 km national altitude. If the
  // domain or the max height moves, this fails and the header gets rewritten.
  const px = (mw) => prismApparentPx({
    heightM: energyPrismRow({ code: 'x', netPhysical: mw }).heightM,
    cameraDistanceM: 1_500_000,
  });
  assert.ok(Math.abs(px(-7781) - 74.9) < 0.2, `AURA ${px(-7781)}`);
  assert.ok(Math.abs(px(6478) - 62.3) < 0.2, `IDF ${px(6478)}`);
  assert.ok(Math.abs(px(1544) - 14.9) < 0.2, `Bretagne ${px(1544)}`);
  // The two leaders are 12 px apart on screen: a difference the eye sorts.
  assert.ok(px(-7781) - px(6478) > 10);
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

test('records stay ordered weakest-first, deterministically', () => {
  // Translucent volumes are depth-sorted by the renderer, so this no longer
  // decides who paints over whom — it keeps the label cohort, the analyst
  // snapshot and the legend counts stable from one poll to the next.
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

test('a région with no published balance says so, and says it in words', () => {
  // It used to read « ÉQUILIBRÉE », which asserted a measurement nobody made.
  assert.match(regionLabelText({ name: 'Corse', balance: null }), /SOLDE NON PUBLIÉ/);
  assert.equal(regionLabelHeightM({ name: 'Corse', netPhysical: null }), 0);
});

test('the label rides at the TOP of its prism, not on the ground', () => {
  // B2 asks for a height read against a vertical guide. Here the guide is the
  // label: it states the megawatts at the altitude the length reaches. Left on
  // the ground it would sit behind 78 km of translucent volume.
  const aura = { code: '84', name: 'Auvergne-Rhône-Alpes', netPhysical: -7781 };
  assert.equal(regionLabelHeightM(aura), energyPrismRow(aura).heightM);
  assert.ok(regionLabelHeightM(aura) > 70_000);
  // A measured zero has no prism, so its label stays on the ground.
  assert.equal(regionLabelHeightM({ code: '11', netPhysical: 0 }), 0);
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

test('the legend publishes the height ruler AND the colour key (D1)', () => {
  const records = buildRegionRecords(PAYLOAD, parseDepartements(BUNDLED));
  const legend = energyPrismLegend(records);
  const labels = legend.map((entry) => entry.label);

  // Height first — it is the primary variable now — with a title row and
  // numbered ticks, because a length without a ruler says nothing.
  assert.match(labels[0], /^Hauteur — /);
  for (const tick of ENERGY_PRISM_SCALE.heightTicks) {
    const row = legend.find((entry) => entry.label.startsWith(`${tick.toLocaleString('fr-FR').replace(/[\u00a0\u202f]/g, ' ')} `));
    assert.ok(row, `no tick row for ${tick}`);
    // One constant colour for all three: in these rows the datum is the bar's
    // HEIGHT, so a varying swatch colour would be a second, false encoding.
    assert.ok(row.glyph.startsWith('data:image/svg+xml;base64,'));
    assert.equal(row.color, legend[1].color);
  }
  // Then the colour key, counted.
  const colourTitle = labels.findIndex((label) => label.startsWith('Couleur — '));
  assert.ok(colourTitle > 0);
  const exporters = legend.find((entry) => entry.color === BALANCE_STYLES.exporter.color);
  const importers = legend.find((entry) => entry.color === BALANCE_STYLES.importer.color);
  assert.equal(exporters.count, 5);
  assert.equal(importers.count, 7);
  // The balanced class is real but never fires on this snapshot, so it is not
  // shown: a colour a reader is told to look for and can never find is noise.
  assert.ok(!legend.some((entry) => entry.color === BALANCE_STYLES.balanced.color));

  // And Corsica, which is NOT in `records` and would otherwise be forgotten by
  // a legend that only counted what the join returned.
  const missing = legend.at(-1);
  assert.equal(missing.count, UNCOVERED_REGIONS.length);
  assert.equal(missing.color, PRISM_NO_RATIO_COLOR);
  assert.ok(missing.glyph, 'the absence is a motif, not just a tint (D3)');
  assert.match(missing.blurb, /Corse/);

  // Every entry is the repo's shape, and no ratio is asserted anywhere: this
  // legend must never claim the colour is « un rapport ».
  for (const entry of legend) {
    assert.equal(typeof entry.label, 'string');
    assert.ok('color' in entry);
    assert.ok(!/rapport/.test(entry.blurb || ''), entry.label);
  }
  assert.deepEqual(energyPrismLegend([]), []);
});

test('the legend declares a clipped prism when there is one (A5)', () => {
  const records = buildRegionRecords({
    regions: PAYLOAD.regions.map((region) => (
      region.code === '84' ? { ...region, netPhysical: -14_000 } : region
    )),
  }, parseDepartements(BUNDLED));
  const clipped = energyPrismLegend(records).find((entry) => /au-dessus de/.test(entry.label));
  assert.ok(clipped, 'a value over the frozen domain must be announced');
  assert.equal(clipped.count, 1);
  assert.match(clipped.blurb, /hauteur maximale/);
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

  // The variable the fill alpha used to carry (A3) and the metres the map
  // actually draws, so an analyst can check the picture against the figure.
  assert.ok(aura.exchangeRatio > 1.2 && aura.exchangeRatio < 1.25);
  assert.equal(Math.round(aura.prismHeightM), Math.round(7781 / 12_000 * PRISM_MAX_HEIGHT_M));
  assert.equal(mapAnalystRecord({ code: '94', netPhysical: null }).prismHeightM, null);

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

test('a région raises all of its départements to ONE height', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    assert.equal(await h.layer.update(h.viewer), true);

    const shown = h.entities().filter((entity) => entity.polygon && entity.show);
    const codes = shown.map((entity) => entity.properties.code.getValue()).sort();
    // 69 is a MultiPolygon, so it contributes TWO entities — both must rise,
    // or an island sits at sea level while its mainland is 78 km up.
    assert.deepEqual(codes, ['2A', '69', '69', '75', '95']);

    const at = (code) => shown.find((entity) => entity.properties.code.getValue() === code);
    const heightOf = (code) => at(code).polygon.extrudedHeight.getValue();

    // Both Île-de-France départements share ONE material and ONE height: they
    // are one measurement, not two, and the plateau is what shows it.
    assert.equal(at('75').polygon.material, at('95').polygon.material);
    assert.equal(heightOf('75'), heightOf('95'));
    // The base is the ELLIPSOID for every prism, or the tops stop being
    // comparable the moment the terrain moves.
    assert.equal(at('75').polygon.height.getValue(), 0);
    assert.equal(at('69').polygon.perPositionHeight.getValue(), false);

    // Auvergne-Rhône-Alpes exports 7 781 MW against Île-de-France's 6 478 MW
    // import: taller AND a different colour. Both facts, one mark.
    assert.ok(heightOf('69') > heightOf('75'));
    assert.equal(Math.round(heightOf('69')), Math.round(7781 / 12_000 * PRISM_MAX_HEIGHT_M));
    const colorOf = (code) => at(code).polygon.material.color.getValue();
    const amber = Cesium.Color.fromCssColorString(BALANCE_STYLES.importer.color);
    const teal = Cesium.Color.fromCssColorString(BALANCE_STYLES.exporter.color);
    assert.ok(colorOf('75').red === amber.red && colorOf('75').green === amber.green);
    assert.ok(colorOf('69').red === teal.red && colorOf('69').green === teal.green);
    // The body is translucent and the silhouette is not: the top edge is the
    // reading instrument, so it gets the outline a clamped fill cannot have.
    assert.equal(colorOf('75').alpha, PRISM_BODY_ALPHA);
    assert.equal(at('75').polygon.outline.getValue(), true);
    assert.equal(at('75').polygon.outlineColor.getValue().alpha, PRISM_TOP_ALPHA);
  } finally {
    h.restore();
  }
});

test('Corsica is a striped footprint, never a prism of height zero', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);

    const corse = h.entities().find((entity) => (
      entity.polygon && entity.properties?.code?.getValue() === '2A'
    ));
    // Visible — a hidden Corsica made "not published" look like "nothing here",
    // which a height channel cannot afford (A1/A4).
    assert.equal(corse.show, true);
    assert.equal(corse.polygon.extrudedHeight, undefined, 'no prism, not even a flat one');
    assert.equal(corse.polygon.height, undefined, 'clamped, or the terrain swallows it');
    // A MOTIF and not a tint (D3), and still classified, because a footprint on
    // the ground is exactly the thing classification is for.
    assert.ok(corse.polygon.material instanceof Cesium.StripeMaterialProperty);
    assert.ok(corse.polygon.classificationType);
    // And it never enters the analyst snapshot or the count.
    assert.ok(!h.layer.getAnalystRecords().some((row) => row.id === '94'));
  } finally {
    h.restore();
  }
});

test('the three marks A1 asks for are three different marks', async () => {
  // Measured (prism) / measured at zero (flat, filled, opaque) / not published
  // (flat, striped). Île-de-France is forced to an exact zero so all three sit
  // on the same frame.
  const zeroed = {
    ...PAYLOAD,
    regions: PAYLOAD.regions.map((region) => (
      region.code === '11' ? { ...region, netPhysical: 0 } : region
    )),
  };
  const h = createHarness([zeroed]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);

    const at = (code) => h.entities().find((entity) => (
      entity.polygon && entity.properties?.code?.getValue() === code
    ));
    const prism = at('69');
    const zero = at('75');
    const absent = at('2A');

    assert.ok(prism.polygon.extrudedHeight.getValue() > 0);
    assert.equal(zero.polygon.extrudedHeight, undefined);
    assert.equal(absent.polygon.extrudedHeight, undefined);

    // The zero is FILLED and OPAQUE in the balanced slate; the absence is
    // striped. They must not be the same pixel.
    assert.equal(
      zero.polygon.material.color.getValue().alpha,
      PRISM_TOP_ALPHA,
      'a measured zero is drawn, and drawn solidly',
    );
    assert.equal(
      zero.polygon.material.color.getValue().red,
      Cesium.Color.fromCssColorString(BALANCE_STYLES.balanced.color).red,
    );
    assert.ok(absent.polygon.material instanceof Cesium.StripeMaterialProperty);
    assert.ok(!(zero.polygon.material instanceof Cesium.StripeMaterialProperty));
    // Both flat marks go back on the ground and take the classification.
    assert.ok(zero.polygon.classificationType);
    assert.equal(zero.polygon.height, undefined);

    // And the legend counts the zero rather than swallowing it.
    const legend = h.layer.getRowControls().legend;
    assert.ok(legend.some((entry) => entry.label === 'mesuré à zéro' && entry.count === 1));
    assert.equal(h.layer.getStats().unpublishedRegions, 0);
  } finally {
    h.restore();
  }
});

test('a région the upstream drops becomes striped, not stale', async () => {
  const dropped = { ...PAYLOAD, regions: PAYLOAD.regions.filter((r) => r.code !== '84') };
  const h = createHarness([PAYLOAD, dropped]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    const rhone = () => h.entities().find((entity) => (
      entity.polygon && entity.properties?.code?.getValue() === '69'
    ));
    assert.ok(rhone().polygon.extrudedHeight.getValue() > 0);

    await h.layer.update(h.viewer);
    // Not a stale 78 km prism, and not a hole either: a declared absence.
    assert.equal(rhone().polygon.extrudedHeight, undefined);
    assert.ok(rhone().polygon.material instanceof Cesium.StripeMaterialProperty);
    assert.equal(h.layer.getStats().count, 11);
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

    // Every région label is lifted to the top of its own prism, so the number
    // and the length it encodes are read in the same glance.
    for (const entry of regions) {
      const height = Cesium.Cartographic.fromCartesian(entry.position).height;
      assert.ok(height > 50_000, `${entry.id} sits at ${height} m, near its base`);
    }
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
    // A5 in the HUD as well as in the legend, and both zero on this snapshot.
    assert.equal(stats.clippedRegions, 0);
    assert.equal(stats.unpublishedRegions, 0);
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

test('the map-stack event reclassifies the FOOTPRINTS and skips the prisms', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);

    h.mapStackEventTarget.dispatchEvent(new CustomEvent('gev:map-stack-changed', {
      detail: { activeId: 'google-photorealistic' },
    }));

    let prisms = 0;
    let footprints = 0;
    for (const entity of h.entities()) {
      if (!entity.polygon || !entity.show) continue;
      if (entity.polygon.extrudedHeight !== undefined) {
        // An extruded polygon is not a GroundPrimitive: `_isOnTerrain` returns
        // false as soon as `extrudedHeight` is defined, so a classification set
        // here would be read and ignored in silence. Not setting it is the
        // honest state, and it is what keeps a reader from believing otherwise.
        assert.equal(entity.polygon.classificationType, undefined);
        prisms += 1;
      } else {
        assert.equal(
          entity.polygon.classificationType.getValue(),
          Cesium.ClassificationType.CESIUM_3D_TILE,
        );
        footprints += 1;
      }
    }
    assert.ok(prisms > 0 && footprints > 0, `${prisms} prisms, ${footprints} footprints`);
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
