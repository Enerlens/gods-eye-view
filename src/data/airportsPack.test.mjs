// src/data/airportsPack.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  AIRPORT_DISPLAY_FLOORS,
  AIRPORT_DRAWN_FOOTPRINT_SUFFIX,
  AIRPORT_DRAWN_RUNWAY_SUFFIX,
  AIRPORT_LENGTH_CLASSES,
  AIRPORT_LENGTH_UNKNOWN,
  AIRPORT_TIERS,
  AIRPORT_TIER_STYLES,
  AIRPORT_TYPE_LABELS,
  FOOTPRINT_MAX_ANCHOR_OFFSET_M,
  FRENCH_TERRITORY_CODES,
  airportCardDetails,
  airportFootprintRings,
  airportIcaoCode,
  airportLabelPriority,
  airportLengthClass,
  airportLengthClassOf,
  airportLengthLegend,
  airportRenderSpec,
  airportRunwaySegments,
  airportTier,
  airportTierLegend,
  airportTierVisible,
  attachAirportFootprints,
  greatCircleMetres,
  isPackedAirport,
  runwayGeometry,
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

test('the tier asks one question — is a seat sold — and the size bucket never overrides it', () => {
  // The service question answers on its own, whatever the size bucket says.
  // This is the inversion: `large_airport` used to be read first, which seated
  // Le Bourget above airports that actually sell seats.
  for (const type of ['large_airport', 'medium_airport', 'small_airport', 'heliport']) {
    assert.equal(airportTier({ type, scheduled: true }), 'airline', type);
  }

  // What is left splits on COVERAGE, not on size: clause (a) is worldwide,
  // clause (c) is France-only.
  assert.equal(airportTier({ type: 'large_airport' }), 'airport');
  assert.equal(airportTier({ type: 'medium_airport' }), 'airport');

  // A heliport is not an "aéroport sans ligne", and neither is a missing type:
  // the bottom tier is the COMPLEMENT of the two worldwide classes, not a list.
  for (const type of ['small_airport', 'heliport', 'seaplane_base', 'balloonport']) {
    assert.equal(airportTier({ type }), 'airfield', type);
  }
  assert.equal(airportTier({ type: 'something_new_upstream' }), 'airfield');
  assert.equal(airportTier({}), 'airfield');
  assert.equal(airportTier(null), 'airfield');

  // `scheduled` is a hard flag: only an explicit true lifts a field.
  assert.equal(airportTier({ type: 'small_airport', scheduled: 'yes' }), 'airfield');
  assert.equal(airportTier({ type: 'small_airport', scheduled: false }), 'airfield');
});

test('every tier is drawn distinctly, and the ramp descends with importance', () => {
  const keys = AIRPORT_TIERS.map((tier) => tier.key);
  assert.deepEqual(keys, ['airline', 'airport', 'airfield'], 'order is the ladder');
  assert.deepEqual(Object.keys(AIRPORT_TIER_STYLES).sort(), [...keys].sort());

  // Two tiers sharing a colour would make the ladder unreadable.
  assert.equal(new Set(AIRPORT_TIERS.map((t) => t.color)).size, keys.length);

  // SIZE IS NOT A TIER CHANNEL ANY MORE. It carries the published runway
  // length; a tier-shaped `pixelSize` back on the ladder would win the merge in
  // the renderer against every field whose runway was never measured.
  for (const tier of AIRPORT_TIERS) {
    assert.equal(tier.pixelSize, undefined, `${tier.key} must not size by tier`);
    assert.equal(AIRPORT_TIER_STYLES[tier.key].pixelSize, undefined, tier.key);
  }

  // Card range descends with the same ladder: a lesser field makes you come
  // closer before it takes a label cell away from a bigger one.
  const ranges = AIRPORT_TIERS.map((tier) => tier.cardMaxDistance);
  assert.ok(ranges.every(Number.isFinite), `every tier needs a card range: ${ranges}`);
  assert.deepEqual(ranges, [...ranges].sort((a, b) => b - a), `card ranges must descend: ${ranges}`);

  // Marker range descends too, and is never SHORTER than the card range: a name
  // offered for a mark nobody can see is a card floating over nothing.
  const marks = AIRPORT_TIERS.map((tier) => tier.markerMaxDistance);
  assert.ok(marks.every(Number.isFinite), `every tier needs a marker range: ${marks}`);
  assert.deepEqual(marks, [...marks].sort((a, b) => b - a), `marker ranges must descend: ${marks}`);
  for (const tier of AIRPORT_TIERS) {
    assert.ok(tier.markerMaxDistance >= tier.cardMaxDistance,
      `${tier.key}: the mark must arrive before its card`);
  }
  // The France-only tier is the one this channel exists for.
  assert.equal(AIRPORT_TIERS.at(-1).key, 'airfield');
  assert.ok(AIRPORT_TIERS.at(-1).markerMaxDistance <= 1_000_000,
    'the 100 %-French tier must not be drawn from orbit');

  // The styles handed to the layer must carry exactly the four channels it reads.
  for (const tier of AIRPORT_TIERS) {
    assert.deepEqual(AIRPORT_TIER_STYLES[tier.key], {
      color: tier.color,
      stemWidth: tier.stemWidth,
      cardMaxDistance: tier.cardMaxDistance,
      markerMaxDistance: tier.markerMaxDistance,
    }, tier.key);
  }
});

