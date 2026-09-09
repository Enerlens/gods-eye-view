/**
 * @module data/weekHourCursor
 *
 * **L'heure de la semaine type, une seule fois pour toute la carte.**
 *
 * ── The problem, counted ────────────────────────────────────────────────────
 *
 * Three layers in this repository draw an ARCHIVED TYPICAL WEEK rather than a
 * live measurement, and until this module each owned its own hour:
 *
 *   · `comptages-fr`   — 2 977 Paris loop arcs × 168 hours, folded by the
 *     publisher into two day-types (`comptagesRhythm.js`);
 *   · `velo-pulse-fr`  — 561 docking stations × 168 hours, Paris and Lyon;
 *   · `idfm-frequency` — 36 502 Île-de-France stops × 7 days × 24 bands.
 *
 * They live on THREE DIFFERENT ROWS of the panel after the 2026-09 fusion —
 * *Trafic routier*, *Vélos et véhicules partagés*, *Transports en commun* — so
 * two of them on screen at once is the normal case, and until now that case
 * drew **two different hours of the week side by side**. A reader comparing
 * the morning peak on the roads with the morning peak on the métro was, in
 * fact, comparing 08 h with whatever hour it happened to be. The map was not
 * wrong on either row; it was wrong BETWEEN them, which is the failure mode a
 * juxtaposition has and a single layer does not.
 *
 * ── What the audit thought the obstacle was, and what it actually is ────────
 *
 * `docs/PLAN-CROISEMENTS.md` recorded this as blocked on the share grammar:
 * *"les trois encodent aujourd'hui leur heure séparément et des liens déjà
 * envoyés en dépendent"*. That turned out to be false, and checking it is what
 * made the module small. In `layerState.js`, `comptages-fr` (`cr`) and
 * `idfm-frequency` (`fq`) are both `enabled-only` — **neither has ever put its
 * hour in a link** — and `velo-pulse-fr` (`vp`) encodes a three-value MODE
 * enum (`now` / `week` / `peak`), not an hour. So no link in the wild carries
 * an hour of the week, and there is nothing to stay compatible with.
 *
 * The decision the audit asked for is therefore the opposite of what it
 * expected: **one shared token, not three**. `wh` (below) is the first share
 * key that can express "Paris, mardi 8 h", and it belongs to the cursor rather
 * than to any layer, because the thing being shared is an hour of a typical
 * week and not a property of the roads or of the bicycles.
 *
 * ── The vocabulary, and why this module owns the translation ────────────────
 *
 * The canonical cursor is `{day, hour}`, `day` 0–6 with **Monday = 0** and
 * `hour` 0–23. Monday-first because two of the three consumers already are:
 * `IDFM_FREQ_DAYS` starts at `lundi` and `veloPulseFeed.slotForDate` returns
 * `day * 24 + hour` on the same origin. `comptages-fr` is the one that is not
 * a real day at all.
 *
 * Each layer speaks its own dialect and NONE of them imports another:
 *
 *   | layer            | its own unit           | lossless? |
 *   |------------------|------------------------|-----------|
 *   | `velo-pulse-fr`  | slot 0–167             | yes       |
 *   | `idfm-frequency` | (day name, band 4–27)  | yes       |
 *   | `comptages-fr`   | (day-TYPE, hour)       | no — see below |
 *
 * **The lossy edge is named rather than hidden.** `comptages-fr` publishes a
 * mean over five weekdays and a mean over two weekend days; neither is a
 * Tuesday and neither is a Sunday, which is why that layer calls them *jour
 * ouvré type* and *week-end type*. So the cursor → comptages direction is
 * exact (Monday–Friday is the weekday profile, Saturday–Sunday the weekend
 * one) and the comptages → cursor direction has to CHOOSE a day the layer
 * never measured. It chooses by keeping the day already on the cursor when
 * that day is on the right side of the split, and only otherwise falls back to
 * {@link WEEK_HOUR_REPRESENTATIVE_DAYS}. Pressing *Sem. 08 h* while the cursor
 * sits on Wednesday therefore leaves it on Wednesday, and the other two layers
 * do not silently jump to Tuesday for a click that said nothing about the day.
 *
 * ── What this is NOT ────────────────────────────────────────────────────────
 *
 * Not a clock (nothing here ticks, and `null` means "no reader has pinned an
 * hour" — every layer keeps its own live default), not an event bus (one key,
 * no ordering, no replay), and not a way to enable a layer: a subscriber that
 * is off hears nothing and reads the cursor when it comes on.
 *
 * Pure and module-scoped: no fetch, no DOM, no Cesium, node-testable.
 */

/** Hours in a week. The unit every consumer folds down to. */
export const WEEK_HOUR_SLOTS = 168;

/** Day names, Monday-first, matching `IDFM_FREQ_DAYS` exactly. */
export const WEEK_HOUR_DAYS = Object.freeze([
  'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche',
]);

