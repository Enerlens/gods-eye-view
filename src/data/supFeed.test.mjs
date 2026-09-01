// The reading of the two MESR higher-education files.
//
// Every test here runs against `fixtures/sup-atlas-sample.json` and
// `fixtures/sup-parcoursup-sample.json` — 35 and 45 REAL rows covering NINE
// real establishments, picked because each one is awkward in a different way:
// an establishment on two coordinates, one the register cannot place that
// Parcoursup can, one neither file can place, one Parcoursup places TWICE (so
// nothing may be borrowed), a row whose name column is the literal string
// `nan`, a lycée running a BTS, a Réunion lycée, and two establishments whose
// composantes are partly unlocatable. A synthetic fixture would have none of
// those and would pass regardless of what this module does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  SUP_ATLAS_FIELDS,
  SUP_CYCLES,
  SUP_KINDS,
  SUP_KIND_INDEX,
  SUP_OFFER_FIELDS,
  SUP_RENTREE_FLOOR,
  SUP_SESSION_FLOOR,
  indexSupOffers,
  newestYear,
  projectSupSites,
  supAtlasWhere,
  supCycle,
  supKind,
  supOfferName,
  supOfferWhere,
  supPoint,
  supRegisterName,
  supSector,
  supSiteKey,
  supUai,
} from './supFeed.js';

const ATLAS = JSON.parse(readFileSync(
  new URL('./fixtures/sup-atlas-sample.json', import.meta.url),
  'utf8',
));
const OFFERS = JSON.parse(readFileSync(
  new URL('./fixtures/sup-parcoursup-sample.json', import.meta.url),
  'utf8',
));

const project = (overrides = {}) => projectSupSites({
  records: ATLAS,
  offers: indexSupOffers(OFFERS),
  rentree: '2024',
  session: '2026',
  totalCount: ATLAS.length,
  ...overrides,
});

const siteFor = (result, uai) => result.sites.filter((site) => site.uai === uai);

test('the fixtures are the real registers, not hand-made stand-ins', () => {
  assert.equal(ATLAS.length, 35);
  assert.equal(OFFERS.length, 45);
  // If someone regenerates these without the awkward rows, the tests below
  // would still pass while testing nothing. Pin the awkwardness itself.
  assert.ok(ATLAS.some((row) => row.geo === null), 'no unlocatable composante');
  assert.ok(ATLAS.some((row) => row.geo && row.geo.lat), 'no located composante');
  assert.ok(ATLAS.some((row) => String(row.libelle_etablissement_2).toLowerCase() === 'nan'));
  assert.ok(ATLAS.some((row) => row.dep_num_nom.startsWith('974')));
  assert.ok(ATLAS.some((row) => row.dep_num_nom.startsWith('987')));
  assert.ok(ATLAS.some((row) => row.categorie_etablissement === 'Lycées'));
  assert.ok(ATLAS.some((row) => row.degre_etudes === 'BAC + 6 et plus'));
  // `tf` is an ARRAY upstream, and a fixture that flattened it would hide the
  // one shape this module has to cope with.
  assert.ok(OFFERS.some((row) => Array.isArray(row.tf) && row.tf.length > 1));
  // The nine establishments, and no more: every count asserted below is the
  // real arithmetic of these rows.
  assert.equal(new Set(ATLAS.map((row) => row.id_etablissement)).size, 9);
});

test('every field the projection reads is a field the query asks for', () => {
  // A `select` that drifts from what `projectSupSites` reads is invisible in
  // tests that hand it a full fixture, and shows up in production as a card
  // with a missing line.
  for (const field of SUP_ATLAS_FIELDS) {
    assert.ok(field in ATLAS[0], `${field} absent from the register payload`);
  }
  for (const field of SUP_OFFER_FIELDS) {
    assert.ok(field in OFFERS[0], `${field} absent from the cartography payload`);
  }
});

// --- The band ladder --------------------------------------------------------

test('every published category in the fixture lands on a named band', () => {
  for (const row of ATLAS) {
    assert.ok(SUP_KINDS.includes(supKind(row.categorie_etablissement)));
  }
});

