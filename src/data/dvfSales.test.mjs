// src/data/dvfSales.test.mjs
//
// Two things are pinned here.
//
// 1. THE C1 CONFORMITY TEST, written verbatim in docs/CARTOGRAPHIE.md: "cadrer
//    une zone, capturer ; élargir le cadrage pour faire entrer des valeurs
//    extrêmes ; la zone initiale a-t-elle changé de couleur ?" It must answer
//    no. Until 2026-09-03 it answered yes, and the fixture below reproduces the
//    old behaviour before proving the new one.
//
// 2. THE BUILDING THEME: what one volume says when several sales landed on it,
//    what it says when the last of them cannot be priced, and that the layer
//    hands the volumes back when it is switched off.
//
// Runs under plain `node --test`: the colour arithmetic, the reduction and the
// registry are all pure, and the layer's own module imports Cesium without
// needing a GPU.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  communeReference,
  groupMutations,
  parseDvfCsv,
  percentile,
  selectNearbySales,
} from './dvfFeed.js';
import {
  BUILDING_THEME_MIN_DELTA_E,
  clearAllBuildingThemes,
  deltaE76,
  getActiveBuildingTheme,
  parseCssRgb,
  registerBuildingTheme,
  resolveBuildingThemePaint,
  unknownBuildingCss,
} from './buildingTheme.js';
import { BDTOPO_USAGE_TIERS } from './bdtopoBuildingsFeed.js';
import dvfSalesLayer, {
  COLOR_NO_BASIS,
  COLOR_NO_RATIO,
  DVF_LAYER_ID,
  DVF_RATIO_BREAKS,
  DVF_RATIO_CLASSES,
  DVF_THEME_PRECEDENCE,
  _dvfSetThemePayloadForTest,
  _dvfWithdrawIfDormantForTest,
  dvfLegendEntries,
  dvfMostRecentSale,
  dvfReference,
  dvfYearsLabel,
  saleColorCss,
  saleRatioClass,
  saleRatioPrice,
} from './dvfSales.js';

const CSV = readFileSync(new URL('./fixtures/dvf-75113-2024-sample.csv', import.meta.url), 'utf8');
const MUTATIONS = groupMutations(parseDvfCsv(CSV));

/** Avenue de France, Paris 13e — the point the fixture was captured around. */
const AVENUE_DE_FRANCE = { lon: 2.3760, lat: 48.8300 };
/** Rue de Tolbiac, 1.5 km west, same arrondissement, same editions. */
const TOLBIAC = { lon: 2.35443, lat: 48.822897 };
/** Boulevard Auguste-Blanqui, 1.9 km north-west, still Paris 13e. */
const BLANQUI = { lon: 2.348481, lat: 48.835292 };

/** Build the payload shape the proxy serves, for a given origin and radius. */
function payloadFor(origin, radiusM, years = [2024]) {
  const { sales, summary } = selectNearbySales(MUTATIONS, origin, radiusM);
  return {
    commune: { code: '75113', name: 'Paris' }, years, sales, summary,
  };
}

/* ── C1: the denominator no longer moves with the camera ─────────────────── */

test('the commune median is the same number from three points and three radii', () => {
  const seen = new Set();
  for (const origin of [AVENUE_DE_FRANCE, TOLBIAC, BLANQUI]) {
    for (const radius of [50, 300, 1000]) {
      const reference = dvfReference(payloadFor(origin, radius));
      seen.add(reference.medianPrixM2);
      assert.equal(reference.basis, 'commune');
      // Named, not just stable: the number is useless to a reader who cannot
      // say what territory it belongs to.
      assert.equal(reference.name, 'Paris 13e Arrondissement');
      assert.equal(reference.code, '75113');
    }
  }
  assert.deepEqual([...seen], [8956], 'one denominator for nine framings');
});

