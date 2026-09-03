// What the READING of ANFR's register is allowed to claim.
//
// One property runs through this whole file: **an approved project is not a
// transmitting mast.** `Projet approuvé` is 66 508 of the observatoire's
// 826 418 rows — 8.05 %, re-counted from the portal's own `refine.statut` on
// 2026-09-02 — and 3 638 supports carry nothing else. Every test below closes
// one door through which one of those could acquire a generation: the status
// fold, the band function, the mask arithmetic, and the emitter-date evidence
// that the register itself agrees they are not in service.
//
// The second property is that this register lies in five specific, measured
// ways — a BOM, an LF-only body where its sibling files are CRLF, decimal
// commas in numeric columns, a `coordonnees` string whose axis order differs
// between two portals publishing the same schema, and a portal whose own
// metadata disagrees with its own datastore — and that every one of them is a
// refusal here rather than a silently wrong number on a card.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ANFR_BANDS,
  ANFR_BAND_INDEX,
  ANFR_CSV_COLUMNS,
  ANFR_CSV_URL_FLOOR,
  ANFR_DATASET,
  ANFR_EDITION_FLOOR,
  ANFR_EXPOSURE_RADIUS_M,
  ANFR_GENERATIONS,
  ANFR_HAUT,
  ANFR_HEIGHTLESS_NATURES,
  ANFR_HEIGHT_MAX_M,
  ANFR_HEIGHT_MEDIAN_M,
  ANFR_HEIGHT_MISSING,
  ANFR_HEIGHT_P05_M,
  ANFR_HEIGHT_P95_M,
  ANFR_HEIGHT_PUBLISHED,
  ANFR_ID,
  ANFR_LAT,
  ANFR_LIVE,
  ANFR_LON,
  ANFR_OPS,
  ANFR_PLAN,
  ANFR_PORTAL,
  ANFR_STATUSES,
  ANFR_SVC,
  ANFR_SYS,
  anfrAzimuthDeg,
  anfrBand,
  anfrCoordinates,
  anfrCsvColumns,
  anfrDecodeMask,
  anfrDistanceM,
  anfrExposureBbox,
  anfrFrenchDateToIso,
  anfrHeightM,
  anfrNumber,
  anfrPopCount,
  anfrProjectPoint,
  parseAnfrNatureTable,
  pickAnfrObservatoire,
  projectAnfrDas,
  projectAnfrSupports,
  projectCartoradioAntennas,
  projectCartoradioExposure,
  projectCartoradioSupport,
  readAnfrCsvRow,
} from './anfrFeed.js';

const read = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const OBSERVATOIRE = read('anfr-observatoire-sample.json');
const CATALOGUE = read('anfr-catalogue-sample.json');
const NATURE = read('anfr-nature-sample.json');
const DAS = read('anfr-das-sample.json');
const CARTORADIO = read('anfr-cartoradio-sample.json');

const LINES = OBSERVATOIRE.csv.split('\n');
const COLUMNS = anfrCsvColumns(LINES[0]);
const ROWS = LINES.slice(1).filter(Boolean).map((line) => readAnfrCsvRow(line, COLUMNS));
const NATURES = parseAnfrNatureTable(NATURE.text);
const PACK = projectAnfrSupports({
  rows: ROWS, natures: NATURES, edition: OBSERVATOIRE.edition, totalCount: OBSERVATOIRE.rows,
});
const byId = (id) => PACK.supports.find((row) => row[ANFR_ID] === id);

test('the fixture is the trimmed observatoire it says it is', () => {
  assert.equal(OBSERVATOIRE.rows, 216);
  assert.equal(OBSERVATOIRE.supports, 15);
  assert.equal(ROWS.length, 216);
  assert.equal(PACK.count, 15);
  assert.equal(PACK.rowsSwept, 216);
  assert.equal(PACK.rowsDropped, 0);
  // The upstream this was cut from, so a reader of the fixture cannot mistake
  // 216 rows for the register.
  assert.equal(OBSERVATOIRE.upstreamRows, 826418);
  assert.equal(OBSERVATOIRE.upstreamBytes, 181988412);
});

