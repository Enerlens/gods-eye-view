/**
 * @module idfmFrequency
 *
 * Fréquence des transports (IDFM) — how often anything actually stops here, at
 * the hour you are asking. The first time-of-day dimension in this repo.
 *
 * ── The hole, stated as a fact about this codebase ──────────────────────────
 * THERE IS NO TIME-OF-DAY DIMENSION ANYWHERE IN GOD'S EYE VIEW. `transit-fr`
 * is live GTFS-Realtime over 148 national feeds and it consumes ZERO IDFM data,
 * because IDFM publishes no vehicle positions at all — `transitCoverage.js`
 * measured 0 vehicles in Paris intra-muros against 453 in Bordeaux.
 * `idfm-network` draws 37 956 stops and 2 121 lines as a static referential: it
 * can say WHAT serves a stop and never HOW MUCH. And four module headers —
 * `gtfsRealtime.js:16`, `transitSchedule.js:27`, `panFeeds.js:59`,
 * `transitFrance.js:64` — state that the project deliberately refuses to load
 * `stop_times.txt`. So "how often does anything stop here at 08:00 versus
 * 22:00" is, today, unanswerable on this globe. For a property-oriented fork it
 * is the number that decides.
 *
 * The refusal stands. `idfmFrequencyFeed.js` re-measured the archive it refers
 * to: IDFM's `stop_times.txt` is 71 778 363 bytes compressed and 747 381 712
 * uncompressed over 8 593 005 rows, and there is no `frequencies.txt` in the
 * zip at all. This layer never opens it. IDFM already published the fold.
 *
 * ── Why a SEPARATE row rather than a panel on `idfm-network` ────────────────
 * The overlap is heavy, deliberate and worth stating before the case for the
 * row. Same publisher, same portal, the same stops: measured 2026-09-02 against
 * the 37 956-row `arrets` referential `idfm-network` draws, **34 903 of this
 * layer's 36 502 stops (95.6 %) join on `arrets.arrid`**, another 518 join on
 * `zdaid` — the stop ZONE rather than the stop point — for **97.0 % in all**,
 * and 1 081 join neither. Nearly every dot this layer draws is already on
 * screen when `idfm-network` (share token `if`) is on. Four things still
 * separate them, and none of them is cosmetic:
 *
 *  1. TWO LICENCES, NOT ONE. `idfm-network`'s stops are ODbL 1.0 with
 *     share-alike (DATA_SOURCES.md line 78). These figures are Licence Ouverte
 *     v2.0 (Etalab) — verified on the portal's own metadata, 2026-09-02. One
 *     toggle would carry one credit line for two licences with different
 *     obligations. This layer ships its own.
 *  2. A RATE IS NOT A REFERENTIAL. What is drawn here CHANGES when a chip is
 *     pressed; a referential never does. A single row whose name said "réseau"
 *     and whose map re-coloured on the hour would be two layers wearing one
 *     toggle — and one share token could not express "the network, without the
 *     hour", which is exactly what `if` means today.
 *  3. NEITHER SET CONTAINS THE OTHER. The referential holds 37 956 stops, the
 *     offer 36 502. **3 053 referential stops (8.0 %) have no offer row at
 *     all** — 1 897 rail, 1 109 bus, 35 tram, 12 métro — and 549 offer stops
 *     (1.50 %) have no coordinate and cannot be drawn by either. Folding them
 *     into one layer would have to pick one count to display, and 1 599 stops
 *     would be on the wrong side of it whichever it picked.
 *  4. THE GATES ARE INCOMPATIBLE. `idfm-network` asks for at most 100 stops in
 *     boxes up to 1° and turns on below 20 000 m; this one draws up to 1 200
 *     stops and needs five upstream calls per box. Merging them would impose
 *     one cadence on two products with a 12× difference in payload.
 *
 * ── Stacked on the same coordinate: measured, then designed around ──────────
 * Both layers on means two marks per stop at one point, so the composition is
 * the design, not an afterthought. Measured over the 805 stops in the 4 km
 * Châtelet box, 2026-09-02: median nearest-neighbour distance **24.2 m**, p10
 * 8.9 m, **463 stops with a neighbour inside 30 m** and 139 inside 10 m, and 7
 * of the 805 sharing an exact coordinate with another stop. Three consequences,
 * all of them visible in the code below:
 *
 *  • SIZE IS SMALL AND BOUNDED. 4.5 px silent to 13.0 px at 32 departures an
 *    hour — strictly under `idfm-network`'s SMALLEST pictogram (14 px bus;
 *    métro and rail are 24 px). The rate disc therefore sits INSIDE the mode
 *    glyph rather than fighting it, and at the density above a bigger disc
 *    would be a smear rather than a reading. `anfr-fr` bounds its own dense
 *    register the same way, 4.5 → 11 px.
 *  • THE FILL IS TRANSLUCENT AND THE RIM IS NOT. Which of a
 *    `PointPrimitiveCollection` and another layer's entity billboards paints
 *    last is not something either layer can pin, so the composition has to read
 *    both ways: at α 0.55 the pictogram survives underneath, and the opaque rim
 *    survives on top.
 *  • THE RAMP CANNOT BE READ AS A MODE. `idfm-network` colours stops by mode in
 *    five SATURATED hues — métro `#ffb03d`, rail `#3d8bff`, tram `#3dd6c4`, bus
 *    `#c9d4e0`, funicular/cable `#ff7ad9`. {@link IDFM_FREQ_RAMP} is a
 *    desaturated cold→warm lightness ladder that holds none of them.
 *
 * ── What each channel claims ────────────────────────────────────────────────
 * COLOUR and SIZE both carry ONE number: average departures per hour at this
 * stop, on the selected day, in the selected one-hour band. Redundant on
 * purpose — on a photorealistic globe an 8 px dot's hue is not reliable, and
 * `comptagesRhythm.js` doubles colour with stroke width for the same reason.
 *
 * The ladder is FIXED (2 / 4 / 8 / 16 / 32 per hour) and never a quantile. The
 * whole claim of this layer is that one number moves as you scrub the clock; a
 * ramp recomputed per viewport and per band would repaint the map on every step
 * for reasons that have nothing to do with the service, and no reader could
 * tell the two apart. A colour means the same wait in Paris at 08:00 and in
 * Melun at 01:00. Measured over those 805 stops on an average Tuesday, the
 * ladder splits them:
 *
 *      band            silent  <2   2–4   4–8  8–16 16–32   32+
 *      08:00–08:59         23    6    17   167   240   237   115
 *      12:00–12:59         24    5    13   194   257   302    10
 *      22:00–22:59         21   16    77   224   395    71     1
 *      01:00–01:59        397  179    80   103    44     2     0
 *
 * No empty band at the peak, and a collapse to the floor at 01:00 that IS the
 * finding. Concretely, on the same Tuesday: Saint-Lazare (métro) runs **37/h at
 * 08:00 and 8.7/h at 22:00**; Auber's bus pole runs 42/h and 33/h; and 397 of
 * the 805 stops — 49.3 % — have nothing at all at 01:00.
 *
 * ── Silence is measured, so it is NOT grey ──────────────────────────────────
 * `fraicheurParis.js` established the rule this repo now works to: grey
 * `#8a93a6` means "the register did not measure this" and nothing else. A stop
 * that publishes a profile and has no course in the selected band was measured,
 * and the published answer is zero. So it keeps its own dark colour
 * ({@link IDFM_FREQ_SILENT_COLOR}), its own legend row and its own card line,
 * and it is DRAWN — an absent dot would read as missing data, and "nothing
 * stops here at this hour" is the answer this layer exists to give.
 *
 * ── Two regimes, and the byte counts that settle the split ──────────────────
 * REGIME `arrets` — below {@link STOPS_ENTER_SPAN_DEG} the viewport is asked
 * for full 7 × 24 profiles. Measured on the 4 km Châtelet box: five upstream
 * calls, **3 303 162 bytes in 2.42 s**, folding to **540 404 bytes raw /
 * 87 143 gzipped** for 805 stops. The span gate is the answer to a measured
 * question — see {@link STOPS_ENTER_SPAN_DEG} — and the density it is answering
 * about, counted at Châtelet on square boxes by side length: 1.2 km 87 stops,
 * 2 km 204, 3 km 436, 4 km 802, 5 km 1 133, and from 5.5 km up the identity
 * page saturates at its 1 201-row limit, which is itself the refusal signal.
 *
 * REGIME `region` — above it, eight département polygons carrying the SAME
 * ladder in the SAME unit, because `idfmFrequencyDepartements.js` divides each
 * bucket's courses by its enumerated stop count. The whole product is **14 719
 * bytes raw / 5 864 gzipped**, built from 356 aggregate rows and 17 stop
 * enumerations in 1.09 s upstream and 54 ms of folding. On an average Tuesday
 * at 08:00 it reads 13.22 departures per hour per stop in Paris against 3.00 in
 * Seine-et-Marne; at 22:00, 7.13 against 0.61. The gap between the two
 * départements more than doubles after dark, and that is a fact about where you
 * can afford to live, printed on eight polygons.
 *
 * There is no third, thinned regime. `sup-fr` ships its whole register because
 * it is 0.62 MB gzipped; the equivalent here is 26.7 MB raw / ~4.3 MB gzipped
 * for one week of one région, so the viewport asks and the région aggregates.
 *
 * ── The clock is Paris's, and the day runs 04:00 → 03:59 ────────────────────
 * The default moment is `Europe/Paris` NOW, mapped onto the operating day by
 * `operatingSlot()`: 01:30 on a Wednesday is TUESDAY's band 25, and getting
 * that backwards moves every night reading onto the wrong day. Friday night is
 * where it costs most — band 25 is 15 904 courses region-wide on a Monday and
 * **31 585 on a Friday, +98.6 %**.
 *
 * The DAY is always today in Paris and is not a control. The map would need
 * fourteen chips to offer both axes, and the day is the cheaper axis to give
 * up: Monday, Tuesday and Thursday differ by 0.36 % across the whole région
 * (3 066 375 / 3 071 759 / 3 077 377 courses). Every card carries all seven
 * days for the selected band anyway, so Friday night is one click away from any
 * stop, and the row label always names the day it drew so a Sunday screenshot
 * cannot be mistaken for a weekday one.
 *
 * ── What is NOT drawn ───────────────────────────────────────────────────────
 *  • 549 stops (1.50 %) publish no coordinate — every one of them in the
 *    dataset's null-`code_departement` bucket, and **473 Train, 69 Bus, 7
 *    Tramway**. They carry **84 768 of the 3 071 759 average-Tuesday courses
 *    (2.76 %)**, well above their 1.50 % of the stops, which is why
 *    they are counted on the card instead of being quietly dropped. 518 of them
 *    join `arrets.zdaid` — the stop ZONE — and 512 of those resolve to two or
 *    more platform coordinates, so there is no single published point to
 *    borrow. Placing one would be inventing a coordinate.
 *  • Eight `code_departement` buckets outside Île-de-France hold 235 stops
 *    between them (60: 87 · 28: 82 · 27: 36 · 89: 11 · 02: 9 · 45: 7 · 10: 2 ·
 *    51: 1). They are in the payload and counted in the legend, and their
 *    polygons stay unpainted: colouring the Marne on the strength of one bus
 *    pole would be a claim about 8 162 km².
 *  • 542 of the 35 953 placed stops (1.51 %) sit inside a different
 *    département's IGN outline from the one they publish. The map is not
 *    repartitioned on that — see `idfmFrequencyDepartements.js` — the number is
 *    reported instead.
 *  • School-holiday and summer weeks. They are published (three sibling
 *    datasets, same licence) and this layer draws the TERM-TIME one, which is
 *    5.2 % busier than the holiday week and 17.1 % busier than summer on an
 *    average Tuesday. The card names the week it drew rather than averaging
 *    three regimes into a number that describes none of them.
 *
 * Every figure above was measured on 2026-09-02 through the exact URLs the
 * proxy builds.
 */

