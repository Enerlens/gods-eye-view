// What the DRAWN layer is allowed to claim, once `idfmFrequencyFeed.js` and
// `idfmFeed.js` have already been proved.
//
// This is ONE layer over two IDFM publications — the ODbL stop referential and
// the Licence Ouverte hourly offer — and four properties run through the file.
//
// 1. **A stop that runs nothing at this hour must never be presentable as a
//    stop that runs a little.** Silence is a measured, published zero here, so
//    it gets its own colour, its own size, its own legend row, its own card
//    sentence, and no place in the DETECT callouts. The moment any of those
//    five acquires a fallback on the bottom of the ramp, this layer starts
//    inventing a bus.
// 2. **The merge must never invent the half it does not have, and must never
//    refuse to go and get it.** A click is a question about one coordinate, so
//    it is answered at any altitude — the frequency gate bounds the DRAWING.
//    The only absence this layer may still report is a measured one: a stop
//    with no row in the offer file. An outage says outage; neither is a zero.
// 3. **One point carries ONE mark.** The two id spaces must not collide and
//    must open the same card, the disc must yield wherever a badge stands, and
//    the badge must say mode by shape and rate by fill — with a legend that
//    describes whichever of the two the view has actually read.
// 4. **The map is always TODAY in Paris.** Every surface that names an hour
//    also names the day, so a Sunday screenshot cannot be read as a weekday one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import idfmNetworkLayer, {
  IDFM_FREQ_MOMENTS,
  IDFM_FREQ_RAMP,
  IDFM_FREQ_SILENT_COLOR,
  IDFM_FREQ_SILENT_SIZE,
  IDFM_FREQ_SIZES,
  IDFM_LAYER_ID,
  IDFM_BADGE_SIZE,
  IDFM_MODE_COLORS,
  IDFM_NOT_MEASURED_COLOR,
  IDFM_OVERLAY_SOURCE_ID,
  STOPS_ENTER_SPAN_DEG,
  STOPS_EXIT_SPAN_DEG,
  buildLoadingLabel,
  buildStopCard,
  clickDecision,
  createSelectedOverlayEntry,
  dayGlyphs,
  formatRate,
  frequencyStyle,
  idfmFreqRegimeFor,
  idfmFreqViewBox,
  idfmFreqViewSpanDeg,
  levelColor,
  levelLabel,
  missingWindows,
  networkLine,
  parisOperatingSlot,
  resolveSelection,
  resolveSlot,
  stopBadge,
  stopBadgeFill,
  waitPhrase,
  weekLine,
  _clearIdfmNetworkSelectionForTest,
  _idfmNetworkDetectablesForTest,
  _idfmNetworkProbeForTest,
  _idfmNetworkRecordForTest,
  _idfmNetworkRowControlsForTest,
  _idfmNetworkSelectedIdForTest,
  _idfmNetworkSetParamsForTest,
  _idfmNetworkSlotForTest,
  _idfmNetworkStatsForTest,
  _selectIdfmNetworkForTest,
  _setIdfmNetworkStateForTest,
} from './idfmNetwork.js';
import { projectFrequencyStops, IDFM_FREQ_SILENT_LABEL } from './idfmFrequencyFeed.js';
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

/**
 * Projected `arrets` rows, in the shape `idfmFeed.projectStops` hands over.
 *
 * Two of them join the offer file on `arrid` — measured region-wide, 95.6 % do
 * — and one deliberately does not, because 3 053 of the 37 956 referential
 * stops (8.0 %) have no row in the offer at all and the card has to say which.
 */
const REF_STOPS = Object.freeze([
  Object.freeze({
    id: '23613',
    name: 'Alésia - Général Leclerc',
    mode: 'bus',
    modeLabel: 'Bus',
    town: 'Paris 14e',
    communeCode: '75114',
    zoneId: '43135',
    fareZone: '1',
    accessible: true,
    lon: 2.322076,
    lat: 48.829576,
  }),
  Object.freeze({
    id: '22154',
    name: 'Alésia',
    mode: 'metro',
    modeLabel: 'Métro',
    town: 'Paris 14e',
    communeCode: '75114',
    zoneId: '43136',
    fareZone: '1',
    accessible: false,
    lon: 2.327093,
    lat: 48.828201,
  }),
  Object.freeze({
    id: '999001',
    name: 'Quai sans profil',
    mode: 'rail',
    modeLabel: 'RER / Transilien',
    town: 'Paris 14e',
    communeCode: '75114',
    zoneId: '43137',
    fareZone: '1',
    accessible: null,
    lon: 2.3240,
    lat: 48.8300,
  }),
]);

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

