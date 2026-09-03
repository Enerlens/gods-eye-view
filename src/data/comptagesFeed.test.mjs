// What the reading of 27.7 million hourly rows is allowed to claim.
//
// The property under test throughout is that an ABSENCE stays an absence. A
// third of this network publishes nothing at all, a further eighth publishes an
// occupancy and never a count, 31 arcs have no geometry anywhere, and the one
// thing that would quietly destroy all three facts is a `?? 0`. So the
// assertions here are mostly about nulls surviving the projection, and about
// the ODSQL windows being the exact ones the numbers in the header were
// measured through — a bare `date'…'` literal is day-granular and would swallow
// a whole day without failing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  COMPTAGES_BARRE_CODES,
  COMPTAGES_DATASET,
  COMPTAGES_GROUP_LIMIT,
  COMPTAGES_HOURS,
  COMPTAGES_HOUR_BLOCKS,
  COMPTAGES_LICENCE,
  COMPTAGES_PHANTOM_ARC,
  COMPTAGES_PROFILE_GROUP_BY,
  COMPTAGES_PROFILE_SELECT,
  COMPTAGES_TIMEZONE,
  COMPTAGES_WEEK_FLOOR,
  comptagesArcName,
  comptagesLine,
  comptagesProfileMean,
  comptagesShiftDay,
  comptagesStampWhere,
  comptagesWeekWindows,
  comptagesWindowWhere,
  indexComptagesBarre,
  indexComptagesProfile,
  newestComptagesWeek,
  projectComptagesArcs,
} from './comptagesFeed.js';

const read = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

const GEOJSON = read('comptages-hour-geojson-sample.json');
const WEEKDAY = read('comptages-profil-semaine-sample.json');
const WEEKEND = read('comptages-profil-weekend-sample.json');
const BARRE = read('comptages-etat-barre-sample.json');
const UNFILTERED = read('comptages-arcs-sans-filtre-sample.json');

/** The week every measured number in these modules was taken against. */
const WEEK = newestComptagesWeek('2026-08-31T00:00:00+02:00');

function projected(overrides = {}) {
  return projectComptagesArcs({
    features: GEOJSON.features,
    weekday: WEEKDAY.results,
    weekend: WEEKEND.results,
    barre: BARRE.results,
    week: WEEK,
    processedAt: '2026-09-01T01:02:50+00:00',
    ...overrides,
  });
}

const byId = (pack, id) => pack.arcs.find((arc) => arc.a === id);

test('the fixtures are the captured shapes, at the counts they were trimmed to', () => {
  // 13 arcs, each chosen for a distinct trap: two multi-vertex, one flow-only,
  // one occupancy-only, three silent (one per etat_barre), three with no
  // geometry at all, one junction-code name, one partial reporter, and one arc
  // that publishes a MEASURED ZERO.
  assert.equal(GEOJSON.features.length, 13);
  assert.equal(WEEKDAY.total_count, 312);
  assert.equal(WEEKDAY.results.length, 312, '13 arcs × 24 hours');
  assert.equal(WEEKEND.total_count, 312);
  assert.equal(BARRE.total_count, 17);
  assert.equal(UNFILTERED.total_count, 14);
  // Every geojson feature carries the four columns the projection reads.
  for (const feature of GEOJSON.features) {
    for (const key of ['iu_ac', 'libelle', 'libelle_nd_amont', 'libelle_nd_aval']) {
      assert.ok(key in feature.properties, `${key} present`);
    }
  }
});

