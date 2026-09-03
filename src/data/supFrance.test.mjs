// The rendering decisions: what a prism, a dot's colour and a dot's size
// claim, and what the cards say about the things this register cannot express
// on its own.
//
// The recurring property under test is that a mark never overstates what it
// stands for. A campus dot is one SITE of an establishment, not the
// establishment; a borrowed coordinate is a thing the map did, not a thing the
// register said; the national prism's HEIGHT counts students and its COLOUR is
// a rate, and neither is allowed to say what the other says. None of those
// distinctions survive in a colour channel alone, so the legend, the cards and
// the status line are where they have to live.
import test from 'node:test';
import assert from 'node:assert/strict';

import supFranceLayer, {
  SUP_FR_LABEL_COHORT_LIMIT,
  SUP_FR_LAYER_ID,
  SUP_PRISM_SCALE,
  buildSupDepartementLabel,
  buildSupLoadingLabel,
  buildSupSelectionLabel,
  cameraSupBox,
  createSupDepartementOverlayEntry,
  selectSupLabelCohort,
  supKindColor,
  supKindLabel,
  supPointSize,
  supPrismRow,
  supPrismRows,
  supRateColor,
  supSiteInBox,
  supViewSpanDeg,
  _clearSupSelectionForTest,
  _repaintSupDepartementsForTest,
  _selectSupDepartementForTest,
  _setSupStateForTest,
  _supDepartementOverlayForTest,
  _supRowControlsForTest,
} from './supFrance.js';
import {
  PRISM_MAX_HEIGHT_M,
  PRISM_MIN_HEIGHT_M,
  createPrismScale,
  prismApparentPx,
  prismRow,
} from './choroplethPrism.js';
import { SUP_KINDS } from './supFeed.js';
import { SCHOOL_LEVELS } from './schoolsFeed.js';
import { schoolLevelColor } from './schoolsFrance.js';

/**
 * Collapse every kind of space to a plain one before matching.
 * `toLocaleString('fr-FR')` separates thousands with U+202F, which is correct
 * French typography and invisible in a diff.
 */
const norm = (value) => String(value).replace(/[\s  ]+/g, ' ');

/** The shipped scale's own arguments, so a twin can be built to compare with. */
const spec = () => ({
  id: 'sup-fr-linear-twin',
  domainMax: SUP_PRISM_SCALE.domainMax,
  heightLabel: SUP_PRISM_SCALE.heightLabel,
  heightUnit: SUP_PRISM_SCALE.heightUnit,
  ratioLabel: SUP_PRISM_SCALE.ratioLabel,
  ratioBreaks: [...SUP_PRISM_SCALE.ratioBreaks],
  ratioColors: [...SUP_PRISM_SCALE.ratioColors],
});

/** One enrolment on an arbitrary scale, for the linear-versus-sqrt comparison. */
const supPrismRowOn = (scale, students) => prismRow({ value: students }, scale);

const site = (over = {}) => ({
  id: '0755890V@48.83796,2.36067',
  uai: '0755890V',
  lat: 48.83796,
  lon: 2.36067,
  name: 'Sorbonne Université',
  sigle: 'SORBONNE UNIV',
  kind: 'universite',
  category: 'Universités',
  sector: 'public',
  students: 15192,
  cycles: { licence: 4374, master: 1874, doctorat: 8944 },
  commune: 'Paris 13e',
  dept: 'D075',
  deptName: '75 - Paris',
  composantes: ['FAC MEDECINE'],
  siteCount: 1,
  siteIndex: 1,
  etabStudents: 15192,
  unsited: 0,
  placement: 'register',
  offer: null,
  web: null,
  ...over,
});

const record = (over = {}) => ({ id: 'r1', rentree: '2024', site: site(over.site), ...over });

test.afterEach(() => { _clearSupSelectionForTest(); });

// --- Colour -----------------------------------------------------------------

