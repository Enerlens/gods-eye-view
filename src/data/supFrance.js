/**
 * @module supFrance
 *
 * Where France's 2.96 million students actually are — the layer that starts
 * where `schoolsFrance.js` stops.
 *
 * The source is the MESR's *Effectifs d'étudiants inscrits — détail par
 * établissements* (Licence Ouverte 2.0), completed with the ministry's
 * geolocated Parcoursup cartography for the establishments the register cannot
 * place. `supFeed.js` holds the reading of both files and every trap in them;
 * `supDepartements.js` holds the national fold; this file is the rendering.
 *
 * ── Two regimes, not three, and that is the interesting part ────────────────
 * `schools-fr` and `irve-fr` both need a middle "maillage" regime, because
 * 68 158 schools and 39 579 charge points cannot be sent to a browser with
 * their names on and cannot be drawn at once if they were. This register is
 * 6 914 sites. The complete pack — every site with its name, band, enrolment,
 * cycle mix, campus count, formation offer and website — measures **0.62 MB
 * gzipped**, which is what the `schools-fr` maillage costs (0.63 MB) while
 * carrying no names at all.
 *
 * So there is no spatial thinning here, no bbox ceiling, and no per-viewport
 * proxy call. The browser is handed the register once and answers every zoom
 * from it, which removes the one caveat those layers can never remove: nothing
 * on this map is a sample. What is drawn is what is there.
 *
 *   national — 96 département PRISMS: height = students, hue = the share at
 *              bac+4 and beyond. Entered on the view's LATITUDE span (≥ 9.5°,
 *              metropolitan France being 9.8° tall), never on the larger of
 *              the two spans, which on a 16:10 viewport is mostly a statement
 *              about the window's shape.
 *   sites    — every site in view, from the pack, with its card.
 *
 * ── The national regime was a flat count fill, and that was the worst one ───
 * Until this pass the national view painted 2.96 million students as SIX
 * QUANTILE COLOURS over the 96 département polygons. That is the figure the
 * corpus names in capitals — « Représentation d'une variable quantitative
 * absolue en aplats de couleur — NOP !!!! » — and of the three layers that
 * committed it, this one committed it hardest: the students sit in about
 * thirty cities, and the polygon they were painted on has no relation to them
 * at all. Paris is 104 km² and holds 394 788 of them; the Gironde is 10 077 km²
 * — ninety-seven times the area — and holds 107 022.
 *
 * The header used to argue that choice by comparing "count fill" with "density
 * fill" and picking the count. The argument is retired: on a globe the choice
 * was never between those two, because the height axis was empty. It now
 * carries the count, and the fill carries a rate, which is the one thing a
 * fill is allowed to say. `choroplethPrism.js` holds the shared grammar and
 * every calibration figure; what follows is only what is specific to sup-fr.
 *
 * ── A3 · what each channel carried, and what it carries now ─────────────────
 *   HUE    before: the student count, in six quantile bins recomputed from the
 *          rows in hand at every load (a B1 fault, and a C1 one).
 *          now: `advancedShare` — the share of a département's graded students
 *          at bac+4 and beyond, against FROZEN breaks published below.
 *   HEIGHT before: nothing. The axis existed and no layer of this repo used it.
 *          now: the student count, on a square-root ruler — see below for the
 *          measurement that forced the square root on this layer alone.
 *   ALPHA  before: `choroplethAlpha.js`'s DESCENDING ladder, a compositing
 *          correction so that six fills stayed six ordered fills over live
 *          imagery. now: nothing. A prism body composites over the sky and
 *          over other prisms, not over the basemap, so that correction has no
 *          object here; the body is a constant {@link PRISM_BODY_ALPHA}, and
 *          the ladder is deliberately NOT imported (it would put a second,
 *          mismatched ordering on a channel that carries none).
 *
 * ── Why this layer declares `sqrt`, and it is the layer that must ───────────
 * The prism default is linear, because a length is judged directly and a
 * uniform ruler is what makes the legend readable with the map. sup-fr is the
 * declared exception, and the measurement is unambiguous. The domain runs from
 * Corse-du-Sud (738 students) to Paris (394 788) — 1 : 535, where the shared
 * grammar puts the threshold at about 1 : 30. On a linear ruler the 4 km floor
 * lands at 3.33 % of the domain, i.e. 13 333 students, and **51 of the 96
 * départements — the median is 9 109 — would be drawn at the same floored
 * height**. Half of France flattened is not a scale, it is a lie by flooring.
 * On the square-root ruler the floor lands at 444 students, below the smallest
 * département, so nothing is floored at all and every value is a height.
 *
 * The price is stated in the legend by `prismLegend`, unprompted and in
 * French: a prism twice as tall is four times as many. Measured heights at the
 * ~1 500 km national altitude, side-on: Paris 119.2 km (114.7 px), Rhône
 * 83.3 km (80.2 px), the median département 18.1 km (17.4 px), Corse-du-Sud
 * 5.2 km (5.0 px). The same values on a linear ruler: 118.4, 57.9, 4.0 and
 * 4.0 km — the last two identical, which is the defect in one line.
 *
 * ── What the hue is, and the two candidates that lost ───────────────────────
 * `supDepartements.js` carries the measurement in full. In short: students per
 * 1 000 km² ranks the same as the height (Spearman ρ = 0.974, mean displacement
 * 4.3 places out of 96) and would spend the second channel restating the
 * first; students per 1 000 inhabitants is the rate a reader would want and
 * needs a population source this layer does not have. What ships is the share
 * at bac+4 and beyond — ρ = 0.880, mean displacement 10.4 places — because it
 * answers the question the height cannot: the Nord and the Haute-Garonne are
 * both tall, and 2 800 of this register's sites are lycées running a BTS, so
 * "many students" and "a full university system" are two different facts.
 *
 * WHAT THE HUE DOES NOT DO, and the shared grammar expects it to: it does not
 * audit the prism's areal bias. A reader who reads the VOLUME rather than the
 * top edge over-reads wide rural départements, and here the colour does not
 * catch that, because the rate chosen is not area-normalised. Two mitigations,
 * both declared rather than hidden: the height legend says in French that the
 * base is the département and that its area is not neutralised, and every
 * département card still prints its students per 1 000 km². It is a stated
 * limit, not a corrected one.
 *
 * ── Rendering notes specific to this layer ──────────────────────────────────
 * · `polygon.classificationType` is CLEARED on every prism and kept on the two
 *   FLAT marks, which is the whole of the nuance. Verified in the bundled
 *   Cesium: `GroundGeometryUpdater._isOnTerrain` returns false as soon as
 *   `extrudedHeight` is defined (`index.js:148334-148336`), so on a prism the
 *   property is read into `_classificationTypeProperty` and then never used —
 *   leaving it set would be a property that lies to the next reader. A flat
 *   footprint, on the other hand, still has to drape, or a département with no
 *   published enrolment would be buried under 2 km of Alpine terrain and its
 *   absence mark would be invisible. `BOTH` covers terrain and the
 *   photorealistic mesh alike, which is why this layer never needed a
 *   per-stack switch and still does not.
 * · `surfaceFill` is therefore declared CONDITIONALLY, and it was declared not
 *   at all before: the shared "your fill is climbing the façades" notice is
 *   true only while at least one flat footprint is drawn, and false for every
 *   prism, which drapes on nothing.
 * · The base sits on the ELLIPSOID (`height = 0`), never on terrain: clamping
 *   would start the Savoie prism 2 km higher than the Landes one and so put
 *   its TOP 2 km higher at equal enrolment, which is a bias correlated with
 *   relief. The whole relief of France is 4.8 km against a 120 km prism.
 * · A MultiPolygon département raises ONE PRISM PER DRAWN PART, all at the
 *   same height, because the height is the département's value and not the
 *   part's. Corsica's two prisms are two views of one number; they are never
 *   to be added.
 * · The ambient département label rides at the TOP of its prism rather than on
 *   the ground, because the top edge is where the reading happens — and a
 *   label left at the base would be occluded by the very prism it names.
 *
 * ── Not in this pass ────────────────────────────────────────────────────────
 * `REPRESENTATION.md` proposes a Dorling cartogram for this layer, and it is
 * the dataset in the repo where an anamorphosis is most justified: 2.96 M
 * students in ~30 cities is a distribution the map of France is a poor support
 * for. That is a different piece of work — it replaces the geometry, where
 * this replaces the sign — and it is not started here.
 *
 * ── What a dot means in the sites regime (unchanged) ────────────────────────
 * Colour is the establishment BAND — seven of them, folded from the register's
 * 14 published categories on the rules in `supFeed.js`. Size is the enrolment
 * AT THAT SITE, and unlike `schools-fr` there is no unpublished case to draw
 * around: the register is an enrolment file, so a site exists only because
 * students are counted there.
 *
 * ── Why the palette is deliberately not the schools palette ─────────────────
 * 2 800 of these 6 914 sites are lycées running a BTS or a CPGE, and
 * `schools-fr` draws every one of them too, at the same coordinate. An
 * operator with both layers on is looking at stacked dots by design. So this
 * layer's hues are DEEP and saturated where the schools ladder is pastel, and
 * its dots carry a white outline where the schools dots carry a black one —
 * two signatures that survive being overlapped, so a reader can always tell
 * which map they are reading.
 */

