import * as Cesium from 'cesium';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { governorRequestRender } from '../renderGovernor.js';
import {
  ADDRESS_SCAN_MOVE_DEBOUNCE_MS,
  SEAT_RETRY_BACKOFF,
  SEAT_RETRY_PASSES,
  SEAT_SETTLE_MS,
  emphasiseAddressMarker,
  renderedGroundM,
  restoreAddressMarker,
  seatEntitiesOnGround,
} from './addressScanLayer.js';
import { idfmStopGlyphKind } from './addressMarkerIcons.js';
import { IDFM_MODES } from './idfmFeed.js';
import { registerPickOwner, resolvePickId, unregisterPickOwner } from './pickRegistry.js';
import { SURFACE_SAMPLE_BUDGET, seatPointsOnSurface } from './renderedSurface.js';
import { registerSpriteCollection, restoreSpriteOrder, unregisterSpriteCollection } from './spriteOrder.js';
import { transitStopBadge } from './transitVehicleIcons.js';
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
 * to know to press both. The differences survive as facts rather than as
 * chips: the card says when a stop publishes no profile, `dataCredits.js`
 * names both licences for as long as the row is on, and the frequency half
 * simply stops DRAWING above its own gate rather than dragging the referential
 * up with it — a click is still answered at any altitude, see
 * {@link probeStop}.
 *
 * What did NOT survive is the département choropleth the frequency row painted
 * above that gate. Eight polygons carrying a per-stop mean, at an alpha that
 * had to stay low enough for satellite imagery underneath — it read as a faint
 * wash over half of France and answered a question nobody had asked at that
 * altitude. The stop-level product is the product.
 *
 * ── ONE MARK PER STOP, which took two goes to get right ────────────────────
 * A stop could carry two marks on one coordinate — the mode's pictogram, and a
 * rate disc under it — and the first version of this merge kept both, sized so
 * that the disc "sits INSIDE the mode glyph rather than fighting it". The
 * reader who saw it said the plain thing: they are one subject drawn twice, and
 * the two numbers are joined anyway. They were right, and the argument for the
 * stack was an argument about pixels rather than about what is being said.
 *
 * So one point carries one mark, and the fix ran in both directions:
 *
 *  • THE PICTOGRAM BECAME A BADGE and grew, 14–24 px to 21–27 px. Naked white
 *    line-art tinted `#c9d4e0` over photorealistic Paris is grey on grey and
 *    the most numerous mode wore it. See {@link stopBadge}.
 *  • THE BADGE CARRIES THE RATE IN ITS FILL, so nothing was lost by dropping
 *    the disc: mode is the shape, rate is the colour, and the legend swaps to
 *    match whichever the view has actually read. See {@link stopBadgeFill}.
 *  • THE DISC YIELDS wherever a badge stands, and only there — never
 *    everywhere. The two publications are read with different page sizes,
 *    {@link STOP_LIMIT} against {@link IDFM_FREQ_MAX_STOPS}, so in a dense
 *    viewport most discs have no badge over them and stay drawn. See
 *    {@link restoreDiscStyle}.
 *
 * The discs' own size ladder still answers to density, and that is why the
 * badges do not have to. Measured over the 805 stops in the 4 km Châtelet box,
 * 2026-09-02: median nearest-neighbour distance **24.2 m**, p10 8.9 m, **463
 * stops with a neighbour inside 30 m** — which is what caps a disc at 13 px.
 * At most {@link STOP_LIMIT} badges are ever on screen, at any altitude,
 * because a hundred is all one referential query asks for.
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
 *
 * THE GATE BOUNDS THE DRAWING AND NOT THE ANSWER. Above it the badges name
 * their mode and no rate is drawn — but a click names one coordinate, and the
 * cheapest legal box around one coordinate is one grid cell, so the click buys
 * it. A card that answered "not at this altitude" was quoting the map's
 * ceiling at somebody who had already stopped asking about the map. See
 * {@link probeStop}.
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
 * and it is DRAWN. The grey is not unused, though: a referential stop with NO
 * row in the offer file is exactly what it is for, and in a charted view its
 * badge wears it — see {@link IDFM_NOT_MEASURED_COLOR}.
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
 *
 * `bus` moved off `#c9d4e0` on 2026-09-10. It is the mode this referential is
 * mostly made of, and as the tint of naked line-art over a photorealistic
 * Paris it was reported in three words: "gris sur gris". {@link stopBadge} is
 * the real fix — a filled mark brings its own ground — but the value it fills
 * with should not be a near-white either.
 *
 * These are only ever DRAWN in a view that read no rate. Where a rate exists
 * the badge wears {@link IDFM_FREQ_RAMP} instead, so the two palettes never
 * share a screen and are not required to be distinguishable from each other —
 * only from each other's neighbours within one palette. See
 * {@link stopBadgeFill}.
 */
export const IDFM_MODE_COLORS = Object.freeze({
  metro: '#ffb03d',
  rail: '#3d8bff',
  tram: '#3dd6c4',
  bus: '#9fb4cf',
  funicular: '#ff7ad9',
  cableway: '#ff7ad9',
});
const COLOR_UNKNOWN_MODE = '#7c8aa0';

/**
 * Badge diameter by mode, in CSS px.
 *
 * A metro entrance matters more to a reader than one of the eighteen bus poles
 * around it, so the ladder is kept — but every rung moved up by half again,
 * from 14–24 px to 21–27 px, and the mark under it changed from line-art to a
 * filled badge. See {@link stopBadge} for what that fixed.
 *
 * DENSITY IS NOT THE CONSTRAINT IT IS FOR THE DISCS, and that is the whole
 * reason these can afford to be this big. `IDFM_FREQ_SIZES` is capped at 13 px
 * because up to {@link IDFM_FREQ_MAX_STOPS} discs share a viewport whose
 * median nearest-neighbour distance is 24.2 m. Badges are capped by
 * {@link STOP_LIMIT}: at most a hundred are ever on screen, at any altitude,
 * because a hundred is all one referential query asks for.
 */
