// src/data/buildingTheme.test.mjs
//
// Five questions, in the order they can make the map lie:
//
//   1. does a point land on the right building — including the courtyard, the
//      party wall and the annexe drawn inside a bigger emprise;
//   2. does the join stay cheap enough to run on a camera move, PROVED by the
//      number of polygon tests rather than by a wall clock nobody can trust on
//      a shared machine;
//   3. when two thematic layers are on, does exactly ONE paint;
//   4. can a reader tell an unpainted volume from a badly-graded one — measured
//      in CIE L*, HSL saturation and ΔE76, the sRGB → linear → CIE chain
//      `choroplethAlpha.test.mjs` established for the choropleths;
//   5. with no theme registered, is the BD TOPO colour still the exact byte it
//      was before this module existed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  BUILDING_THEME_MIN_DELTA_E,
  BUILDING_THEME_UNKNOWN_MAX_LIGHTNESS,
  BUILDING_THEME_UNKNOWN_MAX_SATURATION,
  buildFootprintIndex,
  buildingThemeConflicts,
  cieLightness,
  clearAllBuildingThemes,
  clearBuildingTheme,
  deltaE76,
  getActiveBuildingTheme,
  joinPointsToBuildings,
  listBuildingThemes,
  locateBuilding,
  onBuildingThemeChange,
  parseCssRgb,
  pointInFootprint,
  registerBuildingTheme,
  resolveBuildingThemePaint,
  rgbToHsl,
  unknownBuildingCss,
} from './buildingTheme.js';
import {
  _applyBdtopoThemeForTest,
  _bdtopoRowControlsForTest,
  _bdtopoStatsForTest,
  _bdtopoVolumeColorForTest,
  _setBdtopoStateForTest,
  bdtopoLoadedFootprints,
} from './bdtopoBuildings.js';
import { BASE_SINK_M, BDTOPO_USAGE_TIERS } from './bdtopoBuildingsFeed.js';

/* ── fixtures ──────────────────────────────────────────────────────────── */

/** An axis-aligned rectangle as a closed `[lon, lat, ...]` ring. */
function box(id, west, south, east, north, holes = []) {
  return {
    id,
    degrees: [west, south, east, south, east, north, west, north, west, south],
    holes,
    lat: (south + north) / 2,
    lon: (west + east) / 2,
  };
}

/** A minimal drawable BD TOPO record. */
function record(id, { color = '#e8b96a', heightM = 20, ...rest } = {}) {
  return {
    id,
    color,
    baseM: 100,
    topM: 100 + heightM + BASE_SINK_M,
    degrees: [4.8, 45.75, 4.801, 45.75, 4.801, 45.751, 4.8, 45.751, 4.8, 45.75],
    holes: [],
    lat: 45.7505,
    lon: 4.8005,
    tierId: 'residential',
    ...rest,
  };
}

/** A theme skeleton: the caller only states what the test is about. */
function theme(id, overrides = {}) {
  return registerBuildingTheme({
    id,
    label: id.toUpperCase(),
    points: [],
    reduce: (points) => points.length,
    colorFor: () => '#fc0205',
    legend: [{ label: 'x', color: '#fc0205' }],
    ...overrides,
  });
}

/** The palettes the first thematic layers will bring, for the contrast test. */
const THEME_PALETTES = {
  // Official DPE label colours (arrêté du 31 mars 2021).
  'dpe-fr': ['#319834', '#33cc31', '#cbfc34', '#fbfe06', '#fbcc05', '#fc9935', '#fc0205'],
  // A divergent €/m² ramp against a commune median.
  'dvf-fr': ['#2166ac', '#67a9cf', '#d1e5f0', '#fddbc7', '#ef8a62', '#b2182b'],
  // Permit states: deposited, granted, started, finished, refused.
  'urbanisme-fr': ['#e8c34a', '#4ac0e8', '#4ae88a', '#8a7de8', '#e85d5d'],
};

/* ── 1. the join ───────────────────────────────────────────────────────── */

