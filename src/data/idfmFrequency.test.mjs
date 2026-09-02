// What the DRAWN layer is allowed to claim, once `idfmFrequencyFeed.js` and
// `idfmFrequencyDepartements.js` have already been proved.
//
// One property runs through the whole file and it is the one the layer exists
// for: **a stop that runs nothing at this hour must never be presentable as a
// stop that runs a little.** Silence is a measured, published zero here, so it
// gets its own colour, its own size, its own legend row, its own card sentence,
// and no place in the DETECT callouts. The moment any of those five acquires a
// fallback on the bottom of the ramp, this layer starts inventing a bus.
//
// The second property is the one the overlap forces: this layer draws the SAME
// coordinates as `idfm-network`. So the record ids must not collide with that
// layer's, the discs must stay smaller than its pictograms, and the ramp must
// hold none of its five mode hues — otherwise a stacked stop is unreadable and
// a click is ambiguous.
//
// The third is that the map is always TODAY in Paris. Every surface that names
// an hour also names the day, so a Sunday screenshot cannot be read as a
// weekday one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import idfmFrequencyLayer, {
  IDFM_FREQ_LAYER_ID,
  IDFM_FREQ_MOMENTS,
  IDFM_FREQ_OVERLAY_SOURCE_ID,
  IDFM_FREQ_RAMP,
  IDFM_FREQ_SILENT_COLOR,
  IDFM_FREQ_SILENT_SIZE,
  IDFM_FREQ_SIZES,
  STOPS_ENTER_SPAN_DEG,
  STOPS_EXIT_SPAN_DEG,
  buildFrequencyDepartementLabel,
  buildFrequencyLoadingLabel,
  buildFrequencySelectionLabel,
  createFrequencySelectedOverlayEntry,
  dayGlyphs,
  departementFill,
  formatRate,
  frequencyStyle,
  idfmFreqRegimeFor,
  idfmFreqViewBox,
  idfmFreqViewSpanDeg,
  levelColor,
  levelLabel,
  missingWindows,
  parisOperatingSlot,
  resolveSlot,
  waitPhrase,
  weekLine,
  _clearIdfmFrequencySelectionForTest,
  _idfmFrequencyDetectablesForTest,
  _idfmFrequencyRecordForTest,
  _idfmFrequencyRowControlsForTest,
  _idfmFrequencySelectedIdForTest,
  _idfmFrequencySetParamsForTest,
  _idfmFrequencySlotForTest,
  _idfmFrequencyStatsForTest,
  _selectIdfmFrequencyDepartementForTest,
  _selectIdfmFrequencyForTest,
  _setIdfmFrequencyStateForTest,
} from './idfmFrequency.js';
import { projectFrequencyStops, IDFM_FREQ_SILENT_LABEL } from './idfmFrequencyFeed.js';
import { foldFrequencyRegion } from './idfmFrequencyDepartements.js';
import { IDFM_MODE_COLORS } from './idfmNetwork.js';
import { COMPTAGES_FLOW_COLORS } from './comptagesRhythm.js';

// Cesium reads the aliased line-width range off a live WebGL context, and there
// is none under `node --test`, so `ContextLimits._maximumAliasedLineWidth` sits
// at 0 and every `RenderState.fromCache` throws "renderState.lineWidth is out
// of range". Priming it is a property of the harness, not of the layer.
const { default: ContextLimits } = await import('@cesium/engine/Source/Renderer/ContextLimits.js');
ContextLimits._maximumAliasedLineWidth = 16;
const Cesium = await import('cesium');

const read = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const norm = (value) => String(value).replace(/[\s ]+/g, ' ');

const BOX = Object.freeze({ south: 48.8270, west: 2.3160, north: 48.8330, east: 2.3280 });
const PACK = projectFrequencyStops({
  identity: read('idfm-frequence-identite-sample.json'),
  profiles: ['04-09', '10-15', '16-21', '22-27']
    .map((window) => read(`idfm-frequence-profil-${window}-sample.json`)),
  box: BOX,
});
const REGION = foldFrequencyRegion({
  bands: read('idfm-frequence-region-sample.json'),
  stops: [
    { code: null, envelope: read('idfm-frequence-sans-coordonnees-sample.json') },
    { code: '60', envelope: read('idfm-frequence-arrets-60-sample.json') },
  ],
});

