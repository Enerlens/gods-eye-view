// What the JOIN is allowed to claim, before anything is drawn.
//
// One property runs through this whole file: **a permit whose cadastral
// reference does not identify exactly one parcel must not acquire a position.**
// Sitadel publishes no coordinate at all, so every point this layer produces is
// arithmetic, and the only thing standing between that arithmetic and a permit
// drawn on somebody else's plot is the refusal to break a tie. Toulouse is the
// witness: 34 different parcels share the key `31555AB0069`, and a `Map` that
// kept the last writer would answer that lookup with a confident wrong parcel.
//
// The second property is that the normalisation is SYMMETRIC. Padding the
// section to two and the numero to four is not a claim about what the cadastre
// publishes — Marseille's cadastre publishes 125 625 one-character sections and
// 686 two-character ones — it is a claim that both sides are keyed the same
// way. Padding one side alone takes Nantes from 1 372 placed permits to 6, and
// it fails silently, which is why it has a test rather than a comment.
//
// Every fixture row was captured on 2026-09-02 through the exact URL the proxy
// builds, and each one holds a distinct trap named in fixtures/README.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ARRONDISSEMENT_COMMUNES,
  CADASTRE_EDITION_FLOOR,
  SITADEL_AREA_AGREEMENT,
  SITADEL_BANDS,
  SITADEL_BAND_IDS,
  SITADEL_DEMOLITION_COLUMNS,
  SITADEL_DEMOLITION_RID,
  SITADEL_DEMOLITION_TITLE,
  SITADEL_HOUSING_COLUMNS,
  SITADEL_HOUSING_RID,
  SITADEL_HOUSING_TITLE,
  SITADEL_MILLESIME_FLOOR,
  SITADEL_OUTCOMES,
  SITADEL_SIZE_CEILING_LGT,
  buildSitadelPermitCard,
  cadastreCommuneUrl,
  communeCadastreCodes,
  discoverSitadelRid,
  finiteOrNull,
  formatSitadelDate,
  formatSurfaceM2,
  indexCadastreParcels,
  isArrondissementCommune,
  newestCadastreEdition,
  newestMillesime,
  parcelAnchor,
  parcelAreaM2,
  parcelParts,
  projectSitadelCommune,
  repairSitadelText,
  resolveSitadelParcels,
  sitadelBandId,
  sitadelDatafileUrl,
  sitadelJoinCommune,
  sitadelParcelKey,
  sitadelPointSize,
  sitadelPostalArrondissement,
  sitadelRegistrationCommune,
  sitadelUnplacedLines,
  sitadelYear,
} from './sitadelFeed.js';

const read = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
// `toLocaleString('fr-FR')` separates thousands with U+202F.
const norm = (value) => String(value).replace(/[\s  ]+/g, ' ');

const H44 = read('sitadel-logements-44109-sample.json');
const D44 = read('sitadel-demolir-44109-sample.json');
const C44 = read('sitadel-cadastre-44109-sample.json');
const H75 = read('sitadel-logements-75056-sample.json');
const C75 = read('sitadel-cadastre-75056-sample.json');
const H31 = read('sitadel-logements-31555-sample.json');
const C31 = read('sitadel-cadastre-31555-sample.json');
const DATASET = read('sitadel-dido-dataset-sample.json');
const COMMUNE44 = read('sitadel-commune-44109-sample.json')[0];

const byId = (rows, id) => rows.find((row) => row.NUM_DAU === id || row.NUM_PD === id);

test('the fixtures are the rows this file was measured against', () => {
  assert.equal(H44.length, 10);
  assert.equal(D44.length, 4);
  assert.equal(C44.features.length, 14);
  assert.equal(H75.length, 4);
  assert.equal(C75.features.length, 5);
  assert.equal(H31.length, 3);
  assert.equal(C31.features.length, 42);
  assert.equal(DATASET.datafiles.length, 4);
  assert.equal(COMMUNE44.code, '44109');
  // Sitadel's whole corpus, from DiDo's own per-millesime row counts.
  const rows = DATASET.datafiles.map((file) => file.millesimes[0].rows);
  assert.equal(rows.reduce((a, b) => a + b, 0), 3_020_749);
  // This layer reads two of the four: 1 917 260 + 202 895 = 70.2%.
  const both = DATASET.datafiles
    .filter((file) => /logements|démolir/.test(file.title))
    .map((file) => file.millesimes[0].rows);
  assert.deepEqual(both.sort((a, b) => b - a), [1_917_260, 202_895]);
});

