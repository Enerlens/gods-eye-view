/**
 * @module comptagesRhythm
 *
 * How a street's DAY is read, coloured and put into words.
 *
 * `comptagesFeed.js` turns 27.7 million rows into 2 977 arcs each carrying four
 * 24-hour profiles. This module is the reading of one of those profiles, and it
 * is separate from both the feed and the renderer because the same three
 * answers have to come out identically on the server, in the card and in the
 * legend: which band an arc is in, when it fills, and when it empties.
 *
 * ── Why a WEEKDAY profile and a WEEKEND one, and not just a mean ────────────
 * Because they are different streets. Measured across the 1 710 arcs that count
 * on both day-types, in the week 2026-08-24 → 2026-08-30:
 *
 *   • The peak hour MOVES at the weekend on **1 434 of them (83.9 %)**.
 *   • The weekday peak is one spike: 18 h on 552 of 1 730 arcs (31.9 %), and
 *     970 arcs peak somewhere in 16–19 h against 407 in 07–09 h. Paris peaks in
 *     the evening on two and a half times as many arcs as in the morning.
 *   • The weekend peak is a plateau instead: 17 h on 305 arcs, 18 h on 301,
 *     19 h on 274, 16 h on 273 — no hour owns the afternoon.
 *   • And **696 of the 1 710 (40.7 %) carry MORE vehicles per hour at the
 *     weekend than on a weekday** (ratio p10 0.847, median 0.980, p90 1.114).
 *
 * A single weekly mean would have hidden every one of those. Two profiles cost
 * 0.15 MB gzipped and are what the layer is for.
 *
 * ── Where Paris empties ─────────────────────────────────────────────────────
 * The trough is far more concentrated than the peak: **1 568 of the 1 730
 * counting arcs (90.6 %) are at their quietest between 03 h and 05 h**, 883 of
 * them at 04 h exactly. That is the one hour of the week the city agrees on.
 *
 * ── The colour: a COUNT, and it must not be read as a congestion light ──────
 * `traffic.js` and `roadStatusFrance.js` both use the same green → amber → red
 * triad (`#2ecc71` / `#f0b23e` / `#e05252`) for a congestion RATIO, and
 * `idfm-network` already draws Paris in amber, rail-blue, tram-teal and pink.
 * A vehicle count is a magnitude, not a warning, so the ramp here is a single
 * indigo → magenta → rose sequence — monotonic in lightness, no traffic-light
 * reading available, and it collides with nothing already on this city.
 *
 * The thresholds are round numbers rather than quantiles, so the same colour
 * means the same traffic next week. Measured over the 1 730 counting arcs of
 * this week (mean weekday hour: min 9.7, p10 93.0, median 262.7, p90 878.3,
 * max 5 133 veh/h), 100 / 250 / 500 / 1 000 splits them **196 / 620 / 519 /
 * 238 / 157** — no empty band, no band holding a third of the city.
 *
 * ── The three states, and why a dash ────────────────────────────────────────
 * A third of this network measures nothing, and drawing it as an empty road
 * would be the one lie this layer must not tell. So the primary distinction is
 * not a hue at all, it is the STROKE:
 *
 *   counted    (1 730, 58.1 %)  solid, on the ramp, width by band.
 *   occupancy  (356, 12.0 %)    solid, one steel colour, off the ramp. The loop
 *                               reports how much of the hour the road was
 *                               occupied and never a count — that is a real
 *                               measurement in a different unit, and it has no
 *                               position on a veh/h scale.
 *   silent     (891, 29.9 %)    DASHED. 168 hours, no count and no occupancy.
 *                               The gaps in the line are the gaps in the data.
 *
 * And the silence is not uniform. Cross-tabulated against the city's own
 * `etat_barre` over the same 168 hours: **724 of the 891 (81.3 %) are declared
 * `Invalide`** — a sensor the city has already written off — 26 are `Barré`,
 * the road itself being shut, and **141 are declared `Ouvert` and still publish
 * nothing all week**. Only 10 of the 2 086 arcs that DO measure carry an
 * `Invalide`. The card names which of the three it is looking at.
 *
 * ── The occupancy bands are the CITY's, not this layer's ────────────────────
 * `k`'s own field description publishes them: *Fluide = 0 % ≤ K < 15 % ;
 * Pré-saturé = 15 % ≤ K < 30 % ; Saturé = 30 % ≤ K < 50 % ; Bloqué = 50 % ≤ K*.
 * They are reproduced here verbatim rather than invented, and they were
 * verified: over all 500 136 rows of the week, `etat_trafic` matches them with
 * **zero counter-examples** in seven separate probes.
 *
 * No Cesium and no DOM — this runs under `node --test`.
 */

