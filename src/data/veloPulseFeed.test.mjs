// src/data/veloPulseFeed.test.mjs
// Reading a typical week — and the rule the whole layer rests on: two cities
// measured by two instruments are never put on one scale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PULSE_RADIUS_FLOOR_M,
  PULSE_RADIUS_M_PER_ROOT_BIKE,
  PULSE_RADIUS_M_PER_ROOT_CYCLIST,
  PULSE_RAMP,
  PULSE_SLOTS,
  PULSE_UNSAMPLED_COLOR,
  networkBusiest,
  networkCurve,
  pulseBand,
  pulseColor,
  pulsePhrase,
  pulseRadiusM,
  pulseRampColor,
  pulseReading,
  pulseRelief,
  pulseSiteDetails,
  sitePeak,
  slotForDate,
  slotLabel,
  summarizePack,
  validatePack,
  valueAt,
  valueAtFraction,
  wrapSlot,
} from './veloPulseFeed.js';

/** A profile with a single spike, so every assertion can be read by eye. */
function profile(spikeSlot, spikeValue, base = 10) {
  const out = new Array(PULSE_SLOTS).fill(base);
  out[spikeSlot] = spikeValue;
  return out;
}

const LYON_SITE = Object.freeze({
  id: '1024', name: 'Bellecour', lon: 4.83, lat: 45.75, capacity: 40,
  profile: profile(8 * 1 + 8, 800, 200), samples: new Array(PULSE_SLOTS).fill(4),
});
const PARIS_SITE = Object.freeze({
  id: '100-200', name: 'Pont National', lon: 2.39, lat: 48.83, direction: 'SO-NE',
  profile: profile(32, 350, 40), samples: new Array(PULSE_SLOTS).fill(4),
});

const PACK = Object.freeze({
  slots: PULSE_SLOTS,
  window: { start: '2026-06-01', end: '2026-06-28', weeks: 4 },
  cities: {
    lyon: {
      label: 'Lyon — Vélo\'v', instrument: 'stock', unit: 'remplissage de la station, en %',
      scale: 1000, source: 'Métropole de Lyon', sites: [LYON_SITE],
    },
    paris: {
      label: 'Paris — compteurs vélo', instrument: 'flow', unit: 'cyclistes comptés par heure',
      scale: 1, source: 'Ville de Paris', sites: [PARIS_SITE],
    },
  },
});

// ── Slots ───────────────────────────────────────────────────────────────────

test('slot 0 is Monday midnight in PARIS, whatever clock the reader is on', () => {
  // 2026-06-01 is a Monday. Every instant below is written with an explicit
  // offset rather than local components, because "local" is the whole point:
  // the pack averages PARIS wall-clock hours, and the reader's computer is not
  // the instrument.
  assert.equal(slotForDate(new Date('2026-06-01T00:30:00+02:00')), 0);
  assert.equal(slotForDate(new Date('2026-06-01T08:59:00+02:00')), 8);
  assert.equal(slotForDate(new Date('2026-06-02T08:00:00+02:00')), 24 + 8, 'Tuesday 08:00');
  // Sunday must land at the END of the week, not the start.
  assert.equal(slotForDate(new Date('2026-06-07T23:00:00+02:00')), 6 * 24 + 23);
  // And winter, where the offset is +01:00 — a fixed offset would be wrong for
  // half the year, which is why the zone is named rather than numbered.
  assert.equal(slotForDate(new Date('2026-01-13T08:00:00+01:00')), 24 + 8);
});

test('the same instant reads as the same Paris hour from any time zone', () => {
  // THE BUG THIS TEST EXISTS FOR. `getDay()`/`getHours()` answer in the
  // reader's zone, so "MAINTENANT" showed a New York reader Tuesday 02:00 when
  // Paris was at Tuesday 08:00 — a different hour of the week, with every bike
  // figure on screen belonging to it.
  const instant = new Date('2026-06-02T08:00:00+02:00');
  assert.equal(slotForDate(instant), 24 + 8);
  // Proved against the formatter directly, since a unit test cannot change the
  // process time zone once `Intl` has been constructed: whatever the host is
  // set to, the slot is derived from the Paris hour and nothing else.
  const parisHour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23',
  }).format(instant));
  assert.equal(parisHour, 8);
  assert.equal(slotForDate(instant) % 24, parisHour);
  // A junk date is slot 0 rather than NaN, which would index a profile with
  // `undefined` and paint a whole network grey.
  assert.equal(slotForDate(new Date('nonsense')), 0);
});

