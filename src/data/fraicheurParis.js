/**
 * @module fraicheurParis
 *
 * Îlots de fraîcheur (Paris) — where the city says you can get out of the heat,
 * and how much of that is true at the hour you are asking.
 *
 * `fraicheurFeed.js` reads the three refuge registers and every trap in them;
 * `fraicheurTrees.js` reads the 219 432-tree canopy and the one regime that can
 * honestly draw it. This file is the drawing, and it is the only place the four
 * registers are seen at once.
 *
 * ── FOUR objects, TWO regimes, and the byte counts that settle it ───────────
 *
 * Four registers of four different geometries and four different sizes, and
 * they do not split by zoom — they split by whether the whole thing fits.
 * Measured 2026-09-02 through the exact `exports/geojson` URLs the proxy
 * builds, with the field lists the feed exports:
 *
 *   équipements     535 POINTS      290 718 B decoded
 *   espaces verts   984 POLYGONS  9 216 103 B decoded (584 Polygon + 400 Multi)
 *   fontaines     1 323 POINTS      422 828 B decoded
 *   ────────────────────────────────────────────────────────────────────────
 *   projected together by `projectFraicheurRefuges`: 3 451 189 B of JSON,
 *   **643 105 B gzipped** — 2 205 polygon parts and 127 465 vertices.
 *
 *   arbres      219 432 POINTS  111 MB decoded for the whole file.
 *
 * So REGIME 1 is the whole city in one document. 643 KB is what `sup-fr`
 * already ships for the entire national higher-education register (0.62 MB),
 * for a city of 105 km², and the three registers are read TOGETHER — "where can
 * I cool off" is answered by a park, a mister and a tap on the same screen, and
 * three endpoints would make the first paint three round trips. No bbox query,
 * no `geoMeshThinning`, no choropleth: one fetch, and every zoom answered from
 * what the browser already holds.
 *
 * REGIME 2 is the trees, and it cannot be that. The full export is 111 MB
 * decoded; thinning it would mean the proxy buying 111 MB on every cold cache
 * to publish a few hundred dots that only say "Paris has trees". So the
 * viewport asks — `in_bbox(geo_point_2d,S,W,N,E)` on `exports/geojson`, which
 * is subject to neither of the caps `records` carries (100 rows a page, and
 * *"Invalid value for sum of offset + limit API parameter: 10099 was found but
 * <= 10000 is expected."* past record 10 000). Measured on the 0.020° × 0.030°
 * central box: 5 287 trees, 1 690 170 B decoded, 119 316 B gzipped once
 * projected. The gate is ALTITUDE, 1 500 m, for the reason `cadastreFeed.js`
 * measured on this globe: at 240 m over Paris a nadir camera sees 0.0038° of
 * longitude and a 25°-pitched one sees 0.0397°, so a span gate refuses the
 * layer in the street.
 *
 * ── What each channel claims ───────────────────────────────────────────────
 *
 * FILL on a green space is `indice_veget_sup8m_2024` — the share of the ground
 * under vegetation TALLER THAN 8 m at the 2024 survey, on seven fixed bands.
 * Not area, deliberately: area says how big a park is and this says how much of
 * it casts shade at three in the afternoon, which is the only kind of green a
 * heatwave cares about. `nue` (exactly 0, 66 spaces) is its OWN band and not
 * the bottom of the ramp, and the one space that publishes no index at all is
 * grey. The register also publishes `p_vegetation_h`, which is a DIFFERENT
 * number on 903 of the 953 rows carrying both; the card prints both and calls
 * neither a correction.
 *
 * A HOT STROKE around a green space means `canicule_ouverture = "Oui"`, and
 * this is the finding the layer exists to put on a screen: **23 of the 984**.
 * Verified directly against the portal — `where=canicule_ouverture="Oui"`
 * answers `{"total_count": 23}` — because the facet returns THREE `Oui` rows,
 * (Oui,null)=3, (Oui,Non)=11, (Oui,Oui)=9, and adding two of the three gives
 * the 20 an earlier reading of this dataset reported. Nine are also 24 h. And
 * eleven of the twenty-three have `indice_veget_sup8m_2024 = 0`: their median
 * canopy share is 0.0280 against 0.3197 across all 983 spaces that carry the
 * metric, and eight of the eleven are `categorie: "Jardiniere"` — planters,
 * five of them on the Porte Maillot roundabout. Paris's declared heatwave list
 * is, in the majority, traffic islands with nothing to shut. The stroke is
 * 293 polygon parts and 6 536 vertices, so it costs one cheap second batch.
 *
 * COLOUR on an equipment dot is the MECHANISM, folded from the published
 * `type` — and the fold is the point. Read as a `type` list this register looks
 * like a municipal directory that wandered into a climate dataset: 127 ombrières
 * pérennes, 125 lieux de culte, 87 brumisateurs, 65 musées, 39 piscines, 19
 * mairies d'arrondissement, 17 bains-douches, 16 bibliothèques, 13 terrains de
 * boules, 12 ombrières temporaires, 11 baignades extérieures, 4 découverte et
 * initiation. A church is on that list because five metres of limestone holds
 * last night's temperature through the afternoon, and so is a town hall, a
 * museum and a library — 225 of the 535 are cold stone you go inside, the
 * biggest family and the one nobody guesses. Naming the mechanism is what turns
 * the list back into what it is; flattening it to "amenity" is what would hide
 * it.
 *
 * COLOUR on a fountain is `dispo`, which is live: 1 238 OUI against 85 NON, and
 * the 85 carry a stated outage window. Ten of them are outside a window that
 * has already ended, so the card says "the flag has not caught up" rather than
 * "closed".
 *
 * COLOUR on a tree is whether it was MEASURED at all, and SIZE is the published
 * height capped at 25 m. `hauteurenm = 0` is on 19 407 of the 219 432 trees and
 * it means "not surveyed", not "a seedling" — those get the grey band and the
 * minimum size, never a scaled dot.
 *
 * ── The clock is recomputed here, on the browser's minute ──────────────────
 *
 * The proxy folds the pack and its summary at fetch time and caches for an
 * hour. That summary cannot be shown: measured over the real 984 + 535 rows,
 * "open right now" is **757 green spaces and 93 cool spots at 14 h 00 Paris**
 * and **367 and 0 at 01 h 30**. An hour-old answer to "where can I cool off
 * now" is a wrong answer, so this layer re-runs `summarizeFraicheurRefuges` on
 * its own clock whenever the Paris minute changes — 5.0 ms over the whole pack,
 * measured — and `Europe/Paris` and not the browser's zone, because an operator
 * in Denver must not be shown a Paris park as open eight hours after it shut.
 *
 * ── What is NOT drawn, and is counted instead ──────────────────────────────
 *
 * Nothing is placed that was not published: all 535 equipment rows, all 1 323
 * fountains and all 219 432 trees carry a real coordinate, and 984 of 984 green
 * spaces keep at least one usable ring — 22 rings out of 3 439 fall below a
 * triangle at one metre and are dropped and counted, and no space loses all of
 * its geometry that way. **682 of the 984 green spaces publish a timetable
 * whose own validity window had already expired** on the day this was measured,
 * 638 of them the same `du 01/05/26 au 31/08/26`; that is on the row, on the
 * card, and on the same line as the answer it qualifies. 214 spaces and 423
 * cool spots publish no readable weekday hours at all and are reported as
 * `unknown`, never as `closed`.
 *
 * ── One palette, read across three modules ─────────────────────────────────
 *
 * Four registers on one screen means the canopy ramp in `fraicheurFeed.js`, the
 * tree bands in `fraicheurTrees.js` and the equipment and fountain palettes
 * here have to be read as ONE, and two collisions were live before the test
 * that now forbids them: the `mesure` tree band was exactly `#2f8b43`, which is
 * the canopy ramp's 40–55 % fill, so a measured tree standing on any of those
 * 164 parks was painted in its own background; and the residual equipment
 * family was amber, which the 183 remarkable trees own. The rule that replaced
 * them is one line long: **grey `#8a93a6` means "the register did not measure
 * this" and nothing else** — the one space with no canopy index, the 19 407
 * trees with no surveyed height, and any fountain that stops publishing
 * `dispo` — so no other channel may take it, and no two channels may share
 * anything at all.
 *
 * ── Stacking ───────────────────────────────────────────────────────────────
 *
 * The fills are ground-clamped classification polygons over central Paris, and
 * so are `cadastre-fr`'s parcels and `urbanisme-gpu`'s translucent PLU zones.
 * All three on at once is a three-way surface stack, so this layer follows the
 * same rule the others do: the classification surface is derived from the live
 * map stack and re-derived on every `gev:map-stack-changed`, and the fill alpha
 * is low enough (0.34) that a parcel boundary underneath still reads.
 */

