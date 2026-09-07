/**
 * @module chronicle
 * @description The server's memory of the feeds that keep no memory of
 * themselves — how a live stream becomes a typical week, and what is kept raw
 * while it does.
 *
 * ── The defect this module exists to end ───────────────────────────────────
 *
 * Most of what this fork draws over France is an ARCHIVE with a public past:
 * Filosofi ships a year, DVF ships a decade, the Paris road counts ship
 * thirteen rolling months, and `comptagesRhythm.js` was able to say that 83.9 %
 * of counted arcs move their peak hour at the weekend because somebody kept
 * 27.7 million rows.
 *
 * Five of the feeds this server already reads keep NOTHING. GTFS-RT publishes
 * where a bus is now and overwrites it about thirty seconds later. QualiCharge
 * publishes whether a charge point is free now, one row per plug, replaced on
 * every poll. Bison Futé's DATEX II directory holds one file per agglomeration
 * and the previous one is deleted. AISStream is a socket. Vigicrues republishes
 * one 2.2 MB document twice a day over the top of the last. None of the five
 * has a published history, and no third party sells one for France.
 *
 * So every hour this server runs without recording is an hour that cannot be
 * bought back — and every hour it DOES record is one nobody else has. That is
 * the whole argument for this file. It is not a cache: a cache exists so the
 * next request is cheap and is allowed to forget. This exists so that in six
 * months there is an answer to "is this normal for a Tuesday at 08:00?".
 *
 * ── The two things kept, and the different reasons ─────────────────────────
 *
 *   THE TYPICAL WEEK — kept for ever, tiny. Each series is folded into 168
 *   hour-of-week slots (Monday 00 h to Sunday 23 h, Paris local), each slot
 *   holding a running count, mean and variance. A slot is five numbers, so a
 *   series with every slot filled measures **5 341 bytes** whether one year or
 *   ten went into it — the file does not grow with time, only with the number
 *   of series. This is the proprietary half: the input is public and
 *   re-fetchable, the accumulation is not.
 *
 *   THE RAW TICKS — kept for THIRTY DAYS, one NDJSON file per local day. This
 *   is the escape hatch, and it is why the retention is a month rather than a
 *   week: a fold is irreversible, so any axis nobody thought of on the first
 *   day is lost for ever unless the ticks are still there to re-fold. Thirty
 *   days is four complete weeks — enough to rebuild a first profile on a new
 *   axis — and it is the same TTL, for the same reasoning, as the AIS identity
 *   registry and the mapped-installation disk cache.
 *
 * ── Why the clock is Europe/Paris and not UTC ──────────────────────────────
 *
 * Because every rhythm this records is a HUMAN one. The evening peak is at
 * 18 h local in February and at 18 h local in July; in UTC it moves an hour
 * twice a year, which would smear two months of every profile across two
 * slots and flatten precisely the peak the profile exists to find. The day
 * partition of the raw files uses the same local date, so "Tuesday's file" and
 * "Tuesday's slots" are the same Tuesday.
 *
 * The week ordinal — which is what lets a slot say "seen in 6 distinct weeks"
 * rather than the far weaker "seen 312 times" — is derived from the same local
 * calendar date, never from a division of the epoch, so it survives both DST
 * switches exactly.
 *
 * ── Why a slot counts WEEKS and not just samples ───────────────────────────
 *
 * A source polled every five minutes puts 12 samples into one slot in a single
 * week. A source polled only when an operator happens to be looking at that
 * region puts in one, or none. Judging "is this hour typical" off the sample
 * count alone would let a single busy Tuesday certify the Tuesday 08 h slot
 * for ever, on one week of evidence. So each slot carries `w`, the number of
 * DISTINCT weeks that have contributed to it, and {@link chronicleReading}
 * refuses to score a value until that reaches {@link CHRONICLE_MIN_WEEKS}.
 * Before then the honest answer is "not enough history yet", and it is the
 * answer given.
 *
 * ── What a source may declare, including nothing ───────────────────────────
 *
 * A typical WEEK is only the right shape for a periodic phenomenon. Traffic,
 * transit punctuality, charge-point occupancy and vessel presence are all
 * strongly weekly. FLOODS ARE NOT: a Vigicrues level answers to rainfall, not
 * to Tuesday, and folding it into hour-of-week slots would manufacture a
 * seasonality that does not exist. So a source is allowed to declare no
 * profile axis at all and record only its raw chronology —
 * `chronicleSources.js` says which, and why, per source.
 *
 * Everything here is pure — no fs, no clock of its own, no dev server — so the
 * policy is exercisable by the offline node:test suite. `vite.config.js` owns
 * the file paths, the debounce, the atomic rename and the retention sweep.
 */

