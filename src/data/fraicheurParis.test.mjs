// What the DRAWN layer is allowed to claim, once the two feed modules have
// already been proved.
//
// One property runs through the whole file and it is the same one the feeds are
// built around: **an absence must never be presentable as a measurement.** The
// drawing has four extra ways to break that rule which no pure function can —
// a colour ramp with a fallback member, a dot size derived from a missing
// number, a legend row that folds an unmeasured object into a measured band,
// and a DETECT callout that names a thing it cannot place. Each test below
// closes one of them.
//
// The second property is that the CLOCK is the browser's, not the proxy's. The
// pack ships a summary computed at fetch time and cached for an hour, and
// "where can I cool off right now" answered an hour late is a wrong answer:
// measured over the real registers it is 757 green spaces open at 14 h 00 Paris
// and 367 at 01 h 30.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import fraicheurParisLayer, {
  FRAICHEUR_CANICULE_COLOR,
  FRAICHEUR_FAMILY_COLORS,
  FRAICHEUR_FILL_ALPHA,
  FRAICHEUR_FOUNTAIN_STATES,
  FRAICHEUR_FR_LAYER_ID,
  FRAICHEUR_FR_OVERLAY_SOURCE_ID,
  FRAICHEUR_PARIS_BOX,
  FRAICHEUR_REFUGES_URL,
  FRAICHEUR_TREES_URL,
  buildFraicheurLoadingLabel,
  buildFraicheurSelectionLabel,
  createFraicheurSelectedOverlayEntry,
  fraicheurDetectType,
  fraicheurFamilyColor,
  fraicheurFountainState,
  fraicheurInView,
  fraicheurRingPositions,
  fraicheurSpaceAnchor,
  fraicheurSpaceColor,
  fraicheurTreeColor,
  fraicheurTreeViewport,
  resolveFraicheurPickId,
  _clearFraicheurSelectionForTest,
  _fraicheurDetectablesForTest,
  _fraicheurRecordForTest,
  _fraicheurLoadForTest,
  _fraicheurRowControlsForTest,
  _fraicheurSelectedIdForTest,
  _fraicheurStatsForTest,
  _fraicheurTreeStateForTest,
  _selectFraicheurForTest,
  _setFraicheurStateForTest,
} from './fraicheurParis.js';
import {
  FRAICHEUR_CANOPY_BANDS,
  FRAICHEUR_CANOPY_UNKNOWN,
  projectFraicheurRefuges,
} from './fraicheurFeed.js';
import {
  FRAICHEUR_TREE_BANDS,
  FRAICHEUR_TREE_MAX_ALTITUDE_M,
  projectFraicheurTrees,
} from './fraicheurTrees.js';

// Cesium reads the aliased line-width range off a live WebGL context, and there
// is none under `node --test`, so `ContextLimits._maximumAliasedLineWidth` sits
// at 0 and EVERY `RenderState.fromCache` throws "renderState.lineWidth is out
// of range" — including the default lineWidth of 1. Priming it is what lets the
// real `selectObject()` build its highlight here; it is a property of the
// harness, not of the layer. `GroundPolylineGeometry` bakes its width into
// extruded geometry rather than into a GL line, which is why this layer,
// `comptages-fr` and `power-grid` all pass widths well above 1 in production.
const { default: ContextLimits } = await import('@cesium/engine/Source/Renderer/ContextLimits.js');
ContextLimits._maximumAliasedLineWidth = 16;

const read = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const norm = (value) => String(value).replace(/[\s ]+/g, ' ');

/** 14 h 00 in Paris, a Wednesday — fixed so "open now" never drifts. */
const AFTERNOON = Date.parse('2026-09-02T12:00:00Z');
/** 01 h 30 in Paris, the following Thursday. */
const NIGHT = Date.parse('2026-09-02T23:30:00Z');

const PACK = projectFraicheurRefuges({
  spaces: read('fraicheur-espaces-verts-sample.json'),
  equipment: read('fraicheur-equipements-sample.json'),
  fountains: read('fraicheur-fontaines-sample.json'),
  now: AFTERNOON,
});
const TREES = projectFraicheurTrees({
  features: read('fraicheur-arbres-sample.json'),
  totalInBox: 18,
  box: { south: 48.816, west: 2.346, north: 48.836, east: 2.366 },
});
const idOf = (row) => `${FRAICHEUR_FR_LAYER_ID}:${row.id}`;

/**
 * The smallest viewer the selection path actually touches: it adds a ground
 * polyline over the selected park's rings and removes it again.
 * `GroundPolylinePrimitive.isSupported` reads `scene.frameState.context
 * .depthTexture`, so the stub has to carry it or the highlight is skipped and
 * the test silently proves nothing.
 */
function fakeViewer() {
  const added = [];
  return {
    added,
    scene: {
      frameState: { context: { depthTexture: true } },
      requestRender: () => {},
      groundPrimitives: {
        add: (primitive) => { added.push(primitive); return primitive; },
        remove: (primitive) => {
          const index = added.indexOf(primitive);
          if (index >= 0) added.splice(index, 1);
          return index >= 0;
        },
        contains: (primitive) => added.includes(primitive),
      },
    },
  };
}