test('a slot reads back as a day and an hour a French reader recognises', () => {
  assert.equal(slotLabel(0), 'lundi 00h');
  assert.equal(slotLabel(24 + 8), 'mardi 08h');
  assert.equal(slotLabel(167), 'dimanche 23h');
  assert.equal(slotLabel(168), '—');
  assert.equal(slotLabel(-1), '—');
  assert.equal(slotLabel(null), '—');
});

// ── Values and scale ────────────────────────────────────────────────────────

test('a scaled profile decodes to its real unit', () => {
  // Lyon stores occupancy in tenths of a percent so the pack holds integers.
  assert.equal(valueAt(LYON_SITE, 16, 1000), 80, '800 tenths of a percent is 80 %');
  assert.equal(valueAt(PARIS_SITE, 32, 1), 350, 'Paris counts are already the unit');
});

test('an unsampled slot stays null and is never filled in from a neighbour', () => {
  const holed = { ...PARIS_SITE, profile: [...PARIS_SITE.profile] };
  holed.profile[100] = null;
  assert.equal(valueAt(holed, 100, 1), null);
  assert.equal(valueAt(holed, 99, 1), 40, 'the neighbour is untouched');
  assert.equal(valueAt(null, 0, 1), null);
});

// ── Peaks ───────────────────────────────────────────────────────────────────

test('a site knows its own weekly peak and when it falls', () => {
  assert.deepEqual(sitePeak(LYON_SITE), { value: 800, slot: 16 });
  assert.deepEqual(sitePeak(PARIS_SITE), { value: 350, slot: 32 });
  assert.equal(sitePeak({ profile: new Array(PULSE_SLOTS).fill(null) }), null);
  assert.equal(sitePeak(null), null);
});

test('a FLOW network is busiest when its counters count the most', () => {
  const quiet = { profile: profile(32, 60, 50) };
  const loud = { profile: profile(100, 500, 10) };
  // Normalised against each site's own maximum, slot 100 is 50/60 + 500/500
  // and slot 32 is 60/60 + 10/500 — so the loud site's own peak wins.
  const city = { instrument: 'flow', sites: [quiet, loud] };
  assert.equal(networkBusiest(city).slot, 100);
});

test('a STOCK network is busiest when its docks are EMPTIEST', () => {
  // THE BUG THIS TEST EXISTS FOR. Summing raw occupancy and taking the maximum
  // put Lyon's "peak" at Wednesday 03:00, because a dock is fullest when
  // nobody is riding. A stock is the complement of the use.
  const station = { profile: profile(3, 100, 20) }; // full at slot 3, empty otherwise
  const city = { instrument: 'stock', sites: [station] };
  const busiest = networkBusiest(city);
  assert.notEqual(busiest.slot, 3, 'the fullest hour is the LEAST busy one');
  assert.equal(station.profile[busiest.slot], 20, 'it lands on an empty hour');
  // And the same profile read as a flow gives the opposite answer.
  assert.equal(networkBusiest({ instrument: 'flow', sites: [station] }).slot, 3);
});

test('a dock is read against its capacity, not against how full it ever got', () => {
  // THE BUG THIS TEST EXISTS FOR. Normalising a stock against the station's own
  // observed maximum makes every station reach "zero activity" at its own high
  // point, however low that high point is. Gorge de Loup tops out at 38,8 %
  // full all week in the shipped pack: under the old arithmetic its busiest
  // hour scored zero while 61,2 % of its bikes were out on the road.
  const capped = { profile: profile(3, 388, 100) }; // never more than 38,8 % full
  const city = { instrument: 'stock', scale: 1000, sites: [capped] };
  const busiest = networkBusiest(city);
  // Its fullest hour is its least active, but it is not a zero: 61,2 % of the
  // dock is empty even then.
  assert.equal(busiest.slot === 3, false, 'the fullest hour is still the least busy');
  assert.ok(busiest.score > 0.6, `a station that is never full is never idle either (${busiest.score})`);

  // And a station that is always empty is maximally used, not unusable data.
  const drained = { instrument: 'stock', scale: 1000, sites: [{ profile: profile(3, 0, 0) }] };
  assert.equal(networkBusiest(drained)?.score, 1);
});

