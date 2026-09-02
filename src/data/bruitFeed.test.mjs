// What `bruitFeed.js` is allowed to claim about a number people will read as
// decibels.
//
// ONE property runs through this whole file: **a threshold is never printed
// without the unit it is actually in, and the unit is never guessed.** The
// register keeps two incompatible scales in the same two columns — the *indice
// psophique* France abandoned in 2002, and Lden dB(A) — with nothing in the row
// to tell them apart. Every test below closes one door the wrong unit could
// come through: the date field that is stale, the value that is inverted, the
// value that is fractional, the verdict that disagrees with its own range, and
// the formatter that would otherwise emit a bare number.
//
// The SECOND property is that a returned polygon is not an answer. WMS
// GetFeatureInfo replies with everything within a buffer of the queried pixel,
// so "the service returned zone A" and "you are standing in zone A" are
// different statements, and the tests that pin `atPoint` are the ones that keep
// them different.
//
// Every fixture is a raw upstream response captured on 2026-09-02 through the
// exact URL `buildBruitProbeUrl` builds. Byte counts are in
// `src/data/fixtures/README.md`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  BRUIT_INDEX_LABELS,
  BRUIT_INDEX_SENTENCES,
  BRUIT_LDEN_FROM_YEAR,
  BRUIT_LDEN_MAX_OBSERVED,
  BRUIT_PEB_LAYER,
  BRUIT_PEB_MIN_SCALE_DENOMINATOR,
  BRUIT_PGS_LAYER,
  BRUIT_PROBE_FEATURE_COUNT,
  BRUIT_PROBE_PIXELS,
  BRUIT_PROBE_PIXEL_DEG,
  BRUIT_PROBE_SCALE_DENOMINATOR,
  BRUIT_PSOPHIQUE_MIN_OBSERVED,
  PEB_ZONE_ORDER,
  PGS_ZONE_ORDER,
  arreteDocumentDate,
  bandText,
  buildBruitProbeUrl,
  foldByAirport,
  noiseIndexOf,
  projectBruit,
  projectBruitZones,
  projectRings,
  registerDate,
  threshold,
} from './bruitFeed.js';

const read = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const norm = (value) => String(value).replace(/[\s ]+/g, ' ');

/** Saint-Cyr-l'École, at a point inside BOTH of its published bands. */
const LFPZ = read('bruit-peb-lfpz-sample.json');
const LFPZ_POINT = { lat: 48.81025, lon: 2.07712 };
/** Le Bourget, where two airports' plans meet. */
const LEBOURGET = read('bruit-peb-lebourget-sample.json');
const LEBOURGET_POINT = { lat: 48.96848, lon: 2.43817 };
/** Cannes-Mandelieu, whose thresholds are published back to front. */
const LFMD = read('bruit-peb-lfmd-sample.json');
const LFMD_POINT = { lat: 43.53184, lon: 6.95601 };
/** Gap-Tallard, whose `date_arret` was never moved when the plan was reissued. */
const LFNA = read('bruit-peb-lfna-sample.json');
const LFNA_POINT = { lat: 44.4550, lon: 6.0378 };
/** Montendre, whose document URL carries a literal space. */
const LFDC = read('bruit-peb-lfdc-sample.json');
const LFDC_POINT = { lat: 45.273609, lon: -0.453333 };
/** Toussus-le-Noble: an arrêté, and no polygon at any scale. */
const EMPTY = read('bruit-peb-empty-sample.json');
/** Roissy's plan de gêne sonore — the sibling layer's different schema. */
const PGS = read('bruit-pgs-lfpg-sample.json');
const PGS_POINT = { lat: 49.00920, lon: 2.54790 };

const zones = (payload, point, kind = 'peb') => projectBruitZones(payload, { kind, point });