import * as Cesium from 'cesium';
import { claimCameraSensitivity, releaseCameraSensitivity } from './cameraSensitivity.js';
import { governorRequestRender } from '../renderGovernor.js';
import { registerSpriteCollection, restoreSpriteOrder, unregisterSpriteCollection } from './spriteOrder.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { parseDepartements } from './meteoFranceVigilance.js';
import { textSparkline } from './sparkline.js';
import { boxKey, padBox, snapBoxOutward } from './viewportBox.js';
import {
  IDFM_FREQ_BAND_MAX,
  IDFM_FREQ_BAND_MIN,
  IDFM_FREQ_BOX_STEP_DEG,
  IDFM_FREQ_DAYS,
  IDFM_FREQ_DAY_LABELS,
  IDFM_FREQ_LEVELS,
  IDFM_FREQ_LEVEL_LABELS,
  IDFM_FREQ_MAX_STOPS,
  IDFM_FREQ_MODE_LABELS,
  IDFM_FREQ_REFERENCE_YEAR,
  IDFM_FREQ_SILENT_LABEL,
  bandLabel,
  clampBand,
  frequencyLevel,
  meanWaitMin,
  operatingSlot,
  profileDayTotal,
  profilePeak,
  profileRate,
  profileSpan,
} from './idfmFrequencyFeed.js';
import {
  IDFM_FREQ_REGION_MIN_STOPS,
  regionDayTotal,
  regionRatePerStop,
} from './idfmFrequencyDepartements.js';

/** Layer id — also the share-link registry key and the voice-tool enum value. */
export const IDFM_FREQ_LAYER_ID = 'idfm-frequency';

/** Selected-stop card, on its own protected overlay source. */
export const IDFM_FREQ_OVERLAY_SOURCE_ID = 'idfm-frequency-selected';
export const IDFM_FREQ_OVERLAY_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 1,
  moving: false,
});

const STOPS_URL = '/api/idfm-frequency/stops';
const REGION_URL = '/api/idfm-frequency/region';
const DEPARTEMENTS_URL = new URL(
  './local_data/france_departements/departements.geojson',
  import.meta.url,
).href;

/**
 * Regime boundary, in degrees of the wider view span, with hysteresis.
 *
 * Both numbers are the answer to one measured question: what is the widest view
 * whose PADDED, SNAPPED box still fits under the feed's 1 200-stop ceiling at
 * Châtelet, the densest part of the network? Measured 2026-09-02 by asking the
 * identity URL for the exact box each view produces — the view squared in
 * degrees, padded 8 %, snapped outward onto the 0.005° grid:
 *
 *   view 0.020° → box 0.025°  (2.8 × 1.8 km)    241 stops
 *   view 0.030° → box 0.040°  (4.5 × 2.9 km)    648
 *   view 0.035° → box 0.045°  (5.0 × 3.3 km)    768   ← enter
 *   view 0.040° → box 0.050°  (5.6 × 4.0 km)  1 100
 *   view 0.045° → box 0.055°  (6.1 × 4.0 km)  1 193   ← leave
 *   view 0.050° → box 0.065°  (7.2 × 4.8 km)  the 1 201-row page saturates
 *
 * So 0.045° is literally the last span that fits, and one notch wider the
 * proxy refuses the box after a single cheap call. Anywhere else in the région
 * the same box holds a fraction of that.
 */
export const STOPS_ENTER_SPAN_DEG = 0.035;
export const STOPS_EXIT_SPAN_DEG = 0.045;

/** View padding before the box is snapped, as a fraction of the span. */
const BOX_PAD_FRACTION = 0.08;

/** Camera settle before a new box is asked for. */
const CAMERA_DEBOUNCE_MS = 450;

/**
 * Poll cadence — 60 s, and it is a CLOCK tick, not a data poll.
 *
 * The offer is a yearly average republished a few times a year; nothing
 * upstream changes in a minute. What changes in a minute is which band
 * `Europe/Paris` is in, and the whole layer is a function of that. `update()`
 * re-reads the clock, repaints from the pack it already holds, and only touches
 * the network when the camera has moved to a box it has not asked for.
 */
const UPDATE_INTERVAL_MS = 60_000;

const REQUEST_TIMEOUT_MS = 45_000;
const REGION_TIMEOUT_MS = 120_000;

/** Stops rendered at once. Mirrors the feed's ceiling; the proxy enforces it. */
const MAX_RENDERED_STOPS = IDFM_FREQ_MAX_STOPS;

/** Lift, in metres, so a disc is not swallowed by the terrain it sits on. */
const POINT_LIFT_M = 2.0;

/**
 * The frequency ladder, drawn.
 *
 * A desaturated cold → warm LIGHTNESS ladder, six steps. Not a hue wheel and
 * not a traffic light: more service is better, so a green-to-red reading would
 * be exactly backwards, and `traffic.js` and `roadStatusFrance.js` already own
 * `#2ecc71`/`#f0b23e`/`#e05252` for a congestion ratio on these same streets.
 * Not `comptagesParis.js`'s indigo → magenta → rose either, which is the other
 * magnitude ramp painted over central Paris. And deliberately far from
 * `idfm-network`'s five saturated MODE hues, because those two marks land on
 * the same coordinate — see the module header.
 */
export const IDFM_FREQ_RAMP = Object.freeze([
  '#43587a', '#63809f', '#94a8b8', '#cbc6b4', '#e8d5a0', '#fff0c4',
]);

/**
 * A stop that publishes a profile and runs nothing in this band.
 *
 * Its own colour, and pointedly NOT `#8a93a6`: `fraicheurParis.js` reserved
 * that grey repo-wide for "the register did not measure this". This was
 * measured, and the measurement is zero.
 */
export const IDFM_FREQ_SILENT_COLOR = '#2b3444';

/** Disc diameter in CSS px, one per ladder step. See the module header. */
export const IDFM_FREQ_SIZES = Object.freeze([5.5, 7.0, 8.5, 10.0, 11.5, 13.0]);
export const IDFM_FREQ_SILENT_SIZE = 4.5;

