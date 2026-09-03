// The rendering decisions: what a dot's colour and size claim, and what the
// cards say when the register has nothing to say.
//
// The recurring property under test is the layer's central honesty rule: a
// school with NO published roll must never be presented as a school with no
// pupils. 8.3% of teaching establishments are in that state, and the size
// channel cannot express the difference — so the card has to.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';

import { PRISM_BODY_ALPHA, PRISM_TOP_ALPHA } from './choroplethPrism.js';

import schoolsFranceLayer, {
  SCHOOLS_FR_LABEL_COHORT_LIMIT,
  SCHOOLS_FR_LAYER_ID,
  SCHOOLS_PRISM_SCALE,
  buildSchoolSelectionLabel,
  buildSchoolsDepartementLabel,
  buildSchoolsLoadingLabel,
  buildSchoolsMeshLabel,
  buildSchoolsNationalLegend,
  createSchoolsDepartementOverlayEntry,
  schoolLevelColor,
  schoolLevelLabel,
  schoolPointSize,
  schoolsDensityColor,
  schoolsDepartementLabelHeightM,
  schoolsMeshPointSize,
  schoolsPrismRow,
  schoolsPrismTally,
  schoolCalloutText,
  pickMeshSite,
  selectSchoolsLabelCohort,
  _clearSchoolsSelectionForTest,
  _schoolsDepartementOverlayForTest,
  _schoolsRowControlsForTest,
  _selectSchoolsDepartementForTest,
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

test('the density ramp is a different family from the level hues', () => {
  // A reader zooming out must not carry a category's meaning into a quantity's.
  const levels = new Set(SCHOOL_LEVELS.map(schoolLevelColor));
  for (const color of SCHOOLS_PRISM_SCALE.ratioColors) {
    assert.equal(levels.has(color), false);
  }
});

test('an unpublished density gets no colour at all, not the bottom of the ramp', () => {
  // D3: the missing class is a motif, so this must refuse rather than pick a
  // tint that sits inside the ramp's own family.
  assert.equal(schoolsDensityColor(null), null);
  assert.equal(schoolsDensityColor(undefined), null);
  assert.equal(schoolsDensityColor(NaN), null);
  assert.equal(schoolsDensityColor(''), null);
  // A measured zero density IS a value and gets the bottom class.
  assert.equal(schoolsDensityColor(0), SCHOOLS_PRISM_SCALE.ratioColors[0]);
});

test('the density ramp is ordered, and the constant body alpha keeps it ordered', () => {
  // The whole reason `choroplethAlpha`'s descending ladder is NOT imported
  // here: with a constant alpha, `a·c + (1-a)·bg` is monotone in c for every
  // background, so the ordering cannot inverse the way it did under the flat
  // fill. What has to be checked is separation, and it is checked here.
  const lin = (channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const ls = SCHOOLS_PRISM_SCALE.ratioColors.map(luminance);
  for (let i = 1; i < ls.length; i += 1) {
    assert.ok(ls[i] > ls[i - 1], `class ${i} must be lighter than ${i - 1}`);
    // Composited at PRISM_BODY_ALPHA = 0.62 over ANY background.
    assert.ok((ls[i] - ls[i - 1]) * 0.62 > 0.05, `classes ${i - 1}/${i} too close`);
  }
  for (const background of [0, 0.25, 0.5, 0.75, 1]) {
    const composited = ls.map((l) => 0.62 * l + 0.38 * background);
    for (let i = 1; i < composited.length; i += 1) {
      assert.ok(composited[i] > composited[i - 1], `inverted over ${background}`);
    }
  }
});

test('the density ladder classes every département and never leaves an empty colour', () => {
  // Measured populations of the six frozen classes on the 2026-09-03 export:
  // 8 · 34 · 30 · 14 · 4 · 6. A colour the legend shows and nobody wears is a
  // key a reader is told to look for and can never find.
  const samples = [29, 41, 92, 140.5, 249, 436, 615.6, 925, 14303.4];
  const seen = new Set(samples.map((d) => schoolsDensityColor(d)));
  assert.ok(seen.size >= 5);
  assert.equal(schoolsDensityColor(29), SCHOOLS_PRISM_SCALE.ratioColors[0]);
  assert.equal(schoolsDensityColor(14303.4), SCHOOLS_PRISM_SCALE.ratioColors.at(-1));
  // Gironde and Yvelines hold exactly 1 416 establishments each — the same
  // height — and this is the pair that proves the colour is the audit of the
  // height rather than its decoration.
  assert.notEqual(schoolsDensityColor(140.5), schoolsDensityColor(615.6));
});

// --- The prism ---------------------------------------------------------------

test('the frozen domain is published, linear, and above the measured maximum', () => {
  // C1: the domain is a literal this module measured once, never a quantile
  // recomputed from the rows in hand. Nord, the tallest, was 2 504.
  assert.equal(SCHOOLS_PRISM_SCALE.domainMax, 2600);
  assert.equal(SCHOOLS_PRISM_SCALE.domainMin, 0);
  assert.ok(SCHOOLS_PRISM_SCALE.domainMax > 2504);
  // Linear and not sqrt: the count range is 1 : 16.7, well inside the ruler a
  // reader can use, and the 4 km floor never bites on the real data.
  assert.equal(SCHOOLS_PRISM_SCALE.mode, 'linear');
  assert.equal(schoolsPrismRow({ schools: 150, per1000Km2: 29 }).heightM > 4000, true);
});

test('the height is the count, monotone and clamped at the frozen top', () => {
  const h = (schools) => schoolsPrismRow({ schools, per1000Km2: 100 }).heightM;
  assert.ok(h(2504) > h(1416));
  assert.ok(h(1416) > h(577));
  assert.ok(h(577) > h(150));
  // Linear means twice as tall is twice as many. Nothing else is readable off
  // a map without the legend in hand.
  assert.ok(Math.abs(h(1000) / h(500) - 2) < 1e-9);
  assert.equal(h(5000), h(2600));
  assert.equal(schoolsPrismRow({ schools: 5000, per1000Km2: 100 }).clipped, true);
  assert.equal(schoolsPrismRow({ schools: 2504, per1000Km2: 100 }).clipped, false);
});

test('a measured zero and an unmeasured département are two different marks', () => {
  // A1, and the reason the rollup's `truncated` flag is read here: the sweep
  // writes 0 for both, and only a short export makes a zero unprovable.
  const zero = schoolsPrismRow({ schools: 0, per1000Km2: 0 });
  assert.equal(zero.hasValue, true);
  assert.equal(zero.measuredZero, true);
  assert.equal(zero.extruded, false);
  assert.equal(zero.heightM, 0);
  assert.ok(zero.color, 'a measured zero still gets its density colour');

  const unproven = schoolsPrismRow({ schools: 0, per1000Km2: 0 }, { truncated: true });
  assert.equal(unproven.hasValue, false);
  assert.equal(unproven.measuredZero, false);
  assert.equal(unproven.heightM, null);
  // And a truncated sweep does not demote a département that DID answer.
  const short = schoolsPrismRow({ schools: 150, per1000Km2: 29 }, { truncated: true });
  assert.equal(short.hasValue, true);
});

test('a malformed count is an absence, never a zero-height prism', () => {
  for (const schools of [null, undefined, 'beaucoup', NaN, [], true, -3]) {
    const built = schoolsPrismRow({ schools, per1000Km2: 100 });
    assert.equal(built.hasValue, false, `${String(schools)} must not measure`);
    assert.equal(built.heightM, null);
    assert.equal(built.measuredZero, false);
  }
});

test('the two absences are independent: a height with no colour, a colour with no height', () => {
  const noRate = schoolsPrismRow({ schools: 900, per1000Km2: null });
  assert.equal(noRate.extruded, true);
  assert.equal(noRate.color, null);
  const noCount = schoolsPrismRow({ schools: null, per1000Km2: 300 });
  assert.equal(noCount.hasValue, false);
  assert.ok(noCount.color, 'the rate is published and keeps its colour');
});

test('a label rides the top of its own prism, and an unmeasured one stays on the ground', () => {
  const tall = schoolsDepartementLabelHeightM({ schools: 2504, per1000Km2: 436 });
  const short = schoolsDepartementLabelHeightM({ schools: 150, per1000Km2: 29 });
  assert.ok(tall > short);
  assert.equal(schoolsDepartementLabelHeightM({ schools: null }), 0);
  assert.equal(schoolsDepartementLabelHeightM({ schools: 0, per1000Km2: 0 }), 0);
});

test('the tally counts every state the legend has to publish', () => {
  const tally = schoolsPrismTally({
    departements: [
      { code: '59', schools: 2504, per1000Km2: 436.3 },
      { code: '33', schools: 1416, per1000Km2: 140.5 },
      { code: '48', schools: 150, per1000Km2: 29 },
      { code: '90', schools: 0, per1000Km2: 0 },
      { code: '2A', schools: 3000, per1000Km2: 38.5 },
      { code: '2B', schools: 195, per1000Km2: null },
      { code: '99', schools: null, per1000Km2: 12 },
    ],
  });
  assert.equal(tally.drawn, 6);
  assert.equal(tally.noValue, 1);
  assert.equal(tally.zero, 1);
  assert.equal(tally.clipped, 1);
  assert.equal(tally.noRatio, 1);
  assert.equal(tally.ratioCounts.reduce((a, b) => a + b, 0), 6);
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

test('the département card leads with the prism\'s two channels', () => {
  const copy = buildSchoolsDepartementLabel({
    code: '59', name: 'Nord', schools: 2504, pupils: 466210,
    public: 2000, prive: 504, ep: 300, per1000Km2: 436.3,
  });
  const lines = copy.split('\n');
  assert.equal(lines[0], 'Nord');
  // Height first, colour second, in the order the eye reads the prism.
  assert.match(norm(lines[1]), /2 504 établissements/);
  assert.match(norm(lines[2]), /436,3 pour 1 000 km²/);
  assert.match(norm(copy), /466 210 élèves/);
  assert.match(norm(copy), /2 000 public/);
  assert.match(norm(copy), /504 privé/);
  assert.match(norm(copy), /300 en éducation prioritaire/);
});

test('a département with no roll and no EP prints neither line', () => {
  const copy = buildSchoolsDepartementLabel({
    code: '48', name: 'Lozère', schools: 120, pupils: 0, public: 120, prive: 0, ep: 0, per1000Km2: 23.2,
  });
  assert.equal(/élèves/.test(copy), false);
  assert.equal(/éducation prioritaire/.test(copy), false);
  assert.match(norm(copy), /120 établissements/);
});

test('a département measured at zero says zero, and one never measured says that instead', () => {
  // The A1 pair, on the surface that can spell it out. Neither line may be
  // the other's wording, and neither may be a number nobody produced.
  const zero = buildSchoolsDepartementLabel({
    code: '90', name: 'Territoire de Belfort', schools: 0, pupils: 0, per1000Km2: 0,
  });
  assert.match(zero, /Aucun établissement ouvert géolocalisé/);
  assert.equal(/non relevé/.test(zero), false);
  assert.match(norm(zero), /0,0 pour 1 000 km²/);

  const unproven = buildSchoolsDepartementLabel(
    { code: '90', name: 'Territoire de Belfort', schools: 0, pupils: 0, per1000Km2: 0 },
    { truncated: true },
  );
  assert.match(unproven, /Effectif non relevé/);
  assert.equal(/Aucun établissement/.test(unproven), false);
  assert.notEqual(unproven, zero);
});

test('a département whose density cannot be computed says so instead of printing 0,0', () => {
  const copy = buildSchoolsDepartementLabel({
    code: '2B', name: 'Haute-Corse', schools: 195, per1000Km2: null,
  });
  assert.match(copy, /Densité non calculable/);
  const withoutRefusal = norm(copy).replace(/Densité non calculable[^\n]*/, '');
  assert.equal(/pour 1 000 km²/.test(withoutRefusal), false);
  assert.match(norm(copy), /195 établissements/);
});

test('a count above the frozen domain admits the prism stopped measuring', () => {
  // A5 — the mark is clipped, and the card is where the clipping is declared.
  const copy = buildSchoolsDepartementLabel({
    code: '59', name: 'Nord', schools: 4000, per1000Km2: 700,
  });
  assert.match(norm(copy), /Au-dessus du domaine gelé \(2 600 établissements\)/);
  assert.match(norm(copy), /4 000 établissements/);
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

test('a département label carries the height\'s datum and the colour\'s', () => {
  const entry = createSchoolsDepartementOverlayEntry(
    { code: '59', name: 'Nord', schools: 2504, per1000Km2: 436.3 },
    { anchor: [3, 50] },
  );
  // The label repeats the prism — count in the text, density class in the
  // accent — rather than adding a third variable to a two-variable mark.
  assert.equal(norm(entry.title), 'Nord · 2 504');
  assert.equal(entry.accent, schoolsDensityColor(436.3));
  assert.equal(entry.id, 'schools-fr:dep:59');
});

test('a label for an unmeasured département shows no number and drops to the back', () => {
  const entry = createSchoolsDepartementOverlayEntry(
    { code: '90', name: 'Belfort', schools: 0, per1000Km2: 0 },
    { anchor: [7, 47] },
    { truncated: true },
  );
  assert.match(entry.title, /non relevé/);
  assert.equal(/·\s*0$/.test(entry.title), false);
  assert.equal(entry.priority, 0);
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

test('the national legend publishes the height ruler with numbered ticks', () => {
  // D1: a height with no ticks means nothing at all, so the ruler is the part
  // of this legend that cannot be dropped.
  _setSchoolsStateForTest({
    regime: 'national',
    national: {
      unassigned: 0,
      departements: [
        { code: '59', name: 'Nord', schools: 2504, per1000Km2: 436.3 },
        { code: '48', name: 'Lozère', schools: 150, per1000Km2: 29 },
      ],
    },
  });
  const { legend } = _schoolsRowControlsForTest();
  const labels = legend.map((row) => row.label);
  assert.ok(labels[0].startsWith('Hauteur —'));
  const ticks = legend.filter((row) => /établissements$/.test(row.label) && row.glyph);
  assert.ok(ticks.length >= 3, 'the ruler needs numbered ticks');
  assert.ok(ticks.every((row) => /^[\d\s\u202f]+ établissements$/.test(row.label)));
  // Every tick swatch is the SAME colour: the datum is the bar's height, so a
  // varying colour would be a second, false encoding.
  assert.equal(new Set(ticks.map((row) => row.color)).size, 1);
  // And the colour half is announced as a rate.
  assert.ok(labels.some((label) => label.startsWith('Couleur —')));
  assert.ok(labels.some((label) => /1 000 km²/.test(norm(label))));
});

test('the national legend says what the volume does NOT correct', () => {
  // The known cost, written on the map: the prism moves the areal bias from
  // the fill to the volume, it does not remove it.
  const legend = buildSchoolsNationalLegend({
    unassigned: 0,
    departements: [{ code: '59', name: 'Nord', schools: 2504, per1000Km2: 436.3 }],
  });
  assert.match(legend[0].blurb, /aire n’est pas neutralisée|aire n'est pas neutralisée/);
  assert.match(legend[0].blurb, /borne gelée/);
});

test('the national legend counts the establishments no prism can hold', () => {
  // 2 762 overseas rows and 99 coastal snaps, next to the key being read.
  const legend = buildSchoolsNationalLegend({
    unassigned: 2762,
    snapped: 99,
    departements: [{ code: '59', name: 'Nord', schools: 2504, per1000Km2: 436.3 }],
  });
  const offshore = legend.find((row) => /hors des polygones/.test(row.label));
  assert.ok(offshore);
  assert.equal(offshore.count, 2762);
  assert.equal(offshore.color, null);
  assert.match(norm(offshore.blurb), /99 établissements littoraux/);
  // A rollup with nothing offshore prints no such row.
  assert.equal(
    buildSchoolsNationalLegend({
      unassigned: 0,
      departements: [{ code: '59', schools: 10, per1000Km2: 5 }],
    }).some((row) => /hors des polygones/.test(row.label)),
    false,
  );
});

test('the national legend counts both absences separately', () => {
  const legend = buildSchoolsNationalLegend({
    unassigned: 0,
    truncated: true,
    departements: [
      { code: '59', name: 'Nord', schools: 2504, per1000Km2: 436.3 },
      { code: '90', name: 'Belfort', schools: 0, per1000Km2: 0 },
      { code: '2B', name: 'Haute-Corse', schools: 195, per1000Km2: null },
    ],
  });
  const missing = legend.filter((row) => /non publié/.test(row.label));
  const missingHeight = missing.find((row) => /établissements/.test(row.label));
  const missingColour = missing.find((row) => /1 000 km²/.test(norm(row.label)));
  assert.ok(missingHeight, 'the unmeasured count needs its own row');
  assert.equal(missingHeight.count, 1);
  assert.ok(missingColour, 'the unpublished rate needs its own row');
  assert.equal(missingColour.count, 1);
  assert.notEqual(missingHeight.label, missingColour.label);
});

test('the national legend is empty until the rollup arrives', () => {
  _setSchoolsStateForTest({ regime: 'national', national: null });
  assert.deepEqual(_schoolsRowControlsForTest(), { chips: [], legend: [] });
});

// --- Painting the prism, and clicking it ------------------------------------
//
// The four states have to reach the entity, and the selection has to survive
// the move from a flat fill to a volume: a reader who clicks a prism must get
// the cyan without the prism changing height, because a height that moves on
// click is answering a question nobody asked.

/** A polygon entity thin enough to run without WebGL. */
const fakeEntity = () => ({ polygon: {}, show: false });

const materialColor = (polygon) => polygon.material?.color?.getValue?.();

function seedNational(overrides = {}) {
  const parts = new Map();
  const departements = overrides.departements || [
    { code: '59', name: 'Nord', schools: 2504, per1000Km2: 436.3 },
    { code: '33', name: 'Gironde', schools: 1416, per1000Km2: 140.5 },
    { code: '90', name: 'Territoire de Belfort', schools: 0, per1000Km2: 0 },
  ];
  for (const row of departements) parts.set(row.code, [fakeEntity()]);
  _setSchoolsStateForTest({
    regime: 'national',
    overlayHost: {
      setEntries: () => {}, setVisible: () => {}, clearSource: () => {}, hitTest: () => null,
    },
    national: { unassigned: 0, departements, ...overrides.national },
    depEntities: [...parts.entries()],
    depMeta: departements.map((row) => [row.code, { anchor: [2, 47] }]),
  });
  return parts;
}

test('selecting a département recolours its prism and leaves its height alone', () => {
  const parts = seedNational();
  const polygon = parts.get('59')[0].polygon;

  _selectSchoolsDepartementForTest('59');
  const selectedHeight = polygon.extrudedHeight;
  assert.ok(selectedHeight > 0, 'the prism keeps its extrusion while selected');
  assert.ok(materialColor(polygon).equals(
    Cesium.Color.fromCssColorString('#00ffff').withAlpha(PRISM_BODY_ALPHA),
  ), 'the selected body is cyan at the same body alpha as any other prism');

  // Deselecting restores the class colour at the body alpha, same height.
  _clearSchoolsSelectionForTest();
  assert.equal(polygon.extrudedHeight, selectedHeight);
  assert.ok(materialColor(polygon).equals(
    Cesium.Color.fromCssColorString(schoolsDensityColor(436.3)).withAlpha(PRISM_BODY_ALPHA),
  ));
  assert.equal(polygon.outlineColor.alpha, PRISM_TOP_ALPHA);
});

test('the painted prism sits on the ellipsoid and classifies nothing', () => {
  const parts = seedNational();
  _selectSchoolsDepartementForTest('59');
  _clearSchoolsSelectionForTest();
  for (const code of ['59', '33']) {
    const { polygon } = parts.get(code)[0];
    // An extruded polygon cannot classify: Cesium reads `classificationType`
    // and ignores it silently, so setting it would be a line claiming a
    // behaviour the engine no longer has.
    assert.equal(polygon.classificationType, undefined, `${code} must not classify`);
    // A common datum is what makes two tops comparable — never terrain.
    assert.equal(polygon.height, 0);
    assert.equal(polygon.perPositionHeight, false);
    assert.equal(polygon.outline, true);
    assert.equal(parts.get(code)[0].show, true);
  }
});

test('a flat footprint goes back on the ground, where terrain cannot bury it', () => {
  // The one place classification survives, and it is why it is CLEARED on the
  // prisms rather than deleted from the module: an absence mark pinned to the
  // ellipsoid under 2 km of Alpine terrain is an absence mark nobody sees.
  const parts = seedNational();
  _selectSchoolsDepartementForTest('59');
  _clearSchoolsSelectionForTest();
  const { polygon } = parts.get('90')[0];
  assert.equal(polygon.height, undefined);
  assert.equal(polygon.extrudedHeight, undefined);
  assert.ok(polygon.classificationType !== undefined, 'the footprint is draped');
  // Cesium refuses an outline on a clamped polygon, so the material is what
  // separates the two flat states.
  assert.equal(polygon.outline, false);
});

test('a taller count is a taller prism, on the entities themselves', () => {
  const parts = seedNational();
  _selectSchoolsDepartementForTest('59');
  _clearSchoolsSelectionForTest();
  assert.ok(parts.get('59')[0].polygon.extrudedHeight > parts.get('33')[0].polygon.extrudedHeight);
});

test('a measured zero is a flat filled footprint, not a missing one', () => {
  const parts = seedNational();
  _selectSchoolsDepartementForTest('59');
  _clearSchoolsSelectionForTest();
  const zero = parts.get('90')[0];
  assert.equal(zero.polygon.extrudedHeight, undefined, 'no prism for a zero');
  assert.equal(zero.polygon.fill, true, 'but it is filled: zero is a measurement');
  assert.equal(zero.show, true);
});

test('an unmeasured département is drawn as a motif and stays clickable', () => {
  const parts = seedNational({
    departements: [{ code: '90', name: 'Territoire de Belfort', schools: 0, per1000Km2: 0 }],
    national: { truncated: true },
  });
  const entity = parts.get('90')[0];
  _selectSchoolsDepartementForTest('90');
  // It used to be unselectable — `schools > 0` was required — which left a
  // reader with an unexplained hole and no way to ask about it.
  _clearSchoolsSelectionForTest();
  assert.equal(entity.show, true, 'the footprint is drawn, never hidden');
  assert.equal(entity.polygon.extrudedHeight, undefined);
  // A motif and not a tint: the material is the stripe, not a colour.
  assert.equal(materialColor(entity.polygon), undefined);
  assert.ok(entity.polygon.material?.oddColor, 'the striped material carries the refusal');
});

test('a rate with no count is banded, never filled like a measured zero', () => {
  // The one collision the four-state grammar exists to prevent: both are flat,
  // so if both were solid they would be the same mark for "we counted nothing
  // here" and "we counted nothing at all".
  const parts = seedNational({
    departements: [
      { code: '90', name: 'Belfort', schools: 0, per1000Km2: 0 },
      { code: '99', name: 'Sans relevé', schools: null, per1000Km2: 300 },
    ],
  });
  _selectSchoolsDepartementForTest('90');
  _clearSchoolsSelectionForTest();
  const zero = parts.get('90')[0].polygon;
  const unmeasured = parts.get('99')[0].polygon;
  assert.equal(zero.extrudedHeight, undefined);
  assert.equal(unmeasured.extrudedHeight, undefined);
  assert.ok(materialColor(zero), 'a measured zero is a solid fill');
  assert.ok(materialColor(zero).alpha > 0.5, 'and it reads as a floor, not a haze');
  assert.equal(materialColor(unmeasured), undefined, 'an unmeasured one is a motif');
  assert.ok(unmeasured.material?.oddColor);
});

test('a prism with no published rate keeps its height and refuses only the colour', () => {
  const parts = seedNational({
    departements: [{ code: '2B', name: 'Haute-Corse', schools: 195, per1000Km2: null }],
  });
  _selectSchoolsDepartementForTest('2B');
  _clearSchoolsSelectionForTest();
  const { polygon } = parts.get('2B')[0];
  assert.ok(polygon.extrudedHeight > 0, 'the height is measured and drawn');
  assert.equal(materialColor(polygon), undefined, 'the colour is explicitly refused');
});

test('a département label is anchored on the prism it names', () => {
  seedNational();
  const cohort = _schoolsDepartementOverlayForTest();
  const nord = cohort.find((entry) => entry.id.endsWith(':59'));
  const belfort = cohort.find((entry) => entry.id.endsWith(':90'));
  assert.ok(nord.position.heightM > 0, 'the name rides the top edge, not the ground');
  assert.equal(belfort.position.heightM, 0, 'a flat footprint keeps its name on the ground');
  // Every département in the rollup gets a label candidate now, including the
  // ones with nothing in them.
  assert.equal(cohort.length, 3);
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
  assert.match(norm(label), /96 départements en prismes/);
  assert.match(norm(label), /2 762 hors métropole/);
  assert.equal(/tronqué/.test(label), false);
});

test('a truncated national sweep says so, because every zero in it is unproven', () => {
  const label = buildSchoolsLoadingLabel({
    regime: 'national', status: 'ready', loading: false,
    national: {
      assigned: 100, painted: 96, unassigned: 0, truncated: true,
    },
  });
  assert.match(label, /tronqué/);
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
