// src/data/adsFeed.test.mjs
// Pins the UPSTREAM shape of BOTH French permit registers against real captured
// rows. Every trap guarded here produces a plausible RESULT when handled
// wrongly rather than an exception: a commune code that silently returns an
// empty file, four datafiles that disagree about their own column names, a
// null coordinate spelled as the origin, and a dossier number that is the same
// number in four different spellings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ADS_DEFAULT_MONTHS,
  ADS_MAX_MONTHS,
  ADS_MAX_PERMITS,
  LOCAL_ADS_PORTALS,
  SITADEL_FILES,
  SITADEL_STATES,
  adsSince,
  applyGeocoding,
  buildGeocodeCsv,
  buildLocalAdsUrl,
  buildSitadelUrl,
  dossierKey,
  foldSitadelFamilies,
  foldToSitadelCommune,
  formatDossier,
  localState,
  mergeRegisters,
  normaliseLocalRow,
  normaliseSitadelRow,
  parseGeocodedCsv,
  portalsForCommune,
  seriesOfKind,
  projectAdsPermits,
} from './adsFeed.js';

const SITADEL = JSON.parse(readFileSync(new URL('./fixtures/sitadel-12202-sample.json', import.meta.url), 'utf8'));
const PORTALS = JSON.parse(readFileSync(new URL('./fixtures/ads-portals-sample.json', import.meta.url), 'utf8'));
const BAN_CSV = readFileSync(new URL('./fixtures/ban-geocode-12202-sample.csv', import.meta.url), 'utf8');

const HOUSING_FILE = SITADEL_FILES.find((file) => file.key === 'logements');
const DEMOLITION_FILE = SITADEL_FILES.find((file) => file.key === 'demolir');
const PARIS = LOCAL_ADS_PORTALS.find((portal) => portal.key === 'paris');
const BORDEAUX = LOCAL_ADS_PORTALS.find((portal) => portal.key === 'bordeaux');
const NANTES = LOCAL_ADS_PORTALS.find((portal) => portal.key === 'nantes');

test('Sitadel keys Paris, Lyon and Marseille at COMMUNE level — the inverse of DVF', () => {
  // Measured against the live API: `COMM=eq:75113` answers "Le fichier est
  // vide", `75056` answers the whole of Paris. Getting this backwards yields
  // an EMPTY layer over the three densest cities in France, with no error.
  assert.equal(foldToSitadelCommune('75113'), '75056');
  assert.equal(foldToSitadelCommune('75101'), '75056');
  assert.equal(foldToSitadelCommune('75120'), '75056');
  assert.equal(foldToSitadelCommune('13201'), '13055');
  assert.equal(foldToSitadelCommune('13216'), '13055');
  assert.equal(foldToSitadelCommune('69381'), '69123');
  assert.equal(foldToSitadelCommune('69389'), '69123');

  // Everything else passes through, including the two shapes a naive
  // arrondissement test breaks on.
  assert.equal(foldToSitadelCommune('12202'), '12202');
  assert.equal(foldToSitadelCommune('2A004'), '2A004');
  assert.equal(foldToSitadelCommune('2b033'), '2B033');
  assert.equal(foldToSitadelCommune('97213'), '97213');
  // 75121 and 69390 are outside the arrondissement ranges and must NOT fold.
  assert.equal(foldToSitadelCommune('69390'), '69390');

  assert.equal(foldToSitadelCommune(''), null);
  assert.equal(foldToSitadelCommune('750'), null);
  assert.equal(foldToSitadelCommune(null), null);
});

test('the scan window snaps to the first of the month so the commune cache can hit', () => {
  const now = Date.UTC(2026, 8, 2); // 2026-09-02
  assert.equal(adsSince(36, now), '2023-09-01');
  assert.equal(adsSince(1, now), '2026-08-01');
  // A window computed to the DAY would mint a new cache key every midnight and
  // re-download four national files for a commune already on disk.
  assert.equal(adsSince(36, Date.UTC(2026, 8, 27)), adsSince(36, now));
  // Clamped at both ends; a non-number falls back to the default.
  assert.equal(adsSince(0, now), adsSince(1, now));
  assert.equal(adsSince(9999, now), adsSince(ADS_MAX_MONTHS, now));
  assert.equal(adsSince(NaN, now), adsSince(ADS_DEFAULT_MONTHS, now));
});