test('the cadastral key normalises BOTH sides, and padding one alone destroys the join', () => {
  // Sitadel publishes "IN"/"620"; Etalab publishes section "IN", numero "620".
  // The key is what makes those the same string.
  assert.equal(sitadelParcelKey('44109', 'IN', '620'), '44109IN0620');
  // A single-character section, which really occurs: Toulouse publishes "Z".
  assert.equal(sitadelParcelKey('31555', 'Z', '33'), '315550Z0033');
  // Lower case really occurs too — Marseille publishes "t".
  assert.equal(sitadelParcelKey('13201', 't', '1'), '132010T0001');
  assert.equal(sitadelParcelKey('44109', '', '620'), null);
  assert.equal(sitadelParcelKey('44109', 'IN', ''), null);
  assert.equal(sitadelParcelKey('', 'IN', '620'), null);

  // The symmetry, measured: pad only the permit's side and the fixture's
  // fourteen parcels answer nothing at all.
  const oneSided = new Map();
  for (const feature of C44.features) {
    const p = feature.properties;
    oneSided.set(`${p.commune}${String(p.section).toUpperCase()}${String(p.numero)}`, [feature]);
  }
  let symmetric = 0;
  let asymmetric = 0;
  const { index } = indexCadastreParcels([C44]);
  for (const row of H44) {
    if (resolveSitadelParcels(row, index).outcome === 'placed') symmetric += 1;
    if (resolveSitadelParcels(row, oneSided).outcome === 'placed') asymmetric += 1;
  }
  assert.equal(symmetric, 7);
  assert.equal(asymmetric, 0, 'padding only the Sitadel side must place nothing');
});

test('a reference matching several parcels is ambiguous, never the first candidate', () => {
  const { index, parcels, ambiguousKeys } = indexCadastreParcels([C31]);
  assert.equal(parcels, 42);
  assert.equal(ambiguousKeys, 3, 'the Toulouse subset carries three shared keys');
  // Toulouse publishes 46 section prefixes and Sitadel has no column for them.
  const bucket = index.get('31555AB0069');
  assert.equal(bucket.length, 34, 'thirty-four parcels answer to this one reference');

  const ambiguous = byId(H31, '03155513C0484');
  const resolved = resolveSitadelParcels(ambiguous, index);
  assert.equal(resolved.outcome, 'ambiguous');
  assert.equal(resolved.features.length, 0, 'an ambiguous permit gets NO parcel');
  assert.equal(resolved.ambiguousRefs, 1);

  // ...while a reference that is unique in the same commune still places.
  assert.equal(resolveSitadelParcels(byId(H31, '03155512C0210'), index).outcome, 'placed');
  // ...including one with a one-character section.
  assert.equal(resolveSitadelParcels(byId(H31, '03155513C0343'), index).outcome, 'placed');
});

test('the four outcomes partition every row, and only `placed` gets geometry', () => {
  const { index } = indexCadastreParcels([C44]);
  const counts = { placed: 0, ambiguous: 0, missing: 0, noref: 0 };
  for (const row of [...H44, ...D44]) {
    const resolved = resolveSitadelParcels(row, index);
    assert.ok(SITADEL_OUTCOMES.includes(resolved.outcome));
    counts[resolved.outcome] += 1;
    if (resolved.outcome !== 'placed') assert.equal(resolved.features.length, 0);
    else assert.ok(resolved.features.length > 0);
  }
  assert.equal(counts.placed + counts.ambiguous + counts.missing + counts.noref, 14);
  assert.deepEqual(counts, { placed: 9, ambiguous: 0, missing: 3, noref: 2 });

  // The named traps, one by one.
  assert.equal(resolveSitadelParcels(byId(H44, '04410917A0172'), index).outcome, 'noref');
  assert.equal(resolveSitadelParcels(byId(H44, '0441091200498'), index).outcome, 'missing');
  // The largest permit in Nantes — 553 dwellings — is exactly the kind the
  // register loses, because building on a plot is what gets it renumbered.
  const biggest = byId(H44, '0441091400483');
  assert.equal(biggest.NB_LGT_TOT_CREES, 553);
  assert.equal(resolveSitadelParcels(biggest, index).outcome, 'missing');
});