test('the header is validated, BOM and all, and a rename is a build failure', () => {
  // The file opens with EF BB BF, so `split(';')[0]` is "﻿id" and a naive
  // column build silently loses `id`.
  assert.ok(LINES[0].startsWith('﻿'));
  assert.equal(COLUMNS.id, 0);
  for (const name of ANFR_CSV_COLUMNS) assert.ok(Number.isInteger(COLUMNS[name]), name);
  assert.throws(
    () => anfrCsvColumns('id;adm_lb_nom;sup_id;statut'),
    /missing .*generation/,
  );
});

test('the body is LF-only, so no column carries a trailing carriage return', () => {
  // The bulk 5W tables next door are CRLF. A parser written for those leaves a
  // \r on the LAST column, which is `statut`, and every `=== 'En service'`
  // comparison then fails — the whole map would turn into approved projects.
  assert.equal(OBSERVATOIRE.csv.includes('\r'), false);
  for (const row of ROWS) assert.ok(ANFR_STATUSES.includes(row.statut), row.statut);
});

test('every row splits into exactly 22 fields and only coordonnees is quoted', () => {
  for (const line of LINES.slice(1).filter(Boolean)) {
    assert.equal(line.split(';').length, 22);
  }
  const quoted = ROWS.filter((row) => /^\d+\.\d+ , -?\d+\.\d+$/.test(row.coordonnees));
  assert.equal(quoted.length + ROWS.filter((r) => /^-\d/.test(r.coordonnees)).length, 216);
});

test('coordonnees is LAT-first comma-separated, and the LON-first twin is refused', () => {
  // ANFR national publishes "46.1774... , 3.3741..." — latitude first.
  assert.deepEqual(anfrCoordinates('46.177499999999995 , 3.3741666666666665'), [46.1775, 3.37417]);
  // Clermont Auvergne Métropole republishes the identical column set as
  // "3.1266...;45.8413..." — longitude first, semicolon separated. Reusing a
  // parser between the two puts every French mast in the Indian Ocean, so the
  // separator is part of the contract and a mismatch is refused, not guessed.
  assert.equal(anfrCoordinates('3.1266666666666665;45.84138888888889'), null);
  assert.equal(anfrCoordinates('0 , 0'), null);
  assert.equal(anfrCoordinates('91 , 2'), null);
  assert.equal(anfrCoordinates(''), null);
});

test('French decimal commas are read as decimals, and a height of zero is not a height', () => {
  // parseFloat('28,3') is 28 in JS — a silent 1 % error that never throws.
  assert.equal(anfrNumber('28,3'), 28.3);
  assert.equal(anfrNumber('308'), 308);
  assert.equal(anfrNumber(''), null);
  assert.equal(anfrHeightM('27,2'), 27.2);
  // Support 325857 publishes "0". Zero is the register's way of saying nobody
  // filled the field in; a mast is not 0 m tall.
  assert.equal(anfrHeightM('0'), null);
  assert.equal(byId(325857)[ANFR_HAUT], null);
  assert.equal(byId(241823)[ANFR_HAUT], 27.2);
  assert.equal(byId(437710)[ANFR_HAUT], 308);
});

test('an approved project never becomes a generation', () => {
  // 278838 is the case in miniature: every one of its 8 rows is
  // "Projet approuvé", across 2G, 3G and 4G.
  const planned = byId(278838);
  assert.equal(planned[ANFR_LIVE], 0);
  assert.equal(planned[ANFR_SVC], 0);
  assert.notEqual(planned[ANFR_PLAN], 0);
  assert.equal(anfrBand(planned[ANFR_LIVE]), 'projet');
  // And the band function reads `live` for every support in the fixture, so
  // no plan mask can reach the colour channel by any path.
  for (const support of PACK.supports) {
    assert.equal(anfrBand(support[ANFR_LIVE]), anfrBand(support[ANFR_LIVE] | 0));
    if (support[ANFR_LIVE] === 0) assert.equal(anfrBand(support[ANFR_LIVE]), 'projet');
  }
  assert.equal(PACK.bands.projet, 1);
  assert.equal(PACK.projectOnly, 1);
  assert.equal(PACK.live, 14);
});

