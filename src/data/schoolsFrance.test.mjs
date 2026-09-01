// The rendering decisions: what a dot's colour and size claim, and what the
// cards say when the register has nothing to say.
//
// The recurring property under test is the layer's central honesty rule: a
// school with NO published roll must never be presented as a school with no
// pupils. 8.3% of teaching establishments are in that state, and the size
// channel cannot express the difference — so the card has to.
import test from 'node:test';
import assert from 'node:assert/strict';

import schoolsFranceLayer, {
  SCHOOLS_FR_LABEL_COHORT_LIMIT,
  SCHOOLS_FR_LAYER_ID,
  buildSchoolSelectionLabel,
  buildSchoolsDepartementLabel,
  buildSchoolsLoadingLabel,
  buildSchoolsMeshLabel,
  createSchoolsDepartementOverlayEntry,
  schoolLevelColor,
  schoolLevelLabel,
  schoolPointSize,
  schoolsDepartementAlpha,
  schoolsDepartementBinLabels,
  schoolsDepartementColor,
  schoolsMeshPointSize,
  selectSchoolsLabelCohort,
  _clearSchoolsSelectionForTest,
  _schoolsRowControlsForTest,
  _setSchoolsStateForTest,
} from './schoolsFrance.js';
import { SCHOOL_LEVELS } from './schoolsFeed.js';

/**
 * Collapse every kind of space to a plain one before matching.
 *
 * `toLocaleString('fr-FR')` separates thousands with U+202F (narrow no-break
 * space), which is correct French typography and invisible in a diff — a test
 * written with an ordinary space fails while showing output that looks
 * identical to what it expected. Normalising here keeps the assertions
 * readable and still pins the digits.
 */
const norm = (value) => String(value).replace(/[\s\u202f\u00a0]+/g, ' ');

const site = (over = {}) => ({
  id: '0450922H',
  uai: '0450922H',
  lat: 47.9,
  lon: 1.9,
  name: 'Ecole primaire des Prés Verts',
  level: 'ecole',
  nature: 'ECOLE DE NIVEAU ELEMENTAIRE',
  sector: 'public',
  enrolled: 214,
  commune: 'Orléans',
  address: '5 rue Pierre Budin',
  postal: '45000 ORLÉANS',
  ep: null,
  precision: 'adresse',
  motherUai: null,
  services: { restauration: null, hebergement: null, ulis: null, segpa: null, apprentissage: null },
  ...over,
});

const record = (over = {}) => ({ id: 'r1', site: site(over.site), ...over });

test.afterEach(() => { _clearSchoolsSelectionForTest(); });

// --- Colour -----------------------------------------------------------------