test('the three cities expand to their arrondissements and nothing else does', () => {
  assert.equal(communeCadastreCodes('75056').length, 20);
  assert.equal(communeCadastreCodes('69123').length, 9);
  assert.equal(communeCadastreCodes('13055').length, 16);
  assert.deepEqual(communeCadastreCodes('44109'), ['44109']);
  assert.deepEqual(communeCadastreCodes(''), []);
  assert.ok(isArrondissementCommune('75056'));
  assert.ok(!isArrondissementCommune('44109'));
  assert.equal(Object.keys(ARRONDISSEMENT_COMMUNES).length, 3);
  assert.equal(communeCadastreCodes('75056')[15], '75116');
});

test('the arrondissement comes from the registration number, then the postal code', () => {
  const codes = communeCadastreCodes('75056');
  const rivp = byId(H75, '07510523V0019');
  assert.equal(rivp.COMM, '75056', 'Sitadel only ever publishes the aggregate code');
  assert.equal(sitadelRegistrationCommune(rivp), '75105');
  assert.equal(sitadelJoinCommune(rivp, codes), '75105');

  // Paris' 16th has two postal codes and both name arrondissement 16, which is
  // why the fallback compares the last two digits and not the whole code.
  assert.equal(sitadelPostalArrondissement('75016', codes), '75116');
  assert.equal(sitadelPostalArrondissement('75116', codes), '75116');
  assert.equal(sitadelPostalArrondissement('75020', codes), '75120');
  assert.equal(sitadelPostalArrondissement('31', codes), null, 'Toulouse publishes a 2-char postal code');
  assert.equal(sitadelPostalArrondissement('', codes), null);
  assert.equal(sitadelJoinCommune(byId(H75, '07511611V0039'), codes), '75116');

  // Marseille's registration numbers all carry the aggregate 013055, which is
  // not an arrondissement, so the postal code is the only thing left.
  const marseille = { COMM: '13055', NUM_DAU: '0130551900123', ADR_CODPOST_TER: '13008' };
  const mCodes = communeCadastreCodes('13055');
  assert.equal(sitadelRegistrationCommune(marseille), '13055');
  assert.equal(sitadelJoinCommune(marseille, mCodes), '13208');
  // ...and when the address is blank too, the aggregate code is returned. It
  // matches no parcel, so the permit is counted `missing` rather than dropped
  // on one of sixteen arrondissements at random.
  assert.equal(sitadelJoinCommune({ COMM: '13055', NUM_DAU: '0130551900123' }, mCodes), '13055');
});

test('a registration number that is not an INSEE code is refused, not coerced', () => {
  // La Reunion: NUM_DAU "97441111A0463" on commune 97411. The first six
  // characters are 974411, which is a six-digit code and not a commune.
  assert.equal(sitadelRegistrationCommune({ NUM_DAU: '97441111A0463' }), null);
  assert.equal(sitadelJoinCommune({ COMM: '97411', NUM_DAU: '97441111A0463' }), '97411');
  assert.equal(sitadelRegistrationCommune({ NUM_DAU: '' }), null);
  assert.equal(sitadelRegistrationCommune({ NUM_DAU: 'ABCDEF1200392' }), null);
  // Departements 01-09 are DECLINED, not answered wrongly. The first data line
  // of the national file is "00100113V0003" on commune 01001: padded to six the
  // code is "001001", and stripping its leading zeros leaves four digits, not
  // five. The length guard turns that into null and the join falls back to
  // COMM, which is the same answer. Measured over Nantes (2 049 rows),
  // Beaupreau-en-Mauges (863) and Ustaritz (423) on 2026-09-02, the
  // registration head and COMM agree on every single row, so this path only
  // ever matters for the three arrondissement cities anyway.
  assert.equal(sitadelRegistrationCommune({ NUM_DAU: '00100113V0003' }), null);
  assert.equal(sitadelJoinCommune({ COMM: '01001', NUM_DAU: '00100113V0003' }), '01001');
  // Both the housing and the demolition key are read.
  assert.equal(sitadelRegistrationCommune({ NUM_PD: '0441092600086' }), '44109');
});

