// src/data/datacentersPack.test.mjs
// What a datacenter card is allowed to claim.
//
// The pack this reads is 4 351 OpenStreetMap features with 313 distinct tag
// keys and no power vocabulary worth the name, so nearly every test here is
// about REFUSING to say something: not printing a constant, not calling a
// campus fence a building footprint, not turning a mapping error into a
// measurement. The one thing it does add — footprint area — is the only fact
// in the file that no tag carries, and it is also the easiest to get wrong.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DATACENTER_MIN_AREA_M2,
  datacenterCardDetails,
  datacenterFootprint,
  datacenterYear,
  formatFootprint,
  geometryAreaM2,
} from './datacentersPack.js';

/**
 * Collapse every space-like character to a plain space.
 *
 * `Number.toLocaleString('fr-FR')` groups with U+202F (narrow no-break space)
 * on a modern ICU and U+00A0 on an older one. That is a property of the
 * runtime, not a decision this module makes, and pinning either one turns an
 * ICU upgrade into a failing test about data-centre cards.
 */
const spaces = (value) => String(value).replace(/[\s\u00a0\u202f]+/g, ' ');

/** A square of `side` degrees of longitude at the equator, closed. */
function squareAt(lon, lat, degrees) {
  return {
    type: 'Polygon',
    coordinates: [[
      [lon, lat],
      [lon + degrees, lat],
      [lon + degrees, lat + degrees],
      [lon, lat + degrees],
      [lon, lat],
    ]],
  };
}

// ── Area ────────────────────────────────────────────────────────────────────

test('a square degree at the equator measures what a sphere says it does', () => {
  // 0.01° at the equator is 1 111.95 m on both axes → 1 236 432 m². This is the
  // sanity anchor: everything else in this file trusts the shoelace.
  const area = geometryAreaM2(squareAt(0, 0, 0.01));
  const expected = ((0.01 * Math.PI) / 180 * 6371008.8) ** 2;
  assert.ok(Math.abs(area - expected) / expected < 1e-6, `${area} vs ${expected}`);
});

test('longitude is scaled by latitude, so a polar square is not an equatorial one', () => {
  const equator = geometryAreaM2(squareAt(0, 0, 0.01));
  const paris = geometryAreaM2(squareAt(2.3, 48.85, 0.01));
  // cos(48.855°) ≈ 0.6581. Getting this wrong inflates every French footprint
  // by half, which is exactly the kind of error a card would never surface.
  assert.ok(paris < equator);
  assert.ok(Math.abs(paris / equator - Math.cos((48.855 * Math.PI) / 180)) < 0.002);
});

test('holes are subtracted and winding order is irrelevant', () => {
  const shell = squareAt(0, 0, 0.01).coordinates[0];
  const hole = [
    [0.002, 0.002], [0.004, 0.002], [0.004, 0.004], [0.002, 0.004], [0.002, 0.002],
  ];
  const solid = geometryAreaM2({ type: 'Polygon', coordinates: [shell] });
  const holed = geometryAreaM2({ type: 'Polygon', coordinates: [shell, hole] });
  assert.ok(holed < solid);
  // OSM does not guarantee ring winding, so a reversed shell must not go
  // negative and a reversed hole must still be subtracted.
  const reversed = geometryAreaM2({
    type: 'Polygon',
    coordinates: [[...shell].reverse(), [...hole].reverse()],
  });
  assert.ok(Math.abs(reversed - holed) < 1e-6);
});

