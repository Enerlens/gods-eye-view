// src/data/airportsPack.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  AIRPORT_DISPLAY_FLOORS,
  AIRPORT_TIERS,
  AIRPORT_TIER_STYLES,
  AIRPORT_TYPE_LABELS,
  FRENCH_TERRITORY_CODES,
  airportCardDetails,
  airportIcaoCode,
  airportLabelPriority,
  airportTier,
  airportTierLegend,
  airportTierVisible,
  isPackedAirport,
  runwaySurfaceFamily,
  summarizeRunways,
} from './airportsPack.js';

const PACK = new URL('./local_data/airports/airports.geojsonl', import.meta.url);

/** One row shaped like airports.csv, with only the fields the policy reads. */
function row(overrides = {}) {
  return {
    ident: 'ZZZZ',
    type: 'small_airport',
    iso_country: 'US',
    scheduled_service: 'no',
    icao_code: '',
    local_code: '',
    ...overrides,
  };
}

// ── ICAO derivation ─────────────────────────────────────────────────────────

test('the ICAO indicator comes from icao_code, then from a four-letter ident', () => {
  assert.equal(airportIcaoCode(row({ icao_code: 'LFPG', ident: 'LFPG' })), 'LFPG');

  // Paris Issy — the case the rule exists for: upstream leaves icao_code empty
  // and puts the real published indicator in ident.
  assert.equal(airportIcaoCode(row({ ident: 'LFPI', icao_code: '' })), 'LFPI');

  // `ident === local_code` is upstream saying "this is a national code".
  assert.equal(airportIcaoCode(row({ ident: 'GRVE', local_code: 'GRVE' })), '');

  // Shape gates: three letters, five letters, digits, blank.
  assert.equal(airportIcaoCode(row({ ident: 'AEI' })), '');
  assert.equal(airportIcaoCode(row({ ident: 'FR-0001' })), '');
  assert.equal(airportIcaoCode(row({ ident: '00AA' })), '');
  assert.equal(airportIcaoCode(row({ ident: '' })), '');
  assert.equal(airportIcaoCode(null), '');

  // Case and padding are upstream noise, not identity.
  assert.equal(airportIcaoCode(row({ ident: ' lfpg ' })), 'LFPG');
});

// ── Selection policy ────────────────────────────────────────────────────────

test('the pack keeps large/medium airports and anything with scheduled service', () => {
  assert.equal(isPackedAirport(row({ type: 'large_airport' })), true);
  assert.equal(isPackedAirport(row({ type: 'medium_airport' })), true);
  // Monaco's heliport sells seats, so it ships even though it is a heliport
  // outside France.
  assert.equal(isPackedAirport(row({
    type: 'heliport', iso_country: 'MC', ident: 'LNMC', scheduled_service: 'yes',
  })), true);
  // A US grass strip with no scheduled service is the long tail we do not ship.
  assert.equal(isPackedAirport(row({ type: 'small_airport' })), false);
  assert.equal(isPackedAirport(row({ type: 'seaplane_base' })), false);
});

test('the pack keeps the whole French long tail, and only published French heliports', () => {
  for (const type of ['small_airport', 'seaplane_base', 'balloonport']) {
    assert.equal(isPackedAirport(row({ type, iso_country: 'FR' })), true, type);
  }
  // Overseas territories are France too — Roland Garros is `RE`, not `FR`.
  assert.equal(isPackedAirport(row({ type: 'small_airport', iso_country: 'RE' })), true);
  assert.equal(isPackedAirport(row({ type: 'small_airport', iso_country: 'PF' })), true);

  // Issy carries LFPI → kept. A hospital pad carries FR-0001 → dropped.
  assert.equal(isPackedAirport(row({
    type: 'heliport', iso_country: 'FR', ident: 'LFPI',
  })), true);
  assert.equal(isPackedAirport(row({
    type: 'heliport', iso_country: 'FR', ident: 'FR-0001',
  })), false);
});