import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import {
  registerSpriteCollection,
  restoreSpriteOrder,
  unregisterSpriteCollection,
} from './spriteOrder.js';
import { cachedGroundFloor, warmGroundFloor } from './groundFloor.js';
import { boxKey, boxesIntersect, focusedViewBox, snapBoxOutward } from './viewportBox.js';
import { cameraViewBox } from './viewGate.js';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { powerClassificationTypeForScene, powerClassificationTypeForStack } from './powerGrid.js';
import {
  FRAICHEUR_CANOPY_BANDS,
  FRAICHEUR_CANOPY_UNKNOWN,
  FRAICHEUR_COVERAGE,
  FRAICHEUR_FAMILIES,
  FRAICHEUR_FAMILY_BLURBS,
  FRAICHEUR_FAMILY_LABELS,
  FRAICHEUR_SOURCE,
  equipmentCardLines,
  fountainCardLines,
  fraicheurLoadingLabel,
  parisClock,
  spaceCardLines,
  summarizeFraicheurRefuges,
} from './fraicheurFeed.js';
import {
  FRAICHEUR_TREE_BANDS,
  FRAICHEUR_TREE_BOX_STEP_DEG,
  FRAICHEUR_TREE_BUDGET,
  FRAICHEUR_TREE_MAX_ALTITUDE_M,
  FRAICHEUR_TREE_MAX_BOX_DEG,
  FRAICHEUR_TREE_SOURCE,
  fraicheurTreeBand,
  fraicheurTreeLabel,
  fraicheurTreeSize,
  treeCardLines,
} from './fraicheurTrees.js';

/** Layer id — also the share-link registry key and the voice-tool enum value. */
export const FRAICHEUR_FR_LAYER_ID = 'fraicheur-fr';

/** Selected-object card, on its own protected overlay source. */
export const FRAICHEUR_FR_OVERLAY_SOURCE_ID = 'fraicheur-fr-selected';
export const FRAICHEUR_FR_OVERLAY_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 1,
  moving: false,
});

/** Keyless, same-origin. See `fraicheurParisProxy` in vite.config.js. */
export const FRAICHEUR_REFUGES_URL = '/api/fraicheur-fr/refuges';
export const FRAICHEUR_TREES_URL = '/api/fraicheur-fr/arbres';

/**
 * The rectangle the layer will fetch inside, from the feed's own measurement of
 * every coordinate in all four registers: lat 48.7423 → 48.9122, lon 2.2102 →
 * 2.4698, padded to whole hundredths. NOT the city boundary — Paris buries and
 * waters its dead outside its own walls, and 159 fountains and 25 045 trees
 * live out there.
 */
export const FRAICHEUR_PARIS_BOX = FRAICHEUR_COVERAGE;

/**
 * Idle refresh of the refuge pack.
 *
 * One hour, and the two upstream cadences are what fix it: the equipment
 * register was rebuilt 2026-09-01T05:45:08Z and the fountains 2026-08-31T07:42Z
 * — daily — and `horaires_periode` on the equipment is a ONE-WEEK validity
 * window ("du 31/08/26 au 06/09/26"), so its hours go stale in days rather than
 * months. `statut_ouverture` on a brumisateur reads "Eteint"/"Ouvert" and is the
 * one field in the pack that can move inside a day. The clock over that pack is
 * a different question and is answered every minute, locally — see
 * `refreshSummary`.
 */
const POLL_INTERVAL_MS = 60 * 60_000;
const REQUEST_TIMEOUT_MS = 45_000;
const CAMERA_DEBOUNCE_MS = 400;

/** Card anchor lift above the ground floor, in metres. */
const CARD_LIFT_M = 4;
/** Ground-floor warm-up budget: card anchors, not every dot. */
const FLOOR_WARM_LIMIT = 400;

/**
 * Fill alpha for a green space.
 *
 * 0.34 and not more, because these are ground-clamped classification polygons
 * over the same central Paris that `cadastre-fr` and `urbanisme-gpu` clamp
 * theirs to, and a parcel boundary under a park has to survive the stack.
 */
export const FRAICHEUR_FILL_ALPHA = 0.34;
/** Hot stroke on the 23 spaces that declare a heatwave arrangement. */
export const FRAICHEUR_CANICULE_COLOR = '#ff6f3c';
const CANICULE_WIDTH_PX = 3;
const CANICULE_ALPHA = 0.95;

const SELECTED_COLOR = '#00ffff';
const SELECTED_WIDTH_PX = 5;
const SELECTED_POINT_BONUS_PX = 5;

const OUTLINE_COLOR = Cesium.Color.fromCssColorString('#0b1220').withAlpha(0.85);
const EQUIPMENT_PX = 9;
const FOUNTAIN_PX = 5;
const TREE_MIN_PX = 3;
const TREE_MAX_PX = 9;

/**
 * The five cooling mechanisms, in colour.
 *
 * Deliberately NOT a green ramp: the polygons underneath already own green, and
 * a green dot on a green park is not a dot. The family is read on hue and the
 * register it came from is read on size — 9 px for the 535 listed refuges, 5 px
 * for the 1 323 taps, 3–9 px for the trees.
 */
export const FRAICHEUR_FAMILY_COLORS = Object.freeze({
  // Cold stone you go INSIDE — an interior colour, and explicitly not a grey.
  // Grey is reserved across this whole layer for "the register did not measure
  // this": the one space with no canopy index, the 19 407 trees with no
  // surveyed height, and any fountain that stops publishing `dispo`.
  pierre: '#7e57c2',
  ombre: '#8d6e63',
  brume: '#4dd0e1',
  bain: '#1565c0',
  // The register's own residual bucket, in a hue that belongs to no other
  // channel — it must never be mistaken for shade, water or stone, and amber
  // was not available because the 183 remarkable trees own it.
  'plein-air': '#ec407a',
});

/** Colour for one equipment family; an unmapped family takes the residual. */
export function fraicheurFamilyColor(family) {
  return FRAICHEUR_FAMILY_COLORS[family] || FRAICHEUR_FAMILY_COLORS['plein-air'];
}

/**
 * The three fountain states, and there are three because `dispo` is a STRING
 * pair and not a boolean — a future null must not silently become "available".
 */
export const FRAICHEUR_FOUNTAIN_STATES = Object.freeze([
  Object.freeze({
    id: 'en-service', label: 'Fontaine en service', color: '#26a69a',
    blurb: '1 238 des 1 323 fontaines portent dispo = « OUI ». 72 sont brumisantes, et elles ne sont PAS parmi les 87 brumisateurs de l’autre registre.',
  }),
  Object.freeze({
    id: 'hors-service', label: 'Fontaine hors service', color: '#e53935',
    blurb: '85 fontaines portent dispo = « NON », avec un motif et une fenêtre d’indisponibilité. 10 d’entre elles ont dépassé leur propre date de fin.',
  }),
  Object.freeze({
    id: 'non-publiee', label: 'Disponibilité non publiée', color: '#8a93a6',
    blurb: 'dispo absent. Aucune ligne du relevé du 2026-09-02 n’est dans cet état — la bande existe parce que le champ est du texte, pas un booléen.',
  }),
]);

/** The state one projected fountain is in. */
export function fraicheurFountainState(fountain) {
  if (fountain?.available === true) return FRAICHEUR_FOUNTAIN_STATES[0];
  if (fountain?.available === false) return FRAICHEUR_FOUNTAIN_STATES[1];
  return FRAICHEUR_FOUNTAIN_STATES[2];
}

