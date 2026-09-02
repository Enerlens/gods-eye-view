/**
 * @module idfmFrequencyFeed
 *
 * How often anything actually stops here, by hour of the day — the reading of
 * Île-de-France Mobilités' own pre-folded service offer.
 *
 * ── The hole this fills, stated as a fact about the repo ────────────────────
 * There is no time-of-day dimension anywhere in this codebase. `transit-fr`
 * decodes live GTFS-Realtime vehicle positions from 148 national feeds and
 * consumes ZERO IDFM data, because IDFM publishes no vehicle positions at all
 * — `transitCoverage.js` measured 0 vehicles in Paris intra-muros against 453
 * in Bordeaux. `idfm-network` draws 37 956 stops and 2 121 lines as a static
 * referential: it can say WHAT serves a stop and never HOW MUCH. And four
 * module headers (`gtfsRealtime.js`, `transitSchedule.js`, `panFeeds.js`,
 * `transitFrance.js`) state that the project deliberately refuses to load
 * `stop_times.txt`. That refusal is right and this file does not overturn it:
 * the IDFM archive's `stop_times.txt` is **71 778 363 bytes compressed and
 * 747 381 712 uncompressed over 8 593 005 rows** (read out of the zip's own
 * central directory on 2026-09-01), which is 3.3× the 223 MB figure those
 * headers already cite as too much. There is also NO `frequencies.txt` in the
 * archive — 14 members, and that is not one of them — so frequency cannot be
 * read there, only counted.
 *
 * ── Why this file exists instead: IDFM already did the fold ─────────────────
 * `offre_hebdomadaire_moyenne_hors_vacances` on IDFM's own Opendatasoft portal
 * publishes the average number of *courses* per stop, per line and per
 * one-hour band, for a typical non-holiday week of 2025. Measured 2026-09-01:
 * **1 311 578 records, 22 fields, Licence Ouverte v2.0 (Etalab)**,
 * `data_processed` 2026-08-18T15:54:55+00:00, `access-control-allow-origin: *`,
 * `x-ratelimit-limit: 1000000` per day. It is a strictly better licence than
 * the GTFS archive, which the PAN labels `mobility-licence` (Licence Mobilités,
 * with declaration obligations), and better than the ODbL 1.0 that
 * `idfm-network`'s stops carry.
 *
 * Cross-checked against a second, independently built IDFM dataset —
 * `20251120_offre_simplifiee`, which holds one single real day (Thursday
 * 20/11/2025) — at Bibliothèque François Mitterrand (`id_arret` 21955, Métro
 * 14): the one-day file counts **427** passages against this file's average
 * Thursday of **424.9**, its 08:00 band **35** against **36.4**, and its 22:00
 * band **12** against **12.0**. Two files, three numbers, within 4%.
 *
 * ── The operating day runs 04:00 → 03:59, so bands run 4..27 ────────────────
 * The publisher's own description says so and `min/max(tranche_horaire)`
 * confirms it: **4 and 27**. Band 24 is 00:00–00:59 and band 25 is 01:00–01:59.
 * Validating `0 ≤ band ≤ 23` would silently delete the entire night service,
 * which is the half of the day that actually separates two addresses — and it
 * is where the biggest signal in the file lives. Region-wide on band 25:
 * **15 904** courses on a Monday against **31 585** on a Friday (+98.6%).
 *
 * ── Why the day axis is seven and not three ─────────────────────────────────
 * A three-day fold (weekday/Saturday/Sunday) is the obvious compression and it
 * destroys two real facts. Measured region-wide, band by band:
 *   - band 12 (noon) is **154 214** on a Wednesday against **143 614** on a
 *     Monday, +7.4% — the French school half-day showing up in the bus network;
 *     band 16 runs the other way, 189 838 against 196 720.
 *   - band 25 (01:00) is **31 585** on a Friday against **15 904** on a Monday.
 * Monday, Tuesday and Thursday really are near-identical (3 066 375 /
 * 3 071 759 / 3 077 377 courses, a 0.36% spread), so five columns would carry
 * almost everything — but then the card has to explain which two days are
 * missing, which is a worse trade than 28% of a 95 KB payload.
 *
 * ── Trap 1: grouping by the stop's NAME splits 273 stops in two ─────────────
 * The obvious query groups by `(id_arret, nom_arret, latitude_arret,
 * longitude_arret, tranche_horaire)`. Enumerated over all 17 `code_departement`
 * buckets, that yields **36 781 identity rows for 36 502 stops**: 273 stops
 * publish two spellings of `nom_arret`, and in all 271 pairs where both rows
 * carry a coordinate the two coordinates are byte-identical (**maximum spread
 * 0.0 m**). So the split is never geographic — it is one stop drawn twice at
 * one point, each dot holding part of the service.
 *
 * The worked case is stop **23613** at 48.82957575668455 / 2.3220761112834034:
 * "Alésia - Général Leclerc" carries **98.5** courses on an average Tuesday and
 * "Les Plantes" **65.2**. Grouped by `id_arret` alone the stop is **163.7**.
 * A map built on the first query shows a reader 60% of their bus service.
 *
 * It cannot be fixed inside the query, because Opendatasoft refuses a text
 * aggregate: `max(nom_arret)` returns HTTP 400 `ODSQLError` — *"StatAggregation
 * only supports numeric or date expression"* — while `max(latitude_arret)` is
 * accepted. So the identity query keeps the name, and `projectFrequencyStops`
 * folds the duplicates here, in code that a test can hold to it, keeping the
 * variant that carries the most service and reporting the others as `aliases`.
 *
 * ── Trap 2: 549 stops have no coordinate, and they are not placed ──────────
 * `latitude_arret` is null on **549 of the 36 502 stops (1.50%)**, and those
 * same 549 are exactly the rows with a null `code_departement` and a null
 * `nom_commune` — the file's null-département bucket is its no-coordinate
 * bucket. **473 of them are Train**, 69 Bus, 7 Tramway, and they carry
 * **84 768 of the 3 071 759 average-Tuesday courses (2.76%)** — they punch
 * well above their 1.5% weight because they are rail.
 *
 * They are counted and named, never placed, and the reason is measured rather
 * than assumed. Against the `arrets` referential the layer next door already
 * draws: 5 of the 549 join `arrets.arrid`, **518 join `arrets.zdaid`** — the
 * stop ZONE rather than the stop point, the same distinction the GTFS makes
 * with `IDFM:monomodalStopPlace:` — and 26 join neither. Of those 518,
 * **512 resolve to two or more distinct platform coordinates**. There is no
 * single published point to borrow, and picking one platform of a station
 * would be inventing a coordinate. The count goes on the card instead.
 *
 * ── Trap 3: the band axis cannot be pivoted, so it costs rows ──────────────
 * Opendatasoft's aggregate grammar takes arithmetic but not conditionals:
 * `sum(nb_courses_mardi*tranche_horaire)` is HTTP 200, while
 * `sum(if(tranche_horaire=8,nb_courses_mardi,0))` is HTTP 400
 * `ODSQLSyntaxError` (*"unexpected ("*), as is `case when` (*"unexpected
 * when"*) and `sum(x*(tranche_horaire=8))` (*"unexpected ="*). So a stop's 24
 * bands are 24 ROWS, and with `offset + limit <= 20000` hard-capped under
 * `group_by` one call buys **833 stops of full profile**. Four calls split on
 * the band axis buy four times that, which is where {@link IDFM_FREQ_MAX_STOPS}
 * comes from.
 *
 * ── Why there is no whole-region pack, unlike `sup-fr` ──────────────────────
 * Measured, not estimated. A 4 km box on Châtelet holds 802 stops and folds to
 * **596 709 bytes raw / 95 168 gzipped** (744 B per stop). The whole region is
 * 35 953 placed stops, so the same product for Île-de-France is **26.7 MB raw
 * and about 4.3 MB gzipped** — 6.9× the entire French higher-education
 * register that `supFrance.js` ships whole (0.62 MB gzipped), for one week of
 * one région. It is a viewport product or it is nothing.
 *
 * Dependency-free and side-effect-free (no Cesium, no DOM) so it runs
 * identically in the browser, in the Vite dev-server proxy, and under
 * `node --test`.
 */

