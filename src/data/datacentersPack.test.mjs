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
  DATACENTER_AREA_MARKS,
  DATACENTER_ANCHOR_PX,
  DATACENTER_FILL_ALPHA,
  DATACENTER_HALL_COLOR,
  DATACENTER_LEVEL_HEIGHT_M,
  DATACENTER_MAX_HEIGHT_M,
  DATACENTER_MIN_AREA_M2,
  DATACENTER_POINTLESS_PX,
  DATACENTER_SITE_COLOR,
  DATACENTER_SURFACES,
  datacenterAreaBand,
  datacenterCardDetails,
  datacenterFootprint,
  datacenterHeightM,
  datacenterRenderSpec,
  datacenterSurface,
  datacenterSurfaceLegend,
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

// ── The size channel ────────────────────────────────────────────────────────
//
// Everything below is about the one fact the pack always held and never drew.
// The tests are mostly, again, about REFUSING: no default height for the 63 %
// that publish none, no extruded fence, no filled dot for a feature with no
// emprise at all.

test('height is read in metres first, and converted from storeys second', () => {
  // `height` is already metres, so it needs no factor and wins.
  assert.deepEqual(datacenterHeightM({ height: '18' }), { heightM: 18, basis: 'height' });
  assert.deepEqual(
    datacenterHeightM({ height: '12,5', 'building:levels': '9' }),
    { heightM: 12.5, basis: 'height' },
    'a comma decimal is French typing, not a missing value',
  );

  // Storeys are converted by the MEASURED 5 m/storey, not by an office 3 m.
  assert.deepEqual(
    datacenterHeightM({ 'building:levels': '3' }),
    { heightM: 3 * DATACENTER_LEVEL_HEIGHT_M, basis: 'levels' },
  );

  // The 90 % that publish neither get null — never a default. This single
  // assertion is the whole of A1 for this layer.
  assert.equal(datacenterHeightM({ building: 'yes' }), null);
  assert.equal(datacenterHeightM({}), null);
  assert.equal(datacenterHeightM(null), null);

  // Out of range is REFUSED, not clamped: a clamped 300 m is still a claim
  // nobody made, and it would be the tallest object on the continent.
  assert.equal(datacenterHeightM({ height: String(DATACENTER_MAX_HEIGHT_M + 1) }), null);
  assert.equal(datacenterHeightM({ height: '0' }), null);
  assert.equal(datacenterHeightM({ height: '-4' }), null);
  assert.equal(datacenterHeightM({ 'building:levels': '400' }), null);
  assert.equal(datacenterHeightM({ 'building:levels': 'yes' }), null);
});

test('a polygon is classed by what it outlines, and a fence is never a volume', () => {
  assert.equal(datacenterSurface({ building: 'yes', height: '20' }, 9000), 'volume');
  assert.equal(datacenterSurface({ building: 'industrial', 'building:levels': '2' }, 9000), 'volume');
  assert.equal(datacenterSurface({ building: 'yes' }, 9000), 'slab');

  // No building tag, or an explicit `building=no`, is a site outline — and it
  // stays one even when a mapper put a height on it (5 such features ship).
  assert.equal(datacenterSurface({}, 9000), 'site');
  assert.equal(datacenterSurface({ building: 'no' }, 9000), 'site');
  assert.equal(datacenterSurface({ building: 'no', height: '30' }, 9000), 'site');
  assert.equal(datacenterSurface({ 'building:levels': '4' }, 9000), 'site');

  // No geometry at all is the fourth case, and it is NOT "a very small one".
  assert.equal(datacenterSurface({ building: 'yes', height: '20' }, 0), 'point');
  assert.equal(datacenterSurface({ building: 'yes' }, NaN), 'point');

  // The map draws what was mapped even under the card's printing floor: 61
  // polygons are smaller than DATACENTER_MIN_AREA_M2 and they are still real
  // traced geometry. The card refuses the NUMBER; the map keeps the shape.
  assert.equal(datacenterSurface({ building: 'yes' }, DATACENTER_MIN_AREA_M2 - 1), 'slab');
  assert.equal(datacenterFootprint({ building: 'yes' }, DATACENTER_MIN_AREA_M2 - 1), null);
});

