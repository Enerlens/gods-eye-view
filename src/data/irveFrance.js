/**
 * @module irveFrance
 *
 * France's public EV charging register — the *fichier consolidé des bornes de
 * recharge pour véhicules électriques*, assembled daily by
 * transport.data.gouv.fr from the operators' own IRVE filings and republished
 * on ODRÉ under Licence Ouverte 2.0. Keyless. 231 079 points de charge,
 * measured 2026-08-27.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT. This is INSTALLED CAPACITY, not
 * availability. Nothing in the file says whether a charge point is free right
 * now, working, or occupied — that lives in each operator's own OCPI endpoint,
 * behind a contract. So this layer never draws an availability colour and
 * never prints a "libre" count, which is the single easiest way to make an EV
 * map lie. It draws what is installed, and the card says when the operator
 * last said so.
 *
 * ── Three regimes, because 40 000 sites is not a national picture ───────────
 * 231 079 charge points sit on 39 579 distinct coordinates. Drawn as dots at
 * national altitude that is a solid smear over France that says nothing; drawn
 * only when you are over a city, the country-scale question cannot be asked at
 * all. So the layer answers at the scale you are looking at:
 *
 *   whole country in view — **96 PRISMS**: each département polygon extruded
 *       (span ≥ 9.5°)       to the number of charge points it holds and
 *                           coloured by its density, with the leaders
 *                           labelled. 18 KB, no clutter.
 *   part of the country   — **the maillage**: real site positions, thinned by
 *       (9° … 0.35°)        a geographic grid so every occupied cell keeps its
 *                           largest site before any cell gets a second dot.
 *                           1 100–2 200 dots, densifying as you close in.
 *   one city              — **every site**, with its operators, connectors,
 *       (below ~45 km)      access conditions and freshness.
 *
 * The three never draw at once and each has its own legend, so a colour can
 * never be read against the wrong scale. The national regime draws the bundled
 * IGN département polygons that `meteoFranceVigilance.js` and `franceEnergy.js`
 * also paint — but EXTRUDED rather than clamped, which is a different Cesium
 * object with different rules, and the section below is that argument. The
 * maillage's thinning is `cctvLod.js`'s ambient-ring distribution transposed
 * from screen space to geographic space (see `irveMesh.js`).
 *
 * ── The national regime is a prism, and each channel says one thing ─────────
 *
 * HEIGHT is the number of charge points. COLOUR is the density per 1 000 km².
 * The shared grammar, its calibration and the arbitrations that produced it
 * live once in `choroplethPrism.js`; what follows is what is specific to this
 * layer, measured on this layer's own data.
 *
 * WHAT THIS REPLACES, AND WHY THE OLD ARGUMENT WAS WRONG. Until now the fill
 * was the ABSOLUTE COUNT in six quantile bins, and `irveDepartements.js`
 * argued for it at length: the density spans a factor of 2 254 (43.7 charge
 * points per 1 000 km² in Lozère against 98 509.6 in Paris, re-measured
 * 2026-09-03), so painting it "leaves 95 départements indistinguishable". The
 * measurement is right, the inference is not, twice over.
 *
 *   · Ninety-five-indistinguishable is a property of an EQUAL-INTERVAL ramp.
 *     Six equal steps of 16 411 over that range give an occupancy of
 *     94 · 1 · 0 · 0 · 0 · 1. The GEOMETRIC ladder below, over the same
 *     numbers, gives 11 · 27 · 28 · 19 · 7 · 4 — every class inhabited, and
 *     the top one holding exactly the four inner-Paris départements.
 *   · An absolute count was never allowed on a fill at all (CARTOGRAPHIE B1).
 *     The alternative the old header weighed — count fill against rate fill —
 *     had one channel and two candidates. A globe has two channels.
 *
 * THE HEIGHT DOMAIN IS FROZEN AT 12 000 CHARGE POINTS, and it is a literal,
 * never a maximum recomputed from the payload (C1). Measured highs: 10 539
 * (Paris, 2026-08-27) and 10 245 (Paris, 2026-09-03) — the register moves in
 * both directions, since the national total fell from 231 079 to 227 007 over
 * the same week. 12 000 leaves ~15 % of headroom above the highest figure ever
 * measured, so the top of the scale is not permanently clipped by the ordinary
 * growth of the network, and it puts the 10 000 legend tick at 100 km, which
 * is a ruler mark a reader can hold Paris against. A département above 12 000
 * would be drawn at the top and DECLARED as clipped by the legend (A5).
 *
 * THE HEIGHT SCALE IS LINEAR, and that is a decision against the one hint
 * `choroplethPrism.js` gives this layer: it names `irve-fr` as a `'sqrt'`
 * candidate because the domain runs 1 : 45 and the 4 km floor eats everything
 * under 3.3 % of the domain. Measured rather than assumed, the floor bites at
 * 400 charge points, and THREE départements of 96 are under it — Cantal (373),
 * Creuse (347), Lozère (226). Three floored units is not "the floor doing all
 * the work"; it is the A1 floor doing its job on the three smallest networks
 * in France. Against that, `'sqrt'` would draw Paris as 2.4× the median when
 * it is 5.5×, on the one channel the eye reads best. Linear stands, and the
 * cost is written into the legend rather than hidden.
 *
 * At national altitude (~1 500 km, the camera distance at which the 9.5° entry
 * span is reached) the scale reads: Paris 102.5 km = 98.6 px, Nord 78.0 km =
 * 75.1 px, the median département 18.5 km = 17.8 px, Lozère on the floor at
 * 4 km = 3.9 px. Median-to-top spread is 80.8 px, twice the 40 px under which
 * `choroplethPrism.js` says the map has become a flat fill again.
 *
 * THE COLOUR LADDER IS GEOMETRIC AND FROZEN: 100 / 250 / 500 / 1 000 / 2 500
 * charge points per 1 000 km², i.e. steps of ×2.5, ×2, ×2, ×2.5, which is what
 * a 2 254 : 1 range needs. Six classes, because CARTOGRAPHIE B3 puts the
 * perceptible ceiling at six to seven AFTER compositing, and the geometric
 * ladder is preferred to quantiles for the C1 reason: quantiles are a property
 * of the sample and would have to be recomputed — the same département would
 * change class because a sweep lost a stripe, with no change in the world.
 *
 * WHAT THE PRISM REMOVES FOR FREE. An extruded polygon is not a
 * `GroundPrimitive`, so two defects this repo has already paid for stop
 * applying: the batched ground fill that colours each instance by its bounding
 * RECTANGLE instead of its polygon, and the F4 drape that
 * `surfaceFillNotice.js` exists to declare — a thematic tint climbing the
 * façades of the photorealistic mesh, where the tileset's own shading changes
 * the colour a reader decodes. This layer therefore does NOT raise
 * `surfaceFill` in its row controls: every département that carries a count is
 * a prism, and in the register as measured on 2026-09-03 that is all 96 of
 * them. The exception is the flat footprints below, which stay clamped
 * precisely so that they still land on whatever surface is up.
 *
 * WHAT THE PAIRING BUYS, in this layer's own terms. The prism keeps the areal
 * bias every choropleth has — a big rural département makes a big volume at
 * equal count — but the colour is the audit of the height: Gironde reads TALL
 * (7 455 points, 74.6 km) and PALE (739.8 per 1 000 km², class 4 of 6), Paris
 * reads TALL (10 245, 102.5 km) and SATURATED (98 509.6, top class), and the
 * difference between "a lot, spread thin" and "a lot, packed" is finally on
 * the map instead of only on the card.
 *
 * FOUR STATES, FOUR MARKS, because the two measurements are refused
 * independently and A1 forbids one sign for two facts (see
 * `repaintDepartements` for the code and `prismRow` for the contract):
 *
 *   count ✓ density ✓ → a prism at its height, body in its density colour
 *   count ✓ density ✗ → a prism at its height, body STRIPED — the height is
 *                       measured, the colour is refused, and the two absences
 *                       do not contaminate each other
 *   count = 0         → a FLAT footprint, filled: "the register lists nothing
 *                       here" is a measurement, and it is drawn, not hidden
 *   count ✗           → a flat footprint in a GRID, because D3 wants a motif
 *                       and not a tint where there is no neutral colour
 *
 * The last two are the only shapes still clamped to the ground, which is why
 * `classificationType` still matters for them and is re-armed on every repaint
 * — and why they cannot be outlined, since Cesium refuses an outline on
 * terrain. They are told apart by their material instead. The legend counts
 * each of them separately.
 *
 * A thinned map that does not say it is thinned is a map claiming France has
 * 1 100 charge points, so the middle regime always prints how many sites it
 * drew against how many are in view.
 *
 * WHAT IS DRAWN PER DOT. One dot per SITE — per coordinate, not per station.
 * That is forced by the data rather than chosen: Q-Park's Grande Arche car
 * park publishes 127 distinct `id_station_itinerance` values at one point, one
 * per charge point, and 1 192 rows nationally publish the literal string
 * `"Non concerné"` as their station id.
 *
 * WHAT IS NOT DOUBLE-COUNTED. Measured over Île-de-France, 442 of 3 812 sites
 * carry two "operators" publishing an identical power profile at the same
 * point — TotalEnergies Charging Services beside TotalEnergies Marketing
 * France, ENGIE Vianeo beside its Greenflux back end — worth 7.5% of the
 * area's charge points. Those collapse to one, in `irveFeed.js`, and the card
 * names what was collapsed. Merely overlapping publications never collapse.
 *
 * Every other trap this dataset carries — coordinates labelled backwards,
 * watts in a kilowatt column, eight spellings of a boolean, mojibake, and a
 * verification flag that is False for two quite different reasons — is
 * absorbed server-side in `irveFeed.js` and `irveDepartements.js`, and pinned
 * there against captured payloads. This module is presentation.
 */
import * as Cesium from 'cesium';
import {
  PRISM_BASE_HEIGHT_M,
  PRISM_BODY_ALPHA,
  PRISM_NO_RATIO_COLOR,
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
import { horizonOccluder } from './iconOrientation.js';
import { parseDepartements } from './meteoFranceVigilance.js';
import {
  clearOverlaySource,
  hitTestWorldOverlay,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { pickOverlayLabelId } from './overlayLabelPick.js';
import {
  IRVE_BAND_KEYS,
  IRVE_BAND_LABELS,
  IRVE_CONNECTOR_LABELS,
  IRVE_MAX_BOX_DEG,
} from './irveFeed.js';
import {
  meshSiteId,
  selectIrveMesh,
  MESH_BAND,
  MESH_LAT,
  MESH_LON,
  MESH_PDC,
} from './irveMesh.js';

/** Layer id — also the share-link registry key and the voice-tool enum value. */
export const IRVE_FR_LAYER_ID = 'irve-fr';
/** Protected selected-object card source on the shared world-overlay host. */
export const IRVE_FR_OVERLAY_SOURCE_ID = 'irve-fr-selected';
export const IRVE_FR_OVERLAY_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 0,
  moving: false,
});
/** Ambient département labels at national altitude. */
export const IRVE_FR_LABEL_SOURCE_ID = 'irve-fr-departements';
/** Ambient-label entry-id prefix — the click surface the département NAME provides. */
export const IRVE_FR_DEP_LABEL_PREFIX = 'irve-fr:dep:';
/**
 * Bounded label cohort. There are 96 départements and no reading of the map
 * wants 96 labels — this names the leaders and lets the fill carry the rest.
 */
