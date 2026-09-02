// The reading of the DEPP's indice de position sociale, and the one property
// every test here defends: a school with no published IPS must be
// distinguishable, on the card, from a school with an average one.
//
// The four files disagree about almost everything — their newest rentrée,
// their column names, the type of the number, whether a missing value is null
// or the string "NS" — so every test runs against REAL captured rows
// (`fixtures/ips-*-sample.json`), each chosen for a distinct trap. A synthetic
// fixture would agree with itself and would prove nothing about these files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  IPS_DATASETS,
  IPS_ELIGIBLE_TYPES,
  IPS_KINDS,
  IPS_MAX_PLAUSIBLE,
  IPS_MIN_PLAUSIBLE,
  IPS_SPREAD_MAX_PLAUSIBLE,
  IPS_UNAVAILABLE,
  LYCEE_REF_FIELDS,
  formatIps,
  formatIpsDelta,
  indexIps,
  ipsBaseline,
  ipsCardLines,
  ipsCoverageClause,
  ipsKindForType,
  ipsRentreeWhere,
  ipsSelectFields,
  newestIpsRentree,
  projectIpsRow,
  readIpsSpread,
  readIpsValue,
  summariseIpsCoverage,
} from './ipsFeed.js';

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

const RENTREES = load('ips-rentrees-sample.json');
const ECOLES = load('ips-ecoles-sample.json');
const COLLEGES = load('ips-colleges-sample.json');
const LYCEES = load('ips-lycees-sample.json');
const EREA = load('ips-erea-sample.json');

const specFor = (kind) => IPS_DATASETS.find((spec) => spec.kind === kind);
const discovery = (dataset) => RENTREES.find((entry) => entry.dataset === dataset);
/** `toLocaleString('fr-FR')` uses U+202F for thousands; collapse every space. */
const norm = (value) => String(value).replace(/[\s  ]+/g, ' ');

/** Index one fixture as the proxy would, at the rentrée it was captured at. */
function indexed(kind, rows) {
  const spec = specFor(kind);
  return indexIps([{ spec, rentree: newestIpsRentree(discovery(spec.dataset).response.results, spec.rentreeFloor), rows }]);
}

const ALL = indexIps(IPS_KINDS.map((kind) => {
  const spec = specFor(kind);
  const rows = { ecole: ECOLES, college: COLLEGES, lycee: LYCEES, erea: EREA }[kind];
  return { spec, rentree: newestIpsRentree(discovery(spec.dataset).response.results, spec.rentreeFloor), rows };
}));

// --- The fixtures themselves ------------------------------------------------

test('the fixtures are the real files, with every trap still in them', () => {
  assert.equal(ECOLES.length, 4);
  assert.equal(COLLEGES.length, 4);
  assert.equal(LYCEES.length, 6);
  assert.equal(EREA.length, 2);
  assert.equal(RENTREES.length, 4);

  // Regenerating these without the awkward rows would leave every test below
  // passing while testing nothing. Pin the awkwardness itself.
  assert.ok(ECOLES.some((row) => row.ips === 'NS'), 'the NS sentinel');
  assert.ok(ECOLES.some((row) => row.ips === '72'), 'an integer published as text');
  assert.ok(COLLEGES.some((row) => row.ips === null), 'a published row with an empty index');
  assert.ok(COLLEGES.some((row) => row.ips_national === null), 'a missing national baseline');
  assert.ok(COLLEGES.some((row) => row.ecart_type_de_l_ips < 20), 'an écart-type under the index floor');
  assert.ok(LYCEES.some((row) => row.type_de_lycee === 'LPO' && row.ips_voie_gt && row.ips_voie_pro), 'an LPO with both voies');
  assert.ok(LYCEES.some((row) => row.type_de_lycee === 'LP' && row.ips_voie_gt === null), 'an LP with no general stream');
  assert.ok(LYCEES.some((row) => row.ips_etab === null), 'a lycée with no index at all');
  assert.ok(EREA.every((row) => 'nom_de_l_etablissment' in row), 'the EREA misspelling');
  assert.ok(EREA.every((row) => !('nom_de_l_etablissement' in row)), 'and NOT the correct one');
});