/** A recording overlay host, so the selection path runs with no world overlay. */
function recordingHost() {
  const calls = { set: [], cleared: [], visible: [] };
  return {
    calls,
    setEntries: (sourceId, entries) => calls.set.push({ sourceId, entries }),
    clearSource: (sourceId) => calls.cleared.push(sourceId),
    setVisible: (sourceId, visible) => calls.visible.push({ sourceId, visible }),
  };
}

/** A camera at a given height over a given point, for the tree gate. */
function fakeCamera({ lat = 48.86, lon = 2.35, height = 400, span = 0.01 } = {}) {
  return {
    camera: {
      positionCartographic: { height, latitude: (lat * Math.PI) / 180, longitude: (lon * Math.PI) / 180 },
      pickEllipsoid: () => ({ x: 1, y: 1, z: 1 }),
      computeViewRectangle: () => ({
        south: ((lat - span) * Math.PI) / 180,
        north: ((lat + span) * Math.PI) / 180,
        west: ((lon - span) * Math.PI) / 180,
        east: ((lon + span) * Math.PI) / 180,
      }),
    },
    scene: {
      canvas: { clientWidth: 1200, clientHeight: 800 },
      globe: {
        ellipsoid: {
          cartesianToCartographic: () => ({
            latitude: (lat * Math.PI) / 180,
            longitude: (lon * Math.PI) / 180,
          }),
        },
      },
    },
  };
}

test('the layer object satisfies the manager contract the registry assumes', () => {
  assert.equal(fraicheurParisLayer.id, FRAICHEUR_FR_LAYER_ID);
  assert.equal(FRAICHEUR_FR_LAYER_ID, 'fraicheur-fr');
  for (const hook of ['init', 'enable', 'disable', 'update']) {
    assert.equal(typeof fraicheurParisLayer[hook], 'function', `${hook} is required`);
  }
  assert.ok(fraicheurParisLayer.name);
  assert.ok(fraicheurParisLayer.icon);
  assert.ok(fraicheurParisLayer.source);
  assert.ok(fraicheurParisLayer.updateInterval > 0);
  // The panel row must not repeat a RISQUES & ENVIRONNEMENT neighbour's glyph:
  // FIRMS owns 🔥, Vigicrues 🌊, Géorisques ⚠ and the weather vigilance 🌪.
  for (const taken of ['🔥', '🌊', '⚠', '🌪', '🎓', '🏛']) {
    assert.notEqual(fraicheurParisLayer.icon, taken);
  }
  // The name must carry the city, because the layer covers exactly one.
  assert.match(fraicheurParisLayer.name, /Paris/);
  assert.equal(FRAICHEUR_REFUGES_URL, '/api/fraicheur-fr/refuges');
  assert.equal(FRAICHEUR_TREES_URL, '/api/fraicheur-fr/arbres');
});

test('a space with no measured canopy never takes a colour off the canopy ramp', () => {
  // The single defect this layer would be worst for. One of the 984 spaces
  // publishes no `indice_veget_sup8m_2024` at all and 66 publish exactly 0;
  // painting the first in the ramp's palest green would assert a survey nobody
  // made, and painting the second in the same colour as the first would merge
  // "nothing was found" with "nobody looked".
  const ramp = new Set(FRAICHEUR_CANOPY_BANDS.map((band) => band.color.toLowerCase()));
  const unknown = PACK.spaces.find((space) => space.canopy === null);
  const bare = PACK.spaces.find((space) => space.canopy === 0);
  assert.ok(unknown, 'the fixture must carry a space with no published index');
  assert.ok(bare, 'the fixture must carry a space with a published zero');
  assert.equal(ramp.has(fraicheurSpaceColor(unknown).toLowerCase()), false);
  assert.equal(fraicheurSpaceColor(unknown).toLowerCase(), FRAICHEUR_CANOPY_UNKNOWN.color.toLowerCase());
  assert.notEqual(fraicheurSpaceColor(unknown), fraicheurSpaceColor(bare));
  assert.equal(ramp.has(fraicheurSpaceColor(bare).toLowerCase()), true);
  // A fill translucent enough that the cadastre parcels and the PLU zones
  // clamped to the same ground still read underneath.
  assert.ok(FRAICHEUR_FILL_ALPHA > 0 && FRAICHEUR_FILL_ALPHA < 0.5);
});

