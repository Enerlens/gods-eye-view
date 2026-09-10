/*
 * MEGAFIRE CLOCK — the cursor the Gironde reconstruction is read along.
 *
 * Pure: no Cesium, no DOM, no timers. The layer owns the tick and hands this
 * module a delta in seconds; this module owns what the cursor MEANS. That split
 * exists so the awkward half — what happens at the ends, what a step chip does
 * to playback, what "before the first frame" looks like — is unit-testable
 * without a viewer.
 *
 * ── WHY A CURSOR AND NOT FIVE BUTTONS ───────────────────────────────────────
 *
 * `docs/REPRESENTATION.md` (Piste 3) states the repo's own indictment: "le
 * temps n'est jamais sur la carte", with `idfm-network` as the single
 * exception and its hour chips as the mechanism to reuse. Chips alone would
 * have worked here — there are only five satellite frames — and they would have
 * been a worse answer, because the interesting quantity is not WHICH frame but
 * HOW FAST the gap between two of them was crossed. Between the frames of
 * 24 July 09:05 and 26 July 10:12 the fire took 19 082 hectares; a reader
 * pressing two buttons sees two numbers, a reader watching a cursor sees a
 * rate. The 9 524 FIRMS detections are what fills that gap, and they only mean
 * anything against a moving instant.
 *
 * So both are here: five chips that JUMP to a measured frame, and a cursor that
 * runs between them.
 *
 * ── THE ONE RULE THE DATA IMPOSES ───────────────────────────────────────────
 *
 * A perimeter is what a satellite SAW at an hour. It becomes true at its
 * acquisition instant and stays true until the next frame replaces it — it is
 * never interpolated. Tweening between two perimeters would invent hectares
 * nobody photographed, and the two-day gap in the middle of this event is
 * exactly where the invention would be largest and most convincing. The
 * hotspots interpolate nothing either: a detection exists at its acquisition
 * minute and not before.
 *
 * That is why {@link megafireClockState} returns `stepIndex` as a plain lookup
 * and never a fraction.
 */

import { MEGAFIRE_STEPS, megafireStepAt } from './megafirePack.js';

/**
 * @constant {number} How long one playthrough of the window takes, in seconds.
 *
 * The window is 10 days 0 h 49 min. At 24 s that is ~36 000× real time, which
 * puts the 24 July run — the day that took 3 775 detections — at about three
 * seconds of screen time. Slower and the four quiet days at the end are dead
 * air; faster and the run is a flash.
 */
export const MEGAFIRE_PLAY_SECONDS = 24;

/**
 * @constant {number} Hotspot fade horizon, in hours of event time.
 *
 * A detection is drawn at full strength for this long after its acquisition,
 * then decays to {@link MEGAFIRE_EMBER_FLOOR}. Six hours is roughly two VIIRS
 * revisits: long enough that a pixel does not blink out between passes of the
 * same satellite, short enough that the bright band reads as a FRONT rather
 * than as the whole burn scar.
 */
export const MEGAFIRE_FADE_HOURS = 6;

/**
 * @constant {number} What an old detection fades TO, rather than off.
 *
 * Never zero. A detection that vanished would tell a reader the ground stopped
 * having burned, and the accumulated field of embers IS the record of where the
 * fire has been — it is the only thing on screen between two satellite frames.
 */
export const MEGAFIRE_EMBER_FLOOR = 0.18;

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Create a cursor over the event window.
 *
 * @param {object} options
 * @param {number} options.startMs - Window open, epoch ms.
 * @param {number} options.endMs - Window close, epoch ms.
 * @param {number} [options.playSeconds] - Seconds for one full playthrough.
 * @returns {{startMs: number, endMs: number, playSeconds: number,
 *   cursorMs: number, playing: boolean}}
 */
export function createMegafireClock({ startMs, endMs, playSeconds = MEGAFIRE_PLAY_SECONDS }) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new RangeError('megafire clock needs a positive window');
  }
  return {
    startMs,
    endMs,
    playSeconds,
    // Opens on the LAST frame, not the first. A reader who switches the layer
    // on and never touches a chip must see the finished fire — the state that
    // is still true today — rather than an empty forest waiting to be played.
    cursorMs: endMs,
    playing: false,
  };
}

