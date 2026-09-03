// What a street's day is allowed to look like, and what a colour is allowed to
// claim about it.
//
// One property runs through all of it: the scale for MEASURED LOAD and the mark
// for NO MEASUREMENT are never the same channel. A silent arc cannot reach the
// bottom of the width scale, an unmeasured hour cannot reach the bottom of the
// sparkline, and an occupancy — a real number in a unit the scale does not
// speak — cannot be placed on it at all. The second property is that the
// weekday and weekend pictures stay comparable, because 696 of 1 710 counting
// arcs are BUSIER at the weekend and two independently-normalised sparklines
// would hide every one of them.
//
// Two more arrived with the hour cursor of 2026-09-03, and they are the ones
// most of the file below is about:
//
//  • ONE CHANNEL, ONE INFORMATION. The width carries the count and the hue
//    carries the rhythm class. Neither may carry the other's variable, and the
//    hue must not move when the cursor does — a rhythm is a property of the
//    week, not of the hour being read.
//  • THE CURSOR NAVIGATES AN ARCHIVE. Every slot label names a typical day of a
//    published week; none of them may read as a live moment.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  COMPTAGES_DAY_TYPE_LABELS,
  COMPTAGES_FLOW_COLORS,
  COMPTAGES_FLOW_THRESHOLDS,
  COMPTAGES_FLOW_WIDTHS,
  COMPTAGES_HOUR_GAP_COLOR,
  COMPTAGES_MOMENTS,
  COMPTAGES_OCCUPANCY_BANDS,
  COMPTAGES_OCCUPANCY_COLOR,
  COMPTAGES_RHYTHM_CLASSES,
  COMPTAGES_RHYTHM_COLORS,
  COMPTAGES_RHYTHM_LABELS,
  COMPTAGES_RHYTHM_THRESHOLDS,
  COMPTAGES_RHYTHM_WINDOWS,
  COMPTAGES_SATURATED_MIN,
  COMPTAGES_SILENT_COLOR,
  COMPTAGES_STATES,
  COMPTAGES_STATE_LABELS,
  comptagesArcFlow,
  comptagesArcStyle,
  comptagesClockSlot,
  comptagesDayLine,
  comptagesFlowBandGlyph,
  comptagesFlowBandLabel,
  comptagesFlowBin,
  comptagesHasHourGap,
  comptagesHourLabel,
  comptagesMeasuredHours,
  comptagesOccupancyBand,
  comptagesParseSlot,
  comptagesPeak,
  comptagesProfileReference,
  comptagesReachableBands,
  comptagesResolveSlot,
  comptagesRhythmClass,
  comptagesRhythmColor,
  comptagesRhythmLabel,
  comptagesRhythmMetrics,
  comptagesSaturatedHours,
  comptagesSlotLabel,
  comptagesSlotToken,
  comptagesStrokeGlyph,
  comptagesTrough,
} from './comptagesRhythm.js';
import { ROAD_STATUS_LEVELS } from './datexRoadStatus.js';
import { newestComptagesWeek, projectComptagesArcs } from './comptagesFeed.js';

const read = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const norm = (value) => String(value).replace(/[\s  ]+/g, ' ');

const PACK = projectComptagesArcs({
  features: read('comptages-hour-geojson-sample.json').features,
  weekday: read('comptages-profil-semaine-sample.json').results,
  weekend: read('comptages-profil-weekend-sample.json').results,
  barre: read('comptages-etat-barre-sample.json').results,
  week: newestComptagesWeek('2026-08-31T00:00:00+02:00'),
});
const arc = (id) => PACK.arcs.find((row) => row.a === id);

/** sRGB hex → hue in degrees. Used to prove the wheel avoids the green sector. */
function hueOf(hex) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return ((h * 60) % 360 + 360) % 360;
}

/** CIE76 ΔE between two sRGB hexes — the separation figure the header quotes. */
function deltaE(a, b) {
  const lab = (hex) => {
    const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const [r, g, bl] = [0, 2, 4].map((i) => lin(parseInt(hex.slice(1 + i, 3 + i), 16) / 255));
    const X = (0.4124 * r + 0.3576 * g + 0.1805 * bl) / 0.95047;
    const Y = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    const Z = (0.0193 * r + 0.1192 * g + 0.9505 * bl) / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const [fx, fy, fz] = [f(X), f(Y), f(Z)];
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  };
  const A = lab(a);
  const B = lab(b);
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
}

/** A 24-slot profile from a sparse `{hour: value}` map. Gaps stay null. */
function profile(values) {
  const out = new Array(24).fill(null);
  for (const [hour, value] of Object.entries(values)) out[Number(hour)] = value;
  return out;
}

/** A flat 24-hour day at one level, so a shape can be perturbed from it. */
function flat(level) {
  return new Array(24).fill(level);
}