/** A stand-in point collection, so records carry the style the renderer got. */
function fakePoints() {
  return {
    added: [],
    add(options) { this.added.push(options); return { ...options }; },
    removeAll() { this.added.length = 0; },
  };
}

/** Enough of a viewer for the selection and camera paths to run for real. */
function fakeViewer(rectangleDeg = null) {
  return {
    scene: {
      primitives: { add() {}, remove() {} },
      requestRender() {},
      globe: { show: true },
    },
    camera: {
      computeViewRectangle: () => (rectangleDeg
        ? Cesium.Rectangle.fromDegrees(
          rectangleDeg.west, rectangleDeg.south, rectangleDeg.east, rectangleDeg.north,
        )
        : undefined),
    },
    dataSources: { add() {}, remove() {} },
  };
}

/** Captures what the layer publishes to the shared overlay host. */
function fakeOverlay() {
  const host = {
    entries: new Map(),
    visible: new Map(),
    setEntries(sourceId, list) { host.entries.set(sourceId, list); },
    setVisible(sourceId, value) { host.visible.set(sourceId, value); },
    clearSource(sourceId) { host.entries.delete(sourceId); },
  };
  return host;
}

/** 2026-09-08 is a Tuesday; 09:30 Paris is band 9 of `mardi`. */
const TUESDAY_0930 = Date.parse('2026-09-08T07:30:00Z');
/** Paris is UTC+2 in September, so this instant is 01:30 on Thursday there —
  * band 25 of the WEDNESDAY operating day. */
const THURSDAY_0130 = Date.parse('2026-09-09T23:30:00Z');

function seedStops({ now = TUESDAY_0930, pinnedBand = null, overlay = fakeOverlay(), points = fakePoints() } = {}) {
  _setIdfmFrequencyStateForTest({
    viewer: fakeViewer(BOX), overlayHost: overlay, now, points, pack: PACK, region: REGION, pinnedBand,
  });
  return { overlay, points };
}

test('the layer object satisfies the manager contract', () => {
  assert.equal(idfmFrequencyLayer.id, IDFM_FREQ_LAYER_ID);
  assert.equal(IDFM_FREQ_LAYER_ID, 'idfm-frequency');
  assert.ok(/^[a-z0-9-]+$/.test(idfmFrequencyLayer.id));
  assert.equal(idfmFrequencyLayer.name, 'Fréquence des transports (IDFM)');
  assert.equal(idfmFrequencyLayer.icon, '⏱');
  // Not one of `idfm-network`'s glyphs, and not the transit pack's: the subject
  // here is the hour, not the mode.
  assert.notEqual(idfmFrequencyLayer.icon, '🚇');
  assert.equal(typeof idfmFrequencyLayer.source, 'string');
  for (const hook of ['init', 'enable', 'disable', 'update', 'getStats', 'getRowControls',
    'getDetectableObjects', 'setParams', 'getParams', 'destroy']) {
    assert.equal(typeof idfmFrequencyLayer[hook], 'function', hook);
  }
  // A clock tick, not a data poll — see the module header.
  assert.equal(idfmFrequencyLayer.updateInterval, 60_000);
  _clearIdfmFrequencySelectionForTest();
});

test('the palette cannot be confused with the layer drawn on the same coordinates', () => {
  const mine = new Set([...IDFM_FREQ_RAMP, IDFM_FREQ_SILENT_COLOR].map((css) => css.toLowerCase()));
  // `idfm-network` colours the SAME stops by mode. None of its five hues.
  for (const css of Object.values(IDFM_MODE_COLORS)) {
    assert.equal(mine.has(String(css).toLowerCase()), false, `mode hue ${css}`);
  }
  // `comptages-fr` is the other magnitude ramp over central Paris.
  for (const css of COMPTAGES_FLOW_COLORS) {
    assert.equal(mine.has(String(css).toLowerCase()), false, `comptages ${css}`);
  }
  // `fraicheur-fr` reserved this grey repo-wide for "not measured". A published
  // zero is measured, so the silent state must not borrow it.
  assert.notEqual(IDFM_FREQ_SILENT_COLOR.toLowerCase(), '#8a93a6');
  // Six ramp steps, one per ladder rung.
  assert.equal(IDFM_FREQ_RAMP.length, 6);
  assert.equal(IDFM_FREQ_SIZES.length, 6);
});