/** Portal the dataset is published on. */
export const IDFM_FREQ_PORTAL = 'data.iledefrance-mobilites.fr';

const ODS_ROOT = `https://${IDFM_FREQ_PORTAL}/api/explore/v2.1/catalog/datasets`;

/**
 * The dataset, and the two siblings deliberately not read.
 *
 * IDFM publishes three weekly offers, all Licence Ouverte 2.0, and the choice
 * between them is a calendar choice rather than a quality one. Measured
 * region-wide on an average Tuesday: term time **3 071 759** courses,
 * school holidays **2 911 632** (−5.2%), summer **2 545 687** (−17.1%); at
 * Paris band 08:00, 46 353 / 44 189 / 37 900. This layer draws the TERM-TIME
 * week — the one a reader deciding where to live is asking about — and says so
 * on the card rather than averaging three regimes into a number that describes
 * no week at all.
 *
 * The two holiday files also carry **21 fields, not 22**: they have no `epci`
 * column, and asking for it is HTTP 400 `ODSQLError` *"Unknown field: epci"*,
 * not a silently ignored `select`. Nothing here selects it, and that is
 * deliberate — the field lists below are valid against all three.
 */
export const IDFM_FREQ_DATASET = 'offre_hebdomadaire_moyenne_hors_vacances';
export const IDFM_FREQ_HOLIDAY_DATASET = 'offre_hebdomadaire_moyenne_vacances_scolaires';
export const IDFM_FREQ_SUMMER_DATASET = 'offre_hebdomadaire_moyenne_vacances_ete';

/** Attribution carried on every payload (see DATA_SOURCES.md). */
export const IDFM_FREQ_SOURCE = 'Offre hebdomadaire moyenne hors vacances — '
  + 'Île-de-France Mobilités (data.iledefrance-mobilites.fr)';

/** Licence of the frequency figures. NOT the ODbL the stop geometry carries. */
export const IDFM_FREQ_LICENCE = 'Licence Ouverte v2.0 (Etalab)';

/**
 * Oldest `data_processed` edition accepted, and the one this file was measured
 * against.
 *
 * The dataset id is stable (unlike `20251120_offre_simplifiee`, whose id is
 * date-stamped and holds a single day), so the edition is not in the id — it is
 * the portal's own `data_processed` timestamp, which is discovered at build
 * time and floored here. An edition OLDER than this is a malformed answer from
 * the portal, not a new fact, and the floor is what stops a bad answer being
 * printed on the card as provenance.
 */