test('an hour nobody reported is not an hour nobody cycled', () => {
  // THE BUG THIS TEST EXISTS FOR. The old code divided every slot by the whole
  // site count, so stations missing from an hour contributed nothing to the
  // numerator and stayed in the denominator: an archive outage during Monday
  // rush hour looked exactly like a quiet Monday.
  const busy = new Array(PULSE_SLOTS).fill(10);
  busy[40] = 500;
  const silent = new Array(PULSE_SLOTS).fill(10);
  silent[40] = null; // this counter missed the busiest hour entirely
  const city = { instrument: 'flow', sites: [{ profile: busy }, { profile: silent }] };
  const busiest = networkBusiest(city);
  assert.equal(busiest.slot, 40, 'the hour that was measured is still the busiest');
  assert.equal(busiest.coverage, 0.5, 'and the card can see only half of it reported');

  // Below the coverage floor a slot is not comparable at all, and cannot win.
  const sparse = Array.from({ length: 10 }, (_, i) => {
    const p = new Array(PULSE_SLOTS).fill(10);
    p[40] = i === 0 ? 5000 : null; // one site alone claims a spectacular hour
    return { profile: p };
  });
  assert.notEqual(
    networkBusiest({ instrument: 'flow', sites: sparse }).slot,
    40,
    'one site out of ten does not get to name the busiest hour of the network',
  );
});

test('each city weighs the same however many sites it has', () => {
  // 400 Lyon stations must not drown 111 Paris counters, and a 900-cyclist
  // counter must not drown a 40-cyclist one.
  const lyon = {
    instrument: 'stock',
    sites: Array.from({ length: 400 }, () => ({ profile: profile(3, 100, 90) })),
  };
  const paris = { instrument: 'flow', sites: [{ profile: profile(50, 900, 10) }] };
  const busiest = networkBusiest({ lyon, paris });
  // Lyon is near-full all week and barely moves; Paris has one enormous hour.
  assert.equal(busiest.slot, 50, 'the city with the real signal decides');
});

test('nothing to score answers null rather than slot zero', () => {
  assert.equal(networkBusiest({}), null);
  assert.equal(networkBusiest(null), null);
  assert.equal(networkBusiest({ a: { instrument: 'flow', sites: [] } }), null);
  assert.equal(networkBusiest({
    a: { instrument: 'flow', sites: [{ profile: new Array(PULSE_SLOTS).fill(null) }] },
  }), null);
});

// ── The ramp ────────────────────────────────────────────────────────────────

test('the colour is a share of the site\'s OWN peak, which is the only comparable thing', () => {
  // 350 out of 350 is the top band wherever the site is; 35 out of 350 is the
  // bottom band. The same absolute 350 would be a Lyon impossibility and a
  // Paris peak, which is why an absolute ramp is refused.
  assert.equal(pulseBand(350, 350), PULSE_RAMP.length - 1);
  assert.equal(pulseBand(35, 350), 0);
  assert.equal(pulseBand(175, 350), 2, 'exactly half is the middle band');
  // The same SHARE gives the same band in both cities.
  assert.equal(pulseBand(80, 80), pulseBand(350, 350));
});

test('an unsampled slot is grey, and grey is not the bottom band', () => {
  assert.equal(pulseColor(null, 350), PULSE_UNSAMPLED_COLOR);
  assert.equal(pulseBand(null, 350), -1);
  assert.equal(pulseBand(10, 0), -1, 'a site with no peak cannot be banded');
  assert.notEqual(PULSE_UNSAMPLED_COLOR, PULSE_RAMP[0].color,
    '"no reading" and "the quietest hour" must not look the same');
});

test('the bands are labelled by share, never by a word that would be backwards', () => {
  // "pointe" would be false for half the pack: a Vélo'v station at its weekly
  // maximum is at its FULLEST, which is the middle of the night.
  for (const band of PULSE_RAMP) assert.match(band.label, /%/);
});

test('the five bands are five distinct colours', () => {
  assert.equal(new Set(PULSE_RAMP.map((band) => band.color)).size, PULSE_RAMP.length);
});

// ── The size of a blob ──────────────────────────────────────────────────────