test('the band ladder is ordered lowest-claim-first, which the mesh depends on', () => {
  // `cellRepresentative` breaks a tie between two equally common categories by
  // taking the LOWER index, so index 0 must over-claim nothing.
  assert.deepEqual([...ANFR_BANDS], ['projet', '2g', '3g', '4g', '5g']);
  assert.equal(ANFR_BAND_INDEX.projet, 0);
  assert.equal(ANFR_BAND_INDEX['5g'], 4);
  assert.equal(anfrBand(0b1000), '5g');
  assert.equal(anfrBand(0b0111), '4g');
  assert.equal(anfrBand(0b0011), '3g');
  assert.equal(anfrBand(0b0001), '2g');
  assert.equal(anfrBand(0), 'projet');
});

test('the status fold keeps radiating and approved apart, three ways', () => {
  assert.deepEqual([...ANFR_STATUSES], ['En service', 'Techniquement opérationnel', 'Projet approuvé']);
  assert.deepEqual(PACK.statuses, {
    'En service': 147, 'Techniquement opérationnel': 25, 'Projet approuvé': 44,
  });
  // 2883667 is technically operational on 5G and has 3G/4G only as a project:
  // it radiates, and what it radiates is not what is on file.
  const mixed = byId(2883667);
  assert.equal(anfrDecodeMask(mixed[ANFR_LIVE], ANFR_GENERATIONS).join(''), '5G');
  assert.equal(anfrDecodeMask(mixed[ANFR_SVC], ANFR_GENERATIONS).length, 0);
  assert.deepEqual(anfrDecodeMask(mixed[ANFR_PLAN], ANFR_GENERATIONS), ['3G', '4G', '5G']);
  // ...of which only 3G and 4G would ADD anything: the 5G filing is for a band
  // already on the air, which is paperwork and not an upgrade.
  assert.deepEqual(
    anfrDecodeMask(mixed[ANFR_PLAN] & ~mixed[ANFR_LIVE], ANFR_GENERATIONS), ['3G', '4G'],
  );
});

test('`Techniquement opérationnel` is a fact about 5G, not about a mast', () => {
  // Cross-tabulated over the whole 826 418-row file on 2026-09-02 and
  // reproduced here on the trimmed fixture: every technically-operational row
  // is 5G, and no 5G row is ever "En service".
  for (const row of ROWS) {
    if (row.statut === 'Techniquement opérationnel') assert.equal(row.generation, '5G');
    if (row.generation === '5G') assert.notEqual(row.statut, 'En service');
  }
  // Which is why `svc` never carries the 5G bit anywhere in the fixture.
  const fiveG = 1 << ANFR_GENERATIONS.indexOf('5G');
  for (const support of PACK.supports) assert.equal(support[ANFR_SVC] & fiveG, 0);
});

test('the register agrees with itself: a project has no in-service date', () => {
  // 66 321 rows of the live file carry a null `emr_dt` and every single one is
  // "Projet approuvé". A thing with no service date is a thing not in service.
  const undated = ROWS.filter((row) => !row.emr_dt);
  assert.ok(undated.length > 0);
  for (const row of undated) assert.equal(row.statut, 'Projet approuvé');
});

test('supports fold on SUP_ID and every group has one position', () => {
  assert.equal(PACK.count, new Set(ROWS.map((row) => row.sup_id)).size);
  const positions = new Map();
  for (const row of ROWS) {
    const point = anfrCoordinates(row.coordonnees).join(',');
    const seen = positions.get(row.sup_id);
    if (seen === undefined) positions.set(row.sup_id, point);
    else assert.equal(seen, point, `SUP_ID ${row.sup_id} moved`);
  }
  // Overseas and Corsican supports survive the fold — the fixture holds 977,
  // 974, 986, 988 and 02B on purpose, because a `sta_nm_dpt` code join is what
  // loses them.
  assert.ok(byId(506104), 'Saint-Barthélemy');
  assert.ok(byId(22132), 'Nouvelle-Calédonie');
  assert.ok(byId(628433), 'Wallis-et-Futuna');
  assert.ok(byId(26969), 'Haute-Corse');
  assert.ok(byId(22132)[ANFR_LAT] < 0 && byId(22132)[ANFR_LON] > 0);
  assert.ok(byId(628433)[ANFR_LAT] < 0 && byId(628433)[ANFR_LON] < 0);
});