test('a rate disc stays smaller than the pictogram it is stacked under', () => {
  // `idfm-network`'s MODE_SIZE runs 14 px (bus) to 24 px (métro and rail). Every
  // step here is strictly under the smallest of them, so the rate disc reads as
  // a core inside the mode glyph rather than covering it.
  for (const size of IDFM_FREQ_SIZES) assert.ok(size < 14, `${size} px`);
  assert.ok(IDFM_FREQ_SILENT_SIZE < IDFM_FREQ_SIZES[0]);
  // Monotonic: size and colour carry the same number, redundantly, because an
  // 8 px dot's hue is not reliable on a photorealistic globe.
  for (let i = 1; i < IDFM_FREQ_SIZES.length; i += 1) {
    assert.ok(IDFM_FREQ_SIZES[i] > IDFM_FREQ_SIZES[i - 1]);
  }
});

test('a stop that runs nothing in this band is drawn, and drawn as itself', () => {
  const silent = frequencyStyle(0);
  assert.equal(silent.level, -1);
  assert.equal(silent.css, IDFM_FREQ_SILENT_COLOR);
  assert.equal(silent.sizePx, IDFM_FREQ_SILENT_SIZE);
  // Not the bottom of the ramp — that rung means "under two an hour, which is
  // still a bus".
  assert.notEqual(silent.css, IDFM_FREQ_RAMP[0]);
  assert.equal(frequencyStyle(0.5).css, IDFM_FREQ_RAMP[0]);
  assert.equal(frequencyStyle(40).css, IDFM_FREQ_RAMP[5]);
  assert.equal(frequencyStyle(40).sizePx, IDFM_FREQ_SIZES[5]);
  // Every coercible non-number is silence, never rung 0.
  for (const value of [null, undefined, '', NaN, false]) {
    assert.equal(frequencyStyle(value).level, -1, String(value));
  }
  assert.equal(levelLabel(-1), IDFM_FREQ_SILENT_LABEL);
  assert.equal(levelColor(-1), IDFM_FREQ_SILENT_COLOR);
  assert.equal(levelColor(null), IDFM_FREQ_SILENT_COLOR);
  assert.equal(levelColor(5), IDFM_FREQ_RAMP[5]);
});

test('a département with no divisor gets no fill at all', () => {
  // Not the bottom of the ladder: "we counted and almost nothing runs" is a
  // different sentence from "we could not count".
  assert.equal(departementFill(null), null);
  assert.equal(departementFill(undefined), null);
  assert.equal(departementFill(''), null);
  assert.equal(departementFill(NaN), null);
  assert.equal(departementFill(0).css, IDFM_FREQ_SILENT_COLOR);
  // Paris at 08:00 is 13.22 departures per hour per stop — rung 3 (8–16/h),
  // the same rung a 13/h STOP would get. One ladder, two regimes.
  assert.equal(departementFill(13.22).css, IDFM_FREQ_RAMP[3]);
  // Seine-et-Marne at the same hour is 3.00 — rung 1 (2–4/h).
  assert.equal(departementFill(3.0).css, IDFM_FREQ_RAMP[1]);
  // Alpha climbs with the rung, so a busy département is lighter AND denser.
  assert.ok(departementFill(40).alpha > departementFill(1).alpha);
});

