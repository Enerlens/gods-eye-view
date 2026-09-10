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
  REGION_NAMES,
  UNCOVERED_REGIONS,
  arrowOrientation,
  balanceStyle,
  borderLabelText,
  PRISM_FOOTPRINT_SCALE,
  buildBorderArcs,
  buildMarketOutlines,
  buildRegionRecords,
  buildRegionShapes,
  createFranceEnergyLayer,
  departementRegionIndex,
  energyClassificationTypeForStack,
  energyPrismLegend,
  energyPrismRow,
  formatMegawatts,
  frontierAnchors,
  mapAnalystRecord,
  marketOutlineStyles,
  regionAnchor,
  regionLabelHeightM,
  regionLabelText,
  selectEnergyOverlayCohort,
  summarizeNational,
  unmeasuredRegions,
} from './franceEnergy.js';
import { parseDepartements } from './meteoFranceVigilance.js';
import { ringArea } from './polygonDissolve.js';
import { greatCircleDistanceM } from './greatCircleArc.js';

/** Ray casting, so a test can say "this point is inside that country". */
function pointInRing([lon, lat], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat)
      && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
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
const MARKET_AREAS = JSON.parse(readFileSync(
  new URL('./local_data/energy_market_areas/market_areas.geojson', import.meta.url),
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

test('the CONE lands where the power arrives, whichever way it flows', () => {
  // The head is the mark that carries the sense, so this is the assertion that
  // stands for "the reader can see which way it goes".
  const [imported] = buildBorderArcs([{ key: 'espagne', label: 'Espagne', mw: 500 }]);
  assert.equal(imported.importing, true);
  assert.equal(imported.style.key, 'importer');
  assert.ok(Math.abs(imported.head.tip[0] - BORDER_ANCHORS.france[0]) < 1e-6);
  assert.ok(Math.abs(imported.head.tip[1] - BORDER_ANCHORS.france[1]) < 1e-6);
  // …and it starts out over Spain, on the bearing of the Spanish reference
  // point rather than on the point itself: the glyph has a fixed length.
  assert.ok(imported.positions[1] < BORDER_ANCHORS.france[1], 'the flow comes from the south');

  const [exported] = buildBorderArcs([{ key: 'italie', label: 'Italie', mw: -2537 }]);
  assert.equal(exported.importing, false);
  assert.equal(exported.style.key, 'exporter');
  assert.ok(Math.abs(exported.positions[0] - BORDER_ANCHORS.france[0]) < 1e-6);
  assert.ok(exported.head.tip[0] > BORDER_ANCHORS.france[0], 'the flow heads east');

  // The cone sits at the END of the shaft, never inside it: `base` is the last
  // sample of the tube and the tip is one head-length beyond.
  for (const arc of [imported, exported]) {
    assert.deepEqual(arc.head.base, [
      arc.positions.at(-3), arc.positions.at(-2), arc.positions.at(-1),
    ]);
    assert.ok(greatCircleDistanceM(arc.head.base, arc.head.tip) > arc.headLengthM * 0.5);
  }
});

test('the glyph is a VOLUME, and its length is not a variable', () => {
  const arcs = buildBorderArcs(PAYLOAD.national.exchanges, frontierAnchors(BUNDLED));
  // Thickness is the only thing that moves. Left free, length was geography:
  // 94 km to Switzerland against 411 km to Italy, so the Italian flow read
  // four times the Swiss one before a megawatt was consulted.
  const lengths = arcs.map((arc) => arc.lengthM);
  assert.ok(Math.max(...lengths) / Math.min(...lengths) <= 2.1, lengths.join(','));
  for (const arc of arcs) {
    assert.ok(arc.lengthM >= 170_000 && arc.lengthM <= 340_000, `${arc.key} ${arc.lengthM}`);
    // A world radius, not a screen width: the rest of the layer measures in
    // metres and a hairline that never grows is what made this unreadable.
    assert.ok(arc.radiusM >= 9_000 && arc.radiusM <= 22_000, `${arc.key} ${arc.radiusM}`);
    assert.ok(arc.headRadiusM > arc.radiusM * 1.5, 'a head barely wider than its shaft is a taper');
    // Lifted clear of the ground at BOTH ends, or the lower half of a 22 km
    // tube is buried exactly where the reader looks.
    assert.ok(arc.positions[2] > arc.radiusM, `${arc.key} starts at ${arc.positions[2]} m`);
    assert.ok(arc.head.tip[2] > arc.radiusM, `${arc.key} ends at ${arc.head.tip[2]} m`);
  }
});

test('every flow glyph ends INSIDE the market it names', () => {
  // The clamp is only legitimate if it never points past its own country. The
  // far end is a bearing, so a glyph that overshoots Switzerland lands in Italy
  // and says the opposite of what its label says.
  const frontier = frontierAnchors(BUNDLED);
  const arcs = buildBorderArcs(PAYLOAD.national.exchanges, frontier);
  const outlines = new Map(buildMarketOutlines(MARKET_AREAS).map((m) => [m.key, m.rings]));
  for (const arc of arcs) {
    const abroad = arc.importing
      ? [arc.positions[0], arc.positions[1]]
      : [arc.head.tip[0], arc.head.tip[1]];
    assert.ok(
      outlines.get(arc.key).some((ring) => pointInRing(abroad, ring)),
      `${arc.key} ends at ${abroad.map((v) => v.toFixed(2)).join('/')}, outside its own market`,
    );
  }
});

test('the arcs leave the FRONTIER, not the middle of the country', () => {
  const frontier = frontierAnchors(BUNDLED);
  // Five markets, five frontier points, and Corsica excluded from the search:
  // Bonifacio is nearer Rome than Menton is, and the Franco-Italian commercial
  // border is the Alps.
  assert.equal(frontier.size, 5);
  const italy = frontier.get('italie');
  assert.ok(italy[0] > 6.5 && italy[1] > 43.5, `Italie → ${italy}`);
  const spain = frontier.get('espagne');
  assert.ok(spain[1] < 44 && spain[1] > 42, `Espagne → ${spain}`);

  const arcs = buildBorderArcs(PAYLOAD.national.exchanges, frontier);
  for (const arc of arcs) {
    assert.equal(arc.fromFrontier, true);
    // The French end: the cone's TIP on an import, the shaft's first sample on
    // an export. Either way it is the frontier point, not Berry.
    const home = arc.importing
      ? [arc.head.tip[0], arc.head.tip[1]]
      : [arc.positions[0], arc.positions[1]];
    const anchor = frontier.get(arc.key);
    assert.ok(Math.abs(home[0] - anchor[0]) < 1e-6, `${arc.key} lon ${home[0]}`);
    assert.ok(Math.abs(home[1] - anchor[1]) < 1e-6, `${arc.key} lat ${home[1]}`);
    // And nowhere near Berry, which is where all five used to start.
    assert.ok(
      Math.hypot(home[0] - BORDER_ANCHORS.france[0], home[1] - BORDER_ANCHORS.france[1]) > 1,
      `${arc.key} still starts in the middle of France`,
    );
  }
});

test('a missing frontier costs the arc its start, never its existence', () => {
  // The geometry has not loaded. An arc drawn from slightly the wrong place
  // still says which way the power is going; a missing arc says nothing.
  const arcs = buildBorderArcs(PAYLOAD.national.exchanges, new Map());
  assert.equal(arcs.length, 5);
  assert.ok(arcs.every((arc) => arc.fromFrontier === false));
  // Suisse is an IMPORT on this snapshot, so the French end is the cone's tip.
  const swiss = arcs.find((arc) => arc.key === 'suisse');
  assert.ok(swiss.importing);
  assert.ok(
    Math.abs(swiss.head.tip[0] - BORDER_ANCHORS.france[0]) < 1e-9,
    String(swiss.head.tip[0]),
  );
  assert.deepEqual(frontierAnchors({ features: [] }), new Map());
});

test('a shorter glyph gets a shorter bow, or the arc is a croquet hoop', () => {
  const frontier = frontierAnchors(BUNDLED);
  const apexOf = (arcs, key) => {
    const arc = arcs.find((entry) => entry.key === key);
    return Math.max(...arc.positions.filter((_, i) => i % 3 === 2));
  };
  const near = buildBorderArcs(PAYLOAD.national.exchanges, frontier);
  const far = buildBorderArcs(PAYLOAD.national.exchanges);
  // From Berry the Swiss glyph spans ~590 km and the shared 60 km apex floor is
  // proportionate; from the frontier it is clamped to 170 km, where 60 km of
  // bow is an archway. The apex has to come down with the span.
  assert.ok(apexOf(near, 'suisse') < apexOf(far, 'suisse'));
  // The clearance lift is on top of the bow, so the floor is the apex plus it.
  const swiss = near.find((arc) => arc.key === 'suisse');
  assert.ok(
    apexOf(near, 'suisse') <= 45_000 + swiss.radiusM,
    `${apexOf(near, 'suisse')} m`,
  );
});

test('a zero border is no arc at all, and an unknown border is dropped', () => {
  assert.deepEqual(buildBorderArcs([{ key: 'suisse', label: 'Suisse', mw: 0 }]), []);
  assert.deepEqual(buildBorderArcs([{ key: 'lune', label: 'Lune', mw: 900 }]), []);
  assert.deepEqual(buildBorderArcs([{ key: 'suisse', label: 'Suisse', mw: null }]), []);
  assert.deepEqual(buildBorderArcs(null), []);
});

test('arc thickness ramps with the flow and saturates', () => {
  const [thin] = buildBorderArcs([{ key: 'suisse', label: 'Suisse', mw: 50 }]);
  const [thick] = buildBorderArcs([{ key: 'suisse', label: 'Suisse', mw: 2900 }]);
  const [clamped] = buildBorderArcs([{ key: 'suisse', label: 'Suisse', mw: 25_000 }]);
  assert.ok(thick.radiusM > thin.radiusM);
  assert.ok(clamped.radiusM >= thick.radiusM && clamped.radiusM <= 22_000);
  // And the head follows the shaft, so a weak border is not given a huge head.
  assert.ok(thin.headRadiusM < thick.headRadiusM);
  assert.ok(thin.headLengthM < thick.headLengthM);
});

test('the five real borders all resolve, Allemagne+Belgique as one arc', () => {
  const arcs = buildBorderArcs(PAYLOAD.national.exchanges);
  assert.equal(arcs.length, 5);
  const combined = arcs.find((arc) => arc.key === 'allemagne_belgique');
  assert.ok(combined);
  assert.match(borderLabelText(combined), /Allemagne \+ Belgique/);
});

// ── Presentation ────────────────────────────────────────────────────────────

test('the dissolve turns 96 départements into 13 régions and no seams', () => {
  const shapes = buildRegionShapes(BUNDLED);
  assert.equal(shapes.size, 13, 'twelve measured régions plus Corse');
  let marks = 0;
  for (const [code, shape] of shapes) {
    // ONE prism per région on the real file — the whole point of the dissolve.
    assert.equal(shape.prismRings.length, 1, `région ${code} draws ${shape.prismRings.length}`);
    marks += shape.prismRings.length;
    // The perimeter keeps the islands the prism drops.
    assert.ok(shape.rings.length >= shape.prismRings.length);
    assert.ok(Math.abs(ringArea(shape.rings[0])) >= Math.abs(ringArea(shape.rings.at(-1))));
  }
  assert.equal(marks, 13);
  // Île-de-France: eight départements in, one closed outline out, and the 139
  // shared segments that used to draw the seams are not in it.
  const idf = buildRegionShapes(BUNDLED).get('11');
  assert.deepEqual(idf.rings[0][0], idf.rings[0].at(-1));
  assert.ok(idf.rings[0].length < 250, `${idf.rings[0].length} points`);
  assert.deepEqual(buildRegionShapes(null), new Map());
});

test('the market outlines are whitelisted on the fields éCO2mix publishes', () => {
  const outlines = buildMarketOutlines(TEST_MARKETS);
  assert.deepEqual(outlines.map((entry) => entry.key), ['espagne', 'italie']);
  assert.equal(outlines[1].rings.length, 2, 'a MultiPolygon keeps its parts');
  assert.ok(!outlines.some((entry) => entry.key === 'luxembourg'));
  assert.deepEqual(buildMarketOutlines(null), []);

  // The bundled file: five markets, and Germany + Belgium in ONE entry because
  // they are ONE upstream field.
  const bundled = buildMarketOutlines(MARKET_AREAS);
  assert.deepEqual(
    bundled.map((entry) => entry.key).sort(),
    ['allemagne_belgique', 'angleterre', 'espagne', 'italie', 'suisse'],
  );
  assert.equal(bundled.find((entry) => entry.key === 'allemagne_belgique').rings.length, 2);
  assert.match(bundled.find((entry) => entry.key === 'allemagne_belgique').label, /Belgique/);
});

test('an outline takes its arc class, and slate when nothing crosses', () => {
  const styles = marketOutlineStyles(buildBorderArcs(PAYLOAD.national.exchanges));
  assert.equal(styles.size, 5);
  // +500 MW from Spain is an import; −2 537 MW to Italy is an export.
  assert.equal(styles.get('espagne'), BALANCE_STYLES.importer);
  assert.equal(styles.get('italie'), BALANCE_STYLES.exporter);
  // No arc at all — the market is still a neighbour and still gets a line.
  assert.equal(marketOutlineStyles([]).get('suisse'), BALANCE_STYLES.balanced);
  assert.equal(marketOutlineStyles(null).size, 5);
  assert.ok(!marketOutlineStyles([]).has('france'));
});

test('a région the feed DROPS is counted and named, not silently lost', () => {
  // The bug the first reader found by eye: éCO2mix dropped Normandie from the
  // 15:04Z poll, the map drew twelve prisms and two striped shapes, and the
  // legend said « non publié 1 ». 11 + 1 is not 13.
  const dropped = {
    ...PAYLOAD,
    regions: PAYLOAD.regions.filter((region) => region.code !== '28'),
  };
  const records = buildRegionRecords(dropped, parseDepartements(BUNDLED));
  assert.equal(records.length, 11);

  const missing = unmeasuredRegions(records);
  assert.deepEqual(missing.map((region) => region.code), ['28', '94']);
  assert.deepEqual(missing.map((region) => region.name), ['Normandie', 'Corse']);
  // The arithmetic a reader can do on the legend now closes.
  const legend = energyPrismLegend(records);
  const row = legend.find((entry) => /non publié/.test(entry.label));
  assert.equal(row.count, 2);
  const classes = legend
    .filter((entry) => Object.values(BALANCE_STYLES).some((s) => s.color === entry.color))
    .reduce((sum, entry) => sum + entry.count, 0);
  assert.equal(classes + row.count, Object.keys(REGION_DEPARTEMENTS).length);
  // And it NAMES them, because a striped shape with no label is what sent the
  // reader hunting along the coastline.
  assert.match(row.blurb, /Normandie/);
  assert.match(row.blurb, /Corse/);
});

test('a published NULL and a dropped région are the same absence', () => {
  // Three causes — never published (Corse), published null, dropped from the
  // payload — and one mark, so one count. Telling them apart in the arithmetic
  // would promise a distinction the map does not draw.
  const nulled = {
    ...PAYLOAD,
    regions: PAYLOAD.regions.map((region) => (
      region.code === '53' ? { ...region, netPhysical: null } : region
    )).filter((region) => region.code !== '28'),
  };
  const records = buildRegionRecords(nulled, parseDepartements(BUNDLED));
  assert.deepEqual(unmeasuredRegions(records).map((r) => r.code), ['28', '53', '94']);
  assert.equal(unmeasuredRegions([]).length, Object.keys(REGION_DEPARTEMENTS).length);
  assert.equal(unmeasuredRegions(null).length, Object.keys(REGION_DEPARTEMENTS).length);
});

test('the name table covers the grouping exactly, or a région goes anonymous', () => {
  assert.deepEqual(
    Object.keys(REGION_NAMES).sort(),
    Object.keys(REGION_DEPARTEMENTS).sort(),
  );
  // The names have to match what éCO2mix itself publishes, or a région renames
  // itself the moment the feed drops it.
  for (const region of PAYLOAD.regions) {
    if (!REGION_NAMES[region.code]) continue;
    assert.equal(REGION_NAMES[region.code], region.name, `région ${region.code}`);
  }
});

test('the cone is aimed down the flow, and never at a pole', () => {
  const aim = (x, y, z) => {
    const direction = Cesium.Cartesian3.normalize(
      new Cesium.Cartesian3(x, y, z), new Cesium.Cartesian3(),
    );
    const rotation = Cesium.Matrix3.fromQuaternion(arrowOrientation(direction));
    // The cone is built along its own +Z, so the third column of the basis has
    // to come back as the direction it was given.
    return { direction, z: Cesium.Matrix3.getColumn(rotation, 2, new Cesium.Cartesian3()) };
  };
  for (const axis of [[1, 0, 0], [0, 1, 0], [0.3, -0.5, 0.8], [1, 1, 1]]) {
    const { direction, z } = aim(...axis);
    assert.ok(Cesium.Cartesian3.distance(direction, z) < 1e-9, axis.join(','));
  }
  // Straight up the ECEF Z: crossing with UNIT_Z gives a zero vector, and
  // normalising that is NaN and an arrowhead that vanishes. The seed swaps.
  const { direction, z } = aim(0, 0, 1);
  assert.ok(Cesium.Cartesian3.distance(direction, z) < 1e-9);
  const rotation = Cesium.Matrix3.fromQuaternion(arrowOrientation(direction));
  for (let i = 0; i < 9; i += 1) assert.ok(Number.isFinite(rotation[i]), `element ${i}`);
  // And the basis stays orthonormal, or the cone is sheared.
  const x = Cesium.Matrix3.getColumn(rotation, 0, new Cesium.Cartesian3());
  const y = Cesium.Matrix3.getColumn(rotation, 1, new Cesium.Cartesian3());
  assert.ok(Math.abs(Cesium.Cartesian3.magnitude(x) - 1) < 1e-9);
  assert.ok(Math.abs(Cesium.Cartesian3.dot(x, y)) < 1e-9);
  assert.ok(Math.abs(Cesium.Cartesian3.dot(x, z)) < 1e-9);
});

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
  // And immediately after it, the row that admits the footprint is not the
  // région. The prism is drawn on a reduced emprise, and the reader is told so
  // on the map rather than in a source file.
  assert.match(labels[1], /^Socle — /);
  assert.match(legend[1].blurb, /PÉRIMÈTRE EXACT/);
  assert.equal(legend[1].color, null);
  let swatch = null;
  for (const tick of ENERGY_PRISM_SCALE.heightTicks) {
    const row = legend.find((entry) => entry.label.startsWith(`${tick.toLocaleString('fr-FR').replace(/[\u00a0\u202f]/g, ' ')} `));
    assert.ok(row, `no tick row for ${tick}`);
    // One constant colour for all three: in these rows the datum is the bar's
    // HEIGHT, so a varying swatch colour would be a second, false encoding.
    assert.ok(row.glyph.startsWith('data:image/svg+xml;base64,'));
    swatch = swatch ?? row.color;
    assert.equal(row.color, swatch);
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
  const missing = legend.find((entry) => /non publié/.test(entry.label));
  assert.equal(missing.count, UNCOVERED_REGIONS.length);
  assert.equal(missing.color, PRISM_NO_RATIO_COLOR);
  assert.ok(missing.glyph, 'the absence is a motif, not just a tint (D3)');
  assert.match(missing.blurb, /Corse/);

  // The third mark: the neighbours are delimited and never filled, and the
  // legend has to say why they are empty or an empty outline reads as a bug.
  // It is CONDITIONAL — the market file may fail without taking the layer
  // down, and a legend cannot promise a mark nobody drew.
  assert.ok(!legend.some((entry) => /^Contour — /.test(entry.label)));
  const full = energyPrismLegend(records, { markets: 5, borders: 5 });
  const outline = full.at(-1);
  assert.match(outline.label, /^Contour — /);
  assert.equal(outline.color, null, 'the outline row keys no colour of its own');
  assert.equal(outline.count, 5);
  assert.match(outline.blurb, /jamais un aplat/);
  assert.match(outline.blurb, /le plus proche/);

  // The flow had no legend row at all while it was a hairline. It is now the
  // loudest mark on the map, so D1 applies to it: what the thickness means,
  // what the length does NOT mean, and where the sense is read.
  const flow = full.find((entry) => /^Flux — /.test(entry.label));
  assert.ok(flow, 'the loudest mark on the map needs a key');
  assert.equal(flow.color, null);
  assert.ok(!('count' in flow), 'a row that names a CHANNEL carries no count');
  assert.match(flow.blurb, /ÉPAISSEUR/);
  assert.match(flow.blurb, /LONGUEUR ne dit\s+rien|LONGUEUR ne dit rien/);
  assert.match(flow.blurb, /ARRIVÉE/);
  assert.ok(!energyPrismLegend(records, { markets: 5 }).some((e) => /^Flux — /.test(e.label)));

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

/**
 * Two of the five markets, one of them in two rings.
 *
 * Suisse is deliberately ABSENT: a market file that carries no shape for a
 * border must cost that border its outline and nothing else — not its arc, not
 * its label, not the layer.
 */
const TEST_MARKETS = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { key: 'espagne', label: 'Espagne' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[-5, 39], [-1, 39], [-1, 42], [-5, 42], [-5, 39]]],
      },
    },
    {
      type: 'Feature',
      properties: { key: 'italie', label: 'Italie' },
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [[[10, 42], [14, 42], [14, 45], [10, 45], [10, 42]]],
          [[[13, 37], [15, 37], [15, 38], [13, 38], [13, 37]]],
        ],
      },
    },
    // Not a border éCO2mix publishes: dropped by the whitelist rather than
    // drawn as a country nobody exchanges with.
    {
      type: 'Feature',
      properties: { key: 'luxembourg', label: 'Luxembourg' },
      geometry: { type: 'Polygon', coordinates: [[[6, 49], [7, 49], [7, 50], [6, 50], [6, 49]]] },
    },
  ],
};