import * as Cesium from 'cesium';
import {
  PRISM_BASE_HEIGHT_M,
  PRISM_BODY_ALPHA,
  PRISM_NO_RATIO_COLOR,
  PRISM_NO_RATIO_GLYPH,
  PRISM_TOP_ALPHA,
  createPrismScale,
  prismLegend,
  prismRatioColor,
  prismRow,
  prismTally,
} from './choroplethPrism.js';
import { governorRequestRender } from '../renderGovernor.js';
import { registerSpriteCollection, restoreSpriteOrder, unregisterSpriteCollection } from './spriteOrder.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import { cachedGroundFloor, warmGroundFloor } from './groundFloor.js';
import { parseDepartements } from './meteoFranceVigilance.js';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import {
  SUP_CYCLES,
  SUP_CYCLE_LABELS,
  SUP_KINDS,
  SUP_KIND_LABELS,
  SUP_PLACEMENT_LABELS,
} from './supFeed.js';
import { supAdvancedShare } from './supDepartements.js';

export const SUP_FR_LAYER_ID = 'sup-fr';

export const SUP_FR_OVERLAY_SOURCE_ID = 'sup-fr-selected';
export const SUP_FR_OVERLAY_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 1,
  moving: false,
});
export const SUP_FR_LABEL_SOURCE_ID = 'sup-fr-departements';
export const SUP_FR_LABEL_COHORT_LIMIT = 14;
export const SUP_FR_LABEL_COLLISION_CAPACITY = 12;

const DEPARTEMENTS_URL = new URL(
  './local_data/france_departements/departements.geojson',
  import.meta.url,
).href;

// --- Activation / load gating ----------------------------------------------
/**
 * View LATITUDE span (degrees) at or above which the choropleth answers.
 * Metropolitan France is 9.8° tall. The exit threshold is lower than the entry
 * one so a camera resting on the boundary does not swap the whole map back and
 * forth on sub-pixel drift. The same pair `schools-fr` settled on, because it
 * is a fact about France and the screen rather than about either register.
 */
const NATIONAL_ENTER_SPAN_DEG = 9.5;
const NATIONAL_EXIT_SPAN_DEG = 8;
const CAMERA_DEBOUNCE_MS = 450;
/**
 * Poll cadence (ms). Very long on purpose: the register is published ONCE A
 * YEAR, at the rentrée. Anything faster re-asks a question whose answer cannot
 * have changed. The camera, not the clock, drives this layer.
 */
const POLL_INTERVAL_MS = 6 * 60 * 60_000;
const NATIONAL_TIMEOUT_MS = 120_000;
/**
 * Hard cap on rendered sites. Above the whole register (6 914), so it never
 * bites in production — it exists so a malformed pack cannot ask Cesium for a
 * million primitives. The payload arrives sorted by enrolment, so if it ever
 * did bite, what survives is the part a reader would keep.
 */
const MAX_RENDERED_SITES = 8_000;
const POINT_LIFT_M = 2.5;
const GROUND_WARM_LIMIT = 600;

// --- Presentation -----------------------------------------------------------
/**
 * The band ladder's hues.
 *
 * Deep and saturated, against the schools ladder's pastels, because the two
 * layers draw 2 800 of the same addresses — see the module header. Within the
 * family they are seven distinct hues rather than seven steps of one: a
 * business school is not "more" than an art school, and a categorical scale
 * must not read as a ramp. They collide with nothing else on this globe —
 * not the charge-point power ramp (blue→red), not Mix élec's teal/amber, not
 * Vigilance's green→red. `autre` is deliberately outside the family, in
 * graphite: it is the register's own catch-all, and it should not read as a
 * named kind of school.
 */
const KIND_COLORS = Object.freeze({
  universite: '#7048e8',
  lycee: '#f59f00',
  ingenieur: '#0c8599',
  commerce: '#c2255c',
  sante: '#2b8a3e',
  art: '#e8590c',
  autre: '#495057',
});

/**
 * Prism ramp, low rate to high — the same sequential violet scale the flat
 * fill used, carried over deliberately.
 *
 * Violet because the layer's largest band is, so a reader zooming out from a
 * screen full of universities into the national view is not handed a colour
 * that means something else. Distinct from every other French layer's ramp,
 * and in particular from the `schools-fr` green one: the two national views
 * never draw at the same time, but an operator who toggles between them must
 * not carry one quantity's colour into the other's.
 *
 * It varies in VALUE and not only in hue (B4): #241452 to #bfaefa is a
 * monotone lightness climb, so the order survives greyscale and a deuteranope
 * reads it. What changed under it is what it MEANS — an enrolment count
 * before, a rate now — which is why the legend leads with the word « part ».
 */
const DEPARTEMENT_COLORS = Object.freeze([
  '#241452', '#35207d', '#4b2fae', '#6544dd', '#8e73f0', '#bfaefa',
]);

/**
 * The frozen prism scale — every number here is a literal measured once and
 * published, never derived from a poll or from the viewport (C1).
 *
 * `domainMax` is 400 000 students: a round number just above Paris (394 788),
 * so the top of the ruler is a figure a reader can carry and nothing in the
 * 2024 vintage clips. A value above it is drawn at the maximum height, flagged
 * by `prismRow`, and COUNTED in the legend (A5) rather than silently rescaling
 * the map — a rentrée that pushes Paris past 400 000 must not shorten every
 * other département to make room.
 *
 * `heightTicks` are explicit rather than the grammar's default
 * (200 000 / 100 000 / 20 000): the median département holds 9 109 students,
 * so a ruler whose lowest mark is 20 000 leaves half of France under its
 * bottom tick. 200 000 / 50 000 / 5 000 puts a mark at 84.9, 42.4 and 13.4 km
 * — 81.7, 40.8 and 12.9 px at national altitude — which brackets the actual
 * distribution instead of only its top.
 *
 * `ratioBreaks` are round percentage points on a bounded 0–100 domain, so the
 * ladder needs no justification beyond arithmetic. Class occupancy on the real
 * rollup: 17 / 18 / 18 / 20 / 21 / 2. The top class holds exactly Essonne
 * (46.0 %) and Paris (42.7 %) — Saclay and the Quartier latin — and a class of
 * two is kept because it is a fact about French research, not an accident of
 * cutting.
 */
export const SUP_PRISM_SCALE = createPrismScale({
  id: 'sup-fr',
  domainMax: 400_000,
  heightLabel: 'étudiants',
  heightUnit: 'étudiants',
  mode: 'sqrt',
  heightTicks: [200_000, 50_000, 5_000],
  ratioLabel: 'part des étudiants à bac+4 et au-delà',
  ratioBreaks: [5, 10, 20, 30, 40],
  ratioColors: DEPARTEMENT_COLORS,
  ratioClassLabels: Object.freeze([
    '≤ 5 %', '5 – 10 %', '10 – 20 %', '20 – 30 %', '30 – 40 %', '> 40 %',
  ]),
});

/**
 * Stripe spacing on the body of a prism whose rate is unpublished.
 *
 * A MOTIF and not a tint, per D3: on a photorealistic globe no colour is
 * neutral, and a pattern is the one encoding that survives the NVG and FLIR
 * passes. 18 repeats spans a département with stripes wide enough to read at
 * national altitude and fine enough not to be mistaken for a second class.
 */
const NO_RATIO_STRIPE_REPEAT = 18;
const SELECTED_COLOR = '#00ffff';
/**
 * White, at 0.55 — where `schools-fr` outlines in black at 0.35. The outline
 * is the second half of this layer's signature and the half that survives a
 * stacked dot: on the 2 800 shared lycée addresses, whichever dot is on top,
 * the ring around it says which register drew it.
 */