function seedStops({
  now = TUESDAY_0930, pinnedBand = null, overlay = fakeOverlay(), points = fakePoints(),
  refStops = REF_STOPS, http = undefined,
} = {}) {
  _setIdfmNetworkStateForTest({
    viewer: fakeViewer(BOX), overlayHost: overlay, now, points, pack: PACK, refStops, pinnedBand,
    http,
  });
  return { overlay, points };
}

/** The open card's body, as one string. */
function cardBody(overlay) {
  return (overlay.entries.get(IDFM_OVERLAY_SOURCE_ID)?.[0]?.details || []).join('\n');
}

/** Let the on-demand profile lookup and its repaint land. */
const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });

test('the layer object satisfies the manager contract', () => {
  assert.equal(idfmNetworkLayer.id, IDFM_LAYER_ID);
  assert.equal(IDFM_LAYER_ID, 'idfm-network');
  assert.ok(/^[a-z0-9-]+$/.test(idfmNetworkLayer.id));
  assert.equal(idfmNetworkLayer.name, 'Réseau IDFM (Paris)');
  assert.equal(typeof idfmNetworkLayer.source, 'string');
  // The row now carries BOTH licences, so the source line has to name both.
  assert.ok(idfmNetworkLayer.source.includes('ODbL'));
  assert.ok(idfmNetworkLayer.source.includes('Licence Ouverte'));
  for (const hook of ['init', 'enable', 'disable', 'update', 'getStats', 'getRowControls',
    'getDetectableObjects', 'setParams', 'getParams', 'destroy']) {
    assert.equal(typeof idfmNetworkLayer[hook], 'function', hook);
  }
  // A clock tick, not a data poll — see the module header.
  assert.equal(idfmNetworkLayer.updateInterval, 60_000);
  _clearIdfmNetworkSelectionForTest();
});