// --- Trap 1: four datasets, four newest rentrées ----------------------------

test('each dataset discovers its OWN newest rentrée, and they disagree', () => {
  // This is the trap that silently costs three quarters of the join: a single
  // global max() returns 2025-2026 and drops all 32 494 écoles.
  const found = Object.fromEntries(IPS_DATASETS.map((spec) => [
    spec.kind,
    newestIpsRentree(discovery(spec.dataset).response.results, spec.rentreeFloor),
  ]));
  assert.deepEqual(found, {
    ecole: '2024-2025',
    college: '2025-2026',
    lycee: '2025-2026',
    erea: '2025-2026',
  });
  assert.notEqual(found.ecole, found.college);
});

test('a global max over all four groupings is exactly the bug this avoids', () => {
  const everything = RENTREES.flatMap((entry) => entry.response.results);
  assert.equal(newestIpsRentree(everything, '2024-2025'), '2025-2026');
  // Applied to the écoles file that answer selects a rentrée it does not have.
  assert.equal(
    ECOLES.every((row) => row.uai),
    true,
    'the écoles fixture is at 2024-2025 and would return zero rows at 2025-2026',
  );
});

test('the discovery is floored, and an older answer cannot move it backwards', () => {
  const stale = [{ rentree_scolaire: '2019-2020' }, { rentree_scolaire: '2021-2022' }];
  assert.equal(newestIpsRentree(stale, '2024-2025'), '2024-2025');
  // A newer one is adopted — the floor is a floor, not a pin.
  assert.equal(newestIpsRentree([{ rentree_scolaire: '2026-2027' }], '2024-2025'), '2026-2027');
});

test('a malformed rentrée cannot move the year at all', () => {
  for (const bad of ['2026', '2026/2027', '', null, 'derniere', '2026-27']) {
    assert.equal(newestIpsRentree([{ rentree_scolaire: bad }], '2024-2025'), '2024-2025', String(bad));
  }
  assert.equal(newestIpsRentree(null, '2025-2026'), '2025-2026');
  assert.equal(newestIpsRentree([], '2025-2026'), '2025-2026');
});

test('the where clause pins one rentrée, because the files are cumulative', () => {
  // 97 080 école rows are three school years stacked; unfiltered, every school
  // appears three times with three different indices.
  assert.equal(ipsRentreeWhere('2024-2025'), 'rentree_scolaire="2024-2025"');
});

// --- Trap 2: lycées have no `ips` column ------------------------------------

test('the lycée spec reads ips_etab, because `ips` does not exist there', () => {
  assert.equal(specFor('lycee').valueField, 'ips_etab');
  assert.equal(specFor('ecole').valueField, 'ips');
  assert.ok(!LYCEES.some((row) => 'ips' in row));
  // Every lycée in the fixture is indexed. A join written against `ips` would
  // have found none of them.
  const built = indexed('lycee', LYCEES);
  assert.equal(built.index.size, LYCEES.length);
});

test('an LPO card names both voies, because ips_etab blends them', () => {
  const record = indexed('lycee', LYCEES).index.get('0312746S');
  assert.equal(record.lyceeType, 'LPO');
  assert.equal(record.value, 126.3);
  assert.deepEqual(record.voies, { gt: 140.1, pro: 92.4, postBac: 97.3 });
  const copy = ipsCardLines(record).join('\n');
  assert.match(copy, /établissement entier \(LPO\)/);
  // 47.7 IPS points apart inside one number. Printing 126.3 alone describes
  // neither half of this school.
  assert.match(copy, /voie générale et technologique 140,1/);
  assert.match(copy, /voie professionnelle 92,4/);
});

test('a lycée with one voie says so, and does not imply the other is zero', () => {
  const record = indexed('lycee', LYCEES).index.get('0132922F');
  assert.deepEqual(record.voies, { postBac: 110.7 });
  const copy = ipsCardLines(record).join('\n');
  assert.match(copy, /post-bac 110,7 — seule voie publiée/);
  assert.equal(/voie professionnelle/.test(copy), false);
});