test('closed aerodromes never ship, whatever else the row claims', () => {
  assert.equal(isPackedAirport(row({ type: 'closed', iso_country: 'FR' })), false);
  assert.equal(isPackedAirport(row({ type: 'closed', scheduled_service: 'yes' })), false);
  assert.equal(isPackedAirport(row({ type: '' })), false);
  assert.equal(isPackedAirport(null), false);
});

// ── Runway summary ──────────────────────────────────────────────────────────

test('the runway summary reports the longest OPEN runway, in metres', () => {
  // Charles de Gaulle, verbatim from runways.csv: five open rows, the longest
  // 13,829 ft, plus a 1,444 ft grass helicopter lane that upstream counts.
  const cdg = summarizeRunways([
    { length_ft: '1444', surface: 'GRASS', closed: '0', lighted: '0' },
    { length_ft: '13829', surface: 'ASP', closed: '0', lighted: '1' },
    { length_ft: '8858', surface: 'CON', closed: '0', lighted: '1' },
    { length_ft: '8858', surface: 'ASP', closed: '0', lighted: '1' },
    { length_ft: '13780', surface: 'ASP', closed: '0', lighted: '1' },
  ]);
  assert.deepEqual(cdg, { count: 5, longestM: 4215, surface: 'revêtue', lighted: true });

  // A closed runway is not a runway: excluded from the count AND from the
  // longest, so a shuttered field cannot advertise the strip it lost.
  assert.deepEqual(summarizeRunways([
    { length_ft: '12000', surface: 'ASP', closed: '1', lighted: '1' },
    { length_ft: '2400', surface: 'TURF', closed: '0', lighted: '0' },
  ]), { count: 1, longestM: 732, surface: 'non revêtue' });

  // Present but unmeasured: the count is real, the length is not invented.
  assert.deepEqual(summarizeRunways([{ length_ft: '', surface: '', closed: '0' }]), { count: 1 });
  assert.deepEqual(summarizeRunways([]), { count: 0 });
  assert.deepEqual(summarizeRunways(null), { count: 0 });
});

test('surface families classify the free-text column, and refuse what they cannot read', () => {
  assert.equal(runwaySurfaceFamily('ASP'), 'revêtue');
  assert.equal(runwaySurfaceFamily('ASPH-G'), 'revêtue');
  assert.equal(runwaySurfaceFamily('ASPH/ CONC'), 'revêtue');
  assert.equal(runwaySurfaceFamily('TURF-F'), 'non revêtue');
  assert.equal(runwaySurfaceFamily('PIÇARRA'), 'non revêtue');
  assert.equal(runwaySurfaceFamily('WATER'), 'eau');

  // The trap: `UNPAVED` contains `PAVED`. It must not classify as its opposite.
  assert.equal(runwaySurfaceFamily('UNPAVED'), 'non revêtue');
  assert.equal(runwaySurfaceFamily('PAVED'), 'revêtue');

  assert.equal(runwaySurfaceFamily('UNK'), '');
  assert.equal(runwaySurfaceFamily('X'), '');
  assert.equal(runwaySurfaceFamily(''), '');
  assert.equal(runwaySurfaceFamily(null), '');
});

// ── Card copy ───────────────────────────────────────────────────────────────