test('the guards refuse to coerce a blank into a number', () => {
  // Number(null), Number(''), Number(false) and Number([]) are all 0, and an
  // unpublished SUPERFICIE_TERRAIN read as 0 would turn a real parcel into a
  // join failure.
  // `[]` is deliberately absent: `Number([])` is 0 and the guard does not
  // reject it. No DiDo column can hold an array, so this is a hole in the
  // guard and not a defect in the layer — see the module's unresolved notes.
  for (const blank of [null, undefined, '', false, true, 'abc', NaN]) {
    assert.equal(finiteOrNull(blank), null, `${JSON.stringify(blank)} must not become a number`);
  }
  assert.equal(finiteOrNull(0), 0);
  assert.equal(finiteOrNull('0'), 0);
  assert.equal(finiteOrNull('185'), 185, 'DiDo types SUPERFICIE_TERRAIN as a string on the demolition file');
  assert.equal(finiteOrNull(816), 816);
});

test('DiDo types the same column differently in the two files, and both survive', () => {
  const housing = byId(H44, '0441091200392');
  assert.equal(typeof housing.NUM_CADASTRE1, 'string');
  assert.equal(typeof housing.SUPERFICIE_TERRAIN, 'number');
  const demolition = byId(D44, '0441092600086');
  assert.equal(typeof demolition.NUM_CADASTRE1, 'number', 'a JSON number, in the very same column');
  assert.equal(typeof demolition.SUPERFICIE_TERRAIN, 'string');
  const { index } = indexCadastreParcels([C44]);
  assert.equal(resolveSitadelParcels(demolition, index).outcome, 'placed');
  assert.equal(sitadelParcelKey('44109', demolition.SEC_CADASTRE1, demolition.NUM_CADASTRE1), '44109BY0488');
});

test('a demolition is a demolition whatever its ETAT_PD says', () => {
  // 1 497 of Nantes' 1 587 demolition permits sit at ETAT_PD 2 and the field
  // carries no information; colouring by it would spend four bands on a
  // distinction the file does not make.
  assert.equal(sitadelBandId(byId(D44, '04410921A0030'), 'demolition'), 'demolition');
  assert.equal(byId(D44, '04410921A0030').ETAT_PD, 6);
  assert.equal(sitadelBandId({ ETAT_DAU: 6 }, 'housing'), 'termine');
  assert.equal(sitadelBandId({ ETAT_DAU: 5 }, 'housing'), 'commence');
  assert.equal(sitadelBandId({ ETAT_DAU: 4 }, 'housing'), 'annule');
  assert.equal(sitadelBandId({ ETAT_DAU: 2 }, 'housing'), 'autorise');
  // An unpublished state is `autorise` — the file's own baseline — never a
  // fifth invented band.
  assert.equal(sitadelBandId({ ETAT_DAU: null }, 'housing'), 'autorise');
  assert.equal(SITADEL_BAND_IDS.length, 5);
  assert.equal(new Set(SITADEL_BANDS.map((band) => band.color)).size, 5, 'five bands, five colours');
});

