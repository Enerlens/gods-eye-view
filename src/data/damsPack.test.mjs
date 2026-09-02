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
  DAM_STRUCTURE_CHIPS,
  DAM_STRUCTURES,
  UNCLASSIFIED_STRUCTURE_LABEL,
  damGroupKey,
  damGroupParts,
  damStructureKind,
  damStructureTitle,
  isDamStructureKind,
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
    // The one field emitted for its own sake: what the structure IS. It comes
    // from the tag that SELECTED the feature, which the build used to discard.
    kind: 'dam',
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
  assert.deepEqual(properties, { osm: 'n42', kind: 'dam' });
  assert.equal(Object.hasOwn(properties, 'name'), false);
  assert.equal(Object.hasOwn(properties, 'spanM'), false);

  // A node has no geometry to measure, and null must not become 0.
  // `kind` is absent here on purpose: `abandoned=yes` alone says nothing about
  // what the structure IS, and an unclassified feature must stay unclassified
  // rather than defaulting to 'dam'.
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

  // Styles are keyed by the COMPOSITE `kind:tier` now: colour says WHAT the
  // structure is, everything else says how much it matters. A dyke and a dam
  // of the same size draw the same size, in different colours.
  for (const tier of DAM_TIERS) {
    const colours = new Set();
    for (const kind of ['dam', 'dyke', 'dam+dyke', '']) {
      const style = DAM_TIER_STYLES[`${kind}:${tier.key}`];
      assert.ok(style, `${kind}:${tier.key} has no style`);
      assert.equal(style.pixelSize, tier.pixelSize, `${kind}:${tier.key} size`);
      assert.equal(style.cardMaxDistance, tier.cardMaxDistance, `${kind}:${tier.key} range`);
      colours.add(style.color);
    }
    assert.equal(colours.size, 4, `${tier.key}: the four structures must not share a colour`);
    // The dam ramp keeps the blues this layer has always used.
    assert.equal(DAM_TIER_STYLES[`dam:${tier.key}`].color, tier.color);
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
  // The tally arrives keyed by the composite key and is folded twice — once by
  // structure, once by importance. Both answer a question the panel is asked,
  // and neither can be read off the other.
  const legend = damTierLegend(new Map([
    ['dam:major', { total: 1000, visible: 1000 }],
    ['dam:named', { total: 500, visible: 500 }],
    ['dam:minor', { total: 4579, visible: 0 }],
    ['dyke:major', { total: 60, visible: 60 }],
    ['dyke:named', { total: 50, visible: 50 }],
  ]));
  const byLabel = new Map(legend.map((row) => [row.label, row]));

  assert.equal(byLabel.get('Barrage').count, 1500, 'structure rows fold every tier');
  assert.match(byLabel.get('Barrage').blurb, /4579 masqués/);
  assert.equal(byLabel.get('Digue').count, 110);
  assert.doesNotMatch(byLabel.get('Digue').blurb, /masqué/);
  // …and the importance rows fold every structure.
  assert.equal(byLabel.get('Grand barrage').count, 1060);
  assert.equal(byLabel.get('Barrage nommé').count, 550);
  assert.equal(byLabel.get('Petit ouvrage').count, 0);

  // A group with nothing in it is absent, not a zero row.
  assert.deepEqual(damTierLegend({ 'dam:major': { total: 0, visible: 0 } }), []);
  assert.deepEqual(damTierLegend(null), []);
});

test('the two chip rows are orthogonal, and neither hides what it claims to keep', () => {
  // Importance and structure are independent facts, so their filters AND
  // together and their params merge rather than replace.
  assert.equal(damTierVisible('dam:major', {}), true, 'no params shows everything');
  assert.equal(damTierVisible('dyke:minor', { floor: 'major' }), false, 'the floor still applies');
  assert.equal(damTierVisible('dyke:major', { kinds: 'dams' }), false);
  assert.equal(damTierVisible('dam:major', { kinds: 'dykes' }), false);
  assert.equal(damTierVisible('dyke:major', { kinds: 'dykes' }), true);
  // Both filters at once.
  assert.equal(damTierVisible('dyke:major', { floor: 'major', kinds: 'dykes' }), true);
  assert.equal(damTierVisible('dyke:named', { floor: 'major', kinds: 'dykes' }), false);

  // The 25 double-tagged features are kept by BOTH chips: they genuinely are
  // both, and hiding them from either view would make a filter lie.
  assert.equal(damTierVisible('dam+dyke:major', { kinds: 'dams' }), true);
  assert.equal(damTierVisible('dam+dyke:major', { kinds: 'dykes' }), true);

  // The unclassified world half rides with BARRAGES rather than vanishing.
  assert.equal(damTierVisible(':major', { kinds: 'dams' }), true);
  assert.equal(damTierVisible(':major', { kinds: 'dykes' }), false);

  // An unknown chip shows everything rather than emptying the map.
  assert.equal(damTierVisible('dyke:major', { kinds: 'nope' }), true);
});

