// What the READING of Île-de-France Mobilités' pre-folded offer is allowed to
// claim, before anything is drawn.
//
// One property runs through the whole file: **a number this module prints must
// have been published.** The three doors an invented number could come through
// are all held shut below.
//
//   1. COERCION. `Number(null)`, `Number('')`, `Number(false)` and `Number([])`
//      are all `0`, and `0` is a valid-looking hour, a valid-looking latitude
//      and a valid-looking course count. Every guard here is asserted against
//      the coercible values, not just against `undefined` — this was a real
//      shipped defect in `comptages-fr` and it was live in this feed too:
//      `bandLabel(null)` printed `00:00–00:59`, a clock face for a band the
//      publisher does not have.
//   2. IDENTITY. 273 stops region-wide publish two spellings of `nom_arret`,
//      and other stops share one name outright. A fold keyed on the name draws
//      one stop twice with half its service each; a fold that merges on the
//      name merges two real stops. The fixture holds both cases at once.
//   3. POSITION. 549 stops publish no coordinate. They must be counted and
//      never placed, and a profile row for a stop the identity call never
//      returned must be counted and never drawn.
//
// The second property is that the OPERATING DAY is 04:00 → 03:59. Validating
// bands as 0..23 would silently delete the entire night service, which is the
// half of the day that actually separates two addresses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  IDFM_FREQ_BAND_MAX,
  IDFM_FREQ_BAND_MIN,
  IDFM_FREQ_BAND_WINDOWS,
  IDFM_FREQ_DATASET,
  IDFM_FREQ_DAYS,
  IDFM_FREQ_DEFAULT_BAND,
  IDFM_FREQ_EDITION_FLOOR,
  IDFM_FREQ_GROUP_LIMIT,
  IDFM_FREQ_LEVELS,
  IDFM_FREQ_LICENCE,
  IDFM_FREQ_MAX_STOPS,
  bandLabel,
  buildIdentityUrl,
  buildProfileUrl,
  buildRegionBandsUrl,
  buildRegionStopsUrl,
  clampBand,
  frequencyBoxWhere,
  frequencyLevel,
  frequencyMode,
  isFrequencyBand,
  meanWaitMin,
  newestEdition,
  operatingSlot,
  profileDayTotal,
  profilePeak,
  profileRate,
  profileSpan,
  projectFrequencyStops,
  roundRate,
} from './idfmFrequencyFeed.js';

const read = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

const IDENTITY = read('idfm-frequence-identite-sample.json');
const PROFILES = ['04-09', '10-15', '16-21', '22-27']
  .map((window) => read(`idfm-frequence-profil-${window}-sample.json`));
const NO_COORDS = read('idfm-frequence-sans-coordonnees-sample.json');

/** The Alésia box the fixtures were captured through. */
const BOX = Object.freeze({ south: 48.8270, west: 2.3160, north: 48.8330, east: 2.3280 });

const PACK = projectFrequencyStops({ identity: IDENTITY, profiles: PROFILES, box: BOX });
const byId = (id) => PACK.stops.find((stop) => stop.id === id);

test('the committed fixtures are the trimmed rows they claim to be', () => {
  assert.equal(IDENTITY.total_count, 7);
  assert.equal(IDENTITY.results.length, 7);
  assert.deepEqual(PROFILES.map((envelope) => envelope.total_count), [28, 36, 36, 27]);
  assert.deepEqual(PROFILES.map((envelope) => envelope.results.length), [28, 36, 36, 27]);
  assert.equal(NO_COORDS.total_count, 8);
  // Seven identity rows for six stops: exactly one stop publishes two names.
  assert.equal(new Set(IDENTITY.results.map((row) => row.id_arret)).size, 6);
});

test('two published names for one id_arret fold onto one drawn stop', () => {
  // Stop 23613 publishes "Alésia - Général Leclerc" AND "Les Plantes" at the
  // SAME coordinate, byte-identical in the raw rows. Keyed on the name it would
  // be two dots with part of the service each.
  const raw = IDENTITY.results.filter((row) => row.id_arret === '23613');
  assert.equal(raw.length, 2);
  assert.equal(raw[0].latitude_arret, raw[1].latitude_arret);
  assert.equal(raw[0].longitude_arret, raw[1].longitude_arret);

  const stop = byId('23613');
  assert.equal(stop.name, 'Alésia - Général Leclerc');
  assert.deepEqual(stop.aliases, ['Les Plantes']);
  assert.equal(PACK.aliased, 1);
  assert.equal(PACK.count, 6);
  assert.equal(PACK.stopsInBox, 6);
});

