// src/data/dpeFrance.test.mjs
//
// Six questions, in the order they can make the map lie:
//
//   1. does the reduce rule paint a letter that EXISTS on the building — never
//      a mean of letters, and never an invented one on a tie;
//   2. can a reader tell a painted volume from an unmeasured one, measured in
//      ΔE76 against every wash the BD TOPO palette can produce — and does the
//      module's own header tell the truth about where the official ramp FAILS;
//   3. does the theme reach the volumes, with its precedence, its legend and
//      its "no data" wording, and does it leave when the layer leaves;
//   4. are the badges a supplement and not a replacement — full size with the
//      volumes off, quiet only where the roof already says the same letter, and
//      never touched while selected;
//   5. is every diagnostic that reaches no volume counted rather than swallowed
//      (A5): no coordinate, no footprint, no published letter;
//   6. does the row say how wide the scan was against how wide the city is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  DPE_COLORS,
  DPE_THEME_ID,
  DPE_THEME_PRECEDENCE,
  _applyDpeBadgesForTest,
  _resetDpeThemeForTest,
  _seedDpeThemeForTest,
  dpeBuildingSummary,
  dpeCardDescription,
  dpeMarkerSizePx,
  dpeRowControls,
  dpeSummarize,
  dpeThemeLegend,
} from './dpeFrance.js';
import { DPE_LABELS } from './dpeFeed.js';
import {
  BUILDING_THEME_MIN_DELTA_E,
  cieLightness,
  clearAllBuildingThemes,
  deltaE76,
  getActiveBuildingTheme,
  parseCssRgb,
  registerBuildingTheme,
  unknownBuildingCss,
} from './buildingTheme.js';
import {
  _applyBdtopoThemeForTest,
  _bdtopoRowControlsForTest,
  _setBdtopoStateForTest,
} from './bdtopoBuildings.js';
import { BASE_SINK_M, BDTOPO_USAGE_TIERS } from './bdtopoBuildingsFeed.js';

/* ── fixtures ──────────────────────────────────────────────────────────── */

/** An axis-aligned rectangle as a closed `[lon, lat, ...]` ring. */
function box(id, west, south, east, north) {
  return {
    id,
    degrees: [west, south, east, south, east, north, west, north, west, south],
    holes: [],
    lat: (south + north) / 2,
    lon: (west + east) / 2,
  };
}

/** A drawable BD TOPO record around one footprint. */
function record(footprint, { color = '#e8b96a', heightM = 20 } = {}) {
  return {
    ...footprint,
    color,
    baseM: 100,
    topM: 100 + heightM + BASE_SINK_M,
    tierId: 'residential',
  };
}

/**
 * Three neighbouring blocks of Lyon, 111 m apart in longitude so nothing can
 * accidentally land in the wrong one.
 */
const BLOCK_A = box('A', 4.800, 45.750, 4.801, 45.751);
const BLOCK_B = box('B', 4.802, 45.750, 4.803, 45.751);
const BLOCK_C = box('C', 4.804, 45.750, 4.805, 45.751);

/** A point safely inside a ring. */
function inside(footprint, nudge = 0) {
  return {
    lon: footprint.degrees[0] + 0.0004 + nudge * 0.00001,
    lat: footprint.degrees[1] + 0.0005,
  };
}

/** One ADEME row as `projectDpe` shapes it. */
function dpe(id, letter, footprint, index = 0, extra = {}) {
  const point = footprint ? inside(footprint, index) : { lon: null, lat: null };
  return {
    id,
    etiquetteDpe: letter,
    etiquetteGes: null,
    address: `${id} rue de la Mesure`,
    banId: null,
    builtYear: null,
    surfaceM2: null,
    annualCostEur: null,
    consoKwhM2: null,
    gesKgM2: null,
    issuedOn: '2024-03-01',
    distanceM: 40,
    ...point,
    ...extra,
  };
}

/**
 * The payload of one scan: block A is a mixed block whose mode is D, block B is
 * a tie between C and E, block C has no diagnostic at all, and three rows fail
 * to reach a volume in each of the three ways the seam counts separately.
 */