test('the four datafiles do not share their key column names', () => {
  // Reading all four through one column list is an HTTP 400 per file, which
  // becomes an empty family, which becomes a city with no demolitions.
  assert.equal(HOUSING_FILE.numberColumn, 'NUM_DAU');
  assert.equal(HOUSING_FILE.stateColumn, 'ETAT_DAU');
  assert.equal(HOUSING_FILE.typeColumn, 'TYPE_DAU');
  assert.equal(DEMOLITION_FILE.numberColumn, 'NUM_PD');
  assert.equal(DEMOLITION_FILE.stateColumn, 'ETAT_PD');
  assert.equal(DEMOLITION_FILE.typeColumn, null);

  // The demolition file has NO site-progress columns at all — asking for them
  // is what makes DiDo refuse the whole query.
  assert.ok(!DEMOLITION_FILE.columns.includes('DATE_REELLE_DOC'));
  assert.ok(!DEMOLITION_FILE.columns.includes('DATE_REELLE_DAACT'));
  assert.ok(HOUSING_FILE.columns.includes('DATE_REELLE_DAACT'));

  // Every file must name the columns it says it reads, or the projection
  // silently returns nulls for a field the API was never asked for.
  for (const file of SITADEL_FILES) {
    assert.ok(file.columns.includes(file.numberColumn), `${file.key} omits ${file.numberColumn}`);
    assert.ok(file.columns.includes(file.stateColumn), `${file.key} omits ${file.stateColumn}`);
    if (file.typeColumn) assert.ok(file.columns.includes(file.typeColumn));
  }
});

test('the DiDo query carries the operator prefix its grammar demands', () => {
  const url = new URL(buildSitadelUrl(HOUSING_FILE, { communeCode: '75113', since: '2023-09-01' }));
  // A bare `COMM=75056` is rejected as "La chaîne 75056 dans l'url n'est pas
  // valide" — the grammar is `field=<op>:<value>`.
  assert.equal(url.searchParams.get('COMM'), 'eq:75056');
  assert.equal(url.searchParams.get('DATE_REELLE_AUTORISATION'), 'gte:2023-09-01');
  assert.equal(url.searchParams.get('columns'), HOUSING_FILE.columns.join(','));
  assert.ok(url.pathname.endsWith(`/${HOUSING_FILE.rid}/json`));

  assert.throws(() => buildSitadelUrl(HOUSING_FILE, { communeCode: 'nope', since: '2023-09-01' }),
    /invalid commune code/);
});

test('a portal is queried by distance where it has geometry and by commune where it has none', () => {
  const paris = new URL(buildLocalAdsUrl(PARIS, {
    lon: 2.3522, lat: 48.8566, radiusM: 400, since: '2026-01-01',
  }));
  assert.match(paris.searchParams.get('where'),
    /^distance\(geo_point_2d, geom'POINT\(2\.3522 48\.8566\)', 400m\) and date_depot >= date'2026-01-01'$/);
  assert.equal(paris.searchParams.get('limit'), '-1');

  // Nantes publishes an address string and NOTHING else, so a distance filter
  // has no column to stand on. Its gate is the commune — and that column is an
  // integer, so the value must not be quoted.
  const nantes = new URL(buildLocalAdsUrl(NANTES, { communeCode: '44109', since: '2026-01-01' }));
  assert.equal(nantes.searchParams.get('where'),
    "code_insee_commune = 44109 and date_de_depot >= date'2026-01-01'");
  assert.throws(() => buildLocalAdsUrl(NANTES, { since: '2026-01-01' }), /needs a commune code/);
});

test('the portal gate accepts either level of the Paris code', () => {
  // The BAN answers 75113 and Sitadel wants 75056; whichever one reaches the
  // gate, the Paris portal must still be asked.
  assert.deepEqual(portalsForCommune('75113').map((portal) => portal.key), ['paris']);
  assert.deepEqual(portalsForCommune('75056').map((portal) => portal.key), ['paris']);
  assert.deepEqual(portalsForCommune('33063').map((portal) => portal.key), ['bordeaux']);
  assert.deepEqual(portalsForCommune('44109').map((portal) => portal.key), ['nantes']);
  // A commune with no local portal — which is 34 892 of them.
  assert.deepEqual(portalsForCommune('12202'), []);
  assert.deepEqual(portalsForCommune('bogus'), []);
});

