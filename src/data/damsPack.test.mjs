// src/data/damsPack.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  DAM_DISPLAY_FLOORS,
  DAM_MATERIAL_FAMILIES,
  DAM_MIN_SPAN_M,
  DAM_TAG_FILTERS,
  DAM_TIERS,
  DAM_TIER_STYLES,
  HYDRO_OPERATORS,
  LARGE_DAM_HEIGHT_M,
  MAJOR_DAM_SPAN_M,
  damBuiltYear,
  damCardDetails,
  damDisplayFloor,
  damFeatureProperties,
  damHeightM,
  damIsHydro,
  damLabelPriority,
  damMaterialFamily,
  damName,
  damOutputMw,
  damOverpassQuery,
  damTier,
  damTierLegend,
  damTierVisible,
} from './damsPack.js';

const PACK = new URL('./local_data/dams/dams.geojsonl', import.meta.url);

/** The French Republic's bounding boxes, used only to count what shipped. */
const FRENCH_BOXES = [
  [-5.5, 41.2, 9.8, 51.5],    // métropole + Corse
  [-61.9, 15.8, -60.9, 16.6], // Guadeloupe
  [-61.3, 14.3, -60.7, 15.0], // Martinique
  [-55.0, 2.0, -51.0, 6.0],   // Guyane
  [55.2, -21.5, 55.9, -20.8], // La Réunion
  [45.0, -13.1, 45.4, -12.6], // Mayotte
  [163.5, -22.8, 168.2, -20], // Nouvelle-Calédonie
  [-155, -28, -134, -7],      // Polynésie
];

const inFrance = ([lon, lat]) => FRENCH_BOXES
  .some(([w, s, e, n]) => lon >= w && lon <= e && lat >= s && lat <= n);

/** Any vertex of a feature's geometry, flattened. */
function firstPoint(geometry) {
  let cursor = geometry.coordinates;
  while (Array.isArray(cursor[0])) [cursor] = cursor;
  return cursor;
}

// ── The query IS the selection policy ───────────────────────────────────────