test('the edition is the last COMPLETE Monday–Sunday week, and never runs backwards', () => {
  // max(t_1h) = 2026-08-31T00:00+02:00 is the CLOSING stamp of local Sunday
  // 2026-08-30, so the last complete week is 2026-08-24 → 2026-08-30. Measured
  // at 2026-09-01T21:02Z against the live feed.
  assert.deepEqual(newestComptagesWeek('2026-08-31T00:00:00+02:00'),
    { start: '2026-08-24', end: '2026-08-30', discovered: true });
  // A day still in progress does not promote itself.
  assert.equal(newestComptagesWeek('2026-08-31T15:00:00+02:00').end, '2026-08-30');
  assert.equal(newestComptagesWeek('2026-09-06T23:00:00+02:00').end, '2026-08-30');
  // A completed Sunday does.
  assert.deepEqual(newestComptagesWeek('2026-09-07T00:00:00+02:00'),
    { start: '2026-08-31', end: '2026-09-06', discovered: true });
  // A discovery OLDER than the floor is a malformed answer, not a new fact.
  for (const bad of ['2025-01-01T00:00:00+01:00', null, undefined, 'garbage', '']) {
    const week = newestComptagesWeek(bad);
    assert.equal(week.start, COMPTAGES_WEEK_FLOOR);
    assert.equal(week.discovered, false, `${bad} must not read as a discovery`);
  }
});