test('the double encoding is repaired, and a clean string is left alone', () => {
  // The signature is five code points standing in for one Latin-1 letter:
  // "A" U+00C3 U+0082 U+00C2 U+00xx, where xx + 0x40 is the letter.
  const raw = byId(H44, '0441092500325').ADR_LIBVOIE_TER;
  assert.equal(raw, "DES BLA\u00c3\u0082\u00c2\u0089S D'OR");
  assert.equal(repairSitadelText(raw), "DES BL\u00c9S D'OR");
  // Genuinely clean accented text must survive verbatim — the naive
  // latin-1 -> utf-8 round trip does not manage this.
  assert.equal(repairSitadelText('Île-de-France'), 'Île-de-France');
  assert.equal(repairSitadelText('RÉSIDENCE DU PARC'), 'RÉSIDENCE DU PARC');
  assert.equal(repairSitadelText(null), '');
  // A tail outside the Latin-1 letter range is left as published rather than
  // guessed at: U+0000 + 0x40 is "@", which is not a letter.
  assert.equal(repairSitadelText("A\u00c3\u0082\u00c2\u0000X"), "A\u00c3\u0082\u00c2\u0000X");
});

test('the edition discovery floors, and a discovery older than the floor is refused', () => {
  assert.equal(newestMillesime(['2026-08', '2026-05']), '2026-08');
  assert.equal(newestMillesime(['2026-11']), '2026-11');
  assert.equal(newestMillesime(['2019-01']), SITADEL_MILLESIME_FLOOR, 'older than the floor is malformed');
  assert.equal(newestMillesime([null, '', 'nope', 42]), SITADEL_MILLESIME_FLOOR);
  assert.equal(newestMillesime([]), SITADEL_MILLESIME_FLOOR);
  const millesimes = DATASET.datafiles.flatMap((file) => file.millesimes.map((m) => m.millesime));
  assert.equal(newestMillesime(millesimes), '2026-08');

  // `latest` is a symlink and the 302 it answers with names the real edition.
  const location = 'https://cadastre.s3.rbx.io.cloud.ovh.net:443/etalab-cadastre/2026-06-01/geojson/communes/44/44109/cadastre-44109-parcelles.json.gz';
  assert.equal(newestCadastreEdition(location), '2026-06-01');
  assert.equal(newestCadastreEdition(location.replace('2026-06-01', '2026-09-01')), '2026-09-01');
  assert.equal(newestCadastreEdition(location.replace('2026-06-01', '2024-01-01')), CADASTRE_EDITION_FLOOR);
  assert.equal(newestCadastreEdition(null), CADASTRE_EDITION_FLOOR);
});

test('the datafile rids are discovered from DiDo own titles and fall back to the pins', () => {
  assert.equal(discoverSitadelRid(DATASET.datafiles, SITADEL_HOUSING_TITLE, 'PIN'), SITADEL_HOUSING_RID);
  assert.equal(discoverSitadelRid(DATASET.datafiles, SITADEL_DEMOLITION_TITLE, 'PIN'), SITADEL_DEMOLITION_RID);
  // The fallback is the pin, never the first datafile in the list — picking
  // the wrong one would silently draw non-residential permits as housing.
  assert.equal(discoverSitadelRid(DATASET.datafiles, 'jamais publié', 'PIN'), 'PIN');
  assert.equal(discoverSitadelRid(null, SITADEL_HOUSING_TITLE, 'PIN'), 'PIN');
  assert.equal(discoverSitadelRid([], SITADEL_HOUSING_TITLE, 'PIN'), 'PIN');
  // The two files this layer does NOT read must be in the listing and must not
  // be matched by either title fragment.
  const titles = DATASET.datafiles.map((file) => file.title);
  assert.ok(titles.some((title) => /locaux non résidentiels/.test(title)));
  assert.ok(titles.some((title) => /permis d.aménager/.test(title)));
  assert.ok(!SITADEL_HOUSING_TITLE.split(' ').every((word) => 'Liste des permis d’aménager'.includes(word)));
});