/** Interior alpha. Low enough that a stacked mode pictogram reads through it. */
const FILL_ALPHA = 0.55;
/** Rim alpha and width. The rim is the datum when something paints over it. */
const RIM_ALPHA = 0.95;
const RIM_WIDTH = 1.4;
const SILENT_FILL_ALPHA = 0.42;

/** Selection follows the repo's convention: cyan, and larger than any step. */
const SELECTED_COLOR = '#00ffff';
const SELECTED_SIZE_PX = 18;

/**
 * Choropleth alphas, one per ladder step.
 *
 * They climb with the step so a busy département is both lighter AND more
 * opaque: a single fixed alpha over satellite imagery lets the ground win at
 * the pale end of a lightness ramp, which would invert the reading.
 */
const REGION_ALPHA = Object.freeze([0.30, 0.34, 0.39, 0.45, 0.52, 0.60]);
const REGION_SILENT_ALPHA = 0.26;

/** Legend copy — one sentence a reader can act on, per state. */
const LEVEL_BLURBS = Object.freeze([
  'Moins de deux départs par heure. Une demi-heure d’attente en moyenne, et le service peut être un seul aller-retour.',
  'Deux à quatre départs par heure : 15 à 30 minutes d’attente moyenne.',
  'Quatre à huit par heure : 7 à 15 minutes. Le seuil au-dessous duquel on consulte un horaire avant de sortir.',
  'Huit à seize par heure : 4 à 7 minutes. On descend sans regarder l’heure.',
  'Seize à trente-deux par heure : 2 à 4 minutes.',
  'Trente-deux et plus : moins de deux minutes. Le plus fort mesuré dans la tranche 08 h est Gare de Meaux (Dépose) à 70,1 courses.',
]);

const SILENT_BLURB = 'Arrêt qui publie bien un profil et n’a aucune course dans cette tranche. '
  + 'C’est une valeur mesurée, pas une donnée manquante — d’où sa couleur propre et non le gris '
  + '« non mesuré » du reste de l’application. À 01 h, 397 des 805 arrêts du carré de 4 km sur '
  + 'Châtelet sont dans ce cas.';

/**
 * The chips: seven moments, one panel row.
 *
 * Not 24 chips, and not a day axis — see the module header for why the day is
 * the axis that gets given up. `now` follows the Paris clock through
 * `operatingSlot()`; the other six pin a band and keep today's day. They are
 * the hours a reader actually asks about rather than an even spread: the first
 * service, the morning peak, midday, the evening peak, late evening, and the
 * one o'clock band where half this network stops existing.
 */
export const IDFM_FREQ_MOMENTS = Object.freeze([
  Object.freeze({ id: 'now', band: null, label: 'Maintenant' }),
  Object.freeze({ id: 'b06', band: 6, label: '06 h' }),
  Object.freeze({ id: 'b08', band: 8, label: '08 h' }),
  Object.freeze({ id: 'b12', band: 12, label: '12 h' }),
  Object.freeze({ id: 'b18', band: 18, label: '18 h' }),
  Object.freeze({ id: 'b22', band: 22, label: '22 h' }),
  Object.freeze({ id: 'b01', band: 25, label: '01 h' }),
]);

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});
let _overlayHost = DEFAULT_OVERLAY_HOST;

const DEFAULT_HTTP = (url, options) => fetch(url, options);
let _http = DEFAULT_HTTP;

/** Injectable clock, so a test can stand at 01:30 on a Friday. */
const DEFAULT_NOW = () => Date.now();
let _now = DEFAULT_NOW;

// --- State ------------------------------------------------------------------

let _viewer = null;
let _points = null;
let _records = new Map();
let _enabled = false;
let _clickHandler = null;
let _cameraChangedAttached = false;
let _cameraDebounceTimer = null;
let _preRenderRemover = null;
let _selectedId = null;
let _count = 0;
let _lastUpdate = null;
let _loading = false;
let _error = null;
let _status = 'idle';
let _regime = 'region';
let _requestGeneration = 0;

let _pack = null;
let _packBoxKey = null;

let _region = null;
let _regionPromise = null;

let _depMeta = new Map();
let _depEntities = new Map();
let _depDataSource = null;
let _depShapesPromise = null;
let _classificationType = null;

/** `null` means "follow the Paris clock"; a number pins the band. */
let _pinnedBand = null;
let _slot = { day: 'mardi', band: 8 };

// --- Small helpers ----------------------------------------------------------

/** French thousands separator, matching the rest of the French packs. */
function fr(value) {
  return Number(value).toLocaleString('fr-FR');
}

/** One decimal below ten, whole numbers above — the feed's own wire rule. */
export function formatRate(rate) {
  const value = Number(rate);
  if (!Number.isFinite(value)) return '—';
  return value < 10
    ? value.toLocaleString('fr-FR', { maximumFractionDigits: 1 })
    : Math.round(value).toLocaleString('fr-FR');
}

/**
 * The implied wait, in words.
 *
 * Stated as an implication of the published rate and never as a measured
 * headway: the file counts courses in an hour, it does not say when in the hour
 * they run. Under a minute it says so rather than printing `0,7 min`, which
 * reads like a precision nobody has.
 */
export function waitPhrase(rate) {
  const minutes = meanWaitMin(rate);
  if (minutes === null) return null;
  if (minutes < 1) return 'moins d’une minute d’attente moyenne';
  return `${minutes.toLocaleString('fr-FR', { maximumFractionDigits: minutes < 10 ? 1 : 0 })} min d’attente moyenne`;
}

/**
 * The (day, band) the layer is drawing, from the Paris wall clock.
 *
 * `Europe/Paris` and not the browser's zone, for the reason `fraicheurFeed.js`
 * wrote down about opening hours: an operator in Denver must not be shown the
 * Paris night service as the Paris morning peak. `Intl.DateTimeFormat` handles
 * the summer-time step that a hand-rolled `+2 h` gets wrong on the last Sunday
 * of October. The hour is then mapped onto the OPERATING day by
 * `operatingSlot()`, which is what puts 01:30 on a Wednesday into Tuesday's
 * band 25.
 *
 * @param {number|Date} [now]
 * @returns {{day:string, band:number, hour:number, weekday:number}}
 */
export function parisOperatingSlot(now = Date.now()) {
  const date = now instanceof Date ? now : new Date(now);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris',
    weekday: 'short',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const read = (type) => parts.find((part) => part.type === type)?.value ?? '';
  const SUNDAY_FIRST = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = SUNDAY_FIRST[read('weekday')] ?? 2;
  // `hour: '2-digit'` with `hour12: false` renders midnight as `24` in some ICU
  // builds, which would put the reader in band 24 of the wrong operating day.
  const hour = Number(read('hour')) % 24;
  return { ...operatingSlot({ hour, weekday }), hour, weekday };
}

/**
 * The slot to draw: the pinned band on today's day, or the live clock.
 * @param {?number} pinned
 * @param {number|Date} [now]
 * @returns {{day:string, band:number, pinned:boolean}}
 */
export function resolveSlot(pinned, now = Date.now()) {
  const live = parisOperatingSlot(now);
  if (typeof pinned !== 'number' || !Number.isFinite(pinned)) {
    return { day: live.day, band: live.band, pinned: false };
  }
  return { day: live.day, band: clampBand(pinned), pinned: true };
}

// --- Palette ----------------------------------------------------------------

/**
 * Colour, alpha and size for one rate.
 *
 * `level` is `-1` for a stop with a profile and no service in the band — the
 * one state the ramp must not absorb.
 *
 * @param {number} rate Courses per hour.
 * @returns {{level:number, css:string, alpha:number, sizePx:number}}
 */
export function frequencyStyle(rate) {
  const level = frequencyLevel(rate);
  if (level < 0) {
    return {
      level: -1,
      css: IDFM_FREQ_SILENT_COLOR,
      alpha: SILENT_FILL_ALPHA,
      sizePx: IDFM_FREQ_SILENT_SIZE,
    };
  }
  return {
    level,
    css: IDFM_FREQ_RAMP[level],
    alpha: FILL_ALPHA,
    sizePx: IDFM_FREQ_SIZES[level],
  };
}

/**
 * Choropleth fill for one département's per-stop rate.
 *
 * `null` — a bucket with no enumerated divisor — is NOT rate zero. It gets no
 * fill at all, because a département painted at the bottom of the ladder claims
 * "we counted, and almost nothing runs", which is a different sentence from
 * "we could not count".
 *
 * @param {?number} ratePerStop
 * @returns {?{level:number, css:string, alpha:number}}
 */
export function departementFill(ratePerStop) {
  if (typeof ratePerStop !== 'number' || !Number.isFinite(ratePerStop)) return null;
  const level = frequencyLevel(ratePerStop);
  if (level < 0) {
    return { level: -1, css: IDFM_FREQ_SILENT_COLOR, alpha: REGION_SILENT_ALPHA };
  }
  return { level, css: IDFM_FREQ_RAMP[level], alpha: REGION_ALPHA[level] };
}