test('all 14 published categories are named, none falls through to `autre` by accident', () => {
  // The register's own list, as measured on the live file. A new category
  // arriving upstream SHOULD land in `autre` — but none of these may, because
  // each one is a legend row a reader is looking for.
  const named = {
    'Universités': 'universite',
    "Autre établissements d'enseignement universitaire": 'universite',
    'Écoles normales supérieures': 'universite',
    'Lycées': 'lycee',
    "Écoles d'ingénieurs": 'ingenieur',
    'Écoles vétérinaires': 'ingenieur',
    'Écoles de commerce, gestion et vente': 'commerce',
    'Écoles juridiques et administratives': 'commerce',
    'Écoles paramédicales hors université': 'sante',
    'Écoles préparant aux fonctions sociales': 'sante',
    'Écoles supérieures artistiques et culturelles': 'art',
    "Écoles d'architecture": 'art',
    'Écoles de journalisme et écoles littéraires': 'art',
    'Autres écoles de spécialités diverses': 'autre',
  };
  assert.equal(Object.keys(named).length, 14);
  for (const [category, kind] of Object.entries(named)) {
    assert.equal(supKind(category), kind, category);
  }
  // The apostrophe is the trap: the portal publishes U+2019 on some rows and
  // U+0027 on others, and one spelling silently becoming `autre` would move a
  // hundred écoles d'ingénieurs into the catch-all.
  assert.equal(supKind('Écoles d’ingénieurs'), 'ingenieur');
  assert.equal(supKind('Écoles d’architecture'), 'art');
  assert.equal(supKind('Autre établissements d’enseignement universitaire'), 'universite');
});

test('an unrecognised or missing category is `autre`, never a named kind', () => {
  assert.equal(supKind('Écoles de quelque chose de nouveau'), 'autre');
  assert.equal(supKind(null), 'autre');
  assert.equal(supKind(''), 'autre');
});

test('a site whose composantes disagree takes the LOWEST band on the ladder', () => {
  // The rule is per SITE, not per establishment: a campus that is partly a
  // university IS a university campus, and a tie resolving the other way
  // would understate what is at the address. Built from two register rows at
  // ONE coordinate, because the fixture's real disagreement (AFTEC-EESTP)
  // splits across two coordinates and so exercises the sibling case instead.
  const at = (category, students) => ({
    id_etablissement: '0000000X',
    libelle_etablissement_1: 'CAMPUS',
    categorie_etablissement: category,
    secteur_etablissement: 'Public',
    degre_etudes: 'BAC + 1',
    effectifhdccpge: students,
    geo: { lat: 48.85, lon: 2.35 },
  });
  const mixed = projectSupSites({
    records: [at('Autres écoles de spécialités diverses', 40), at('Universités', 10)],
  });
  assert.equal(mixed.count, 1);
  assert.equal(mixed.sites[0].kind, 'universite');
  assert.ok(SUP_KIND_INDEX.universite < SUP_KIND_INDEX.autre);
  // A site with only one category keeps it, and names it on the card.
  assert.equal(mixed.sites[0].students, 50);
  const single = projectSupSites({ records: [at('Lycées', 5)] });
  assert.equal(single.sites[0].kind, 'lycee');
  assert.equal(single.sites[0].category, 'Lycées');

  // And the fixture's own disagreement resolves per site, not per UAI: the
  // two AFTEC-EESTP addresses are allowed to differ from each other.
  const both = siteFor(project(), '0142395C');
  assert.equal(both.length, 2);
  for (const site of both) {
    const here = new Set(ATLAS
      .filter((row) => row.id_etablissement === '0142395C'
        && row.geo && Math.abs(row.geo.lat - site.lat) < 1e-5)
      .map((row) => supKind(row.categorie_etablissement)));
    const lowest = [...here].sort((a, b) => SUP_KIND_INDEX[a] - SUP_KIND_INDEX[b])[0];
    assert.equal(site.kind, lowest);
  }
});

// --- Reading the awkward columns -------------------------------------------

test('the literal string `nan` is not a name', () => {
  // 3 806 rows of `libelle_etablissement_2` publish it. A plain trim lets it
  // through and the card reads "ENSIATE — nan".
  const row = ATLAS.find((entry) => String(entry.libelle_etablissement_2).toLowerCase() === 'nan');
  assert.ok(row);
  assert.equal(supRegisterName(row), row.libelle_etablissement_1);
  assert.equal(supRegisterName({ libelle_etablissement_1: 'nan', libelle_etablissement_2: 'nan' }), null);
});