import { textSparkline } from './sparkline.js';

/** The three things an arc can have done over 168 hours. */
export const COMPTAGES_STATES = Object.freeze(['counted', 'occupancy', 'silent']);

export const COMPTAGES_STATE_LABELS = Object.freeze({
  counted: 'Véhicules comptés',
  occupancy: 'Occupation seule',
  silent: 'Aucune mesure',
});

/** Upper bounds of the flow bands, in vehicles per hour. Five bands. */
export const COMPTAGES_FLOW_THRESHOLDS = Object.freeze([100, 250, 500, 1000]);

/**
 * Indigo → magenta → rose, quiet to busy. See the module header for why it is
 * not a green/amber/red ramp and not one of `idfm-network`'s four hues.
 */
export const COMPTAGES_FLOW_COLORS = Object.freeze([
  '#2c115f', '#5c1a7a', '#8f2482', '#c23a86', '#ee7ea8',
]);

/**
 * Stroke width per band, in pixels.
 *
 * Redundant with the colour on purpose: on a photorealistic globe a 2 px line
 * is read at 300 m and at 30 km, and the hue of a hairline is not reliable at
 * the far end. Width carries the same magnitude so the boulevards stay
 * boulevards when the colour stops resolving.
 */
export const COMPTAGES_FLOW_WIDTHS = Object.freeze([2.0, 2.8, 3.6, 4.6, 5.8]);

/** Occupancy-only arcs: measured, off the ramp, one flat colour. */
export const COMPTAGES_OCCUPANCY_COLOR = '#7f93ab';
export const COMPTAGES_OCCUPANCY_WIDTH = 2.6;

/** Silent arcs: dashed, thin, cold. `dashLength` is in pixels. */
export const COMPTAGES_SILENT_COLOR = '#59606e';
export const COMPTAGES_SILENT_WIDTH = 2.0;
export const COMPTAGES_SILENT_DASH_LENGTH = 14;
export const COMPTAGES_SILENT_ALPHA = 0.55;

/** Alpha for every solid stroke. Low enough to keep the tarmac readable. */
export const COMPTAGES_STROKE_ALPHA = 0.9;

/**
 * The Ville de Paris's own occupancy bands, copied verbatim from the `k` field
 * description. `min` is inclusive, the next band's `min` is the exclusive top.
 */
export const COMPTAGES_OCCUPANCY_BANDS = Object.freeze([
  Object.freeze({ id: 'fluide', min: 0, label: 'Fluide' }),
  Object.freeze({ id: 'presature', min: 15, label: 'Pré-saturé' }),
  Object.freeze({ id: 'sature', min: 30, label: 'Saturé' }),
  Object.freeze({ id: 'bloque', min: 50, label: 'Bloqué' }),
]);

/** At and above this occupancy the city calls the arc saturated. */
export const COMPTAGES_SATURATED_MIN = 30;

/** What the city says about the arc itself, keyed on `etat_barre`. */
export const COMPTAGES_BARRE_LABELS = Object.freeze({
  o: 'déclaré ouvert',
  b: 'déclaré barré',
  i: 'déclaré invalide',
});

/**
 * Band index for a mean hourly flow. `null` for an arc with no count at all —
 * NOT band 0, which means "measured, and under 100 veh/h".
 * @param {?number} flow Mean vehicles per hour.
 * @returns {?number} 0…4
 */