/** Fill colour for one projected green space, by canopy band. */
export function fraicheurSpaceColor(space) {
  const band = [...FRAICHEUR_CANOPY_BANDS, FRAICHEUR_CANOPY_UNKNOWN]
    .find((entry) => entry.id === space?.band);
  return (band || FRAICHEUR_CANOPY_UNKNOWN).color;
}

/** Colour for one projected tree, by whether its height was measured at all. */
export function fraicheurTreeColor(tree) {
  const id = fraicheurTreeBand(tree);
  return (FRAICHEUR_TREE_BANDS.find((band) => band.id === id) || FRAICHEUR_TREE_BANDS[1]).color;
}

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});
let _overlayHost = DEFAULT_OVERLAY_HOST;

// --- Runtime state ----------------------------------------------------------
let _viewer = null;
let _enabled = false;
/** @type {Map<string, object>} render id → record */
let _records = new Map();
let _payload = null;
let _summary = null;
let _summaryMinute = null;
let _treePayload = null;
let _treeStatus = 'idle';
let _treeBoxKey = null;
/** Probe count for the box last asked for, kept even when it was refused. */
let _treeTotal = null;
/** @type {?Cesium.PointPrimitiveCollection} 219 432-strong register, bottom. */
let _treePoints = null;
/** @type {?Cesium.PointPrimitiveCollection} */
let _fountainPoints = null;
/** @type {?Cesium.PointPrimitiveCollection} */
let _equipmentPoints = null;
/** @type {?Cesium.GroundPrimitive} */
let _fills = null;
/** @type {?Cesium.GroundPolylinePrimitive} */
let _caniculeStrokes = null;
/** @type {?Cesium.GroundPolylinePrimitive} */
let _highlight = null;
let _selectedId = null;
let _clickHandler = null;
let _moveEndRemover = null;
let _debounceTimer = null;
let _abort = null;
let _treeAbort = null;
let _mapStackListener = null;
let _classificationType = Cesium.ClassificationType.BOTH;
/** @type {?boolean} `GroundPolylinePrimitive.isSupported`, checked once. */
let _groundLinesSupported = null;
let _loading = false;
let _error = null;
let _status = 'idle';
let _stale = false;
let _lastUpdate = null;
let _inView = false;
/**
 * A pinned instant, for tests only.
 *
 * Every "is it open" answer this file produces reads one clock, and it has to
 * be the SAME clock in a test as in production or the test proves something
 * about `Date.now()` rather than about the layer. Null in the browser.
 * @type {?number}
 */
let _nowOverride = null;

/** The instant every open/closed answer in this file is taken at. */
function fraicheurNow() {
  return _nowOverride === null ? Date.now() : _nowOverride;
}

// --- Geometry ---------------------------------------------------------------

/**
 * Cartesian positions for one ring, dropping the repeated closing vertex.
 *
 * `PolygonGeometry` closes its own rings and a duplicated last point makes a
 * degenerate triangle at the seam; `GroundPolylineGeometry` needs the closure
 * put back, which `caniculeInstances` does explicitly.
 */
export function fraicheurRingPositions(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const last = ring.length - 1;
  const closed = ring[0][0] === ring[last][0] && ring[0][1] === ring[last][1];
  const degrees = [];
  const stop = closed ? last : ring.length;
  for (let i = 0; i < stop; i += 1) {
    const point = ring[i];
    if (!Array.isArray(point)) continue;
    const [lon, lat] = point;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    degrees.push(lon, lat);
  }
  return degrees.length >= 6 ? Cesium.Cartesian3.fromDegreesArray(degrees) : null;
}

/**
 * Where a green space's card hangs.
 *
 * The feed's `ringLabelAnchor` first — it stands INSIDE the widest part, which
 * a bounding-box centre does not for a park shaped like the Bois de Vincennes.
 * 983 of the 984 spaces carry one. The one that does not falls back to the
 * first vertex of its largest published ring, which is a coordinate the city
 * published rather than one computed from a centroid it never claimed.
 */
export function fraicheurSpaceAnchor(space) {
  const anchor = space?.anchor;
  if (Array.isArray(anchor) && Number.isFinite(anchor[0]) && Number.isFinite(anchor[1])) {
    return { lon: anchor[0], lat: anchor[1] };
  }
  let widest = null;
  for (const rings of space?.parts || []) {
    if (!widest || (rings[0]?.length || 0) > (widest[0]?.length || 0)) widest = rings;
  }
  const first = widest?.[0]?.[0];
  if (!Array.isArray(first) || !Number.isFinite(first[0]) || !Number.isFinite(first[1])) return null;
  return { lon: first[0], lat: first[1] };
}

/** Whether the camera can currently see any of the four registers' ground. */
export function fraicheurInView(viewer) {
  const box = cameraViewBox(viewer);
  if (!box) return false;
  // `cameraViewBox` unwraps east past 180 across the dateline; Paris is at +2°,
  // so a view that crossed the seam has to be tested folded back too.
  if (boxesIntersect(box, FRAICHEUR_PARIS_BOX)) return true;
  return boxesIntersect({ ...box, west: box.west - 360, east: box.east - 360 }, FRAICHEUR_PARIS_BOX);
}

/** The point on the globe the middle of the screen is looking at. */
export function fraicheurFocusPoint(viewer) {
  const scene = viewer?.scene;
  const camera = viewer?.camera;
  if (!scene || typeof camera?.pickEllipsoid !== 'function') return null;
  const width = scene.canvas?.clientWidth;
  const height = scene.canvas?.clientHeight;
  if (!width || !height) return null;
  const ellipsoid = scene.globe?.ellipsoid || Cesium.Ellipsoid.WGS84;
  const hit = camera.pickEllipsoid(new Cesium.Cartesian2(width / 2, height / 2), ellipsoid);
  if (!hit) return null;
  const carto = ellipsoid.cartesianToCartographic(hit);
  if (!carto) return null;
  const lat = Cesium.Math.toDegrees(carto.latitude);
  const lon = Cesium.Math.toDegrees(carto.longitude);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

/**
 * The tree box this camera may ask for, or the reason it may not.
 *
 * Four distinct refusals, kept distinct because each needs a different sentence:
 * no camera rectangle, a camera outside the only city this data describes, a
 * camera too high for a 3-pixel dot to mean anything, and a degenerate camera
 * whose focus point falls outside its own view. Coverage is tested BEFORE
 * altitude — a high view of the Atlantic told to descend is advice that would
 * still find nothing at sea level.
 * @param {?Cesium.Viewer} viewer
 * @returns {{box: ?object, reason: ?string}}
 */
export function fraicheurTreeViewport(viewer) {
  const view = cameraViewBox(viewer);
  if (!view) return { box: null, reason: 'no-view' };
  if (!fraicheurInView(viewer)) return { box: null, reason: 'off-coverage' };
  const altitude = viewer?.camera?.positionCartographic?.height;
  if (!Number.isFinite(altitude)) return { box: null, reason: 'no-view' };
  if (altitude > FRAICHEUR_TREE_MAX_ALTITUDE_M) return { box: null, reason: 'too-high' };
  const box = focusedViewBox(view, fraicheurFocusPoint(viewer), FRAICHEUR_TREE_MAX_BOX_DEG);
  if (!box) return { box: null, reason: 'no-view' };
  return { box: snapBoxOutward(box, FRAICHEUR_TREE_BOX_STEP_DEG), reason: null };
}

// --- Drawing ----------------------------------------------------------------

function removePrimitive(primitive) {
  if (!primitive) return;
  _viewer?.scene?.groundPrimitives?.remove?.(primitive);
}

function clearHighlight() {
  if (_highlight) {
    removePrimitive(_highlight);
    _highlight = null;
  }
}

function clearSurfaces() {
  removePrimitive(_fills);
  removePrimitive(_caniculeStrokes);
  _fills = null;
  _caniculeStrokes = null;
  clearHighlight();
}

function groundLinesSupported() {
  if (_groundLinesSupported === null && _viewer?.scene) {
    _groundLinesSupported = Cesium.GroundPolylinePrimitive.isSupported(_viewer.scene);
    if (!_groundLinesSupported) {
      console.warn('[Data:Fraîcheur FR] GroundPolylinePrimitive unsupported — canicule strokes disabled');
    }
  }
  return _groundLinesSupported !== false;
}

/**
 * Rebuild the two ground batches for the whole city.
 *
 * TWO primitives and not 984: 2 205 polygon parts batch into one
 * `GroundPrimitive` with per-instance colour, and the hot stroke on the 23
 * heatwave spaces has to be a second one because a polyline is a different
 * geometry, not because it is a different colour. `releaseGeometryInstances`
 * stays false so the selection can recolour an instance in place instead of
 * paying a second full tessellation of 127 465 vertices.
 */
function drawSpaces(spaces) {
  clearSurfaces();
  if (!_viewer?.scene?.groundPrimitives) return;
  const fillInstances = [];
  const strokeInstances = [];
  for (const space of spaces) {
    const record = _records.get(`${FRAICHEUR_FR_LAYER_ID}:${space.id}`);
    if (!record) continue;
    const color = Cesium.Color.fromCssColorString(record.color).withAlpha(FRAICHEUR_FILL_ALPHA);
    for (const rings of space.parts || []) {
      const outer = fraicheurRingPositions(rings[0]);
      if (!outer) continue;
      const holes = [];
      for (let h = 1; h < rings.length; h += 1) {
        const hole = fraicheurRingPositions(rings[h]);
        // 1 212 interior rings across 261 spaces. Dropped, a park swallows
        // whatever the city carved out of it.
        if (hole) holes.push(new Cesium.PolygonHierarchy(hole));
      }
      fillInstances.push(new Cesium.GeometryInstance({
        id: record.id,
        geometry: new Cesium.PolygonGeometry({
          polygonHierarchy: new Cesium.PolygonHierarchy(outer, holes),
          vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
        }),
        attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(color) },
      }));
      if (space.canicule === true) {
        strokeInstances.push(new Cesium.GeometryInstance({
          id: record.id,
          geometry: new Cesium.GroundPolylineGeometry({
            positions: [...outer, outer[0]],
            width: CANICULE_WIDTH_PX,
          }),
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(
              Cesium.Color.fromCssColorString(FRAICHEUR_CANICULE_COLOR).withAlpha(CANICULE_ALPHA),
            ),
          },
        }));
      }
    }
  }
  if (fillInstances.length) {
    _fills = _viewer.scene.groundPrimitives.add(new Cesium.GroundPrimitive({
      geometryInstances: fillInstances,
      appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true }),
      classificationType: _classificationType,
      asynchronous: true,
      releaseGeometryInstances: false,
    }));
    _fills.show = _enabled;
  }
  if (strokeInstances.length && groundLinesSupported()) {
    _caniculeStrokes = _viewer.scene.groundPrimitives.add(new Cesium.GroundPolylinePrimitive({
      geometryInstances: strokeInstances,
      appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
      classificationType: _classificationType,
      asynchronous: true,
      releaseGeometryInstances: false,
    }));
    _caniculeStrokes.show = _enabled;
  }
}