export const IDFM_BADGE_SIZE = Object.freeze({ metro: 27, rail: 27, tram: 24, bus: 21 });
/** A mode this layer has no size rule for. */
const DEFAULT_BADGE_SIZE = 22;

/**
 * "The register did not measure this", the repo-wide grey.
 *
 * `fraicheurParis.js` reserved `#8a93a6` for exactly this and nothing else,
 * and a badge in the frequency regime that has no row in the offer file is
 * exactly this: 3 053 of the 37 956 referential stops, 8.0 %. It is NOT
 * `IDFM_FREQ_SILENT_COLOR`, which means the opposite — a stop that publishes a
 * profile and runs nothing in this band, which is a measurement.
 */
export const IDFM_NOT_MEASURED_COLOR = '#8a93a6';

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
 * The regional roll-up, read for ONE number: how many stops the file publishes
 * with no coordinate at all.
 *
 * That count is a fact about the FILE and not about the box on screen. The
 * viewport product carries an `unplaced` of its own and it counts something
 * else — rows dropped inside that box, which is 0 almost everywhere — so
 * reading it and printing the regional sentence beside it stated a number the
 * legend then contradicted. Measured 2026-09-10: every viewport tried answered
 * 0, so the note never appeared at all.
 *
 * Fetched once per session on enable, fire-and-forget, and cheap: the whole
 * regional product is ~5.9 kB gzipped and the proxy caches it on disk.
 */
const FREQ_REGION_URL = '/api/idfm-frequency/region';

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
 * Half-side of the box ONE click asks the offer for, in degrees.
 *
 * ~65 m, which the proxy then snaps OUTWARD onto its shared 0.005° grid — so
 * the smallest question this layer can ask is one or two grid cells, roughly
 * 550 m on a side. That is deliberate on both counts: a box smaller than the
 * grid would be rounded up anyway, and a box on the grid is the same cache
 * entry the next click a street away will hit.
 */
const PROBE_HALF_DEG = 0.0006;

/**
 * Profiles kept from clicks. A click is cheap; a session of them must be bounded.
 *
 * One probe answers for its whole grid cell, so this holds far more than 200
 * clicks' worth of ground.
 */
const PROBE_CACHE = 200;

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

/**
 * NO BLURB UNDER A RATE RUNG, and that is the whole edit of 2026-09-10.
 *
 * Six sentences used to hang under the six colours, and five of them said the
 * label again in words: `4 à 8/h — 7 à 15 min` carried « Quatre à huit par
 * heure : 7 à 15 minutes. » A reader called the result « du charabia » and was
 * right — the key was mostly its own echo, 692 px of it. The rungs now name
 * the WAIT ({@link IDFM_FREQ_LEVEL_LABELS}), which is the whole sentence those
 * blurbs were trying to reach, so there is nothing left for them to add.
 *
 * {@link MODE_BLURBS} below stays, and the difference is the point: a mode
 * blurb says what the thing IS and why its badge is that size, which is not on
 * its label. A rung blurb only restated the rung.
 */

/**
 * Legend copy for the MODE regime — one sentence per mode, on what it is and
 * why its badge is the size it is.
 */
const MODE_BLURBS = Object.freeze({
  metro: 'Bouche ou station de métro. Le plus grand badge, avec le RER : une station porte des '
    + 'ordres de grandeur de voyageurs de plus qu’un poteau de bus, et à cette altitude c’est '
    + 'l’ossature du réseau qu’on lit.',
  rail: 'Gare RER ou Transilien, au même diamètre que le métro.',
  tram: 'Station de tramway.',
  bus: 'Poteau de bus. Le mode le plus nombreux du référentiel de très loin, donc le plus petit '
    + 'badge — sans quoi il recouvrirait les trois autres.',
  funicular: 'Funiculaire.',
  cableway: 'Téléphérique. Une seule ligne publiée dans tout le référentiel, le Câble C1 vers Créteil.',
});

/**
 * The legend for a view that has read no rate: what modes are on screen.
 *
 * Ordered by the badge ladder rather than by count, so the legend reads in the
 * same order as the marks read on the map — biggest first.
 *
 * @param {Map<string, object>} stops Referential rows currently drawn.
 * @returns {Array<object>} Legend rows.
 */
export function modeLegend(stops) {
  const counts = new Map();
  for (const stop of stops?.values?.() || []) {
    const mode = stop?.mode || 'unknown';
    counts.set(mode, (counts.get(mode) || 0) + 1);
  }
  const size = (mode) => IDFM_BADGE_SIZE[mode] ?? DEFAULT_BADGE_SIZE;
  return [...counts.entries()]
    .sort((a, b) => (size(b[0]) - size(a[0])) || (b[1] - a[1]))
    .map(([mode, count]) => ({
      label: IDFM_MODES[mode] || 'Mode non publié',
      color: IDFM_MODE_COLORS[mode] || COLOR_UNKNOWN_MODE,
      count,
      blurb: MODE_BLURBS[mode]
        || 'Arrêt dont le référentiel ne publie pas le mode — jamais emprunté à un voisin.',
    }));
}

/**
 * The one rung that still earns a sentence.
 *
 * A reader cannot decode silence from the colour: a dark dot could as easily
 * mean "no data", and the row directly under it — {@link IDFM_NOT_MEASURED_COLOR}
 * — is exactly that. So this says the one thing the swatch cannot, and stops.
 * What went with the old version was a count from a 4 km square over Châtelet
 * that the reader is not standing in: commentary about the dataset, not about
 * the map in front of them.
 */
const SILENT_BLURB = 'L’arrêt existe et publie ses horaires. À cette heure-ci, il ne dessert rien.';