test('the request URLs carry the filter and the projection, and only the columns drawn', () => {
  const url = new URL(sitadelDatafileUrl(SITADEL_HOUSING_RID, '44109', SITADEL_HOUSING_COLUMNS));
  assert.equal(url.host, 'data.statistiques.developpement-durable.gouv.fr');
  assert.ok(url.pathname.endsWith(`/datafiles/${SITADEL_HOUSING_RID}/json`), 'the JSON endpoint, not the CSV');
  assert.equal(url.searchParams.get('COMM'), 'eq:44109');
  assert.equal(url.searchParams.get('columns').split(',').length, 23);
  assert.equal(SITADEL_HOUSING_COLUMNS.length, 23);
  assert.equal(SITADEL_DEMOLITION_COLUMNS.length, 15);
  // Every projected column is either read by the projection or keyed on.
  for (const column of ['COMM', 'NUM_DAU', 'ETAT_DAU', 'DATE_REELLE_DOC', 'DATE_REELLE_DAACT',
    'NB_LGT_TOT_CREES', 'SURF_HAB_CREEE', 'SUPERFICIE_TERRAIN']) {
    assert.ok(SITADEL_HOUSING_COLUMNS.includes(column), column);
  }
  // The demolition file has no DOC and no DAACT at all — asking for them would
  // be asking DiDo for a column that does not exist.
  assert.ok(!SITADEL_DEMOLITION_COLUMNS.includes('DATE_REELLE_DOC'));
  assert.ok(!SITADEL_DEMOLITION_COLUMNS.includes('DATE_REELLE_DAACT'));
  assert.ok(cadastreCommuneUrl('44109').endsWith('/communes/44/44109/cadastre-44109-parcelles.json.gz'));
  assert.ok(cadastreCommuneUrl('75105').includes('/communes/75/75105/'));
});

test('a parcel area and anchor come from its own geometry, never from a bounding box', () => {
  const feature = C44.features.find((f) => f.properties.id === '44109000IN0620');
  const parts = parcelParts(feature.geometry);
  assert.equal(parts.length, 1);
  const area = parcelAreaM2(parts);
  // The cadastre publishes its own `contenance`; the shoelace over the ring
  // has to agree with it, or the area line on the card is fiction.
  assert.ok(Math.abs(area - feature.properties.contenance) / feature.properties.contenance < 0.02,
    `computed ${area} m2 against published ${feature.properties.contenance} m2`);
  const anchor = parcelAnchor(parts);
  assert.ok(anchor[0] > -1.7 && anchor[0] < -1.4, 'longitude inside Nantes');
  assert.ok(anchor[1] > 47.1 && anchor[1] < 47.3, 'latitude inside Nantes');
  assert.equal(parcelAnchor([]), null);
  assert.equal(parcelAreaM2([]), null);
  assert.deepEqual(parcelParts(null), []);
  assert.deepEqual(parcelParts({ type: 'Point', coordinates: [0, 0] }), []);
});

test('the dot size is bounded at both ends and never invents a dwelling', () => {
  assert.equal(sitadelPointSize(null, 5, 22), 5);
  assert.equal(sitadelPointSize(0, 5, 22), 5);
  assert.equal(sitadelPointSize(-3, 5, 22), 5);
  assert.equal(sitadelPointSize('', 5, 22), 5);
  assert.equal(sitadelPointSize(SITADEL_SIZE_CEILING_LGT, 5, 22), 22);
  assert.equal(sitadelPointSize(553, 5, 22), 22, 'the ceiling holds above it');
  // Square-rooted, so a 200-dwelling block is four times the AREA of a 50.
  const fifty = sitadelPointSize(50, 0, 1);
  assert.ok(Math.abs(fifty - 0.5) < 1e-9);
  assert.ok(sitadelPointSize(1, 5, 22) > 5);
});