/** Serialisation version. Bump when the stored slot shape changes. */
export const CHRONICLE_VERSION = 1;

/**
 * The clock every profile is folded against.
 *
 * Not configurable: a profile written against one zone and read against
 * another is silently wrong, and this fork's subject is France.
 */
export const CHRONICLE_TIME_ZONE = 'Europe/Paris';

/** Hour-of-week slots: 7 days x 24 hours, Monday 00 h first. */
export const CHRONICLE_SLOTS = 168;

/** How long a raw day file is kept before the sweep drops it. */
export const CHRONICLE_RETENTION_DAYS = 30;

/**
 * Distinct weeks a slot needs before it may be used to judge a live value.
 *
 * Three, because two is the smallest number that can produce a variance and
 * that variance is worthless — two Tuesdays that happened to agree give a
 * spread of zero and a z-score of infinity on the third. Three is the point at
 * which a slot has an outvoted minority. It is a ROUND, FROZEN number, not a
 * quantile of the data, so a slot does not become judgeable because its
 * neighbours did.
 */
export const CHRONICLE_MIN_WEEKS = 3;

/**
 * Ceiling on retained series per source.
 *
 * The profile document is rewritten WHOLE on a debounce, so its size is a
 * write cost paid over and over. Measured on fully populated series, 250 of
 * them serialise to **1.31 MB**, which at the 15-minute debounce is 126 MB of
 * writes a day for the widest source. Sources are expected to declare axes far
 * below this — the busiest today, `road-status-fr`, uses 99 — so the cap is the
 * backstop for an upstream that starts publishing identifiers this repo has
 * never seen, not a budget to spend.
 */
export const CHRONICLE_MAX_SERIES = 250;

/**
 * Floor on the spread used to score a value, absolute and proportional.
 *
 * A series that has been the same number for six weeks has a standard
 * deviation of exactly zero, and every real observation would then score an
 * infinite z. The floor turns that into "a change of more than half a unit, or
 * more than 2 % of the usual level, is worth a number" — which is the smallest
 * claim this data can support anyway, given that most of these series are
 * counts of things whose upstream rounds, drops and retries.
 */
export const CHRONICLE_SPREAD_FLOOR_ABS = 0.5;
export const CHRONICLE_SPREAD_FLOOR_REL = 0.02;

/**
 * |z| at which a reading stops being ordinary, and at which it becomes rare.
 *
 * Round numbers, frozen. Two sigma is the conventional "worth looking at";
 * 3.5 is past where a roughly-normal count series produces one false alarm per
 * slot per several years of weeks. Neither is a promise about the
 * distribution — these series are not normal — they are labels on a ruler.
 */
export const CHRONICLE_UNUSUAL_Z = 2;
export const CHRONICLE_RARE_Z = 3.5;

/** Longest series key kept. Defence against an upstream identifier gone wild. */
const MAX_KEY_LENGTH = 96;

/** @type {Map<string, Intl.DateTimeFormat>} */
const FORMATTERS = new Map();

function formatterFor(timeZone) {
  let formatter = FORMATTERS.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    });
    FORMATTERS.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * Read one instant on the chronicle's clock.
 *
 * `week` is the count of Monday-started weeks since the Monday before the
 * epoch, computed from the LOCAL calendar date rather than from a division of
 * the epoch — so the two annual DST switches, which move an hour and not a
 * day, cannot slide an observation into the neighbouring week.
 *
 * @param {number} epochMs
 * @param {string} [timeZone]
 * @returns {?{dayKey: string, hour: number, weekday: number, slot: number, week: number}}
 *   Null on a non-finite instant; nothing downstream may fold a NaN.
 */