/**
 * Advance a playing cursor by a wall-clock delta.
 *
 * Stops at the end rather than looping: a loop would restart the fire behind a
 * reader who looked away, and this event has an end. `dtSec` is clamped so a
 * backgrounded tab that returns after a minute does not jump the whole window
 * in one frame.
 *
 * @param {ReturnType<createMegafireClock>} clock - Mutated in place.
 * @param {number} dtSec - Seconds of wall clock since the last call.
 * @returns {boolean} True when the cursor moved.
 */
export function advanceMegafireClock(clock, dtSec) {
  if (!clock?.playing) return false;
  const dt = Math.min(0.25, Math.max(0, Number(dtSec) || 0));
  if (dt <= 0) return false;
  const span = clock.endMs - clock.startMs;
  const next = clock.cursorMs + (dt / clock.playSeconds) * span;
  if (next >= clock.endMs) {
    const moved = clock.cursorMs !== clock.endMs;
    clock.cursorMs = clock.endMs;
    clock.playing = false;
    return moved;
  }
  clock.cursorMs = next;
  return true;
}

/**
 * Start, stop, or restart playback.
 *
 * Pressing play at the end REWINDS, because that is the only thing the gesture
 * could mean there — the alternative is a button that does nothing on the state
 * the layer opens in.
 *
 * @param {ReturnType<createMegafireClock>} clock - Mutated in place.
 * @param {boolean} [play] - Force a state; omit to toggle.
 * @returns {boolean} The resulting `playing`.
 */
export function setMegafirePlaying(clock, play) {
  if (!clock) return false;
  const next = play === undefined ? !clock.playing : Boolean(play);
  if (next && clock.cursorMs >= clock.endMs) clock.cursorMs = clock.startMs;
  clock.playing = next;
  return clock.playing;
}

/**
 * Move the cursor to an instant, clamped to the window, and stop playback.
 *
 * Seeking always pauses: a chip that moved the cursor and let it immediately
 * drift off the frame the reader asked for would make the five measured
 * instants unreachable.
 *
 * @param {ReturnType<createMegafireClock>} clock - Mutated in place.
 * @param {number} instantMs
 * @returns {number} The clamped cursor.
 */
export function seekMegafireClock(clock, instantMs) {
  if (!clock) return NaN;
  const value = Number(instantMs);
  if (!Number.isFinite(value)) return clock.cursorMs;
  clock.cursorMs = Math.min(clock.endMs, Math.max(clock.startMs, value));
  clock.playing = false;
  return clock.cursorMs;
}

/**
 * Everything the renderer needs for one instant, derived and never stored.
 *
 * @param {ReturnType<createMegafireClock>} clock
 * @param {ReadonlyArray<{acq: string}>} [steps] - Defaults to {@link MEGAFIRE_STEPS}.
 * @returns {{cursorMs: number, progress: number, stepIndex: ?number,
 *   playing: boolean, atEnd: boolean, atStart: boolean, day: number,
 *   days: number}}
 */
export function megafireClockState(clock, steps = MEGAFIRE_STEPS) {
  const span = clock.endMs - clock.startMs;
  const progress = span > 0 ? (clock.cursorMs - clock.startMs) / span : 1;
  const days = megafireWindowDays(clock);
  return {
    cursorMs: clock.cursorMs,
    progress,
    stepIndex: megafireStepAt(clock.cursorMs, steps),
    playing: Boolean(clock.playing),
    atEnd: clock.cursorMs >= clock.endMs,
    // `atStart` is not `!atEnd`. Three states have to be told apart on one
    // button — never played, stopped halfway, finished — because the gesture
    // means something different in each, and a play control that reads the
    // same in all three is the defect this window was reported with.
    atStart: clock.cursorMs <= clock.startMs,
    day: Math.min(days, Math.floor((clock.cursorMs - clock.startMs) / DAY_MS) + 1),
    days,
  };
}

/**
 * Whole days spanned by the window. 10 for the shipped pack.
 *
 * ROUNDED, not ceiled: 22 July 11:55 to 1 August 12:44 is ten days and
 * forty-nine minutes, and "jour 4 sur 11" for a fire everything else in this
 * layer calls a ten-day event would be a denominator the reader has to
 * reconcile. The last day absorbs the remainder instead, which is what
 * {@link megafireClockState} clamps `day` for.
 * @param {{startMs: number, endMs: number}} clock
 * @returns {number} Days, at least 1.
 */