/** Legend label for one ladder step, or the silent state. */
export function levelLabel(level) {
  if (typeof level !== 'number' || !Number.isInteger(level)) return IDFM_FREQ_SILENT_LABEL;
  if (level < 0) return IDFM_FREQ_SILENT_LABEL;
  return IDFM_FREQ_LEVEL_LABELS[Math.min(level, IDFM_FREQ_LEVEL_LABELS.length - 1)];
}

/** Legend colour for one ladder step, or the silent state. */
export function levelColor(level) {
  if (typeof level !== 'number' || !Number.isInteger(level) || level < 0) {
    return IDFM_FREQ_SILENT_COLOR;
  }
  return IDFM_FREQ_RAMP[Math.min(level, IDFM_FREQ_RAMP.length - 1)];
}

// --- Camera -----------------------------------------------------------------

/** The wider of the view rectangle's two spans, in degrees. */
export function idfmFreqViewSpanDeg(viewer) {
  const rectangle = viewer?.camera?.computeViewRectangle?.();
  if (!rectangle) return Infinity;
  const lat = Cesium.Math.toDegrees(rectangle.north - rectangle.south);
  const lon = Cesium.Math.toDegrees(rectangle.east - rectangle.west);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return Infinity;
  return Math.max(lat, lon);
}

/**
 * Which regime a span belongs to, with hysteresis so the two products do not
 * flip on a wheel notch at the boundary.
 * @param {number} spanDeg
 * @param {string} [current]
 * @returns {'arrets'|'region'}
 */
export function idfmFreqRegimeFor(spanDeg, current = 'region') {
  const span = typeof spanDeg === 'number' && Number.isFinite(spanDeg) ? spanDeg : Infinity;
  if (current === 'arrets') return span > STOPS_EXIT_SPAN_DEG ? 'region' : 'arrets';
  return span <= STOPS_ENTER_SPAN_DEG ? 'arrets' : 'region';
}

/**
 * The box the `arrets` regime asks for: the view, padded, then snapped OUTWARD
 * onto the shared cache grid so a pan of a few metres reuses the same key.
 * @param {object} viewer
 * @returns {?{south:number, west:number, north:number, east:number}}
 */
export function idfmFreqViewBox(viewer) {
  const rectangle = viewer?.camera?.computeViewRectangle?.();
  if (!rectangle) return null;
  const south = Cesium.Math.toDegrees(rectangle.south);
  const north = Cesium.Math.toDegrees(rectangle.north);
  const west = Cesium.Math.toDegrees(rectangle.west);
  const east = Cesium.Math.toDegrees(rectangle.east);
  if (![south, west, north, east].every(Number.isFinite)) return null;
  if (west >= east || south >= north) return null;
  const margin = Math.max(north - south, east - west) * BOX_PAD_FRACTION;
  return snapBoxOutward(padBox({ south, west, north, east }, margin), IDFM_FREQ_BOX_STEP_DEG);
}

// --- Card copy --------------------------------------------------------------

/**
 * Band windows the proxy asked for and did not get.
 *
 * A viewport's profiles arrive as FOUR pages split on the band axis, because
 * `offset + limit <= 20000` is a hard cap under `group_by`. One page failing is
 * a hole in the day, not a hole in the map — and an unnamed hole reads as "no
 * service between 16:00 and 21:00".
 *
 * @param {?object} pack
 * @returns {number} Windows missing, 0 when the fold is whole or unknown.
 */
export function missingWindows(pack) {
  const asked = Number(pack?.windows?.asked);
  const answered = Number(pack?.windows?.answered);
  if (!Number.isFinite(asked) || !Number.isFinite(answered)) return 0;
  return Math.max(0, asked - answered);
}

/** `04 h → 03 h` sparkline over one day's 24 bands. */
export function dayGlyphs(profile, day) {
  const index = IDFM_FREQ_DAYS.indexOf(day);
  const row = index >= 0 ? profile?.[index] : null;
  if (!Array.isArray(row)) return '';
  return textSparkline(row.map((value) => Number(value) || 0));
}

/**
 * The week, band by band, on one line.
 *
 * Seven numbers for the SELECTED band, which is the comparison the chips cannot
 * make: the map is always today, and the one place the day matters more than
 * the hour is band 25, where the région runs 15 904 courses on a Monday and
 * 31 585 on a Friday.
 */
export function weekLine(profile, band) {
  const slot = clampBand(band);
  const parts = IDFM_FREQ_DAYS.map((day) => {
    const rate = profileRate(profile, day, slot);
    return `${IDFM_FREQ_DAY_LABELS[day].slice(0, 3)} ${formatRate(rate)}`;
  });
  return parts.join(' · ');
}

/**
 * The selected stop's card.
 *
 * Every line is either published or an arithmetic identity on a published
 * number, and the last line says which week was drawn — this is a yearly
 * average of a term-time week, not a timetable, and a card that read like a
 * departure board would be lying about what it is.
 *
 * @param {object} record
 * @param {{day:string, band:number, payload:?object}} context
 * @returns {string} Title on the first line, details after.
 */
export function buildFrequencySelectionLabel(record, context = {}) {
  const stop = record?.stop;
  if (!stop) return '';
  const day = context.day || _slot.day;
  const band = clampBand(context.band ?? _slot.band);
  const payload = context.payload || null;

  const lines = [stop.name || `Arrêt ${stop.id}`];
  const where = [IDFM_FREQ_MODE_LABELS[stop.mode] || IDFM_FREQ_MODE_LABELS.unknown];
  if (stop.commune) where.push(stop.dept ? `${stop.commune} (${stop.dept})` : stop.commune);
  lines.push(where.join(' · '));

  const rate = profileRate(stop.profile, day, band);
  const when = `${IDFM_FREQ_DAY_LABELS[day] || day} ${bandLabel(band)}`;
  if (rate > 0) {
    lines.push(`${when} — ${formatRate(rate)} départs/h · ${waitPhrase(rate)}`);
  } else {
    lines.push(`${when} — ${IDFM_FREQ_SILENT_LABEL}`);
  }

  const glyphs = dayGlyphs(stop.profile, day);
  if (glyphs) lines.push(`04 h ${glyphs} 03 h`);

  const span = profileSpan(stop.profile, day);
  const peak = profilePeak(stop.profile, day);
  const shape = [];
  if (span) shape.push(`premier ${bandLabel(span.first)}`.replace(/–\d{2}:\d{2}$/, ''));
  if (peak) shape.push(`pointe ${bandLabel(peak.band).replace(/–\d{2}:\d{2}$/, '')} à ${formatRate(peak.rate)}/h`);
  if (span) shape.push(`dernier ${bandLabel(span.last)}`.replace(/–\d{2}:\d{2}$/, ''));
  if (shape.length) lines.push(shape.join(' · '));

  lines.push(`Total ${IDFM_FREQ_DAY_LABELS[day] || day} : ${formatRate(profileDayTotal(stop.profile, day))} courses`);
  lines.push(`Même tranche : ${weekLine(stop.profile, band)}`);

  // A stop that publishes fewer than 24 bands is not truncated: it simply has
  // no service in the rest of them. Saying so stops the sparkline's flat tail
  // reading as a gap in the feed.
  if (typeof stop.bands === 'number' && stop.bands > 0 && stop.bands < 24) {
    lines.push(`${stop.bands} tranches publiées sur 24 — aucune course dans les autres`);
  }
  if (Array.isArray(stop.aliases) && stop.aliases.length) {
    lines.push(`Aussi publié « ${stop.aliases.join(' », « ')} » au même point`);
  }
  const missing = missingWindows(payload);
  if (missing) {
    lines.push(`${missing} des 4 fenêtres horaires n’ont pas répondu — un creux `
      + 'du graphique peut être une panne amont, pas une absence de service');
  }
  if (stop.mode === 'unknown') {
    lines.push('Mode non publié par ce jeu de données — non emprunté au référentiel');
  }
  lines.push(`Offre moyenne, semaine type hors vacances ${payload?.year || IDFM_FREQ_REFERENCE_YEAR}`);
  lines.push('Île-de-France Mobilités — Licence Ouverte v2.0');
  return lines.join('\n');
}

/**
 * A département's card, in the same unit as a stop's.
 *
 * The per-stop mean leads and the raw total follows, in that order and never
 * the other way round: the total is a fact about how big the département is.
 *
 * @param {object} row
 * @param {{day:string, band:number, region:?object, name:?string}} context
 * @returns {string}
 */