export const IRVE_FR_LABEL_COHORT_LIMIT = 14;
export const IRVE_FR_LABEL_COLLISION_CAPACITY = 12;

const DEPARTEMENTS_URL = new URL(
  './local_data/france_departements/departements.geojson',
  import.meta.url,
).href;

// --- Activation / load gating ----------------------------------------------
/**
 * Altitude (m) below which the layer draws individual sites. A charge point is
 * a street-scale object, and the proxy refuses a box wider than 0.35° anyway —
 * above this the request would stop being a viewport query and every dot would
 * be a speck. Above it, the national choropleth answers instead.
 */
const SITE_ALTITUDE_M = 45_000;
const SITE_ENTER_ALTITUDE_M = SITE_ALTITUDE_M - 3_000;
const SITE_EXIT_ALTITUDE_M = SITE_ALTITUDE_M + 3_000;
/**
 * View LATITUDE span (degrees) at or above which the choropleth answers.
 *
 * Metropolitan France is 9.8° tall, so a view this wide vertically is one
 * that still holds the whole territory — exactly the condition under which a
 * per-département fill is the right answer and individual positions are not.
 * Below it the country is already cropped, and the question turns from "which
 * parts of France" into "where, actually". Measured on the app's own camera:
 * 9.53° at 1 400 km, 6.72° at 1 000 km.
 *
 * Latitude rather than the larger of the two spans, because on a 16:10
 * viewport the longitude span is ~2.4× the latitude one and is therefore
 * mostly a statement about the window's shape (24.42° against 9.53° at
 * 1 400 km). Using it would keep the choropleth up long after France had been
 * cropped top and bottom.
 *
 * The exit threshold is lower than the entry one on purpose: without the gap
 * a camera resting near the boundary would swap the entire map back and forth
 * on sub-pixel drift.
 */
const NATIONAL_ENTER_SPAN_DEG = 9.5;
const NATIONAL_EXIT_SPAN_DEG = 8;
/** Debounce (ms) on camera-driven viewport reloads. */
const CAMERA_DEBOUNCE_MS = 450;
/**
 * Poll cadence (ms). Long on purpose: the consolidation runs once a day, so
 * anything faster re-asks a question whose answer cannot have changed. The
 * camera, not the clock, is what actually drives this layer.
 */
const POLL_INTERVAL_MS = 30 * 60_000;
const REQUEST_TIMEOUT_MS = 45_000;
/** The national sweep is a bigger job than one viewport; it gets its own budget. */
const NATIONAL_TIMEOUT_MS = 120_000;
/** Hard cap on rendered sites, independent of what the proxy or the mesh returns. */
const MAX_RENDERED_SITES = 4_000;
/** Metres above the resolved ground floor a dot sits. */
const POINT_LIFT_M = 2.5;
/** Sites whose ground floor is resolved eagerly after a reconcile. */
const GROUND_WARM_LIMIT = 600;

// --- Presentation -----------------------------------------------------------
/**
 * Power ramp, cold to hot. Read as a RAMP rather than as categories — the
 * whole point of the colour is that 300 kW and 7 kW are the same kind of thing
 * at different magnitudes, so the eye should sort them without the legend.
 *
 * `inconnue` is deliberately outside the ramp, in neutral slate: a site whose
 * published power is 7 360 in a kilowatt column has not told us how fast it
 * charges, and guessing a rung would be worse than admitting that.
 */
const BAND_COLORS = Object.freeze({
  lente: '#4c6ef5',
  normale: '#22b8cf',
  accelere: '#94d82d',
  rapide: '#fab005',
  hpc: '#fa5252',
  inconnue: '#7c8899',
});
/**
 * Density ramp, low to high — a violet-to-pink sequential scale.
 *
 * Deliberately a family that appears nowhere else on this globe: not the power
 * ramp above (which means a *kind* of charging, not an amount), not Mix élec's
 * teal/amber balance, not Vigilance's green→red. The two IRVE regimes never
 * draw at the same time, but a reader who zooms out must not carry a
 * category's meaning into a quantity's.
 *
 * Lightness ASCENDS with the value, which is both Bertin's ordering rule and
 * the right choice for the mark this now colours: a prism is seen against the
 * sky as often as against the ground, and the dense end has to be the salient
 * one on either backdrop.
 *
 * Six colours because the ladder has six classes — see {@link IRVE_DENSITY_BREAKS}.
 */
const DEPARTEMENT_COLORS = Object.freeze([
  '#2f1b52', '#4d2a86', '#7239b4', '#9b4fd0', '#c774e0', '#eba9ef',
]);
/**
 * Frozen class boundaries for the DENSITY, in charge points per 1 000 km².
 *
 * Geometric — ×2.5, ×2, ×2, ×2.5 — because the variable spans 2 254 : 1
 * (43.7 in Lozère, 98 509.6 in Paris, measured 2026-09-03 over the whole
 * register). Measured occupancy of the 96 départements on this ladder:
 * 11 · 27 · 28 · 19 · 7 · 4, against 94 · 1 · 0 · 0 · 0 · 1 for six equal
 * intervals over the same range. That single comparison is the whole reason
 * the density is drawable at all, and it is why the header of
 * `irveDepartements.js` had to be rewritten rather than merely amended.
 *
 * A LITERAL, not a quantile of the payload (C1): a class boundary derived from
 * the rows in hand moves when a sweep loses a stripe, and a département that
 * changes colour without changing is the defect the frozen ladder removes.
 * Re-measuring it is an edit to this line, made once, with the date attached.
 */
export const IRVE_DENSITY_BREAKS = Object.freeze([100, 250, 500, 1000, 2500]);
/**
 * Top of the frozen HEIGHT domain, in charge points. See the header for the
 * derivation: 15 % of headroom over the highest département ever measured
 * (10 539, Paris, 2026-08-27), and a 10 000 legend tick that lands on 100 km.
 */
export const IRVE_PRISM_DOMAIN_MAX = 12_000;
/**
 * The layer's frozen prism scale — height in charge points, colour in charge
 * points per 1 000 km². Built once at module load, so a bad literal throws
 * where an author sees it rather than where a reader does.
 *
 * `mode: 'linear'` is deliberate and is argued in the header against
 * `choroplethPrism.js`'s own hint: the floor bites at 400 charge points and
 * only three départements of 96 are under it.
 */
export const IRVE_PRISM_SCALE = createPrismScale({
  id: IRVE_FR_LAYER_ID,
  domainMax: IRVE_PRISM_DOMAIN_MAX,
  heightLabel: 'points de charge installés',
  heightUnit: 'points de charge',
  mode: 'linear',
  ratioLabel: 'densité en points de charge pour 1 000 km²',
  ratioBreaks: IRVE_DENSITY_BREAKS,
  ratioColors: DEPARTEMENT_COLORS,
  // Round ticks that bracket the real distribution: 100 km for the 10 000 of
  // Paris, 50 km for the fifth département down, 10 km for the first quartile.
  heightTicks: [10_000, 5_000, 1_000],
});
/**
 * Fill alpha of a FLAT footprint — the measured zeros and the unmeasured
 * départements, which are the only shapes still clamped to the ground.
 *
 * A scalar, not a ladder. `choroplethAlpha.js` runs a DESCENDING alpha ladder
 * so that a six-class fill keeps its lightness ordering when composited over
 * live imagery; there is nothing to order here, because every flat footprint
 * is drawn in one class or in no colour at all. Importing the ladder would put
 * a second encoding on a channel that now carries none (A3).
 */
const FLAT_FOOTPRINT_ALPHA = 0.45;
const SELECTED_COLOR = '#00ffff';
const OUTLINE_COLOR = Cesium.Color.BLACK.withAlpha(0.35);
const SITE_POINT_MIN_PX = 5;
const SITE_POINT_MAX_PX = 14;
const SELECTED_POINT_PX = 17;
/**
 * Mesh dots are smaller and flatter than exact sites. They stand for a
 * sampled network rather than a counted inventory, and a mesh dot the size of
 * a site dot would invite the eye to read one as the other.
 */
const MESH_POINT_MIN_PX = 3.4;
const MESH_POINT_MAX_PX = 9;

/** One-line explanations behind each power swatch. */
const BAND_BLURBS = Object.freeze({
  lente: 'Wall boxes and kerbside sockets — an overnight charge.',
  normale: 'Three-phase AC, the standard on-street and car-park rung.',
  accelere: 'Fast AC or entry-level DC — a useful top-up over a shop.',
  rapide: 'DC rapid charging, the motorway-service rung.',
  hpc: 'High-power DC. Published up to 400 kW, the envelope of real hardware.',
  inconnue: 'Published power outside any real envelope — ≤ 0 kW, or watts in a kilowatt column. Counted, never rescaled.',
});

/**
 * `MAP_STACKS` ids that render imagery on the SHOWN Cesium globe. An explicit
 * allowlist, for the same reason the Vigilance, Vigicrues and cable layers keep
 * one: an unknown stack id must reach the safe BOTH fallback rather than be
 * asserted onto a surface that is not there.
 */
const IRVE_GLOBE_STACK_IDS = Object.freeze(new Set(['bing-aerial', 'bing-labels', 'osm']));

/**
 * Ground-fill classification for one map stack.
 * @param {string|null|undefined} activeId MapStackController stack id.
 * @returns {Cesium.ClassificationType}
 */
export function irveClassificationTypeForStack(activeId) {
  if (activeId === 'photoreal') return Cesium.ClassificationType.CESIUM_3D_TILE;
  if (IRVE_GLOBE_STACK_IDS.has(activeId)) return Cesium.ClassificationType.TERRAIN;
  return Cesium.ClassificationType.BOTH;
}

/**
 * Derive the active surface from live scene state.
 *
 * Needed because boot calls `setStack(..., { silent: true })` and fires no
 * 'gev:map-stack-changed', so a layer that only listens for the event keeps
 * whatever it guessed at init. Guessing BOTH is the expensive mistake here:
 * with Google's tiles up the Cesium globe is HIDDEN, so a fill asserted onto
 * terrain has no terrain to land on and the national map comes up blank —
 * which is exactly what it did before this existed.
 *
 * @param {Cesium.Scene|null|undefined} scene
 * @returns {Cesium.ClassificationType}
 */
export function irveClassificationTypeForScene(scene) {
  if (!scene?.globe) return Cesium.ClassificationType.BOTH;
  return scene.globe.show === false
    ? Cesium.ClassificationType.CESIUM_3D_TILE
    : Cesium.ClassificationType.TERRAIN;
}

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
  hitTest: hitTestWorldOverlay,
});
let _overlayHost = DEFAULT_OVERLAY_HOST;