test('a name shared by two different stops does NOT merge them', () => {
  // 23611 is its own stop, 88 m away, also signed "Les Plantes" — the mirror of
  // the trap above. Merging on the name would delete it and hand its service to
  // 23613; keying on `id_arret` keeps both.
  const other = byId('23611');
  assert.equal(other.name, 'Les Plantes');
  assert.equal(other.aliases, null);
  assert.notEqual(other.lat, byId('23613').lat);
  assert.equal(profileRate(other.profile, 'mardi', 8), 11);
  assert.equal(profileRate(byId('23613').profile, 'mardi', 8), 10);
});

test('two platforms of one station stay two stops', () => {
  // "Alésia" métro is published twice, 9 m apart, and the two carry DIFFERENT
  // service: 22154 runs to band 25 and 463118 stops at 24. Folding on the name
  // would average a real difference away.
  const a = byId('22154');
  const b = byId('463118');
  assert.equal(a.name, 'Alésia');
  assert.equal(b.name, 'Alésia');
  assert.equal(a.mode, 'metro');
  assert.equal(b.mode, 'metro');
  assert.equal(a.bands, 22);
  assert.equal(b.bands, 21);
  assert.deepEqual(profileSpan(a.profile, 'mardi'), { first: 5, last: 25 });
  assert.deepEqual(profileSpan(b.profile, 'mardi'), { first: 5, last: 24 });
});

test('the night bands above 23 survive the fold', () => {
  // Band 25 is 01:00–01:59 and band 27 is 03:00–03:59. A 0..23 validation would
  // delete them, and they are where the biggest signal in this dataset lives.
  assert.ok(PACK.bandsSeen.includes(25));
  assert.ok(PACK.bandsSeen.includes(27));
  assert.equal(PACK.outOfRangeRows, 0);
  const night = byId('36547');
  assert.equal(profileRate(night.profile, 'mardi', 25), 6);
  assert.equal(profileRate(night.profile, 'mardi', 27), 6);
  assert.equal(bandLabel(25), '01:00–01:59');
  assert.equal(bandLabel(27), '03:00–03:59');
});

test('a rate below one course an hour is kept, not rounded away', () => {
  // 22154 publishes 0.1 courses in band 26 on a Monday. Rounding the wire to
  // whole numbers would save 28 % of the payload and turn that into "nothing
  // runs" — which is exactly the number a night-shift reader is looking for.
  assert.equal(byId('22154').profile[IDFM_FREQ_DAYS.indexOf('lundi')][26 - IDFM_FREQ_BAND_MIN], 0.1);
  assert.equal(roundRate(0.14), 0.1);
  assert.equal(roundRate(11.942857142857143), 12);
  assert.equal(roundRate(9.94), 9.9);
  // Zero and below-zero stay zero: a negative course count is not a datum.
  assert.equal(roundRate(0), 0);
  assert.equal(roundRate(-3), 0);
});

test('a stop with no coordinate is counted and never placed', () => {
  const unplaced = projectFrequencyStops({ identity: NO_COORDS, profiles: [], box: null });
  assert.equal(unplaced.count, 0);
  assert.equal(unplaced.stops.length, 0);
  assert.equal(unplaced.unplaced, 8);
  assert.equal(unplaced.unplacedRows, 8);
  // No mode is published on this query, so they are `unknown` rather than
  // borrowing the referential's answer.
  assert.deepEqual(unplaced.unplacedModes, { unknown: 8 });
  assert.equal(PACK.unplaced, 0);
});