export function buildFrequencyDepartementLabel(row, context = {}) {
  if (!row?.code) return '';
  const day = context.day || _slot.day;
  const band = clampBand(context.band ?? _slot.band);
  const name = context.name || row.code;
  const lines = [name === row.code ? `Département ${row.code}` : `${name} (${row.code})`];

  const rate = regionRatePerStop(row, day, band);
  const when = `${IDFM_FREQ_DAY_LABELS[day] || day} ${bandLabel(band)}`;
  if (rate === null) {
    lines.push(`${when} — aucun décompte d’arrêts, donc aucune moyenne`);
  } else if (rate > 0) {
    lines.push(`${when} — ${formatRate(rate)} départs/h par arrêt`);
  } else {
    lines.push(`${when} — ${IDFM_FREQ_SILENT_LABEL}`);
  }

  const dayIndex = IDFM_FREQ_DAYS.indexOf(day);
  const total = dayIndex >= 0 ? Number(row.profile?.[dayIndex]?.[band - IDFM_FREQ_BAND_MIN]) || 0 : 0;
  if (typeof row.stops === 'number') {
    lines.push(`${fr(row.stops)} arrêts · ${formatRate(total)} courses dans la tranche`);
  }
  const glyphs = dayGlyphs(row.profile, day);
  if (glyphs) lines.push(`04 h ${glyphs} 03 h`);
  lines.push(`Total ${IDFM_FREQ_DAY_LABELS[day] || day} : ${fr(Math.round(regionDayTotal(row, day)))} courses`);

  if (!row.paint) {
    lines.push(`Hors Île-de-France : ${fr(row.stops ?? 0)} arrêts, sous le seuil de `
      + `${fr(IDFM_FREQ_REGION_MIN_STOPS)} — compté, jamais peint`);
  } else if (typeof row.inside === 'number' && typeof row.stops === 'number' && row.inside < row.stops) {
    lines.push(`${fr(row.stops - row.inside)} arrêts publiés ici tombent dans un autre `
      + 'contour IGN — code administratif, pas géométrie');
  }
  lines.push('Moyenne par arrêt : le total mesure la taille du département, pas le service.');
  return lines.join('\n');
}

/**
 * One line under the layer's toggle: what this view actually contains.
 *
 * It always names the DAY, because the map is always today and a Sunday
 * screenshot must not be readable as a weekday one.
 */
export function buildFrequencyLoadingLabel({
  regime = _regime,
  status = _status,
  loading = _loading,
  slot = _slot,
  pinned = _pinnedBand !== null,
  records = _records,
  pack = _pack,
  region = _region,
} = {}) {
  if (loading) {
    return regime === 'arrets'
      ? 'lecture de l’offre horaire IDFM…'
      : 'lecture de l’offre régionale IDFM…';
  }
  if (status === 'error') return '';
  const when = `${IDFM_FREQ_DAY_LABELS[slot.day] || slot.day} ${bandLabel(slot.band)}`;
  const parts = [pinned ? when : `${when} (heure de Paris)`];

  if (regime === 'region') {
    const painted = region?.paintedCodes?.length || 0;
    if (!painted) return parts.concat('offre régionale indisponible').join(' · ');
    parts.push(`${painted} départements`);
    if (region?.totals?.placed) parts.push(`${fr(region.totals.placed)} arrêts pondérés`);
    if (region?.totals?.unplaced) parts.push(`${fr(region.totals.unplaced)} sans coordonnée`);
    return parts.join(' · ');
  }

  if (pack?.tooDense) {
    // "au moins", because the identity page saturates: the proxy knows the box
    // holds more than the ceiling and cannot know how many more without buying
    // the pages it just refused.
    return parts.concat(
      `${pack.stopsAtLeast ? 'au moins ' : ''}${fr(pack.stopsInBox ?? 0)} arrêts dans `
      + `cette vue, plus que les ${fr(IDFM_FREQ_MAX_STOPS)} tracés — rapprochez-vous`,
    ).join(' · ');
  }
  if (!records.size) return parts.concat('aucun arrêt IDFM dans cette vue').join(' · ');
  parts.push(`${fr(records.size)} arrêts`);
  let silent = 0;
  let top = 0;
  for (const record of records.values()) {
    const rate = profileRate(record.stop.profile, slot.day, slot.band);
    if (rate <= 0) silent += 1;
    else if (frequencyLevel(rate) >= IDFM_FREQ_LEVELS.length) top += 1;
  }
  if (top) parts.push(`${fr(top)} à plus de ${IDFM_FREQ_LEVELS[IDFM_FREQ_LEVELS.length - 1]}/h`);
  if (silent) parts.push(`${fr(silent)} sans passage`);
  if (pack?.refused) parts.push(`${fr(pack.refused)} non tracés`);
  // The band axis costs four upstream pages, and losing one is a hole in the
  // DAY rather than a hole in the map. Unnamed, that hole reads as "no service
  // between 16:00 and 21:00", which is the worst lie this layer could tell.
  const missing = missingWindows(pack);
  if (missing) parts.push(`${missing} fenêtres horaires manquantes en amont`);
  return parts.join(' · ');
}

// --- Overlay ----------------------------------------------------------------

function selectedOverlayEntry(id, position, copy) {
  const [title, ...details] = copy.split('\n');
  return {
    id: String(id),
    position,
    variant: 'selected',
    selected: true,
    protected: true,
    paintLane: 'selected',
    collisionGroup: 'ambient-card',
    priority: Number.MAX_SAFE_INTEGER,
    title,
    details,
    accent: SELECTED_COLOR,
    interactive: false,
    anchorRadiusPx: 9,
    minAnchorGapPx: 11,
    verticalOnly: true,
    placement: 'above',
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
  };
}

/** Protected selected-stop entry for the shared overlay host. */
export function createFrequencySelectedOverlayEntry(record, context = {}) {
  if (!record?.id || !record?.position) return null;
  const copy = record.kind === 'departement'
    ? buildFrequencyDepartementLabel(record.row, context)
    : buildFrequencySelectionLabel(record, context);
  if (!copy) return null;
  return selectedOverlayEntry(record.id, record.position, copy);
}

// --- Selection --------------------------------------------------------------

function slotContext() {
  return { day: _slot.day, band: _slot.band, payload: _pack, region: _region };
}

function restoreRecordStyle(record) {
  if (!record?.point || !record.style) return;
  record.point.color = Cesium.Color.fromCssColorString(record.style.css).withAlpha(record.style.alpha);
  record.point.outlineColor = Cesium.Color.fromCssColorString(record.style.css).withAlpha(RIM_ALPHA);
  record.point.pixelSize = record.style.sizePx;
}

function clearSelection() {
  if (!_selectedId) return;
  const record = _records.get(_selectedId);
  restoreRecordStyle(record);
  // A département record exists only because it was selected — it has no
  // primitive and nothing else reads it — so it goes when the selection does
  // rather than accumulating one entry per polygon ever clicked.
  if (record?.kind === 'departement') _records.delete(_selectedId);
  _selectedId = null;
  _overlayHost.clearSource(IDFM_FREQ_OVERLAY_SOURCE_ID);
  governorRequestRender('idfm-frequency-deselect');
}

function repaintSelectedCard(id) {
  if (_selectedId !== id) return;
  const record = _records.get(id);
  const entry = record ? createFrequencySelectedOverlayEntry(record, slotContext()) : null;
  if (entry) {
    _overlayHost.setEntries(IDFM_FREQ_OVERLAY_SOURCE_ID, [entry], IDFM_FREQ_OVERLAY_SOURCE_OPTIONS);
  }
  governorRequestRender('idfm-frequency-card');
}

function selectStop(id) {
  const record = _records.get(id);
  if (!record) return;
  if (_selectedId && _selectedId !== id) clearSelection();
  _selectedId = id;
  if (record.point) {
    record.point.color = Cesium.Color.fromCssColorString(SELECTED_COLOR).withAlpha(0.85);
    record.point.outlineColor = Cesium.Color.fromCssColorString(SELECTED_COLOR);
    record.point.pixelSize = SELECTED_SIZE_PX;
  }
  repaintSelectedCard(id);
}

function selectDepartement(code) {
  const row = _region?.departements?.find((entry) => entry.code === code);
  if (!row) return;
  const anchor = _depMeta.get(code)?.anchor;
  if (!anchor) return;
  const id = `idfm-freq:dep:${code}`;
  if (_selectedId && _selectedId !== id) clearSelection();
  _selectedId = id;
  const record = {
    id,
    kind: 'departement',
    row,
    position: Cesium.Cartesian3.fromDegrees(anchor[0], anchor[1]),
  };
  _records.set(id, record);
  const entry = createFrequencySelectedOverlayEntry(record, {
    ...slotContext(),
    name: _depMeta.get(code)?.name || code,
  });
  if (entry) {
    _overlayHost.setEntries(IDFM_FREQ_OVERLAY_SOURCE_ID, [entry], IDFM_FREQ_OVERLAY_SOURCE_OPTIONS);
  }
  governorRequestRender('idfm-frequency-card');
}

function onKeyDown(event) {
  if (event.key === 'Escape' && _selectedId) clearSelection();
}

/** The département code carried by a picked polygon entity, if any. */
function pickedDepartementCode(picked) {
  const code = picked?.id?.properties?.code?.getValue?.();
  return code ? String(code).trim() : null;
}