test('the two label columns are joined only when the second adds something', () => {
  assert.equal(supRegisterName({ libelle_etablissement_1: 'AFTEC', libelle_etablissement_2: 'AFTEC' }), 'AFTEC');
  // Containment runs BOTH ways: the second column is truncated to 30
  // characters upstream, and it is also sometimes the fuller name.
  assert.equal(
    supRegisterName({ libelle_etablissement_1: 'UNIVERSITE  PARIS 8', libelle_etablissement_2: 'UNIVERSITE PARIS 8' }),
    'UNIVERSITE  PARIS 8',
  );
  assert.equal(
    supRegisterName({ libelle_etablissement_1: 'UNIVERSITE', libelle_etablissement_2: 'SORBONNE UNIVERSITE' }),
    'SORBONNE UNIVERSITE',
  );
  assert.equal(
    supRegisterName({ libelle_etablissement_1: 'ORGANISME DE FORMATION-CFA', libelle_etablissement_2: 'METIERS DU BATIMENT' }),
    'ORGANISME DE FORMATION-CFA — METIERS DU BATIMENT',
  );
});

test('a Parcoursup name loses the locality Parcoursup appended, and nothing else', () => {
  assert.equal(supOfferName('AFTRAL - AUXERRE (Appoigny - 89)'), 'AFTRAL - AUXERRE');
  assert.equal(supOfferName('UFA GROUPE ALTERNANCE AUXERRE (89)'), 'UFA GROUPE ALTERNANCE AUXERRE');
  // `(EPE)` is part of the name and survives; only the trailing suffix goes.
  assert.equal(supOfferName('Université de Brest (EPE) (29)'), 'Université de Brest (EPE)');
  assert.equal(supOfferName('Lycée Camille Jullian (2A)'), 'Lycée Camille Jullian');
  assert.equal(supOfferName('Institut (Paris)'), 'Institut (Paris)');
  // Stripping must never leave an empty title.
  assert.equal(supOfferName('(75)'), '(75)');
  assert.equal(supOfferName(null), null);
});

test('a coordinate is read from the object shape only, never guessed from a string', () => {
  assert.deepEqual(supPoint({ lat: 48.8, lon: 2.3 }), [48.8, 2.3]);
  // The GeoJSON export publishes the same field as [lon, lat]; accepting it is
  // fine, accepting `"48.8, 2.3"` is not — guessing the axis order wrong puts
  // every French university in the Indian Ocean and nothing would notice.
  assert.deepEqual(supPoint([2.3, 48.8]), [48.8, 2.3]);
  assert.equal(supPoint('48.8, 2.3'), null);
  assert.equal(supPoint(null), null);
  assert.equal(supPoint({ lat: 0, lon: 0 }), null);
  assert.equal(supPoint({ lat: 91, lon: 2 }), null);
  assert.equal(supPoint({ lat: 48.8 }), null);
});

test('a degree outside the published seven is dropped, not folded into a cycle', () => {
  assert.equal(supCycle('BAC + 1'), 'licence');
  assert.equal(supCycle('Inférieur ou égal au baccalauréat'), 'licence');
  assert.equal(supCycle('BAC + 5'), 'master');
  assert.equal(supCycle('BAC + 6 et plus'), 'doctorat');
  assert.equal(supCycle('BAC + 9'), null);
  assert.equal(supCycle(null), null);
});

test('sector and UAI are normalised the same way the two files spell them', () => {
  assert.equal(supSector('Public'), 'public');
  assert.equal(supSector('Privé'), 'prive');
  assert.equal(supSector('Prive'), 'prive');
  assert.equal(supSector('autre chose'), null);
  // The two files disagree about case on a few hundred UAIs; the join is on
  // this function's output, so a lower-case UAI must not miss.
  assert.equal(supUai(' 0142395c '), '0142395C');
  assert.equal(supUai(null), null);
});

// --- The Parcoursup index ---------------------------------------------------

test('a coordinate is borrowed only when the cartography gives exactly one', () => {
  const index = indexSupOffers(OFFERS);
  // Polynésie: one point, so it may be lent.
  assert.equal(index.get('9840349G').points, 1);
  assert.ok(index.get('9840349G').point);
  // 0891160C: TWO points for one UAI, so nothing is lent — picking one of two
  // campuses is inventing a fact.
  assert.ok(index.get('0891160C').points > 1);
  assert.equal(index.get('0891160C').point, null);
});

