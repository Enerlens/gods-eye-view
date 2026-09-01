// The reading of the Annuaire de l'éducation.
//
// Every test here runs against `fixtures/schools-annuaire-sample.json` — 15
// REAL rows, picked because each one is awkward in a different way: a
// commune-centroid coordinate, a sub-UAI section, a row with no
// `type_etablissement` at all, an agricultural lycée, a Réunion maternelle, a
// service administratif that is not a school. A synthetic fixture would have
// none of those and would pass regardless of what this module does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  SCHOOLS_MAX_BOX_DEG,
  SCHOOLS_OPEN_WHERE,
  SCHOOL_LEVELS,
  SCHOOL_LEVEL_INDEX,
  parseSchoolFlag,
  projectSchoolSites,
  schoolLevel,
  schoolPrecision,
  schoolDisplayName,
  schoolNameStatesLevel,
  schoolPriorityEducation,
  schoolSector,
  schoolSiteKey,
  schoolsBboxWhere,
} from './schoolsFeed.js';

const SAMPLE = JSON.parse(readFileSync(
  new URL('./fixtures/schools-annuaire-sample.json', import.meta.url),
  'utf8',
));

const byUai = (uai) => SAMPLE.find((row) => row.identifiant_de_l_etablissement === uai);

test('the fixture is the real register, not a hand-made stand-in', () => {
  assert.equal(SAMPLE.length, 15);
  // If someone regenerates this fixture without the awkward rows, the tests
  // below would still pass while testing nothing. Pin the awkwardness itself.
  assert.ok(SAMPLE.some((row) => row.precision_localisation === 'Ville'));
  assert.ok(SAMPLE.some((row) => row.type_etablissement === null));
  assert.ok(SAMPLE.some((row) => row.etablissement_mere));
  assert.ok(SAMPLE.some((row) => row.code_departement === '974'));
  assert.ok(SAMPLE.some((row) => row.ministere_tutelle === 'AGRICULTURE'));
});

// --- The colour ladder ------------------------------------------------------

test('every published type_etablissement lands on a named band', () => {
  for (const row of SAMPLE) {
    assert.ok(SCHOOL_LEVELS.includes(schoolLevel(row)), `${row.type_etablissement} unmapped`);
  }
});

test('a row with no type at all is `autre`, never a school', () => {
  // 245 rows nationally publish no type. Defaulting them to `ecole` would add
  // them to the count a reader trusts most.
  const untyped = SAMPLE.find((row) => row.type_etablissement === null);
  assert.equal(schoolLevel(untyped), 'autre');
  assert.equal(schoolLevel({}), 'autre');
  assert.equal(schoolLevel({ type_etablissement: 'Something New' }), 'autre');
});

test('EREA and médico-social share the adapted band, and lycée is not it', () => {
  assert.equal(schoolLevel({ type_etablissement: 'EREA' }), 'adapte');
  assert.equal(schoolLevel({ type_etablissement: 'Médico-social' }), 'adapte');
  assert.notEqual(schoolLevel({ type_etablissement: 'EREA' }), 'lycee');
});

test('the ladder is ordered so a mesh tie resolves to the commonest level', () => {
  // `cellRepresentative` breaks a tie toward the LOWER index. `ecole` is 71%
  // of the register, so it has to be index 0 or the maillage would err toward
  // the rare reading of a cell.
  assert.equal(SCHOOL_LEVEL_INDEX.ecole, 0);
  assert.ok(SCHOOL_LEVEL_INDEX.ecole < SCHOOL_LEVEL_INDEX.college);
  assert.ok(SCHOOL_LEVEL_INDEX.college < SCHOOL_LEVEL_INDEX.lycee);
});

// --- Geocoding quality ------------------------------------------------------

test('the 22 published precision spellings fold onto four steps', () => {
  assert.equal(schoolPrecision('Numéro de rue'), 'adresse');
  assert.equal(schoolPrecision('PLAQUE_ADRESSE'), 'adresse');
  assert.equal(schoolPrecision('Parfaite'), 'adresse');
  assert.equal(schoolPrecision('BATIMENT'), 'adresse');
  assert.equal(schoolPrecision('Rue'), 'rue');
  assert.equal(schoolPrecision('Correcte'), 'rue');
  assert.equal(schoolPrecision('Ville'), 'commune');
  assert.equal(schoolPrecision('COMMUNE'), 'commune');
});

test('accents and case do not split one spelling into several', () => {
  assert.equal(schoolPrecision('numero de rue'), 'adresse');
  assert.equal(schoolPrecision('NUMÉRO DE RUE'), 'adresse');
  assert.equal(schoolPrecision('Numéro de rue'), schoolPrecision('numero de rue'));
});

test('an unknown spelling is `inconnue`, never promoted to exact', () => {
  // The académies keep adding pipelines. A new spelling silently inheriting
  // "exact address" is the one error this ladder exists to make impossible.
  assert.equal(schoolPrecision('QUELQUE CHOSE DE NOUVEAU'), 'inconnue');
  assert.equal(schoolPrecision(''), 'inconnue');
  assert.equal(schoolPrecision(null), 'inconnue');
  assert.equal(schoolPrecision(undefined), 'inconnue');
});