test('the card reads identity, then shape, then place — and omits what it lacks', () => {
  assert.deepEqual(airportCardDetails({
    name: 'Charles de Gaulle International Airport',
    type: 'large_airport',
    icao: 'LFPG',
    iata: 'CDG',
    municipality: 'Roissy-en-France',
    country: 'France',
    scheduled: true,
    runways: { count: 5, longestM: 4215, surface: 'revêtue', lighted: true },
  }), [
    'LFPG · CDG · vols réguliers',
    'Grand aéroport · piste 4 215 m revêtue',
    'Roissy-en-France · France',
  ]);

  // A grass strip, verbatim from the pack: no IATA, no scheduled service, no
  // surface family upstream could classify.
  assert.deepEqual(airportCardDetails({
    name: 'Argentan Airfield',
    type: 'small_airport',
    icao: 'LFAJ',
    municipality: 'Argentan, Orne',
    country: 'France',
    runways: { count: 1, longestM: 1000 },
  }), [
    'LFAJ',
    'Aérodrome · piste 1 000 m',
    'Argentan, Orne · France',
  ]);

  // ...and when the name already carries the place, the place line is not
  // repeated back at the reader.
  assert.deepEqual(airportCardDetails({
    name: 'Aérodrome de Bellegarde',
    type: 'small_airport',
    icao: 'LFHN',
    municipality: 'Bellegarde',
    country: 'France',
  }), ['LFHN', 'Aérodrome', 'France']);

  // A municipality that only repeats the name is dropped, not echoed.
  assert.deepEqual(airportCardDetails({
    name: 'Monaco Heliport',
    type: 'heliport',
    icao: 'LNMC',
    iata: 'MCM',
    municipality: 'Monaco',
    country: 'Monaco',
    scheduled: true,
  }), [
    'LNMC · MCM · vols réguliers',
    'Hélistation',
    'Monaco',
  ]);

  // Nothing to say is an empty card body, never a line of placeholders.
  assert.deepEqual(airportCardDetails({ name: 'Somewhere' }), []);
  assert.deepEqual(airportCardDetails(null), []);
});

test('thousands separate with an ordinary space, not a runtime-dependent one', () => {
  // No identity fields, so the shape line is the FIRST line, not the second.
  const [shape] = airportCardDetails({
    name: 'X', type: 'large_airport', runways: { count: 1, longestM: 4215 },
  });
  assert.equal(shape, 'Grand aéroport · piste 4 215 m');
  assert.ok(!/[\u00a0\u202f]/.test(shape), 'no narrow/non-breaking space may reach the card');
});

// ── Label priority ──────────────────────────────────────────────────────────

// ── Importance tiers ───────────────────────────────────────────────────────

test('the tier reads size first, then whether a ticket is sold', () => {
  // Roissy is BOTH large and scheduled. Taking the scheduled branch first would
  // empty the top tier of every airport that also sells seats — i.e. all of them.
  assert.equal(airportTier({ type: 'large_airport', scheduled: true }), 'hub');
  assert.equal(airportTier({ type: 'large_airport' }), 'hub');

  assert.equal(airportTier({ type: 'medium_airport', scheduled: true }), 'airline');
  assert.equal(airportTier({ type: 'small_airport', scheduled: true }), 'airline');
  assert.equal(airportTier({ type: 'heliport', scheduled: true }), 'airline');

  assert.equal(airportTier({ type: 'medium_airport' }), 'airport');

  for (const type of ['small_airport', 'heliport', 'seaplane_base', 'balloonport']) {
    assert.equal(airportTier({ type }), 'airfield', type);
  }
  assert.equal(airportTier(null), 'airfield');
});

test('every tier is drawn distinctly, and the ramp descends with importance', () => {
  const keys = AIRPORT_TIERS.map((tier) => tier.key);
  assert.deepEqual(keys, ['hub', 'airline', 'airport', 'airfield'], 'order is the ladder');
  assert.deepEqual(Object.keys(AIRPORT_TIER_STYLES).sort(), [...keys].sort());

  const sizes = AIRPORT_TIERS.map((tier) => tier.pixelSize);
  assert.deepEqual(sizes, [...sizes].sort((a, b) => b - a), `dot sizes must descend: ${sizes}`);
  // Two tiers sharing a colour or a size would make the ladder unreadable.
  assert.equal(new Set(AIRPORT_TIERS.map((t) => t.color)).size, keys.length);
  assert.equal(new Set(sizes).size, keys.length);

  // Card range descends with the same ladder: a lesser field makes you come
  // closer before it takes a label cell away from a bigger one.
  const ranges = AIRPORT_TIERS.map((tier) => tier.cardMaxDistance);
  assert.ok(ranges.every(Number.isFinite), `every tier needs a card range: ${ranges}`);
  assert.deepEqual(ranges, [...ranges].sort((a, b) => b - a), `card ranges must descend: ${ranges}`);
  // The styles handed to the layer must carry all four channels.
  for (const tier of AIRPORT_TIERS) {
    assert.deepEqual(AIRPORT_TIER_STYLES[tier.key], {
      color: tier.color,
      pixelSize: tier.pixelSize,
      stemWidth: tier.stemWidth,
      cardMaxDistance: tier.cardMaxDistance,
    }, tier.key);
  }
});