test('a name is borrowed under the same rule as a coordinate', () => {
  const index = indexSupOffers(OFFERS);
  for (const entry of index.values()) {
    if (entry.names > 1) assert.equal(entry.name, null);
    else if (entry.names === 1) assert.ok(entry.name);
  }
});

test('the formation types are deduplicated across an establishment’s rows', () => {
  const index = indexSupOffers(OFFERS);
  for (const entry of index.values()) {
    assert.equal(new Set(entry.offer).size, entry.offer.length);
    // `tf` arrives as an array; a flattening bug would show as `[object Object]`.
    for (const label of entry.offer) assert.equal(typeof label, 'string');
  }
});

test('an empty cartography is a degraded layer, not a broken one', () => {
  const result = project({ offers: indexSupOffers([]) });
  // Everything the register can place is still placed; only the borrowed
  // coordinate, the names and the offers are lost.
  assert.equal(result.borrowed, 0);
  assert.ok(result.count > 0);
  assert.ok(result.sites.every((site) => site.offer === null));
  assert.ok(result.sites.every((site) => site.placement === 'register'));
});

// --- The projection ---------------------------------------------------------

test('every student in the register is either on the map, unsited, or unplaced', () => {
  // The one invariant that makes every number on every card trustworthy: the
  // three buckets partition the register exactly, so nothing can be quietly
  // lost or quietly double-counted.
  const result = project();
  const raw = ATLAS.reduce((total, row) => total + (row.effectifhdccpge || 0), 0);
  assert.equal(raw, 4586);
  assert.equal(
    result.students + result.unsitedStudents + result.unplacedStudents,
    raw,
  );
  assert.equal(result.studentsTotal, raw);
  assert.equal(result.students, result.sites.reduce((t, s) => t + s.students, 0));
});

test('an establishment on two coordinates becomes two sites that name each other', () => {
  const result = project();
  const pair = siteFor(result, '0142395C');
  assert.equal(pair.length, 2);
  for (const site of pair) {
    assert.equal(site.siteCount, 2);
    assert.equal(site.etabStudents, 208);
  }
  assert.deepEqual(pair.map((site) => site.siteIndex).sort(), [1, 2]);
  // The two dots add up to the establishment, which is what lets a reader
  // treat `etabStudents` as a total rather than a repetition.
  assert.equal(pair.reduce((total, site) => total + site.students, 0), 208);
  // Distinct coordinates, therefore distinct ids.
  assert.equal(new Set(pair.map((site) => site.id)).size, 2);
});

test('an establishment the register cannot place is placed from the cartography, and says so', () => {
  const result = project();
  const [site] = siteFor(result, '9840349G');
  assert.equal(result.borrowed, 1);
  assert.equal(site.placement, 'offer');
  assert.equal(site.students, 2596);
  // The whole roll IS this site's — there is only one — so nothing may be
  // reported as unattributed on a card whose dot already carries it all.
  assert.equal(site.unsited, 0);
  assert.equal(site.etabStudents, 2596);
});

test('an establishment neither file can place is counted, never invented', () => {
  const result = project();
  assert.equal(siteFor(result, '0756065K').length, 0);
  assert.equal(siteFor(result, '0891160C').length, 0);
  assert.equal(result.unplaced, 2);
  assert.equal(result.placed, result.establishments - result.unplaced);
  assert.ok(result.unplacedStudents > 0);
  // No site anywhere sits at (0, 0) or at a null island coordinate.
  for (const site of result.sites) {
    assert.ok(Number.isFinite(site.lat) && Number.isFinite(site.lon));
    assert.ok(site.lat !== 0 || site.lon !== 0);
  }
});

test('unlocatable composantes are flagged on the sites, not moved onto them', () => {
  const result = project();
  const [brest] = siteFor(result, '0290127F');
  assert.ok(brest.unsited > 0);
  // The dot holds only what the register put at this coordinate; the rest is
  // named as missing rather than folded in to make the number look complete.
  assert.ok(brest.students < brest.etabStudents);
  assert.equal(brest.students + brest.unsited, brest.etabStudents);
});