test('the tier legend declares the marker range, because nothing on screen can', () => {
  const rows = airportTierLegend(new Map([
    ['airline', { total: 2, visible: 2 }],
    ['airfield', { total: 10, visible: 4 }],
  ]));
  assert.equal(rows.length, 2);
  // The top tier is drawn at the shared ceiling, so it claims no range at all.
  assert.ok(!/Marque affichée/.test(rows[0].blurb), rows[0].blurb);
  assert.match(rows[1].blurb, /Marque affichée sous 900 km\./);
  assert.match(rows[1].blurb, /6 masqués$/);
  assert.equal(rows[1].count, 4);
});

test('length classes are frozen domain thresholds, and an unpublished length is not a short one', () => {
  const mins = AIRPORT_LENGTH_CLASSES.map((entry) => entry.minM);
  assert.deepEqual(mins, [3000, 1800, 1000, 0], 'operational bounds, not quantiles');
  const sizes = AIRPORT_LENGTH_CLASSES.map((entry) => entry.pixelSize);
  assert.deepEqual(sizes, [...sizes].sort((a, b) => b - a), `diameters must descend: ${sizes}`);
  assert.equal(new Set(sizes).size, sizes.length, 'two classes may not share a diameter');

  assert.equal(airportLengthClass({ runways: { longestM: 4215 } }), 'len3000');
  assert.equal(airportLengthClass({ runways: { longestM: 3000 } }), 'len3000');
  assert.equal(airportLengthClass({ runways: { longestM: 2999 } }), 'len1800');
  assert.equal(airportLengthClass({ runways: { longestM: 1000 } }), 'len1000');
  assert.equal(airportLengthClass({ runways: { longestM: 441 } }), 'len0');

  // A1: never the same mark for a measurement and its absence.
  for (const props of [{}, null, { runways: {} }, { runways: { longestM: 0 } }]) {
    assert.equal(airportLengthClass(props), 'nolength', JSON.stringify(props));
  }
  // The ring must not be reachable by any measured diameter, or it would read
  // as a class rather than as a refusal.
  assert.ok(!sizes.includes(AIRPORT_LENGTH_UNKNOWN.pixelSize),
    'the unmeasured ring shares a diameter with a measured class');
});

test('the render spec sizes by the measurement, rings what was never published, and carries the shape', () => {
  const geom = [[2.55274, 48.9957, 2.61018, 48.9988, 45]];
  const drawn = airportRenderSpec({ runways: { longestM: 4215, geom } });
  assert.equal(drawn.pixelSize, 18);
  assert.equal(drawn.hollow, false);
  // The floor of the drawn segment IS the pastille it grew out of.
  assert.equal(drawn.lineFloorPx, drawn.pixelSize);
  assert.equal(drawn.lines.length, 1);
  assert.deepEqual(drawn.lines[0], {
    lon1: 2.55274, lat1: 48.9957, lon2: 2.61018, lat2: 48.9988, widthM: 45,
  });
  // The suffix is what lets ONE tally answer two questions.
  assert.equal(drawn.key, `len3000${AIRPORT_DRAWN_RUNWAY_SUFFIX}`);
  assert.equal(airportLengthClassOf(drawn.key), 'len3000');

  const sized = airportRenderSpec({ runways: { longestM: 1500 } });
  assert.equal(sized.key, 'len1000', 'no geometry, no suffix');
  assert.equal(sized.lines.length, 0);

  const unknown = airportRenderSpec({});
  assert.equal(unknown.hollow, true);
  assert.equal(unknown.pixelSize, AIRPORT_LENGTH_UNKNOWN.pixelSize);
  assert.equal(unknown.key, 'nolength');

  // An airport is not a footprint this pack ships: the surface half of the
  // render contract must stay untouched, or the loader would try to fill one.
  for (const spec of [drawn, sized, unknown]) {
    assert.equal(spec.surface, null);
    assert.equal(spec.extrudedHeightM, null);
  }
});

test('a 3 000 m runway buys its own orbital range, and an aeroclub never does', () => {
  // The one thing the retired `hub` tier did that size could not: keep Roissy
  // nameable from orbit. It now rides on the measurement instead of the bucket.
  const roissy = airportRenderSpec({ type: 'large_airport', scheduled: true, runways: { longestM: 4215 } });
  assert.equal(roissy.cardMaxDistance, 14_000_000);
  assert.equal(roissy.markerMaxDistance, 14_000_000);

  // And it is the LENGTH that buys it, not the ticket: an air base with a long
  // runway had no honest reason to hide while a shorter regional airport drew.
  const airbase = airportRenderSpec({ type: 'medium_airport', runways: { longestM: 3000 } });
  assert.equal(airbase.cardMaxDistance, 14_000_000, '3 000 m is inclusive');

  // Everything shorter defers to its tier — null, never 0, which the renderer
  // would read as "wherever the horizon allows".
  for (const longestM of [2999, 1200, 8]) {
    const spec = airportRenderSpec({ type: 'medium_airport', runways: { longestM } });
    assert.equal(spec.cardMaxDistance, null, `${longestM} m must not reach orbit`);
    assert.equal(spec.markerMaxDistance, null, `${longestM} m must not reach orbit`);
  }
  const unmeasured = airportRenderSpec({ type: 'medium_airport' });
  assert.equal(unmeasured.cardMaxDistance, null, 'an unpublished length is not a long one');

  // THE REFUSAL. The bottom tier is 100 % French by selection, so no runway
  // length may lift one of its fields to orbit — that would draw a French
  // aerodrome density belonging to the pack rather than to the world.
  const club = airportRenderSpec({ type: 'small_airport', runways: { longestM: 4000 } });
  assert.equal(airportTier({ type: 'small_airport' }), 'airfield');
  assert.equal(club.cardMaxDistance, null, 'an aeroclub is never drawn from orbit');
  assert.equal(club.markerMaxDistance, null, 'an aeroclub is never drawn from orbit');

  // Selling a seat takes the same strip out of that tier, and the refusal with it.
  const shuttle = airportRenderSpec({ type: 'small_airport', scheduled: true, runways: { longestM: 4000 } });
  assert.equal(shuttle.cardMaxDistance, 14_000_000);
});