test('a point inside the footprint joins, a point outside does not', () => {
  const footprints = [box('a', 0, 0, 1, 1)];
  const join = joinPointsToBuildings(footprints, [
    { lon: 0.5, lat: 0.5, tag: 'in' },
    { lon: 2.5, lat: 0.5, tag: 'out' },
  ]);
  assert.deepEqual([...join.byBuilding.keys()], ['a']);
  assert.equal(join.byBuilding.get('a')[0].tag, 'in');
  assert.equal(join.matchedPoints, 1);
  assert.equal(join.unmatchedPoints, 1);
  assert.equal(join.matchedBuildings, 1);
});

test('a point in the courtyard is not in the building', () => {
  // BD TOPO keeps interior rings because dropping them welds a street front
  // into one block. A join that ignored them would hand the courtyard's own
  // diagnostic to the building wrapped around it.
  const hole = [0.4, 0.4, 0.6, 0.4, 0.6, 0.6, 0.4, 0.6, 0.4, 0.4];
  const footprints = [box('a', 0, 0, 1, 1, [hole])];
  assert.equal(pointInFootprint(footprints[0], 0.5, 0.5), false, 'in the courtyard');
  assert.equal(pointInFootprint(footprints[0], 0.2, 0.5), true, 'in the built part');
  const join = joinPointsToBuildings(footprints, [{ lon: 0.5, lat: 0.5 }]);
  assert.equal(join.matchedPoints, 0);
  assert.equal(join.unmatchedPoints, 1);
});

test('a party wall belongs to exactly one of the two buildings', () => {
  // The crossing test is half-open in latitude: west and south edges are inside,
  // east and north edges are not. Two footprints sharing a wall therefore never
  // both claim a point geocoded exactly onto it — and never both refuse it.
  const west = box('west', 0, 0, 1, 1);
  const east = box('east', 1, 0, 2, 1);
  assert.equal(pointInFootprint(west, 1, 0.5), false, 'the east edge is outside');
  assert.equal(pointInFootprint(east, 1, 0.5), true, 'the west edge is inside');
  assert.equal(pointInFootprint(west, 0, 0.5), true);
  const join = joinPointsToBuildings([west, east], [{ lon: 1, lat: 0.5 }]);
  assert.deepEqual([...join.byBuilding.keys()], ['east']);
  assert.equal(join.unmatchedPoints, 0);
});

test('a point in two footprints goes to the smaller one, whatever the order', () => {
  const big = box('big', 0, 0, 1, 1);
  const annexe = box('annexe', 0.4, 0.4, 0.6, 0.6);
  const point = { lon: 0.5, lat: 0.5 };
  assert.deepEqual([...joinPointsToBuildings([big, annexe], [point]).byBuilding.keys()], ['annexe']);
  assert.deepEqual([...joinPointsToBuildings([annexe, big], [point]).byBuilding.keys()], ['annexe'],
    'the tile order must not move a diagnostic from one volume to another');
});

test('two identical footprints — the same building drawn from two tiles — break the tie by id', () => {
  const a = box('bdtopo:x:7', 0, 0, 1, 1);
  const b = box('bdtopo:x:2', 0, 0, 1, 1);
  const point = { lon: 0.5, lat: 0.5 };
  assert.deepEqual([...joinPointsToBuildings([a, b], [point]).byBuilding.keys()], ['bdtopo:x:2']);
  assert.deepEqual([...joinPointsToBuildings([b, a], [point]).byBuilding.keys()], ['bdtopo:x:2']);
});

test('several points on one building is the normal case, and they all arrive', () => {
  const footprints = [box('a', 0, 0, 1, 1)];
  const points = [
    { lon: 0.2, lat: 0.2, grade: 'D' },
    { lon: 0.5, lat: 0.5, grade: 'G' },
    { lon: 0.8, lat: 0.8, grade: 'C' },
  ];
  const join = joinPointsToBuildings(footprints, points);
  assert.deepEqual(join.byBuilding.get('a').map((p) => p.grade), ['D', 'G', 'C'],
    'in the order the caller supplied them');
  assert.equal(join.matchedPoints, 3);
  assert.equal(join.matchedBuildings, 1);
});