const OUTLINE_COLOR = Cesium.Color.WHITE.withAlpha(0.55);
const SITE_POINT_MIN_PX = 5;
const SITE_POINT_MAX_PX = 16;
const SELECTED_POINT_PX = 19;
/**
 * Enrolment at which a dot reaches full size.
 *
 * 20 000, and it is a real ceiling rather than a round number: the largest
 * single site in the register holds 30 187 students (Université Paris Nanterre)
 * and the second 20 418, so a cap at the maximum would spend the whole top of
 * the scale on two dots. Square-rooted, because the eye reads area.
 */
const SIZE_CEILING_STUDENTS = 20_000;

/**
 * How many Parcoursup formation types the card prints before summarising.
 *
 * Four. The cartography files an establishment under up to 25 of them, and a
 * university that offers most of them produced a 160-character line — one
 * unwrapped row wider than the card, on the layer's biggest and most-clicked
 * dots. The remainder is COUNTED rather than dropped, so the line still says
 * how much it is not showing.
 */
const CARD_OFFER_LIMIT = 4;

/** One-line explanations behind each band swatch. */
const KIND_BLURBS = Object.freeze({
  universite: 'Universités, établissements assimilés et ENS — 58% des étudiants.',
  lycee: 'BTS et CPGE, enseignés dans un lycée. Ces adresses sont AUSSI dans la couche Établissements scolaires.',
  ingenieur: 'Écoles d’ingénieurs et écoles vétérinaires.',
  commerce: 'Écoles de commerce, gestion et vente, écoles juridiques et administratives.',
  sante: 'Écoles paramédicales hors université (IFSI, IFAS) et écoles du travail social.',
  art: 'Écoles supérieures artistiques et culturelles, écoles d’architecture, écoles de journalisme.',
  autre: 'La catégorie fourre-tout du registre : CFA et organismes de formation, pour l’essentiel.',
});

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});
let _overlayHost = DEFAULT_OVERLAY_HOST;

// --- Runtime state ----------------------------------------------------------
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
let _regime = 'national';
let _requestGeneration = 0;

let _national = null;
let _nationalPromise = null;
let _nationalError = null;
let _nationalPainted = false;
let _depDataSource = null;
let _depEntities = new Map();
let _depMeta = new Map();
let _depShapesPromise = null;

let _pack = null;
let _packPromise = null;
let _packError = null;
let _inView = 0;
let _studentsInView = 0;

// --- Colour and size --------------------------------------------------------

/** Hex for one band. Anything unrecognised gets the graphite. */
export function supKindColor(kind) {
  return KIND_COLORS[kind] || KIND_COLORS.autre;
}

/** French label for one band. */
export function supKindLabel(kind) {
  return SUP_KIND_LABELS[kind] || SUP_KIND_LABELS.autre;
}

/**
 * Everything one département needs to be drawn as a prism, from its rollup row.
 *
 * The four states the shared grammar defines are kept apart here and never
 * collapsed (A1): a measured zero is not a missing count, and a missing RATE
 * is independent of a missing count. `prismRow` decides them; this only adds
 * the identity and the two figures the card and the label need.
 *
 * @param {object} row One entry of `_national.departements`.
 * @returns {object} The prism row, plus `code`, `name`, `students`, `share`.
 */
export function supPrismRow(row) {
  const source = row || {};
  // The published rate, or the same arithmetic re-run over the cycles the row
  // still carries. The dev proxy caches this rollup on disk for a WEEK and its
  // shape version lives in a file this layer does not own, so a machine that
  // built its cache before `advancedShare` existed would otherwise draw all 96
  // prisms striped — an honest mark for a defect that is not real.
  const ratio = Number.isFinite(source.advancedShare)
    ? source.advancedShare
    : (source.advancedShare === null ? null : supAdvancedShare(source));
  const built = prismRow(
    { code: source.code, value: source.students, ratio },
    SUP_PRISM_SCALE,
  );
  return {
    ...built,
    name: source.name || '',
    students: built.value,
    share: built.ratio,
    sites: Number(source.sites) || 0,
  };
}

/** Every département of a rollup as a prism row, in the rollup's own order. */
export function supPrismRows(national) {
  return (national?.departements || []).map(supPrismRow);
}

/**
 * Fill colour for one rate, or `null` when the rate is not published.
 *
 * `null` and not a grey: the caller has to decide what "unpublished" looks
 * like, and the answer is a motif rather than a tint — see
 * {@link NO_RATIO_STRIPE_REPEAT} and D3.
 * @param {number|null|undefined} share Percentage at bac+4 and beyond.
 * @returns {string|null} CSS colour.
 */
export function supRateColor(share) {
  return prismRatioColor(share, SUP_PRISM_SCALE);
}

/**
 * Dot size for one site, by enrolment at that site.
 *
 * Square-rooted and capped — see `SIZE_CEILING_STUDENTS`. A 200-student IFSI
 * stays visibly smaller than a 12 000-student campus without a 30 000-student
 * one being a hundred and fifty times its area.
 */
export function supPointSize(students) {
  const count = Number(students);
  if (!Number.isFinite(count) || count <= 0) return SITE_POINT_MIN_PX;
  const span = SITE_POINT_MAX_PX - SITE_POINT_MIN_PX;
  const scale = Math.sqrt(Math.min(count, SIZE_CEILING_STUDENTS)) / Math.sqrt(SIZE_CEILING_STUDENTS);
  return SITE_POINT_MIN_PX + span * scale;
}

// --- Camera -----------------------------------------------------------------

/**
 * View box for the sites regime — the camera rectangle, padded.
 *
 * No ceiling, unlike the `schools-fr` box: the sites are picked from a set the
 * client already holds, so a wide view costs nothing upstream and there is no
 * proxy to refuse it. The padding means a dot does not pop into existence
 * exactly at the screen edge as you pan.
 */
export function cameraSupBox(viewer, padFraction = 0.12) {
  const rectangle = viewer?.camera?.computeViewRectangle?.();
  if (!rectangle) return null;
  const south = Cesium.Math.toDegrees(rectangle.south);
  const north = Cesium.Math.toDegrees(rectangle.north);
  const west = Cesium.Math.toDegrees(rectangle.west);
  const east = Cesium.Math.toDegrees(rectangle.east);
  if (![south, west, north, east].every(Number.isFinite)) return null;
  if (west >= east || south >= north) return null;
  const padLat = (north - south) * padFraction;
  const padLon = (east - west) * padFraction;
  return {
    south: Math.max(-90, south - padLat),
    north: Math.min(90, north + padLat),
    west: Math.max(-180, west - padLon),
    east: Math.min(180, east + padLon),
  };
}

/**
 * A view rectangle's two spans, in degrees. Infinite when the camera is past
 * the limb and Cesium can give no rectangle at all.
 */
export function supViewSpanDeg(viewer) {
  const rectangle = viewer?.camera?.computeViewRectangle?.();
  if (!rectangle) return { lat: Infinity, max: Infinity };
  const lat = Cesium.Math.toDegrees(rectangle.north - rectangle.south);
  const lon = Cesium.Math.toDegrees(rectangle.east - rectangle.west);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { lat: Infinity, max: Infinity };
  return { lat, max: Math.max(lat, lon) };
}

/** Whether one site falls inside a box (edges count). */
export function supSiteInBox(site, box) {
  if (!box) return false;
  return site.lat >= box.south && site.lat <= box.north
    && site.lon >= box.west && site.lon <= box.east;
}

/** Which regime the camera is in, with hysteresis at the boundary. */
function updateRegime(viewer) {
  const span = supViewSpanDeg(viewer);
  if (_regime === 'national') {
    if (span.lat < NATIONAL_EXIT_SPAN_DEG) _regime = 'sites';
  } else if (span.lat >= NATIONAL_ENTER_SPAN_DEG) {
    _regime = 'national';
  }
  return _regime;
}

function sitePosition(site) {
  const floor = cachedGroundFloor(site.lat, site.lon);
  const height = (Number.isFinite(floor) ? floor : 0) + POINT_LIFT_M;
  return Cesium.Cartesian3.fromDegrees(site.lon, site.lat, height);
}

/** French thousands separator, matching the rest of the French packs. */
function fr(value) {
  return Number(value).toLocaleString('fr-FR');
}

// --- Cards ------------------------------------------------------------------

/** The site's cycle mix, as a line, or null when it says nothing. */
function cycleLine(cycles) {
  const parts = [];
  for (const cycle of SUP_CYCLES) {
    const value = Number(cycles?.[cycle]) || 0;
    if (value > 0) parts.push(`${SUP_CYCLE_LABELS[cycle].split(' ')[0]} ${fr(value)}`);
  }
  return parts.length > 1 ? parts.join(' · ') : null;
}

/**
 * Card copy for one selected site. Every line is a published value or a stated
 * absence of one; nothing here is inferred.
 */