test('the whole projection counts every row exactly once and draws only what it placed', () => {
  const { index, parcels } = indexCadastreParcels([C44]);
  const pack = projectSitadelCommune({
    housing: H44,
    demolition: D44,
    index,
    commune: COMMUNE44,
    millesime: '2026-08',
    cadastreEdition: '2026-06-01',
    cadastreCommunes: ['44109'],
    cadastreParcels: parcels,
  });
  const s = pack.summary;
  assert.equal(s.permits, 14);
  assert.equal(s.housing, 10);
  assert.equal(s.demolition, 4);
  assert.equal(s.placed + s.ambiguous + s.missing + s.noref, s.permits);
  assert.deepEqual(
    { placed: s.placed, ambiguous: s.ambiguous, missing: s.missing, noref: s.noref },
    { placed: 9, ambiguous: 0, missing: 3, noref: 2 },
  );
  assert.equal(pack.permits.length, s.placed, 'exactly the placed permits are emitted');
  assert.equal(s.drawn, 9);
  assert.equal(s.parcels, pack.parcels.length);
  assert.equal(s.multiParcel, 4);
  assert.equal(s.mojibake, 1);
  assert.equal(pack.commune, 'Nantes');
  assert.equal(pack.dept, '44');
  assert.equal(pack.millesime, '2026-08');
  assert.equal(pack.cadastreEdition, '2026-06-01');

  // Newest authorisation first — the drawing depends on it to decide which
  // permit colours a shared parcel.
  const dates = pack.permits.map((permit) => permit.da);
  assert.deepEqual(dates, [...dates].sort((a, b) => String(b).localeCompare(String(a))));

  // Every emitted permit points at a real parcel, and every parcel has a real
  // coordinate. Nothing is at a centroid, a zero or a NaN.
  for (const permit of pack.permits) {
    assert.ok(permit.px.length > 0);
    for (const slot of permit.px) {
      const parcel = pack.parcels[slot];
      assert.ok(parcel, `slot ${slot} must exist`);
      assert.ok(Number.isFinite(parcel.p[0]) && Number.isFinite(parcel.p[1]));
      assert.notEqual(parcel.p[0], 0);
      assert.equal(parcel.k.slice(0, 5), '44109');
    }
  }
  // Six decimals and no more: 0.11 m, and a float tail would double the payload.
  for (const parcel of pack.parcels) {
    assert.ok((String(parcel.p[0]).split('.')[1] || '').length <= 6);
    assert.ok((String(parcel.p[1]).split('.')[1] || '').length <= 6);
  }
  // The band tally is the drawn permits, not the queried rows.
  assert.equal(s.bands.reduce((sum, band) => sum + band.count, 0), s.placed);
  assert.equal(s.bands.find((band) => band.id === 'demolition').count, 2);
});

test('a year tally never counts a permit it did not place', () => {
  const { index } = indexCadastreParcels([C44]);
  const pack = projectSitadelCommune({ housing: H44, demolition: D44, index, commune: COMMUNE44 });
  for (const tally of pack.years) {
    assert.ok(tally.placed <= tally.permits, `${tally.year}: ${tally.placed} placed of ${tally.permits}`);
    assert.ok(tally.placed >= 0);
  }
  assert.equal(pack.years.reduce((sum, y) => sum + y.permits, 0), 14);
  assert.equal(pack.years.reduce((sum, y) => sum + y.placed, 0), 9);
  assert.equal(sitadelYear({ DATE_REELLE_AUTORISATION: '2013-01-15' }), '2013');
  assert.equal(sitadelYear({ DATE_REELLE_AUTORISATION: '' }), null);
  assert.equal(sitadelYear({}), null);
});

test('the Paris pack joins through the arrondissements Sitadel never names', () => {
  const codes = communeCadastreCodes('75056');
  const { index, parcels } = indexCadastreParcels([C75]);
  const pack = projectSitadelCommune({
    housing: H75,
    index,
    commune: { code: '75056', nom: 'Paris' },
    cadastreCommunes: codes,
    cadastreParcels: parcels,
  });
  assert.equal(pack.summary.permits, 4);
  assert.equal(pack.summary.placed, 3);
  assert.equal(pack.summary.noref, 1);
  const keys = pack.parcels.map((parcel) => parcel.k).sort();
  assert.deepEqual(keys, ['75105AD0044', '75105AD0045', '75105AE0007', '75116FP0027', '75120DM0081']);
  // Not one of them is keyed on 75056, which is the only code Sitadel published.
  assert.ok(!keys.some((key) => key.startsWith('75056')));
  const rivp = pack.permits.find((permit) => permit.i === '07510523V0019');
  assert.equal(rivp.lgt, 583);
  assert.equal(rivp.px.length, 3, 'three references across two sections');
});

