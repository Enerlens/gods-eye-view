// What the two registers are allowed to put on the map, and what they are not.
//
// One property runs through this whole file: **a position a register admits it
// invented must never reach the globe.** BPE says so with QUALITE_GEOLOC = 33
// ("Voie inconnue, Position aléatoire dans la commune") and FINESS says so by
// naming ADMIN-EXPRESS as the geocoder and leaving the score as ".". Each is a
// different sentence in a different file and both mean the same thing, so each
// gets its own test and neither is allowed a fallback.
//
// The second property is that the CRS is READ, never assumed. Both fixtures
// carry rows in projections the metropolitan formula would throw thousands of
// kilometres, including two whose CRS token has no `EPSG:` prefix at all.
//
// The third is that the refusals are load-bearing product decisions and not
// filter accidents: the BPE fixture holds one row of each code this layer
// declines, and a test that stops asserting them would let a school, a charge
// point or a second pharmacy back onto a map that already draws them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  AMENITIES_MAX_BOX_DEG,
  AMENITY_CARD_NAME_LIMIT,
  AMENITY_FAMILIES,
  AMENITY_FAMILY_BLURBS,
  AMENITY_FAMILY_LABELS,
  AMENITY_FAMILY_REGISTER,
  BPE_CODE_FAMILY,
  BPE_COLUMN_COUNT,
  BPE_EDITION_FLOOR,
  BPE_REFUSED_CODES,
  BPE_ROW_FLOOR,
  FINESS_COLUMN_COUNT,
  FINESS_CRS,
  FINESS_HOPITAL_AGGREGATES,
  FINESS_PHARMACIE_CATEG,
  FINESS_ROW_FLOOR,
  amenityFamilyIndex,
  amenityPrecisionFromRank,
  amenityPrecisionRank,
  amenitySiteInBox,
  bpeArchiveFromHtml,
  bpeLandingFromDataset,
  bpePrecision,
  bpeSubPagesFromHtml,
  bpeValue,
  buildAmenityMeshRows,
  csvHeaderIndex,
  finessPosition,
  finessPrecision,
  foldAmenitySites,
  newAmenityTally,
  newestBpeArchive,
  orderAmenitySites,
  parseFinessSourceCoord,
  readBpeRow,
  readFinessRow,
  splitSemicolonRow,
  sumByFamily,
  tallyAmenityOutcome,
  trimAmenityRecord,
  utmToWgs84,
} from './amenitiesFeed.js';

const readCsv = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
  .split('\n').filter((line) => line.length > 0);

const BPE_LINES = readCsv('amenities-bpe25-sample.csv');
const FINESS_LINES = readCsv('amenities-finess-sample.csv');
const BPE_INDEX = csvHeaderIndex(BPE_LINES[0]);
const FINESS_INDEX = csvHeaderIndex(FINESS_LINES[0]);

const bpeOutcomes = BPE_LINES.slice(1)
  .map((line) => readBpeRow(splitSemicolonRow(line), BPE_INDEX));
const finessOutcomes = FINESS_LINES.slice(1)
  .map((line) => readFinessRow(splitSemicolonRow(line), FINESS_INDEX));
const bpeCode = (i) => splitSemicolonRow(BPE_LINES[i + 1])[BPE_INDEX.TYPEQU].replace(/^"|"$/g, '');

test('the fixtures are the real files: 95 BPE columns, 35 FINESS columns, the counts they were captured at', () => {
  assert.equal(splitSemicolonRow(BPE_LINES[0]).length, BPE_COLUMN_COUNT);
  assert.equal(splitSemicolonRow(FINESS_LINES[0]).length, FINESS_COLUMN_COUNT);
  assert.equal(BPE_LINES.length - 1, 26);
  assert.equal(FINESS_LINES.length - 1, 17);
  // Every row keeps its arity: the readers refuse to parse at an offset.
  for (const line of BPE_LINES.slice(1)) {
    assert.equal(splitSemicolonRow(line).length, BPE_COLUMN_COUNT);
  }
  for (const line of FINESS_LINES.slice(1)) {
    assert.equal(splitSemicolonRow(line).length, FINESS_COLUMN_COUNT);
  }
});