test('a point with no coordinate is counted apart from a point that missed', () => {
  const join = joinPointsToBuildings([box('a', 0, 0, 1, 1)], [
    { lon: 0.5, lat: 0.5 },
    { lon: 9, lat: 9 },
    { lon: null, lat: 45 },
    { lat: 45 },
    { lon: Number.NaN, lat: Number.NaN },
  ]);
  assert.equal(join.matchedPoints, 1);
  assert.equal(join.unmatchedPoints, 1, 'geocoded, but on no building here');
  assert.equal(join.unplacedPoints, 3, 'never geocoded at all');
});

test('a degenerate footprint is dropped instead of poisoning the index', () => {
  const index = buildFootprintIndex([
    box('ok', 0, 0, 1, 1),
    { id: 'short', degrees: [0, 0, 1, 1], holes: [] },
    { id: 'nan', degrees: [0, 0, Number.NaN, 1, 1, 1, 0, 0], holes: [] },
    { degrees: [0, 0, 1, 0, 1, 1, 0, 0], holes: [] },
  ]);
  assert.equal(index.count, 1);
  assert.equal(locateBuilding(index, 0.5, 0.5), 'ok');
});

/* ── 2. the cost ───────────────────────────────────────────────────────── */

test('the join is indexed: 3 000 footprints × 200 points costs 200 polygon tests, not 600 000', () => {
  // The one figure that does not depend on the machine. A regression to the
  // naive nested loop shows up here as a number three orders of magnitude
  // bigger, long before anyone notices the dropped frames.
  const buildings = [];
  const cols = 55;
  const step = 0.02 / cols;
  for (let i = 0; i < 3000; i += 1) {
    const west = 4.8 + (i % cols) * step;
    const south = 45.75 + Math.floor(i / cols) * step;
    buildings.push(box(`b${i}`, west, south, west + step * 0.7, south + step * 0.7));
  }
  const points = [];
  for (let i = 0; i < 200; i += 1) {
    const target = buildings[(i * 13) % buildings.length];
    points.push({ lon: target.lon, lat: target.lat, value: i });
  }

  const started = performance.now();
  const join = joinPointsToBuildings(buildings, points);
  const elapsedMs = performance.now() - started;

  assert.equal(join.matchedPoints, 200);
  assert.equal(join.buildings, 3000);
  assert.ok(join.tests <= 4 * points.length,
    `${join.tests} polygon tests for ${points.length} points — the index stopped working`);
  // A wall-clock guard deliberately loose: this is the first heavy call in a
  // cold process and it measured 269 ms against 2.2 ms warm, so a tight bound
  // here would only test the JIT. The polygon-test count above is the real
  // assertion; this one is a floor under a catastrophic regression.
  assert.ok(elapsedMs < 2_000, `join took ${elapsedMs.toFixed(1)} ms`);
});

test('the grid holds a handful of buildings per cell, not a thousand', () => {
  const buildings = [];
  for (let i = 0; i < 900; i += 1) {
    const west = 4.8 + (i % 30) * 0.0005;
    const south = 45.75 + Math.floor(i / 30) * 0.0005;
    buildings.push(box(`b${i}`, west, south, west + 0.0003, south + 0.0003));
  }
  const index = buildFootprintIndex(buildings);
  let worst = 0;
  for (const bucket of index.cells.values()) worst = Math.max(worst, bucket.length);
  assert.ok(worst <= 8, `fullest cell holds ${worst} footprints`);
});

/* ── 3. the registry ───────────────────────────────────────────────────── */

test('the lowest precedence paints, and nothing is blended', (t) => {
  t.after(clearAllBuildingThemes);
  theme('dvf', { precedence: 20 });
  theme('dpe', { precedence: 10 });
  assert.equal(getActiveBuildingTheme().id, 'dpe');
  assert.deepEqual(listBuildingThemes().map((x) => x.id), ['dpe', 'dvf']);
  clearBuildingTheme('dpe');
  assert.equal(getActiveBuildingTheme().id, 'dvf', 'the loser takes over, it does not merge');
  clearBuildingTheme('dvf');
  assert.equal(getActiveBuildingTheme(), null);
});

