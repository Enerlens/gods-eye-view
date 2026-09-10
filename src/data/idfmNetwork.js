import * as Cesium from 'cesium';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { governorRequestRender } from '../renderGovernor.js';
import {
  ADDRESS_SCAN_MOVE_DEBOUNCE_MS,
  SEAT_SETTLE_MS,
  emphasiseAddressMarker,
  renderedGroundM,
  restoreAddressMarker,
  seatEntitiesOnGround,
} from './addressScanLayer.js';
import { addressMarkerGlyph, idfmStopGlyphKind } from './addressMarkerIcons.js';
import { IDFM_MODES } from './idfmFeed.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import { registerSpriteCollection, restoreSpriteOrder, unregisterSpriteCollection } from './spriteOrder.js';
import { transitVehicleGlyph } from './transitVehicleIcons.js';
import { greatCircleKm } from './trafficBounds.js';
import { textSparkline } from './sparkline.js';
import { boxKey, padBox, snapBoxOutward } from './viewportBox.js';
import {
  getWeekHour,
  setWeekHour,
  subscribeWeekHour,
  weekHourFromOperatingSlot,
  weekHourToOperatingSlot,
} from './weekHourCursor.js';
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

/**
 * Île-de-France Mobilités — ONE layer for the Paris network: what serves this
 * stop, and how often it does.
 *
 * ── The absence this layer answers ──────────────────────────────────────────
 * `transitCoverage.js` measured it across all 148 queryable national feeds:
 * **0 live vehicles in Paris intra-muros** against 453 in Bordeaux, because
 * IDFM publishes no GTFS-Realtime vehicle positions at all. The flagship
 * live-transit layer is therefore blank over the one city this fork opens on,
 * and blank is indistinguishable from broken.
 *
 * What IDFM does publish, keylessly and completely, is the OFFER, and it
 * publishes it twice:
 *
 *   - `arrets` / `referentiel-des-lignes` — 37 956 stops and 2 121 lines, each
 *     line with its official livery, ODbL 1.0. This says WHAT serves a stop:
 *     the mode, the fare zone, whether the platform is step-free.
 *   - `offre_hebdomadaire_moyenne_hors_vacances` — 1 311 578 rows of average
 *     courses per stop, per line and per one-hour band over a typical
 *     term-time week, Licence Ouverte v2.0. This says HOW MUCH, and it is the
 *     only time-of-day dimension on this globe.
 *
 * ── Why these are ONE row and not two ───────────────────────────────────────
 * They were two rows until 2026-09-10, and the case for the split was written
 * at length: two licences, a rate is not a referential, neither set contains
 * the other, and the query gates differ by 12× in payload. Every one of those
 * is true and none of them is a reason to make the READER do the join. Two
 * chips drew ONE subject — measured 2026-09-02 against the referential,
 * **34 903 of the frequency file's 36 502 stops (95.6 %) join on `arrets.arrid`**
 * — and the reader who wanted "how good is the transport at this address" had
 * to know to press both. The four differences survive as facts ON THE CARD:
 * the licence line names both licences, the card says when a stop publishes no
 * profile, and the frequency half simply stops drawing above its own gate
 * rather than dragging the referential up with it.
 *
 * What did NOT survive is the département choropleth the frequency row painted
 * above that gate. Eight polygons carrying a per-stop mean, at an alpha that
 * had to stay low enough for satellite imagery underneath — it read as a faint
 * wash over half of France and answered a question nobody had asked at that
 * altitude. The stop-level product is the product.
 *
 * ── Two marks on one coordinate, measured then designed around ──────────────
 * Every stop can carry two: the mode's pictogram, and the rate disc under it.
 * Measured over the 805 stops in the 4 km Châtelet box, 2026-09-02: median
 * nearest-neighbour distance **24.2 m**, p10 8.9 m, **463 stops with a
 * neighbour inside 30 m**. Three consequences, all visible below:
 *
 *  • SIZE IS SMALL AND BOUNDED. 4.5 px silent to 13.0 px at 32 departures an
 *    hour — strictly under the SMALLEST pictogram (14 px bus; métro and rail
 *    are 24 px). The rate disc sits INSIDE the mode glyph rather than fighting
 *    it, and at that density a bigger disc would be a smear.
 *  • THE FILL IS TRANSLUCENT AND THE RIM IS NOT. Which of the point collection
 *    and the entity billboards paints last is not something this module can
 *    pin, so the composition reads both ways: at α 0.55 the pictogram survives
 *    underneath, and the opaque rim survives on top.
 *  • THE RAMP CANNOT BE READ AS A MODE. {@link IDFM_MODE_COLORS} is five
 *    saturated hues; {@link IDFM_FREQ_RAMP} is a desaturated cold→warm
 *    lightness ladder that holds none of them.
 *
 * ── Two queries, two gates, one row ─────────────────────────────────────────
 * THE REFERENTIAL is a viewport box: the stops API takes a bounding box, so
 * the viewport IS the natural query. It draws below {@link ACTIVATION_ALTITUDE_M}.
 *
 * THE FREQUENCY is a tighter viewport box, because its rows are 24 per stop
 * and `offset + limit <= 20000` is a hard cap under `group_by`: five upstream
 * calls buy at most {@link IDFM_FREQ_MAX_STOPS} full profiles. It draws below
 * {@link STOPS_ENTER_SPAN_DEG} of view span and leaves above
 * {@link STOPS_EXIT_SPAN_DEG}, with hysteresis so a wheel notch cannot flip it.
 * Between the two gates the pictograms are on their own and the card says so,
 * which is the honest answer: "not at this altitude", never a silent zero.
 *
 * ── The clock is Paris's, and the day runs 04:00 → 03:59 ────────────────────
 * The default moment is `Europe/Paris` NOW, mapped onto the operating day by
 * `operatingSlot()`: 01:30 on a Wednesday is TUESDAY's band 25, and getting
 * that backwards moves every night reading onto the wrong day. Friday night is
 * where it costs most — band 25 is 15 904 courses region-wide on a Monday and
 * **31 585 on a Friday, +98.6 %**.
 *
 * ── Silence is measured, so it is NOT grey ──────────────────────────────────
 * `fraicheurParis.js` established the rule: grey `#8a93a6` means "the register
 * did not measure this" and nothing else. A stop that publishes a profile and
 * has no course in the selected band WAS measured, and the published answer is
 * zero. It keeps its own dark colour, its own legend row, its own card line,
 * and it is DRAWN.
 *
 * @module data/idfmNetwork
 */

// --- Referential half -------------------------------------------------------

/** Above this the stop density is a smear, and the box exceeds what is served. */
const ACTIVATION_ALTITUDE_M = 20_000;
/**
 * Refresh cadence — 60 s, and it is a CLOCK tick more than a data poll.
 *
 * Neither product changes in a minute: a stop referential does not move, and
 * the offer is a yearly average republished a few times a year. What changes
 * in a minute is which band `Europe/Paris` is in, and half this layer is a
 * function of that. `update()` re-reads the clock, repaints from the packs it
 * already holds, and only touches the network when the camera has moved to a
 * box it has not asked for.
 */