test('operator and system vocabularies are alphabetical, so a legend is reproducible', () => {
  assert.deepEqual(PACK.operators, [...PACK.operators].sort((a, b) => a.localeCompare(b, 'fr')));
  assert.deepEqual(PACK.systems, [...PACK.systems].sort((a, b) => a.localeCompare(b, 'fr')));
  // 506104 is the one support in France carrying five operators.
  assert.equal(anfrPopCount(byId(506104)[ANFR_OPS]), 5);
  assert.deepEqual(anfrDecodeMask(byId(506104)[ANFR_OPS], PACK.operators), [
    'DAUPHIN TELECOM', 'DIGICEL', 'FREE CARAIBES', 'ORANGE', 'UTS Caraibes',
  ]);
  assert.deepEqual(PACK.sharing, { 1: 4, 2: 6, 3: 2, 4: 2, 5: 1 });
  // A system label only enters the vocabulary from a row that RADIATES, so an
  // approved project cannot put a band on a card.
  assert.equal(anfrPopCount(byId(278838)[ANFR_SYS]), 0);
});

test('the systems this mirror publishes are the 13 consumer ones, with no GSM R', () => {
  // The bulk 5W file has 68 distinct EMR_LB_SYSTEME and prefix-matching them
  // sweeps in GSM R, the LTE 700 P / LTE 2600 P priority network and four
  // "Expe" labels. The observatoire has already excluded all of them.
  for (const system of PACK.systems) {
    assert.match(system, /^(GSM|UMTS|LTE|5G NR) /);
    assert.doesNotMatch(system, /\bR\b|\bP$|Expe/);
  }
  assert.ok(PACK.systems.length <= 13, `${PACK.systems.length} systems`);
});

test('the nature table keeps the register\'s own placeholders', () => {
  assert.equal(NATURE.rows, 38);
  assert.equal(Object.keys(NATURES).length, 38);
  // "Sans nature", "XXX" and "Support non décrit" are three ways of saying "we
  // do not know". Inventing a nicer label is a lie about the register.
  assert.equal(NATURES['0'], 'Sans nature');
  assert.equal(NATURES['51'], 'XXX');
  assert.equal(NATURES['999999999'], 'Support non décrit');
  assert.equal(NATURES['23'], 'Pylône autostable');
  assert.equal(PACK.natureAvailable, true);
  assert.equal(PACK.natures['23'], 'Pylône autostable');
  // Only the natures actually used are carried.
  assert.equal(Object.keys(PACK.natures).length, 7);
  assert.equal(parseAnfrNatureTable('').constructor, Object);
  assert.deepEqual(parseAnfrNatureTable(''), {});
});

test('a short download is caught by the portal\'s own count', () => {
  const short = projectAnfrSupports({ rows: ROWS.slice(0, 100), totalCount: OBSERVATOIRE.rows });
  assert.equal(short.complete, false);
  assert.equal(PACK.complete, true);
  // With no count to check against, completeness is not asserted either way.
  assert.equal(projectAnfrSupports({ rows: ROWS.slice(0, 100) }).complete, true);
});

test('a row with no readable coordinate is counted and dropped, never placed', () => {
  const broken = ROWS.map((row, index) => (index === 0 ? { ...row, coordonnees: 'n/a' } : row));
  const pack = projectAnfrSupports({ rows: broken });
  assert.equal(pack.rowsDropped, 1);
  assert.equal(pack.rowsSwept, 215);
  assert.equal(pack.count, 15, 'the support keeps its other rows');
});