// --- Runtime state ----------------------------------------------------------
let _viewer = null;
let _points = null;
/** The beams. Allocated once, recycled across rebuilds — never churned. */
let _beams = null;
/** Set when the next frame owes a beam sweep (camera settle, or a rebuild). */
let _beamSweepDirty = true;
/** Where the camera was when the last sweep ran, for the motion fallback. */
let _beamSweptFrom = null;
/** Throttles how often the motion fallback is allowed to read the clock. */
let _beamSweepProbedAt = 0;
/** Reused so a sweep over 2 575 records allocates no Cartesians. */
const _beamTipScratch = new Cesium.Cartesian3();
let _records = new Map();
let _enabled = false;
let _clickHandler = null;
let _cameraChangedAttached = false;
let _cameraDebounceTimer = null;
let _preRenderRemover = null;
let _selectedId = null;
let _inFlight = null;
let _requestGeneration = 0;
let _loading = false;
let _error = null;
let _status = 'idle';
let _count = 0;
let _lastUpdate = null;
let _lastBox = null;
/** `'national'` (choropleth), `'mesh'` (thinned positions) or `'sites'` (all). */
let _regime = 'national';
/** National mesh tuples, fetched once per session. */
let _mesh = null;
let _meshPromise = null;
let _meshError = null;
/** Last mesh pick, for the panel line and the legend. */
let _meshPick = null;
/** Last viewport summary from the proxy, for the panel row and the analyst. */
let _summary = null;

// National regime.
let _national = null;
let _nationalPainted = false;
let _nationalPromise = null;
let _nationalError = null;
let _depDataSource = null;
/** Département code → EVERY entity Cesium made for it (islands are separate parts). */
let _depEntities = new Map();
/** Département code → `{code, name, anchor}` from the bundled polygons. */
let _depMeta = new Map();
let _depShapesPromise = null;
let _classificationType = Cesium.ClassificationType.BOTH;
let _mapStackListener = null;

/** Colour for a power band. */
export function irveBandColor(band) {
  return BAND_COLORS[band] || BAND_COLORS.inconnue;
}

/** Display label for a power band. */
export function irveBandLabel(band) {
  return IRVE_BAND_LABELS[band] || 'Puissance non exploitable';
}

/**
 * The two measurements one département hands the prism: the charge-point count
 * (its height) and the density per 1 000 km² (its colour).
 *
 * The two are refused INDEPENDENTLY, which is the whole point of routing this
 * through `prismRow`: a count that was never published draws no prism at all,
 * a count measured at zero draws a flat footprint, and a density that cannot
 * be computed refuses the colour without touching the height. `Number(null)`
 * is 0 rather than NaN, so none of those three cases may go through a plain
 * coercion — the shared module rejects absence before it converts, exactly as
 * `irveFeed.js` does on the site rows.
 *
 * @param {object|null|undefined} row Département rollup row.
 * @returns {object} From `prismRow` — see `choroplethPrism.js`.
 */
export function irveDepartementPrism(row, { truncated = false } = {}) {
  const pdc = row?.pdc;
  // THE FOURTH CASE, and it is a repli that used to reach the screen as a
  // measurement. `projectIrveDepartements` walks the whole département index
  // and writes `pdc: 0` for every code the sweep never reached, so a stalled
  // latitude stripe returns Lozère — 226 real charge points — as a hard zero.
  // Drawn as a measured zero that is an ASSERTION ("no charge point here")
  // built on a fallback, which is A1. The sweep already proves its own
  // completeness against the portal's `total_count` and publishes `truncated`;
  // when it is short, a zero is demoted to "not measured" — no prism, hatched
  // footprint — exactly as `schoolsFrance.schoolsPrismRow()` does with the
  // same signal. Not `Number(pdc)`: `Number(null)` is 0 and would manufacture
  // the very zero this guard exists to refuse.
  const unproven = truncated && (pdc === 0 || pdc === '0');
  return prismRow({
    code: row?.code,
    value: unproven ? null : pdc,
    ratio: row?.per1000Km2,
  }, IRVE_PRISM_SCALE);
}

/**
 * Colour for one density, or `null` when the density is not published.
 *
 * `null` rather than a grey, so every caller has to decide what "no rate"
 * looks like instead of inheriting a colour that sits inside the ramp's own
 * family — D3 wants a motif there, not a tint.
 *
 * @param {number|null|undefined} per1000Km2 Charge points per 1 000 km².
 * @returns {?string} CSS colour.
 */
export function irveDensityColor(per1000Km2) {
  return prismRatioColor(per1000Km2, IRVE_PRISM_SCALE);
}

/**
 * Every département of the current rollup, in the shape the prism helpers
 * take. One place builds this, so the legend's tally, the paint pass and the
 * tests can never disagree about which rows exist.
 * @returns {Array<{code: string, value: number, ratio: ?number}>}
 */
export function irveNationalPrismRows(national = _national) {
  const truncated = national?.truncated === true;
  return (national?.departements || []).map((row) => ({
    code: row.code,
    // Same demotion as `irveDepartementPrism` — the legend's tally and the
    // paint pass must count the same 96 rows, or the key says "mesuré à
    // zéro — 1" over a département the map draws as unmeasured.
    value: irveDepartementPrism(row, { truncated }).value,
    ratio: row.per1000Km2,
  }));
}

/**
 * Rendered size for a site, by how many charge points are installed.
 *
 * Square-rooted and capped: SAEMES publishes 606 charge points under the
 * Madeleine, and a linear ramp would make that one dot swallow the arrondissement.
 *
 * @param {number} pdc Charge points at the site.
 * @returns {number} Pixel size.
 */
export function irveSitePointSize(pdc) {
  const count = Number(pdc);
  if (!Number.isFinite(count) || count <= 0) return SITE_POINT_MIN_PX;
  return Math.min(SITE_POINT_MAX_PX, SITE_POINT_MIN_PX + Math.sqrt(Math.min(count, 120)) * 0.9);
}

/**
 * Camera view box, clamped to the proxy's ceiling.
 * A wider view returns null and the layer falls back to the national regime
 * instead of asking for a box the proxy would refuse.
 * @param {Cesium.Viewer} viewer
 * @returns {?{south:number, west:number, north:number, east:number}}
 */
export function cameraIrveBox(viewer) {
  const rectangle = viewer?.camera?.computeViewRectangle?.();
  if (!rectangle) return null;
  const south = Cesium.Math.toDegrees(rectangle.south);
  const north = Cesium.Math.toDegrees(rectangle.north);
  const west = Cesium.Math.toDegrees(rectangle.west);
  const east = Cesium.Math.toDegrees(rectangle.east);
  if (![south, west, north, east].every(Number.isFinite)) return null;
  if (west >= east || south >= north) return null;
  if (north - south > IRVE_MAX_BOX_DEG || east - west > IRVE_MAX_BOX_DEG) return null;
  return { south, west, north, east };
}

/**
 * View box for the mesh regime — the camera rectangle, padded.
 *
 * No ceiling here, unlike `cameraIrveBox`: the mesh is picked from a set the
 * client already holds, so a wide view costs nothing upstream. The padding
 * means a dot does not pop into existence exactly at the screen edge as you
 * pan, which is what makes the thinning read as a map rather than a redraw.
 *
 * @param {Cesium.Viewer} viewer
 * @returns {?{south:number, west:number, north:number, east:number}}
 */