test('an equal precedence is settled by registration order, not by Map iteration', (t) => {
  t.after(clearAllBuildingThemes);
  theme('first');
  theme('second');
  assert.equal(getActiveBuildingTheme().id, 'first');
  // And a refresh of the SAME theme does not take the map away from whoever is
  // already painting: a feed republishing its points every five minutes must not
  // reshuffle the legend.
  theme('second', { points: [{ lon: 1, lat: 1 }] });
  assert.equal(getActiveBuildingTheme().id, 'first');
  clearBuildingTheme('first');
  assert.equal(getActiveBuildingTheme().id, 'second');
  assert.equal(getActiveBuildingTheme().points.length, 1, 'the refresh was kept');
});

test('a theme without an aggregation rule is refused at registration', () => {
  assert.throws(() => registerBuildingTheme({ id: '', reduce: () => 1, colorFor: () => '#fff' }),
    /id is required/);
  assert.throws(() => registerBuildingTheme({ id: 'x', colorFor: () => '#fff' }),
    /reduce\(points\) is required/);
  assert.throws(() => registerBuildingTheme({ id: 'x', reduce: () => 1 }),
    /colorFor\(value\) is required/);
  assert.equal(getActiveBuildingTheme(), null, 'nothing half-registered survives');
});

test('registering and clearing notify whoever owns the volumes', (t) => {
  t.after(clearAllBuildingThemes);
  const seen = [];
  const off = onBuildingThemeChange((reason) => seen.push(reason));
  theme('dpe');
  theme('dpe', { points: [] });
  clearBuildingTheme('dpe');
  clearBuildingTheme('dpe');
  off();
  theme('after');
  assert.deepEqual(seen, ['register', 'update', 'clear'],
    'a clear that removed nothing is not a change, and an unsubscribed listener is silent');
});

/* ── aggregation is the theme's business ───────────────────────────────── */

test('the aggregation rule comes from the theme, and sees every point on the building', (t) => {
  t.after(clearAllBuildingThemes);
  const GRADES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
  const worstGrade = registerBuildingTheme({
    id: 'dpe-fr',
    label: 'Performance énergétique (DPE)',
    points: [
      { lon: 0.2, lat: 0.2, grade: 'C' },
      { lon: 0.8, lat: 0.8, grade: 'F' },
      { lon: 1.5, lat: 0.5, grade: 'A' },
    ],
    // "The worst diagnostic of the block", which is the question a DPE map is
    // asked; a median would hide the one flat that is heated through the wall.
    reduce: (points) => points.reduce((worst, p) => (GRADES.indexOf(p.grade) > GRADES.indexOf(worst)
      ? p.grade : worst), 'A'),
    colorFor: (grade) => THEME_PALETTES['dpe-fr'][GRADES.indexOf(grade)] || null,
    legend: GRADES.map((g, i) => ({ label: g, color: THEME_PALETTES['dpe-fr'][i] })),
    unknownLabel: 'sans diagnostic',
  });
  const footprints = [box('a', 0, 0, 1, 1), box('b', 1, 0, 2, 1), box('c', 2, 0, 3, 1)];
  const paint = resolveBuildingThemePaint(footprints, worstGrade);
  assert.equal(paint.colorById.get('a'), THEME_PALETTES['dpe-fr'][5], 'F beats C on building a');
  assert.equal(paint.valueById.get('b'), 'A');
  assert.equal(paint.painted, 2);
  assert.equal(paint.unpainted, 1, 'building c has no diagnostic and stays unpainted');
  assert.equal(paint.unknownLabel, 'sans diagnostic');
});