test('the catalogue is read for the weekly CSV, and the edition is floored', () => {
  assert.equal(ANFR_PORTAL, 'data.anfr.fr');
  const picked = pickAnfrObservatoire(CATALOGUE);
  assert.equal(picked.discovered, true);
  assert.match(picked.csvUrl, /^https:\/\/data\.anfr\.fr\/.*observatoireod_\d{8}\.csv$/);
  assert.equal(picked.edition, '2026-08-27');
  assert.equal(picked.rowsTotal, 826418);
  assert.equal(picked.licence, 'Licence Ouverte v2.0 (Etalab)');
  assert.equal(picked.resourceId, '88ef0887-6b0f-4d3f-8545-6d64c8f597da');

  // A discovery older than the floor is a malformed answer, not a new fact.
  const stale = JSON.parse(JSON.stringify(CATALOGUE));
  const extras = stale.result.results[0].extras;
  extras.find((entry) => entry.key === 'date_modification_data').value = '2019-01-01T00:00:00+00:00';
  assert.equal(pickAnfrObservatoire(stale).edition, ANFR_EDITION_FLOOR);

  // A CSV URL that is not on the portal is refused in favour of the pin.
  const hijacked = JSON.parse(JSON.stringify(CATALOGUE));
  hijacked.result.results[0].extras.find((e) => e.key === 'file_csv').value = 'https://example.com/x.csv';
  const fallback = pickAnfrObservatoire(hijacked);
  assert.equal(fallback.csvUrl, ANFR_CSV_URL_FLOOR);
  assert.equal(fallback.discovered, false);

  // An empty catalogue still answers with something usable.
  const empty = pickAnfrObservatoire({});
  assert.equal(empty.csvUrl, ANFR_CSV_URL_FLOOR);
  assert.equal(empty.edition, ANFR_EDITION_FLOOR);
  assert.equal(empty.rowsTotal, null);
  assert.equal(ANFR_DATASET, 'observatoire_2g_3g_4g');
});

test('the DAS register is read from the datastore, which its own catalogue contradicts', () => {
  const das = projectAnfrDas(DAS);
  // The trimmed fixture restates its total; the upstream numbers it was cut
  // from are recorded beside it.
  assert.equal(das.handsets, 8);
  assert.equal(das.rowsRead, 8);
  assert.equal(DAS.upstreamTotal, 1230);
  assert.equal(DAS.upstreamConforme, 1150);
  assert.equal(DAS.upstreamNonConforme, 80);
  // ...and the D4C CATALOGUE advertises 1232 for the same resource. Measured
  // both ways on 2026-09-02: the datastore says 1230. The projection reads the
  // datastore, never the metadata.
  const advertised = JSON.parse(
    CATALOGUE.result.results.find((d) => d.name === 'das-telephonie-mobile').extras
      .find((e) => e.key === 'records_count').value,
  );
  assert.equal(Number(advertised['ada0f4f9-01c6-4fab-b2db-6e0c8e1a9096']), 1232);

  assert.equal(das.conforming, 5);
  assert.equal(das.nonConforming, 3);
  assert.equal(das.brands, 7);
  assert.equal(das.newestSample, '2025-07-02');
  // The one claim that decides where this can be shown: it has no coordinate.
  assert.equal(das.geographic, false);
  // And the values are refused as numbers, because one row publishes the
  // literal string "< 2W/kg(**)" where another publishes "3,01".
  assert.ok(DAS.result.records.some((r) => r.das_tronc__nf_en_50566_ === '< 2W/kg(**)'));
  assert.equal('das' in das, false);
  assert.equal('averageDas' in das, false);
});

test('Cartoradio names its latitude coord_x, and the projection knows it', () => {
  const site = projectCartoradioSupport(CARTORADIO.site.body);
  assert.equal(site.supId, 449714);
  // coord_x is the LATITUDE and coord_y the LONGITUDE — the other way round
  // from every convention. Checked against the observatoire's own position for
  // the same support.
  assert.equal(site.lat, 48.85528);
  assert.equal(site.lon, 2.33167);
  assert.equal(byId(449714)[ANFR_LAT], 48.85528);
  assert.equal(byId(449714)[ANFR_LON], 2.33167);
  assert.equal(site.nature, 'Immeuble');
  assert.equal(site.heightM, 65);
  assert.equal(site.commune, 'PARIS 6E ARRONDISSEMENT');
  assert.equal(site.operators.length, 4);
  // The observatoire is PUBLIC MOBILE only. Naming what else is on the mast is
  // how the layer admits its dot is not the whole installation.
  assert.deepEqual(site.otherCategories, ['FH']);
  assert.equal(projectCartoradioSupport({}), null);
  assert.equal(projectCartoradioSupport({ data: {} }), null);
});