test('the Overpass query asks for the three dam tags over one area, as nwr', () => {
  const query = damOverpassQuery('["ISO3166-1"="FR"][admin_level=2]', 90);

  assert.match(query, /\[out:json\]\[timeout:90\];/);
  assert.match(query, /area\["ISO3166-1"="FR"\]\[admin_level=2\]->\.scope;/);
  assert.match(query, /out geom;/);

  for (const [key, value] of DAM_TAG_FILTERS) {
    // `nwr`, never `way`: 291 French dams are a single node and 19 are a
    // relation, and a way-only query would ship neither.
    assert.ok(query.includes(`nwr["${key}"="${value}"](area.scope);`), `${key}=${value} missing`);
  }
  assert.equal((query.match(/nwr\[/g) || []).length, DAM_TAG_FILTERS.length);
});

// ── Tag reading ─────────────────────────────────────────────────────────────

test('hydro evidence is power tagging or a named fleet operator, never a guess', () => {
  assert.equal(damIsHydro({ power: 'plant' }), true);
  assert.equal(damIsHydro({ power: 'generator' }), true);
  assert.equal(damIsHydro({ 'plant:source': 'hydro' }), true);
  assert.equal(damIsHydro({ 'generator:type': 'kaplan_turbine' }), true);
  assert.equal(damIsHydro({ 'plant:output:electricity': '330KW' }), true);
  // A European energy-market identifier is not issued to an irrigation pond.
  assert.equal(damIsHydro({ 'ref:EU:ENTSOE_EIC': '17W100P100P0721J' }), true);

  // Operators, by QID and by every spelling the fleet actually uses.
  assert.equal(damIsHydro({ 'operator:wikidata': 'Q274591' }), true);
  assert.equal(damIsHydro({ operator: 'EDF' }), true);
  assert.equal(damIsHydro({ operator: 'Électricité de France' }), true);
  assert.equal(damIsHydro({ operator: 'EDF PEI' }), true);
  assert.equal(damIsHydro({ operator: 'CNR' }), true);
  assert.equal(damIsHydro({ operator: 'Compagnie Nationale du Rhône' }), true);
  assert.equal(damIsHydro({ operator: 'SHEM' }), true);

  // VNF runs navigation weirs, not power stations. SHEMA is a different
  // company from SHEM, and prefix matching would swallow it.
  assert.equal(damIsHydro({ operator: 'VNF' }), false);
  assert.equal(damIsHydro({ operator: 'Shema' }), false);
  assert.equal(damIsHydro({ operator: 'Vendée Eau' }), false);
  assert.equal(damIsHydro({ operator: 'beaver' }), false);
  assert.equal(damIsHydro({ name: 'Centrale hydroélectrique de nulle part' }), false);
  assert.equal(damIsHydro(null), false);

  // Every listed operator is already normalized — no accent, no lower case —
  // or the set lookup could never match it.
  for (const operator of HYDRO_OPERATORS) {
    assert.equal(operator, operator.toUpperCase(), `${operator} must be upper case`);
    assert.equal(operator.normalize('NFD').replace(/[̀-ͯ]/g, ''), operator);
    assert.equal(damIsHydro({ operator }), true, `${operator} must match itself`);
  }
});

test('height is parsed out of free text and bounded to something a dam can be', () => {
  assert.equal(damHeightM({ height: '124' }), 124);
  assert.equal(damHeightM({ height: '12 m' }), 12);
  assert.equal(damHeightM({ height: '70,5' }), 70.5);
  assert.equal(damHeightM({ 'dam:height': '30', height: '2' }), 30, 'dam:height wins');

  // Out of bounds is a typo, not a record — the tallest dam on earth is 305 m.
  assert.equal(damHeightM({ height: '1200' }), null);
  assert.equal(damHeightM({ height: '0' }), null);
  assert.equal(damHeightM({ height: '-4' }), null);
  assert.equal(damHeightM({ height: 'high' }), null);
  assert.equal(damHeightM({}), null);
});

test('material collapses two languages of free text into six families', () => {
  assert.equal(damMaterialFamily('concrete'), DAM_MATERIAL_FAMILIES.concrete);
  assert.equal(damMaterialFamily('beton'), DAM_MATERIAL_FAMILIES.concrete);
  assert.equal(damMaterialFamily('soil'), DAM_MATERIAL_FAMILIES.earth);
  assert.equal(damMaterialFamily('earth'), DAM_MATERIAL_FAMILIES.earth);
  assert.equal(damMaterialFamily('masonry'), DAM_MATERIAL_FAMILIES.masonry);
  assert.equal(damMaterialFamily('stone'), DAM_MATERIAL_FAMILIES.stone);
  assert.equal(damMaterialFamily('metal'), DAM_MATERIAL_FAMILIES.metal);
  assert.equal(damMaterialFamily('wood'), DAM_MATERIAL_FAMILIES.wood);
  // Unclassifiable yields nothing rather than a guess.
  assert.equal(damMaterialFamily('composite'), '');
  assert.equal(damMaterialFamily(''), '');
});

test('output resolves a unit or is dropped — a card never claims 0 MW', () => {
  assert.equal(damOutputMw({ 'plant:output:electricity': '330KW' }), 0.33);
  assert.equal(damOutputMw({ 'plant:output:electricity': '12 MW' }), 12);
  assert.equal(damOutputMw({ 'plant:output:electricity': '1.8 GW' }), 1800);
  // No unit letter means watts.
  assert.equal(damOutputMw({ 'plant:output:electricity': '1200000' }), 1.2);
  assert.equal(damOutputMw({ 'plant:output:electricity': 'yes' }), null);
  assert.equal(damOutputMw({ 'plant:output:electricity': '' }), null);
  assert.equal(damOutputMw({}), null);
});

test('the built year is the year inside start_date, or nothing', () => {
  assert.equal(damBuiltYear({ start_date: '1951' }), 1951);
  assert.equal(damBuiltYear({ start_date: '2006-01-12' }), 2006);
  assert.equal(damBuiltYear({ construction_date: '1899' }), 1899);
  assert.equal(damBuiltYear({ start_date: 'inconnue' }), null);
  assert.equal(damBuiltYear({}), null);
});

test('the name is the local one, never a language variant standing in for it', () => {
  assert.equal(damName({ name: 'Barrage de Roselend' }), 'Barrage de Roselend');
  assert.equal(damName({ 'name:fr': 'Barrage de Guerlédan' }), 'Barrage de Guerlédan');
  // A Breton-only name is a real name, but not the one this app looks up.
  assert.equal(damName({ 'name:br': 'Stankañ' }), '');
  assert.equal(damName({}), '');
});

// ── Projection ──────────────────────────────────────────────────────────────

test('the shipped properties are an allowlist — free text never rides along', () => {
  const properties = damFeatureProperties({
    osm: 'w80671354',
    spanM: 699.4,
    tags: {
      name: 'Barrage de Serre-Ponçon',
      operator: 'EDF',
      height: '124',
      material: 'concrete',
      start_date: '1960',
      waterway: 'dam',
      // None of these may survive: this IS the privacy transform.
      note: 'call Jean 06 12 34 56 78',
      description: 'contact barrages@example.com',
      'contact:phone': '+33 4 92 00 00 00',
      'operator:email': 'someone@example.com',
      source: 'survey by a mapper',
    },
  });

  assert.deepEqual(properties, {
    name: 'Barrage de Serre-Ponçon',
    osm: 'w80671354',
    operator: 'EDF',
    heightM: 124,
    spanM: 699,
    material: 'béton',
    builtYear: 1960,
    hydro: true,
  });
});

test('a span below the floor, and every absent field, is omitted rather than emitted empty', () => {
  const properties = damFeatureProperties({
    osm: 'n42',
    spanM: DAM_MIN_SPAN_M - 1,
    tags: { waterway: 'dam' },
  });
  assert.deepEqual(properties, { osm: 'n42' });
  assert.equal(Object.hasOwn(properties, 'name'), false);
  assert.equal(Object.hasOwn(properties, 'spanM'), false);

  // A node has no geometry to measure, and null must not become 0.
  assert.deepEqual(
    damFeatureProperties({ osm: 'n43', spanM: null, tags: { abandoned: 'yes' } }),
    { osm: 'n43', abandoned: true },
  );
});

// ── The ladder ──────────────────────────────────────────────────────────────

test('the top tier takes height, electricity, or a name on a long structure', () => {
  assert.equal(damTier({ heightM: LARGE_DAM_HEIGHT_M }), 'major');
  assert.equal(damTier({ heightM: 124, name: 'Barrage de Serre-Ponçon' }), 'major');
  assert.equal(damTier({ hydro: true }), 'major');
  assert.equal(damTier({ name: 'Barrage de Vouglans', spanM: MAJOR_DAM_SPAN_M }), 'major');

  // Just under each threshold.
  assert.equal(damTier({ heightM: LARGE_DAM_HEIGHT_M - 0.1, name: 'Seuil' }), 'named');
  assert.equal(damTier({ name: 'Digue', spanM: MAJOR_DAM_SPAN_M - 1 }), 'named');

  // Span alone never promotes: the long unnamed objects in this pack are canal
  // embankments, and 165 of the 286 French features over 300 m have no name.
  assert.equal(damTier({ spanM: 6399 }), 'minor');
  assert.equal(damTier({ spanM: 6399, name: '' }), 'minor');

  assert.equal(damTier({ name: 'Barrage sans autre fait' }), 'named');
  assert.equal(damTier({}), 'minor');
  assert.equal(damTier(null), 'minor');
});

test('every tier has a style, a floor that keeps it, and a shrinking card range', () => {
  const keys = DAM_TIERS.map((tier) => tier.key);
  assert.deepEqual(keys, ['major', 'named', 'minor'], 'the array order IS the ranking');

  for (const tier of DAM_TIERS) {
    const style = DAM_TIER_STYLES[tier.key];
    assert.ok(style, `${tier.key} has no style`);
    assert.equal(style.color, tier.color);
    assert.equal(style.pixelSize, tier.pixelSize);
    assert.equal(style.cardMaxDistance, tier.cardMaxDistance);
    assert.ok(tier.blurb.length > 0, `${tier.key} has no blurb`);
  }

  // Importance is monotonic across all three channels, so the biggest dot is
  // also the one that keeps its label longest.
  for (let i = 1; i < DAM_TIERS.length; i += 1) {
    assert.ok(DAM_TIERS[i].pixelSize < DAM_TIERS[i - 1].pixelSize);
    assert.ok(DAM_TIERS[i].priority < DAM_TIERS[i - 1].priority);
    assert.ok(DAM_TIERS[i].cardMaxDistance < DAM_TIERS[i - 1].cardMaxDistance);
  }

  // Every floor keeps a prefix of the ladder, and TOUS keeps all of it.
  assert.deepEqual(DAM_DISPLAY_FLOORS[0].keep, keys);
  for (const floor of DAM_DISPLAY_FLOORS) {
    assert.deepEqual(floor.keep, keys.slice(0, floor.keep.length),
      `${floor.id} keeps something other than the top of the ladder`);
  }
});

test('a display floor hides the tiers below it and falls back to showing everything', () => {
  assert.equal(damTierVisible('minor', { floor: 'all' }), true);
  assert.equal(damTierVisible('minor', { floor: 'named' }), false);
  assert.equal(damTierVisible('named', { floor: 'named' }), true);
  assert.equal(damTierVisible('named', { floor: 'major' }), false);
  assert.equal(damTierVisible('major', { floor: 'major' }), true);

  // An unknown or missing floor shows the whole pack rather than nothing.
  assert.equal(damDisplayFloor('nonsense').id, 'all');
  assert.equal(damDisplayFloor(undefined).id, 'all');
  assert.equal(damTierVisible('minor', {}), true);
  assert.equal(damTierVisible('minor'), true);
});

test('the legend counts what is DRAWN and names what it is hiding', () => {
  const legend = damTierLegend(new Map([
    ['major', { total: 1060, visible: 1060 }],
    ['named', { total: 550, visible: 550 }],
    ['minor', { total: 4579, visible: 0 }],
  ]));

  assert.deepEqual(legend.map((row) => row.count), [1060, 550, 0]);
  assert.match(legend[2].blurb, /4579 masqués/);
  assert.doesNotMatch(legend[0].blurb, /masqué/);

  // A tier with nothing in it is absent, not a zero row.
  assert.deepEqual(damTierLegend({ major: { total: 0, visible: 0 } }), []);
  assert.deepEqual(damTierLegend(null), []);
});

test('label priority runs on the same scale as the ports and airports ladders', () => {
  assert.equal(damLabelPriority({ hydro: true }), 310);
  assert.equal(damLabelPriority({ name: 'Barrage' }), 180);
  assert.equal(damLabelPriority({}), 100);
});

// ── The card ────────────────────────────────────────────────────────────────

test('the card says who runs it, how big it is and what it sits on', () => {
  assert.deepEqual(damCardDetails({
    name: 'Barrage de Bort',
    operator: 'EDF',
    heightM: 120,
    spanM: 310,
    material: 'béton',
    builtYear: 1952,
    hydro: true,
  }), ['EDF', '120 m de haut · 310 m de long · béton', '1952']);

  // No operator, but OSM says it generates: the word is spelt out instead.
  assert.deepEqual(damCardDetails({ hydro: true, outputMw: 135, heightM: 133, river: 'El Abid' }),
    ['hydroélectrique · 135 MW', '133 m de haut', 'El Abid']);

  // "EDF · hydroélectrique" would tell a French reader nothing twice.
  assert.deepEqual(damCardDetails({ operator: 'EDF', hydro: true }), ['EDF']);

  // A structure with nothing but a name has nothing to say, and says nothing.
  assert.deepEqual(damCardDetails({ name: 'Barrage' }), []);
  assert.deepEqual(damCardDetails({}), []);
  assert.deepEqual(damCardDetails(null), []);
});

test('the card drops a line that would only repeat the title, and flags a dead dam', () => {
  // The river is the title's own words.
  assert.deepEqual(damCardDetails({ name: 'Barrage de la Rance', river: 'la Rance' }), []);
  assert.deepEqual(damCardDetails({ name: 'Barrage de Bort', river: 'la Dordogne' }),
    ['la Dordogne']);
  // The operator is the title's own words.
  assert.deepEqual(damCardDetails({ name: 'EDF', operator: 'EDF' }), []);

  assert.deepEqual(damCardDetails({ abandoned: true, operator: 'VNF' }), ['Désaffecté · VNF']);
});

test('metre counts are grouped with an ordinary space, whatever the ICU build', () => {
  const [, shape] = damCardDetails({ operator: 'EDF', heightM: 124, spanM: 1670 });
  assert.equal(shape, '124 m de haut · 1 670 m de long');
  assert.doesNotMatch(shape, /[  ]/, 'no invisible separator may ship');
});

// ── The shipped pack ────────────────────────────────────────────────────────

test('the shipped pack is French-complete, graded, and carries nothing it should not', () => {
  const features = readFileSync(PACK, 'utf8')
    .split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));

  // Rebuilt 2026-09-01: 6,189 features, 5,529 of them in France. Floors, not
  // equalities — OSM growing is upstream working; the pack HALVING is a broken
  // extraction, and only the second should fail here.
  assert.ok(features.length > 5800, `pack shrank unexpectedly (${features.length})`);

  const ALLOWED = new Set([
    'name', 'osm', 'operator', 'river', 'heightM', 'spanM',
    'material', 'builtYear', 'outputMw', 'hydro', 'abandoned',
  ]);
  const MATERIALS = new Set(Object.values(DAM_MATERIAL_FAMILIES));
  const tally = { major: 0, named: 0, minor: 0 };
  const ids = new Set();
  let french = 0;

  for (const feature of features) {
    const props = feature.properties;
    assert.equal(feature.type, 'Feature');
    // Never a LineString: the layer draws one stem per feature and that stem
    // overwrites a LineString's own polyline, so a line ships as a card-less
    // blue thread. Cesium cards each ring of a MultiPolygon, so those are fine.
    assert.ok(['Point', 'Polygon', 'MultiPolygon'].includes(feature.geometry.type),
      `${feature.id} ships a ${feature.geometry.type}, which the layer cannot card`);

    const [lon, lat] = firstPoint(feature.geometry);
    assert.ok(Number.isFinite(lon) && Math.abs(lon) <= 180, `bad longitude on ${feature.id}`);
    assert.ok(Number.isFinite(lat) && Math.abs(lat) <= 90, `bad latitude on ${feature.id}`);
    assert.ok(!(lon === 0 && lat === 0), `Null Island position on ${feature.id}`);

    for (const key of Object.keys(props)) {
      assert.ok(ALLOWED.has(key), `${feature.id} ships an unlisted property: ${key}`);
      assert.notEqual(props[key], '', `${feature.id} ships an empty ${key}`);
    }
    if (props.material) assert.ok(MATERIALS.has(props.material), `raw material on ${feature.id}`);
    if (props.spanM !== undefined) assert.ok(props.spanM >= DAM_MIN_SPAN_M);
    if (props.heightM !== undefined) assert.ok(props.heightM > 0 && props.heightM <= 400);

    assert.ok(!ids.has(feature.id), `duplicate feature id ${feature.id}`);
    ids.add(feature.id);

    tally[damTier(props)] += 1;
    if (inFrance([lon, lat])) french += 1;
  }

  // The whole point of the rebuild: France used to hold 44 of 704 features.
  assert.ok(french > 5000, `French coverage collapsed (${french})`);
  // And the world half is still there, so the layer is not empty elsewhere.
  assert.ok(features.length - french > 400, 'the world snapshot was dropped');

  // The ladder has to keep separating; a pack where everything is `major` is a
  // classifier that stopped classifying.
  assert.ok(tally.major > 400 && tally.major < features.length / 2, `top tier: ${tally.major}`);
  assert.ok(tally.minor > 2000, `unnamed tier collapsed: ${tally.minor}`);

  const byName = new Map(features.filter((f) => f.properties.name)
    .map((f) => [f.properties.name, f.properties]));

  // Spot checks whose values are independently known: Roselend is 150 m,
  // Serre-Ponçon 124 m, Bort-les-Orgues 120 m, and all three are EDF's.
  assert.equal(byName.get('Barrage de Roselend')?.heightM, 150);
  assert.equal(byName.get('Barrage de Serre-Ponçon')?.heightM, 124);
  assert.equal(byName.get('Barrage de Bort')?.heightM, 120);
  for (const name of ['Barrage de Roselend', 'Barrage de Serre-Ponçon', 'Barrage de Bort']) {
    assert.equal(byName.get(name)?.hydro, true, `${name} must read as hydroelectric`);
    assert.equal(damTier(byName.get(name)), 'major');
  }
  // Vouglans has neither a height nor an operator in OSM; it reaches the top
  // tier on the named-and-long clause alone, which is why that clause exists.
  assert.equal(damTier(byName.get('Barrage de Vouglans')), 'major');
  assert.equal(byName.get('Barrage de Vouglans')?.heightM, undefined);
});