test('one dossier number, four spellings, one key', () => {
  // Sitadel writes it closed up; the portals space it and prefix the family.
  // These are the same Paris dossier and must merge rather than draw twice.
  assert.equal(dossierKey('07510826V0143'), '07510826V0143');
  assert.equal(dossierKey('DP 075 108 26 V0143'), '07510826V0143');
  assert.equal(dossierKey('CU 033 519 17 Z0225'), '03351917Z0225');
  assert.equal(dossierKey('DP0441662600106'), '04416626 00106'.replace(' ', ''));

  // A MODIFICATIF is a separately filed decision on the same project, and
  // merging it into its parent would replace "modified in June" with the
  // original permit's dates.
  assert.notEqual(dossierKey('PC 075 104 24 V0031 M01'), dossierKey('PC 075 104 24 V0031'));

  assert.equal(dossierKey(''), null);
  assert.equal(dossierKey(null), null);
});

test('a Sitadel number is re-spaced the way the panneau on the fence prints it', () => {
  assert.equal(formatDossier('DP', '04410925A0227'), 'DP 044 109 25 A0227');
  assert.equal(formatDossier('PD', '0122022600005'), 'PD 012 202 26 00005');
  // Re-spacing must never change identity.
  assert.equal(dossierKey(formatDossier('DP', '04410925A0227')), dossierKey('04410925A0227'));
  // Anything that does not match the grammar is returned untouched rather than
  // sliced into a shape it does not have.
  assert.equal(formatDossier('PC', 'XYZ'), 'XYZ');
  assert.equal(formatDossier('PC', ''), '');
});

test('the ETAT ladder is site progress, and the fixture cross-tabulates that way', () => {
  // From the SDES variable dictionary: 2 Autorisé, 4 Annulé, 5 Commencé,
  // 6 Terminé. There is no 1 and no 3 in the open files.
  assert.deepEqual(Object.keys(SITADEL_STATES).sort(), ['2', '4', '5', '6']);

  const rows = SITADEL.logements.map((row) => normaliseSitadelRow(HOUSING_FILE, row));
  assert.equal(rows.length, 6);
  assert.deepEqual([...new Set(rows.map((row) => row.state))].sort(),
    ['annule', 'autorise', 'commence', 'termine']);

  for (const row of rows) {
    // Every dated fact must agree with the state the register published.
    if (row.state === 'termine') assert.ok(row.completedOn, `${row.dossier} terminé without a DAACT`);
    if (row.state === 'commence') {
      assert.ok(row.startedOn, `${row.dossier} commencé without a DOC`);
      assert.equal(row.completedOn, null);
    }
    if (row.state === 'autorise') {
      assert.equal(row.startedOn, null);
      assert.equal(row.completedOn, null);
    }
    // Not one row in any of the four files carries a coordinate.
    assert.equal(row.lon, null);
    assert.equal(row.lat, null);
    assert.equal(row.source, 'sitadel');
  }
});

test('the demolition file projects through the same shape despite its own column names', () => {
  const rows = SITADEL.demolir.map((row) => normaliseSitadelRow(DEMOLITION_FILE, row));
  assert.ok(rows.length >= 1);
  for (const row of rows) {
    assert.equal(row.kind, 'PD');
    assert.equal(row.kindLabel, 'Permis de démolir');
    assert.ok(row.dossier.startsWith('PD '));
    assert.ok(row.key);
    // The file has no site-progress columns; the projection must not invent
    // them from `undefined`.
    assert.equal(row.startedOn, null);
    assert.equal(row.completedOn, null);
  }
});

test('up to three cadastral parcels ride along, and a half-filled pair is dropped', () => {
  const rows = SITADEL.logements.map((row) => normaliseSitadelRow(HOUSING_FILE, row));
  for (const row of rows) {
    for (const parcel of row.parcels) assert.match(parcel, /^\S+ \S+$/);
  }
  // A section with no number (or the reverse) is not a parcel reference.
  const half = normaliseSitadelRow(HOUSING_FILE, {
    NUM_DAU: '01220226A0001', ETAT_DAU: 2, TYPE_DAU: 'PC', COMM: '12202',
    SEC_CADASTRE1: 'AV', NUM_CADASTRE1: null,
    SEC_CADASTRE2: null, NUM_CADASTRE2: '12',
    SEC_CADASTRE3: 'BX', NUM_CADASTRE3: '7',
  });
  assert.deepEqual(half.parcels, ['BX 7']);
});

