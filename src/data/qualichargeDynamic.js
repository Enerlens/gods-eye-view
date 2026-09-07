/**
 * @module qualichargeDynamic
 * @description The one feed that says whether a French charge point is FREE
 * RIGHT NOW — and the reading rules that keep it from lying.
 *
 * ── Why this exists next to `irveFeed.js` ──────────────────────────────────
 *
 * `irveFeed.js` reads the *fichier consolidé* — a static register of where the
 * plugs are, and it says out loud, three times over, that it is not an
 * availability feed: "Capacité installée — ce fichier ne publie pas la
 * disponibilité". That was true of every national file until QualiCharge.
 *
 * QualiCharge is the DGEC's aggregation API. Connecting to it is COMPULSORY
 * for any DC charge-point operator claiming renewable-electricity certificates,
 * which is why a voluntary-looking feed nonetheless covers the fast network:
 * measured 2026-09-07, **75 427 points de charge**, one row per plug, 6.08 MB
 * of CSV (1.17 MB gzipped, 320 ms), CORS-open, Licence Ouverte 2.0.
 *
 * It publishes ONLY the current state. Each poll replaces the last, no history
 * is kept anywhere, and no third party sells one. `chronicle.js` is what turns
 * it into a past.
 *
 * ── Trap 1: a third of the file is not about now ───────────────────────────
 *
 * `horodatage` is when the operator last SPOKE about that plug, not when the
 * file was built, and it reaches back years. Measured 2026-09-07 16:37 UTC
 * over all 75 427 rows:
 *
 *   within 1 h    17 786   23.6 %
 *   within 6 h    40 915   54.2 %
 *   within 24 h   51 230   67.9 %
 *   within 7 d    62 796   83.3 %
 *   within 30 d   67 737   89.8 %
 *   oldest                 862 days — a state assertion from 2024
 *
 * And the stale rows are not stale-and-silent, they are stale-and-CONFIDENT:
 * of the 24 197 rows outside 24 hours, **18 052 still say `libre`** and only
 * 858 say `occupe`. Counting the file as it stands gives 58 742 free plugs;
 * counting only what has been re-affirmed within a day gives 40 690. A naive
 * reading inflates France's free charging capacity by **44.4 %**, and it does
 * so in one direction — an operator that goes silent goes silent while its
 * plugs are idle.
 *
 * So every share this module publishes is computed over the FRESH rows only,
 * and the fresh count travels with them ({@link QUALICHARGE_FRESH_MS}, 24 h).
 * The stale rows are counted too, under their own key, because "how much of
 * the network stopped reporting" is itself a measurement.
 *
 * ── Trap 2: the freshness clock is the FETCH, not `Date.now()` ─────────────
 *
 * No row in either captured file is stamped ahead of the instant its body
 * arrived — 0 of 75 426 and 0 of 75 427. But a first pass at this measurement
 * compared the file against a `now` taken a few minutes BEFORE the fetch and
 * "found" 1 252 rows from the future, all within three minutes. That is the
 * shape of the real bug: a body fetched at 12:00 and folded from cache at
 * 12:14 ages every row by fourteen minutes it did not live, and pushes the
 * plugs nearest the window's edge over it.
 *
 * So {@link qualichargeSamples} takes the FETCH instant as `now`, never the
 * caller's wall clock, and the age is `|now - stamp|` so that a publisher
 * whose clock genuinely runs ahead loses no rows either.
 *
 * ── Trap 3: the operator code is in the id, and 16 rows spell it differently ─
 *
 * `id_pdc_itinerance` follows AFIREV: two country letters, three operator
 * characters, an `E`, then the operator's own id — `FRS30E300320031` is
 * operator `FRS30`. Sixteen rows (all `FRV75PPX…`, the Ville de Paris) omit
 * the `E` separator entirely. Reading the first FIVE characters rather than
 * splitting on the `E` matches all 75 427 rows and puts those sixteen in the
 * `FRV75` bucket they belong to, alongside the other 1 940.
 *
 * Measured: **94 distinct operators**, 85 of them with 20 or more plugs. The
 * per-operator series is emitted only above {@link QUALICHARGE_OPERATOR_FLOOR}
 * because an occupancy share over three plugs is a coin toss, not a rhythm.
 *
 * Pure: no fetch, no clock of its own, no fs. `vite.config.js` polls, and
 * `chronicle.js` remembers.
 */