test('a theme that declines to grade leaves the volume unpainted rather than defaulting it', (t) => {
  t.after(clearAllBuildingThemes);
  const shy = theme('shy', {
    points: [{ lon: 0.5, lat: 0.5 }, { lon: 1.5, lat: 0.5 }, { lon: 2.5, lat: 0.5 }],
    reduce: (points) => (points[0].lon < 1 ? null : points[0].lon),
    colorFor: (value) => (value < 2 ? 'not a colour' : '#fc0205'),
  });
  const paint = resolveBuildingThemePaint(
    [box('a', 0, 0, 1, 1), box('b', 1, 0, 2, 1), box('c', 2, 0, 3, 1)], shy,
  );
  assert.equal(paint.painted, 1, 'a null value and an unparseable colour both mean "no paint"');
  assert.equal(paint.colorById.get('c'), '#fc0205');
  assert.equal(paint.unpainted, 2);
  assert.equal(paint.matchedPoints, 3, 'the points were still joined, and are still counted');
});

test('a theme that throws does not take the whole payload down', (t) => {
  t.after(clearAllBuildingThemes);
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...args) => warnings.push(args[0]);
  try {
    const broken = theme('broken', {
      points: [{ lon: 0.5, lat: 0.5 }, { lon: 1.5, lat: 0.5 }],
      reduce: (points) => { if (points[0].lon < 1) throw new Error('nope'); return 1; },
    });
    const paint = resolveBuildingThemePaint([box('a', 0, 0, 1, 1), box('b', 1, 0, 2, 1)], broken);
    assert.equal(paint.painted, 1);
  } finally {
    console.warn = realWarn;
  }
  assert.equal(warnings.length, 1);
});

test('a static legend is counted by matching its swatches against what was painted', (t) => {
  t.after(clearAllBuildingThemes);
  const graded = theme('graded', {
    points: [
      { lon: 0.5, lat: 0.5 }, { lon: 1.5, lat: 0.5 }, { lon: 2.5, lat: 0.5 },
    ],
    reduce: (points) => (points[0].lon < 2 ? 'G' : 'A'),
    colorFor: (grade) => (grade === 'G' ? '#fc0205' : '#319834'),
    legend: [{ label: 'A', color: '#319834' }, { label: 'G', color: '#FC0205' }],
  });
  const paint = resolveBuildingThemePaint(
    [box('a', 0, 0, 1, 1), box('b', 1, 0, 2, 1), box('c', 2, 0, 3, 1)], graded,
  );
  // The panel prints a count beside every swatch whether the layer gave one or
  // not, so "no count" would render as a confident zero on a class that is on
  // screen. Case-insensitive, because a palette written in two files is written
  // in two cases.
  assert.deepEqual(paint.legend.map((entry) => [entry.label, entry.count]), [['A', 1], ['G', 2]]);
});

test('the legend follows the paint, with live counts when the theme offers them', (t) => {
  t.after(clearAllBuildingThemes);
  const counted = theme('counted', {
    points: [{ lon: 0.5, lat: 0.5 }, { lon: 0.6, lat: 0.6 }, { lon: 1.5, lat: 0.5 }],
    reduce: (points) => points.length,
    colorFor: () => '#fc0205',
    legendFor: (values) => [{ label: 'peints', color: '#fc0205', count: values.length }],
  });
  const paint = resolveBuildingThemePaint([box('a', 0, 0, 1, 1), box('b', 1, 0, 2, 1)], counted);
  assert.deepEqual(paint.legend, [{ label: 'peints', color: '#fc0205', count: 2 }]);
});

/* ── 4. "no data" cannot be read as a class ────────────────────────────── */