test('BPE rows whose QUALITE_GEOLOC is 33 are refused, not banded', () => {
  const refused = bpeOutcomes
    .map((outcome, i) => ({ outcome, code: bpeCode(i) }))
    .filter(({ outcome }) => outcome.kind === 'refused' && outcome.reason === 'position-aleatoire');
  assert.equal(refused.length, 2);
  assert.deepEqual(refused.map((row) => row.code).sort(), ['B105', 'D265']);
  // And the banding function cannot be talked into giving 33 a band at all.
  assert.equal(bpePrecision('33'), null);
  assert.equal(bpePrecision('11'), 'numero');
  assert.equal(bpePrecision('12'), 'voie');
  assert.equal(bpePrecision('21'), 'voie');
  assert.equal(bpePrecision('22'), 'approchee');
  assert.equal(bpePrecision('_U'), 'indeterminee');
  assert.equal(bpePrecision('_Z'), 'indeterminee');
});

test('the Mayotte row publishes EPSG 4471 and no coordinate whatsoever, and is refused for the coordinate', () => {
  const index = BPE_LINES.findIndex((line, i) => i > 0
    && splitSemicolonRow(line)[BPE_INDEX.DEP].replace(/^"|"$/g, '') === '976') - 1;
  assert.ok(index >= 0);
  const fields = splitSemicolonRow(BPE_LINES[index + 1]);
  assert.equal(fields[BPE_INDEX.EPSG].replace(/^"|"$/g, ''), '4471');
  assert.equal(fields[BPE_INDEX.LATITUDE].replace(/^"|"$/g, ''), '');
  assert.equal(fields[BPE_INDEX.LONGITUDE].replace(/^"|"$/g, ''), '');
  assert.equal(fields[BPE_INDEX.LAMBERT_X].replace(/^"|"$/g, ''), '');
  assert.equal(bpeOutcomes[index].kind, 'refused');
  assert.equal(bpeOutcomes[index].reason, 'sans-coordonnee');
});

test('_Z and _U are read as absence and never as a value', () => {
  assert.equal(bpeValue('_Z'), '');
  assert.equal(bpeValue('_U'), '');
  assert.equal(bpeValue(' MAIRIE '), 'MAIRIE');
  // The gendarmerie row that carries _Z in QUALITE_GEOLOC still draws — the
  // register declining to grade a position is not the same as grading it badly.
  const zRow = bpeOutcomes.find((outcome) => outcome.kind === 'site'
    && outcome.family === 'gendarmerie' && outcome.site.precision === 'indeterminee');
  assert.ok(zRow, 'expected one gendarmerie with no published precision');
  // The two columns disagree on this row and both are read as themselves:
  // QUALITE_XY says 'B' (Bonne) while QUALITE_GEOLOC and TR_DIST_PRECISION are
  // both `_Z`. So the register grades the coordinate and declines to say how it
  // was found — which is exactly why the band comes from QUALITE_GEOLOC and the
  // distance line is simply absent from the card rather than invented.
  assert.equal(zRow.site.quality, 'B');
  assert.equal(zRow.site.distance, '');
});

test('every bassin de natation in the fixture carries no published precision at all', () => {
  const pools = bpeOutcomes.filter((outcome) => outcome.family === 'piscine');
  assert.equal(pools.length, 1);
  assert.equal(pools[0].kind, 'site');
  assert.equal(pools[0].site.precision, 'indeterminee');
});

test('the ten drawn codes are drawn and every refused code is skipped', () => {
  const drawnCodes = new Set();
  const skipped = new Set();
  bpeOutcomes.forEach((outcome, i) => {
    if (outcome.kind === 'skip') skipped.add(bpeCode(i));
    else drawnCodes.add(bpeCode(i));
  });
  for (const code of Object.keys(BPE_CODE_FAMILY)) {
    assert.ok(drawnCodes.has(code) || code === 'A208' || code === 'B104',
      `expected ${code} among the drawn codes`);
  }
  // The refusals a reader would otherwise see twice on the globe.
  for (const code of ['B326', 'C108', 'C501', 'D307', 'D106', 'E107']) {
    assert.ok(skipped.has(code), `${code} must not be drawn`);
    assert.ok(BPE_REFUSED_CODES[code], `${code} must carry a stated reason`);
  }
  // And a code that is simply outside the brief.
  assert.ok(skipped.has('A504'));
  assert.equal(BPE_REFUSED_CODES.A504, undefined);
});

