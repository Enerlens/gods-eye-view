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
  summarizeProviderError,
  IGN_OPAQUE_BOXES,
  isViewFullyCoveredByIgn,
  isRectangleCoveredByBoxes,
} from './mapStackController.js';
import { WORLD_IMAGERY_FAILURE_BUDGET } from './data/worldImagery.js';

/** The constructor only stores the viewer, so a stub is enough for these. */
const stubViewer = () => ({
  scene: { globe: { show: true } },
  imageryLayers: { add() {}, remove() {} },
});

const stackById = (id) => MAP_STACKS.find((stack) => stack.id === id);

test('the shipped registry is the eight ids every presentation surface expects', () => {
  assert.deepEqual(MAP_STACKS.map((stack) => stack.id), [
    'photoreal', 'google-roadmap', 'google-terrain',
    'bing-aerial', 'bing-labels', 'osm', 'ign-ortho', 'ign-plan',
  ]);
  // Only the Bing/ion pair costs a credential. Getting this wrong would put an
  // ION badge on a keyless source, or hide a keyed one behind no warning.
  assert.deepEqual(
    MAP_STACKS.filter((stack) => stack.requiresIon).map((stack) => stack.id),
    ['bing-aerial', 'bing-labels'],
  );
});

test('the Google 2D stacks are keyed but tileset-independent — the EEA case', () => {
  // The whole point of these two: on an EEA billing address Google refuses 3D
  // tiles and satellite (403) while still serving roadmap and terrain on the
  // SAME key. So availability must follow the KEY, never the loaded 3D
  // tileset. A controller with a key and no tileset is exactly staging.
  const controller = new MapStackController(stubViewer(), {
    googleTileset: null,
    googleKeyConfigured: true,
  });
  assert.equal(controller.isStackAvailable('photoreal'), false);
  assert.equal(controller.isStackAvailable('google-roadmap'), true);
  assert.equal(controller.isStackAvailable('google-terrain'), true);
  // …and it is what the controller falls back to, rather than dropping to OSM
  // and leaving a paid-for basemap unused.
  assert.equal(controller.getActiveId(), 'google-roadmap');

  // The keyless build says so explicitly, and only that turns them off.
  const keyless = new MapStackController(stubViewer(), { googleKeyConfigured: false });
  assert.equal(keyless.isStackAvailable('google-roadmap'), false);
  assert.match(
    keyless.getStacks().find((stack) => stack.id === 'google-roadmap').unavailableReason,
    /Google Maps API key required/,
  );

  // `null` means the caller never said; guessing "missing" would hide a
  // working basemap from every tool-built controller.
  const unsaid = new MapStackController(stubViewer(), {});
  assert.equal(unsaid.isStackAvailable('google-roadmap'), true);

  for (const [id, mapType] of [['google-roadmap', 'roadmap'], ['google-terrain', 'terrain']]) {
    const stack = stackById(id);
    assert.equal(stack.kind, 'google-2d');
    // No ion token: these ride the Google key, and an ION badge here would
    // send the operator hunting for the wrong credential.
    assert.equal(stack.requiresIon, false);
    assert.equal(stack.google2d.mapType, mapType);
    // Anything other than a scaleFactor Google accepts is a 400 at session
    // time, which surfaces as a dead chip rather than a fallback.
    assert.equal(stack.google2d.scale, 'scaleFactor2x');
  }
  // Worldwide — unlike the IGN pair, these carry no coverage caveat.
  assert.equal(stackById('google-roadmap').coverageNote, undefined);
});