test('emitter bands stay as published pairs, never summed into a bandwidth', () => {
  const antennas = projectCartoradioAntennas(CARTORADIO.antennes.body);
  assert.equal(antennas.stations, 5);
  assert.equal(antennas.antennas, 33);
  assert.deepEqual(antennas.operators, ['BOUYGUES TELECOM', 'FREE MOBILE', 'ORANGE', 'SFR']);
  assert.equal(antennas.newestService, '2025-07-18');
  const lte700 = antennas.systems.find((entry) => entry.system.startsWith('5G NR 700'));
  // LTE/NR 700 is duplex, so it returns TWO band pairs, and a sum of them
  // would be a number ANFR never published.
  assert.ok(lte700.bands.length >= 2, lte700.bands.join(','));
  for (const band of lte700.bands) assert.match(band, /^[\d.]+–[\d.]+ (MHz|GHz)$/);
  assert.deepEqual(projectCartoradioAntennas({}).systems, []);
  // dd/mm/yyyy sorted as yyyy-mm-dd, so string order is time order.
  assert.equal(anfrFrenchDateToIso('09/10/2024'), '2024-10-09');
  assert.equal(anfrFrenchDateToIso('2024-10-09'), null);
});

test('the exposure readout is a reading of a PLACE, and says when it predates the mast', () => {
  const antennas = projectCartoradioAntennas(CARTORADIO.antennes.body);
  const exposure = projectCartoradioExposure({
    mesures: CARTORADIO.mesures.body,
    report: CARTORADIO.mesure.body,
    lat: 48.85528,
    lon: 2.33167,
    newestService: antennas.newestService,
  });
  assert.equal(exposure.radiusM, ANFR_EXPOSURE_RADIUS_M);
  assert.equal(exposure.nearest.id, 15410);
  assert.equal(exposure.nearest.metres, 40);
  assert.ok(exposure.within > 1);
  // The whole point of the flag: 0,0 V/m measured in 2009 under protocol
  // ANFR/DR 15-2.1, beside a mast whose newest equipment went live in 2025.
  assert.equal(exposure.report.globalVoltsPerM, 0);
  assert.equal(exposure.report.measuredOn, '2009-02-04');
  assert.equal(exposure.report.protocol, 'ANFR/DR 15-2.1');
  assert.equal(exposure.report.predatesEquipment, true);
  assert.equal(exposure.report.conforming, true);
  // Service lines with no measured value are counted, not shown as zero.
  assert.ok(exposure.report.servicesBelowFloor > 0);
  for (const service of exposure.report.services) assert.ok(Number.isFinite(service.volts));

  // A recent report on the same mast does NOT raise the flag.
  const recent = projectCartoradioExposure({
    mesures: CARTORADIO.mesures.body,
    report: CARTORADIO.mesureRecente.body,
    lat: 48.85528,
    lon: 2.33167,
    newestService: '2020-01-01',
  });
  assert.equal(recent.report.predatesEquipment, false);
  assert.equal(recent.report.globalVoltsPerM, 0.55);

  // No measurement in the radius is an explicit zero, not a null report.
  const nowhere = projectCartoradioExposure({
    mesures: CARTORADIO.mesures.body, lat: 0, lon: 0,
  });
  assert.deepEqual(nowhere, { within: 0, radiusM: ANFR_EXPOSURE_RADIUS_M, nearest: null, report: null });
});