test('the size legend prints its bounds, counts what is drawn, and names the runway mark', () => {
  const rows = airportLengthLegend(new Map([
    ['len3000+rw', { total: 1200, visible: 900 }],
    ['len3000', { total: 80, visible: 80 }],
    ['nolength', { total: 300, visible: 300 }],
  ]));
  assert.deepEqual(rows.map((r) => r.label), [
    '3 000 m et plus', 'Longueur non publiée', 'Piste tracée',
  ]);
  // The two halves of one class sum back into one row…
  assert.equal(rows[0].count, 980);
  // …and the drawn half also answers on its own.
  assert.equal(rows[2].count, 900);
  assert.match(rows[0].blurb, /1 000, 1 800, 3 000 m/, 'the frozen bounds are printed');
  assert.match(rows[1].blurb, /[Aa]nneau creux/);
  // One colour across every size row: the datum is the swatch, not the hue.
  assert.equal(new Set(rows.map((r) => r.color)).size, 1);
  assert.ok(rows.every((r) => r.glyph.startsWith('data:image/svg+xml;base64,')));

  // A class nobody drew is absent, not zero: the row would promise a mark.
  assert.deepEqual(airportLengthLegend(new Map()), []);
});

test('runway geometry refuses the two rows that would put a runway in the wrong place', () => {
  // Charles de Gaulle 08L/26R, verbatim from runways.csv.
  const real = {
    closed: '0',
    le_longitude_deg: '2.55274', le_latitude_deg: '48.9957',
    he_longitude_deg: '2.61018', he_latitude_deg: '48.9988',
    length_ft: '13829', width_ft: '148',
  };
  const anchor = { lon: 2.55412, lat: 49.00896 };
  assert.deepEqual(runwayGeometry([real], anchor), [[2.55274, 48.9957, 2.61018, 48.9988, 45]]);

  // Refusal 1 — the two published numbers disagree by more than the tolerance.
  assert.deepEqual(runwayGeometry([{ ...real, length_ft: '3000' }], anchor), []);
  // …but a disagreement inside it is kept: upstream rounds, and so do we.
  assert.equal(runwayGeometry([{ ...real, length_ft: '13000' }], anchor).length, 1);

  // Refusal 2 — the runway is joined to the wrong field.
  assert.deepEqual(runwayGeometry([real], { lon: 2.55412, lat: 49.5 }), []);
  // With no anchor the offset test simply does not run.
  assert.equal(runwayGeometry([real], null).length, 1);

  // Closed, unplaceable, Null Island, and one threshold entered twice.
  assert.deepEqual(runwayGeometry([{ ...real, closed: '1' }], anchor), []);
  assert.deepEqual(runwayGeometry([{ ...real, he_latitude_deg: '' }], anchor), []);
  assert.deepEqual(runwayGeometry([{
    closed: '0',
    le_longitude_deg: '0', le_latitude_deg: '0',
    he_longitude_deg: '0', he_latitude_deg: '0.01',
  }], anchor), []);
  assert.deepEqual(runwayGeometry([{
    closed: '0',
    le_longitude_deg: '2.5', le_latitude_deg: '49',
    he_longitude_deg: '2.5', he_latitude_deg: '49',
  }], anchor), []);
  assert.deepEqual(runwayGeometry(null), []);

  // A1 on the third channel: an unpublished width is OMITTED, never defaulted,
  // so the renderer can never stroke a thickness nobody measured.
  const { width_ft: _drop, ...noWidth } = real;
  assert.deepEqual(runwayGeometry([noWidth], anchor), [[2.55274, 48.9957, 2.61018, 48.9988]]);

  // Longest first — the layer draws index 0 alone at range.
  const short = {
    ...real,
    le_longitude_deg: '2.55857', le_latitude_deg: '49.01577',
    he_longitude_deg: '2.5646', he_latitude_deg: '49.01609',
    length_ft: '1444', width_ft: '98',
  };
  const ordered = runwayGeometry([short, real], anchor);
  assert.equal(ordered.length, 2);
  assert.deepEqual(ordered[0], [2.55274, 48.9957, 2.61018, 48.9988, 45], 'longest first');
});