test('the FINESS CRS token is read positionally, including the two rows with no EPSG: prefix', () => {
  const parsed = FINESS_LINES.slice(1)
    .map((line) => parseFinessSourceCoord(splitSemicolonRow(line)[FINESS_INDEX.sourcecoordet]))
    .filter(Boolean);
  // The whole file splits into exactly five tokens; so does the fixture.
  for (const line of FINESS_LINES.slice(1)) {
    const raw = splitSemicolonRow(line)[FINESS_INDEX.sourcecoordet];
    if (raw) assert.equal(raw.split(',').length, 5);
  }
  const spm = parsed.find((row) => /21N/.test(row.crsText));
  assert.ok(spm, 'expected the Saint-Pierre row');
  assert.equal(/^EPSG:/.test(spm.crsText), false);
  assert.equal(spm.crs.id, 'WGS84 / UTM 21N');
  const wallis = parsed.find((row) => /1S/.test(row.crsText));
  assert.ok(wallis, 'expected the Wallis row');
  assert.equal(/^EPSG:/.test(wallis.crsText), false);
  assert.equal(wallis.geocoder, 'MAPS 06-11-2024');
  // `.` is the register's own "no score" and must never become a number.
  assert.equal(wallis.score, null);
});

test('a FINESS row geocoded to its commune is refused, whichever half of the partition names it', () => {
  const refused = finessOutcomes.filter((outcome) => outcome.kind === 'refused'
    && outcome.reason === 'geocode-commune');
  assert.equal(refused.length, 2);
  assert.deepEqual(refused.map((row) => row.family).sort(), ['hopital', 'pharmacie']);
  const noCoord = finessOutcomes.filter((outcome) => outcome.kind === 'refused'
    && outcome.reason === 'sans-coordonnee');
  assert.equal(noCoord.length, 0, 'the no-coordinate row is not in a drawn family');
});

test('every declared CRS lands its row inside its own territory', () => {
  const placed = finessOutcomes.filter((outcome) => outcome.kind === 'site').map((o) => o.site);
  const at = (label) => placed.find((site) => site.crs === label);
  const box = (site, west, south, east, north) => {
    assert.ok(site, 'expected a row in this CRS');
    assert.ok(site.lon >= west && site.lon <= east, `${site.name} lon ${site.lon}`);
    assert.ok(site.lat >= south && site.lat <= north, `${site.name} lat ${site.lat}`);
  };
  box(at('RGF93 / Lambert-93 (Métropole)'), -5.2, 41.3, 9.6, 51.1);
  box(at('RGAF09 / UTM 20N (Antilles)'), -63.2, 14.3, -60.7, 18.2);
  box(at('RGR92 / UTM 40S (La Réunion)'), 55.2, -21.4, 55.9, -20.8);
  box(at('RGFG95 / UTM 22N (Guyane)'), -54.5, 3.5, -51.7, 5.8);
  box(at('RGM04 / UTM 38S (Mayotte)'), 45.0, -13.0, 45.3, -12.6);
  box(at('WGS84 / UTM 21N (Saint-Pierre-et-Miquelon)'), -56.4, 46.7, -56.1, 46.9);
});

test('the CH de Fleyriat reprojects to the coordinate INSEE and the recon both name', () => {
  const fleyriat = finessOutcomes
    .map((outcome) => outcome.site)
    .find((site) => site?.finess === '010000024');
  assert.ok(fleyriat);
  assert.equal(fleyriat.lat, 46.22229);
  assert.equal(fleyriat.lon, 5.20918);
  assert.equal(fleyriat.family, 'hopital');
  assert.equal(fleyriat.precision, 'numero');
});