test('Paris spells "no coordinate" as the origin, not as a null', () => {
  // Measured 2026-09-02: `x=0 or y=0` returns 19 rows and `geo_point_2d is
  // null` returns none. The naive read puts nineteen Paris permits in the
  // Gulf of Guinea.
  const zero = PORTALS.paris.find((row) => row.x === 0 || row.y === 0);
  assert.ok(zero, 'fixture must carry the origin row');
  const projected = normaliseLocalRow(PARIS, zero);
  assert.equal(projected.lon, null);
  assert.equal(projected.lat, null);
  assert.equal(projected.precision, null);

  const placed = PORTALS.paris.filter((row) => row.x !== 0 && row.y !== 0)
    .map((row) => normaliseLocalRow(PARIS, row));
  assert.ok(placed.length >= 3);
  for (const permit of placed) {
    assert.equal(permit.precision, 'published');
    assert.ok(Number.isFinite(permit.lon) && Number.isFinite(permit.lat));
    assert.equal(permit.source, 'paris');
  }
  assert.ok(placed.some((permit) => permit.state === 'instruction'));
  assert.ok(placed.some((permit) => permit.state === 'refuse'));
});

test('Bordeaux publishes no decision column, so its rows say what they provably are', () => {
  const rows = PORTALS.bordeaux.map((row) => normaliseLocalRow(BORDEAUX, row));
  for (const permit of rows) {
    // Not null — a null would be dropped by the card and painted as "state
    // unknown" by the legend, when the file does state that it was filed.
    assert.equal(permit.state, 'depose');
    assert.equal(permit.stateLabel, 'Déposé');
    assert.ok(permit.depositedOn);
    assert.equal(permit.precision, 'published');
  }
  // The three families this portal spells in French all resolve.
  assert.deepEqual(rows.map((permit) => permit.kind), ['PC', 'CU', 'PD']);
  // `refcad` is an ARRAY here, unlike everywhere else.
  assert.ok(Array.isArray(rows[0].parcels));
  assert.ok(rows[0].parcels.length >= 1);
});

test('Nantes hides markup in a plain-text field and an integer in a commune code', () => {
  const rows = PORTALS.nantes.map((row) => normaliseLocalRow(NANTES, row));
  for (const permit of rows) {
    // `<br/>` would show through as literal characters on the card.
    assert.doesNotMatch(permit.purpose ?? '', /<[^>]+>/);
    // `code_insee_commune` is an int; a 01 département would lose its zero.
    assert.match(permit.communeCode, /^\d{5}$/);
    // No coordinate of any kind — these rows are placed by the BAN.
    assert.equal(permit.lon, null);
    assert.equal(permit.precision, null);
  }
  const html = PORTALS.nantes.find((row) => /<br/i.test(row.details_du_projet || ''));
  assert.ok(html, 'fixture must carry a markup row');
  assert.match(normaliseLocalRow(NANTES, html).purpose, / · /);

  // The one value that is the whole point of asking a portal at all.
  assert.ok(rows.some((permit) => permit.state === 'instruction'));
});

test('the free-text state vocabularies of three portals fold onto one ladder', () => {
  assert.equal(localState("En cours d'instruction").state, 'instruction');
  assert.equal(localState('Dossier déposé (en cours d’instruction)').state, 'instruction');
  assert.equal(localState('Refusé').state, 'refuse');
  assert.equal(localState('Accordé').state, 'accorde');
  assert.equal(localState('Autorisé').state, 'accorde');
  assert.equal(localState('Dossier retiré').state, 'annule');
  // A wording none of the three has used yet is kept verbatim rather than
  // guessed at — the label is what a reader sees.
  assert.deepEqual(localState('Sursis à statuer'), { state: 'depose', label: 'Sursis à statuer' });
  assert.deepEqual(localState(null), { state: null, label: null });
});

test('the BAN answer parses with its quoted commas intact', () => {
  const rows = parseGeocodedCsv(BAN_CSV);
  assert.equal(rows.length, 9);
  // `result_context` is quoted and contains commas; a naive split(',') shifts
  // every column after it and lands score values on the map.
  const quoted = rows.find((row) => row.result_context?.includes(','));
  assert.ok(quoted, 'fixture must carry a quoted field');
  assert.equal(quoted.result_citycode, '12202');
  assert.match(quoted.ref, /^sitadel:/);
  assert.equal(parseGeocodedCsv('').length, 0);
  assert.equal(parseGeocodedCsv(null).length, 0);
});

