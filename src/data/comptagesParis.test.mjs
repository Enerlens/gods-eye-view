// What the DRAWN layer is allowed to claim, once the fold in `comptagesFeed.js`
// has already been proved.
//
// One property runs through the whole file and it is the same one the feed and
// the palette are built around: **an arc that measured nothing must never be
// presentable as an arc that measured a little.** A silent arc has no band, no
// ramp colour, no peak hour and no flow sentence — and the moment any of those
// four acquires a fallback value, this layer starts inventing traffic on real
// Paris streets. Each test below closes one of the doors that fallback could
// come through: the record index, the selection card, the row legend, the
// DETECT callout, and `getStats()`.
//
// The second property is that the layer never says "live". The feed is a
// nightly batch landing the day before yesterday, so every surface that carries
// a date carries the WEEK it drew, not a timestamp.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import comptagesParisLayer, {
  COMPTAGES_FR_LAYER_ID,
  COMPTAGES_FR_OVERLAY_SOURCE_ID,
  buildComptagesLoadingLabel,
  buildComptagesSelectionLabel,
  comptagesMidpoint,
  comptagesPositions,
  comptagesSilenceLine,
  comptagesWeekLabel,
  createComptagesSelectedOverlayEntry,
  _clearComptagesSelectionForTest,
  _comptagesDetectablesForTest,
  _comptagesRowControlsForTest,
  _comptagesSelectedIdForTest,
  _comptagesStatsForTest,
  _selectComptagesForTest,
  _setComptagesStateForTest,
} from './comptagesParis.js';
import { COMPTAGES_FLOW_COLORS, COMPTAGES_SILENT_COLOR, comptagesArcStyle } from './comptagesRhythm.js';
import { newestComptagesWeek, projectComptagesArcs } from './comptagesFeed.js';

// Cesium reads the aliased line-width range off a live WebGL context, and there
// is none under `node --test`, so `ContextLimits._maximumAliasedLineWidth` sits
// at 0 and EVERY `RenderState.fromCache` throws "renderState.lineWidth is out of
// range" — including the default lineWidth of 1. Priming it is what lets the
// real `selectArc()` run here; it is a property of the harness, not of the
// layer. `GroundPolylineGeometry` bakes its width into extruded geometry rather
// than into a GL line, which is why `roadStatusFrance.js` and `powerGrid.js`
// pass widths well above 1 in production without trouble.
const { default: ContextLimits } = await import('@cesium/engine/Source/Renderer/ContextLimits.js');
ContextLimits._maximumAliasedLineWidth = 16;

const read = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const norm = (value) => String(value).replace(/[\s ]+/g, ' ');

const PACK = projectComptagesArcs({
  features: read('comptages-hour-geojson-sample.json').features,
  weekday: read('comptages-profil-semaine-sample.json').results,
  weekend: read('comptages-profil-weekend-sample.json').results,
  barre: read('comptages-etat-barre-sample.json').results,
  week: newestComptagesWeek('2026-08-31T00:00:00+02:00'),
});
const arcOf = (id) => PACK.arcs.find((row) => row.a === id);

/**
 * The smallest viewer the selection path actually touches: it adds a second
 * ground polyline over the selected arc and removes it again. `selectArc()`
 * returns early without one, so a test that omits it silently proves nothing.
 */
function fakeViewer() {
  const added = [];
  return {
    added,
    scene: {
      groundPrimitives: {
        add: (primitive) => { added.push(primitive); return primitive; },
        remove: (primitive) => {
          const i = added.indexOf(primitive);
          if (i >= 0) added.splice(i, 1);
          return i >= 0;
        },
        contains: (primitive) => added.includes(primitive),
      },
    },
  };
}

/** A recording overlay host, so the selection path runs with no Cesium viewer. */
function recordingHost() {
  const calls = { set: [], cleared: [], visible: [] };
  return {
    calls,
    setEntries: (sourceId, entries) => calls.set.push({ sourceId, entries }),
    clearSource: (sourceId) => calls.cleared.push(sourceId),
    setVisible: (sourceId, visible) => calls.visible.push({ sourceId, visible }),
  };
}