test('every window bound is a full timestamp, because a bare date literal is day-granular', () => {
  const windows = comptagesWeekWindows(WEEK);
  // Verified against the live API on one arc: 120 rows / 48 rows / 168 rows.
  // `t_1h > date'2026-08-29'` skips the whole of the 29th, which is why the
  // hour is always spelled out.
  assert.deepEqual(windows.weekday, { from: '2026-08-24T01:00:00', to: '2026-08-29T00:00:00' });
  assert.deepEqual(windows.weekend, { from: '2026-08-29T01:00:00', to: '2026-08-31T00:00:00' });
  assert.deepEqual(windows.week, { from: '2026-08-24T01:00:00', to: '2026-08-31T00:00:00' });
  assert.equal(windows.stamp, '2026-08-31T00:00:00');
  assert.equal(windows.hours, 168);
  for (const bound of [windows.weekday.from, windows.weekday.to, windows.weekend.from,
    windows.weekend.to, windows.week.from, windows.week.to, windows.stamp]) {
    assert.match(bound, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  }
  assert.equal(comptagesShiftDay('2026-08-31', -1), '2026-08-30');
  assert.equal(comptagesShiftDay('nonsense', 1), null);
});

test('the profile is split on hour(t_1h) because grouped paging stops at 30 000', () => {
  // 2 977 arcs × 24 hours = 71 448 cells and the server refuses offset + limit
  // above 30 000 (HTTP 400 InvalidRESTParameterError, measured at 100 000). So
  // the split is in the WHERE clause, six hours of the clock at a time —
  // 17 862 cells a call, four calls a day-type.
  assert.equal(COMPTAGES_HOUR_BLOCKS.length, 4);
  assert.deepEqual(COMPTAGES_HOUR_BLOCKS.map((b) => b[1] - b[0]), [6, 6, 6, 6]);
  assert.equal(COMPTAGES_HOUR_BLOCKS[0][0], 0);
  assert.equal(COMPTAGES_HOUR_BLOCKS[3][1], COMPTAGES_HOURS);
  assert.ok(COMPTAGES_GROUP_LIMIT <= 30_000);

  const where = comptagesWindowWhere(comptagesWeekWindows(WEEK).weekday, COMPTAGES_HOUR_BLOCKS[3]);
  assert.equal(where,
    "t_1h>=date'2026-08-24T01:00:00' and t_1h<=date'2026-08-29T00:00:00' and hour(t_1h)>=18 and hour(t_1h)<24");
  assert.equal(comptagesStampWhere('2026-08-31T00:00:00'), "t_1h=date'2026-08-31T00:00:00'");

  // The alias `h` lives in group_by ONLY. Declaring it in both is HTTP 400
  // "Alias 'h' is declared several times".
  assert.match(COMPTAGES_PROFILE_GROUP_BY, /hour\(t_1h\) as h/);
  assert.equal(/\bas h\b/.test(COMPTAGES_PROFILE_SELECT), false);
  // count(q) and count(k) are what stop a mean over one Tuesday reading as a
  // mean over five weekdays: 4 407 of 71 448 weekday cells are partial.
  assert.match(COMPTAGES_PROFILE_SELECT, /count\(q\) as nq/);
  assert.match(COMPTAGES_PROFILE_SELECT, /count\(k\) as nk/);
  assert.equal(COMPTAGES_TIMEZONE, 'Europe/Paris');
});

test('a profile is keyed on the hour MEASURED, not on the stamp that closes it', () => {
  // t_1h is "fin de la période d'élaboration": the 09:00 stamp is 08:00–09:00
  // traffic. Get this wrong and every rush hour on every card is an hour late.
  const index = indexComptagesProfile([
    { iu_ac: '9', h: 9, f: 100, o: 5, nq: 5, nk: 5 },
    { iu_ac: '9', h: 0, f: 7, o: 1, nq: 5, nk: 5 },
  ]);
  const profile = index.get('9');
  assert.equal(profile.q[8], 100, 'the 09:00 stamp describes hour 08');
  assert.equal(profile.q[23], 7, 'the 00:00 stamp describes hour 23 of the day before');
  assert.equal(profile.q[9], null, 'nothing else is invented');
  // The phantom arc never becomes a profile.
  assert.equal(indexComptagesProfile([{ iu_ac: COMPTAGES_PHANTOM_ARC, h: 1, f: 1 }]).size, 0);
});

test('a measured ZERO survives the projection and an unmeasured hour stays null', () => {
  // 234 rows of the week publish q = 0 against 218 707 nulls. `avg(q) ?? 0`
  // would convert the second set into the first at a ratio of 935 : 1 and paint
  // 1 247 dead loops as empty roads. Arc 525, Bd Sébastopol, is the fixture:
  // it counted one weekday, hours 00–08 and 11–13, and hour 13 was ZERO.
  const arc = byId(projected(), '525');
  assert.equal(arc.wq[13], 0, 'a counted zero is a zero');
  assert.equal(arc.wq[12], 1);
  assert.equal(arc.wq[9], null, 'an hour nothing was published for stays null');
  assert.equal(arc.wq[23], null);
  assert.equal(arc.eq, null, 'a day-type with nothing at all ships as null, not as 24 zeros');
  assert.equal(arc.hq, 12, 'twelve counted hours out of 168');
  assert.equal(arc.s, 'counted', 'twelve hours of counting is counting');
  // And an arc the city declares INVALIDE can still be counting: 525 is one.
  assert.equal(arc.b, 'i');
});

test('the three states are decided on what was published, never on a colour field', () => {
  const pack = projected();
  assert.deepEqual(pack.states, { counted: 8, occupancy: 1, silent: 4 });
  // Occupancy without a count is a real measurement in another unit, and it
  // gets its own state rather than being folded into either neighbour.
  const quai = byId(pack, '1');
  assert.equal(quai.s, 'occupancy');
  assert.equal(quai.hq, 0);
  assert.equal(quai.hk, 167);
  assert.equal(quai.mq, null, 'no count means no mean, not a zero mean');
  // The mirror case: 168 counted hours and not one occupancy reading.
  const rivoli = byId(pack, '30');
  assert.equal(rivoli.s, 'counted');
  assert.equal(rivoli.hk, 0);
  assert.equal(rivoli.mk, null);
  assert.equal(rivoli.wk, null);
});

test('the silence is split by the operator’s own etat_barre', () => {
  // Across the full week, 724 of the 891 silent arcs are declared Invalide,
  // 26 Barré and 141 Ouvert — so four fifths of the silence is a sensor the
  // city has already written off, and 141 arcs are open and say nothing anyway.
  // The fixture carries one of each plus a second Invalide.
  const pack = projected();
  assert.deepEqual(pack.silentBy, { o: 1, b: 1, i: 2, unknown: 0 });
  assert.equal(byId(pack, '284').b, 'o');
  assert.equal(byId(pack, '25').b, 'b');
  assert.equal(byId(pack, '5').b, 'i');
  // DOMINANT over the week, not latest: an arc whose loop failed on Wednesday
  // is not a different installation on Thursday.
  const index = indexComptagesBarre([
    { iu_ac: '7', etat_barre: 'Ouvert', n: 40 },
    { iu_ac: '7', etat_barre: 'Invalide', n: 128 },
  ]);
  assert.deepEqual(index.get('7'), { code: 'i', hours: 128 });
  // The API returns French words, never the documented 0/1/2/3 integers.
  assert.deepEqual(Object.keys(COMPTAGES_BARRE_CODES).sort(),
    ['Barre', 'Barré', 'Invalide', 'Ouvert']);
  assert.equal(indexComptagesBarre([{ iu_ac: '7', etat_barre: '1', n: 9 }]).size, 0);
});

test('an arc with no published geometry is counted and named, never placed', () => {
  // 31 of 2 977 arcs have geometry null — the same 31 whose date_debut and
  // date_fin are also null — and all 31 are absent from the 3 739-row
  // referential, which has no geometry for them either. 19 are measuring.
  const pack = projected();
  assert.equal(pack.unplaced, 3);
  assert.equal(pack.unplacedMeasuring, 2);
  assert.equal(pack.placed, 10);
  const mallarme = byId(pack, '5201');
  assert.equal(mallarme.g, null);
  assert.equal(mallarme.s, 'counted');
  assert.equal(mallarme.hq, 158, 'it counts, it just cannot be drawn');
  assert.equal(mallarme.n, 'Av Mallarme');
  // Nothing anywhere in the row is a fabricated coordinate.
  for (const arc of pack.arcs) {
    assert.ok(arc.g === null || (Array.isArray(arc.g) && arc.g.length >= 2));
  }
});

test('the phantom arc is refused by name, not only by the where clause', () => {
  // iu_ac = "*" with every other field null. It is dropped by any filter on
  // t_1h — the shipping query returns 2 977 groups and not 2 989 — but a filter
  // that only works by accident is not one.
  assert.equal(UNFILTERED.results[0].iu_ac, COMPTAGES_PHANTOM_ARC);
  const pack = projectComptagesArcs({
    features: [
      { properties: { iu_ac: COMPTAGES_PHANTOM_ARC, libelle: null }, geometry: null },
      ...GEOJSON.features,
    ],
    weekday: WEEKDAY.results,
    weekend: WEEKEND.results,
    barre: BARRE.results,
    week: WEEK,
  });
  assert.equal(pack.phantom, 1);
  assert.equal(pack.count, 13);
  assert.equal(pack.arcs.some((arc) => arc.a === COMPTAGES_PHANTOM_ARC), false);
});

test('a duplicated arc id is counted once and reported, not drawn twice', () => {
  // The counts export gives 2 977 features for 2 977 distinct ids and this
  // never fires in production — but the REFERENTIAL gives 3 739 rows for 3 348
  // ids, and the day someone swaps the geometry source that has to be visible.
  const pack = projectComptagesArcs({
    features: [...GEOJSON.features, GEOJSON.features[0]],
    weekday: WEEKDAY.results,
    weekend: WEEKEND.results,
    barre: BARRE.results,
    week: WEEK,
  });
  assert.equal(pack.duplicates, 1);
  assert.equal(pack.count, 13);
});

test('a published name is de-punctuated and never re-accented', () => {
  // The city writes `Quai_de_la_Megisserie`. The underscores are punctuation
  // from a filename and go; the missing accents STAY missing, because guessing
  // at 892 street names would put something on the map nobody published.
  assert.equal(comptagesArcName('Quai_de_la_Megisserie'), 'Quai de la Megisserie');
  assert.equal(byId(projected(), '5').n, 'Quai de la Megisserie');
  // 437 of the 2 977 names already carry spaces.
  assert.equal(comptagesArcName('Avenue de New York'), 'Avenue de New York');
  // Four are junction pairs rather than street names, and all four are among
  // the 31 with no geometry. Passed through verbatim.
  assert.equal(byId(projected(), '7279').n, 'CF1424->CF0181');
  assert.equal(comptagesArcName('  '), null);
  assert.equal(comptagesArcName(null), null);
});

test('geometry is accepted only as a LineString of at least two real vertices', () => {
  assert.deepEqual(comptagesLine({ type: 'LineString', coordinates: [[2.333419, 48.860029], [2.335063, 48.859647]] }),
    [[2.33342, 48.86003], [2.33506, 48.85965]]);
  assert.equal(comptagesLine(null), null);
  assert.equal(comptagesLine({ type: 'Point', coordinates: [2.3, 48.8] }), null);
  assert.equal(comptagesLine({ type: 'LineString', coordinates: [[2.3, 48.8]] }), null);
  // An out-of-range ordinate is dropped rather than drawn into the ocean.
  assert.equal(comptagesLine({ type: 'LineString', coordinates: [[2.3, 148.8], [999, 4]] }), null);
  // The fixture's own vertex total, which is what the header's 7 449 is a
  // count of on the full pack.
  assert.equal(projected().vertices, 38);
});

test('a mean is over the hours that reported, and is null when none did', () => {
  assert.equal(comptagesProfileMean([10, null, 20]), 15);
  assert.equal(comptagesProfileMean([0, 0]), 0, 'a measured zero mean is zero');
  assert.equal(comptagesProfileMean([null, null]), null);
  assert.equal(comptagesProfileMean([]), null);
  assert.equal(comptagesProfileMean(null), null);
});

test('the pack carries its own provenance, licence and the week it describes', () => {
  const pack = projected();
  assert.equal(pack.dataset, COMPTAGES_DATASET);
  assert.equal(pack.licence, COMPTAGES_LICENCE);
  assert.equal(COMPTAGES_LICENCE, 'Open Database License (ODbL)');
  assert.deepEqual(pack.week, { start: '2026-08-24', end: '2026-08-30', discovered: true });
  // J-2: the batch that produced this week ran on the 1st for a week that
  // ended on the 30th. The card reads this, never a clock.
  assert.equal(pack.processedAt, '2026-09-01T01:02:50+00:00');
  assert.equal(pack.hours, 168);
  assert.equal(pack.weekdayHours, 120);
  assert.equal(pack.weekendHours, 48);
  assert.match(pack.source, /Ville de Paris/);
  // Busiest first, so a truncated read keeps the arcs a reader would keep.
  const means = pack.arcs.map((arc) => arc.mq ?? -1);
  assert.deepEqual(means, [...means].sort((a, b) => b - a));
});

test('an empty upstream produces an empty pack, not a throw and not a fake one', () => {
  const pack = projectComptagesArcs({ features: [], week: WEEK });
  assert.equal(pack.count, 0);
  assert.deepEqual(pack.states, { counted: 0, occupancy: 0, silent: 0 });
  assert.equal(pack.unplaced, 0);
  assert.equal(projectComptagesArcs().count, 0);
});

test('the fold ships the 48 slots the hour cursor navigates, gaps included', () => {
  // The renderer's chips scrub `wq` and `eq`, so what this projection ships is
  // the cursor's whole axis. Two invariants have to hold for the control to be
  // honest about what it is moving through.
  const pack = projected();
  for (const arc of pack.arcs) {
    for (const field of ['wq', 'eq', 'wk', 'ek']) {
      const slots = arc[field];
      if (slots === null) continue;
      // (1) EXACTLY 24 slots, always, so slot n is hour n and never an index
      // into a compacted list. A profile with the empty hours dropped would put
      // the evening peak wherever the gaps happened to fall.
      assert.equal(slots.length, COMPTAGES_HOURS, `${arc.a}.${field}`);
      // (2) every slot is a number or a null — never a coerced zero. The whole
      // week carries 234 measured zeroes against 218 707 nulls, and the cursor
      // draws the two differently.
      for (const value of slots) {
        assert.ok(value === null || Number.isFinite(value), `${arc.a}.${field} carries ${value}`);
      }
    }
    // A profile that measured nothing at all is `null` outright rather than 24
    // nulls, so "this day-type does not exist for this arc" is one check.
    if (arc.s === 'silent') {
      assert.equal(arc.wq, null);
      assert.equal(arc.eq, null);
    }
  }
  // Bd Sébastopol: 12 weekday hours published and none at the weekend. The gaps
  // are what make an hour cursor a claim rather than a slider — hour 09 is a
  // hole and hour 13 is a measured zero, in the same profile.
  const sebastopol = pack.arcs.find((arc) => arc.a === '525');
  assert.equal(sebastopol.wq[9], null);
  assert.equal(sebastopol.wq[13], 0);
  assert.equal(sebastopol.eq, null);
  assert.equal(sebastopol.s, 'counted', 'it counts — it just does not count all week');
});