/**
 * The stops nobody can draw — and the reason this is NOT a counted row.
 *
 * It used to sit in the counted list with a colour swatch beside `549`, under
 * rows counting what is on screen. A reader read it exactly as the shape
 * invited: « énormément d'arrêts placés sur la carte dont on n'a pas les
 * coordonnées ». It is the opposite — these are the only stops that CANNOT be
 * placed, they are 1,50 % of the file, and none of them is on any map.
 *
 * So it is published with `color: null`, which `manager.js` renders as the
 * deliberate "not drawn here" line: an empty swatch slot, text still aligned
 * with the coloured rows, and no pastille implying it was mapped. The count
 * moves INTO the sentence, where it reads as a fact about the file rather than
 * as a tally of marks in the frame.
 *
 * Figures measured against the live proxy on 2026-09-10: 36 502 stops
 * published, 35 953 placed, 549 without coordinates — 473 Train, 69 Bus,
 * 7 Tramway — carrying 84 766 of an average Tuesday's 3 071 764 courses.
 */
const UNPLACED_BLURB = 'Sans latitude ni longitude dans le fichier : 473 Train, 69 Bus, '
  + '7 Tramway. 518 se rattachent à une zone d’arrêt, mais 512 de ces zones ont deux quais '
  + 'ou plus — il n’existe aucun point publié à emprunter. Ils portent 2,8 % des passages.';

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
/** Stops the file publishes with no coordinate, region-wide. See {@link FREQ_REGION_URL}. */
let _freqUnplaced = null;
let _freqUnplacedPromise = null;
let _freqRegime = 'wide';
let _freqLoading = false;
let _freqStatus = 'idle';
let _freqError = null;
let _freqGeneration = 0;

/** `id_arret` → `{status, stop}` for profiles bought by a CLICK. */
let _probes = new Map();

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
 * The mark a stop is drawn with: its MODE's pictogram inside a filled badge.
 *
 * A stop is signed in the street with its mode's pictogram — the bus on the
 * pole, the M on the entrance — so this reuses `transitVehicleIcons.js` rather
 * than inventing a second transit vocabulary for the same city.
 *
 * ── The bare pictogram was unreadable, and not by a little ────────────────
 * Until 2026-09-10 this layer drew that glyph naked: white line-art with
 * a ~1.6 px dark halo, 14 px wide for a bus, tinted `#c9d4e0`. Bus is the
 * mode this referential is mostly made of. Over photorealistic Paris that is
 * pale grey line-art on pale grey roofs and pale grey roads, and the reader
 * who reported it used the words "gris sur gris". A filled badge answers it by
 * construction instead of by hunting for a luckier hue: the mark brings its
 * own ground, and `transitVehicleIcons.js` picks the ink from the fill's
 * luminance so the pictogram survives either end of a lightness ramp.
 *
 * ── One mark per stop, which is what the fill is FOR ──────────────────────
 * A stop used to be able to carry two marks on one coordinate — this pictogram
 * and a rate disc under it — and the reader who saw both said the obvious
 * thing: they are one subject drawn twice. So the disc now yields wherever a
 * badge stands (see {@link reconcileDiscs}) and the badge carries the rate in
 * its FILL. That is why the fill is a parameter and not a property of the
 * mode: at a hundred badges on screen the fill is the only channel wide enough
 * to read at a glance, and the mode is already carried by the shape inside it.
 *
 * @param {?string} mode
 * @param {string} fill Badge fill, from {@link stopBadgeFill}.
 * @returns {string} data URI.
 */
export function stopBadge(mode, fill) {
  return transitStopBadge(idfmStopGlyphKind(mode), { fill });
}

/**
 * The fill one badge carries — and therefore what its colour MEANS.
 *
 * Three states, and the reason there are three rather than one is that this
 * layer's two publications do not cover the same ground:
 *
 *  • A STOP WITH A PROFILE takes the frequency ramp, or the silent colour when
 *    the published answer for this band is zero. This is the only state whose
 *    colour is a rate, and it is the state the legend's ramp describes.
 *  • A STOP WITH NO PROFILE, in a view where the offer WAS charted, takes
 *    {@link IDFM_NOT_MEASURED_COLOR}. Measured: 3 053 of 37 956, 8.0 %.
 *  • ANY STOP IN A VIEW THAT CHARTED NOTHING takes its mode's hue. Above the
 *    frequency gate, or in a box the proxy refused as too dense, no rate has
 *    been read for anything on screen — so nothing on screen can be misread as
 *    one, and the colour channel is free to say what a reader can still use.
 *    `getRowControls()` swaps the legend to match, so the legend always
 *    describes the marks that are actually drawn.
 *
 * @param {Object} [state]
 * @param {?string} [state.mode]
 * @param {?object} [state.freq] The stop's row in the offer file, if any.
 * @param {?string} [state.day]
 * @param {?number} [state.band]
 * @param {boolean} [state.charted] Whether this view charted any profile.
 * @returns {string} CSS colour.
 */