test('the probe URL sends latitude first, because WMS 1.3.0 with EPSG:4326 says so', () => {
  const url = new URL(buildBruitProbeUrl('peb', { lat: 48.81025, lon: 2.07712 }));
  const params = url.searchParams;
  assert.equal(params.get('VERSION'), '1.3.0');
  assert.equal(params.get('CRS'), 'EPSG:4326');
  const [south, west, north, east] = params.get('BBOX').split(',').map(Number);
  // Latitude first. Sending lon/lat here does not fail — it answers HTTP 200
  // about a point in another country, which is the worst kind of bug there is.
  assert.ok(south < 48.81025 && north > 48.81025, 'the first pair brackets the LATITUDE');
  assert.ok(west < 2.07712 && east > 2.07712, 'the second pair brackets the LONGITUDE');
  assert.equal(params.get('LAYERS'), BRUIT_PEB_LAYER);
  assert.equal(params.get('QUERY_LAYERS'), BRUIT_PEB_LAYER);
  assert.equal(params.get('INFO_FORMAT'), 'application/json');
  assert.equal(params.get('FEATURE_COUNT'), String(BRUIT_PROBE_FEATURE_COUNT));
  assert.equal(buildBruitProbeUrl('pgs', { lat: 48, lon: 2 }).includes(BRUIT_PGS_LAYER), true);
});

test('the queried pixel is the CENTRE of the frame, not a corner between four', () => {
  const params = new URL(buildBruitProbeUrl('peb', { lat: 49, lon: 2 })).searchParams;
  assert.equal(Number(params.get('WIDTH')), BRUIT_PROBE_PIXELS);
  assert.equal(Number(params.get('HEIGHT')), BRUIT_PROBE_PIXELS);
  // Odd frame, integer centre: 101 pixels, I = J = 50.
  assert.equal(BRUIT_PROBE_PIXELS % 2, 1);
  assert.equal(Number(params.get('I')), (BRUIT_PROBE_PIXELS - 1) / 2);
  assert.equal(Number(params.get('J')), (BRUIT_PROBE_PIXELS - 1) / 2);
  const [south, west, north, east] = params.get('BBOX').split(',').map(Number);
  assert.ok(Math.abs((south + north) / 2 - 49) < 1e-9);
  assert.ok(Math.abs((west + east) / 2 - 2) < 1e-9);
});

test('the pinned scale stays above the floor where the service goes silent with HTTP 200', () => {
  // `dgac_peb_plan_wmsv` carries a MinScaleDenominator: below roughly 1:25,000
  // it answers 200 with an EMPTY FeatureCollection, which reads exactly like
  // "there is no noise plan here". A smaller denominator is a LARGER scale.
  assert.ok(
    BRUIT_PROBE_SCALE_DENOMINATOR > BRUIT_PEB_MIN_SCALE_DENOMINATOR,
    `1:${BRUIT_PROBE_SCALE_DENOMINATOR} must stay coarser than the 1:${BRUIT_PEB_MIN_SCALE_DENOMINATOR} floor`,
  );
  assert.equal(BRUIT_PROBE_SCALE_DENOMINATOR, 39_757);
  // The scale is a CONSTANT, not a function of the camera: derived from the
  // view it would answer at 30 km and go silently blank at 800 m.
  assert.equal(typeof BRUIT_PROBE_PIXEL_DEG, 'number');
  assert.equal(BRUIT_PROBE_PIXEL_DEG, 1e-4);
});

test('a coordinate that is not a coordinate throws instead of probing the Gulf of Guinea', () => {
  for (const bad of [{}, { lat: null, lon: 2 }, { lat: 48, lon: '' }, { lat: NaN, lon: 2 }]) {
    assert.throws(() => buildBruitProbeUrl('peb', bad), /finite numbers/);
  }
  assert.throws(() => buildBruitProbeUrl('peb', { lat: 91, lon: 2 }), /out of range/);
  assert.throws(() => buildBruitProbeUrl('peb', { lat: 48, lon: 181 }), /out of range/);
});