test('a profile row for a stop the identity call never returned is not drawn', () => {
  // Exactly what a truncated identity page produces: the profile windows still
  // carry the stop, and it has no position, so it is counted as an orphan
  // rather than placed somewhere plausible.
  const trimmed = {
    total_count: IDENTITY.results.length - 2,
    results: IDENTITY.results.filter((row) => row.id_arret !== '36547'),
  };
  const pack = projectFrequencyStops({ identity: trimmed, profiles: PROFILES, box: BOX });
  assert.equal(pack.count, 5);
  assert.ok(pack.orphanRows > 0);
  assert.equal(pack.stops.some((stop) => stop.id === '36547'), false);
  assert.equal(pack.bandRows, PACK.bandRows);
});

test('the ceiling keeps the busiest stops and reports the rest', () => {
  const pack = projectFrequencyStops({ identity: IDENTITY, profiles: PROFILES, box: BOX, maxStops: 2 });
  assert.equal(pack.count, 2);
  assert.equal(pack.refused, 4);
  assert.equal(pack.stopsInBox, 6);
  assert.deepEqual(pack.stops.map((stop) => stop.id), ['36547', '22154']);
});

test('bandLabel refuses everything that merely coerces to a number', () => {
  // The shipped defect: `Math.trunc(Number(null))` is 0 and `Number.isFinite(0)`
  // is true, so a missing band printed `00:00–00:59` — a real, readable, wrong
  // hour. Guarding before the coercion is what makes the dash reachable.
  for (const value of [null, '', '   ', false, true, [], {}, undefined, NaN]) {
    assert.equal(bandLabel(value), '—', `bandLabel(${JSON.stringify(value)})`);
  }
  assert.equal(bandLabel(8), '08:00–08:59');
  assert.equal(bandLabel(24), '00:00–00:59');
  assert.equal(bandLabel('8'), '08:00–08:59');
});

test('clampBand falls back to the documented default for every non-number', () => {
  // Same trap, opposite symptom: `null` used to clamp to band 4 — 04:00, the
  // first hour of the operating day — while `undefined` fell back to 8. One
  // function, two answers, for the same absence.
  for (const value of [null, '', false, [], {}, undefined, NaN]) {
    assert.equal(clampBand(value), IDFM_FREQ_DEFAULT_BAND, `clampBand(${JSON.stringify(value)})`);
  }
  assert.equal(IDFM_FREQ_DEFAULT_BAND, 8);
  assert.equal(clampBand(0), IDFM_FREQ_BAND_MIN);
  assert.equal(clampBand(99), IDFM_FREQ_BAND_MAX);
  assert.equal(clampBand('12'), 12);
  assert.equal(clampBand(12.9), 12);
});

test('the band range is the operating day, 4 to 27', () => {
  assert.equal(IDFM_FREQ_BAND_MIN, 4);
  assert.equal(IDFM_FREQ_BAND_MAX, 27);
  assert.equal(isFrequencyBand(3), false);
  assert.equal(isFrequencyBand(4), true);
  assert.equal(isFrequencyBand(27), true);
  assert.equal(isFrequencyBand(28), false);
  assert.equal(isFrequencyBand(null), false);
  assert.equal(isFrequencyBand(8.5), false);
});

test('01:30 on a Wednesday belongs to Tuesday', () => {
  // The operating day starts at 04:00. Getting this backwards moves every night
  // reading onto the wrong day, and band 25 runs 15 904 courses region-wide on
  // a Monday against 31 585 on a Friday — the one place the day matters most.
  assert.deepEqual(operatingSlot({ hour: 1, weekday: 3 }), { day: 'mardi', band: 25 });
  assert.deepEqual(operatingSlot({ hour: 8, weekday: 3 }), { day: 'mercredi', band: 8 });
  assert.deepEqual(operatingSlot({ hour: 3, weekday: 0 }), { day: 'samedi', band: 27 });
  assert.deepEqual(operatingSlot({ hour: 4, weekday: 0 }), { day: 'dimanche', band: 4 });
  assert.deepEqual(operatingSlot({ hour: 23, weekday: 5 }), { day: 'vendredi', band: 23 });
  // A missing clock is the documented default and never band 24 of yesterday,
  // which is what `Number(null) === 0` used to produce.
  assert.deepEqual(operatingSlot({}), { day: 'mardi', band: 8 });
  assert.deepEqual(operatingSlot({ hour: null, weekday: null }), { day: 'mardi', band: 8 });
});