function createHarness(polls, shapes = TEST_SHAPES, markets = TEST_MARKETS) {
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
    marketAreasGeoJson: markets,
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

test('a région is ONE mark, and its départements are gone from the scene', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    assert.equal(await h.layer.update(h.viewer), true);

    const shown = h.entities().filter((entity) => entity.polygon && entity.show);
    const codes = shown.map((entity) => entity.properties.code.getValue()).sort();
    // RÉGION codes, not département codes. The fixture's Île-de-France squares
    // do not touch, so région 11 keeps two rings — a dissolve merges what is
    // adjacent and honestly refuses to merge what is not. Auvergne-Rhône-Alpes
    // is one mark: its 0.04 deg² island is under the prism threshold.
    assert.deepEqual(codes, ['11', '11', '84', '94']);
    assert.ok(!codes.includes('75'), 'no département reaches the scene any more');
    assert.ok(!codes.includes('69'));

    const marksOf = (code) => shown.filter((e) => e.properties.code.getValue() === code);
    const heightOf = (code) => marksOf(code)[0].polygon.extrudedHeight.getValue();

    // Both rings of Île-de-France share ONE material and ONE height: they are
    // one measurement, and nothing about the drawing may suggest two.
    const [first, second] = marksOf('11');
    assert.equal(first.polygon.material, second.polygon.material);
    assert.equal(
      first.polygon.extrudedHeight.getValue(),
      second.polygon.extrudedHeight.getValue(),
    );
    // The base is the ELLIPSOID for every prism, or the tops stop being
    // comparable the moment the terrain moves.
    assert.equal(first.polygon.height.getValue(), 0);
    assert.equal(first.polygon.perPositionHeight.getValue(), false);

    // Auvergne-Rhône-Alpes exports 7 781 MW against Île-de-France's 6 478 MW
    // import: taller AND a different colour. Both facts, one mark.
    assert.ok(heightOf('84') > heightOf('11'));
    assert.equal(Math.round(heightOf('84')), Math.round(7781 / 12_000 * PRISM_MAX_HEIGHT_M));
    const colorOf = (code) => marksOf(code)[0].polygon.material.color.getValue();
    const amber = Cesium.Color.fromCssColorString(BALANCE_STYLES.importer.color);
    const teal = Cesium.Color.fromCssColorString(BALANCE_STYLES.exporter.color);
    assert.ok(colorOf('11').red === amber.red && colorOf('11').green === amber.green);
    assert.ok(colorOf('84').red === teal.red && colorOf('84').green === teal.green);
    // The body is translucent and the silhouette is not: the top edge is the
    // reading instrument, so it gets the outline a clamped fill cannot have.
    assert.equal(colorOf('11').alpha, PRISM_BODY_ALPHA);
    assert.equal(first.polygon.outline.getValue(), true);
    assert.equal(first.polygon.outlineColor.getValue().alpha, PRISM_TOP_ALPHA);
  } finally {
    h.restore();
  }
});