test('a stock is drawn as bikes and a flow as cyclists, each in its own unit', () => {
  const lyonCity = PACK.cities.lyon;
  const parisCity = PACK.cities.paris;
  // 80 % of a 40-stand station is 32 bikes, and the disc's AREA carries them:
  // radius grows as the square root, so twice the bikes is twice the ink.
  assert.equal(
    pulseRadiusM(80, lyonCity, LYON_SITE),
    Math.sqrt(32) * PULSE_RADIUS_M_PER_ROOT_BIKE,
  );
  assert.equal(
    pulseRadiusM(350, parisCity, PARIS_SITE),
    Math.sqrt(350) * PULSE_RADIUS_M_PER_ROOT_CYCLIST,
  );
  // Twice the quantity is twice the area, not twice the radius.
  const one = pulseRadiusM(175, parisCity, PARIS_SITE);
  const two = pulseRadiusM(350, parisCity, PARIS_SITE);
  assert.ok(Math.abs((two * two) / (one * one) - 2) < 1e-9, `${one} → ${two}`);
});

test('the two scales are chosen so neither city is a scatter beside the other', () => {
  // A full 40-stand Lyon dock and a 350/h Paris counter must draw comparable
  // discs, or the layer invites exactly the comparison it refuses to make.
  const lyonFull = pulseRadiusM(100, PACK.cities.lyon, LYON_SITE);
  const parisPeak = pulseRadiusM(350, PACK.cities.paris, PARIS_SITE);
  assert.ok(lyonFull > parisPeak * 0.7 && lyonFull < parisPeak * 1.4,
    `${lyonFull} m vs ${parisPeak} m`);
});

test('nothing to draw is nothing at all, and an empty dock still has a floor', () => {
  assert.equal(pulseRadiusM(null, PACK.cities.lyon, LYON_SITE), 0);
  // An empty dock at 04:00 is a MEASUREMENT — the bikes are out on the road —
  // so it keeps a mark and stays clickable.
  assert.equal(pulseRadiusM(0, PACK.cities.paris, PARIS_SITE), PULSE_RADIUS_FLOOR_M);
  // A Lyon station with no published capacity still draws rather than vanishing.
  assert.ok(pulseRadiusM(50, PACK.cities.lyon, { ...LYON_SITE, capacity: null }) > 0);
});

// ── The colour the field paints ─────────────────────────────────────────────

test('the continuous ramp passes through the bands the legend names', () => {
  // The legend's vocabulary is five bands; the map fills the gaps between them
  // so an animated site swells across a threshold instead of snapping.
  assert.equal(pulseRampColor(0), 'rgb(44, 62, 107)', 'the bottom band, exactly');
  assert.equal(pulseRampColor(1), 'rgb(232, 96, 60)', 'the top band, exactly');
  // Unsampled is the same grey the legend shows, written in the ramp's own
  // notation rather than a second grey nobody would notice had drifted.
  assert.equal(pulseRampColor(null), 'rgb(74, 85, 104)');
  assert.equal(PULSE_UNSAMPLED_COLOR, '#4a5568');
  // The middle bands are reached exactly too, at their own midpoints — the
  // legend's swatch is a colour that really is on the map.
  assert.equal(pulseRampColor(0.5), 'rgb(73, 179, 176)');
  assert.equal(pulseRampColor(0.7), 'rgb(240, 192, 74)');
  // And it is continuous: no share is a jump away from the share beside it,
  // which is the whole reason the animation stopped strobing.
  const channels = (share) => pulseRampColor(share).match(/\d+/g).map(Number);
  let previous = channels(0);
  for (let step = 1; step <= 100; step += 1) {
    const current = channels(step / 100);
    for (let index = 0; index < 3; index += 1) {
      assert.ok(Math.abs(current[index] - previous[index]) <= 12,
        `channel ${index} jumped at ${step}/100`);
    }
    previous = current;
  }
});

// ── Between the hours ───────────────────────────────────────────────────────

test('the week is a loop, so a position off either end comes back onto it', () => {
  assert.equal(wrapSlot(0), 0);
  assert.equal(wrapSlot(PULSE_SLOTS), 0, 'Sunday 23:00 is followed by Monday 00:00');
  assert.equal(wrapSlot(-1), PULSE_SLOTS - 1);
  assert.equal(wrapSlot(PULSE_SLOTS + 3.5), 3.5);
});