test('a row the BAN cannot place is dropped, never moved to the commune centroid', () => {
  const permits = [
    ...SITADEL.logements.map((row) => normaliseSitadelRow(HOUSING_FILE, row)),
    ...SITADEL.demolir.map((row) => normaliseSitadelRow(DEMOLITION_FILE, row)),
  ];
  const { permits: placed, geocoded, unplaced } = applyGeocoding(permits, BAN_CSV);
  // Measured on this fixture: 3 house numbers, 4 streets, 2 not found.
  assert.equal(geocoded, 7);
  assert.equal(unplaced, 2);
  assert.equal(placed.length, 7);
  for (const permit of placed) {
    assert.ok(['housenumber', 'street'].includes(permit.precision));
    assert.ok(Number.isFinite(permit.lon) && Number.isFinite(permit.lat));
    assert.ok(permit.geocodeScore > 0);
  }

  // A commune-level hit is indistinguishable from a real position once it is
  // a dot, so it is refused even though the BAN answered.
  const [one] = permits;
  const municipal = applyGeocoding([one],
    `ref,longitude,latitude,result_score,result_type\n${one.id},2.57,44.35,0.4,municipality\n`);
  assert.equal(municipal.permits.length, 0);
  assert.equal(municipal.unplaced, 1);

  // An already-placed permit never reaches the geocoder at all.
  const published = { ...one, lon: 1, lat: 2, precision: 'published' };
  assert.equal(applyGeocoding([published], '').permits.length, 1);
});

test('only the rows that need a coordinate are posted to the geocoder', () => {
  const rows = SITADEL.logements.map((row) => normaliseSitadelRow(HOUSING_FILE, row));
  const csv = buildGeocodeCsv([...rows, { id: 'x', address: '1 rue A', lon: 1, lat: 2 }]);
  const parsed = parseGeocodedCsv(csv);
  // The already-placed row is absent, and so is any row with no address.
  assert.ok(parsed.every((row) => row.ref !== 'x'));
  assert.equal(parsed.length, rows.filter((row) => row.address).length);
  for (const row of parsed) assert.equal(row.citycode, '12202');
  assert.equal(buildGeocodeCsv([{ id: 'y', address: null, lon: null }]), null);

  // A field with a comma must survive the round trip rather than shifting the
  // citycode into the address column.
  const tricky = buildGeocodeCsv([{
    id: 'z', address: 'LIEU-DIT LA CROIX, BAS', postcode: '12000', communeCode: '12202', lon: null,
  }]);
  assert.deepEqual(parseGeocodedCsv(tricky)[0],
    { ref: 'z', adresse: 'LIEU-DIT LA CROIX, BAS', codepostal: '12000', citycode: '12202' });
});

test('one mixed operation listed in both PC files is one dossier, not two', () => {
  // TRAP 6, first half. Flats over a shop are filed ONCE and appear in both
  // permis-de-construire files, which share the `NUM_DAU` series: 151 such
  // pairs over Paris in a three-year window. Two entities claiming one id is a
  // render Cesium abandons MID-WAY — measured in the browser as twelve markers
  // drawn and the layer then frozen with no payload and no clickable cards.
  const base = { COMM: '75113', DATE_REELLE_AUTORISATION: '2024-06-01', TYPE_DAU: 'PC' };
  const rows = [
    normaliseSitadelRow(HOUSING_FILE, {
      ...base, NUM_DAU: '07511324V0005', ETAT_DAU: 5, DATE_REELLE_DOC: '2024-09-01',
      NB_LGT_TOT_CREES: 9, SURF_HAB_CREEE: 640, NATURE_PROJET_DECLAREE: 1,
      SEC_CADASTRE1: 'BX', NUM_CADASTRE1: '9',
    }),
    normaliseSitadelRow(SITADEL_FILES.find((f) => f.key === 'locaux'), {
      ...base, NUM_DAU: '07511324V0005', ETAT_DAU: 5,
      SURF_LOC_CREEE: 78, DESTINATION_PRINCIPALE: 4,
    }),
  ];
  const { permits, folded } = foldSitadelFamilies(rows);
  assert.equal(folded, 1);
  assert.equal(permits.length, 1);
  const [permit] = permits;
  // Whichever row knew a fact, the fold keeps it.
  assert.equal(permit.housing, 9);
  assert.equal(permit.surfaceCreatedM2, 640);
  assert.equal(permit.startedOn, '2024-09-01');
  assert.deepEqual(permit.parcels, ['BX 9']);
  assert.match(permit.purpose, /commerce/);
  assert.equal(new Set(permits.map((p) => p.id)).size, 1);
});

