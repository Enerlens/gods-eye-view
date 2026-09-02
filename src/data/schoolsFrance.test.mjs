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
  schoolCalloutText,
  schoolsMeshPointSize,
  pickMeshSite,
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

test('a maillage card being resolved says the name is on its way', () => {
  const copy = buildSchoolsMeshLabel({
    mesh: true, resolving: true, site: { level: 'lycee', enrolled: 1200 },
  });
  assert.match(norm(copy), /1 200 élèves/);
  assert.match(copy, /lecture du nom/i);
  // It must not invent a title it does not have.
  assert.equal(copy.split('\n')[0], 'Établissement');
});

test('a maillage card whose lookup found nothing says so, and does not blame the zoom', () => {
  const copy = buildSchoolsMeshLabel({ mesh: true, site: { level: 'lycee', enrolled: 1200 } });
  assert.match(copy, /introuvable dans le registre/i);
  assert.doesNotMatch(copy, /zoom/i);
  assert.equal(copy.split('\n')[0], 'Établissement');
});

test('a maillage card that HAS its name is the same card the exact regime draws', () => {
  const resolved = {
    name: 'Collège Jean Moulin', level: 'college', nature: 'COLLEGE', sector: 'public',
    enrolled: 612, commune: 'Lyon', uai: '0690123X',
  };
  const copy = buildSchoolsMeshLabel({ mesh: true, resolved, site: { level: 'college', enrolled: 612 } });
  assert.equal(copy, buildSchoolSelectionLabel({ site: resolved }));
  // The whole point: the title is the school, at every altitude that draws it.
  assert.equal(copy.split('\n')[0], 'Collège Jean Moulin');
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

// --- Naming a maillage dot --------------------------------------------------
//
// The maillage ships coordinates, not UAIs, so a click resolves the register
// by POSITION — and several UAIs legitimately share one. These are the rules
// that decide which of them the card is about.

test('a lookup picks the establishment at the clicked coordinate and ignores its neighbours', () => {
  const here = { lat: 45.76052, lon: 4.82371, level: 'college', name: 'Collège Jean Moulin', enrolled: 612 };
  const nextDoor = { lat: 45.76233, lon: 4.82410, level: 'ecole', name: 'École Jules Ferry', enrolled: 210 };
  const { site, sharing } = pickMeshSite([nextDoor, here], '45.76052,4.82371', 'college');
  assert.equal(site.name, 'Collège Jean Moulin');
  assert.equal(sharing, 0);
});

test('when a SEGPA shares its collège\'s address, the tuple\'s own level decides', () => {
  // Trap 1 in schoolsFeed.js: 2 212 sections sit at their parent's coordinate.
  const college = { lat: 45.76052, lon: 4.82371, level: 'college', name: 'Collège Jean Moulin', enrolled: 612 };
  const segpa = { lat: 45.76052, lon: 4.82371, level: 'adapte', name: 'SEGPA du collège Jean Moulin', enrolled: null };
  const picked = pickMeshSite([segpa, college], '45.76052,4.82371', 'college');
  assert.equal(picked.site.name, 'Collège Jean Moulin');
  // The other UAI is not discarded quietly — the card gets to say it is there.
  assert.equal(picked.sharing, 1);
});

test('with no level match the largest roll wins, never the array order', () => {
  const small = { lat: 1.00000, lon: 2.00000, level: 'ecole', name: 'Annexe', enrolled: 40 };
  const large = { lat: 1.00000, lon: 2.00000, level: 'ecole', name: 'Groupe scolaire', enrolled: 400 };
  assert.equal(pickMeshSite([small, large], '1.00000,2.00000', 'lycee').site.name, 'Groupe scolaire');
  assert.equal(pickMeshSite([large, small], '1.00000,2.00000', 'lycee').site.name, 'Groupe scolaire');
});

test('a coordinate the register does not know resolves to nothing, not to a neighbour', () => {
  const elsewhere = { lat: 48.85660, lon: 2.35220, level: 'ecole', name: 'École du coin', enrolled: 120 };
  assert.deepEqual(pickMeshSite([elsewhere], '45.76052,4.82371', 'ecole'), { site: null, sharing: 0 });
  assert.deepEqual(pickMeshSite(null, '45.76052,4.82371', 'ecole'), { site: null, sharing: 0 });
});

test('a card whose position is shared says how many other UAIs are on it', () => {
  const copy = buildSchoolSelectionLabel({
    site: { name: 'Collège Jean Moulin', level: 'college', enrolled: 612, sharing: 2 },
  });
  assert.match(norm(copy), /2 autres UAI/);
  assert.doesNotMatch(buildSchoolSelectionLabel({
    site: { name: 'Collège Jean Moulin', level: 'college', enrolled: 612, sharing: 0 },
  }), /UAI enregistr/);
});

// --- The DETECT callout -----------------------------------------------------

test('a detected school is named, not counted', () => {
  assert.equal(
    schoolCalloutText({ site: { name: 'Collège Jean Moulin', level: 'college', enrolled: 612 } }),
    'Collège Jean Moulin',
  );
});

test('a resolved maillage dot is named in DETECT too, from the same lookup', () => {
  assert.equal(
    schoolCalloutText({
      mesh: true,
      resolved: { name: 'Lycée du Parc', level: 'lycee', enrolled: 1800 },
      site: { level: 'lycee', enrolled: 1800 },
    }),
    'Lycée du Parc',
  );
});

test('an unnamed dot falls back to what the pack actually shipped', () => {
  assert.equal(
    norm(schoolCalloutText({ mesh: true, site: { level: 'ecole', enrolled: 1200 } })),
    'École · 1 200 élèves',
  );
  assert.equal(
    schoolCalloutText({ mesh: true, site: { level: 'ecole', enrolled: null } }),
    'École',
  );
});

// --- The IPS on the card ----------------------------------------------------
//
// The layer's honesty rule, applied to the second attribute: 40 529 of the
// 62 857 drawn schools that can carry an index have one. The dot
// says nothing about the other 22 328 (62 857 - 40 529) — its colour is the level and its size
// is the roll — so the CARD is the only surface that can, and it has to make
// four different absences read as four different sentences.

/** An IPS record shaped as `indexIps` produces them. */
const ips = (over = {}) => ({
  kind: 'ecole', rentree: '2024-2025', status: 'ok', value: 97.2, sentinel: null,
  spread: null, lyceeType: null, voies: null, national: 105.8, departemental: 108.7, ...over,
});

test('the IPS sits under the roll, and names its own rentrée', () => {
  // The écoles file is a year behind the roll files. One year printed for both
  // would be a claim neither source makes.
  const copy = buildSchoolSelectionLabel(record({ site: site({ ips: ips() }) })).split('\n');
  const roll = copy.findIndex((line) => /élèves/.test(line));
  const index = copy.findIndex((line) => /^IPS /.test(line));
  assert.ok(roll >= 0 && index === roll + 1);
  assert.match(copy[index], /IPS 97,2 — rentrée 2024-2025/);
  assert.match(norm(copy[roll]), /rentrée 2025/);
});

test('a school with no published IPS says so, and is never read as average', () => {
  const copy = buildSchoolSelectionLabel(record({ site: site({ ips: null }) }));
  assert.match(copy, /IPS non publié pour cet UAI/);
  // The one failure this join exists to make impossible.
  assert.equal(/IPS 0/.test(copy), false);
  assert.equal(/IPS 10/.test(copy), false);
});

test('a school the index does not cover says nothing about the index', () => {
  // A rectorat is in the register and is not a school. Reporting "IPS non
  // publié" on its card invents a gap.
  const copy = buildSchoolSelectionLabel(record({ site: site({ level: 'autre', ips: undefined }) }));
  assert.equal(/IPS/.test(copy), false);
});

test('a dead DEPP file reads as a broken pipe, not as a country of gaps', () => {
  const copy = buildSchoolSelectionLabel(record({ site: site({ ips: { status: 'unavailable', value: null } }) }));
  assert.match(copy, /indisponible/);
  assert.equal(/non publié/.test(copy), false);
});

test('a withheld index is distinguishable from an absent one, on the card', () => {
  const withheld = buildSchoolSelectionLabel(record({
    site: site({ ips: ips({ status: 'ns', value: null, sentinel: 'NS' }) }),
  }));
  const absent = buildSchoolSelectionLabel(record({ site: site({ ips: null }) }));
  assert.match(withheld, /non significatif/);
  assert.notEqual(withheld, absent);
});

test('a lycée card names the voies its establishment index blends', () => {
  const copy = buildSchoolSelectionLabel(record({
    site: site({
      level: 'lycee',
      ips: ips({
        kind: 'lycee', rentree: '2025-2026', value: 126.3, spread: 40.5, lyceeType: 'LPO',
        voies: { gt: 140.1, pro: 92.4 }, national: 104.4, departemental: 118.3,
      }),
    }),
  }));
  assert.match(copy, /établissement entier \(LPO\)/);
  assert.match(copy, /voie générale et technologique 140,1/);
  assert.match(copy, /voie professionnelle 92,4/);
  // And the baseline is the LPO one, not the LEGT one 15.8 points above it.
  assert.match(copy, /Réf. LPO/);
});

test('a maillage card that has been resolved carries the index too', () => {
  // The pack ships no IPS — a click fetches the register for one coordinate,
  // and the card it produces is the same card the exact regime draws.
  const resolved = { ...site({ ips: ips({ value: 88.4 }) }) };
  const copy = buildSchoolsMeshLabel({ mesh: true, resolved, site: { level: 'ecole', enrolled: 214 } });
  assert.equal(copy, buildSchoolSelectionLabel({ site: resolved }));
  assert.match(copy, /IPS 88,4/);
});

test('an unresolved maillage dot claims no index rather than an empty one', () => {
  const copy = buildSchoolsMeshLabel({ mesh: true, resolving: true, site: { level: 'ecole', enrolled: 214 } });
  assert.equal(/IPS/.test(copy), false);
});

test('the site status line states the coverage of THIS view', () => {
  const label = buildSchoolsLoadingLabel({
    regime: 'sites', status: 'ready', loading: false, count: 537,
    summary: { pupils: 108175, complete: true, ips: { eligible: 498, joined: 350, valued: 341, status: 'ok' } },
  });
  assert.match(norm(label), /537 établissements/);
  assert.match(norm(label), /IPS publié pour 341 des 498 établissements concernés/);
});

test('the national line states the coverage the choropleth cannot colour', () => {
  const label = buildSchoolsLoadingLabel({
    regime: 'national', status: 'ready', loading: false,
    national: {
      assigned: 65396, painted: 96, unassigned: 2762,
      ips: { eligible: 62857, joined: 42974, valued: 40529, status: 'ok' },
    },
  });
  assert.match(norm(label), /65 396/);
  assert.match(norm(label), /IPS publié pour 40 529 des 62 857 établissements concernés/);
});

test('a payload with no IPS block prints no IPS clause at all', () => {
  // An older cached answer must not be reported as a view with no indices.
  const label = buildSchoolsLoadingLabel({
    regime: 'sites', status: 'ready', loading: false, count: 537,
    summary: { pupils: 108175, complete: true, ips: null },
  });
  assert.equal(/IPS/.test(label), false);
});

test('the maillage legend says where the index comes from in that regime', () => {
  _setSchoolsStateForTest({
    regime: 'mesh',
    records: [record({ id: 'a', mesh: true, site: site({ level: 'ecole' }) })],
  });
  const { legend } = _schoolsRowControlsForTest();
  assert.match(legend[0].blurb, /IPS arrive au clic/);
});

test('the level ladder and the dot sizes are untouched by the IPS join', () => {
  // The layer is SHIPPED. Its colour means level and its size means roll, and
  // adding an attribute may not quietly move either.
  const withIps = site({ ips: ips({ value: 60 }) });
  const without = site();
  assert.equal(schoolPointSize(withIps.enrolled), schoolPointSize(without.enrolled));
  assert.equal(schoolLevelColor(withIps.level), schoolLevelColor(without.level));
  _setSchoolsStateForTest({
    regime: 'sites',
    records: [record({ id: 'a', site: withIps }), record({ id: 'b', site: without })],
  });
  const { legend } = _schoolsRowControlsForTest();
  assert.deepEqual(legend.map((row) => row.label), ['École']);
  assert.deepEqual(legend.map((row) => row.count), [2]);
});
