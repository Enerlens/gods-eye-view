// What a parcel does not say about itself — the address and the buildings —
// and the three ways joining those in is easy to get confidently wrong.
//
// The join is GEOMETRIC. No published key says "this building is on that
// parcel", so every number here is a measurement of a stated rule rather than a
// fact from a register, and the tests are mostly about the rule being applied
// honestly: the same building counted once however many tiles it appears in, a
// building on the neighbour not claimed, and an address that is 200 m away not
// printed as if it were this one.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADDRESS_MAX_DISTANCE_M,
  addressLine,
  buildingLines,
  dimensionLine,
  footprintCentroid,
  parcelSpanM,
  projectBanAddress,
  summarizeParcelBuildings,
} from './cadastreParcelDetail.js';

/** A 100 m square at the equator-ish scale of Paris, as a parcel. */
const PARCEL = {
  polygons: [[[[2.2800, 48.8600], [2.2814, 48.8600], [2.2814, 48.8609], [2.2800, 48.8609], [2.2800, 48.8600]]]],
  areaM2: 10000,
};

/** A square footprint centred on `lon`/`lat`, `half` degrees to a side. */
function building(lon, lat, half, properties = {}) {
  return {
    properties,
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [lon - half, lat - half], [lon + half, lat - half],
        [lon + half, lat + half], [lon - half, lat + half], [lon - half, lat - half],
      ]],
    },
  };
}

/** Normalize every Unicode space to a plain one before matching copy. */
function flat(text) {
  return String(text).replace(/[   ]/g, ' ');
}

// ── Trap 1: one building, several tiles ─────────────────────────────────────

test('a building that appears in two tiles is counted once', () => {
  // Vector tiles carry a buffer, so a footprint near an edge arrives in both
  // tiles it touches — clipped differently in each. Measured over Paris 16e:
  // a naive join reported 25 buildings on a parcel that has 14, and one
  // identifier appeared three times at 2 983, 13 and 5 042 m².
  const cleabs = 'BATIMENT0000000245169856';
  const summary = summarizeParcelBuildings([
    building(2.2805, 48.8604, 0.0002, { cleabs }),
    building(2.2805, 48.8604, 0.0002, { cleabs }),
    building(2.2805, 48.8604, 0.0002, { cleabs }),
  ], PARCEL);
  assert.equal(summary.count, 1);
});

test('the LARGEST piece of a split building is the one kept', () => {
  // The tile that holds more of a building holds the better single estimate of
  // its footprint. Summing the pieces would count the buffered overlap twice,
  // which is how one parcel came out 89% built instead of 56%.
  const cleabs = 'BATIMENT0000000245169856';
  const small = summarizeParcelBuildings([building(2.2805, 48.8604, 0.0001, { cleabs })], PARCEL);
  const large = summarizeParcelBuildings([building(2.2805, 48.8604, 0.0003, { cleabs })], PARCEL);
  const both = summarizeParcelBuildings([
    building(2.2805, 48.8604, 0.0001, { cleabs }),
    building(2.2805, 48.8604, 0.0003, { cleabs }),
  ], PARCEL);
  assert.equal(both.count, 1);
  assert.equal(both.footprintM2, large.footprintM2);
  assert.ok(large.footprintM2 > small.footprintM2);
});

test('a building with no identifier at all is kept, not merged into its neighbour', () => {
  // 0 of 1 202 features in a sampled tile lacked `cleabs`, but keying an
  // unidentified building on the empty string would silently collapse every
  // such building on a parcel into one.
  const summary = summarizeParcelBuildings([
    building(2.2804, 48.8603, 0.0001, {}),
    building(2.2810, 48.8606, 0.0001, {}),
  ], PARCEL);
  assert.equal(summary.count, 2);
  assert.equal(summary.anonymous, 2);
});