test('an unsurveyed tree never takes the measured colour nor a scaled dot', () => {
  _setFraicheurStateForTest({ payload: PACK, trees: TREES, overlayHost: recordingHost(), now: AFTERNOON });
  const measured = FRAICHEUR_TREE_BANDS.find((band) => band.id === 'mesure').color.toLowerCase();
  let unmeasured = 0;
  let sizes = new Set();
  for (const record of [..._recordsOfKind('tree')]) {
    if (record.row.height !== null) continue;
    unmeasured += 1;
    assert.notEqual(fraicheurTreeColor(record.row).toLowerCase(), measured,
      `${record.id} has no published height and must not take the measured colour`);
    sizes.add(record.basePixelSize);
  }
  assert.ok(unmeasured > 0, 'the fixture must contain an unsurveyed tree');
  assert.equal(sizes.size, 1, 'every unsurveyed tree is drawn at the same minimum size');
  // And a tree WITH a height is bigger than one without.
  const tall = [..._recordsOfKind('tree')].find((r) => r.row.height >= 15);
  assert.ok(tall.basePixelSize > [...sizes][0]);
  _clearFraicheurSelectionForTest();
});

/** Every seeded record of one kind, read back through the production index. */
function _recordsOfKind(kind) {
  const out = [];
  for (const row of [...PACK.spaces, ...PACK.equipment, ...PACK.fountains, ...TREES.trees]) {
    const record = _fraicheurRecordForTest(`${FRAICHEUR_FR_LAYER_ID}:${row.id}`);
    if (record && record.kind === kind) out.push(record);
  }
  return out;
}

test('the five mechanisms and the three fountain states are separable colours', () => {
  const colors = Object.values(FRAICHEUR_FAMILY_COLORS).map((c) => c.toLowerCase());
  assert.equal(new Set(colors).size, colors.length, 'no two mechanisms share a colour');
  assert.equal(colors.length, 5);
  // Not a green ramp: the polygons underneath own green, and a green dot on a
  // green park is not a dot.
  const canopy = new Set([...FRAICHEUR_CANOPY_BANDS, FRAICHEUR_CANOPY_UNKNOWN]
    .map((band) => band.color.toLowerCase()));
  for (const color of colors) assert.equal(canopy.has(color), false);
  assert.equal(fraicheurFamilyColor('inconnue'), FRAICHEUR_FAMILY_COLORS['plein-air']);

  // `dispo` is a STRING pair upstream, so the state table is three-valued and a
  // future null must not silently become "available".
  assert.equal(FRAICHEUR_FOUNTAIN_STATES.length, 3);
  assert.equal(fraicheurFountainState({ available: true }).id, 'en-service');
  assert.equal(fraicheurFountainState({ available: false }).id, 'hors-service');
  assert.equal(fraicheurFountainState({ available: null }).id, 'non-publiee');
  assert.equal(fraicheurFountainState({}).id, 'non-publiee');
  assert.notEqual(fraicheurFountainState({ available: null }).color,
    fraicheurFountainState({ available: true }).color);
});