export function megafireWindowDays(clock) {
  const span = (clock?.endMs ?? 0) - (clock?.startMs ?? 0);
  return Math.max(1, Math.round(span / DAY_MS));
}

/**
 * The one line that says where the cursor is — the instant, the day, and
 * whether anything is moving.
 *
 * WHY THIS EXISTS. The layer shipped with the cursor readable in exactly two
 * places: a chip tooltip, and a `getStats()` field nothing rendered. Pressing
 * play therefore ran ten days of fire past a reader with no clock anywhere on
 * screen, and the reported symptom was the honest one — "I do not know where I
 * am". An instant alone would not have fixed it either: `26 juil. 04:12 UTC` is
 * only meaningful to somebody who already knows the window runs from the 22nd
 * to the 1st, which is precisely what a first-time reader does not know. So the
 * line carries the position IN the window as well.
 *
 * WHAT THE TWO ENDS ARE ALLOWED TO CLAIM. They read `première détection` and
 * `dernière détection`, not `départ de l'incendie` and `fin de l'événement`,
 * because neither bound is an event — both are EFFIS's FIREDATE and FINALDATE,
 * the first and last instants an algorithm saw this ground burn. The fire was
 * reported to the COGIC six hours AFTER 22 July 11:55, and it was declared
 * fixed days AFTER 1 August 12:44 by a préfecture communiqué that is prose in a
 * press release: no dataset, no API, and two different words — "fixé", then
 * "éteint" — that a peat fire can put weeks apart. Naming a detection after an
 * event would be the one claim in this layer no reader could go and check.
 *
 * @param {ReturnType<createMegafireClock>} clock
 * @param {ReturnType<megafireClockState>} state
 * @returns {string} e.g. `▶ 26 juil. 04:12 UTC · jour 4 sur 10`.
 */
export function megafireCursorReadout(clock, state) {
  const instant = megafireCursorLabel(state.cursorMs);
  if (state.playing) return `▶ ${instant} · jour ${state.day} sur ${state.days}`;
  if (state.atEnd) return `■ ${instant} · dernière détection`;
  if (state.atStart) return `▶ ${instant} · première détection`;
  return `❚❚ ${instant} · jour ${state.day} sur ${state.days}`;
}

/**
 * How brightly a detection acquired at `detectionMs` burns at `cursorMs`.
 *
 * Linear decay over {@link MEGAFIRE_FADE_HOURS} down to
 * {@link MEGAFIRE_EMBER_FLOOR}, and exactly 0 for a detection the cursor has
 * not reached — the future is not dim, it is absent.
 *
 * @param {number} detectionMs
 * @param {number} cursorMs
 * @returns {number} 0, or a strength in [{@link MEGAFIRE_EMBER_FLOOR}, 1].
 */
export function megafireEmberStrength(detectionMs, cursorMs) {
  if (!Number.isFinite(detectionMs) || !Number.isFinite(cursorMs)) return 0;
  const age = cursorMs - detectionMs;
  if (age < 0) return 0;
  const horizon = MEGAFIRE_FADE_HOURS * HOUR_MS;
  if (age >= horizon) return MEGAFIRE_EMBER_FLOOR;
  const fresh = 1 - age / horizon;
  return MEGAFIRE_EMBER_FLOOR + fresh * (1 - MEGAFIRE_EMBER_FLOOR);
}

/**
 * A short French label for the cursor, in UTC.
 *
 * UTC and not Europe/Paris, even though the fire is French and the reader
 * probably is too. Every instant in this pack is a satellite acquisition or a
 * VIIRS granule, and both are published in UTC; converting for display would
 * mean the hour on the card no longer matches the hour in `event.json`, in the
 * Copernicus product name, or in anything a reader could go and check.
 *
 * @param {number} instantMs
 * @returns {string} e.g. `24 juil. 09:05 UTC`.
 */
export function megafireCursorLabel(instantMs) {
  if (!Number.isFinite(instantMs)) return '—';
  const date = new Date(instantMs);
  const day = date.getUTCDate();
  const month = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
    'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'][date.getUTCMonth()];
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  return `${day === 1 ? '1ᵉʳ' : day} ${month} ${hh}:${mm} UTC`;
}
