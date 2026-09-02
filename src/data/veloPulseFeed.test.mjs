// src/data/veloPulseFeed.test.mjs
// Reading a typical week — and the rule the whole layer rests on: two cities
// measured by two instruments are never put on one scale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PULSE_METRES_PER_BIKE,
  PULSE_METRES_PER_CYCLIST,
  PULSE_RAMP,
  PULSE_SLOTS,
  PULSE_UNSAMPLED_COLOR,
  networkBusiest,
  pulseBand,
  pulseColor,
  pulseHeightM,
  pulseReading,
  sitePeak,
  slotForDate,
  slotLabel,
  summarizePack,
  validatePack,
  valueAt,
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

test('slot 0 is Monday midnight, local time', () => {
  // 2026-06-01 is a Monday. Constructed with local components on purpose: the
  // pack was built from local wall-clock hours in both cities, and reading it
  // back in UTC would shift the whole picture by an hour or two by season.
  assert.equal(slotForDate(new Date(2026, 5, 1, 0, 30)), 0);
  assert.equal(slotForDate(new Date(2026, 5, 1, 8, 59)), 8);
  assert.equal(slotForDate(new Date(2026, 5, 2, 8, 0)), 24 + 8, 'Tuesday 08:00');
  // Sunday must land at the END of the week, not the start.
  assert.equal(slotForDate(new Date(2026, 5, 7, 23, 0)), 6 * 24 + 23);
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

// ── Height ──────────────────────────────────────────────────────────────────

test('a stock is drawn as bikes and a flow as cyclists, each in its own unit', () => {
  const lyonCity = PACK.cities.lyon;
  const parisCity = PACK.cities.paris;
  // 80 % of a 40-stand station is 32 bikes.
  assert.equal(pulseHeightM(80, lyonCity, LYON_SITE), 32 * PULSE_METRES_PER_BIKE);
  assert.equal(pulseHeightM(350, parisCity, PARIS_SITE), 350 * PULSE_METRES_PER_CYCLIST);
});

test('the two scales are chosen so neither city is a plain beside the other', () => {
  // A full 40-stand Lyon dock and a 350/h Paris counter must reach comparable
  // heights, or the layer invites exactly the comparison it refuses to make.
  const lyonFull = pulseHeightM(100, PACK.cities.lyon, LYON_SITE);
  const parisPeak = pulseHeightM(350, PACK.cities.paris, PARIS_SITE);
  assert.ok(lyonFull > parisPeak * 0.7 && lyonFull < parisPeak * 1.4,
    `${lyonFull} m vs ${parisPeak} m`);
});

test('nothing to draw is zero height, and a tiny value still has a floor', () => {
  assert.equal(pulseHeightM(null, PACK.cities.lyon, LYON_SITE), 0);
  assert.equal(pulseHeightM(0, PACK.cities.paris, PARIS_SITE), 4, 'a floor keeps it clickable');
  // A Lyon station with no published capacity still draws rather than vanishing.
  assert.ok(pulseHeightM(50, PACK.cities.lyon, { ...LYON_SITE, capacity: null }) > 0);
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