export function cameraMeshBox(viewer, padFraction = 0.12) {
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

function cameraAltitudeM(viewer) {
  const carto = viewer?.camera?.positionCartographic;
  return Number.isFinite(carto?.height) ? carto.height : Infinity;
}

/**
 * A view rectangle's two spans, in degrees. Infinite when the camera is past
 * the limb and Cesium can give no rectangle at all — the most zoomed-out
 * state there is.
 * @param {Cesium.Viewer} viewer
 * @returns {{lat:number, max:number}}
 */
export function viewSpanDeg(viewer) {
  const rectangle = viewer?.camera?.computeViewRectangle?.();
  if (!rectangle) return { lat: Infinity, max: Infinity };
  const lat = Cesium.Math.toDegrees(rectangle.north - rectangle.south);
  const lon = Cesium.Math.toDegrees(rectangle.east - rectangle.west);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { lat: Infinity, max: Infinity };
  return { lat, max: Math.max(lat, lon) };
}

/**
 * Which regime the camera is in, with hysteresis at both boundaries so a
 * camera resting on one does not flip the whole map back and forth.
 *
 * A camera with no view rectangle is looking past the limb at the whole
 * globe, which is the most zoomed-out state there is — the choropleth, not a
 * fallback.
 *
 * @param {Cesium.Viewer} viewer
 * @returns {'national'|'mesh'|'sites'}
 */
function updateRegime(viewer) {
  const span = viewSpanDeg(viewer);
  const altitude = cameraAltitudeM(viewer);

  if (_regime === 'national') {
    if (span.lat >= NATIONAL_EXIT_SPAN_DEG) return _regime;
  } else if (span.lat >= NATIONAL_ENTER_SPAN_DEG) {
    _regime = 'national';
    return _regime;
  }

  // Below the national threshold the choice is between every site and a
  // thinned sample, and it is the PROXY's box ceiling that decides — the
  // exact regime exists only where a viewport query is answerable at all.
  // That ceiling bites before the altitude gate does (0.35° of longitude is
  // reached around 25 km, not 45 km), which is the correct order: a request
  // the proxy would refuse must never be issued.
  if (_regime === 'sites') {
    if (altitude > SITE_EXIT_ALTITUDE_M || span.max > IRVE_MAX_BOX_DEG) _regime = 'mesh';
  } else if (altitude < SITE_ENTER_ALTITUDE_M && span.max <= IRVE_MAX_BOX_DEG) {
    _regime = 'sites';
  } else {
    _regime = 'mesh';
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

/**
 * Build the card copy for a selected site. Every line is a published value or
 * a stated count of published values; nothing here is inferred.
 *
 * @param {Object} record Render record.
 * @returns {string} Newline-separated card copy.
 */
export function buildIrveSelectionLabel(record) {
  const site = record?.site || {};
  const details = [];
  const title = site.name || site.commune || 'Station de recharge';

  const pdc = Number(site.pdcDistinct) || 0;
  const published = Number(site.pdcPublished) || 0;
  details.push(`🔌 ${fr(pdc)} point${pdc === 1 ? '' : 's'} de charge`);
  // Naming both figures is the point: the layer is not claiming a truth the
  // file does not hold, it is reporting a file that says a thing twice.
  if (published > pdc) {
    details.push(`↳ ${fr(published)} publiés — ${fr(published - pdc)} en double`);
  }

  const bands = site.bands || {};
  const split = IRVE_BAND_KEYS
    .filter((band) => Number(bands[band]) > 0)
    .map((band) => `${fr(bands[band])} × ${irveBandLabel(band).replace(/\s*\(.*\)$/, '').toLowerCase()}`);
  if (split.length > 1) details.push(`⚡ ${split.join(' · ')}`);
  else if (Number.isFinite(site.peakKW)) details.push(`⚡ ${fr(site.peakKW)} kW max`);
  if (site.topBand === 'inconnue') {
    details.push('⚠️ Puissance publiée hors gabarit — non convertie');
  }

  if (site.connectors?.length) {
    details.push(`🔗 ${site.connectors.map((key) => IRVE_CONNECTOR_LABELS[key] || key).join(' · ')}`);
  }
  if (site.access) details.push(`🚧 ${site.access}`);
  if (site.implantation) details.push(site.implantation);
  if (site.pmr && site.pmr !== 'Accessibilité inconnue') details.push(`♿ ${site.pmr}`);
  // Tri-state: an unstated tariff is not a free one.
  if (site.free === true) details.push('💶 Gratuit');
  else if (site.free === false) details.push('💶 Payant');

  if (site.operators?.length) details.push(`🏢 ${site.operators.join(' · ')}`);
  if (site.duplicateOperators?.length) {
    details.push(`↳ publié aussi par ${site.duplicateOperators.join(' · ')} — fusionné`);
  }
  if (site.commune) details.push(`📍 ${site.commune}`);
  if (!site.coordVerified) {
    details.push('📍 Position non vérifiée contre une commune');
  }

  // The freshness of the DECLARATION, not of the poll: a tenth of this file
  // has not been touched since 2023 and the card has to be able to say so.
  if (site.updatedFrom) {
    details.push(site.updatedTo && site.updatedTo !== site.updatedFrom
      ? `🗓 déclaré ${site.updatedFrom} → ${site.updatedTo}`
      : `🗓 déclaré ${site.updatedFrom}`);
  }
  details.push('Capacité installée — ce fichier ne publie pas la disponibilité');

  return [title, ...details].join('\n');
}

/**
 * Card copy for a site picked out of the maillage.
 *
 * The national sweep carries five columns, so this card knows the position,
 * the count and the top power band and NOTHING else. It says so rather than
 * printing an empty operator line, and points at the zoom level where the
 * rest exists.
 *
 * @param {Object} record
 * @returns {string}
 */
export function buildIrveMeshLabel(record) {
  const site = record?.site || {};
  const pdc = Number(site.pdcDistinct) || 0;
  return [
    'Station de recharge',
    `🔌 ${fr(pdc)} point${pdc === 1 ? '' : 's'} de charge`,
    `⚡ ${irveBandLabel(site.topBand)}`,
    'Zoomez pour l\u2019opérateur, les prises et les conditions d\u2019accès',
    'Capacité installée — ce fichier ne publie pas la disponibilité',
  ].join('\n');
}

/**
 * Build the card copy for a selected département.
 *
 * The density line is not decoration: the fill encodes an absolute count, and
 * a count choropleth flatters a large département. Printing charge points per
 * 1 000 km² beside the total is what lets a reader check that bias rather than
 * inherit it.
 *
 * @param {Object} row Département rollup row.
 * @returns {string} Newline-separated card copy.
 */
export function buildIrveDepartementLabel(row) {
  if (!row) return '';
  const details = [];
  const pdc = Number(row.pdc) || 0;
  // The two lines the two channels are read from, named as such: a reader who
  // wants the exact figure behind a height or behind a class finds it here,
  // which is what makes the volume's areal bias checkable rather than fatal.
  details.push(`🔌 ${fr(pdc)} point${pdc === 1 ? '' : 's'} de charge — la hauteur du prisme`);
  if (Number(row.sites) > 0) {
    details.push(`📍 ${fr(row.sites)} site${row.sites === 1 ? '' : 's'}`);
  }
  const bands = row.bands || {};
  const split = IRVE_BAND_KEYS
    .filter((band) => Number(bands[band]) > 0)
    .map((band) => `${fr(bands[band])} × ${irveBandLabel(band).replace(/\s*\(.*\)$/, '').toLowerCase()}`);
  if (split.length) details.push(`⚡ ${split.join(' · ')}`);
  if (Number.isFinite(row.per1000Km2)) {
    details.push(`▦ ${row.per1000Km2.toLocaleString('fr-FR')} pour 1 000 km² — la couleur (${fr(row.areaKm2)} km²)`);
  } else {
    // Not a zero and not a low density: no rate could be computed at all, and
    // the prism says so with a striped body rather than a step of the ramp.
    details.push('▦ densité non calculable — le prisme est hachuré, sa hauteur reste mesurée');
  }
  details.push('Capacité installée — ce fichier ne publie pas la disponibilité');
  return [`${row.name} (${row.code})`, ...details].join('\n');
}

/** Shared shape of a protected selected-object overlay entry. */
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

/**
 * Protected selected-site entry for the shared overlay host.
 * @param {Object} record
 * @returns {?Object}
 */
export function createIrveSelectedOverlayEntry(record) {
  const position = record?.position;
  if (!record?.id || !position) return null;
  const copy = record.mesh
    ? buildIrveMeshLabel(record)
    : buildIrveSelectionLabel(record);
  return selectedOverlayEntry(record.id, position, copy);
}

/**
 * Ambient label for one département at national altitude.
 * @param {Object} row
 * @param {Cesium.Cartesian3} position
 * @returns {Object}
 */
export function createIrveDepartementOverlayEntry(row, position) {
  return {
    id: `${IRVE_FR_DEP_LABEL_PREFIX}${row.code}`,
    position,
    variant: 'label',
    title: `${row.name} · ${fr(row.pdc)}`,
    // The label's accent is the PRISM'S OWN colour — the density class — so
    // the name and the shape it belongs to are never two different keys. A
    // département with no computable density takes the refusal grey rather
    // than a step of the ramp.
    accent: irveDensityColor(row.per1000Km2) || PRISM_NO_RATIO_COLOR,
    // The cohort is bounded, so priority decides WHICH départements get named:
    // the biggest, which is the same ranking the fill already shows.
    priority: Number(row.pdc) || 0,
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    // The département's name is a click surface, not a caption — see
    // `overlayLabelPick.js` for the mechanism and the pick-ordering rule.
    interactive: true,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 15,
    verticalOnly: true,
    placement: 'above',
  };
}

/** Keep the largest départements, with stable identity as tie-break. */
export function selectIrveLabelCohort(entries, limit = IRVE_FR_LABEL_COHORT_LIMIT) {
  const cap = Math.max(0, Math.min(IRVE_FR_LABEL_COHORT_LIMIT, Math.floor(Number(limit) || 0)));
  if (!Array.isArray(entries) || cap === 0) return [];
  return entries.slice()
    .sort((a, b) => b.priority - a.priority || String(a.id).localeCompare(String(b.id)))
    .slice(0, cap);
}

function restoreRecordStyle(record) {
  if (!record?.point) return;
  record.point.color = Cesium.Color.fromCssColorString(record.baseColor);
  record.point.pixelSize = record.baseSize;  styleBeam(record, false);
}

function clearSelection() {
  // The id is dropped BEFORE the repaint, and the ordering is the whole fix.
  // `repaintDepartements` ends by calling `highlightSelectedDepartement`, so
  // repainting while `_selectedId` was still set re-applied the highlight to
  // the entity being deselected — which then stayed cyan until the next
  // repaint, i.e. until the next poll, half an hour later. Clicking Paris then
  // the Nord left TWO cyan prisms on screen and one card. Same defect, same
  // ordering, as `schoolsFrance.clearSelection()`.
  const departement = _selectedId?.startsWith?.('dep:') === true;
  const record = departement || !_selectedId ? null : _records.get(_selectedId);
  _selectedId = null;
  // Nothing to restore for a département: its fill is owned by the repaint,
  // which is idempotent, so re-running it puts the bin colour back.
  if (departement) repaintDepartements();
  else if (record) restoreRecordStyle(record);
  _overlayHost.clearSource(IRVE_FR_OVERLAY_SOURCE_ID);
}

function selectSite(id) {
  clearSelection();
  const record = _records.get(id);
  if (!record || !_viewer) return;
  _selectedId = id;
  if (record.point) {
    record.point.color = Cesium.Color.fromCssColorString(SELECTED_COLOR);
    record.point.pixelSize = SELECTED_POINT_PX;
  }
  styleBeam(record, true);
  const entry = createIrveSelectedOverlayEntry(record);
  if (entry) {
    _overlayHost.setEntries(IRVE_FR_OVERLAY_SOURCE_ID, [entry], IRVE_FR_OVERLAY_SOURCE_OPTIONS);
  }
  governorRequestRender('irve-fr-select');
}

function selectDepartement(code) {
  clearSelection();
  const row = _national?.departements?.find((entry) => entry.code === code);
  const anchor = _depMeta.get(code)?.anchor;
  if (!row || !anchor) return;
  _selectedId = `dep:${code}`;
  highlightSelectedDepartement();
  _overlayHost.setEntries(
    IRVE_FR_OVERLAY_SOURCE_ID,
    [selectedOverlayEntry(
      _selectedId,
      Cesium.Cartesian3.fromDegrees(anchor[0], anchor[1]),
      buildIrveDepartementLabel(row),
    )],
    IRVE_FR_OVERLAY_SOURCE_OPTIONS,
  );
  governorRequestRender('irve-fr-select-departement');
}

function onKeyDown(event) {
  if (event.key === 'Escape' && _selectedId) clearSelection();
}

/** Département code carried by a picked Cesium entity, if it is one of ours. */
function pickedDepartementCode(picked) {
  const entity = picked?.id;
  if (!entity || typeof entity === 'string' || !entity.polygon) return null;
  const code = String(entity.properties?.code?.getValue?.() ?? '').trim();
  return _depEntities.has(code) ? code : null;
}

function installClickHandler(viewer) {
  if (_clickHandler) return;
  _clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  _clickHandler.setInputAction((click) => {
    const picked = viewer.scene.pick(click.position);
    if (picked) {
      const primitiveId = picked.primitive?.id;
      if (typeof primitiveId === 'string' && _records.has(primitiveId)) {
        selectSite(primitiveId);
        return;
      }
      if (typeof picked.id === 'string' && _records.has(picked.id)) {
        selectSite(picked.id);
        return;
      }
      if (_regime === 'national') {
        const code = pickedDepartementCode(picked);
        if (code) {
          selectDepartement(code);
          return;
        }
      }
    }
    if (_regime === 'national') {
      // The label plane the depth buffer knows nothing about. At national
      // altitude the name floats clear of the shape it belongs to, so it is
      // often the only thing under the cursor.
      const labelled = pickOverlayLabelId(click.position, {
        sourceId: IRVE_FR_LABEL_SOURCE_ID,
        prefix: IRVE_FR_DEP_LABEL_PREFIX,
        has: (depCode) => _depEntities.has(depCode),
        hitTest: _overlayHost.hitTest,
      });
      if (labelled) {
        selectDepartement(labelled);
        return;
      }
    }
    if (_selectedId) clearSelection();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  document.addEventListener('keydown', onKeyDown);
}

/**
 * Per-frame horizon pass.
 *
 * Dots draw with depth testing disabled so a charge point is not swallowed by
 * the kerb it stands on, which also means one on the far side of the planet
 * would paint straight through the globe. Nothing here animates — a register
 * does not move — so this is the layer's only per-frame work, and it is idle
 * entirely in the national regime.
 */
/* ══════════════════════════════════════════════════════════════════════════
 * THE BEAMS — lifting the marker off a basemap we do not control
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A 7–14 px dot with a one-pixel outline is legible against a basemap you
 * choose and against nothing else. This layer draws over OSM, Plan IGN, IGN
 * ortho and Bing aerial, and on ortho a coloured dot the size of a parked car
 * is simply part of the texture. The fix used elsewhere in this console is to
 * stand the marker UP: a short vertical beam has a length and a direction that
 * no aerial photograph contains, so it reads as an overlay at any zoom, over
 * any surface.
 *
 * ── WHY A RECYCLED POLYLINE COLLECTION AND NOT ENTITIES ─────────────────────
 *
 * The two stem implementations already in this repo — the submarine cables and
 * the shared `createLocalGeoJsonLayer` factory — both build their stems ONCE
 * from a bundled file and never rebuild: 2 629 and 7 464 of them, added at load
 * and left alone. This layer is the opposite. Its record set is rebuilt on
 * every camera settle behind a 450 ms debounce, and the densest real viewport
 * in France (a 0.35° box over central Paris, measured live: 5 253 grouped rows
 * → 2 575 distinct sites) would mean up to 2 575 entity add/remove per pan —
 * a workload neither precedent has ever run, and precisely the shape of the
 * hitch the cable layer documented and removed.
 *
 * So the beams live in a `PolylineCollection` that is allocated once and
 * RECYCLED: a rebuild rewrites positions and colours on the polylines that
 * already exist and hides the surplus. Nothing is destroyed, nothing is
 * re-created, and the collection converges on the largest view the session has
 * seen. `PolylineCollection.update` takes its partial-buffer `writeUpdate`
 * path when only positions moved and the vertex count is unchanged — which,
 * for a two-vertex beam, is every rebuild.
 *
 * ── WHY THEY GET SHORTER AS THE VIEW GETS BUSIER ────────────────────────────
 *
 * 2 575 vertical beams inside one city do not read as markers; they read as a
 * hedge. The cables' 2 629 are spread over every ocean on Earth and the
 * airports' 7 464 over the whole planet — this layer's worst case is all of
 * them inside 39 km. The beam therefore has a length BUDGET that falls as the
 * in-view count rises (see {@link irveBeamTargetPx}), so a quiet market town
 * gets a tall obvious marker and central Paris gets a short bristle that still
 * lifts the dot off the tarmac without becoming a wall.
 */

/**
 * Beam length in pixels for a sparse view, and for a saturated one.
 *
 * CALIBRATED AGAINST THE REGIMES, not against a guess. The first attempt used
 * a 14 px floor reached at 1 600 markers, on the reasoning that the densest
 * real viewport in France holds ~2 575 sites. It was wrong in practice for a
 * reason a browser found and arithmetic did not: the MESH regime is capped at
 * 2 200 dots and covers most of the useful zoom range, so every mesh view
 * saturated the budget and drew the minimum. Measured over Paris at 9 km that
 * is a ~100 m beam — about 8 px — which at 0.62 alpha over an OSM basemap is
 * indistinguishable from nothing. The beams were rendering perfectly and were
 * invisible, which is the failure this whole change exists to fix.
 *
 * The saturation point now sits above the mesh cap so a mesh view is not
 * automatically on the floor, and the floor itself was raised twice against a
 * measurement rather than a taste. Counting the pixels a beam actually changes
 * on a 1 200×800 canvas over central Paris at 2 200 markers:
 *
 *     406 m of beam (26 px budget)     3 186 px   present, but faint
 *     406 m, drawn fat and opaque     11 406 px   width is NOT the lever
 *   3 000 m, shipped width and alpha  81 595 px   unmistakable — and a hedge
 *
 * Height dominates by a factor of twenty-five and width barely moves it, so the
 * budget is where the tuning belongs. 3 000 m covers 8.5 % of the canvas, which
 * is the wall the recon warned about; the shipped 38–64 px band sits between
 * the two, roughly doubling the faint case without approaching the wall.
 *
 * The last word on this belongs to a real browser on the staging URL. A
 * software rasteriser at 1 200×800 is not where a judgement about whether a
 * marker reads should be made, and this comment records the numbers so the
 * next adjustment starts from data instead of from taste.
 */
export const IRVE_BEAM_MAX_PX = 64;
export const IRVE_BEAM_MIN_PX = 38;
/** In-view counts the budget interpolates between. */
export const IRVE_BEAM_SPARSE_COUNT = 300;
export const IRVE_BEAM_DENSE_COUNT = 2400;
/** Metres a beam may never fall below or exceed, whatever the pixel budget says. */
const BEAM_MIN_M = 60;
const BEAM_MAX_M = 40_000;
/** Sub-metre tip noise is not worth a geometry write. */
const BEAM_TIP_EPSILON_M = 0.5;
const BEAM_TIP_EPSILON_SQ = BEAM_TIP_EPSILON_M ** 2;
/** Beam width, and the width a selected beam takes. */
const BEAM_WIDTH_PX = 2.6;
const SELECTED_BEAM_WIDTH_PX = 5;
/**
 * Beams are translucent so a dense view reads as a field rather than a fence —
 * but not so translucent that a single one disappears. 0.62 was measured too
 * faint over an OSM basemap at the length the budget was giving.
 */
const BEAM_ALPHA = 0.82;
/** Camera travel that re-arms the beam sweep when `moveEnd` never fires. */
const BEAM_SWEEP_MOTION_EPSILON_M = 250;
const BEAM_SWEEP_MOTION_EPSILON_SQ = BEAM_SWEEP_MOTION_EPSILON_M ** 2;
/** How often the motion fallback is even allowed to look at the clock. */
const BEAM_SWEEP_PROBE_INTERVAL_MS = 2000;

/**
 * Beam length, in pixels, for a view holding `count` markers.
 *
 * Linear between the two anchors and clamped outside them. The shape is not
 * the point — the point is that it is MONOTONIC DECREASING, so the layer can
 * never make a dense view taller than a sparse one.
 * @param {number} count Markers currently rendered.
 * @returns {number} Target beam length in CSS pixels.
 */
export function irveBeamTargetPx(count) {
  const n = Number.isFinite(count) ? count : 0;
  if (n <= IRVE_BEAM_SPARSE_COUNT) return IRVE_BEAM_MAX_PX;
  if (n >= IRVE_BEAM_DENSE_COUNT) return IRVE_BEAM_MIN_PX;
  const t = (n - IRVE_BEAM_SPARSE_COUNT) / (IRVE_BEAM_DENSE_COUNT - IRVE_BEAM_SPARSE_COUNT);
  return IRVE_BEAM_MAX_PX - t * (IRVE_BEAM_MAX_PX - IRVE_BEAM_MIN_PX);
}

/**
 * Metres of beam that subtend `targetPx` at `distance`, clamped.
 * @param {number} distance Camera distance to the beam foot, metres.
 * @param {number} targetPx Desired on-screen length.
 * @param {number} metresPerPixelFactor `2·tan(fov/2) / canvasHeight`.
 * @returns {number}
 */
export function irveBeamHeightM(distance, targetPx, metresPerPixelFactor) {
  const effective = Math.max(Number(distance) || 0, 500);
  const raw = effective * metresPerPixelFactor * targetPx;
  if (!Number.isFinite(raw)) return BEAM_MIN_M;
  return Math.max(BEAM_MIN_M, Math.min(BEAM_MAX_M, raw));
}

/**
 * Rebuild the beam for every rendered record, and hide the surplus.
 *
 * Runs on the SWEEP, not on every frame — see {@link onPreRender}.
 */
function sweepBeams() {
  if (!_beams || !_viewer) return;
  const camera = _viewer.camera;
  const scene = _viewer.scene;
  const canvasHeight = scene?.canvas?.clientHeight || 0;
  if (!canvasHeight) return;
  const fov = scene?.camera?.frustum?.fovy;
  if (!Number.isFinite(fov)) return;
  const metresPerPixelFactor = (2 * Math.tan(fov * 0.5)) / canvasHeight;
  const targetPx = irveBeamTargetPx(_records.size);
  const occluder = horizonOccluder(camera);

  let index = 0;
  for (const record of _records.values()) {
    const visible = occluder.isPointVisible(record.position);
    if (record.point) record.point.show = visible;
    const line = _beams.get(index);
    index += 1;
    if (!line) continue;
    if (!visible) {
      // Hidden beams keep their last geometry: the sweep that turns them
      // visible again is the one that refreshes it, and rewriting positions
      // for something nobody can see is a buffer write for nothing.
      line.show = false;
      continue;
    }
    const distance = Cesium.Cartesian3.distance(camera.positionWC, record.position);
    const height = irveBeamHeightM(distance, targetPx, metresPerPixelFactor);
    const carto = record.carto;
    Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, carto.height + height, undefined, _beamTipScratch);
    // Skip the write when the tip has not meaningfully moved. At the shipped
    // budget a 250 m camera move shifts a tip by a few metres, so a settled
    // camera costs zero buffer writes.
    const positions = line.positions;
    if (positions && positions.length === 2
      && Cesium.Cartesian3.distanceSquared(positions[1], _beamTipScratch) <= BEAM_TIP_EPSILON_SQ) {
      line.show = true;
      continue;
    }
    line.positions = [record.position, Cesium.Cartesian3.clone(_beamTipScratch)];
    line.show = true;
  }
  // Everything past the record set is surplus from a busier view. Hidden, not
  // removed — the collection converges rather than churning.
  for (let i = index; i < _beams.length; i += 1) _beams.get(i).show = false;
}

/**
 * Give every rendered record a beam, recycling the polylines already allocated.
 *
 * Called from both reconcile paths after the dots are rebuilt. Colour and width
 * are set here (they change with the record); geometry is left to the sweep,
 * which is the only place that knows where the camera is.
 */
function rebuildBeams() {
  if (!_beams) return;
  let index = 0;
  for (const record of _records.values()) {
    const color = Cesium.Color.fromCssColorString(record.baseColor).withAlpha(BEAM_ALPHA);
    let line = _beams.get(index);
    if (!line) {
      line = _beams.add({
        positions: [record.position, record.position],
        width: BEAM_WIDTH_PX,
        material: Cesium.Material.fromType('Color', { color }),
        show: false,
      });
    } else {
      line.material.uniforms.color = color;
      line.width = BEAM_WIDTH_PX;
    }
    record.beamIndex = index;
    index += 1;
  }
  for (let i = index; i < _beams.length; i += 1) _beams.get(i).show = false;
  _beamSweepDirty = true;
}

/**
 * Per-frame work: decide whether this frame owes a sweep, and run one if so.
 *
 * The walk itself is unchanged in kind — it was already an occluder test over
 * every record — but it is now GATED rather than run unconditionally, and it
 * carries the beam resize with it. Two dirty conditions, no timer: a camera
 * settle (or a rebuild), and a motion fallback for tracked cameras that never
 * emit `moveEnd`, which reads the clock at most every 2 s and only re-arms
 * past 250 m of travel since the LAST SWEPT position. A parked camera costs
 * one distance comparison per frame.
 */
function onPreRender() {
  if (!_enabled || !_records.size) return;
  const camera = _viewer?.camera;
  if (!camera) return;
  if (!_beamSweepDirty) {
    const now = Date.now();
    if (now - _beamSweepProbedAt < BEAM_SWEEP_PROBE_INTERVAL_MS) return;
    _beamSweepProbedAt = now;
    if (!_beamSweptFrom
      || Cesium.Cartesian3.distanceSquared(camera.positionWC, _beamSweptFrom) < BEAM_SWEEP_MOTION_EPSILON_SQ) {
      return;
    }
  }
  _beamSweepDirty = false;
  _beamSweptFrom = Cesium.Cartesian3.clone(camera.positionWC, _beamSweptFrom);
  sweepBeams();
}

/**
 * Paint one record's beam as selected, or back to its band colour.
 *
 * The beam is widened as well as recoloured: at the dense end of the length
 * budget a selected beam is only 14 px tall, and a colour change alone on a
 * 2.2 px line inside a field of 1 600 of them is not a selection anyone can
 * find.
 * @param {object|null|undefined} record
 * @param {boolean} selected
 */
function styleBeam(record, selected) {
  if (!_beams || !record || !Number.isFinite(record.beamIndex)) return;
  const line = _beams.get(record.beamIndex);
  if (!line) return;
  line.material.uniforms.color = selected
    ? Cesium.Color.fromCssColorString(SELECTED_COLOR)
    : Cesium.Color.fromCssColorString(record.baseColor).withAlpha(BEAM_ALPHA);
  line.width = selected ? SELECTED_BEAM_WIDTH_PX : BEAM_WIDTH_PX;
}

/** Ask for a sweep on the next frame. */
function markBeamSweepDirty() {
  _beamSweepDirty = true;
}

// --- National regime --------------------------------------------------------

/** True when this entity is currently drawn as a prism rather than a footprint. */
function isExtruded(entity) {
  return entity?.polygon?.extrudedHeight !== undefined;
}

/**
 * Re-target the ground fill at whichever surface the map stack put up.
 *
 * It now applies to the FLAT footprints only — the measured zeros and the
 * unmeasured départements — and that is not a shortcut, it is the rule.
 * Verified in the bundled Cesium: `GroundGeometryUpdater._isOnTerrain` returns
 * false as soon as `extrudedHeight` is defined (`index.js:148334-148336`), so
 * on a prism `polygon.classificationType` is read into
 * `_classificationTypeProperty` and then never used. Leaving it set would be a
 * property that lies to the next reader, so {@link paintDepartementPrism}
 * clears it on the way up and restores it on the way back down.
 *
 * The stack listener still has to run: a session that starts over Google's
 * tiles, hides the Cesium globe and then switches to Bing must re-assert the
 * surface for every flat footprint, or those come up on nothing.
 */
function applyClassification(next) {
  if (next === undefined || next === _classificationType) return;
  _classificationType = next;
  for (const parts of _depEntities.values()) {
    for (const entity of parts) {
      if (entity.polygon && !isExtruded(entity)) entity.polygon.classificationType = next;
    }
  }
  _viewer?.scene?.requestRender?.();
}

/**
 * Load the bundled polygons ONCE, hidden. Every département gets an entity up
 * front so a repaint only flips `show` and swaps a material — the same shape
 * the Vigilance and Mix élec layers use on this same file.
 */
async function ensureDepartementShapes() {
  if (_depShapesPromise) return _depShapesPromise;
  _depShapesPromise = (async () => {
    const geojson = await (await fetch(DEPARTEMENTS_URL)).json();
    _depMeta = parseDepartements(geojson);
    const source = await Cesium.GeoJsonDataSource.load(geojson, {
      clampToGround: true,
      fill: Cesium.Color.TRANSPARENT,
      stroke: Cesium.Color.TRANSPARENT,
      strokeWidth: 0,
    });
    source.name = 'Bornes IRVE — implantation par département';
    source.show = _enabled;
    // The polygons load lazily, on first entry to the national regime — long
    // after init, and after any silent stack settle. Re-derive here so the
    // entities are built with the surface that is actually up.
    _classificationType = irveClassificationTypeForScene(_viewer?.scene);
    for (const entity of source.entities.values) {
      const code = String(entity.properties?.code?.getValue?.() ?? '').trim();
      if (!entity.polygon || !code) {
        entity.show = false;
        continue;
      }
      entity.polygon.outline = false;
      entity.polygon.classificationType = _classificationType;
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

/** Re-apply the selected département's highlight after a repaint. */
function highlightSelectedDepartement() {
  if (!_selectedId?.startsWith('dep:')) return;
  const cyan = Cesium.Color.fromCssColorString(SELECTED_COLOR);
  for (const entity of _depEntities.get(_selectedId.slice(4)) || []) {
    if (!entity.polygon) continue;
    // A prism keeps its silhouette when it is selected: the top edge is the
    // instrument the height is read with, and a selection that filled the body
    // without lighting the edge would take the reading away at the exact
    // moment the reader asked for the figures.
    const extruded = isExtruded(entity);
    entity.polygon.material = new Cesium.ColorMaterialProperty(
      cyan.withAlpha(extruded ? PRISM_BODY_ALPHA : 0.42),
    );
    if (extruded) entity.polygon.outlineColor = cyan.withAlpha(PRISM_TOP_ALPHA);
  }
}

/**
 * Draw one département as a PRISM: base on the ellipsoid, top at its count.
 *
 * `height` is pinned to {@link PRISM_BASE_HEIGHT_M} (0) rather than clamped to
 * the ground, and that is the argument for abandoning classification rather
 * than a consequence of it: a terrain-clamped base would start the Savoie
 * prism ~2 km higher than the Landes one, so its TOP would sit 2 km higher at
 * equal count, and a height read against a moving datum is not a height.
 * Terrain pokes through the bottom of an Alpine prism; that is the visible,
 * correct trade. `perPositionHeight` must stay false for the same reason.
 *
 * @param {Cesium.Entity} entity
 * @param {object} built A row from {@link irveDepartementPrism}.
 * @param {Cesium.MaterialProperty} material Body material.
 * @param {Cesium.Color} edge Silhouette and top-edge colour.
 */
function paintDepartementPrism(entity, built, material, edge) {
  entity.polygon.height = PRISM_BASE_HEIGHT_M;
  entity.polygon.extrudedHeight = built.heightM;
  entity.polygon.perPositionHeight = false;
  // Read and silently ignored on an extruded polygon — see applyClassification.
  entity.polygon.classificationType = undefined;
  entity.polygon.material = material;
  // Cesium force-disables `outline` on terrain with a one-time warning
  // (`index.js:61110-61113`). Off terrain it is legal, so the prism gets the
  // silhouette the flat fill could never have.
  entity.polygon.outline = true;
  entity.polygon.outlineColor = edge;
  entity.show = true;
}

/**
 * Draw one département as a FLAT footprint — the two cases that have no height.
 *
 * These stay clamped to the ground, which is why `classificationType` still
 * matters for them and why it is re-asserted here on every repaint: an entity
 * that was a prism a moment ago carries a cleared one.
 *
 * They also stay OUTLINED = false, and not by choice: Cesium refuses an
 * outline on a terrain-clamped polygon. The two flat cases are therefore told
 * apart by their MATERIAL — a solid fill for a measured zero, a grid for a
 * département nobody measured — which is what D3 asks for anyway, since a
 * motif survives the NVG and FLIR passes that a tint does not.
 *
 * @param {Cesium.Entity} entity
 * @param {Cesium.MaterialProperty} material
 */
function paintDepartementFootprint(entity, material) {
  entity.polygon.extrudedHeight = undefined;
  entity.polygon.height = undefined;
  entity.polygon.outline = false;
  entity.polygon.classificationType = _classificationType;
  entity.polygon.material = material;
  entity.show = true;
}

/**
 * The grid a département with no published count is drawn with (A1 + D3).
 *
 * Allocated once and shared: it is one state, not one state per département,
 * and a repaint that minted a material per shape would churn the material
 * cache on every rollup.
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
 * Paint the current rollup onto the pre-built département entities.
 *
 * Four states, four marks, and the reason they are four and not two is A1:
 * "we did not measure this" and "we measured this and it is zero" are
 * different facts, and so are "we have no rate for it" and "the rate is low".
 *
 *   count ✓ density ✓ → prism at its height, body in its density colour
 *   count ✓ density ✗ → prism at its height, body STRIPED: the height is
 *                       measured, the colour is refused
 *   count = 0         → flat footprint, filled, no volume at all
 *   count ✗           → flat footprint, GRID, filled by nothing
 *
 * Idempotent, and it re-asserts a live selection at the end: a repaint resets
 * every material, so without that a camera nudge would silently drop the cyan
 * highlight while the card stayed on screen.
 */
function repaintDepartements() {
  if (!_depEntities.size) return;
  const seen = new Set();
  // One material instance per CLASS, shared by every département in it: they
  // are one step of a six-step scale, not 96 separate colours.
  const bodies = new Map();
  const edges = new Map();
  for (const row of _national?.departements || []) {
    const parts = _depEntities.get(row.code);
    if (!parts) continue;
    seen.add(row.code);
    const built = irveDepartementPrism(row, { truncated: _national?.truncated === true });
    const key = built.hasRatio ? built.bin : 'none';
    if (!bodies.has(key)) {
      const css = built.color || PRISM_NO_RATIO_COLOR;
      const base = Cesium.Color.fromCssColorString(css);
      bodies.set(key, built.hasRatio
        ? new Cesium.ColorMaterialProperty(base.withAlpha(PRISM_BODY_ALPHA))
        // No density: a motif, not a tint, so the refusal cannot be mistaken
        // for a step of the ramp (D3).
        : new Cesium.StripeMaterialProperty({
          evenColor: base.withAlpha(PRISM_BODY_ALPHA),
          oddColor: base.withAlpha(0.12),
          repeat: 24,
        }));
      edges.set(key, base.withAlpha(PRISM_TOP_ALPHA));
      bodies.set(`${key}:flat`, new Cesium.ColorMaterialProperty(
        base.withAlpha(FLAT_FOOTPRINT_ALPHA),
      ));
    }
    for (const entity of parts) {
      if (!entity.polygon) continue;
      if (built.extruded) {
        paintDepartementPrism(entity, built, bodies.get(key), edges.get(key));
      } else if (built.hasValue) {
        // A measured zero. Drawn, and drawn flat: the register lists nothing
        // here, which is a finding, and hiding it would make it look like the
        // sweep had simply missed the département.
        paintDepartementFootprint(entity, bodies.get(`${key}:flat`));
      } else {
        paintDepartementFootprint(entity, unmeasuredMaterial());
      }
    }
  }
  // A département the rollup does not cover at all — a payload that came back
  // short. It is not the bottom of the scale and it is not a zero; it is the
  // grid, and the legend counts it.
  for (const [code, parts] of _depEntities) {
    if (seen.has(code)) continue;
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
    _overlayHost.clearSource(IRVE_FR_LABEL_SOURCE_ID);
    return;
  }
  const entries = [];
  for (const row of _national?.departements || []) {
    if (!(row.pdc > 0)) continue;
    const anchor = _depMeta.get(row.code)?.anchor;
    if (!anchor) continue;
    entries.push(createIrveDepartementOverlayEntry(
      row,
      Cesium.Cartesian3.fromDegrees(anchor[0], anchor[1]),
    ));
  }
  _overlayHost.setEntries(IRVE_FR_LABEL_SOURCE_ID, selectIrveLabelCohort(entries), {
    cohortLimit: IRVE_FR_LABEL_COHORT_LIMIT,
    collisionCapacity: IRVE_FR_LABEL_COLLISION_CAPACITY,
    moving: false,
  });
}

/** Fetch the national rollup once per session; the proxy caches it for a day. */
async function ensureNational() {
  if (_national) return _national;
  if (_nationalPromise) return _nationalPromise;
  _nationalPromise = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NATIONAL_TIMEOUT_MS);
    try {
      const response = await fetch('/api/irve-fr/departements', { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload?.departements)) throw new Error('malformed national rollup');
      _national = payload;
      _nationalError = null;
      return payload;
    } finally {
      clearTimeout(timer);
      _nationalPromise = null;
    }
  })().catch((error) => {
    if (error?.name !== 'AbortError') {
      console.warn('[Data:IRVE-FR] national rollup failed:', error?.message || error);
      _nationalError = error?.message || 'national rollup unavailable';
    }
    return null;
  });
  return _nationalPromise;
}

function hideDepartements() {
  for (const parts of _depEntities.values()) {
    for (const entity of parts) entity.show = false;
  }
  _overlayHost.clearSource(IRVE_FR_LABEL_SOURCE_ID);
}

/**
 * Enter (or refresh) the national regime.
 *
 * The rollup is one national answer, so panning inside this regime must not
 * repaint anything: `_nationalPainted` makes every camera nudge after the
 * first a no-op. Only a new rollup, or re-entering the regime, repaints.
 *
 * @param {{force?: boolean}} [options] `force` re-asks the proxy, which
 *   normally answers from its own 24-hour cache — that is how a session open
 *   across midnight picks up the next day's consolidation.
 */
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
    console.warn('[Data:IRVE-FR] département polygons failed:', error?.message || error);
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
  governorRequestRender('irve-fr-national');
}

// --- Mesh regime ------------------------------------------------------------

/** Pixel size for a mesh dot — smaller than an exact site, and flatter. */
export function irveMeshPointSize(pdc) {
  const count = Number(pdc);
  if (!Number.isFinite(count) || count <= 0) return MESH_POINT_MIN_PX;
  return Math.min(MESH_POINT_MAX_PX, MESH_POINT_MIN_PX + Math.sqrt(Math.min(count, 200)) * 0.42);
}

/** Fetch the national point set once per session; the proxy caches it for a day. */
async function ensureMesh() {
  if (_mesh) return _mesh;
  if (_meshPromise) return _meshPromise;
  _meshPromise = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NATIONAL_TIMEOUT_MS);
    try {
      const response = await fetch('/api/irve-fr/mesh', { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload?.sites)) throw new Error('malformed mesh');
      _mesh = payload;
      _meshError = null;
      return payload;
    } finally {
      clearTimeout(timer);
      _meshPromise = null;
    }
  })().catch((error) => {
    if (error?.name !== 'AbortError') {
      console.warn('[Data:IRVE-FR] national mesh failed:', error?.message || error);
      _meshError = error?.message || 'national mesh unavailable';
    }
    return null;
  });
  return _meshPromise;
}

/**
 * Draw a thinned selection of real site positions for the current view.
 *
 * Re-picked on every camera settle rather than cached: the pick is a function
 * of the box, and re-running it over 39 579 tuples costs a few milliseconds
 * against a round trip that would cost a few hundred.
 */
function reconcileMesh(box) {
  const pick = selectIrveMesh(_mesh?.sites, { box });
  _meshPick = pick;

  clearSelection();
  _points.removeAll();
  _records.clear();

  for (const site of pick.picked) {
    if (_records.size >= MAX_RENDERED_SITES) break;
    const lat = site[MESH_LAT];
    const lon = site[MESH_LON];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const id = meshSiteId(site);
    if (_records.has(id)) continue;
    const band = IRVE_BAND_KEYS[site[MESH_BAND]] || 'inconnue';
    const color = irveBandColor(band);
    const size = irveMeshPointSize(site[MESH_PDC]);
    // No ground warm-up here: at these altitudes a metre of vertical error is
    // invisible, and 2 200 terrain lookups per pan would not be.
    const position = Cesium.Cartesian3.fromDegrees(lon, lat, POINT_LIFT_M);
    const point = _points.add({
      id,
      position,
      color: Cesium.Color.fromCssColorString(color),
      pixelSize: size,
      outlineColor: OUTLINE_COLOR,
      outlineWidth: 1,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
    _records.set(id, {
      id,
      // A mesh record carries only what the national sweep knows. The flag is
      // what lets the card say so instead of implying the rest is absent.
      mesh: true,
      site: { id, lat, lon, pdcDistinct: site[MESH_PDC], pdcPublished: site[MESH_PDC], topBand: band },
      point,
      position,
      carto: Cesium.Cartographic.fromCartesian(position),
      baseColor: color,
      baseSize: size,
    });
  }
  _count = _records.size;
  rebuildBeams();
  governorRequestRender('irve-fr-mesh');
}

/** Enter (or refresh) the mesh regime. */
async function loadMesh(box) {
  hideDepartements();
  _nationalPainted = false;
  dropDepartementSelection();
  _summary = null;
  _error = null;
  _loading = !_mesh;
  const generation = ++_requestGeneration;
  await ensureMesh();
  if (generation !== _requestGeneration || !_enabled || _regime !== 'mesh') return;
  _loading = false;
  if (!_mesh) {
    _error = _meshError || 'national mesh unavailable';
    _status = 'error';
    return;
  }
  reconcileMesh(box);
  _lastUpdate = Number(_mesh.fetchedAt) || Date.now();
  _status = _count > 0 ? 'ready' : 'empty';
}

// --- Site regime ------------------------------------------------------------

/** Replace the rendered set with a viewport answer. */
function reconcile(payload) {
  const sites = Array.isArray(payload?.sites) ? payload.sites : [];

  clearSelection();
  _points.removeAll();
  _records.clear();

  const warm = [];
  for (const site of sites) {
    if (_records.size >= MAX_RENDERED_SITES) break;
    const id = site?.id;
    if (!id || _records.has(id)) continue;
    if (!Number.isFinite(site.lat) || !Number.isFinite(site.lon)) continue;
    const position = sitePosition(site);
    const color = irveBandColor(site.topBand);
    const size = irveSitePointSize(site.pdcDistinct);
    const point = _points.add({
      id,
      position,
      color: Cesium.Color.fromCssColorString(color),
      pixelSize: size,
      outlineColor: OUTLINE_COLOR,
      outlineWidth: 1,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      translucencyByDistance: new Cesium.NearFarScalar(500, 1.0, 60_000, 0.35),
    });
    _records.set(id, {
      id,
      site,
      point,
      position,
      // Cached so the beam sweep never re-derives a cartographic per frame.
      carto: Cesium.Cartographic.fromCartesian(position),
      baseColor: color,
      baseSize: size,
    });
    warm.push(site);
  }

  _count = _records.size;
  rebuildBeams();
  warmGroundFloor(warm.slice(0, GROUND_WARM_LIMIT));
  governorRequestRender('irve-fr-reconcile');
}

function clearSites() {
  if (_selectedId && !_selectedId.startsWith('dep:')) clearSelection();
  if (_points) _points.removeAll();
  // The national regime draws départements, not sites, so every beam has to go
  // dark. Hidden rather than removed: the collection is a pool.
  if (_beams) for (let i = 0; i < _beams.length; i += 1) _beams.get(i).show = false;
  _records.clear();
  _count = 0;
  _summary = null;
  _meshPick = null;
}

async function loadViewport({ force = false } = {}) {
  if (!_enabled || !_viewer) return;

  const regime = updateRegime(_viewer);
  if (regime === 'national') {
    _lastBox = null;
    _meshPick = null;
    await loadNational({ force });
    return;
  }

  if (regime === 'mesh') {
    _lastBox = null;
    await loadMesh(cameraMeshBox(_viewer));
    return;
  }

  const box = cameraIrveBox(_viewer);
  if (!box) {
    // Inside the altitude gate but looking at more than the proxy will answer
    // — an oblique horizon shot. The maillage is the honest fallback, not an
    // empty map.
    _regime = 'mesh';
    await loadMesh(cameraMeshBox(_viewer));
    return;
  }

  hideDepartements();
  _nationalPainted = false;
  _meshPick = null;
  dropDepartementSelection();

  const key = [box.south, box.west, box.north, box.east].map((v) => v.toFixed(3)).join(',');
  if (!force && key === _lastBox && _inFlight) return;
  _lastBox = key;

  const generation = ++_requestGeneration;
  _inFlight?.abort?.();
  const controller = new AbortController();
  _inFlight = controller;
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  _loading = true;

  try {
    const params = new URLSearchParams({
      south: box.south.toFixed(5),
      west: box.west.toFixed(5),
      north: box.north.toFixed(5),
      east: box.east.toFixed(5),
    });
    const response = await fetch(`/api/irve-fr/sites?${params}`, { signal: controller.signal });
    if (generation !== _requestGeneration) return;
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const body = await response.json();
        if (body?.error) detail = String(body.error);
      } catch { /* keep the status-code detail */ }
      throw new Error(detail);
    }
    const payload = await response.json();
    if (generation !== _requestGeneration || !_enabled) return;

    reconcile(payload);
    const { sites, ...summary } = payload;
    _summary = summary;
    _lastUpdate = Date.now();
    _error = null;
    _status = _count > 0 ? 'ready' : 'empty';
  } catch (error) {
    if (error?.name === 'AbortError') return;
    if (generation !== _requestGeneration) return;
    console.warn('[Data:IRVE-FR] viewport load failed:', error?.message || error);
    _error = error?.message || 'IRVE register unavailable';
    _status = 'error';
  } finally {
    clearTimeout(timer);
    if (generation === _requestGeneration) {
      _loading = false;
      _inFlight = null;
    }
  }
}

/** Drop a département selection that the site regime can no longer show. */
function dropDepartementSelection() {
  if (_selectedId?.startsWith('dep:')) clearSelection();
}

function onCameraChanged() {
  if (!_enabled) return;
  clearTimeout(_cameraDebounceTimer);
  _cameraDebounceTimer = setTimeout(() => { void loadViewport(); }, CAMERA_DEBOUNCE_MS);
}

/** Deterministic subsample of rendered sites for the detection overlay. */
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
    const pdc = Number(record.site?.pdcDistinct) || 0;
    result.push({
      position: record.position,
      sourceId: record.id,
      id: `${pdc} PDC`,
      type: 'EVSE',
      skipLabel: record.id === _selectedId,
    });
    if (result.length >= maxCount) break;
  }
  return result;
}