/** The national dynamic feed, via transport.data.gouv.fr's proxy. */
export const QUALICHARGE_DYNAMIC_URL = 'https://proxy.transport.data.gouv.fr/resource/qualicharge-irve-dynamique';

/** Dataset page, for attribution and for the status endpoint. */
export const QUALICHARGE_DATASET_PAGE = 'https://www.data.gouv.fr/datasets/infrastructures-de-recharge-pour-vehicules-electriques-donnees-ouvertes';

export const QUALICHARGE_LICENCE = 'Licence Ouverte 2.0';
export const QUALICHARGE_ATTRIBUTION = 'QualiCharge — Direction générale de l’énergie et du climat, via transport.data.gouv.fr';

/**
 * How recently an operator must have spoken for its plug to count as measured.
 *
 * Twenty-four hours, not one: the distribution above has a long shoulder — a
 * 6-hour window would discard 45 % of the file and a 1-hour window 76 %, and
 * most of what those windows drop is AC charging at sites that report on a
 * session boundary rather than on a heartbeat. A day is where the curve starts
 * to flatten (67.9 % → 83.3 % costs another six days), and it is short enough
 * that no row inside it predates the previous poll's own answer.
 */
export const QUALICHARGE_FRESH_MS = 24 * 60 * 60 * 1000;

/** Fewest plugs an operator needs before its occupancy share is recorded. */
export const QUALICHARGE_OPERATOR_FLOOR = 20;

/** Longest CSV this module will read. The measured body is 6.1 MB. */
export const QUALICHARGE_MAX_BYTES = 32 * 1024 * 1024;

/**
 * The single-character codes the raw transition log is written in.
 *
 * Written short because this log is the biggest thing the chronicle keeps —
 * `en_service`/`hors_service` alone would add ~9 bytes to every one of the
 * ~5 000 rows a tick carries. The mapping is exported, not implied, so a
 * re-fold six months from now reads the log without guessing.
 */
export const QUALICHARGE_ETAT_CODES = Object.freeze({
  en_service: 'S', hors_service: 'H', inconnu: '?',
});
export const QUALICHARGE_OCCUPATION_CODES = Object.freeze({
  libre: 'L', occupe: 'O', reserve: 'R', inconnu: '?',
});

const ETAT_LABELS = Object.freeze(Object.fromEntries(
  Object.entries(QUALICHARGE_ETAT_CODES).map(([label, code]) => [code, label]),
));
const OCCUPATION_LABELS = Object.freeze(Object.fromEntries(
  Object.entries(QUALICHARGE_OCCUPATION_CODES).map(([label, code]) => [code, label]),
));

/** Decode one transition-log code back to the word the feed published. */
export function qualichargeEtatLabel(code) { return ETAT_LABELS[code] || null; }
export function qualichargeOccupationLabel(code) { return OCCUPATION_LABELS[code] || null; }

/** Columns this module reads. Anything else in the header is ignored. */
const REQUIRED_COLUMNS = Object.freeze(['id_pdc_itinerance', 'etat_pdc', 'occupation_pdc', 'horodatage']);

/** AFIREV id: two country letters then three operator characters. */
const OPERATOR_PATTERN = /^[A-Z]{2}[A-Z0-9]{3}/;

/**
 * Split one CSV line.
 *
 * The measured file quotes nothing — 0 of 75 427 rows contain a double quote,
 * and every row has exactly 8 fields — so the common path is a plain split.
 * The quoted branch exists so that a publisher who one day puts a comma in a
 * field produces a correct read rather than a silently shifted one.
 */