export function buildSupSelectionLabel(record) {
  const site = record?.site || {};
  const details = [];
  const title = site.name || site.commune || 'Établissement du supérieur';

  const kind = [site.category || supKindLabel(site.kind)];
  if (site.sector === 'public') kind.push('public');
  else if (site.sector === 'prive') kind.push('privé');
  details.push(kind.join(' · '));

  const rentree = record?.rentree ? ` — rentrée ${record.rentree}` : '';
  details.push(`${fr(site.students || 0)} étudiants sur ce site${rentree}`);

  const cycles = cycleLine(site.cycles);
  if (cycles) details.push(cycles);

  // A multi-site establishment is the register's unit showing through. Naming
  // both numbers is what stops eleven Sorbonne dots reading as eleven
  // universities — or as one university of 15 192 students.
  if (site.siteCount > 1) {
    details.push(`Site ${site.siteIndex} sur ${site.siteCount} — ${fr(site.etabStudents || 0)} étudiants au total`);
  }
  // Students the register counts for this establishment but cannot place. The
  // dots add up to less than the establishment does, and this is why.
  if (site.unsited > 0) {
    details.push(`${fr(site.unsited)} étudiants sans site localisé dans ce registre`);
  }

  if (site.composantes?.length) details.push(site.composantes.join(' · '));

  const where = [site.commune, site.deptName].filter(Boolean).join(', ');
  if (where) details.push(where);

  // A borrowed coordinate is a thing the map did, not a thing the register
  // said, and the card is the only place that can say so.
  if (site.placement === 'offer') details.push(`⚠ ${SUP_PLACEMENT_LABELS.offer}`);

  if (site.offer?.length) {
    const shown = site.offer.slice(0, CARD_OFFER_LIMIT).join(' · ');
    const rest = site.offer.length - CARD_OFFER_LIMIT;
    details.push(`Parcoursup : ${shown}${rest > 0 ? ` · +${rest} autres` : ''}`);
  }
  if (site.uai) details.push(`UAI ${site.uai}`);

  return [title, ...details].join('\n');
}

/**
 * Card copy for one département at national altitude.
 *
 * Both of the prism's channels are spelled out here in the unit they are drawn
 * in — the height's count and the hue's rate — and both absences are said out
 * loud rather than printed as a zero, because « pas publié » and « zéro » are
 * the two facts A1 exists to keep apart.
 */
export function buildSupDepartementLabel(row) {
  const details = [];
  const prism = supPrismRow(row);
  details.push(prism.hasValue
    ? `${fr(prism.students)} étudiants`
    : 'Effectif étudiant non publié pour ce département');
  details.push(`${fr(row.etabs)} établissements sur ${fr(row.sites)} sites`);
  details.push(prism.hasRatio
    ? `${prism.share.toFixed(1).replace('.', ',')} % des étudiants à bac+4 et au-delà — la couleur du prisme`
    : 'Part à bac+4 non calculable ici : aucun cycle renseigné');
  const cycles = cycleLine(row.cycles);
  if (cycles) details.push(cycles);
  const mix = [];
  if (row.public > 0) mix.push(`${fr(row.public)} sites publics`);
  if (row.prive > 0) mix.push(`${fr(row.prive)} privés`);
  if (mix.length) details.push(mix.join(' · '));
  // The prism's own blind spot, on the prism's own card: the height is an
  // absolute count on a base whose area is not neutralised, so the density is
  // the figure that answers "big because the territory is big?".
  if (row.per1000Km2 > 0) {
    details.push(`${fr(Math.round(row.per1000Km2))} étudiants pour 1 000 km² — la hauteur ne le corrige pas`);
  }
  return [row.name, ...details].join('\n');
}

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

/** Protected selected-site entry for the shared overlay host. */
export function createSupSelectedOverlayEntry(record) {
  const position = record?.position;
  if (!record?.id || !position) return null;
  return selectedOverlayEntry(record.id, position, buildSupSelectionLabel(record));
}

/**
 * Ambient label for one département at national altitude.
 *
 * The caller anchors it at the TOP of the prism, not on the ground: the top
 * edge is the reading instrument, and a label at the base would be occluded by
 * its own prism. The accent is the prism's own hue, so the label cannot claim
 * a class the volume does not have; a département whose rate is unpublished
 * gets the graphite the striped body uses, never a hue from the ladder.
 */
export function createSupDepartementOverlayEntry(row, position) {
  const prism = supPrismRow(row);
  return {
    id: `sup-fr:dep:${row.code}`,
    position,
    variant: 'label',
    title: prism.hasValue
      ? `${row.name} · ${fr(prism.students)}`
      : `${row.name} · non publié`,
    accent: prism.color || PRISM_NO_RATIO_COLOR,
    priority: Number(prism.students) || 0,
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 15,
    verticalOnly: true,
    placement: 'above',
  };
}

/** Keep the largest départements, with stable identity as tie-break. */
export function selectSupLabelCohort(entries, limit = SUP_FR_LABEL_COHORT_LIMIT) {
  const cap = Math.max(0, Math.min(SUP_FR_LABEL_COHORT_LIMIT, Math.floor(Number(limit) || 0)));
  if (!Array.isArray(entries) || cap === 0) return [];
  return entries.slice()
    .sort((a, b) => b.priority - a.priority || String(a.id).localeCompare(String(b.id)))
    .slice(0, cap);
}

// --- Selection --------------------------------------------------------------

function restoreRecordStyle(record) {
  if (!record?.point) return;
  record.point.color = Cesium.Color.fromCssColorString(record.baseColor);
  record.point.pixelSize = record.baseSize;
}

/**
 * Recolour the selected prism, height untouched.
 *
 * Selection is a QUALITATIVE state and it takes the one channel that carries
 * nothing thematic — the body's hue is overwritten, the outline goes to full
 * cyan, and `extrudedHeight` is not touched, so a selected département still
 * states its enrolment. Losing the rate for as long as the card is open is the
 * intended trade: the card prints it in figures right there.
 */
function highlightSelectedDepartement() {
  if (!_selectedId?.startsWith('dep:')) return;
  const highlight = new Cesium.ColorMaterialProperty(
    Cesium.Color.fromCssColorString(SELECTED_COLOR).withAlpha(0.42),
  );
  const cyan = Cesium.Color.fromCssColorString(SELECTED_COLOR);
  for (const entity of _depEntities.get(_selectedId.slice(4)) || []) {
    if (!entity.polygon) continue;
    entity.polygon.fill = true;
    entity.polygon.material = highlight;
    // A prism keeps its silhouette when selected; a flat footprint has none to
    // keep, because Cesium refuses an outline on a clamped polygon.
    if (entity.polygon.extrudedHeight !== undefined) {
      entity.polygon.outline = true;
      entity.polygon.outlineColor = cyan.withAlpha(PRISM_TOP_ALPHA);
    }
  }
}

function dropDepartementSelection() {
  if (_selectedId?.startsWith?.('dep:')) {
    _selectedId = null;
    _overlayHost.clearSource(SUP_FR_OVERLAY_SOURCE_ID);
  }
}

function clearSelection() {
  // The id is dropped BEFORE the repaint: `repaintDepartements` ends by
  // calling `highlightSelectedDepartement`, which would otherwise re-apply the
  // highlight to the entity being deselected and leave it cyan until the next
  // repaint — here the next poll, SIX HOURS later. Same ordering as
  // `schoolsFrance` and `irveFrance`.
  const departement = _selectedId?.startsWith?.('dep:') === true;
  const record = departement || !_selectedId ? null : _records.get(_selectedId);
  _selectedId = null;
  if (departement) repaintDepartements();
  else if (record) restoreRecordStyle(record);
  _overlayHost.clearSource(SUP_FR_OVERLAY_SOURCE_ID);
  governorRequestRender('sup-fr-deselect');
}

function selectSite(id) {
  const record = _records.get(id);
  if (!record) return;
  if (_selectedId && _selectedId !== id) clearSelection();
  _selectedId = id;
  if (record.point) {
    record.point.color = Cesium.Color.fromCssColorString(SELECTED_COLOR);
    record.point.pixelSize = SELECTED_POINT_PX;
  }
  const entry = createSupSelectedOverlayEntry(record);
  if (entry) {
    _overlayHost.setEntries(SUP_FR_OVERLAY_SOURCE_ID, [entry], SUP_FR_OVERLAY_SOURCE_OPTIONS);
  }
  governorRequestRender('sup-fr-select');
}

/**
 * Open the card for one département.
 *
 * Any département the rollup covers is selectable, INCLUDING one with no
 * published enrolment: the footprint is drawn for it (hatched, no prism), so a
 * reader who clicks it must get the sentence that says why it is flat rather
 * than silence, which would read as a broken map. The card's anchor rides at
 * the top of the prism for the same reason the ambient label does.
 */