/** One line under the layer's toggle: what this view actually contains. */
export function buildIrveLoadingLabel({
  regime = _regime,
  status = _status,
  loading = _loading,
  count = _count,
  summary = _summary,
  national = _national,
  meshPick = _meshPick,
} = {}) {
  if (regime === 'mesh') {
    if (loading) return 'reading the national maillage...';
    if (status === 'error') return '';
    if (!meshPick) return '';
    if (!meshPick.inBox) return 'no charge point published in view';
    // Naming both numbers is the whole contract of this regime: a thinned map
    // that does not say it is thinned claims France has 1 100 charge points.
    const parts = meshPick.thinned
      ? [`${fr(meshPick.picked.length)} of ${fr(meshPick.inBox)} sites — sampled maillage`]
      : [`${fr(meshPick.inBox)} sites — all of them`];
    parts.push('zoom in for detail');
    return parts.join(' · ');
  }
  if (regime === 'national') {
    if (loading) return 'reading the national register...';
    if (status === 'error') return '';
    if (!national) return '';
    const parts = [`${fr(national.pdcAssigned ?? 0)} charge points · ${national.painted ?? 0} départements`];
    if (national.pdcUnassigned > 0) parts.push(`${fr(national.pdcUnassigned)} outre-mer not mapped`);
    if (national.truncated || national.stalledStripes > 0) parts.push('partial sweep');
    if (national.stale) parts.push('cached');
    parts.push('zoom in for sites');
    return parts.join(' · ');
  }
  if (loading) return count ? 'refreshing register...' : 'reading IRVE register...';
  if (status === 'empty') return 'no charge point published here';
  if (status !== 'ready' || !summary) return '';

  const parts = [`${fr(summary.pdcDistinct ?? 0)} charge points`];
  const duplicated = (summary.pdcPublished ?? 0) - (summary.pdcDistinct ?? 0);
  if (duplicated > 0) parts.push(`${fr(duplicated)} double-published merged`);
  if (summary.pdcWithheld > 0) parts.push(`${fr(summary.pdcWithheld)} misplaced withheld`);
  if (summary.truncated) parts.push('capped');
  if (summary.stale) parts.push('cached');
  return parts.join(' · ');
}