test('a pre-2002 arrêté is an index, not decibels — Saint-Cyr publishes 96 and it is not a level', () => {
  const bands = zones(LFPZ, LFPZ_POINT);
  assert.equal(bands.length, 2);
  for (const band of bands) {
    assert.equal(band.index, 'psophique');
    assert.equal(BRUIT_INDEX_LABELS.psophique, 'indice psophique');
    // The label carries NO unit, and the text puts the words BEFORE the number
    // so nothing on screen can be read as "96 dB".
    assert.ok(!/dB/.test(bandText(band)), `"${bandText(band)}" must not mention decibels`);
    assert.ok(bandText(band).startsWith('indice psophique'));
  }
  assert.equal(norm(bandText(bands[0])), 'indice psophique 96');
  assert.equal(norm(bandText(bands[1])), 'indice psophique 89 – 96');
});

test('the unit comes from the LATER of the two dates — Gap is Lden on a 1985 register row', () => {
  // `date_arret` says 1985-07-01 and `ref_doc` says PEB_LFNA_11_04_2017.pdf.
  // Reading the register's date alone labels a live 70 dB(A) threshold with an
  // index abandoned before it was measured.
  const [band] = zones(LFNA, LFNA_POINT);
  assert.equal(band.arreteDate, '1985-07-01');
  assert.equal(band.documentDate, '2017-04-11');
  assert.equal(band.effectiveDate, '2017-04-11');
  assert.equal(band.revisedDocument, true);
  assert.equal(band.index, 'lden');
  assert.equal(norm(bandText(band)), '70 Lden dB(A)');
});

test('a document name with a literal space still parses — Montendre is the one row in 298', () => {
  const url = LFDC.features[0].properties.ref_doc;
  assert.ok(url.includes('PEB_LFDC_ 28_07_1986.pdf'), 'the fixture still carries the space');
  assert.equal(arreteDocumentDate(url), '1986-07-28');
  const [band] = zones(LFDC, LFDC_POINT);
  assert.equal(band.effectiveDate, '1986-07-28');
  assert.equal(band.index, 'psophique');
});

test('a date that is not one is null, not a year 0 or an Invalid Date', () => {
  assert.equal(arreteDocumentDate(null), null);
  assert.equal(arreteDocumentDate(''), null);
  assert.equal(arreteDocumentDate('http://x/PEB_LFPG.pdf'), null);
  // A month of 13 is a malformed name, not December of some other year.
  assert.equal(arreteDocumentDate('http://x/PEB_LFPG_03_13_2007.pdf'), null);
  assert.equal(arreteDocumentDate('http://x/PEB_LFPG_00_04_2007.pdf'), null);
  // `date_arret` is a DATE carrying a datetime's zone suffix. Sliced, not
  // parsed: nothing here needs a clock.
  assert.equal(registerDate('2007-04-03Z'), '2007-04-03');
  assert.equal(registerDate(null), null);
  assert.equal(registerDate(undefined), null);
  assert.equal(registerDate('hier'), null);
});

test('the verdict is checked against the values, and a disagreement suppresses the unit', () => {
  // The date says Lden; the value is a psophique one. Guessing either way puts
  // a wrong unit on a real threshold, so the module prints neither.
  const disputed = noiseIndexOf({
    dateArret: '2007-04-03Z', refDoc: null, low: 84, high: 96,
  });
  assert.equal(disputed.disputed, true);
  assert.equal(disputed.index, 'unknown');
  assert.equal(BRUIT_INDEX_LABELS.unknown, null);
  assert.equal(
    norm(bandText({ low: 84, high: 96, index: disputed.index })),
    'seuils 84 – 96 — indice non déterminé',
  );
  // …and the same in the other direction.
  const other = noiseIndexOf({ dateArret: '1985-07-03Z', refDoc: null, low: 56, high: 65 });
  assert.equal(other.disputed, true);
  assert.equal(other.index, 'unknown');
  // The two observed scales do not overlap, which is what makes the check safe.
  assert.ok(BRUIT_PSOPHIQUE_MIN_OBSERVED > BRUIT_LDEN_MAX_OBSERVED);
  assert.equal(BRUIT_LDEN_FROM_YEAR, 2002);
});