/**
 * A plausible Paris day, so a synthetic arc can be perturbed from something the
 * classifier would not reject on the FIRST gate.
 *
 * A genuinely flat 24-hour profile carries 5/24 = 20.8 % of its day between
 * 00 and 04 h, which is above the 15 % `nocturne` cut and well past the p95 of
 * 13.9 % measured on the real network — so a flat day IS night-heavy, and the
 * waterfall is right to say so. This base has the trough 90.6 % of the network
 * actually has: 5.2 % of the day at night, 100 véh/h from 06 h on.
 */
function day(peaks = {}) {
  const out = new Array(24).fill(100);
  for (let hour = 0; hour < 5; hour += 1) out[hour] = 20;
  out[5] = 40;
  for (const [hour, value] of Object.entries(peaks)) out[Number(hour)] = value;
  return out;
}

/** All 49 slots the cursor can be in — `mean` plus the two day-types. */
function everySlot() {
  const slots = [comptagesResolveSlot('mean')];
  for (const day of ['w', 'e']) {
    for (let hour = 0; hour < 24; hour += 1) {
      slots.push(comptagesResolveSlot(`${day}${String(hour).padStart(2, '0')}`));
    }
  }
  return slots;
}

test('the flow bands are round numbers, and they split the measured city', () => {
  // Round rather than quantile, so the same colour means the same traffic next
  // week. Measured over the 1 730 counting arcs of 2026-08-24 → 08-30 (mean
  // weekday hour: min 9.7, median 262.7, max 5 133 véh/h), these four cuts give
  // 196 / 620 / 519 / 238 / 157 — no empty band, none holding a third.
  assert.deepEqual(COMPTAGES_FLOW_THRESHOLDS, [100, 250, 500, 1000]);
  assert.equal(COMPTAGES_FLOW_COLORS.length, 5);
  assert.equal(COMPTAGES_FLOW_WIDTHS.length, 5);
  assert.deepEqual([9.7, 99, 100, 262.7, 499, 500, 999, 1000, 5133].map(comptagesFlowBin),
    [0, 0, 1, 2, 2, 3, 3, 4, 4]);
  // Width rises with the band: a hue is not readable in a hairline at 30 km.
  const widths = [...COMPTAGES_FLOW_WIDTHS];
  assert.deepEqual(widths, [...widths].sort((a, b) => a - b));
  assert.equal(new Set(widths).size, 5);
  // An arc with no count has NO band. Not band 0 — band 0 means "measured, and
  // under 100 véh/h", which is a claim about 196 real streets.
  assert.equal(comptagesFlowBin(null), null);
  assert.equal(comptagesFlowBin(NaN), null);
});

test('the rhythm wheel cannot be read as a congestion light, and nothing shares a hue', () => {
  // `traffic` and `road-status-fr` both colour a congestion RATIO green →
  // amber → red. A reader who has them on must not be handed one layer's
  // vocabulary for the other's quantity — and the defence is structural, not a
  // list: a traffic-light reading needs the GREEN, and there is none here.
  const taken = new Set(Object.values(ROAD_STATUS_LEVELS).map((level) => level.color.toLowerCase()));
  const wheel = Object.values(COMPTAGES_RHYTHM_COLORS);
  for (const color of wheel) {
    assert.equal(taken.has(color.toLowerCase()), false, `${color} is a congestion colour`);
    // Hue 75°–165° is the green sector. Nothing on the wheel may enter it.
    const hue = hueOf(color);
    assert.equal(hue > 75 && hue < 165, false, `${color} sits at ${hue.toFixed(0)}°, in the green sector`);
  }
  // Nor the five hues idfm-network already draws across Paris.
  const idfm = new Set(['#ffb03d', '#3d8bff', '#3dd6c4', '#c9d4e0', '#ff7ad9']);
  const drawn = [...wheel, COMPTAGES_OCCUPANCY_COLOR, COMPTAGES_SILENT_COLOR, COMPTAGES_HOUR_GAP_COLOR];
  for (const color of drawn) {
    assert.equal(idfm.has(color.toLowerCase()), false, `${color} collides with the transit network`);
  }
  // Every drawn colour is distinct, and none of them is the selection cyan.
  assert.equal(new Set(drawn.map((c) => c.toLowerCase())).size, drawn.length);
  assert.equal(drawn.includes('#00ffff'), false);
  // Measured separation: the closest pair of anything this layer paints is
  // dE 15.8 in CIE L*a*b*, and the closest pair of the wheel itself is 26.1.
  let closest = Infinity;
  for (let i = 0; i < drawn.length; i += 1) {
    for (let j = i + 1; j < drawn.length; j += 1) closest = Math.min(closest, deltaE(drawn[i], drawn[j]));
  }
  assert.ok(closest > 15, `closest drawn pair is ΔE ${closest.toFixed(1)}`);

  // The retired ramp is still exported for `idfmFrequency.test.mjs`, and it is
  // no longer any arc's colour. If that ever stops being true, the two layers
  // over central Paris have started sharing a vocabulary again.
  for (const color of COMPTAGES_FLOW_COLORS) {
    assert.equal(wheel.includes(color), false, `${color} is the retired flow ramp`);
  }
});

