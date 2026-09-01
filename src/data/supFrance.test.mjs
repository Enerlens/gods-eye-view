// The rendering decisions: what a dot's colour and size claim, and what the
// cards say about the two things this register cannot express on its own.
//
// The recurring property under test is that a dot never overstates what it
// stands for. A campus dot is one SITE of an establishment, not the
// establishment; a borrowed coordinate is a thing the map did, not a thing the
// register said; and the choropleth counts students, not dots. None of those
// distinctions survive in the colour or the size channel, so the cards and the
// status line are where they have to live.
import test from 'node:test';
import assert from 'node:assert/strict';

import supFranceLayer, {
  SUP_FR_LABEL_COHORT_LIMIT,
  SUP_FR_LAYER_ID,
  buildSupDepartementLabel,
  buildSupLoadingLabel,
  buildSupSelectionLabel,
  cameraSupBox,
  createSupDepartementOverlayEntry,
  selectSupLabelCohort,
  supDepartementAlpha,
  supDepartementBinLabels,
  supDepartementColor,
  supKindColor,
  supKindLabel,
  supPointSize,
  supSiteInBox,
  supViewSpanDeg,
  _clearSupSelectionForTest,
  _setSupStateForTest,
  _supRowControlsForTest,
} from './supFrance.js';
import { SUP_KINDS } from './supFeed.js';
import { SCHOOL_LEVELS } from './schoolsFeed.js';
import { schoolLevelColor } from './schoolsFrance.js';

/**
 * Collapse every kind of space to a plain one before matching.
 * `toLocaleString('fr-FR')` separates thousands with U+202F, which is correct
 * French typography and invisible in a diff.
 */
const norm = (value) => String(value).replace(/[\s  ]+/g, ' ');

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

test('the choropleth ramp is a different family from the band hues', () => {
  // A reader zooming out must not carry a category's meaning into a quantity's.
  const bands = new Set(SUP_KINDS.map(supKindColor));
  for (let bin = 0; bin < 6; bin += 1) {
    assert.equal(bands.has(supDepartementColor(bin)), false);
  }
});

test('a département with nothing in it gets no fill at all', () => {
  assert.equal(supDepartementColor(-1), null);
  assert.equal(supDepartementAlpha(-1), 0);
});

test('the ramp gets heavier as well as lighter, and is clamped at both ends', () => {
  assert.ok(supDepartementAlpha(5) > supDepartementAlpha(0));
  assert.equal(supDepartementColor(99), supDepartementColor(5));
});

test('bin labels read as ranges, are grouped, and the top one is open-ended', () => {
  const labels = supDepartementBinLabels([2297, 4259, 9841, 27905, 53455]);
  assert.equal(labels.length, 6);
  assert.equal(norm(labels[0]), '1–2 297');
  assert.equal(norm(labels[1]), '2 298–4 259');
  assert.equal(norm(labels.at(-1)), '> 53 455');
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

test('a département label carries its student count and its own bin colour', () => {
  const entry = createSupDepartementOverlayEntry(
    { code: '75', name: 'Paris', students: 394788, bin: 5 },
    { anchor: [2, 48] },
  );
  assert.equal(norm(entry.title), 'Paris · 394 788');
  assert.equal(entry.accent, supDepartementColor(5));
  assert.equal(entry.id, 'sup-fr:dep:75');
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

test('the national legend is the quantile ramp, and says it counts students', () => {
  _setSupStateForTest({
    regime: 'national',
    national: {
      thresholds: [2297, 4259, 9841, 27905, 53455],
      departements: [
        { code: '75', name: 'Paris', students: 394788, bin: 5 },
        { code: '48', name: 'Lozère', students: 300, bin: 0 },
        { code: '90', name: 'Belfort', students: 0, bin: -1 },
      ],
    },
  });
  const { legend } = _supRowControlsForTest();
  assert.equal(legend.length, 2);
  assert.ok(legend.every((row) => row.label.endsWith('étudiants')));
  // A bin nobody is in is not a legend row.
  assert.equal(legend.some((row) => row.count === 0), false);
  assert.match(legend.at(-1).blurb, /ÉTUDIANTS/);
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