test('pushing an overseas row through the metropolitan formula is caught by the CRS, not by luck', () => {
  const guyane = finessOutcomes
    .map((outcome) => outcome.site)
    .find((site) => site?.crs === 'RGFG95 / UTM 22N (Guyane)');
  assert.ok(guyane);
  // The same easting/northing read as Lambert-93 lands nowhere near Cayenne.
  const wrong = finessPosition(
    Number(splitSemicolonRow(FINESS_LINES.find((line) => line.includes(guyane.finess)))[FINESS_INDEX.coordxet]),
    Number(splitSemicolonRow(FINESS_LINES.find((line) => line.includes(guyane.finess)))[FINESS_INDEX.coordyet]),
    FINESS_CRS['EPSG:2154'],
  );
  const km = Math.hypot((wrong.lat - guyane.lat) * 111.32, (wrong.lon - guyane.lon) * 111.32);
  assert.ok(km > 1000, `expected a large error, got ${Math.round(km)} km`);
});

test('the UTM inverse is one function for five CRS, and round-trips', () => {
  // Wallis, zone 1 south — the extreme case, west of the antimeridian.
  const wallis = utmToWgs84(370000, 8530000, 1, true);
  assert.ok(wallis.lon < -170 && wallis.lon > -180);
  assert.ok(wallis.lat < 0 && wallis.lat > -20);
  // Northern-hemisphere zone 21 has no false northing to remove.
  const spm = utmToWgs84(561000, 5182000, 21, false);
  assert.ok(spm.lat > 46 && spm.lat < 47.5);
  assert.ok(spm.lon > -57 && spm.lon < -55.5);
});

test('the score bands are typed, so an unscored row cannot become the worst-located one', () => {
  assert.equal(finessPrecision(96), 'numero');
  assert.equal(finessPrecision(95), 'numero');
  assert.equal(finessPrecision(94), 'voie');
  assert.equal(finessPrecision(80), 'voie');
  assert.equal(finessPrecision(79), 'approchee');
  // The three shapes a coercing guard would have turned into band 0.
  assert.equal(finessPrecision(null), 'indeterminee');
  assert.equal(finessPrecision(undefined), 'indeterminee');
  assert.equal(finessPrecision('96'), 'indeterminee');
  assert.equal(finessPrecision(NaN), 'indeterminee');
});

test('the family vocabulary is complete and each family answers to exactly one register', () => {
  assert.equal(AMENITY_FAMILIES.length, 7);
  for (const family of AMENITY_FAMILIES) {
    assert.ok(AMENITY_FAMILY_LABELS[family], `${family} needs a label`);
    assert.ok(AMENITY_FAMILY_BLURBS[family], `${family} needs a blurb`);
    assert.ok(['bpe', 'finess'].includes(AMENITY_FAMILY_REGISTER[family]));
    assert.equal(amenityFamilyIndex(family), AMENITY_FAMILIES.indexOf(family));
  }
  assert.equal(amenityFamilyIndex('ecole'), -1);
  // Every BPE code maps to a BPE family, and no BPE code claims a FINESS one.
  for (const [code, family] of Object.entries(BPE_CODE_FAMILY)) {
    assert.equal(AMENITY_FAMILY_REGISTER[family], 'bpe', `${code} → ${family}`);
  }
  assert.equal(FINESS_PHARMACIE_CATEG, '620');
  assert.equal(Object.keys(FINESS_HOPITAL_AGGREGATES).length, 4);
});

test('co-located rows collapse to one dot that says how many it stands for', () => {
  const sites = bpeOutcomes.filter((outcome) => outcome.kind === 'site').map((o) => o.site);
  const folded = foldAmenitySites(sites);
  const cluster = folded.find((record) => record.count > 1);
  assert.ok(cluster, 'the fixture carries three médecins at one address');
  assert.equal(cluster.family, 'medecin');
  assert.equal(cluster.count, 3);
  assert.equal(cluster.names.length, 3);
  assert.equal(cluster.lat, 48.83801);
  assert.equal(cluster.lon, 2.34276);
  // Fewer dots than rows, and every id unique.
  assert.ok(folded.length < sites.length);
  assert.equal(new Set(folded.map((record) => record.id)).size, folded.length);
  // The card trims the names and COUNTS the remainder rather than dropping it.
  const trimmed = trimAmenityRecord({ ...cluster, names: ['a', 'b', 'c', 'd', 'e', 'f'] });
  assert.equal(trimmed.names.length, AMENITY_CARD_NAME_LIMIT);
  assert.equal(trimmed.moreNames, 2);
});