test('the shipped geometry is read back defensively, and a stale pack simply has no shape', () => {
  assert.deepEqual(airportRunwaySegments({}), []);
  assert.deepEqual(airportRunwaySegments({ runways: {} }), [], 'a pack built before the shape');
  assert.deepEqual(airportRunwaySegments({ runways: { geom: 'nope' } }), []);
  assert.deepEqual(airportRunwaySegments({ runways: { geom: [[1, 2, 3]] } }), [], 'too short');
  assert.deepEqual(airportRunwaySegments({ runways: { geom: [[1, 2, 3, null]] } }), []);
  assert.deepEqual(airportRunwaySegments({ runways: { geom: [[1, 2, 3, 4]] } }), [
    { lon1: 1, lat1: 2, lon2: 3, lat2: 4, widthM: null },
  ]);
  assert.deepEqual(airportRunwaySegments({ runways: { geom: [[1, 2, 3, 4, 0]] } }), [
    { lon1: 1, lat1: 2, lon2: 3, lat2: 4, widthM: null },
  ], 'a zero width is no width');
});

test('the display floors slice the ladder from the top down', () => {
  const ids = AIRPORT_DISPLAY_FLOORS.map((floor) => floor.id);
  // Three chips, one axis. GRANDS is gone: it asked about size, which the size
  // channel answers without a filter.
  assert.deepEqual(ids, ['all', 'airports', 'airlines']);

  // Every floor keeps the top tier, every floor is a strict prefix of the
  // ladder, and each one is strictly smaller than the last.
  let previous = Infinity;
  for (const floor of AIRPORT_DISPLAY_FLOORS) {
    assert.ok(floor.keep.includes('airline'), `${floor.id} must keep the scheduled fields`);
    assert.deepEqual(floor.keep, AIRPORT_TIERS.slice(0, floor.keep.length).map((t) => t.key),
      `${floor.id} must be a top-down prefix of the ladder`);
    assert.ok(floor.keep.length < previous, `${floor.id} must narrow the view`);
    previous = floor.keep.length;
  }

  assert.equal(airportTierVisible('airfield', { floor: 'all' }), true);
  assert.equal(airportTierVisible('airfield', { floor: 'airports' }), false);
  assert.equal(airportTierVisible('airport', { floor: 'airlines' }), false);
  assert.equal(airportTierVisible('airline', { floor: 'airlines' }), true);

  // An unknown or absent floor shows everything — never nothing. A params
  // typo must not silently blank the layer.
  assert.equal(airportTierVisible('airfield', { floor: 'nonsense' }), true);
  assert.equal(airportTierVisible('airfield', {}), true);
  assert.equal(airportTierVisible('airfield'), true);
});

test('the legend counts what is DRAWN, and names what it hides', () => {
  const tally = new Map([
    ['airline', { total: 118, visible: 118 }],
    ['airfield', { total: 1126, visible: 0 }],
  ]);
  const legend = airportTierLegend(tally);
  // `airport` had no features at all, so it is absent rather than listed as 0.
  assert.deepEqual(legend.map((entry) => entry.label),
    ['Aéroport de ligne', 'Aérodrome & aéroclub']);
  assert.deepEqual(legend.map((entry) => entry.count), [118, 0]);
  assert.match(legend[1].blurb, /1126 masqués$/, 'a hidden tier says so');
  assert.ok(!/masqué/.test(legend[0].blurb), 'a fully drawn tier says nothing about hiding');
  assert.deepEqual(airportTierLegend(null), []);
});