function selectDepartement(code) {
  const row = (_national?.departements || []).find((entry) => entry.code === code);
  if (!row) return;
  if (_selectedId && _selectedId !== `dep:${code}`) clearSelection();
  _selectedId = `dep:${code}`;
  highlightSelectedDepartement();
  const anchor = _depMeta.get(code)?.anchor;
  if (anchor) {
    const entry = selectedOverlayEntry(
      `sup-fr:dep-card:${code}`,
      Cesium.Cartesian3.fromDegrees(anchor[0], anchor[1], supPrismRow(row).heightM || 0),
      buildSupDepartementLabel(row),
    );
    _overlayHost.setEntries(SUP_FR_OVERLAY_SOURCE_ID, [entry], SUP_FR_OVERLAY_SOURCE_OPTIONS);
  }
  governorRequestRender('sup-fr-select-dep');
}

function onKeyDown(event) {
  if (event.key === 'Escape' && _selectedId) clearSelection();
}

function pickedDepartementCode(picked) {
  const entity = picked?.id;
  if (!entity?.polygon) return null;
  const code = String(entity.properties?.code?.getValue?.() ?? '').trim();
  return code || null;
}

function installClickHandler(viewer) {
  if (_clickHandler) return;
  _clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  _clickHandler.setInputAction((movement) => {
    const picked = viewer.scene.pick(movement.position);
    const id = picked?.id;
    if (typeof id === 'string' && _records.has(id)) {
      selectSite(id);
      return;
    }
    if (_regime === 'national') {
      const code = pickedDepartementCode(picked);
      if (code && _depEntities.has(code)) {
        selectDepartement(code);
        return;
      }
    }
    if (_selectedId) clearSelection();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  document.addEventListener('keydown', onKeyDown);
}

/** Keep the selected card pinned to its dot as the camera moves. */
function onPreRender() {
  if (!_enabled || !_selectedId || _selectedId.startsWith('dep:')) return;
  const record = _records.get(_selectedId);
  if (!record) return;
  const entry = createSupSelectedOverlayEntry(record);
  if (entry) {
    _overlayHost.setEntries(SUP_FR_OVERLAY_SOURCE_ID, [entry], SUP_FR_OVERLAY_SOURCE_OPTIONS);
  }
}

// --- National regime --------------------------------------------------------

async function ensureDepartementShapes() {
  if (_depShapesPromise) return _depShapesPromise;
  _depShapesPromise = (async () => {
    const geojson = await (await fetch(DEPARTEMENTS_URL)).json();
    _depMeta = parseDepartements(geojson);
    // `clampToGround: false` on purpose, and it is the point of this pass: a
    // clamped polygon is a GroundPrimitive draped on the surface, and an
    // extruded one cannot be. Cesium then leaves `height` at 0 on 2D
    // coordinates — the common datum every prism is measured from — and the
    // repaint puts a flat footprint back on the ground where one is needed.
    const source = await Cesium.GeoJsonDataSource.load(geojson, {
      clampToGround: false,
      fill: Cesium.Color.TRANSPARENT,
      stroke: Cesium.Color.TRANSPARENT,
      strokeWidth: 0,
    });
    source.name = 'Enseignement supérieur — prismes départementaux';
    source.show = _enabled;
    for (const entity of source.entities.values) {
      const code = String(entity.properties?.code?.getValue?.() ?? '').trim();
      if (!entity.polygon || !code) {
        entity.show = false;
        continue;
      }
      entity.polygon.outline = false;
      // Whether this shape ends up a prism or a flat footprint is the
      // repaint's call, so neither `height` nor `classificationType` is
      // decided here — see paintDepartementPrism / paintDepartementFootprint.
      // `perPositionHeight` is the one that is never anything but false: the
      // outlines carry no z, and a base that follows the relief would move
      // every top with it.
      entity.polygon.perPositionHeight = false;
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
    // A failed shape load must be retryable, not a permanently poisoned
    // promise that leaves the national view silently empty for the session.
    _depShapesPromise = null;
    throw error;
  });
  return _depShapesPromise;
}

/**
 * The shared height blurb ends by promising that the COLOUR answers « rapporté
 * à quoi ? ». On the three sibling layers it does, because their hue is a
 * density. On this one it is not: the hue is the share at bac+4, which says
 * nothing about the base's area (see the module header for the measurement
 * that led there). A sentence that is false about the map in front of the
 * reader is worse than no sentence, so this layer withdraws the promise and
 * replaces it with what it can actually offer — the density, in figures, on
 * the card.
 *
 * Written as a cut-and-append rather than a rewrite: the clause is removed
 * when it is there, the correction is added either way, so the day
 * `choroplethPrism.js` rewords its blurb this degrades to a redundant sentence
 * instead of a stale copy of somebody else's text.
 *
 * @param {Array<object>} legend Entries from `prismLegend`, edited in place.
 */
function correctAerialClaim(legend) {
  const title = legend[0];
  if (!title?.blurb) return;
  // Both apostrophes, because the shared string uses the typewriter one today
  // and the repo's French prose uses the typographic one.
  const promise = Math.max(
    title.blurb.indexOf('— c’est la couleur'),
    title.blurb.indexOf("— c'est la couleur"),
  );
  const kept = promise > 0 ? `${title.blurb.slice(0, promise).trimEnd()}.` : title.blurb;
  title.blurb = `${kept} Sur cette couche la couleur ne corrige PAS ce biais : `
    + 'elle porte la part du bac+4 et non une densité. Le rapport surfacique est écrit '
    + 'en chiffres sur la fiche de chaque département (étudiants pour 1 000 km²).';
}

/**
 * How a flat footprint is classified onto whatever surface the map stack put
 * up. `BOTH` covers terrain AND the photorealistic mesh, which is why this
 * layer never needed a per-stack switch and still does not.
 *
 * It applies to the FLAT footprints only — a measured zero, and a département
 * with no published enrolment. Verified in the bundled Cesium:
 * `GroundGeometryUpdater._isOnTerrain` returns false as soon as
 * `extrudedHeight` is defined (`index.js:148334-148336`), so on a prism this
 * property is read into `_classificationTypeProperty` and then never used. It
 * is therefore CLEARED on the way up and re-asserted on the way back down,
 * rather than left set where it would lie to the next reader.
 */
const FLAT_CLASSIFICATION = Cesium.ClassificationType.BOTH;

/** Alpha of a flat footprint: no volume to see through, so it stays legible. */
const FLAT_FOOTPRINT_ALPHA = 0.55;

/**
 * The material of a prism body — a solid rate colour, or a MOTIF when there
 * is no rate.
 *
 * Cached by class, because these are six steps of one scale and not 96
 * colours; a repaint that minted a material per département would churn
 * Cesium's own material cache on every rollup.
 * @param {object} prism From {@link supPrismRow}.
 * @param {Map<string, object>} cache Per-repaint material cache.
 */
function prismBodyMaterial(prism, cache) {
  const key = prism.hasRatio ? `bin:${prism.bin}:${prism.extruded ? 'up' : 'flat'}` : 'no-ratio';
  const cached = cache.get(key);
  if (cached) return cached;
  const base = Cesium.Color.fromCssColorString(prism.color || PRISM_NO_RATIO_COLOR);
  const material = prism.hasRatio
    ? new Cesium.ColorMaterialProperty(
      base.withAlpha(prism.extruded ? PRISM_BODY_ALPHA : FLAT_FOOTPRINT_ALPHA),
    )
    // No rate: stripes, not a tint (D3). A motif cannot be mistaken for a step
    // of the ramp, and it survives the NVG and FLIR passes that destroy a hue.
    : new Cesium.StripeMaterialProperty({
      orientation: Cesium.StripeOrientation.VERTICAL,
      evenColor: base.withAlpha(PRISM_BODY_ALPHA),
      oddColor: base.withAlpha(0.1),
      repeat: NO_RATIO_STRIPE_REPEAT,
    });
  cache.set(key, material);
  return material;
}

/**
 * The grid a département with NO PUBLISHED ENROLMENT is drawn with (A1 + D3).
 *
 * A different motif from the stripes above, on purpose: stripes mean "height
 * measured, colour refused", the grid means "nothing measured at all". Two
 * refusals, two patterns, and the legend names both. Allocated once, because
 * it is one state and not one state per shape.
 */
let _unmeasuredMaterial = null;
function unmeasuredMaterial() {
  if (!_unmeasuredMaterial) {
    _unmeasuredMaterial = new Cesium.GridMaterialProperty({
      color: Cesium.Color.fromCssColorString(PRISM_NO_RATIO_COLOR).withAlpha(0.85),
      cellAlpha: 0.06,
      lineCount: new Cesium.Cartesian2(6, 6),
      lineThickness: new Cesium.Cartesian2(2, 2),
    });
  }
  return _unmeasuredMaterial;
}

/**
 * Draw one part of a département as a PRISM.
 *
 * The base is pinned to the ellipsoid ({@link PRISM_BASE_HEIGHT_M} = 0) and
 * never clamped to terrain: a base that follows the relief moves the TOP with
 * it, so Savoie would out-top the Landes by 2 km at equal enrolment. The whole
 * relief of France is 4.8 km against a 120 km ruler — the error would be 4 %
 * of the mark, systematically, and correlated with altitude.
 */
function paintDepartementPrism(entity, prism, material, edge) {
  entity.polygon.height = PRISM_BASE_HEIGHT_M;
  entity.polygon.extrudedHeight = prism.heightM;
  entity.polygon.perPositionHeight = false;
  // Read and silently ignored on an extruded polygon — see FLAT_CLASSIFICATION.
  entity.polygon.classificationType = undefined;
  entity.polygon.fill = true;
  entity.polygon.material = material;
  // Cesium force-disables `outline` on terrain with a one-time warning
  // (`index.js:61110-61113`). Off terrain it is legal, so the prism gets the
  // silhouette and the top edge that the reading depends on — the flat fill
  // could never have either.
  entity.polygon.outline = true;
  entity.polygon.outlineColor = edge;
  entity.show = true;
}

/**
 * Draw one part of a département as a FLAT footprint — the two cases with no
 * height to show.
 *
 * These go back ON THE GROUND, which is the whole reason `classificationType`
 * survives in this module: a footprint left at ellipsoid height would be
 * buried under 2 km of Alpine terrain, and an absence mark nobody can see is
 * not an absence mark. The price is the outline — Cesium refuses one on a
 * clamped polygon — so the two flat cases are told apart by their MATERIAL: a
 * solid fill for a measured zero, a grid for a département nobody measured.
 */
function paintDepartementFootprint(entity, material) {
  entity.polygon.extrudedHeight = undefined;
  entity.polygon.height = undefined;
  entity.polygon.perPositionHeight = false;
  entity.polygon.classificationType = FLAT_CLASSIFICATION;
  entity.polygon.outline = false;
  entity.polygon.fill = true;
  entity.polygon.material = material;
  entity.show = true;
}

/**
 * Raise every département: height = students, hue = the share at bac+4.
 *
 * Four states, four marks, and they are four rather than two because of A1 —
 * "we did not measure this" and "we measured this and it is zero" are
 * different facts, and so are "we have no rate for this" and "the rate is low":
 *
 *   count ✓ rate ✓ → prism at its height, body in its class colour.
 *   count ✓ rate ✗ → prism at its height, body STRIPED. The height is
 *                    measured, the colour is refused; the two are independent.
 *   count = 0      → flat footprint, solid fill. Zero is a measurement, and
 *                    hiding it would look like the sweep had missed the
 *                    département.
 *   count ✗        → flat footprint, GRID. Nothing was measured here.
 *
 * Every part of a MultiPolygon département gets the SAME height, because the
 * height is the département's value and not the part's.
 *
 * Idempotent, and it re-asserts a live selection at the end: a repaint resets
 * every material, so without that a camera nudge would drop the cyan highlight
 * while the card stayed on screen.
 */
function repaintDepartements() {
  if (!_national) return;
  const materials = new Map();
  const edges = new Map();
  const covered = new Set();
  for (const prism of supPrismRows(_national)) {
    const parts = _depEntities.get(prism.code);
    if (!parts) continue;
    covered.add(prism.code);
    const edgeKey = prism.hasRatio ? `bin:${prism.bin}` : 'no-ratio';
    if (!edges.has(edgeKey)) {
      edges.set(edgeKey, Cesium.Color
        .fromCssColorString(prism.color || PRISM_NO_RATIO_COLOR)
        .withAlpha(PRISM_TOP_ALPHA));
    }
    for (const entity of parts) {
      if (!entity.polygon) continue;
      if (prism.extruded) {
        paintDepartementPrism(entity, prism, prismBodyMaterial(prism, materials), edges.get(edgeKey));
      } else if (prism.hasValue) {
        paintDepartementFootprint(entity, prismBodyMaterial(prism, materials));
      } else {
        paintDepartementFootprint(entity, unmeasuredMaterial());
      }
    }
  }
  // A département the rollup does not mention at all — a payload that came
  // back short. It is not the bottom of the scale and it is not a zero: it is
  // the grid, and `getRowControls` counts it with the other unmeasured ones.
  for (const [code, parts] of _depEntities) {
    if (covered.has(code)) continue;
    for (const entity of parts) {
      if (!entity.polygon) continue;
      paintDepartementFootprint(entity, unmeasuredMaterial());
    }
  }
  highlightSelectedDepartement();
  _viewer?.scene?.requestRender?.();
}

function publishDepartementOverlay() {
  if (!_enabled || _regime !== 'national') {
    _overlayHost.clearSource(SUP_FR_LABEL_SOURCE_ID);
    return;
  }
  const entries = [];
  for (const row of _national?.departements || []) {
    const prism = supPrismRow(row);
    if (!prism.hasValue) continue;
    const anchor = _depMeta.get(row.code)?.anchor;
    if (!anchor) continue;
    entries.push(createSupDepartementOverlayEntry(
      row,
      // At the TOP of the prism: the label marks the edge that is read, and at
      // the base it would sit inside its own volume.
      Cesium.Cartesian3.fromDegrees(anchor[0], anchor[1], prism.heightM),
    ));
  }
  _overlayHost.setEntries(SUP_FR_LABEL_SOURCE_ID, selectSupLabelCohort(entries), {
    cohortLimit: SUP_FR_LABEL_COHORT_LIMIT,
    collisionCapacity: SUP_FR_LABEL_COLLISION_CAPACITY,
    moving: false,
  });
}

async function fetchJson(path, validate) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NATIONAL_TIMEOUT_MS);
  try {
    const response = await fetch(path, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (!validate(payload)) throw new Error('malformed payload');
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function ensureNational() {
  if (_national) return _national;
  if (_nationalPromise) return _nationalPromise;
  _nationalPromise = fetchJson('/api/sup-fr/departements', (p) => Array.isArray(p?.departements))
    .then((payload) => {
      _national = payload;
      _nationalError = null;
      return payload;
    })
    .catch((error) => {
      if (error?.name !== 'AbortError') {
        console.warn('[Data:Sup-FR] national rollup failed:', error?.message || error);
        _nationalError = error?.message || 'national rollup unavailable';
      }
      return null;
    })
    .finally(() => { _nationalPromise = null; });
  return _nationalPromise;
}

function hideDepartements() {
  for (const parts of _depEntities.values()) {
    for (const entity of parts) entity.show = false;
  }
  _overlayHost.clearSource(SUP_FR_LABEL_SOURCE_ID);
}

async function loadNational({ force = false } = {}) {
  _error = null;
  clearSites();
  if (force) {
    _national = null;
    _nationalPainted = false;
  }
  _loading = !_national;
  const generation = _requestGeneration;
  try {
    await ensureDepartementShapes();
  } catch (error) {
    console.warn('[Data:Sup-FR] département polygons failed:', error?.message || error);
    _error = 'département polygons unavailable';
    _status = 'error';
    _loading = false;
    return;
  }
  await ensureNational();
  if (generation !== _requestGeneration || !_enabled || _regime !== 'national') return;
  _loading = false;
  if (!_national) {
    _error = _nationalError || 'national rollup unavailable';
    _status = 'error';
    return;
  }
  _count = _national.painted || 0;
  _lastUpdate = Number(_national.fetchedAt) || Date.now();
  _status = _count > 0 ? 'ready' : 'empty';
  if (_nationalPainted) return;
  _nationalPainted = true;
  repaintDepartements();
  publishDepartementOverlay();
  governorRequestRender('sup-fr-national');
}

// --- Sites regime -----------------------------------------------------------

/**
 * The whole national register, fetched once.
 *
 * Deferred until the camera leaves the choropleth for the same reason
 * `schools-fr` defers its maillage: the national view is answered by a 30 KB
 * rollup, and an operator who never zooms in should not pay 0.62 MB for a pack
 * they will not see.
 */
async function ensurePack() {
  if (_pack) return _pack;
  if (_packPromise) return _packPromise;
  _packPromise = fetchJson('/api/sup-fr/sites', (p) => Array.isArray(p?.sites))
    .then((payload) => {
      _pack = payload;
      _packError = null;
      return payload;
    })
    .catch((error) => {
      if (error?.name !== 'AbortError') {
        console.warn('[Data:Sup-FR] national pack failed:', error?.message || error);
        _packError = error?.message || 'national register unavailable';
      }
      return null;
    })
    .finally(() => { _packPromise = null; });
  return _packPromise;
}

/**
 * Draw every site in the view, from the pack the client already holds.
 *
 * Re-run on every camera settle rather than cached: it is a linear scan over
 * 6 914 objects, which costs well under a millisecond, against a round trip
 * that would cost a few hundred.
 */
function reconcile(box) {
  clearSelection();
  _points.removeAll();
  _records.clear();

  const rentree = _pack?.rentree || null;
  const warm = [];
  let inView = 0;
  let students = 0;

  for (const site of _pack?.sites || []) {
    if (!Number.isFinite(site?.lat) || !Number.isFinite(site?.lon)) continue;
    if (!supSiteInBox(site, box)) continue;
    inView += 1;
    students += Number(site.students) || 0;
    if (_records.size >= MAX_RENDERED_SITES) continue;
    const id = site.id;
    if (!id || _records.has(id)) continue;
    const position = sitePosition(site);
    const color = supKindColor(site.kind);
    const size = supPointSize(site.students);
    const point = _points.add({
      id,
      position,
      color: Cesium.Color.fromCssColorString(color),
      pixelSize: size,
      outlineColor: OUTLINE_COLOR,
      outlineWidth: 1,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      translucencyByDistance: new Cesium.NearFarScalar(500, 1.0, 400_000, 0.4),
    });
    _records.set(id, { id, site, rentree, point, position, baseColor: color, baseSize: size });
    warm.push(site);
  }

  _inView = inView;
  _studentsInView = students;
  _count = _records.size;
  warmGroundFloor(warm.slice(0, GROUND_WARM_LIMIT));
  governorRequestRender('sup-fr-reconcile');
}

function clearSites() {
  if (_selectedId && !_selectedId.startsWith('dep:')) clearSelection();
  if (_points) _points.removeAll();
  _records.clear();
  _count = 0;
  _inView = 0;
  _studentsInView = 0;
}

async function loadSites(box, { force = false } = {}) {
  hideDepartements();
  _nationalPainted = false;
  dropDepartementSelection();
  _error = null;
  if (force) _pack = null;
  _loading = !_pack;
  const generation = ++_requestGeneration;
  await ensurePack();
  if (generation !== _requestGeneration || !_enabled || _regime !== 'sites') return;
  _loading = false;
  if (!_pack) {
    _error = _packError || 'national register unavailable';
    _status = 'error';
    return;
  }
  reconcile(box);
  _lastUpdate = Number(_pack.fetchedAt) || Date.now();
  _status = _count > 0 ? 'ready' : 'empty';
}

async function loadViewport({ force = false } = {}) {
  if (!_enabled || !_viewer) return;
  const regime = updateRegime(_viewer);
  const box = regime === 'national' ? null : cameraSupBox(_viewer);
  // A camera that is inside the sites regime but gives no usable rectangle —
  // an oblique horizon shot, or a view crossing the dateline — has nothing to
  // filter the pack against. The choropleth is the honest fallback, not an
  // empty map captioned "aucun établissement dans cette vue".
  if (regime === 'national' || !box) {
    _regime = 'national';
    await loadNational({ force });
    return;
  }
  await loadSites(box, { force });
}

function onCameraChanged() {
  clearTimeout(_cameraDebounceTimer);
  _cameraDebounceTimer = setTimeout(() => {
    void loadViewport();
  }, CAMERA_DEBOUNCE_MS);
}

function collectDetectableObjects(options = {}) {
  if (!_enabled || !_points?.show || !_records.size) return [];
  const records = [];
  for (const record of _records.values()) {
    if (!record.point?.show && record.id !== _selectedId) continue;
    records.push(record);
  }
  if (!records.length) return [];

  const maxCount = Number.isFinite(options.maxCount)
    ? Math.max(1, Math.floor(options.maxCount))
    : records.length;
  const seed = Number.isFinite(options.seed) ? Math.floor(options.seed) : 0;
  const stride = Math.max(1, Math.ceil(records.length / maxCount));
  const start = ((seed % stride) + stride) % stride;

  const result = [];
  for (let i = start; i < records.length; i += stride) {
    const record = records[i];
    const students = Number(record.site?.students) || 0;
    result.push({
      position: record.position,
      sourceId: record.id,
      id: students > 0 ? `${students} étudiants` : supKindLabel(record.site?.kind),
      type: 'Campus',
      skipLabel: record.id === _selectedId,
    });
    if (result.length >= maxCount) break;
  }
  return result;
}

/** One line under the layer's toggle: what this view actually contains. */
export function buildSupLoadingLabel({
  regime = _regime,
  status = _status,
  loading = _loading,
  count = _count,
  inView = _inView,
  students = _studentsInView,
  national = _national,
} = {}) {
  if (regime === 'national') {
    if (loading) return 'lecture du registre national...';
    if (status === 'error') return '';
    if (!national) return '';
    const parts = [`${fr(national.studentsAssigned)} étudiants sur ${fr(national.painted)} départements`];
    // The prism's own blind spot, stated where the prism is read.
    if (national.unassigned > 0) {
      parts.push(`${fr(national.unassigned)} sites hors métropole non cartographiés`);
    }
    return parts.join(' · ');
  }
  if (loading) return 'lecture du registre national...';
  if (status === 'error') return '';
  if (!inView) return 'aucun établissement du supérieur dans cette vue';
  const parts = [`${fr(count)} sites`];
  if (students > 0) parts.push(`${fr(students)} étudiants`);
  // The cap is above the whole register, so this can only fire on a malformed
  // pack — and if it ever does, it says so rather than drawing a short map.
  if (inView > count) parts.push(`${fr(inView - count)} non tracés`);
  return parts.join(' · ');
}

// --- Layer ------------------------------------------------------------------

const supFranceLayer = {
  id: SUP_FR_LAYER_ID,
  name: 'Enseignement supérieur (FR)',
  // NOT the 🎓 `schools-fr` uses. The two rows sit next to each other in the
  // same taxonomy group and share 2 800 addresses; giving them the same glyph
  // would make the panel the one place a reader cannot tell them apart.
  icon: '🏛',
  source: 'Effectifs d’étudiants inscrits — MESR',
  updateInterval: POLL_INTERVAL_MS,

  init(viewer) {
    _viewer = viewer;
    _points = new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT });
    _points.show = false;
    viewer.scene.primitives.add(_points);
    registerSpriteCollection(SUP_FR_LAYER_ID, _points);

    _enabled = false;
    _records = new Map();
    _selectedId = null;
    _count = 0;
    _inView = 0;
    _studentsInView = 0;
    _lastUpdate = null;
    _loading = false;
    _error = null;
    _status = 'idle';
    _regime = 'national';
    _nationalPainted = false;

    _overlayHost.setVisible(SUP_FR_OVERLAY_SOURCE_ID, false);
    _overlayHost.setVisible(SUP_FR_LABEL_SOURCE_ID, false);
    restoreSpriteOrder(viewer);
  },

  enable(viewer) {
    _enabled = true;
    _error = null;
    _points.show = true;
    if (_depDataSource) _depDataSource.show = true;
    _overlayHost.setVisible(SUP_FR_OVERLAY_SOURCE_ID, true);
    _overlayHost.setVisible(SUP_FR_LABEL_SOURCE_ID, true);
    installClickHandler(viewer);
    registerPickOwner(SUP_FR_LAYER_ID, (pickedId) => _records.has(pickedId));

    if (!_cameraChangedAttached) {
      viewer.camera.changed.addEventListener(onCameraChanged);
      viewer.camera.percentageChanged = Math.min(viewer.camera.percentageChanged || 1, 0.05);
      _cameraChangedAttached = true;
    }
    if (!_preRenderRemover) {
      _preRenderRemover = viewer.scene.preRender.addEventListener(onPreRender);
    }
    void loadViewport({ force: true });
    restoreSpriteOrder(viewer);
  },

  disable(viewer) {
    _enabled = false;
    _requestGeneration += 1;
    _regime = 'national';
    _nationalPainted = false;
    clearTimeout(_cameraDebounceTimer);
    _cameraDebounceTimer = null;

    clearSelection();
    clearSites();
    hideDepartements();
    if (_depDataSource) _depDataSource.show = false;
    _overlayHost.setVisible(SUP_FR_OVERLAY_SOURCE_ID, false);
    _overlayHost.setVisible(SUP_FR_LABEL_SOURCE_ID, false);

    if (_clickHandler) {
      _clickHandler.destroy();
      _clickHandler = null;
    }
    document.removeEventListener('keydown', onKeyDown);
    unregisterPickOwner(SUP_FR_LAYER_ID);

    if (_cameraChangedAttached) {
      viewer.camera.changed.removeEventListener(onCameraChanged);
      _cameraChangedAttached = false;
    }
    if (_preRenderRemover) {
      _preRenderRemover();
      _preRenderRemover = null;
    }

    _points.show = false;
    _loading = false;
    _status = 'idle';
  },

  async update() {
    if (!_enabled) return;
    await loadViewport({ force: true });
  },

  getDetectableObjects(options = {}) {
    return collectDetectableObjects(options);
  },

  getStats() {
    const stats = {
      count: _count,
      lastUpdate: _lastUpdate,
      loading: _loading,
      status: _status === 'ready' ? 'ok' : _status,
    };
    const label = buildSupLoadingLabel();
    if (label) stats.loadingLabel = label;
    if (_regime === 'national' ? _national?.stale : _pack?.stale) stats.stale = true;
    if (_error) stats.error = _error;
    return stats;
  },

  /** Register provenance for the attribution popover and analyst surfaces. */
  getViewportSummary() {
    if (!_pack) return null;
    const { sites, ...summary } = _pack;
    return { ...summary, inView: _inView, drawn: _count, studentsInView: _studentsInView };
  },

  /** National rollup, for the analyst and for tests. */
  getNationalSummary() {
    if (!_national) return null;
    const { departements, ...rest } = _national;
    return { ...rest, regime: _regime };
  },

  /**
   * Colour legend for the control-panel row AND for the on-map block —
   * whichever scale is actually on screen, never both.
   *
   * The national regime hands over the shared prism legend: the height ruler
   * first (three ticks whose swatch is a BAR of the right height, all in one
   * constant colour so the swatch's colour cannot read as a second encoding),
   * then the rate ladder. D1 is the reason this exists at all — a height that
   * is not published in figures is a shape, not a measurement.
   *
   * `surfaceFill` is declared only while a FLAT footprint is on screen: those
   * are the only marks left that classify onto the surface, and the shared
   * "your fill is climbing the buildings" notice would be false about a prism.
   */
  getRowControls() {
    if (_regime === 'national') {
      if (!_national) return { chips: [], legend: [] };
      // Through `supPrismRow`, so the tally sees exactly what the map drew —
      // including the recomputed rate a stale cached rollup does not publish.
      const rows = supPrismRows(_national).map((row) => ({
        code: String(row.code), value: row.students, ratio: row.share,
      }));
      // A polygon the payload never mentioned is drawn as a grid, so it has to
      // be counted with the other unmeasured ones — otherwise the legend's
      // totals would quietly stop adding up to the map.
      const covered = new Set(rows.map((row) => row.code));
      for (const code of _depEntities.keys()) {
        if (!covered.has(code)) rows.push({ code });
      }
      const tally = prismTally(rows, SUP_PRISM_SCALE);
      const legend = prismLegend(SUP_PRISM_SCALE, tally);
      correctAerialClaim(legend);
      legend.push({
        label: 'départements couverts',
        color: null,
        count: rows.length,
        blurb: 'Un prisme par PARTIE dessinée : la Corse en lève deux, à la même hauteur, '
          + 'parce que la hauteur est celle du département et non celle de la partie. '
          + 'Deux prismes voisins ne s’additionnent jamais.',
      });
      // A5, on the map rather than only under the toggle: the shortfall this
      // rollup cannot draw at all, because no metropolitan polygon can hold it.
      if (_national.unassigned > 0) {
        legend.push({
          label: 'hors métropole — aucun prisme',
          color: null,
          glyph: PRISM_NO_RATIO_GLYPH,
          count: _national.unassigned,
          blurb: `${fr(_national.students - _national.studentsAssigned)} étudiants sur `
            + `${fr(_national.students)} sont sur des sites que les 96 polygones métropolitains `
            + 'ne peuvent pas contenir (La Réunion, Antilles, Guyane, Mayotte, Polynésie). '
            + 'Ils sont comptés et jamais déplacés : le prisme le plus proche est à 7 000 km.',
        });
      }
      // The drape notice is true only for the FLAT marks: a prism classifies
      // nothing, so claiming the fill climbs the façades would be false for
      // every département that has a height (see surfaceFillNotice.js).
      const flat = (tally.zero || 0) + (tally.noValue || 0);
      return { chips: [], legend, surfaceFill: flat > 0 };
    }
    const tally = new Map();
    for (const record of _records.values()) {
      const kind = record.site?.kind;
      if (kind) tally.set(kind, (tally.get(kind) || 0) + 1);
    }
    const legend = SUP_KINDS
      .filter((kind) => tally.get(kind) > 0)
      .map((kind) => ({
        label: supKindLabel(kind),
        color: supKindColor(kind),
        count: tally.get(kind),
        blurb: KIND_BLURBS[kind],
      }));
    return { chips: [], legend };
  },

  destroy(viewer) {
    if (_enabled) this.disable(viewer);
    else {
      clearSelection();
      _overlayHost.setVisible(SUP_FR_OVERLAY_SOURCE_ID, false);
      _overlayHost.setVisible(SUP_FR_LABEL_SOURCE_ID, false);
      if (_clickHandler) {
        _clickHandler.destroy();
        _clickHandler = null;
      }
      document.removeEventListener('keydown', onKeyDown);
      unregisterPickOwner(SUP_FR_LAYER_ID);
    }
    if (_preRenderRemover) {
      _preRenderRemover();
      _preRenderRemover = null;
    }
    if (_depDataSource) {
      viewer.dataSources?.remove?.(_depDataSource, true);
      _depDataSource = null;
    }
    _depEntities.clear();
    _depMeta = new Map();
    _depShapesPromise = null;
    if (_points) {
      unregisterSpriteCollection(SUP_FR_LAYER_ID, _points);
      viewer.scene.primitives.remove(_points);
      _points = null;
    }
    _records.clear();
    _viewer = null;
  },
};

/** Seed rendered records so selection/card/legend paths run without WebGL. */
export function _setSupStateForTest({
  viewer, records, overlayHost, status, count, regime, national, depEntities, depMeta,
  pack, inView, studentsInView,
} = {}) {
  _viewer = viewer || null;
  _records = new Map((records || []).map((record) => [record.id, record]));
  _selectedId = null;
  _overlayHost = overlayHost || DEFAULT_OVERLAY_HOST;
  _status = status || 'ready';
  _count = Number.isFinite(count) ? count : _records.size;
  _inView = Number.isFinite(inView) ? inView : _count;
  _studentsInView = Number.isFinite(studentsInView) ? studentsInView : 0;
  _loading = false;
  _regime = regime || 'sites';
  _national = national || null;
  _pack = pack || null;
  _depEntities = new Map(depEntities || []);
  _depMeta = new Map(depMeta || []);
  _enabled = true;
}

/** Exercise the production selection path in focused runtime tests. */
export function _selectSupForTest(id) {
  selectSite(id);
}

/** Exercise the production département selection path. */
export function _selectSupDepartementForTest(code) {
  selectDepartement(code);
}

/**
 * Raise the prisms through the production path, on whatever stand-in entities
 * the test seeded. This is the one function that turns a rollup row into
 * geometry, so it is the one a test has to be able to run without a viewer.
 */
export function _repaintSupDepartementsForTest() {
  repaintDepartements();
}

/** Exercise the production clear path and restore the production host seam. */
export function _clearSupSelectionForTest() {
  clearSelection();
  _overlayHost = DEFAULT_OVERLAY_HOST;
  _national = null;
  _nationalPainted = false;
  _pack = null;
  _depEntities = new Map();
  _depMeta = new Map();
  _regime = 'sites';
  _enabled = false;
}

/** Row-control legend, for tests that do not construct a viewer. */
export function _supRowControlsForTest() {
  return supFranceLayer.getRowControls();
}

/** Ambient département label cohort, for tests that do not construct a viewer. */
export function _supDepartementOverlayForTest() {
  const entries = [];
  for (const row of _national?.departements || []) {
    const prism = supPrismRow(row);
    if (!prism.hasValue) continue;
    const anchor = _depMeta.get(row.code)?.anchor;
    if (!anchor) continue;
    entries.push(createSupDepartementOverlayEntry(row, { anchor, heightM: prism.heightM }));
  }
  return selectSupLabelCohort(entries);
}

export default supFranceLayer;