const UPDATE_INTERVAL_MS = 60_000;
/** Movement, in km, before the referential box is re-queried. */
const MIN_SHIFT_KM = 0.4;
/** Widest box the proxy accepts, in degrees per side. */
const MAX_BOX_DEG = 1;
/** Stops asked for in one query. */
const STOP_LIMIT = 100;

/**
 * Fallback colours by mode, used ONLY for stops.
 *
 * The lines carry their own published livery and it is never overridden. A
 * stop, though, serves several lines at once and has no colour of its own, so
 * these are the mode families — deliberately muted, so they never read as a
 * line colour a Parisian would recognise.
 */
export const IDFM_MODE_COLORS = Object.freeze({
  metro: '#ffb03d',
  rail: '#3d8bff',
  tram: '#3dd6c4',
  bus: '#c9d4e0',
  funicular: '#ff7ad9',
  cableway: '#ff7ad9',
});
const COLOR_UNKNOWN_MODE = Cesium.Color.fromCssColorString('#7c8aa0');

/**
 * Marker size by mode, in CSS px: a metro entrance matters more to a reader
 * than one of the eighteen bus poles around it.
 */
const MODE_SIZE = Object.freeze({ metro: 24, rail: 24, tram: 20, bus: 14 });
/** A mode this layer has no size rule for. */
const DEFAULT_MODE_SIZE = 16;

// --- Frequency half ---------------------------------------------------------

/** Layer id — also the share-link registry key and the voice-tool enum value. */
export const IDFM_LAYER_ID = 'idfm-network';

/** Selected-stop card, on its own protected overlay source. */
export const IDFM_OVERLAY_SOURCE_ID = 'idfm-network';
export const IDFM_OVERLAY_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 1,
  moving: false,
});

const STOPS_URL = '/api/idfm/stops';
const FREQ_URL = '/api/idfm-frequency/stops';

/**
 * Frequency regime boundary, in degrees of the wider view span, with hysteresis.
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
 * proxy refuses the box after a single cheap call.
 */
export const STOPS_ENTER_SPAN_DEG = 0.035;
export const STOPS_EXIT_SPAN_DEG = 0.045;

/** View padding before the frequency box is snapped, as a fraction of the span. */
const BOX_PAD_FRACTION = 0.08;

const FREQ_TIMEOUT_MS = 45_000;

/** Discs rendered at once. Mirrors the feed's ceiling; the proxy enforces it. */
const MAX_RENDERED_DISCS = IDFM_FREQ_MAX_STOPS;

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
 * magnitude ramp painted over central Paris. And deliberately far from the five
 * saturated MODE hues above, because those two marks land on the same point.
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
 * Not 24 chips, and not a day axis — the day is the cheaper axis to give up:
 * Monday, Tuesday and Thursday differ by 0.36 % across the whole région
 * (3 066 375 / 3 071 759 / 3 077 377 courses). Every card carries all seven
 * days for the selected band anyway, so Friday night is one click away from
 * any stop. `now` follows the Paris clock through `operatingSlot()`; the other
 * six pin a band and keep today's day. They are the hours a reader actually
 * asks about rather than an even spread: the first service, the morning peak,
 * midday, the evening peak, late evening, and the one o'clock band where half
 * this network stops existing.
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
let _dataSource = null;
let _enabled = false;
let _lastCentre = null;
let _lastUpdate = null;
let _lastError = null;
let _count = 0;
let _total = null;
let _truncated = false;
let _byMode = {};
let _dormant = false;
let _clickHandler = null;
let _selectedId = null;
let _selectedBase = null;
let _moveEndRemover = null;
let _debounceTimer = null;
let _scanning = false;
let _rescanQueued = false;
let _tileProgressRemover = null;
let _seatTimer = null;
let _seatPending = false;
/** Referential rows by `arrid`, so a picked disc can read its own network row. */
let _refStops = new Map();

let _points = null;
/** Frequency records by `idfm-freq:<id_arret>`, one per drawn disc. */
let _freqRecords = new Map();
/** The same records by bare `id_arret`, which is what joins `arrets.arrid`. */
let _freqByStopId = new Map();
let _freqPack = null;
let _freqPackBoxKey = null;
let _freqRegime = 'wide';
let _freqLoading = false;
let _freqStatus = 'idle';
let _freqError = null;
let _freqGeneration = 0;

/** `null` means "follow the Paris clock"; a number pins the band. */
let _pinnedBand = null;
/** `null` means "today"; a day name pins it. Only ever set with a band. */
let _pinnedDay = null;
/** Stop following the shared week-hour cursor. Null while the layer is off. */
let _weekHourUnsubscribe = null;
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
 * The pictogram a stop is drawn with.
 *
 * A stop is signed in the street with its MODE's pictogram — the bus on the
 * pole, the M on the entrance — so these reuse `transitVehicleIcons.js` rather
 * than inventing a second transit vocabulary for the same city. A mode that
 * pack cannot draw falls back to the urbanism plan sheet rather than borrowing
 * another mode's vehicle, which would assert something the referential never
 * said.
 *
 * @param {?string} mode
 * @returns {string} data URI.
 */
export function stopGlyph(mode) {
  return transitVehicleGlyph(idfmStopGlyphKind(mode)) || addressMarkerGlyph('plan');
}

/**
 * Colour a stop by its mode family.
 * @param {string} mode
 * @returns {object} Cesium colour.
 */