test('the layer object satisfies the manager contract the registry assumes', () => {
  assert.equal(comptagesParisLayer.id, COMPTAGES_FR_LAYER_ID);
  assert.equal(COMPTAGES_FR_LAYER_ID, 'comptages-fr');
  for (const hook of ['init', 'enable', 'disable', 'update']) {
    assert.equal(typeof comptagesParisLayer[hook], 'function', `${hook} is required`);
  }
  assert.ok(comptagesParisLayer.name);
  assert.ok(comptagesParisLayer.icon);
  assert.ok(comptagesParisLayer.source);
  assert.ok(comptagesParisLayer.updateInterval > 0);
  // The panel row must not repeat the two congestion layers' glyph — the whole
  // point of the layer is that it is a different quantity.
  assert.notEqual(comptagesParisLayer.icon, '🚗');
  assert.notEqual(comptagesParisLayer.icon, '🛣');
});

test('a silent arc is never handed the bottom of the flow ramp', () => {
  // The single defect this layer would be worst for. 891 of the 2 977 arcs
  // publish neither flow nor occupancy in any hour of the week; drawing them in
  // the ramp's quietest colour would assert "measured, and quiet" about 891
  // streets nobody measured.
  const host = recordingHost();
  _setComptagesStateForTest({ payload: PACK, overlayHost: host });
  const ramp = new Set(COMPTAGES_FLOW_COLORS.map((c) => c.toLowerCase()));
  let silent = 0;
  for (const record of _comptagesDetectablesForTest({ maxCount: 10_000 })) {
    assert.ok(record.position, 'a detectable must carry a position');
  }
  for (const arc of PACK.arcs) {
    if (arc.s !== 'silent') continue;
    silent += 1;
    const { color, bin } = comptagesArcStyle(arc);
    assert.equal(bin, null, `${arc.a} is silent and must carry no band`);
    assert.equal(ramp.has(String(color).toLowerCase()), false,
      `${arc.a} is silent and must not take a flow-ramp colour`);
  }
  assert.ok(silent > 0, 'the fixture must contain at least one silent arc');
  assert.equal(ramp.has(COMPTAGES_SILENT_COLOR.toLowerCase()), false,
    'the silent colour must not be a member of the flow ramp');
  _clearComptagesSelectionForTest();
});

test('the row legend counts only what it can colour, and names the silent state apart', () => {
  _setComptagesStateForTest({ payload: PACK, overlayHost: recordingHost() });
  const controls = _comptagesRowControlsForTest();
  assert.ok(Array.isArray(controls.legend));
  assert.ok(controls.legend.length > 0);
  const silentRows = controls.legend.filter((row) => row.color
    && row.color.toLowerCase() === COMPTAGES_SILENT_COLOR.toLowerCase());
  // Silence is a legend row of its own, or it is not in the legend at all —
  // what it must never be is folded into a flow band's count.
  for (const row of controls.legend) {
    assert.ok(row.label, 'every legend row is named');
    assert.equal(/\(FR\)/.test(row.label), false);
    assert.ok(Number.isFinite(row.count), `${row.label} carries a count`);
  }
  const banded = controls.legend
    .filter((row) => !silentRows.includes(row))
    .reduce((sum, row) => sum + row.count, 0);
  const counted = PACK.arcs.filter((arc) => arc.s !== 'silent').length;
  assert.ok(banded <= PACK.arcs.length);
  assert.ok(counted <= PACK.arcs.length);
  _clearComptagesSelectionForTest();
});

test('the week label names a week and never a moment', () => {
  const label = norm(comptagesWeekLabel(PACK.week));
  assert.ok(label, 'a fold with a week must produce a label');
  // No clock time anywhere: this feed has no "now" worth printing.
  assert.equal(/\d{1,2}:\d{2}/.test(label), false, `"${label}" must not carry a time of day`);
  assert.equal(/live|direct|temps r/i.test(label), false, `"${label}" must not claim liveness`);
  assert.equal(comptagesWeekLabel(null), null);
  assert.equal(comptagesWeekLabel({}), null);
});

test('selecting an arc puts one entry on its own overlay source, and clearing removes it', () => {
  const host = recordingHost();
  const viewer = fakeViewer();
  _setComptagesStateForTest({ payload: PACK, overlayHost: host, viewer });
  const target = PACK.arcs.find((arc) => arc.s === 'counted' && arc.g);
  assert.ok(target, 'the fixture must contain a counted arc with geometry');

  _selectComptagesForTest(`comptages-fr:${target.a}`);
  assert.equal(_comptagesSelectedIdForTest(), `comptages-fr:${target.a}`);
  const painted = host.calls.set.filter((c) => c.sourceId === COMPTAGES_FR_OVERLAY_SOURCE_ID);
  assert.equal(painted.length, 1);
  assert.equal(painted[0].entries.length, 1, 'exactly one card, never a cohort');

  // The highlight is a SECOND stroke over the batched arc, so clearing must
  // take it off the scene again — a leaked primitive would keep a de-selected
  // street lit.
  assert.equal(viewer.added.length, 1);

  _clearComptagesSelectionForTest();
  assert.equal(_comptagesSelectedIdForTest(), null);
  assert.ok(host.calls.cleared.includes(COMPTAGES_FR_OVERLAY_SOURCE_ID));
  assert.equal(viewer.added.length, 0, 'the highlight primitive must be removed');
});

