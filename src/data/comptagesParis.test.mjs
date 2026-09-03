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
// a date carries the WEEK it drew, not a timestamp — and since 2026-09-03 it
// also carries the SLOT, because the hour cursor made "which map is this"
// a real question. A chip that moved the map without moving the label would be
// rule E1 broken by the very control that made it matter.
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
  _comptagesRecordsForTest,
  _comptagesSetParamsForTest,
  _comptagesSlotForTest,
  _comptagesStatsForTest,
  _drawComptagesForTest,
  _selectComptagesForTest,
  _setComptagesStateForTest,
} from './comptagesParis.js';
import {
  COMPTAGES_FLOW_WIDTHS,
  COMPTAGES_HOUR_GAP_COLOR,
  COMPTAGES_HOUR_GAP_LABEL,
  COMPTAGES_MOMENTS,
  COMPTAGES_RHYTHM_COLORS,
  COMPTAGES_SILENT_COLOR,
  comptagesArcStyle,
  comptagesResolveSlot,
  comptagesSlotLabel,
} from './comptagesRhythm.js';
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

// The two absence strokes are dashed, and a dash is a `Material`. Cesium types
// a material uniform by testing it against the DOM image classes —
// `uniformValue instanceof HTMLCanvasElement` and friends, `Material.js:1262` —
// and under `node --test` those identifiers do not exist, so `Material.fromType`
// throws a ReferenceError before it ever reaches a GPU. Declaring the four names
// is a property of the harness, the same as the line width above, and
// `anfrFrance.test.mjs` established it: nothing here is ever an instance of
// them, so the chain falls through to the object branch the colour and dash
// uniforms actually belong in.
for (const name of ['HTMLCanvasElement', 'HTMLImageElement', 'ImageBitmap', 'OffscreenCanvas']) {
  if (!(name in globalThis)) globalThis[name] = class {};
}

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
      // `GroundPolylinePrimitive.isSupported` reads exactly this one flag
      // (`GroundPolylinePrimitive.js:846`), so the real batch build runs here.
      frameState: { context: { depthTexture: true } },
      requestRender() {},
      postRender: { addEventListener: () => () => {} },
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
  const wheel = new Set(Object.values(COMPTAGES_RHYTHM_COLORS).map((c) => c.toLowerCase()));
  let silent = 0;
  for (const record of _comptagesDetectablesForTest({ maxCount: 10_000 })) {
    assert.ok(record.position, 'a detectable must carry a position');
  }
  for (const arc of PACK.arcs) {
    if (arc.s !== 'silent') continue;
    silent += 1;
    const { color, bin, rhythm, widthPx } = comptagesArcStyle(arc);
    assert.equal(bin, null, `${arc.a} is silent and must carry no band`);
    assert.equal(rhythm, null, `${arc.a} is silent and must carry no rhythm class`);
    assert.equal(wheel.has(String(color).toLowerCase()), false,
      `${arc.a} is silent and must not take a rhythm hue`);
    // Not the widest stroke either: the count channel is as closed to it as
    // the hue channel is.
    assert.ok(widthPx <= COMPTAGES_FLOW_WIDTHS[0]);
  }
  assert.ok(silent > 0, 'the fixture must contain at least one silent arc');
  assert.equal(wheel.has(COMPTAGES_SILENT_COLOR.toLowerCase()), false,
    'the silent colour must not be a member of the rhythm wheel');
  _clearComptagesSelectionForTest();
});