function installClickHandler(viewer) {
  if (_clickHandler || !viewer?.scene) return;
  _clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  _clickHandler.setInputAction((movement) => {
    const picked = viewer.scene.pick(movement.position);
    const id = picked?.id;
    // The stop discs come first: the two layers draw the same coordinate, and a
    // click that lands on both must resolve to the one that carries a rate.
    if (typeof id === 'string' && _records.has(id)) {
      selectStop(id);
      return;
    }
    const code = pickedDepartementCode(picked);
    if (code && _regime === 'region' && _region) {
      selectDepartement(code);
      return;
    }
    if (_selectedId) clearSelection();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  if (typeof document !== 'undefined') document.addEventListener('keydown', onKeyDown);
}

/**
 * Keep the selected card pinned to its dot as the camera moves.
 *
 * Deliberately does NOT call `governorRequestRender`: this runs inside
 * `scene.preRender`, so asking for a render here would ask for the next frame
 * on every frame and pin the app at full rate for as long as anything is
 * selected.
 */
function onPreRender() {
  if (!_enabled || !_selectedId) return;
  const record = _records.get(_selectedId);
  if (!record) return;
  const entry = createFrequencySelectedOverlayEntry(record, {
    ...slotContext(),
    name: record.kind === 'departement' ? _depMeta.get(record.row?.code)?.name : undefined,
  });
  if (entry) {
    _overlayHost.setEntries(IDFM_FREQ_OVERLAY_SOURCE_ID, [entry], IDFM_FREQ_OVERLAY_SOURCE_OPTIONS);
  }
}

// --- HTTP -------------------------------------------------------------------

async function fetchJson(url, { timeoutMs = REQUEST_TIMEOUT_MS, validate } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await _http(url, { signal: controller.signal });
    if (!response?.ok) throw new Error(`HTTP ${response?.status ?? '???'}`);
    const payload = await response.json();
    if (typeof validate === 'function' && !validate(payload)) throw new Error('malformed payload');
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

// --- Stop regime ------------------------------------------------------------

function stopPosition(lat, lon) {
  return Cesium.Cartesian3.fromDegrees(lon, lat, POINT_LIFT_M);
}

/**
 * Rebuild the drawn discs from a viewport payload.
 *
 * Records are keyed with an `idfm-freq:` prefix on purpose: `idfmFeed.js` uses
 * the bare `arrid` as its entity id, and these two layers put a mark on the
 * SAME coordinate. Unprefixed, a click would be ambiguous to `pickRegistry` and
 * one layer would answer for the other's dot.
 */
function reconcileStops(payload) {
  clearSelection();
  _points?.removeAll();
  _records = new Map();
  for (const stop of payload?.stops || []) {
    if (typeof stop?.lat !== 'number' || typeof stop?.lon !== 'number') continue;
    if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lon)) continue;
    if (_records.size >= MAX_RENDERED_STOPS) break;
    const id = `idfm-freq:${stop.id}`;
    if (_records.has(id)) continue;
    const style = frequencyStyle(profileRate(stop.profile, _slot.day, _slot.band));
    const position = stopPosition(stop.lat, stop.lon);
    const point = _points?.add({
      id,
      position,
      color: Cesium.Color.fromCssColorString(style.css).withAlpha(style.alpha),
      pixelSize: style.sizePx,
      outlineColor: Cesium.Color.fromCssColorString(style.css).withAlpha(RIM_ALPHA),
      outlineWidth: RIM_WIDTH,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      translucencyByDistance: new Cesium.NearFarScalar(500, 1.0, 60_000, 0.5),
    }) || null;
    _records.set(id, { id, kind: 'stop', stop, point, position, style });
  }
  _count = _records.size;
  governorRequestRender('idfm-frequency-stops');
}

/**
 * Re-style every drawn disc for a new (day, band) without touching the network.
 *
 * This is the whole point of shipping a 7 × 24 profile per stop rather than one
 * number: scrubbing the clock is a repaint, not a request.
 */
function restyleStops() {
  for (const record of _records.values()) {
    if (record.kind !== 'stop') continue;
    record.style = frequencyStyle(profileRate(record.stop.profile, _slot.day, _slot.band));
    if (record.id !== _selectedId) restoreRecordStyle(record);
  }
  if (_selectedId) repaintSelectedCard(_selectedId);
  governorRequestRender('idfm-frequency-restyle');
}

async function loadStops(box, { force = false } = {}) {
  const key = boxKey(box, 4);
  if (!force && _pack && _packBoxKey === key) {
    restyleStops();
    return;
  }
  _error = null;
  _loading = true;
  const generation = ++_requestGeneration;
  const params = new URLSearchParams({
    south: box.south.toFixed(5),
    west: box.west.toFixed(5),
    north: box.north.toFixed(5),
    east: box.east.toFixed(5),
  });
  try {
    const payload = await fetchJson(`${STOPS_URL}?${params}`, {
      validate: (body) => Array.isArray(body?.stops),
    });
    if (generation !== _requestGeneration || !_enabled || _regime !== 'arrets') return;
    _pack = payload;
    _packBoxKey = key;
    reconcileStops(payload);
    _lastUpdate = new Date();
    // A box the proxy refused after ONE cheap identity call: it holds more
    // stops than the layer will draw, so it answers with the count and no
    // profiles rather than buying four heavy pages to throw most of them away.
    // `zoom-in` is a GUIDANCE status — a green ON chip and a sentence — never a
    // fault, and never an empty map with no explanation.
    if (payload.tooDense) _status = 'zoom-in';
    else _status = _count > 0 ? 'ok' : 'empty';
  } catch (error) {
    if (generation !== _requestGeneration || !_enabled) return;
    if (error?.name !== 'AbortError') {
      console.warn('[Data:IDFM Fréquence] viewport unavailable:', error?.message || error);
    }
    // Keep what is drawn: an older box is still a true map of the service in
    // it, and blanking the screen would say the region has no transport.
    _error = _records.size
      ? 'rafraîchissement de l’offre IDFM indisponible'
      : 'offre horaire IDFM indisponible';
    _status = _records.size ? 'ok' : 'error';
  } finally {
    if (generation === _requestGeneration) _loading = false;
  }
}

// --- Région regime ----------------------------------------------------------

async function ensureRegion() {
  if (_region) return _region;
  if (_regionPromise) return _regionPromise;
  _regionPromise = fetchJson(REGION_URL, {
    timeoutMs: REGION_TIMEOUT_MS,
    validate: (body) => Array.isArray(body?.departements),
  })
    .then((payload) => {
      _region = payload;
      return payload;
    })
    .catch((error) => {
      if (error?.name !== 'AbortError') {
        console.warn('[Data:IDFM Fréquence] region unavailable:', error?.message || error);
      }
      _error = 'offre régionale IDFM indisponible';
      return null;
    })
    .finally(() => { _regionPromise = null; });
  return _regionPromise;
}

async function ensureDepartementShapes() {
  if (_depShapesPromise) return _depShapesPromise;
  _depShapesPromise = (async () => {
    const geojson = await (await _http(DEPARTEMENTS_URL)).json();
    _depMeta = parseDepartements(geojson);
    const source = await Cesium.GeoJsonDataSource.load(geojson, {
      clampToGround: true,
      fill: Cesium.Color.TRANSPARENT,
      stroke: Cesium.Color.TRANSPARENT,
      strokeWidth: 0,
    });
    source.name = 'Fréquence des transports — moyenne par arrêt et par département';
    source.show = _enabled;
    for (const entity of source.entities.values) {
      const code = String(entity.properties?.code?.getValue?.() ?? '').trim();
      if (!entity.polygon || !code) {
        entity.show = false;
        continue;
      }
      entity.polygon.outline = false;
      entity.polygon.classificationType = _classificationType ?? Cesium.ClassificationType.BOTH;
      entity.polygon.material = new Cesium.ColorMaterialProperty(Cesium.Color.TRANSPARENT);
      entity.show = false;
      const parts = _depEntities.get(code);
      if (parts) parts.push(entity);
      else _depEntities.set(code, [entity]);
    }
    if (_viewer) await _viewer.dataSources.add(source);
    _depDataSource = source;
    return source;
  })().catch((error) => {
    _depShapesPromise = null;
    throw error;
  });
  return _depShapesPromise;
}

/**
 * Paint the eight painted départements and hide the other 88.
 *
 * A département with no row, or one below the stop threshold, is HIDDEN rather
 * than painted at the bottom of the ladder — see {@link departementFill}.
 */
function repaintDepartements() {
  if (!_region) return 0;
  const materials = new Map();
  const painted = new Set();
  for (const row of _region.departements || []) {
    if (!row?.paint || !row.code) continue;
    const fill = departementFill(regionRatePerStop(row, _slot.day, _slot.band));
    if (!fill) continue;
    const key = `${fill.css}|${fill.alpha}`;
    let material = materials.get(key);
    if (!material) {
      material = new Cesium.ColorMaterialProperty(
        Cesium.Color.fromCssColorString(fill.css).withAlpha(fill.alpha),
      );
      materials.set(key, material);
    }
    const parts = _depEntities.get(row.code);
    if (!parts) continue;
    painted.add(row.code);
    for (const entity of parts) {
      if (!entity.polygon) continue;
      entity.polygon.material = material;
      entity.show = true;
    }
  }
  for (const [code, parts] of _depEntities) {
    if (painted.has(code)) continue;
    for (const entity of parts) entity.show = false;
  }
  governorRequestRender('idfm-frequency-region');
  return painted.size;
}

function hideDepartements() {
  for (const parts of _depEntities.values()) {
    for (const entity of parts) entity.show = false;
  }
}

// --- Reconciliation ---------------------------------------------------------

async function loadViewport({ force = false } = {}) {
  if (!_enabled) return;
  const previous = `${_slot.day}|${_slot.band}`;
  _slot = resolveSlot(_pinnedBand, _now());
  const slotChanged = previous !== `${_slot.day}|${_slot.band}`;

  const span = idfmFreqViewSpanDeg(_viewer);
  const next = idfmFreqRegimeFor(span, _regime);
  const regimeChanged = next !== _regime;
  _regime = next;

  if (_regime === 'arrets') {
    const box = idfmFreqViewBox(_viewer);
    // A camera inside the exact regime that yields no usable rectangle — an
    // oblique horizon shot, or a view crossing the dateline — has no box to ask
    // about. The région is the honest fallback, not an empty map.
    if (box) {
      if (regimeChanged) hideDepartements();
      await loadStops(box, { force: force || regimeChanged });
      return;
    }
    _regime = 'region';
  }

  // ONLY on the regime change. This block runs on every 60 s clock tick in the
  // wide regime, and tearing the record map down each time would drop a
  // selected département's card once a minute for no reason a reader could see.
  if (regimeChanged) {
    _points?.removeAll();
    if (_records.size) {
      clearSelection();
      _records = new Map();
    }
    _pack = null;
    _packBoxKey = null;
  }
  _loading = !_region;
  try {
    const [region] = await Promise.all([
      ensureRegion(),
      ensureDepartementShapes().catch((error) => {
        console.warn('[Data:IDFM Fréquence] département outlines unavailable:', error?.message || error);
        _error = 'contours départementaux indisponibles';
        return null;
      }),
    ]);
    if (!_enabled || _regime !== 'region') return;
    if (!region) {
      _count = 0;
      _status = 'error';
      return;
    }
    _count = repaintDepartements();
    _status = _count > 0 ? 'ok' : 'empty';
    _lastUpdate = new Date();
    if (slotChanged && _selectedId) repaintSelectedCard(_selectedId);
  } finally {
    _loading = false;
  }
}

function onCameraChanged() {
  if (!_enabled) return;
  clearTimeout(_cameraDebounceTimer);
  _cameraDebounceTimer = setTimeout(() => { void loadViewport(); }, CAMERA_DEBOUNCE_MS);
}

// --- Detection --------------------------------------------------------------

function collectDetectableObjects(options = {}) {
  if (!_enabled || _regime !== 'arrets') return [];
  const records = [];
  for (const record of _records.values()) {
    if (record.kind !== 'stop') continue;
    const rate = profileRate(record.stop.profile, _slot.day, _slot.band);
    // A stop with nothing in this band is not offered to DETECT. The callout
    // would read "0/h", which the map already says in colour, and a callout is
    // the most expensive way this app has of saying nothing.
    if (rate <= 0) continue;
    records.push({ record, rate });
  }
  if (!records.length) return [];
  // Busiest first, so a strided sample keeps the stops a reader would keep.
  records.sort((a, b) => b.rate - a.rate || a.record.id.localeCompare(b.record.id));
  const maxCount = typeof options.maxCount === 'number' && Number.isFinite(options.maxCount)
    ? Math.max(1, Math.floor(options.maxCount))
    : records.length;
  const seed = typeof options.seed === 'number' && Number.isFinite(options.seed)
    ? Math.floor(options.seed)
    : 0;
  const stride = Math.max(1, Math.ceil(records.length / maxCount));
  const start = ((seed % stride) + stride) % stride;

  const result = [];
  for (let i = start; i < records.length; i += stride) {
    const { record, rate } = records[i];
    result.push({
      position: record.position,
      sourceId: record.id,
      id: `${formatRate(rate)}/h`,
      type: 'Transit frequency',
      skipLabel: record.id === _selectedId,
    });
    if (result.length >= maxCount) break;
  }
  return result;
}

// --- Layer ------------------------------------------------------------------

const idfmFrequencyLayer = {
  id: IDFM_FREQ_LAYER_ID,
  name: 'Fréquence des transports (IDFM)',
  // ⏱ and not 🚇, 🚌 or 🚏: `idfm-network` owns the network's own vocabulary
  // next door and reuses the transit pictogram pack for its stops. This layer's
  // subject is not the mode, it is the hour, and the stopwatch is the only
  // glyph in the panel that says so.
  icon: '⏱',
  source: 'Offre hebdomadaire moyenne hors vacances — Île-de-France Mobilités',
  updateInterval: UPDATE_INTERVAL_MS,

  init(viewer) {
    _viewer = viewer;
    _points = new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT });
    _points.show = false;
    viewer?.scene?.primitives?.add?.(_points);
    registerSpriteCollection(IDFM_FREQ_LAYER_ID, _points);

    _enabled = false;
    _records = new Map();
    _selectedId = null;
    _count = 0;
    _lastUpdate = null;
    _loading = false;
    _error = null;
    _status = 'idle';
    _regime = 'region';
    _slot = resolveSlot(_pinnedBand, _now());
    _classificationType = viewer?.scene?.globe?.show === false
      ? Cesium.ClassificationType.CESIUM_3D_TILE
      : Cesium.ClassificationType.BOTH;

    _overlayHost.setVisible(IDFM_FREQ_OVERLAY_SOURCE_ID, false);
    restoreSpriteOrder(viewer);
    console.log('[Data:IDFM Fréquence] Initialized');
  },

  enable(viewer) {
    _enabled = true;
    _error = null;
    if (_points) _points.show = true;
    if (_depDataSource) _depDataSource.show = true;
    _overlayHost.setVisible(IDFM_FREQ_OVERLAY_SOURCE_ID, true);
    installClickHandler(viewer);
    registerPickOwner(IDFM_FREQ_LAYER_ID, (pickedId) => _records.has(pickedId));
    if (!_cameraChangedAttached && viewer?.camera) {
      viewer.camera.changed.addEventListener(onCameraChanged);
      claimCameraSensitivity(viewer, IDFM_FREQ_LAYER_ID);
      _cameraChangedAttached = true;
    }
    if (!_preRenderRemover && viewer?.scene?.preRender) {
      _preRenderRemover = viewer.scene.preRender.addEventListener(onPreRender);
    }
    restoreSpriteOrder(viewer);
    // DataLayerManager calls update() immediately after enable() and that call
    // owns the first fetch; racing it with a second request here would double
    // every cold start.
  },

  disable(viewer) {
    _enabled = false;
    _requestGeneration += 1;
    clearTimeout(_cameraDebounceTimer);
    _cameraDebounceTimer = null;
    clearSelection();
    _points?.removeAll();
    _records = new Map();
    _count = 0;
    hideDepartements();
    if (_depDataSource) _depDataSource.show = false;
    if (_points) _points.show = false;
    _overlayHost.setVisible(IDFM_FREQ_OVERLAY_SOURCE_ID, false);
    if (_clickHandler) {
      _clickHandler.destroy();
      _clickHandler = null;
    }
    if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeyDown);
    unregisterPickOwner(IDFM_FREQ_LAYER_ID);
    if (_cameraChangedAttached && viewer?.camera) {
      viewer.camera.changed.removeEventListener(onCameraChanged);
      releaseCameraSensitivity(viewer, IDFM_FREQ_LAYER_ID);
      _cameraChangedAttached = false;
    }
    if (_preRenderRemover) {
      _preRenderRemover();
      _preRenderRemover = null;
    }
    _loading = false;
    _status = 'idle';
  },

  /**
   * The minute tick.
   *
   * Not forced: the pack is keyed on the snapped box and the profiles carry all
   * 7 × 24 bands, so a clock tick that changes the band is a repaint of what
   * the browser already holds. Only a camera move to a box it has not asked for
   * touches the network.
   */
  async update() {
    if (!_enabled) return true;
    await loadViewport();
    return true;
  },

  getDetectableObjects(options = {}) {
    return collectDetectableObjects(options);
  },

  getStats() {
    const stats = {
      count: _count,
      lastUpdate: _lastUpdate,
      loading: _loading,
      status: _status,
      regime: _regime,
      day: _slot.day,
      band: _slot.band,
      pinned: _pinnedBand !== null,
      edition: (_regime === 'arrets' ? _pack : _region)?.edition ?? null,
      // The layer's own honesty numbers, surfaced rather than buried.
      stopsWithoutCoordinate: _region?.totals?.unplaced ?? null,
      stopsInRegion: _region?.totals?.stops ?? null,
    };
    if ((_regime === 'arrets' ? _pack : _region)?.stale) stats.stale = true;
    const label = buildFrequencyLoadingLabel();
    if (label) stats.loadingLabel = label;
    if (_error) stats.error = _error;
    return stats;
  },

  /** Provenance for the attribution popover and the analyst surfaces. */
  getViewportSummary() {
    const payload = _regime === 'arrets' ? _pack : _region;
    if (!payload) return null;
    const { stops, departements, ...summary } = payload;
    return {
      ...summary,
      regime: _regime,
      day: _slot.day,
      band: _slot.band,
      drawn: _count,
    };
  },

  /**
   * Seven moment chips and the ladder legend for whichever scale is on screen.
   *
   * The chips are NOT serialized into the share link — the layer is registered
   * `enabled-only`, and `OPTION_GROUPS` in `layerState.js` is a shared file this
   * layer does not own — so a shared view always opens on the reader's own
   * Paris clock rather than on somebody else's pinned hour. That is the right
   * default anyway: a link that silently pinned 03:00 would show a stranger an
   * empty city and no way to know why.
   *
   * The legend counts what is DRAWN, and the silent row is kept even at zero,
   * because "nothing stops here at this hour" is the entry a reader has to be
   * given before they can read the map at all.
   */
  getRowControls() {
    const chips = IDFM_FREQ_MOMENTS.map((moment) => ({
      id: moment.id,
      label: moment.label,
      active: moment.band === null ? _pinnedBand === null : _pinnedBand === moment.band,
      state: (moment.band === null ? _pinnedBand === null : _pinnedBand === moment.band)
        ? 'active' : 'idle',
      title: moment.band === null
        ? `Suivre l’horloge de Paris — actuellement ${IDFM_FREQ_DAY_LABELS[_slot.day]} ${bandLabel(_slot.band)}`
        : `${IDFM_FREQ_DAY_LABELS[_slot.day]} ${bandLabel(moment.band)}`,
      params: { band: moment.band === null ? 'now' : moment.band },
    }));

    const counts = new Array(IDFM_FREQ_RAMP.length).fill(0);
    let silent = 0;
    if (_regime === 'arrets') {
      for (const record of _records.values()) {
        if (record.kind !== 'stop') continue;
        const level = frequencyLevel(profileRate(record.stop.profile, _slot.day, _slot.band));
        if (level < 0) silent += 1;
        else counts[Math.min(level, counts.length - 1)] += 1;
      }
    } else {
      for (const row of _region?.departements || []) {
        if (!row?.paint) continue;
        const rate = regionRatePerStop(row, _slot.day, _slot.band);
        if (rate === null) continue;
        const level = frequencyLevel(rate);
        if (level < 0) silent += 1;
        else counts[Math.min(level, counts.length - 1)] += 1;
      }
    }

    const legend = [];
    counts.forEach((count, level) => {
      if (!count) return;
      legend.push({
        label: levelLabel(level),
        color: levelColor(level),
        count,
        blurb: LEVEL_BLURBS[level],
      });
    });
    legend.push({
      label: IDFM_FREQ_SILENT_LABEL,
      color: IDFM_FREQ_SILENT_COLOR,
      count: silent,
      blurb: SILENT_BLURB,
    });
    // The stops nobody can draw travel with the legend at every zoom: 549 stops
    // and 2.76 % of an average Tuesday's courses are not on this map, and that
    // is a number a reader has to carry with the ones that are.
    if (_region?.totals?.unplaced) {
      legend.push({
        label: 'sans coordonnée publiée',
        color: IDFM_FREQ_SILENT_COLOR,
        count: _region.totals.unplaced,
        blurb: 'Arrêts sans latitude ni longitude dans le fichier — 473 Train, 69 Bus, 7 Tramway. '
          + '518 se rattachent à une zone d’arrêt du référentiel, mais 512 de ces zones ont deux '
          + 'quais ou plus : il n’existe pas de point publié à emprunter, donc ils sont comptés '
          + 'et jamais placés.',
      });
    }
    return { chips, legend };
  },

  /**
   * Pin a band, or hand the clock back.
   *
   * `'now'` is the only string accepted and an unknown band is ignored rather
   * than clamped: a chip that silently moved the reader to 04:00 because a
   * caller sent nonsense would be worse than a chip that did nothing.
   */
  setParams(params = {}) {
    const raw = params?.band;
    let next;
    if (raw === 'now' || raw === null) next = null;
    else if (typeof raw === 'number' && Number.isInteger(raw)
      && raw >= IDFM_FREQ_BAND_MIN && raw <= IDFM_FREQ_BAND_MAX) next = raw;
    else return;
    if (next === _pinnedBand) return;
    _pinnedBand = next;
    _slot = resolveSlot(_pinnedBand, _now());
    if (_regime === 'arrets') restyleStops();
    else repaintDepartements();
    if (_selectedId) repaintSelectedCard(_selectedId);
  },

  getParams() {
    return { band: _pinnedBand === null ? 'now' : _pinnedBand, day: _slot.day };
  },

  destroy(viewer) {
    if (_enabled) this.disable(viewer);
    else {
      clearSelection();
      _overlayHost.setVisible(IDFM_FREQ_OVERLAY_SOURCE_ID, false);
      if (_clickHandler) {
        _clickHandler.destroy();
        _clickHandler = null;
      }
      if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeyDown);
      unregisterPickOwner(IDFM_FREQ_LAYER_ID);
    }
    if (_preRenderRemover) {
      _preRenderRemover();
      _preRenderRemover = null;
    }
    if (_points) {
      unregisterSpriteCollection(IDFM_FREQ_LAYER_ID, _points);
      viewer?.scene?.primitives?.remove?.(_points);
      _points = null;
    }
    if (_depDataSource) {
      viewer?.dataSources?.remove?.(_depDataSource, true);
      _depDataSource = null;
    }
    _depEntities.clear();
    _depMeta = new Map();
    _depShapesPromise = null;
    _records.clear();
    _pack = null;
    _packBoxKey = null;
    _region = null;
    _viewer = null;
  },
};