test('a silent arc is dashed and OFF both channels; a quiet measured one is neither', () => {
  // The lie this layer must not tell. 891 of 2 977 arcs published nothing for
  // 168 hours; 196 published a real count under 100 véh/h. Drawing them the
  // same way is the whole failure mode.
  const silent = comptagesArcStyle(arc('5'));
  assert.equal(silent.state, 'silent');
  assert.equal(silent.dashed, true);
  assert.equal(silent.bin, null);
  assert.equal(silent.rhythm, null, 'a silent arc has no rhythm to colour');
  assert.equal(silent.color, COMPTAGES_SILENT_COLOR);
  assert.equal(Object.values(COMPTAGES_RHYTHM_COLORS).includes(silent.color), false);

  // A quiet measured arc takes the THINNEST stroke — the count channel — and a
  // rhythm hue, which says nothing about how many vehicles there were.
  const quiet = comptagesArcStyle(arc('5201'));
  assert.equal(quiet.dashed, false);
  assert.equal(quiet.bin, 0);
  assert.equal(quiet.widthPx, COMPTAGES_FLOW_WIDTHS[0]);
  assert.equal(quiet.color, COMPTAGES_RHYTHM_COLORS.vesperal);
  assert.notEqual(quiet.color, silent.color);
  // The two share a stroke WIDTH — 2.0 px is both the bottom band and the
  // silent hairline — and that is fine, because width is not what separates
  // them: the dash and the hue are, and both differ. Asserted rather than
  // assumed, because widening the bottom band later must not be read as the
  // fix for a conflation that was never on that channel.
  assert.equal(quiet.widthPx, silent.widthPx);
  assert.notEqual(quiet.dashed, silent.dashed);

  // Occupancy without a count is measured, so it is solid — and it has no
  // position on a véh/h scale, so it is on neither channel.
  const occ = comptagesArcStyle(arc('1'));
  assert.equal(occ.state, 'occupancy');
  assert.equal(occ.dashed, false);
  assert.equal(occ.bin, null);
  assert.equal(occ.rhythm, null);
  assert.equal(occ.color, COMPTAGES_OCCUPANCY_COLOR);

  // Anything unrecognised falls to the most conservative claim available.
  assert.equal(comptagesArcStyle({}).state, 'silent');
  assert.equal(comptagesArcStyle(null).dashed, true);
  assert.deepEqual([...COMPTAGES_STATES], ['counted', 'occupancy', 'silent']);
});

test('the fixture arcs land in the bands their measured means put them in', () => {
  assert.equal(comptagesArcStyle(arc('5298')).bin, 4, '4 313 véh/h — périphérique');
  assert.equal(comptagesArcStyle(arc('5266')).bin, 4);
  assert.equal(comptagesArcStyle(arc('228')).bin, 4);
  assert.equal(comptagesArcStyle(arc('525')).bin, 2, '426 véh/h');
  assert.equal(comptagesArcStyle(arc('23')).bin, 1, '178 véh/h');
  assert.equal(comptagesArcStyle(arc('5201')).bin, 0, '23 véh/h');
  // And the width follows the band, which is now the only channel carrying it.
  for (const id of ['5298', '525', '5201']) {
    const style = comptagesArcStyle(arc(id));
    assert.equal(style.widthPx, COMPTAGES_FLOW_WIDTHS[style.bin]);
  }
});

test('the peak and the trough read a measured zero, and skip a missing hour', () => {
  // Arc 525, Bd Sébastopol: one weekday counted, hours 00–08 and 11–13, and
  // hour 13 was ZERO vehicles. The trough is that hour, not one of the eleven
  // hours nothing was published for.
  const bd = arc('525');
  assert.deepEqual(comptagesTrough(bd.wq), { hour: 13, value: 0 });
  assert.deepEqual(comptagesPeak(bd.wq), { hour: 8, value: 899 });
  assert.equal(comptagesMeasuredHours(bd.wq), 12);
  // Nothing measured at all is null on both, never hour 0.
  assert.equal(comptagesPeak(new Array(24).fill(null)), null);
  assert.equal(comptagesTrough(new Array(24).fill(null)), null);
  assert.equal(comptagesPeak(null), null);
  assert.equal(comptagesMeasuredHours(null), 0);
  // A zero-only profile is a real profile.
  assert.deepEqual(comptagesPeak([0, null, 0]), { hour: 0, value: 0 });
});