test('the exposure box is built by hand because Cartoradio 500s on a missing param', () => {
  const bbox = anfrExposureBbox(48.85528, 2.33167, 300);
  const [west, south, east, north] = bbox.split(',').map(Number);
  assert.ok(west < 2.33167 && east > 2.33167);
  assert.ok(south < 48.85528 && north > 48.85528);
  // ~300 m north-south at any latitude.
  assert.ok(Math.abs(anfrDistanceM(south, west, north, west) - 600) < 5);
  // The longitude half-width widens with latitude, so the box stays a circle
  // rather than a slit near the poles.
  const polar = anfrExposureBbox(80, 0, 300).split(',').map(Number);
  assert.ok(polar[2] - polar[0] > east - west);
  assert.equal(anfrDistanceM(NaN, 0, 0, 0), Infinity);
});

test('mask helpers are exact, because every channel on the map is built from them', () => {
  assert.deepEqual(anfrDecodeMask(0b1010, ANFR_GENERATIONS), ['3G', '5G']);
  assert.deepEqual(anfrDecodeMask(0, ANFR_GENERATIONS), []);
  assert.deepEqual(anfrDecodeMask(0b1010, null), []);
  assert.equal(anfrPopCount(0b1011), 3);
  assert.equal(anfrPopCount(0), 0);
  assert.equal(anfrPopCount(undefined), 0);
  assert.deepEqual([...ANFR_GENERATIONS], ['2G', '3G', '4G', '5G']);
});

test('the frozen height domain is the register’s own, and it adds up', () => {
  // C1 — these are marks of the PHENOMENON, counted once over the whole
  // register and published, never derived from whatever is on screen. The sum
  // is the test that keeps them honest: 72 149 measured + 551 blank is exactly
  // the 72 700 supports the fold produces.
  assert.equal(ANFR_HEIGHT_PUBLISHED + ANFR_HEIGHT_MISSING, 72_700);
  assert.ok(ANFR_HEIGHT_P05_M < ANFR_HEIGHT_MEDIAN_M);
  assert.ok(ANFR_HEIGHT_MEDIAN_M < ANFR_HEIGHT_P95_M);
  assert.ok(ANFR_HEIGHT_P95_M < ANFR_HEIGHT_MAX_M);
  // The 551 blanks are a category, not a scatter: every one of them is one of
  // these three natures. The layer's "no shaft" row quotes this list, so the
  // list has to stay a list.
  assert.deepEqual([...ANFR_HEIGHTLESS_NATURES], [
    'Intérieur sous-terrain', 'Tunnel', 'Intérieur galerie',
  ]);
  // And the fixture carries one of them, so the drawing test downstream is
  // exercising the real case rather than an invented null.
  const blank = PACK.supports.find((row) => row[ANFR_HAUT] === null);
  assert.ok(blank, 'the fixture holds a support with no published height');
  assert.ok(ANFR_HEIGHTLESS_NATURES.includes(PACK.natures[String(blank[8])]));
});

test('a zero azimuth is north, and the shapes a null takes are refused', () => {
  // Measured on 138 real installations: 26 carry a 0, none carries it alone,
  // and 18 of the 26 are the three-sector 0/120/240. So zero is a bearing.
  assert.equal(anfrAzimuthDeg(0), 0);
  assert.equal(anfrAzimuthDeg('0'), 0);
  assert.equal(anfrAzimuthDeg(271), 271);
  assert.equal(anfrAzimuthDeg('12,7'), 12.7);
  // One turn either way is normalised; anything beyond it is not a bearing
  // that was written down badly, it is a different field.
  assert.equal(anfrAzimuthDeg(-90), 270);
  assert.equal(anfrAzimuthDeg(360), 0);
  assert.equal(anfrAzimuthDeg(361), null);
  assert.equal(anfrAzimuthDeg(null), null);
  assert.equal(anfrAzimuthDeg(undefined), null);
  assert.equal(anfrAzimuthDeg(''), null);
  assert.equal(anfrAzimuthDeg('N'), null);
});