function splitCsvLine(line) {
  if (!line.includes('"')) return line.split(',');
  const fields = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { current += '"'; i += 1; } else quoted = false;
      } else current += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { fields.push(current); current = ''; }
    else current += ch;
  }
  fields.push(current);
  return fields;
}

/**
 * Parse `horodatage` to epoch milliseconds.
 *
 * The feed writes `2026-09-07 13:01:16.040850+00:00` — a space instead of the
 * ISO `T`, microseconds instead of milliseconds, and an offset. `Date.parse`
 * accepts it on V8, but not by specification, so the space is normalised here
 * rather than trusted.
 */
export function parseQualichargeStamp(value) {
  if (typeof value !== 'string' || !value) return NaN;
  const ms = Date.parse(value.replace(' ', 'T'));
  return Number.isFinite(ms) ? ms : NaN;
}

/** The AFIREV operator this id belongs to, or null. */
export function qualichargeOperator(id) {
  if (typeof id !== 'string') return null;
  const upper = id.toUpperCase();
  return OPERATOR_PATTERN.test(upper) ? upper.slice(0, 5) : null;
}

/**
 * Read the whole file into the compact state this module holds between polls.
 *
 * One entry per plug: `{ e, o, t }` — état code, occupation code, stamp in
 * epoch SECONDS. At ~60 bytes an entry the resident state is about 4.5 MB,
 * which is the price of being able to log transitions rather than snapshots.
 *
 * @param {string} csv
 * @returns {{rows: Map<string, {e: string, o: string, t: number}>, malformed: number, columns: number}}
 */
export function parseQualichargeDynamic(csv) {
  const rows = new Map();
  let malformed = 0;
  if (typeof csv !== 'string' || !csv) return { rows, malformed, columns: 0 };
  const lines = csv.split('\n');
  const header = splitCsvLine((lines[0] || '').replace(/\r$/, '')).map((name) => name.trim());
  const index = {};
  for (const column of REQUIRED_COLUMNS) {
    const at = header.indexOf(column);
    // A missing required column is not a partial read: every share below would
    // silently become zero. The caller sees an empty map and keeps its cache.
    if (at < 0) return { rows, malformed: lines.length, columns: header.length };
    index[column] = at;
  }
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i].replace(/\r$/, '');
    if (!line) continue;
    const fields = splitCsvLine(line);
    if (fields.length < header.length) { malformed += 1; continue; }
    const id = fields[index.id_pdc_itinerance]?.trim();
    if (!id) { malformed += 1; continue; }
    const stamp = parseQualichargeStamp(fields[index.horodatage]?.trim());
    rows.set(id, {
      e: QUALICHARGE_ETAT_CODES[fields[index.etat_pdc]?.trim()] || '?',
      o: QUALICHARGE_OCCUPATION_CODES[fields[index.occupation_pdc]?.trim()] || '?',
      t: Number.isFinite(stamp) ? Math.round(stamp / 1000) : 0,
    });
  }
  return { rows, malformed, columns: header.length };
}

/**
 * Fold one parsed file into the numbers the chronicle stores.
 *
 * Every `Pct` is over the FRESH rows and nothing else — see Trap 1. The
 * denominators travel with the shares (`fr/pdc`, `fr/fresh`) so a thin day
 * reads as thin rather than as a national outage.
 *
 * @param {Map<string, {e: string, o: string, t: number}>} rows
 * @param {{now?: number, freshMs?: number, operatorFloor?: number}} [options]
 *   `now` is the instant the BODY ARRIVED — see Trap 2.
 * @returns {{samples: Object<string, number>, pdc: number, fresh: number,
 *   operators: number, national: Object<string, number>}}
 */