/** Cartesian anchor for one record's card, on the shared coarse ground floor. */
function cardPosition(record) {
  const at = record?.at;
  if (!at) return null;
  const floor = cachedGroundFloor(at.lat, at.lon);
  return Cesium.Cartesian3.fromDegrees(at.lon, at.lat, (Number.isFinite(floor) ? floor : 0) + CARD_LIFT_M);
}

/**
 * Shared, because a tree box is up to 12 500 dots and `PointPrimitive` CLONES
 * both of these into its own storage on assignment. Twelve thousand throwaway
 * `NearFarScalar`s and twelve thousand CSS colour parses per camera settle is
 * the kind of cost that only shows up on the densest box in Paris.
 */
const POINT_FADE = new Cesium.NearFarScalar(400, 1.0, 60_000, 0.35);
const _colorCache = new Map();
function cssColor(css) {
  let color = _colorCache.get(css);
  if (!color) {
    color = Cesium.Color.fromCssColorString(css);
    _colorCache.set(css, color);
  }
  return color;
}

function addPoint(collection, { id, at, color, pixelSize }) {
  if (!collection) return null;
  const floor = cachedGroundFloor(at.lat, at.lon);
  return collection.add({
    id,
    position: Cesium.Cartesian3.fromDegrees(at.lon, at.lat, (Number.isFinite(floor) ? floor : 0) + 1),
    color: cssColor(color),
    pixelSize,
    outlineColor: OUTLINE_COLOR,
    outlineWidth: 1,
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
    translucencyByDistance: POINT_FADE,
  });
}

/**
 * Rebuild every record and every primitive from the pack in hand.
 *
 * One pass over 984 + 535 + 1 323 rows, which is a linear scan the browser
 * finishes in a millisecond against a round trip that would cost hundreds —
 * the same trade `sup-fr` makes over its 6 914 sites.
 */
function drawRefuges(payload) {
  const previous = _selectedId;
  clearSelection();
  _records = new Map();
  _equipmentPoints?.removeAll();
  _fountainPoints?.removeAll();

  const warm = [];
  const spaces = Array.isArray(payload?.spaces) ? payload.spaces : [];
  for (const space of spaces) {
    const at = fraicheurSpaceAnchor(space);
    if (!at) continue;
    const id = `${FRAICHEUR_FR_LAYER_ID}:${space.id}`;
    _records.set(id, { id, kind: 'space', row: space, at, color: fraicheurSpaceColor(space) });
    if (warm.length < FLOOR_WARM_LIMIT) warm.push(at);
  }
  drawSpaces(spaces);

  for (const site of Array.isArray(payload?.equipment) ? payload.equipment : []) {
    const at = { lon: site.p[0], lat: site.p[1] };
    const id = `${FRAICHEUR_FR_LAYER_ID}:${site.id}`;
    const color = fraicheurFamilyColor(site.family);
    const point = addPoint(_equipmentPoints, { id, at, color, pixelSize: EQUIPMENT_PX });
    _records.set(id, { id, kind: 'equipment', row: site, at, color, point, basePixelSize: EQUIPMENT_PX });
    if (warm.length < FLOOR_WARM_LIMIT) warm.push(at);
  }
  for (const fountain of Array.isArray(payload?.fountains) ? payload.fountains : []) {
    const at = { lon: fountain.p[0], lat: fountain.p[1] };
    const id = `${FRAICHEUR_FR_LAYER_ID}:${fountain.id}`;
    const color = fraicheurFountainState(fountain).color;
    const point = addPoint(_fountainPoints, { id, at, color, pixelSize: FOUNTAIN_PX });
    _records.set(id, { id, kind: 'fountain', row: fountain, at, color, point, basePixelSize: FOUNTAIN_PX });
  }
  drawTrees(_treePayload);
  if (warm.length) warmGroundFloor(warm);
  governorRequestRender('fraicheur-fr-draw');
  // A refresh must not silently drop the card the operator was reading; the
  // object has not moved, and its render id carries its geometry, so it is the
  // same id on the other side of the rebuild.
  if (previous && _records.has(previous)) selectObject(previous);
}

/** Repaint the tree collection from one viewport payload. */
function drawTrees(payload) {
  _treePoints?.removeAll();
  for (const [id, record] of [..._records]) {
    if (record.kind === 'tree') _records.delete(id);
  }
  const trees = Array.isArray(payload?.trees) ? payload.trees : [];
  for (const tree of trees) {
    const at = { lon: tree.p[0], lat: tree.p[1] };
    const id = `${FRAICHEUR_FR_LAYER_ID}:${tree.id}`;
    if (_records.has(id)) continue;
    const color = fraicheurTreeColor(tree);
    const pixelSize = tree.remarquable === true
      ? TREE_MAX_PX
      : fraicheurTreeSize(tree.height, TREE_MIN_PX, TREE_MAX_PX);
    const point = addPoint(_treePoints, { id, at, color, pixelSize });
    _records.set(id, { id, kind: 'tree', row: tree, at, color, point, basePixelSize: pixelSize });
  }
  governorRequestRender('fraicheur-fr-trees');
}