test('the ladder is fixed, and a silent stop is off it', () => {
  assert.deepEqual([...IDFM_FREQ_LEVELS], [2, 4, 8, 16, 32]);
  assert.equal(frequencyLevel(0), -1);
  assert.equal(frequencyLevel(0.1), 0);
  assert.equal(frequencyLevel(1.9), 0);
  assert.equal(frequencyLevel(2), 1);
  assert.equal(frequencyLevel(4), 2);
  assert.equal(frequencyLevel(8), 3);
  assert.equal(frequencyLevel(16), 4);
  assert.equal(frequencyLevel(32), 5);
  assert.equal(frequencyLevel(70.1), 5);
  // Absence is the silent state and never band 0: a stop with no reading and a
  // stop with a published zero must not both be "the bottom of the ramp".
  for (const value of [null, undefined, '', NaN, -1]) assert.equal(frequencyLevel(value), -1);
});

test('the implied wait is half the interval, and never a measured headway', () => {
  assert.equal(meanWaitMin(2), 15);
  assert.equal(meanWaitMin(4), 7.5);
  assert.equal(meanWaitMin(30), 1);
  assert.equal(meanWaitMin(0), null);
  assert.equal(meanWaitMin(null), null);
});

test('the profile readers agree with the fixture the card will print', () => {
  const stop = byId('36547');
  assert.equal(stop.name, 'Alésia - Général Leclerc');
  assert.equal(stop.mode, 'bus');
  assert.equal(stop.commune, 'Paris');
  assert.equal(stop.dept, '75');
  assert.equal(profileRate(stop.profile, 'mardi', 8), 29);
  assert.equal(profileRate(stop.profile, 'mardi', 22), 19);
  assert.deepEqual(profilePeak(stop.profile, 'mardi'), { band: 17, rate: 32 });
  assert.deepEqual(profileSpan(stop.profile, 'mardi'), { first: 5, last: 27 });
  assert.equal(Math.round(profileDayTotal(stop.profile, 'mardi')), 505);
  // A day that is not one of the seven published columns reads as nothing, not
  // as the first column.
  assert.equal(profileRate(stop.profile, 'monday', 8), 0);
  assert.equal(profilePeak(stop.profile, 'monday'), null);
  assert.equal(profileSpan(stop.profile, 'monday'), null);
  assert.equal(profileDayTotal(stop.profile, 'monday'), 0);
});

test('a mode the offer dataset does not publish is unknown, never borrowed', () => {
  // The ten Câble C1 rows carry a null `libelle_mode_ligne`. `arrets` types them
  // `cableway` and `idfmFeed.js` names them, but that join is not one this
  // module performs at runtime, so it says so instead of guessing.
  assert.equal(frequencyMode(null), 'unknown');
  assert.equal(frequencyMode(''), 'unknown');
  assert.equal(frequencyMode('Câble'), 'unknown');
  assert.equal(frequencyMode('Bus'), 'bus');
  assert.equal(frequencyMode('Métro'), 'metro');
  assert.equal(frequencyMode('Train'), 'rail');
  assert.equal(frequencyMode('Tramway'), 'tram');
  assert.equal(frequencyMode('Funiculaire'), 'funicular');
  assert.deepEqual(PACK.byMode, { bus: 4, metro: 2 });
});

test('the bbox is four range comparisons, because this dataset has no geo point', () => {
  // `in_bbox` needs a geo-point column and the weekly datasets publish
  // `latitude_arret`/`longitude_arret` as plain doubles. The range form also
  // does the right thing with the 549 null coordinates: a null fails every
  // comparison, so they never reach a viewport.
  const where = frequencyBoxWhere(BOX);
  assert.equal(where, 'latitude_arret>=48.827 and latitude_arret<=48.833'
    + ' and longitude_arret>=2.316 and longitude_arret<=2.328');
  assert.equal(where.includes('in_bbox'), false);
  for (const bad of [{}, { south: '', west: 0, north: 1, east: 1 }, { south: null, west: 0, north: 1, east: 1 }]) {
    assert.throws(() => frequencyBoxWhere(bad), /finite numbers/);
  }
});