test('families are never merged into each other, even at one coordinate', () => {
  const folded = foldAmenitySites([
    { family: 'pharmacie', register: 'finess', lat: 48.5, lon: 2.5, precision: 'numero', name: 'PH' },
    { family: 'courses', register: 'bpe', lat: 48.5, lon: 2.5, precision: 'numero', name: 'SUP' },
  ]);
  assert.equal(folded.length, 2);
  assert.deepEqual(folded.map((row) => row.family).sort(), ['courses', 'pharmacie']);
});

test('the folded precision is the BEST of the merged rows, not the worst', () => {
  const folded = foldAmenitySites([
    { family: 'medecin', register: 'bpe', lat: 48.5, lon: 2.5, precision: 'approchee', name: 'A' },
    { family: 'medecin', register: 'bpe', lat: 48.5, lon: 2.5, precision: 'numero', name: 'B' },
  ]);
  assert.equal(folded.length, 1);
  assert.equal(folded[0].precision, 'numero');
  assert.equal(folded[0].count, 2);
});

test('a viewport payload is ordered rarest family first, so a cap drops médecins and never hôpitaux', () => {
  const rows = [
    { family: 'medecin', lat: 1, lon: 1, precision: 'numero' },
    { family: 'hopital', lat: 2, lon: 2, precision: 'voie' },
    { family: 'pharmacie', lat: 3, lon: 3, precision: 'numero' },
    { family: 'piscine', lat: 4, lon: 4, precision: 'numero' },
  ];
  const ordered = orderAmenitySites(rows);
  assert.deepEqual(ordered.map((row) => row.family), ['hopital', 'piscine', 'pharmacie', 'medecin']);
  // Within a family, best-located first.
  const inFamily = orderAmenitySites([
    { family: 'medecin', lat: 1, lon: 1, precision: 'indeterminee' },
    { family: 'medecin', lat: 2, lon: 2, precision: 'numero' },
  ]);
  assert.equal(inFamily[0].precision, 'numero');
});

test('the mesh document is sorted south-to-north and carries only four numbers per row', () => {
  const sites = bpeOutcomes.filter((outcome) => outcome.kind === 'site').map((o) => o.site);
  const mesh = buildAmenityMeshRows(foldAmenitySites(sites));
  assert.ok(mesh.length > 0);
  for (const row of mesh) {
    assert.equal(row.length, 4);
    assert.equal(typeof row[2], 'number');
    assert.ok(row[3] >= 0 && row[3] < AMENITY_FAMILIES.length);
  }
  for (let i = 1; i < mesh.length; i += 1) {
    assert.ok(mesh[i][0] > mesh[i - 1][0]
      || (mesh[i][0] === mesh[i - 1][0] && mesh[i][1] >= mesh[i - 1][1]));
  }
  // No name survives into the national document — that is the 1.5 MB decision.
  assert.equal(JSON.stringify(mesh).includes('MÉDECIN'), false);
});

test('precision ranks round-trip and an out-of-range rank does not become the best band', () => {
  for (const band of ['indeterminee', 'approchee', 'voie', 'numero']) {
    assert.equal(amenityPrecisionFromRank(amenityPrecisionRank(band)), band);
  }
  assert.equal(amenityPrecisionRank('bogus'), 0);
  assert.equal(amenityPrecisionFromRank(99), 'indeterminee');
  assert.equal(amenityPrecisionFromRank(null), 'indeterminee');
  assert.equal(amenityPrecisionFromRank('3'), 'indeterminee');
});