test('an unjoined volume is far from every class of every intended theme', () => {
  // The measurement A1 demands, run the way `choroplethAlpha.test.mjs` runs it:
  // sRGB → linear → CIE. Two differences with the choropleth case. There is no
  // compositing — these volumes are opaque, because an alpha below 1 would move
  // them into Cesium's translucent pass and a city would render as one mass. And
  // L* alone is not enough: DVF's cold end `#2166ac` sits only 8.5 L* above the
  // brightest wash and is still in no danger of being read as "no data", because
  // what separates them is chroma. So the assertion is ΔE, with L* and
  // saturation asserted separately for the record.
  const unknowns = [];
  for (const tier of BDTOPO_USAGE_TIERS) {
    const washed = parseCssRgb(unknownBuildingCss(tier.color));
    // Both ends of the height shading an unpainted volume keeps: a 4 m shed is
    // darkened 0.42, a 38 m block not at all.
    for (const darken of [0.42, 0]) {
      unknowns.push({ tier: tier.id, rgb: washed.map((c) => c * (1 - darken)) });
    }
  }
  const lightnesses = unknowns.map((u) => cieLightness(u.rgb));
  const saturations = unknowns.map((u) => rgbToHsl(u.rgb)[1]);
  assert.ok(Math.max(...lightnesses) < BUILDING_THEME_UNKNOWN_MAX_LIGHTNESS,
    `the lightest unpainted volume is L* ${Math.max(...lightnesses).toFixed(1)}`);
  assert.ok(Math.max(...saturations) < BUILDING_THEME_UNKNOWN_MAX_SATURATION,
    `the most saturated unpainted volume is S ${Math.max(...saturations).toFixed(2)}`);
  // The range published in the module header.
  assert.deepEqual(
    [Math.min(...lightnesses), Math.max(...lightnesses)].map((v) => Number(v.toFixed(1))),
    [14.9, 33.9],
  );

  let worst = { distance: Infinity, where: '' };
  for (const [themeId, palette] of Object.entries(THEME_PALETTES)) {
    for (const color of palette) {
      const rgb = parseCssRgb(color);
      for (const unknown of unknowns) {
        const distance = deltaE76(rgb, unknown.rgb);
        if (distance < worst.distance) {
          worst = { distance, where: `${themeId} ${color} vs washed ${unknown.tier}` };
        }
      }
    }
  }
  assert.ok(worst.distance >= BUILDING_THEME_MIN_DELTA_E,
    `closest approach is ΔE ${worst.distance.toFixed(1)} at ${worst.where}`);
  // The published figure, reproduced to one decimal.
  assert.equal(Number(worst.distance.toFixed(1)), 36.5);
  assert.equal(worst.where, 'dvf-fr #2166ac vs washed civic');
});

test('a dimmed class is not the wash, and cannot be used as one', () => {
  // The cheaper "unknown" somebody will propose: take the class colour and dim
  // it. DPE G dimmed until it is as dark as the wash is still 25+ ΔE from every
  // wash, so a dark red volume would be ambiguous between "G" and "not
  // measured, and the usage happens to be reddish". The wash has to be a
  // different REGISTER, not a darker version of the same one.
  const washes = BDTOPO_USAGE_TIERS
    .map((tier) => parseCssRgb(unknownBuildingCss(tier.color)));
  const dimmedG = parseCssRgb('#fc0205').map((c) => c * 0.35);
  const closest = Math.min(...washes.map((wash) => deltaE76(dimmedG, wash)));
  assert.ok(closest >= BUILDING_THEME_MIN_DELTA_E,
    `a dimmed DPE G lands ΔE ${closest.toFixed(1)} from the nearest wash`);
});

test('the wash keeps a trace of the usage hue and no more', () => {
  const washed = BDTOPO_USAGE_TIERS.map((tier) => unknownBuildingCss(tier.color));
  assert.equal(new Set(washed).size, BDTOPO_USAGE_TIERS.length,
    'six usages, six distinct washes — the city is still a city');
  for (const css of washed) {
    assert.ok(rgbToHsl(parseCssRgb(css))[1] <= BUILDING_THEME_UNKNOWN_MAX_SATURATION);
  }
  assert.equal(unknownBuildingCss('not a colour'), 'not a colour', 'unparseable is returned as is');
});