test('a MultiPolygon sums its parts, and anything else measures nothing', () => {
  const one = geometryAreaM2(squareAt(0, 0, 0.01));
  const two = geometryAreaM2({
    type: 'MultiPolygon',
    coordinates: [squareAt(0, 0, 0.01).coordinates, squareAt(1, 0, 0.01).coordinates],
  });
  assert.ok(Math.abs(two - 2 * one) / one < 1e-3);
  // 834 of the pack's features are Points and have no footprint at all. They
  // must measure ZERO, never NaN — a NaN would reach the card as "≈ NaN m²".
  for (const geometry of [
    { type: 'Point', coordinates: [2, 48] },
    { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
    { type: 'Polygon', coordinates: [[[0, 0], [1, 1]]] },
    { type: 'Polygon', coordinates: 'nope' },
    null,
    undefined,
    {},
  ]) {
    const area = geometryAreaM2(geometry);
    assert.equal(area, 0, `${JSON.stringify(geometry)} measured ${area}`);
  }
});

// ── The building/site distinction ───────────────────────────────────────────

test('a polygon with no building tag is a SITE, not a footprint', () => {
  // The trap this whole module is shaped around. `Meta Los Lunas Data Center`
  // is tagged `building=no` and its polygon is 2 033 401 m²; the 313 untagged
  // polygons in the pack are six times larger at the median than the 3 200 real
  // buildings. Wording them identically would present a fence as a hall.
  assert.equal(datacenterFootprint({ building: 'yes' }, 5000).kind, 'building');
  assert.equal(datacenterFootprint({ building: 'data_center' }, 5000).kind, 'building');
  assert.equal(datacenterFootprint({ building: 'industrial' }, 5000).kind, 'building');
  assert.equal(datacenterFootprint({}, 5000).kind, 'site');
  assert.equal(datacenterFootprint({ building: 'no' }, 5000).kind, 'site');
  assert.equal(datacenterFootprint({ building: 'NO' }, 5000).kind, 'site', 'case-insensitive');
});

test('a footprint below the floor is dropped rather than printed precisely', () => {
  // The pack's smallest polygon is 2.6 m². That is a mapping error, and "≈ 2,6
  // m²" would render it as a finding.
  assert.equal(datacenterFootprint({ building: 'yes' }, DATACENTER_MIN_AREA_M2 - 1), null);
  assert.ok(datacenterFootprint({ building: 'yes' }, DATACENTER_MIN_AREA_M2));
  for (const bad of [0, -1, NaN, null, undefined, 'big']) {
    assert.equal(datacenterFootprint({ building: 'yes' }, bad), null, String(bad));
  }
});

// ── Formatting ──────────────────────────────────────────────────────────────

test('area reads in square metres until it stops being a building', () => {
  // Two significant figures throughout: an OSM tracing does not support more,
  // and a card that printed 19 473 m² would be claiming a survey.
  assert.equal(spaces(formatFootprint(19473)), '19 000 m²');
  assert.equal(spaces(formatFootprint(5697)), '5 700 m²');
  assert.equal(spaces(formatFootprint(1716)), '1 700 m²');
  // Ten hectares, not one. A hall is quoted in square metres by everyone who
  // works in one; 99 344 m² as "9,9 ha" is true and useless.
  assert.equal(spaces(formatFootprint(99344)), '99 000 m²');
  assert.equal(spaces(formatFootprint(343709)), '34 ha');
  assert.equal(spaces(formatFootprint(2033401)), '200 ha');
  for (const bad of [0, -5, NaN, null, undefined]) {
    assert.equal(formatFootprint(bad), '', String(bad));
  }
});

test('a year is a plausible year or nothing at all', () => {
  assert.equal(datacenterYear('2018'), '2018');
  assert.equal(datacenterYear('2016-04'), '2016');
  assert.equal(datacenterYear('1990-01-01'), '1990');
  // 87 distinct values live in this tag across 188 features; the ones that are
  // not a commissioning year must not become one.
  for (const bad of ['', '  ', 'unknown', '90', '1066', '3200', 'C19', null, undefined]) {
    assert.equal(datacenterYear(bad), '', JSON.stringify(bad));
  }
});

// ── The card ────────────────────────────────────────────────────────────────

test('the card names the operator, the real IT load, and a ref the title lacks', () => {
  const lines = datacenterCardDetails({
    tags: {
      name: 'Digital Realty MRS3',
      operator: 'Digital Realty',
      building: 'data_center',
      'data_center:power': '24 MW',
    },
  }, { areaM2: 7500 });
  // `data_center:power` is the ONLY key in this pack that is an IT-load figure,
  // and the three keys the old card looked for match one feature each.
  assert.equal(lines[0], 'Digital Realty · 24 MW');
  assert.equal(spaces(lines[1]), 'emprise au sol ≈ 7 500 m²');
});

test('a ref already inside the title is not printed twice', () => {
  // 569 of the pack's 868 refs are a substring of the name they sit under.
  const redundant = datacenterCardDetails({
    tags: { name: 'Telehouse 3', operator: 'Telehouse', ref: '3' },
  });
  assert.equal(redundant[0], 'Telehouse');
  const genuine = datacenterCardDetails({
    tags: { name: 'Digital Realty Marseille', operator: 'Digital Realty', ref: 'MRS1' },
  });
  assert.equal(genuine[0], 'Digital Realty · MRS1');
});

test('an operator that merely repeats the title is dropped', () => {
  const lines = datacenterCardDetails({ tags: { name: 'Equinix', operator: 'Equinix' } });
  assert.deepEqual(lines, []);
});

test('operator:short is never a source — it is 83% the word AWS', () => {
  // Five distinct values across 344 features. It would add a word to sites that
  // already name their operator and nothing to any site that does not.
  const lines = datacenterCardDetails({ tags: { name: 'Somewhere', 'operator:short': 'AWS' } });
  assert.deepEqual(lines, []);
  // owner and brand DO stand in for a missing operator.
  assert.equal(datacenterCardDetails({ tags: { name: 'X', owner: 'Iron Mountain' } })[0], 'Iron Mountain');
  assert.equal(datacenterCardDetails({ tags: { name: 'X', brand: 'Scaleway' } })[0], 'Scaleway');
});

test('telecom and description never reach the card', () => {
  // `telecom` is 4 176 identical `data_center` values — a constant is not
  // information. `description` in this pack is dominated by the literal string
  // "data center", which restates the layer name.
  const lines = datacenterCardDetails({
    tags: {
      name: 'Cogent Nantes',
      telecom: 'data_center',
      description: 'data center',
      building: 'yes',
    },
  }, { areaM2: 3000 });
  const joined = lines.join(' | ').toLowerCase();
  assert.ok(!joined.includes('data_center'));
  assert.ok(!joined.includes('data center'));
});

test('a point feature degrades to whatever its tags carry, never to a zero', () => {
  const lines = datacenterCardDetails({ tags: { name: 'Scaleway DC4', operator: 'Scaleway' } }, { areaM2: 0 });
  assert.deepEqual(lines, ['Scaleway']);
  // And a feature with nothing at all yields nothing, not an empty string line.
  assert.deepEqual(datacenterCardDetails({ tags: { name: 'Telehouse Paris Voltaire' } }), []);
  assert.deepEqual(datacenterCardDetails(null), []);
  assert.deepEqual(datacenterCardDetails(undefined), []);
  assert.deepEqual(datacenterCardDetails({}), []);
});

test('storeys are preferred to a height, and both read in French', () => {
  const levels = datacenterCardDetails({
    tags: { name: 'X', building: 'commercial', 'building:levels': '10', height: '40' },
  }, { areaM2: 3400 });
  assert.equal(spaces(levels[0]), 'emprise au sol ≈ 3 400 m² · 10 niveaux');
  const height = datacenterCardDetails({
    tags: { name: 'X', building: 'commercial', height: '15.5' },
  }, { areaM2: 6500 });
  assert.equal(spaces(height[0]), 'emprise au sol ≈ 6 500 m² · 15,5 m de haut');
  const one = datacenterCardDetails({
    tags: { name: 'X', building: 'yes', 'building:levels': '1' },
  }, { areaM2: 900 });
  assert.match(one[0], /1 niveau$/, 'singular');
});

// ── Against the real pack ───────────────────────────────────────────────────

test('the shipped pack gets materially more card than it used to, and no lies', () => {
  const lines = readFileSync(
    new URL('./local_data/datacenters/datacenters.geojsonl', import.meta.url),
    'utf8',
  ).trim().split('\n');
  assert.equal(lines.length, 4351, 'the pack this was measured against');

  let withDetail = 0;
  let withTwo = 0;
  let siteWorded = 0;
  for (const raw of lines) {
    const feature = JSON.parse(raw);
    const details = datacenterCardDetails(feature.properties, {
      areaM2: geometryAreaM2(feature.geometry),
    });
    if (details.length >= 1) withDetail += 1;
    if (details.length >= 2) withTwo += 1;
    for (const line of details) {
      assert.ok(typeof line === 'string' && line.trim(), 'no blank line may be emitted');
      assert.ok(!/NaN|undefined|null/.test(line), `${line}`);
      if (line.includes('emprise du site')) siteWorded += 1;
    }
  }
  // The old card produced one line for 1 923 features (44.2%) and never two.
  assert.ok(withDetail / lines.length > 0.85, `only ${withDetail} of ${lines.length}`);
  assert.ok(withTwo / lines.length > 0.40, `only ${withTwo} got two lines`);
  // And the campus outlines are still worded as campuses.
  assert.ok(siteWorded > 100, `${siteWorded} site-worded footprints`);
});

test('the campus outlines the pack is known to contain are never called buildings', () => {
  const lines = readFileSync(
    new URL('./local_data/datacenters/datacenters.geojsonl', import.meta.url),
    'utf8',
  ).trim().split('\n');
  const named = new Map();
  for (const raw of lines) {
    const feature = JSON.parse(raw);
    const name = String(feature.properties?.tags?.name || '');
    if (!/^(Meta Los Lunas Data Center|Data4 Campus Paris Saclay)$/.test(name)) continue;
    named.set(name, datacenterCardDetails(feature.properties, {
      areaM2: geometryAreaM2(feature.geometry),
    }));
  }
  // Both are explicitly not buildings in OSM, and both are enormous. If either
  // ever prints "emprise au sol" the building-tag gate has been lost.
  for (const [name, details] of named) {
    const joined = details.join(' | ');
    assert.ok(joined.includes('emprise du site'), `${name}: ${joined}`);
    assert.ok(!joined.includes('emprise au sol'), `${name}: ${joined}`);
  }
  assert.equal(named.size, 2, 'both reference features are still in the pack');
});