test('the number series are per family, so identical digits are NOT one dossier', () => {
  // TRAP 6, second half and the dangerous one. `NUM_DAU`, `NUM_PA` and
  // `NUM_PD` are three independent counters: measured over Paris since
  // 2023-09-01, **271 numbers collide across series at completely different
  // addresses**. Folding on the bare number would glue 271 unrelated Paris
  // dossiers together, each inheriting the other's address and dwellings.
  assert.equal(seriesOfKind('PC'), 'DAU');
  assert.equal(seriesOfKind('DP'), 'DAU');
  assert.equal(seriesOfKind('PA'), 'PA');
  assert.equal(seriesOfKind('PD'), 'PD');

  const base = { COMM: '75113', DATE_REELLE_AUTORISATION: '2024-06-01' };
  const rows = [
    normaliseSitadelRow(HOUSING_FILE, {
      ...base, NUM_DAU: '07511324V0005', TYPE_DAU: 'PC', ETAT_DAU: 2,
      NB_LGT_TOT_CREES: 9, ADR_LIBVOIE_TER: 'RUE DE TOLBIAC',
    }),
    normaliseSitadelRow(SITADEL_FILES.find((f) => f.key === 'amenager'), {
      ...base, NUM_PA: '07511324V0005', ETAT_PA: 2, ADR_LIBVOIE_TER: 'AVENUE DE FRANCE',
    }),
    normaliseSitadelRow(DEMOLITION_FILE, {
      ...base, NUM_PD: '07511324V0005', ETAT_PD: 2, ADR_LIBVOIE_TER: 'RUE DU CHEVALERET',
    }),
  ];
  const { permits, folded } = foldSitadelFamilies(rows);
  assert.equal(folded, 0);
  assert.equal(permits.length, 3);
  // Three distinct addresses survive, and no dossier inherits another's.
  assert.deepEqual(permits.map((p) => p.address).sort(),
    ['AVENUE DE FRANCE', 'RUE DE TOLBIAC', 'RUE DU CHEVALERET']);
  assert.equal(new Set(permits.map((p) => p.id)).size, 3);
  // …and the same must hold across the two registers: a portal PA must not
  // merge into a Sitadel PC of the same digits.
  const counter = normaliseLocalRow(BORDEAUX, {
    ident: 'PA 075 113 24 V0005', type_libelle: "Permis d'aménager",
    date_depot: '2024-01-05', geo_point_2d: { lon: 2.37, lat: 48.83 },
  });
  assert.notEqual(counter.key, permits.find((p) => p.kind === 'PC').key);
  assert.equal(counter.key, permits.find((p) => p.kind === 'PA').key);
});

test('a fold over distinct dossiers changes nothing', () => {
  const rows = SITADEL.logements.map((row) => normaliseSitadelRow(HOUSING_FILE, row));
  const { permits, folded } = foldSitadelFamilies(rows);
  assert.equal(folded, 0);
  assert.equal(permits.length, rows.length);
  assert.equal(new Set(permits.map((p) => p.id)).size, rows.length);
  for (const permit of permits) assert.deepEqual(permit.families, [permit.kind]);
});