test('the label ladder is the tier ladder, and nothing else', () => {
  const cdg = airportLabelPriority({ type: 'large_airport', iata: 'CDG', scheduled: true });
  const beauvais = airportLabelPriority({ type: 'medium_airport', iata: 'BVA', scheduled: true });
  const bricy = airportLabelPriority({ type: 'medium_airport' });
  const lognes = airportLabelPriority({ type: 'small_airport' });
  // Roissy and Beauvais both sell seats, so they now share a rung — the ladder
  // no longer re-ranks them by a size bucket. Roissy still wins the cell, on
  // the channel that measures: 18 px of runway against Beauvais' 13.
  assert.equal(cdg, beauvais);
  assert.ok(beauvais > bricy && bricy > lognes,
    `ladder must descend (${beauvais} > ${bricy} > ${lognes})`);

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

test('the shipped pack has the shape the three-tier ladder was chosen on', () => {
  const features = readFileSync(PACK, 'utf8')
    .split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
  const french = new Set(FRENCH_TERRITORY_CODES);

  const tally = { airline: 0, airport: 0, airfield: 0 };
  let foreignAirfields = 0;
  let orbitalAirfields = 0;
  for (const { properties } of features) {
    const tier = airportTier(properties);
    tally[tier] += 1;
    if (tier !== 'airfield') continue;
    // THE CLAIM THE LADDER RESTS ON: the bottom tier is France-only, because
    // clause (c) of the selection policy has no foreign counterpart. Every
    // non-French small field in the pack is here on clause (b) — a sold seat —
    // and therefore ranks `airline`.
    if (!french.has(properties.countryCode)) foreignAirfields += 1;
    // And the corollary the range refusal exists for: none of them is long
    // enough to ask for orbit in the first place. Measured, not assumed.
    if (Number(properties.runways?.longestM) >= AIRPORT_LENGTH_CLASSES[0].minM) orbitalAirfields += 1;
  }

  assert.equal(foreignAirfields, 0, 'the aeroclub tier must stay 100 % French');
  assert.equal(orbitalAirfields, 0,
    'an aeroclub with a 3 000 m runway would exercise the range refusal — check it still holds');

  // Floors, not equalities: a rebuild that shifts a few fields between tiers is
  // upstream working, one that empties a tier is a broken ladder.
  assert.ok(tally.airline > 4000, `scheduled tier collapsed (${tally.airline})`);
  assert.ok(tally.airport > 1800, `unscheduled airport tier collapsed (${tally.airport})`);
  assert.ok(tally.airfield > 1000, `aeroclub tier collapsed (${tally.airfield})`);

  // Paris-Le Bourget is why the ladder was inverted: Europe's busiest business
  // airport, and it sells no scheduled seat. It must NOT rank as a line airport,
  // which is what the LIGNES chip promises to keep.
  const byIcao = new Map(features.filter((f) => f.properties.icao)
    .map((f) => [f.properties.icao, f.properties]));
  const bourget = byIcao.get('LFPB');
  assert.ok(bourget, 'Le Bourget must ship');
  assert.notEqual(bourget.scheduled, true, 'Le Bourget sells no scheduled seat');
  assert.equal(airportTier(bourget), 'airport');
  // Roissy, which does, sits one rung above it.
  assert.equal(airportTier(byIcao.get('LFPG')), 'airline');
});

test('the shipped pack still has the runway shape the size and line channels were chosen on', () => {
  const features = readFileSync(PACK, 'utf8')
    .split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
  const french = new Set(FRENCH_TERRITORY_CODES);

  let withLength = 0;
  let withGeometry = 0;
  let frenchTotal = 0;
  let frenchWithGeometry = 0;
  let segments = 0;
  for (const feature of features) {
    const props = feature.properties;
    if (props.runways?.longestM > 0) withLength += 1;
    const shape = airportRunwaySegments(props);
    if (french.has(props.countryCode)) frenchTotal += 1;
    if (shape.length === 0) continue;
    withGeometry += 1;
    segments += shape.length;
    if (french.has(props.countryCode)) frenchWithGeometry += 1;

    // Longest first is a contract the renderer relies on: it draws index 0
    // alone at range and opens the rest of the field only close in.
    const spans = shape.map((s) => greatCircleMetres(s.lon1, s.lat1, s.lon2, s.lat2));
    assert.deepEqual(spans, [...spans].sort((a, b) => b - a),
      `${props.name}: segments must ship longest first`);
    // Refusal 2, verified on the shipped bytes rather than on the build's word.
    for (const segment of shape) {
      const [lon, lat] = feature.geometry.coordinates;
      const offset = greatCircleMetres(
        lon, lat, (segment.lon1 + segment.lon2) / 2, (segment.lat1 + segment.lat2) / 2,
      );
      assert.ok(offset <= 10_000, `${props.name}: runway ${Math.round(offset)} m from its field`);
    }
  }

  // Floors, not equalities — upstream gains and loses rows every day. Measured
  // 2026-09-07: 6 150 lengths, 4 790 shaped fields, 6 698 segments, 279 French.
  assert.ok(withLength > 5800, `runway lengths collapsed (${withLength})`);
  assert.ok(withGeometry > 4500, `runway shapes collapsed (${withGeometry})`);
  assert.ok(segments > 6300, `drawn runways collapsed (${segments})`);

  // THE ASYMMETRY IS THE DESIGN CONSTRAINT, so it is pinned. The French long
  // tail is the half upstream never georeferenced: if this ever rose above a
  // third, the layer could start treating the runway as its primary sign — and
  // until then it must not. See the pack header.
  assert.ok(frenchWithGeometry / frenchTotal < 0.35,
    `French geometry coverage rose to ${(100 * frenchWithGeometry / frenchTotal).toFixed(1)}% —`
    + ' re-read the "runway can never be the only sign" argument before relying on it');

  // Every shaped field is also a sized one, so the drawn segment always has a
  // floor to fall back on. The reverse is not true and must not be assumed.
  for (const feature of features) {
    if (airportRunwaySegments(feature.properties).length === 0) continue;
    assert.notEqual(airportLengthClass(feature.properties), AIRPORT_LENGTH_UNKNOWN.key,
      `${feature.properties.name} has a shape but no published length`);
  }

  const byIcao = new Map(features.filter((f) => f.properties.icao)
    .map((f) => [f.properties.icao, f.properties]));
  // Roissy ships all five runway records, and the fifth is the 440 m grass
  // helicopter lane 08H/26H that makes `count: 5` read as a hub with five
  // strips. Drawn to scale beside the four real ones, it explains itself.
  const cdg = airportRunwaySegments(byIcao.get('LFPG'));
  assert.equal(cdg.length, 5);
  const cdgSpans = cdg.map((s) => Math.round(greatCircleMetres(s.lon1, s.lat1, s.lon2, s.lat2)));
  assert.ok(cdgSpans[0] > 4100 && cdgSpans[0] < 4300, `LFPG longest ${cdgSpans[0]} m`);
  assert.ok(cdgSpans[4] < 600, `LFPG shortest ${cdgSpans[4]} m — the helicopter lane`);
  assert.equal(cdg[4].widthM, 30);

  // Issy is the case the layer must keep drawable as a ring: a real published
  // heliport with a runway record and no threshold coordinates at all.
  assert.deepEqual(airportRunwaySegments(byIcao.get('LFPI')), []);
});

/* ── Footprints — the IGN outline joined onto an OurAirports field ───────── */

/** A BD TOPO feature, with only the fields the join reads. */
function ignFeature(overrides = {}, ring = null) {
  const { properties = {}, ...rest } = overrides;
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      // ~1.1 km × 1.1 km at the equator — comfortably over the hectare floor.
      coordinates: [ring || [[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]]],
    },
    properties: { nature: 'Aérodrome', usage: 'Civil', ...properties },
    ...rest,
  };
}