/**
 * French EV charge-point layer.
 * @type {Object}
 */
const irveFranceLayer = {
  id: IRVE_FR_LAYER_ID,
  name: 'Bornes IRVE (FR)',
  icon: '🔌',
  source: 'transport.data.gouv.fr / ODRÉ',
  updateInterval: POLL_INTERVAL_MS,

  init(viewer) {
    _viewer = viewer;
    _points = new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT });
    _points.show = false;
    viewer.scene.primitives.add(_points);
    registerSpriteCollection(IRVE_FR_LAYER_ID, _points);
    // NOT registered with the sprite order: that registry arbitrates
    // near-plane-clamped sprite collections, and a beam is depth-bearing
    // geometry that has to sort against the world rather than against sprites.
    _beams = new Cesium.PolylineCollection();
    _beams.show = false;
    viewer.scene.primitives.add(_beams);
    _beamSweepDirty = true;
    _beamSweptFrom = null;

    _enabled = false;
    _records = new Map();
    _selectedId = null;
    _count = 0;
    _lastUpdate = null;
    _loading = false;
    _error = null;
    _status = 'idle';
    _summary = null;
    _regime = 'national';
    _nationalPainted = false;
    _meshPick = null;
    _lastBox = null;
    _classificationType = irveClassificationTypeForScene(viewer?.scene);
    if (typeof window !== 'undefined' && !_mapStackListener) {
      _mapStackListener = (event) => {
        applyClassification(event?.detail?.activeId
          ? irveClassificationTypeForStack(event.detail.activeId)
          : irveClassificationTypeForScene(_viewer?.scene));
      };
      window.addEventListener('gev:map-stack-changed', _mapStackListener);
    }

    _overlayHost.setVisible(IRVE_FR_OVERLAY_SOURCE_ID, false);
    _overlayHost.setVisible(IRVE_FR_LABEL_SOURCE_ID, false);
    restoreSpriteOrder(viewer);
  },

  enable(viewer) {
    _enabled = true;
    _error = null;
    _points.show = true;
    if (_beams) _beams.show = true;
    markBeamSweepDirty();
    if (_depDataSource) _depDataSource.show = true;
    _overlayHost.setVisible(IRVE_FR_OVERLAY_SOURCE_ID, true);
    _overlayHost.setVisible(IRVE_FR_LABEL_SOURCE_ID, true);
    installClickHandler(viewer);
    registerPickOwner(IRVE_FR_LAYER_ID, (pickedId) => _records.has(pickedId));

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
    _meshPick = null;
    clearTimeout(_cameraDebounceTimer);
    _cameraDebounceTimer = null;
    _inFlight?.abort?.();
    _inFlight = null;

    clearSelection();
    clearSites();
    hideDepartements();
    if (_depDataSource) _depDataSource.show = false;
    _overlayHost.setVisible(IRVE_FR_OVERLAY_SOURCE_ID, false);
    _overlayHost.setVisible(IRVE_FR_LABEL_SOURCE_ID, false);

    if (_clickHandler) {
      _clickHandler.destroy();
      _clickHandler = null;
    }
    document.removeEventListener('keydown', onKeyDown);
    unregisterPickOwner(IRVE_FR_LAYER_ID);

    if (_cameraChangedAttached) {
      viewer.camera.changed.removeEventListener(onCameraChanged);
      _cameraChangedAttached = false;
    }
    if (_preRenderRemover) {
      _preRenderRemover();
      _preRenderRemover = null;
    }

    _points.show = false;
    if (_beams) _beams.show = false;
    _loading = false;
    _status = 'idle';
    _lastBox = null;
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
    const label = buildIrveLoadingLabel();
    if (label) stats.loadingLabel = label;
    if (_regime === 'national' ? _national?.stale : _summary?.stale) stats.stale = true;
    if (_error) stats.error = _error;
    return stats;
  },

  /** Viewport provenance for the attribution popover and analyst surfaces. */
  getViewportSummary() {
    return _summary ? { ..._summary } : null;
  },

  /** What the maillage drew, and out of how many. */
  getMeshSummary() {
    if (!_meshPick) return null;
    return {
      shown: _meshPick.picked.length,
      inBox: _meshPick.inBox,
      budget: _meshPick.budget,
      cells: _meshPick.cells,
      thinned: _meshPick.thinned,
      nationalSites: _mesh?.siteCount ?? null,
    };
  },

  /** National rollup, for the analyst and for tests. */
  getNationalSummary() {
    if (!_national) return null;
    const { departements, ...rest } = _national;
    return { ...rest, regime: _regime };
  },

  /**
   * Colour legend for the control-panel row — whichever scale is actually on
   * screen, never both. At national altitude it is the quantile ramp with the
   * measured bin boundaries; over a city it is the power bands, counted in
   * charge points rather than in sites.
   * @returns {{ chips: Array<object>, legend: Array<object> }}
   */
  getRowControls() {
    if (_regime === 'national') {
      if (!_national) return { chips: [], legend: [] };
      // Height first, then colour, because the height is now the primary
      // variable — and both halves get their ruler, since a prism whose
      // legend gives no numbered marks says only "more than that one" (D1).
      // The counts are DÉPARTEMENTS, and the four non-colour rows (the two
      // titles, the ticks, the refusals) are the ones `manager.js` renders
      // with an empty aligned swatch.
      const tally = prismTally(irveNationalPrismRows(), IRVE_PRISM_SCALE);
      // The drape notice is true only for the FLAT marks. A prism classifies
      // nothing, but `paintDepartementFootprint` puts `classificationType`
      // back on the two flat cases — measured zero, and no row at all — so
      // under Google 3D Tiles those aplats DO climb the façades and that has
      // to be declared. Same rule and same shape as `supFrance` and
      // `schoolsFrance`; irve was the only prism layer that stayed silent.
      const flat = (tally.zero || 0) + (tally.noValue || 0);
      return {
        chips: [],
        legend: prismLegend(IRVE_PRISM_SCALE, tally),
        surfaceFill: flat > 0,
      };
    }
    const tally = new Map();
    for (const record of _records.values()) {
      if (record.mesh) {
        // A mesh record knows one band, not a split — so the maillage legend
        // counts SITES by their top band, and says so in the blurb. Counting
        // them as charge points would silently understate every big car park.
        const band = record.site?.topBand;
        if (band) tally.set(band, (tally.get(band) || 0) + 1);
        continue;
      }
      const bands = record.site?.bands || {};
      for (const band of IRVE_BAND_KEYS) {
        const count = Number(bands[band]) || 0;
        if (count > 0) tally.set(band, (tally.get(band) || 0) + count);
      }
    }
    const meshRegime = _regime === 'mesh';
    const legend = IRVE_BAND_KEYS
      .filter((band) => tally.get(band) > 0)
      .map((band) => ({
        label: irveBandLabel(band),
        color: irveBandColor(band),
        count: tally.get(band),
        blurb: meshRegime
          // Naming the sample is the point: this mix is what the thinning
          // drew, close to the real one but not it. See `irveMesh.js`.
          ? `${BAND_BLURBS[band]} Counted as SITES over the sampled maillage — a sample of the mix in view, not the national figure.`
          : BAND_BLURBS[band],
      }));
    return { chips: [], legend };
  },

  destroy(viewer) {
    if (_enabled) this.disable(viewer);
    else {
      clearSelection();
      _overlayHost.setVisible(IRVE_FR_OVERLAY_SOURCE_ID, false);
      _overlayHost.setVisible(IRVE_FR_LABEL_SOURCE_ID, false);
      if (_clickHandler) {
        _clickHandler.destroy();
        _clickHandler = null;
      }
      document.removeEventListener('keydown', onKeyDown);
      unregisterPickOwner(IRVE_FR_LAYER_ID);
    }
    if (_preRenderRemover) {
      _preRenderRemover();
      _preRenderRemover = null;
    }
    if (typeof window !== 'undefined' && _mapStackListener) {
      window.removeEventListener('gev:map-stack-changed', _mapStackListener);
      _mapStackListener = null;
    }
    if (_depDataSource) {
      viewer.dataSources?.remove?.(_depDataSource, true);
      _depDataSource = null;
    }
    _depEntities.clear();
    _depMeta = new Map();
    _depShapesPromise = null;
    if (_points) {
      unregisterSpriteCollection(IRVE_FR_LAYER_ID, _points);
      viewer.scene.primitives.remove(_points);
      _points = null;
    }
    if (_beams) {
      viewer?.scene?.primitives?.remove?.(_beams);
      _beams = null;
    }
    _beamSweptFrom = null;
    _records.clear();
    _viewer = null;
  },
};