test('every band in the ladder has its own colour', () => {
  const seen = new Set();
  for (const kind of SUP_KINDS) {
    const color = supKindColor(kind);
    assert.match(color, /^#[0-9a-f]{6}$/i);
    assert.equal(seen.has(color), false, `${kind} reuses a colour`);
    seen.add(color);
  }
  assert.equal(seen.size, 7);
});

test('no band reuses a schools-fr level colour — the two layers stack on 2 800 addresses', () => {
  // BTS and CPGE are taught inside lycées, so an operator with both layers on
  // is looking at overlapping dots by design. A shared hex would make the two
  // registers indistinguishable exactly where telling them apart matters.
  const schools = new Set(SCHOOL_LEVELS.map(schoolLevelColor));
  for (const kind of SUP_KINDS) {
    assert.equal(schools.has(supKindColor(kind)), false, `${kind} collides with schools-fr`);
  }
});

test('an unknown band falls back to the catch-all, not to a named kind', () => {
  assert.equal(supKindColor('quelque chose'), supKindColor('autre'));
  assert.equal(supKindColor(undefined), supKindColor('autre'));
  assert.notEqual(supKindColor('quelque chose'), supKindColor('universite'));
});

test('the prism ramp is a different family from the band hues', () => {
  // A reader zooming out must not carry a category's meaning into a rate's.
  const bands = new Set(SUP_KINDS.map(supKindColor));
  for (const color of SUP_PRISM_SCALE.ratioColors) {
    assert.equal(bands.has(color), false);
  }
});

test('the ramp climbs in LIGHTNESS, so the order survives greyscale', () => {
  // B4: hue does not order, value does. The ladder has to be readable by a
  // deuteranope and in a black-and-white screenshot, or it is not a ladder.
  const luma = (hex) => {
    const h = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const values = SUP_PRISM_SCALE.ratioColors.map(luma);
  for (let i = 1; i < values.length; i += 1) {
    assert.ok(values[i] > values[i - 1], `class ${i} is not lighter than class ${i - 1}`);
  }
});

// --- The prism: what the height says ----------------------------------------

test('the domain is a frozen literal above the measured maximum, not a quantile', () => {
  // C1. Paris holds 394 788 students in the 2024 vintage; the ruler stops at
  // 400 000, so the same département is the same height in every session and a
  // poll that lost a stripe cannot move a single boundary.
  assert.equal(SUP_PRISM_SCALE.domainMax, 400_000);
  assert.equal(SUP_PRISM_SCALE.domainMin, 0);
  assert.equal(supPrismRow({ students: 394_788, advancedShare: 42.7 }).clipped, false);
  assert.equal(Object.isFrozen(SUP_PRISM_SCALE), true);
});

test('this layer declares sqrt, and the linear twin is what proves it had to', () => {
  // The domain runs 738 (Corse-du-Sud) to 394 788 (Paris) — 1 : 535, where the
  // shared grammar puts the threshold at ~1 : 30. On a linear ruler the 4 km
  // floor sits at 13 333 students and swallows 51 of the 96 départements,
  // the median (9 109) among them. On the square root it sits at 444, below
  // the smallest département, so nothing is floored at all.
  assert.equal(SUP_PRISM_SCALE.mode, 'sqrt');
  const linear = createPrismScale({ ...spec(), mode: 'linear' });
  const floored = (scale, students) => supPrismRowOn(scale, students).heightM <= PRISM_MIN_HEIGHT_M;
  assert.equal(floored(linear, 9_109), true);
  assert.equal(floored(linear, 738), true);
  assert.equal(floored(SUP_PRISM_SCALE, 738), false);
  assert.equal(floored(SUP_PRISM_SCALE, 9_109), false);
  // And the two smallest départements stay TELLABLE APART, which is the whole
  // reason the mode is not the default one.
  assert.ok(supPrismRow({ students: 950 }).heightM > supPrismRow({ students: 738 }).heightM);
  assert.equal(supPrismRowOn(linear, 950).heightM, supPrismRowOn(linear, 738).heightM);
});

test('the measured départements land where the header says they do, in pixels', () => {
  // Every figure quoted in the module header is recomputed here, at the
  // ~1 500 km national altitude on a 1600 × 1000 canvas: the numbers are
  // auditable rather than asserted.
  const px = (students) => prismApparentPx({
    heightM: supPrismRow({ students }).heightM,
    cameraDistanceM: 1_500_000,
  });
  assert.equal(Math.round(px(394_788) * 10) / 10, 114.7); // Paris
  assert.equal(Math.round(px(192_964) * 10) / 10, 80.2); // Rhône
  assert.equal(Math.round(px(9_109) * 10) / 10, 17.4); // the median département
  assert.equal(Math.round(px(738) * 10) / 10, 5.0); // Corse-du-Sud
  // And the tallest prism never exceeds the shared ceiling, whatever arrives.
  assert.equal(supPrismRow({ students: 1e9 }).heightM, PRISM_MAX_HEIGHT_M);
});

test('a value above the frozen domain is clipped AND flagged, never rescales the map', () => {
  // A5: the mark stops measuring, and something has to say so.
  const over = supPrismRow({ students: 500_000, advancedShare: 40 });
  assert.equal(over.clipped, true);
  assert.equal(over.heightM, PRISM_MAX_HEIGHT_M);
  assert.equal(supPrismRow({ students: 400_000 }).clipped, false);
});

test('the height ruler brackets the distribution instead of only its top', () => {
  // The median département holds 9 109 students: a lowest tick at 20 000 —
  // what the shared default would have picked — leaves half of France under
  // the bottom of the ruler.
  assert.deepEqual([...SUP_PRISM_SCALE.heightTicks], [200_000, 50_000, 5_000]);
  assert.ok(SUP_PRISM_SCALE.heightTicks.at(-1) < 9_109);
});

// --- The prism: three states of a height, two of a colour -------------------

test('absent, measured zero and measured positive are three different marks', () => {
  // A1, and the reason this layer was rebuilt. A `?? 0` anywhere on this path
  // would merge the first two.
  const absent = supPrismRow({ code: '48' });
  assert.equal(absent.hasValue, false);
  assert.equal(absent.heightM, null);
  assert.equal(absent.extruded, false);
  assert.equal(absent.measuredZero, false);

  const zero = supPrismRow({ code: '48', students: 0 });
  assert.equal(zero.hasValue, true);
  assert.equal(zero.heightM, 0);
  assert.equal(zero.extruded, false);
  assert.equal(zero.measuredZero, true);

  const one = supPrismRow({ code: '48', students: 1 });
  assert.equal(one.extruded, true);
  assert.ok(one.heightM >= PRISM_MIN_HEIGHT_M);
});

test('a malformed enrolment is an absence, never a fabricated zero', () => {
  // `Number([])` is 0 and `Number(true)` is 1: a bad row must not invent a
  // measurement out of a coercion.
  for (const students of [null, undefined, NaN, [], true, {}, '', 'beaucoup', -12]) {
    const row = supPrismRow({ code: '48', students });
    assert.equal(row.hasValue, false, `${String(students)} should not be a measurement`);
    assert.equal(row.measuredZero, false);
  }
});

test('the two absences are independent — a height without a colour is still a height', () => {
  const noRate = supPrismRow({ code: '75', students: 394_788, advancedShare: null });
  assert.equal(noRate.hasValue, true);
  assert.equal(noRate.extruded, true);
  assert.equal(noRate.hasRatio, false);
  assert.equal(noRate.color, null);

  const noCount = supPrismRow({ code: '75', advancedShare: 42.7 });
  assert.equal(noCount.hasValue, false);
  assert.equal(noCount.hasRatio, true);
  assert.ok(noCount.color);
});

// --- The prism: what the colour says ----------------------------------------

test('the colour is the RATE, on frozen percentage-point breaks', () => {
  assert.deepEqual([...SUP_PRISM_SCALE.ratioBreaks], [5, 10, 20, 30, 40]);
  assert.equal(SUP_PRISM_SCALE.ratioColors.length, 6);
  assert.equal(supRateColor(5), SUP_PRISM_SCALE.ratioColors[0]);
  assert.equal(supRateColor(17.4), SUP_PRISM_SCALE.ratioColors[2]);
  // Essonne 46.0 % and Paris 42.7 % — the two of the top class.
  assert.equal(supRateColor(46), SUP_PRISM_SCALE.ratioColors[5]);
  assert.equal(supRateColor(42.7), SUP_PRISM_SCALE.ratioColors[5]);
});

test('a rate of zero is a class, and no rate at all is no colour', () => {
  // Ardèche, Cantal, Corse-du-Sud and Haute-Loire really do publish 0 % at
  // bac+4. That is a measurement, and it is not an empty cell.
  assert.equal(supRateColor(0), SUP_PRISM_SCALE.ratioColors[0]);
  assert.equal(supRateColor(null), null);
  assert.equal(supRateColor(undefined), null);
  assert.equal(supRateColor('beaucoup'), null);
});

test('the height and the colour are read from two different fields', () => {
  // The one property that keeps the prism from being a fill drawn twice: move
  // the rate and the height stays put, and the other way round.
  const base = { code: '75', students: 100_000, advancedShare: 10 };
  const richer = supPrismRow({ ...base, advancedShare: 40 });
  const taller = supPrismRow({ ...base, students: 300_000 });
  assert.equal(richer.heightM, supPrismRow(base).heightM);
  assert.notEqual(richer.color, supPrismRow(base).color);
  assert.equal(taller.color, supPrismRow(base).color);
  assert.ok(taller.heightM > supPrismRow(base).heightM);
});

test('a rollup built before the rate existed still gets its colour', () => {
  // The dev proxy caches this payload on disk for a week and its shape version
  // lives in a file this layer does not own, so a machine holding an older
  // rollup must not paint all 96 départements as "rate refused". The cycles
  // are in that payload, and the rate is the same arithmetic over them.
  const stale = {
    code: '69', name: 'Rhône', students: 192_964, sites: 292,
    cycles: { licence: 121_892, master: 60_000, doctorat: 11_072 },
  };
  const row = supPrismRow(stale);
  assert.equal(row.hasRatio, true);
  assert.equal(Math.round(row.share * 10) / 10, 36.8);
  assert.equal(row.color, supRateColor(36.8));
  // A published `null` is a REFUSAL and is honoured, not recomputed around.
  assert.equal(supPrismRow({ ...stale, advancedShare: null }).hasRatio, false);
  // And a row with neither is simply colourless.
  assert.equal(supPrismRow({ code: '69', students: 10 }).hasRatio, false);
});

test('a rollup becomes one prism row per département, in its own order', () => {
  const rows = supPrismRows({
    departements: [
      { code: '75', name: 'Paris', students: 394_788, advancedShare: 42.7, sites: 484 },
      { code: '48', name: 'Lozère', students: 1_122, advancedShare: 7.8, sites: 5 },
    ],
  });
  assert.deepEqual(rows.map((row) => row.code), ['75', '48']);
  assert.equal(rows[0].name, 'Paris');
  assert.equal(rows[0].sites, 484);
  assert.ok(rows[0].heightM > rows[1].heightM);
  assert.deepEqual(supPrismRows(null), []);
  assert.deepEqual(supPrismRows({}), []);
});

// --- Size -------------------------------------------------------------------

test('a bigger roll is a bigger dot, sub-linearly', () => {
  assert.ok(supPointSize(15000) > supPointSize(2000));
  assert.ok(supPointSize(2000) > supPointSize(200));
  // Area, not radius, is what the eye reads — a 75× roll must not be a 75× dot.
  assert.ok(supPointSize(15000) / supPointSize(200) < 3);
});

test('the size is bounded, so one 30 000-student campus cannot blot out a city', () => {
  assert.equal(supPointSize(20_000), supPointSize(30_187));
  assert.equal(supPointSize(20_000), supPointSize(1e9));
});

test('a missing or absurd roll draws at the base size rather than vanishing', () => {
  assert.equal(supPointSize(null), supPointSize(0));
  assert.equal(supPointSize(undefined), supPointSize(0));
  assert.equal(supPointSize(NaN), supPointSize(0));
  assert.equal(supPointSize(-5), supPointSize(0));
  assert.ok(supPointSize(0) > 0);
});

// --- The selection card -----------------------------------------------------

test('the card leads with the name and states the roll AT THIS SITE', () => {
  const copy = buildSupSelectionLabel(record()).split('\n');
  assert.equal(copy[0], 'Sorbonne Université');
  assert.ok(copy.some((line) => norm(line).includes('15 192 étudiants sur ce site')));
  assert.ok(copy.some((line) => line.includes('rentrée 2024')));
});

test('a multi-site establishment names both numbers, or the dot overstates', () => {
  // 26 Sorbonne dots must read as one university, and each dot must not read
  // as the whole of it.
  const copy = buildSupSelectionLabel(record({
    site: site({ siteCount: 26, siteIndex: 4, students: 15192, etabStudents: 51168 }),
  }));
  assert.match(norm(copy), /Site 4 sur 26/);
  assert.match(norm(copy), /51 168 étudiants au total/);
  // A single-site establishment prints neither — there is nothing to reconcile.
  assert.equal(/Site 1 sur 1/.test(buildSupSelectionLabel(record())), false);
});

test('students the register cannot place are named on the card, not folded in', () => {
  const copy = buildSupSelectionLabel(record({
    site: site({ students: 642, etabStudents: 1336, unsited: 694 }),
  }));
  assert.match(norm(copy), /694 étudiants sans site localisé/);
  assert.equal(/sans site localisé/.test(buildSupSelectionLabel(record())), false);
});

test('a borrowed coordinate is flagged; a published one says nothing', () => {
  // The absence of a warning IS the signal that the register placed this dot.
  const borrowed = buildSupSelectionLabel(record({ site: site({ placement: 'offer' }) }));
  assert.match(borrowed, /⚠/);
  assert.match(borrowed, /Parcoursup/);
  assert.equal(/⚠/.test(buildSupSelectionLabel(record())), false);
});

test('the card prefers the published category over the folded band label', () => {
  // The band is seven buckets; the register publishes fourteen names, and the
  // card is where the finer one still fits.
  const copy = buildSupSelectionLabel(record({
    site: site({ kind: 'sante', category: 'Écoles paramédicales hors université' }),
  }));
  assert.match(copy, /Écoles paramédicales hors université/);
  // With no published category it falls back to the band, never to blank.
  const folded = buildSupSelectionLabel(record({ site: site({ kind: 'sante', category: null }) }));
  assert.match(folded, /Santé & social/);
});

test('the cycle mix is printed only when it says something', () => {
  assert.match(norm(buildSupSelectionLabel(record())), /Licence 4 374/);
  // A BTS lycée is entirely first-cycle: one number is not a mix, and a line
  // that repeats the roll is noise.
  const bts = buildSupSelectionLabel(record({
    site: site({ students: 1821, cycles: { licence: 1821, master: 0, doctorat: 0 } }),
  }));
  assert.equal(/Licence/.test(bts), false);
});

test('the Parcoursup offer rides on the card when there is one', () => {
  const copy = buildSupSelectionLabel(record({
    site: site({ offer: ['BTS - BTSA - BTSM', 'CPGE'] }),
  }));
  assert.match(copy, /Parcoursup : BTS - BTSA - BTSM · CPGE/);
  assert.equal(/Parcoursup :/.test(buildSupSelectionLabel(record())), false);
});

test('a long offer list is summarised, and says how much it is not showing', () => {
  // The cartography files an establishment under up to 25 types, and the
  // unwrapped line was wider than the card on the biggest universities.
  const copy = buildSupSelectionLabel(record({
    site: site({ offer: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] }),
  }));
  const line = copy.split('\n').find((row) => row.startsWith('Parcoursup'));
  assert.equal(line, 'Parcoursup : A · B · C · D · +3 autres');
  // A list that fits is printed whole, with no counter to read past.
  const short = buildSupSelectionLabel(record({ site: site({ offer: ['A', 'B'] }) }));
  assert.equal(/autres/.test(short), false);
});

test('a nameless site still produces a card with a usable title', () => {
  assert.equal(buildSupSelectionLabel(record({ site: site({ name: null }) })).split('\n')[0], 'Paris 13e');
  assert.equal(
    buildSupSelectionLabel(record({ site: site({ name: null, commune: null }) })).split('\n')[0],
    'Établissement du supérieur',
  );
});

test('the card never throws on a missing or empty record', () => {
  assert.doesNotThrow(() => buildSupSelectionLabel(undefined));
  assert.doesNotThrow(() => buildSupSelectionLabel({}));
  assert.doesNotThrow(() => buildSupSelectionLabel({ site: {} }));
});

// --- The département card ---------------------------------------------------

test('the département card gives students, establishments AND sites', () => {
  const copy = buildSupDepartementLabel({
    code: '75',
    name: 'Paris',
    students: 394788,
    etabs: 402,
    sites: 484,
    cycles: { licence: 180000, master: 150000, doctorat: 64788 },
    public: 300,
    prive: 184,
    per1000Km2: 3742.6,
  });
  assert.equal(copy.split('\n')[0], 'Paris');
  assert.match(norm(copy), /394 788 étudiants/);
  // Both counts, because one establishment can hold many sites and a reader
  // who saw only the site count would over-count institutions.
  assert.match(norm(copy), /402 établissements sur 484 sites/);
  assert.match(norm(copy), /300 sites publics/);
  assert.match(norm(copy), /184 privés/);
  // The fill is an absolute count, so the rate has to be printed beside it.
  assert.match(norm(copy), /3 743 étudiants pour 1 000 km²/);
});

test('the département card prints BOTH channels in their own unit', () => {
  // The card is where a reader checks what the two channels claim: the height
  // in students, the hue in points of percentage, each named as such.
  const copy = norm(buildSupDepartementLabel({
    code: '69',
    name: 'Rhône',
    students: 192964,
    etabs: 210,
    sites: 292,
    advancedShare: 36.84,
    cycles: { licence: 121892, master: 60000, doctorat: 11072 },
    public: 150,
    prive: 142,
    per1000Km2: 59321,
  }));
  assert.match(copy, /192 964 étudiants/);
  assert.match(copy, /36,8 % des étudiants à bac\+4 et au-delà/);
  assert.match(copy, /la couleur du prisme/);
  // And the areal caveat the hue does NOT audit, on the card, in figures.
  assert.match(copy, /59 321 étudiants pour 1 000 km²/);
  assert.match(copy, /la hauteur ne le corrige pas/);
});

test('the card says which half is missing, and never prints a zero for it', () => {
  // A1 in words: « non publié » is not « 0 », in either channel.
  const noRate = norm(buildSupDepartementLabel({
    code: '90', name: 'Belfort', students: 5185, etabs: 12, sites: 14,
    advancedShare: null, cycles: {}, public: 10, prive: 4, per1000Km2: 8545,
  }));
  assert.match(noRate, /Part à bac\+4 non calculable/);
  assert.equal(/0,0 %/.test(noRate), false);

  const noCount = norm(buildSupDepartementLabel({
    code: '2A', name: 'Corse-du-Sud', etabs: 0, sites: 0,
    advancedShare: 12, cycles: {}, public: 0, prive: 0, per1000Km2: 0,
  }));
  assert.match(noCount, /Effectif étudiant non publié/);
  assert.equal(/^0 étudiants/m.test(noCount), false);

  // A measured zero is a measurement and prints as one.
  const zero = norm(buildSupDepartementLabel({
    code: '90', name: 'Belfort', students: 0, etabs: 0, sites: 0,
    advancedShare: null, cycles: {}, public: 0, prive: 0, per1000Km2: 0,
  }));
  assert.match(zero, /0 étudiants/);
  assert.equal(/non publié/.test(zero.split('\n')[1]), false);
});

test('a département with no private sites and no rate prints neither line', () => {
  const copy = buildSupDepartementLabel({
    code: '48',
    name: 'Lozère',
    students: 300,
    etabs: 4,
    sites: 4,
    cycles: { licence: 300, master: 0, doctorat: 0 },
    public: 4,
    prive: 0,
    per1000Km2: 0,
  });
  assert.equal(/privés/.test(copy), false);
  assert.equal(/pour 1 000 km²/.test(copy), false);
  assert.match(norm(copy), /4 établissements sur 4 sites/);
});

// --- The ambient label cohort ----------------------------------------------

test('the cohort keeps the biggest départements and is bounded', () => {
  const entries = [];
  for (let i = 0; i < 40; i += 1) {
    entries.push(createSupDepartementOverlayEntry(
      { code: String(i), name: `D${i}`, students: i, bin: 3 },
      { anchor: [1, 1] },
    ));
  }
  const cohort = selectSupLabelCohort(entries);
  assert.equal(cohort.length, SUP_FR_LABEL_COHORT_LIMIT);
  assert.equal(cohort[0].priority, 39);
  // A caller cannot raise the ceiling by asking for more.
  assert.equal(selectSupLabelCohort(entries, 999).length, SUP_FR_LABEL_COHORT_LIMIT);
  assert.deepEqual(selectSupLabelCohort(entries, 0), []);
  assert.deepEqual(selectSupLabelCohort(null), []);
});

test('a département label carries its student count and its prism’s own hue', () => {
  const entry = createSupDepartementOverlayEntry(
    { code: '75', name: 'Paris', students: 394788, advancedShare: 42.7 },
    { anchor: [2, 48] },
  );
  assert.equal(norm(entry.title), 'Paris · 394 788');
  assert.equal(entry.accent, supRateColor(42.7));
  assert.equal(entry.id, 'sup-fr:dep:75');
});

test('a label never claims a class its prism does not have', () => {
  // No rate published: the accent falls back to the graphite the striped body
  // uses, and never to a hue off the ladder.
  const noRate = createSupDepartementOverlayEntry(
    { code: '75', name: 'Paris', students: 394788, advancedShare: null },
    { anchor: [2, 48] },
  );
  assert.equal(SUP_PRISM_SCALE.ratioColors.includes(noRate.accent), false);
  // No enrolment published: the title says so instead of printing « 0 ».
  const noCount = createSupDepartementOverlayEntry(
    { code: '48', name: 'Lozère', advancedShare: 7.8 },
    { anchor: [3, 44] },
  );
  assert.match(noCount.title, /non publié/);
  assert.equal(noCount.priority, 0);
});

// --- The view box -----------------------------------------------------------

test('a site inside the box is drawn, one outside is not, and edges count', () => {
  const box = { south: 48, north: 49, west: 2, east: 3 };
  assert.equal(supSiteInBox({ lat: 48.5, lon: 2.5 }, box), true);
  assert.equal(supSiteInBox({ lat: 48, lon: 2 }, box), true);
  assert.equal(supSiteInBox({ lat: 47.9, lon: 2.5 }, box), false);
  assert.equal(supSiteInBox({ lat: 48.5, lon: 3.1 }, box), false);
  assert.equal(supSiteInBox({ lat: 48.5, lon: 2.5 }, null), false);
});

test('the view box is padded, and there is no upstream ceiling to refuse it', () => {
  // Unlike `schools-fr`, a wide box costs nothing: the sites come from a pack
  // the client already holds, so the box is never rejected for being large.
  const viewer = {
    camera: {
      computeViewRectangle: () => ({
        south: 0.1, north: 0.3, west: 0.1, east: 0.3,
      }),
    },
  };
  const box = cameraSupBox(viewer, 0.1);
  assert.ok(box.south < 0.1 * (180 / Math.PI));
  assert.ok(box.north > 0.3 * (180 / Math.PI));
  assert.equal(cameraSupBox({}), null);
  assert.equal(cameraSupBox({ camera: { computeViewRectangle: () => null } }), null);
});

test('a camera past the limb reports an infinite span, so the layer stays national', () => {
  assert.deepEqual(supViewSpanDeg({}), { lat: Infinity, max: Infinity });
  assert.deepEqual(
    supViewSpanDeg({ camera: { computeViewRectangle: () => null } }),
    { lat: Infinity, max: Infinity },
  );
});

// --- The row legend ---------------------------------------------------------

test('the site legend counts sites by band, in ladder order, dropping empty rows', () => {
  _setSupStateForTest({
    regime: 'sites',
    records: [
      record({ id: 'a', site: site({ kind: 'lycee' }) }),
      record({ id: 'b', site: site({ kind: 'universite' }) }),
      record({ id: 'c', site: site({ kind: 'lycee' }) }),
    ],
  });
  const { legend } = _supRowControlsForTest();
  assert.deepEqual(legend.map((row) => row.label), ['Université', 'Lycée — BTS & CPGE']);
  assert.deepEqual(legend.map((row) => row.count), [1, 2]);
});

test('the lycée legend row warns that those addresses are also in schools-fr', () => {
  // Without it, a reader with both layers on reads a stacked dot as a bug.
  _setSupStateForTest({
    regime: 'sites',
    records: [record({ id: 'a', site: site({ kind: 'lycee' }) })],
  });
  assert.match(_supRowControlsForTest().legend[0].blurb, /Établissements scolaires/);
});

// --- The national legend (D1) ------------------------------------------------

const NATIONAL = Object.freeze({
  students: 2_960_012,
  studentsAssigned: 2_902_711,
  painted: 96,
  unassigned: 214,
  departements: [
    { code: '75', name: 'Paris', students: 394_788, advancedShare: 42.7, sites: 484 },
    { code: '69', name: 'Rhône', students: 192_964, advancedShare: 36.8, sites: 292 },
    { code: '48', name: 'Lozère', students: 1_122, advancedShare: 7.8, sites: 5 },
    { code: '15', name: 'Cantal', students: 1_400, advancedShare: 0, sites: 6 },
    { code: '90', name: 'Belfort', students: 0, advancedShare: null, sites: 0 },
    { code: '2A', name: 'Corse-du-Sud', advancedShare: null, sites: 0 },
  ],
});

test('the national legend publishes the HEIGHT ruler in figures, not just colours', () => {
  // D1, and the reason the prism is legible at all: a height nobody can
  // translate into students is a shape. Three ticks, each with a BAR glyph
  // whose height is the datum, all in one constant colour so the swatch's
  // colour cannot read as a second encoding (A3).
  _setSupStateForTest({ regime: 'national', national: NATIONAL });
  const { legend } = _supRowControlsForTest();
  const title = legend[0];
  assert.match(norm(title.label), /^Hauteur — étudiants$/);
  assert.equal(title.color, null);
  assert.match(norm(title.blurb), /400 000 étudiants, borne gelée/);
  const ticks = legend.filter((row) => row.glyph && /étudiants$/.test(row.label));
  assert.equal(ticks.length, 3);
  assert.deepEqual(ticks.map((row) => norm(row.label)), [
    '200 000 étudiants', '50 000 étudiants', '5 000 étudiants',
  ]);
  assert.equal(new Set(ticks.map((row) => row.color)).size, 1);
  assert.equal(new Set(ticks.map((row) => row.glyph)).size, 3);
});

test('the legend says the scale is a square root, unprompted', () => {
  // A ruler where twice as tall means four times as many is a claim the reader
  // cannot check without being told, so it is told in French, on the map.
  _setSupStateForTest({ regime: 'national', national: NATIONAL });
  const { legend } = _supRowControlsForTest();
  assert.match(norm(legend[0].blurb), /racine carrée/);
  assert.match(norm(legend[0].blurb), /quatre fois plus/);
});

test('the legend states the areal bias, and withdraws the promise it cannot keep', () => {
  // The honest half of the arbitration. The shared blurb ends by promising the
  // COLOUR answers « rapporté à quoi ? » — true where the hue is a density,
  // false here, where it is the share at bac+4. The promise is cut and the
  // real answer (the card's students per 1 000 km²) is named instead.
  _setSupStateForTest({ regime: 'national', national: NATIONAL });
  const blurb = norm(_supRowControlsForTest().legend[0].blurb);
  assert.match(blurb, /aire n’est pas neutralisée|aire n'est pas neutralisée/);
  assert.equal(/qui répond à/.test(blurb), false);
  assert.match(blurb, /la couleur ne corrige PAS ce biais/);
  assert.match(blurb, /étudiants pour 1 000 km²/);
});

test('the colour half of the legend is a RATE, and says so', () => {
  _setSupStateForTest({ regime: 'national', national: NATIONAL });
  const { legend } = _supRowControlsForTest();
  const title = legend.find((row) => /^Couleur —/.test(row.label));
  assert.match(norm(title.label), /part des étudiants à bac\+4 et au-delà/);
  assert.equal(title.color, null);
  // Only classes somebody is in, and each one counted.
  const classes = legend.filter((row) => SUP_PRISM_SCALE.ratioColors.includes(row.color));
  // Cantal 0 %, Lozère 7.8 %, Rhône 36.8 %, Paris 42.7 % — and the two classes
  // nobody is in are not printed, because a colour a reader is told to look
  // for and can never find is noise.
  assert.deepEqual(classes.map((row) => norm(row.label)), ['≤ 5 %', '5 – 10 %', '30 – 40 %', '> 40 %']);
  assert.deepEqual(classes.map((row) => row.count), [1, 1, 1, 1]);
});

test('measured zero and unpublished get their own counted rows, never each other’s', () => {
  // A1 on the legend rather than only on the map: Belfort is a measured zero,
  // Corse-du-Sud has no published enrolment, and both are counted.
  _setSupStateForTest({ regime: 'national', national: NATIONAL });
  const { legend } = _supRowControlsForTest();
  const zero = legend.find((row) => /mesuré à zéro/.test(row.label));
  const missing = legend.find((row) => /non publié$/.test(row.label));
  assert.equal(zero.count, 1);
  assert.equal(missing.count, 1);
  assert.notEqual(zero.label, missing.label);
  // The missing row is keyed by a MOTIF, because no hue is neutral on a globe.
  assert.ok(missing.glyph);
});

test('the legend carries the overseas shortfall the prisms cannot draw', () => {
  // A5 where the map is read: 57 301 students on sites no metropolitan polygon
  // can hold, counted and never moved.
  _setSupStateForTest({ regime: 'national', national: NATIONAL });
  const { legend } = _supRowControlsForTest();
  const offshore = legend.find((row) => /hors métropole/.test(row.label));
  assert.equal(offshore.count, 214);
  assert.match(norm(offshore.blurb), /57 301 étudiants/);
  // A rollup with nothing offshore does not print an empty warning.
  _setSupStateForTest({
    regime: 'national',
    national: { ...NATIONAL, unassigned: 0 },
  });
  assert.equal(
    _supRowControlsForTest().legend.some((row) => /hors métropole/.test(row.label)),
    false,
  );
});

test('every coloured legend row is a rate row — no colour keys a count', () => {
  // B1, checked from the outside: the only entries carrying a hue from the
  // ladder are the rate classes. Height rows carry the constant swatch, and
  // the title and shortfall rows carry no colour at all.
  _setSupStateForTest({ regime: 'national', national: NATIONAL });
  for (const row of _supRowControlsForTest().legend) {
    if (!SUP_PRISM_SCALE.ratioColors.includes(row.color)) continue;
    assert.match(norm(row.label), /%/);
  }
});

// --- Raising the prisms ------------------------------------------------------

/** A stand-in for one drawn polygon part; only property writes are observed. */
const drawnPart = () => ({ show: false, polygon: {} });

test('the four states get four different marks on the geometry itself', () => {
  // A1, at the only place it finally matters: the polygon. A measured zero, a
  // missing count and a missing rate must not produce the same object.
  const parts = {
    75: drawnPart(), 90: drawnPart(), '2A': drawnPart(), 69: drawnPart(),
  };
  _setSupStateForTest({
    regime: 'national',
    national: {
      ...NATIONAL,
      departements: [
        { code: '75', name: 'Paris', students: 394_788, advancedShare: 42.7 },
        { code: '90', name: 'Belfort', students: 0, advancedShare: null },
        { code: '2A', name: 'Corse-du-Sud', advancedShare: null },
        { code: '69', name: 'Rhône', students: 192_964, advancedShare: null },
      ],
    },
    depEntities: Object.entries(parts).map(([code, part]) => [code, [part]]),
  });
  _repaintSupDepartementsForTest();

  // count ✓ rate ✓ — a prism, filled in its class colour.
  assert.equal(parts[75].polygon.extrudedHeight, supPrismRow({ students: 394_788 }).heightM);
  assert.equal(parts[75].polygon.fill, true);
  assert.equal(parts[75].show, true);

  // count = 0 — flat, solidly filled, and back ON THE GROUND so it is visible
  // where the terrain is 2 km up. Zero is a measurement.
  assert.equal(parts[90].polygon.extrudedHeight, undefined);
  assert.equal(parts[90].polygon.height, undefined);
  assert.equal(parts[90].polygon.fill, true);
  assert.equal(parts[90].show, true);

  // count ✗ — flat too, and told apart from the zero by its MOTIF, because
  // Cesium refuses an outline on a clamped polygon and a tint would read as a
  // seventh class (D3).
  assert.equal(parts['2A'].polygon.extrudedHeight, undefined);
  assert.equal(parts['2A'].show, true);
  assert.match(parts['2A'].polygon.material.constructor.name, /Grid/);
  // Belfort's rate is null too — a département with zero students has nothing
  // graded, so a real measured zero always carries a refused colour — and it
  // is STRIPED, which is not the grid. The two absences stay legible as two.
  assert.match(parts[90].polygon.material.constructor.name, /Stripe/);
  assert.notEqual(parts[90].polygon.material, parts['2A'].polygon.material);

  // count ✓ rate ✗ — a prism at full height, with STRIPES instead of a hue.
  // A third motif is not needed: stripes mean "colour refused", the grid means
  // "nothing measured", and the two never appear on the same mark.
  assert.equal(parts[69].polygon.extrudedHeight, supPrismRow({ students: 192_964 }).heightM);
  assert.equal(parts[69].polygon.fill, true);
  assert.notEqual(parts[69].polygon.material, parts[75].polygon.material);
  assert.match(parts[69].polygon.material.constructor.name, /Stripe/);
  assert.match(parts[75].polygon.material.constructor.name, /Color/);
});

test('a prism starts on the ellipsoid and classifies nothing; a footprint does the reverse', () => {
  // The two rendering facts the height scale rests on. A prism: a common datum
  // (a terrain-clamped base would put Savoie's TOP 2 km higher at equal
  // enrolment) and a CLEARED `classificationType`, which an extruded polygon
  // reads and then ignores silently — leaving it set would lie to the next
  // reader. A flat footprint: the opposite, because it has no height to
  // protect and would otherwise be buried under the Alps.
  const prism = drawnPart();
  const flat = drawnPart();
  _setSupStateForTest({
    regime: 'national',
    national: {
      ...NATIONAL,
      departements: [
        { code: '75', name: 'Paris', students: 394_788, advancedShare: 42.7 },
        { code: '2A', name: 'Corse-du-Sud', advancedShare: null },
      ],
    },
    depEntities: [['75', [prism]], ['2A', [flat]]],
  });
  _repaintSupDepartementsForTest();
  assert.equal(prism.polygon.height, 0);
  assert.equal(prism.polygon.perPositionHeight, false);
  assert.equal(prism.polygon.classificationType, undefined);
  assert.equal(prism.polygon.outline, true);

  assert.equal(flat.polygon.height, undefined);
  assert.ok(flat.polygon.classificationType !== undefined);
  assert.equal(flat.polygon.outline, false);
});

test('a MultiPolygon département raises every part to the SAME height', () => {
  // Corsica draws twice. Two prisms, one number — and never a number to add up.
  const north = drawnPart();
  const south = drawnPart();
  _setSupStateForTest({
    regime: 'national',
    national: {
      ...NATIONAL,
      departements: [{ code: '2A', name: 'Corse-du-Sud', students: 738, advancedShare: 0 }],
    },
    depEntities: [['2A', [north, south]]],
  });
  _repaintSupDepartementsForTest();
  assert.equal(north.polygon.extrudedHeight, south.polygon.extrudedHeight);
  assert.equal(north.polygon.extrudedHeight, supPrismRow({ students: 738 }).heightM);
});

test('a département the rollup never mentions is a grid, and the legend counts it', () => {
  // A payload that came back short is neither a zero nor the bottom of the
  // scale, and hiding it would leave a hole the reader cannot interpret (A4).
  const part = drawnPart();
  _setSupStateForTest({
    regime: 'national',
    national: { ...NATIONAL, departements: [] },
    depEntities: [['75', [part]]],
  });
  _repaintSupDepartementsForTest();
  assert.equal(part.show, true);
  assert.match(part.polygon.material.constructor.name, /Grid/);
  const missing = _supRowControlsForTest().legend.find((row) => /non publié$/.test(row.label));
  assert.equal(missing.count, 1);
});

// --- Selecting a prism -------------------------------------------------------

test('selecting a prism recolours it and leaves its HEIGHT alone', () => {
  // Selection is a qualitative state, so it takes the hue — which carries the
  // rate — and never the height, which carries the enrolment. A selected
  // département must still state how many students it holds.
  const part = drawnPart();
  const sent = [];
  _setSupStateForTest({
    regime: 'national',
    national: NATIONAL,
    depEntities: [['75', [part]]],
    depMeta: [['75', { anchor: [2.34, 48.85] }]],
    overlayHost: {
      setEntries: (id, entries) => sent.push(entries),
      setVisible: () => {},
      clearSource: () => {},
    },
  });
  _repaintSupDepartementsForTest();
  _selectSupDepartementForTest('75');
  assert.equal(part.show, true);
  assert.equal(part.polygon.extrudedHeight, supPrismRow(NATIONAL.departements[0]).heightM);
  assert.equal(part.polygon.outline, true);
  assert.ok(part.polygon.material);
  const [entry] = sent.at(-1);
  assert.equal(entry.title, 'Paris');
  assert.match(norm(entry.details.join(' ')), /394 788 étudiants/);
});

test('a département with no published enrolment is still clickable, and says why', () => {
  // Its footprint IS drawn — hatched, flat — so a click on it must produce the
  // sentence, not silence. Silence would read as a broken map.
  const part = drawnPart();
  const sent = [];
  _setSupStateForTest({
    regime: 'national',
    national: NATIONAL,
    depEntities: [['2A', [part]]],
    depMeta: [['2A', { anchor: [8.9, 41.9] }]],
    overlayHost: {
      setEntries: (id, entries) => sent.push(entries),
      setVisible: () => {},
      clearSource: () => {},
    },
  });
  _repaintSupDepartementsForTest();
  _selectSupDepartementForTest('2A');
  assert.equal(sent.length, 1);
  assert.match(norm(sent[0][0].details.join(' ')), /Effectif étudiant non publié/);
  // No prism was raised for it, and selecting it did not raise one.
  assert.equal(part.polygon.extrudedHeight, undefined);
});

test('the ambient labels ride the prisms and are ordered by enrolment', () => {
  _setSupStateForTest({
    regime: 'national',
    national: NATIONAL,
    depMeta: [
      ['75', { anchor: [2.34, 48.85] }],
      ['69', { anchor: [4.83, 45.75] }],
      ['2A', { anchor: [8.9, 41.9] }],
    ],
  });
  const cohort = _supDepartementOverlayForTest();
  // Corse-du-Sud publishes no enrolment, so it gets no label: a label with no
  // number is a name, and this cohort exists to carry numbers.
  assert.deepEqual(cohort.map((entry) => entry.id), ['sup-fr:dep:75', 'sup-fr:dep:69']);
  assert.equal(cohort[0].position.heightM, supPrismRow(NATIONAL.departements[0]).heightM);
  assert.ok(cohort[0].position.heightM > cohort[1].position.heightM);
});

test('surfaceFill is declared only while a FLAT footprint is drawn', () => {
  // The shared "your fill is climbing the façades" notice is true of a
  // ground-classified footprint and false of every prism, which classifies
  // nothing. NATIONAL holds one measured zero and one unpublished département,
  // so it declares it; a rollup where every département has a height does not.
  _setSupStateForTest({ regime: 'national', national: NATIONAL });
  assert.equal(_supRowControlsForTest().surfaceFill, true);
  _setSupStateForTest({
    regime: 'national',
    national: {
      ...NATIONAL,
      departements: NATIONAL.departements.filter((row) => row.students > 0),
    },
  });
  assert.equal(_supRowControlsForTest().surfaceFill, false);
});

test('the national legend is empty until the rollup arrives', () => {
  _setSupStateForTest({ regime: 'national', national: null });
  assert.deepEqual(_supRowControlsForTest(), { chips: [], legend: [] });
});

// --- The status line --------------------------------------------------------

test('the national line states the sites the choropleth cannot paint', () => {
  const label = buildSupLoadingLabel({
    regime: 'national',
    status: 'ready',
    loading: false,
    national: { studentsAssigned: 2902711, painted: 96, unassigned: 214 },
  });
  assert.match(norm(label), /2 902 711 étudiants/);
  assert.match(norm(label), /96 départements/);
  assert.match(norm(label), /214 sites hors métropole/);
});

test('a national rollup with nothing unassigned prints no shortfall clause', () => {
  const label = buildSupLoadingLabel({
    regime: 'national',
    status: 'ready',
    loading: false,
    national: { studentsAssigned: 1000, painted: 3, unassigned: 0 },
  });
  assert.equal(/hors métropole/.test(label), false);
});

test('the site line reports the sites drawn and the students in them', () => {
  const label = buildSupLoadingLabel({
    regime: 'sites', status: 'ready', loading: false, count: 537, inView: 537, students: 108175,
  });
  assert.match(norm(label), /537 sites/);
  assert.match(norm(label), /108 175 étudiants/);
  // Nothing was dropped, so nothing claims to have been.
  assert.equal(/non tracés/.test(label), false);
});

test('a view holding more than the layer will draw says how many it dropped', () => {
  // The cap sits above the whole register, so this can only fire on a
  // malformed pack — and if it ever does it must not draw a short map quietly.
  const label = buildSupLoadingLabel({
    regime: 'sites', status: 'ready', loading: false, count: 8000, inView: 8600, students: 10,
  });
  assert.match(norm(label), /600 non tracés/);
});

test('an empty view says so rather than going quiet', () => {
  assert.match(
    buildSupLoadingLabel({ regime: 'sites', status: 'empty', loading: false, count: 0, inView: 0 }),
    /aucun établissement du supérieur/,
  );
});

test('an errored layer prints no count line at all', () => {
  for (const regime of ['sites', 'national']) {
    assert.equal(buildSupLoadingLabel({ regime, status: 'error', loading: false }), '');
  }
});

test('a loading layer says what it is reading, in both regimes', () => {
  for (const regime of ['sites', 'national']) {
    assert.match(buildSupLoadingLabel({ regime, loading: true }), /lecture du registre/);
  }
});

// --- The layer contract -----------------------------------------------------

test('the layer id matches the one every registry was wired with', () => {
  assert.equal(SUP_FR_LAYER_ID, 'sup-fr');
  assert.equal(supFranceLayer.id, 'sup-fr');
});

test('the layer exposes the lifecycle the data manager calls', () => {
  for (const method of ['init', 'enable', 'disable', 'update', 'destroy', 'getStats', 'getRowControls']) {
    assert.equal(typeof supFranceLayer[method], 'function', `${method} missing`);
  }
  assert.equal(typeof supFranceLayer.name, 'string');
  assert.ok(supFranceLayer.updateInterval > 0);
});

test('the poll cadence matches a register published once a year', () => {
  // Anything faster re-asks a question whose answer cannot have changed.
  assert.ok(supFranceLayer.updateInterval >= 60 * 60_000);
});

test('band labels are French and every band has one', () => {
  for (const kind of SUP_KINDS) {
    assert.equal(typeof supKindLabel(kind), 'string');
    assert.ok(supKindLabel(kind).length > 0);
  }
  assert.equal(supKindLabel('inconnu'), supKindLabel('autre'));
});
