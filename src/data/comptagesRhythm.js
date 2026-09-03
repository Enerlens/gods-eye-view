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
 * ── The colour used to be the COUNT. It is not any more ─────────────────────
 * Until 2026-09-03 the hue AND the stroke width both carried the same number —
 * the arc's mean weekday hour — and the header said so out loud: *"WIDTH
 * repeats the same band, because a hue is not readable in a hairline"*. Two
 * channels, one information, which is the defect rule A3 of `CARTOGRAPHIE.md`
 * names. The redundancy also cost the only channel this layer had left, on a
 * pack that holds 2 977 arcs x 168 hours and painted exactly one of them.
 *
 * So the two channels were split:
 *
 *   WIDTH  keeps the count. An absolute quantity belongs on a size channel
 *          (B1), the five bands below are unchanged, and the stroke is baked in
 *          world-space geometry rather than composed with `scaleByDistance`
 *          (B2). What moved is WHICH count: the width now reads the hour the
 *          reader selected, not a single weekly average.
 *   COLOUR takes the SHAPE of the week — a qualitative variable, which is what
 *          hue is for (B4), on seven classes, which is inside B5's ceiling of
 *          five to seven.
 *
 * ── The rhythm classes: what they are, and the counts they hold ─────────────
 * Computed on the 48 published hourly means of each arc (24 weekday, 24
 * weekend), by {@link comptagesRhythmClass}, in a fixed waterfall. Measured on
 * the whole week 2026-08-24 -> 2026-08-30, over the 1 730 counting arcs:
 *
 *   nocturne     56   the 00-04 core carries >= 15 % of the weekday total.
 *                     Bd de Strasbourg, Bd de Clichy - Paris's night streets,
 *                     found by the profile and not by a name list.
 *   week-end    100   the weekend hour averages >= 1.15x the weekday hour.
 *                     Quai de la Rapee, Quai de Bercy, the A6A slip.
 *   pendulaire  367   BOTH commute windows stand >= 1.20x above the midday
 *                     floor. PE Charles Hermite, PE Batignolles.
 *   matinal     150   only the 06-09 window does. PE Lagny, PE Guyane.
 *   vesperal    652   only the 16-19 window does. The largest class by far,
 *                     and that IS the finding: 970 of the 1 730 arcs peak in
 *                     16-19 h against 407 in 07-09 h.
 *   plateau     369   neither window stands out. PE Pont Amont, PI Quai d'Ivry
 *                     - the ring road, saturated from morning to night.
 *   indetermine  36   fewer than 20 of 24 hours published on either day-type.
 *                     19 of them counted on weekdays and never once at the
 *                     weekend. They are NOT given a class they did not earn
 *                     (rule A1); they keep their measured width and lose only
 *                     the hue.
 *
 * The four thresholds are ROUND NUMBERS and they are frozen (rule C1): 15 % of
 * the day at night, +15 % at the weekend, +20 % above the midday floor, 20 of
 * 24 hours of coverage. None of them is a quantile of this week, so an arc does
 * not change class because its neighbours did. For the record, the measured
 * distributions they cut: night share p50 0.082 / p95 0.139 ; weekend ratio p50
 * 0.980 / p90 1.110 ; commute shoulder p50 1.074 / p75 1.201.
 *
 * ── Why these seven hues ────────────────────────────────────────────────────
 * There is NO GREEN anywhere on the wheel, and that is the whole safety
 * argument: `traffic.js` and `roadStatusFrance.js` both paint a congestion
 * ratio green -> amber -> red, and a traffic-light reading needs the green. An
 * orange arc here cannot be read as "slowing" because nothing on the map is
 * "clear". Beyond that the wheel is a mnemonic of the HOUR rather than an
 * arbitrary set: cold cyan for the morning, deep blue for the night, violet for
 * the two peaks that mix them, orange for the evening, gold for the street that
 * is busy all day, raspberry for the weekend.
 *
 * Separation was measured, not assumed. In CIE L*a*b*, the closest pair of the
 * seven is nocturne/pendulaire at dE 26.1, and every map colour of this layer
 * (the seven, plus occupancy steel, plus the two absence greys) is at least
 * dE 15.8 from every other. Lightness runs L* 41 to 78, so the wheel survives a
 * dark tarmac and a white zebra crossing. The nearest foreign hue is
 * `idfm-network`'s rail blue at dE 18.0 from nocturne; that layer draws
 * pictograms and elevated lines, this one draws ground-clamped strokes, and
 * both publish a legend.
 *
 * ── The hour cursor ─────────────────────────────────────────────────────────
 * One average was hiding the pack. Measured over the same week: only 932 of the
 * 1 730 counting arcs (53.9 %) are in the same width band at 18 h as they are
 * on the weekly average, so the single number misfiled 798 streets. Only 124
 * arcs (7.2 %) hold one band across all 48 published slots. From 04 h to 18 h,
 * 1 562 arcs climb at least one band and not one descends.
 *
 * The cursor is a SLOT token — `mean`, `clock`, `w00`..`w23`, `e00`..`e23` —
 * parsed by {@link comptagesParseSlot} and resolved by
 * {@link comptagesResolveSlot}. It navigates an ARCHIVED typical week, never a
 * present: this feed is J-2 and its unit is the last complete Monday-Sunday
 * week, so `clock` means "the hour it is now in Paris, read in that archived
 * week", and every label says which week it read (rule E1). The word "live"
 * still appears nowhere.
 *
 * The bands the cursor moves through, measured (counted arcs, per band, plus
 * the arcs with no published measurement in that slot):
 *
 *   slot     <100  100-250  250-500  500-1k   >=1k   sans mesure
 *   mean      196     620      519     238     157        0
 *   sem 04 h 1174     398       42      74      38        4
 *   sem 08 h  142     503      580     302     199        4
 *   sem 18 h  111     329      628     432     228        2
 *   w-e 04 h  797     529      223      68      93       20
 *   w-e 18 h  110     367      622     381     222       28
 *
 * No empty band at any of them, and the 04 h collapse IS the answer to "a
 * quelle heure". The weekend night is not a quieter version of the weekday
 * night: across the counting network the 00-04 hours carry **1.60x** as many
 * vehicles per hour at the weekend as on a weekday, and 685 arcs climb a band
 * between `w04` and `e04` against 21 that drop one.
 *
 * ── An hour with no measurement is not a quiet hour ─────────────────────────
 * Rule A1 again, one level down. An arc can count all week and still publish
 * nothing in the selected slot: at most 69 of the 1 730 do (weekend 10 h), 51
 * weekday cells and 674 weekend cells out of 41 520 in all. They are NOT drawn
 * at the bottom of the width scale, and they are not drawn like the 891 arcs
 * that never measure anything either. They take a THIRD stroke — a short dash
 * in a pale grey - so the map carries three distinguishable absences: nothing
 * all week (long dash, dark), nothing in this slot (short dash, pale), and a
 * unit the scale does not speak (solid steel, occupancy only).
 *
 * ── The three states, and why a dash ────────────────────────────────────────
 * A third of this network measures nothing, and drawing it as an empty road
 * would be the one lie this layer must not tell. So the primary distinction is
 * not a hue at all, it is the STROKE:
 *
 *   counted    (1 730, 58.1 %)  solid, hue by rhythm class, width by the flow
 *                               band of the SELECTED slot — or a short pale
 *                               dash when that slot published nothing.
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
 * RETIRED. The indigo → rose ramp the hue carried until 2026-09-03, when the
 * colour channel moved to the rhythm class (see the header, rule A3).
 *
 * It is still exported for one reason: `idfmFrequency.test.mjs` — another
 * module's file — imports it to assert that the two layers drawn over central
 * Paris never share a hue. That assertion is cheap and it stays true, so the
 * constant is kept rather than breaking a test this module does not own.
 * NOTHING on the map is painted with it any more; {@link COMPTAGES_RHYTHM_COLORS}
 * is what the arcs take.
 */