test('the commune-centroid rows in the fixture are actually flagged', () => {
  const centroids = SAMPLE.filter((row) => schoolPrecision(row.precision_localisation) === 'commune');
  assert.equal(centroids.length, 2);
  for (const row of centroids) assert.equal(row.precision_localisation, 'Ville');
});

// --- Booleans ---------------------------------------------------------------

test('1 / 0 / null read as true / false / null — null is not false', () => {
  assert.equal(parseSchoolFlag(1), true);
  assert.equal(parseSchoolFlag('1'), true);
  assert.equal(parseSchoolFlag(0), false);
  assert.equal(parseSchoolFlag('0'), false);
  // The distinction that matters: an undeclared canteen is not a school
  // without one, and a plain Boolean() coercion cannot tell them apart.
  assert.equal(parseSchoolFlag(null), null);
  assert.equal(parseSchoolFlag(undefined), null);
});

// --- Sector and priority education -----------------------------------------

test('sector is public / prive / null, and 1 984 rows declare neither', () => {
  assert.equal(schoolSector({ statut_public_prive: 'Public' }), 'public');
  assert.equal(schoolSector({ statut_public_prive: 'Privé' }), 'prive');
  assert.equal(schoolSector({ statut_public_prive: null }), null);
  assert.equal(schoolSector({}), null);
});

test('REP and REP+ stay distinct, because the policy distinguishes them', () => {
  assert.equal(schoolPriorityEducation({ appartenance_education_prioritaire: 'REP+' }), 'REP+');
  assert.equal(schoolPriorityEducation({ appartenance_education_prioritaire: 'REP' }), 'REP');
  assert.equal(schoolPriorityEducation({ appartenance_education_prioritaire: null }), null);
  // Collapsing them to a boolean would throw away the stronger designation.
  assert.notEqual(
    schoolPriorityEducation({ appartenance_education_prioritaire: 'REP+' }),
    schoolPriorityEducation({ appartenance_education_prioritaire: 'REP' }),
  );
});

// --- The projection ---------------------------------------------------------

test('the fixture projects to one site per row, with nothing dropped', () => {
  const out = projectSchoolSites({ records: SAMPLE });
  assert.equal(out.count, SAMPLE.length);
  assert.equal(out.dropped, 0);
  assert.equal(out.sites.length, SAMPLE.length);
});

test('the per-level tally sums to the projected count', () => {
  const out = projectSchoolSites({ records: SAMPLE });
  const summed = SCHOOL_LEVELS.reduce((total, level) => total + out.levels[level], 0);
  assert.equal(summed, out.count);
});

test('a row with no coordinate is counted as dropped, never plotted at (0,0)', () => {
  const out = projectSchoolSites({
    records: [
      ...SAMPLE,
      { identifiant_de_l_etablissement: 'X', latitude: null, longitude: null },
      { identifiant_de_l_etablissement: 'Y', latitude: 0, longitude: 0 },
    ],
  });
  assert.equal(out.dropped, 2);
  assert.equal(out.count, SAMPLE.length);
  assert.ok(!out.sites.some((site) => site.lat === 0 && site.lon === 0));
});

test('the roll joins on the UAI, and an absent roll is null and not zero', () => {
  const target = byUai('0450922H');
  const out = projectSchoolSites({ records: SAMPLE, rolls: new Map([[target.identifiant_de_l_etablissement, 214]]) });
  const joined = out.sites.find((site) => site.uai === '0450922H');
  assert.equal(joined.enrolled, 214);
  assert.equal(out.withRoll, 1);
  assert.equal(out.pupils, 214);
  // Every other site has no roll. `null` is what lets the card say "effectif
  // non publié"; a 0 would be indistinguishable from an empty school.
  for (const site of out.sites) {
    if (site.uai === '0450922H') continue;
    assert.equal(site.enrolled, null);
  }
});

test('a plain object works as the roll map, not only a Map', () => {
  const out = projectSchoolSites({ records: SAMPLE, rolls: { '0170111D': 500 } });
  assert.equal(out.sites.find((site) => site.uai === '0170111D').enrolled, 500);
});

test('the sub-UAI sections carry their parent, so two dots at one address read', () => {
  const out = projectSchoolSites({ records: SAMPLE });
  const section = out.sites.find((site) => site.uai === '0391193K');
  assert.equal(section.motherUai, '0390033Z');
  const standalone = out.sites.find((site) => site.uai === '0450922H');
  assert.equal(standalone.motherUai, null);
});

test('services keep the three-state reading all the way to the site', () => {
  const out = projectSchoolSites({ records: SAMPLE });
  const withServices = out.sites.filter((site) => site.services.restauration !== null);
  assert.ok(withServices.length > 0);
  for (const site of out.sites) {
    for (const value of Object.values(site.services)) {
      assert.ok(value === true || value === false || value === null);
    }
  }
});