export function chronicleStamp(epochMs, timeZone = CHRONICLE_TIME_ZONE) {
  if (!Number.isFinite(epochMs)) return null;
  const parts = formatterFor(timeZone).formatToParts(new Date(epochMs));
  let year = NaN;
  let month = NaN;
  let day = NaN;
  let hour = NaN;
  for (const part of parts) {
    if (part.type === 'year') year = Number(part.value);
    else if (part.type === 'month') month = Number(part.value);
    else if (part.type === 'day') day = Number(part.value);
    else if (part.type === 'hour') hour = Number(part.value);
  }
  if (!Number.isFinite(year) || !Number.isFinite(month)
    || !Number.isFinite(day) || !Number.isFinite(hour)) return null;
  // `hourCycle: 'h23'` is asked for above; this is the belt for a runtime that
  // ignores it and prints midnight as 24.
  if (hour === 24) hour = 0;
  const dayNumber = Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
  // 1970-01-01 was a Thursday, so day 0 is index 3 on a Monday-first week.
  const weekday = ((dayNumber + 3) % 7 + 7) % 7;
  return {
    dayKey: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    hour,
    weekday,
    slot: weekday * 24 + hour,
    week: Math.floor((dayNumber + 3) / 7),
  };
}

/** A fresh, empty typical week. Five parallel arrays, one entry per slot. */
export function createChronicleSeries() {
  return {
    n: new Array(CHRONICLE_SLOTS).fill(0),
    w: new Array(CHRONICLE_SLOTS).fill(0),
    // Last week ordinal folded into each slot. -1 rather than 0 so that the
    // first observation always counts as a new week, whatever the ordinal is.
    lw: new Array(CHRONICLE_SLOTS).fill(-1),
    mean: new Array(CHRONICLE_SLOTS).fill(0),
    m2: new Array(CHRONICLE_SLOTS).fill(0),
  };
}

/**
 * Fold one observation into a series, by Welford's online algorithm.
 *
 * Welford rather than sum-and-sum-of-squares because these counters run for
 * years against means in the tens of thousands, which is exactly where the
 * naive form loses the variance to cancellation.
 *
 * A non-finite value is REFUSED rather than folded as zero. "The feed said
 * nothing this tick" and "the feed said zero" are different facts, and a
 * source that goes down for a day must not teach the profile that its quiet
 * hours are quieter than they are.
 *
 * @param {object} series From {@link createChronicleSeries}.
 * @param {number} slot 0..167
 * @param {number} value
 * @param {number} week Week ordinal from {@link chronicleStamp}.
 * @returns {boolean} True when the observation was folded.
 */
export function observeChronicleSeries(series, slot, value, week) {
  if (!series || !Number.isFinite(value)) return false;
  if (!Number.isInteger(slot) || slot < 0 || slot >= CHRONICLE_SLOTS) return false;
  const n = series.n[slot] + 1;
  const delta = value - series.mean[slot];
  series.mean[slot] += delta / n;
  series.m2[slot] += delta * (value - series.mean[slot]);
  series.n[slot] = n;
  if (Number.isFinite(week) && series.lw[slot] !== week) {
    series.w[slot] += 1;
    series.lw[slot] = week;
  }
  return true;
}

/** Sample standard deviation of one slot, or NaN below two observations. */
export function chronicleSlotSpread(series, slot) {
  const n = series?.n?.[slot] || 0;
  if (n < 2) return NaN;
  return Math.sqrt(series.m2[slot] / (n - 1));
}

/**
 * Score a live value against the slot it landed in.
 *
 * Returns null — never a zero, never a guess — when the slot has not been seen
 * in {@link CHRONICLE_MIN_WEEKS} distinct weeks. "We do not know yet" is a
 * real answer and the only honest one on a young profile.
 *
 * @param {object} series
 * @param {number} slot
 * @param {number} value
 * @param {{minWeeks?: number}} [options]
 * @returns {?{expected: number, spread: number, samples: number, weeks: number,
 *   z: number, band: 'typical'|'unusual'|'rare', direction: 'above'|'below'|'level'}}
 */