test('a theme that ships a colour indistinguishable from "no data" is named at registration', (t) => {
  t.after(clearAllBuildingThemes);
  const conflicts = buildingThemeConflicts(['#3f4142', '#fc0205', '#2166ac', null, 'nonsense']);
  assert.deepEqual(conflicts.map((c) => c.color), ['#3f4142'],
    'the cheap envelope catches the dark grey and clears the dark blue');
  assert.ok(conflicts[0].lightness <= BUILDING_THEME_UNKNOWN_MAX_LIGHTNESS);
  assert.equal(conflicts[0].deltaE, null);

  // Given the wash colours themselves it is the ΔE form that answers, and the
  // two forms agree on this palette.
  const washes = BDTOPO_USAGE_TIERS.map((tier) => unknownBuildingCss(tier.color));
  const measured = buildingThemeConflicts(['#3f4142', '#fc0205', '#2166ac'], washes);
  assert.deepEqual(measured.map((c) => c.color), ['#3f4142']);
  assert.ok(measured[0].deltaE < BUILDING_THEME_MIN_DELTA_E);

  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...args) => warnings.push(String(args[0]));
  try {
    theme('grey', { legend: [{ label: 'sombre', color: '#3f4142' }] });
  } finally {
    console.warn = realWarn;
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /cannot tell them from "no data"/);
  assert.equal(getActiveBuildingTheme().id, 'grey', 'warned, not refused');
});

/* ── 5. the seam in the BD TOPO layer ──────────────────────────────────── */

/** The exact colour formula the layer shipped before themes existed. */
function historicalVolumeColor(rec) {
  const base = Cesium.Color.fromCssColorString(rec.color);
  const visibleM = rec.topM - rec.baseM - BASE_SINK_M;
  const t = Math.min(Math.max((visibleM - 4) / 34, 0), 1);
  const color = base.darken(0.42 * (1 - t), new Cesium.Color());
  return `#${[color.red, color.green, color.blue]
    .map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`;
}

test('with no theme registered the volume colour is byte-identical to before', (t) => {
  t.after(() => { clearAllBuildingThemes(); _setBdtopoStateForTest({ viewer: null, enabled: false }); });
  const records = new Map();
  for (const [index, tier] of BDTOPO_USAGE_TIERS.entries()) {
    for (const heightM of [3, 12, 40]) {
      const rec = record(`r${index}-${heightM}`, { color: tier.color, heightM });
      records.set(rec.id, rec);
    }
  }
  _setBdtopoStateForTest({ records });
  const { painted, paint } = _applyBdtopoThemeForTest();
  assert.equal(paint, null, 'no theme, no paint');
  assert.equal(painted, 0);
  for (const rec of records.values()) {
    assert.equal(_bdtopoVolumeColorForTest(rec), historicalVolumeColor(rec), rec.id);
  }
  const stats = _bdtopoStatsForTest();
  assert.equal(stats.theme, null);
  assert.equal(stats.themePainted, null);
  const { legend } = _bdtopoRowControlsForTest();
  assert.deepEqual(legend.map((entry) => entry.label), BDTOPO_USAGE_TIERS.map((x) => x.label),
    'the usage bands stay the legend when nothing else paints');
});

test('a theme paints the volumes it joined and washes the ones it did not', (t) => {
  t.after(() => { clearAllBuildingThemes(); _setBdtopoStateForTest({ viewer: null, enabled: false }); });
  const joined = record('joined', { color: '#e8b96a', heightM: 40 });
  const alone = record('alone', {
    color: '#e8b96a',
    heightM: 40,
    degrees: [5, 45.75, 5.001, 45.75, 5.001, 45.751, 5, 45.751, 5, 45.75],
    lat: 45.7505,
    lon: 5.0005,
  });
  _setBdtopoStateForTest({ records: new Map([['joined', joined], ['alone', alone]]) });
  theme('dpe-fr', {
    label: 'Performance énergétique (DPE)',
    points: [{ lon: 4.8005, lat: 45.7505 }, { lon: 4.8005, lat: 45.7505 }, { lon: 3, lat: 40 }],
    reduce: (points) => points.length,
    colorFor: () => '#fc0205',
    legend: [{ label: 'G', color: '#fc0205' }],
    unknownLabel: 'sans diagnostic',
  });
  const { paint } = _applyBdtopoThemeForTest();

  assert.equal(paint.themeId, 'dpe-fr');
  assert.equal(paint.painted, 1);
  assert.equal(paint.unpainted, 1);
  assert.equal(paint.unmatchedPoints, 1);
  assert.equal(_bdtopoVolumeColorForTest(joined), '#fc0205',
    'the theme colour is taken flat — the height shading would fight the class');
  assert.equal(_bdtopoVolumeColorForTest(alone), unknownBuildingCss('#e8b96a'),
    'and the unjoined volume is washed, not left looking graded');
  assert.notEqual(_bdtopoVolumeColorForTest(alone), historicalVolumeColor(alone));

  const stats = _bdtopoStatsForTest();
  assert.equal(stats.theme, 'dpe-fr');
  assert.equal(stats.themePainted, 1);
  assert.equal(stats.themeUnpainted, 1);
  assert.match(stats.loadingLabel,
    /^1 volume peint par Performance énergétique \(DPE\), 1 sans diagnostic — 1 point hors emprise$/);

  const { legend } = _bdtopoRowControlsForTest();
  assert.deepEqual(legend.map((entry) => entry.label), ['G', 'sans diagnostic', 'points sans bâtiment']);
  assert.equal(legend[1].count, 1);
  assert.equal(legend[2].count, 1);
});

