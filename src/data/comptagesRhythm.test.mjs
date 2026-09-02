// What a street's day is allowed to look like, and what a colour is allowed to
// claim about it.
//
// One property runs through all of it: the scale for MEASURED LOAD and the mark
// for NO MEASUREMENT are never the same channel. A silent arc cannot reach the
// bottom of the flow ramp, an unmeasured hour cannot reach the bottom of the
// sparkline, and an occupancy — a real number in a unit the ramp does not speak
// — cannot be placed on it at all. The second property is that the weekday and
// weekend pictures stay comparable, because 696 of 1 710 counting arcs are
// BUSIER at the weekend and two independently-normalised sparklines would hide
// every one of them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  COMPTAGES_FLOW_COLORS,
  COMPTAGES_FLOW_THRESHOLDS,
  COMPTAGES_FLOW_WIDTHS,
  COMPTAGES_OCCUPANCY_BANDS,
  COMPTAGES_OCCUPANCY_COLOR,
  COMPTAGES_SATURATED_MIN,
  COMPTAGES_SILENT_COLOR,
  COMPTAGES_STATES,
  COMPTAGES_STATE_LABELS,
  comptagesArcStyle,
  comptagesDayLine,
  comptagesFlowBandLabel,
  comptagesFlowBin,
  comptagesHourLabel,
  comptagesMeasuredHours,
  comptagesOccupancyBand,
  comptagesPeak,
  comptagesProfileReference,
  comptagesSaturatedHours,
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

test('the ramp is not the congestion palette either road layer already uses', () => {
  // `traffic` and `road-status-fr` both colour a congestion RATIO green →
  // amber → red. This layer colours a COUNT. A reader who has both on must not
  // be handed one layer's vocabulary for the other's quantity.
  const taken = new Set(Object.values(ROAD_STATUS_LEVELS).map((level) => level.color.toLowerCase()));
  for (const color of COMPTAGES_FLOW_COLORS) {
    assert.equal(taken.has(color.toLowerCase()), false, `${color} is a congestion colour`);
  }
  // Nor the four hues idfm-network already draws across Paris.
  const idfm = new Set(['#ffb03d', '#3d8bff', '#3dd6c4', '#c9d4e0', '#ff7ad9']);
  for (const color of [...COMPTAGES_FLOW_COLORS, COMPTAGES_OCCUPANCY_COLOR, COMPTAGES_SILENT_COLOR]) {
    assert.equal(idfm.has(color.toLowerCase()), false, `${color} collides with the transit network`);
  }
  // Every band colour is distinct, and none of them is the selection cyan.
  assert.equal(new Set(COMPTAGES_FLOW_COLORS).size, 5);
  assert.equal(COMPTAGES_FLOW_COLORS.includes('#00ffff'), false);
});

test('a silent arc is dashed and OFF the ramp; a quiet measured one is neither', () => {
  // The lie this layer must not tell. 891 of 2 977 arcs published nothing for
  // 168 hours; 196 published a real count under 100 véh/h. Drawing them the
  // same way is the whole failure mode.
  const silent = comptagesArcStyle(arc('5'));
  assert.equal(silent.state, 'silent');
  assert.equal(silent.dashed, true);
  assert.equal(silent.bin, null);
  assert.equal(silent.color, COMPTAGES_SILENT_COLOR);
  assert.equal(COMPTAGES_FLOW_COLORS.includes(silent.color), false);

  const quiet = comptagesArcStyle({ s: 'counted', mq: 23 });
  assert.equal(quiet.dashed, false);
  assert.equal(quiet.bin, 0);
  assert.equal(quiet.color, COMPTAGES_FLOW_COLORS[0]);
  assert.notEqual(quiet.color, silent.color);

  // Occupancy without a count is measured, so it is solid — and it has no
  // position on a véh/h scale, so it is not on the ramp.
  const occ = comptagesArcStyle(arc('1'));
  assert.equal(occ.state, 'occupancy');
  assert.equal(occ.dashed, false);
  assert.equal(occ.bin, null);
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