test('a short answer against the portal count is reported as incomplete', () => {
  // Opendatasoft returns a capped export as HTTP 200. The count is the only
  // signal, and a quiet arrondissement looks exactly like a capped one.
  const complete = projectSchoolSites({ records: SAMPLE, totalCount: SAMPLE.length });
  assert.equal(complete.complete, true);
  const short = projectSchoolSites({ records: SAMPLE, totalCount: SAMPLE.length + 1 });
  assert.equal(short.complete, false);
});

test('dropped rows count toward completeness, so a dropped row is not a gap', () => {
  const out = projectSchoolSites({
    records: [...SAMPLE, { identifiant_de_l_etablissement: 'X', latitude: null, longitude: null }],
    totalCount: SAMPLE.length + 1,
  });
  assert.equal(out.dropped, 1);
  assert.equal(out.complete, true);
});

test('an unknown total degrades to "unverified", not to "incomplete"', () => {
  const out = projectSchoolSites({ records: SAMPLE, totalCount: null });
  assert.equal(out.complete, true);
  assert.equal(out.totalCount, null);
});

test('an empty or malformed input projects to an empty answer, not a throw', () => {
  for (const records of [[], null, undefined, 'nope', {}]) {
    const out = projectSchoolSites({ records });
    assert.equal(out.count, 0);
    assert.deepEqual(out.sites, []);
  }
  assert.doesNotThrow(() => projectSchoolSites());
});

// --- The query --------------------------------------------------------------

test('the bbox clause uses the indexed geo filter and excludes the unusable', () => {
  const where = schoolsBboxWhere({ south: 48.8, west: 2.3, north: 48.9, east: 2.4 });
  assert.match(where, /in_bbox\(position, 48\.8, 2\.3, 48\.9, 2\.4\)/);
  // The 382 closed and 399 uncoordinated rows must never leave the portal.
  assert.match(where, /etat="OUVERT"/);
  assert.match(where, /position is not null/);
});

test('the national clause constrains the same two things as the bbox one', () => {
  assert.match(SCHOOLS_OPEN_WHERE, /etat="OUVERT"/);
  assert.match(SCHOOLS_OPEN_WHERE, /position is not null/);
});

test('the box ceiling is the one the proxy and the layer both read', () => {
  assert.equal(SCHOOLS_MAX_BOX_DEG, 0.35);
});

test('the site key is coordinate-based and stable to 5 decimals', () => {
  assert.equal(schoolSiteKey(48.123456789, 2.987654321), '48.12346,2.98765');
  assert.equal(schoolSiteKey(48.123456789, 2.987654321), schoolSiteKey(48.1234567, 2.9876543));
});

// --- Naming an establishment ------------------------------------------------
//
// `nom_etablissement` is the register's own name and 97.4% of the 68 557 open
// rows already open with their type ("Collège Jean Moulin"). The rule is
// therefore to PREFIX ONLY WHAT DOES NOT, or every card in France reads
// "Collège · Collège Jean Moulin".

test('a name that already states its type is left exactly as published', () => {
  assert.equal(
    schoolDisplayName({ name: 'Collège Jean Moulin', level: 'college' }),
    'Collège Jean Moulin',
  );
  assert.equal(
    schoolDisplayName({ name: 'Lycée du Parc', level: 'lycee' }),
    'Lycée du Parc',
  );
  // Accents and case are the académies' business, not the reader's.
  assert.equal(schoolDisplayName({ name: 'LYCEE DU PARC', level: 'lycee' }), 'LYCEE DU PARC');
});

test('a name that states no type gets its level in front', () => {
  // The 2 467 rows measured in the register: campuses, institutions, groupes.
  assert.equal(
    schoolDisplayName({ name: 'Institution Saint-Pierre', level: 'lycee' }),
    'Lycée · Institution Saint-Pierre',
  );
});

test('the école band recognises the words the register actually uses for it', () => {
  for (const name of [
    'Ecole primaire publique Jules Ferry',
    'École maternelle Les Tilleuls',
    'Groupe scolaire Saint Exupéry',
    'ECOLE ELEMENTAIRE PUBLIQUE',
  ]) {
    assert.equal(schoolNameStatesLevel(name, 'ecole'), true, name);
  }
  assert.equal(schoolNameStatesLevel('Envie', 'ecole'), false);
});

test('the non-teaching band is never prefixed with its legend row', () => {
  // "Administratif & orientation" names a legend row, not a kind of building.
  assert.equal(
    schoolDisplayName({ name: "Rectorat de l'académie de Lyon", level: 'autre' }),
    "Rectorat de l'académie de Lyon",
  );
});

test('with no name at all the level is the answer, and never a blank', () => {
  assert.equal(schoolDisplayName({ level: 'college' }), 'Collège');
  assert.equal(schoolDisplayName({ name: '   ', level: 'lycee' }), 'Lycée');
  // No level either: the generic word, not a band it was never sorted into.
  assert.equal(schoolDisplayName(null), 'Établissement');
  assert.equal(schoolDisplayName({}), 'Établissement');
});

test('every projected site can be named without inventing anything', () => {
  for (const site of projectSchoolSites({ records: SAMPLE }).sites) {
    const display = schoolDisplayName(site);
    assert.ok(display.length > 0);
    if (site.name) assert.ok(display.includes(site.name), site.name);
  }
});