test('the prism stands on a REDUCED footprint, and the true one is drawn under it', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);

    const shapes = buildRegionShapes(TEST_SHAPES);
    const ring = shapes.get('84').rings[0];
    const inset = shapes.get('84').prismRings[0];
    // The footprint is the SAME SHAPE, smaller: same vertex count, area down
    // by the square of the factor. A buffer would have changed both.
    assert.equal(inset.length, ring.length);
    assert.ok(Math.abs(
      Math.abs(ringArea(inset)) / Math.abs(ringArea(ring)) - PRISM_FOOTPRINT_SCALE ** 2,
    ) < 1e-9);

    // The prism polygon is built on the reduced ring, and a perimeter polyline
    // on the true one is shown beneath it in the same colour. Without that
    // line nothing on the globe says where the région ends.
    const perimeters = h.entities().filter((entity) => (
      entity.polyline && String(entity.id).startsWith('energy-fr:perimeter:')
    ));
    assert.ok(perimeters.length >= 4, `${perimeters.length} perimeter lines`);
    assert.ok(perimeters.every((entity) => entity.show));
    assert.ok(perimeters.every((entity) => entity.polyline.clampToGround.getValue()));
    const aura = perimeters.find((e) => String(e.id) === 'energy-fr:perimeter:84:0');
    const teal = Cesium.Color.fromCssColorString(BALANCE_STYLES.exporter.color);
    assert.equal(aura.polyline.material.color.getValue().red, teal.red);
    assert.ok(aura.polyline.material.color.getValue().alpha < PRISM_TOP_ALPHA);

    // The 0.04 deg² island of Auvergne-Rhône-Alpes carries a perimeter and NO
    // prism: a 78 km column on a speck measures its région and looks like it
    // measures the island.
    assert.ok(h.entities().some((e) => String(e.id) === 'energy-fr:perimeter:84:1'));
    assert.ok(!h.entities().some((e) => String(e.id) === 'energy-fr:region:84:1'));
  } finally {
    h.restore();
  }
});