export function comptagesFlowBin(flow) {
  if (!Number.isFinite(flow)) return null;
  let bin = 0;
  while (bin < COMPTAGES_FLOW_THRESHOLDS.length && flow >= COMPTAGES_FLOW_THRESHOLDS[bin]) bin += 1;
  return bin;
}

/**
 * Legend labels for the five bands, in veh/h. `null` in, `null` out.
 *
 * The guard is `typeof === 'number'` and NOT a bare `Number(bin)`, because
 * `Number(null)`, `Number('')`, `Number(false)` and `Number([])` are all `0` —
 * so a coercing guard hands the caller "< 100 véh/h" for an arc that measured
 * nothing at all. That is the one conflation this module exists to prevent
 * (see `comptagesFlowBin`, which already refuses it), and it reaches the
 * legend and the card, not just an internal index.
 */
export function comptagesFlowBandLabel(bin) {
  if (typeof bin !== 'number') return null;
  const index = bin;
  if (!Number.isInteger(index) || index < 0 || index >= COMPTAGES_FLOW_COLORS.length) return null;
  const top = COMPTAGES_FLOW_THRESHOLDS;
  if (index === 0) return `< ${top[0]} véh/h`;
  if (index === top.length) return `≥ ${top[top.length - 1].toLocaleString('fr-FR')} véh/h`;
  return `${top[index - 1]}–${top[index].toLocaleString('fr-FR')} véh/h`;
}

/**
 * Stroke style for one arc.
 *
 * The one rule worth stating: an arc that measured NOTHING never receives a
 * colour from the flow ramp, not even its bottom. A silent arc and a very quiet
 * measured arc are the two things this layer exists to keep apart.
 *
 * @param {object} arc Pack row.
 * @returns {{color:string, widthPx:number, dashed:boolean, alpha:number,
 *   bin:?number, state:string}}
 */
export function comptagesArcStyle(arc) {
  const state = COMPTAGES_STATES.includes(arc?.s) ? arc.s : 'silent';
  if (state === 'silent') {
    return {
      color: COMPTAGES_SILENT_COLOR,
      widthPx: COMPTAGES_SILENT_WIDTH,
      dashed: true,
      alpha: COMPTAGES_SILENT_ALPHA,
      bin: null,
      state,
    };
  }
  if (state === 'occupancy') {
    return {
      color: COMPTAGES_OCCUPANCY_COLOR,
      widthPx: COMPTAGES_OCCUPANCY_WIDTH,
      dashed: false,
      alpha: COMPTAGES_STROKE_ALPHA,
      bin: null,
      state,
    };
  }
  // A `counted` arc with no weekday mean counted only at the weekend. It is on
  // the ramp — it has a count — and it takes the bottom band rather than being
  // demoted to a state it did not earn.
  const bin = comptagesFlowBin(arc?.mq) ?? 0;
  return {
    color: COMPTAGES_FLOW_COLORS[bin],
    widthPx: COMPTAGES_FLOW_WIDTHS[bin],
    dashed: false,
    alpha: COMPTAGES_STROKE_ALPHA,
    bin,
    state,
  };
}

/** The highest measured slot of a profile, or null when nothing was measured. */
export function comptagesPeak(profile) {
  let hour = -1;
  let value = -Infinity;
  const slots = Array.isArray(profile) ? profile : [];
  for (let i = 0; i < slots.length; i += 1) {
    if (!Number.isFinite(slots[i])) continue;
    if (slots[i] > value) {
      value = slots[i];
      hour = i;
    }
  }
  return hour < 0 ? null : { hour, value };
}

/**
 * The lowest measured slot, or null.
 *
 * Reads `Number.isFinite` and not truthiness, so a measured **0** is the
 * trough it is. 234 rows of the week publish `q = 0` against 218 707 nulls, and
 * an arc that genuinely counted nothing at 13 h has to be able to say so.
 */