export const COMPTAGES_FLOW_COLORS = Object.freeze([
  '#2c115f', '#5c1a7a', '#8f2482', '#c23a86', '#ee7ea8',
]);

/**
 * Stroke width per band, in pixels.
 *
 * This is now the ONLY channel that carries the count, which is where an
 * absolute quantity belongs (B1). The width is baked into a
 * `GroundPolylineGeometry` in world space rather than composed with a
 * `scaleByDistance`, so a busy street seen from 30 km cannot be out-drawn by a
 * quiet one seen from 300 m (B2). The five steps are unchanged from the
 * redundant era; what changed is that the band is read at the SELECTED slot
 * instead of on one weekly average, and that the hue beside it now says
 * something else.
 */
export const COMPTAGES_FLOW_WIDTHS = Object.freeze([2.0, 2.8, 3.6, 4.6, 5.8]);

/**
 * Ink for the width swatches in the legend — and NOWHERE on the map.
 *
 * The width bands are drawn on the globe in whichever rhythm hue the arc owns,
 * so their legend entry cannot borrow one of the seven without claiming that
 * band belongs to that class. A neutral bar says "this row is about thickness".
 */
export const COMPTAGES_WIDTH_INK = '#eef3f9';

/**
 * A legend swatch that IS the stroke it describes.
 *
 * The manager masks the swatch with this glyph and keeps the declared colour
 * (`manager.js` `_syncRowControls`), which is the only way a WIDTH channel and
 * a DASH channel can appear in a legend at all: two identically-sized squares
 * with captions would leave the reader to take the caption's word for it.
 * `cctv.js` established the technique for its solid/dashed cones.
 *
 * @param {object} options
 * @param {number} options.widthPx Stroke width, in the same pixels the map uses.
 * @param {?number} [options.dashLength] Dash period in pixels, or null for solid.
 * @returns {string} A `data:` URI usable as a CSS mask.
 */