export function chronicleReading(series, slot, value, { minWeeks = CHRONICLE_MIN_WEEKS } = {}) {
  if (!series || !Number.isFinite(value)) return null;
  if (!Number.isInteger(slot) || slot < 0 || slot >= CHRONICLE_SLOTS) return null;
  const weeks = series.w[slot] || 0;
  const samples = series.n[slot] || 0;
  if (weeks < minWeeks || samples < 2) return null;
  const expected = series.mean[slot];
  const spread = Math.max(
    chronicleSlotSpread(series, slot),
    CHRONICLE_SPREAD_FLOOR_ABS,
    CHRONICLE_SPREAD_FLOOR_REL * Math.abs(expected),
  );
  const z = (value - expected) / spread;
  const magnitude = Math.abs(z);
  return {
    expected,
    spread,
    samples,
    weeks,
    z,
    band: magnitude >= CHRONICLE_RARE_Z ? 'rare' : (magnitude >= CHRONICLE_UNUSUAL_Z ? 'unusual' : 'typical'),
    direction: z > 0 ? 'above' : (z < 0 ? 'below' : 'level'),
  };
}

/** Total observations a series carries, across every slot. */
export function chronicleSeriesWeight(series) {
  let total = 0;
  for (let slot = 0; slot < CHRONICLE_SLOTS; slot += 1) total += series?.n?.[slot] || 0;
  return total;
}

/** How many of the 168 slots have ever been observed. */
export function chronicleSeriesCoverage(series) {
  let filled = 0;
  for (let slot = 0; slot < CHRONICLE_SLOTS; slot += 1) if (series?.n?.[slot] > 0) filled += 1;
  return filled;
}

/** Whether a key is one this module is willing to store. */
export function isChronicleSeriesKey(key) {
  return typeof key === 'string' && key.length > 0 && key.length <= MAX_KEY_LENGTH;
}

/**
 * Round to `digits` decimals, returning a NUMBER so JSON stays compact.
 *
 * The means and variances kept here are of counts and percentages read off
 * feeds whose own precision is a whole vehicle or a whole plug; carrying
 * seventeen significant digits into the file would triple its size to record
 * float noise.
 */
function rounded(value, digits) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * The precision every observation is stored at — three decimals.
 *
 * Exported and applied by the CALLER, before both the fold and the raw line,
 * so the two agree exactly. Rounding only on the way to the file would leave
 * the profile holding a mean of numbers the log does not contain, and the one
 * property that makes the thirty-day window an escape hatch — that re-folding
 * the log reproduces the profile — would be false in the fourth decimal.
 *
 * Three decimals because these series are counts and percentages: a share of
 * 16.249 % is already past what the feeds behind it can support.
 */
export function chronicleRoundValue(value) {
  return Number.isFinite(value) ? rounded(value, 3) : Number.NaN;
}

/**
 * Render one source's profiles as the document written to disk.
 *
 * Series are ordered by weight and truncated at the cap, so a source that
 * overflows loses the identifiers it has heard least — never the ones it knows
 * best. Empty series are dropped rather than stored as 168 zeros.
 *
 * @param {Map<string, object>} profiles seriesKey -> series
 * @param {{now?: number, maxSeries?: number, timeZone?: string}} [options]
 * @returns {{version: number, savedAt: string, timeZone: string, slots: number,
 *   count: number, series: Object<string, object>}}
 */
export function serializeChronicleProfile(profiles, {
  now = Date.now(),
  maxSeries = CHRONICLE_MAX_SERIES,
  timeZone = CHRONICLE_TIME_ZONE,
} = {}) {
  const rows = [];
  for (const [key, series] of profiles) {
    if (!isChronicleSeriesKey(key) || !series) continue;
    const weight = chronicleSeriesWeight(series);
    if (weight <= 0) continue;
    rows.push([key, series, weight]);
  }
  rows.sort((a, b) => b[2] - a[2] || a[0].localeCompare(b[0]));
  const series = {};
  for (const [key, entry] of rows.slice(0, maxSeries)) {
    series[key] = {
      n: entry.n.slice(),
      w: entry.w.slice(),
      lw: entry.lw.slice(),
      mean: entry.mean.map((value) => rounded(value, 3)),
      m2: entry.m2.map((value) => rounded(value, 3)),
    };
  }
  return {
    version: CHRONICLE_VERSION,
    savedAt: new Date(now).toISOString(),
    timeZone,
    slots: CHRONICLE_SLOTS,
    count: Math.min(rows.length, maxSeries),
    series,
  };
}