test('the palette cannot be confused with the mode hues drawn on the same points', () => {
  const mine = new Set([...IDFM_FREQ_RAMP, IDFM_FREQ_SILENT_COLOR].map((css) => css.toLowerCase()));
  // The same layer colours the same stops by MODE. None of its five hues.
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

test('a rate disc stays smaller than the badge it stands beside', () => {
  // `IDFM_BADGE_SIZE` runs 21 px (bus) to 27 px (métro and rail). Every step
  // here is strictly under the smallest of them, so the two kinds of mark can
  // never be confused where both are on screen — which they are, because the
  // referential's page stops at 100 stops and the offer's at 1 200.
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

test('the frequency gate has hysteresis, so a wheel notch cannot flip the product', () => {
  assert.ok(STOPS_ENTER_SPAN_DEG < STOPS_EXIT_SPAN_DEG);
  // 0.045° is the last span whose padded, snapped box fits under the 1 200-stop
  // ceiling at Châtelet — 1 193 stops, measured. One notch wider the identity
  // page saturates at 1 201 rows and the proxy refuses the box.
  assert.equal(STOPS_ENTER_SPAN_DEG, 0.035);
  assert.equal(STOPS_EXIT_SPAN_DEG, 0.045);
  assert.equal(idfmFreqRegimeFor(0.03, 'wide'), 'arrets');
  assert.equal(idfmFreqRegimeFor(0.04, 'wide'), 'wide');
  assert.equal(idfmFreqRegimeFor(0.04, 'arrets'), 'arrets');
  assert.equal(idfmFreqRegimeFor(0.05, 'arrets'), 'wide');
  // A camera past the limb gives no rectangle: the pictograms carry on alone,
  // never a viewport request for an infinite box.
  assert.equal(idfmFreqViewSpanDeg(fakeViewer(null)), Infinity);
  assert.equal(idfmFreqRegimeFor(Infinity, 'arrets'), 'wide');
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
  const record = _idfmNetworkRecordForTest('idfm-freq:36547');
  assert.ok(record);
  // 29 courses at 09:30 on a Tuesday puts it on rung 4 (16–32/h).
  assert.equal(record.style.level, 4);
  assert.equal(record.point.pixelSize, IDFM_FREQ_SIZES[4]);
  assert.ok(record.point.color.toCssHexString().toLowerCase().startsWith(IDFM_FREQ_RAMP[4]));
  // The rim is opaque where the fill is not, so the composition reads whichever
  // of the two stacked marks paints last.
  assert.ok(record.point.outlineColor.alpha > record.point.color.alpha);
  assert.equal(record.point.disableDepthTestDistance, Number.POSITIVE_INFINITY);
  _clearIdfmNetworkSelectionForTest();
});

test('the two marks on one coordinate keep separate ids and open ONE card', () => {
  const { overlay } = seedStops({ pinnedBand: 8 });
  // The billboard is `idfm:stop:<arrid>` and the disc is `idfm-freq:<arrid>`.
  // Unprefixed, a click would be ambiguous to `pickRegistry`.
  assert.ok(_idfmNetworkRecordForTest('idfm-freq:23613'));
  assert.equal(_idfmNetworkRecordForTest('23613'), null);

  const fromDisc = resolveSelection('idfm-freq:23613');
  const fromPictogram = resolveSelection('idfm:stop:23613');
  assert.ok(fromDisc?.ref && fromDisc?.freq, 'the disc reaches the referential row');
  assert.ok(fromPictogram?.ref && fromPictogram?.freq, 'the pictogram reaches the profile');
  assert.equal(fromDisc.ref.id, fromPictogram.ref.id);
  assert.equal(fromDisc.freq.id, fromPictogram.freq.id);

  const context = { day: 'mardi', band: 8, pack: PACK, regime: 'arrets' };
  assert.equal(buildStopCard(fromDisc, context), buildStopCard(fromPictogram, context));

  // And both routes really do open a card, with the id that was clicked.
  assert.equal(_selectIdfmNetworkForTest('idfm:stop:23613'), true);
  assert.equal(_idfmNetworkSelectedIdForTest(), 'idfm:stop:23613');
  assert.equal(overlay.entries.get(IDFM_OVERLAY_SOURCE_ID)[0].id, 'idfm:stop:23613');
  assert.equal(_selectIdfmNetworkForTest('idfm-freq:23613'), true);
  assert.equal(_idfmNetworkSelectedIdForTest(), 'idfm-freq:23613');
  _clearIdfmNetworkSelectionForTest();
});

test('one click prints the network half and the frequency half together', () => {
  const { overlay } = seedStops({ pinnedBand: 8 });
  _selectIdfmNetworkForTest('idfm:stop:23613');
  const [entry] = overlay.entries.get(IDFM_OVERLAY_SOURCE_ID);
  assert.equal(entry.title, 'Alésia - Général Leclerc');
  const body = norm(entry.details.join('\n'));

  // THE NETWORK HALF: mode, arrondissement, fare zone, step-free status.
  assert.ok(body.includes('Bus · Paris 14e · zone 1 · accessible'));
  // THE FREQUENCY HALF, on the same card and never behind a second chip.
  assert.ok(body.includes('Mardi 08:00–08:59 — 10 départs/h'));
  assert.ok(body.includes('3 min d’attente moyenne'));
  // The whole day is on the card, which is what makes one hour on the map
  // legitimate rather than a cherry-pick.
  assert.ok(body.includes('04 h '));
  assert.ok(body.includes(' 03 h'));
  assert.ok(/premier 06:00/.test(body));
  assert.ok(/dernier 01:00/.test(body));
  // The other published name is kept, at the same point, rather than deleted.
  assert.ok(body.includes('Aussi publié « Les Plantes » au même point'));
  // 21 of 24 bands published is not truncation, and the card says which it is.
  assert.ok(body.includes('21 tranches publiées sur 24'));
  // The week for the SELECTED band — the comparison the chips cannot make.
  assert.ok(body.includes('Même tranche : Lun'));
  // It never reads like a departure board, and that is the LAST line: the two
  // licences used to follow it, and they are discharged by `dataCredits.js`
  // and by the layer's `source` string, not by the eleventh line of a card
  // somebody opened to find out what serves their street.
  assert.ok(body.includes('semaine type hors vacances 2025'));
  assert.equal(/ODbL|Licence Ouverte/.test(body), false);
  assert.ok(entry.details[entry.details.length - 1].includes('semaine type'));
  _clearIdfmNetworkSelectionForTest();
});

test('a half that is missing says which one, and never says zero', async () => {
  // The proxy answers this stop's own box with no rows at all — which is what
  // 3 053 of the 37 956 referential stops (8.0 %) really get.
  const asked = [];
  const { overlay } = seedStops({
    pinnedBand: 8,
    http: (url) => {
      asked.push(String(url));
      return Promise.resolve({ ok: true, json: async () => ({ stops: [] }) });
    },
  });

  _selectIdfmNetworkForTest('idfm:stop:999001');
  // The click is registered as a QUESTION before it is an absence.
  assert.equal(_idfmNetworkProbeForTest('999001')?.status, 'loading');
  assert.ok(norm(cardBody(overlay)).includes('Lecture de l’offre horaire de cet arrêt'));
  await settle();

  const missing = norm(cardBody(overlay));
  assert.ok(missing.includes('RER / Transilien · Paris 14e · zone 1 · accessibilité non renseignée'));
  // Only now, with the answer in hand, is the absence stated.
  assert.equal(_idfmNetworkProbeForTest('999001')?.status, 'empty');
  assert.ok(missing.includes('Aucun profil horaire publié'));
  assert.equal(missing.includes('départs/h'), false);
  assert.equal(missing.includes(IDFM_FREQ_SILENT_LABEL), false);
  assert.equal(asked.length, 1, 'one box, for one stop');
  // The smallest legal question, centred on the stop the reader clicked.
  const box = new URL(asked[0], 'http://x').searchParams;
  assert.ok(Math.abs(Number(box.get('south')) - 48.8294) < 0.001, box.get('south'));
  assert.ok(Math.abs(Number(box.get('north')) - 48.8306) < 0.001, box.get('north'));

  // A stop the offer publishes and the referential box did not return: its mode
  // and commune are the OFFER file's own, said as its own — and no probe, since
  // the pack already holds it.
  _selectIdfmNetworkForTest('idfm-freq:23997');
  const orphan = norm(cardBody(overlay));
  assert.ok(orphan.includes('Bus · Paris (75)'));
  assert.equal(orphan.includes('zone 1'), false);
  assert.ok(orphan.includes('départs/h') || orphan.includes(IDFM_FREQ_SILENT_LABEL));

  // And going back to the stop with no profile does NOT buy the box again.
  _selectIdfmNetworkForTest('idfm:stop:999001');
  await settle();
  assert.equal(asked.length, 1, `${asked.length} boxes bought`);
  assert.ok(norm(cardBody(overlay)).includes('Aucun profil horaire publié'));
  _clearIdfmNetworkSelectionForTest();
});

test('a click above the frequency gate buys the profile it cannot draw', async () => {
  // Everything the map needs is out of reach up here — the discs are gone and
  // the row says to come closer. A CLICK is not the map, and it is answered.
  const overlay = fakeOverlay();
  const asked = [];
  _setIdfmNetworkStateForTest({
    viewer: fakeViewer({ south: 48.5, west: 2.0, north: 49.1, east: 2.8 }),
    overlayHost: overlay,
    now: TUESDAY_0930,
    refStops: REF_STOPS,
    http: (url) => {
      asked.push(String(url));
      return Promise.resolve({
        ok: true,
        json: async () => ({ stops: PACK.stops.filter((stop) => stop.id === '23613') }),
      });
    },
  });

  _selectIdfmNetworkForTest('idfm:stop:23613');
  await settle();
  const body = norm(cardBody(overlay));
  // No ceiling quoted back at the reader — the numbers, which is what a click
  // asked for. This line used to read "Offre horaire non lue à cette altitude".
  assert.equal(/altitude|Rapprochez|rapprochez/.test(body), false, body);
  assert.ok(body.includes('départs/h'), body);
  assert.ok(body.includes('Mardi 09:00–09:59'), body);
  assert.equal(asked.length, 1);

  // The MAP is untouched: one stop wearing a rate while the hundred around it
  // wear their mode would read as a difference in service.
  assert.equal(_idfmNetworkStatsForTest().regime, 'wide');
  assert.equal(_idfmNetworkStatsForTest().charted, 0);
  // And the row still says where the frequency starts being drawn.
  assert.ok(norm(buildLoadingLabel()).includes('fréquence à partir d’une vue de 5 km'));
  _clearIdfmNetworkSelectionForTest();
});

test('a proxy that fails a click says so, and never says "no service"', async () => {
  const overlay = fakeOverlay();
  _setIdfmNetworkStateForTest({
    viewer: fakeViewer({ south: 48.5, west: 2.0, north: 49.1, east: 2.8 }),
    overlayHost: overlay,
    now: TUESDAY_0930,
    refStops: REF_STOPS,
    http: () => Promise.resolve({ ok: false, status: 503 }),
  });
  _selectIdfmNetworkForTest('idfm:stop:23613');
  await settle();
  const body = norm(cardBody(overlay));
  assert.equal(_idfmNetworkProbeForTest('23613')?.status, 'error');
  assert.ok(body.includes('momentanément indisponible'), body);
  // An outage is not a measurement, so it must not borrow the sentence for one.
  assert.equal(body.includes('Aucun profil horaire publié'), false);
  assert.equal(body.includes('départs/h'), false);
  _clearIdfmNetworkSelectionForTest();
});

test('scrubbing the hour repaints what the browser already holds', () => {
  const { points } = seedStops();
  const before = _idfmNetworkRecordForTest('idfm-freq:36547').style.level;
  const added = points.added.length;
  _idfmNetworkSetParamsForTest({ band: 25 });
  assert.deepEqual(_idfmNetworkSlotForTest(), { day: 'mardi', band: 25, pinned: 25 });
  // 6 courses at 01:00 — rung 2 — against 29 at 09:30. No new primitive was
  // created and nothing was fetched: the 7 × 24 profile is already on the wire.
  assert.equal(_idfmNetworkRecordForTest('idfm-freq:36547').style.level, 2);
  assert.notEqual(before, 2);
  assert.equal(points.added.length, added);
  // The other métro platform has no 01:00 service at all.
  assert.equal(_idfmNetworkRecordForTest('idfm-freq:463118').style.level, -1);
  _clearIdfmNetworkSelectionForTest();
});

test('an unknown band is ignored rather than clamped onto a real hour', () => {
  seedStops({ pinnedBand: 22 });
  for (const band of [3, 28, 'huit', {}, 12.5, true, []]) {
    _idfmNetworkSetParamsForTest({ band });
    assert.equal(_idfmNetworkSlotForTest().band, 22, JSON.stringify(band));
  }
  // `'now'` and an explicit `null` are the two ways to hand the clock back.
  _idfmNetworkSetParamsForTest({ band: 'now' });
  assert.equal(_idfmNetworkSlotForTest().pinned, null);
  assert.equal(_idfmNetworkSlotForTest().band, 9);
  _clearIdfmNetworkSelectionForTest();
});

test('a stop with no service in the band says so, and does not say zero', () => {
  seedStops({ pinnedBand: 27 });
  const resolved = resolveSelection('idfm-freq:23997');
  const copy = norm(buildStopCard(resolved, { day: 'mardi', band: 27, regime: 'arrets' }));
  assert.ok(copy.includes(IDFM_FREQ_SILENT_LABEL));
  assert.equal(copy.includes('0 départs/h'), false);
  assert.equal(copy.includes('d’attente moyenne'), false);
  // 19 bands out of 24, and the card explains the flat tail of the sparkline.
  assert.ok(copy.includes('19 tranches publiées sur 24'));
  _clearIdfmNetworkSelectionForTest();
});

test('the card is built from the same record the DETECT callout is', () => {
  const { overlay } = seedStops();
  _selectIdfmNetworkForTest('idfm-freq:22154');
  const [entry] = overlay.entries.get(IDFM_OVERLAY_SOURCE_ID);
  assert.equal(entry.protected, true);
  assert.equal(entry.selected, true);
  assert.equal(entry.id, 'idfm-freq:22154');
  const detect = _idfmNetworkDetectablesForTest();
  const mine = detect.find((row) => row.sourceId === 'idfm-freq:22154');
  assert.ok(mine);
  // The selected stop already carries a card, so DETECT does not draw a second
  // label over it.
  assert.equal(mine.skipLabel, true);
  assert.equal(mine.type, 'Transit frequency');
  assert.equal(mine.id, '31/h');
  _clearIdfmNetworkSelectionForTest();
});

test('DETECT is offered the busiest stops and never a silent one', () => {
  seedStops({ pinnedBand: 27 });
  const detect = _idfmNetworkDetectablesForTest();
  // Only 36547 runs anything at 03:00 in this box; a "0/h" callout is the most
  // expensive way this app has of saying nothing.
  assert.deepEqual(detect.map((row) => row.sourceId), ['idfm-freq:36547']);
  assert.equal(detect[0].id, '6/h');

  seedStops({ pinnedBand: 8 });
  const capped = _idfmNetworkDetectablesForTest({ maxCount: 2 });
  assert.equal(capped.length, 2);
  // Busiest first, so a strided sample keeps the stops a reader would keep.
  assert.equal(capped[0].sourceId, 'idfm-freq:463118');
  _clearIdfmNetworkSelectionForTest();
});

test('DETECT offers nothing above the frequency gate', () => {
  // The pictograms are still on screen up there, but a callout can only quote a
  // rate this layer has not read at that altitude.
  _setIdfmNetworkStateForTest({ viewer: fakeViewer(), refStops: REF_STOPS, now: TUESDAY_0930 });
  assert.deepEqual(_idfmNetworkDetectablesForTest(), []);
  _clearIdfmNetworkSelectionForTest();
});

test('the row controls are seven moments, exactly one of them lit', () => {
  seedStops();
  const controls = _idfmNetworkRowControlsForTest();
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
  _idfmNetworkSetParamsForTest({ band: 12 });
  const pinned = _idfmNetworkRowControlsForTest();
  assert.equal(pinned.chips.find((chip) => chip.id === 'b12').active, true);
  assert.equal(pinned.chips.find((chip) => chip.id === 'now').active, false);
  _clearIdfmNetworkSelectionForTest();
});

test('the legend counts what is drawn, and always carries the silence', () => {
  seedStops({ pinnedBand: 8 });
  const { legend } = _idfmNetworkRowControlsForTest();
  const rate = legend.filter((entry) => entry.color !== IDFM_NOT_MEASURED_COLOR);
  assert.equal(rate.reduce((total, entry) => total + entry.count, 0), 6);
  const silent = legend.find((entry) => entry.label === IDFM_FREQ_SILENT_LABEL);
  assert.ok(silent, 'the silent row is present even at zero');
  assert.equal(silent.count, 0);
  assert.equal(silent.color, IDFM_FREQ_SILENT_COLOR);
  assert.ok(silent.blurb.includes('mesurée'));

  // The badges the offer does not reach get their own row, in the repo-wide
  // "not measured" grey — one of the three referential stops in the fixture.
  const unmeasured = legend.find((entry) => entry.color === IDFM_NOT_MEASURED_COLOR);
  assert.ok(unmeasured, 'the unmeasured row is present');
  assert.equal(unmeasured.count, 1);
  assert.notEqual(unmeasured.color, IDFM_FREQ_SILENT_COLOR);

  // At 03:00 the same six stops collapse onto the silence.
  _idfmNetworkSetParamsForTest({ band: 27 });
  const night = _idfmNetworkRowControlsForTest().legend;
  assert.equal(night.find((entry) => entry.label === IDFM_FREQ_SILENT_LABEL).count, 5);
  _clearIdfmNetworkSelectionForTest();
});

test('a view that read no rate gets a legend of MODES, not a ramp of zeros', () => {
  // The bug this closes was on screen: above the frequency gate the ramp was
  // listed with six rungs at zero and one silent row at zero, which is a
  // legend describing nothing that is drawn.
  const overlay = fakeOverlay();
  _setIdfmNetworkStateForTest({
    viewer: fakeViewer({ south: 48.5, west: 2.0, north: 49.1, east: 2.8 }),
    overlayHost: overlay,
    now: TUESDAY_0930,
    refStops: REF_STOPS,
  });
  const { legend } = _idfmNetworkRowControlsForTest();
  assert.equal(legend.length, 3);
  assert.equal(legend.reduce((total, entry) => total + entry.count, 0), 3);
  // Read in the order the marks read on the map: biggest badge first.
  assert.deepEqual(legend.map((entry) => entry.label),
    ['Métro', 'RER / Transilien', 'Bus']);
  for (const entry of legend) {
    assert.ok(Object.values(IDFM_MODE_COLORS).includes(entry.color), entry.color);
    assert.ok(entry.blurb.length > 20, entry.label);
  }
  // Not one rung of the rate ramp, because no rate was read.
  assert.equal(legend.some((entry) => IDFM_FREQ_RAMP.includes(entry.color)), false);
  assert.equal(legend.some((entry) => entry.color === IDFM_FREQ_SILENT_COLOR), false);
  _clearIdfmNetworkSelectionForTest();
});

test('one stop is drawn ONCE: the disc yields to the badge on its own point', () => {
  const { points } = seedStops({ pinnedBand: 8 });
  // Six profiles in the pack, three of them also in the referential box — and
  // two of those three join, so two discs stand down.
  const shown = points.added.filter((point) => point.show !== false);
  assert.equal(points.added.length, 6);
  assert.equal(shown.length, 4);
  for (const id of ['idfm-freq:23613', 'idfm-freq:22154']) {
    assert.equal(_idfmNetworkRecordForTest(id).point.show, false, id);
  }
  // The stop the referential never returned keeps its disc: nothing else draws it.
  assert.equal(_idfmNetworkRecordForTest('idfm-freq:23997').point.show, true);

  // Both are still CHARTED — they count in the legend and in the stats, and
  // the badge carries the rate. Yielding a primitive is not dropping a fact.
  assert.equal(_idfmNetworkStatsForTest().charted, 6);
  _clearIdfmNetworkSelectionForTest();
});

test('a badge says its mode by shape and its rate by fill', () => {
  const ref = REF_STOPS[0];
  const freq = PACK.stops.find((stop) => stop.id === '23613');

  // In a charted view the fill is the ramp — the colour the legend explains.
  assert.equal(
    stopBadgeFill({ mode: 'bus', freq, day: 'mardi', band: 8 }),
    frequencyStyle(10).css,
  );
  // A published zero keeps the silent colour, never the bottom rung.
  assert.equal(
    stopBadgeFill({ mode: 'bus', freq, day: 'mardi', band: 27 }),
    IDFM_FREQ_SILENT_COLOR,
  );
  // No profile in a view that charted others: the repo-wide "not measured".
  assert.equal(stopBadgeFill({ mode: 'rail', charted: true }), IDFM_NOT_MEASURED_COLOR);
  // No profile anywhere in the view: the colour is free to name the mode.
  assert.equal(stopBadgeFill({ mode: 'rail' }), IDFM_MODE_COLORS.rail);
  assert.equal(stopBadgeFill({ mode: 'nope' }), stopBadgeFill({}));

  // The mark itself: one data URI per (mode, fill), and the mode is the SHAPE.
  const busy = stopBadge(ref.mode, IDFM_FREQ_RAMP[5]);
  const quiet = stopBadge(ref.mode, IDFM_FREQ_RAMP[0]);
  assert.ok(busy.startsWith('data:image/svg+xml;base64,'));
  assert.notEqual(busy, quiet, 'the fill is in the artwork');
  assert.notEqual(stopBadge('metro', IDFM_FREQ_RAMP[5]), busy, 'the mode is in the artwork');
  assert.equal(stopBadge(ref.mode, IDFM_FREQ_RAMP[5]), busy, 'memoised');

  const svg = (uri) => Buffer.from(uri.split(',')[1], 'base64').toString('utf8');
  // Either end of a LIGHTNESS ramp has to hold a pictogram, so the ink is
  // chosen from the fill and cannot be a tint. Dark rung, light ink.
  assert.ok(svg(quiet).includes(`fill="${IDFM_FREQ_RAMP[0]}"`));
  assert.notEqual(
    /<g fill="(#[0-9a-f]{6})" stroke="none">/i.exec(svg(quiet))?.[1],
    /<g fill="(#[0-9a-f]{6})" stroke="none">/i.exec(svg(busy))?.[1],
  );

  // Every badge is strictly bigger than the biggest rate disc, so the two
  // marks can never be mistaken for one another where both are drawn.
  for (const size of Object.values(IDFM_BADGE_SIZE)) {
    assert.ok(size > IDFM_FREQ_SIZES[IDFM_FREQ_SIZES.length - 1], `${size} px`);
  }
  _clearIdfmNetworkSelectionForTest();
});

test('every surface that names an hour also names the day', () => {
  seedStops({ pinnedBand: 22 });
  const label = norm(buildLoadingLabel());
  assert.ok(label.includes('Mardi 22:00–22:59'));
  assert.ok(label.startsWith('3 arrêts'));
  assert.ok(label.includes('6 chiffrés'));
  const stats = _idfmNetworkStatsForTest();
  assert.equal(stats.day, 'mardi');
  assert.equal(stats.band, 22);
  assert.equal(stats.pinned, true);
  assert.equal(stats.count, 3);
  assert.equal(stats.charted, 6);
  assert.equal(stats.regime, 'arrets');
  assert.ok(norm(stats.loadingLabel).includes('Mardi'));

  // Following the clock says so, so a reader knows why the map moved.
  _idfmNetworkSetParamsForTest({ band: 'now' });
  assert.ok(norm(buildLoadingLabel()).includes('(heure de Paris)'));
  _clearIdfmNetworkSelectionForTest();
});

test('a box the proxy refused is guidance with a number, not an empty map', () => {
  // The proxy answers a saturated identity page with the count it can honestly
  // claim and NO profiles, so this state has to be legible from the payload
  // alone: `zoom-in` is a GUIDANCE status — a green ON chip — and the sentence
  // says "au moins", because a saturated page cannot know how many more.
  _setIdfmNetworkStateForTest({
    viewer: fakeViewer(BOX),
    pack: { stops: [], count: 0, stopsInBox: 1197, stopsAtLeast: true, refused: 1197, tooDense: true },
    refStops: REF_STOPS,
    now: TUESDAY_0930,
    status: 'zoom-in',
  });
  const label = norm(buildLoadingLabel());
  assert.ok(label.includes('au moins 1 197 arrêts dans cette vue'));
  assert.ok(label.includes('rapprochez-vous'));
  const stats = _idfmNetworkStatsForTest();
  assert.equal(stats.regime, 'arrets');
  assert.equal(stats.error, null);
  assert.equal(stats.charted, 0);
  // The pictograms are still on screen: the refusal is about the RATE only.
  assert.equal(stats.count, 3);
  _clearIdfmNetworkSelectionForTest();
});

test('a band window the proxy never got is named, not silently flat', () => {
  // Losing one of the four profile pages is a hole in the DAY. Unnamed, the
  // sparkline's flat stretch reads as "no service between 16:00 and 21:00".
  const partial = { ...PACK, windows: { asked: 4, answered: 3 } };
  _setIdfmNetworkStateForTest({
    viewer: fakeViewer(BOX), pack: partial, refStops: REF_STOPS, now: TUESDAY_0930, points: fakePoints(),
  });
  assert.equal(missingWindows(partial), 1);
  assert.equal(missingWindows(PACK), 0);
  assert.equal(missingWindows(null), 0);
  assert.ok(norm(buildLoadingLabel()).includes('1 fenêtres horaires manquantes en amont'));
  const copy = norm(buildStopCard(resolveSelection('idfm-freq:36547'), {
    day: 'mardi', band: 8, pack: partial, regime: 'arrets',
  }));
  assert.ok(copy.includes('n’ont pas répondu'));
  assert.ok(copy.includes('panne amont'));
  _clearIdfmNetworkSelectionForTest();
});

test('an empty viewport is guidance, not a fault', () => {
  _setIdfmNetworkStateForTest({
    viewer: fakeViewer(BOX), pack: { stops: [], count: 0 }, refStops: REF_STOPS, now: TUESDAY_0930,
  });
  assert.ok(norm(buildLoadingLabel()).includes('aucune fréquence publiée dans cette vue'));
  const stats = _idfmNetworkStatsForTest();
  // `empty` and `zoom-in` are GUIDANCE statuses: a green ON chip, not a fault.
  assert.equal(stats.error, null);
  _clearIdfmNetworkSelectionForTest();
});

test('nothing is claimed for a stop neither publication holds', () => {
  seedStops();
  assert.equal(buildStopCard({}), '');
  assert.equal(buildStopCard({ ref: null, freq: null }), '');
  assert.equal(networkLine(null), null);
  assert.equal(resolveSelection('idfm:stop:not-a-stop'), null);
  assert.equal(resolveSelection('idfm-freq:not-a-stop'), null);
  assert.equal(resolveSelection(''), null);
  assert.equal(createSelectedOverlayEntry('idfm:stop:not-a-stop'), null);
  assert.equal(_selectIdfmNetworkForTest('idfm:stop:not-a-stop'), false);
  _clearIdfmNetworkSelectionForTest();
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

test('a click on the map closes the card, even on a photorealistic globe', () => {
  const { overlay } = seedStops({ pinnedBand: 8 });
  _selectIdfmNetworkForTest('idfm:stop:23613');
  assert.ok(overlay.entries.get(IDFM_OVERLAY_SOURCE_ID));

  // Either of this layer's two marks selects.
  assert.deepEqual(clickDecision({ id: 'idfm:stop:22154' }),
    { action: 'select', id: 'idfm:stop:22154' });
  assert.deepEqual(clickDecision({ id: 'idfm-freq:23997' }),
    { action: 'select', id: 'idfm-freq:23997' });

  // THE REGRESSION. A click on the ground over Paris picks the 3D Tiles
  // feature under the cursor, so the pick is not falsy — it just is not ours.
  // The old handler tested `!picked` and therefore never closed anything.
  const tilesetPick = { primitive: { isCesium3DTileset: true }, content: {}, id: undefined };
  assert.deepEqual(clickDecision(tilesetPick), { action: 'close', id: null });
  // Another layer's entity closes it too: the card answers "this stop".
  assert.deepEqual(clickDecision({ id: { id: 'flight:AF1234' } }), { action: 'close', id: null });
  // Empty sky over the horizon, with nothing open, is not an action.
  assert.deepEqual(clickDecision(null, { selectedId: null }), { action: 'ignore', id: null });

  // And the production path really does clear the host.
  _clearIdfmNetworkSelectionForTest();
  assert.equal(overlay.entries.get(IDFM_OVERLAY_SOURCE_ID), undefined);
});