test('a row with no date at all is unknown, and a row with no values is not disputed', () => {
  const undated = noiseIndexOf({ dateArret: null, refDoc: null, low: 62, high: 70 });
  assert.equal(undated.index, 'unknown');
  assert.equal(undated.effectiveDate, null);
  assert.equal(undated.disputed, false);
  // No thresholds to check means nothing to disagree with — the date stands.
  const noValues = noiseIndexOf({ dateArret: '2017-02-06Z', refDoc: null });
  assert.equal(noValues.index, 'lden');
  assert.equal(noValues.disputed, false);
  assert.equal(bandText({ low: null, high: null, index: 'lden' }), null);
});

test('a fractional threshold is not truncated, and an empty one is not zero', () => {
  // One PEB row in the register publishes '56.5'; `parseInt` moves a boundary
  // half a decibel without saying so.
  assert.equal(threshold('56.5'), 56.5);
  assert.equal(threshold('56'), 56);
  assert.equal(threshold(55), 55);
  // The coercion trap: `Number(null)`, `Number('')` and `Number(false)` are all
  // 0, and a threshold of 0 dB is a fabricated silence.
  assert.equal(threshold(null), null);
  assert.equal(threshold(undefined), null);
  assert.equal(threshold(''), null);
  assert.equal(threshold('n/a'), null);
});

test('thresholds published back to front are put in order and the row says so', () => {
  // Cannes-Mandelieu publishes `indldenext` 70 and `indldenint` 65 on zone B —
  // printed in field order that reads "70 – 65 dB(A)", a band running backwards.
  const raw = LFMD.features.map((f) => [f.properties.indldenext, f.properties.indldenint]);
  assert.deepEqual(raw, [['70', '65'], ['65', '57']]);
  const bands = zones(LFMD, LFMD_POINT);
  const zoneB = bands.find((band) => band.zone === 'B');
  assert.equal(zoneB.low, 65);
  assert.equal(zoneB.high, 70);
  assert.equal(zoneB.inverted, true);
  assert.equal(norm(bandText(zoneB)), '65 – 70 Lden dB(A)');
});

test('one band published as two polygons is merged, and the piece count is kept', () => {
  // Saint-Cyr returns four features for two bands: zone A as id_map 649 and
  // 652, zone B as 650 and 653. Not merged, the layer draws the same rule twice
  // and counts it twice.
  assert.equal(LFPZ.features.length, 4);
  const ids = LFPZ.features.map((f) => f.properties.id_map).sort((a, b) => a - b);
  assert.deepEqual(ids, [649, 650, 652, 653]);
  const bands = zones(LFPZ, LFPZ_POINT);
  assert.equal(bands.length, 2);
  assert.deepEqual(bands.map((band) => band.zone), ['A', 'B']);
  assert.deepEqual(bands.map((band) => band.pieces), [2, 2]);
  // Merged on the BAND's identity and not on `id_map`: the duplicates disagree
  // about `producteur` (DSAC N against ADP) and `date_maj` (null against
  // 2017-05-23Z), so an identity built from the whole row would never match.
  assert.deepEqual(
    LFPZ.features.map((f) => f.properties.producteur),
    ['DSAC N', 'ADP', 'ADP', 'DSAC N'],
  );
});

test('a returned zone is only an answer when the point is INSIDE it', () => {
  // Cannes returns two overlapping bands; the probe is inside B and not inside
  // C. "The service returned zone C" and "you are in zone C" are not the same
  // statement, and only one of them belongs on a card.
  const bands = zones(LFMD, LFMD_POINT);
  assert.deepEqual(bands.map((band) => [band.zone, band.atPoint]), [['B', true], ['C', false]]);
  // Sorted so a consumer that takes bands[0] is right rather than lucky:
  // inside before beside, then most exposed first.
  assert.equal(bands[0].atPoint, true);
  const airports = foldByAirport(bands);
  assert.equal(airports.length, 1, 'a band the point is not in never becomes an airport answer');
  assert.equal(airports[0].zone, 'B');
});