export const IDFM_FREQ_EDITION_FLOOR = '2026-08-18T15:54:55+00:00';

/** The reference year the publisher's own description states for this edition. */
export const IDFM_FREQ_REFERENCE_YEAR = '2025';

// --- The two axes -----------------------------------------------------------

/**
 * The seven day columns, in payload order.
 *
 * This order is LOAD-BEARING: a stop's profile ships as seven arrays in this
 * sequence, because naming the days on every one of 36 502 stops costs 35
 * bytes a stop for information that is a constant. Anything reading a profile
 * reads it through {@link IDFM_FREQ_DAYS}.
 */
export const IDFM_FREQ_DAYS = Object.freeze([
  'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche',
]);

/** Short aliases the aggregate `select` uses, in the same order. */
export const IDFM_FREQ_DAY_ALIASES = Object.freeze([
  'lu', 'ma', 'me', 'je', 've', 'sa', 'di',
]);

/** French labels for the panel and the card. */
export const IDFM_FREQ_DAY_LABELS = Object.freeze({
  lundi: 'Lundi',
  mardi: 'Mardi',
  mercredi: 'Mercredi',
  jeudi: 'Jeudi',
  vendredi: 'Vendredi',
  samedi: 'Samedi',
  dimanche: 'Dimanche',
});

/** One-character chip labels — seven day chips must fit one panel row. */
export const IDFM_FREQ_DAY_CHIPS = Object.freeze({
  lundi: 'L', mardi: 'Ma', mercredi: 'Me', jeudi: 'J', vendredi: 'V',
  samedi: 'S', dimanche: 'D',
});

/**
 * The band axis: 24 one-hour bands over the OPERATING day, 04:00 → 03:59.
 *
 * Not 0..23. `min(tranche_horaire)` is 4 and `max` is 27 over all 1 311 578
 * rows, measured. Band 24 means 00:00–00:59 and band 27 means 03:00–03:59; the
 * publisher numbers them above 23 precisely so they read as the end of an
 * evening rather than the start of a morning.
 */
export const IDFM_FREQ_BAND_MIN = 4;
export const IDFM_FREQ_BAND_MAX = 27;
export const IDFM_FREQ_BAND_COUNT = IDFM_FREQ_BAND_MAX - IDFM_FREQ_BAND_MIN + 1;

/**
 * The band windows the profile query is split across.
 *
 * Four, because `offset + limit <= 20000` is a hard cap under `group_by`
 * (HTTP 400 `InvalidRESTParameterError`, verbatim: *"Invalid value for sum of
 * offset + limit API parameter: 60000 was found but <= 20000 is expected"*)
 * and a stop's profile is one row per band. Six bands per call means one call
 * carries up to 3 333 stops, so four calls comfortably cover
 * {@link IDFM_FREQ_MAX_STOPS} with room for the 0.76% of stops that arrive
 * twice under two names.
 */
export const IDFM_FREQ_BAND_WINDOWS = Object.freeze([
  Object.freeze([4, 9]),
  Object.freeze([10, 15]),
  Object.freeze([16, 21]),
  Object.freeze([22, 27]),
]);

/** Largest `limit` Opendatasoft accepts on a grouped query. */
export const IDFM_FREQ_GROUP_LIMIT = 20_000;

/**
 * Stops one viewport will be answered for.
 *
 * 1 200. Measured on Châtelet (48.8584, 2.3470), the densest part of the
 * network: a 1.2 km box holds 87 stops, 2 km 204, 3 km 435, 4 km 802, 5 km
 * 1 132, 6 km 1 570, 8 km 2 581. So 1 200 is a little over a 5 km box in
 * central Paris and a great deal more than that anywhere else in the région.
 *
 * The ceiling is a bandwidth decision, not an API one: at 4 km the five
 * upstream calls transfer **3 291 332 bytes in 1.84 s** and fold to 95 KB
 * gzipped; at 8 km they transfer **10 249 337 bytes in 3.74 s**. Asking IDFM
 * for ten megabytes so a reader can look at a smear of 2 581 overlapping rings
 * is a bad trade in both directions.
 */
export const IDFM_FREQ_MAX_STOPS = 1_200;

/**
 * Widest box the proxy will consider, degrees per side.
 *
 * 0.6°, which is about 67 km — half the width of the région. Wider than this
 * the answer is always "too many stops", so the layer switches to the
 * département regime without asking.
 */
export const IDFM_FREQ_MAX_BOX_DEG = 0.6;

/** Cache grid the request box is snapped outward onto, degrees (~550 m). */
export const IDFM_FREQ_BOX_STEP_DEG = 0.005;

// --- Vocabulary -------------------------------------------------------------