test('the clock is Paris, and 01:30 belongs to the previous operating day', () => {
  const morning = parisOperatingSlot(TUESDAY_0930);
  assert.deepEqual({ day: morning.day, band: morning.band }, { day: 'mardi', band: 9 });
  const night = parisOperatingSlot(THURSDAY_0130);
  assert.deepEqual({ day: night.day, band: night.band }, { day: 'mercredi', band: 25 });
  // A pinned band keeps today's day: the day axis is not a control.
  assert.deepEqual(resolveSlot(22, THURSDAY_0130), { day: 'mercredi', band: 22, pinned: true });
  assert.deepEqual(resolveSlot(null, TUESDAY_0930), { day: 'mardi', band: 9, pinned: false });
  // Anything that is not a number hands the clock back rather than pinning 04:00.
  for (const value of ['22', null, undefined, NaN]) {
    assert.equal(resolveSlot(value, TUESDAY_0930).pinned, false, String(value));
  }
});

test('the regime boundary has hysteresis, so a wheel notch cannot flip the product', () => {
  assert.ok(STOPS_ENTER_SPAN_DEG < STOPS_EXIT_SPAN_DEG);
  // 0.045° is the last span whose padded, snapped box fits under the 1 200-stop
  // ceiling at Châtelet — 1 193 stops, measured. One notch wider the identity
  // page saturates at 1 201 rows and the proxy refuses the box.
  assert.equal(STOPS_ENTER_SPAN_DEG, 0.035);
  assert.equal(STOPS_EXIT_SPAN_DEG, 0.045);
  assert.equal(idfmFreqRegimeFor(0.03, 'region'), 'arrets');
  assert.equal(idfmFreqRegimeFor(0.04, 'region'), 'region');
  assert.equal(idfmFreqRegimeFor(0.04, 'arrets'), 'arrets');
  assert.equal(idfmFreqRegimeFor(0.05, 'arrets'), 'region');
  // A camera past the limb gives no rectangle: the région is the honest answer,
  // never a viewport request for an infinite box.
  assert.equal(idfmFreqViewSpanDeg(fakeViewer(null)), Infinity);
  assert.equal(idfmFreqRegimeFor(Infinity, 'arrets'), 'region');
  assert.equal(idfmFreqViewBox(fakeViewer(null)), null);
});

test('the requested box is padded and snapped outward onto the cache grid', () => {
  const box = idfmFreqViewBox(fakeViewer(BOX));
  // Outward on a 0.005° grid, so a pan of a few metres reuses one cache key.
  for (const value of [box.south, box.west, box.north, box.east]) {
    assert.ok(Math.abs(value / 0.005 - Math.round(value / 0.005)) < 1e-6, String(value));
  }
  assert.ok(box.south <= BOX.south && box.north >= BOX.north);
  assert.ok(box.west <= BOX.west && box.east >= BOX.east);
});

test('the drawn records carry the style the renderer was handed', () => {
  const { points } = seedStops();
  assert.equal(points.added.length, 6);
  const record = _idfmFrequencyRecordForTest('idfm-freq:36547');
  assert.ok(record);
  // 29 courses at 09:30 on a Tuesday puts it on rung 4 (16–32/h).
  assert.equal(record.style.level, 4);
  assert.equal(record.point.pixelSize, IDFM_FREQ_SIZES[4]);
  assert.ok(record.point.color.toCssHexString().toLowerCase().startsWith(IDFM_FREQ_RAMP[4]));
  // The rim is opaque where the fill is not, so the composition reads whichever
  // of the two stacked layers paints last.
  assert.ok(record.point.outlineColor.alpha > record.point.color.alpha);
  assert.equal(record.point.disableDepthTestDistance, Number.POSITIVE_INFINITY);
  _clearIdfmFrequencySelectionForTest();
});

test('record ids are namespaced, because the neighbour layer uses the bare arrid', () => {
  seedStops();
  // `idfmFeed.js` builds its entity ids as `String(row.arrid)` — "36547". An
  // unprefixed id here would make a click ambiguous to `pickRegistry`.
  assert.ok(_idfmFrequencyRecordForTest('idfm-freq:36547'));
  assert.equal(_idfmFrequencyRecordForTest('36547'), null);
  _clearIdfmFrequencySelectionForTest();
});

