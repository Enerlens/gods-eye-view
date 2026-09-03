// src/data/veloPulse.test.mjs
// The layer: three ways of looking at a typical week, a pack that is refused
// when it is broken, and a card that never lets a stock be read as a flow.
//
// The arithmetic — slots, peaks, bands, heights — is proved in
// `veloPulseFeed.test.mjs`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import veloPulseLayer, {
  ANIMATION_MS_PER_SLOT,
  PULSE_MODES,
  _loadPulsePackForTest,
  _pulseRowControlsForTest,
  _pulseSeekForTest,
  _pulseSetParamsForTest,
  _pulseStateForTest,
  _pulseStatsForTest,
  _pulseStopTickForTest,
  _pulseTogglePlayForTest,
  _setPulseStateForTest,
  buildRecords,
  createPulseOverlayEntry,
  resolveMode,
  siteId,
  slotForMode,
} from './veloPulse.js';
import { PULSE_SLOTS } from './veloPulseFeed.js';

function profile(spikeSlot, spikeValue, base = 10) {
  const out = new Array(PULSE_SLOTS).fill(base);
  out[spikeSlot] = spikeValue;
  return out;
}

const LYON_SITE = {
  id: '1024', name: 'Bellecour', commune: 'Lyon 2e', lon: 4.83, lat: 45.75, capacity: 40,
  profile: profile(16, 800, 200), samples: new Array(PULSE_SLOTS).fill(4),
};
const PARIS_SITE = {
  id: '100-200', name: 'Pont National', direction: 'SO-NE', installedOn: '2018-12-04',
  lon: 2.39, lat: 48.83, profile: profile(32, 350, 40), samples: new Array(PULSE_SLOTS).fill(3),
};

const PACK = {
  slots: PULSE_SLOTS,
  window: { start: '2026-06-01', end: '2026-06-28', weeks: 4 },
  cities: {
    lyon: {
      label: 'Lyon — Vélo\'v', instrument: 'stock', unit: 'remplissage de la station, en %',
      scale: 1000, source: 'Métropole de Lyon / JCDecaux', sites: [LYON_SITE],
    },
    paris: {
      label: 'Paris — compteurs vélo', instrument: 'flow', unit: 'cyclistes comptés par heure',
      scale: 1, source: 'Ville de Paris', sites: [PARIS_SITE],
    },
  },
};

function fakeViewer() {
  return {
    scene: {
      globe: { ellipsoid: Cesium.Ellipsoid.WGS84, getHeight: () => 170, show: true },
      primitives: { add: () => {}, remove: () => true },
    },
  };
}

/** Every test leaves the module's animation stopped. */
function reset() {
  _pulseStopTickForTest();
  _setPulseStateForTest({ viewer: null, pack: null, records: new Map(), mode: 'now', slot: 16 });
}

// ── Modes ───────────────────────────────────────────────────────────────────

test('the three modes are the three questions, and nothing else resolves', () => {
  assert.deepEqual(PULSE_MODES.map((mode) => mode.id), ['now', 'week', 'peak']);
  for (const mode of PULSE_MODES) assert.equal(resolveMode(mode.id), mode.id);
  assert.equal(resolveMode('NOW'), 'now', 'a share link may arrive uppercased');
  assert.equal(resolveMode('sunday'), null);
  assert.equal(resolveMode(null), null);
});

test('peak reads a stock the right way round, so it lands on a riding hour', () => {
  // In the fixture Lyon's station is FULLEST at slot 16 and Paris' counter is
  // BUSIEST at slot 32. Read naively — sum the raw numbers, take the maximum —
  // slot 16 wins and the layer freezes on the hour every bike is parked. A
  // stock is the complement of the use, so 16 is Lyon's QUIETEST hour and the
  // combined answer is Paris' real peak. On the shipped pack the same
  // correction moves Lyon from Wednesday 03:00 to Wednesday 18:00.
  assert.equal(slotForMode('peak', PACK), 32);
  // A pack with no sites falls back to the wall clock rather than to slot 0.
  const empty = { cities: {} };
  assert.equal(slotForMode('peak', empty, { now: new Date(2026, 5, 2, 8, 0) }), 32);
  assert.equal(slotForMode('now', PACK, { now: new Date(2026, 5, 2, 8, 0) }), 32);
});

test('setting a mode that is not a change, or not a mode, is refused', () => {
  reset();
  _setPulseStateForTest({ viewer: fakeViewer(), pack: PACK, mode: 'now', slot: 16 });
  assert.equal(_pulseSetParamsForTest({ mode: 'now' }), false);
  assert.equal(_pulseSetParamsForTest({ mode: 'nope' }), false);
  assert.equal(_pulseSetParamsForTest({}), false);
  assert.equal(_pulseStateForTest().mode, 'now');
  reset();
});