test('grey means one thing in this layer, and nothing else shares a colour', () => {
  // Four registers on one screen, so the palettes of three modules have to be
  // read as ONE. Two collisions were live before this test existed: the tree
  // band `mesure` was exactly #2f8b43, which is the canopy ramp's 40-55 % fill,
  // so a measured tree drawn on any of those 164 parks was painted in its own
  // background; and the residual equipment family was amber, which the 183
  // remarkable trees own.
  const swatches = [];
  for (const band of [...FRAICHEUR_CANOPY_BANDS, FRAICHEUR_CANOPY_UNKNOWN]) {
    swatches.push([`canopy:${band.id}`, band.color]);
  }
  for (const band of FRAICHEUR_TREE_BANDS) swatches.push([`tree:${band.id}`, band.color]);
  for (const [id, color] of Object.entries(FRAICHEUR_FAMILY_COLORS)) swatches.push([`family:${id}`, color]);
  for (const state of FRAICHEUR_FOUNTAIN_STATES) swatches.push([`fountain:${state.id}`, state.color]);
  swatches.push(['canicule', FRAICHEUR_CANICULE_COLOR]);

  const GREY = FRAICHEUR_CANOPY_UNKNOWN.color.toLowerCase();
  const seen = new Map();
  for (const [id, color] of swatches) {
    const key = String(color).toLowerCase();
    assert.match(key, /^#[0-9a-f]{6}$/, `${id} must be a six-digit hex colour`);
    if (key === GREY) {
      // Grey is shared ON PURPOSE, by exactly the three channels that mean "the
      // register did not measure this" — and by no other.
      assert.ok(['canopy:inconnue', 'tree:sans-mesure', 'fountain:non-publiee'].includes(id),
        `${id} must not take the reserved "not measured" grey`);
      continue;
    }
    assert.equal(seen.has(key), false, `${id} shares ${key} with ${seen.get(key)}`);
    seen.set(key, id);
  }
  // And the selection colour is outside the data palette entirely, or a
  // selected object would be indistinguishable from an unselected one.
  assert.equal(seen.has('#00ffff'), false);
});

test('selecting a point highlights it in place and clearing puts it back', () => {
  const host = recordingHost();
  const viewer = fakeViewer();
  _setFraicheurStateForTest({ payload: PACK, overlayHost: host, viewer, now: AFTERNOON });
  const site = PACK.equipment[0];
  const record = _fraicheurRecordForTest(idOf(site));
  const base = record.basePixelSize;

  _selectFraicheurForTest(idOf(site));
  assert.equal(_fraicheurSelectedIdForTest(), idOf(site));
  assert.ok(record.point.pixelSize > base, 'the selected dot grows');
  const painted = host.calls.set.filter((call) => call.sourceId === FRAICHEUR_FR_OVERLAY_SOURCE_ID);
  assert.equal(painted.length, 1);
  assert.equal(painted[0].entries.length, 1, 'exactly one card, never a cohort');
  // A point is mutable, so it needs no second primitive — and adding one would
  // leak, because nothing would take it off again.
  assert.equal(viewer.added.length, 0);

  _clearFraicheurSelectionForTest();
  assert.equal(_fraicheurSelectedIdForTest(), null);
  assert.equal(record.point.pixelSize, base, 'the dot returns to its own size');
  assert.ok(host.calls.cleared.includes(FRAICHEUR_FR_OVERLAY_SOURCE_ID));
});

test('selecting a park adds one highlight primitive and clearing removes it', () => {
  const host = recordingHost();
  const viewer = fakeViewer();
  _setFraicheurStateForTest({ payload: PACK, overlayHost: host, viewer, now: AFTERNOON });
  const space = PACK.spaces.find((row) => row.parts.length === 1);
  assert.ok(space, 'the fixture must carry a single-part park');

  _selectFraicheurForTest(idOf(space));
  assert.equal(_fraicheurSelectedIdForTest(), idOf(space));
  // A batched instance cannot be restyled without rebuilding 127 465 vertices,
  // so the highlight is a SECOND stroke — which must come off again, or a
  // de-selected park stays lit.
  assert.equal(viewer.added.length, 1);

  _clearFraicheurSelectionForTest();
  assert.equal(_fraicheurSelectedIdForTest(), null);
  assert.equal(viewer.added.length, 0, 'the highlight primitive must be removed');
});

test('an unknown id selects nothing rather than selecting the first object', () => {
  const host = recordingHost();
  const viewer = fakeViewer();
  _setFraicheurStateForTest({ payload: PACK, overlayHost: host, viewer, now: AFTERNOON });
  _selectFraicheurForTest('fraicheur-fr:not-a-real-object');
  assert.equal(_fraicheurSelectedIdForTest(), null);
  assert.equal(viewer.added.length, 0);
  assert.equal(host.calls.set.length, 0);
  // Pick arbitration must not claim an id this layer does not own, or a click
  // on a stacked layer's parcel would open a park card.
  assert.equal(resolveFraicheurPickId(null), null);
  assert.equal(resolveFraicheurPickId({ id: 'cadastre-fr:xyz' }), null);
  assert.equal(resolveFraicheurPickId({ id: idOf(PACK.spaces[0]) }), idOf(PACK.spaces[0]));
  assert.equal(resolveFraicheurPickId({ id: { id: idOf(PACK.spaces[0]) } }), idOf(PACK.spaces[0]));
  _clearFraicheurSelectionForTest();
});

test('a card built for each register says what that register publishes', () => {
  _setFraicheurStateForTest({ payload: PACK, trees: TREES, overlayHost: recordingHost(), now: AFTERNOON });
  const hot = PACK.spaces.find((row) => row.canicule === true && row.canopy === 0);
  const spaceCard = norm(buildFraicheurSelectionLabel(_fraicheurRecordForTest(idOf(hot)), PACK));
  assert.match(spaceCard, /Ouverture canicule déclarée/);
  assert.match(spaceCard, /0 % de canopée mesurée/);
  assert.match(spaceCard, /Ville de Paris — ODbL/);
  assert.match(spaceCard, /relevé 2024/);

  // The fountains are Eau de Paris, a DIFFERENT publisher. Merging the footer
  // would drop an attribution the ODbL requires.
  const tap = PACK.fountains[0];
  const fountainCard = norm(buildFraicheurSelectionLabel(_fraicheurRecordForTest(idOf(tap)), PACK));
  assert.match(fountainCard, /Eau de Paris/);
  assert.equal(/Ville de Paris — ODbL/.test(fountainCard), false);

  const tree = TREES.trees.find((row) => row.height === null);
  const treeCard = norm(buildFraicheurSelectionLabel(_fraicheurRecordForTest(idOf(tree)), PACK));
  assert.match(treeCard, /Hauteur non mesurée/);
  assert.match(treeCard, /Direction des Espaces Verts/);

  // Nothing anywhere may claim liveness: the registers are daily batches and
  // the canopy survey is from 2024.
  for (const card of [spaceCard, fountainCard, treeCard]) {
    assert.equal(/temps réel|en direct/i.test(card), false, `"${card}" must not claim liveness`);
  }
  assert.equal(buildFraicheurSelectionLabel(null), '');
  assert.equal(buildFraicheurSelectionLabel({ kind: 'nope' }), '');
  _clearFraicheurSelectionForTest();
});

test('a site with no readable timetable is never carded as closed', () => {
  _setFraicheurStateForTest({ payload: PACK, overlayHost: recordingHost(), now: AFTERNOON });
  let checked = 0;
  for (const site of PACK.equipment) {
    const readable = (site.schedule?.days || []).some((day) => day && day !== '-'
      && !/^Les horaires/.test(day));
    if (readable || site.open24 === true) continue;
    checked += 1;
    const card = norm(buildFraicheurSelectionLabel(_fraicheurRecordForTest(idOf(site)), PACK));
    assert.match(card, /Aucun horaire hebdomadaire publié/);
    assert.equal(/Fermé maintenant/.test(card), false, `${site.id} must not be carded as closed`);
  }
  assert.ok(checked > 0, 'the fixture must carry a site with no readable timetable');
  _clearFraicheurSelectionForTest();
});

test('the overlay entry accents a heatwave park differently from everything else', () => {
  _setFraicheurStateForTest({ payload: PACK, overlayHost: recordingHost(), now: AFTERNOON });
  const hot = PACK.spaces.find((row) => row.canicule === true);
  const cool = PACK.spaces.find((row) => row.canicule !== true);
  const hotEntry = createFraicheurSelectedOverlayEntry(_fraicheurRecordForTest(idOf(hot)), PACK);
  const coolEntry = createFraicheurSelectedOverlayEntry(_fraicheurRecordForTest(idOf(cool)), PACK);
  assert.ok(hotEntry && coolEntry);
  assert.equal(hotEntry.accent, FRAICHEUR_CANICULE_COLOR);
  assert.notEqual(coolEntry.accent, FRAICHEUR_CANICULE_COLOR);
  assert.equal(hotEntry.protected, true);
  assert.ok(hotEntry.title);
  assert.ok(hotEntry.details.length > 1);
  // No position, no card — never a card at 0,0.
  assert.equal(createFraicheurSelectedOverlayEntry({ id: 'x', kind: 'space', row: {} }), null);
  _clearFraicheurSelectionForTest();
});

test('the row legend leads with the heatwave asymmetry and counts only what it colours', () => {
  _setFraicheurStateForTest({ payload: PACK, trees: TREES, overlayHost: recordingHost(), now: AFTERNOON });
  const { chips, legend } = _fraicheurRowControlsForTest();
  assert.deepEqual(chips, []);
  assert.ok(legend.length > 1);
  // First, because it is the finding: the register is 984 parks and 23 of them
  // declare a heatwave arrangement.
  assert.equal(legend[0].label, 'Ouvert en canicule');
  assert.equal(legend[0].color, FRAICHEUR_CANICULE_COLOR);
  assert.equal(legend[0].count, PACK.summary.canicule);
  // The 24 h count in the blurb is taken INSIDE the heatwave set, not across
  // the register — 189 of 984 carry the flag and only 9 of the 23 do.
  const canicule24 = PACK.spaces.filter((s) => s.canicule === true && s.open24 === true).length;
  assert.match(norm(legend[0].blurb), new RegExp(`dont ${canicule24} ouverts 24 h/24`));
  for (const row of legend) {
    assert.ok(row.label, 'every legend row is named');
    assert.equal(/\(FR\)/.test(row.label), false);
    assert.ok(Number.isFinite(row.count), `${row.label} carries a count`);
    assert.ok(row.color, `${row.label} carries a colour`);
  }
  // The canopy rows must sum to the parks, and no ramp row may be a duplicate
  // of the grey "not measured" one.
  const rampRows = legend.filter((row) => FRAICHEUR_CANOPY_BANDS.some((b) => b.label === row.label));
  const greyRows = legend.filter((row) => row.label === FRAICHEUR_CANOPY_UNKNOWN.label);
  const canopyTotal = [...rampRows, ...greyRows].reduce((sum, row) => sum + row.count, 0);
  assert.equal(canopyTotal, PACK.summary.spaces);
  assert.equal(greyRows.length, 1);
  // The tree bands only appear when trees are actually on screen.
  const treeRows = legend.filter((row) => FRAICHEUR_TREE_BANDS.some((b) => b.label === row.label));
  assert.ok(treeRows.length > 0);
  _clearFraicheurSelectionForTest();

  _setFraicheurStateForTest({ payload: PACK, overlayHost: recordingHost(), now: AFTERNOON });
  const withoutTrees = _fraicheurRowControlsForTest().legend
    .filter((row) => FRAICHEUR_TREE_BANDS.some((b) => b.label === row.label));
  assert.equal(withoutTrees.length, 0, 'no tree band is legended when no tree is drawn');
  _clearFraicheurSelectionForTest();
  assert.deepEqual(_fraicheurRowControlsForTest(), { chips: [], legend: [] });
});

test('the open-now answer is recomputed on the browser clock, not on the fetch', () => {
  // The pack ships a summary the proxy folded at fetch time and caches for an
  // hour. Measured over the real registers, "open right now" is 757 green
  // spaces and 93 cool spots at 14 h 00 Paris against 367 and 0 at 01 h 30 — an
  // hour-old answer to this question is a wrong answer.
  _setFraicheurStateForTest({ payload: PACK, overlayHost: recordingHost(), now: AFTERNOON });
  const afternoon = _fraicheurStatsForTest();
  _clearFraicheurSelectionForTest();
  _setFraicheurStateForTest({ payload: PACK, overlayHost: recordingHost(), now: NIGHT });
  const night = _fraicheurStatsForTest();
  assert.ok(afternoon.openNow > night.openNow,
    `open-now must fall overnight (${afternoon.openNow} vs ${night.openNow})`);
  assert.equal(afternoon.parisTime.replace(/\s+/g, ''), '14h00');
  assert.equal(night.parisTime.replace(/\s+/g, ''), '01h30');
  // "Unknown" is a property of the register, not of the hour.
  assert.equal(afternoon.unknownNow, night.unknownNow);
  _clearFraicheurSelectionForTest();
});

test('getStats reports being off Paris as guidance, never as an error', () => {
  _setFraicheurStateForTest({ payload: PACK, overlayHost: recordingHost(), inView: false, now: AFTERNOON });
  const stats = _fraicheurStatsForTest();
  assert.ok(stats);
  // `layerFeedState()` treats 'zoom-in' / 'empty' / 'idle' as GUIDANCE and
  // still paints a green ON chip. A prompt smuggled into `error` paints a fault.
  if (stats.status && stats.status !== 'ok') {
    assert.ok(['zoom-in', 'empty', 'idle', 'loading'].includes(stats.status), stats.status);
  }
  assert.equal(stats.error, undefined, 'being off Paris is not an error');
  assert.match(norm(stats.loadingLabel), /Hors Paris/);
  assert.equal(stats.canicule, PACK.summary.canicule);
  assert.equal(stats.caniculeWithoutCanopy, PACK.summary.caniculeWithoutCanopy);
  assert.equal(stats.expiredSchedules, PACK.summary.spacesExpired);
  assert.equal(stats.fountainsStaleOutage, PACK.summary.fountainsStaleOutage);
  _clearFraicheurSelectionForTest();
});

test('a stale pack is reported stale rather than quietly drawn as fresh', () => {
  _setFraicheurStateForTest({ payload: { ...PACK, stale: true }, overlayHost: recordingHost(), now: AFTERNOON });
  assert.equal(_fraicheurStatsForTest().stale, true);
  _clearFraicheurSelectionForTest();
  _setFraicheurStateForTest({ payload: PACK, overlayHost: recordingHost(), now: AFTERNOON });
  assert.notEqual(_fraicheurStatsForTest().stale, true);
  _clearFraicheurSelectionForTest();
});

test('a refused tree box reports the count it refused, and draws nothing short', () => {
  _setFraicheurStateForTest({
    payload: PACK, overlayHost: recordingHost(), treeStatus: 'too-dense', treeTotal: 10571, now: AFTERNOON,
  });
  const stats = _fraicheurStatsForTest();
  assert.equal(stats.treeStatus, 'too-dense');
  assert.equal(stats.treeTotalInBox, 10571);
  assert.equal(stats.trees, 0, 'a refused box draws no trees at all');
  assert.match(norm(stats.loadingLabel), /10 571 arbres ici — zoome/);
  _clearFraicheurSelectionForTest();

  _setFraicheurStateForTest({
    payload: PACK, overlayHost: recordingHost(), treeStatus: 'too-high', now: AFTERNOON,
  });
  assert.match(norm(_fraicheurStatsForTest().loadingLabel), /arbres : descends pour les charger/);
  _clearFraicheurSelectionForTest();
});

test('the tree gate refuses on coverage before it refuses on altitude', () => {
  // A high view of the Atlantic told to descend is advice that would still find
  // nothing at sea level.
  assert.deepEqual(fraicheurTreeViewport(null), { box: null, reason: 'no-view' });
  const atlantic = fakeCamera({ lat: 45, lon: -20, height: 40_000 });
  assert.equal(fraicheurTreeViewport(atlantic).reason, 'off-coverage');
  const tooHigh = fakeCamera({ height: FRAICHEUR_TREE_MAX_ALTITUDE_M + 1, span: 0.005 });
  assert.equal(fraicheurTreeViewport(tooHigh).reason, 'too-high');
  const inTheStreet = fakeCamera({ height: 300, span: 0.004 });
  const { box, reason } = fraicheurTreeViewport(inTheStreet);
  assert.equal(reason, null);
  assert.ok(box);
  // Snapped onto the same 0.002° grid the proxy caches on, so panning a few
  // streets re-uses the answer.
  for (const edge of [box.south, box.west, box.north, box.east]) {
    assert.ok(Math.abs(edge / 0.002 - Math.round(edge / 0.002)) < 1e-6, `${edge} is off the cache grid`);
  }
  assert.ok(box.north - box.south <= 0.022 + 1e-9);
  assert.ok(box.east - box.west <= 0.022 + 1e-9);
});

test('the coverage box reaches the cemeteries outside the walls', () => {
  // NOT the city boundary: 159 fountains and 25 045 trees are in Thiais,
  // Pantin, Saint-Ouen and Bagneux. A box on the périphérique would report them
  // as off-map.
  assert.ok(FRAICHEUR_PARIS_BOX.south <= 48.7423);
  assert.ok(FRAICHEUR_PARIS_BOX.north >= 48.9122);
  assert.ok(FRAICHEUR_PARIS_BOX.west <= 2.2102);
  assert.ok(FRAICHEUR_PARIS_BOX.east >= 2.4698);
  assert.equal(fraicheurInView(null), false);
  assert.equal(fraicheurInView(fakeCamera({ lat: 48.86, lon: 2.35, span: 0.01 })), true);
  assert.equal(fraicheurInView(fakeCamera({ lat: 35.68, lon: 139.69, span: 0.05 })), false);
});

test('DETECT names the four registers apart and never places what it cannot', () => {
  _setFraicheurStateForTest({ payload: PACK, trees: TREES, overlayHost: recordingHost(), now: AFTERNOON });
  const candidates = _fraicheurDetectablesForTest({ maxCount: 500 });
  assert.ok(candidates.length > 0);
  for (const candidate of candidates) {
    assert.ok(candidate.position, 'a detectable must carry a position');
    assert.ok(candidate.sourceId);
    assert.ok(candidate.id, 'a detectable must carry a label');
    assert.ok(['Cool green space', 'Cool refuge', 'Remarkable tree', 'Drinking fountain']
      .includes(candidate.type), candidate.type);
  }
  // The heatwave parks come first — they are the finding, and a stride over
  // 15 000 objects would bury all 23 of them under plane trees.
  assert.equal(candidates[0].type, 'Cool green space');
  // An ordinary tree is never a candidate: only the 183 the city itself calls
  // remarkable are.
  const ordinary = TREES.trees.find((tree) => tree.remarquable !== true);
  assert.equal(candidates.some((c) => c.sourceId === idOf(ordinary)), false);
  // The cap is honoured.
  assert.ok(_fraicheurDetectablesForTest({ maxCount: 3 }).length <= 3);
  assert.equal(fraicheurDetectType({ kind: 'fountain' }), 'Drinking fountain');
  _clearFraicheurSelectionForTest();
  assert.deepEqual(_fraicheurDetectablesForTest({}), [], 'a disabled layer offers nothing');
});

test('geometry helpers refuse a shape they cannot place', () => {
  assert.equal(fraicheurRingPositions(null), null);
  assert.equal(fraicheurRingPositions([]), null);
  assert.equal(fraicheurRingPositions([[2, 48], [2.1, 48.1]]), null, 'two points are not a ring');
  const ring = fraicheurRingPositions([[2, 48], [2.1, 48], [2.1, 48.1], [2, 48]]);
  assert.ok(ring);
  // The repeated closing vertex is dropped: `PolygonGeometry` closes its own
  // rings and a duplicate makes a degenerate triangle at the seam.
  assert.equal(ring.length, 3);

  // The anchor stands inside the widest part; a space without one falls back to
  // a coordinate the city published, never to a computed centroid.
  const anchored = fraicheurSpaceAnchor(PACK.spaces[0]);
  assert.ok(Number.isFinite(anchored.lon) && Number.isFinite(anchored.lat));
  const parts = [[[[2.3, 48.8], [2.31, 48.8], [2.31, 48.81], [2.3, 48.8]]]];
  const fallback = fraicheurSpaceAnchor({ anchor: null, parts });
  assert.deepEqual(fallback, { lon: 2.3, lat: 48.8 });
  assert.equal(fraicheurSpaceAnchor({ anchor: null, parts: [] }), null);
  assert.equal(fraicheurSpaceAnchor(null), null);
});

test('a failed tree box is said out loud, not left as an empty street', () => {
  // The 2 842 refuges are still on screen so this is not a layer fault — but an
  // operator reading an empty street as a street with no trees on it is exactly
  // the misreading this layer exists to prevent.
  _setFraicheurStateForTest({
    payload: PACK, overlayHost: recordingHost(), treeStatus: 'unavailable', now: AFTERNOON,
  });
  const stats = _fraicheurStatsForTest();
  assert.match(norm(stats.loadingLabel), /arbres indisponibles pour cette vue/);
  assert.equal(stats.error, undefined, 'a failed tree box is not a layer error');
  assert.equal(stats.status, 'ok');
  _clearFraicheurSelectionForTest();
});

test('the row label degrades without throwing on a half-built state', () => {
  assert.doesNotThrow(() => buildFraicheurLoadingLabel({}));
  assert.doesNotThrow(() => buildFraicheurLoadingLabel({ loading: true }));
  assert.equal(buildFraicheurLoadingLabel({ payload: null, summary: null, inView: true }), null);
  assert.match(norm(buildFraicheurLoadingLabel({ loading: true })), /lecture des trois registres/);
});

test('the real load path builds the two proxy URLs the vite plugin answers', async () => {
  const calls = [];
  const host = recordingHost();
  const viewer = { ...fakeCamera({ height: 300, span: 0.004 }), ...fakeViewer() };
  viewer.scene = { ...fakeCamera({ height: 300, span: 0.004 }).scene, ...fakeViewer().scene };
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).startsWith(FRAICHEUR_REFUGES_URL)) {
      return { ok: true, json: async () => ({ ...PACK, fetchedAt: AFTERNOON }) };
    }
    return { ok: true, json: async () => TREES };
  };
  _setFraicheurStateForTest({
    payload: null, viewer, overlayHost: host, fetchImpl, now: AFTERNOON,
  });
  const changed = await _fraicheurLoadForTest({ force: true });
  assert.equal(changed, true);
  assert.equal(calls.length, 2, 'one call for the city pack, one for the tree box');
  assert.equal(calls[0], FRAICHEUR_REFUGES_URL, 'the pack takes no viewport parameter at all');
  assert.ok(calls[1].startsWith(`${FRAICHEUR_TREES_URL}?`));
  const params = new URL(calls[1], 'http://localhost').searchParams;
  for (const key of ['south', 'west', 'north', 'east']) {
    const value = Number(params.get(key));
    assert.ok(Number.isFinite(value), `${key} must be a number`);
    // Snapped onto the 0.002° grid the proxy caches on.
    assert.ok(Math.abs(value / 0.002 - Math.round(value / 0.002)) < 1e-6, `${key}=${value} is off the grid`);
  }
  const state = _fraicheurTreeStateForTest();
  assert.equal(state.status, 'ready');
  assert.equal(state.drawn, TREES.trees.length);
  // A second load at the same camera re-asks neither: the pack is unchanged and
  // the tree box key is the same, so a pan of a few metres costs nothing.
  const again = await _fraicheurLoadForTest();
  assert.equal(again, false);
  assert.equal(calls.length, 2);
  _clearFraicheurSelectionForTest();
});