test('the neighbouring markets are delimited, and never filled', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);

    const outlines = h.entities().filter((entity) => (
      String(entity.id).startsWith('energy-fr:market:')
    ));
    assert.equal(outlines.length, 3, 'one entity per ring of the test outlines');
    // A LINE and nothing else. A filled foreign polygon is what a measurement
    // looks like in this layer, and nothing inside Spain was measured.
    assert.ok(outlines.every((entity) => entity.polyline && !entity.polygon));
    assert.ok(outlines.every((entity) => entity.show));
    assert.ok(outlines.every((entity) => entity.polyline.clampToGround.getValue()));

    const colorOf = (key) => outlines
      .find((entity) => String(entity.id).startsWith(`energy-fr:market:${key}:`))
      .polyline.material.color.getValue();
    // Espagne is +500 MW upstream, i.e. France IMPORTS from it: amber, the
    // same class as its arc. Italie is an export: teal.
    const amber = Cesium.Color.fromCssColorString(BALANCE_STYLES.importer.color);
    const teal = Cesium.Color.fromCssColorString(BALANCE_STYLES.exporter.color);
    assert.equal(colorOf('espagne').red, amber.red);
    assert.equal(colorOf('italie').red, teal.red);
    // Suisse has no outline in the fixture and no entity: a market file that
    // does not carry a shape costs its outline and nothing else.
    assert.ok(!outlines.some((entity) => String(entity.id).includes('suisse')));
  } finally {
    h.restore();
  }
});

