/**
 * @module comptagesFeed
 *
 * The reading of the only French road dataset that has actually COUNTED a
 * vehicle — Paris's own permanent counting loops, and the 27 772 889 hourly
 * readings they have published.
 *
 * ── Why this exists next to two road layers that already draw Paris ─────────
 * `traffic.js` is TomTom flow: bring-your-own-key, and on a keyless build its
 * own header says it runs a SIMULATION — "white dots at hardcoded per-road-class
 * speeds". `roadStatusFrance.js` is DATEX II incident reporting from the DIR,
 * and its own header says "Île-de-France has no publisher at all". Neither has
 * ever counted a vehicle inside Paris. This one publishes `q`, whose field
 * description is verbatim *"Débit (nombre de véhicules comptés pendant
 * l'heure)"* — an integer of cars, on a named arc of a named street, keyless,
 * ODbL, since 1996-10-03 (the oldest `date_debut` in the current hour).
 *
 * ── It is NOT live. It is J-2, and the layer says so on every surface ───────
 * Measured 2026-09-01T21:02Z: `metas.default.data_processed` =
 * 2026-09-01T01:02:50+00:00, `dcat.accrualperiodicity` = Quotidienne,
 * `dcat.granularity` = Horaire — and `max(t_1h)` = 2026-08-30T22:00:00+00:00,
 * i.e. 2026-08-31T00:00+02:00 Paris, the closing stamp of local Sunday
 * 2026-08-30. A nightly batch that lands the day before yesterday, ~46 h behind
 * the wall clock. The word "live" never appears in this layer.
 *
 * ── So the edition is a WEEK, discovered and floored ────────────────────────
 * A J-2 feed has no "now" worth drawing, and one hour of a Tuesday is a fact
 * about that Tuesday. The unit is therefore the last COMPLETE Monday–Sunday
 * local week: `newestComptagesWeek()` reads `max(t_1h)`, drops the day in
 * progress, walks back to the last Sunday, and refuses anything older than
 * `COMPTAGES_WEEK_FLOOR` — the week this module was measured against. A
 * discovery older than the floor is a malformed answer, not a new fact.
 * Measured on that week (2026-08-24 → 2026-08-30): 2 977 arcs × 168 h =
 * **500 136 rows, every arc with exactly 168** — no gaps, no decay.
 *
 * ── The fold IS the hour cursor's axis, and it is 48 slots, not 168 ─────────
 * `comptagesParis.js` now lets a reader scrub the hour, and what it scrubs is
 * exactly what this module builds: `wq` and `eq`, two 24-hour profiles of means
 * per arc. That is 48 published values per arc and NOT the 168 individual hours
 * of the week, and the difference is a claim about the data that has to be
 * stated rather than implied by a control:
 *
 *   • a slot is a mean over the FIVE weekdays or the TWO weekend days, so it
 *     describes a typical Tuesday-ish hour and never a particular Tuesday.
 *     Every label downstream says "type" for that reason.
 *   • the mean is taken over the hours that REPORTED, which is what `nq`/`nk`
 *     are for: of the 71 448 weekday cells, 37 062 carry all five days, 29 979
 *     carry none, and 4 407 (6.17 %) are partial. A cell built from one Tuesday
 *     is not marked differently from one built from five, and that is the
 *     coarsest thing this feed does — the card prints the reported-hour totals
 *     (`hq`, `hk`) so the reader can see how thin a profile is.
 *   • a slot with no reporting day at all stays `null`, never 0, all the way to
 *     the renderer, which draws it as its own dash. See Trap 3.
 *
 * Publishing the 168 raw hours instead would cost 3.5x the payload to answer a
 * question — "what happened on Wednesday the 26th at 18 h" — that a J-2 weekly
 * batch is the wrong instrument for anyway.
 *
 * ── The five upstream calls, and why there are five ─────────────────────────
 * 1. `records?select=max(t_1h)` — the edition. ~100 B, 0.27 s.
 * 2. `exports/geojson?where=t_1h=<week's last stamp>` — geometry AND names in
 *    one shot. 1 668 654 B raw, **346 713 B on the wire with gzip**, 2 977
 *    features, 2 977 distinct `iu_ac`, zero duplicates, 2 946 LineStrings.
 * 3–4. eight `group_by=iu_ac,hour(t_1h)` calls, four per day-type, six hours of
 *    the clock each. 71 448 cells per day-type, 142 896 in all, 10 248 946 B,
 *    1.06–2.68 s per call.
 * 5. `group_by=iu_ac,etat_barre` over the week — 3 843 rows, 204 875 B, 0.71 s.
 *
 * ── Trap 1: the geometry does NOT come from the referential ─────────────────
 * The obvious source is `referentiel-comptages-routiers`, and it is the wrong
 * one. Measured 2026-09-01: 3 739 rows for **3 348 distinct `iu_ac`** — 338 ids
 * repeated, with no usable tiebreak (`date_fin` maxes at 2023-01-01 on 3 303 of
 * them while those same arcs are demonstrably still counting in 2026). It also
 * misses 31 of the arcs that ARE counting, and carries 402 that are not.
 * The counts export carries its own `geo_shape` on every row: 2 977 features
 * for 2 977 distinct ids, one row per arc, fresher, and 0.27 s against 7.7 s.
 * So geometry is taken from the measurement itself and the referential is not
 * fetched at all.
 *
 * ── Trap 2: 31 arcs count from nowhere, and NOTHING can place them ──────────
 * 31 of the 2 977 features have `"geometry": null`. They are exactly the 31
 * whose `date_debut` AND `date_fin` are also null — rows the referential never
 * received — and I checked all 31 against the full 3 739-row referential
 * export: **0 are present, 0 have a geometry**. 19 of them are actively
 * measuring (15 both flow and occupancy, 3 flow only, 1 occupancy only) on real
 * named streets — Bd_Magenta, Bd_Malesherbes, Av_Kleber, Pl_de_la_Nation. They
 * are counted and named in `unplaced`, and never placed at a centroid.
 *
 * ── Trap 3: `q = 0` is a MEASUREMENT and `q = null` is not ──────────────────
 * Over the 500 136 rows of the week, `q = 0` on **234** and `q` is null on
 * **218 707**. An `avg(q) ?? 0` would convert 218 707 unmeasured hours into
 * measured zeroes at a ratio of 935 : 1, and paint 1 247 dead loops as empty
 * roads. Every profile slot here is `null` or a number, never a coerced zero,
 * and the card draws them through `textSparkline`, whose whole thesis is that a
 * gap is `·` and never `▁`.
 *
 * ── Trap 4: `etat_trafic` is a pure function of `k`, so it is not a colour ───
 * The field description publishes the thresholds (Fluide 0 ≤ K < 15 %,
 * Pré-saturé 15–30, Saturé 30–50, Bloqué ≥ 50). I tested the derivation seven
 * ways over all 500 136 rows and found **zero counter-examples**: `Inconnu`
 * appears on exactly the 209 874 rows where `k` is null, and each band matches
 * its interval exactly. So the city's own colour field carries nothing the
 * occupancy does not — and it says nothing whatever about the vehicle count:
 * it reads `Inconnu` on 51 241 rows that DO carry one. It is reported on the
 * card as the operator's own reading and is never this layer's colour.
 *
 * ── Trap 5: the ODSQL surface ───────────────────────────────────────────────
 * • An alias declared in BOTH `select` and `group_by` is HTTP 400 *"Alias 'd'
 *   is declared several times"*. Declared in `group_by` only, it still comes
 *   back in the results — which is why `COMPTAGES_PROFILE_SELECT` has no `h`.
 * • Grouped queries cap at **offset + limit ≤ 30 000** (HTTP 400
 *   `InvalidRESTParameterError` at 100 000). 2 977 × 24 = 71 448 cells cannot
 *   be paged, so the profile is split on `hour(t_1h)` in the WHERE clause
 *   instead — which works, and gives 17 862 cells a call.
 * • `date'…'` literals are day-granular with a bare date and hour-granular with
 *   a full timestamp: `t_1h > date'2026-08-29'` skips the whole of the 29th.
 *   Every window here carries a full `THH:MM:SS`.
 * • `&timezone=Europe/Paris` shifts `hour(t_1h)` in `group_by` AND in `where`,
 *   verified against the same arc read both ways (+2 h in August). Without it
 *   every rush hour sits two hours early in summer.
 * • `t_1h` is the END of the hour ("fin de la période d'élaboration"), so the
 *   09:00 stamp is 08:00–09:00 traffic. `COMPTAGES_HOURS` re-keys every profile
 *   onto the hour that was MEASURED.
 * • A grouped response's `total_count` echoes the rows returned, not the number
 *   of groups. It is never read as a cardinality here.
 *
 * ── Trap 6: the phantom arc ─────────────────────────────────────────────────
 * One record has `iu_ac = "*"` and every other field null, including `t_1h`.
 * It surfaces in an UNFILTERED `group_by=iu_ac` (2 989 buckets against 2 977)
 * and is dropped by any `where` on `t_1h` — but `projectComptagesArcs` refuses
 * it by name anyway, because a filter that only works by accident is not one.
 *
 * Dependency-free and side-effect-free (no Cesium, no DOM) so it runs
 * identically in the browser, in the Vite dev-server proxy and under
 * `node --test`.
 */