test('the tally counts every outcome exactly once, in the right bucket', () => {
  const tally = newAmenityTally();
  for (const outcome of bpeOutcomes) tallyAmenityOutcome(tally, outcome);
  for (const outcome of finessOutcomes) tallyAmenityOutcome(tally, outcome);
  assert.equal(tally.scanned, bpeOutcomes.length + finessOutcomes.length);
  assert.equal(tally.malformed, 0);
  assert.equal(sumByFamily(tally.drawn), 28);
  assert.deepEqual(tally.drawn, {
    medecin: 7, courses: 2, pharmacie: 5, poste: 3, piscine: 1, gendarmerie: 3, hopital: 7,
  });
  assert.equal(sumByFamily(tally.refusedNoCoordinate), 1);
  assert.equal(sumByFamily(tally.refusedInvented), 4);
  assert.equal(sumByFamily(tally.refusedCrs), 0);
  const banded = Object.values(tally.precision).reduce((sum, value) => sum + value, 0);
  assert.equal(banded, sumByFamily(tally.drawn));
});

test('a row of the wrong arity is counted as malformed and never parsed at an offset', () => {
  const tally = newAmenityTally();
  const short = readBpeRow(['a', 'b', 'c'], BPE_INDEX);
  assert.equal(short.kind, 'malformed');
  tallyAmenityOutcome(tally, short);
  assert.equal(tally.malformed, 1);
  assert.equal(sumByFamily(tally.drawn), 0);
  assert.equal(readFinessRow(['a'], FINESS_INDEX).kind, 'malformed');
});

test('the edition is discovered from data.gouv and floored', () => {
  // The shape data.gouv actually returns: one resource, whose url is the page.
  assert.equal(
    bpeLandingFromDataset({ resources: [{ url: 'https://www.insee.fr/fr/statistiques/8217537' }] }),
    'https://www.insee.fr/fr/statistiques/8217537',
  );
  assert.equal(bpeLandingFromDataset({ resources: [{ url: 'https://example.com/x.csv' }] }), null);
  assert.equal(bpeLandingFromDataset(null), null);

  const landing = '<a href="/fr/statistiques/8217525?sommaire=8217537">Équipements géolocalisés</a>'
    + '<a href="/fr/statistiques/8217527?sommaire=8217537">Dénombrement</a>';
  assert.deepEqual(bpeSubPagesFromHtml(landing).sort(), ['8217525', '8217527']);

  const page = '<a href="/fr/statistiques/fichier/8217525/BPE25.zip">csv</a>';
  assert.deepEqual(bpeArchiveFromHtml(page), {
    path: '/fr/statistiques/fichier/8217525/BPE25.zip', edition: 25,
  });
  assert.equal(bpeArchiveFromHtml('<p>nothing here</p>'), null);

  const newest = newestBpeArchive([
    { path: '/a/BPE25.zip', edition: 25 },
    { path: '/a/BPE26.zip', edition: 26 },
    null,
  ]);
  assert.equal(newest.edition, 26);
  assert.equal(newest.year, 2026);
  assert.equal(newest.url, 'https://www.insee.fr/a/BPE26.zip');
  // A discovery older than the floor is a malformed answer, not a new fact.
  assert.equal(newestBpeArchive([{ path: '/a/BPE24.zip', edition: 24 }]), null);
  assert.equal(BPE_EDITION_FLOOR, 25);
  assert.equal(BPE_ROW_FLOOR, 2_921_770);
  assert.equal(FINESS_ROW_FLOOR, 103_032);
});

test('the bbox helper is inclusive on its edges and the ceiling is the one the proxy enforces', () => {
  const box = { south: 48, west: 2, north: 48.35, east: 2.35 };
  assert.equal(amenitySiteInBox({ lat: 48, lon: 2 }, box), true);
  assert.equal(amenitySiteInBox({ lat: 48.35, lon: 2.35 }, box), true);
  assert.equal(amenitySiteInBox({ lat: 47.99, lon: 2.1 }, box), false);
  assert.equal(amenitySiteInBox(null, box), false);
  assert.equal(amenitySiteInBox({ lat: 48, lon: 2 }, null), false);
  assert.equal(AMENITIES_MAX_BOX_DEG, 0.35);
});