test('the merge grafts what the State knows onto what the counter knows', () => {
  const state = normaliseSitadelRow(HOUSING_FILE, {
    NUM_DAU: '07510826V0143', TYPE_DAU: 'DP', ETAT_DAU: 6, COMM: '75056',
    DATE_REELLE_AUTORISATION: '2026-05-20', DATE_REELLE_DOC: '2026-06-01',
    DATE_REELLE_DAACT: '2026-07-15', NB_LGT_TOT_CREES: 12, SURF_HAB_CREEE: 940,
    ADR_LIBVOIE_TER: 'AVENUE DE FRIEDLAND', ADR_CODPOST_TER: '75008',
    SEC_CADASTRE1: 'AS', NUM_CADASTRE1: '2',
  });
  const counter = normaliseLocalRow(PARIS, {
    nom_dossier: 'DP 075 108 26 V0143', type_dossier: 'Déclarations préalables',
    etat: "En cours d'instruction", date_depot: '2026-03-06',
    adresse: '47 AVENUE DE FRIEDLAND 75008 PARIS', x: 648473, y: 6863973,
    geo_point_2d: { lon: 2.2975, lat: 48.8737 },
  });

  const { permits, merged } = mergeRegisters([state], [counter]);
  assert.equal(merged, 1);
  assert.equal(permits.length, 1);
  const [permit] = permits;
  // The counter WINS the live facts — it is days old, not weeks, and it is the
  // only one that can say a file is still open.
  assert.equal(permit.state, 'instruction');
  assert.equal(permit.depositedOn, '2026-03-06');
  assert.equal(permit.precision, 'published');
  // …and everything the State knows that the counter does not publish rides
  // along. This graft is the whole reason for merging rather than layering.
  assert.equal(permit.housing, 12);
  assert.equal(permit.surfaceCreatedM2, 940);
  assert.equal(permit.startedOn, '2026-06-01');
  assert.equal(permit.completedOn, '2026-07-15');
  assert.deepEqual(permit.parcels, ['AS 2']);
  assert.deepEqual(permit.sources, ['paris', 'sitadel']);
  // The chantier ladder is kept separately so it never overwrites the live
  // instruction state it disagrees with.
  assert.equal(permit.siteState, 'termine');
});

test('every merged, local-only and state-only permit carries its own provenance', () => {
  const state = normaliseSitadelRow(HOUSING_FILE, {
    NUM_DAU: '01220224A0021', TYPE_DAU: 'PC', ETAT_DAU: 2, COMM: '12202',
  });
  const counter = normaliseLocalRow(NANTES, {
    numero_de_dossier: 'DP0441092600001', type_dossier: 'Déclaration préalable',
    etat_dossier: "Dossier déposé (en cours d'instruction)", code_insee_commune: 44109,
  });
  const { permits, merged } = mergeRegisters([state], [counter]);
  assert.equal(merged, 0);
  assert.equal(permits.length, 2);
  // A permit that reached the client without `sources` read as sourceless
  // rather than as local-only. Every branch sets it.
  for (const permit of permits) assert.ok(Array.isArray(permit.sources) && permit.sources.length);
  assert.deepEqual(permits.find((p) => p.source === 'sitadel').sources, ['sitadel']);
  assert.deepEqual(permits.find((p) => p.source === 'nantes').sources, ['nantes']);
});

test('the projection cuts to the circle, excludes certificates, and says what it dropped', () => {
  const origin = { lon: 2.3522, lat: 48.8566 };
  const at = (metres, extra = {}) => ({
    id: `p${metres}${extra.kind ?? ''}`, kind: 'PC', state: 'autorise', housing: 1,
    lon: origin.lon, lat: origin.lat + metres / 111_320, ...extra,
  });
  const { permits, summary } = projectAdsPermits({
    permits: [
      at(50),
      at(900),
      at(60, { kind: 'CU', id: 'cu-near' }),
      at(70, { kind: 'DP', id: 'dp-near', state: 'instruction' }),
      { id: 'nowhere', kind: 'PC', lon: null, lat: null },
    ],
    origin,
    radiusM: 400,
  });
  // The far one is outside the circle, the CU is excluded on principle, and
  // the one with no coordinate was never drawable.
  assert.deepEqual(permits.map((permit) => permit.id), ['p50', 'dp-near']);
  assert.equal(summary.count, 2);
  assert.equal(summary.found, 2);
  assert.equal(summary.certificates, 1);
  assert.equal(summary.underInstruction, 1);
  assert.equal(summary.housing, 2);
  assert.deepEqual(summary.byKind, { PC: 1, DP: 1 });
  assert.equal(permits[0].distanceM, 50);
  assert.ok(permits[0].distanceM < permits[1].distanceM, 'nearest first');
});

test('a truncated scan says so rather than looking like a quiet block', () => {
  const origin = { lon: 2.3522, lat: 48.8566 };
  const many = Array.from({ length: ADS_MAX_PERMITS + 25 }, (_, i) => ({
    id: `p${i}`, kind: 'DP', state: 'autorise',
    lon: origin.lon, lat: origin.lat + (i + 1) / 111_320,
  }));
  const { summary } = projectAdsPermits({ permits: many, origin, radiusM: 800 });
  assert.equal(summary.count, ADS_MAX_PERMITS);
  assert.equal(summary.found, ADS_MAX_PERMITS + 25);
  assert.equal(summary.truncated, true);
});