test('scrubbing the hour repaints what the browser already holds', () => {
  const { points } = seedStops();
  const before = _idfmFrequencyRecordForTest('idfm-freq:36547').style.level;
  const added = points.added.length;
  _idfmFrequencySetParamsForTest({ band: 25 });
  assert.deepEqual(_idfmFrequencySlotForTest(), { day: 'mardi', band: 25, pinned: 25 });
  // 6 courses at 01:00 — rung 2 — against 29 at 09:30. No new primitive was
  // created and nothing was fetched: the 7 × 24 profile is already on the wire.
  assert.equal(_idfmFrequencyRecordForTest('idfm-freq:36547').style.level, 2);
  assert.notEqual(before, 2);
  assert.equal(points.added.length, added);
  // The other métro platform has no 01:00 service at all.
  assert.equal(_idfmFrequencyRecordForTest('idfm-freq:463118').style.level, -1);
  _clearIdfmFrequencySelectionForTest();
});

test('an unknown band is ignored rather than clamped onto a real hour', () => {
  seedStops({ pinnedBand: 22 });
  for (const band of [3, 28, 'huit', {}, 12.5, true, []]) {
    _idfmFrequencySetParamsForTest({ band });
    assert.equal(_idfmFrequencySlotForTest().band, 22, JSON.stringify(band));
  }
  // `'now'` and an explicit `null` are the two ways to hand the clock back.
  _idfmFrequencySetParamsForTest({ band: 'now' });
  assert.equal(_idfmFrequencySlotForTest().pinned, null);
  assert.equal(_idfmFrequencySlotForTest().band, 9);
  _clearIdfmFrequencySelectionForTest();
});

test('the selected stop card prints only published numbers', () => {
  const { overlay } = seedStops({ pinnedBand: 8 });
  _selectIdfmFrequencyForTest('idfm-freq:23613');
  assert.equal(_idfmFrequencySelectedIdForTest(), 'idfm-freq:23613');
  const [entry] = overlay.entries.get(IDFM_FREQ_OVERLAY_SOURCE_ID);
  assert.equal(entry.title, 'Alésia - Général Leclerc');
  const body = norm(entry.details.join('\n'));
  assert.ok(body.includes('Bus · Paris (75)'));
  assert.ok(body.includes('Mardi 08:00–08:59 — 10 départs/h'));
  assert.ok(body.includes('3 min d’attente moyenne'));
  // The whole day is on the card, which is what makes one hour on the map
  // legitimate rather than a cherry-pick.
  assert.ok(body.includes('04 h '));
  assert.ok(body.includes(' 03 h'));
  assert.ok(/premier 06:00/.test(body));
  assert.ok(/dernier 01:00/.test(body));
  // The other name is kept, at the same point, rather than deleted.
  assert.ok(body.includes('Aussi publié « Les Plantes » au même point'));
  // 21 of 24 bands published is not truncation, and the card says which it is.
  assert.ok(body.includes('21 tranches publiées sur 24'));
  // The week for the SELECTED band — the comparison the chips cannot make.
  assert.ok(body.includes('Même tranche : Lun'));
  // It never reads like a departure board.
  assert.ok(body.includes('semaine type hors vacances 2025'));
  assert.ok(body.includes('Licence Ouverte v2.0'));
  _clearIdfmFrequencySelectionForTest();
});

test('a stop with no service in the band says so, and does not say zero', () => {
  seedStops({ pinnedBand: 27 });
  const record = _idfmFrequencyRecordForTest('idfm-freq:23997');
  const copy = norm(buildFrequencySelectionLabel(record, { day: 'mardi', band: 27 }));
  assert.ok(copy.includes(IDFM_FREQ_SILENT_LABEL));
  assert.equal(copy.includes('0 départs/h'), false);
  assert.equal(copy.includes('d’attente moyenne'), false);
  // 19 bands out of 24, and the card explains the flat tail of the sparkline.
  assert.ok(copy.includes('19 tranches publiées sur 24'));
  _clearIdfmFrequencySelectionForTest();
});