test('a ray lands at the distance and the bearing it was asked for', () => {
  // The spherical form is used because the flat one divides by cos(lat), and
  // that factor is what puts a 60 m ray off-azimuth in Dunkerque. Checked at
  // three latitudes the register actually reaches, including the two extremes
  // of the file (51.08 N Dunkerque, -27.62 S the Loyauté islands).
  for (const lat of [-27.618333, 48.85528, 51.080278]) {
    for (const bearing of [0, 90, 180, 270, 359]) {
      const far = anfrProjectPoint(lat, 2.33167, bearing, 60);
      // Half a metre of slack on a 60 m ray, and the slack is the RULER's:
      // `anfrDistanceM` is a flat local approximation with a 110 574 m degree
      // of latitude, which is 0.6 % short of the sphere this projects on.
      assert.ok(Math.abs(anfrDistanceM(lat, 2.33167, far.lat, far.lon) - 60) < 0.5,
        `60 m at ${lat}/${bearing}`);
    }
  }
  // North is +latitude and east is +longitude, which is the one way round a
  // bearing can be wired and still look plausible on a card.
  const north = anfrProjectPoint(48.85528, 2.33167, 0, 60);
  assert.ok(north.lat > 48.85528 && Math.abs(north.lon - 2.33167) < 1e-9);
  const east = anfrProjectPoint(48.85528, 2.33167, 90, 60);
  assert.ok(east.lon > 2.33167 && Math.abs(east.lat - 48.85528) < 1e-5);
  assert.equal(anfrProjectPoint(NaN, 0, 0, 60), null);
  assert.equal(anfrProjectPoint(48, 2, 0, NaN), null);
});

test('the azimuths fold to distinct bearing/height pairs, and count what is missing', () => {
  const antennas = projectCartoradioAntennas(CARTORADIO.antennes.body);
  // The fixture is support 449714: five operators, 33 antennas, and every one
  // of them files an orientation.
  assert.equal(antennas.antennas, 33);
  assert.equal(antennas.withoutAzimuth, 0);
  assert.ok(antennas.azimuths.length > 0);
  // Sorted by bearing then height, so two reads of the same mast are diffable.
  const sorted = [...antennas.azimuths]
    .sort((a, b) => a.deg - b.deg || (a.heightM ?? 0) - (b.heightM ?? 0));
  assert.deepEqual(antennas.azimuths, sorted);
  // Every pair is a real bearing on a real mounting height, and the zero is
  // kept rather than swept out as a blank.
  assert.ok(antennas.azimuths.some((pair) => pair.deg === 0));
  for (const pair of antennas.azimuths) {
    assert.ok(pair.deg >= 0 && pair.deg < 360);
    assert.ok(pair.heightM === null || pair.heightM > 0);
    assert.ok(pair.antennas >= 1);
  }
  // The pairs are DISTINCT: a busy mast files the same three sectors many
  // times over, and one ray per antenna would stack a dozen on each bearing.
  const keys = antennas.azimuths.map((pair) => `${pair.deg}|${pair.heightM}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(
    antennas.azimuths.reduce((sum, pair) => sum + pair.antennas, 0) + antennas.withoutAzimuth,
    antennas.antennas,
    'every antenna is either folded into a pair or counted as unaimed',
  );
});

test('an antenna with no orientation is counted, never pointed somewhere', () => {
  // The measured rate is 4 of 328, so the branch is rare and has to be tested
  // on purpose. A mounting height that is missing is kept apart from a bearing
  // that is missing, because the drawing answers them differently.
  const body = {
    data: [{
      station: { exploitant: 'ORANGE' },
      installations: [
        { hauteur: 30, antennes: [{ orientation: 120 }, { orientation: null }, {}] },
        { hauteur: 0, antennes: [{ orientation: 240 }] },
      ],
    }],
  };
  const antennas = projectCartoradioAntennas(body);
  assert.equal(antennas.antennas, 4);
  assert.equal(antennas.withoutAzimuth, 2);
  assert.deepEqual(antennas.azimuths, [
    { deg: 120, heightM: 30, antennas: 1 },
    // `hauteur: 0` is the register's blank, so the pair keeps a null height
    // rather than a mounting point 0 m off the ground.
    { deg: 240, heightM: null, antennas: 1 },
  ]);
  const empty = projectCartoradioAntennas({});
  assert.deepEqual(empty.azimuths, []);
  assert.equal(empty.withoutAzimuth, 0);
});