test('the mode reaches a share link, because it is what the layer is showing', () => {
  reset();
  _setPulseStateForTest({ viewer: fakeViewer(), pack: PACK, mode: 'peak' });
  assert.deepEqual(veloPulseLayer.getParams(), { mode: 'peak' });
  reset();
});

test('the week is paced for a reader, not for a stopwatch', () => {
  // 520 ms an hour: the whole week takes about a minute and a half. The layer
  // shipped at 220 ms — 37 seconds for 168 discrete jumps — and nobody could
  // tell what had changed between one frame and the next.
  assert.ok(ANIMATION_MS_PER_SLOT >= 450, `${ANIMATION_MS_PER_SLOT} ms per hour`);
  const weekSeconds = (ANIMATION_MS_PER_SLOT * PULSE_SLOTS) / 1000;
  assert.ok(weekSeconds > 60 && weekSeconds < 180, `${weekSeconds} s for a week`);
});

test('scrubbing stops the week on the hour asked for, and says so in the row', () => {
  reset();
  _setPulseStateForTest({ viewer: fakeViewer(), pack: PACK, mode: 'now', slot: 0 });
  _pulseSetParamsForTest({ mode: 'week' });
  assert.equal(_pulseStateForTest().ticking, true);
  _pulseSeekForTest(3 * 24 + 15);
  const state = _pulseStateForTest();
  assert.equal(state.ticking, false, 'a scrub pauses; the reader is the clock now');
  assert.equal(state.slot, 3 * 24 + 15);
  // A row reading MAINTENANT over a globe showing Thursday 15:00 would be a lie
  // told by the interface, so a scrub moves the layer into SEMAINE.
  assert.equal(state.mode, 'week');
  assert.equal(_pulseStatsForTest().slotLabel, 'jeudi 15h');
  const paused = _pulseRowControlsForTest().chips.find((chip) => chip.id === 'week');
  assert.ok(paused.active && /❚❚/.test(paused.label), JSON.stringify(paused));
  // And play resumes from exactly where the scrub left it.
  _pulseTogglePlayForTest();
  assert.equal(_pulseStateForTest().ticking, true);
  assert.equal(_pulseStateForTest().slot, 3 * 24 + 15);
  _pulseTogglePlayForTest();
  assert.equal(_pulseStateForTest().ticking, false);
  reset();
});

test('pressing SEMAINE again restarts a week the reader had paused', () => {
  reset();
  _setPulseStateForTest({ viewer: fakeViewer(), pack: PACK, mode: 'now', slot: 0 });
  _pulseSetParamsForTest({ mode: 'week' });
  _pulseSeekForTest(40);
  assert.equal(_pulseStateForTest().ticking, false);
  // Same mode, and still a change: the chip is the only restart control a
  // reader who never found the panel has.
  assert.equal(_pulseSetParamsForTest({ mode: 'week' }), true);
  assert.equal(_pulseStateForTest().ticking, true);
  reset();
});

test('week animates and the other two do not, and disable always stops it', () => {
  reset();
  _setPulseStateForTest({ viewer: fakeViewer(), pack: PACK, mode: 'now', slot: 0 });
  assert.equal(_pulseStateForTest().ticking, false);
  assert.equal(_pulseSetParamsForTest({ mode: 'week' }), true);
  assert.equal(_pulseStateForTest().ticking, true, 'week must animate');
  assert.equal(_pulseSetParamsForTest({ mode: 'peak' }), true);
  assert.equal(_pulseStateForTest().ticking, false, 'leaving week must stop the clock');
  // And a layer switched off never leaves a timer holding continuous render.
  _pulseSetParamsForTest({ mode: 'week' });
  assert.equal(_pulseStateForTest().ticking, true);
  veloPulseLayer.disable();
  assert.equal(_pulseStateForTest().ticking, false);
  reset();
});

// ── Records ─────────────────────────────────────────────────────────────────

test('one record per site, each carrying its own city and its own scale', () => {
  const records = buildRecords(PACK, 16);
  assert.equal(records.length, 2);
  const lyon = records.find((record) => record.cityKey === 'lyon');
  const paris = records.find((record) => record.cityKey === 'paris');
  assert.equal(lyon.value, 80, '800 tenths of a percent decodes to 80 %');
  assert.equal(lyon.peak, 80, 'and so does its own peak');
  assert.equal(paris.value, 40, 'Paris is unscaled');
  assert.equal(paris.peak, 350);
  assert.equal(lyon.id, siteId('lyon', LYON_SITE));
  // Lyon is at its own peak here and Paris is not: the colours must differ.
  assert.notEqual(lyon.color, paris.color);
});

test('a site with no reading at this hour is grey and flat, not zero-and-blue', () => {
  const holed = { ...PARIS_SITE, profile: [...PARIS_SITE.profile] };
  holed.profile[5] = null;
  const pack = { ...PACK, cities: { ...PACK.cities, paris: { ...PACK.cities.paris, sites: [holed] } } };
  const record = buildRecords(pack, 5).find((entry) => entry.cityKey === 'paris');
  assert.equal(record.value, null);
  assert.equal(record.radiusM, 0, 'nothing measured is nothing drawn');
  assert.equal(record.share, null);
  assert.equal(record.color, 'rgb(74, 85, 104)', 'the unsampled grey, not the bottom band');
});