test('the card is built from the same record the DETECT callout is', () => {
  const { overlay } = seedStops();
  _selectIdfmFrequencyForTest('idfm-freq:22154');
  const [entry] = overlay.entries.get(IDFM_FREQ_OVERLAY_SOURCE_ID);
  assert.equal(entry.protected, true);
  assert.equal(entry.selected, true);
  assert.equal(entry.id, 'idfm-freq:22154');
  const detect = _idfmFrequencyDetectablesForTest();
  const mine = detect.find((row) => row.sourceId === 'idfm-freq:22154');
  assert.ok(mine);
  // The selected stop already carries a card, so DETECT does not draw a second
  // label over it.
  assert.equal(mine.skipLabel, true);
  assert.equal(mine.type, 'Transit frequency');
  assert.equal(mine.id, '31/h');
  _clearIdfmFrequencySelectionForTest();
});

test('DETECT is offered the busiest stops and never a silent one', () => {
  seedStops({ pinnedBand: 27 });
  const detect = _idfmFrequencyDetectablesForTest();
  // Only 36547 runs anything at 03:00 in this box; a "0/h" callout is the most
  // expensive way this app has of saying nothing.
  assert.deepEqual(detect.map((row) => row.sourceId), ['idfm-freq:36547']);
  assert.equal(detect[0].id, '6/h');

  seedStops({ pinnedBand: 8 });
  const capped = _idfmFrequencyDetectablesForTest({ maxCount: 2 });
  assert.equal(capped.length, 2);
  // Busiest first, so a strided sample keeps the stops a reader would keep.
  assert.equal(capped[0].sourceId, 'idfm-freq:463118');
  _clearIdfmFrequencySelectionForTest();
});

test('DETECT offers nothing from the wide regime', () => {
  // A département polygon has no point to put a callout on that is not a
  // centroid, and a callout reading "13/h" over the middle of a département
  // would be a claim about a place nobody can stand.
  _setIdfmFrequencyStateForTest({ viewer: fakeViewer(), region: REGION, now: TUESDAY_0930 });
  assert.deepEqual(_idfmFrequencyDetectablesForTest(), []);
  _clearIdfmFrequencySelectionForTest();
});

test('the row controls are seven moments, exactly one of them lit', () => {
  seedStops();
  const controls = _idfmFrequencyRowControlsForTest();
  assert.equal(controls.chips.length, 7);
  assert.equal(controls.chips.length, IDFM_FREQ_MOMENTS.length);
  assert.equal(controls.chips.filter((chip) => chip.active).length, 1);
  assert.equal(controls.chips[0].id, 'now');
  assert.equal(controls.chips[0].active, true);
  // Every chip carries the params the manager dispatches on click.
  for (const chip of controls.chips) {
    assert.ok(chip.params && 'band' in chip.params, chip.id);
    assert.ok(chip.title.includes('Mardi'));
  }
  _idfmFrequencySetParamsForTest({ band: 12 });
  const pinned = _idfmFrequencyRowControlsForTest();
  assert.equal(pinned.chips.find((chip) => chip.id === 'b12').active, true);
  assert.equal(pinned.chips.find((chip) => chip.id === 'now').active, false);
  _clearIdfmFrequencySelectionForTest();
});

test('the legend counts what is drawn, and always carries the silence', () => {
  seedStops({ pinnedBand: 8 });
  const { legend } = _idfmFrequencyRowControlsForTest();
  const drawn = legend.filter((entry) => entry.label !== 'sans coordonnée publiée');
  const counted = drawn.reduce((total, entry) => total + entry.count, 0);
  assert.equal(counted, 6);
  const silent = legend.find((entry) => entry.label === IDFM_FREQ_SILENT_LABEL);
  assert.ok(silent, 'the silent row is present even at zero');
  assert.equal(silent.count, 0);
  assert.equal(silent.color, IDFM_FREQ_SILENT_COLOR);
  assert.ok(silent.blurb.includes('mesurée'));

  // At 03:00 the same six stops collapse onto the silence.
  _idfmFrequencySetParamsForTest({ band: 27 });
  const night = _idfmFrequencyRowControlsForTest().legend;
  assert.equal(night.find((entry) => entry.label === IDFM_FREQ_SILENT_LABEL).count, 5);

  // The stops nobody can draw travel with the legend at every zoom.
  const unplaced = night.find((entry) => entry.label === 'sans coordonnée publiée');
  assert.ok(unplaced);
  assert.equal(unplaced.count, REGION.totals.unplaced);
  _clearIdfmFrequencySelectionForTest();
});