// --- Test seams -------------------------------------------------------------

/**
 * Seed the layer so cards, legends, selection, DETECT and stats run against the
 * production code paths with no WebGL and no network.
 *
 * `pack` and `region` are the two payload shapes the proxy serves. Passing
 * `pack` builds the records exactly as `reconcileStops` would, minus the
 * primitives — which is the point: a test that hand-rolled the record map would
 * prove nothing about the function that actually builds it.
 */
export function _setIdfmFrequencyStateForTest({
  viewer, overlayHost, http, now, points = null, pack = null, region = null, depMeta = null,
  pinnedBand = null, regime = pack ? 'arrets' : 'region', enabled = true, status = 'ok',
} = {}) {
  _viewer = viewer || null;
  _overlayHost = overlayHost || DEFAULT_OVERLAY_HOST;
  _http = http || DEFAULT_HTTP;
  _now = typeof now === 'function' ? now : (typeof now === 'number' ? () => now : DEFAULT_NOW);
  // A caller that supplies a stand-in collection gets real `point` objects on
  // every record, so the style a test asserts is the one `reconcileStops`
  // actually handed the renderer rather than a copy the test made itself.
  _points = points || null;
  _enabled = enabled;
  _regime = regime;
  _pinnedBand = pinnedBand;
  _slot = resolveSlot(_pinnedBand, _now());
  _pack = pack;
  _packBoxKey = pack ? 'test' : null;
  _region = region;
  _depMeta = new Map(depMeta || []);
  _records = new Map();
  _selectedId = null;
  _error = null;
  _status = status;
  _loading = false;
  _lastUpdate = null;
  if (pack) {
    reconcileStops(pack);
  } else {
    _count = region?.departements?.filter((row) => row?.paint).length || 0;
  }
}