test('two bands of ONE plan really do cover one point, and both are reported', () => {
  // Saint-Cyr: zone B has no hole cut where zone A sits, so the register itself
  // puts two rules on the same ground. This is the case a renderer must resolve
  // deliberately rather than by taking features[0].
  const bands = zones(LFPZ, LFPZ_POINT);
  assert.deepEqual(bands.map((band) => [band.zone, band.atPoint]), [['A', true], ['B', true]]);
  const airports = foldByAirport(bands);
  assert.equal(airports.length, 1, 'one airport, not two');
  assert.equal(airports[0].zone, 'A', 'the most exposed band is the airport answer');
  assert.deepEqual(airports[0].alsoInside, [{ zone: 'B', low: 89, high: 96 }]);
});

test('two AIRPORTS at one point are two facts, each with its own arrêté and unit', () => {
  // Le Bourget's own zone A (arrêté 2017) and Roissy's zone D (arrêté 2007)
  // both contain the ground north of Paris. Folding them into one answer would
  // delete a document.
  const bands = zones(LEBOURGET, LEBOURGET_POINT);
  assert.deepEqual(bands.map((band) => [band.oaci, band.zone]), [['LFPB', 'A'], ['LFPG', 'D']]);
  assert.ok(bands.every((band) => band.atPoint === true));
  const airports = foldByAirport(bands);
  assert.equal(airports.length, 2);
  assert.deepEqual(airports.map((a) => a.oaci), ['LFPB', 'LFPG']);
  assert.deepEqual(airports.map((a) => a.effectiveDate), ['2017-02-06', '2007-04-03']);
  assert.deepEqual(airports.map((a) => a.alsoInside), [[], []]);
});

test('a zone is a RING, and its holes are where the louder zone begins', () => {
  // Filled without its holes, Roissy's zone D is painted over zone C, B and A —
  // the map then shows the quiet number on the loudest ground.
  const bands = zones(LEBOURGET, LEBOURGET_POINT);
  const zoneD = bands.find((band) => band.zone === 'D');
  assert.equal(zoneD.holes, 1);
  assert.equal(zoneD.vertices, 664);
  const rings = zoneD.parts[0];
  assert.equal(rings.length, 2, 'one outer ring and one interior ring');
  assert.ok(rings[0].length > rings[1].length);
  // Saint-Cyr's zone B carries two, one per published piece.
  assert.equal(zones(LFPZ, LFPZ_POINT).find((band) => band.zone === 'B').holes, 2);
});

test('geometry that is not geometry is skipped, not crashed on and not half-drawn', () => {
  assert.deepEqual(projectRings(null), { parts: [], vertices: 0, holes: 0 });
  assert.deepEqual(projectRings({ type: 'Point', coordinates: [2, 48] }),
    { parts: [], vertices: 0, holes: 0 });
  // A two-point ring is not a shape; a ring whose points are not numbers is not
  // a ring. Neither may reduce a MultiPolygon to a partial outline silently —
  // the surviving parts are counted so a caller can see what was dropped.
  const mixed = projectRings({
    type: 'MultiPolygon',
    coordinates: [
      [[[2, 48], [2.001, 48]]],
      [[[2, 48], [2.001, 48], [2.001, 48.001]], [['x', 'y'], [null, null]]],
    ],
  });
  assert.equal(mixed.parts.length, 1);
  assert.equal(mixed.vertices, 3);
  assert.equal(mixed.holes, 0);
});