test('a market file that fails costs the outlines and nothing else', async () => {
  // The harness fetch answers every URL with the éCO2mix payload, so the
  // market file comes back as a document with no `key` on any feature — the
  // realistic shape of a bad deploy. The régions and the arcs must survive it,
  // and the legend must stop promising a mark nobody drew.
  const h = createHarness([PAYLOAD], TEST_SHAPES, null);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    assert.equal(await h.layer.update(h.viewer), true);

    assert.ok(!h.entities().some((e) => String(e.id).startsWith('energy-fr:market:')));
    assert.equal(h.layer.getStats().count, 12);
    assert.equal(h.layer.getStats().borders, 5);
    assert.ok(!h.layer.getRowControls().legend.some((entry) => /^Contour — /.test(entry.label)));
  } finally {
    h.restore();
  }
});

test('the legend gains its outline row once the markets are on the globe', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);
    const row = h.layer.getRowControls().legend.find((entry) => /^Contour — /.test(entry.label));
    assert.ok(row);
    assert.equal(row.count, 2, 'the two markets the fixture carries');
  } finally {
    h.restore();
  }
});

test('a market whose flow dies keeps its outline, in slate', async () => {
  // An arc is a DIRECTION and a direction of nothing is nothing, so it goes.
  // An outline answers "who is on the other side", which stays true at zero.
  const zeroed = {
    ...PAYLOAD,
    national: {
      ...PAYLOAD.national,
      exchanges: PAYLOAD.national.exchanges.map((entry) => (
        entry.key === 'espagne' ? { ...entry, mw: 0 } : entry
      )),
    },
  };
  const h = createHarness([zeroed]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);

    const spain = h.entities().find((e) => String(e.id) === 'energy-fr:market:espagne:0');
    assert.equal(spain.show, true);
    assert.equal(
      spain.polyline.material.color.getValue().red,
      Cesium.Color.fromCssColorString(BALANCE_STYLES.balanced.color).red,
    );
    assert.ok(!h.entities().some((e) => String(e.id) === 'energy-fr:arc:espagne' && e.show));
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
      entity.polygon && entity.properties?.code?.getValue() === '94'
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
    // Its perimeter is drawn too: even the région nobody measures has to say
    // where it is, and it says it in the slate of the unmeasured.
    const edge = h.entities().find((e) => String(e.id) === 'energy-fr:perimeter:94:0');
    assert.equal(edge.show, true);
    assert.equal(
      edge.polyline.material.color.getValue().red,
      Cesium.Color.fromCssColorString(PRISM_NO_RATIO_COLOR).red,
    );
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
    const prism = at('84');
    const zero = at('11');
    const absent = at('94');

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
    // Corse, and Corse alone: counted from the KNOWN 13 régions rather than
    // from the rows the payload carried, which is what used to lose a région
    // the feed had dropped.
    assert.equal(h.layer.getStats().unpublishedRegions, 1);
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
      entity.polygon && entity.properties?.code?.getValue() === '84'
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

test('the five border flows are drawn as translucent volumes with a solid head', async () => {
  const h = createHarness([PAYLOAD]);
  try {
    h.layer.init(h.viewer);
    h.layer.enable(h.viewer);
    await h.layer.update(h.viewer);

    const arcs = h.entities().filter((entity) => String(entity.id).startsWith('energy-fr:arc:'));
    const heads = h.entities().filter((entity) => String(entity.id).startsWith('energy-fr:arc-head:'));
    assert.equal(arcs.length, 5);
    assert.equal(heads.length, 5, 'a flow without a head has no sense');
    for (const arc of arcs) {
      assert.ok(arc.show);
      // A VOLUME, not a stroke: the reader called the old pixel line « quasi
      // illisible », and a screen width also refuses to grow when the prisms
      // beside it do.
      assert.ok(arc.polylineVolume, 'the shaft is a polyline volume');
      assert.equal(arc.polyline, undefined);
      assert.ok(arc.polylineVolume.positions.getValue().length > 2);
      const shape = arc.polylineVolume.shape.getValue();
      assert.ok(shape.length >= 6, 'a regular section, as thick from every angle');
      const radius = Math.hypot(shape[0].x, shape[0].y);
      assert.ok(radius >= 9_000 && radius <= 22_000, `${radius} m`);
      // The prism's own grammar: translucent body, near-opaque edge.
      const body = arc.polylineVolume.material.color.getValue();
      assert.ok(body.alpha < 0.5, `body alpha ${body.alpha}`);
      assert.equal(arc.polylineVolume.outline.getValue(), true);
      assert.ok(arc.polylineVolume.outlineColor.getValue().alpha > body.alpha);
    }

    for (const head of heads) {
      assert.ok(head.show);
      // A CONE — `topRadius: 0` — and a fat one, because a head barely wider
      // than its shaft is a taper and not an arrow.
      assert.equal(head.cylinder.topRadius.getValue(), 0);
      const shaft = arcs.find((entity) => String(entity.id).endsWith(String(head.id).split(':').at(-1)));
      const radius = Math.hypot(...['x', 'y'].map((k) => shaft.polylineVolume.shape.getValue()[0][k]));
      assert.ok(head.cylinder.bottomRadius.getValue() > radius * 1.5);
      // And it is the BRIGHTEST end of the mark: that is where the sense is.
      assert.ok(head.cylinder.material.color.getValue().alpha > 0.8);
      assert.ok(head.position, 'the cone is placed on the flow');
      assert.ok(head.orientation, 'and aimed down it');
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
    const arcs = (only = false) => h.entities().filter((e) => (
      String(e.id).startsWith('energy-fr:arc:') && (!only || e.show)
    ));
    await h.layer.update(h.viewer);
    assert.equal(arcs(true).length, 5);

    await h.layer.update(h.viewer);
    assert.equal(arcs(true).length, 4);
    // The entity is kept and hidden, not destroyed — the next refresh reuses it.
    assert.equal(arcs().length, 5);
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
    // The harness only bundles four départements, so only the régions whose
    // départements are present get an anchor: IDF and AURA measured, plus
    // Corse — which is UNMEASURED and labelled anyway. That last one is the
    // fix: a striped shape with no name is what sent the first reader hunting
    // for the missing région along the coastline.
    const borders = entries.filter((entry) => entry.id.startsWith('energy-fr:border:'));
    const regions = entries.filter((entry) => entry.id.startsWith('energy-fr:region:'));
    assert.equal(borders.length, 5);
    assert.equal(regions.length, 3, 'IDF, AURA, and an unmeasured Corse');
    for (const entry of entries) assert.equal(entry.interactive, false);

    const corse = regions.find((entry) => entry.id === 'energy-fr:region:94');
    assert.match(corse.title, /^Corse · SOLDE NON PUBLIÉ$/);
    assert.equal(corse.accent, PRISM_NO_RATIO_COLOR);
    // On the ground: it has no prism, so there is no top to ride.
    assert.equal(Math.round(Cesium.Cartographic.fromCartesian(corse.position).height), 0);

    // Every MEASURED région label is lifted to the top of its own prism, so the
    // number and the length it encodes are read in the same glance.
    for (const entry of regions.filter((row) => row.id !== 'energy-fr:region:94')) {
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
    assert.equal(stats.unpublishedRegions, 1, 'Corse is never published');
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