test('C1 — widening the framing does not repaint a sale', () => {
  // The doctrine's own test, on a synthetic commune because the captured sample
  // is too thin to hold two price regimes inside the 1 km radius ceiling: a
  // cheap block at the origin, a dear one 800 m away that a wider radius pulls
  // in. Prices are Paris-scale so the ratios are the ones the ramp really sees.
  const near = [4000, 4200, 4600].map((prixM2, i) => ({
    id: `near-${i}`, prixM2, lon: 2.30, lat: 48.85, commune: 'Testville', communeCode: '99999',
  }));
  const far = [16000, 16500, 17000, 17500].map((prixM2, i) => ({
    id: `far-${i}`, prixM2, lon: 2.3098, lat: 48.85, commune: 'Testville', communeCode: '99999',
  }));
  const all = [...near, ...far];
  const origin = { lon: 2.30, lat: 48.85 };

  const tight = selectNearbySales(all, origin, 300);
  const wide = selectNearbySales(all, origin, 1000);
  assert.equal(tight.sales.length, 3);
  assert.equal(wide.sales.length, 7, 'the wider framing really does bring the extremes in');

  // THE OLD RULE — the median of what is on screen — flipped the colour of a
  // sale that had not changed. This is the regression being fixed, asserted so
  // that nobody reintroduces the "local median" argument without seeing it.
  const oldTight = saleColorCss(4600, tight.summary.medianPrixM2);
  const oldWide = saleColorCss(4600, wide.summary.medianPrixM2);
  assert.notEqual(oldTight, oldWide);
  assert.equal(oldTight, '#ffb03d', '4 600 €/m² was "+5 to +25 %" against a 4 200 local median');
  assert.equal(oldWide, '#3dd6c4', 'and "more than 25 % below" once the dear block entered the view');

  // THE NEW RULE. Same sale, same colour, whatever the framing.
  const tightRef = dvfReference({ summary: tight.summary, commune: null, years: [2024] });
  const wideRef = dvfReference({ summary: wide.summary, commune: null, years: [2024] });
  assert.equal(tightRef.medianPrixM2, wideRef.medianPrixM2);
  assert.equal(
    saleColorCss(4600, tightRef.medianPrixM2),
    saleColorCss(4600, wideRef.medianPrixM2),
  );
  // And every one of the seven keeps its class across both framings.
  for (const sale of all) {
    assert.equal(
      saleColorCss(sale.prixM2, tightRef.medianPrixM2),
      saleColorCss(sale.prixM2, wideRef.medianPrixM2),
      `${sale.id} must not change colour when the framing does`,
    );
  }
});

test('the old denominator painted both extremes of the arrondissement "average"', () => {
  // Measured on the real fixture, and the reason this was not a theoretical
  // objection: park the camera on the dearest sale of the sample and the local
  // median IS that sale, so it came out at 1.00 and was drawn yellow — the same
  // yellow as the cheapest sale, for the same reason, 1.9 km away.
  for (const [origin, prixM2] of [[TOLBIAC, 12406], [BLANQUI, 6797]]) {
    const { summary } = selectNearbySales(MUTATIONS, origin, 300);
    assert.equal(summary.medianPrixM2, prixM2, 'a median of one sale is that sale');
    assert.equal(saleColorCss(prixM2, summary.medianPrixM2), '#ffe066', 'painted "at the median"');
  }
  const reference = dvfReference(payloadFor(AVENUE_DE_FRANCE, 300));
  assert.equal(saleColorCss(12406, reference.medianPrixM2), '#ff6b4a', '1,39 × the commune → red');
  assert.equal(saleColorCss(6797, reference.medianPrixM2), '#7ed957', '0,76 × the commune → green');
});

test('the six comparables of the fixture spread across four classes, not one', () => {
  const median = communeReference(MUTATIONS).medianPrixM2;
  const classes = [6797, 7182, 8857, 9054, 10464, 12406]
    .map((price) => saleRatioClass(price, median).id);
  assert.deepEqual(classes, ['low', 'low', 'at-median', 'at-median', 'high', 'very-high']);
});