export function comptagesStrokeGlyph({ widthPx, dashLength = null } = {}) {
  const width = Math.max(1, Number(widthPx) || 1);
  const dash = Number.isFinite(dashLength) && dashLength > 0
    ? ` stroke-dasharray="${(dashLength * 0.55).toFixed(1)} ${(dashLength * 0.45).toFixed(1)}"`
    : '';
  const cap = dash ? 'butt' : 'round';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">'
    + `<path d="M1 8H15" stroke="#000" stroke-width="${width.toFixed(1)}" `
    + `stroke-linecap="${cap}"${dash}/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** The legend glyph for one flow band, or null when the band does not exist. */
export function comptagesFlowBandGlyph(bin) {
  if (typeof bin !== 'number' || !Number.isInteger(bin)) return null;
  if (bin < 0 || bin >= COMPTAGES_FLOW_WIDTHS.length) return null;
  return comptagesStrokeGlyph({ widthPx: COMPTAGES_FLOW_WIDTHS[bin] });
}

/** Occupancy-only arcs: measured, off the ramp, one flat colour. */
export const COMPTAGES_OCCUPANCY_COLOR = '#7f93ab';
export const COMPTAGES_OCCUPANCY_WIDTH = 2.6;

/** Silent arcs: dashed, thin, cold. `dashLength` is in pixels. */
export const COMPTAGES_SILENT_COLOR = '#59606e';
export const COMPTAGES_SILENT_WIDTH = 2.0;
export const COMPTAGES_SILENT_DASH_LENGTH = 14;
export const COMPTAGES_SILENT_ALPHA = 0.55;

/**
 * An arc that counts, in a slot it published nothing for.
 *
 * The THIRD absence. It is not the 891 arcs that never measure — those keep the
 * dark long dash — and it must never be the bottom of the width scale, which is
 * a claim that fewer than a hundred vehicles were counted. A short pale dash
 * says "measured street, unmeasured hour": lighter than the dead loops because
 * the street is alive, dashed because nothing was published.
 *
 * At most 69 of the 1 730 counting arcs are in this state in any slot (weekend
 * 10 h); 51 weekday cells and 674 weekend cells out of 41 520 in all.
 * `mean` never produces one — a `counted` arc has a weekday mean by definition.
 */
export const COMPTAGES_HOUR_GAP_COLOR = '#aeb9c8';
export const COMPTAGES_HOUR_GAP_WIDTH = 2.0;
export const COMPTAGES_HOUR_GAP_DASH_LENGTH = 5;
export const COMPTAGES_HOUR_GAP_ALPHA = 0.7;
export const COMPTAGES_HOUR_GAP_LABEL = 'Pas de mesure à cette heure';

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

// --- The hour cursor --------------------------------------------------------

/** 24 hourly slots per day-type. Local to this module — no feed import. */
const HOURS = 24;

/** The two day-types the pack folds 168 hours into. */
export const COMPTAGES_DAY_TYPES = Object.freeze(['weekday', 'weekend']);

/**
 * French names for the two day-types.
 *
 * "type" is not decoration: `wq` is a mean over five weekdays and `eq` over two
 * weekend days, so neither is a Tuesday and neither is a Sunday. Calling them
 * *mardi* would name a day nobody measured.
 */
export const COMPTAGES_DAY_TYPE_LABELS = Object.freeze({
  weekday: 'jour ouvré type',
  weekend: 'week-end type',
});

/** The profile fields each day-type reads, flow then occupancy. */
export const COMPTAGES_DAY_TYPE_FIELDS = Object.freeze({
  weekday: Object.freeze({ flow: 'wq', occupancy: 'wk' }),
  weekend: Object.freeze({ flow: 'eq', occupancy: 'ek' }),
});

/** The aggregate slot: the arc's mean weekday hour, which is `mq`. */
export const COMPTAGES_SLOT_MEAN = 'mean';

/** The slot that follows the Paris clock into the archived week. */
export const COMPTAGES_SLOT_CLOCK = 'clock';

/** The publisher's own timezone. `clock` is read here and nowhere else. */
export const COMPTAGES_CLOCK_ZONE = 'Europe/Paris';

/**
 * The chips the panel row offers.
 *
 * Seven, the same count `idfm-frequency` settled on, but split over TWO axes
 * instead of one: this layer's whole finding is that the weekend is a different
 * street (the peak hour moves on 83.9 % of arcs, and 40.7 % carry more traffic
 * at the weekend), so giving up the day-type axis the way `idfm-frequency` gave
 * up the day would throw away the measurement.
 *
 * The four pinned hours are the ones the pack makes different, not an even
 * spread: 04 h is the trough 90.6 % of the network agrees on, 18 h is the peak
 * 970 arcs share, and the weekend pair is where the night inverts — the 00–04
 * hours carry 1.60× as many vehicles per hour at the weekend as on a weekday.
 * Midday is not a chip, and does not need to be: every card draws all 24 hours
 * of BOTH day-types as sparklines, so any hour is one click away on any arc.
 */
export const COMPTAGES_MOMENTS = Object.freeze([
  Object.freeze({ id: 'mean', slot: COMPTAGES_SLOT_MEAN, label: 'Moyenne ouvrée' }),
  Object.freeze({ id: 'clock', slot: COMPTAGES_SLOT_CLOCK, label: 'À cette heure' }),
  Object.freeze({ id: 'w04', slot: 'w04', label: 'Sem. 04 h' }),
  Object.freeze({ id: 'w08', slot: 'w08', label: 'Sem. 08 h' }),
  Object.freeze({ id: 'w18', slot: 'w18', label: 'Sem. 18 h' }),
  Object.freeze({ id: 'e04', slot: 'e04', label: 'W-E 04 h' }),
  Object.freeze({ id: 'e18', slot: 'e18', label: 'W-E 18 h' }),
]);

/** `weekday` → `w`, `weekend` → `e`. */
const DAY_TOKENS = Object.freeze({ weekday: 'w', weekend: 'e' });
const TOKEN_DAYS = Object.freeze({ w: 'weekday', e: 'weekend' });

/** `('weekday', 18)` → `'w18'`. `null` for anything unplaceable. */
export function comptagesSlotToken(day, hour) {
  const prefix = DAY_TOKENS[day];
  if (!prefix || !Number.isInteger(hour) || hour < 0 || hour >= HOURS) return null;
  return `${prefix}${String(hour).padStart(2, '0')}`;
}

/**
 * Parse a slot token, or refuse it.
 *
 * Refuses rather than clamps, for the reason `idfm-frequency` wrote down about
 * its own bands: a control that silently moved the reader to another hour
 * because a caller sent nonsense is worse than a control that did nothing.
 *
 * @param {*} token `'mean'`, `'clock'`, `'w00'`…`'w23'`, `'e00'`…`'e23'`.
 * @returns {?{kind:string, day:?string, hour:?number, token:string}}
 */
export function comptagesParseSlot(token) {
  if (token === COMPTAGES_SLOT_MEAN) {
    return { kind: 'mean', day: null, hour: null, token: COMPTAGES_SLOT_MEAN };
  }
  if (token === COMPTAGES_SLOT_CLOCK) {
    return { kind: 'clock', day: null, hour: null, token: COMPTAGES_SLOT_CLOCK };
  }
  const match = /^([we])(\d{2})$/.exec(String(token ?? ''));
  if (!match) return null;
  const hour = Number(match[2]);
  if (!Number.isInteger(hour) || hour < 0 || hour >= HOURS) return null;
  return { kind: 'hour', day: TOKEN_DAYS[match[1]], hour, token: `${match[1]}${match[2]}` };
}

/**
 * Where the Paris wall clock lands in the ARCHIVED week.
 *
 * `Europe/Paris` and not the browser's zone, for the reason `fraicheurFeed.js`
 * wrote down: an operator in Denver must not be shown the Paris night as the
 * Paris morning. `Intl.DateTimeFormat` handles the summer-time step a hand-rolled
 * `+2 h` gets wrong on the last Sunday of October.
 *
 * Saturday and Sunday read the weekend profile, Monday to Friday the weekday
 * one — the same split the feed's own two windows use, so the chip and the
 * upstream aggregation cannot disagree.
 *
 * @param {number} [nowMs] Injectable clock.
 * @returns {{kind:string, day:string, hour:number, token:string}}
 */
export function comptagesClockSlot(nowMs = Date.now()) {
  let day = 'weekday';
  let hour = 12;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: COMPTAGES_CLOCK_ZONE, weekday: 'short', hour: '2-digit', hour12: false,
    }).formatToParts(new Date(nowMs));
    const read = (type) => parts.find((part) => part.type === type)?.value ?? '';
    const weekday = read('weekday').slice(0, 3).toLowerCase();
    if (weekday === 'sat' || weekday === 'sun') day = 'weekend';
    // `hour12: false` yields 00–23 on every ICU this project ships against, but
    // some locales still emit "24" for midnight; the modulo is what makes that
    // land on hour 0 instead of falling off the profile.
    const parsed = Number(read('hour'));
    if (Number.isFinite(parsed)) hour = ((Math.trunc(parsed) % HOURS) + HOURS) % HOURS;
  } catch {
    // No Intl data is not a reason to draw nothing: fall back to the aggregate's
    // own day-type at midday, and the label still names the slot it drew.
  }
  return { kind: 'clock', day, hour, token: COMPTAGES_SLOT_CLOCK };
}

/**
 * Resolve a token into the slot the map will actually paint.
 *
 * `clock` keeps its own token — so the chip stays lit and the label can say it
 * is following the clock — but carries the resolved day-type and hour.
 *
 * @param {*} token
 * @param {number} [nowMs]
 * @returns {{kind:string, day:?string, hour:?number, token:string}}
 */
export function comptagesResolveSlot(token, nowMs = Date.now()) {
  const parsed = comptagesParseSlot(token);
  if (!parsed) return { kind: 'mean', day: null, hour: null, token: COMPTAGES_SLOT_MEAN };
  if (parsed.kind !== 'clock') return parsed;
  return comptagesClockSlot(nowMs);
}

/**
 * The slot, in words, for the row label and the card (rule E1).
 *
 * Never a date and never a time of day with minutes: this feed has no "now"
 * worth printing, and the unit is a typical hour of an archived week.
 */
export function comptagesSlotLabel(slot) {
  if (!slot || slot.kind === 'mean') return 'moyenne de l’heure ouvrée';
  const day = COMPTAGES_DAY_TYPE_LABELS[slot.day] || COMPTAGES_DAY_TYPE_LABELS.weekday;
  return `${day} · ${comptagesHourLabel(slot.hour ?? 0)}`;
}

/**
 * The vehicles-per-hour this arc publishes in one slot, or null.
 *
 * `null` is a REFUSAL, never a zero: 218 707 of the week's 500 136 cells carry
 * no count, and an arc that published nothing at 04 h has not counted zero cars
 * — nobody looked. Trap 3 of `comptagesFeed.js`, one level down.
 *
 * The `mean` slot obeys the same rule, and that is a change of behaviour worth
 * naming: a `counted` arc that only ever counted at the WEEKEND has no weekday
 * mean, and until 2026-09-03 it was given band 0 with the note "it has a count,
 * so it takes the bottom band". Band 0 says "measured, and under 100 véh/h",
 * which is a claim about 196 real streets — so such an arc is now refused on
 * this slot and takes the hour-gap dash, exactly like any other slot it did not
 * publish. None exists in the week of 2026-08-24, and the case is real.
 *
 * @param {object} arc Pack row.
 * @param {object} [slot] Resolved slot; the weekly mean when omitted.
 * @returns {?number}
 */
export function comptagesArcFlow(arc, slot = null) {
  if (arc?.s !== 'counted') return null;
  if (!slot || slot.kind === 'mean') {
    return Number.isFinite(arc.mq) ? arc.mq : null;
  }
  const field = COMPTAGES_DAY_TYPE_FIELDS[slot.day]?.flow;
  const profile = field ? arc[field] : null;
  const value = Array.isArray(profile) ? profile[slot.hour] : null;
  return Number.isFinite(value) ? value : null;
}

/** The occupancy percentage this arc publishes in one slot, or null. */
export function comptagesArcOccupancy(arc, slot = null) {
  if (!slot || slot.kind === 'mean') {
    return Number.isFinite(arc?.mk) ? arc.mk : null;
  }
  const field = COMPTAGES_DAY_TYPE_FIELDS[slot.day]?.occupancy;
  const profile = field ? arc?.[field] : null;
  const value = Array.isArray(profile) ? profile[slot.hour] : null;
  return Number.isFinite(value) ? value : null;
}

// --- The rhythm class -------------------------------------------------------

/**
 * The four windows of the clock the classifier reads, both bounds inclusive.
 *
 * They are declared once here because the card, the legend and the class all
 * have to mean the same "evening". 06–09 and 16–19 are the commute shoulders
 * this dataset actually shows (970 arcs peak inside 16–19, 407 inside 07–09);
 * 10–15 is the floor between them; 00–04 is the core of the night, which is
 * where 90.6 % of the network reaches its trough.
 */
export const COMPTAGES_RHYTHM_WINDOWS = Object.freeze({
  night: Object.freeze([0, 4]),
  morning: Object.freeze([6, 9]),
  midday: Object.freeze([10, 15]),
  evening: Object.freeze([16, 19]),
});

/**
 * The four cuts, frozen and round (rule C1).
 *
 * Round numbers and not quantiles of this week, so an arc keeps its class next
 * week and does not change colour because its neighbours did. What each one
 * cuts, measured over the 1 694 classifiable arcs of 2026-08-24 → 08-30:
 * night share p50 0.082 / p95 0.139 · weekend ratio p50 0.980 / p90 1.110 ·
 * commute shoulder p50 1.074 / p75 1.201.
 */
export const COMPTAGES_RHYTHM_THRESHOLDS = Object.freeze({
  /** Hours of 24 that must be published on EACH day-type to classify at all. */
  coverage: 20,
  /** Share of the weekday day carried by 00–04 for `nocturne`. */
  night: 0.15,
  /** Weekend hour ÷ weekday hour for `weekend`. */
  weekend: 1.15,
  /** Commute window ÷ midday floor for a shoulder to count as a peak. */
  shoulder: 1.20,
});

/**
 * The seven classes, in the order the waterfall tests them.
 *
 * `indetermine` is last because it is not a shape, it is the refusal to name
 * one — and it is reached from the top of the waterfall, not the bottom.
 */
export const COMPTAGES_RHYTHM_CLASSES = Object.freeze([
  'nocturne', 'weekend', 'pendulaire', 'matinal', 'vesperal', 'plateau', 'indetermine',
]);

/** French labels. The legend reads these verbatim. */
export const COMPTAGES_RHYTHM_LABELS = Object.freeze({
  nocturne: 'Nocturne',
  weekend: 'Week-end',
  pendulaire: 'Pendulaire',
  matinal: 'Pointe du matin',
  vesperal: 'Pointe du soir',
  plateau: 'Continu',
  indetermine: 'Rythme indéterminé',
});

/**
 * The wheel. Six hues plus one desaturated refusal — see the header for the
 * measured ΔE separations and for why there is no green anywhere on it.
 */
export const COMPTAGES_RHYTHM_COLORS = Object.freeze({
  nocturne: '#4f63d6',
  weekend: '#e04f7f',
  pendulaire: '#a763ea',
  matinal: '#5ec5e0',
  vesperal: '#f4813f',
  plateau: '#c9b83f',
  indetermine: '#9b9187',
});

/** One sentence a reader can act on, per class. Counts are the measured week. */
export const COMPTAGES_RHYTHM_BLURBS = Object.freeze({
  nocturne: 'Le cœur de nuit (00–04 h) pèse au moins 15 % de la journée ouvrée. '
    + '56 arcs sur 1 730 : Bd de Strasbourg, Bd de Clichy — trouvés par le profil, pas par une liste de noms.',
  weekend: 'L’heure moyenne du week-end vaut au moins 1,15 fois celle de la semaine. '
    + '100 arcs : quai de la Rapée, quai de Bercy, la bretelle A6a. Sur tout le réseau compté, '
    + 'les heures 00–04 portent 1,60 fois plus de véhicules le week-end qu’en semaine.',
  pendulaire: 'Les deux fenêtres domicile-travail (06–09 h et 16–19 h) dépassent d’au moins 20 % '
    + 'le creux de milieu de journée. 367 arcs, dont l’essentiel du périphérique nord.',
  matinal: 'Seule la fenêtre 06–09 h dépasse le creux de milieu de journée. 150 arcs.',
  vesperal: 'Seule la fenêtre 16–19 h le dépasse. 652 arcs — la classe la plus nombreuse, '
    + 'et c’est le fait mesuré : 970 arcs culminent entre 16 et 19 h contre 407 entre 07 et 09 h.',
  plateau: 'Aucune des deux fenêtres ne se détache : la rue est chargée du matin au soir. '
    + '369 arcs, dont le périphérique sud (Pont Amont, quai d’Ivry).',
  indetermine: 'Moins de 20 heures publiées sur 24 pour au moins un des deux types de jour : '
    + 'le rythme n’est pas calculable. 36 arcs, dont 19 qui comptent en semaine et jamais le week-end. '
    + 'Ils gardent leur largeur mesurée et perdent seulement la teinte — une classe par défaut serait une invention.',
});

/** Highest measured value inside `[from, to]`, or null. */
function windowMax(profile, [from, to]) {
  let top = null;
  for (let i = from; i <= to; i += 1) {
    const value = Array.isArray(profile) ? profile[i] : null;
    if (Number.isFinite(value) && (top === null || value > top)) top = value;
  }
  return top;
}

/** Lowest measured value inside `[from, to]`, or null. */
function windowMin(profile, [from, to]) {
  let floor = null;
  for (let i = from; i <= to; i += 1) {
    const value = Array.isArray(profile) ? profile[i] : null;
    if (Number.isFinite(value) && (floor === null || value < floor)) floor = value;
  }
  return floor;
}

/** Sum of the measured values inside `[from, to]`. */
function windowSum(profile, [from, to]) {
  let total = 0;
  for (let i = from; i <= to; i += 1) {
    const value = Array.isArray(profile) ? profile[i] : null;
    if (Number.isFinite(value)) total += value;
  }
  return total;
}

/**
 * The five numbers the class is decided on, or null when the arc has no flow.
 *
 * Exported so the card can print WHY an arc is in its class rather than asking
 * the reader to trust a hue, and so the test can assert the waterfall against
 * numbers instead of against itself.
 *
 * @param {object} arc Pack row.
 * @returns {?{weekdayHours:number, weekendHours:number, nightShare:?number,
 *   weekendRatio:?number, morningShoulder:?number, eveningShoulder:?number}}
 */
export function comptagesRhythmMetrics(arc) {
  if (arc?.s !== 'counted') return null;
  const weekday = Array.isArray(arc.wq) ? arc.wq : null;
  const weekend = Array.isArray(arc.eq) ? arc.eq : null;
  const weekdayHours = comptagesMeasuredHours(weekday);
  const weekendHours = comptagesMeasuredHours(weekend);
  const dayTotal = windowSum(weekday, [0, HOURS - 1]);
  const weekdayMean = comptagesProfileMeanLocal(weekday);
  const weekendMean = comptagesProfileMeanLocal(weekend);
  const midday = windowMin(weekday, COMPTAGES_RHYTHM_WINDOWS.midday);
  const morning = windowMax(weekday, COMPTAGES_RHYTHM_WINDOWS.morning);
  const evening = windowMax(weekday, COMPTAGES_RHYTHM_WINDOWS.evening);
  return {
    weekdayHours,
    weekendHours,
    nightShare: dayTotal > 0
      ? windowSum(weekday, COMPTAGES_RHYTHM_WINDOWS.night) / dayTotal
      : null,
    weekendRatio: weekdayMean > 0 && weekendMean !== null ? weekendMean / weekdayMean : null,
    morningShoulder: midday > 0 && morning !== null ? morning / midday : null,
    eveningShoulder: midday > 0 && evening !== null ? evening / midday : null,
  };
}

/** Mean of the measured slots, or null. Local twin of the feed's own. */
function comptagesProfileMeanLocal(profile) {
  let sum = 0;
  let seen = 0;
  for (const value of Array.isArray(profile) ? profile : []) {
    if (!Number.isFinite(value)) continue;
    sum += value;
    seen += 1;
  }
  return seen ? sum / seen : null;
}

/**
 * The rhythm class of one arc, decided on its 48 published hourly means.
 *
 * A WATERFALL, and the order is the argument: the two classes that describe
 * WHICH part of the week carries the street (`nocturne`, `weekend`) are asked
 * before the three that describe the SHAPE of its weekday, because a street
 * whose traffic is mostly at 03 h has a weekday shape nobody should be reading
 * as a commute. Ties therefore cannot happen and the class is a pure function
 * of the pack — the same arc gets the same colour on the server, in the card
 * and in the legend.
 *
 * Returns `null` for an arc that is not `counted`: an occupancy-only or silent
 * arc has no flow profile at all, so it is not on the wheel and takes its own
 * stroke instead (see {@link comptagesArcStyle}).
 *
 * @param {object} arc Pack row.
 * @returns {?string} One of {@link COMPTAGES_RHYTHM_CLASSES}, or null.
 */
export function comptagesRhythmClass(arc) {
  const metrics = comptagesRhythmMetrics(arc);
  if (!metrics) return null;
  const T = COMPTAGES_RHYTHM_THRESHOLDS;
  // Coverage first. Below it every ratio below would be computed over hours
  // nobody published, and a class asserted on those is an invention (rule A1).
  if (metrics.weekdayHours < T.coverage || metrics.weekendHours < T.coverage) return 'indetermine';
  if (metrics.nightShare === null) return 'indetermine';
  if (metrics.nightShare >= T.night) return 'nocturne';
  if (metrics.weekendRatio === null) return 'indetermine';
  if (metrics.weekendRatio >= T.weekend) return 'weekend';
  if (metrics.morningShoulder === null || metrics.eveningShoulder === null) return 'indetermine';
  const morning = metrics.morningShoulder >= T.shoulder;
  const evening = metrics.eveningShoulder >= T.shoulder;
  if (morning && evening) return 'pendulaire';
  if (morning) return 'matinal';
  if (evening) return 'vesperal';
  return 'plateau';
}

/**
 * Every width band this arc can ever take, across `mean` and the 48 slots.
 *
 * This exists for the renderer, and it is what makes the cursor free. A stroke
 * width is baked into `GroundPolylineGeometry` and cannot be changed on a built
 * batch — only `color` and `show` can — so moving the cursor without rebuilding
 * geometry means holding one instance per band an arc can reach and toggling
 * `show`. Building all five for every arc would be 8 560 instances on the
 * measured pack; building only the reachable ones is **4 970 (58.1 %)**,
 * because 124 of the 1 712 placed counting arcs never leave one band and only
 * 13 visit all five. The saving is exact, not heuristic: the set of slots is
 * finite and closed.
 *
 * @param {object} arc Pack row.
 * @returns {Array<number>} Ascending band indices; empty when the arc has none.
 */
export function comptagesReachableBands(arc) {
  if (arc?.s !== 'counted') return [];
  const seen = new Set();
  const add = (value) => {
    if (!Number.isFinite(value)) return;
    seen.add(comptagesFlowBin(value) ?? 0);
  };
  add(arc.mq);
  for (const field of ['wq', 'eq']) {
    for (const value of Array.isArray(arc[field]) ? arc[field] : []) add(value);
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * Whether any slot of this arc's week published no count at all.
 *
 * 83 of the 1 712 placed counting arcs, so the "measured street, unmeasured
 * hour" stroke only needs geometry for those — the other 1 629 can never enter
 * that state and are not given an instance in that batch.
 */
export function comptagesHasHourGap(arc) {
  if (arc?.s !== 'counted') return false;
  return comptagesMeasuredHours(arc.wq) < HOURS || comptagesMeasuredHours(arc.eq) < HOURS;
}

/** French label for a class id, or null. */
export function comptagesRhythmLabel(rhythm) {
  return COMPTAGES_RHYTHM_LABELS[rhythm] || null;
}

/** Wheel colour for a class id, or null. Never a default hue. */
export function comptagesRhythmColor(rhythm) {
  return COMPTAGES_RHYTHM_COLORS[rhythm] || null;
}

/**
 * Stroke style for one arc, at one slot.
 *
 * Two rules are enforced here and both are rule A1:
 *
 *  1. An arc that measured NOTHING all week never receives a rhythm hue and
 *     never receives a width from the flow scale. It is dashed, dark, off both
 *     channels.
 *  2. An arc that counts but published nothing IN THIS SLOT never receives the
 *     bottom of the width scale either — that band means "measured, and under
 *     100 véh/h", which is a claim about 196 real streets. It takes the short
 *     pale dash instead.
 *
 * @param {object} arc Pack row.
 * @param {object} [slot] Resolved slot. The weekly mean when omitted.
 * @returns {{color:string, widthPx:number, dashed:boolean, alpha:number,
 *   bin:?number, state:string, rhythm:?string, gap:boolean, flow:?number}}
 */
export function comptagesArcStyle(arc, slot = null) {
  const state = COMPTAGES_STATES.includes(arc?.s) ? arc.s : 'silent';
  if (state === 'silent') {
    return {
      color: COMPTAGES_SILENT_COLOR,
      widthPx: COMPTAGES_SILENT_WIDTH,
      dashed: true,
      alpha: COMPTAGES_SILENT_ALPHA,
      bin: null,
      state,
      rhythm: null,
      gap: false,
      flow: null,
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
      rhythm: null,
      gap: false,
      flow: null,
    };
  }
  const rhythm = comptagesRhythmClass(arc) || 'indetermine';
  const flow = comptagesArcFlow(arc, slot);
  if (flow === null) {
    return {
      color: COMPTAGES_HOUR_GAP_COLOR,
      widthPx: COMPTAGES_HOUR_GAP_WIDTH,
      dashed: true,
      alpha: COMPTAGES_HOUR_GAP_ALPHA,
      bin: null,
      state,
      rhythm,
      gap: true,
      flow: null,
    };
  }
  const bin = comptagesFlowBin(flow) ?? 0;
  return {
    color: COMPTAGES_RHYTHM_COLORS[rhythm],
    widthPx: COMPTAGES_FLOW_WIDTHS[bin],
    dashed: false,
    alpha: COMPTAGES_STROKE_ALPHA,
    bin,
    state,
    rhythm,
    gap: false,
    flow,
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