/** Portal. Same Opendatasoft v2.1 API the ODRÉ and MESR layers already speak. */
export const COMPTAGES_PORTAL = 'opendata.paris.fr';

/** The measurement. 27 772 889 rows, read twice on 2026-09-01. */
export const COMPTAGES_DATASET = 'comptages-routiers-permanents';

/**
 * The referential, named but deliberately NOT fetched — see Trap 1.
 * 3 739 rows for 3 348 distinct ids, 402 of them never seen in the week.
 */
export const COMPTAGES_REFERENTIAL = 'referentiel-comptages-routiers';

/** Attribution carried on every payload (see DATA_SOURCES.md). */
export const COMPTAGES_SOURCE = 'Comptages routiers — capteurs permanents, '
  + 'Direction de la Voirie et des Déplacements, Ville de Paris (opendata.paris.fr)';

/**
 * ODbL, read from `metas.default.license` / `license_url` on 2026-09-01.
 * `metas.default.attributions` is null, so ODbL's own notice is the whole
 * requirement — and this repo already carries the share-alike wording on its
 * IDFM credit.
 */
export const COMPTAGES_LICENCE = 'Open Database License (ODbL)';
export const COMPTAGES_LICENCE_URL = 'http://opendatacommons.org/licenses/odbl/';

/**
 * The publisher's own timezone, from `metas.default.timezone`.
 *
 * Passed on EVERY request. It moves `hour(t_1h)` in both `group_by` and
 * `where`, so without it the profile is a UTC one and August's evening peak
 * lands at 16:00.
 */