export function stopBadgeFill({
  mode = null, freq = null, day = null, band = null, charted = false,
} = {}) {
  if (freq) return frequencyStyle(profileRate(freq.profile, day, band)).css;
  if (charted) return IDFM_NOT_MEASURED_COLOR;
  return IDFM_MODE_COLORS[mode] || COLOR_UNKNOWN_MODE;
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

/**
 * Whether this view has read a rate for ANYTHING, which is what makes the
 * colour channel mean a rate rather than a mode.
 *
 * False above the frequency gate and false in a box the proxy refused as too
 * dense — in both, nothing on screen carries a number, so nothing on screen
 * can be misread as one. See {@link stopBadgeFill}.
 */
function freqCharted() {
  return _freqRegime === 'arrets' && _freqRecords.size > 0;
}

/** {@link stopBadgeFill} against the pack, the slot and the regime held now. */
function badgeFillFor(ref) {
  return stopBadgeFill({
    mode: ref?.mode,
    freq: _freqByStopId.get(String(ref?.id))?.stop || null,
    day: _slot.day,
    band: _slot.band,
    charted: freqCharted(),
  });
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
 * The wait, on a clock face rather than as a decimal.
 *
 * `2,5 min` is what the arithmetic gives and `2 min 30` is what a person says.
 * Rounded to the half-minute and never finer: this is a MEAN wait derived from
 * a count of departures in an hour, not a headway the file publishes, and
 * printing seconds would claim a precision nobody has.
 *
 * It replaces `waitPhrase()`, which said the same number with the caveat glued
 * to it — « 2,5 min d'attente moyenne ». The caveat is still on the card, once,
 * on the line that says this is an average week and not a timetable; repeating
 * it inside the sentence a reader acts on bought nothing and cost the sentence.
 *
 * @param {number} rate Departures per hour.
 * @returns {?string}
 */
export function waitClock(rate) {
  const minutes = meanWaitMin(rate);
  if (minutes === null) return null;
  if (minutes < 1) return 'moins d’une minute';
  if (minutes >= 60) return 'plus d’une heure';
  if (minutes >= 10) return `${Math.round(minutes)} min`;
  const halves = Math.round(minutes * 2) / 2;
  return Number.isInteger(halves) ? `${halves} min` : `${Math.floor(halves)} min 30`;
}

/**
 * What the reader is waiting FOR, by mode.
 *
 * « Un passage toutes les 2 min » is correct and flat; « un métro toutes les
 * 2 min » is the same sentence in the reader's own words. `rail` says "train"
 * rather than "RER & Transilien" — the mode label is right for a header and
 * wrong inside a sentence.
 */
const MODE_VEHICLE = Object.freeze({
  bus: 'bus',
  metro: 'métro',
  rail: 'train',
  tram: 'tram',
  funicular: 'passage',
  cableway: 'passage',
  unknown: 'passage',
});

/** `06:00–06:59` → `06 h 00`. The card names a moment, not a bracket. */
function clockOf(band) {
  const match = /^(\d{2}):(\d{2})/.exec(String(bandLabel(band)));
  return match ? `${match[1]} h ${match[2]}` : bandLabel(band);
}

/** `08:00–08:59` → `08 h`. */
function hourOf(band) {
  const match = /^(\d{2})/.exec(String(bandLabel(band)));
  return match ? `${match[1]} h` : bandLabel(band);
}

/**
 * The day whose service at this hour differs MOST from the day on screen.
 *
 * This replaces a row of seven numbers — `Lun 12 · Mar 12 · Mer 12 · Jeu 12 ·
 * Ven 12 · Sam 10 · Dim 5,9` — which answered a question it never asked. The
 * question is "and on another day?", and the answer worth a line is the day
 * where it CHANGES, not the five where it does not.
 *
 * Generalised rather than hard-coded to the weekend on purpose: the biggest
 * gap in this dataset is not Saturday, it is FRIDAY NIGHT — band 25 runs
 * 15 904 courses region-wide on a Monday and 31 585 on a Friday, +98.6 %. A
 * rule that named « le week-end » would print the smaller finding and hide the
 * larger one.
 *
 * @returns {?{day: string, rate: number}} Null when no day differs enough to
 *   be worth a line of the card.
 */
export function mostDifferentDay(profile, band, shownDay, threshold = 0.2) {
  const here = profileRate(profile, shownDay, band);
  if (!(here > 0)) return null;
  let best = null;
  for (const day of IDFM_FREQ_DAYS) {
    if (day === shownDay) continue;
    const rate = profileRate(profile, day, band);
    const gap = Math.abs(rate - here) / here;
    if (gap < threshold) continue;
    if (!best || gap > best.gap) best = { day, rate, gap };
  }
  return best ? { day: best.day, rate: best.rate } : null;
}

/**
 * WHERE the stop is, on one line — town, fare zone, step-free access.
 *
 * The MODE is no longer on this line: since 2026-09-10 it sits on the title,
 * beside the name, where a reader looks for what kind of thing they clicked.
 *
 * `null` accessibility is "nobody surveyed it", which is not "not accessible" —
 * and for a reader deciding where to live that distinction is the whole point.
 * Said in the words a reader uses about a kerb rather than in the vocabulary of
 * a compliance form: `accessible` was ambiguous about WHAT was accessible.
 *
 * @param {?object} ref Projected `arrets` row.
 * @param {?object} [freq] Frequency row, whose commune stands in when the
 *   referential holds no row for this stop.
 * @returns {?string}
 */
export function networkLine(ref, freq = null) {
  const where = [];
  if (ref?.town) where.push(ref.town);
  else if (freq?.commune) where.push(freq.dept ? `${freq.commune} (${freq.dept})` : freq.commune);
  if (ref?.fareZone) where.push(`zone ${ref.fareZone}`);
  if (ref) {
    where.push(ref.accessible === true ? 'accès de plain-pied'
      : ref.accessible === 'partial' ? 'accès de plain-pied partiel'
        : ref.accessible === false ? 'pas d’accès de plain-pied'
          : 'accessibilité non renseignée');
  }
  return where.length ? where.join(' · ') : null;
}

/**
 * The selected stop's card — the network half and the frequency half, in one.
 *
 * This is the merge, stated as copy. Every line is either published or an
 * arithmetic identity on a published number, and the last one says which week
 * was drawn: this is a yearly average of a term-time week, not a timetable.
 *
 * ── THE CONSEQUENCE FIRST, THE NUMBER AS ITS PROOF ───────────────────────
 * Rewritten 2026-09-10, to the rule the airport-noise pastilles were rewritten
 * to a day earlier. What stood here was eleven lines built the other way round
 * — a rate, then a day total in "courses", then seven day-by-day numbers, then
 * a count of published time bands. A reader called it « du charabia ». It is
 * seven lines now, and it opens on how long they stand at the pole.
 *
 * Three lines were cut outright and the reasoning is worth keeping:
 *   - `Total Mardi : 244 courses` measures how big the stop is, which is a
 *     fact about the operator's day, not about the reader's.
 *   - `Même tranche : Lun 13 · Mar 13 · …` is seven numbers with no question
 *     attached. {@link mostDifferentDay} asks the question and answers it in
 *     one clause.
 *   - `21 tranches publiées sur 24` is internal accounting. The part a reader
 *     needs — when the service starts and stops — is already the first/last
 *     line, and states it in hours rather than in array indices.
 *
 * The MODE moves to the title, beside the name, where a reader looks for what
 * kind of thing they just clicked; {@link networkLine} keeps WHERE it is.
 *
 * ── A CLICK IS ANSWERED, NEVER DEFERRED ──────────────────────────────────
 * There are no altitude excuses on this card any more. It carried two —
 * "l'offre horaire n'est pas lue à cette altitude, rapprochez-vous" above the
 * frequency gate, and a flat "aucun profil publié" in a box the proxy had
 * refused without ever asking about this stop — and both were the MAP's
 * ceiling quoted back at a reader who had already narrowed the question to one
 * coordinate. `probeStop()` buys that coordinate's profile instead, so the
 * only absence this card can still report is a measured one: a stop with no
 * row in the offer file. See {@link selectStop}.
 *
 * ── AND NO LICENCE LINE ──────────────────────────────────────────────────
 * It named both licences, which is a real obligation and is discharged in the
 * two places built for it: `dataCredits.js`, which puts both in the
 * attribution surface for as long as the layer is on, and the layer's own
 * `source` string. A per-stop card is not one of those places — it is where a
 * reader asks what serves this address — and "réseau ODbL 1.0 · fréquence
 * Licence Ouverte v2.0" is the last line they read before closing it.
 *
 * @param {{ref:?object, freq:?object}} stop
 * @param {{day:string, band:number, pack:?object, probe:?string}} context
 *   `probe` is the state of the on-demand lookup: `loading`, `error`, or null.
 * @returns {string} Title on the first line, details after.
 */
export function buildStopCard({ ref = null, freq = null } = {}, context = {}) {
  if (!ref && !freq) return '';
  const day = context.day || _slot.day;
  const band = clampBand(context.band ?? _slot.band);
  const pack = context.pack || null;
  const probe = context.probe || null;

  const mode = ref?.mode || freq?.mode || 'unknown';
  const modeLabel = ref?.modeLabel || IDFM_MODES[ref?.mode]
    || IDFM_FREQ_MODE_LABELS[freq?.mode] || IDFM_FREQ_MODE_LABELS.unknown;
  const name = ref?.name || freq?.name || `Arrêt ${ref?.id || freq?.id}`;
  const dayLabel = IDFM_FREQ_DAY_LABELS[day] || day;
  const lines = [`${name} · ${modeLabel}`];

  if (freq) {
    // 1. THE CONSEQUENCE. How long you stand there, at the hour on screen.
    const rate = profileRate(freq.profile, day, band);
    const when = `${dayLabel.toLowerCase()} à ${hourOf(band)}`;
    const vehicle = MODE_VEHICLE[mode] || MODE_VEHICLE.unknown;
    lines.push(rate > 0
      ? `Un ${vehicle} toutes les ${waitClock(rate)} — ce ${when}`
      : `Rien ne passe ici ce ${when}`);

    // 2. THE PROOF, and the shape of the day around it.
    const span = profileSpan(freq.profile, day);
    const peak = profilePeak(freq.profile, day);
    const proof = [];
    if (rate > 0) {
      proof.push(peak && peak.band !== band
        ? `${formatRate(rate)} par heure ici, jusqu’à ${formatRate(peak.rate)} vers ${hourOf(peak.band)}`
        : `${formatRate(rate)} par heure ici`);
    }
    if (span) proof.push(`premier ${clockOf(span.first)}, dernier ${clockOf(span.last)}`);
    if (proof.length) lines.push(proof.join(' · '));

    // 3. THE DAY THAT DIFFERS, if one does.
    const other = mostDifferentDay(freq.profile, band, day);
    if (other) {
      lines.push(other.rate > 0
        ? `${IDFM_FREQ_DAY_LABELS[other.day]} à la même heure : un toutes les ${waitClock(other.rate)}`
        : `${IDFM_FREQ_DAY_LABELS[other.day]} à la même heure : rien`);
    }
  } else if (probe === 'loading') {
    lines.push('Lecture de l’offre horaire de cet arrêt…');
  } else if (probe === 'error') {
    lines.push('Offre horaire IDFM momentanément indisponible pour cet arrêt');
  } else {
    // The one honest absence left, and it is a MEASUREMENT rather than a
    // ceiling: this stop has no row in the offer file at all. Measured,
    // 3 053 of the 37 956 referential stops, 8.0 %.
    lines.push('Aucun profil horaire publié pour cet arrêt dans l’offre IDFM');
  }

  // 4. WHERE IT IS — town, fare zone, step-free. The mode is on the title.
  const where = networkLine(ref, freq);
  if (where) lines.push(where);

  if (freq) {
    // 5. THE WHOLE DAY, in one line of glyphs.
    const glyphs = dayGlyphs(freq.profile, day);
    if (glyphs) lines.push(`04 h ${glyphs} 03 h — la journée entière`);

    // 6. THE CAVEATS THAT ONLY APPEAR WHEN THEY APPLY.
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

    // 7. WHAT THIS IS. Never a timetable, and it says so in its own words.
    lines.push(`Moyenne d’une semaine ordinaire ${pack?.year || IDFM_FREQ_REFERENCE_YEAR}, `
      + 'hors vacances — ce n’est pas un horaire');
  }

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
    // The colour channel is named, because up here it carries the MODE and
    // lower down it carries the rate. See {@link stopBadgeFill}.
    return parts.concat('couleur par mode', 'fréquence à partir d’une vue de 5 km').join(' · ');
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

/** The `id_arret` behind either of this layer's two pick-id spaces. */
export function selectionStopId(id) {
  if (typeof id !== 'string' || !id) return null;
  if (id.startsWith('idfm:stop:')) return id.slice('idfm:stop:'.length);
  if (id.startsWith('idfm-freq:')) return id.slice('idfm-freq:'.length);
  return null;
}

function slotContext(id = _selectedId) {
  const stopId = selectionStopId(id);
  return {
    day: _slot.day,
    band: _slot.band,
    pack: _freqPack,
    probe: stopId ? (_probes.get(stopId)?.status ?? null) : null,
  };
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
    return {
      ref,
      // The viewport pack first, then whatever a click has bought for this
      // stop. Same shape, same feed, different reason for being here.
      freq: _freqByStopId.get(stopId)?.stop || _probes.get(stopId)?.stop || null,
      position,
    };
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
  // ONE MARK PER STOP. A stop the referential also returned is already drawn,
  // as a badge carrying this same rate in its fill — so its disc is not a
  // second reading of the same number, it is the same reading twice. Hidden
  // rather than never created, because `_refStops` is refreshed by a query of
  // its own and a disc must be able to reappear when its badge goes.
  record.point.show = !_refStops.has(String(record.stop.id));
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
  const resolved = resolveSelection(id);
  if (!resolved) return false;
  if (_selectedId && _selectedId !== id) clearSelection();
  _selectedId = id;
  if (id.startsWith('idfm:stop:')) {
    _selectedBase = emphasiseAddressMarker(_dataSource?.entities?.getById(id));
  } else {
    const record = _freqRecords.get(id);
    if (record?.point) {
      record.point.show = true;
      record.point.color = Cesium.Color.fromCssColorString(SELECTED_COLOR).withAlpha(0.85);
      record.point.outlineColor = Cesium.Color.fromCssColorString(SELECTED_COLOR);
      record.point.pixelSize = SELECTED_SIZE_PX;
    }
  }
  // A CLICK IS A QUESTION, and it is answered. If this view never charted this
  // stop's profile — above the gate, or in a box the proxy refused — the card
  // does not quote the map's ceiling back at the reader, it buys the one
  // profile they asked for. Fired before the first paint so the card opens on
  // "lecture…" rather than flashing an absence it is about to disprove.
  if (!resolved.freq) {
    void probeStop(selectionStopId(id), resolved.ref?.lat, resolved.ref?.lon);
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

/**
 * What one left-click does: select a stop, close the card, or nothing.
 *
 * ── The bug this is a function because of ─────────────────────────────────
 * The handler used to close on `!picked` — on nothing at all being under the
 * cursor. Over a PHOTOREALISTIC globe there is always something under the
 * cursor: the click lands on the 3D Tiles feature of the roof or the road, so
 * `!picked` was false everywhere in Paris and the card could not be dismissed
 * by clicking the map. Reported as exactly that, and it is the kind of
 * condition that reads correct until you know which globe it runs on — so the
 * decision is a pure function with the tileset case pinned in a test.
 *
 * ANY pick that is not one of ours closes the card, another layer's marker
 * included. That is right rather than merely convenient: the card answers
 * "this stop", and the reader has just pointed at something that is not it.
 *
 * @param {object|null} picked Result of `scene.pick()`.
 * @param {{selectedId: ?string}} [state]
 * @returns {{action:'select'|'close'|'ignore', id:?string}}
 */
export function clickDecision(picked, { selectedId = _selectedId } = {}) {
  const pickedId = resolvePickId(picked);
  if (ownsPickId(pickedId)) return { action: 'select', id: pickedId };
  return { action: selectedId ? 'close' : 'ignore', id: null };
}

function installClickHandler(viewer) {
  if (_clickHandler || !viewer?.scene?.canvas) return;
  _clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  _clickHandler.setInputAction((click) => {
    const { action, id } = clickDecision(viewer.scene.pick(click.position));
    if (action === 'select') selectStop(id);
    else if (action === 'close') clearSelection();
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

// --- Rendered-surface seating -----------------------------------------------

/**
 * Put every mark this layer draws on the surface underneath it.
 *
 * BOTH KINDS AT ONCE, because they stand on the SAME coordinate: a badge
 * entity and, under it, a frequency disc. The disc yields wherever a badge
 * stands, but a hidden disc still has to be in the right place — its badge can
 * go at any repaint, and a fix that seated one of the two would simply pull
 * them apart at that moment.
 *
 * The same mechanism the address-scan factory runs, for the same reason: a
 * stop drawn on the ellipsoid stands eighty metres under the pavement it
 * serves, and a vertical error under a camera that is not exactly overhead is
 * a horizontal error on screen that MOVES as the camera moves. Measured on
 * this layer, 2026-09-10 over the Latin Quarter with the camera at 420 m: the
 * marks sat at ellipsoidal 0 while the rendered mesh read 83.5 to 91.6 m under
 * the same coordinates — 140 px of median error, 272 px at worst, and up to
 * 269 px of SLIDE across a 250 m pan. That slide is the reported symptom.
 *
 * The height is read from whichever surface is ON SCREEN, which is the part
 * that was missing: `globe.getHeight()` answers `undefined` for every point on
 * the photoreal stack, where the globe is hidden, so this seating was a silent
 * no-op on the stack most readers are looking at. `renderedSurface.js` owns
 * that decision and the budget it costs.
 *
 * This layer keeps its own copy of the wiring rather than the logic — its scan
 * is a bounding box, not a radius, so it does not sit on the factory — and the
 * box centre stands in for surface that has not streamed in yet. Over this
 * viewport that one borrowed reading is most of the fix on its own: ~88 m of
 * error down to ~8 m, for a single probe.
 *
 * @returns {number} How many marks moved.
 */
function seatMarkers(centre = _lastCentre) {
  const scene = _viewer?.scene;
  if (!scene?.globe || _dormant) return 0;
  const fallback = centre
    ? renderedGroundM(scene, Cesium.Math.toRadians(centre.lon), Cesium.Math.toRadians(centre.lat))
    : null;
  let moved = 0;
  let pending = 0;
  if (_dataSource) {
    const seated = seatEntitiesOnGround(_dataSource.entities.values, scene, fallback);
    moved += seated.moved;
    pending += seated.pending;
  }
  const discs = seatDiscs(fallback);
  moved += discs.moved;
  pending += discs.pending;
  _seatPending = pending > 0;
  if (moved > 0) {
    // The open card carries a copy of its mark's position, so it has to
    // follow the mark up rather than stay where the mark used to be.
    if (_selectedId) repaintSelectedCard();
    governorRequestRender('idfm-network-seat');
  }
  return moved;
}

/**
 * Seat the frequency discs, which are `PointPrimitive`s rather than entities.
 *
 * {@link POINT_LIFT_M} was measured against the wrong datum: `fromDegrees(lon,
 * lat, 2)` is two metres above the ELLIPSOID, so a disc stood some eighty-eight
 * metres under the pavement it describes and was painted there anyway, depth
 * testing being disabled. The lift is kept — it is what holds a disc clear of
 * the tarmac — and simply applied to a measured floor instead of to nothing.
 *
 * A disc hidden under a badge is seated too: `show` is not `exists`, and the
 * moment its badge stops covering it a disc that skipped its turn would be the
 * only mark in the view standing on the ellipsoid.
 *
 * @param {?number} fallbackHeightM Surface under the scan centre, if read.
 * @returns {{moved: number, pending: number}}
 */
function seatDiscs(fallbackHeightM) {
  const scene = _viewer?.scene;
  if (!scene || !_points?.length) return { moved: 0, pending: 0 };
  const { moved, pending } = seatPointsOnSurface(iterateDiscs(), scene, {
    fallbackHeightM,
    liftM: POINT_LIFT_M,
    sampleBudget: SURFACE_SAMPLE_BUDGET,
  });
  // A record carries a COPY of its disc's position and the card is anchored on
  // the record, so the copy follows the disc up rather than staying behind.
  if (moved > 0) {
    for (const record of _freqRecords.values()) {
      if (record.point) record.position = record.point.position;
    }
  }
  return { moved, pending };
}

/** The collection is index-addressed; the seater wants an iterable. */
function* iterateDiscs() {
  for (let i = 0; i < _points.length; i += 1) yield _points.get(i);
}

/**
 * Re-seat once the surface settles, coalescing the burst of tile-load events.
 *
 * A pass that still owes readings books the next one itself, with a DOUBLING
 * delay: on the photoreal stack the globe's `tileLoadProgressEvent` never
 * fires — a hidden globe streams no tiles — and the probe budget seats at most
 * a couple of dozen marks per pass. A first fixed-interval cut of this loop
 * (six wake-ups at 250 ms) expired before the mesh had finished streaming and
 * left the defect whole. See `addressScanLayer.js`, where the same loop and
 * the same measurement are written out in full.
 */
function scheduleSeat(retries = SEAT_RETRY_PASSES, delayMs = SEAT_SETTLE_MS) {
  clearTimeout(_seatTimer);
  _seatTimer = setTimeout(() => {
    seatMarkers();
    if (_seatPending && retries > 0) scheduleSeat(retries - 1, delayMs * SEAT_RETRY_BACKOFF);
  }, delayMs);
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
      show: !_refStops.has(String(stop.id)),
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
  restyleBadges();
  // Freshly added discs are on the ellipsoid until somebody reads the ground
  // for them, and the badges they hide under were seated by the referential
  // pass. Seating here, and again as the mesh streams, is what keeps the two
  // marks over one stop from drifting apart.
  seatMarkers();
  scheduleSeat();
  governorRequestRender('idfm-network-frequency');
}

/**
 * Repaint every badge for the slot and the pack the layer now holds.
 *
 * The badges are the ONLY mark on a stop this layer draws twice — the disc
 * yields to them — so scrubbing the clock has to reach them, not just the
 * discs. Cheap by construction: at most {@link STOP_LIMIT} entities, and the
 * data URIs are memoised per (mode, fill) inside `transitVehicleIcons.js`, so
 * a repaint is a property assignment against an atlas entry that already
 * exists.
 *
 * The selected badge is repainted too. `restoreAddressMarker` snapshots colour
 * and size and not the image, so a new fill survives deselection instead of
 * being reverted to the band the reader has since left.
 */
function restyleBadges() {
  if (!_dataSource) return;
  for (const entity of _dataSource.entities.values) {
    if (!entity?.billboard) continue;
    const ref = _refStops.get(String(entity.id).slice('idfm:stop:'.length));
    if (!ref) continue;
    entity.billboard.image = stopBadge(ref.mode, badgeFillFor(ref));
  }
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
  restyleBadges();
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

/** Remember one probed profile, evicting the oldest first. */
function rememberProbe(stopId, entry) {
  _probes.delete(stopId);
  while (_probes.size >= PROBE_CACHE) {
    _probes.delete(_probes.keys().next().value);
  }
  _probes.set(stopId, entry);
}

/**
 * Buy ONE stop's hourly profile, because the reader clicked it.
 *
 * ── The line this replaced ────────────────────────────────────────────────
 * Above the frequency gate a card used to read "Offre horaire non lue à cette
 * altitude — rapprochez-vous pour la fréquence", and in a box the proxy
 * refused as too dense it read "Aucun profil horaire publié pour cet arrêt" —
 * which was not merely unhelpful, it was FALSE, because nothing had been
 * asked. Both were the map's ceiling quoted back at somebody who had already
 * pointed at one stop. A click is not a viewport: it names a single
 * coordinate, and the cheapest legal box around that coordinate is one grid
 * cell. So the click buys it.
 *
 * WHAT IT COSTS, and why the gate still exists for the MAP. Five upstream
 * calls — one identity page and the four band windows — for a box the proxy
 * caches to disk. That is affordable per click and is exactly what is NOT
 * affordable per frame across a viewport of 1 200 stops, which is what
 * {@link STOPS_ENTER_SPAN_DEG} is for. The gate now bounds the DRAWING and
 * never the answer to a question.
 *
 * Every profile the box paid for is kept, not just the one asked about: the
 * neighbours are already in the payload, and the next click on that street is
 * then free.
 *
 * @param {string} stopId `id_arret`, which is what joins `arrets.arrid`.
 * @param {number} lat @param {number} lon
 */
async function probeStop(stopId, lat, lon) {
  if (!stopId || _probes.has(stopId)) return;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  rememberProbe(stopId, { status: 'loading', stop: null });
  const params = new URLSearchParams({
    south: (lat - PROBE_HALF_DEG).toFixed(5),
    west: (lon - PROBE_HALF_DEG).toFixed(5),
    north: (lat + PROBE_HALF_DEG).toFixed(5),
    east: (lon + PROBE_HALF_DEG).toFixed(5),
  });
  let answer = { status: 'empty', stop: null };
  try {
    const payload = await fetchJson(`${FREQ_URL}?${params}`, {
      validate: (body) => Array.isArray(body?.stops),
    });
    for (const stop of payload.stops) {
      const id = String(stop?.id ?? '');
      if (!id || id === stopId) continue;
      rememberProbe(id, { status: 'ok', stop });
    }
    const own = payload.stops.find((stop) => String(stop?.id ?? '') === stopId);
    // `empty` and not `error`: the box answered, and its answer is that this
    // stop has no row in the offer file. Measured, 3 053 of 37 956 stops.
    if (own) answer = { status: 'ok', stop: own };
  } catch (error) {
    if (error?.name !== 'AbortError') {
      console.warn('[Data:IDFM] stop profile unavailable:', error?.message || error);
    }
    answer = { status: 'error', stop: null };
  }
  rememberProbe(stopId, answer);
  if (!_enabled) return;
  // Only the open card reads a probe, so only the open card is repainted. The
  // BADGE deliberately does not move: one stop wearing a rate while the
  // hundred around it wear their mode would read as a difference in service.
  if (_selectedId && selectionStopId(_selectedId) === stopId) repaintSelectedCard();
}

/**
 * Read the region's unplaced total, once.
 *
 * Fire-and-forget and never awaited by a draw: the note it feeds is one legend
 * line, and a reader looking at stops must not wait on it. A failure leaves the
 * line absent, which is the honest state — an unknown count is not zero.
 */
function ensureUnplacedTotal() {
  if (_freqUnplaced !== null || _freqUnplacedPromise) return;
  _freqUnplacedPromise = fetchJson(FREQ_REGION_URL, {
    validate: (body) => Number.isFinite(body?.totals?.unplaced),
  }).then((payload) => {
    _freqUnplaced = payload.totals.unplaced;
  }).catch(() => null).finally(() => { _freqUnplacedPromise = null; });
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
      // The badges were carrying rates; up here nothing has read one, so they
      // go back to naming their mode. See {@link stopBadgeFill}.
      restyleBadges();
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
            // The mode's own pictogram, inside a filled badge: five French
            // registers scan the same address and a coloured dot said nothing
            // about which one a marker came from. See `addressMarkerIcons.js`.
            image: stopBadge(stop.mode, badgeFillFor(stop)),
            width: IDFM_BADGE_SIZE[stop.mode] ?? DEFAULT_BADGE_SIZE,
            height: IDFM_BADGE_SIZE[stop.mode] ?? DEFAULT_BADGE_SIZE,
            // WHITE, and deliberately: the badge's colours are BAKED, because
            // a tint cannot flip a pictogram's ink from white to black and
            // this fill ramp needs both ends. `emphasiseAddressMarker` still
            // tints on selection, which is the one place a cast is wanted.
            color: Cesium.Color.WHITE,
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
 * the same box is still on screen — but the LOD of the surface beneath those
 * stops may have refined on the way in. Re-seating is a local read; it must
 * not be gated behind a decision about the network.
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
    _probes = new Map();
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
    // ONE regional read, here rather than inside a viewport load: the count it
    // carries is a fact about the FILE, true at every altitude, and a reader
    // who opens the layer already zoomed in — or on a box the proxy answers
    // from cache — never passes through the code path a load-time call would
    // sit on. Measured: on two runs out of three the note was simply absent.
    ensureUnplacedTotal();
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
    _probes = new Map();
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
      stopsWithoutCoordinate: _freqUnplaced,
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

    // THE LEGEND DESCRIBES WHAT IS DRAWN, and what is drawn depends on the
    // regime. Above the gate, or in a box the proxy refused, no rate has been
    // read for anything on screen and every badge names its MODE — so a ramp
    // legend there listed six rungs at zero and a silent row at zero, which is
    // what the reader saw and rightly read as broken. See {@link stopBadgeFill}.
    if (!freqCharted()) {
      return { chips, legend: modeLegend(_refStops) };
    }

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
      legend.push({ label: levelLabel(level), color: levelColor(level), count });
    });
    legend.push({
      label: IDFM_FREQ_SILENT_LABEL,
      color: IDFM_FREQ_SILENT_COLOR,
      count: silent,
      blurb: SILENT_BLURB,
    });
    // The badges the offer does not reach. Its own row, because it is the one
    // grey on this map that means "nobody counted", and a reader who cannot
    // tell it from the silent colour cannot read either.
    let unmeasured = 0;
    for (const stopId of _refStops.keys()) {
      if (!_freqByStopId.has(String(stopId))) unmeasured += 1;
    }
    if (unmeasured) {
      legend.push({
        label: 'offre horaire non publiée',
        color: IDFM_NOT_MEASURED_COLOR,
        count: unmeasured,
        blurb: 'Arrêt du référentiel qui n’a AUCUNE ligne dans le fichier d’offre — 3 053 des '
          + '37 956, soit 8,0 %. Le gris « non mesuré » de toute l’application, et non la couleur '
          + 'du passage nul, qui est une mesure. Un clic sur cet arrêt va tout de même chercher '
          + 'son profil : le fichier d’offre est interrogé par arrêt, pas seulement par vue.',
      });
    }
    // The stops nobody can draw travel with the legend — but NOT as a counted
    // row. See {@link UNPLACED_BLURB}: here the shape says more than the
    // sentence, and the old shape said the opposite of the truth.
    if (_freqUnplaced) {
      legend.push({
        label: `${fr(_freqUnplaced)} arrêts sans coordonnée publiée : `
          + 'sur aucune carte, ici ni ailleurs',
        color: null,
        blurb: UNPLACED_BLURB,
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
  dormant = false, count = null, unplacedTotal = null,
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
  _freqUnplaced = unplacedTotal;
  _freqUnplacedPromise = null;
  _refStops = new Map((refStops || []).map((stop) => [String(stop.id), stop]));
  _freqRecords = new Map();
  _freqByStopId = new Map();
  _probes = new Map();
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
  _probes = new Map();
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

/** What a click bought, keyed on `id_arret`. */
export function _idfmNetworkProbeForTest(stopId) {
  return _probes.get(String(stopId)) || null;
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