/** Re-classify against the active surface, rebuilding the baked ground batches. */
function applyClassification(next) {
  if (next === undefined || next === _classificationType) return;
  _classificationType = next;
  // `classificationType` is read when a ground primitive is built, so an
  // already-built one has to be rebuilt rather than mutated. The pack is still
  // in hand, so this costs a re-tessellation and no network at all.
  const selected = _selectedId;
  if (_payload?.spaces?.length) drawSpaces(_payload.spaces);
  // `drawSpaces` tears down the highlight with the batch it was drawn over, so
  // a park selected when the operator switches map stack would keep its card
  // and silently lose its outline.
  if (selected && _records.get(selected)?.kind === 'space') selectObject(selected);
  _viewer?.scene?.requestRender?.();
}

// --- The clock --------------------------------------------------------------

/**
 * Re-fold "open right now" on the browser's own minute.
 *
 * The pack ships a summary the proxy computed at fetch time and caches for an
 * hour, and that number cannot be shown: measured on the real registers, 757
 * green spaces and 93 cool spots are open at 14 h 00 Paris and 367 and 0 at
 * 01 h 30. 5.0 ms per re-fold over the whole pack, so it runs on any minute
 * change and never on a paint.
 * @param {boolean} [force]
 * @returns {?object}
 */
function refreshSummary(force = false) {
  if (!_payload) return null;
  const at = fraicheurNow();
  const clock = parisClock(at);
  const minute = `${clock.iso} ${clock.hhmm}`;
  if (!force && _summary && minute === _summaryMinute) return _summary;
  _summaryMinute = minute;
  _summary = summarizeFraicheurRefuges({
    spaces: _payload.spaces,
    equipment: _payload.equipment,
    fountains: _payload.fountains,
  }, { now: at, reusedIds: _payload.reusedIds || 0 });
  return _summary;
}

// --- Cards ------------------------------------------------------------------

/** French thousands separator, matching the rest of the French packs. */
function fr(value) {
  return Number(value).toLocaleString('fr-FR');
}

/**
 * Card copy for one selected object.
 *
 * The four registers get four card builders from the two feed modules rather
 * than one generic renderer, because the four say genuinely different things:
 * a park has a canopy metric and an expiry date, a mister has a status field, a
 * tap has an outage window, and a tree has a girth that sometimes contradicts
 * its height. The provenance footer differs too — the fountains are published
 * by Eau de Paris, not by the Ville de Paris, and merging the two would drop an
 * attribution the licence requires.
 * @param {object} record
 * @param {object} [payload]
 * @returns {string}
 */
export function buildFraicheurSelectionLabel(record, payload = null) {
  const now = fraicheurNow();
  const clock = parisClock(now);
  let card = null;
  let footer = 'Ville de Paris — ODbL';
  if (record?.kind === 'space') {
    card = spaceCardLines(record.row, clock, now);
    footer = 'Ville de Paris — ODbL · canopée : relevé 2024';
  } else if (record?.kind === 'equipment') {
    card = equipmentCardLines(record.row, clock, now);
  } else if (record?.kind === 'fountain') {
    card = fountainCardLines(record.row, now);
    footer = 'Eau de Paris — ODbL';
  } else if (record?.kind === 'tree') {
    card = treeCardLines(record.row);
    footer = 'Ville de Paris, Direction des Espaces Verts — ODbL';
  }
  if (!card) return '';
  const details = card.details.filter(Boolean);
  if (record.kind !== 'tree') {
    details.push(`Heure de Paris : ${clock.day} ${clock.hhmm}`);
  }
  details.push(footer);
  return [card.title, ...details].join('\n');
}

/** Protected selected-object entry for the shared overlay host. */
export function createFraicheurSelectedOverlayEntry(record, payload = null) {
  const position = cardPosition(record);
  if (!record?.id || !position) return null;
  const text = buildFraicheurSelectionLabel(record, payload);
  if (!text) return null;
  const [title, ...details] = text.split('\n');
  return {
    id: String(record.id),
    position,
    variant: 'selected',
    selected: true,
    protected: true,
    paintLane: 'selected',
    collisionGroup: 'ambient-card',
    priority: Number.MAX_SAFE_INTEGER,
    title,
    details,
    accent: record.kind === 'space' && record.row?.canicule === true
      ? FRAICHEUR_CANICULE_COLOR
      : SELECTED_COLOR,
    interactive: false,
    anchorRadiusPx: 10,
    minAnchorGapPx: 12,
    verticalOnly: true,
    placement: 'above',
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
  };
}

// --- Selection --------------------------------------------------------------

function clearSelection() {
  clearHighlight();
  const record = _selectedId ? _records.get(_selectedId) : null;
  if (record?.point && !record.point.isDestroyed?.()) {
    record.point.pixelSize = record.basePixelSize;
    record.point.outlineColor = OUTLINE_COLOR;
    record.point.outlineWidth = 1;
  }
  if (_selectedId) {
    _selectedId = null;
    _overlayHost.clearSource(FRAICHEUR_FR_OVERLAY_SOURCE_ID);
    governorRequestRender('fraicheur-fr-deselect');
  }
}

/**
 * Select one object, whatever register it came from.
 *
 * A point is highlighted IN PLACE — a `PointPrimitive` is mutable, unlike a
 * batched geometry instance — and a polygon gets a second ground polyline over
 * its rings, which is the technique `comptages-fr`, `road-status-fr` and
 * `power-grid` all use for the same reason: a batched instance cannot be
 * restyled without rebuilding the batch, and rebuilding 127 465 vertices to
 * light one park is not a click.
 */
function selectObject(id) {
  clearSelection();
  const record = _records.get(id);
  if (!record || !_viewer) return;
  _selectedId = id;
  if (record.point && !record.point.isDestroyed?.()) {
    record.point.pixelSize = record.basePixelSize + SELECTED_POINT_BONUS_PX;
    record.point.outlineColor = Cesium.Color.fromCssColorString(SELECTED_COLOR);
    record.point.outlineWidth = 2;
  } else if (record.kind === 'space' && groundLinesSupported()) {
    const instances = [];
    for (const rings of record.row?.parts || []) {
      for (const ring of rings) {
        const positions = fraicheurRingPositions(ring);
        if (!positions) continue;
        instances.push(new Cesium.GeometryInstance({
          geometry: new Cesium.GroundPolylineGeometry({
            positions: [...positions, positions[0]],
            width: SELECTED_WIDTH_PX,
          }),
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(
              Cesium.Color.fromCssColorString(SELECTED_COLOR).withAlpha(0.8),
            ),
          },
        }));
      }
    }
    if (instances.length) {
      _highlight = _viewer.scene.groundPrimitives.add(new Cesium.GroundPolylinePrimitive({
        geometryInstances: instances,
        appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
        classificationType: _classificationType,
      }));
    }
  }
  const entry = createFraicheurSelectedOverlayEntry(record, _payload);
  if (entry) {
    _overlayHost.setEntries(
      FRAICHEUR_FR_OVERLAY_SOURCE_ID, [entry], FRAICHEUR_FR_OVERLAY_SOURCE_OPTIONS,
    );
  }
  governorRequestRender('fraicheur-fr-select');
}

function onKeyDown(event) {
  if (event.key === 'Escape' && _selectedId) clearSelection();
}

/**
 * Resolve a Cesium pick into one of this layer's ids.
 *
 * A `PointPrimitive` reports the id it was added with; a batched ground
 * primitive reports the `GeometryInstance` id. Both are strings here, and both
 * are checked against the record index rather than trusted.
 */
export function resolveFraicheurPickId(picked, has = (id) => _records.has(id)) {
  if (!picked) return null;
  if (typeof picked.id === 'string' && has(picked.id)) return picked.id;
  const nested = picked.id?.id;
  if (typeof nested === 'string' && has(nested)) return nested;
  return null;
}