test('a refused tree box clears the trees rather than leaving the last box drawn', async () => {
  const viewer = { ...fakeCamera({ height: 300, span: 0.004 }), ...fakeViewer() };
  viewer.scene = { ...fakeCamera({ height: 300, span: 0.004 }).scene, ...fakeViewer().scene };
  let answer = { ...TREES };
  const fetchImpl = async (url) => (String(url).startsWith(FRAICHEUR_REFUGES_URL)
    ? { ok: true, json: async () => ({ ...PACK, fetchedAt: AFTERNOON }) }
    : { ok: true, json: async () => answer });
  _setFraicheurStateForTest({ payload: null, viewer, overlayHost: recordingHost(), fetchImpl, now: AFTERNOON });
  await _fraicheurLoadForTest({ force: true });
  assert.equal(_fraicheurTreeStateForTest().drawn, TREES.trees.length);

  // The proxy refuses over budget and hands back only the true count. Leaving
  // the previous box drawn would show the operator a neighbouring viewport's
  // trees under a refusal message.
  answer = { box: TREES.box, trees: [], truncated: true, totalInBox: 10571, budget: 12500 };
  _clearFraicheurSelectionForTest();
  _setFraicheurStateForTest({ payload: null, viewer, overlayHost: recordingHost(), fetchImpl, now: AFTERNOON });
  await _fraicheurLoadForTest({ force: true });
  const state = _fraicheurTreeStateForTest();
  assert.equal(state.status, 'too-dense');
  assert.equal(state.total, 10571);
  assert.equal(state.drawn, 0, 'nothing is drawn short');
  _clearFraicheurSelectionForTest();
});