export function stopColor(mode) {
  const css = IDFM_MODE_COLORS[mode];
  return css ? Cesium.Color.fromCssColorString(css) : COLOR_UNKNOWN_MODE;
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
 * The slot to draw: the pinned band, on the pinned day or on today's.
 *
 * The seven chips give up the day axis for the reason the module header
 * states, but the pack holds a full 7 × 24 profile per stop and
 * `weekHourCursor.js` is a control that can name a day without spending a chip
 * on each one. So a day arriving from the shared cursor is honoured, and a day
 * arriving from nowhere is still today's.
 *
 * @param {?number} pinned Band 4-27, or null to follow the Paris clock.
 * @param {number|Date} [now]
 * @param {?string} [pinnedDay] One of {@link IDFM_FREQ_DAYS}, or null.
 * @returns {{day:string, band:number, pinned:boolean}}
 */
export function resolveSlot(pinned, now = Date.now(), pinnedDay = null) {
  const live = parisOperatingSlot(now);
  const day = IDFM_FREQ_DAYS.includes(pinnedDay) ? pinnedDay : live.day;
  if (typeof pinned !== 'number' || !Number.isFinite(pinned)) {
    return { day, band: live.band, pinned: false };
  }
  return { day, band: clampBand(pinned), pinned: true };
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

/**
 * Read the current viewport as a bounding box, clamped to what the proxy takes.
 * @param {object} viewer
 * @returns {{west: number, south: number, east: number, north: number,
 *   lat: number, lon: number, altitudeM: number}|null}
 */
export function viewportBox(viewer) {
  const rectangle = viewer?.camera?.computeViewRectangle?.(viewer.scene?.globe?.ellipsoid);
  const carto = viewer?.camera?.positionCartographic;
  if (!rectangle || !carto) return null;
  const west = Cesium.Math.toDegrees(rectangle.west);
  const south = Cesium.Math.toDegrees(rectangle.south);
  const east = Cesium.Math.toDegrees(rectangle.east);
  const north = Cesium.Math.toDegrees(rectangle.north);
  if (![west, south, east, north].every(Number.isFinite)) return null;
  const lat = (south + north) / 2;
  const lon = (west + east) / 2;
  // At oblique pitch the rectangle runs to the horizon; clamping keeps the
  // query over what is actually on screen instead of over the next département.
  const halfLon = Math.min(MAX_BOX_DEG / 2, Math.abs(east - west) / 2);
  const halfLat = Math.min(MAX_BOX_DEG / 2, Math.abs(north - south) / 2);
  return {
    west: lon - halfLon,
    south: lat - halfLat,
    east: lon + halfLon,
    north: lat + halfLat,
    lat,
    lon,
    altitudeM: carto.height,
  };
}

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
 * Whether a span can afford the frequency product, with hysteresis so the
 * discs do not blink on a wheel notch at the boundary.
 * @param {number} spanDeg
 * @param {string} [current]
 * @returns {'arrets'|'wide'}
 */
export function idfmFreqRegimeFor(spanDeg, current = 'wide') {
  const span = typeof spanDeg === 'number' && Number.isFinite(spanDeg) ? spanDeg : Infinity;
  if (current === 'arrets') return span > STOPS_EXIT_SPAN_DEG ? 'wide' : 'arrets';
  return span <= STOPS_ENTER_SPAN_DEG ? 'arrets' : 'wide';
}

/**
 * The box the frequency query asks for: the view, padded, then snapped OUTWARD
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
 * What the referential says about a stop, on one line.
 *
 * `null` accessibility is "nobody surveyed it", which is not "not accessible" —
 * and for a reader deciding where to live that distinction is the whole point.
 *
 * @param {?object} ref Projected `arrets` row.
 * @returns {?string}
 */
export function networkLine(ref) {
  if (!ref) return null;
  return [
    ref.modeLabel || IDFM_MODES[ref.mode] || null,
    ref.town,
    ref.fareZone ? `zone ${ref.fareZone}` : null,
    ref.accessible === true ? 'accessible'
      : ref.accessible === 'partial' ? 'partiellement accessible'
        : ref.accessible === false ? 'non accessible'
          : 'accessibilité non renseignée',
  ].filter(Boolean).join(' · ');
}

/**
 * The selected stop's card — the network half and the frequency half, in one.
 *
 * This is the merge, stated as copy. Either half may be missing and the card
 * says which: a referential stop outside the frequency file (3 053 of 37 956,
 * 8.0 %) gets a line saying no profile is published, and a stop looked at from
 * too far up gets a line saying the hourly offer is not read at this altitude.
 * Neither is ever a zero, because a zero here is a measured claim.
 *
 * Every line is either published or an arithmetic identity on a published
 * number, and the last two lines say which week was drawn and under which
 * licences — this is a yearly average of a term-time week, not a timetable.
 *
 * @param {{ref:?object, freq:?object}} stop
 * @param {{day:string, band:number, pack:?object, regime:string}} context
 * @returns {string} Title on the first line, details after.
 */
export function buildStopCard({ ref = null, freq = null } = {}, context = {}) {
  if (!ref && !freq) return '';
  const day = context.day || _slot.day;
  const band = clampBand(context.band ?? _slot.band);
  const pack = context.pack || null;
  const regime = context.regime || _freqRegime;

  const lines = [ref?.name || freq?.name || `Arrêt ${ref?.id || freq?.id}`];

  const where = networkLine(ref);
  if (where) {
    lines.push(where);
  } else if (freq) {
    // No referential row: the frequency file publishes its own mode and
    // commune, and they are said as its own rather than borrowed.
    const own = [IDFM_FREQ_MODE_LABELS[freq.mode] || IDFM_FREQ_MODE_LABELS.unknown];
    if (freq.commune) own.push(freq.dept ? `${freq.commune} (${freq.dept})` : freq.commune);
    lines.push(own.join(' · '));
  }

  if (freq) {
    const rate = profileRate(freq.profile, day, band);
    const when = `${IDFM_FREQ_DAY_LABELS[day] || day} ${bandLabel(band)}`;
    if (rate > 0) lines.push(`${when} — ${formatRate(rate)} départs/h · ${waitPhrase(rate)}`);
    else lines.push(`${when} — ${IDFM_FREQ_SILENT_LABEL}`);

    const glyphs = dayGlyphs(freq.profile, day);
    if (glyphs) lines.push(`04 h ${glyphs} 03 h`);

    const span = profileSpan(freq.profile, day);
    const peak = profilePeak(freq.profile, day);
    const shape = [];
    if (span) shape.push(`premier ${bandLabel(span.first)}`.replace(/–\d{2}:\d{2}$/, ''));
    if (peak) shape.push(`pointe ${bandLabel(peak.band).replace(/–\d{2}:\d{2}$/, '')} à ${formatRate(peak.rate)}/h`);
    if (span) shape.push(`dernier ${bandLabel(span.last)}`.replace(/–\d{2}:\d{2}$/, ''));
    if (shape.length) lines.push(shape.join(' · '));

    lines.push(`Total ${IDFM_FREQ_DAY_LABELS[day] || day} : ${formatRate(profileDayTotal(freq.profile, day))} courses`);
    lines.push(`Même tranche : ${weekLine(freq.profile, band)}`);

    // A stop that publishes fewer than 24 bands is not truncated: it simply has
    // no service in the rest of them. Saying so stops the sparkline's flat tail
    // reading as a gap in the feed.
    if (typeof freq.bands === 'number' && freq.bands > 0 && freq.bands < 24) {
      lines.push(`${freq.bands} tranches publiées sur 24 — aucune course dans les autres`);
    }
    if (Array.isArray(freq.aliases) && freq.aliases.length) {
      lines.push(`Aussi publié « ${freq.aliases.join(' », « ')} » au même point`);
    }
    const missing = missingWindows(pack);
    if (missing) {
      lines.push(`${missing} des 4 fenêtres horaires n’ont pas répondu — un creux `
        + 'du graphique peut être une panne amont, pas une absence de service');
    }
    if (freq.mode === 'unknown' && !ref) {
      lines.push('Mode non publié par ce jeu de données — non emprunté au référentiel');
    }
    lines.push(`Offre moyenne, semaine type hors vacances ${pack?.year || IDFM_FREQ_REFERENCE_YEAR}`);
  } else if (regime === 'arrets') {
    // In the regime and still no profile: measured, 3 053 of the 37 956
    // referential stops (8.0 %) have no row in the offer file at all.
    lines.push('Aucun profil horaire publié pour cet arrêt dans l’offre IDFM');
  } else {
    lines.push('Offre horaire non lue à cette altitude — rapprochez-vous pour la fréquence');
  }

  lines.push('Île-de-France Mobilités — réseau ODbL 1.0 · fréquence Licence Ouverte v2.0');
  return lines.join('\n');
}

/**
 * One line under the layer's toggle: what this view actually contains.
 *
 * It always names the DAY when it names an hour, because the map is always
 * today and a Sunday screenshot must not be readable as a weekday one.
 */
export function buildLoadingLabel({
  regime = _freqRegime,
  status = _freqStatus,
  loading = _freqLoading,
  slot = _slot,
  pinned = _pinnedBand !== null,
  records = _freqRecords,
  pack = _freqPack,
  dormant = _dormant,
  stops = _count,
} = {}) {
  if (dormant) return 'rapprochez-vous : le réseau IDFM se dessine sous 20 km d’altitude';
  if (loading) return 'lecture de l’offre horaire IDFM…';

  const parts = [`${fr(stops)} arrêts`];
  if (regime !== 'arrets') {
    return parts.concat('fréquence à partir d’une vue de 5 km').join(' · ');
  }
  const when = `${IDFM_FREQ_DAY_LABELS[slot.day] || slot.day} ${bandLabel(slot.band)}`;
  parts.push(pinned ? when : `${when} (heure de Paris)`);
  if (status === 'error') return parts.concat('offre horaire IDFM indisponible').join(' · ');

  if (pack?.tooDense) {
    // "au moins", because the identity page saturates: the proxy knows the box
    // holds more than the ceiling and cannot know how many more without buying
    // the pages it just refused.
    return parts.concat(
      `${pack.stopsAtLeast ? 'au moins ' : ''}${fr(pack.stopsInBox ?? 0)} arrêts dans `
      + `cette vue, plus que les ${fr(IDFM_FREQ_MAX_STOPS)} chiffrés — rapprochez-vous`,
    ).join(' · ');
  }
  if (!records.size) return parts.concat('aucune fréquence publiée dans cette vue').join(' · ');
  parts.push(`${fr(records.size)} chiffrés`);
  let silent = 0;
  let top = 0;
  for (const record of records.values()) {
    const rate = profileRate(record.stop.profile, slot.day, slot.band);
    if (rate <= 0) silent += 1;
    else if (frequencyLevel(rate) >= IDFM_FREQ_LEVELS.length) top += 1;
  }
  if (top) parts.push(`${fr(top)} à plus de ${IDFM_FREQ_LEVELS[IDFM_FREQ_LEVELS.length - 1]}/h`);
  if (silent) parts.push(`${fr(silent)} sans passage`);
  if (pack?.refused) parts.push(`${fr(pack.refused)} non chiffrés`);
  // The band axis costs four upstream pages, and losing one is a hole in the
  // DAY rather than a hole in the map. Unnamed, that hole reads as "no service
  // between 16:00 and 21:00", which is the worst lie this layer could tell.
  const missing = missingWindows(pack);
  if (missing) parts.push(`${missing} fenêtres horaires manquantes en amont`);
  return parts.join(' · ');
}

// --- Overlay ----------------------------------------------------------------

/**
 * The one card this layer ever paints.
 *
 * Its own entry builder rather than `createAddressScanOverlayEntry`: that one
 * caps `details` at six lines, which is right for a card carrying one register
 * and wrong for a card carrying two.
 */
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

function slotContext() {
  return { day: _slot.day, band: _slot.band, pack: _freqPack, regime: _freqRegime };
}

/**
 * The two halves a selection id resolves to.
 *
 * One id space, two primitive kinds: `idfm:stop:<arrid>` is a referential
 * billboard and `idfm-freq:<id_arret>` is a rate disc. Both resolve to the
 * SAME pair, which is what makes the two marks on one coordinate open one card.
 *
 * @param {string} id
 * @returns {?{ref:?object, freq:?object, position:object}}
 */
export function resolveSelection(id) {
  if (typeof id !== 'string' || !id) return null;
  if (id.startsWith('idfm:stop:')) {
    const stopId = id.slice('idfm:stop:'.length);
    const ref = _refStops.get(stopId) || null;
    if (!ref) return null;
    // The seated entity is the truth about where the marker IS — a stop drawn
    // on the ellipsoid stands eighty metres under its pavement — so the
    // published coordinate is only the fallback for a marker not yet drawn.
    const entity = _dataSource?.entities?.getById(id);
    const position = entity?.position?.getValue?.(Cesium.JulianDate.now())
      ?? (Number.isFinite(ref.lon) && Number.isFinite(ref.lat)
        ? Cesium.Cartesian3.fromDegrees(ref.lon, ref.lat)
        : null);
    if (!position) return null;
    return { ref, freq: _freqByStopId.get(stopId)?.stop || null, position };
  }
  const record = _freqRecords.get(id);
  if (!record) return null;
  return { ref: _refStops.get(record.stop.id) || null, freq: record.stop, position: record.position };
}

/** Protected selected-stop entry for the shared overlay host. */
export function createSelectedOverlayEntry(id, context = {}) {
  const resolved = resolveSelection(id);
  if (!resolved) return null;
  const copy = buildStopCard(resolved, context);
  if (!copy) return null;
  return selectedOverlayEntry(id, resolved.position, copy);
}

// --- Selection --------------------------------------------------------------

function restoreDiscStyle(record) {
  if (!record?.point || !record.style) return;
  record.point.color = Cesium.Color.fromCssColorString(record.style.css).withAlpha(record.style.alpha);
  record.point.outlineColor = Cesium.Color.fromCssColorString(record.style.css).withAlpha(RIM_ALPHA);
  record.point.pixelSize = record.style.sizePx;
}

function clearSelection() {
  if (!_selectedId) return;
  if (_selectedBase) {
    restoreAddressMarker(_dataSource?.entities?.getById(_selectedId), _selectedBase);
  }
  restoreDiscStyle(_freqRecords.get(_selectedId));
  _selectedBase = null;
  _selectedId = null;
  _overlayHost.clearSource(IDFM_OVERLAY_SOURCE_ID);
  governorRequestRender('idfm-network-deselect');
}

function repaintSelectedCard() {
  if (!_selectedId) return;
  const entry = createSelectedOverlayEntry(_selectedId, slotContext());
  if (entry) {
    _overlayHost.setVisible(IDFM_OVERLAY_SOURCE_ID, true);
    _overlayHost.setEntries(IDFM_OVERLAY_SOURCE_ID, [entry], IDFM_OVERLAY_SOURCE_OPTIONS);
  } else {
    clearSelection();
  }
  governorRequestRender('idfm-network-card');
}

function selectStop(id) {
  if (!resolveSelection(id)) return false;
  if (_selectedId && _selectedId !== id) clearSelection();
  _selectedId = id;
  if (id.startsWith('idfm:stop:')) {
    _selectedBase = emphasiseAddressMarker(_dataSource?.entities?.getById(id));
  } else {
    const record = _freqRecords.get(id);
    if (record?.point) {
      record.point.color = Cesium.Color.fromCssColorString(SELECTED_COLOR).withAlpha(0.85);
      record.point.outlineColor = Cesium.Color.fromCssColorString(SELECTED_COLOR);
      record.point.pixelSize = SELECTED_SIZE_PX;
    }
  }
  repaintSelectedCard();
  return true;
}

function onKeyDown(event) {
  if (event.key === 'Escape' && _selectedId) clearSelection();
}

/** Whether a picked id belongs to this layer, in either of its two id spaces. */
function ownsPickId(pickedId) {
  if (typeof pickedId !== 'string') return false;
  return _freqRecords.has(pickedId) || (pickedId.startsWith('idfm:stop:') && Boolean(resolveSelection(pickedId)));
}

function installClickHandler(viewer) {
  if (_clickHandler || !viewer?.scene?.canvas) return;
  _clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  _clickHandler.setInputAction((click) => {
    const picked = viewer.scene.pick(click.position);
    const pickedId = typeof picked?.id === 'string' ? picked.id : picked?.id?.id;
    if (ownsPickId(pickedId)) {
      selectStop(pickedId);
      return;
    }
    if (_selectedId && !picked) clearSelection();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  document.addEventListener('keydown', onKeyDown);
}

function removeClickHandler() {
  if (_clickHandler) {
    _clickHandler.destroy();
    _clickHandler = null;
  }
  document.removeEventListener('keydown', onKeyDown);
}

// --- Terrain seating --------------------------------------------------------

/**
 * Put every stop on the terrain underneath it.
 *
 * The same mechanism the address-scan factory runs, for the same reason: a
 * stop drawn on the ellipsoid stands eighty metres under the pavement it
 * serves, and a vertical error under an oblique camera is a horizontal error
 * on screen that moves with the camera. See `addressScanLayer.js` for the
 * measurement. This layer keeps its own copy of the wiring rather than the
 * logic — its scan is a bounding box, not a radius, so it does not sit on the
 * factory — and the box centre stands in for terrain that has not streamed
 * in yet.
 *
 * @returns {number} How many stops moved.
 */
function seatMarkers(centre = _lastCentre) {
  const globe = _viewer?.scene?.globe;
  if (!globe || !_dataSource || _dormant) return 0;
  const fallback = centre
    ? renderedGroundM(globe, Cesium.Math.toRadians(centre.lon), Cesium.Math.toRadians(centre.lat))
    : null;
  const { moved, pending } = seatEntitiesOnGround(_dataSource.entities.values, globe, fallback);
  _seatPending = pending > 0;
  if (moved > 0) {
    // The open card carries a copy of its marker's position, so it has to
    // follow the marker up rather than stay where the marker used to be.
    if (_selectedId) repaintSelectedCard();
    governorRequestRender('idfm-network-seat');
  }
  return moved;
}

/** Re-seat once terrain settles, coalescing the burst of tile-load events. */
function scheduleSeat() {
  clearTimeout(_seatTimer);
  _seatTimer = setTimeout(() => { seatMarkers(); }, SEAT_SETTLE_MS);
}

// --- Frequency discs --------------------------------------------------------

function stopPosition(lat, lon) {
  return Cesium.Cartesian3.fromDegrees(lon, lat, POINT_LIFT_M);
}

/**
 * Rebuild the drawn discs from a viewport payload.
 *
 * Records are keyed with an `idfm-freq:` prefix on purpose: the referential
 * half of this same layer uses `idfm:stop:<arrid>` for its billboards, and the
 * two marks land on the SAME coordinate. One prefix per primitive kind is what
 * lets `resolveSelection` answer for either without guessing.
 */
function reconcileDiscs(payload) {
  _points?.removeAll();
  _freqRecords = new Map();
  _freqByStopId = new Map();
  for (const stop of payload?.stops || []) {
    if (typeof stop?.lat !== 'number' || typeof stop?.lon !== 'number') continue;
    if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lon)) continue;
    if (_freqRecords.size >= MAX_RENDERED_DISCS) break;
    const id = `idfm-freq:${stop.id}`;
    if (_freqRecords.has(id)) continue;
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
    const record = { id, stop, point, position, style };
    _freqRecords.set(id, record);
    _freqByStopId.set(String(stop.id), record);
  }
  governorRequestRender('idfm-network-frequency');
}

/**
 * Re-style every drawn disc for a new (day, band) without touching the network.
 *
 * This is the whole point of shipping a 7 × 24 profile per stop rather than one
 * number: scrubbing the clock is a repaint, not a request.
 */
function restyleDiscs() {
  for (const record of _freqRecords.values()) {
    record.style = frequencyStyle(profileRate(record.stop.profile, _slot.day, _slot.band));
    if (record.id !== _selectedId) restoreDiscStyle(record);
  }
  if (_selectedId) repaintSelectedCard();
  governorRequestRender('idfm-network-restyle');
}

function clearDiscs() {
  _points?.removeAll();
  if (_selectedId && _selectedId.startsWith('idfm-freq:')) clearSelection();
  _freqRecords = new Map();
  _freqByStopId = new Map();
  _freqPack = null;
  _freqPackBoxKey = null;
}

async function fetchJson(url, { timeoutMs = FREQ_TIMEOUT_MS, validate } = {}) {
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

async function loadFrequency(box, { force = false } = {}) {
  const key = boxKey(box, 4);
  if (!force && _freqPack && _freqPackBoxKey === key) {
    restyleDiscs();
    return;
  }
  _freqError = null;
  _freqLoading = true;
  const generation = ++_freqGeneration;
  const params = new URLSearchParams({
    south: box.south.toFixed(5),
    west: box.west.toFixed(5),
    north: box.north.toFixed(5),
    east: box.east.toFixed(5),
  });
  try {
    const payload = await fetchJson(`${FREQ_URL}?${params}`, {
      validate: (body) => Array.isArray(body?.stops),
    });
    if (generation !== _freqGeneration || !_enabled || _freqRegime !== 'arrets') return;
    _freqPack = payload;
    _freqPackBoxKey = key;
    reconcileDiscs(payload);
    if (_selectedId) repaintSelectedCard();
    // A box the proxy refused after ONE cheap identity call: it holds more
    // stops than the layer will chart, so it answers with the count and no
    // profiles rather than buying four heavy pages to throw most of them away.
    // `zoom-in` is a GUIDANCE status — a sentence, never a fault.
    if (payload.tooDense) _freqStatus = 'zoom-in';
    else _freqStatus = _freqRecords.size > 0 ? 'ok' : 'empty';
  } catch (error) {
    if (generation !== _freqGeneration || !_enabled) return;
    if (error?.name !== 'AbortError') {
      console.warn('[Data:IDFM] hourly offer unavailable:', error?.message || error);
    }
    // Keep what is drawn: an older box is still a true map of the service in
    // it, and blanking the discs would say the region has no transport.
    _freqError = _freqRecords.size
      ? 'rafraîchissement de l’offre IDFM indisponible'
      : 'offre horaire IDFM indisponible';
    _freqStatus = _freqRecords.size ? 'ok' : 'error';
  } finally {
    if (generation === _freqGeneration) _freqLoading = false;
  }
}

/**
 * Decide the frequency regime for the current camera and act on it.
 *
 * Called from the same `moveEnd` the referential scan runs on, so the two
 * halves of the row always describe the same arrival box. `camera.changed`
 * would fire earlier and, measured, up to 0.8 s BEFORE the camera has settled.
 */
async function reconcileFrequency({ force = false } = {}) {
  if (!_enabled) return;
  // The clock is re-read here and nowhere else on the tick path. A band the
  // wall clock crossed is repainted by whichever branch below runs: a cache hit
  // restyles inside `loadFrequency`, and a fresh pack is built by
  // `reconcileDiscs` at the slot resolved on this line. Above the gate nothing
  // quotes a band — not the map, not the card — so nothing is left stale.
  _slot = resolveSlot(_pinnedBand, _now(), _pinnedDay);

  const next = _dormant ? 'wide' : idfmFreqRegimeFor(idfmFreqViewSpanDeg(_viewer), _freqRegime);
  const regimeChanged = next !== _freqRegime;
  _freqRegime = next;

  if (_freqRegime !== 'arrets') {
    if (regimeChanged) {
      clearDiscs();
      _freqStatus = 'idle';
      if (_selectedId) repaintSelectedCard();
    }
    return;
  }
  const box = idfmFreqViewBox(_viewer);
  if (!box) return;
  await loadFrequency(box, { force: force || regimeChanged });
}

// --- Referential scan -------------------------------------------------------

/**
 * Query the viewport and redraw.
 *
 * Shared by the manager's tick and by the camera's `moveEnd`, with a
 * single-flight guard. Without the listener the layer only notices that you
 * have flown somewhere else when the timer next fires — which reads as a
 * layer that "has trouble refreshing" as you navigate.
 *
 * @param {object} viewer @param {AbortSignal|null} [signal]
 * @returns {Promise<boolean>}
 */
async function runScan(viewer, signal = null) {
  if (_scanning) { _rescanQueued = true; return true; }
  _scanning = true;
  try {
    if (!_enabled || !_dataSource) return false;
    const box = viewportBox(viewer);
    if (!box) {
      _lastError = 'No viewport bounds';
      return false;
    }
    if (box.altitudeM > ACTIVATION_ALTITUDE_M) {
      if (!_dormant) {
        clearSelection();
        _dataSource.entities.removeAll();
        _refStops = new Map();
        _count = 0;
        _total = null;
        _byMode = {};
        _dormant = true;
        _lastCentre = null;
        _seatPending = false;
        clearDiscs();
        _freqRegime = 'wide';
        _freqStatus = 'idle';
      }
      _lastError = null;
      return true;
    }
    _dormant = false;
    if (_lastCentre && greatCircleKm(_lastCentre.lat, _lastCentre.lon, box.lat, box.lon) < MIN_SHIFT_KM) {
      await reconcileFrequency();
      return true;
    }

    const query = new URLSearchParams({
      bbox: [box.west, box.south, box.east, box.north].map((v) => v.toFixed(5)).join(','),
      limit: String(STOP_LIMIT),
    });
    try {
      const response = await _http(`${STOPS_URL}?${query}`, signal ? { signal } : undefined);
      if (!response.ok) {
        _lastError = `IDFM HTTP ${response.status}`;
        return false;
      }
      const payload = await response.json();
      if (!payload || payload.error || !Array.isArray(payload.stops)) {
        _lastError = payload?.error || 'Malformed IDFM response';
        return false;
      }
      clearSelection();
      _dataSource.entities.removeAll();
      _refStops = new Map();
      let drawn = 0;
      for (const stop of payload.stops) {
        if (!Number.isFinite(stop.lon) || !Number.isFinite(stop.lat)) continue;
        _dataSource.entities.add({
          id: `idfm:stop:${stop.id}`,
          position: Cesium.Cartesian3.fromDegrees(stop.lon, stop.lat),
          billboard: {
            // The mode's own pictogram, not a disc: five French registers scan
            // the same address and a coloured dot said nothing about which one
            // a marker came from. See `addressMarkerIcons.js`.
            image: stopGlyph(stop.mode),
            width: MODE_SIZE[stop.mode] ?? DEFAULT_MODE_SIZE,
            height: MODE_SIZE[stop.mode] ?? DEFAULT_MODE_SIZE,
            // The glyph is white line-art; this tint is the mode family.
            color: stopColor(stop.mode),
            // POSITIVE_INFINITY: see `addressScanLayer.js`. A finite value
            // leaves the terrain clipping the bottom of every stop marker
            // as soon as the camera is further off than that distance.
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          properties: {
            kind: 'idfm-stop',
            mode: stop.mode,
            accessible: stop.accessible,
            fareZone: stop.fareZone,
            communeCode: stop.communeCode,
          },
          name: stop.name || 'Arrêt',
        });
        _refStops.set(String(stop.id), stop);
        drawn += 1;
      }
      _count = drawn;
      seatMarkers({ lat: box.lat, lon: box.lon });
      _total = payload.total ?? null;
      _truncated = payload.truncated === true;
      _byMode = payload.byMode || {};
      _lastCentre = { lat: box.lat, lon: box.lon };
      _lastUpdate = Date.now();
      _lastError = null;
      await reconcileFrequency();
      return true;
    } catch (error) {
      if (error?.name === 'AbortError') return false;
      _lastError = error?.message || String(error);
      return false;
    }
  } finally {
    _scanning = false;
    if (_rescanQueued) {
      _rescanQueued = false;
      setTimeout(() => { void runScan(_viewer); }, 0);
    }
  }
}

/** Re-query once the camera settles, not on every frame of a fly-through. */
function scheduleScan() {
  clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(() => { void runScan(_viewer); }, ADDRESS_SCAN_MOVE_DEBOUNCE_MS);
}

/**
 * The camera stopped: re-seat, and separately consider re-querying.
 *
 * Under the movement threshold `runScan` returns without a request — right,
 * the same box is still on screen — but the terrain LOD beneath those stops
 * may have refined on the way in. Re-seating is a local read; it must not be
 * gated behind a decision about the network.
 */
function onCameraSettled() {
  scheduleSeat();
  scheduleScan();
}

// --- Detection --------------------------------------------------------------

function collectDetectableObjects(options = {}) {
  if (!_enabled || _freqRegime !== 'arrets') return [];
  const records = [];
  for (const record of _freqRecords.values()) {
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

// --- The shared week-hour cursor ---------------------------------------------

/**
 * Move to a band, optionally on a named day, and repaint what quotes it.
 *
 * The one path a chip and the shared cursor both go through, so the layer
 * cannot end up drawing a slot its own `getParams` would not report.
 *
 * @param {?number} band 4-27, or null to follow the Paris clock.
 * @param {?string} day One of `IDFM_FREQ_DAYS`, or null for today's.
 * @returns {boolean} Whether the layer moved.
 */
function applyBand(band, day) {
  const nextDay = IDFM_FREQ_DAYS.includes(day) ? day : null;
  if (band === _pinnedBand && nextDay === _pinnedDay) return false;
  _pinnedBand = band;
  _pinnedDay = nextDay;
  _slot = resolveSlot(_pinnedBand, _now(), _pinnedDay);
  restyleDiscs();
  return true;
}

/** Follow the shared cursor, and take whatever it already holds. */
function followWeekHour() {
  _weekHourUnsubscribe?.();
  _weekHourUnsubscribe = subscribeWeekHour(IDFM_LAYER_ID, adoptWeekHour);
  adoptWeekHour(getWeekHour());
}

/** Stop following. The cursor is left alone — see `comptagesParis.js`. */
function unfollowWeekHour() {
  _weekHourUnsubscribe?.();
  _weekHourUnsubscribe = null;
}

/**
 * Take the shared cursor, on the OPERATING day rather than the calendar one.
 *
 * 01 h on a Wednesday is Tuesday's band 25 in this network's own filing, which
 * is why the `01 h` chip carries band 25 — so the translation is not a
 * formality, it is the difference between drawing the night service and
 * drawing nothing.
 *
 * @param {?{day:number, hour:number}} cursor
 */
function adoptWeekHour(cursor) {
  const slot = weekHourToOperatingSlot(cursor);
  if (!slot) return;
  applyBand(clampBand(slot.band), slot.day);
}

// --- Layer ------------------------------------------------------------------

const idfmNetworkLayer = {
  id: IDFM_LAYER_ID,
  name: 'Réseau IDFM (Paris)',
  icon: 'Ⓜ',
  source: 'Île-de-France Mobilités — référentiel (ODbL 1.0) et offre horaire (Licence Ouverte v2.0)',
  updateInterval: UPDATE_INTERVAL_MS,

  init(viewer) {
    _viewer = viewer;
    _dataSource = new Cesium.CustomDataSource('idfm-network');
    _dataSource.show = false;
    viewer?.dataSources?.add?.(_dataSource);
    _points = new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT });
    _points.show = false;
    viewer?.scene?.primitives?.add?.(_points);
    registerSpriteCollection(IDFM_LAYER_ID, _points);
    _overlayHost.setVisible(IDFM_OVERLAY_SOURCE_ID, false);
    _enabled = false;
    _lastCentre = null;
    _lastUpdate = null;
    _lastError = null;
    _count = 0;
    _total = null;
    _truncated = false;
    _byMode = {};
    _dormant = false;
    _seatPending = false;
    _refStops = new Map();
    _freqRecords = new Map();
    _freqByStopId = new Map();
    _freqPack = null;
    _freqPackBoxKey = null;
    _freqRegime = 'wide';
    _freqStatus = 'idle';
    _freqError = null;
    _slot = resolveSlot(_pinnedBand, _now(), _pinnedDay);
    restoreSpriteOrder(viewer);
  },

  enable(viewer) {
    _enabled = true;
    _lastError = null;
    _freqError = null;
    if (viewer) _viewer = viewer;
    if (_dataSource) _dataSource.show = true;
    if (_points) _points.show = true;
    _overlayHost.setVisible(IDFM_OVERLAY_SOURCE_ID, true);
    installClickHandler(_viewer);
    registerPickOwner(IDFM_LAYER_ID, ownsPickId);
    if (!_moveEndRemover && _viewer?.camera?.moveEnd) {
      _moveEndRemover = _viewer.camera.moveEnd.addEventListener(onCameraSettled);
    }
    // Terrain arrives after the stops do. `queued === 0` is the globe saying
    // it has streamed what this view needs, which is the first moment
    // `getHeight` can answer for every one of them.
    const globe = _viewer?.scene?.globe;
    if (!_tileProgressRemover && globe?.tileLoadProgressEvent) {
      _tileProgressRemover = globe.tileLoadProgressEvent.addEventListener((queued) => {
        if (queued === 0 || _seatPending) scheduleSeat();
      });
    }
    restoreSpriteOrder(_viewer);
    // Adopted before the first fetch, so the viewport is asked for the slot the
    // reader is on rather than for today's clock and then again for the pinned
    // hour. DataLayerManager calls update() immediately after enable() and that
    // call owns the first fetch.
    followWeekHour();
    _lastCentre = null;
  },

  disable() {
    _enabled = false;
    _freqGeneration += 1;
    if (_dataSource) _dataSource.show = false;
    clearSelection();
    clearDiscs();
    if (_points) _points.show = false;
    _overlayHost.setVisible(IDFM_OVERLAY_SOURCE_ID, false);
    removeClickHandler();
    unregisterPickOwner(IDFM_LAYER_ID);
    unfollowWeekHour();
    clearTimeout(_debounceTimer);
    clearTimeout(_seatTimer);
    if (_moveEndRemover) { _moveEndRemover(); _moveEndRemover = null; }
    if (_tileProgressRemover) { _tileProgressRemover(); _tileProgressRemover = null; }
    _freqLoading = false;
    _freqStatus = 'idle';
  },

  destroy(viewer) {
    clearTimeout(_debounceTimer);
    clearTimeout(_seatTimer);
    if (_moveEndRemover) { _moveEndRemover(); _moveEndRemover = null; }
    if (_tileProgressRemover) { _tileProgressRemover(); _tileProgressRemover = null; }
    removeClickHandler();
    unregisterPickOwner(IDFM_LAYER_ID);
    unfollowWeekHour();
    _overlayHost.clearSource(IDFM_OVERLAY_SOURCE_ID);
    _overlayHost.setVisible(IDFM_OVERLAY_SOURCE_ID, false);
    if (_dataSource) {
      _dataSource.entities.removeAll();
      viewer?.dataSources?.remove?.(_dataSource, true);
    }
    if (_points) {
      unregisterSpriteCollection(IDFM_LAYER_ID, _points);
      viewer?.scene?.primitives?.remove?.(_points);
      _points = null;
    }
    _refStops = new Map();
    _freqRecords = new Map();
    _freqByStopId = new Map();
    _freqPack = null;
    _freqPackBoxKey = null;
    _selectedId = null;
    _selectedBase = null;
    _dataSource = null;
    _viewer = null;
  },

  async update(viewer, { signal } = {}) {
    if (viewer) _viewer = viewer;
    return runScan(viewer || _viewer, signal);
  },

  getDetectableObjects(options = {}) {
    return collectDetectableObjects(options);
  },

  getStats() {
    const stats = {
      count: _count,
      lastUpdate: _lastUpdate,
      error: _lastError || _freqError || null,
      dormant: _dormant,
      // Named `scanCentre` to match the four point-scan siblings: it is the
      // centre of the box last queried, and it is how a reader (or a harness)
      // tells "this answer is about where I am" from "this answer is stale".
      scanCentre: _lastCentre ? { lat: _lastCentre.lat, lon: _lastCentre.lon } : null,
      selectedId: _selectedId,
      clickableCount: _refStops.size + _freqRecords.size,
      // True while at least one stop still stands on the box centre's height
      // rather than on a terrain reading of its own.
      seatPending: _seatPending,
      stopsInBox: _total,
      truncated: _truncated,
      byMode: _byMode,
      modeLabels: IDFM_MODES,
      // Stated in the layer's own stats so a reader is never left to conclude
      // the vehicles are missing because the layer is broken.
      liveVehicles: null,
      liveVehicleNote: 'IDFM ne publie aucune position de véhicule en temps réel',
      // The frequency half, reported next to the network half rather than
      // behind a second row.
      regime: _freqRegime,
      day: _slot.day,
      band: _slot.band,
      pinned: _pinnedBand !== null,
      charted: _freqRecords.size,
      edition: _freqPack?.edition ?? null,
      stopsWithoutCoordinate: _freqPack?.unplaced ?? null,
    };
    if (_freqPack?.stale) stats.stale = true;
    const label = buildLoadingLabel();
    if (label) stats.loadingLabel = label;
    return stats;
  },

  /** Provenance for the attribution popover and the analyst surfaces. */
  getViewportSummary() {
    if (!_freqPack) return null;
    const { stops, ...summary } = _freqPack;
    void stops;
    return {
      ...summary,
      regime: _freqRegime,
      day: _slot.day,
      band: _slot.band,
      drawn: _freqRecords.size,
      networkStops: _count,
    };
  },

  /**
   * Seven moment chips and the frequency ladder for what is on screen.
   *
   * The chips are NOT serialized into the share link — the layer is registered
   * `enabled-only` — so a shared view always opens on the reader's own Paris
   * clock rather than on somebody else's pinned hour. That is the right default
   * anyway: a link that silently pinned 03:00 would show a stranger an empty
   * city and no way to know why.
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
        // A band chip moves the other typical-week rows too, and a control
        // whose reach goes past its own row has to say so.
        : `${IDFM_FREQ_DAY_LABELS[_slot.day]} ${bandLabel(moment.band)}`
          + ' · déplace aussi les autres couches de semaine type',
      params: { band: moment.band === null ? 'now' : moment.band },
    }));

    const counts = new Array(IDFM_FREQ_RAMP.length).fill(0);
    let silent = 0;
    for (const record of _freqRecords.values()) {
      const level = frequencyLevel(profileRate(record.stop.profile, _slot.day, _slot.band));
      if (level < 0) silent += 1;
      else counts[Math.min(level, counts.length - 1)] += 1;
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
    // The stops nobody can draw travel with the legend: they publish no
    // coordinate at all, and they carry 2.76 % of an average Tuesday's courses.
    if (_freqPack?.unplaced) {
      legend.push({
        label: 'sans coordonnée publiée',
        color: IDFM_FREQ_SILENT_COLOR,
        count: _freqPack.unplaced,
        blurb: 'Arrêts sans latitude ni longitude dans le fichier — 473 Train, 69 Bus, 7 Tramway '
          + 'sur toute la région. 518 se rattachent à une zone d’arrêt du référentiel, mais 512 de '
          + 'ces zones ont deux quais ou plus : il n’existe pas de point publié à emprunter, donc '
          + 'ils sont comptés et jamais placés.',
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
    // A chip names a BAND and never a day, so pressing one always returns the
    // day to today's — otherwise a cursor set from another row would leave
    // this layer on a Thursday that no control on this row can be seen to have
    // chosen.
    applyBand(next, null);
    // `Maintenant` releases the cursor: it means "follow the clock", which is
    // a behaviour, not a position. A band travels as the hour it draws.
    setWeekHour(
      IDFM_LAYER_ID,
      next === null ? null : weekHourFromOperatingSlot(_slot.day, _slot.band),
    );
  },

  getParams() {
    return { band: _pinnedBand === null ? 'now' : _pinnedBand, day: _slot.day };
  },
};

// --- Test seams -------------------------------------------------------------

/**
 * Seed the layer so cards, legends, selection, DETECT and stats run against the
 * production code paths with no WebGL and no network.
 *
 * Passing `pack` builds the disc records exactly as `reconcileDiscs` would,
 * minus the primitives unless a stand-in collection is supplied — which is the
 * point: a test that hand-rolled the record map would prove nothing about the
 * function that actually builds it. `refStops` is the projected `arrets` rows
 * the referential half holds, keyed on `arrid` here as it is there.
 */
export function _setIdfmNetworkStateForTest({
  viewer, overlayHost, http, now, points = null, pack = null, refStops = null,
  pinnedBand = null, regime = pack ? 'arrets' : 'wide', enabled = true, status = 'ok',
  dormant = false, count = null,
} = {}) {
  _viewer = viewer || null;
  _overlayHost = overlayHost || DEFAULT_OVERLAY_HOST;
  _http = http || DEFAULT_HTTP;
  _now = typeof now === 'function' ? now : (typeof now === 'number' ? () => now : DEFAULT_NOW);
  _points = points || null;
  _dataSource = null;
  _enabled = enabled;
  _dormant = dormant;
  _freqRegime = regime;
  _pinnedBand = pinnedBand;
  _pinnedDay = null;
  _slot = resolveSlot(_pinnedBand, _now(), _pinnedDay);
  _freqPack = pack;
  _freqPackBoxKey = pack ? 'test' : null;
  _refStops = new Map((refStops || []).map((stop) => [String(stop.id), stop]));
  _freqRecords = new Map();
  _freqByStopId = new Map();
  _selectedId = null;
  _selectedBase = null;
  _lastError = null;
  _freqError = null;
  _freqStatus = status;
  _freqLoading = false;
  _lastUpdate = null;
  if (pack) reconcileDiscs(pack);
  _count = count === null ? _refStops.size : count;
}

/** Exercise the production selection path. */
export function _selectIdfmNetworkForTest(id) {
  return selectStop(id);
}

/** Exercise the production clear path and restore the production seams. */
export function _clearIdfmNetworkSelectionForTest() {
  clearSelection();
  _overlayHost = DEFAULT_OVERLAY_HOST;
  _http = DEFAULT_HTTP;
  _now = DEFAULT_NOW;
  _refStops = new Map();
  _freqRecords = new Map();
  _freqByStopId = new Map();
  _freqPack = null;
  _freqPackBoxKey = null;
  _pinnedBand = null;
  _pinnedDay = null;
  _freqRegime = 'wide';
  _count = 0;
  _enabled = false;
  _dormant = false;
  _freqStatus = 'idle';
  _points = null;
}

/** Whatever is selected right now. */
export function _idfmNetworkSelectedIdForTest() {
  return _selectedId;
}

/** One drawn disc record, for assertions about style. */
export function _idfmNetworkRecordForTest(id) {
  return _freqRecords.get(id) || null;
}

/** The slot the layer would draw. */
export function _idfmNetworkSlotForTest() {
  return { ..._slot, pinned: _pinnedBand };
}

/** Row controls, for tests that do not construct a viewer. */
export function _idfmNetworkRowControlsForTest() {
  return idfmNetworkLayer.getRowControls();
}

/** Stats, for tests that do not construct a viewer. */
export function _idfmNetworkStatsForTest() {
  return idfmNetworkLayer.getStats();
}

/** DETECT candidates, for tests that do not construct a viewer. */
export function _idfmNetworkDetectablesForTest(options = {}) {
  return collectDetectableObjects(options);
}

/** Drive the production `setParams` path. */
export function _idfmNetworkSetParamsForTest(params) {
  idfmNetworkLayer.setParams(params);
}

/** Test seam: run the half of enable/disable that follows the shared cursor. */
export function _idfmNetworkFollowWeekHourForTest(follow = true) {
  if (follow) followWeekHour();
  else unfollowWeekHour();
}

export default idfmNetworkLayer;
