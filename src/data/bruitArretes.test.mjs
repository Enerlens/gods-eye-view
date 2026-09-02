// What the national arrêté register is allowed to say, and — much more
// importantly — what it is allowed to say when it comes back SHORT.
//
// This module exists for one sentence: "no noise plan covers this ground; the
// nearest aerodrome that has one is LFPG, 12.4 km away". That sentence is built
// from a register, and a register that answered with a handful of rows would
// produce a confidently wrong version of it — naming an aerodrome 50 km away
// while the real nearest one sat in the rows that never arrived. So the
// property under test throughout is: **an incomplete index is REPORTED, never
// quietly used as if it were complete.**
//
// The second property is that a row with no coordinate is counted and dropped,
// never placed. An aerodrome without a published point cannot be the answer to
// "which one is nearest", and putting it at a commune centroid would make it
// one.
//
// The fixture is the real WFS answer of 2026-09-02 trimmed to twelve rows that
// each carry a distinct trap, with `totalFeatures`, `numberMatched` and
// `numberReturned` restated to twelve. See `src/data/fixtures/README.md`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  BRUIT_AREA_MAX_AERODROMES,
  BRUIT_AREA_PLAN_REACH_KM,
  BRUIT_ARRETE_COUNT,
  BRUIT_ARRETE_FLOOR,
  BRUIT_ARRETE_TYPENAME,
  BRUIT_NEAREST_MAX_KM,
  BRUIT_WFS_BASE,
  arreteName,
  arretesWithin,
  buildPebArreteIndexUrl,
  nearestArrete,
  projectPebArretes,
} from './bruitArretes.js';
import { BRUIT_LDEN_FROM_YEAR } from './bruitFeed.js';

const INDEX = JSON.parse(readFileSync(
  new URL('./fixtures/bruit-arrete-index-sample.json', import.meta.url), 'utf8',
));
const PROJECTED = projectPebArretes(INDEX);
const at = (oaci) => PROJECTED.airports.find((row) => row.oaci === oaci);

test('the WFS URL asks for EPSG:4326 explicitly, or every aerodrome moves to the Indian Ocean', () => {
  const url = new URL(buildPebArreteIndexUrl());
  assert.equal(`${url.origin}${url.pathname}`, BRUIT_WFS_BASE);
  const params = url.searchParams;
  assert.equal(params.get('SERVICE'), 'WFS');
  assert.equal(params.get('VERSION'), '2.0.0');
  assert.equal(params.get('TYPENAMES'), BRUIT_ARRETE_TYPENAME);
  assert.equal(params.get('OUTPUTFORMAT'), 'application/json');
  // Without it the service answers in its own default axis order and the
  // coordinates arrive transposed.
  assert.equal(params.get('SRSNAME'), 'EPSG:4326');
  // Headroom over the measured 224, and small enough that a service answering
  // with something absurd cannot pass for a national index.
  assert.equal(Number(params.get('COUNT')), BRUIT_ARRETE_COUNT);
  assert.ok(BRUIT_ARRETE_COUNT > BRUIT_ARRETE_FLOOR);
  // The PLAN layers are not in this service at all: asking for them is not a
  // 404 but an HTTP 400 "Unknown namespace". Only the arrêté POINTS are here.
  assert.ok(BRUIT_ARRETE_TYPENAME.includes('arrete'));
});

test('a register shorter than the one this was written against says SHORT rather than answering', () => {
  // Twelve rows, honestly labelled twelve — and twelve is not a national index.
  assert.equal(PROJECTED.count, 12);
  assert.equal(PROJECTED.total, 12);
  assert.equal(PROJECTED.truncated, false, 'nothing was cut off: the total agrees with the rows');
  assert.equal(PROJECTED.short, true, 'but it is far below the 224 this was measured against');
  assert.equal(BRUIT_ARRETE_FLOOR, 224);
  // The two flags are not the same fact. `truncated` is "the service had more
  // and did not send it"; `short` is "what arrived is not a national register".
  const cut = projectPebArretes({ ...INDEX, numberMatched: 224 });
  assert.equal(cut.truncated, true);
  assert.equal(cut.short, true);
  assert.equal(cut.total, 224);
});

test('a payload that is not a FeatureCollection yields zeros, not an exception', () => {
  for (const bad of [null, undefined, {}, { features: null }, { features: 'nope' }]) {
    const projected = projectPebArretes(bad);
    assert.equal(projected.count, 0);
    assert.equal(projected.airports.length, 0);
    assert.equal(projected.short, true);
    // `numberMatched` absent is null, and NOT zero: `Number(undefined)` is NaN
    // and `Number(null)` is 0, and a total of 0 would read as "the register is
    // empty" rather than "the register did not say".
    assert.equal(projected.total, null);
    assert.equal(projected.truncated, false);
  }
});