/** Seed rendered records so selection/card/legend paths run without WebGL. */
export function _setIrveStateForTest({
  viewer, records, overlayHost, summary, status, count, regime, national, depEntities, depMeta,
  mesh, meshPick,
} = {}) {
  _mesh = mesh || null;
  _meshPick = meshPick || null;
  _viewer = viewer || null;
  _records = new Map((records || []).map((record) => [record.id, record]));
  _selectedId = null;
  _overlayHost = overlayHost || DEFAULT_OVERLAY_HOST;
  _summary = summary || null;
  _status = status || 'ready';
  _count = Number.isFinite(count) ? count : _records.size;
  _loading = false;
  _regime = regime || 'sites';
  _national = national || null;
  _depEntities = new Map(depEntities || []);
  _depMeta = new Map(depMeta || []);
}

/** Exercise the production selection path in focused runtime tests. */
export function _selectIrveSiteForTest(id) {
  selectSite(id);
}

/** Exercise the production département selection path. */
export function _selectIrveDepartementForTest(code) {
  selectDepartement(code);
}

/**
 * Drive the map-stack classification switch without a window event.
 *
 * The property under test is the one the prism forced: a stack change must
 * still re-arm every FLAT footprint, and must not write onto a prism, where
 * Cesium reads the property and ignores it.
 */