test('the IGN stacks name a real Géoplateforme layer and declare their partial coverage', () => {
  for (const [id, layer, format, coverage] of [
    // The two notes differ because the two stacks now differ: only the plan is
    // France-and-nothing-else. The ortho carries world satellite under it, so
    // saying "metropolitan France only" on its chip would be a lie.
    ['ign-ortho', 'ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg', 'IGN 20 cm over France, world satellite beyond'],
    ['ign-plan', 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png', 'metropolitan France only'],
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
    assert.equal(stack.coverageNote, coverage);
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

test('an IGN stack composites over a world base, bottom-first; every other stack is one layer', async () => {
  const controller = new MapStackController(stubViewer(), { cesiumToken: '' });

  const ign = await controller._getStackProviders(stackById('ign-ortho'));
  assert.equal(ign.length, 2, 'IGN needs a world base under it');
  assert.ok(ign[1] instanceof Cesium.WebMapTileServiceImageryProvider, 'IGN composites on top');
  // Cesium stretches a BASE layer's edge pixels across every tile outside its
  // bounds. IGN alone at index 0 would paint France's coastline over the
  // Atlantic and then the rest of Earth — the whole reason for the pair.

  // The ortho's base is SATELLITE, not OSM: a street map showing through under
  // a photograph reads as a rendering fault the moment the camera leaves France.
  assert.ok(ign[0] instanceof Cesium.UrlTemplateImageryProvider, 'ortho sits on world satellite');
  assert.match(ign[0].url, /arcgisonline\.com/, 'Esri is the preferred world base');
  assert.equal(ign[0].maximumLevel, 19, 'Esri stops where IGN stops — the base never outruns it');

  // `ign-plan` is cartography, and OSM's line work continues it past the border.
  const plan = await controller._getStackProviders(stackById('ign-plan'));
  assert.ok(plan[0] instanceof Cesium.OpenStreetMapImageryProvider, 'the plan keeps its OSM base');

  const osm = await controller._getStackProviders(stackById('osm'));
  assert.equal(osm.length, 1);
  assert.equal(osm[0], plan[0], 'the OSM provider is shared, not rebuilt per stack');
  assert.notEqual(plan[1], ign[1]);
});

test('the world base falls back to Sentinel-2 once Esri has failed its tile budget', async () => {
  const controller = new MapStackController(stubViewer(), { cesiumToken: '' });
  const [esri] = await controller._getStackProviders(stackById('ign-ortho'));
  assert.equal(controller._getWorldImageryProvider(), esri, 'the base is cached, not rebuilt');

  // One tile lost to a flaky connection must not cost the sharp basemap, and
  // neither must the SAME tile failing repeatedly — Cesium re-raises
  // `errorEvent` on every retry, so the budget counts distinct tiles.
  for (let retry = 0; retry < WORLD_IMAGERY_FAILURE_BUDGET + 2; retry += 1) {
    esri.errorEvent.raiseEvent({ level: 7, x: 1, y: 1 });
  }
  assert.equal(controller._getWorldImageryProvider(), esri, 'one repeatedly-failing tile is not an outage');

  for (let tile = 0; tile < WORLD_IMAGERY_FAILURE_BUDGET; tile += 1) {
    esri.errorEvent.raiseEvent({ level: 7, x: tile, y: 2 });
  }
  const fallback = controller._getWorldImageryProvider();
  assert.notEqual(fallback, esri, 'a real outage swaps the base');
  assert.match(fallback.url, /s2cloudless-2017/, 'the fallback is the CC BY 4.0 vintage, not a NonCommercial one');
  assert.equal(fallback.maximumLevel, 14, 'Sentinel-2 is 10 m — anything past 14 is upsampling');

  // IGN is untouched by the swap: France keeps its 20 cm layer and its cache.
  const after = await controller._getStackProviders(stackById('ign-ortho'));
  assert.equal(after[0], fallback);
  assert.equal(after[1], (await controller._getStackProviders(stackById('ign-ortho')))[1]);
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

/**
 * A viewer stub that COUNTS imagery construction, which is the number the
 * reload bug is actually about.
 */
function countingViewer() {
  const built = [];
  const live = [];
  return {
    scene: { globe: { show: true }, setTerrain() {} },
    imageryLayers: {
      add(layer) { built.push(layer); live.push(layer); },
      remove(layer) { const i = live.indexOf(layer); if (i >= 0) live.splice(i, 1); },
    },
    terrainProvider: null,
    /** Every layer ever added, including the ones since torn down. */
    builds: built,
  };
}

/** A controller whose keyless terrain is pre-resolved, so no test touches the network. */
function offlineController(viewer, options = {}) {
  const controller = new MapStackController(viewer, { cesiumToken: '', ...options });
  controller._reearthTerrainProvider = { _stub: 'terrain' };
  return controller;
}

test('replaying the active stack rebuilds nothing', async () => {
  // The reload the field reported: boot activated a stack, the share restore
  // replayed the SAME id 1.5 s later, and `_activateGlobeStack` destroyed and
  // rebuilt every imagery layer — new `ImageryLayer` instances, empty tile
  // cache, a full coarse→sharp re-refine of a map that had not changed.
  const viewer = countingViewer();
  const controller = offlineController(viewer);

  await controller.setStack('osm', { silent: true });
  assert.equal(viewer.builds.length, 1, 'the boot activation must actually build the imagery');

  await controller.setStack('osm');
  await controller.setStack('osm');
  assert.equal(viewer.builds.length, 1, 'replaying the live stack must build nothing');
  assert.equal(controller.getActiveId(), 'osm');
});

test('the short-circuit cannot swallow the boot activation itself', async () => {
  // `_activeId` is seeded in the constructor, BEFORE anything is on the globe.
  // A short-circuit keyed on the id alone would skip the one call that builds.
  const viewer = countingViewer();
  const controller = offlineController(viewer);
  assert.equal(controller.getActiveId(), 'osm', 'seeded, but nothing is drawn yet');

  await controller.setStack('osm', { silent: true });
  assert.equal(viewer.builds.length, 1);
});

test('a share link opening on its own stack costs ONE imagery construction', async () => {
  // What `#map=ign-plan` must now do end to end: boot reads the hash and
  // activates Plan IGN (OSM base + IGN over it), and the restore that follows
  // finds the globe already right.
  const viewer = countingViewer();
  const controller = offlineController(viewer);

  await controller.setStack('ign-plan', { silent: true });
  assert.equal(viewer.builds.length, 2, 'IGN is a two-layer stack: OSM base + IGN on top');

  await controller.setStack('ign-plan');
  assert.equal(viewer.builds.length, 2, 'the hash restore must not rebuild the same globe');
});

test('a real switch still rebuilds, and switching back rebuilds again', async () => {
  const viewer = countingViewer();
  const controller = offlineController(viewer);

  await controller.setStack('osm', { silent: true });
  await controller.setStack('ign-ortho');
  assert.equal(viewer.builds.length, 3, 'OSM (1) then the IGN pair (2)');
  await controller.setStack('osm');
  assert.equal(viewer.builds.length, 4);
  assert.equal(controller.getActiveId(), 'osm');
});

test('a failed Google 3D boot is named on the source chip, not swallowed', async () => {
  // The old behaviour was a console.warn and a fallback nobody announced, which
  // made the basemap non-deterministic from one reload to the next.
  const viewer = countingViewer();
  const controller = offlineController(viewer, {
    googleKeyConfigured: true,
    googleTilesetError: 'HTTP 403 (API key restricted)',
  });

  assert.equal(
    controller.getStacks().find((stack) => stack.id === 'photoreal').unavailableReason,
    'Google 3D Tiles failed to load: HTTP 403 (API key restricted)',
    'the chip tooltip quotes the provider, it does not paraphrase it',
  );

  await controller.setStack('osm', { silent: true });
  const state = controller.getState();
  assert.match(state.notice, /HTTP 403/);
  assert.match(state.notice, /showing OSM$/, 'the notice says what IS on the globe');
  assert.equal(state.lastError, null, 'a boot fallback is not a failed switch and must never toast');
});

test('the boot notice steps aside once someone picks a source', async () => {
  const viewer = countingViewer();
  const controller = offlineController(viewer, {
    googleKeyConfigured: true,
    googleTilesetError: 'network error',
  });
  await controller.setStack('osm', { silent: true });
  assert.ok(controller.getState().notice);

  // A deliberate switch: the globe is now the one that was asked for.
  await controller.setStack('ign-plan');
  assert.equal(controller.getState().notice, null);
});

test('a build that never attempted Google 3D has nothing to report', async () => {
  const viewer = countingViewer();
  const controller = offlineController(viewer, { googleKeyConfigured: false });
  await controller.setStack('osm', { silent: true });
  assert.equal(controller.getState().notice, null, 'a keyless build is configured, not broken');
});

test('a Cesium RequestErrorEvent is reduced to the sentence the provider wrote', () => {
  // The live 2026-09-03 rejection, verbatim. Cesium's RequestErrorEvent has no
  // `message`, so the generic serializer produced nine hundred characters of
  // gzip headers — a tooltip nobody can read is the same as no tooltip.
  const raw = JSON.stringify({
    statusCode: 403,
    response: JSON.stringify({
      error: {
        code: 403,
        message: 'Your request cannot be served because satellite tiles and 3D tiles are not '
          + 'available for your account and region.',
        status: 'PERMISSION_DENIED',
      },
    }),
    responseHeaders: { 'content-encoding': 'gzip', 'content-length': '220' },
  });
  assert.equal(
    summarizeProviderError(raw),
    'HTTP 403 — Your request cannot be served because satellite tiles and 3D tiles are not '
      + 'available for your account and region.',
  );
});

test('an error that is already a sentence is left alone, and nothing is invented', () => {
  assert.equal(summarizeProviderError('network error'), 'network error');
  assert.equal(summarizeProviderError(''), '');
  assert.equal(summarizeProviderError(null), '');
  assert.equal(summarizeProviderError(undefined), '');
  // A body that is plain text rather than JSON still reads.
  assert.equal(
    summarizeProviderError(JSON.stringify({ statusCode: 429, response: 'Too Many Requests' })),
    'HTTP 429 — Too Many Requests',
  );
  // A status with nothing to say still names itself.
  assert.equal(summarizeProviderError(JSON.stringify({ statusCode: 503 })), 'HTTP 503');
});

test('a provider that will not stop talking is cut to tooltip length', () => {
  const long = summarizeProviderError(JSON.stringify({
    statusCode: 500,
    response: JSON.stringify({ error: { message: 'x'.repeat(600) } }),
  }));
  assert.ok(long.length < 240, `expected a tooltip, got ${long.length} characters`);
  assert.ok(long.endsWith('…'), 'a truncation must announce itself');
});

test('the world base sleeps only where IGN is proven opaque, never on its bounding box', () => {
  // Paris at city zoom: wholly inside the central box, so the invisible base
  // must switch off — this is the 813 kB per view the bench measured.
  assert.equal(isViewFullyCoveredByIgn({ west: 2.28, south: 48.85, east: 2.31, north: 48.87 }), true);

  // Brussels is INSIDE `IGN_FRANCE_RECTANGLE` and the Géoplateforme answers
  // "No data found" there. Sleeping the base on the bounding box would leave a
  // white hole, which is why the boxes exist at all.
  assert.equal(isViewFullyCoveredByIgn({ west: 4.34, south: 50.84, east: 4.36, north: 50.86 }), false);
  assert.ok(4.35 > IGN_FRANCE_RECTANGLE.west && 4.35 < IGN_FRANCE_RECTANGLE.east
    && 50.85 > IGN_FRANCE_RECTANGLE.south && 50.85 < IGN_FRANCE_RECTANGLE.north,
  'Brussels really is inside the clamp — that is the trap being guarded');

  // A whole-country view reaches sea and border on every side, so the base
  // stays on however many boxes it swallows.
  assert.equal(isViewFullyCoveredByIgn({ west: -5, south: 42, east: 9, north: 51 }), false);
  // The Atlantic west of Cap Ferret: the Géoplateforme answers 404 there (38 of
  // 81 sampled points), so this is exactly where the base earns its bytes.
  assert.equal(isViewFullyCoveredByIgn({ west: -2.05, south: 44.62, east: -0.36, north: 45.61 }), false);
  // No rectangle at all (camera sees space past the globe) keeps the base on.
  assert.equal(isViewFullyCoveredByIgn(null), false);
  // An antimeridian-crossing view is never France, however its numbers compare.
  assert.equal(isViewFullyCoveredByIgn({ west: 179, south: 44, east: -179, north: 45 }), false);

  // Every box must sit strictly inside the clamp, or it would claim coverage
  // the IGN layer is not even allowed to request.
  for (const box of IGN_OPAQUE_BOXES) {
    assert.ok(box.west >= IGN_FRANCE_RECTANGLE.west && box.east <= IGN_FRANCE_RECTANGLE.east
      && box.south >= IGN_FRANCE_RECTANGLE.south && box.north <= IGN_FRANCE_RECTANGLE.north,
    `${JSON.stringify(box)} escapes the France clamp`);
  }
});

test('the cockpit’s own default tilt still lets the base sleep over inland France', () => {
  // THE REGRESSION THIS FILE EXISTS TO HOLD. `src/camera.js` and `src/orbit.js`
  // both pitch the camera -30° by default, and at 9 400 m over Paris that view
  // spans 1.88-2.70 E / 48.93-49.34 N. Probed tile by tile on 2026-09-09: 81
  // points out of 81 carry real orthophoto, so nothing of the world base can
  // show through. The old "inside ONE box" test still kept it awake, at a
  // measured 69 requests / 1 362 kB of Esri per camera rest — more than the
  // 41 requests / 923 kB of IGN that were actually on screen.
  const defaultTiltOverParis = { west: 1.88, south: 48.93, east: 2.70, north: 49.34 };
  assert.equal(isViewFullyCoveredByIgn(defaultTiltOverParis), true);

  // The five boxes this replaced could not, and that is the whole regression:
  // the view crossed the northern edge of one and the western edge of another.
  const HAND_DRAWN_2026_09_08 = [
    { west: 0.5, south: 44.0, east: 5.0, north: 49.0 },
    { west: -0.5, south: 43.4, east: 2.0, north: 45.5 },
    { west: 4.5, south: 45.2, east: 6.0, north: 48.3 },
    { west: 2.0, south: 49.0, east: 4.0, north: 50.2 },
    { west: 4.2, south: 43.7, east: 6.0, north: 45.0 },
  ];
  assert.equal(isRectangleCoveredByBoxes(defaultTiltOverParis, HAND_DRAWN_2026_09_08), false,
    'if the old boxes covered this, the regression being pinned is not real');
});

test('two boxes cover a view neither of them contains', () => {
  // What the union rule buys once the boxes are measured rather than guessed.
  // Over the Landes at the default tilt: the southern box stops at 43.8 N and
  // the one above it starts at 43.7 N, so they overlap by a tenth of a degree
  // and this view needs exactly that overlap. Sleeping here saves the same
  // ~1.3 MB per camera rest as anywhere else IGN is opaque.
  const acrossTwoBoxes = { west: -1.0, south: 43.4, east: -0.2, north: 43.85 };
  assert.equal(isViewFullyCoveredByIgn(acrossTwoBoxes), true);

  const containedInSomeBox = IGN_OPAQUE_BOXES.some((box) => acrossTwoBoxes.west >= box.west
    && acrossTwoBoxes.east <= box.east
    && acrossTwoBoxes.south >= box.south
    && acrossTwoBoxes.north <= box.north);
  assert.equal(containedInSomeBox, false,
    'this view must straddle — pick another if the boxes were re-derived');
});

test('union coverage is exact on shapes the French coastline does not make', () => {
  const rect = (west, south, east, north) => ({ west, south, east, north });

  // Two boxes meeting exactly on an edge cover a rectangle neither contains.
  // This is the whole point of the change, in miniature.
  const pair = [rect(0, 0, 1, 1), rect(1, 0, 2, 1)];
  assert.equal(isRectangleCoveredByBoxes(rect(0.5, 0.2, 1.5, 0.8), pair), true);
  // One millimetre past their union is not covered.
  assert.equal(isRectangleCoveredByBoxes(rect(0.5, 0.2, 2.001, 0.8), pair), false);

  // An L: the bounding rectangle of two boxes is NOT their union.
  const ell = [rect(0, 0, 1, 2), rect(0, 0, 2, 1)];
  assert.equal(isRectangleCoveredByBoxes(rect(0, 0, 2, 2), ell), false);
  assert.equal(isRectangleCoveredByBoxes(rect(0, 0, 1, 2), ell), true);

  // A ring of four boxes with a hole in the middle: every edge is covered, the
  // centre is not. A cell-corner test instead of a cell-centre one would miss
  // this, so it is worth pinning.
  const ring = [rect(0, 0, 3, 1), rect(0, 2, 3, 3), rect(0, 0, 1, 3), rect(2, 0, 3, 3)];
  assert.equal(isRectangleCoveredByBoxes(rect(0, 0, 3, 3), ring), false);
  assert.equal(isRectangleCoveredByBoxes(rect(1, 1.2, 2, 1.8), ring), false);
  assert.equal(isRectangleCoveredByBoxes(rect(0, 0, 3, 1), ring), true);

  // A degenerate view — zero width or height — must be tested as a point, not
  // waved through by an arrangement that has no cells at all.
  assert.equal(isRectangleCoveredByBoxes(rect(0.5, 0.5, 0.5, 0.5), pair), true);
  assert.equal(isRectangleCoveredByBoxes(rect(9, 9, 9, 9), pair), false);

  // Nothing to cover with, and a rectangle whose east is west of its west.
  assert.equal(isRectangleCoveredByBoxes(rect(0, 0, 1, 1), []), false);
  assert.equal(isRectangleCoveredByBoxes(rect(1, 0, 0, 1), pair), false);
});