export const COMPTAGES_TIMEZONE = 'Europe/Paris';

/**
 * Oldest week this module will accept, and the one every number above was
 * measured on: Monday 2026-08-24 → Sunday 2026-08-30.
 */
export const COMPTAGES_WEEK_FLOOR = '2026-08-24';

/** 24 measured hours, keyed on the hour that STARTS them. */
export const COMPTAGES_HOURS = 24;

/**
 * Six hours of the clock per grouped call.
 *
 * 2 977 × 6 = 17 862 cells, comfortably inside the 30 000 ceiling with room for
 * the network to grow by two thirds before a block has to be split again.
 */
export const COMPTAGES_HOUR_BLOCKS = Object.freeze([
  Object.freeze([0, 6]), Object.freeze([6, 12]),
  Object.freeze([12, 18]), Object.freeze([18, 24]),
]);

/** Grouped-query page size. The hard server ceiling is offset + limit ≤ 30 000. */
export const COMPTAGES_GROUP_LIMIT = 20_000;

/**
 * Aggregates asked of each (arc × hour) cell.
 *
 * `avg(q)` and `avg(k)` are the shape of the day; `count(q)` and `count(k)` are
 * how much of it was actually measured, and they are what stops a mean over one
 * Tuesday being read as a mean over five weekdays. Measured over the weekday
 * window: of 71 448 cells, 37 062 carry all 5 days, 29 979 carry none, and
 * **4 407 (6.17 %) are partial** — so the distinction is not theoretical.
 *
 * `h` is NOT declared here. It is the `group_by` alias, and declaring it twice
 * is the HTTP 400 in Trap 5.
 */
export const COMPTAGES_PROFILE_SELECT = 'avg(q) as f,avg(k) as o,count(q) as nq,count(k) as nk';

/** The two-key grouping the profile rides on. */
export const COMPTAGES_PROFILE_GROUP_BY = 'iu_ac,hour(t_1h) as h';

