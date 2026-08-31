// Unit contract for the map-stack registry and the keyless IGN imagery stacks.
//
// The IGN stacks are the first entry in `MAP_STACKS` that is neither a single
// world-covering layer nor a stack that can be reasoned about from its id
// alone, so the three things that would fail SILENTLY in a browser are pinned
// here instead: the WMTS request parameters, the two-layer composition, and
// which credential a stack actually needs.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  MAP_STACKS,
  MapStackController,
  IGN_FRANCE_RECTANGLE,
  createIgnWmtsProvider,
} from './mapStackController.js';

/** The constructor only stores the viewer, so a stub is enough for these. */
const stubViewer = () => ({
  scene: { globe: { show: true } },
  imageryLayers: { add() {}, remove() {} },
});

const stackById = (id) => MAP_STACKS.find((stack) => stack.id === id);

test('the shipped registry is the six ids every presentation surface expects', () => {
  assert.deepEqual(MAP_STACKS.map((stack) => stack.id), [
    'photoreal', 'bing-aerial', 'bing-labels', 'osm', 'ign-ortho', 'ign-plan',
  ]);
  // Only the Bing/ion pair costs a credential. Getting this wrong would put an
  // ION badge on a keyless source, or hide a keyed one behind no warning.
  assert.deepEqual(
    MAP_STACKS.filter((stack) => stack.requiresIon).map((stack) => stack.id),
    ['bing-aerial', 'bing-labels'],
  );
});