test('ips_etab is not a copy of the single voie it looks like', () => {
  // 0020031Y publishes GT 97.4 and ips_etab 95.4 — the difference is the
  // post-bac population, which is folded into ips_etab and into nothing else.
  const record = indexed('lycee', LYCEES).index.get('0020031Y');
  assert.equal(record.value, 95.4);
  assert.equal(record.voies.gt, 97.4);
  assert.notEqual(record.value, record.voies.gt);
});

// --- Trap 3: the EREA misspelling -------------------------------------------

test('the EREA name column is misspelled upstream and copied verbatim', () => {
  assert.equal(specFor('erea').nameField, 'nom_de_l_etablissment');
  for (const kind of ['ecole', 'college', 'lycee']) {
    assert.equal(specFor(kind).nameField, 'nom_de_l_etablissement');
  }
});

test('the select is built per dataset, because a shared one is an HTTP 400', () => {
  // Verified live 2026-09-02: the correct spelling returns
  // `ODSQLError: Unknown field: nom_de_l_etablissement` on the EREA dataset,
  // and the misspelling returns the same on the écoles one. Not a null column
  // — a whole-request failure.
  const erea = ipsSelectFields(specFor('erea'));
  const ecole = ipsSelectFields(specFor('ecole'));
  assert.ok(erea.includes('nom_de_l_etablissment'));
  assert.ok(!erea.includes('nom_de_l_etablissement'));
  assert.ok(ecole.includes('nom_de_l_etablissement'));
  assert.ok(!ecole.includes('nom_de_l_etablissment'));
  // And the fixtures were captured through exactly those lists.
  for (const [spec, rows] of [[specFor('erea'), EREA], [specFor('ecole'), ECOLES],
    [specFor('college'), COLLEGES], [specFor('lycee'), LYCEES]]) {
    const fields = new Set(ipsSelectFields(spec));
    for (const row of rows) {
      for (const key of Object.keys(row)) assert.ok(fields.has(key), `${spec.dataset}: ${key}`);
    }
  }
});

test('the EREA name still reaches the index, misspelling and all', () => {
  const built = indexed('erea', EREA);
  assert.equal(built.names.get('0010966V'), 'ETABLISSEMENT REGIONAL D ENSEIGNEMENT ADAPTE PHILIBERT COMMERSON');
});

// --- Trap 4: per-type baselines for lycées ----------------------------------

test('a lycée is compared to its own type, never to the wrong one', () => {
  // Nationally LEGT 120.2, LPO 104.4, LP 89.9 — 30 points end to end, so the
  // wrong column is a wrong number and not a rounding difference.
  const built = indexed('lycee', LYCEES).index;
  assert.equal(built.get('0312746S').national, 104.4, 'LPO');
  assert.equal(built.get('0010099C').national, 89.9, 'LP');
  assert.equal(built.get('0020031Y').national, 120.2, 'LEGT');
  assert.deepEqual(Object.keys(LYCEE_REF_FIELDS), ['LEGT', 'LPO', 'LP']);
});

test('the non-lycée files use their single unsplit reference pair', () => {
  assert.equal(indexed('ecole', ECOLES).index.get('0010093W').national, 105.8);
  assert.equal(indexed('college', COLLEGES).index.get('0010018P').departemental, 109.8);
});

test('a missing baseline degrades the comparison instead of inventing one', () => {
  // 94 collège rows and 39 lycée rows publish no `ips_national` at all.
  const record = indexed('college', COLLEGES).index.get('9830313Y');
  assert.equal(record.national, null);
  assert.equal(record.departemental, 82);
  const copy = ipsCardLines(record).join('\n');
  assert.equal(/France/.test(copy), false);
  assert.match(copy, /département 82,0/);
  assert.match(copy, /écart −5,3 au département/);
});