function installClickHandler(viewer) {
  if (_clickHandler) return;
  _clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  _clickHandler.setInputAction((movement) => {
    const id = resolveFraicheurPickId(viewer.scene.pick(movement.position));
    if (id) {
      selectObject(id);
      return;
    }
    if (_selectedId) clearSelection();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  if (typeof document !== 'undefined') document.addEventListener('keydown', onKeyDown);
}

// --- Loading ----------------------------------------------------------------

let _fetchImpl = null;

async function loadRefuges({ force = false } = {}) {
  if (_payload && !force) return false;
  _abort?.abort();
  const controller = new AbortController();
  _abort = controller;
  _loading = !_payload;
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const fetchImpl = _fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!fetchImpl) throw new Error('no fetch available');
    const response = await fetchImpl(FRAICHEUR_REFUGES_URL, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload?.spaces)) throw new Error('malformed payload');
    if (controller.signal.aborted || !_enabled) return false;
    _payload = payload;
    _stale = !!payload.stale;
    _lastUpdate = Number(payload.fetchedAt) || Date.now();
    _error = null;
    refreshSummary(true);
    drawRefuges(payload);
    _status = _records.size > 0 ? 'ready' : 'empty';
    return true;
  } catch (error) {
    if (error?.name === 'AbortError') return false;
    console.warn('[Data:Fraîcheur FR] refuges unavailable:', error?.message || error);
    // An hour-old pack still describes the same 984 parks. Keep drawing it and
    // say the refresh failed rather than blanking a city.
    _error = _payload
      ? 'rafraîchissement des îlots de fraîcheur indisponible'
      : 'îlots de fraîcheur de Paris indisponibles';
    _status = _payload ? 'ready' : 'error';
    return false;
  } finally {
    clearTimeout(timer);
    _loading = false;
    if (_abort === controller) _abort = null;
  }
}

/**
 * Ask for one box of trees, or clear them and say why not.
 *
 * The box is snapped onto the same 0.002° grid the proxy caches on, so panning
 * a few streets re-uses the answer; an unchanged key is not re-asked at all.
 * A refusal is NOT an error state — `too-high` and `too-dense` are guidance,
 * and both name the number the operator would need to reach.
 */