function scanEntries() {
  return [
    dpe('a1', 'D', BLOCK_A, 0),
    dpe('a2', 'D', BLOCK_A, 1),
    dpe('a3', 'D', BLOCK_A, 2),
    dpe('a4', 'F', BLOCK_A, 3),
    dpe('a5', null, BLOCK_A, 4),
    dpe('b1', 'C', BLOCK_B, 0),
    dpe('b2', 'C', BLOCK_B, 1),
    dpe('b3', 'E', BLOCK_B, 2),
    dpe('b4', 'E', BLOCK_B, 3),
    // Geocoded to the middle of the street: a real diagnostic on no building.
    dpe('street', 'G', null, 0, { lon: 4.9, lat: 45.75 }),
    // No coordinate at all, which is a different admission.
    dpe('nowhere', 'G', null),
  ];
}

/** Seed the volume layer with the three blocks. */
function seedBuildings(footprints = [BLOCK_A, BLOCK_B, BLOCK_C]) {
  const records = new Map();
  for (const footprint of footprints) records.set(footprint.id, record(footprint));
  _setBdtopoStateForTest({ records });
}

/** A data source that answers `getById` the way Cesium's does. */
function fakeDataSource(entries) {
  const byId = new Map();
  for (const entry of entries) {
    if (!Number.isFinite(entry.lon)) continue;
    const size = entry.etiquetteDpe ? 20 : 16;
    byId.set(`dpe:${entry.id}`, new Cesium.Entity({
      id: `dpe:${entry.id}`,
      billboard: { width: size, height: size },
    }));
  }
  return { byId, entities: { getById: (id) => byId.get(id) || undefined } };
}

/** The width a badge is currently drawn at. */
function widthOf(source, id) {
  const billboard = source.byId.get(`dpe:${id}`)?.billboard;
  return Number(billboard?.width?.getValue?.(Cesium.JulianDate.now()) ?? billboard?.width);
}

function reset() {
  _resetDpeThemeForTest();
  clearAllBuildingThemes();
  _setBdtopoStateForTest({ records: new Map() });
}

/* ── 1. the rule ───────────────────────────────────────────────────────── */

/**
 * The whole reason this layer needed a rule of its own. The module header of
 * `dpeFeed.js` has always said the mean of a street's letters is not a property
 * of the street; a building is a smaller street and the sentence still holds.
 */
test('the painted letter is one the building actually holds', () => {
  const summary = dpeBuildingSummary([
    { etiquetteDpe: 'B' }, { etiquetteDpe: 'B' }, { etiquetteDpe: 'F' },
  ]);
  assert.equal(summary.grade, 'B', 'the mode, not the mean');
  assert.equal(summary.votes, 2);
  assert.equal(summary.best, 'B');
  assert.equal(summary.worst, 'F');
  assert.equal(summary.spread, 4);
  assert.equal(summary.mixed, true);
  // The arithmetic mean of B(1) and F(5) over three rows is D — a letter no
  // diagnostic on this building ever carried.
  assert.notEqual(summary.grade, 'D');
});

test('a tie goes to the worse letter, whatever order the register sent', () => {
  const forwards = dpeBuildingSummary([
    { etiquetteDpe: 'C' }, { etiquetteDpe: 'C' }, { etiquetteDpe: 'E' }, { etiquetteDpe: 'E' },
  ]);
  const backwards = dpeBuildingSummary([
    { etiquetteDpe: 'E' }, { etiquetteDpe: 'C' }, { etiquetteDpe: 'E' }, { etiquetteDpe: 'C' },
  ]);
  assert.equal(forwards.grade, 'E');
  assert.equal(backwards.grade, 'E', 'row order cannot move the paint');
});

test('a building with no published letter is not graded at all', () => {
  const summary = dpeBuildingSummary([{ etiquetteDpe: null }, { etiquetteDpe: '' }]);
  assert.equal(summary.grade, null);
  assert.equal(summary.graded, 0);
  assert.equal(summary.ungraded, 2);
  assert.equal(summary.total, 2);
  assert.equal(summary.mixed, false);
});