test('every level in the ladder has its own colour', () => {
  const seen = new Set();
  for (const level of SCHOOL_LEVELS) {
    const color = schoolLevelColor(level);
    assert.match(color, /^#[0-9a-f]{6}$/i);
    assert.equal(seen.has(color), false, `${level} reuses a colour`);
    seen.add(color);
  }
});

test('an unknown level falls back to the neutral band, not to a school colour', () => {
  assert.equal(schoolLevelColor('quelque chose'), schoolLevelColor('autre'));
  assert.equal(schoolLevelColor(undefined), schoolLevelColor('autre'));
  assert.notEqual(schoolLevelColor('quelque chose'), schoolLevelColor('ecole'));
});

test('the choropleth ramp is a different family from the level hues', () => {
  // A reader zooming out must not carry a category's meaning into a quantity's.
  const levels = new Set(SCHOOL_LEVELS.map(schoolLevelColor));
  for (let bin = 0; bin < 6; bin += 1) {
    assert.equal(levels.has(schoolsDepartementColor(bin)), false);
  }
});

test('a département with nothing in it gets no fill at all', () => {
  assert.equal(schoolsDepartementColor(-1), null);
  assert.equal(schoolsDepartementAlpha(-1), 0);
});

test('the ramp gets heavier as well as lighter, and is clamped at both ends', () => {
  assert.ok(schoolsDepartementAlpha(5) > schoolsDepartementAlpha(0));
  assert.equal(schoolsDepartementColor(99), schoolsDepartementColor(5));
});

test('bin labels read as ranges and the top one is open-ended', () => {
  const labels = schoolsDepartementBinLabels([294, 433, 589, 719, 1079]);
  assert.equal(labels.length, 6);
  assert.equal(labels[0], '1–294');
  assert.equal(labels[1], '295–433');
  assert.equal(labels.at(-1), '> 1079');
});

// --- Size -------------------------------------------------------------------

test('a bigger roll is a bigger dot, sub-linearly', () => {
  assert.ok(schoolPointSize(1500) > schoolPointSize(200));
  assert.ok(schoolPointSize(200) > schoolPointSize(30));
  // Area, not radius, is what the eye reads — a 27× roll must not be a 27× dot.
  assert.ok(schoolPointSize(1500) / schoolPointSize(55) < 3);
});

test('an unpublished roll draws at the base size, and so does a tiny school', () => {
  // This is the ambiguity the card exists to resolve; the size channel cannot.
  assert.equal(schoolPointSize(null), schoolPointSize(0));
  assert.equal(schoolPointSize(undefined), schoolPointSize(0));
  assert.equal(schoolPointSize(NaN), schoolPointSize(0));
});

test('mesh dots are strictly smaller than exact dots at the same roll', () => {
  // They stand for a sample, not an inventory, and must not be mistaken for one.
  for (const pupils of [0, 100, 800, 2000]) {
    assert.ok(schoolsMeshPointSize(pupils) < schoolPointSize(pupils), `at ${pupils}`);
  }
});

test('the size is bounded, so one huge lycée cannot blot out its neighbours', () => {
  assert.equal(schoolPointSize(2000), schoolPointSize(50_000));
  assert.equal(schoolsMeshPointSize(2000), schoolsMeshPointSize(50_000));
});

// --- The selection card -----------------------------------------------------

test('the card leads with the name and states the roll', () => {
  const copy = buildSchoolSelectionLabel(record()).split('\n');
  assert.equal(copy[0], 'Ecole primaire des Prés Verts');
  assert.ok(copy.some((line) => norm(line).includes('214 élèves')));
});

test('a school with no roll says so, and never says zero', () => {
  const copy = buildSchoolSelectionLabel(record({ site: site({ enrolled: null }) }));
  assert.match(copy, /Effectif non publié/);
  assert.equal(/0 élèves/.test(copy), false);
});

test('a commune-centroid coordinate is called out with a warning', () => {
  // 2 159 rows are geocoded to the town centre. A dot that does not admit that
  // is a dot claiming to know where the school is.
  const copy = buildSchoolSelectionLabel(record({ site: site({ precision: 'commune' }) }));
  assert.match(copy, /Centre de la commune/);
  assert.match(copy, /⚠/);
  // An exact coordinate says nothing — the absence of a warning IS the signal.
  assert.equal(/Centre de la commune/.test(buildSchoolSelectionLabel(record())), false);
});

test('a sub-UAI section names its parent, so two dots at one address read', () => {
  const copy = buildSchoolSelectionLabel(record({ site: site({ motherUai: '0390033Z' }) }));
  assert.match(copy, /Rattaché à l'UAI 0390033Z/);
});

test('éducation prioritaire keeps its exact designation on the card', () => {
  assert.match(buildSchoolSelectionLabel(record({ site: site({ ep: 'REP+' }) })), /REP\+/);
  const rep = buildSchoolSelectionLabel(record({ site: site({ ep: 'REP' }) }));
  assert.match(rep, /Éducation prioritaire : REP/);
  assert.equal(/REP\+/.test(rep), false);
});

test('undeclared services are omitted, not denied', () => {
  // null means "not declared". Printing "pas de restauration" would be a claim
  // the register never made.
  const undeclared = buildSchoolSelectionLabel(record());
  assert.equal(/restauration/.test(undeclared), false);
  const declared = buildSchoolSelectionLabel(record({
    site: site({ services: { restauration: true, hebergement: false, ulis: null, segpa: null, apprentissage: null } }),
  }));
  assert.match(declared, /restauration/);
  // A declared FALSE is also not printed — the card lists what is there.
  assert.equal(/internat/.test(declared), false);
});

test('a nameless row still produces a card with a usable title', () => {
  const copy = buildSchoolSelectionLabel(record({ site: site({ name: null }) }));
  assert.equal(copy.split('\n')[0], 'Orléans');
  const bare = buildSchoolSelectionLabel(record({ site: site({ name: null, commune: null }) }));
  assert.equal(bare.split('\n')[0], 'Établissement scolaire');
});

test('the card never throws on a missing or empty record', () => {
  assert.doesNotThrow(() => buildSchoolSelectionLabel(undefined));
  assert.doesNotThrow(() => buildSchoolSelectionLabel({}));
  assert.doesNotThrow(() => buildSchoolSelectionLabel({ site: {} }));
});

// --- The mesh card ----------------------------------------------------------

test('a maillage card admits it has no name and points at the zoom that does', () => {
  const copy = buildSchoolsMeshLabel({ mesh: true, site: { level: 'lycee', enrolled: 1200 } });
  assert.match(norm(copy), /1 200 élèves/);
  assert.match(copy, /zoomez/i);
  // It must not invent a title it does not have.
  assert.equal(copy.split('\n')[0], 'Établissement');
});

test('a maillage card with no roll makes the same distinction as the site card', () => {
  const copy = buildSchoolsMeshLabel({ mesh: true, site: { level: 'ecole', enrolled: null } });
  assert.match(copy, /Effectif non publié/);
});

// --- The département card ---------------------------------------------------

test('the département card gives the count, the roll and the rate', () => {
  const copy = buildSchoolsDepartementLabel({
    code: '59', name: 'Nord', schools: 2504, pupils: 466210,
    public: 2000, prive: 504, ep: 300, per1000Km2: 436.3,
  });
  assert.equal(copy.split('\n')[0], 'Nord');
  assert.match(norm(copy), /2 504 établissements/);
  assert.match(norm(copy), /466 210 élèves/);
  assert.match(norm(copy), /2 000 public/);
  assert.match(norm(copy), /504 privé/);
  assert.match(norm(copy), /300 en éducation prioritaire/);
  // The fill is an absolute count, so the rate has to be printed beside it.
  assert.match(norm(copy), /436\.3 pour 1 000 km²/);
});

test('a département with no roll and no EP prints neither line', () => {
  const copy = buildSchoolsDepartementLabel({
    code: '48', name: 'Lozère', schools: 120, pupils: 0, public: 120, prive: 0, ep: 0, per1000Km2: 23.2,
  });
  assert.equal(/élèves/.test(copy), false);
  assert.equal(/éducation prioritaire/.test(copy), false);
  assert.match(norm(copy), /120 établissements/);
});

// --- The ambient label cohort ----------------------------------------------

test('the cohort keeps the largest départements and is bounded', () => {
  const entries = [];
  for (let i = 0; i < 40; i += 1) {
    entries.push(createSchoolsDepartementOverlayEntry(
      { code: String(i), name: `D${i}`, schools: i, bin: 3 },
      { anchor: [1, 1] },
    ));
  }
  const cohort = selectSchoolsLabelCohort(entries);
  assert.equal(cohort.length, SCHOOLS_FR_LABEL_COHORT_LIMIT);
  assert.equal(cohort[0].priority, 39);
  // A caller cannot raise the ceiling by asking for more.
  assert.equal(selectSchoolsLabelCohort(entries, 999).length, SCHOOLS_FR_LABEL_COHORT_LIMIT);
  assert.deepEqual(selectSchoolsLabelCohort(entries, 0), []);
  assert.deepEqual(selectSchoolsLabelCohort(null), []);
});

test('a département label carries its count and its own bin colour', () => {
  const entry = createSchoolsDepartementOverlayEntry(
    { code: '59', name: 'Nord', schools: 2504, bin: 5 },
    { anchor: [3, 50] },
  );
  assert.equal(norm(entry.title), 'Nord · 2 504');
  assert.equal(entry.accent, schoolsDepartementColor(5));
  assert.equal(entry.id, 'schools-fr:dep:59');
});

// --- The row legend ---------------------------------------------------------

test('the site legend counts establishments by level and drops empty rows', () => {
  _setSchoolsStateForTest({
    regime: 'sites',
    records: [
      record({ id: 'a', site: site({ level: 'ecole' }) }),
      record({ id: 'b', site: site({ level: 'ecole' }) }),
      record({ id: 'c', site: site({ level: 'lycee' }) }),
    ],
  });
  const { legend } = _schoolsRowControlsForTest();
  assert.deepEqual(legend.map((row) => row.label), ['École', 'Lycée']);
  assert.deepEqual(legend.map((row) => row.count), [2, 1]);
});

test('the maillage legend says the mix it shows is a sample', () => {
  // Not saying so would let a reader take the thinned mix for the national one.
  _setSchoolsStateForTest({
    regime: 'mesh',
    records: [record({ id: 'a', mesh: true, site: site({ level: 'ecole' }) })],
  });
  const { legend } = _schoolsRowControlsForTest();
  assert.match(legend[0].blurb, /échantillon/);
});

test('the national legend is the quantile ramp, and only the ramp', () => {
  _setSchoolsStateForTest({
    regime: 'national',
    national: {
      thresholds: [294, 433, 589, 719, 1079],
      departements: [
        { code: '59', name: 'Nord', schools: 2504, bin: 5 },
        { code: '48', name: 'Lozère', schools: 120, bin: 0 },
        { code: '90', name: 'Belfort', schools: 0, bin: -1 },
      ],
    },
  });
  const { legend } = _schoolsRowControlsForTest();
  assert.equal(legend.length, 2);
  assert.ok(legend.every((row) => row.label.endsWith('établissements')));
  // A bin nobody is in is not a legend row.
  assert.equal(legend.some((row) => row.count === 0), false);
});

test('the national legend is empty until the rollup arrives', () => {
  _setSchoolsStateForTest({ regime: 'national', national: null });
  assert.deepEqual(_schoolsRowControlsForTest(), { chips: [], legend: [] });
});

// --- The status line --------------------------------------------------------

test('the maillage line names BOTH counts, or it is claiming France has 1 100 schools', () => {
  const label = buildSchoolsLoadingLabel({
    regime: 'mesh', status: 'ready', loading: false,
    meshPick: { picked: new Array(1100), inBox: 12000, thinned: true },
  });
  assert.match(norm(label), /1 100/);
  assert.match(norm(label), /12 000/);
  assert.match(label, /échantillon/);
});

test('an unthinned maillage does not claim to be a sample', () => {
  const label = buildSchoolsLoadingLabel({
    regime: 'mesh', status: 'ready', loading: false,
    meshPick: { picked: new Array(40), inBox: 40, thinned: false },
  });
  assert.equal(/échantillon/.test(label), false);
  assert.match(norm(label), /40 établissements/);
});

test('the national line states the schools the choropleth cannot paint', () => {
  // 2 762 overseas schools are outside every bundled polygon. The line that
  // reports the choropleth is where that has to be admitted.
  const label = buildSchoolsLoadingLabel({
    regime: 'national', status: 'ready', loading: false,
    national: { assigned: 65396, painted: 96, unassigned: 2762 },
  });
  assert.match(norm(label), /65 396/);
  assert.match(norm(label), /96 départements/);
  assert.match(norm(label), /2 762 hors métropole/);
});

test('a national rollup with nothing unassigned prints no shortfall clause', () => {
  const label = buildSchoolsLoadingLabel({
    regime: 'national', status: 'ready', loading: false,
    national: { assigned: 100, painted: 3, unassigned: 0 },
  });
  assert.equal(/hors métropole/.test(label), false);
});

test('the site line reports a truncated upstream answer', () => {
  const label = buildSchoolsLoadingLabel({
    regime: 'sites', status: 'ready', loading: false, count: 537,
    summary: { pupils: 108175, complete: false },
  });
  assert.match(norm(label), /537 établissements/);
  assert.match(norm(label), /108 175 élèves/);
  assert.match(label, /tronquée/);
});

test('an empty view says so rather than going quiet', () => {
  assert.match(
    buildSchoolsLoadingLabel({ regime: 'sites', status: 'empty', loading: false, count: 0 }),
    /aucun établissement/,
  );
  assert.match(
    buildSchoolsLoadingLabel({
      regime: 'mesh', status: 'ready', loading: false, meshPick: { picked: [], inBox: 0, thinned: false },
    }),
    /aucun établissement/,
  );
});

test('an errored layer prints no count line at all', () => {
  for (const regime of ['sites', 'mesh', 'national']) {
    assert.equal(buildSchoolsLoadingLabel({ regime, status: 'error', loading: false }), '');
  }
});

// --- The layer contract -----------------------------------------------------

test('the layer id matches the one every registry was wired with', () => {
  assert.equal(SCHOOLS_FR_LAYER_ID, 'schools-fr');
  assert.equal(schoolsFranceLayer.id, 'schools-fr');
});

test('the layer exposes the lifecycle the data manager calls', () => {
  for (const method of ['init', 'enable', 'disable', 'update', 'destroy', 'getStats', 'getRowControls']) {
    assert.equal(typeof schoolsFranceLayer[method], 'function', `${method} missing`);
  }
  assert.equal(typeof schoolsFranceLayer.name, 'string');
  assert.ok(schoolsFranceLayer.updateInterval > 0);
});

test('level labels are French and every level has one', () => {
  for (const level of SCHOOL_LEVELS) {
    assert.equal(typeof schoolLevelLabel(level), 'string');
    assert.ok(schoolLevelLabel(level).length > 0);
  }
  assert.equal(schoolLevelLabel('inconnu'), schoolLevelLabel('autre'));
});