test('the class breaks are frozen ratios, never quantiles of the sample', () => {
  assert.deepEqual([...DVF_RATIO_BREAKS], [1.25, 1.05, 0.95, 0.75]);
  assert.deepEqual(DVF_RATIO_CLASSES.map((entry) => entry.min), [1.25, 1.05, 0.95, 0.75, -Infinity]);
  assert.ok(Object.isFrozen(DVF_RATIO_CLASSES) && Object.isFrozen(DVF_RATIO_CLASSES[0]));
  // A quantile classification would put ~20 % of the sample in each class. The
  // fixture's six comparables do not, and must not.
  const median = communeReference(MUTATIONS).medianPrixM2;
  const counts = new Map();
  for (const price of [6797, 7182, 8857, 9054, 10464, 12406]) {
    const id = saleRatioClass(price, median).id;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  assert.equal(counts.get('very-low') ?? 0, 0, 'an empty class stays empty rather than being filled');
});

/* ── A1: three outcomes, three signs ─────────────────────────────────────── */

test('a price, an unpriceable sale and a missing denominator are three colours', () => {
  const median = 8956;
  assert.equal(saleColorCss(9054, median), '#ffe066');
  assert.equal(saleColorCss(null, median), COLOR_NO_RATIO);
  assert.equal(saleColorCss(9054, null), COLOR_NO_BASIS);
  const distinct = new Set([saleColorCss(9054, median), COLOR_NO_RATIO, COLOR_NO_BASIS]);
  assert.equal(distinct.size, 3);
});

test('a mutation declared at €0 is not a bargain, it is an absence of price', () => {
  assert.equal(saleRatioPrice({ prixM2: 0 }), null);
  assert.equal(saleRatioPrice({ prixM2: null }), null);
  assert.equal(saleRatioPrice({ prixM2: 9054 }), 9054);
  assert.equal(saleColorCss(0, 8956), COLOR_NO_RATIO, 'never painted "25 % below the commune"');
});

test('no denominator implies nothing on screen to colour — the fallback is unreachable', () => {
  // The claim the header makes, asserted rather than trusted: the served sales
  // are a subset of the mutations the reference is computed from, so a commune
  // with no comparable cannot serve a sale that has one.
  const unpriceable = MUTATIONS.map((mutation) => ({ ...mutation, prixM2: null }));
  const reference = communeReference(unpriceable);
  assert.equal(reference.basis, 'none');
  assert.equal(reference.medianPrixM2, null);
  const { sales } = selectNearbySales(unpriceable, AVENUE_DE_FRANCE, 1000);
  assert.ok(sales.length > 0, 'sales are still drawn — they happened');
  for (const sale of sales) {
    assert.equal(saleRatioPrice(sale), null);
    assert.equal(saleColorCss(saleRatioPrice(sale), reference.medianPrixM2), COLOR_NO_RATIO);
  }
});

test('every colour this layer paints stays clear of the "no data" wash', () => {
  // The volumes are shared with `buildingTheme.js`, whose whole A1 argument is
  // that an unjoined volume cannot be mistaken for a graded one. That holds for
  // the wash AND for its height shading, which darkens it by up to 42 %.
  const references = [];
  for (const tier of BDTOPO_USAGE_TIERS) {
    const washed = parseCssRgb(unknownBuildingCss(tier.color));
    for (let percent = 0; percent <= 42; percent += 1) {
      references.push(washed.map((channel) => channel * (1 - percent / 100)));
    }
  }
  const palette = [...DVF_RATIO_CLASSES.map((entry) => entry.color), COLOR_NO_RATIO, COLOR_NO_BASIS];
  for (const css of palette) {
    const rgb = parseCssRgb(css);
    const worst = Math.min(...references.map((reference) => deltaE76(rgb, reference)));
    assert.ok(worst > BUILDING_THEME_MIN_DELTA_E, `${css} is ΔE76 ${worst.toFixed(1)} from a wash`);
  }
  // The measurement that moved the neutral: the previous `#7c8aa0` sat exactly
  // on the threshold, which is why it is not the colour any more.
  const old = Math.min(...references.map((reference) => deltaE76(parseCssRgb('#7c8aa0'), reference)));
  assert.ok(old <= BUILDING_THEME_MIN_DELTA_E, `#7c8aa0 measured ΔE76 ${old.toFixed(1)}`);
});

test('adjacent classes of the ramp stay separable (B3)', () => {
  for (let i = 1; i < DVF_RATIO_CLASSES.length; i += 1) {
    const distance = deltaE76(
      parseCssRgb(DVF_RATIO_CLASSES[i - 1].color),
      parseCssRgb(DVF_RATIO_CLASSES[i].color),
    );
    assert.ok(distance > 10, `${DVF_RATIO_CLASSES[i].id} is ΔE76 ${distance.toFixed(1)} from its neighbour`);
  }
});

/* ── D1: the legend names the denominator ────────────────────────────────── */

test('the legend prints the denominator, its territory and how many sales made it', () => {
  const payload = payloadFor(AVENUE_DE_FRANCE, 300);
  const reference = dvfReference(payload);
  const entries = dvfLegendEntries(reference, new Map([['at-median', 2], ['low', 1]]));
  const head = entries[0];
  assert.match(head.label, /Paris 13e Arrondissement/);
  assert.match(head.label, /8\D?956/, 'the number itself, not only the word "médian"');
  assert.equal(head.count, 6, 'the median was computed from six comparable mutations');
  assert.match(head.blurb, /C1/);
  // Every ramp class restates its bounds in €/m², so the key can be compared to
  // a listing and not only to itself.
  const atMedian = entries.find((entry) => entry.color === '#ffe066');
  assert.match(atMedian.label, /8\D?508/);
  assert.match(atMedian.label, /9\D?404/);
  assert.equal(atMedian.count, 2);
  // Every entry carries a count: the panel prints one whether or not it is
  // supplied, and an absent one renders "undefined".
  for (const entry of entries) assert.equal(typeof entry.count, 'number');
});

test('the legend hands the counts to the theme rather than inventing them', () => {
  const reference = dvfReference(payloadFor(AVENUE_DE_FRANCE, 300));
  const forTheme = dvfLegendEntries(reference);
  // Ramp swatches carry no count so `resolveBuildingThemePaint` can fill them
  // with VOLUMES; the reference line carries its own because it counts
  // mutations, which no colour match could recover.
  assert.equal(forTheme[0].count, 6);
  for (const entry of forTheme.slice(1)) {
    assert.equal(entry.count, undefined, `${entry.label} must be counted by the theme`);
  }
});

test('an absent reference block says so instead of borrowing the local median', () => {
  const legacy = { commune: { code: '75113', name: 'Paris' }, years: [2024], sales: [], summary: { medianPrixM2: 8857 } };
  const reference = dvfReference(legacy);
  assert.equal(reference.basis, 'absent');
  assert.equal(reference.medianPrixM2, null);
  assert.notEqual(reference.medianPrixM2, 8857);
  assert.match(reference.label, /indisponible/);
});

test('the editions the denominator covers are named', () => {
  assert.equal(dvfYearsLabel([2024]), 'édition 2024');
  assert.equal(dvfYearsLabel([2024, 2023, 2022]), 'éditions 2022 à 2024');
  assert.equal(dvfYearsLabel([2024, 2021]), 'éditions 2021, 2024');
  assert.equal(dvfYearsLabel([]), null);
});

/* ── A5: what was clipped, what could not be placed ──────────────────────── */

test('the row declares the clipped count and the mutations with no coordinate', () => {
  const payload = payloadFor(AVENUE_DE_FRANCE, 1000);
  const controls = dvfSalesLayer.getRowControls?.call(null);
  assert.equal(controls, null, 'nothing published while the layer has never scanned');

  // The fixture holds exactly one mutation the register publishes without a
  // coordinate — it has a price (10 464 €/m²) and cannot be drawn.
  const reference = dvfReference(payload);
  assert.equal(reference.unplacedCount, 1);
  const entries = dvfLegendEntries(reference, new Map());
  assert.equal(entries.some((entry) => /sans coordonnée/.test(entry.label)), false,
    'the unplaced line is added by the layer row, not by the ramp builder');
});

/* ── the building theme ──────────────────────────────────────────────────── */

test('the theme registers at precedence 20 and withdraws when the layer stops', () => {
  clearAllBuildingThemes();
  const payload = payloadFor(AVENUE_DE_FRANCE, 300);
  assert.equal(_dvfSetThemePayloadForTest(payload), true);
  const theme = getActiveBuildingTheme();
  assert.equal(theme.id, DVF_LAYER_ID);
  assert.equal(theme.precedence, DVF_THEME_PRECEDENCE);
  assert.equal(theme.points.length, payload.sales.length);
  // Scope, not a verdict on the market: the scan covers 300 m, the volumes
  // cover kilometres, so an unpainted volume is usually one nobody asked about.
  assert.equal(theme.unknownLabel, 'hors du rayon de 300 m ou sans mutation');
  assert.doesNotMatch(theme.unknownLabel, /^sans mutation/);

  // A theme with a lower precedence takes the volumes; DVF does not blend in.
  registerBuildingTheme({
    id: 'dpe-fr', label: 'DPE', precedence: 10, points: [], reduce: () => null, colorFor: () => null,
  });
  assert.equal(getActiveBuildingTheme().id, 'dpe-fr');

  // Switching the layer off hands the volumes back rather than leaving the city
  // painted by a layer nobody can see.
  assert.equal(_dvfSetThemePayloadForTest(null, false), false);
  assert.equal(getActiveBuildingTheme().id, 'dpe-fr');
  clearAllBuildingThemes();
});

test('a volume speaks for its most recent mutation, whatever that mutation says', () => {
  const older = { id: 'a', date: '2022-03-01', prixM2: 12000, dwellingSurface: 40 };
  const newer = { id: 'b', date: '2024-07-15', prixM2: 8000, dwellingSurface: 55 };
  assert.equal(dvfMostRecentSale([older, newer]).id, 'b');
  assert.equal(dvfMostRecentSale([newer, older]).id, 'b', 'order of arrival must not decide');

  // A median of the two would publish 10 000 €/m² — a price nobody paid, at a
  // date that does not exist.
  const median = percentile([8000, 12000], 0.5);
  assert.equal(median, 10000);
  assert.notEqual(dvfMostRecentSale([older, newer]).prixM2, median);

  // And the most recent one wins even when it cannot be priced: falling back to
  // the older comparable would present a 2022 price as today's.
  const blockSale = { id: 'c', date: '2024-11-02', prixM2: null, dwellingSurface: 0 };
  assert.equal(dvfMostRecentSale([older, blockSale]).id, 'c');
  assert.equal(saleColorCss(saleRatioPrice(dvfMostRecentSale([older, blockSale])), 8956),
    COLOR_NO_RATIO);
});

test('ties are broken by surface then by id, never by concatenation order', () => {
  const small = { id: 'z', date: '2024-05-05', prixM2: 9000, dwellingSurface: 30 };
  const large = { id: 'a', date: '2024-05-05', prixM2: 7000, dwellingSurface: 90 };
  assert.equal(dvfMostRecentSale([small, large]).id, 'a');
  assert.equal(dvfMostRecentSale([large, small]).id, 'a');
  const twinA = { id: 'a', date: '2024-05-05', prixM2: 9000, dwellingSurface: 30 };
  const twinB = { id: 'b', date: '2024-05-05', prixM2: 7000, dwellingSurface: 30 };
  assert.equal(dvfMostRecentSale([twinA, twinB]).id, 'b');
  assert.equal(dvfMostRecentSale([twinB, twinA]).id, 'b');
});

test('the volumes and the markers are painted the same colour by the same rule', () => {
  clearAllBuildingThemes();
  const payload = payloadFor(AVENUE_DE_FRANCE, 300);
  _dvfSetThemePayloadForTest(payload);
  const theme = getActiveBuildingTheme();
  // Three sales at the same address in the fixture: one volume, the most recent
  // of the three, and the marker of that sale carries the same hex.
  const footprint = {
    id: 'BAT-1',
    degrees: [2.3750, 48.8298, 2.3752, 48.8298, 2.3752, 48.8302, 2.3750, 48.8302],
    holes: [],
  };
  const paint = resolveBuildingThemePaint([footprint], theme);
  assert.equal(paint.matchedPoints, 3);
  assert.equal(paint.painted, 1);
  const winner = dvfMostRecentSale(payload.sales.filter((sale) => sale.lon === 2.375086));
  const expected = saleColorCss(saleRatioPrice(winner), dvfReference(payload).medianPrixM2);
  assert.equal(paint.colorById.get('BAT-1'), expected);
  // The theme's legend was counted against what was actually painted.
  const painted = paint.legend.find((entry) => entry.color === expected);
  assert.equal(painted.count, 1);
  clearAllBuildingThemes();
});

test('a sale on no loaded footprint is counted, not swallowed (A5)', () => {
  clearAllBuildingThemes();
  const payload = payloadFor(AVENUE_DE_FRANCE, 1000);
  _dvfSetThemePayloadForTest(payload);
  const elsewhere = {
    id: 'BAT-9',
    degrees: [2.0, 48.0, 2.0001, 48.0, 2.0001, 48.0001, 2.0, 48.0001],
    holes: [],
  };
  const paint = resolveBuildingThemePaint([elsewhere], getActiveBuildingTheme());
  assert.equal(paint.painted, 0);
  assert.equal(paint.unmatchedPoints, payload.sales.length);
  assert.equal(paint.unplacedPoints, 0, 'the feed already drops coordinate-less mutations');
  clearAllBuildingThemes();
});

test('flying above the scan ceiling hands the volumes back', () => {
  // The shell clears its draw without calling `render` when the camera goes
  // dormant, so the theme has to be retracted from the one method that still
  // runs. Without this the volumes of the NEXT city would be told, in a
  // legend, that no sale was ever recorded there.
  clearAllBuildingThemes();
  _dvfSetThemePayloadForTest(payloadFor(AVENUE_DE_FRANCE, 300));
  assert.equal(getActiveBuildingTheme()?.id, DVF_LAYER_ID);
  _dvfWithdrawIfDormantForTest({ dormant: false });
  assert.equal(getActiveBuildingTheme()?.id, DVF_LAYER_ID, 'a live scan keeps painting');
  _dvfWithdrawIfDormantForTest({ dormant: true });
  assert.equal(getActiveBuildingTheme(), null);
  // Idempotent: a panel polling `getStats()` must not thrash the registry.
  _dvfWithdrawIfDormantForTest({ dormant: true });
  assert.equal(getActiveBuildingTheme(), null);
  clearAllBuildingThemes();
});

test('the wrapper keeps the shell contract the manager relies on', () => {
  // `manager.js` reads `enable()`/`disable()` as "anything but false means it
  // worked", and reads id/name/updateInterval off the module.
  assert.equal(dvfSalesLayer.id, DVF_LAYER_ID);
  assert.equal(dvfSalesLayer.name, 'Ventes immobilières (DVF)');
  assert.equal(typeof dvfSalesLayer.updateInterval, 'number');
  for (const method of ['init', 'enable', 'disable', 'destroy', 'update', 'getStats', 'getRowControls']) {
    assert.equal(typeof dvfSalesLayer[method], 'function', method);
  }
  // `disable()` itself needs a DOM (the shell removes a click handler), so the
  // theme half of it is exercised through the seam above; what is checked here
  // is that the wrapper did not shadow a method away.
  assert.equal(typeof dvfSalesLayer.getStats().count, 'number');
  assert.equal(dvfSalesLayer.getStats().dormant, false);
});