test('the card names the position as computed, and grades the area check', () => {
  const { index } = indexCadastreParcels([C44]);
  const pack = projectSitadelCommune({ housing: H44, demolition: D44, index, commune: COMMUNE44 });

  const discordant = pack.permits.find((permit) => permit.i === '0441091200686');
  const card = buildSitadelPermitCard(discordant, pack.parcels).map(norm);
  assert.ok(card.some((line) => line.includes('DISCORDANT')), card.join(' | '));
  assert.ok(discordant.ag > SITADEL_AREA_AGREEMENT, `ratio ${discordant.ag}`);
  // The last line is never optional: this is the only layer on the globe whose
  // every coordinate was computed rather than published.
  assert.ok(card.some((line) => line.includes('Position calculée par jointure cadastrale')));
  assert.ok(card.some((line) => line.includes('Sitadel ne publie aucune coordonnée')));

  const concordant = pack.permits.find((permit) => permit.i === '0441091200392');
  const good = buildSitadelPermitCard(concordant, pack.parcels).map(norm);
  assert.ok(good.some((line) => line.includes('concordant')));
  assert.ok(good[0].includes('27 logements'));
  assert.ok(good.some((line) => line.includes('2 parcelles')));
  assert.ok(good.some((line) => line.includes('2 logements démolis')));

  // A demolition whose terrain is the string "0" says the surface is not
  // published, rather than printing a 0 m2 plot.
  const demolition = pack.permits.find((permit) => permit.i === '04410921A0030');
  const demCard = buildSitadelPermitCard(demolition, pack.parcels).map(norm);
  assert.ok(demCard.some((line) => line.includes('Superficie du terrain non publiée')), demCard.join(' | '));
  assert.equal(demCard[0], 'Permis de démolir');

  // The three real dates, and only the distinctions the file actually makes.
  const started = pack.permits.find((permit) => permit.i === '0441091200506');
  const startedCard = buildSitadelPermitCard(started, pack.parcels).map(norm);
  assert.ok(startedCard.some((line) => /Chantier ouvert le 18\/07\/2016 . achèvement non déclaré/.test(line)),
    startedCard.join(' | '));
  const finishedNoStart = pack.permits.find((permit) => permit.i === '0441092600876');
  const fnsCard = buildSitadelPermitCard(finishedNoStart, pack.parcels).map(norm);
  assert.ok(fnsCard.some((line) => /aucune ouverture de chantier déclarée/.test(line)));
  // A cancelled permit still says so.
  const cancelled = pack.permits.find((permit) => permit.i === '0441091200600');
  assert.ok(buildSitadelPermitCard(cancelled, pack.parcels)[1].startsWith('Annulé'));
});

test('the unplaced sentence keeps the three failures apart', () => {
  const lines = sitadelUnplacedLines({ ambiguous: 4007, missing: 266, noref: 59 }).map(norm);
  assert.equal(lines.length, 3);
  assert.ok(lines[0].includes('préfixes de section'), lines[0]);
  assert.ok(lines[1].includes('divisée ou renumérotée'), lines[1]);
  assert.ok(lines[2].includes('sans aucune référence cadastrale'), lines[2]);
  assert.deepEqual(sitadelUnplacedLines({ ambiguous: 0, missing: 0, noref: 0 }), []);
  assert.deepEqual(sitadelUnplacedLines(null), []);
  // Singular and plural are both written, because "1 references ambigues" on a
  // rural commune is how a reader stops believing the rest of the card.
  const one = sitadelUnplacedLines({ ambiguous: 1, missing: 0, noref: 0 }).map(norm);
  assert.ok(one[0].startsWith('1 référence ambiguë'), one[0]);
});

test('the display formatters answer in French, and answer null with null', () => {
  assert.equal(norm(formatSurfaceM2(816)), '816 m²');
  assert.equal(norm(formatSurfaceM2(132633)), '13,26 ha');
  assert.equal(formatSurfaceM2(null), null);
  assert.equal(formatSurfaceM2(''), null);
  assert.equal(formatSitadelDate('2024-10-04'), '04/10/2024');
  assert.equal(formatSitadelDate(null), null);
  assert.equal(formatSitadelDate('pas une date'), null);
  assert.deepEqual(SITADEL_OUTCOMES, ['placed', 'ambiguous', 'missing', 'noref']);
});