/**
 * `libelle_mode_ligne` → the vocabulary `idfmFeed.js` already uses.
 *
 * The two IDFM datasets do NOT speak the same mode language: `arrets` publishes
 * lower-case English codes (`bus`, `metro`, `rail`, `tram`, `funicular`,
 * `cableway`) and this one publishes French labels. Counted over the whole
 * region: Bus 34 499 · Métro 805 · Train 599 · Tramway 585 · Funiculaire 4 ·
 * and **10 rows with no mode at all**.
 *
 * Those 10 are not noise. They are exactly the ten Câble C1 stations — Pointe
 * du Lac, Limeil-Brévannes, Valenton, La Végétale and Villa Nova, each in two
 * directions — which `arrets` types `cableway` and which `idfmFeed.js` went to
 * the trouble of naming. This file will not borrow that: a mode the offer
 * dataset does not publish is `unknown` here and says so on the card, because
 * the join that establishes it is not one this module performs at runtime.
 */
export const IDFM_FREQ_MODES = Object.freeze({
  Bus: 'bus',
  'Métro': 'metro',
  Metro: 'metro',
  Train: 'rail',
  Tramway: 'tram',
  Funiculaire: 'funicular',
});

/** French labels for the drawn mode families. */
export const IDFM_FREQ_MODE_LABELS = Object.freeze({
  bus: 'Bus',
  metro: 'Métro',
  rail: 'Train — RER & Transilien',
  tram: 'Tramway',
  funicular: 'Funiculaire',
  unknown: 'Mode non publié',
});

/**
 * The frequency ladder: six steps, each one halving the wait.
 *
 * FIXED thresholds, not quantiles, and that is the single most important
 * presentation decision in this layer. The whole claim is that ONE number moves
 * as you scrub the clock; a quantile ramp recomputed per viewport and per band
 * would repaint the map on every step for reasons that have nothing to do with
 * the service, and a reader could never tell the two apart. A colour here means
 * the same thing in Paris at 08:00 and in Melun at 01:00.
 *
 * The steps double because waiting time halves, which is what a rider actually
 * experiences: 2/h is a half-hour wait, 32/h is under two minutes. The top step
 * is reached by real stops — the busiest single stop in the 08:00 band is Gare
 * de Meaux (Dépose) at **70.1** courses, and Châtelet les Halles still runs
 * **45.5** in the 22:00 band — so the ladder is not open-ended decoration.
 *
 * Level -1 is a stop with a published profile and NO service in the selected
 * band. It is drawn, in grey, because "nothing stops here at this hour" is the
 * answer the layer exists to give and an absent dot would read as missing data.
 */
export const IDFM_FREQ_LEVELS = Object.freeze([2, 4, 8, 16, 32]);

/** French legend labels, one per level, with the headway they mean. */
export const IDFM_FREQ_LEVEL_LABELS = Object.freeze([
  'moins de 2/h — plus de 30 min d’attente',
  '2 à 4/h — 15 à 30 min',
  '4 à 8/h — 7 à 15 min',
  '8 à 16/h — 4 à 7 min',
  '16 à 32/h — 2 à 4 min',
  '32/h et plus — moins de 2 min',
]);

/** Label for the "runs, but not in this band" state. */
export const IDFM_FREQ_SILENT_LABEL = 'aucun passage dans cette tranche';

// --- Small helpers ----------------------------------------------------------