test('a proxy failure with nothing in hand is an error, and with a pack in hand is not', async () => {
  const viewer = { ...fakeCamera({ height: 300, span: 0.004 }), ...fakeViewer() };
  viewer.scene = { ...fakeCamera({ height: 300, span: 0.004 }).scene, ...fakeViewer().scene };
  let ok = false;
  const fetchImpl = async (url) => {
    if (!ok) return { ok: false, status: 503 };
    return String(url).startsWith(FRAICHEUR_REFUGES_URL)
      ? { ok: true, json: async () => ({ ...PACK, fetchedAt: AFTERNOON }) }
      : { ok: true, json: async () => TREES };
  };
  _setFraicheurStateForTest({ payload: null, viewer, overlayHost: recordingHost(), fetchImpl, now: AFTERNOON });
  await _fraicheurLoadForTest({ force: true });
  const cold = _fraicheurStatsForTest();
  assert.equal(cold.status, 'error');
  assert.match(cold.error, /indisponibles/);

  // With an hour-old pack in hand the same failure keeps drawing it and says
  // the REFRESH failed, rather than blanking a city.
  ok = true;
  await _fraicheurLoadForTest({ force: true });
  ok = false;
  await _fraicheurLoadForTest({ force: true });
  const warm = _fraicheurStatsForTest();
  assert.equal(warm.status, 'ok');
  assert.match(warm.error, /rafraîchissement/);
  assert.ok(warm.count > 0, 'the pack is still drawn');
  _clearFraicheurSelectionForTest();
});