test('a reference equal to the school itself is not a comparison', () => {
  // There is at most one EREA per département, so `ips_departemental` IS the
  // school on 49 of the 77 rows. An "écart +0,0" would read as a finding.
  const record = indexed('erea', EREA).index.get('0010966V');
  assert.equal(record.departemental, record.value);
  assert.deepEqual(ipsBaseline(record), { value: 82.1, label: 'à la France' });
  assert.match(ipsCardLines(record).join('\n'), /écart −4,8 à la France/);
});

test('with neither baseline usable there is no écart, and no invented one', () => {
  const orphan = { status: 'ok', kind: 'college', value: 100, rentree: '2025-2026', national: null, departemental: null };
  assert.equal(ipsBaseline(orphan), null);
  assert.deepEqual(ipsCardLines(orphan), ['IPS 100,0 — rentrée 2025-2026']);
});

// --- Trap 5: NS is a value, and Number('NS') is NaN -------------------------

test('the NS sentinel is read as withheld, never as zero and never as text', () => {
  // 2 504 of the 32 494 école rows. `Number(row.ips) || 0` would draw every one
  // of them at an IPS of 0 on a scale whose real floor is 54.9.
  assert.deepEqual(readIpsValue('NS'), { value: null, sentinel: 'NS' });
  const record = indexed('ecole', ECOLES).index.get('0010108M');
  assert.equal(record.status, 'ns');
  assert.equal(record.value, null);
  assert.equal(record.sentinel, 'NS');
  const copy = ipsCardLines(record).join('\n');
  assert.match(copy, /non significatif/);
  assert.equal(/\b0\b/.test(copy), false);
  assert.equal(/NS/.test(copy), true);
});

test('an empty cell is "not published", which is not the same as withheld', () => {
  const record = indexed('college', COLLEGES).index.get('9750025D');
  assert.equal(record.status, 'absent');
  assert.equal(record.sentinel, null);
  assert.deepEqual(ipsCardLines(record), ['IPS non publié pour cet UAI']);
  // And the two are counted apart, because the difference is a fact about the
  // file rather than about the school.
  const built = indexed('college', COLLEGES);
  assert.equal(built.counts.college.blank, 1);
  assert.equal(built.counts.college.sentinel, 0);
  assert.equal(indexed('ecole', ECOLES).counts.ecole.sentinel, 1);
});

test('an écart-type has its OWN window, or 162 published ones vanish', () => {
  // The index floor is 20 and the dispersion runs down to 7.9 — reusing one
  // window for both silently discarded 102 collèges, 39 lycées and 21 EREA.
  const record = indexed('college', COLLEGES).index.get('0752954D');
  assert.equal(record.spread, 7.9);
  assert.match(ipsCardLines(record).join(''), /écart-type 7,9/);
  assert.equal(readIpsSpread(7.9), 7.9);
  assert.equal(readIpsSpread('46.2'), 46.2);
  // And it is still a window: a spread cannot be negative or larger than the
  // scale it disperses.
  assert.equal(readIpsSpread(0), null);
  assert.equal(readIpsSpread(-3), null);
  assert.equal(readIpsSpread(IPS_SPREAD_MAX_PLAUSIBLE + 1), null);
  assert.equal(readIpsSpread('NS'), null);
  assert.equal(readIpsSpread(null), null);
});

test('a number outside the plausible window is a sentinel, not a dot', () => {
  assert.deepEqual(readIpsValue(0), { value: null, sentinel: '0' });
  assert.deepEqual(readIpsValue(9999), { value: null, sentinel: '9999' });
  assert.deepEqual(readIpsValue('-1'), { value: null, sentinel: '-1' });
  // The measured extremes across all four files are 54.9 and 162.7, so the
  // window never touches a real value.
  assert.ok(IPS_MIN_PLAUSIBLE < 54.9);
  assert.ok(IPS_MAX_PLAUSIBLE > 162.7);
  assert.equal(readIpsValue(54.9).value, 54.9);
  assert.equal(readIpsValue(162.7).value, 162.7);
});