test('the département card leads with the per-stop mean and names what is not painted', () => {
  const overlay = fakeOverlay();
  _setIdfmFrequencyStateForTest({
    viewer: fakeViewer(),
    overlayHost: overlay,
    region: REGION,
    now: TUESDAY_0930,
    pinnedBand: 8,
    depMeta: [['60', { code: '60', name: 'Oise', anchor: [2.42, 49.42] }]],
  });
  _selectIdfmFrequencyDepartementForTest('60');
  const [entry] = overlay.entries.get(IDFM_FREQ_OVERLAY_SOURCE_ID);
  assert.equal(entry.title, 'Oise (60)');
  const body = norm(entry.details.join('\n'));
  assert.ok(body.includes('0,7 départs/h par arrêt'));
  assert.ok(body.includes('87 arrêts'));
  // The total follows the mean and never leads it: the total is a fact about
  // how big the département is.
  assert.ok(body.indexOf('départs/h par arrêt') < body.indexOf('courses dans la tranche'));
  assert.ok(body.includes('compté, jamais peint'));
  assert.ok(body.includes('Moyenne par arrêt'));
  // A département record exists only for as long as it is selected: it has no
  // primitive and nothing else reads it, so clearing must take it with it
  // rather than accumulating one entry per polygon ever clicked.
  assert.ok(_idfmFrequencyRecordForTest('idfm-freq:dep:60'));
  _selectIdfmFrequencyDepartementForTest('60');
  assert.equal(_idfmFrequencySelectedIdForTest(), 'idfm-freq:dep:60');
  _clearIdfmFrequencySelectionForTest();
  assert.equal(_idfmFrequencyRecordForTest('idfm-freq:dep:60'), null);
});

test('a département with no divisor says so instead of printing a rate', () => {
  const seine = { code: '77', stops: null, placed: null, inside: null, paint: false, profile: REGION.departements.find((row) => row.code === '77').profile, bands: 24, week: 1500862 };
  const copy = norm(buildFrequencyDepartementLabel(seine, { day: 'mardi', band: 8, name: 'Seine-et-Marne' }));
  assert.ok(copy.includes('aucun décompte d’arrêts, donc aucune moyenne'));
  assert.equal(copy.includes('départs/h par arrêt'), false);
  assert.equal(buildFrequencyDepartementLabel(null), '');
  assert.equal(buildFrequencySelectionLabel(null), '');
  assert.equal(createFrequencySelectedOverlayEntry(null), null);
});

test('every surface that names an hour also names the day', () => {
  seedStops({ pinnedBand: 22 });
  const label = norm(buildFrequencyLoadingLabel());
  assert.ok(label.startsWith('Mardi 22:00–22:59'));
  assert.ok(label.includes('6 arrêts'));
  const stats = _idfmFrequencyStatsForTest();
  assert.equal(stats.day, 'mardi');
  assert.equal(stats.band, 22);
  assert.equal(stats.pinned, true);
  assert.equal(stats.count, 6);
  assert.equal(stats.regime, 'arrets');
  assert.equal(stats.status, 'ok');
  assert.equal(stats.stopsWithoutCoordinate, REGION.totals.unplaced);
  assert.ok(norm(stats.loadingLabel).includes('Mardi'));

  // Following the clock says so, so a reader knows why the map moved.
  _idfmFrequencySetParamsForTest({ band: 'now' });
  assert.ok(norm(buildFrequencyLoadingLabel()).includes('(heure de Paris)'));
  _clearIdfmFrequencySelectionForTest();
});

test('the wide regime reports what it painted and what it could not', () => {
  _setIdfmFrequencyStateForTest({ viewer: fakeViewer(), region: REGION, now: TUESDAY_0930 });
  const label = norm(buildFrequencyLoadingLabel());
  // The committed census covers no Île-de-France département, so nothing is
  // painted, and the label says that rather than showing an empty map.
  assert.ok(label.includes('offre régionale indisponible'));
  assert.equal(_idfmFrequencyStatsForTest().count, 0);
  _clearIdfmFrequencySelectionForTest();
});