// ── The card ────────────────────────────────────────────────────────────────

test('every card names its instrument, because the two cities do not share one', () => {
  reset();
  _setPulseStateForTest({ viewer: fakeViewer(), pack: PACK, slot: 16 });
  const [lyon, paris] = buildRecords(PACK, 16);
  const lyonCard = createPulseOverlayEntry(lyon, PACK);
  const parisCard = createPulseOverlayEntry(paris, PACK);
  assert.ok(lyonCard.details.some((line) => /Mesure un STOCK/.test(line)));
  assert.ok(parisCard.details.some((line) => /Mesure un FLUX/.test(line)));
  // And the reading is in that city's unit, never a shared abstract number.
  assert.ok(lyonCard.details.some((line) => /% pleine/.test(line)));
  assert.ok(parisCard.details.some((line) => /cyclistes par heure/.test(line)));
  reset();
});

test('the card says which four weeks it is averaging', () => {
  reset();
  _setPulseStateForTest({ viewer: fakeViewer(), pack: PACK, slot: 16 });
  const card = createPulseOverlayEntry(buildRecords(PACK, 16)[0], PACK);
  assert.ok(card.details.some((line) => /2026-06-01 → 2026-06-28/.test(line)),
    card.details.join(' | '));
  // A typical week in June is not a typical week in January, and a reader who
  // does not know which four weeks these are cannot judge them.
  assert.ok(card.details.some((line) => /Moyenne de 4 semaines/.test(line)));
  reset();
});

test('a card for an hour with no reading says so instead of printing a number', () => {
  reset();
  const holed = { ...PARIS_SITE, profile: [...PARIS_SITE.profile], samples: [...PARIS_SITE.samples] };
  holed.profile[5] = null;
  holed.samples[5] = 0;
  const pack = { ...PACK, cities: { paris: { ...PACK.cities.paris, sites: [holed] } } };
  _setPulseStateForTest({ viewer: fakeViewer(), pack, slot: 5 });
  const card = createPulseOverlayEntry(buildRecords(pack, 5)[0], pack);
  assert.ok(card.details.some((line) => /non échantillonné/.test(line)));
  assert.ok(card.details.some((line) => /Aucun relevé à cette heure/.test(line)));
  reset();
});

// ── The pack contract ───────────────────────────────────────────────────────

test('a broken pack is refused loudly rather than drawn half', () => {
  reset();
  const bad = async () => ({ ok: true, json: async () => ({ slots: 24, cities: {} }) });
  return _loadPulsePackForTest(bad).then((ok) => {
    assert.equal(ok, false);
    const stats = _pulseStatsForTest();
    assert.equal(stats.status, 'unavailable');
    assert.match(stats.error, /pack invalide/);
    reset();
  });
});

test('a pack that will not load leaves an error, not an empty week', () => {
  reset();
  const down = async () => ({ ok: false, status: 503, json: async () => ({}) });
  return _loadPulsePackForTest(down).then((ok) => {
    assert.equal(ok, false);
    assert.match(_pulseStatsForTest().error, /503/);
    reset();
  });
});

// ── The row ─────────────────────────────────────────────────────────────────

test('the legend counts sites per band AT THE HOUR ON SCREEN', () => {
  reset();
  const records = new Map(buildRecords(PACK, 16).map((record) => [record.id, record]));
  _setPulseStateForTest({ viewer: fakeViewer(), pack: PACK, records, mode: 'now', slot: 16 });
  const { chips, legend } = _pulseRowControlsForTest();
  assert.equal(chips.length, 3);
  assert.equal(chips.filter((chip) => chip.active).length, 1);
  assert.equal(legend.reduce((sum, row) => sum + row.count, 0), 2,
    'every drawn site lands in exactly one band');
  // Lyon is at its own peak at slot 16, so the top band must not be empty.
  assert.ok(legend.at(-1).count > 0 || legend.at(-2).count > 0, JSON.stringify(legend));
  reset();
});

test('the row says which hour of the week is on screen', () => {
  reset();
  _setPulseStateForTest({ viewer: fakeViewer(), pack: PACK, mode: 'now', slot: 24 + 8 });
  const stats = _pulseStatsForTest();
  assert.equal(stats.slot, 32);
  assert.equal(stats.slotLabel, 'mardi 08h');
  assert.match(stats.loadingLabel, /mardi 08h/);
  assert.equal(stats.mode, 'now');
  // And it keeps the two cities apart in what it reports.
  assert.equal(stats.cities.lyon.instrument, 'stock');
  assert.equal(stats.cities.paris.instrument, 'flow');
  reset();
});