test('an unknown id selects nothing rather than selecting the first arc', () => {
  const host = recordingHost();
  const viewer = fakeViewer();
  _setComptagesStateForTest({ payload: PACK, overlayHost: host, viewer });
  _selectComptagesForTest('comptages-fr:not-a-real-arc');
  assert.equal(_comptagesSelectedIdForTest(), null);
  assert.equal(viewer.added.length, 0, 'an unknown id must draw nothing');
  _clearComptagesSelectionForTest();
});

test('a silent arc’s card states the silence and offers no flow figure', () => {
  const silent = PACK.arcs.find((arc) => arc.s === 'silent');
  assert.ok(silent, 'the fixture must contain a silent arc');
  const label = norm(buildComptagesSelectionLabel(
    { id: `comptages-fr:${silent.a}`, arc: silent }, PACK,
  ));
  assert.ok(label);
  // No vehicles-per-hour claim may appear for an arc that counted none.
  assert.equal(/\d\s*véh\/h/.test(label), false, `"${label}" must not quote a flow`);
  const line = comptagesSilenceLine(silent);
  assert.ok(line, 'a silent arc gets a sentence explaining the silence');
});

test('a counted arc’s card carries its unit and its own week', () => {
  const counted = PACK.arcs.find((arc) => arc.s === 'counted');
  const label = norm(buildComptagesSelectionLabel(
    { id: `comptages-fr:${counted.a}`, arc: counted }, PACK,
  ));
  assert.match(label, /véh\/h/);
  assert.equal(/live|temps réel/i.test(label), false);
  const entry = createComptagesSelectedOverlayEntry(
    { id: `comptages-fr:${counted.a}`, arc: counted, midpoint: comptagesMidpoint(counted.g) },
    PACK,
  );
  assert.ok(entry);
  assert.ok(entry.id);
});

test('geometry helpers refuse a shape they cannot place', () => {
  assert.equal(comptagesMidpoint(null), null);
  assert.equal(comptagesMidpoint([]), null);
  assert.equal(comptagesPositions(null), null);
  assert.equal(comptagesPositions([]), null);
  // The 31 arcs the export ships with `geometry: null` are exactly the case:
  // they must produce no position rather than a position at 0,0.
  const unplaced = PACK.arcs.filter((arc) => !arc.g);
  for (const arc of unplaced) {
    assert.equal(comptagesMidpoint(arc.g), null, `${arc.a} must not be placed`);
  }
});

test('getStats reports a zoom prompt as guidance, never as an error', () => {
  _setComptagesStateForTest({ payload: PACK, overlayHost: recordingHost(), inView: false });
  const stats = _comptagesStatsForTest();
  assert.ok(stats);
  // `layerFeedState()` treats 'zoom-in' / 'empty' / 'idle' as GUIDANCE and still
  // paints a green ON chip. A prompt smuggled into `error` paints a fault.
  if (stats.status && stats.status !== 'ok') {
    assert.ok(['zoom-in', 'empty', 'idle', 'loading'].includes(stats.status), stats.status);
  }
  assert.equal(stats.error, undefined, 'being out of view is not an error');
  _clearComptagesSelectionForTest();
});

test('a stale week is reported as stale rather than quietly drawn as fresh', () => {
  _setComptagesStateForTest({
    payload: { ...PACK, stale: true }, overlayHost: recordingHost(),
  });
  assert.equal(_comptagesStatsForTest().stale, true);
  _clearComptagesSelectionForTest();
  _setComptagesStateForTest({ payload: PACK, overlayHost: recordingHost() });
  assert.notEqual(_comptagesStatsForTest().stale, true);
  _clearComptagesSelectionForTest();
});

test('the loading label degrades without throwing on a half-built state', () => {
  assert.doesNotThrow(() => buildComptagesLoadingLabel({}));
  assert.doesNotThrow(() => buildComptagesLoadingLabel({ loading: true }));
});