test('an unpublishable letter is refused rather than snapped to the nearest', () => {
  const summary = dpeBuildingSummary([{ etiquetteDpe: 'H' }, { etiquetteDpe: 'D' }]);
  assert.equal(summary.grade, 'D');
  assert.equal(summary.graded, 1);
  assert.equal(summary.ungraded, 1, 'H is counted as ungraded, never folded into G');
});

test('ungraded diagnostics do not dilute the mode', () => {
  const summary = dpeBuildingSummary([
    { etiquetteDpe: null }, { etiquetteDpe: null }, { etiquetteDpe: 'D' },
  ]);
  assert.equal(summary.grade, 'D');
  assert.equal(summary.votes, 1);
  assert.equal(summary.total, 3);
});

/* ── 2. the palette against "nobody measured this one" (A1) ────────────── */

/**
 * The washes an unjoined volume can actually take: every BD TOPO usage colour,
 * washed by `unknownBuildingCss`, then darkened by the height shading the
 * volume layer keeps on unpainted volumes — `darken(0.42 * (1 - t))`, t in
 * 0..1, so the factor runs 0.42 at ground level to 0 at 38 m.
 */
function washColours() {
  const out = [];
  for (const tier of BDTOPO_USAGE_TIERS) {
    const washed = parseCssRgb(unknownBuildingCss(tier.color));
    for (const factor of [0, 0.21, 0.42]) {
      out.push(washed.map((channel) => Math.round(channel * (1 - factor))));
    }
  }
  return out;
}

test('no DPE class can be read as an unmeasured volume', () => {
  const washes = washColours();
  let worst = Infinity;
  for (const letter of DPE_LABELS) {
    const rgb = parseCssRgb(DPE_COLORS[letter]);
    for (const wash of washes) worst = Math.min(worst, deltaE76(rgb, wash));
  }
  assert.ok(
    worst >= BUILDING_THEME_MIN_DELTA_E,
    `closest class to a wash is ΔE76 ${worst.toFixed(1)}, under the `
      + `${BUILDING_THEME_MIN_DELTA_E} the seam asks for`,
  );
  // The number the module header quotes. Locked so a palette edit anywhere has
  // to come back and re-argue it.
  assert.ok(worst > 58 && worst < 59, `expected ~58.5, measured ${worst.toFixed(1)}`);
});

/**
 * The half of the official palette that does NOT work, asserted so the header
 * cannot quietly stop being true. B and F are the same grey; that is why the
 * badge draws the letter as a SHAPE and why it is kept when the volume is
 * painted.
 */
test('the official ramp fails the greyscale test, and the badge is why that is survivable', () => {
  const lightness = Object.fromEntries(
    DPE_LABELS.map((letter) => [letter, cieLightness(parseCssRgb(DPE_COLORS[letter]))]),
  );
  assert.ok(
    Math.abs(lightness.B - lightness.F) < 1,
    'B and F should be indistinguishable in grey, measured '
      + `${Math.abs(lightness.B - lightness.F).toFixed(1)} L*`,
  );
  assert.ok(lightness.C < lightness.D, 'the ramp climbs to D...');
  assert.ok(lightness.E < lightness.D, '...and comes back down, so it is not a ladder');
});

/* ── 3. the theme reaches the volumes, and leaves ──────────────────────── */

test('the theme registers with its precedence and its own no-data wording', (t) => {
  t.after(reset);
  reset();
  seedBuildings();
  _seedDpeThemeForTest(scanEntries());

  const active = getActiveBuildingTheme();
  assert.equal(active.id, DPE_THEME_ID);
  assert.equal(active.precedence, DPE_THEME_PRECEDENCE);
  assert.equal(active.precedence, 10);
  assert.equal(active.unknownLabel, 'sans DPE dans le rayon scanné');
});