test('the IGN stacks name a real Géoplateforme layer and declare their partial coverage', () => {
  for (const [id, layer, format] of [
    ['ign-ortho', 'ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg'],
    ['ign-plan', 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png'],
  ]) {
    const stack = stackById(id);
    assert.equal(stack.kind, 'ign-wmts');
    assert.equal(stack.requiresIon, false);
    assert.equal(stack.wmts.layer, layer);
    // The Géoplateforme publishes ONE format per layer; asking for the other
    // one is a 400, not a fallback.
    assert.equal(stack.wmts.format, format);
    assert.equal(stack.wmts.maximumLevel, 19);
    // Available-but-partial. The tray turns this into the chip tooltip.
    assert.equal(stack.coverageNote, 'metropolitan France only');
  }
});

test('the France clamp is metropolitan France + Corsica and nothing else', () => {
  const { west, south, east, north } = IGN_FRANCE_RECTANGLE;
  assert.ok(west < east && south < north);
  // Corsica's east coast (~9.56 E) and Bonifacio (~41.38 N) are inside.
  assert.ok(east > 9.56 && south < 41.38, 'Corsica must be inside the clamp');
  // Dunkerque (~51.03 N) and the Pointe de Corsen (~-4.79 E) are inside.
  assert.ok(north > 51.03 && west < -4.79, 'the mainland extremes must be inside');
  // Guadeloupe (-61.5) and Réunion (55.5) are DOM — deliberately outside.
  assert.ok(west > -61.5 && east < 55.5, 'DOM-TOM are out of scope for this pass');
});

test('the WMTS provider carries every parameter the Géoplateforme requires', () => {
  const provider = createIgnWmtsProvider(stackById('ign-ortho'));

  // Cesium normalizes the URL into a KVP GetTile template, so assert the host
  // and the operation rather than the string we handed it.
  assert.match(provider.url, /^https:\/\/data\.geopf\.fr\/wmts\?/);
  assert.match(provider.url, /request=GetTile/i);
  assert.equal(provider.format, 'image/jpeg');
  assert.ok(provider.tilingScheme instanceof Cesium.WebMercatorTilingScheme);
  assert.equal(provider.tileWidth, 256);
  assert.equal(provider.maximumLevel, 19);

  // LAYER / STYLE / TILEMATRIXSET have no public getters on Cesium's
  // WebMapTileServiceImageryProvider — they go straight into the KVP query at
  // request time. Reaching for the private fields is the only way to pin them,
  // and they are exactly the four that fail INVISIBLY: a wrong layer or matrix
  // set is a 404 storm, and a missing style is a synchronous throw at switch
  // time. Worth the coupling.
  assert.equal(provider._layer, 'ORTHOIMAGERY.ORTHOPHOTOS');
  // IGN publishes exactly one style per layer, named `normal`.
  assert.equal(provider._style, 'normal');
  // `PM` is IGN's Web Mercator set and is bit-for-bit Cesium's default
  // WebMercatorTilingScheme — one 256 px tile at level 0.
  assert.equal(provider._tileMatrixSetID, 'PM');
  // Labels are passed through verbatim as TILEMATRIX, so they must be the
  // string level ids '0'..'19' — one per level, not one short.
  assert.deepEqual(
    provider._tileMatrixLabels,
    Array.from({ length: 20 }, (_, level) => String(level)),
  );

  // Without the rectangle the provider 404s its way around the whole planet:
  // the layer's own declared bbox is France UNION the DOM and covers most of
  // the globe, so it is useless as a coverage mask.
  const rect = provider.rectangle;
  assert.ok(Math.abs(Cesium.Math.toDegrees(rect.west) - IGN_FRANCE_RECTANGLE.west) < 1e-9);
  assert.ok(Math.abs(Cesium.Math.toDegrees(rect.north) - IGN_FRANCE_RECTANGLE.north) < 1e-9);

  assert.match(provider.credit.html, /IGN/);
});

test('an IGN stack composites over OSM, bottom-first; every other stack is one layer', async () => {
  const controller = new MapStackController(stubViewer(), { cesiumToken: '' });

  const ign = await controller._getStackProviders(stackById('ign-ortho'));
  assert.equal(ign.length, 2, 'IGN needs a world base under it');
  assert.ok(ign[0] instanceof Cesium.OpenStreetMapImageryProvider, 'OSM is the BASE layer');
  assert.ok(ign[1] instanceof Cesium.WebMapTileServiceImageryProvider, 'IGN composites on top');
  // Cesium stretches a BASE layer's edge pixels across every tile outside its
  // bounds. IGN alone at index 0 would paint France's coastline over the
  // Atlantic and then the rest of Earth — the whole reason for the pair.

  const osm = await controller._getStackProviders(stackById('osm'));
  assert.equal(osm.length, 1);
  assert.equal(osm[0], ign[0], 'the OSM provider is shared, not rebuilt per stack');

  // Both IGN stacks reuse the same cached OSM base and their own layer.
  const plan = await controller._getStackProviders(stackById('ign-plan'));
  assert.equal(plan[0], ign[0]);
  assert.notEqual(plan[1], ign[1]);
});

test('an unavailable stack says which credential it is missing, not a generic one', () => {
  const keyless = new MapStackController(stubViewer(), { googleKeyConfigured: false });
  assert.equal(
    keyless.getStacks().find((stack) => stack.id === 'photoreal').unavailableReason,
    'Google Maps API key required for Google 3D',
  );

  // Keyed build whose tiles failed to load: same `googleTileset: null`, opposite advice.
  const tilesFailed = new MapStackController(stubViewer(), { googleKeyConfigured: true });
  assert.equal(
    tilesFailed.getStacks().find((stack) => stack.id === 'photoreal').unavailableReason,
    'Google 3D Tiles failed to load',
  );

  // A caller that did not say keeps the old generic wording rather than
  // inventing a cause it has no evidence for.
  const unsaid = new MapStackController(stubViewer(), {});
  assert.equal(
    unsaid.getStacks().find((stack) => stack.id === 'photoreal').unavailableReason,
    'Google 3D is unavailable',
  );

  assert.equal(
    keyless.getStacks().find((stack) => stack.id === 'bing-aerial').unavailableReason,
    'Cesium ion token required for Bing stacks',
  );
});

test('the keyless build can select every keyless stack, and only those', () => {
  const keyless = new MapStackController(stubViewer(), { googleKeyConfigured: false });
  assert.deepEqual(
    keyless.getStacks().filter((stack) => stack.available).map((stack) => stack.id),
    ['osm', 'ign-ortho', 'ign-plan'],
  );
  // With no Google tileset the controller must not open on `photoreal`.
  assert.equal(keyless.getActiveId(), 'osm');
});