/**
 * The day a DAY-TYPE falls back to when nothing better is known.
 *
 * Only reached when `comptages-fr` moves the cursor from a day-type chip while
 * the cursor sits on the other side of the weekday/weekend split (or is unset).
 * Tuesday and Saturday, and the choice is the one the rest of the repository
 * already made: `idfmFrequencyFeed.operatingSlot` defaults to weekday index 2
 * (Tuesday) and every measurement in that layer's header is quoted "on an
 * average Tuesday".
 */
export const WEEK_HOUR_REPRESENTATIVE_DAYS = Object.freeze({ weekday: 1, weekend: 5 });

/** The share-link key. One key for the cursor, not one per layer. */
export const WEEK_HOUR_SHARE_PARAM = 'wh';

/** @type {?{day: number, hour: number}} */
let _cursor = null;
/** @type {Map<string, (cursor: ?{day:number, hour:number}, sourceId: string) => void>} */
const _subscribers = new Map();
/** Subscribers that have already thrown once. Warn once, not per click. */
const _warned = new Set();

/**
 * Is this a placeable hour of the week?
 * @param {unknown} value
 * @returns {boolean}
 */
function isCursor(value) {
  return Number.isInteger(value?.day) && value.day >= 0 && value.day <= 6
    && Number.isInteger(value?.hour) && value.hour >= 0 && value.hour <= 23;
}

/**
 * The hour of the week every consumer is pinned to, or `null`.
 *
 * `null` is the DEFAULT and it is not "midnight": it means nobody has pinned
 * an hour, so each layer follows whatever it followed before this module
 * existed — the Paris clock for `velo-pulse-fr` and `idfm-frequency`, the
 * weekday mean for `comptages-fr`.
 *
 * @returns {?{day: number, hour: number}} A frozen copy, or null.
 */
export function getWeekHour() {
  return _cursor;
}

/**
 * Pin the hour of the week, or release it.
 *
 * @param {string} sourceId Who is moving it — a layer id, `'share'`, or
 *   `'voice'`. Handed to every subscriber so the one that MOVED the cursor can
 *   skip re-applying its own broadcast, which would otherwise re-enter its own
 *   `setParams` on every click.
 * @param {?{day: number, hour: number}} cursor `null` releases the pin.
 * @returns {boolean} Whether anything changed. A no-op set notifies nobody:
 *   three layers each writing back the cursor they just adopted would
 *   otherwise be an infinite round of broadcasts.
 */
export function setWeekHour(sourceId, cursor) {
  const next = cursor === null || cursor === undefined
    ? null
    : (isCursor(cursor) ? Object.freeze({ day: cursor.day, hour: cursor.hour }) : undefined);
  // `undefined` means the argument was neither a release nor a placeable hour.
  // Refused rather than clamped, for the reason `comptagesParseSlot` gives:
  // a control that silently moved the reader to another hour because a caller
  // sent nonsense is worse than a control that did nothing.
  if (next === undefined) return false;
  if (next === null ? _cursor === null : (_cursor?.day === next.day && _cursor?.hour === next.hour)) {
    return false;
  }
  _cursor = next;
  const source = String(sourceId || '');
  for (const [id, handler] of _subscribers) {
    if (id === source) continue;
    try {
      handler(_cursor, source);
    } catch (error) {
      if (!_warned.has(id)) {
        _warned.add(id);
        console.warn(`[WeekHour] ${id} refused the cursor:`, error);
      }
    }
  }
  return true;
}

/**
 * Follow the cursor for as long as the layer is on.
 *
 * @param {string} id The subscriber's layer id — the same string it passes to
 *   {@link setWeekHour}, which is what stops a layer hearing its own move.
 * @param {(cursor: ?{day:number, hour:number}, sourceId: string) => void} handler
 * @returns {() => void} Stop following. Idempotent, and it only removes THIS
 *   handler — a re-subscribe under the same id replaces it.
 */
export function subscribeWeekHour(id, handler) {
  if (typeof id !== 'string' || !id || typeof handler !== 'function') return () => {};
  _subscribers.set(id, handler);
  _warned.delete(id);
  return () => {
    if (_subscribers.get(id) === handler) _subscribers.delete(id);
  };
}

/** Test seam: drop every subscriber and release the pin. */
export function _resetWeekHourForTest() {
  _subscribers.clear();
  _warned.clear();
  _cursor = null;
}

// --- The dialects -----------------------------------------------------------

/**
 * `{day, hour}` → the 0–167 slot `velo-pulse-fr` counts in.
 * @param {?{day:number, hour:number}} cursor
 * @returns {?number}
 */
export function weekHourToPulseSlot(cursor) {
  if (!isCursor(cursor)) return null;
  return cursor.day * 24 + cursor.hour;
}

/**
 * The 0–167 slot back to `{day, hour}`. Accepts a fractional position, because
 * the pulse animation runs on one and a paused frame lands between hours.
 * @param {unknown} slot
 * @returns {?{day:number, hour:number}}
 */