test('a theme that outranks DPE takes the map, and DPE takes it back', (t) => {
  t.after(reset);
  reset();
  seedBuildings();
  _seedDpeThemeForTest(scanEntries());

  registerBuildingTheme({
    id: 'rival-low',
    label: 'Rival',
    precedence: 20,
    points: [],
    reduce: () => 1,
    colorFor: () => '#ffffff',
  });
  assert.equal(getActiveBuildingTheme().id, DPE_THEME_ID, 'precedence 10 beats 20');

  registerBuildingTheme({
    id: 'rival-high',
    label: 'Rival',
    precedence: 5,
    points: [],
    reduce: () => 1,
    colorFor: () => '#ffffff',
  });
  assert.equal(getActiveBuildingTheme().id, 'rival-high', 'and loses to 5');
});

test('the volumes take the letter, and the ones nobody diagnosed do not', (t) => {
  t.after(reset);
  reset();
  seedBuildings();
  _seedDpeThemeForTest(scanEntries());

  const { paint } = _applyBdtopoThemeForTest();
  assert.equal(paint.themeId, DPE_THEME_ID);
  assert.equal(paint.colorById.get('A'), DPE_COLORS.D, 'the mode of block A');
  assert.equal(paint.colorById.get('B'), DPE_COLORS.E, 'the tie, resolved pessimistically');
  assert.equal(paint.colorById.has('C'), false, 'no diagnostic, no grade');
  assert.equal(paint.painted, 2);
  assert.equal(paint.unpainted, 1);
  assert.equal(paint.buildings, 3);
});

test('the legend carries all seven rungs, counted, even the empty ones', (t) => {
  t.after(reset);
  reset();
  seedBuildings();
  _seedDpeThemeForTest(scanEntries());
  const { paint } = _applyBdtopoThemeForTest();

  const rows = paint.legend.filter((row) => DPE_LABELS.includes(row.label));
  assert.equal(rows.length, 7, 'a frozen domain scale is published whole (C1)');
  assert.equal(rows.find((row) => row.label === 'D').count, 1);
  assert.equal(rows.find((row) => row.label === 'E').count, 1);
  assert.equal(rows.find((row) => row.label === 'A').count, 0, 'an empty rung stays on the ladder');

  // What the reader actually sees: the volume layer's own row, which replaces
  // its six usage bands with this ramp and appends the wording for a volume the
  // theme could not speak about.
  const { legend } = _bdtopoRowControlsForTest();
  const unknown = legend.find((row) => row.label === 'sans DPE dans le rayon scanné');
  assert.equal(unknown.count, 1, 'block C, loaded and never diagnosed');
  const stray = legend.find((row) => row.label === 'points sans bâtiment');
  assert.equal(stray.count, 2, 'the street row and the row with no coordinate');
});