/** A packed feature, at a point, with only what the join reads. */
function packed(properties = {}, coordinates = [0.005, 0.005]) {
  return { type: 'Feature', geometry: { type: 'Point', coordinates }, properties };
}

test('the footprint join reads the published key first, then containment', () => {
  const keyed = packed({ name: 'Keyed', icao: 'LFXX' }, [3, 3]);
  const unkeyed = packed({ name: 'Unkeyed', localCode: 'XX' }, [0.005, 0.005]);
  const outside = packed({ name: 'Elsewhere', localCode: 'YY' }, [40, 40]);
  const features = [keyed, unkeyed, outside];
  const report = attachAirportFootprints(features, [
    // The keyed outline sits at (3,3) with the field inside it.
    ignFeature({ properties: { code_icao: 'LFXX' } },
      [[2.995, 2.995], [3.005, 2.995], [3.005, 3.005], [2.995, 3.005], [2.995, 2.995]]),
    ignFeature(),
  ]);

  assert.equal(report.attached, 2);
  assert.equal(report.byKey, 1);
  assert.equal(report.byContainment, 1);
  assert.equal(keyed.properties.footprint.match, 'icao');
  assert.equal(unkeyed.properties.footprint.match, 'contains');
  assert.equal(outside.properties.footprint, undefined, 'a field outside every outline gets none');
  assert.equal(report.unattached, 0);
});

test('an outline two fields fall inside is refused for both, never tie-broken', () => {
  const left = packed({ name: 'Left', localCode: 'AA' }, [0.004, 0.005]);
  const right = packed({ name: 'Right', localCode: 'BB' }, [0.006, 0.005]);
  const report = attachAirportFootprints([left, right], [ignFeature()]);

  assert.equal(report.attached, 0);
  assert.equal(report.refusedShared, 2);
  assert.equal(left.properties.footprint, undefined);
  assert.equal(right.properties.footprint, undefined);
});

test('containment never claims a KEYED outline — that belongs to its own field', () => {
  // The field has no ICAO code and sits inside an outline that carries one.
  // Clause (b) reads unkeyed outlines only, so nothing attaches: the outline is
  // spoken for by a field that may simply not be in the pack.
  const field = packed({ name: 'Interloper', localCode: 'ZZ' });
  const report = attachAirportFootprints([field], [
    ignFeature({ properties: { code_icao: 'LFZZ' } }),
  ]);
  assert.equal(report.attached, 0);
  assert.equal(field.properties.footprint, undefined);
});

test('the two refusals on the outline itself: a pad, and a placeholder square', () => {
  const heliport = packed({ name: 'Pad', icao: 'LFAA' });
  const tiny = packed({ name: 'Speck', icao: 'LFBB' });
  const report = attachAirportFootprints([heliport, tiny], [
    // A heliport outline, large enough, and refused on nature alone.
    ignFeature({ properties: { code_icao: 'LFAA', nature: 'Héliport' } }),
    // BD TOPO's 5.2 m × 5.2 m placeholder: a coordinate wearing a polygon.
    ignFeature({ properties: { code_icao: 'LFBB' } },
      [[0, 0], [0.00005, 0], [0.00005, 0.00005], [0, 0.00005], [0, 0]]),
  ]);
  assert.equal(report.attached, 0);
  assert.equal(heliport.properties.footprint, undefined);
  assert.equal(tiny.properties.footprint, undefined);
  assert.equal(report.unattached, 0, 'a refused candidate never counts as unattached');
});

test('a key that lands kilometres from the field is a bad join, not a big airport', () => {
  const field = packed({ name: 'Far', icao: 'LFCC' }, [0, 0]);
  const report = attachAirportFootprints([field], [
    ignFeature({ properties: { code_icao: 'LFCC' } },
      [[1, 1], [1.01, 1], [1.01, 1.01], [1, 1.01], [1, 1]]),
  ]);
  assert.equal(report.attached, 0);
  assert.equal(report.refusedOffset, 1);
  assert.equal(field.properties.footprint, undefined);
});