/** Trimmed string, or null. */
function str(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

/**
 * Finite number, or null.
 *
 * The empty string is NOT zero here. `Number('')` is `0`, so the original guard
 * turned a blank `latitude_arret` into a coordinate in the Gulf of Guinea and a
 * blank `tranche_horaire` into band 0; `Number.isFinite` alone does not catch
 * it because the coercion has already happened by the time it runs. Everything
 * that is not a number or a non-blank numeric string is null.
 */
function num(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Round one rate for the wire.
 *
 * One decimal below ten, whole numbers above. The published values carry
 * fifteen significant digits (`11.942857142857143` is a real cell) because they
 * are averages over a year of matching weekdays, and shipping them raw triples
 * the payload for precision nobody can read. Measured on the 802-stop Châtelet
 * box: a flat one decimal is 710 775 bytes raw / 131 730 gzipped, this rule is
 * **596 709 / 95 168** (−28% gzipped), and rounding everything to whole numbers
 * would be 443 163 / 63 080 but would turn a genuine 0.4 courses an hour into
 * nothing at all — which is exactly the number a night-shift reader is looking
 * for.
 *
 * @param {number} value
 * @returns {number}
 */
export function roundRate(value) {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return rate < 10 ? Math.round(rate * 10) / 10 : Math.round(rate);
}

/**
 * Ladder index for one rate: -1 for a silent stop, 0..5 otherwise.
 * @param {number} rate Courses per hour.
 * @returns {number}
 */
export function frequencyLevel(rate) {
  const value = Number(rate);
  if (!Number.isFinite(value) || value <= 0) return -1;
  for (let i = 0; i < IDFM_FREQ_LEVELS.length; i += 1) {
    if (value < IDFM_FREQ_LEVELS[i]) return i;
  }
  return IDFM_FREQ_LEVELS.length;
}

/**
 * The clock face of one band, as the publisher defines it.
 *
 * The guard runs BEFORE the coercion, not after. `Math.trunc(Number(null))` is
 * `0` and `Number.isFinite(0)` is true, so the previous order printed
 * `00:00–00:59` — a real, readable, wrong hour — for a band that does not
 * exist. `null`, `''`, `false` and `[]` all coerce to 0 in JavaScript, so a
 * missing band is exactly the input this must refuse.
 *
 * @param {number} band 4..27
 * @returns {string} e.g. `08:00–08:59`, `01:00–01:59` for band 25, `—` for
 *   anything that is not a number.
 */
export function bandLabel(band) {
  const value = num(band);
  if (value === null) return '—';
  const hour = ((Math.trunc(value) % 24) + 24) % 24;
  return `${String(hour).padStart(2, '0')}:00–${String(hour).padStart(2, '0')}:59`;
}

/** Whether a band is inside the published range. */
export function isFrequencyBand(band) {
  const value = Number(band);
  return Number.isInteger(value) && value >= IDFM_FREQ_BAND_MIN && value <= IDFM_FREQ_BAND_MAX;
}

/**
 * The band this module falls back to when it is given none.
 *
 * 08:00 — the morning peak, the band with the widest spread between stops and
 * the one a reader asking "can I get to work from here" is asking about.
 */
export const IDFM_FREQ_DEFAULT_BAND = 8;

/**
 * Clamp any input onto the published band range.
 *
 * Same coercion trap as {@link bandLabel}: `Number(null)` is 0, so the previous
 * `Number.isFinite(Math.trunc(Number(band)))` accepted `null` and clamped it to
 * band 4 — 04:00, the first hour of the operating day — instead of falling back
 * to the documented default. `undefined` fell back and `null` did not, from the
 * same function, which is the kind of split a card silently inherits.
 */
export function clampBand(band) {
  const value = num(band);
  if (value === null) return IDFM_FREQ_DEFAULT_BAND;
  return Math.min(IDFM_FREQ_BAND_MAX, Math.max(IDFM_FREQ_BAND_MIN, Math.trunc(value)));
}

/**
 * The mean wait a rate implies, in minutes — the number a rider feels.
 *
 * Half the interval, which is the expected wait for a passenger arriving at
 * random against an evenly spaced service. It is stated as an implication of
 * the published rate and never as a measured headway: the file counts courses
 * in an hour, it does not say when in the hour they run.
 *
 * @param {number} rate
 * @returns {?number} Minutes, or null when nothing runs.
 */
export function meanWaitMin(rate) {
  const value = Number(rate);
  if (!Number.isFinite(value) || value <= 0) return null;
  return 30 / value;
}

/**
 * Map a real instant onto the operating day's (day, band) pair.
 *
 * The operating day starts at 04:00, so 01:30 on a Wednesday belongs to
 * TUESDAY's band 25. Getting this backwards moves every night reading onto the
 * wrong day, and Friday night is the one place in this dataset where the day
 * matters most (band 25 is 15 904 on a Monday and 31 585 on a Friday).
 *
 * The caller supplies the Paris wall-clock parts; this function does no time
 * zone work of its own, because a pure module cannot know the viewer's.
 *
 * @param {{hour:number, weekday:number}} parts `weekday` 0=Sunday..6=Saturday.
 * @returns {{day:string, band:number}}
 */
export function operatingSlot({ hour, weekday } = {}) {
  // `num` and not `Number(...)`: a null hour coerces to 0, which is not
  // midnight-as-a-default, it is band 24 on YESTERDAY — a real slot, silently
  // invented out of a missing argument.
  const rawHour = num(hour);
  const rawWeekday = num(weekday);
  const h = rawHour === null ? IDFM_FREQ_DEFAULT_BAND : Math.trunc(rawHour);
  const w = rawWeekday === null ? 2 : Math.trunc(rawWeekday);
  const beforeDawn = h < IDFM_FREQ_BAND_MIN;
  const band = beforeDawn ? h + 24 : h;
  // 0=Sunday in the JS convention; the published columns start at Monday.
  const shifted = beforeDawn ? (w + 6) % 7 : w;
  const index = (shifted + 6) % 7;
  return { day: IDFM_FREQ_DAYS[index], band: clampBand(band) };
}

// --- Query builders ---------------------------------------------------------

/**
 * The bbox predicate.
 *
 * Written as four range comparisons rather than `in_bbox`, because this dataset
 * publishes `longitude_arret`/`latitude_arret` as plain doubles and has no
 * geo-point column at all — `in_bbox` needs one, and only the one-day sibling
 * `20251120_offre_simplifiee` has it. The comparison also does the right thing
 * with the 549 coordinate-less rows: a null fails every range test, so they
 * never reach a viewport, and they are reported by the regional product
 * instead.
 *
 * @param {{south:number, west:number, north:number, east:number}} box
 * @returns {string}
 */
export function frequencyBoxWhere(box) {
  const south = num(box?.south);
  const west = num(box?.west);
  const north = num(box?.north);
  const east = num(box?.east);
  if ([south, west, north, east].some((value) => value === null)) {
    throw new Error('idfm-frequency: bbox bounds must be finite numbers');
  }
  return `latitude_arret>=${south} and latitude_arret<=${north}`
    + ` and longitude_arret>=${west} and longitude_arret<=${east}`;
}

/** The seven aggregate columns, in {@link IDFM_FREQ_DAYS} order. */
function daySelect() {
  return IDFM_FREQ_DAYS
    .map((day, i) => `sum(nb_courses_${day}) as ${IDFM_FREQ_DAY_ALIASES[i]}`)
    .join(',');
}

/** Fields the identity query groups on. */
export const IDFM_FREQ_IDENTITY_FIELDS = Object.freeze([
  'id_arret',
  'nom_arret',
  'nom_commune',
  'code_departement',
  'libelle_mode_ligne',
  'latitude_arret',
  'longitude_arret',
]);

/**
 * The identity query: one row per (stop, published name) inside the box.
 *
 * Asked for FIRST and alone, for two reasons. It is the exact stop count — so
 * a box over the whole of Paris is refused after one cheap call instead of
 * after five expensive ones — and it takes the seven identity columns out of
 * the profile query's `group_by`, which is what makes the profile rows small.
 * Measured on the 4 km Châtelet box: carrying the identity inside the band
 * grouping cost **6 313 751 bytes in 2.66 s**, splitting it costs
 * **3 291 332 bytes in 1.84 s** for the same answer.
 *
 * `limit` is one more than the ceiling on purpose: a full page is the signal
 * that the box is too dense, and it bounds the refusal's own cost.
 *
 * @param {{box:object, dataset?:string, limit?:number}} query
 * @returns {string}
 */
export function buildIdentityUrl({ box, dataset = IDFM_FREQ_DATASET, limit = IDFM_FREQ_MAX_STOPS + 1 } = {}) {
  const fields = IDFM_FREQ_IDENTITY_FIELDS.join(',');
  const params = new URLSearchParams({
    select: fields,
    group_by: fields,
    where: frequencyBoxWhere(box),
    // Without an order the API pages unstably; with it the fold is
    // deterministic and a fixture captured today still matches tomorrow.
    order_by: 'id_arret',
    limit: String(Math.max(1, Math.min(IDFM_FREQ_GROUP_LIMIT, Math.round(limit)))),
  });
  return `${ODS_ROOT}/${dataset}/records?${params}`;
}

/**
 * One band window of the profile query: `(stop, band)` with seven day sums.
 *
 * `between` is not available — `tranche_horaire between 7 and 8` is HTTP 400
 * `ODSQLSyntaxError` *"unexpected between at position 16"* — so the window is
 * written as two comparisons.
 *
 * @param {{box:object, bandLo:number, bandHi:number, dataset?:string}} query
 * @returns {string}
 */
export function buildProfileUrl({ box, bandLo, bandHi, dataset = IDFM_FREQ_DATASET } = {}) {
  const lo = clampBand(bandLo);
  const hi = clampBand(bandHi);
  const params = new URLSearchParams({
    select: `id_arret,tranche_horaire,${daySelect()}`,
    group_by: 'id_arret,tranche_horaire',
    where: `(${frequencyBoxWhere(box)}) and tranche_horaire>=${lo} and tranche_horaire<=${hi}`,
    order_by: 'id_arret',
    limit: String(IDFM_FREQ_GROUP_LIMIT),
  });
  return `${ODS_ROOT}/${dataset}/records?${params}`;
}

/**
 * The regional query: every département's whole week, in one call.
 *
 * 17 buckets × up to 24 bands. Measured: **356 rows, 73 723 bytes, 0.77 s**.
 * That is the entire wide-zoom regime for the price of one request.
 *
 * @param {{dataset?:string}} [query]
 * @returns {string}
 */
export function buildRegionBandsUrl({ dataset = IDFM_FREQ_DATASET } = {}) {
  const params = new URLSearchParams({
    select: `code_departement,tranche_horaire,${daySelect()}`,
    group_by: 'code_departement,tranche_horaire',
    order_by: 'code_departement,tranche_horaire',
    limit: String(IDFM_FREQ_GROUP_LIMIT),
  });
  return `${ODS_ROOT}/${dataset}/records?${params}`;
}

/**
 * One département's stop list, with coordinates.
 *
 * The divisor of the regional regime — a département's departures per hour
 * mean nothing until they are divided by the number of stops they are spread
 * over — and the input to the point-in-polygon cross-check in
 * `idfmFrequencyDepartements.js`.
 *
 * `code_departement` has a NULL bucket and it must be asked for as such:
 * `where=code_departement="None"` returns HTTP 200 with zero rows, silently
 * losing 549 stops, while `where=code_departement is null` returns them.
 *
 * @param {{code:?string, dataset?:string}} query
 * @returns {string}
 */
export function buildRegionStopsUrl({ code, dataset = IDFM_FREQ_DATASET } = {}) {
  const fields = 'id_arret,latitude_arret,longitude_arret';
  const value = str(code);
  const params = new URLSearchParams({
    select: fields,
    group_by: fields,
    where: value ? `code_departement="${value}"` : 'code_departement is null',
    order_by: 'id_arret',
    limit: String(IDFM_FREQ_GROUP_LIMIT),
  });
  return `${ODS_ROOT}/${dataset}/records?${params}`;
}

/** The dataset's metadata document, read for the edition and the licence. */
export function buildMetadataUrl({ dataset = IDFM_FREQ_DATASET } = {}) {
  return `${ODS_ROOT}/${dataset}`;
}

/**
 * Newest edition the portal reports, refusing anything below the floor.
 *
 * @param {object} metadata Body of {@link buildMetadataUrl}.
 * @param {string} [floor]
 * @returns {{edition:string, licence:string, records:?number, discovered:boolean}}
 */
export function newestEdition(metadata, floor = IDFM_FREQ_EDITION_FLOOR) {
  const meta = metadata?.metas?.default || null;
  const published = str(meta?.data_processed);
  // ISO-8601 with a fixed offset compares correctly as a string, and a value
  // that is not an ISO instant must not win by parsing to NaN.
  const usable = published && /^\d{4}-\d{2}-\d{2}T/.test(published) && published >= floor;
  return {
    edition: usable ? published : String(floor),
    discovered: Boolean(usable),
    licence: str(meta?.license) || IDFM_FREQ_LICENCE,
    records: num(meta?.records_count),
  };
}

// --- Projection -------------------------------------------------------------

/** An empty 7 × 24 profile. */
function emptyProfile() {
  return IDFM_FREQ_DAYS.map(() => new Array(IDFM_FREQ_BAND_COUNT).fill(0));
}

/** Normalise one published mode label. */
export function frequencyMode(label) {
  const text = str(label);
  if (!text) return 'unknown';
  return IDFM_FREQ_MODES[text] || 'unknown';
}

/**
 * Total service on one day of a profile.
 * @param {Array<Array<number>>} profile
 * @param {string} day One of {@link IDFM_FREQ_DAYS}.
 * @returns {number}
 */
export function profileDayTotal(profile, day) {
  const index = IDFM_FREQ_DAYS.indexOf(day);
  if (index < 0) return 0;
  const row = profile?.[index];
  if (!Array.isArray(row)) return 0;
  let total = 0;
  for (const value of row) total += Number(value) || 0;
  return total;
}

/**
 * Rate at one (day, band) of a profile.
 * @param {Array<Array<number>>} profile
 * @param {string} day
 * @param {number} band
 * @returns {number}
 */
export function profileRate(profile, day, band) {
  const dayIndex = IDFM_FREQ_DAYS.indexOf(day);
  if (dayIndex < 0) return 0;
  const bandIndex = Math.trunc(Number(band)) - IDFM_FREQ_BAND_MIN;
  if (!(bandIndex >= 0 && bandIndex < IDFM_FREQ_BAND_COUNT)) return 0;
  return Number(profile?.[dayIndex]?.[bandIndex]) || 0;
}

/**
 * The busiest band of one day, and its rate.
 * @param {Array<Array<number>>} profile
 * @param {string} day
 * @returns {?{band:number, rate:number}}
 */
export function profilePeak(profile, day) {
  const index = IDFM_FREQ_DAYS.indexOf(day);
  const row = index >= 0 ? profile?.[index] : null;
  if (!Array.isArray(row)) return null;
  let bestBand = -1;
  let best = 0;
  for (let i = 0; i < row.length; i += 1) {
    const value = Number(row[i]) || 0;
    if (value > best) {
      best = value;
      bestBand = i + IDFM_FREQ_BAND_MIN;
    }
  }
  return bestBand < 0 ? null : { band: bestBand, rate: best };
}

/**
 * The first and last bands of the day that carry any service.
 *
 * The two ends of the service day are what a reader actually asks about — the
 * last train home is a fact about band 25, not about the peak — and they are
 * cheaper to read off a card than a 24-number array.
 *
 * @param {Array<Array<number>>} profile
 * @param {string} day
 * @returns {?{first:number, last:number}}
 */
export function profileSpan(profile, day) {
  const index = IDFM_FREQ_DAYS.indexOf(day);
  const row = index >= 0 ? profile?.[index] : null;
  if (!Array.isArray(row)) return null;
  let first = -1;
  let last = -1;
  for (let i = 0; i < row.length; i += 1) {
    if ((Number(row[i]) || 0) <= 0) continue;
    if (first < 0) first = i + IDFM_FREQ_BAND_MIN;
    last = i + IDFM_FREQ_BAND_MIN;
  }
  return first < 0 ? null : { first, last };
}

/**
 * Fold one viewport's identity rows and band rows into the drawn stop list.
 *
 * The whole trap list is enforced here rather than in the query, because the
 * query cannot enforce it (see the module header): duplicate names are merged
 * on `id_arret`, coordinate-less rows are counted rather than placed, and a
 * profile row for a stop the identity call never returned is dropped rather
 * than drawn at an unknown position.
 *
 * @param {object} input
 * @param {object} input.identity Raw `{total_count, results}` of the identity call.
 * @param {Array<object>} input.profiles One raw envelope per band window.
 * @param {object} [input.box] The box that was asked for, echoed back.
 * @param {number} [input.maxStops]
 * @param {string} [input.edition]
 * @param {string} [input.source]
 * @returns {object}
 */
export function projectFrequencyStops({
  identity,
  profiles = [],
  box = null,
  maxStops = IDFM_FREQ_MAX_STOPS,
  edition = IDFM_FREQ_EDITION_FLOOR,
  source = IDFM_FREQ_SOURCE,
} = {}) {
  const identityRows = Array.isArray(identity?.results) ? identity.results : [];
  const ceiling = Math.max(1, Math.round(Number(maxStops) || IDFM_FREQ_MAX_STOPS));

  /** @type {Map<string, object>} */
  const draft = new Map();
  let unplacedRows = 0;
  const unplacedIds = new Set();
  const unplacedModes = {};

  for (const row of identityRows) {
    const id = str(row?.id_arret);
    if (!id) continue;
    const lat = num(row?.latitude_arret);
    const lon = num(row?.longitude_arret);
    const mode = frequencyMode(row?.libelle_mode_ligne);
    if (lat === null || lon === null) {
      // Counted, named by mode, and NOT placed. See the module header: the
      // only second source that could position these is the stop-zone half of
      // `arrets`, and it answers with several platforms for 512 of the 518
      // that join it at all.
      unplacedRows += 1;
      unplacedIds.add(id);
      unplacedModes[mode] = (unplacedModes[mode] || 0) + 1;
      continue;
    }
    let entry = draft.get(id);
    if (!entry) {
      entry = {
        id,
        names: new Map(),
        commune: str(row?.nom_commune),
        dept: str(row?.code_departement),
        mode,
        lat,
        lon,
        profile: emptyProfile(),
        bandRows: 0,
      };
      draft.set(id, entry);
    }
    const name = str(row?.nom_arret);
    if (name && !entry.names.has(name)) entry.names.set(name, 0);
    entry.commune = entry.commune || str(row?.nom_commune);
    entry.dept = entry.dept || str(row?.code_departement);
    if (entry.mode === 'unknown' && mode !== 'unknown') entry.mode = mode;
  }

  let bandRows = 0;
  let orphanRows = 0;
  let outOfRangeRows = 0;
  const bandsSeen = new Set();

  for (const envelope of Array.isArray(profiles) ? profiles : []) {
    for (const row of Array.isArray(envelope?.results) ? envelope.results : []) {
      bandRows += 1;
      const id = str(row?.id_arret);
      const entry = id ? draft.get(id) : null;
      if (!entry) {
        // A stop the identity call did not return — either coordinate-less or
        // a window the two calls disagree about. It has no position, so it is
        // counted, never drawn.
        orphanRows += 1;
        continue;
      }
      const band = num(row?.tranche_horaire);
      if (band === null || !isFrequencyBand(band)) {
        outOfRangeRows += 1;
        continue;
      }
      bandsSeen.add(band);
      const slot = band - IDFM_FREQ_BAND_MIN;
      entry.bandRows += 1;
      for (let d = 0; d < IDFM_FREQ_DAYS.length; d += 1) {
        const value = num(row?.[IDFM_FREQ_DAY_ALIASES[d]]) || 0;
        entry.profile[d][slot] += value;
      }
    }
  }

  const stops = [];
  const byMode = {};
  let silentIn = 0;
  let weekTotal = 0;
  let named = 0;
  let aliased = 0;

  for (const entry of draft.values()) {
    // The LONGEST published spelling wins, ties broken alphabetically, so the
    // choice is reproducible across builds and across machines.
    //
    // It is deliberately not "the name carrying the most service", which is
    // what an earlier draft of this comment claimed and no query here can
    // deliver: the identity call groups on the seven identity fields and
    // selects no sums, so per-NAME service is not a number this module ever
    // holds. For stop 23613 the file publishes "Alésia - Général Leclerc" and
    // "Les Plantes"; the longer one is also the one signed on the pole, and the
    // loser rides along as an alias rather than being deleted, because both are
    // real names a rider might be searching for.
    let total = 0;
    for (let d = 0; d < IDFM_FREQ_DAYS.length; d += 1) {
      for (const value of entry.profile[d]) total += value;
    }
    weekTotal += total;

    const names = [...entry.names.keys()].sort((a, b) => b.length - a.length || a.localeCompare(b, 'fr'));
    const profile = entry.profile.map((row) => row.map(roundRate));
    const stop = {
      id: entry.id,
      name: names[0] || null,
      aliases: names.length > 1 ? names.slice(1) : null,
      commune: entry.commune,
      dept: entry.dept,
      mode: entry.mode,
      lat: Number(entry.lat.toFixed(6)),
      lon: Number(entry.lon.toFixed(6)),
      profile,
      // Bands the file actually publishes for this stop. A stop with 22 of 24
      // is not truncated — it simply has no service at 03:00.
      bands: entry.bandRows,
      week: Math.round(total),
    };
    if (names.length > 1) aliased += 1;
    if (names.length) named += 1;
    byMode[entry.mode] = (byMode[entry.mode] || 0) + 1;
    if (entry.bandRows === 0) silentIn += 1;
    stops.push(stop);
  }

  // Busiest first, so a payload that ever had to be cut keeps the stops a
  // reader would keep. Ties on id, so the order is stable across builds.
  stops.sort((a, b) => b.week - a.week || a.id.localeCompare(b.id));
  const drawn = stops.slice(0, ceiling);

  return {
    stops: drawn,
    count: drawn.length,
    // The exact number of stops with a coordinate in this box, before the
    // ceiling. `tooDense` is the caller's decision, not this function's.
    stopsInBox: draft.size,
    refused: Math.max(0, draft.size - drawn.length),
    unplaced: unplacedIds.size,
    unplacedRows,
    unplacedModes,
    aliased,
    named,
    byMode,
    silent: silentIn,
    bandRows,
    orphanRows,
    outOfRangeRows,
    bandsSeen: [...bandsSeen].sort((a, b) => a - b),
    week: Math.round(weekTotal),
    box: box ? { ...box } : null,
    dataset: IDFM_FREQ_DATASET,
    edition,
    year: IDFM_FREQ_REFERENCE_YEAR,
    licence: IDFM_FREQ_LICENCE,
    source,
  };
}