test('an unknown sentinel is reported as itself, not silently swallowed', () => {
  assert.deepEqual(readIpsValue('nd'), { value: null, sentinel: 'ND' });
  const line = ipsCardLines({ status: 'ns', sentinel: 'ND', kind: 'ecole', value: null });
  assert.deepEqual(line, ['IPS publié comme « ND », pas comme un nombre']);
});

// --- Trap 6: three types for one measure ------------------------------------

test('text, integer-text and double all read to the same number', () => {
  assert.equal(readIpsValue('119.5').value, 119.5);
  assert.equal(readIpsValue('72').value, 72);
  assert.equal(readIpsValue(96.3).value, 96.3);
  assert.equal(indexed('ecole', ECOLES).index.get('0930327A').value, 72);
  assert.equal(indexed('college', COLLEGES).index.get('0010018P').value, 96.3);
  assert.equal(indexed('lycee', LYCEES).index.get('0010099C').value, 104.9);
});

test('a blank, a null and an undefined are all "nothing was said"', () => {
  for (const raw of [null, undefined, '', '   ']) {
    assert.deepEqual(readIpsValue(raw), { value: null, sentinel: null }, String(raw));
  }
  assert.deepEqual(readIpsValue(NaN), { value: null, sentinel: null });
});

// --- The index --------------------------------------------------------------

test('the four files fold into one index with no UAI in two of them', () => {
  assert.equal(ALL.index.size, ECOLES.length + COLLEGES.length + LYCEES.length + EREA.length);
  assert.equal(ALL.collisions, 0);
  assert.equal(ALL.status, 'ok');
  assert.deepEqual(ALL.missing, []);
  // Measured nationally 2026-09-02: 32 494 + 7 089 + 3 662 + 77 = 43 322 rows
  // over 43 322 distinct UAI. The collision counter exists because that is a
  // measurement and not a guarantee.
});

test('a row with no UAI is counted, never joined to something', () => {
  const spec = specFor('college');
  assert.equal(projectIpsRow({ ips: 100 }, spec, '2025-2026'), null);
  const built = indexIps([{ spec, rentree: '2025-2026', rows: [...COLLEGES, { uai: '  ', ips: 100 }] }]);
  assert.equal(built.counts.college.noUai, 1);
  assert.equal(built.index.size, COLLEGES.length);
});

test('a dataset that did not load is MISSING, not empty', () => {
  // The difference the whole degradation story rests on: three files loaded
  // and one did not, so lycée cards say "indisponible" while every other card
  // is unaffected.
  const partial = indexIps([{ spec: specFor('ecole'), rentree: '2024-2025', rows: ECOLES }]);
  assert.equal(partial.status, 'partial');
  assert.deepEqual(partial.missing, ['college', 'lycee', 'erea']);
  const nothing = indexIps([]);
  assert.equal(nothing.status, 'unavailable');
  assert.deepEqual(nothing.missing, IPS_KINDS);
  assert.equal(nothing.index.size, 0);
});

test('malformed input produces an empty index rather than a throw', () => {
  for (const batches of [null, undefined, 'nope', {}, [null], [{ spec: null }]]) {
    assert.doesNotThrow(() => indexIps(batches));
    assert.equal(indexIps(batches).index.size, 0);
  }
});

// --- Coverage ---------------------------------------------------------------

const annuaire = (over = {}) => ({
  identifiant_de_l_etablissement: '0010093W', type_etablissement: 'Ecole', ...over,
});