test('a row with no coordinate is counted and dropped, never placed', () => {
  const withGhosts = {
    ...INDEX,
    features: [
      ...INDEX.features,
      { type: 'Feature', geometry: null, properties: { oaci: 'LFXX', nom: 'LFXX - SANS POINT', arrete_peb: 'http://x/PEB_LFXX_01_01_2010.pdf' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [null, null] }, properties: { oaci: 'LFYY', nom: 'LFYY - NULL', arrete_peb: 'http://x/PEB_LFYY_01_01_2010.pdf' } },
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[2, 48]]] }, properties: { oaci: 'LFZZ', nom: 'LFZZ - POLY', arrete_peb: 'http://x/PEB_LFZZ_01_01_2010.pdf' } },
    ],
  };
  const projected = projectPebArretes(withGhosts);
  assert.equal(projected.unplaced, 3);
  assert.equal(projected.count, 12, 'the twelve real rows, and only those');
  assert.equal(projected.airports.some((row) => row.oaci === 'LFXX'), false);
  // The coercion trap in its natural habitat: `Number(null)` is 0, so a null
  // coordinate pair placed unguarded lands at 0°N 0°E — the Gulf of Guinea —
  // and becomes "the nearest aerodrome with a noise plan" for half of Africa.
  assert.equal(projected.airports.some((row) => row.lat === 0 && row.lon === 0), false);
});

test('the date lives in the FILENAME, and it splits the register on the 2002 change of unit', () => {
  // The WFS index publishes no date of its own — `arrete_peb` is the register's
  // only statement about when each plan was made.
  assert.deepEqual(Object.keys(INDEX.features[0].properties).sort(), ['arrete_peb', 'nom', 'oaci']);
  assert.equal(PROJECTED.undated, 0, 'all twelve parse');
  assert.equal(PROJECTED.psophique + PROJECTED.lden, PROJECTED.count);
  assert.equal(PROJECTED.psophique, 6);
  assert.equal(PROJECTED.lden, 6);
  assert.equal(PROJECTED.oldest, '1974-08-22');
  assert.equal(PROJECTED.newest, '2022-06-20');
  for (const row of PROJECTED.airports) {
    const year = Number(row.arreteDate.slice(0, 4));
    assert.equal(row.index, year >= BRUIT_LDEN_FROM_YEAR ? 'lden' : 'psophique');
  }
  // Istres 1974 against Nancy-Est 2022: forty-eight years, and the index the
  // thresholds are written in changed in the middle of it.
  assert.equal(at('LFMI').index, 'psophique');
  assert.equal(at('LFSN').index, 'lden');
});

test('the register spans the DOM, so "224 French aerodromes" is not "metropolitan France"', () => {
  // La Réunion at 55.5°E and Cayenne at 52.4°W: any code that assumes a
  // metropolitan bounding box drops them, and any nearest-neighbour search that
  // clamps to it answers the wrong aerodrome for two départements.
  assert.ok(at('FMEE').lon > 55);
  assert.ok(at('SOCA').lon < -52);
  assert.ok(at('FMEE').lat < -20);
});

test('the name is stripped of the code it repeats, and never of anything else', () => {
  // `nom` is "LFSB - BALE" on every row, so printing it whole reads
  // "LFSB — LFSB - BALE".
  assert.equal(at('LFSB').name, 'BALE');
  assert.equal(at('FMEE').name, 'LA REUNION-ROLAND GARROS');
  assert.equal(arreteName('LFPG - P. CH. DE-GAULLE', 'LFPG'), 'P. CH. DE-GAULLE');
  // The `oaci` field is the authority; the echo is only trimmed when it IS the
  // echo. A name that merely starts with letters is left alone.
  assert.equal(arreteName('LFPG - P. CH. DE-GAULLE', 'LFPB'), 'LFPG - P. CH. DE-GAULLE');
  assert.equal(arreteName('BALE', 'LFSB'), 'BALE');
  assert.equal(arreteName('', 'LFSB'), null);
  assert.equal(arreteName(null, null), null);
  // A row that is nothing but its code keeps the code rather than becoming a
  // blank card.
  assert.equal(arreteName('LFSB -', 'LFSB'), 'LFSB -');
});

test('"the nearest aerodrome with a plan" is a measured distance or it is nothing', () => {
  const roissy = nearestArrete(PROJECTED.airports, 49.0092, 2.5479);
  assert.equal(roissy.oaci, 'LFPG');
  assert.equal(roissy.distanceKm, 0.1);
  // Rounded to one decimal on purpose: the register's point is an aerodrome
  // reference point, not the end of a runway, and four decimals would claim a
  // precision the coordinate does not have.
  assert.equal(Number.isInteger(roissy.distanceKm * 10), true);
  assert.equal(roissy.documentUrl.endsWith('PEB_LFPG_03_04_2007.pdf'), true);
  // Beyond the reach, the sentence stops being about the ground under the
  // camera and the module says nothing rather than naming an aerodrome in
  // another region.
  assert.equal(nearestArrete(PROJECTED.airports, 45, -30), null);
  assert.equal(BRUIT_NEAREST_MAX_KM, 150);
  const bordeaux = nearestArrete(PROJECTED.airports, 44.83, -0.57);
  assert.equal(bordeaux.oaci, 'LFDC');
  assert.ok(bordeaux.distanceKm < BRUIT_NEAREST_MAX_KM);
  assert.equal(nearestArrete(PROJECTED.airports, 44.83, -0.57, 10), null, 'a tighter reach refuses it');
});