export function comptagesTrough(profile) {
  let hour = -1;
  let value = Infinity;
  const slots = Array.isArray(profile) ? profile : [];
  for (let i = 0; i < slots.length; i += 1) {
    if (!Number.isFinite(slots[i])) continue;
    if (slots[i] < value) {
      value = slots[i];
      hour = i;
    }
  }
  return hour < 0 ? null : { hour, value };
}

/** How many of a profile's 24 slots carry a measurement. */
export function comptagesMeasuredHours(profile) {
  let seen = 0;
  for (const value of Array.isArray(profile) ? profile : []) {
    if (Number.isFinite(value)) seen += 1;
  }
  return seen;
}

/** The city's own band for one occupancy percentage, or null. */
export function comptagesOccupancyBand(occupancy) {
  if (!Number.isFinite(occupancy) || occupancy < 0) return null;
  let band = COMPTAGES_OCCUPANCY_BANDS[0];
  for (const candidate of COMPTAGES_OCCUPANCY_BANDS) {
    if (occupancy >= candidate.min) band = candidate;
  }
  return band;
}

/** Hours of a profile at or above the city's saturation threshold. */
export function comptagesSaturatedHours(profile) {
  let hours = 0;
  for (const value of Array.isArray(profile) ? profile : []) {
    if (Number.isFinite(value) && value >= COMPTAGES_SATURATED_MIN) hours += 1;
  }
  return hours;
}

/**
 * The top of the scale both of an arc's sparklines are drawn against.
 *
 * ONE reference for the pair, deliberately. Two 24-hour bars each normalised to
 * their own maximum would draw a Sunday that looks exactly like a Tuesday, and
 * the fact this layer is for — that 696 of 1 710 arcs are busier at the weekend
 * — would be invisible on the card that should show it.
 */
export function comptagesProfileReference(...profiles) {
  let top = 0;
  for (const profile of profiles) {
    for (const value of Array.isArray(profile) ? profile : []) {
      if (Number.isFinite(value) && value > top) top = value;
    }
  }
  return top > 0 ? top : null;
}

/** `18 h`, in the French style the rest of the packs use. */
export function comptagesHourLabel(hour) {
  return `${String(hour).padStart(2, '0')} h`;
}

/**
 * One day-type, as a line: 24 bars, then when it fills and when it empties.
 *
 * The bars come from the shared `textSparkline`, whose contract is that a gap
 * is `·` and never `▁`. That is the whole reason it is used here rather than a
 * local loop: 29 979 of the 71 448 weekday cells are gaps, and a floor bar
 * would claim a measurement on 42 % of the grid.
 *
 * @param {object} options
 * @param {string} options.label French name of the day-type.
 * @param {Array<?number>} options.profile 24 slots, hour-of-day.
 * @param {?number} [options.reference] Shared top of scale.
 * @param {number} [options.days] Days the profile is meaned over.
 * @returns {?string}
 */
export function comptagesDayLine({ label, profile, reference = null, days = 0 } = {}) {
  const measured = comptagesMeasuredHours(profile);
  if (!measured) {
    return days > 0 ? `${label} — aucune heure comptée sur 24` : null;
  }
  const bars = textSparkline(profile, reference);
  const peak = comptagesPeak(profile);
  const trough = comptagesTrough(profile);
  const parts = [`${label} ${bars}`];
  if (peak) {
    parts.push(`pointe ${comptagesHourLabel(peak.hour)} · ${Math.round(peak.value).toLocaleString('fr-FR')} véh/h`);
  }
  // Only worth printing when it is a different hour: an arc measured for one
  // hour has a peak and a trough at the same place, and saying both twice
  // reads as two facts.
  if (trough && peak && trough.hour !== peak.hour) {
    parts.push(`creux ${comptagesHourLabel(trough.hour)} · ${Math.round(trough.value).toLocaleString('fr-FR')}`);
  }
  if (measured < 24) parts.push(`${measured}/24 h mesurées`);
  return parts.join(' · ');
}