test('the render spec draws four different signs and never a default height', () => {
  const volume = datacenterRenderSpec({ tags: { building: 'yes', 'building:levels': '4' } }, { areaM2: 20_000 });
  assert.equal(volume.surface, 'volume');
  assert.equal(volume.extrudedHeightM, 4 * DATACENTER_LEVEL_HEIGHT_M);
  assert.equal(volume.color, DATACENTER_HALL_COLOR);
  assert.equal(volume.hollow, false);
  assert.equal(volume.pixelSize, DATACENTER_ANCHOR_PX);

  // 63 % of the pack. Flat, and with NOTHING in extrudedHeightM: this is the
  // assertion that stops a default storey height from creeping back in.
  const slab = datacenterRenderSpec({ tags: { building: 'yes' } }, { areaM2: 20_000 });
  assert.equal(slab.surface, 'flat');
  assert.equal(slab.extrudedHeightM, null);
  assert.equal(slab.color, DATACENTER_HALL_COLOR);

  // A fence: flat, never extruded, and a different hue so the reader is not
  // told a 32 000 m² enclosure is a 32 000 m² hall.
  const site = datacenterRenderSpec({ tags: { building: 'no', height: '25' } }, { areaM2: 200_000 });
  assert.equal(site.surface, 'flat');
  assert.equal(site.extrudedHeightM, null);
  assert.equal(site.color, DATACENTER_SITE_COLOR);
  assert.notEqual(site.color, DATACENTER_HALL_COLOR);

  // No emprise: a HOLLOW ring, no surface at all, at a size no filled mark
  // uses — "absent" must not be reachable by any value of "measured".
  const point = datacenterRenderSpec({ tags: { building: 'yes' } }, { areaM2: 0 });
  assert.equal(point.surface, null);
  assert.equal(point.hollow, true);
  assert.equal(point.pixelSize, DATACENTER_POINTLESS_PX);
  assert.notEqual(DATACENTER_POINTLESS_PX, DATACENTER_ANCHOR_PX);

  // Opacity is constant across the three surface classes, on purpose: form
  // says what is known, hue says what is outlined, extent says how big. A
  // ramp of alphas would be a fourth encoding of facts already carried (A3).
  for (const spec of [volume, slab, site]) {
    assert.equal(spec.fillAlpha, DATACENTER_FILL_ALPHA);
  }

  // Garbage in still produces a drawable mark rather than a throw.
  assert.equal(datacenterRenderSpec(null).surface, null);
  assert.equal(datacenterRenderSpec(undefined, {}).hollow, true);
});

test('the area marks are frozen domain thresholds, never quantiles of the view', () => {
  const marks = DATACENTER_AREA_MARKS.map((mark) => mark.minM2);
  assert.deepEqual(marks, [100_000, 10_000, 1_000], 'largest first, and round');
  for (let i = 1; i < marks.length; i += 1) assert.ok(marks[i] < marks[i - 1]);

  assert.equal(datacenterAreaBand(7_060_220), 'ha10');
  assert.equal(datacenterAreaBand(100_000), 'ha10');
  assert.equal(datacenterAreaBand(99_999), 'ha1');
  assert.equal(datacenterAreaBand(10_000), 'ha1');
  assert.equal(datacenterAreaBand(1_000), 'm1000');
  assert.equal(datacenterAreaBand(999), '', 'under the smallest mark is not a mark');
  assert.equal(datacenterAreaBand(0), '');
  assert.equal(datacenterAreaBand(NaN), '');
});