export function _applyIrveClassificationForTest(next) {
  applyClassification(next);
}

/**
 * Run the production paint pass over seeded entities.
 *
 * The four marks this layer owes A1 — prism, striped prism, flat footprint,
 * grid — are decided here and nowhere else, so a test that asserted them from
 * a reimplementation would prove nothing about what ships.
 */
export function _repaintIrveDepartementsForTest() {
  repaintDepartements();
}

/** Exercise the production clear path and restore the production host seam. */
export function _clearIrveSelectionForTest() {
  clearSelection();
  _overlayHost = DEFAULT_OVERLAY_HOST;
  _national = null;
  _nationalPainted = false;
  _mesh = null;
  _meshPick = null;
  _depEntities = new Map();
  _depMeta = new Map();
  _regime = 'sites';
}

/** Row-control legend, for tests that do not construct a viewer. */
export function _irveRowControlsForTest() {
  return irveFranceLayer.getRowControls();
}

/** Ambient département label cohort, for tests that do not construct a viewer. */
export function _irveDepartementOverlayForTest() {
  const entries = [];
  for (const row of _national?.departements || []) {
    if (!(row.pdc > 0)) continue;
    const anchor = _depMeta.get(row.code)?.anchor;
    if (!anchor) continue;
    entries.push(createIrveDepartementOverlayEntry(row, { anchor }));
  }
  return selectIrveLabelCohort(entries);
}

export default irveFranceLayer;