/** Bring one stored series back to the in-memory shape, or reject it. */
function parseChronicleSeries(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const series = createChronicleSeries();
  for (const field of ['n', 'w', 'lw', 'mean', 'm2']) {
    const values = raw[field];
    if (!Array.isArray(values) || values.length !== CHRONICLE_SLOTS) return null;
    for (let slot = 0; slot < CHRONICLE_SLOTS; slot += 1) {
      const value = Number(values[slot]);
      series[field][slot] = Number.isFinite(value) ? value : (field === 'lw' ? -1 : 0);
    }
  }
  // A slot claiming observations it cannot have is a corrupt file, not a
  // partial one: folding onto it would carry the corruption forward for ever.
  for (let slot = 0; slot < CHRONICLE_SLOTS; slot += 1) {
    if (series.n[slot] < 0 || series.w[slot] < 0 || series.w[slot] > series.n[slot]) return null;
    if (series.m2[slot] < 0) return null;
  }
  return series;
}

/**
 * Read a profile document back.
 *
 * An unknown version is ignored WHOLESALE rather than guessed at, and a
 * corrupt file costs the accumulated profile rather than the boot: the raw
 * ticks of the last thirty days are still on disk, so the loss is repairable
 * and a crash here would not be.
 *
 * @param {string|object} source
 * @returns {Map<string, object>} Empty on any unreadable input.
 */
export function parseChronicleProfile(source) {
  const profiles = new Map();
  let document = source;
  if (typeof source === 'string') {
    try {
      document = JSON.parse(source);
    } catch {
      return profiles;
    }
  }
  if (!document || typeof document !== 'object' || Array.isArray(document)) return profiles;
  if (document.version !== CHRONICLE_VERSION) return profiles;
  if (document.slots !== CHRONICLE_SLOTS) return profiles;
  // A document folded on another clock cannot be merged with this one: its
  // slot 8 is not this slot 8.
  if (document.timeZone && document.timeZone !== CHRONICLE_TIME_ZONE) return profiles;
  const entries = document.series;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return profiles;
  for (const [key, raw] of Object.entries(entries)) {
    if (!isChronicleSeriesKey(key)) continue;
    const series = parseChronicleSeries(raw);
    if (series) profiles.set(key, series);
  }
  return profiles;
}

/**
 * Encode one tick as the line(s) appended to the day's raw file.
 *
 * The timestamp is written ONCE per tick rather than once per series: a
 * transit tick carries three hundred numbers that share an instant, and
 * repeating the epoch on each would be more bytes of clock than of data.
 *
 * @param {{at: number, samples?: Object<string, number>|Array<[string, number]>,
 *   events?: Array<*>}} tick
 * @returns {string} Zero, one or two NDJSON lines, newline-terminated.
 */
export function encodeChronicleTick({ at, samples, events } = {}) {
  if (!Number.isFinite(at)) return '';
  let out = '';
  const pairs = samples instanceof Map
    ? [...samples]
    : (Array.isArray(samples) ? samples : Object.entries(samples || {}));
  const s = {};
  let kept = 0;
  for (const [key, value] of pairs) {
    if (!isChronicleSeriesKey(key) || !Number.isFinite(value)) continue;
    s[key] = rounded(value, 3);
    kept += 1;
  }
  if (kept) out += `${JSON.stringify({ t: at, s })}\n`;
  if (Array.isArray(events) && events.length) out += `${JSON.stringify({ t: at, e: events })}\n`;
  return out;
}

/**
 * Read one raw line back.
 * @param {string} line
 * @returns {?{at: number, samples: Object<string, number>, events: Array<*>}}
 */