test('the RNB identifier stands in when cleabs is absent', () => {
  const summary = summarizeParcelBuildings([
    building(2.2805, 48.8604, 0.0002, { identifiants_rnb: '2NPB8CCYQ237/XYZ' }),
    building(2.2805, 48.8604, 0.0002, { identifiants_rnb: '2NPB8CCYQ237/XYZ' }),
  ], PARCEL);
  assert.equal(summary.count, 1);
  assert.equal(summary.anonymous, 0);
});

// ── Trap 2: the join is a rule, not a register ──────────────────────────────

test('a building whose centre is on the neighbour is not claimed', () => {
  const summary = summarizeParcelBuildings([
    building(2.2805, 48.8604, 0.0001, { cleabs: 'A' }), // inside
    building(2.2830, 48.8604, 0.0001, { cleabs: 'B' }), // well outside
    building(2.2900, 48.8700, 0.0001, { cleabs: 'C' }), // another quarter
  ], PARCEL);
  assert.equal(summary.count, 1);
});

test('coverage is clamped at 100%, because the rule can exceed the parcel', () => {
  // A building joined by its centre contributes its WHOLE footprint, so a
  // dense parcel with an overhanging block can compute past its own surface.
  // Over 100% reads as broken data when it is a property of the rule.
  const summary = summarizeParcelBuildings(
    [building(2.2807, 48.86045, 0.0009, { cleabs: 'A' })],
    { ...PARCEL, areaM2: 200 },
  );
  assert.equal(summary.coverage, 1);
  assert.ok(summary.footprintM2 > 200);
});

test('coverage is null rather than zero when the parcel has no usable area', () => {
  const summary = summarizeParcelBuildings(
    [building(2.2805, 48.8604, 0.0001, { cleabs: 'A' })],
    { polygons: PARCEL.polygons, areaM2: null },
  );
  assert.equal(summary.coverage, null);
});