test('a box the proxy refused is guidance with a number, not an empty map', () => {
  // The proxy answers a saturated identity page with the count it can honestly
  // claim and NO profiles, so this state has to be legible from the payload
  // alone: `zoom-in` is a GUIDANCE status — a green ON chip — and the sentence
  // says "au moins", because a saturated page cannot know how many more.
  _setIdfmFrequencyStateForTest({
    viewer: fakeViewer(BOX),
    pack: { stops: [], count: 0, stopsInBox: 1197, stopsAtLeast: true, refused: 1197, tooDense: true },
    region: REGION,
    now: TUESDAY_0930,
    status: 'zoom-in',
  });
  const label = norm(buildFrequencyLoadingLabel());
  assert.ok(label.includes('au moins 1 197 arrêts dans cette vue'));
  assert.ok(label.includes('rapprochez-vous'));
  const stats = _idfmFrequencyStatsForTest();
  assert.equal(stats.status, 'zoom-in');
  assert.equal(stats.error, undefined);
  assert.equal(stats.count, 0);
  _clearIdfmFrequencySelectionForTest();
});

test('a band window the proxy never got is named, not silently flat', () => {
  // Losing one of the four profile pages is a hole in the DAY. Unnamed, the
  // sparkline's flat stretch reads as "no service between 16:00 and 21:00".
  const partial = { ...PACK, windows: { asked: 4, answered: 3 } };
  _setIdfmFrequencyStateForTest({
    viewer: fakeViewer(BOX), pack: partial, region: REGION, now: TUESDAY_0930, points: fakePoints(),
  });
  assert.equal(missingWindows(partial), 1);
  assert.equal(missingWindows(PACK), 0);
  assert.equal(missingWindows(null), 0);
  assert.ok(norm(buildFrequencyLoadingLabel()).includes('1 fenêtres horaires manquantes en amont'));
  const record = _idfmFrequencyRecordForTest('idfm-freq:36547');
  const copy = norm(buildFrequencySelectionLabel(record, { day: 'mardi', band: 8, payload: partial }));
  assert.ok(copy.includes('n’ont pas répondu'));
  assert.ok(copy.includes('panne amont'));
  _clearIdfmFrequencySelectionForTest();
});

test('an empty viewport is guidance, not a fault', () => {
  _setIdfmFrequencyStateForTest({
    viewer: fakeViewer(BOX), pack: { stops: [], count: 0 }, region: REGION, now: TUESDAY_0930,
  });
  assert.ok(norm(buildFrequencyLoadingLabel()).includes('aucun arrêt IDFM dans cette vue'));
  const stats = _idfmFrequencyStatsForTest();
  // `empty` and `zoom-in` are GUIDANCE statuses: a green ON chip, not a fault.
  assert.equal(stats.error, undefined);
  _clearIdfmFrequencySelectionForTest();
});

test('the small text helpers say what they mean', () => {
  assert.equal(formatRate(9.94), '9,9');
  assert.equal(norm(formatRate(1234.6)), '1 235');
  assert.equal(formatRate(NaN), '—');
  assert.equal(waitPhrase(0), null);
  assert.equal(waitPhrase(null), null);
  assert.equal(waitPhrase(40), 'moins d’une minute d’attente moyenne');
  assert.equal(waitPhrase(2), '15 min d’attente moyenne');
  // A missing sample is `·` and never `▁`, which is the sparkline module's own
  // rule; here every band is published, so there are no dots.
  const stop = PACK.stops.find((entry) => entry.id === '36547');
  const glyphs = dayGlyphs(stop.profile, 'mardi');
  assert.equal(glyphs.length, 24);
  assert.equal(glyphs.includes('·'), false);
  assert.equal(dayGlyphs(stop.profile, 'monday'), '');
  assert.ok(weekLine(stop.profile, 8).startsWith('Lun 29'));
  assert.equal(weekLine(stop.profile, 8).split(' · ').length, 7);
});