test('the cycle mix is the LMD split of the published degrees, and it sums', () => {
  const result = project();
  for (const site of result.sites) {
    const total = SUP_CYCLES.reduce((sum, cycle) => sum + site.cycles[cycle], 0);
    assert.equal(total, site.students, site.uai);
  }
  // The fixture carries a doctoral establishment, so the third cycle is
  // exercised rather than being structurally always zero.
  assert.ok(result.sites.some((site) => site.cycles.doctorat > 0));
});

test('every site carries a positive roll — the register is an enrolment file', () => {
  // Unlike `schools-fr`, there is no "effectif non publié" case to draw: a
  // site exists here only because students are counted at it. If this ever
  // stops holding, `supPointSize` and the card both need a new branch.
  const result = project();
  for (const site of result.sites) assert.ok(site.students > 0, site.id);
});

test('the commune and the département survive a borrowed coordinate', () => {
  // They are published on every register row, including the ones with no
  // `geo`. Reading them inside the coordinate branch would leave every
  // borrowed site unnamed in the national rollup's offshore list.
  const result = project();
  const [site] = siteFor(result, '9840349G');
  assert.equal(site.placement, 'offer');
  assert.ok(site.commune);
  assert.ok(site.deptName.startsWith('987'));
});

test('the ladder tally counts every drawn site exactly once', () => {
  const result = project();
  assert.equal(
    SUP_KINDS.reduce((total, kind) => total + result.kinds[kind], 0),
    result.count,
  );
});

test('the sites arrive sorted by enrolment, so a truncated draw keeps the largest', () => {
  const result = project();
  for (let i = 1; i < result.sites.length; i += 1) {
    assert.ok(result.sites[i - 1].students >= result.sites[i].students);
  }
});

test('a short export is reported, not served as a smaller country', () => {
  // The one failure Opendatasoft returns as HTTP 200.
  assert.equal(project().complete, true);
  assert.equal(project({ totalCount: ATLAS.length + 1 }).complete, false);
  // No count at all degrades the guarantee to "unknown", never to "false".
  assert.equal(project({ totalCount: null }).complete, true);
});

test('a row with no UAI is dropped rather than pooled into one nameless site', () => {
  const result = projectSupSites({
    records: [
      { id_etablissement: null, geo: { lat: 48, lon: 2 }, effectifhdccpge: 10 },
      { id_etablissement: '', geo: { lat: 49, lon: 3 }, effectifhdccpge: 20 },
    ],
  });
  assert.equal(result.count, 0);
  assert.equal(result.establishments, 0);
  assert.equal(result.rowsSwept, 0);
});

test('an empty or malformed input is an empty register, not a throw', () => {
  for (const records of [[], null, undefined, 'nope', [null, 42]]) {
    const result = projectSupSites({ records });
    assert.equal(result.count, 0);
    assert.equal(result.students, 0);
    assert.deepEqual(result.sites, []);
  }
});

// --- Year discovery and query construction ---------------------------------

test('the newest year is discovered, and never goes backwards from the floor', () => {
  assert.equal(newestYear([{ rentree: '2025' }, { rentree: '2024' }], 'rentree', '2024'), '2025');
  // An answer older than the floor is malformed, not a new fact.
  assert.equal(newestYear([{ rentree: '2019' }], 'rentree', '2024'), '2024');
  // A non-year value must not win by parsing to NaN — these columns are TEXT.
  assert.equal(newestYear([{ rentree: '2023-24' }, { rentree: 'toutes' }], 'rentree', '2024'), '2024');
  assert.equal(newestYear(null, 'rentree', '2024'), '2024');
  assert.equal(newestYear([{ annee: '2027' }], 'annee', SUP_SESSION_FLOOR), '2027');
});

test('the floors are the years this module was measured against', () => {
  assert.match(SUP_RENTREE_FLOOR, /^\d{4}$/);
  assert.match(SUP_SESSION_FLOOR, /^\d{4}$/);
  assert.equal(supAtlasWhere('2024'), 'rentree="2024"');
  assert.equal(supOfferWhere('2026'), 'annee="2026"');
});

test('a site key is its establishment AND its coordinate', () => {
  // Two establishments do share an address — a lycée and the CFA inside it —
  // so a coordinate alone would silently merge them into one dot.
  assert.equal(supSiteKey('0142395C', 49.18, -0.37), '0142395C@49.18000,-0.37000');
  assert.notEqual(supSiteKey('A', 1, 2), supSiteKey('B', 1, 2));
});