test('every building line names the rule it measured', () => {
  const summary = summarizeParcelBuildings([building(2.2805, 48.8604, 0.0002, { cleabs: 'A' })], PARCEL);
  const lines = buildingLines(summary);
  assert.ok(lines.some((line) => /centre d'emprise/.test(line)), lines.join(' | '));
  assert.ok(lines.some((line) => /BD TOPO/.test(line)), lines.join(' | '));
});

test('an empty parcel says so, and says differently when the search was bounded', () => {
  const empty = summarizeParcelBuildings([], PARCEL);
  assert.equal(empty.count, 0);
  assert.match(buildingLines(empty, false)[0], /Aucun bâtiment BD TOPO/);
  // A parcel too big for the tile budget has NOT been shown to be empty.
  assert.match(buildingLines(empty, true)[0], /partielle/);
});

test('the building line carries height, storeys, dwellings and use', () => {
  const summary = summarizeParcelBuildings([
    building(2.2804, 48.8603, 0.0002, {
      cleabs: 'A', hauteur: 27.1, nombre_d_etages: 7, nombre_de_logements: 24, usage_1: 'Résidentiel',
    }),
    building(2.2810, 48.8606, 0.0001, {
      cleabs: 'B', hauteur: 12, nombre_d_etages: 3, nombre_de_logements: 6, usage_1: 'Résidentiel',
    }),
  ], PARCEL);
  assert.equal(summary.count, 2);
  assert.equal(summary.tallestM, 27.1);
  assert.equal(summary.storeys, 7);
  assert.equal(summary.dwellings, 30);
  assert.deepEqual(summary.usages[0], { name: 'Résidentiel', count: 2 });
  const lines = buildingLines(summary).map(flat);
  assert.match(lines[0], /^2 bâtiments · [\d ]+ m² au sol · \d+ % de la parcelle$/);
  assert.match(lines[1], /R\+7 · 27 m de haut · 30 logements · résidentiel/);
});

test('`Indifférencié` is not a use and does not become the headline', () => {
  // 83-87% of buildings on a French urban tile carry it. Printing it would
  // spend the card's most useful line saying nothing.
  const summary = summarizeParcelBuildings(
    [building(2.2805, 48.8604, 0.0002, { cleabs: 'A', usage_1: 'Indifférencié' })],
    PARCEL,
  );
  assert.deepEqual(summary.usages, []);
});

test('a missing dwelling count is null, not a confident zero', () => {
  const summary = summarizeParcelBuildings([building(2.2805, 48.8604, 0.0002, { cleabs: 'A' })], PARCEL);
  assert.equal(summary.dwellings, null);
  assert.ok(!buildingLines(summary).some((line) => /logements/.test(line)));
});

// ── Trap 3: the address is the nearest one ──────────────────────────────────

const BAN = {
  type: 'FeatureCollection',
  features: [{
    properties: {
      label: '19 Avenue Raymond Poincaré 75116 Paris',
      housenumber: '19',
      street: 'Avenue Raymond Poincaré',
      postcode: '75116',
      city: 'Paris',
      district: 'Paris 16e Arrondissement',
      distance: 7,
    },
  }],
};

test('a nearby address is printed bare, because the distance is noise', () => {
  const address = projectBanAddress(BAN);
  assert.equal(address.housenumber, '19');
  assert.equal(addressLine(address), '19 Avenue Raymond Poincaré 75116 Paris');
});

test('a mid-range address is printed WITH the distance that qualifies it', () => {
  const address = projectBanAddress({
    features: [{ properties: { ...BAN.features[0].properties, distance: 54 } }],
  });
  assert.match(flat(addressLine(address)), /point adresse à 54 m$/);
});

test('an address too far away is dropped, not shown with a caveat', () => {
  // On a card whose whole subject is which piece of ground you are looking at,
  // a confidently wrong address does more damage than a missing line.
  assert.equal(projectBanAddress({
    features: [{ properties: { ...BAN.features[0].properties, distance: ADDRESS_MAX_DISTANCE_M + 1 } }],
  }), null);
  assert.equal(addressLine(null), null);
});

test('an empty or malformed BAN answer is an absence', () => {
  assert.equal(projectBanAddress({ features: [] }), null);
  assert.equal(projectBanAddress({}), null);
  assert.equal(projectBanAddress(null), null);
  assert.equal(projectBanAddress({ features: [{ properties: { distance: 3 } }] }), null);
});

test('an address with no published distance is still used', () => {
  // BAN returns `distance` on reverse lookups, but a missing one must not be
  // read as "infinitely far" and silently drop a usable address.
  const address = projectBanAddress({
    features: [{ properties: { label: '1 Rue de la Paix 75002 Paris' } }],
  });
  assert.equal(address.label, '1 Rue de la Paix 75002 Paris');
  assert.equal(address.distanceM, null);
  assert.equal(addressLine(address), '1 Rue de la Paix 75002 Paris');
});

// ── Geometry helpers ────────────────────────────────────────────────────────

test('the span is the parcel\'s longest diagonal, in metres', () => {
  const span = parcelSpanM(PARCEL.polygons);
  // 0.0014° of longitude at 48.86°N is ~103 m; the diagonal of that by 0.0009°
  // of latitude (~99 m) is ~143 m.
  assert.ok(span > 130 && span < 155, `span was ${span}`);
  assert.match(flat(dimensionLine(PARCEL.polygons)), /^Plus grande dimension \d+ m$/);
});

test('geometry helpers answer null rather than NaN on nothing', () => {
  assert.equal(parcelSpanM([]), null);
  assert.equal(parcelSpanM(null), null);
  assert.equal(dimensionLine(null), null);
  assert.equal(footprintCentroid([]), null);
  assert.equal(footprintCentroid([[[[1, 2]]]]), null);
});

test('a multi-part parcel spans all of its parts', () => {
  const far = [
    PARCEL.polygons[0],
    [[[2.2900, 48.8600], [2.2910, 48.8600], [2.2910, 48.8605], [2.2900, 48.8600]]],
  ];
  assert.ok(parcelSpanM(far) > parcelSpanM(PARCEL.polygons));
});