test('the group key carries both axes, and survives a missing one', () => {
  assert.equal(damGroupKey({ kind: 'dyke', name: 'Digue de Lazer', spanM: 1180 }), 'dyke:major');
  assert.equal(damGroupKey({ kind: 'dam', heightM: 120 }), 'dam:major');
  assert.equal(damGroupKey({ name: 'quelque chose' }), ':named', 'no kind is not "dam"');
  assert.equal(damGroupKey({ kind: 'nonsense' }), ':minor', 'an unknown kind is unclassified');
  assert.deepEqual(damGroupParts('dam+dyke:major'), { kind: 'dam+dyke', tier: 'major' });
  assert.deepEqual(damGroupParts(':minor'), { kind: '', tier: 'minor' });
});

test('a dyke is not a dam, and a feature tagged both is neither silently', () => {
  // THE REPORTED BUG. 25 features in the shipped pack carry man_made=dyke and
  // waterway=dam at once, 26 are named "Digue …", and seven of those are
  // promoted to the top tier and labelled "Grand barrage" — because the
  // `name AND span >= 300 m` clause cannot tell a 1 106 m dyke from a dam.
  assert.equal(damStructureKind({ waterway: 'dam' }), 'dam');
  assert.equal(damStructureKind({ man_made: 'dam' }), 'dam');
  assert.equal(damStructureKind({ building: 'dam' }), 'dam');
  assert.equal(damStructureKind({ man_made: 'dyke' }), 'dyke');
  assert.equal(damStructureKind({ embankment: 'dyke' }), 'dyke');
  assert.equal(damStructureKind({ man_made: 'dyke', waterway: 'dam' }), 'dam+dyke');
  // Unclassified, and NOT 'dam': the carried-over world half has no tags left,
  // and defaulting it to dam would recreate the conflation outside France
  // where nobody would notice.
  for (const tags of [{}, { abandoned: 'yes' }, null, undefined, 'tags']) {
    assert.equal(damStructureKind(tags), '', JSON.stringify(tags));
  }
  assert.equal(isDamStructureKind('dyke'), true);
  assert.equal(isDamStructureKind(''), false);
});

test('a nameless structure is titled by its kind, never by the layer', () => {
  // The reported sighting: OSM w860215522 at Octeville-sur-Mer is `man_made=dyke`
  // and nothing else — a 159 m anti-ruissellement bund with no water within
  // 250 m — and the card titled it "Barrage 159 m de long". `kind` was already
  // in the properties; the title just never read it.
  assert.equal(damStructureTitle({ kind: 'dyke', spanM: 159 }), 'Digue');
  assert.equal(damStructureTitle({ kind: 'dam' }), 'Barrage');
  assert.equal(damStructureTitle({ kind: 'dam+dyke' }), 'Barrage-digue');
  // The carried-over world half has no kind, and 'Ouvrage' is the whole of what
  // is known about it. Same rule as the grey ramp: unclassified is not 'dam'.
  for (const props of [{}, { kind: '' }, { kind: 'weir' }, null, undefined, 'props']) {
    assert.equal(damStructureTitle(props), UNCLASSIFIED_STRUCTURE_LABEL, JSON.stringify(props));
  }
  // Every title is one a chip or the legend already shows, so the card and the
  // filter row cannot name the same structure two different ways.
  const shown = new Set(DAM_STRUCTURES.map((entry) => entry.label));
  for (const key of ['dam', 'dyke', 'dam+dyke']) assert.ok(shown.has(damStructureTitle({ kind: key })));
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

  // Rebuilt 2026-09-01 with dykes: 7,432 features, 6,771 of them in France.
  // Floors, not equalities — OSM growing is upstream working; the pack HALVING
  // is a broken extraction, and only the second should fail here.
  assert.ok(features.length > 6800, `pack shrank unexpectedly (${features.length})`);

  const ALLOWED = new Set([
    'name', 'osm', 'operator', 'river', 'heightM', 'spanM',
    'material', 'builtYear', 'outputMw', 'hydro', 'abandoned',
    // What the structure IS. The one field emitted for its own sake.
    'kind',
  ]);
  const MATERIALS = new Set(Object.values(DAM_MATERIAL_FAMILIES));
  const tally = { major: 0, named: 0, minor: 0 };
  const ids = new Set();
  let french = 0;
  let dykes = 0;
  let unclassified = 0;

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

    if (props.kind !== undefined) {
      assert.ok(isDamStructureKind(props.kind), `${feature.id} ships an unknown kind: ${props.kind}`);
    }
    tally[damTier(props)] += 1;
    if (inFrance([lon, lat])) french += 1;
    if (props.kind === 'dyke' || props.kind === 'dam+dyke') dykes += 1;
    if (props.kind === undefined) unclassified += 1;
  }

  // THE REPORTED BUG, asserted against the shipped file. Before this rebuild
  // the pack held 25 dykes and could not say so — they were filed as dams,
  // and seven features named "Digue …" were labelled "Grand barrage".
  assert.ok(dykes > 800, `the dykes did not survive the rebuild (${dykes})`);
  // …and the carried-over world half stays UNCLASSIFIED rather than defaulting
  // to dam, which would recreate the conflation where nobody would notice.
  assert.ok(unclassified > 400, `the world half lost its honest blank (${unclassified})`);
  assert.ok(unclassified < 1000, `too much of the pack is unclassified (${unclassified})`);

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