test('both sparklines share one scale, so the weekend can be read against the week', () => {
  // 696 of the 1 710 arcs that count on both day-types carry MORE vehicles per
  // hour at the weekend, and the peak hour moves on 1 434 of them. Normalising
  // each line to its own maximum would draw a Sunday that looks like a Tuesday.
  const peri = arc('5298');
  const reference = comptagesProfileReference(peri.wq, peri.eq);
  assert.equal(reference, Math.max(...peri.wq.filter(Number.isFinite), ...peri.eq.filter(Number.isFinite)));
  const weekday = comptagesDayLine({ label: 'Sem.', profile: peri.wq, reference, days: 5 });
  const weekend = comptagesDayLine({ label: 'W-E', profile: peri.eq, reference, days: 2 });
  // Both lines are drawn against the WEEKEND's 6 297, because that is the
  // higher of the two — so the weekday line tops out at 5 893/6 297 = 93.6 %.
  // That still rounds to a full block on the shared 8-step ramp, so "the
  // weekday never reaches █" is NOT the property to assert; the property is
  // that the two lines are on ONE scale, which is what makes the busier
  // weekend visible at all. Asserted directly on the peaks instead.
  assert.ok(weekend.includes('█'));
  assert.ok(Math.max(...peri.eq.filter(Number.isFinite))
    > Math.max(...peri.wq.filter(Number.isFinite)));
  // Re-normalising each line to its own maximum would put █ on BOTH peaks and
  // erase exactly that difference — the regression this test exists for.
  const selfScaled = comptagesDayLine({ label: 'Sem.', profile: peri.wq, reference: null, days: 5 });
  assert.ok(selfScaled.includes('█'));
  assert.notEqual(selfScaled.split(' ')[1], weekday.split(' ')[1]);
  assert.match(norm(weekday), /pointe 08 h · 5 893 véh\/h/);
  assert.match(norm(weekend), /pointe 18 h · 6 297 véh\/h/);
  assert.equal(comptagesProfileReference([null], [null]), null);
});

test('an unmeasured hour is a gap glyph and a measured zero is a floor bar', () => {
  // The shared `textSparkline` contract, exercised on the one fixture arc that
  // has both in the same 24 hours. 29 979 of the 71 448 weekday cells are gaps;
  // a floor bar there would claim a measurement on 42 % of the grid.
  const line = comptagesDayLine({ label: 'Sem.', profile: arc('525').wq, reference: 899, days: 5 });
  const bars = line.split(' ')[1];
  assert.equal(bars.length, 24);
  assert.equal(bars[9], '·', 'hour 09 published nothing');
  assert.equal(bars[13], '▁', 'hour 13 counted zero vehicles');
  assert.match(line, /12\/24 h mesurées/);
  // A day-type with nothing at all says so rather than drawing 24 dots.
  assert.equal(comptagesDayLine({ label: 'W-E', profile: arc('525').eq, reference: 899, days: 2 }),
    'W-E — aucune heure comptée sur 24');
  assert.equal(comptagesDayLine({ label: 'W-E', profile: null, days: 0 }), null);
});

test('the occupancy bands are the city’s own, copied not invented', () => {
  // Published verbatim on the `k` field: Fluide 0 ≤ K < 15 ; Pré-saturé 15–30 ;
  // Saturé 30–50 ; Bloqué ≥ 50. Verified against etat_trafic over all 500 136
  // rows of the week with zero counter-examples in seven probes.
  assert.deepEqual(COMPTAGES_OCCUPANCY_BANDS.map((band) => band.min), [0, 15, 30, 50]);
  assert.deepEqual([0, 14.9, 15, 29.9, 30, 49.9, 50, 97.3].map((k) => comptagesOccupancyBand(k).id),
    ['fluide', 'fluide', 'presature', 'presature', 'sature', 'sature', 'bloque', 'bloque']);
  assert.equal(comptagesOccupancyBand(null), null);
  assert.equal(comptagesOccupancyBand(-1), null);
  assert.equal(COMPTAGES_SATURATED_MIN, 30);
  // Hours at or above the city's own saturation threshold, gaps excluded.
  assert.equal(comptagesSaturatedHours([29.9, null, 30, 55]), 2);
  assert.equal(comptagesSaturatedHours(null), 0);
  // Arc 5298's measured week, verbatim: only 16 h, 17 h and 18 h reach the
  // city's own 30 % threshold (34.8, 32, 30). The 19 h reading is 29.1 and does
  // NOT count — the band is `>= 30`, and rounding it in would invent an hour of
  // saturation on a real street.
  assert.equal(comptagesSaturatedHours(arc('5298').wk), 3);
});

test('every legend label is French, names its unit, and no state is unnamed', () => {
  const labels = [0, 1, 2, 3, 4].map(comptagesFlowBandLabel);
  assert.deepEqual(labels.map(norm), [
    '< 100 véh/h', '100–250 véh/h', '250–500 véh/h', '500–1 000 véh/h', '≥ 1 000 véh/h',
  ]);
  assert.equal(comptagesFlowBandLabel(5), null);
  assert.equal(comptagesFlowBandLabel(null), null);
  for (const state of COMPTAGES_STATES) {
    assert.ok(COMPTAGES_STATE_LABELS[state], `${state} has a French label`);
    assert.equal(/\(FR\)/.test(COMPTAGES_STATE_LABELS[state]), false);
  }
  assert.equal(comptagesHourLabel(4), '04 h');
  assert.equal(comptagesHourLabel(18), '18 h');
});