test('the animation eases between two measured hours', () => {
  const site = { profile: new Array(PULSE_SLOTS).fill(null) };
  site.profile[10] = 100;
  site.profile[11] = 200;
  assert.equal(valueAtFraction(site, 10), 100, 'on the hour, the hour');
  assert.equal(valueAtFraction(site, 10.5), 150);
  assert.equal(valueAtFraction(site, 10.75), 175);
});

test('an hour nobody sampled is never filled in from its neighbours', () => {
  const site = { profile: new Array(PULSE_SLOTS).fill(null) };
  site.profile[10] = 100;
  // The hour we are IN has no reading: the site is unsampled and stays so, at
  // every fraction of it. A neighbour's number is not an answer for it.
  assert.equal(valueAtFraction(site, 11), null);
  assert.equal(valueAtFraction(site, 11.5), null);
  // A hole AHEAD is held rather than faded into: easing toward a missing hour
  // would draw a station emptying when in fact nobody looked.
  assert.equal(valueAtFraction(site, 10.5), 100);
});

// ── The week's own shape ────────────────────────────────────────────────────

test('the curve the strip draws is the curve POINTE freezes on', () => {
  const curve = networkCurve(PACK.cities);
  assert.equal(curve.values.length, PULSE_SLOTS);
  assert.equal(curve.peakSlot, networkBusiest(PACK.cities).slot,
    'the strip and the chip must never point at two different hours');
  assert.equal(curve.values[curve.peakSlot], 1, 'the peak is the top of the strip');
  assert.equal(networkCurve({}), null, 'nothing to draw is null, not a flat week');
});

test('the words track the same stretched curve as the bars', () => {
  const curve = networkCurve(PACK.cities);
  assert.equal(pulseRelief(curve.peakSlot, curve), 1);
  assert.equal(pulseRelief(curve.quietSlot, curve), 0);
  assert.equal(pulseRelief(0, null), null);
  assert.match(pulsePhrase(curve.peakSlot, curve), /pointe/);
  assert.match(pulsePhrase(0, null), /non relevée|week-end/);
});

// ── The reading a card prints ───────────────────────────────────────────────

test('the card names the unit, because the two cities do not share one', () => {
  assert.match(pulseReading(80, PACK.cities.lyon, LYON_SITE), /80 % pleine/);
  assert.match(pulseReading(80, PACK.cities.lyon, LYON_SITE), /32 vélos sur 40/);
  assert.match(pulseReading(350, PACK.cities.paris, PARIS_SITE), /350 cyclistes par heure/);
  assert.match(pulseReading(null, PACK.cities.paris, PARIS_SITE), /non échantillonné/);
  // A station with no capacity says the percentage and does not invent a count.
  const noCapacity = pulseReading(80, PACK.cities.lyon, { ...LYON_SITE, capacity: null });
  assert.match(noCapacity, /80 % pleine/);
  assert.ok(!/vélos sur/.test(noCapacity));
});

// ── The pack contract ───────────────────────────────────────────────────────

test('a valid pack passes and every way of being broken is named', () => {
  assert.deepEqual(validatePack(PACK), { ok: true, reason: null });
  assert.equal(validatePack(null).ok, false);
  assert.equal(validatePack({ ...PACK, slots: 24 }).ok, false);
  assert.equal(validatePack({ slots: PULSE_SLOTS }).ok, false);
  const noSites = { ...PACK, cities: { lyon: { ...PACK.cities.lyon, sites: [] } } };
  assert.match(validatePack(noSites).reason, /no sites/);
  const badInstrument = { ...PACK, cities: { lyon: { ...PACK.cities.lyon, instrument: 'vibes' } } };
  assert.match(validatePack(badInstrument).reason, /instrument/);
  const shortProfile = {
    ...PACK,
    cities: { lyon: { ...PACK.cities.lyon, sites: [{ id: 'x', profile: [1, 2, 3] }] } },
  };
  assert.match(validatePack(shortProfile).reason, /profile length/);
});

test('the summary keeps the two instruments apart', () => {
  const summary = summarizePack(PACK);
  assert.equal(summary.cities, 2);
  assert.equal(summary.sites, 2);
  assert.equal(summary.byCity.lyon.instrument, 'stock');
  assert.equal(summary.byCity.paris.instrument, 'flow');
  assert.notEqual(summary.byCity.lyon.unit, summary.byCity.paris.unit);
  assert.equal(summary.byCity.paris.peakLabel, slotLabel(32));
  assert.deepEqual(summary.window, PACK.window);
});