test('the legend names the blocks whose diagnostics disagree', () => {
  const legend = dpeThemeLegend([
    { grade: 'D', mixed: true }, { grade: 'D', mixed: false }, { grade: 'E', mixed: false },
  ]);
  const d = legend.find((row) => row.label === 'D');
  const e = legend.find((row) => row.label === 'E');
  assert.equal(d.count, 2);
  assert.match(d.blurb, /1 immeuble peint D n'est pas unanime/);
  assert.equal(e.count, 1);
  assert.doesNotMatch(e.blurb, /unanime/, 'a class with no dispute says nothing about dispute');
});

test('a scan with nothing to paint leaves the city its own colours', (t) => {
  t.after(reset);
  reset();
  seedBuildings();
  _seedDpeThemeForTest([dpe('u1', null, BLOCK_A, 0), dpe('u2', null, BLOCK_B, 0)]);
  assert.equal(getActiveBuildingTheme(), null, 'no letter anywhere is not a grey city');
});

test('switching the layer off takes the paint with it', (t) => {
  t.after(reset);
  reset();
  seedBuildings();
  _seedDpeThemeForTest(scanEntries());
  assert.equal(getActiveBuildingTheme().id, DPE_THEME_ID);

  _resetDpeThemeForTest();
  assert.equal(getActiveBuildingTheme(), null);
  const { paint } = _applyBdtopoThemeForTest();
  assert.equal(paint, null, 'the volumes are back to their usage bands');
});

/* ── 4. the badge is a supplement, not a replacement ───────────────────── */

test('with the volumes off, every badge keeps the size it always had', (t) => {
  t.after(reset);
  reset();
  // No footprints seeded: this is `Bâti 3D` switched off.
  const entries = scanEntries();
  const source = fakeDataSource(entries);
  const join = _seedDpeThemeForTest(entries, { dataSource: source });
  _applyDpeBadgesForTest();

  assert.equal(join.buildings, 0);
  assert.equal(widthOf(source, 'a1'), 20, 'a published letter still draws at 20 px');
  assert.equal(widthOf(source, 'a5'), 16, 'and an unpublished one at 16');
});

test('a badge goes quiet only where the volume already says its letter', (t) => {
  t.after(reset);
  reset();
  seedBuildings();
  const entries = scanEntries();
  const source = fakeDataSource(entries);
  _seedDpeThemeForTest(entries, { dataSource: source });
  _applyDpeBadgesForTest();

  // Block A is painted D.
  assert.equal(widthOf(source, 'a1'), 12, 'agrees with the roof');
  assert.equal(widthOf(source, 'a4'), 20, 'the F on a D block is the dispersion, and stays');
  assert.equal(widthOf(source, 'a5'), 16, 'no letter published — the paint cannot say this');
  // Block B is painted E.
  assert.equal(widthOf(source, 'b1'), 20, 'the losing half of the tie keeps its badge');
  assert.equal(widthOf(source, 'b3'), 12);
  // Off every footprint: the volume says nothing about it.
  assert.equal(widthOf(source, 'street'), 20);
});

test('the selected badge is left exactly as the operator enlarged it', (t) => {
  t.after(reset);
  reset();
  seedBuildings();
  const entries = scanEntries();
  const source = fakeDataSource(entries);
  _seedDpeThemeForTest(entries, { dataSource: source });
  source.byId.get('dpe:a1').billboard.width = 26;
  source.byId.get('dpe:a1').billboard.height = 26;

  _applyDpeBadgesForTest('dpe:a1');
  assert.equal(widthOf(source, 'a1'), 26, 'a selection outranks the theme until Escape');
  assert.equal(widthOf(source, 'a2'), 12, 'its neighbours are still re-sized');
});

test('the size rule is one statement and reads the same everywhere', () => {
  assert.equal(dpeMarkerSizePx({ etiquetteDpe: 'D' }, null), 20);
  assert.equal(dpeMarkerSizePx({ etiquetteDpe: 'D' }, 'D'), 12);
  assert.equal(dpeMarkerSizePx({ etiquetteDpe: 'F' }, 'D'), 20);
  assert.equal(dpeMarkerSizePx({ etiquetteDpe: null }, 'D'), 16);
  assert.equal(dpeMarkerSizePx({ etiquetteDpe: null }, null), 16);
});

/* ── the card carries the range the colour cannot ──────────────────────── */

test('the card states the spread of the block, and never hides it behind the paint', (t) => {
  t.after(reset);
  reset();
  seedBuildings();
  const entries = scanEntries();
  const join = _seedDpeThemeForTest(entries);

  const mixed = dpeCardDescription(entries[0], join.byPoint.get('a1'), true);
  assert.match(mixed, /immeuble : 5 DPE, de D à F, volume peint D/);
  // The building line sits second, so the six-line card cap cannot drop it.
  assert.equal(mixed.split(' · ')[1].startsWith('immeuble'), true);

  const unanimous = dpeCardDescription(
    { etiquetteDpe: 'D', distanceM: 10 },
    dpeBuildingSummary([{ etiquetteDpe: 'D' }, { etiquetteDpe: 'D' }]),
    true,
  );
  assert.match(unanimous, /immeuble : 2 DPE, tous D/);

  const partial = dpeCardDescription(
    { etiquetteDpe: 'D', distanceM: 10 },
    dpeBuildingSummary([{ etiquetteDpe: 'D' }, { etiquetteDpe: null }]),
    true,
  );
  assert.match(partial, /1 en D, 1 sans étiquette/);
});

test('a diagnostic on no loaded footprint says so, and only when there were any', () => {
  const entry = { etiquetteDpe: 'G', distanceM: 12 };
  assert.match(dpeCardDescription(entry, null, true), /hors des emprises BD TOPO chargées/);
  assert.doesNotMatch(
    dpeCardDescription(entry, null, false),
    /hors des emprises/,
    'with the volumes off that sentence would be about Bâti 3D, not about the DPE',
  );
});

/* ── 5. everything that reaches no volume is counted (A5) ──────────────── */

test('the three ways a diagnostic misses a volume are counted apart', (t) => {
  t.after(reset);
  reset();
  seedBuildings();
  const join = _seedDpeThemeForTest(scanEntries());

  assert.equal(join.matchedPoints, 9, 'the nine rows inside a footprint');
  assert.equal(join.unmatchedPoints, 1, 'geocoded to the street');
  assert.equal(join.unplacedPoints, 1, 'no coordinate published at all');
  assert.equal(join.ungradedPoints, 1, 'present, and unable to paint anything');
  assert.equal(join.buildings, 3);
  assert.equal(join.painted, 2);
  assert.equal(join.mixed, 2, 'both painted blocks are summaries, not verdicts');
});

test('a row with an empty coordinate is never sent to sea', (t) => {
  t.after(reset);
  reset();
  seedBuildings();
  const join = _seedDpeThemeForTest([dpe('empty', 'D', null, 0, { lon: '', lat: '' })]);
  assert.equal(join.unplacedPoints, 1);
  assert.equal(join.unmatchedPoints, 0, 'Number("") is 0 and 0,0 is the Gulf of Guinea');
});

test('the stats publish painted over loaded, not just painted', (t) => {
  t.after(reset);
  reset();
  seedBuildings();
  const entries = scanEntries();
  _seedDpeThemeForTest(entries);
  const distribution = { D: 3, F: 1, C: 2, E: 2, G: 2 };
  const stats = dpeSummarize({ entries, total: 2805, distribution });

  assert.equal(stats.themePainting, true);
  assert.equal(stats.themePainted, 2);
  assert.equal(stats.themeBuildings, 3);
  assert.equal(stats.themeUnpainted, 1);
  assert.equal(stats.themeUnmatchedPoints, 1);
  assert.equal(stats.themeUnplacedPoints, 1);
  assert.equal(stats.themeUngradedPoints, 1);
});

/* ── 6. the row says how wide the scan was ─────────────────────────────── */

test('the coverage line states the truncation and the paint', (t) => {
  t.after(reset);
  reset();
  seedBuildings();
  const entries = scanEntries();
  _seedDpeThemeForTest(entries);

  const truncated = dpeSummarize({ entries, total: 2805, distribution: {} });
  assert.match(truncated.coverage, /11 DPE servis sur 2\s?805 dans 200 m/);
  assert.match(truncated.coverage, /les plus proches du centre/);
  assert.match(truncated.coverage, /2 volumes peints sur 3 chargés/);

  const whole = dpeSummarize({ entries, total: 11, distribution: {} });
  assert.doesNotMatch(whole.coverage, /servis sur/, 'nothing was dropped, so nothing is claimed');
});

test('with the volumes off the row says nothing about painting', (t) => {
  t.after(reset);
  reset();
  const entries = scanEntries();
  _seedDpeThemeForTest(entries);
  const stats = dpeSummarize({ entries, total: 11, distribution: {} });
  assert.equal(stats.themePainting, false);
  assert.doesNotMatch(stats.coverage, /peint/);
});

test('the row legend gives the grey badge the entry it never had', (t) => {
  t.after(reset);
  reset();
  seedBuildings();
  _seedDpeThemeForTest(scanEntries());

  const { legend } = dpeRowControls({ distribution: { D: 3, F: 1, C: 2, E: 2, G: 2 } });
  assert.equal(legend.length, 8, 'seven rungs and the absence of a rung');
  assert.equal(legend.find((row) => row.label === 'D').count, 3, 'this row counts DIAGNOSTICS');
  const ungraded = legend.find((row) => row.label === 'étiquette non publiée');
  assert.equal(ungraded.count, 1);
  assert.equal(ungraded.color, '#7c8aa0');
});