export function weekHourFromPulseSlot(slot) {
  const value = Number(slot);
  if (!Number.isFinite(value)) return null;
  const whole = ((Math.floor(value) % WEEK_HOUR_SLOTS) + WEEK_HOUR_SLOTS) % WEEK_HOUR_SLOTS;
  return { day: Math.floor(whole / 24), hour: whole % 24 };
}

/**
 * Which of the two profiles `comptages-fr` publishes an hour belongs to.
 * @param {?{day:number, hour:number}} cursor
 * @returns {?('weekday'|'weekend')}
 */
export function weekHourToDayType(cursor) {
  if (!isCursor(cursor)) return null;
  return cursor.day >= 5 ? 'weekend' : 'weekday';
}

/**
 * A day-type and an hour back to a cursor, keeping the day when it fits.
 *
 * The lossy direction, and the whole of the care it needs. `comptages-fr` has
 * no Tuesday to give: it publishes a mean over five weekdays. So this keeps
 * the day the cursor is ALREADY on when that day is on the requested side of
 * the split — pressing *Sem. 08 h* on a Wednesday cursor leaves Wednesday
 * alone — and only invents a day when it has to.
 *
 * @param {'weekday'|'weekend'} dayType
 * @param {number} hour 0–23.
 * @param {?{day:number, hour:number}} [previous] The cursor before the move.
 * @returns {?{day:number, hour:number}}
 */
export function weekHourFromDayType(dayType, hour, previous = null) {
  if (dayType !== 'weekday' && dayType !== 'weekend') return null;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  const keep = isCursor(previous) && weekHourToDayType(previous) === dayType
    ? previous.day
    : WEEK_HOUR_REPRESENTATIVE_DAYS[dayType];
  return { day: keep, hour };
}

/**
 * `{day, hour}` → the `idfm-frequency` operating slot.
 *
 * The OPERATING day, not the calendar one: that network files 01 h on a
 * Wednesday as Tuesday's band 25, which is why `IDFM_FREQ_MOMENTS` has a chip
 * labelled `01 h` carrying band 25. Bands run 4–27, so the four hours before
 * dawn belong to the previous day and every one of the 24 hours is reachable.
 *
 * @param {?{day:number, hour:number}} cursor
 * @returns {?{dayIndex:number, day:string, band:number}}
 */
export function weekHourToOperatingSlot(cursor) {
  if (!isCursor(cursor)) return null;
  const beforeDawn = cursor.hour < 4;
  const dayIndex = beforeDawn ? (cursor.day + 6) % 7 : cursor.day;
  return { dayIndex, day: WEEK_HOUR_DAYS[dayIndex], band: beforeDawn ? cursor.hour + 24 : cursor.hour };
}

/**
 * An `idfm-frequency` operating slot back to a cursor.
 * @param {number|string} day Day index 0–6, or one of {@link WEEK_HOUR_DAYS}.
 * @param {number} band 4–27.
 * @returns {?{day:number, hour:number}}
 */
export function weekHourFromOperatingSlot(day, band) {
  const dayIndex = typeof day === 'string' ? WEEK_HOUR_DAYS.indexOf(day) : day;
  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6) return null;
  if (!Number.isInteger(band) || band < 0 || band > 27) return null;
  if (band <= 23) return { day: dayIndex, hour: band };
  return { day: (dayIndex + 1) % 7, hour: band - 24 };
}

// --- The share key ----------------------------------------------------------

/**
 * The cursor as it travels in a link: the 0–167 slot, as digits.
 *
 * A slot and not `day:hour`, because it is one field and the shortest honest
 * encoding of it — and because `velo-pulse-fr` already thinks in that number,
 * so a link and the layer that most depends on it agree by construction.
 *
 * @param {?{day:number, hour:number}} [cursor] Defaults to the live cursor.
 * @returns {?string} `'32'` for Tuesday 08 h, or `null` when nothing is pinned.
 */
export function encodeWeekHourParam(cursor = _cursor) {
  const slot = weekHourToPulseSlot(cursor);
  return slot === null ? null : String(slot);
}

/**
 * Read the cursor out of a link.
 *
 * A value out of range is refused rather than wrapped: `wh=999` is a typo or a
 * truncation, and wrapping it to hour 15 of a Sunday would restore a picture
 * nobody shared.
 *
 * @param {unknown} value Raw `wh` parameter.
 * @returns {?{day:number, hour:number}}
 */
export function decodeWeekHourParam(value) {
  if (value === null || value === undefined || value === '') return null;
  const slot = Number(value);
  if (!Number.isInteger(slot) || slot < 0 || slot >= WEEK_HOUR_SLOTS) return null;
  return { day: Math.floor(slot / 24), hour: slot % 24 };
}

/**
 * The cursor in words, for a tooltip or a row label. `mardi 08 h`.
 * @param {?{day:number, hour:number}} [cursor]
 * @returns {?string}
 */
export function weekHourLabel(cursor = _cursor) {
  if (!isCursor(cursor)) return null;
  return `${WEEK_HOUR_DAYS[cursor.day]} ${String(cursor.hour).padStart(2, '0')} h`;
}