/** Exercise the production stop-selection path. */
export function _selectIdfmFrequencyForTest(id) {
  selectStop(id);
}

/** Exercise the production département-selection path. */
export function _selectIdfmFrequencyDepartementForTest(code) {
  selectDepartement(code);
}

/** Exercise the production clear path and restore the production seams. */
export function _clearIdfmFrequencySelectionForTest() {
  clearSelection();
  _overlayHost = DEFAULT_OVERLAY_HOST;
  _http = DEFAULT_HTTP;
  _now = DEFAULT_NOW;
  _records = new Map();
  _pack = null;
  _packBoxKey = null;
  _region = null;
  _depMeta = new Map();
  _pinnedBand = null;
  _regime = 'region';
  _count = 0;
  _enabled = false;
  _status = 'idle';
  _points = null;
}

/** Whatever is selected right now. */
export function _idfmFrequencySelectedIdForTest() {
  return _selectedId;
}

/** One drawn record, for assertions about style. */
export function _idfmFrequencyRecordForTest(id) {
  return _records.get(id) || null;
}

/** The slot the layer would draw. */
export function _idfmFrequencySlotForTest() {
  return { ..._slot, pinned: _pinnedBand };
}

/** Row controls, for tests that do not construct a viewer. */
export function _idfmFrequencyRowControlsForTest() {
  return idfmFrequencyLayer.getRowControls();
}

/** Stats, for tests that do not construct a viewer. */
export function _idfmFrequencyStatsForTest() {
  return idfmFrequencyLayer.getStats();
}

/** DETECT candidates, for tests that do not construct a viewer. */
export function _idfmFrequencyDetectablesForTest(options = {}) {
  return collectDetectableObjects(options);
}

/** Drive the production `setParams` path. */
export function _idfmFrequencySetParamsForTest(params) {
  idfmFrequencyLayer.setParams(params);
}

export default idfmFrequencyLayer;