test('clearing the theme puts the usage colours back exactly', (t) => {
  t.after(() => { clearAllBuildingThemes(); _setBdtopoStateForTest({ viewer: null, enabled: false }); });
  const rec = record('r', { heightM: 12 });
  _setBdtopoStateForTest({ records: new Map([['r', rec]]) });
  theme('dpe-fr', {
    points: [{ lon: 4.8005, lat: 45.7505 }],
    colorFor: () => '#fc0205',
  });
  _applyBdtopoThemeForTest();
  assert.equal(_bdtopoVolumeColorForTest(rec), '#fc0205');
  clearBuildingTheme('dpe-fr');
  const { paint } = _applyBdtopoThemeForTest();
  assert.equal(paint, null);
  assert.equal(_bdtopoVolumeColorForTest(rec), historicalVolumeColor(rec));
});

test('only one theme paints, and the row names the one that does', (t) => {
  t.after(() => { clearAllBuildingThemes(); _setBdtopoStateForTest({ viewer: null, enabled: false }); });
  const rec = record('r', { heightM: 12 });
  _setBdtopoStateForTest({ records: new Map([['r', rec]]) });
  const points = [{ lon: 4.8005, lat: 45.7505 }];
  theme('dvf-fr', {
    label: 'Prix au m² (DVF)', precedence: 20, points, colorFor: () => '#2166ac',
  });
  theme('dpe-fr', {
    label: 'Performance énergétique (DPE)', precedence: 10, points, colorFor: () => '#fc0205',
  });
  _applyBdtopoThemeForTest();
  assert.equal(_bdtopoVolumeColorForTest(rec), '#fc0205', 'never a blend of the two');
  assert.equal(_bdtopoStatsForTest().themeLabel, 'Performance énergétique (DPE)');
  clearBuildingTheme('dpe-fr');
  _applyBdtopoThemeForTest();
  assert.equal(_bdtopoVolumeColorForTest(rec), '#2166ac');
  assert.equal(_bdtopoStatsForTest().themeLabel, 'Prix au m² (DVF)');
});

test('the footprints handed to a theme are copies, not the drawn geometry', (t) => {
  t.after(() => _setBdtopoStateForTest({ viewer: null, enabled: false }));
  const rec = record('r', { holes: [[4.8002, 45.7502, 4.8004, 45.7502, 4.8004, 45.7504, 4.8002, 45.7502]] });
  _setBdtopoStateForTest({ records: new Map([['r', rec]]) });
  const exported = bdtopoLoadedFootprints();
  assert.equal(exported.length, 1);
  assert.deepEqual(exported[0].degrees, rec.degrees);
  exported[0].degrees[0] = 999;
  exported[0].holes[0][0] = 999;
  assert.equal(rec.degrees[0], 4.8, 'a caller cannot reach the geometry the primitive was built from');
  assert.equal(rec.holes[0][0], 4.8002);
  assert.equal(exported[0].props, undefined, 'and gets the geometry only, not the record');
});