/** The open/closed/invalid grouping. 3 843 rows over the measured week. */
export const COMPTAGES_BARRE_GROUP_BY = 'iu_ac,etat_barre';

/**
 * `etat_barre` labels → one-character codes.
 *
 * The field description documents integers (`0=inconnu; 1=ouvert; 2=barré;
 * 3=Invalide`) and the API returns FRENCH WORDS. Measured over the week:
 * Ouvert 357 679 · Invalide 128 729 · Barré 13 728 = 500 136, and `0`/`inconnu`
 * never appears. Coding against the documented integers finds nothing.
 */
export const COMPTAGES_BARRE_CODES = Object.freeze({
  Ouvert: 'o',
  Barré: 'b',
  Barre: 'b',
  Invalide: 'i',
});

/** The junk group. See Trap 6. */
export const COMPTAGES_PHANTOM_ARC = '*';

/** Coordinate precision. 5 decimals is ~1.1 m at this latitude. */
export const COMPTAGES_COORD_DECIMALS = 5;

// --- Dates ------------------------------------------------------------------

const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/** `YYYY-MM-DD` → epoch ms at UTC midnight, or NaN. Calendar maths only. */
function dayValue(iso) {
  const match = ISO_DATE.exec(String(iso || ''));
  if (!match) return NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** epoch ms → `YYYY-MM-DD`. */
function dayIso(value) {
  return new Date(value).toISOString().slice(0, 10);
}

/**
 * Shift a `YYYY-MM-DD` by whole days.
 * @param {string} iso
 * @param {number} days
 * @returns {?string}
 */
export function comptagesShiftDay(iso, days) {
  const value = dayValue(iso);
  if (!Number.isFinite(value)) return null;
  return dayIso(value + days * DAY_MS);
}

/**
 * The last complete Monday–Sunday Paris week at a given `max(t_1h)`.
 *
 * The stamp is the END of an hour, so the local calendar date it carries always
 * belongs to a day that is still in progress (or has just closed at midnight);
 * either way the last COMPLETE local day is that date minus one, and the week
 * is the last Sunday at or before it. Purely calendar arithmetic on the local
 * ISO string — the offset is never re-interpreted, because parsing
 * `2026-08-31T00:00:00+02:00` through a Date in a UTC process would silently
 * move the day back to the 30th.
 *
 * @param {?string} maxStamp Local ISO stamp from `max(t_1h)` with
 *   `timezone=Europe/Paris`, e.g. `2026-08-31T00:00:00+02:00`.
 * @param {string} [floor] Oldest acceptable Monday.
 * @returns {{start:string, end:string, discovered:boolean}}
 */
export function newestComptagesWeek(maxStamp, floor = COMPTAGES_WEEK_FLOOR) {
  const floorStart = dayValue(floor);
  const fallback = {
    start: dayIso(floorStart),
    end: dayIso(floorStart + 6 * DAY_MS),
    discovered: false,
  };
  const stamp = dayValue(maxStamp);
  if (!Number.isFinite(stamp)) return fallback;

  const lastComplete = stamp - DAY_MS;
  // getUTCDay(): 0 = Sunday. Walk back to it, then back six more for Monday.
  const sunday = lastComplete - (new Date(lastComplete).getUTCDay() % 7) * DAY_MS;
  const start = sunday - 6 * DAY_MS;
  // A discovery older than the floor is a malformed answer, not a new fact.
  if (!(start >= floorStart)) return fallback;
  return { start: dayIso(start), end: dayIso(sunday), discovered: true };
}

/**
 * The three windows one week is read through, plus the stamp the geometry
 * export is pinned to.
 *
 * Every bound is a FULL timestamp, because a bare `date'…'` literal is
 * day-granular and would silently swallow or skip a whole day (Trap 5). The
 * bounds are shifted one hour forward against the measured day they describe,
 * because `t_1h` closes its hour: the stamps `Mon 01:00 … Sat 00:00` are
 * exactly the 120 hours measured from Monday 00:00 to Friday 24:00. Verified
 * against one arc: 120 rows for the weekday window, 48 for the weekend, 168 for
 * the week.
 *
 * @param {{start:string, end:string}} week
 * @returns {{week:{from:string,to:string}, weekday:{from:string,to:string},
 *   weekend:{from:string,to:string}, stamp:string, hours:number}}
 */
export function comptagesWeekWindows(week) {
  const start = week?.start;
  const end = week?.end;
  const saturday = comptagesShiftDay(start, 5);
  const monday = comptagesShiftDay(end, 1);
  const open = (day) => `${day}T01:00:00`;
  const close = (day) => `${day}T00:00:00`;
  return {
    week: { from: open(start), to: close(monday) },
    weekday: { from: open(start), to: close(saturday) },
    weekend: { from: open(saturday), to: close(monday) },
    stamp: close(monday),
    hours: 168,
  };
}

/** `where` for one window, optionally narrowed to a block of the local clock. */
export function comptagesWindowWhere(window, block = null) {
  const clause = `t_1h>=date'${window.from}' and t_1h<=date'${window.to}'`;
  if (!Array.isArray(block)) return clause;
  return `${clause} and hour(t_1h)>=${block[0]} and hour(t_1h)<${block[1]}`;
}

/** `where` pinning the geometry export to the week's closing hour. */
export function comptagesStampWhere(stamp) {
  return `t_1h=date'${stamp}'`;
}

// --- Values -----------------------------------------------------------------

/** Trimmed string, or null. */
function str(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

/** Finite number, or null. Never coerces a null to 0 — see Trap 3. */
function num(value) {
  const parsed = typeof value === 'string' ? Number(value.trim()) : value;
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A published `libelle`, made readable.
 *
 * The city writes street names with underscores and WITHOUT accents —
 * `Quai_de_la_Megisserie`, not *Quai de la Mégisserie*. The underscores are
 * removed because they are punctuation the publisher used for a filename; the
 * missing accents are LEFT MISSING, because restoring them would mean guessing
 * at 892 street names and the map would then be showing something nobody
 * published. 2 540 of the 2 977 names carry an underscore and 437 already carry
 * spaces, so both shapes arrive from the same column.
 *
 * Four of them are not street names at all but junction pairs —
 * `CF1424->CF0181`, `Place Dauphine->CF1994`, `1711->4` — and all four are
 * among the 31 arcs with no geometry. They are passed through unchanged: an
 * operator reading `CF1424->CF0181` on a card has been told the truth about
 * what the publisher wrote.
 */
export function comptagesArcName(libelle) {
  const text = str(libelle);
  if (!text) return null;
  return str(text.replace(/_/g, ' ').replace(/\s+/g, ' '));
}

/**
 * A `geo_shape` LineString from the counts export, as `[lon, lat]` pairs.
 *
 * Refuses anything that is not a LineString and anything under two vertices: a
 * one-point "line" is not an arc, and drawing it as a stub would invent an
 * extent. Measured over the 2 946 placed arcs: 2 229 are bare two-vertex chords
 * (75.7 %), the tail runs to 15 vertices, 7 449 vertices in all, 537.5 km, and
 * zero are degenerate.
 */
export function comptagesLine(geometry) {
  const coords = geometry?.type === 'LineString' ? geometry.coordinates : null;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const out = [];
  for (const point of coords) {
    const lon = num(Array.isArray(point) ? point[0] : null);
    const lat = num(Array.isArray(point) ? point[1] : null);
    if (lon === null || lat === null) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    out.push([
      Number(lon.toFixed(COMPTAGES_COORD_DECIMALS)),
      Number(lat.toFixed(COMPTAGES_COORD_DECIMALS)),
    ]);
  }
  return out.length >= 2 ? out : null;
}

/** An empty 24-slot profile. `null` everywhere, never 0. */
function emptyProfile() {
  return {
    q: new Array(COMPTAGES_HOURS).fill(null),
    k: new Array(COMPTAGES_HOURS).fill(null),
    nq: new Array(COMPTAGES_HOURS).fill(0),
    nk: new Array(COMPTAGES_HOURS).fill(0),
  };
}

/**
 * Fold the grouped `(iu_ac, h)` cells of one day-type into per-arc profiles.
 *
 * The re-keying is the point: `h` is `hour(t_1h)` and `t_1h` CLOSES its hour,
 * so the cell tagged `h` describes the traffic of hour `h - 1`. Every profile
 * in this module is indexed by the hour that was measured, so slot 18 is
 * 18:00–19:00 and the card can say "pointe à 18 h" and mean it.
 *
 * @param {Array<object>} rows Rows of one or more grouped responses.
 * @returns {Map<string, {q:Array, k:Array, nq:Array, nk:Array}>}
 */
export function indexComptagesProfile(rows) {
  const index = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const arc = str(row?.iu_ac);
    if (!arc || arc === COMPTAGES_PHANTOM_ARC) continue;
    const stampHour = num(row?.h);
    if (stampHour === null) continue;
    const slot = ((Math.trunc(stampHour) + COMPTAGES_HOURS - 1) % COMPTAGES_HOURS
      + COMPTAGES_HOURS) % COMPTAGES_HOURS;
    let profile = index.get(arc);
    if (!profile) {
      profile = emptyProfile();
      index.set(arc, profile);
    }
    profile.q[slot] = num(row?.f);
    profile.k[slot] = num(row?.o);
    profile.nq[slot] = num(row?.nq) || 0;
    profile.nk[slot] = num(row?.nk) || 0;
  }
  return index;
}

/**
 * Fold the grouped `(iu_ac, etat_barre)` cells into one declared state per arc.
 *
 * The DOMINANT state over the week, not the latest: an arc whose loop failed on
 * Wednesday is not a different installation on Thursday. Measured over the
 * week, cross-tabulated against what each arc actually published — this is the
 * finding the layer is built on:
 *
 *   counted (1 730)   Ouvert 1 678 · Barré  46 · Invalide  6
 *   occupancy (356)   Ouvert   348 · Barré   4 · Invalide  4
 *   silent (891)      Ouvert   141 · Barré  26 · **Invalide 724**
 *
 * So four fifths of the silence is a sensor the city has already written off,
 * and 141 arcs are declared OPEN and still say nothing for 168 hours. Those are
 * two different kinds of nothing and the card keeps them apart.
 *
 * @param {Array<object>} rows
 * @returns {Map<string, {code:string, hours:number}>}
 */
export function indexComptagesBarre(rows) {
  /** @type {Map<string, {code:string, hours:number}>} */
  const index = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const arc = str(row?.iu_ac);
    if (!arc || arc === COMPTAGES_PHANTOM_ARC) continue;
    const code = COMPTAGES_BARRE_CODES[str(row?.etat_barre)] || null;
    if (!code) continue;
    const hours = num(row?.n) || 0;
    const current = index.get(arc);
    if (!current || hours > current.hours) index.set(arc, { code, hours });
  }
  return index;
}

/** Mean of the measured slots, or null when nothing was measured. */
export function comptagesProfileMean(values) {
  let sum = 0;
  let seen = 0;
  for (const value of Array.isArray(values) ? values : []) {
    if (!Number.isFinite(value)) continue;
    sum += value;
    seen += 1;
  }
  return seen ? sum / seen : null;
}

/** Sum of a count array. */
function total(values) {
  let sum = 0;
  for (const value of Array.isArray(values) ? values : []) {
    if (Number.isFinite(value)) sum += value;
  }
  return sum;
}

/** Round to whole vehicles, keeping a measured 0 as 0 and a null as null. */
function whole(value) {
  return Number.isFinite(value) ? Math.round(value) : null;
}

/** Round an occupancy percentage to one decimal. */
function tenth(value) {
  return Number.isFinite(value) ? Number(value.toFixed(1)) : null;
}

/** A profile that measured nothing at all is shipped as `null`, not as zeros. */
function shipProfile(values, round) {
  const out = values.map(round);
  return out.some((value) => value !== null) ? out : null;
}

// --- Projection -------------------------------------------------------------

/**
 * Build the whole layer from the five upstream answers.
 *
 * The finished pack — 2 977 arcs, each with its polyline, its street name, both
 * ends of the arc, two 24-hour flow profiles, two 24-hour occupancy profiles,
 * its reported-hour counts and its declared state — measures **1 374 229 bytes
 * raw and 305 551 gzipped**, built and weighed rather than estimated. That is
 * why this layer has ONE regime: it is barely half of what `sup-fr` already
 * ships whole (0.62 MB gzipped) and half of the `schools-fr` maillage
 * (0.63 MB), and the whole of it fits in a box 0.1721° × 0.0896° — 12.6 km by
 * 10.0 km. There is nothing to thin, no national fold to make, and no viewport
 * worth paging.
 *
 * @param {object} options
 * @param {Array<object>} options.features GeoJSON features of the week's last
 *   hour — geometry, names and the operator's own reading.
 * @param {Array<object>} [options.weekday] Grouped weekday cells.
 * @param {Array<object>} [options.weekend] Grouped weekend cells.
 * @param {Array<object>} [options.barre] Grouped `etat_barre` cells.
 * @param {{start:string, end:string, discovered?:boolean}} options.week
 * @param {?string} [options.processedAt] `metas.default.data_processed`.
 * @param {string} [options.source]
 * @returns {object}
 */
export function projectComptagesArcs({
  features,
  weekday = [],
  weekend = [],
  barre = [],
  week,
  processedAt = null,
  source = COMPTAGES_SOURCE,
} = {}) {
  const windows = comptagesWeekWindows(week);
  const weekdayIndex = indexComptagesProfile(weekday);
  const weekendIndex = indexComptagesProfile(weekend);
  const barreIndex = indexComptagesBarre(barre);

  const arcs = [];
  const states = { counted: 0, occupancy: 0, silent: 0 };
  const silentBy = { o: 0, b: 0, i: 0, unknown: 0 };
  let phantom = 0;
  let duplicates = 0;
  let unplaced = 0;
  let unplacedMeasuring = 0;
  let vertices = 0;
  const seen = new Set();

  for (const feature of Array.isArray(features) ? features : []) {
    const props = feature?.properties || {};
    const arc = str(props.iu_ac);
    if (!arc) continue;
    if (arc === COMPTAGES_PHANTOM_ARC) {
      phantom += 1;
      continue;
    }
    if (seen.has(arc)) {
      duplicates += 1;
      continue;
    }
    seen.add(arc);

    const wd = weekdayIndex.get(arc) || emptyProfile();
    const we = weekendIndex.get(arc) || emptyProfile();
    const countedHours = total(wd.nq) + total(we.nq);
    const occupiedHours = total(wd.nk) + total(we.nk);
    // The three states, decided on what the arc PUBLISHED over 168 hours and
    // never on a colour field. `counted` needs one hour with a vehicle count;
    // `occupancy` measured saturation and never a count; `silent` published
    // neither, all week.
    const state = countedHours > 0 ? 'counted' : (occupiedHours > 0 ? 'occupancy' : 'silent');
    states[state] += 1;

    const declared = barreIndex.get(arc) || null;
    if (state === 'silent') silentBy[declared?.code || 'unknown'] += 1;

    const line = comptagesLine(feature?.geometry);
    if (line) vertices += line.length;
    else {
      unplaced += 1;
      if (state !== 'silent') unplacedMeasuring += 1;
    }

    arcs.push({
      a: arc,
      n: comptagesArcName(props.libelle),
      // Both ends of the arc, because 2 977 arcs carry only 892 distinct street
      // names — a mean of 3.3 arcs per name. Without them a card on Rue de
      // Rivoli cannot say WHICH stretch of Rue de Rivoli was clicked.
      f: comptagesArcName(props.libelle_nd_amont),
      t: comptagesArcName(props.libelle_nd_aval),
      g: line,
      s: state,
      b: declared?.code || null,
      bh: declared?.hours ?? null,
      // The colour's number: the arc's typical weekday HOUR, meaned over the
      // hours it reported rather than over 24, so an arc that only counts in
      // the morning is not divided by a night it never measured.
      mq: whole(comptagesProfileMean(wd.q)),
      mk: tenth(comptagesProfileMean(wd.k)),
      hq: countedHours,
      hk: occupiedHours,
      wq: shipProfile(wd.q, whole),
      eq: shipProfile(we.q, whole),
      wk: shipProfile(wd.k, tenth),
      ek: shipProfile(we.k, tenth),
    });
  }

  arcs.sort((a, b) => (b.mq || 0) - (a.mq || 0) || a.a.localeCompare(b.a));

  return {
    arcs,
    count: arcs.length,
    states,
    silentBy,
    placed: arcs.length - unplaced,
    unplaced,
    unplacedMeasuring,
    vertices,
    duplicates,
    phantom,
    week: { start: week?.start || null, end: week?.end || null, discovered: !!week?.discovered },
    windows,
    hours: windows.hours,
    weekdayHours: 120,
    weekendHours: 48,
    processedAt,
    dataset: COMPTAGES_DATASET,
    portal: COMPTAGES_PORTAL,
    licence: COMPTAGES_LICENCE,
    source,
  };
}