async function loadTrees() {
  const { box, reason } = fraicheurTreeViewport(_viewer);
  if (!box) {
    if (_treePayload || _treeBoxKey) {
      _treePayload = null;
      _treeBoxKey = null;
      drawTrees(null);
    }
    // The refusal reasons carry no count of their own — only `too-dense` does,
    // and it comes from the proxy — so a stale probe total is dropped rather
    // than left to be printed against the wrong box.
    _treeTotal = null;
    _treeStatus = reason || 'idle';
    return false;
  }
  const key = boxKey(box, 3);
  if (key === _treeBoxKey && _treePayload) return false;

  _treeAbort?.abort();
  const controller = new AbortController();
  _treeAbort = controller;
  _treeStatus = 'loading';
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const fetchImpl = _fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!fetchImpl) throw new Error('no fetch available');
    const params = new URLSearchParams({
      south: String(box.south),
      west: String(box.west),
      north: String(box.north),
      east: String(box.east),
    });
    const response = await fetchImpl(`${FRAICHEUR_TREES_URL}?${params}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (controller.signal.aborted || !_enabled) return false;
    _treeBoxKey = key;
    if (payload?.truncated) {
      // The proxy already withheld the trees. Clear whatever the last box left
      // on screen: a partial tree map is indistinguishable from a street with
      // no trees on it, which is the one thing this register must not imply.
      _treePayload = null;
      drawTrees(null);
      _treeStatus = 'too-dense';
      _treeTotal = Number(payload.totalInBox) || null;
      return true;
    }
    _treePayload = payload;
    _treeTotal = Number(payload.totalInBox) || (payload.trees?.length ?? 0);
    drawTrees(payload);
    _treeStatus = payload.trees?.length ? 'ready' : 'empty';
    return true;
  } catch (error) {
    if (error?.name === 'AbortError') return false;
    console.warn('[Data:Fraîcheur FR] trees unavailable:', error?.message || error);
    _treeStatus = 'unavailable';
    _treeBoxKey = null;
    return false;
  } finally {
    clearTimeout(timer);
    if (_treeAbort === controller) _treeAbort = null;
  }
}

async function load({ force = false } = {}) {
  if (!_enabled || !_viewer) return false;
  _inView = fraicheurInView(_viewer);
  if (!_inView) {
    // Not an error and not an empty dataset — the operator is looking somewhere
    // else. Keep whatever is drawn; it is still true.
    _status = 'empty';
    _loading = false;
    return false;
  }
  const packed = await loadRefuges({ force });
  const treed = await loadTrees();
  return packed || treed;
}

function scheduleLoad() {
  clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(() => { void load(); }, CAMERA_DEBOUNCE_MS);
}

// --- Detection --------------------------------------------------------------

/**
 * Candidates for the DETECT callout, in the order they are worth calling out.
 *
 * NOT a stride over 15 000 objects. The four registers are not equally
 * interesting: a park that declares a heatwave arrangement is the finding, the
 * 535 listed refuges are the layer's subject, a tree the city itself calls
 * remarkable is one of 183 in 219 432, and a broken tap is actionable. An
 * ordinary plane tree is not, and 12 500 of them would drown all four.
 */
function collectDetectableObjects(options = {}) {
  if (!_enabled || !_records.size) return [];
  const maxCount = Number.isFinite(options.maxCount)
    ? Math.max(1, Math.floor(options.maxCount))
    : 2600;
  const tiers = [[], [], [], []];
  for (const record of _records.values()) {
    if (record.kind === 'space' && record.row?.canicule === true) tiers[0].push(record);
    else if (record.kind === 'equipment') tiers[1].push(record);
    else if (record.kind === 'tree' && record.row?.remarquable === true) tiers[2].push(record);
    else if (record.kind === 'fountain' && record.row?.available === false) tiers[3].push(record);
  }
  const ordered = [...tiers[0], ...tiers[1], ...tiers[2], ...tiers[3]];
  if (!ordered.length) return [];
  const seed = Number.isFinite(options.seed) ? Math.floor(options.seed) : 0;
  const stride = Math.max(1, Math.ceil(ordered.length / maxCount));
  const start = ((seed % stride) + stride) % stride;

  const result = [];
  for (let i = start; i < ordered.length; i += stride) {
    const record = ordered[i];
    const floor = cachedGroundFloor(record.at.lat, record.at.lon);
    result.push({
      position: Cesium.Cartesian3.fromDegrees(
        record.at.lon, record.at.lat, (Number.isFinite(floor) ? floor : 0) + CARD_LIFT_M,
      ),
      sourceId: record.id,
      id: fraicheurDetectLabel(record),
      type: fraicheurDetectType(record),
      skipLabel: record.id === _selectedId,
    });
    if (result.length >= maxCount) break;
  }
  return result;
}

/** The one line the DETECT callout shows for a record. */
export function fraicheurDetectLabel(record) {
  if (record?.kind === 'space') return record.row?.name || 'Espace vert frais';
  if (record?.kind === 'equipment') return record.row?.name || record.row?.type || 'Îlot de fraîcheur';
  if (record?.kind === 'tree') return record.row?.name || 'Arbre remarquable';
  return record?.row?.street || 'Fontaine';
}

/** English type noun for the DETECT callout. */
export function fraicheurDetectType(record) {
  if (record?.kind === 'space') return 'Cool green space';
  if (record?.kind === 'equipment') return 'Cool refuge';
  if (record?.kind === 'tree') return 'Remarkable tree';
  return 'Drinking fountain';
}

// --- Row label --------------------------------------------------------------

/** One line under the layer's toggle: what this view actually contains. */
export function buildFraicheurLoadingLabel({
  payload = _payload,
  summary = _summary,
  loading = _loading,
  inView = _inView,
  treeStatus = _treeStatus,
  treeTotal = _treeTotal,
} = {}) {
  if (loading) return fraicheurLoadingLabel({ status: 'loading' });
  if (!inView) return fraicheurLoadingLabel({ status: 'off-coverage' });
  if (!payload || !summary) return null;
  // A failed tree box is NOT a failed layer — the 2 842 refuges are still on
  // screen — but it must not be silent either, or an operator reads an empty
  // street as a street with no trees on it.
  const suffix = treeStatus === 'unavailable' ? ' · arbres indisponibles pour cette vue' : '';
  return (fraicheurLoadingLabel({
    status: 'ready',
    summary,
    drawn: summary.spaces + summary.equipment + summary.fountains,
    // Off the payload and not by walking the record index: `getStats()` runs on
    // the panel's one-second refresh and the index holds up to 12 500 trees.
    trees: _treePayload?.trees?.length ?? 0,
    treeStatus,
    treeTotal,
  }) || '') + suffix;
}

// --- Layer ------------------------------------------------------------------

const fraicheurParisLayer = {
  id: FRAICHEUR_FR_LAYER_ID,
  name: 'Îlots de fraîcheur (Paris)',
  // 🌳 and not 🌲/🌿: the taxonomy neighbours in RISQUES & ENVIRONNEMENT are
  // 🔥 (FIRMS), 🌊 (Vigicrues), ⚠ (Géorisques) and 🌪 (vigilance météo), so the
  // glyph has to say "vegetation and shade" without saying "wildfire".
  icon: '🌳',
  source: FRAICHEUR_SOURCE,
  updateInterval: POLL_INTERVAL_MS,

  init(viewer) {
    _viewer = viewer;
    _enabled = false;
    _records = new Map();
    _payload = null;
    _summary = null;
    _summaryMinute = null;
    _treePayload = null;
    _treeStatus = 'idle';
    _treeBoxKey = null;
    _treeTotal = null;
    _selectedId = null;
    _loading = false;
    _error = null;
    _status = 'idle';
    _stale = false;
    _lastUpdate = null;
    _inView = false;
    _classificationType = powerClassificationTypeForScene(viewer?.scene);

    // Bottom-to-top within this layer's own slot: 12 500 tree dots must never
    // hide the 535 refuges the layer is named after, nor a broken tap.
    _treePoints = new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT });
    _fountainPoints = new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT });
    _equipmentPoints = new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT });
    for (const collection of [_treePoints, _fountainPoints, _equipmentPoints]) {
      collection.show = false;
      viewer.scene.primitives.add(collection);
      registerSpriteCollection(FRAICHEUR_FR_LAYER_ID, collection);
    }
    restoreSpriteOrder(viewer);

    if (typeof window !== 'undefined' && !_mapStackListener) {
      _mapStackListener = (event) => {
        applyClassification(event?.detail?.activeId !== undefined
          ? powerClassificationTypeForStack(event.detail.activeId)
          : powerClassificationTypeForScene(_viewer?.scene));
      };
      window.addEventListener('gev:map-stack-changed', _mapStackListener);
    }
    _overlayHost.setVisible(FRAICHEUR_FR_OVERLAY_SOURCE_ID, false);
    console.log('[Data:Fraîcheur FR] Initialized');
  },

  enable(viewer) {
    _enabled = true;
    _error = null;
    for (const collection of [_treePoints, _fountainPoints, _equipmentPoints]) {
      if (collection) collection.show = true;
    }
    if (_fills) _fills.show = true;
    if (_caniculeStrokes) _caniculeStrokes.show = true;
    // The boot-time stack settle fires no event, so re-derive on every enable
    // rather than trusting whatever the last event left behind.
    applyClassification(powerClassificationTypeForScene(viewer?.scene || _viewer?.scene));
    restoreSpriteOrder(viewer);
    _overlayHost.setVisible(FRAICHEUR_FR_OVERLAY_SOURCE_ID, true);
    installClickHandler(viewer);
    registerPickOwner(FRAICHEUR_FR_LAYER_ID, (pickedId) => _records.has(pickedId));
    if (!_moveEndRemover) {
      _moveEndRemover = viewer.camera.moveEnd.addEventListener(scheduleLoad);
    }
    // DataLayerManager calls update() immediately after enable(), which owns
    // the first fetch. Avoid racing it with a second aborting request here.
  },

  disable() {
    _enabled = false;
    clearSelection();
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
    _abort?.abort();
    _abort = null;
    _treeAbort?.abort();
    _treeAbort = null;
    for (const collection of [_treePoints, _fountainPoints, _equipmentPoints]) {
      if (collection) collection.show = false;
    }
    if (_fills) _fills.show = false;
    if (_caniculeStrokes) _caniculeStrokes.show = false;
    _overlayHost.setVisible(FRAICHEUR_FR_OVERLAY_SOURCE_ID, false);
    if (_clickHandler) {
      _clickHandler.destroy();
      _clickHandler = null;
    }
    if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeyDown);
    unregisterPickOwner(FRAICHEUR_FR_LAYER_ID);
    if (_moveEndRemover) {
      _moveEndRemover();
      _moveEndRemover = null;
    }
    _loading = false;
    _status = 'idle';
  },

  async update() {
    if (!_enabled) return false;
    // `load()` answers "did I fetch", which is false when the camera is not on
    // Paris and false on an unchanged pack. Neither is a refusal of the
    // lifecycle transition, and DataLayerManager reads a literal `false` from
    // update() as exactly that.
    await load({ force: true });
    return true;
  },

  getDetectableObjects(options = {}) {
    return collectDetectableObjects(options);
  },

  getStats() {
    const summary = refreshSummary();
    const stats = {
      count: _records.size,
      lastUpdate: _lastUpdate,
      loading: _loading,
      status: _status === 'ready' ? 'ok' : _status,
      stale: _stale,
      // The layer's own honesty numbers, surfaced rather than buried.
      spaces: summary?.spaces ?? null,
      equipment: summary?.equipment ?? null,
      fountains: summary?.fountains ?? null,
      trees: _treePayload?.trees?.length ?? 0,
      treeStatus: _treeStatus,
      treeTotalInBox: _treeTotal,
      canicule: summary?.canicule ?? null,
      caniculeWithoutCanopy: summary?.caniculeWithoutCanopy ?? null,
      openNow: summary ? summary.spacesOpenNow + summary.equipmentOpenNow : null,
      unknownNow: summary ? summary.spacesUnknownNow + summary.equipmentUnknownNow : null,
      expiredSchedules: summary?.spacesExpired ?? null,
      fountainsOut: summary?.fountainsOut ?? null,
      fountainsStaleOutage: summary?.fountainsStaleOutage ?? null,
      unplaced: _payload?.unplaced ?? null,
      parisTime: summary?.clock?.hhmm ?? null,
    };
    const label = buildFraicheurLoadingLabel({ summary });
    if (label) stats.loadingLabel = label;
    if (_error) stats.error = _error;
    return stats;
  },

  /** Provenance for the attribution popover and the analyst surfaces. */
  getViewportSummary() {
    if (!_payload) return null;
    const { spaces, equipment, fountains, ...rest } = _payload;
    return {
      ...rest,
      summary: refreshSummary(),
      drawn: _records.size,
      inView: _inView,
      trees: _treePayload
        ? { drawn: _treePayload.trees?.length ?? 0, totalInBox: _treePayload.totalInBox, box: _treePayload.box }
        : { drawn: 0, totalInBox: _treeTotal, status: _treeStatus },
      treeSource: FRAICHEUR_TREE_SOURCE,
    };
  },

  /**
   * Colour legend for the control-panel row.
   *
   * Four registers, so four blocks, and the ORDER is the argument: the 23
   * spaces that declare a heatwave arrangement come first because they are the
   * finding, before the canopy ramp they are mostly at the bottom of. Rows at
   * zero are dropped, except the heatwave row, which is kept even at zero
   * because "none of the parks you can see stays open in a heatwave" is the
   * entry a reader has to be given.
   */
  getRowControls() {
    const summary = refreshSummary();
    if (!summary) return { chips: [], legend: [] };
    const legend = [];
    // `ouvert_24h` counted INSIDE the heatwave set, not across the register:
    // 189 of the 984 spaces carry the flag and only 9 of the 23 heatwave ones
    // do, and quoting the wrong one here would turn the finding upside down.
    const canicule24 = (_payload?.spaces || [])
      .filter((space) => space.canicule === true && space.open24 === true).length;
    legend.push({
      label: 'Ouvert en canicule',
      color: FRAICHEUR_CANICULE_COLOR,
      count: summary.canicule,
      blurb: `${fr(summary.canicule)} des ${fr(summary.spaces)} espaces verts frais déclarent une ouverture canicule, `
        + `dont ${fr(canicule24)} ouverts 24 h/24. `
        + `${fr(summary.caniculeWithoutCanopy)} d’entre eux n’ont AUCUNE canopée mesurée au-dessus de 8 m — `
        + `leur médiane est à 0,0280 contre 0,3197 sur l’ensemble du registre.`,
    });
    for (const band of [...FRAICHEUR_CANOPY_BANDS, FRAICHEUR_CANOPY_UNKNOWN]) {
      const row = summary.canopyBands.find((entry) => entry.id === band.id);
      if (!row || row.count <= 0) continue;
      legend.push({ label: row.label, color: row.color, count: row.count, blurb: row.blurb });
    }
    for (const id of FRAICHEUR_FAMILIES) {
      const row = summary.families.find((entry) => entry.id === id);
      if (!row || row.count <= 0) continue;
      legend.push({
        label: FRAICHEUR_FAMILY_LABELS[id],
        color: fraicheurFamilyColor(id),
        count: row.count,
        blurb: FRAICHEUR_FAMILY_BLURBS[id],
      });
    }
    const fountainCounts = [summary.fountainsAvailable, summary.fountainsOut,
      summary.fountains - summary.fountainsAvailable - summary.fountainsOut];
    FRAICHEUR_FOUNTAIN_STATES.forEach((state, index) => {
      if (!(fountainCounts[index] > 0)) return;
      legend.push({ label: state.label, color: state.color, count: fountainCounts[index], blurb: state.blurb });
    });
    if (_treePayload?.summary?.bands) {
      for (const band of _treePayload.summary.bands) {
        if (!(band.count > 0)) continue;
        legend.push({ label: band.label, color: band.color, count: band.count, blurb: band.blurb });
      }
    }
    return { chips: [], legend };
  },

  destroy(viewer) {
    if (_enabled) this.disable(viewer);
    else {
      clearSelection();
      if (_clickHandler) {
        _clickHandler.destroy();
        _clickHandler = null;
      }
      if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeyDown);
      unregisterPickOwner(FRAICHEUR_FR_LAYER_ID);
    }
    if (typeof window !== 'undefined' && _mapStackListener) {
      window.removeEventListener('gev:map-stack-changed', _mapStackListener);
      _mapStackListener = null;
    }
    if (_moveEndRemover) {
      _moveEndRemover();
      _moveEndRemover = null;
    }
    clearSurfaces();
    for (const collection of [_treePoints, _fountainPoints, _equipmentPoints]) {
      if (!collection) continue;
      unregisterSpriteCollection(FRAICHEUR_FR_LAYER_ID, collection);
      (viewer || _viewer)?.scene?.primitives?.remove?.(collection);
    }
    _treePoints = null;
    _fountainPoints = null;
    _equipmentPoints = null;
    _records.clear();
    _payload = null;
    _summary = null;
    _summaryMinute = null;
    _treePayload = null;
    _viewer = null;
  },
};

// --- Test seams -------------------------------------------------------------

/**
 * Seed rendered records so the selection, card, legend and detection paths run
 * without WebGL.
 *
 * The point collections are seeded as plain arrays, not Cesium collections, so
 * a test can drive `selectObject()` — which mutates the primitive it selected —
 * with no GL context. `viewer` is still needed for the polygon highlight path,
 * which really does add a `GroundPolylinePrimitive` to the scene.
 */
export function _setFraicheurStateForTest({
  viewer, payload, trees = null, overlayHost, enabled = true, inView = true,
  treeStatus = 'idle', treeTotal = null, now = Date.now(), fetchImpl,
} = {}) {
  _fetchImpl = fetchImpl || null;
  _nowOverride = Number.isFinite(now) ? Number(now) : null;
  _viewer = viewer || null;
  _overlayHost = overlayHost || DEFAULT_OVERLAY_HOST;
  _payload = payload || null;
  _treePayload = trees;
  _treeStatus = treeStatus;
  _treeTotal = treeTotal;
  _records = new Map();
  const fake = (pixelSize) => ({ pixelSize, outlineColor: null, outlineWidth: 1 });
  for (const space of payload?.spaces || []) {
    const at = fraicheurSpaceAnchor(space);
    if (!at) continue;
    const id = `${FRAICHEUR_FR_LAYER_ID}:${space.id}`;
    _records.set(id, { id, kind: 'space', row: space, at, color: fraicheurSpaceColor(space) });
  }
  for (const site of payload?.equipment || []) {
    const id = `${FRAICHEUR_FR_LAYER_ID}:${site.id}`;
    _records.set(id, {
      id, kind: 'equipment', row: site, at: { lon: site.p[0], lat: site.p[1] },
      color: fraicheurFamilyColor(site.family), point: fake(EQUIPMENT_PX), basePixelSize: EQUIPMENT_PX,
    });
  }
  for (const fountain of payload?.fountains || []) {
    const id = `${FRAICHEUR_FR_LAYER_ID}:${fountain.id}`;
    _records.set(id, {
      id, kind: 'fountain', row: fountain, at: { lon: fountain.p[0], lat: fountain.p[1] },
      color: fraicheurFountainState(fountain).color, point: fake(FOUNTAIN_PX), basePixelSize: FOUNTAIN_PX,
    });
  }
  for (const tree of trees?.trees || []) {
    const id = `${FRAICHEUR_FR_LAYER_ID}:${tree.id}`;
    const size = tree.remarquable === true
      ? TREE_MAX_PX : fraicheurTreeSize(tree.height, TREE_MIN_PX, TREE_MAX_PX);
    _records.set(id, {
      id, kind: 'tree', row: tree, at: { lon: tree.p[0], lat: tree.p[1] },
      color: fraicheurTreeColor(tree), point: fake(size), basePixelSize: size,
    });
  }
  _enabled = enabled;
  _inView = inView;
  _selectedId = null;
  _loading = false;
  _error = null;
  _stale = !!payload?.stale;
  _status = 'ready';
  _summary = payload
    ? summarizeFraicheurRefuges({
      spaces: payload.spaces, equipment: payload.equipment, fountains: payload.fountains,
    }, { now, reusedIds: payload.reusedIds || 0 })
    : null;
  _summaryMinute = `${parisClock(now).iso} ${parisClock(now).hhmm}`;
}

/** Exercise the production selection path in focused runtime tests. */
export function _selectFraicheurForTest(id) {
  selectObject(id);
}

/** Exercise the production clear path and restore the production host seam. */
export function _clearFraicheurSelectionForTest() {
  clearSelection();
  _nowOverride = null;
  _fetchImpl = null;
  _treeBoxKey = null;
  _overlayHost = DEFAULT_OVERLAY_HOST;
  _payload = null;
  _summary = null;
  _summaryMinute = null;
  _treePayload = null;
  _treeStatus = 'idle';
  _treeTotal = null;
  _records = new Map();
  _enabled = false;
  _inView = false;
  _status = 'idle';
  _viewer = null;
}

/** @returns {?string} */
export function _fraicheurSelectedIdForTest() {
  return _selectedId;
}

/** Row-control legend, for tests that do not construct a viewer. */
export function _fraicheurRowControlsForTest() {
  return fraicheurParisLayer.getRowControls();
}

/** Stats, for tests that do not construct a viewer. */
export function _fraicheurStatsForTest() {
  return fraicheurParisLayer.getStats();
}

/** Detection candidates, for tests that do not construct a viewer. */
export function _fraicheurDetectablesForTest(options = {}) {
  return collectDetectableObjects(options);
}

/**
 * Drive the real `load()` — URL building, box snapping, the truncated branch
 * and the degraded branch — against an injected fetch.
 * @returns {Promise<boolean>}
 */
export async function _fraicheurLoadForTest(options = {}) {
  return load(options);
}

/** What the layer thinks about the trees right now, for the load-path tests. */
export function _fraicheurTreeStateForTest() {
  return { status: _treeStatus, total: _treeTotal, boxKey: _treeBoxKey, drawn: _treePayload?.trees?.length ?? 0 };
}

/** One render record by id, so a test can assert on what was seeded. */
export function _fraicheurRecordForTest(id) {
  return _records.get(id) || null;
}

export default fraicheurParisLayer;