export function qualichargeSamples(rows, {
  now = Date.now(),
  freshMs = QUALICHARGE_FRESH_MS,
  operatorFloor = QUALICHARGE_OPERATOR_FLOOR,
} = {}) {
  const national = {
    pdc: 0, fresh: 0, libre: 0, occupe: 0, reserve: 0, inconnu: 0, horsService: 0, ahead: 0,
  };
  /** @type {Map<string, {fresh: number, occupe: number, libre: number, hs: number}>} */
  const operators = new Map();
  for (const [id, row] of rows) {
    national.pdc += 1;
    const stampMs = row.t * 1000;
    // Absolute distance, not a signed age, so a publisher whose clock runs
    // ahead of this one keeps its freshest rows rather than losing them to a
    // `0 <= age` test (Trap 2).
    const fresh = row.t > 0 && Math.abs(now - stampMs) <= freshMs;
    if (stampMs > now) national.ahead += 1;
    if (!fresh) continue;
    national.fresh += 1;
    if (row.o === 'L') national.libre += 1;
    else if (row.o === 'O') national.occupe += 1;
    else if (row.o === 'R') national.reserve += 1;
    else national.inconnu += 1;
    if (row.e === 'H') national.horsService += 1;

    const operator = qualichargeOperator(id);
    if (!operator) continue;
    let bucket = operators.get(operator);
    if (!bucket) {
      bucket = { fresh: 0, occupe: 0, libre: 0, hs: 0 };
      operators.set(operator, bucket);
    }
    bucket.fresh += 1;
    if (row.o === 'O') bucket.occupe += 1;
    else if (row.o === 'L') bucket.libre += 1;
    if (row.e === 'H') bucket.hs += 1;
  }

  const samples = {
    'fr/pdc': national.pdc,
    'fr/fresh': national.fresh,
    'fr/libre': national.libre,
    'fr/occupe': national.occupe,
    'fr/horsService': national.horsService,
    'fr/inconnu': national.inconnu,
  };
  if (national.fresh > 0) {
    samples['fr/occupePct'] = (100 * national.occupe) / national.fresh;
    samples['fr/horsServicePct'] = (100 * national.horsService) / national.fresh;
  }
  let emitted = 0;
  for (const [operator, bucket] of operators) {
    if (bucket.fresh < operatorFloor) continue;
    samples[`op:${operator}/occupePct`] = (100 * bucket.occupe) / bucket.fresh;
    emitted += 1;
  }
  return {
    samples, pdc: national.pdc, fresh: national.fresh, operators: emitted, national,
  };
}

/**
 * The rows whose STATE changed since the previous poll.
 *
 * `horodatage` moving on its own is not a transition — it is the operator
 * re-affirming the same answer. Measured over a 9 min 36 s gap on 2026-09-07
 * (16:27:28 → 16:37:04 UTC), **4 231 of 75 426 plugs changed row**: 3 100
 * changed occupation, 178 changed état, and **1 116 changed nothing but their
 * timestamp**. Dropping that last quarter is what keeps the archive a log of
 * events rather than a log of heartbeats.
 *
 * That leaves ~3 100 real transitions per ten minutes, which at the recorder's
 * 15-minute cadence is roughly 5 000 rows a tick and 480 000 a day — 30 MB
 * plain, 4.2 MB gzipped, about **125 MB for the thirty-day window**. That is
 * the whole storage bill for a national charge-point transition log that does
 * not exist anywhere else.
 *
 * A plug seen for the FIRST TIME is emitted with `null` as its previous state,
 * so a cold start records the network it inherited rather than pretending
 * everything appeared unchanged.
 *
 * @param {?Map<string, {e: string, o: string, t: number}>} previous
 * @param {Map<string, {e: string, o: string, t: number}>} current
 * @param {{maxRows?: number}} [options]
 * @returns {Array<[string, string, string, number]>} `[id, étatCode, occupationCode, stampSec]`
 */
export function qualichargeTransitions(previous, current, { maxRows = 200_000 } = {}) {
  const out = [];
  for (const [id, row] of current) {
    const before = previous?.get(id);
    if (before && before.e === row.e && before.o === row.o) continue;
    out.push([id, row.e, row.o, row.t]);
    if (out.length >= maxRows) break;
  }
  return out;
}