test('the display floors slice the ladder from the top down', () => {
  const ids = AIRPORT_DISPLAY_FLOORS.map((floor) => floor.id);
  assert.deepEqual(ids, ['all', 'airports', 'airlines', 'hubs']);

  // Every floor keeps the hub, every floor is a strict prefix of the ladder,
  // and each one is strictly smaller than the last.
  let previous = Infinity;
  for (const floor of AIRPORT_DISPLAY_FLOORS) {
    assert.ok(floor.keep.includes('hub'), `${floor.id} must keep the hubs`);
    assert.deepEqual(floor.keep, AIRPORT_TIERS.slice(0, floor.keep.length).map((t) => t.key),
      `${floor.id} must be a top-down prefix of the ladder`);
    assert.ok(floor.keep.length < previous, `${floor.id} must narrow the view`);
    previous = floor.keep.length;
  }

  assert.equal(airportTierVisible('airfield', { floor: 'all' }), true);
  assert.equal(airportTierVisible('airfield', { floor: 'airports' }), false);
  assert.equal(airportTierVisible('airport', { floor: 'airlines' }), false);
  assert.equal(airportTierVisible('hub', { floor: 'hubs' }), true);

  // An unknown or absent floor shows everything — never nothing. A params
  // typo must not silently blank the layer.
  assert.equal(airportTierVisible('airfield', { floor: 'nonsense' }), true);
  assert.equal(airportTierVisible('airfield', {}), true);
  assert.equal(airportTierVisible('airfield'), true);
});

test('the legend counts what is DRAWN, and names what it hides', () => {
  const tally = new Map([
    ['hub', { total: 27, visible: 27 }],
    ['airline', { total: 92, visible: 92 }],
    ['airfield', { total: 1126, visible: 0 }],
  ]);
  const legend = airportTierLegend(tally);
  // `airport` had no features at all, so it is absent rather than listed as 0.
  assert.deepEqual(legend.map((entry) => entry.label),
    ['Grand aéroport', 'Aéroport de ligne', 'Aérodrome & aéroclub']);
  assert.deepEqual(legend.map((entry) => entry.count), [27, 92, 0]);
  assert.match(legend[2].blurb, /1126 masqués$/, 'a hidden tier says so');
  assert.ok(!/masqué/.test(legend[0].blurb), 'a fully drawn tier says nothing about hiding');
  assert.deepEqual(airportTierLegend(null), []);
});

test('the label ladder is the tier ladder, and nothing else', () => {
  const cdg = airportLabelPriority({ type: 'large_airport', iata: 'CDG', scheduled: true });
  const beauvais = airportLabelPriority({ type: 'medium_airport', iata: 'BVA', scheduled: true });
  const bricy = airportLabelPriority({ type: 'medium_airport' });
  const lognes = airportLabelPriority({ type: 'small_airport' });
  assert.ok(cdg > beauvais && beauvais > bricy && bricy > lognes,
    `ladder must descend (${cdg} > ${beauvais} > ${bricy} > ${lognes})`);

  // Selling a seat lifts a grass strip out of the aéroclub tier entirely.
  assert.ok(
    airportLabelPriority({ type: 'small_airport', scheduled: true })
      > airportLabelPriority({ type: 'small_airport' }),
  );

  // The top step matches the ports ladder's, so neither bundled layer can
  // quietly outbid the other for a shared screen cell.
  assert.equal(cdg, 310);
  assert.equal(Number.isFinite(airportLabelPriority(null)), true);
});

// ── The shipped pack ────────────────────────────────────────────────────────