test('coverage is measured over the eligible types, and only those', () => {
  const cover = summariseIpsCoverage({
    records: [
      annuaire(),                                                        // joined, valued
      annuaire({ identifiant_de_l_etablissement: '0010108M' }),          // joined, NS
      annuaire({ identifiant_de_l_etablissement: '9999999Z' }),          // eligible, no row
      annuaire({ identifiant_de_l_etablissement: '0010018P', type_etablissement: 'Collège' }),
      annuaire({ identifiant_de_l_etablissement: '0000000A', type_etablissement: 'Médico-social' }),
      annuaire({ identifiant_de_l_etablissement: '0000000B', type_etablissement: 'Service Administratif' }),
    ],
    index: ALL.index,
  });
  assert.equal(cover.eligible, 4, 'the two non-teaching rows are not a denominator');
  assert.equal(cover.joined, 3);
  assert.equal(cover.valued, 2, 'the NS row joined but has no number');
  assert.equal(cover.byType.Ecole.drawn, 3);
  assert.equal(cover.byType['Collège'].valued, 1);
  assert.equal(cover.byType['Lycée'].drawn, 0);
  assert.equal(cover.drawnOutsideScope, 0);
});

test('an indexed school the register never typed is counted, not dropped', () => {
  // 7 nationally. The Annuaire publishes no `type_etablissement` for them and
  // the DEPP publishes an index anyway; staying silent about a published index
  // is the failure this join exists to prevent.
  const cover = summariseIpsCoverage({
    records: [
      annuaire(),
      annuaire({ identifiant_de_l_etablissement: '0010018P', type_etablissement: null }),
      annuaire({ identifiant_de_l_etablissement: '0000000A', type_etablissement: null }),
    ],
    index: ALL.index,
  });
  assert.equal(cover.eligible, 2, 'the untyped row WITHOUT an index is still out');
  assert.equal(cover.joined, 2);
  assert.equal(cover.drawnOutsideScope, 1);
  // The per-type table plus the untyped remainder reconciles to the total.
  const typed = IPS_ELIGIBLE_TYPES.reduce((sum, type) => sum + cover.byType[type].drawn, 0);
  assert.equal(typed + cover.drawnOutsideScope, cover.eligible);
  // And the invariant the readout depends on holds in every case.
  assert.ok(cover.valued <= cover.joined && cover.joined <= cover.eligible);
});

test('EREA is counted apart from médico-social, or its rate is 30x wrong', () => {
  // `schoolLevel()` folds both into the `adapte` band. Nationally that is 79
  // EREA against 2 300 médico-social, so a coverage rate over the band would
  // report the best-covered type in the file — 77 of 79 — as 3.3%.
  assert.equal(ipsKindForType('EREA'), 'erea');
  assert.equal(ipsKindForType('Médico-social'), null);
  assert.equal(ipsKindForType('Service Administratif'), null);
  assert.equal(ipsKindForType('Information et orientation'), null);
  assert.equal(ipsKindForType(null), null);
  assert.deepEqual([...IPS_ELIGIBLE_TYPES], ['Ecole', 'Collège', 'Lycée', 'EREA']);
});

test('a UAI the register publishes twice is one dot and one denominator', () => {
  // 70 UAIs are duplicated in the drawn set nationally (one appears 3 times)
  // and `schoolsFrance.js` keys its records on the UAI, so it draws one.
  const cover = summariseIpsCoverage({
    records: [annuaire(), annuaire(), annuaire()],
    index: ALL.index,
  });
  assert.equal(cover.eligible, 1);
  assert.equal(cover.joined, 1);
});

test('IPS establishments the map does not draw are counted, and named', () => {
  const cover = summariseIpsCoverage({ records: [annuaire()], index: ALL.index, names: ALL.names });
  assert.equal(cover.indexed, 16);
  assert.equal(cover.unmatched, 15);
  assert.ok(cover.unmatchedSample.length > 0 && cover.unmatchedSample.length <= 5);
  for (const entry of cover.unmatchedSample) {
    assert.ok(entry.uai);
    assert.ok(entry.name, 'a bare count is not checkable; the name is');
    assert.ok(IPS_KINDS.includes(entry.kind));
  }
  // 1300023U is the Lycée Comte de Foix in Andorra la Vella — a French lycée
  // the open Annuaire does not list. 348 rows nationally are in this state.
  assert.ok([...ALL.index.keys()].includes('1300023U'));
});