test('usage ships only when it is not the ordinary civil case', () => {
  const military = packed({ name: 'Base', icao: 'LFDD' }, [3, 3]);
  const civil = packed({ name: 'Club', icao: 'LFEE' }, [0.005, 0.005]);
  attachAirportFootprints([military, civil], [
    ignFeature({ properties: { code_icao: 'LFDD', usage: 'Militaire' } },
      [[2.995, 2.995], [3.005, 2.995], [3.005, 3.005], [2.995, 3.005], [2.995, 2.995]]),
    ignFeature({ properties: { code_icao: 'LFEE' } }),
  ]);
  assert.equal(military.properties.footprint.use, 'Militaire');
  assert.equal(civil.properties.footprint.use, undefined);
  // 0.01° × 0.01° at 3° N — the fixture's own size, printed the French way.
  assert.equal(airportCardDetails(military.properties).at(-1), 'emprise IGN 123 ha · militaire');
});

test('a multi-part outline ships its largest ring, so the area and the drawing agree', () => {
  const field = packed({ name: 'Two parts', icao: 'LFFF' }, [0.005, 0.005]);
  const report = attachAirportFootprints([field], [{
    type: 'Feature',
    properties: { nature: 'Aérodrome', usage: 'Civil', code_icao: 'LFFF' },
    geometry: {
      type: 'MultiPolygon',
      coordinates: [
        [[[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]]],
        [[[0.5, 0.5], [0.502, 0.5], [0.502, 0.502], [0.5, 0.502], [0.5, 0.5]]],
      ],
    },
  }]);
  assert.equal(report.attached, 1);
  assert.equal(report.droppedParts, 1);
  assert.equal(field.properties.footprint.rings.length, 1);
  // The kept ring is the big one (124 ha at the equator), and the area is
  // measured on IT rather than on the 5 ha stub the other part contributes.
  assert.equal(field.properties.footprint.areaHa, 124);
});