test('the PGS is a different schema on a sibling layer, not a rename', () => {
  const properties = PGS.features[0].properties;
  // Integers, not strings; `date_arrete`, not `date_arret`; `indice_lde` and a
  // truncated `indice_l_1`. Read with the PEB field names, every threshold on
  // this row is `undefined`.
  assert.equal(typeof properties.indice_lde, 'number');
  assert.equal(properties.indldenext, undefined);
  assert.equal(properties.date_arret, undefined);
  assert.equal(properties.date_arrete, '2013-12-11Z');
  const [band] = zones(PGS, PGS_POINT, 'pgs');
  assert.equal(band.zone, '3');
  assert.equal(band.low, 55);
  assert.equal(band.high, 65);
  assert.equal(band.index, 'lden');
  assert.equal(band.arreteDate, '2013-12-11');
  assert.equal(band.updatedOn, '2018-10-05');
  assert.equal(norm(bandText(band)), '55 – 65 Lden dB(A)');
  // Reading the same row with the PEB field map yields a band with no numbers.
  const wrong = zones(PGS, PGS_POINT, 'peb')[0];
  assert.equal(wrong.low, null);
  assert.equal(wrong.high, null);
});

test('an empty FeatureCollection is an empty answer, not an exception', () => {
  assert.equal(EMPTY.features.length, 0);
  assert.deepEqual(zones(EMPTY, { lat: 48.7498, lon: 2.1112 }), []);
  const built = projectBruit({ peb: EMPTY, pgs: null, point: { lat: 48.7498, lon: 2.1112 } });
  assert.deepEqual(built.airports, []);
  assert.equal(built.nearbyCount, 0);
  assert.equal(built.mixedIndex, false);
  // The half that was never asked for is reported as absent rather than empty:
  // "no PGS here" and "the PGS service did not answer" are different sentences.
  assert.deepEqual(built.available, { peb: true, pgs: false });
});

test('the assembled document reports what is beside the point and which units are in play', () => {
  const built = projectBruit({
    peb: LFMD, pgs: null, point: LFMD_POINT, nearest: null,
  });
  assert.equal(built.peb.length, 2);
  assert.equal(built.airports.length, 1);
  assert.equal(built.nearbyCount, 1, 'zone C came back beside the probe, not under it');
  assert.equal(built.mixedIndex, false);
  assert.deepEqual(built.indices, ['lden']);
  assert.equal(built.scaleDenominator, BRUIT_PROBE_SCALE_DENOMINATOR);
  assert.deepEqual(built.point, LFMD_POINT);
});

test('"two indices here" counts the bands the point is IN, not everything returned', () => {
  // Saint-Cyr is on the psophique scale and Le Bourget and Roissy on Lden, so
  // one response carrying both is one response carrying two incomparable
  // vocabularies. Only the bands the point is INSIDE decide the flag: a zone
  // the buffer found thirty metres away must not make a card announce that the
  // ground under the marker carries two units.
  //
  // Measured over all 224 airports at the pinned scale, exactly ONE probe
  // returned bands from two airports at once (Le Bourget: LFPB zone A and LFPG
  // zone D) and both are Lden — so no point in France is observed to carry two
  // indices. `mixedIndex` is a guard, and this test pins that it is not a
  // trigger-happy one.
  const built = projectBruit({
    peb: { features: [...LFPZ.features, ...LEBOURGET.features] },
    pgs: null,
    point: LFPZ_POINT,
  });
  assert.ok(built.peb.some((band) => band.index === 'lden'), 'the Lden bands are in the answer');
  assert.deepEqual(built.indices, ['psophique'], 'but only the psophique ones are underfoot');
  assert.equal(built.mixedIndex, false);
  assert.equal(built.nearbyCount, 2, 'the two Lden bands are beside the point, and counted');
});

test('the two zone vocabularies are ordered most-exposed-first and cover what is published', () => {
  assert.deepEqual([...PEB_ZONE_ORDER], ['A', 'B', 'C', 'D']);
  assert.deepEqual([...PGS_ZONE_ORDER], ['1', '2', '3']);
  // Each index is explained once, in full, and the psophique sentence says out
  // loud that it is not a level in decibels.
  assert.ok(/pas un niveau en dB/.test(BRUIT_INDEX_SENTENCES.psophique));
  assert.ok(/dB\(A\)/.test(BRUIT_INDEX_SENTENCES.lden));
  assert.ok(/ne concordent pas/.test(BRUIT_INDEX_SENTENCES.unknown));
});