export function decodeChronicleTick(line) {
  if (typeof line !== 'string' || !line.trim()) return null;
  let row;
  try {
    row = JSON.parse(line);
  } catch {
    return null;
  }
  if (!row || typeof row !== 'object' || !Number.isFinite(row.t)) return null;
  const samples = {};
  if (row.s && typeof row.s === 'object' && !Array.isArray(row.s)) {
    for (const [key, value] of Object.entries(row.s)) {
      if (isChronicleSeriesKey(key) && Number.isFinite(value)) samples[key] = value;
    }
  }
  return { at: row.t, samples, events: Array.isArray(row.e) ? row.e : [] };
}

/** The day file name a tick is appended to while that day is still running. */
export function chronicleDayFile(dayKey) {
  return `${dayKey}.ndjson`;
}

/**
 * Whether a filename is one this module wrote, and the day it holds.
 *
 * Two forms, because a finished day is compacted: `.ndjson` is the day being
 * appended to, `.ndjson.gz` is one that is closed. Both are the same day and
 * both count against retention.
 */
export function chronicleDayOfFile(name) {
  const match = /^(\d{4}-\d{2}-\d{2})\.ndjson(?:\.gz)?$/.exec(String(name || ''));
  return match ? match[1] : null;
}

/**
 * Raw day files that are finished and still uncompressed.
 *
 * These logs are the most compressible thing this server writes — the same
 * few dozen tokens, tens of thousands of times. Measured on a synthetic day of
 * the QualiCharge transition log (96 ticks x 5 000 changed charge points):
 * **30.2 MB plain, 4.2 MB gzipped, a ratio of 7.3**, which is the difference
 * between 900 MB and 125 MB of retained month on a small VPS.
 *
 * Only days strictly BEFORE today are returned: compacting the file still
 * being appended to would mean re-writing it on every tick, which is the one
 * shape that costs more than it saves.
 *
 * @param {Array<string>} names Directory listing.
 * @param {string} todayKey
 * @returns {Array<string>} Plain `.ndjson` names to compact, oldest first.
 */
export function compactableChronicleDays(names, todayKey) {
  if (!Array.isArray(names) || !todayKey) return [];
  const out = [];
  for (const name of names) {
    if (!/\.ndjson$/.test(name)) continue;
    const day = chronicleDayOfFile(name);
    if (day && day < todayKey) out.push(name);
  }
  return out.sort();
}

/**
 * Oldest day key still inside the retention window.
 *
 * Inclusive: a file named exactly this is KEPT. Thirty days of retention means
 * today plus the twenty-nine before it, which is four complete weeks and a
 * day — the smallest window from which a new profile axis can be rebuilt with
 * every weekday represented four times.
 *
 * @param {number} nowMs
 * @param {number} [days]
 * @param {string} [timeZone]
 * @returns {?string}
 */
export function chronicleRetentionFloor(nowMs, days = CHRONICLE_RETENTION_DAYS, timeZone = CHRONICLE_TIME_ZONE) {
  const stamp = chronicleStamp(nowMs, timeZone);
  if (!stamp) return null;
  const floor = chronicleStamp(nowMs - (Math.max(1, days) - 1) * 86_400_000, timeZone);
  return floor ? floor.dayKey : stamp.dayKey;
}

/**
 * Which of a source's raw files have fallen out of the window.
 *
 * Day keys are `YYYY-MM-DD`, so the comparison is a plain string compare and
 * needs no date arithmetic — which is what makes this testable without a
 * clock. Anything in the directory that this module did not write is left
 * alone: the sweep deletes files, and a sweep that deletes what it does not
 * recognise is a sweep that one day deletes the profile.
 *
 * @param {Array<string>} names Directory listing.
 * @param {?string} floorDayKey From {@link chronicleRetentionFloor}.
 * @returns {Array<string>} Names to delete, oldest first.
 */
export function expiredChronicleDays(names, floorDayKey) {
  if (!Array.isArray(names) || !floorDayKey) return [];
  const expired = [];
  for (const name of names) {
    const day = chronicleDayOfFile(name);
    if (day && day < floorDayKey) expired.push(name);
  }
  return expired.sort();
}