test('a nearest lookup with nothing to look through returns null rather than guessing', () => {
  assert.equal(nearestArrete([], 49, 2), null);
  assert.equal(nearestArrete(null, 49, 2), null);
  assert.equal(nearestArrete(PROJECTED.airports, NaN, 2), null);
  // The same coercion trap once more: an absent latitude must not become 0.
  assert.equal(nearestArrete(PROJECTED.airports, null, 2), null);
  assert.equal(nearestArrete(PROJECTED.airports, undefined, undefined), null);
  // Rows that carry no usable point are skipped rather than sorting first.
  assert.equal(nearestArrete([{ oaci: 'LFXX', lat: null, lon: null }], 49, 2), null);
});

test('the register names an aerodrome that has an arrêté and NO drawable zone', () => {
  // Toussus-le-Noble is in the register with a 1985 arrêté and returns an empty
  // FeatureCollection from the plan layer at every scale tried. Measured at the
  // pinned scale, 9 of the 224 aerodromes answer nothing at their own published
  // point, and three of them — LFPN, LFPK, LFPT — answer nothing at any scale.
  // "224 aerodromes" is the register's number and an upper bound on what can be
  // drawn; this row is why the layer states both.
  const toussus = at('LFPN');
  assert.equal(toussus.arreteDate, '1985-07-03');
  assert.equal(toussus.index, 'psophique');
  assert.ok(toussus.documentUrl.endsWith('PEB_LFPN_03_07_1985.pdf'));
  assert.ok(Number.isFinite(toussus.lat) && Number.isFinite(toussus.lon));
});

// ── WHICH AERODROMES AN OVERVIEW PROBES ─────────────────────────────────────
// The overview does not probe the camera's coordinate, it probes each
// aerodrome's own published reference point — so the register stops being the
// source of one sentence about the nearest plan and becomes the list of places
// to ask. Two things then have to be true, and neither is obvious: the
// selection has to reach PAST the view, because a plan is drawn around a point
// that can be off-screen while its zone D is not, and what the request budget
// drops has to be counted rather than quietly missing.

test('the selection reaches past the view, because a plan is wider than its point', () => {
  const PARIS = { lat: 48.8566, lon: 2.3522 };
  // Nothing but the reach margin: a radius of zero still finds the aerodromes
  // whose plans can paint ground at the centre. Roissy's reference point is
  // 23 km from Notre-Dame and its zone D reaches far past that.
  const tight = arretesWithin(PROJECTED.airports, PARIS.lat, PARIS.lon, 0);
  assert.ok(tight.selected.some((row) => row.oaci === 'LFPG'), 'Roissy is within the 35 km margin');
  assert.equal(BRUIT_AREA_PLAN_REACH_KM, 35);
  // Nearest to the centre of the view first — so a capped list drops the ones
  // furthest from what the reader is looking at, not an arbitrary tail.
  const distances = tight.selected.map((row) => row.distanceKm);
  assert.deepEqual(distances, [...distances].sort((a, b) => a - b));
  assert.ok(distances.every((km) => km <= 35));
  // Réunion and Cayenne are in the register and nowhere near Paris.
  assert.equal(tight.selected.some((row) => row.oaci === 'FMEE'), false);
});

test('what the request budget drops is counted, not quietly missing', () => {
  const PARIS = { lat: 48.8566, lon: 2.3522 };
  const wide = arretesWithin(PROJECTED.airports, PARIS.lat, PARIS.lon, 200, 2);
  assert.equal(wide.selected.length, 2);
  assert.ok(wide.candidates > 2);
  // A map that stops at the cap and a complete one look identical on screen.
  assert.equal(wide.dropped, wide.candidates - 2);
  const uncapped = arretesWithin(PROJECTED.airports, PARIS.lat, PARIS.lon, 200);
  assert.equal(uncapped.dropped, 0);
  assert.equal(uncapped.selected.length, uncapped.candidates);
  assert.equal(BRUIT_AREA_MAX_AERODROMES, 24);
});

test('a selection cannot be made from a coordinate that is not one', () => {
  // Same trap the whole register module is built around: `Number(null)` is 0,
  // and an unguarded call would select the aerodromes nearest 0°N 0°E.
  for (const bad of [
    [Number.NaN, 2, 50], [48, Number.NaN, 50], [48, 2, Number.NaN],
  ]) {
    assert.deepEqual(arretesWithin(PROJECTED.airports, ...bad).selected, []);
  }
  assert.deepEqual(arretesWithin(null, 48, 2, 50).selected, []);
  // A row the register could not place is skipped rather than put at 0°N 0°E.
  assert.deepEqual(
    arretesWithin([{ oaci: 'LFXX', lat: null, lon: null }], 48, 2, 500).selected, [],
  );
});