test('the legend publishes the four signs AND a numbered scale, counting what is drawn', () => {
  const legend = datacenterSurfaceLegend(new Map([
    ['volume|ha1', { total: 10, visible: 10 }],
    ['slab|m1000', { total: 100, visible: 60 }],
    ['site|ha10', { total: 5, visible: 5 }],
    ['point|', { total: 20, visible: 20 }],
  ]));
  const byLabel = new Map(legend.map((row) => [row.label, row]));

  // Four signs…
  for (const surface of DATACENTER_SURFACES) {
    assert.ok(byLabel.has(surface.label), `${surface.label} is missing`);
    assert.ok(byLabel.get(surface.label).glyph.startsWith('data:image/svg+xml;base64,'));
  }
  assert.equal(byLabel.get('Volume bâti').count, 10);
  assert.equal(byLabel.get('Emprise seule').count, 60, 'counts what is DRAWN');
  assert.match(byLabel.get('Emprise seule').blurb, /40 masqués/);
  assert.equal(byLabel.get('Sans emprise').count, 20);

  // …then the scale, without which a world-unit size is unreadable (D1). The
  // marks are cumulative: `≥ 1 ha` counts the `≥ 10 ha` too.
  assert.equal(byLabel.get('≥ 10 ha').count, 5);
  assert.equal(byLabel.get('≥ 1 ha').count, 15);
  // 5 sites + 10 volumes + the 60 slabs still DRAWN — not the 100 loaded.
  assert.equal(byLabel.get('≥ 1 000 m²').count, 75);
  // One graphite for every size row: in those rows the datum is the swatch's
  // size, so a hue that moved with it would encode the same fact twice.
  const sizeColors = new Set(DATACENTER_AREA_MARKS.map((mark) => byLabel.get(mark.label).color));
  assert.equal(sizeColors.size, 1);
  // …and three visibly different swatch shapes, largest mark largest.
  const sizeGlyphs = DATACENTER_AREA_MARKS.map((mark) => byLabel.get(mark.label).glyph);
  assert.equal(new Set(sizeGlyphs).size, 3);

  // Nothing loaded is no rows, not seven rows of zero.
  assert.deepEqual(datacenterSurfaceLegend(new Map()), []);
  assert.deepEqual(datacenterSurfaceLegend(null), []);
  assert.deepEqual(datacenterSurfaceLegend({ 'volume|ha1': { total: 0, visible: 0 } }), []);
});

test('the shipped pack still splits into the four populations this was measured on', () => {
  const lines = readFileSync(
    new URL('./local_data/datacenters/datacenters.geojsonl', import.meta.url),
    'utf8',
  ).trim().split('\n');

  const counts = { volume: 0, slab: 0, site: 0, point: 0 };
  const bands = new Map();
  let extrudedMax = 0;
  for (const raw of lines) {
    const feature = JSON.parse(raw);
    const areaM2 = geometryAreaM2(feature.geometry);
    const spec = datacenterRenderSpec(feature.properties, { areaM2 });
    counts[datacenterSurface(feature.properties?.tags, areaM2)] += 1;
    bands.set(datacenterAreaBand(areaM2), (bands.get(datacenterAreaBand(areaM2)) || 0) + 1);
    if (spec.extrudedHeightM) extrudedMax = Math.max(extrudedMax, spec.extrudedHeightM);
    // A spec is either extruded or flat, never "extruded by nothing".
    assert.equal(spec.surface === 'volume', spec.extrudedHeightM !== null, raw.slice(0, 80));
  }

  // The numbers quoted in the module header and in DATACENTER_SURFACES.
  assert.deepEqual(counts, { volume: 461, slab: 2739, site: 317, point: 834 });
  for (const surface of DATACENTER_SURFACES) {
    assert.equal(surface.count, counts[surface.key], `${surface.key} blurb is stale`);
  }
  // Two thirds of the pack has an emprise and no height. That proportion IS
  // the argument for the flat slab, so it is asserted rather than assumed.
  assert.ok(counts.slab / lines.length > 0.6);
  // And the cumulative mark counts the legend promises.
  assert.equal(bands.get('ha10'), 84);
  assert.equal(bands.get('ha10') + bands.get('ha1'), 1254);
  assert.equal(bands.get('ha10') + bands.get('ha1') + bands.get('m1000'), 2976);
  for (const mark of DATACENTER_AREA_MARKS) {
    assert.ok(mark.count > 0, `${mark.label} count is stale`);
  }
  // Nothing in the pack asks for a skyscraper.
  assert.ok(extrudedMax <= DATACENTER_MAX_HEIGHT_M, `${extrudedMax} m`);
  assert.equal(extrudedMax, 170);
});