test('coverage never throws on an empty or malformed sweep', () => {
  for (const records of [[], null, undefined, 'nope', [null], [{}]]) {
    const cover = summariseIpsCoverage({ records, index: ALL.index });
    assert.equal(cover.eligible, 0);
    assert.equal(cover.valued, 0);
  }
  assert.doesNotThrow(() => summariseIpsCoverage());
});

// --- The card ---------------------------------------------------------------

test('the four ways an IPS can be missing all read differently', () => {
  // The whole point of the join: a reader must never be unable to tell a
  // withheld index from a broken pipe from a school outside the scheme.
  assert.deepEqual(ipsCardLines(undefined), [], 'outside the scheme — say nothing');
  assert.deepEqual(ipsCardLines(null), ['IPS non publié pour cet UAI']);
  assert.deepEqual(
    ipsCardLines(IPS_UNAVAILABLE),
    ['Indice de position sociale indisponible — fichier DEPP injoignable'],
  );
  assert.match(
    ipsCardLines({ status: 'ns', sentinel: 'NS', value: null }).join(''),
    /non significatif/,
  );
  const lines = new Set([
    ipsCardLines(null)[0],
    ipsCardLines(IPS_UNAVAILABLE)[0],
    ipsCardLines({ status: 'ns', sentinel: 'NS', value: null })[0],
  ]);
  assert.equal(lines.size, 3, 'three states, three sentences');
});

test('the card names the rentrée the index belongs to, not today', () => {
  const ecole = ipsCardLines(indexed('ecole', ECOLES).index.get('0010093W')).join('\n');
  const college = ipsCardLines(indexed('college', COLLEGES).index.get('0010018P')).join('\n');
  // The écoles file is a year behind. Printing one rentrée for both would be a
  // claim neither source makes.
  assert.match(ecole, /rentrée 2024-2025/);
  assert.match(college, /rentrée 2025-2026/);
});

test('the écart-type rides the headline where the file publishes one', () => {
  // Écoles never publish it; collèges, EREA and lycées always do.
  assert.equal(/écart-type/.test(ipsCardLines(indexed('ecole', ECOLES).index.get('0010093W')).join('')), false);
  assert.match(ipsCardLines(indexed('college', COLLEGES).index.get('0010018P')).join(''), /écart-type 34,3/);
});

test('a school far below its département says so in the sign', () => {
  // 0930327A, Bondy: IPS 72 against a Seine-Saint-Denis reference of 94.9.
  const copy = ipsCardLines(indexed('ecole', ECOLES).index.get('0930327A')).join('\n');
  assert.match(copy, /IPS 72,0/);
  assert.match(copy, /écart −22,9 au département/);
});

test('French decimals use a comma and the écart carries an explicit sign', () => {
  assert.equal(formatIps(119.5), '119,5');
  assert.equal(formatIps(72), '72,0');
  assert.equal(formatIpsDelta(-7.8), '−7,8');
  assert.equal(formatIpsDelta(12.75), '+12,8');
  assert.equal(formatIpsDelta(0), '+0,0');
});

test('the card never throws on a broken record', () => {
  for (const ips of [{}, { status: 'ok' }, { status: 'ok', value: 'x' }, { status: 'weird' }]) {
    assert.doesNotThrow(() => ipsCardLines(ips));
  }
});

// --- The coverage readout ---------------------------------------------------

test('the readout names the denominator, never a bare percentage', () => {
  assert.equal(
    norm(ipsCoverageClause({ eligible: 62857, valued: 40529, status: 'ok' })),
    'IPS publié pour 40 529 des 62 857 établissements concernés',
  );
});

test('a partial index says it is partial, and a dead one says nothing else', () => {
  assert.match(ipsCoverageClause({ eligible: 100, valued: 40, status: 'partial' }), /index partiel/);
  assert.equal(ipsCoverageClause({ eligible: 0, valued: 0, status: 'unavailable' }), 'IPS indisponible');
  // Nothing eligible in view is nothing to say — not "0 of 0".
  assert.equal(ipsCoverageClause({ eligible: 0, valued: 0, status: 'ok' }), '');
  assert.equal(ipsCoverageClause(null), '');
});