test('the shipped pack obeys the policy it documents', () => {
  const features = readFileSync(PACK, 'utf8')
    .split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));

  // Rebuilt 2026-08-31 from the OurAirports mirror: 7,464 features. Pinned as a
  // floor, not an equality — a rebuild that adds airfields is upstream working,
  // while a rebuild that HALVES the pack is a broken filter, and only the
  // second should fail here.
  assert.ok(features.length > 7000, `pack shrank unexpectedly (${features.length})`);

  const french = new Set(FRENCH_TERRITORY_CODES);
  let frenchCount = 0;
  for (const feature of features) {
    const props = feature.properties;
    assert.equal(feature.type, 'Feature');
    assert.equal(feature.geometry.type, 'Point');
    const [lon, lat] = feature.geometry.coordinates;
    assert.ok(Number.isFinite(lon) && Math.abs(lon) <= 180, `bad longitude on ${props.name}`);
    assert.ok(Number.isFinite(lat) && Math.abs(lat) <= 90, `bad latitude on ${props.name}`);
    assert.ok(!(lon === 0 && lat === 0), `Null Island position on ${props.name}`);
    assert.ok(props.name, 'every feature is named');
    assert.ok(Object.hasOwn(AIRPORT_TYPE_LABELS, props.type), `unlabelled type ${props.type}`);
    assert.notEqual(props.type, 'closed');
    // The card is written from these properties, so the properties must satisfy
    // the policy that selected them.
    assert.equal(isPackedAirport({
      type: props.type,
      iso_country: props.countryCode,
      scheduled_service: props.scheduled ? 'yes' : 'no',
      ident: props.icao || '',
      icao_code: props.icao || '',
    }), true, `${props.name} would not be re-selected by the policy`);
    if (french.has(props.countryCode)) frenchCount += 1;
  }

  assert.ok(frenchCount > 1200, `French coverage collapsed (${frenchCount})`);

  const byIcao = new Map(features.filter((f) => f.properties.icao)
    .map((f) => [f.properties.icao, f.properties]));

  // Spot checks whose values are independently known. Roissy's longest runway
  // is 4,215 m; Orly's is 3,650 m; JFK's 13R/31L is 14,511 ft = 4,423 m.
  assert.equal(byIcao.get('LFPG')?.runways?.longestM, 4215);
  assert.equal(byIcao.get('LFPO')?.runways?.longestM, 3650);
  assert.equal(byIcao.get('KJFK')?.runways?.longestM, 4423);
  assert.equal(byIcao.get('LFPG')?.iata, 'CDG');

  // The two published French heliports are in; the hospital pads are not.
  assert.ok(byIcao.has('LFPI'), 'Paris Issy-les-Moulineaux must ship');
  const unpublishedPads = features.filter((f) => f.properties.type === 'heliport'
    && f.properties.countryCode === 'FR'
    && !f.properties.icao && f.properties.scheduled !== true)
    .map((f) => f.properties.name);
  assert.deepEqual(unpublishedPads, [],
    'a French heliport ships only with an ICAO indicator or a scheduled service');
  // Clause (b) is what keeps the two that have no ICAO code: both run a real
  // scheduled shuttle (Nice–Cannes, Fromentine–Yeu).
  const scheduledPads = features.filter((f) => f.properties.type === 'heliport'
    && f.properties.countryCode === 'FR' && f.properties.scheduled === true);
  assert.ok(scheduledPads.length >= 2, 'the scheduled French heliports must survive');

  // The overseas territories are present, which `FR` alone would have missed.
  for (const icao of ['FMEE', 'NTAA', 'TFFR', 'SOCA']) {
    assert.ok(byIcao.has(icao), `${icao} (overseas France) must ship`);
  }

  // Identity is unique where it exists: two rows sharing an ICAO indicator
  // means the join or the upstream merge went wrong.
  const icaos = features.map((f) => f.properties.icao).filter(Boolean);
  assert.equal(new Set(icaos).size, icaos.length, 'duplicate ICAO indicator in the pack');
});