test('the legend has one block per channel, and every row is decodable', () => {
  _setComptagesStateForTest({ payload: PACK, overlayHost: recordingHost() });
  const controls = _comptagesRowControlsForTest();
  assert.ok(Array.isArray(controls.legend));
  assert.ok(controls.legend.length > 0);
  for (const row of controls.legend) {
    assert.ok(row.label, 'every legend row is named');
    assert.equal(/\(FR\)/.test(row.label), false);
    assert.ok(Number.isFinite(row.count), `${row.label} carries a count`);
    assert.ok(row.count > 0, `${row.label} is not published at zero`);
    assert.ok(row.blurb, `${row.label} explains itself`);
    assert.ok(/^#[0-9a-f]{6}$/i.test(row.color), `${row.label} has a colour`);
  }
  // Block 1 — the HUE. Rule D1: where a colour carries a value, the key that
  // decodes it travels with the map. Every rhythm class present is a row.
  const wheel = new Set(Object.values(COMPTAGES_RHYTHM_COLORS));
  const hueRows = controls.legend.filter((row) => wheel.has(row.color));
  const classesDrawn = new Set(
    PACK.arcs.map((arc) => comptagesArcStyle(arc).rhythm).filter(Boolean),
  );
  assert.equal(hueRows.length, classesDrawn.size);
  for (const row of hueRows) assert.equal(row.glyph, undefined, 'a hue row is a plain swatch');
  // The hue rows account for every counting arc, once each.
  assert.equal(hueRows.reduce((sum, row) => sum + row.count, 0), PACK.states.counted);

  // Block 2 — the WIDTH. Every count row is a masked stroke of the real width,
  // and none of them borrows a rhythm hue.
  const widthRows = controls.legend.filter((row) => row.glyph && /véh\/h/.test(row.label));
  assert.ok(widthRows.length > 0);
  for (const row of widthRows) {
    assert.match(row.glyph, /^data:image\/svg\+xml,/);
    assert.equal(wheel.has(row.color), false, `${row.label} borrows a rhythm hue`);
  }

  // Block 3 — the strokes off the count scale. Silence is a row of its own or
  // it is not in the legend at all; what it must never be is folded into a band.
  const silentRow = controls.legend.find((row) => row.color === COMPTAGES_SILENT_COLOR);
  assert.ok(silentRow, 'silence is named');
  assert.equal(silentRow.count, PACK.states.silent);
  assert.match(silentRow.label, /Aucune mesure/);
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

test('seven chips, exactly one lit, and the panel can round-trip every one', () => {
  _setComptagesStateForTest({ payload: PACK, overlayHost: recordingHost() });
  const controls = _comptagesRowControlsForTest();
  assert.equal(controls.chips.length, COMPTAGES_MOMENTS.length);
  assert.equal(controls.chips.filter((chip) => chip.active).length, 1);
  // The default is the aggregate, not the clock: chips are not serialized into
  // the share link (the layer is registered `enabled-only`), so two readers
  // opening the same link at different hours must see the same map.
  assert.equal(controls.chips.find((chip) => chip.active).id, 'mean');
  for (const chip of controls.chips) {
    assert.ok(chip.label, 'every chip is named');
    assert.ok(chip.title, 'every chip explains what it will draw');
    assert.ok(chip.params?.slot, 'every chip carries the param the manager will apply');
    assert.equal(chip.state, chip.active ? 'active' : 'idle');
    // The archive must be named on the chip itself — a reader hovering "W-E
    // 04 h" is being told which week's Saturday night that is.
    assert.match(chip.title, /semaine/);
    assert.equal(/live|temps réel|maintenant/i.test(chip.title), false, chip.title);
  }
  // Every chip applies, through the production `setParams` the manager calls.
  for (const chip of controls.chips) {
    _comptagesSetParamsForTest(chip.params);
    assert.equal(_comptagesSlotForTest().token, chip.params.slot, chip.id);
    const lit = _comptagesRowControlsForTest().chips.filter((row) => row.active);
    assert.equal(lit.length, 1);
    assert.equal(lit[0].id, chip.id);
  }
  _clearComptagesSelectionForTest();
});

test('an unknown slot moves nothing, rather than moving the reader somewhere else', () => {
  _setComptagesStateForTest({ payload: PACK, overlayHost: recordingHost() });
  _comptagesSetParamsForTest({ slot: 'w18' });
  assert.equal(_comptagesSlotForTest().token, 'w18');
  for (const bad of [{ slot: 'w99' }, { slot: 25 }, { slot: null }, {}, undefined]) {
    _comptagesSetParamsForTest(bad);
    assert.equal(_comptagesSlotForTest().token, 'w18', `${JSON.stringify(bad)} moved the cursor`);
  }
  assert.deepEqual(comptagesParisLayer.getParams(), { slot: 'w18', day: 'weekday', hour: 18 });
  _clearComptagesSelectionForTest();
});

test('the cursor moves the WIDTH and leaves the hue alone', () => {
  // The whole point of the split. Between 04 h and 18 h on a weekday, 1 562 of
  // the real pack's arcs climb at least one band and not one descends — and no
  // arc changes colour, because a rhythm is a property of the week.
  _setComptagesStateForTest({ payload: PACK, overlayHost: recordingHost() });
  const snapshot = () => {
    const out = new Map();
    for (const [id, record] of _comptagesRecordsForTest()) {
      out.set(id, { bin: record.style.bin, color: record.style.color, gap: record.style.gap });
    }
    return out;
  };
  _comptagesSetParamsForTest({ slot: 'w04' });
  const night = snapshot();
  _comptagesSetParamsForTest({ slot: 'w18' });
  const evening = snapshot();

  let widened = 0;
  for (const [id, before] of night) {
    const after = evening.get(id);
    if (before.gap || after.gap) continue;
    if (before.bin === null || after.bin === null) continue;
    if (after.bin !== before.bin) widened += 1;
    // The hue is the invariant. Only the gap dash may replace it.
    if (before.color !== COMPTAGES_HOUR_GAP_COLOR && after.color !== COMPTAGES_HOUR_GAP_COLOR) {
      assert.equal(after.color, before.color, `${id} changed colour with the hour`);
    }
  }
  assert.ok(widened > 0, 'the fixture must contain an arc that changes band with the hour');
  _clearComptagesSelectionForTest();
});

test('an arc that publishes nothing at the selected hour is dashed, not thin', () => {
  // Arc 525 (Bd Sébastopol) counts 426 véh/h on its weekday mean and publishes
  // nothing at 18 h. The bottom band means "measured, and under 100 véh/h" —
  // handing it to this arc would invent a quiet evening on a real street.
  _setComptagesStateForTest({ payload: PACK, overlayHost: recordingHost(), slot: 'w18' });
  const record = _comptagesRecordsForTest().get('comptages-fr:525');
  assert.ok(record);
  assert.equal(record.style.gap, true);
  assert.equal(record.style.dashed, true);
  assert.equal(record.style.bin, null);
  assert.equal(record.style.color, COMPTAGES_HOUR_GAP_COLOR);
  assert.notEqual(record.style.color, COMPTAGES_SILENT_COLOR);

  // The legend names it, apart from the 168-hour silence.
  const legend = _comptagesRowControlsForTest().legend;
  const gapRow = legend.find((row) => row.label === COMPTAGES_HOUR_GAP_LABEL);
  assert.ok(gapRow, 'the hour gap is a legend row of its own');
  assert.ok(gapRow.count > 0);
  const silentRow = legend.find((row) => row.color === COMPTAGES_SILENT_COLOR);
  assert.ok(silentRow);
  assert.notEqual(gapRow.color, silentRow.color);
  assert.notEqual(gapRow.label, silentRow.label);

  // And the DETECT callout refuses it: a callout reading "0 véh/h" on an hour
  // nobody published is the same lie the dash exists to prevent.
  const called = _comptagesDetectablesForTest({ maxCount: 10_000 });
  assert.equal(called.some((entry) => entry.sourceId === 'comptages-fr:525'), false);
  for (const entry of called) assert.match(entry.id, /véh\/h/);
  _clearComptagesSelectionForTest();
});

test('the card and the row label both name the slot they drew', () => {
  // Rule E1: a screenshot has to say which map it is. The map now has 49 of
  // them for one week, so the week alone is no longer enough.
  _setComptagesStateForTest({ payload: PACK, overlayHost: recordingHost(), slot: 'e04' });
  const label = norm(buildComptagesLoadingLabel());
  assert.match(label, /semaine/);
  assert.match(label, /week-end type · 04 h/);
  assert.equal(/live|temps réel/i.test(label), false);

  const counted = arcOf('5298');
  const card = norm(buildComptagesSelectionLabel(
    { id: 'comptages-fr:5298', arc: counted, style: comptagesArcStyle(counted, comptagesResolveSlot('e04')) },
    PACK,
    comptagesResolveSlot('e04'),
  ));
  assert.match(card, /week-end type · 04 h/);
  assert.match(card, /véh\/h/);
  // The rhythm is named AND justified — a hue the reader has to take on trust
  // is not a legend.
  assert.match(card, /Rythme : /);
  assert.equal(/live|temps réel/i.test(card), false);

  // A gap arc quotes no flow for that slot and says why.
  const gap = arcOf('525');
  const gapCard = norm(buildComptagesSelectionLabel(
    { id: 'comptages-fr:525', arc: gap, style: comptagesArcStyle(gap, comptagesResolveSlot('w18')) },
    PACK,
    comptagesResolveSlot('w18'),
  ));
  assert.match(gapCard, /Aucun comptage publié — jour ouvré type · 18 h/);
  _clearComptagesSelectionForTest();
});

test('getStats publishes the instant represented, and the card follows a chip', () => {
  const host = recordingHost();
  const viewer = fakeViewer();
  _setComptagesStateForTest({ payload: PACK, overlayHost: host, viewer });
  assert.equal(_comptagesStatsForTest().slot, 'mean');
  assert.equal(norm(_comptagesStatsForTest().slotLabel), 'moyenne de l’heure ouvrée');

  _selectComptagesForTest('comptages-fr:5298');
  const before = host.calls.set.length;
  _comptagesSetParamsForTest({ slot: 'w04' });
  // A chip pressed with a card open has to move the card too, or the panel and
  // the map would be reading two different hours of the same street.
  assert.ok(host.calls.set.length > before, 'the open card was not repainted');
  const entry = host.calls.set.at(-1).entries[0];
  assert.ok(entry.details.some((line) => norm(line).includes('jour ouvré type · 04 h')));
  assert.equal(_comptagesStatsForTest().slot, 'w04');
  _clearComptagesSelectionForTest();
});

test('the clock chip reads the archived week, and rolls over without a refetch', () => {
  // `updateInterval` is six hours because the DATA changes weekly; the clock is
  // re-resolved on the surfaces the panel already polls instead.
  let now = Date.parse('2026-09-03T14:30:00Z'); // Thursday 16:30 in Paris
  _setComptagesStateForTest({
    payload: PACK, overlayHost: recordingHost(), slot: 'clock', now: () => now,
  });
  assert.deepEqual(_comptagesSlotForTest(), {
    token: 'clock', kind: 'clock', day: 'weekday', hour: 16,
  });
  assert.equal(norm(_comptagesStatsForTest().slotLabel), 'jour ouvré type · 16 h');

  now = Date.parse('2026-09-05T23:30:00Z'); // Sunday 01:30 in Paris
  assert.equal(norm(_comptagesStatsForTest().slotLabel), 'week-end type · 01 h');
  assert.equal(_comptagesSlotForTest().day, 'weekend');
  // The chip stays lit on `clock` rather than jumping to a pinned token.
  const chips = _comptagesRowControlsForTest().chips;
  assert.equal(chips.find((chip) => chip.active).params.slot, 'clock');
  assert.match(chips.find((chip) => chip.active).title, /horloge de Paris/);
  _clearComptagesSelectionForTest();
});

test('the legend never re-cuts its thresholds from what is on screen', () => {
  // Rule C1. The counts move with the slot — that is the whole point — but the
  // band a count falls in must not, or two screenshots of the same street at
  // two hours would be uncomparable.
  _setComptagesStateForTest({ payload: PACK, overlayHost: recordingHost() });
  const labelsAt = (slot) => {
    _comptagesSetParamsForTest({ slot });
    return _comptagesRowControlsForTest().legend
      .filter((row) => /véh\/h/.test(row.label))
      .map((row) => norm(row.label));
  };
  const night = labelsAt('w04');
  const evening = labelsAt('w18');
  const known = new Set([
    '< 100 véh/h', '100–250 véh/h', '250–500 véh/h', '500–1 000 véh/h', '≥ 1 000 véh/h',
  ]);
  for (const label of [...night, ...evening]) assert.ok(known.has(label), label);
  // And the counts DO move, or the cursor would be decorative.
  const countsAt = (slot) => {
    _comptagesSetParamsForTest({ slot });
    return _comptagesRowControlsForTest().legend
      .filter((row) => /véh\/h/.test(row.label))
      .reduce((acc, row) => ({ ...acc, [norm(row.label)]: row.count }), {});
  };
  assert.notDeepEqual(countsAt('w04'), countsAt('w18'));
  _clearComptagesSelectionForTest();
});

test('the batches are built once, per width band, and only where an arc can land', () => {
  // The cost argument of the hour cursor, checked rather than asserted in prose.
  // `GroundPolylineGeometry`, `GeometryInstance`, `Material` and both appearances
  // are pure JS, so the batching decisions are testable without WebGL.
  const viewer = fakeViewer();
  _setComptagesStateForTest({ payload: PACK, overlayHost: recordingHost(), viewer });
  const built = _drawComptagesForTest(PACK);

  // EIGHT primitives and the count is forced, not chosen: five width bands
  // (a width is baked into the geometry), one occupancy stroke, and two dashed
  // materials (a material is per-primitive).
  assert.equal(built.primitives.length, 8);
  assert.equal(built.bands.length, COMPTAGES_FLOW_WIDTHS.length);
  assert.equal(built.primitives.filter((p) => p.appearance.material).length, 2,
    'exactly two dashed materials: the 168-hour silence and the hour gap');

  // Each band's geometry is baked at that band's width, once.
  built.bands.forEach((primitive, band) => {
    if (!primitive) return;
    for (const instance of primitive.geometryInstances) {
      assert.equal(instance.geometry.width, COMPTAGES_FLOW_WIDTHS[band]);
    }
  });

  // An arc gets an instance in every band it can reach across the 49 slots and
  // in no other — a missing one would make the street VANISH at some hour, with
  // nothing on screen to say why.
  for (const [id, record] of built.records) {
    const present = built.bands
      .map((primitive, band) => (primitive?.geometryInstances.some((i) => i.id === id) ? band : null))
      .filter((band) => band !== null);
    assert.deepEqual(present, record.positions ? record.bands : [], id);
    const inGap = Boolean(built.gap?.geometryInstances.some((i) => i.id === id));
    assert.equal(inGap, Boolean(record.positions && record.hasGap), `${id} gap instance`);
  }

  // Exactly one instance of each drawn counted arc starts visible, and it is
  // the one the current slot puts it in.
  for (const record of built.records.values()) {
    if (!record.positions || record.arc.s !== 'counted') {
      assert.equal(record.painted, null);
      continue;
    }
    assert.equal(record.painted, record.style.gap ? 'gap' : record.style.bin);
  }
  _clearComptagesSelectionForTest();
});