test('the identity query asks one more than the ceiling, and the profile splits the band axis', () => {
  const identity = new URL(buildIdentityUrl({ box: BOX }));
  assert.equal(identity.searchParams.get('limit'), String(IDFM_FREQ_MAX_STOPS + 1));
  assert.equal(identity.searchParams.get('order_by'), 'id_arret');
  assert.equal(identity.searchParams.get('group_by'), identity.searchParams.get('select'));
  assert.ok(identity.pathname.includes(IDFM_FREQ_DATASET));
  // The grouped cap is 20 000 and the API answers HTTP 400 above it, so a
  // caller cannot ask for a whole day of a whole région in one page.
  const profile = new URL(buildProfileUrl({ box: BOX, bandLo: 4, bandHi: 9 }));
  assert.equal(profile.searchParams.get('limit'), String(IDFM_FREQ_GROUP_LIMIT));
  assert.equal(profile.searchParams.get('group_by'), 'id_arret,tranche_horaire');
  assert.ok(profile.searchParams.get('where').includes('tranche_horaire>=4 and tranche_horaire<=9'));
  // `between` is an HTTP 400 on this API, so the window is two comparisons.
  assert.equal(profile.searchParams.get('where').includes('between'), false);
  // The four windows tile 4..27 exactly once each.
  const covered = [];
  for (const [lo, hi] of IDFM_FREQ_BAND_WINDOWS) for (let b = lo; b <= hi; b += 1) covered.push(b);
  assert.deepEqual(covered, Array.from({ length: 24 }, (_, i) => i + 4));
});

test('the null-département bucket is asked for as null, never as the string None', () => {
  // `where=code_departement="None"` returns HTTP 200 with zero rows and loses
  // 549 stops without an error — the failure this predicate exists to avoid.
  const nul = new URL(buildRegionStopsUrl({ code: null }));
  assert.equal(nul.searchParams.get('where'), 'code_departement is null');
  const one = new URL(buildRegionStopsUrl({ code: '75' }));
  assert.equal(one.searchParams.get('where'), 'code_departement="75"');
  // A blank code is the null bucket, not a bucket named "".
  assert.equal(new URL(buildRegionStopsUrl({ code: '  ' })).searchParams.get('where'), 'code_departement is null');
  const region = new URL(buildRegionBandsUrl({}));
  assert.equal(region.searchParams.get('group_by'), 'code_departement,tranche_horaire');
  assert.equal(region.searchParams.has('where'), false);
});

test('an edition older than the measured floor is refused as malformed', () => {
  const fresh = newestEdition({ metas: { default: { data_processed: '2026-09-01T00:00:00+00:00', license: 'Licence Ouverte v2.0 (Etalab)', records_count: 1311578 } } });
  assert.equal(fresh.edition, '2026-09-01T00:00:00+00:00');
  assert.equal(fresh.discovered, true);
  assert.equal(fresh.records, 1311578);
  assert.equal(fresh.licence, IDFM_FREQ_LICENCE);

  const stale = newestEdition({ metas: { default: { data_processed: '2024-01-01T00:00:00+00:00' } } });
  assert.equal(stale.edition, IDFM_FREQ_EDITION_FLOOR);
  assert.equal(stale.discovered, false);

  for (const bad of [{}, null, { metas: { default: { data_processed: 'hier' } } }, { metas: { default: { data_processed: 0 } } }]) {
    const answer = newestEdition(bad);
    assert.equal(answer.edition, IDFM_FREQ_EDITION_FLOOR);
    assert.equal(answer.discovered, false);
  }
});

test('the pack carries its own provenance, so no caller has to remember it', () => {
  assert.equal(PACK.dataset, IDFM_FREQ_DATASET);
  assert.equal(PACK.licence, IDFM_FREQ_LICENCE);
  assert.equal(PACK.year, '2025');
  assert.equal(PACK.edition, IDFM_FREQ_EDITION_FLOOR);
  assert.deepEqual(PACK.box, BOX);
  assert.equal(PACK.week, 11528);
  assert.equal(PACK.silent, 0);
});