test('the rhythm thresholds are round domain numbers, published and frozen', () => {
  // Rule C1. Round rather than quantile, so an arc keeps its class next week
  // and does not change colour because its neighbours did. Measured over the
  // 1 694 classifiable arcs of 2026-08-24 → 08-30, these four cuts give
  // nocturne 56 · week-end 100 · pendulaire 367 · matinal 150 · vespéral 652 ·
  // continu 369 · indéterminé 36 — no empty class.
  assert.deepEqual({ ...COMPTAGES_RHYTHM_THRESHOLDS }, {
    coverage: 20, night: 0.15, weekend: 1.15, shoulder: 1.20,
  });
  assert.equal(Object.isFrozen(COMPTAGES_RHYTHM_THRESHOLDS), true);
  assert.deepEqual({ ...COMPTAGES_RHYTHM_WINDOWS }, {
    night: [0, 4], morning: [6, 9], midday: [10, 15], evening: [16, 19],
  });
  // Seven classes, every one named in French and coloured, and the wheel holds
  // nothing that is not a declared class (B5's ceiling is 5 to 7).
  assert.equal(COMPTAGES_RHYTHM_CLASSES.length, 7);
  assert.ok(COMPTAGES_RHYTHM_CLASSES.length <= 7);
  for (const rhythm of COMPTAGES_RHYTHM_CLASSES) {
    assert.ok(COMPTAGES_RHYTHM_LABELS[rhythm], `${rhythm} has a French label`);
    assert.ok(/^#[0-9a-f]{6}$/i.test(COMPTAGES_RHYTHM_COLORS[rhythm]), `${rhythm} has a colour`);
    assert.equal(comptagesRhythmLabel(rhythm), COMPTAGES_RHYTHM_LABELS[rhythm]);
    assert.equal(comptagesRhythmColor(rhythm), COMPTAGES_RHYTHM_COLORS[rhythm]);
  }
  assert.deepEqual(Object.keys(COMPTAGES_RHYTHM_COLORS).sort(), [...COMPTAGES_RHYTHM_CLASSES].sort());
  // An unknown class gets NOTHING, never a default hue — B5's "signe explicite
  // pour non classé" is a class, not a fallback.
  assert.equal(comptagesRhythmColor('inventé'), null);
  assert.equal(comptagesRhythmLabel(undefined), null);
});

test('the waterfall is ordered, and coverage is asked before any ratio', () => {
  // The order IS the argument: which part of the week carries a street is asked
  // before the shape of its weekday, because a street that runs at 03 h has a
  // daytime shape nobody should read as a commute.
  const night = { s: 'counted', wq: day({ 0: 100, 1: 100, 2: 100, 3: 100, 4: 100 }), eq: day() };
  assert.ok(comptagesRhythmMetrics(night).nightShare >= COMPTAGES_RHYTHM_THRESHOLDS.night);
  assert.equal(comptagesRhythmClass(night), 'nocturne');
  // The same street with the trough the rest of Paris has is not nocturne.
  assert.equal(comptagesRhythmClass({ s: 'counted', wq: day(), eq: day() }), 'plateau');

  // The same arc, with 12 of 24 weekday hours published, is INDETERMINE — the
  // coverage gate fires first. This is arc 525 of the fixture, verbatim: a
  // night share of 0.376, which would otherwise be the strongest `nocturne` in
  // the pack, on 12 hours of one weekday and nothing at all at the weekend.
  const sebastopol = arc('525');
  assert.equal(comptagesMeasuredHours(sebastopol.wq), 12);
  assert.equal(comptagesMeasuredHours(sebastopol.eq), 0);
  assert.ok(comptagesRhythmMetrics(sebastopol).nightShare > COMPTAGES_RHYTHM_THRESHOLDS.night);
  assert.equal(comptagesRhythmClass(sebastopol), 'indetermine',
    'a class asserted on 12 published hours would be an invention');

  // Weekend orientation outranks the weekday shape, for the same reason.
  const busyWeekend = {
    s: 'counted',
    wq: day({ 8: 200, 18: 200 }),
    eq: day().map((value) => value * 1.3),
  };
  assert.equal(comptagesRhythmClass({ ...busyWeekend, eq: day() }), 'pendulaire',
    'the weekday shape alone would read as a commute');
  assert.ok(comptagesRhythmMetrics(busyWeekend).weekendRatio >= COMPTAGES_RHYTHM_THRESHOLDS.weekend);
  assert.equal(comptagesRhythmClass(busyWeekend), 'weekend');
});

test('the four weekday shapes fall out of the shoulder ratio, and nothing else', () => {
  const shape = (peaks) => ({ s: 'counted', wq: day(peaks), eq: day() });
  // +20 % over the midday floor in both commute windows.
  assert.equal(comptagesRhythmClass(shape({ 8: 120, 18: 120 })), 'pendulaire');
  assert.equal(comptagesRhythmClass(shape({ 8: 120 })), 'matinal');
  assert.equal(comptagesRhythmClass(shape({ 18: 120 })), 'vesperal');
  assert.equal(comptagesRhythmClass(shape({})), 'plateau');
  // The threshold is a hard `>=`, not a rounding. 119.9 is not a peak.
  assert.equal(comptagesRhythmClass(shape({ 8: 119.9, 18: 119.9 })), 'plateau');
  assert.equal(comptagesRhythmClass(shape({ 8: 120, 18: 119.9 })), 'matinal');
  // A peak OUTSIDE both windows is not a commute peak. 14 h is midday.
  assert.equal(comptagesRhythmClass(shape({ 14: 400 })), 'plateau');

  // And the fixture, which carries four of the seven classes on real streets.
  assert.equal(comptagesRhythmClass(arc('5298')), 'matinal', 'PI Haubans');
  assert.equal(comptagesRhythmClass(arc('5266')), 'plateau', 'PE Poterne');
  assert.equal(comptagesRhythmClass(arc('30')), 'weekend', 'Rivoli');
  assert.equal(comptagesRhythmClass(arc('5201')), 'vesperal', 'Av Mallarmé');
});

test('an arc with no flow profile is not on the wheel at all', () => {
  // A rhythm is computed on the count. An occupancy-only arc and a silent one
  // have no count in any hour, so they get `null` — not `indetermine`, which
  // means "counts, but too holed to classify", and not a class.
  assert.equal(comptagesRhythmClass(arc('1')), null, 'occupancy-only');
  assert.equal(comptagesRhythmClass(arc('5')), null, 'silent');
  assert.equal(comptagesRhythmMetrics(arc('5')), null);
  assert.equal(comptagesRhythmClass(null), null);
  assert.equal(comptagesRhythmClass({ s: 'counted' }), 'indetermine');
});

test('the class does not move when the cursor does', () => {
  // Rule A3, stated as a property: the hue carries the shape of the WEEK, so
  // the same arc must be the same colour in all 49 slots. If the class ever
  // started reading the slot, the two channels would be back to one variable.
  for (const id of ['5298', '5266', '228', '30', '23', '5201', '525']) {
    const row = arc(id);
    const colors = new Set(everySlot().map((slot) => comptagesArcStyle(row, slot).color));
    const rhythms = new Set(everySlot().map((slot) => comptagesArcStyle(row, slot).rhythm));
    assert.equal(rhythms.size, 1, `${id} changed rhythm class with the slot`);
    // The colour is allowed exactly one other value: the hour-gap dash, which
    // is an ABSENCE and not a class.
    for (const color of colors) {
      assert.ok(color === COMPTAGES_RHYTHM_COLORS[[...rhythms][0]] || color === COMPTAGES_HOUR_GAP_COLOR,
        `${id} took ${color} in some slot`);
    }
  }
});

test('an unmeasured hour takes its own stroke, never the bottom of the width scale', () => {
  // Rule A1 one level down. Arc 525 counts (426 véh/h on its weekday mean) and
  // publishes nothing at 18 h — the width scale has no honest value for it, so
  // it is dashed instead of drawn as "under 100 véh/h".
  const sebastopol = arc('525');
  const measured = comptagesArcStyle(sebastopol, comptagesResolveSlot('w08'));
  assert.equal(measured.gap, false);
  assert.equal(measured.dashed, false);
  assert.equal(measured.flow, sebastopol.wq[8]);

  const gap = comptagesArcStyle(sebastopol, comptagesResolveSlot('w18'));
  assert.equal(gap.gap, true);
  assert.equal(gap.dashed, true);
  assert.equal(gap.bin, null, 'no band means no claim about a count');
  assert.equal(gap.flow, null);
  assert.equal(gap.color, COMPTAGES_HOUR_GAP_COLOR);
  // And it is NOT the same absence as an arc that never measures anything.
  assert.notEqual(gap.color, COMPTAGES_SILENT_COLOR);
  assert.equal(gap.state, 'counted', 'the arc still counts — only this hour is missing');

  // A measured ZERO is not a gap. 234 rows of the week publish q = 0.
  const zeroAt = { s: 'counted', mq: 10, wq: profile({ 4: 0, 8: 300 }), eq: day() };
  const zero = comptagesArcStyle(zeroAt, comptagesResolveSlot('w04'));
  assert.equal(zero.gap, false);
  assert.equal(zero.bin, 0);
  assert.equal(zero.flow, 0);
  assert.equal(zero.dashed, false);
});

test('the occupancy and silent strokes ignore the cursor entirely', () => {
  // Neither has a count in any hour, so no slot can move them. A cursor that
  // made the 356 occupancy arcs flicker would be claiming they measure flow.
  for (const id of ['1', '5']) {
    const styles = everySlot().map((slot) => comptagesArcStyle(arc(id), slot));
    assert.equal(new Set(styles.map((s) => s.color)).size, 1);
    assert.equal(new Set(styles.map((s) => s.widthPx)).size, 1);
    assert.equal(new Set(styles.map((s) => s.dashed)).size, 1);
    assert.equal(styles.every((s) => s.bin === null && s.gap === false), true);
  }
});

test('a slot token is parsed or refused, and never clamped into a nearby hour', () => {
  assert.deepEqual(comptagesParseSlot('mean'), { kind: 'mean', day: null, hour: null, token: 'mean' });
  assert.deepEqual(comptagesParseSlot('clock'), { kind: 'clock', day: null, hour: null, token: 'clock' });
  assert.deepEqual(comptagesParseSlot('w18'), { kind: 'hour', day: 'weekday', hour: 18, token: 'w18' });
  assert.deepEqual(comptagesParseSlot('e04'), { kind: 'hour', day: 'weekend', hour: 4, token: 'e04' });
  // Nonsense is refused, not rounded — a control that silently moved the reader
  // to another hour is worse than one that did nothing.
  for (const bad of ['w24', 'e99', 'x08', 'w8', '18', '', null, undefined, 18, {}]) {
    assert.equal(comptagesParseSlot(bad), null, `${JSON.stringify(bad)} must be refused`);
  }
  assert.equal(comptagesSlotToken('weekday', 4), 'w04');
  assert.equal(comptagesSlotToken('weekend', 23), 'e23');
  assert.equal(comptagesSlotToken('weekday', 24), null);
  assert.equal(comptagesSlotToken('lundi', 8), null);
  // An unresolvable token falls back to the aggregate, which is the only slot
  // that is reproducible for two readers opening the same link.
  assert.equal(comptagesResolveSlot('w99').token, 'mean');
});

test('the clock reads Paris, and it lands in the archived week’s day-type', () => {
  // 2026-09-03 is a Thursday: 14:30 UTC is 16:30 in Paris, a weekday hour.
  const thursday = comptagesClockSlot(Date.parse('2026-09-03T14:30:00Z'));
  assert.deepEqual(thursday, { kind: 'clock', day: 'weekday', hour: 16, token: 'clock' });
  // 2026-09-05 is a Saturday: 23:30 UTC is 01:30 on Sunday in Paris. Both are
  // the weekend profile, and the hour is 1 — reading it as 23 would put Paris's
  // busiest night hour on the wrong side of midnight.
  const sunday = comptagesClockSlot(Date.parse('2026-09-05T23:30:00Z'));
  assert.deepEqual(sunday, { kind: 'clock', day: 'weekend', hour: 1, token: 'clock' });
  // Winter, to prove the offset is not a hardcoded +2.
  const january = comptagesClockSlot(Date.parse('2026-01-15T23:30:00Z'));
  assert.equal(january.hour, 0);
  assert.equal(january.day, 'weekday');
  // `clock` keeps its token so the chip stays lit, and carries the resolution.
  const resolved = comptagesResolveSlot('clock', Date.parse('2026-09-03T14:30:00Z'));
  assert.equal(resolved.token, 'clock');
  assert.equal(resolved.hour, 16);
});

test('every slot label names a typical day of an archive, never a live moment', () => {
  assert.equal(norm(comptagesSlotLabel(comptagesResolveSlot('mean'))), 'moyenne de l’heure ouvrée');
  assert.equal(comptagesSlotLabel(comptagesResolveSlot('w18')), 'jour ouvré type · 18 h');
  assert.equal(comptagesSlotLabel(comptagesResolveSlot('e04')), 'week-end type · 04 h');
  // "type" is load-bearing: `wq` is a mean over five weekdays, so naming it
  // *mardi* would name a day nobody measured.
  for (const day of Object.values(COMPTAGES_DAY_TYPE_LABELS)) assert.match(day, /type/);
  for (const slot of everySlot()) {
    const label = comptagesSlotLabel(slot);
    assert.equal(/live|direct|temps r|maintenant|now/i.test(label), false, label);
    assert.equal(/\d{1,2}:\d{2}/.test(label), false, `${label} must not carry a clock time`);
  }
  // Seven chips, one of them the clock, one of them the aggregate, all French.
  assert.equal(COMPTAGES_MOMENTS.length, 7);
  assert.equal(COMPTAGES_MOMENTS.filter((m) => m.slot === 'clock').length, 1);
  assert.equal(COMPTAGES_MOMENTS.filter((m) => m.slot === 'mean').length, 1);
  assert.equal(new Set(COMPTAGES_MOMENTS.map((m) => m.id)).size, 7);
  for (const moment of COMPTAGES_MOMENTS) {
    assert.ok(comptagesParseSlot(moment.slot), `${moment.slot} must parse`);
    assert.equal(/live|maintenant/i.test(moment.label), false, moment.label);
  }
});

test('a flow is read from the slot, and a null is a refusal rather than a zero', () => {
  const peri = arc('5298');
  assert.equal(comptagesArcFlow(peri, comptagesResolveSlot('mean')), peri.mq);
  assert.equal(comptagesArcFlow(peri, comptagesResolveSlot('w18')), peri.wq[18]);
  assert.equal(comptagesArcFlow(peri, comptagesResolveSlot('e18')), peri.eq[18]);
  assert.equal(comptagesArcFlow(peri, null), peri.mq, 'no slot means the aggregate');
  // Trap 3, one level down: 218 707 of the week's 500 136 cells carry no count,
  // and an `?? 0` here would convert every one of them into a measured zero.
  assert.equal(comptagesArcFlow(arc('525'), comptagesResolveSlot('w18')), null);
  assert.equal(comptagesArcFlow(arc('525'), comptagesResolveSlot('e12')), null);
  assert.equal(comptagesArcFlow(arc('1'), comptagesResolveSlot('w08')), null, 'occupancy has no flow');
  assert.equal(comptagesArcFlow(arc('5'), comptagesResolveSlot('w08')), null, 'silent has no flow');
});

test('the pre-built bands cover every slot an arc can reach, and nothing more', () => {
  // The renderer builds one instance per reachable band and toggles `show`, so
  // a band that is reachable but not built would leave the arc INVISIBLE at
  // that hour — a silent data loss the map could not report. Property-checked
  // over all 49 slots of every fixture arc.
  for (const row of PACK.arcs) {
    const bands = comptagesReachableBands(row);
    assert.deepEqual(bands, [...bands].sort((a, b) => a - b), `${row.a} bands are ascending`);
    assert.equal(new Set(bands).size, bands.length);
    let sawGap = false;
    for (const slot of everySlot()) {
      const style = comptagesArcStyle(row, slot);
      if (style.state !== 'counted') continue;
      if (style.gap) {
        sawGap = true;
        continue;
      }
      assert.ok(bands.includes(style.bin), `${row.a} reaches band ${style.bin} without an instance`);
    }
    assert.equal(comptagesHasHourGap(row), sawGap,
      `${row.a} disagrees about whether it ever needs the gap stroke`);
    if (row.s !== 'counted') assert.deepEqual(bands, []);
  }
  // Measured on the real pack: 1 712 placed counting arcs would need 8 560
  // instances if all five bands were built for each, and need 4 970.
  assert.deepEqual(comptagesReachableBands(arc('5201')), [0], 'Av Mallarmé never leaves band 0');
  assert.deepEqual(comptagesReachableBands(arc('228')), [2, 3, 4]);
});

test('the legend swatch is the stroke it describes, not a coloured square', () => {
  // A WIDTH channel cannot be shown by a square. `cctv.js` established the mask
  // technique; here the bar's own stroke-width is the band's own pixel width.
  for (let bin = 0; bin < COMPTAGES_FLOW_WIDTHS.length; bin += 1) {
    const glyph = comptagesFlowBandGlyph(bin);
    assert.match(glyph, /^data:image\/svg\+xml,/);
    assert.match(decodeURIComponent(glyph), new RegExp(`stroke-width="${COMPTAGES_FLOW_WIDTHS[bin].toFixed(1)}"`));
  }
  assert.equal(comptagesFlowBandGlyph(5), null);
  assert.equal(comptagesFlowBandGlyph(null), null);
  // A dashed stroke draws a dashed key, so the three absences are told apart in
  // the legend by the same signal that tells them apart on the map.
  const dashed = decodeURIComponent(comptagesStrokeGlyph({ widthPx: 2, dashLength: 14 }));
  assert.match(dashed, /stroke-dasharray/);
  assert.equal(/stroke-dasharray/.test(decodeURIComponent(comptagesStrokeGlyph({ widthPx: 2 }))), false);
});

test('a counted arc with no weekday mean is refused on the aggregate, not floored', () => {
  // A `counted` arc needs one counted hour anywhere in 168, so an arc that only
  // ever counted at the WEEKEND is `counted` with `mq === null`. Until
  // 2026-09-03 it was handed band 0 — "measured, and under 100 véh/h", which is
  // a claim about 196 real streets. It is refused instead.
  const weekendOnly = { s: 'counted', mq: null, wq: null, eq: day({ 18: 400 }) };
  const mean = comptagesArcStyle(weekendOnly, comptagesResolveSlot('mean'));
  assert.equal(mean.gap, true);
  assert.equal(mean.bin, null);
  assert.equal(mean.dashed, true);
  // It is not silent either: at a weekend hour it measures, and it draws.
  const saturday = comptagesArcStyle(weekendOnly, comptagesResolveSlot('e18'));
  assert.equal(saturday.gap, false);
  assert.equal(saturday.bin, 2, '400 véh/h');
  assert.equal(saturday.state, 'counted');
  // And the renderer is told it needs the gap stroke, or it would vanish on the
  // aggregate with nothing on screen to say why.
  assert.equal(comptagesHasHourGap(weekendOnly), true);
  assert.deepEqual(comptagesReachableBands(weekendOnly), [0, 1, 2]);
  // Its rhythm cannot be classified — no weekday profile at all.
  assert.equal(comptagesRhythmClass(weekendOnly), 'indetermine');
});