test('the shipped footprint is read back defensively, and an older pack simply has none', () => {
  assert.deepEqual(airportFootprintRings({}), []);
  assert.deepEqual(airportFootprintRings({ footprint: {} }), []);
  assert.deepEqual(airportFootprintRings({ footprint: { rings: 'nope' } }), []);
  // Three positions cannot close a ring.
  assert.deepEqual(airportFootprintRings({ footprint: { rings: [[[0, 0], [1, 0], [0, 0]]] } }), []);
  assert.deepEqual(
    airportFootprintRings({ footprint: { rings: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }),
    [[[0, 0], [1, 0], [1, 1], [0, 0]]],
  );
  // One bad vertex refuses the whole ring rather than drawing a truncated one.
  assert.deepEqual(
    airportFootprintRings({ footprint: { rings: [[[0, 0], [1, null], [1, 1], [0, 0]]] } }),
    [],
  );
});

test('the render key carries both marks, and the class survives being read back', () => {
  const ring = [[0, 0], [0.01, 0], [0.01, 0.01], [0, 0]];
  const both = airportRenderSpec({
    runways: { longestM: 4215, geom: [[0, 0, 0.01, 0.01, 45]] },
    footprint: { areaHa: 2832, rings: [ring] },
  });
  assert.equal(both.key, `${AIRPORT_LENGTH_CLASSES[0].key}${AIRPORT_DRAWN_RUNWAY_SUFFIX}${AIRPORT_DRAWN_FOOTPRINT_SUFFIX}`);
  assert.equal(airportLengthClassOf(both.key), AIRPORT_LENGTH_CLASSES[0].key);
  assert.deepEqual(both.footprint, [ring]);

  // The aeroclub case the whole join exists for: no runway shape, an outline.
  const outlineOnly = airportRenderSpec({ runways: { longestM: 700 }, footprint: { rings: [ring] } });
  assert.ok(outlineOnly.key.endsWith(AIRPORT_DRAWN_FOOTPRINT_SUFFIX));
  assert.ok(!outlineOnly.key.includes(AIRPORT_DRAWN_RUNWAY_SUFFIX));
  assert.equal(airportLengthClassOf(outlineOnly.key), AIRPORT_LENGTH_CLASSES.at(-1).key);

  // And `surface` stays null: the outline is not the polygon Cesium parsed.
  assert.equal(both.surface, null);
});

test('the size legend names the outline, and counts it separately from the runway', () => {
  const rows = airportLengthLegend(new Map([
    [`${AIRPORT_LENGTH_CLASSES[0].key}${AIRPORT_DRAWN_RUNWAY_SUFFIX}${AIRPORT_DRAWN_FOOTPRINT_SUFFIX}`,
      { total: 5, visible: 5 }],
    [`len300${AIRPORT_DRAWN_FOOTPRINT_SUFFIX}`, { total: 200, visible: 120 }],
  ]));
  const footprintRow = rows.find((row) => row.label === 'Emprise au sol');
  const runwayRow = rows.find((row) => row.label === 'Piste tracée');
  assert.ok(footprintRow, 'a drawn mark must have a legend row (D1)');
  assert.equal(footprintRow.count, 125, 'the row counts what is DRAWN, both classes together');
  assert.equal(runwayRow.count, 5);
  assert.match(footprintRow.blurb, /IGN/, 'the row names the publisher the rest of the pack is not');
  assert.notEqual(footprintRow.glyph, runwayRow.glyph);
});

test('the shipped pack carries the IGN outlines the ground channel was chosen on', () => {
  const features = readFileSync(PACK, 'utf8')
    .split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
  const french = new Set(FRENCH_TERRITORY_CODES);

  let withFootprint = 0;
  let outlineOnly = 0;
  let byContainment = 0;
  let foreign = 0;
  let worstOffsetM = 0;
  let smallestHa = Infinity;
  for (const feature of features) {
    const props = feature.properties;
    const rings = airportFootprintRings(props);
    if (rings.length === 0) {
      assert.equal(props.footprint, undefined,
        `${props.name}: a footprint that cannot be read back must not ship`);
      continue;
    }
    withFootprint += 1;
    if (airportRunwaySegments(props).length === 0) outlineOnly += 1;
    if (props.footprint.match === 'contains') byContainment += 1;
    if (!french.has(props.countryCode)) foreign += 1;
    smallestHa = Math.min(smallestHa, props.footprint.areaHa);

    // ONE ring, always — the renderer draws a single hierarchy.
    assert.equal(rings.length, 1, `${props.name}: the pack ships one ring per field`);
    const ring = rings[0];
    assert.deepEqual(ring[0], ring[ring.length - 1], `${props.name}: the ring must close`);

    // The anchor guard, verified on the shipped bytes rather than the build's word.
    const [lon, lat] = feature.geometry.coordinates;
    let sumLon = 0;
    let sumLat = 0;
    for (const position of ring) { sumLon += position[0]; sumLat += position[1]; }
    const offset = greatCircleMetres(lon, lat, sumLon / ring.length, sumLat / ring.length);
    worstOffsetM = Math.max(worstOffsetM, offset);
    assert.ok(offset <= FOOTPRINT_MAX_ANCHOR_OFFSET_M,
      `${props.name}: outline centre ${Math.round(offset)} m from its field`);
  }

  // Floors, not equalities — BD TOPO and OurAirports both move. Measured on the
  // 2026-09-09 build: 418 footprints, 213 of them on fields with no runway
  // shape at all, 41 joined on containment, worst anchor offset 1 382 m.
  assert.ok(withFootprint > 380, `footprint join collapsed (${withFootprint})`);
  assert.ok(outlineOnly > 180,
    `the outline-only fields are the reason this join exists (${outlineOnly})`);
  assert.ok(byContainment > 20, `the containment clause stopped answering (${byContainment})`);
  assert.ok(smallestHa >= 1, `a sub-hectare outline shipped (${smallestHa} ha)`);
  assert.ok(worstOffsetM < FOOTPRINT_MAX_ANCHOR_OFFSET_M);

  // BD TOPO stops at the French border, and it overlaps it in both directions:
  // the French slice of Genève and San Sebastián, and the Brazilian bank of the
  // Oyapock facing Saint-Georges. A handful, never a wave.
  assert.ok(foreign <= 10,
    `${foreign} outlines landed on non-French fields — the coverage claim broke`);

  // Tahiti is the coverage limit, stated as a test: the busiest French airport
  // with no outline, because Polynésie is not in BD TOPO.
  const byIcao = new Map(features.filter((f) => f.properties.icao)
    .map((f) => [f.properties.icao, f.properties]));
  assert.equal(byIcao.get('NTAA')?.footprint, undefined, 'BD TOPO does not cover Polynésie');
  assert.ok(byIcao.get('LFPG')?.footprint?.areaHa > 2000, 'Roissy must carry its ground');
});

// ── The sky over the field ──────────────────────────────────────────────────
//
// The one line this pack cannot write. It is a fact about live traffic, held
// by a layer this module must never import, and it arrives through
// `layerJoins.js` — which means it is absent whenever the flights layer is
// off, and the card simply has one line fewer.

test('the card names what is flying to the field, when somebody is telling it', () => {
  const props = {
    name: 'Charles de Gaulle International Airport',
    type: 'large_airport',
    icao: 'LFPG',
    iata: 'CDG',
    municipality: 'Roissy-en-France',
    country: 'France',
    scheduled: true,
  };
  assert.deepEqual(airportCardDetails(props, {
    traffic: {
      inbound: 12, outbound: 8, fleet: 900,
      inboundSamples: ['AFR447', 'BAW303'], outboundSamples: ['DLH1041'],
    },
  }).at(-1), '12 en approche · 8 au départ — AFR447, BAW303, DLH1041');

  // One direction only prints one clause.
  assert.equal(airportCardDetails(props, {
    traffic: { inbound: 0, outbound: 3, fleet: 900, inboundSamples: [], outboundSamples: [] },
  }).at(-1), '3 au départ');
});

test('no traffic, no line — the pack never claims a sky it cannot see', () => {
  const props = { name: 'Argentan Airfield', type: 'small_airport', icao: 'LFAJ', country: 'France' };
  const bare = airportCardDetails(props);
  // The flights layer is off: `askJoin` answered null and the card is what it
  // has always been.
  assert.deepEqual(airportCardDetails(props, { traffic: null }), bare);
  // The layer is ON and nothing is flying there, which is a different fact and
  // still not a line: a grass strip with no traffic is the ordinary case, and
  // "0 en approche" on 7 000 cards would be noise.
  assert.deepEqual(airportCardDetails(props, {
    traffic: { inbound: 0, outbound: 0, fleet: 900, inboundSamples: [], outboundSamples: [] },
  }), bare);
  // A malformed answer cannot break a card either.
  assert.deepEqual(airportCardDetails(props, { traffic: 'yes' }), bare);
});
