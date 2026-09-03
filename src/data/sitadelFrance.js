/**
 * @module sitadelFrance
 *
 * Sitadel — the only forward-looking layer on this globe, drawn on the exact
 * parcels the permits were granted for.
 *
 * `sitadelFeed.js` holds the join and every trap in it. This file is the
 * drawing, and it exists to settle three questions the feed deliberately
 * leaves open: WHERE the layer is allowed to ask, WHAT the two channels claim,
 * and HOW the permits it could not place stay visible without being drawn.
 *
 * ── Against the layer it sits beside ────────────────────────────────────────
 *
 * `dvf-sales` draws completed transactions: what changed hands, for how much,
 * with a latitude and a longitude already in the file. This draws
 * AUTHORISATIONS — what somebody has been given permission to build and has
 * not necessarily built. DVF looks backwards at price, Sitadel forwards at
 * supply, and on the same parcel the two compose. `bdtopo-buildings` is the
 * stock as surveyed and `urbanisme-gpu` is the rule; a permit is the moment
 * between them.
 *
 * Sitadel publishes NO coordinate — 94 columns on the housing file, 33 on the
 * demolitions, and `geoFields: ["REG","DEP"]` on both. Every position here was
 * computed by joining a cadastral reference to `cadastre-fr`'s own upstream,
 * so every card ends by saying so and by publishing the rate at which that
 * computation succeeded.
 *
 * ── ONE regime, and the arithmetic that forbids a second ────────────────────
 *
 * The four Sitadel files hold 3 020 749 permits over 1.30 GB of CSV, and DiDo
 * answers a filtered, column-projected commune query by SCANNING the whole
 * file: measured 2026-09-02, six sequential queries returned in 3.57–5.01 s
 * whatever their size — Nantes (2 049 rows) took 3.98 s and a single-column
 * probe of the same commune took 3.57 s. A national mesh regime would be
 * 34 945 commune queries at ~4 s, which is 39 hours for one pass. There is no
 * honest maillage, so this layer answers ONE COMMUNE at a time and says which.
 *
 * That also fixes the concurrency, and this is the measurement nobody upstream
 * of this file had: **DiDo refuses a fourth simultaneous request.** Six
 * parallel queries on 2026-09-02 returned three HTTP 200 and three HTTP 429
 * within 145 ms, body `max connections reached: 3` — 26 bytes of plain text,
 * with no `content-type`, no `retry-after` and NO `access-control-allow-origin`,
 * so a browser could not even read the refusal. Three at once are all served.
 * The proxy therefore holds a global semaphore of two and this layer never
 * fetches a second commune while one is in flight.
 *
 * ── The gate: 12 000 m, measured against the communes themselves ────────────
 *
 * At {@link SITADEL_MAX_ALTITUDE_M} a nadir camera at Cesium's default 60°
 * vertical FOV (`VIEW_GATE_DEFAULT_FOV_DEG`) sees 2·h·tan 30° = 13.86 km of
 * ground. The communes this layer answers with are 12.13 km wide (Nantes),
 * 13.29 km (Toulouse) and 17.85 km (Paris) — measured from the outer bounds of
 * their own Etalab cadastre, not estimated. Above that height the answer would
 * be one commune inside a view holding twenty, and the empty ground either side
 * would read as "no permits here" when it means "never asked".
 *
 * There is NO coverage rectangle, deliberately. Sitadel covers the DROM and so
 * does the Etalab cadastre: Saint-Denis de La Réunion (97411) answers with
 * 2 849 permits and a 10 449 654-byte parcel file. A metropolitan box would
 * have refused all of it while claiming national coverage, so the question
 * "is there a French commune under the middle of the screen" is put to
 * `geo.api.gouv.fr`, which is the only service entitled to answer it.
 *
 * ── What the two channels claim ─────────────────────────────────────────────
 *
 * The FILL on a parcel is the lifecycle band of the MOST RECENT authorisation
 * that names it — `ETAT_DAU` read through the three real dates. That is the
 * whole point of the layer: `2` Autorisé is a permit about which nothing
 * further has been reported, `5` Chantier ouvert has a DATE_REELLE_DOC, `6`
 * Travaux achevés has a DATE_REELLE_DAACT, and a permis de démolir is its own
 * band because its own `ETAT_PD` says nothing (1 497 of Nantes' 1 587
 * demolitions and 1 582 of Paris' 1 609 sit at Autorisé). A parcel that
 * carries several permits over thirteen years is coloured by the newest and
 * its card counts the rest; measured on Nantes, 2 747 placed permits sit on
 * 3 032 parcels, so the collision is rare and naming it is cheaper than
 * inventing a rule for it.
 *
 * The DOT is one per placed permit, sized by DWELLINGS CREATED —
 * `NB_LGT_TOT_CREES` under `sitadelPointSize`'s square root and its 200-dwelling
 * ceiling. It carries the layer above the street: a Nantes parcel is 800 m²
 * and sub-pixel at 12 000 m, so without the dot the layer would be invisible
 * for the whole top half of its own altitude range. A demolition draws at the
 * minimum and its card says why — the permis de démolir file has 33 columns
 * and not one of them counts a dwelling.
 *
 * The HEIGHT is the same number on a channel the perspective does not eat.
 *
 * ── The parcel becomes a volume ─────────────────────────────────────────────
 *
 * A dwelling count is an ABSOLUTE quantity, and the doctrine gives an absolute
 * exactly one honest channel: size. On a globe the screen-size channel is
 * already spent on depth, so what is left is extrusion — and this layer is
 * standing on the one thing that makes extrusion legal here, which is that it
 * already draws the EXACT PARCEL the permit names. Extruding a parcel claims
 * only what the register claims: this plot, this many dwellings.
 *
 * WHY 1 METRE PER DWELLING, LINEARLY. The dot uses a square root because a disc
 * encodes through its AREA, and doubling a radius quadruples the ink. A prism's
 * height is a LENGTH: it reads directly, twice as tall is twice as many, and
 * square-rooting it would make the tallest prism claim 14 times a 1-dwelling
 * one instead of 200. The unit is chosen so the prism can be read against the
 * city it stands in rather than against itself: a Nantes block is 10–30 m of
 * BD TOPO volume, so a 27-dwelling permit is a 27 m prism — the size of the
 * thing it replaces — and the commune's largest, at 553, is clipped at 200 m,
 * which is 56 m above the Tour Bretagne. Anything steeper would put a housing
 * estate through the cloud layer; anything flatter would make 57 % of permits
 * (the ones creating exactly one dwelling) an invisible film.
 *
 * The ceiling is {@link SITADEL_SIZE_CEILING_LGT} — the feed's own measured
 * constant, 99th percentile 190 dwellings over 22 474 permits, largest 659 —
 * so the dot and the prism saturate on the same number. Every clipped prism is
 * counted on the row and the card still prints the true count (A5).
 *
 * WHY THE DOT KEEPS ITS SIZE ANYWAY. Two channels for one datum is redundancy,
 * and redundancy is only defensible when the two are legible at different
 * distances — which here is arithmetic, not taste. At the 12 000 m gate a 60°
 * FOV over a 720 px canvas covers 13 856 m of ground: 19.2 m per pixel, so a
 * 200 m prism is 10 px of screen height and the median 1-dwelling prism is
 * 0.05 px. At 300 m the same canvas covers 346 m: 0.48 m per pixel, the
 * 1-dwelling prism is 2 px and the 800 m² parcel under it is ~58 px across.
 * The dot is the layer at the top of the range, the prism is the layer at the
 * bottom, and neither is doing the other's job.
 *
 * ── A permit with no height, and why it is not drawn at zero ────────────────
 *
 * Height means dwellings authorised. A plot with no height is a plot whose file
 * publishes no dwelling count — ONE meaning, and there are exactly two ways to
 * arrive at it:
 *
 * • a **permis de démolir**, whose file has 33 columns and no dwelling among
 *   them (this is structural, not missing data);
 * • a **housing permit at zero**. `sitadelFeed.js` reads
 *   `finiteOrNull(NB_LGT_TOT_CREES) ?? 0`, so a published zero and a blank cell
 *   arrive here as the same number and this layer cannot separate them. Over
 *   the 17 housing rows shipped as fixtures, 1 publishes an explicit `0` and
 *   none is blank; the row says "aucun logement créé ou non publié" rather than
 *   choosing one of the two.
 *
 * Neither gets a prism of height 0, which would be an invisible claim. They
 * keep the ground fill and the parcel outline they have always had — a
 * ground-classified surface at {@link SITADEL_FILL_ALPHA}, which is a drawn,
 * clickable, coloured object and not an absence — and their PARCEL EDGE is
 * stroked in their own band colour instead of the neutral `#0b1220`. "Outlined
 * in its own colour" therefore reads as "this plot has no height, and the fill
 * tells you which kind": red is a demolition, the four pipeline colours are a
 * housing permit that creates nothing.
 *
 * A fixed-height ghost volume was the other candidate and was rejected: any
 * constant height is a number on the very scale the file did not publish, which
 * is A1 in three dimensions — the same mistake `REPRESENTATION.md` refuses to
 * make with the GPU's non-existent constructible envelope.
 *
 * Measured on the Nantes pack shipped as fixtures — 9 placed permits over 14
 * parcels — 10 plots stand up, 3 belong to the two demolitions and 1 to a
 * déclaration préalable creating zero dwellings. Tallest prism 27 m, nothing
 * clipped. The row prints all four numbers.
 *
 * ── A prism needs a floor, and a cold floor is not a floor ──────────────────
 *
 * A `GroundPrimitive` is clamped by the renderer; an extruded polygon is not —
 * it is placed at absolute ellipsoidal heights and it has to be told where the
 * ground is. That comes from `cachedGroundFloor`, the same coarse (~111 m) grid
 * the dots already stand on, read at the parcel's own anchor. When the cell is
 * still cold the parcel is left FLAT rather than extruded from the ellipsoid,
 * which in metropolitan France is 44–55 m underground and would draw a
 * 27-dwelling permit as a hole. One retry three seconds later, once per
 * commune, in the shape `bdtopoBuildings.js` already uses for the same problem.
 *
 * ── What changes under the photorealistic stack ─────────────────────────────
 *
 * The flat parcels stay ground-classified, so on Google 3D they classify as
 * `CESIUM_3D_TILE` and the wash climbs the façades — the drape defect
 * `surfaceFillNotice.js` describes, which is why `getRowControls` declares
 * `surfaceFill` whenever any parcel is still flat.
 *
 * The PRISMS do not have that defect at all, and this is the part worth stating
 * plainly: an extruded polygon is not a classification volume, it carries no
 * `classificationType`, and it is not draped on anything. It is opaque geometry
 * in the world, depth-tested against the photoreal mesh — so a 12 m prism
 * behind a 30 m tileset building is HIDDEN by it instead of painted on it
 * (CARTOGRAPHIE F1(a), F4). The colour a reader decodes off a prism is the
 * colour that was declared, on every stack. Going 3D removes the constraint
 * rather than adding one; the batched-`GroundPrimitive`-colours-by-bounding-
 * rectangle trap does not exist here either, because per-instance colour on a
 * plain `Primitive` addresses the polygon itself.
 *
 * Opaque, and not translucent, for the reason `bdtopoBuildings.js` measured:
 * an alpha below 1 moves geometry into Cesium's translucent pass, which does
 * not write depth, and a street of see-through boxes reads as one mass with
 * everything showing through everything.
 *
 * The commune OUTLINE is not decoration. It is the scope of the answer, and
 * without it the neighbouring commune reads as "nothing was authorised here"
 * rather than "this was never asked". It is drawn from `geo.api.gouv.fr`'s own
 * `contour`, decimated by `projectGeometry` — Nantes 804 vertices to 269, Paris
 * 532 to 267, Toulouse 1 191 to 398 — which moves the drawn boundary by a mean
 * of 3.6–8.8 m and at worst 183 m (Nantes), 125 m (Paris), 242 m (Toulouse).
 * The row says the outline is simplified. It is never used to decide anything:
 * the commune under the camera is resolved upstream, by the geocoder.
 *
 * ── What is NOT drawn, and where it goes instead ────────────────────────────
 *
 * Measured 2026-09-02 over six communes, both files, against the Etalab
 * cadastre edition 2026-06-01:
 *
 *   Paris      75056   5 204 permits   4 753 placed  91.3%     0 ambiguous
 *   Nantes     44109   3 636           2 747         75.6%     0
 *   Ustaritz   64547     432             238         55.1%     0
 *   Beaupréau  49023     888             484         54.5%   294
 *   Marseille  13055   5 424           1 092         20.1%  4 007
 *   Toulouse   31555   5 687             430          7.6%  5 148
 *   ─────────────────────────────────────────────────────────────
 *   total             21 271           9 744         45.8%
 *
 * 45.8% is almost exactly the 44.8% DREAL Auvergne-Rhône-Alpes reached on the
 * same data with more time (362 038 permits, 162 171 with a geometry), which is
 * the correct calibration for anyone reading these numbers as a failure.
 *
 * The 11 527 that are not drawn are COUNTED on the row, in `getStats()` and on
 * every card, and they are not in the LEGEND — the panel's swatch IS the datum,
 * and there is no colour for a permit that is nowhere. Nothing is moved to a
 * commune centroid. The three failures are kept apart because a reader can act
 * on the difference: *ambiguous* means the commune publishes section préfixes
 * that Sitadel has no column for and NOTHING will fix it, *missing* means the
 * parcel was divided and renumbered — which is what happens when somebody
 * builds on it — and *noref* means the file is blank.
 *
 * ── The audit agrees with the diagnosis ─────────────────────────────────────
 *
 * `SUPERFICIE_TERRAIN` is the plot the applicant declared. It places nothing;
 * it audits. Over the same six communes the share of placed permits whose drawn
 * parcels agree with the declared terrain within a factor of two ranks the
 * communes in the SAME order as the placement rate: Paris 98.4% (4 556/4 630),
 * Nantes 94.2% (2 387/2 533), Beaupréau 86.4%, Ustaritz 84.7%, Marseille 68.6%,
 * Toulouse 51.5% (212/412). An independent measurement agreeing with the join
 * rate is the strongest evidence available that the parcels drawn under the
 * top of that table are the right ones — and the clearest possible warning
 * about the bottom of it. Every card prints its own permit's ratio and the
 * word CONCORDANT or DISCORDANT.
 *
 * ── Two of Sitadel's four files are not read ────────────────────────────────
 *
 * This layer reads the housing register (1 917 260 permits) and the demolitions
 * (202 895) — 2 120 155 of the 3 020 749, or 70.2%. The 792 588 non-residential
 * permits and the 108 006 permis d'aménager are not read, and that is a real
 * hole: Nantes alone has 1 881 non-residential permits and 129 permis
 * d'aménager on top of the 3 636 drawn here, measured through the same URLs.
 * They are omitted because the non-residential file answers a different
 * question — surfaces by destination across seven families, with no dwelling
 * count to size a dot by — and because a third and fourth concurrent DiDo query
 * is exactly the request DiDo answers with 429. The row says two files.
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
import { cameraViewBox } from './viewGate.js';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { powerClassificationTypeForScene, powerClassificationTypeForStack } from './powerGrid.js';
import {
  SITADEL_BANDS,
  SITADEL_LICENCE,
  SITADEL_OUTCOME_LABELS,
  SITADEL_SIZE_CEILING_LGT,
  SITADEL_SOURCE,
  buildSitadelPermitCard,
  finiteOrNull,
  sitadelBand,
  sitadelBandColor,
  sitadelLoadingLabel,
  sitadelPermitTitle,
  sitadelPointSize,
  sitadelUnplacedLines,
} from './sitadelFeed.js';

/** Layer id — also the share-link registry key and the voice-tool enum value. */
export const SITADEL_FR_LAYER_ID = 'sitadel-fr';

/** Selected-permit card, on its own protected overlay source. */
export const SITADEL_FR_OVERLAY_SOURCE_ID = 'sitadel-fr-selected';
export const SITADEL_FR_OVERLAY_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 1,
  moving: false,
});

/** Keyless, same-origin. See `sitadelFranceProxy` in vite.config.js. */
export const SITADEL_COMMUNE_URL = '/api/sitadel-fr/commune';

/**
 * Highest camera this layer will ask from.
 *
 * 12 000 m. At Cesium's default 60° vertical FOV a nadir camera sees
 * 2 · 12 000 · tan 30° = 13 856 m of ground, and the communes this layer
 * answers with are 12.13 km (Nantes), 13.29 km (Toulouse) and 17.85 km (Paris)
 * across — measured from the bounds of their own Etalab parcel files on
 * 2026-09-02. One commune is the whole answer, so the gate is set where one
 * commune is most of the view.
 */
export const SITADEL_MAX_ALTITUDE_M = 12_000;

/**
 * Grid the camera focus is rounded onto before the commune is re-asked.
 *
 * 0.01° ≈ 1.11 km north–south. Panning inside a cell asks nothing at all;
 * crossing one costs a reverse geocode the proxy answers from memory, and the
 * pack is only re-fetched when the INSEE code actually changes — which is why
 * the request carries `have=`. The gap between this grid and the commune
 * boundary is deliberate: an approximate boundary must never be what decides
 * whether a permit belongs to the commune under the camera.
 */
export const SITADEL_FOCUS_GRID_DEG = 0.01;

/**
 * Fill alpha for a parcel.
 *
 * 0.42 — higher than `fraicheur-fr`'s 0.34 and lower than an opaque fill,
 * because these are 800 m² plots rather than parks: at street level a parcel
 * covers a few hundred screen pixels and a 0.34 fill over a photoreal roof is
 * not a colour anyone can name. `cadastre-fr` and `urbanisme-gpu` clamp their
 * own surfaces to the same ground, so the boundary underneath still has to
 * read through.
 */
export const SITADEL_FILL_ALPHA = 0.42;

/** Commune boundary — the scope of the answer, not a datum. */
export const SITADEL_OUTLINE_COLOR = '#7f8ea3';
const OUTLINE_WIDTH_PX = 2;
const OUTLINE_ALPHA = 0.75;

/** Parcel edge, so two adjacent plots in the same band stay two plots. */
const PARCEL_EDGE_COLOR = '#0b1220';
const PARCEL_EDGE_ALPHA = 0.55;
const PARCEL_EDGE_WIDTH_PX = 1.5;

/**
 * The edge of a plot that carries NO height, in its own band colour.
 *
 * The second sign of "this file publishes no dwelling count", and the one that
 * survives a nadir camera — from straight above a prism and a flat plot look
 * alike, and an outline does not. Brighter and half a pixel wider than the
 * neutral edge so it reads as a deliberate stroke rather than as the shared one
 * tinted by the fill under it.
 */
const PARCEL_EDGE_ALPHA_NO_HEIGHT = 0.95;
const PARCEL_EDGE_WIDTH_NO_HEIGHT_PX = 2;

const SELECTED_COLOR = '#00ffff';
const SELECTED_WIDTH_PX = 5;
const SELECTED_POINT_BONUS_PX = 5;
const POINT_OUTLINE_COLOR = Cesium.Color.fromCssColorString('#0b1220').withAlpha(0.85);

/** Dot radius range, in pixels. 5 px is one dwelling, 22 px is 200 or more. */
export const SITADEL_POINT_MIN_PX = 5;
export const SITADEL_POINT_MAX_PX = 22;

/**
 * Metres of prism per dwelling authorised. LINEAR — see the header.
 *
 * One metre is a scale a reader can hold: a prism is as many metres tall as the
 * permit creates dwellings, so it can be read against the BD TOPO volumes
 * beside it (a Nantes block is 10–30 m) without a ruler.
 */
export const SITADEL_METRES_PER_DWELLING = 1;

/**
 * Where the prism stops growing: {@link SITADEL_SIZE_CEILING_LGT} dwellings, so
 * 200 m. The dot and the prism saturate on the same measured number, and every
 * clipped prism is counted on the row while the card keeps the true count (A5).
 */
export const SITADEL_PRISM_MAX_M = SITADEL_SIZE_CEILING_LGT * SITADEL_METRES_PER_DWELLING;

/**
 * How long to wait before rebuilding a pack that was extruded while the shared
 * ground-floor grid was still cold.
 *
 * The same three seconds and the same once-per-key discipline
 * `bdtopoBuildings.js` uses: `resolveGroundFloorCellsBounded` gives up after
 * 1.2 s and the answer lands in the cache a moment later. Without this a
 * commune entered cold keeps every parcel flat until the camera happens to
 * cross into another commune.
 */
export const SITADEL_COLD_FLOOR_RETRY_MS = 3_000;

/**
 * Why a parcel has no height. Both are the same statement — the file publishes
 * no dwelling count — and they are told apart on screen by the band colour.
 */
export const SITADEL_NO_HEIGHT_DEMOLITION = 'demolition';
export const SITADEL_NO_HEIGHT_DWELLINGS = 'nodwellings';
/** Transient, not a class: the ground cell had not been resolved yet. */
export const SITADEL_NO_HEIGHT_COLD_FLOOR = 'coldfloor';

/**
 * Idle refresh.
 *
 * Six hours, and it is generous: DiDo publishes monthly (`frequency: "monthly"`,
 * `frequency_date: "2026-09-29"` on dataset 6513f0189d7d312c80ec5b5b) and the
 * Etalab cadastre republishes about quarterly (`latest` resolved to the
 * 2026-06-01 edition on 2026-09-02). This exists so a session left open across
 * a publication does not keep drawing the previous millésime, not because
 * anything moves.
 */
const UPDATE_INTERVAL_MS = 6 * 60 * 60_000;
/** A cold commune build is 5.9–6.6 s measured end to end; the timeout has to clear it. */
const REQUEST_TIMEOUT_MS = 60_000;
const CAMERA_DEBOUNCE_MS = 450;

/** Card anchor lift above the ground floor, in metres. */
const CARD_LIFT_M = 4;
/** Ground-floor warm-up budget. Paris draws 4 753 dots; the floor grid is coarse. */
const FLOOR_WARM_LIMIT = 600;

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
/** @type {?object} the one commune pack in hand */
let _payload = null;
/** @type {Map<number, {permit: object, index: number, permits: number}>} parcel slot → owner */
let _owners = new Map();
/** @type {?Cesium.PointPrimitiveCollection} */
let _points = null;
/** @type {?Cesium.GroundPrimitive} */
let _fills = null;
/** @type {?Cesium.Primitive} The extruded parcels — real geometry, not a drape. */
let _prisms = null;
/** What the last `drawSurfaces` did with the height channel. */
let _prismTally = null;
let _coldFloorTimer = null;
let _coldFloorKey = null;
/** @type {?Cesium.GroundPolylinePrimitive} */
let _edges = null;
/** @type {?Cesium.GroundPolylinePrimitive} */
let _outline = null;
/** @type {?Cesium.GroundPolylinePrimitive} */
let _highlight = null;
/** @type {?Cesium.Primitive} The selection ring on the ROOF of an extruded plot. */
let _highlightAir = null;
let _selectedId = null;
let _clickHandler = null;
let _moveEndRemover = null;
let _debounceTimer = null;
let _abort = null;
let _mapStackListener = null;
let _classificationType = Cesium.ClassificationType.BOTH;
/** @type {?boolean} `GroundPolylinePrimitive.isSupported`, checked once. */
let _groundLinesSupported = null;
let _loading = false;
let _error = null;
let _status = 'idle';
let _stale = false;
let _lastUpdate = null;
/** Rounded focus cell already asked for; null re-arms the ask. */
let _focusKey = null;
/** The commune the last answer named, even when it carried no pack. */
let _communeName = null;
let _fetchImpl = null;

// --- Camera -----------------------------------------------------------------

/**
 * The point on the globe the middle of the screen is looking at.
 *
 * `pickEllipsoid` and not the camera's own carto position: a 25°-pitched camera
 * 300 m above the Seine is asking about a commune two kilometres away, and the
 * question this layer answers is "which commune am I looking at", never "which
 * commune am I over".
 * @param {?object} viewer
 * @returns {?{lat: number, lon: number}}
 */
export function sitadelFocusPoint(viewer) {
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
 * The rounded cell a focus point falls in, or null.
 *
 * Rounded rather than floored so the key is symmetric about the grid line and a
 * camera nudged a metre back and forth does not alternate between two cells.
 * @param {?{lat: number, lon: number}} focus
 * @param {number} [gridDeg]
 * @returns {?string}
 */
export function sitadelFocusKey(focus, gridDeg = SITADEL_FOCUS_GRID_DEG) {
  const lat = finiteOrNull(focus?.lat);
  const lon = finiteOrNull(focus?.lon);
  if (lat === null || lon === null || !(gridDeg > 0)) return null;
  return `${Math.round(lat / gridDeg)},${Math.round(lon / gridDeg)}`;
}

/**
 * Where this camera may ask about, or the reason it may not.
 *
 * Three distinct refusals, kept distinct because each needs its own sentence:
 * no camera rectangle at all, a camera above the gate, and a camera whose
 * middle of screen does not land on the globe (looking at the sky over a
 * horizon). There is deliberately NO coverage refusal — see the header.
 * @param {?object} viewer
 * @returns {{focus: ?{lat: number, lon: number}, reason: ?string}}
 */
export function sitadelViewport(viewer) {
  if (!cameraViewBox(viewer)) return { focus: null, reason: 'no-view' };
  const altitude = viewer?.camera?.positionCartographic?.height;
  if (!Number.isFinite(altitude)) return { focus: null, reason: 'no-view' };
  if (altitude > SITADEL_MAX_ALTITUDE_M) return { focus: null, reason: 'too-high' };
  const focus = sitadelFocusPoint(viewer);
  if (!focus) return { focus: null, reason: 'no-view' };
  return { focus, reason: null };
}

// --- Projection of the pack into what is drawn ------------------------------

/**
 * Which permit colours each parcel, and how many others share it.
 *
 * `projectSitadelCommune` sorts `permits` newest authorisation first, so the
 * FIRST permit naming a slot is the most recent one — the parcel is coloured by
 * where its pipeline has got to, not by where it started. The count of the rest
 * is kept because it is the plot's history and the card prints it: measured on
 * Nantes, 2 747 placed permits name 3 032 distinct parcels, so most parcels
 * carry exactly one and the ones that carry more are the interesting ones.
 * @param {?object} payload
 * @returns {Map<number, {permit: object, index: number, permits: number}>}
 */
export function sitadelParcelOwners(payload) {
  const owners = new Map();
  const permits = Array.isArray(payload?.permits) ? payload.permits : [];
  for (let index = 0; index < permits.length; index += 1) {
    for (const slot of permits[index]?.px || []) {
      const held = owners.get(slot);
      if (held) held.permits += 1;
      else owners.set(slot, { permit: permits[index], index, permits: 1 });
    }
  }
  return owners;
}

/**
 * Where one permit's dot stands: the anchor of the LARGEST parcel it names.
 *
 * Largest and not first, and never a midpoint between them. 426 of Nantes'
 * 2 747 placed permits name several parcels, and the mean of two centroids is a
 * coordinate nobody published — it can land in the street between them. The
 * anchor of the biggest plot is a point the cadastre's own geometry produced.
 * @param {?object} permit
 * @param {Array<object>} parcels
 * @returns {?{lat: number, lon: number}}
 */
export function sitadelPermitAnchor(permit, parcels = []) {
  let best = null;
  let bestArea = -Infinity;
  for (const slot of permit?.px || []) {
    const parcel = parcels?.[slot];
    const point = parcel?.p;
    if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
    const area = finiteOrNull(parcel.a) ?? 0;
    if (area > bestArea) { bestArea = area; best = point; }
  }
  return best ? { lon: best[0], lat: best[1] } : null;
}

/**
 * Dot radius for one permit.
 *
 * A demolition always draws at the minimum, and that is not a fallback: the
 * permis de démolir file has 33 columns and none of them counts a dwelling or a
 * surface, so any size above the floor would be a claim the file does not
 * make. The card says which of "nothing was created" and "nothing was
 * published" applies.
 * @param {?object} permit
 * @returns {number}
 */
export function sitadelPermitSize(permit) {
  if (permit?.f === 'dem') return SITADEL_POINT_MIN_PX;
  return sitadelPointSize(permit?.lgt, SITADEL_POINT_MIN_PX, SITADEL_POINT_MAX_PX);
}

/** Colour for one permit — its lifecycle band, or the demolition band. */
export function sitadelPermitColor(permit) {
  return sitadelBandColor(permit?.b);
}

/**
 * Why this permit's parcel carries no height, or null when it carries one.
 *
 * Two answers, and they are the SAME sentence about the register: nobody
 * counted a dwelling. A demolition is structural — 33 columns, none of them a
 * dwelling. A housing permit at zero is `finiteOrNull(NB_LGT_TOT_CREES) ?? 0`
 * in `sitadelFeed.js`, which has already folded "published zero" into "blank"
 * before this file sees it, so the refusal names both and picks neither.
 * @param {?object} permit
 * @returns {?string} one of the `SITADEL_NO_HEIGHT_*` reasons.
 */
export function sitadelHeightRefusal(permit) {
  if (permit?.f === 'dem') return SITADEL_NO_HEIGHT_DEMOLITION;
  const created = finiteOrNull(permit?.lgt);
  if (created === null || created <= 0) return SITADEL_NO_HEIGHT_DWELLINGS;
  return null;
}

/**
 * Prism height for one permit, in metres above its own ground.
 *
 * Linear in dwellings and clipped at {@link SITADEL_PRISM_MAX_M}. Zero means
 * "no height claim" and NEVER "zero dwellings drawn flat by accident" — the
 * callers ask {@link sitadelHeightRefusal} for the reason and draw a different
 * sign, they do not extrude to nothing.
 * @param {?object} permit
 * @returns {number} metres, 0 when the file publishes no dwelling count.
 */
export function sitadelPrismHeightM(permit) {
  if (sitadelHeightRefusal(permit)) return 0;
  const created = finiteOrNull(permit.lgt);
  return Math.min(created, SITADEL_SIZE_CEILING_LGT) * SITADEL_METRES_PER_DWELLING;
}

/** True when the prism stopped short of the permit's real dwelling count. */
export function sitadelPrismClipped(permit) {
  const created = finiteOrNull(permit?.lgt);
  return !sitadelHeightRefusal(permit) && created > SITADEL_SIZE_CEILING_LGT;
}

/**
 * The ellipsoidal floor a parcel's prism stands on, or null when the shared
 * grid has not resolved that cell yet.
 *
 * Read at the parcel's OWN anchor rather than at the permit's — a permit naming
 * three plots across a slope would otherwise sink two of them. Null is a real
 * answer and the caller must not turn it into 0: the ellipsoid is 44–55 m below
 * the ground in metropolitan France, and a prism based there is a hole.
 * @param {?object} parcel One entry of `payload.parcels`.
 * @returns {?number}
 */
export function sitadelParcelFloorM(parcel) {
  const point = parcel?.p;
  if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
    return null;
  }
  const floor = cachedGroundFloor(point[1], point[0]);
  return Number.isFinite(floor) ? floor : null;
}

/**
 * Render records for one pack, one per PLACED permit.
 *
 * The id carries the commune, the file and the permit's ordinal, never
 * `NUM_DAU` alone: the registration number is not a primary key — 3 561
 * distinct values across Paris' 3 595 housing rows, so 34 permits share one
 * with another — and two records under one id would silently drop a card.
 * @param {?object} payload
 * @returns {Array<object>}
 */
export function sitadelPermitRecords(payload) {
  const parcels = Array.isArray(payload?.parcels) ? payload.parcels : [];
  const insee = String(payload?.insee ?? '');
  const records = [];
  const permits = Array.isArray(payload?.permits) ? payload.permits : [];
  for (let index = 0; index < permits.length; index += 1) {
    const permit = permits[index];
    const at = sitadelPermitAnchor(permit, parcels);
    // A permit with no usable anchor is not drawn and not counted as drawn.
    // `projectSitadelCommune` already refuses to emit a parcel it could not
    // anchor, so this only fires on a malformed payload — and it fires quietly
    // rather than putting a NaN at the centre of the Earth.
    if (!at) continue;
    records.push({
      id: `${SITADEL_FR_LAYER_ID}:${insee}:${permit.f || 'lgt'}:${index}`,
      kind: 'permit',
      permit,
      index,
      at,
      color: sitadelPermitColor(permit),
      basePixelSize: sitadelPermitSize(permit),
    });
  }
  return records;
}

// --- Geometry ---------------------------------------------------------------

/**
 * Cesium positions for one ring, dropping the repeated closing vertex.
 *
 * `PolygonGeometry` closes its own rings and a duplicated last point makes a
 * degenerate triangle at the seam; `GroundPolylineGeometry` needs the closure
 * put back, which the two callers below do explicitly.
 * @param {Array<number[]>} ring
 * @returns {?object}
 */
export function sitadelRingPositions(ring) {
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
 * The same ring, lifted to an absolute ellipsoidal height.
 *
 * Used only by the selection, which has to reach the ROOF of an extruded plot:
 * a ground-clamped highlight under an opaque prism is a highlight nobody sees.
 * @param {Array<number[]>} ring
 * @param {number} heightM
 * @returns {?object}
 */
export function sitadelRingPositionsAtHeight(ring, heightM) {
  if (!Array.isArray(ring) || ring.length < 3 || !Number.isFinite(heightM)) return null;
  const last = ring.length - 1;
  const closed = ring[0][0] === ring[last][0] && ring[0][1] === ring[last][1];
  const degrees = [];
  const stop = closed ? last : ring.length;
  for (let i = 0; i < stop; i += 1) {
    const point = ring[i];
    if (!Array.isArray(point)) continue;
    const [lon, lat] = point;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    degrees.push(lon, lat, heightM);
  }
  return degrees.length >= 9 ? Cesium.Cartesian3.fromDegreesArrayHeights(degrees) : null;
}

function removeGround(primitive) {
  if (!primitive) return;
  _viewer?.scene?.groundPrimitives?.remove?.(primitive);
}

function clearHighlight() {
  if (_highlight) {
    removeGround(_highlight);
    _highlight = null;
  }
  if (_highlightAir) {
    _viewer?.scene?.primitives?.remove?.(_highlightAir);
    _highlightAir = null;
  }
}

function clearSurfaces() {
  removeGround(_fills);
  removeGround(_edges);
  removeGround(_outline);
  // The prisms are NOT ground primitives — they carry no classification type
  // and live in the ordinary primitive list, which is the whole point of them.
  if (_prisms) _viewer?.scene?.primitives?.remove?.(_prisms);
  _fills = null;
  _prisms = null;
  _edges = null;
  _outline = null;
  clearHighlight();
}

/** Drop the pending cold-floor rebuild. */
function clearColdFloorRetry() {
  if (_coldFloorTimer) { clearTimeout(_coldFloorTimer); _coldFloorTimer = null; }
}

function groundLinesSupported() {
  if (_groundLinesSupported === null && _viewer?.scene) {
    _groundLinesSupported = Cesium.GroundPolylinePrimitive.isSupported(_viewer.scene);
    if (!_groundLinesSupported) {
      console.warn('[Data:Sitadel FR] GroundPolylinePrimitive unsupported — parcel edges and commune outline disabled');
    }
  }
  return _groundLinesSupported !== false;
}

// --- Drawing ----------------------------------------------------------------

/**
 * Rebuild the three ground batches for the whole commune.
 *
 * THREE primitives and not 4 500: measured 2026-09-02, Paris' pack draws 4 500
 * parcel parts and 70 766 vertices and Nantes' 3 032 parts and 47 676, which is
 * one batched tessellation each — `fraicheur-fr` already batches 127 465 on
 * this globe. `releaseGeometryInstances` stays false so a selection can recolour
 * one instance in place instead of paying a second full tessellation to light
 * one plot.
 * @param {?object} payload
 */
function drawSurfaces(payload) {
  clearSurfaces();
  _prismTally = null;
  if (!_viewer?.scene?.groundPrimitives || !payload) return;
  const parcels = Array.isArray(payload.parcels) ? payload.parcels : [];
  const fillInstances = [];
  const prismInstances = [];
  const edgeInstances = [];
  const tally = {
    parcels: 0,
    prisms: 0,
    clipped: 0,
    tallestM: 0,
    demolition: 0,
    noDwellings: 0,
    coldFloor: 0,
  };

  for (let slot = 0; slot < parcels.length; slot += 1) {
    const owner = _owners.get(slot);
    if (!owner) continue;
    const record = _records.get(recordIdFor(payload, owner));
    if (!record) continue;
    tally.parcels += 1;
    const band = Cesium.Color.fromCssColorString(record.color);
    const color = band.withAlpha(SITADEL_FILL_ALPHA);

    // Three outcomes for the height channel, decided once per parcel: a prism,
    // a plot the register gave no count for, or a plot whose ground is not yet
    // known. Only the middle one is a CLASS; the third is a loading state and
    // must not be given the class's sign.
    const refusal = sitadelHeightRefusal(record.permit);
    const heightM = refusal ? 0 : sitadelPrismHeightM(record.permit);
    const floorM = heightM > 0 ? sitadelParcelFloorM(parcels[slot]) : null;
    const extruded = heightM > 0 && floorM !== null;
    if (refusal === SITADEL_NO_HEIGHT_DEMOLITION) tally.demolition += 1;
    else if (refusal === SITADEL_NO_HEIGHT_DWELLINGS) tally.noDwellings += 1;
    else if (!extruded) tally.coldFloor += 1;

    // The parcel edge is the second sign, and it carries ONE thing: a plot
    // outlined in its own band colour is a plot whose file publishes no
    // dwelling count. A plot still waiting for its ground cell keeps the
    // neutral edge, because it is going to be a prism.
    const edgeColor = refusal
      ? band.withAlpha(PARCEL_EDGE_ALPHA_NO_HEIGHT)
      : Cesium.Color.fromCssColorString(PARCEL_EDGE_COLOR).withAlpha(PARCEL_EDGE_ALPHA);
    const edgeWidth = refusal ? PARCEL_EDGE_WIDTH_NO_HEIGHT_PX : PARCEL_EDGE_WIDTH_PX;

    for (const part of parcels[slot]?.g || []) {
      const outer = sitadelRingPositions(part[0]);
      if (!outer) continue;
      const holes = [];
      for (let h = 1; h < part.length; h += 1) {
        const hole = sitadelRingPositions(part[h]);
        // 190 of Nantes' 58 099 parcels carry an interior ring. Kept: a hole
        // filled in is ground attributed to a permit that does not cover it.
        if (hole) holes.push(new Cesium.PolygonHierarchy(hole));
      }
      // The ground wash stays under every parcel, prism or not. At the top of
      // this layer's altitude range a 1-dwelling prism is 0.05 px of screen
      // height and the wash is all there is; the prism is added to it, never
      // substituted for it.
      fillInstances.push(new Cesium.GeometryInstance({
        id: record.id,
        geometry: new Cesium.PolygonGeometry({
          polygonHierarchy: new Cesium.PolygonHierarchy(outer, holes),
          vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
        }),
        attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(color) },
      }));
      if (extruded) {
        prismInstances.push(new Cesium.GeometryInstance({
          id: record.id,
          geometry: new Cesium.PolygonGeometry({
            polygonHierarchy: new Cesium.PolygonHierarchy(outer, holes),
            height: floorM,
            extrudedHeight: floorM + heightM,
            vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
            closeTop: true,
            // Closed: on a slope the base of a volume breaks the surface, and
            // an open bottom shows the inside of the far walls through it.
            closeBottom: true,
          }),
          // Opaque. See the header: translucent geometry does not write depth.
          attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(band) },
        }));
      }
      for (const ring of part) {
        const positions = sitadelRingPositions(ring);
        if (!positions) continue;
        edgeInstances.push(new Cesium.GeometryInstance({
          id: record.id,
          geometry: new Cesium.GroundPolylineGeometry({
            positions: [...positions, positions[0]],
            width: edgeWidth,
          }),
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(edgeColor),
          },
        }));
      }
    }
    if (extruded) {
      tally.prisms += 1;
      if (sitadelPrismClipped(record.permit)) tally.clipped += 1;
      if (heightM > tally.tallestM) tally.tallestM = heightM;
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
  if (prismInstances.length) {
    _prisms = _viewer.scene.primitives.add(new Cesium.Primitive({
      geometryInstances: prismInstances,
      // Lit, not flat: without normals a row of one-colour boxes reads as a
      // single mass and the shape — which is the datum — is lost.
      appearance: new Cesium.PerInstanceColorAppearance({ closed: true, translucent: false }),
      asynchronous: true,
      releaseGeometryInstances: false,
    }));
    _prisms.show = _enabled;
  }
  if (edgeInstances.length && groundLinesSupported()) {
    _edges = _viewer.scene.groundPrimitives.add(new Cesium.GroundPolylinePrimitive({
      geometryInstances: edgeInstances,
      appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
      classificationType: _classificationType,
      asynchronous: true,
      releaseGeometryInstances: false,
    }));
    _edges.show = _enabled;
  }

  const outlineInstances = [];
  for (const part of payload.outline?.parts || []) {
    for (const ring of part) {
      const positions = sitadelRingPositions(ring);
      if (!positions) continue;
      outlineInstances.push(new Cesium.GeometryInstance({
        geometry: new Cesium.GroundPolylineGeometry({
          positions: [...positions, positions[0]],
          width: OUTLINE_WIDTH_PX,
        }),
        attributes: {
          color: Cesium.ColorGeometryInstanceAttribute.fromColor(
            Cesium.Color.fromCssColorString(SITADEL_OUTLINE_COLOR).withAlpha(OUTLINE_ALPHA),
          ),
        },
      }));
    }
  }
  if (outlineInstances.length && groundLinesSupported()) {
    _outline = _viewer.scene.groundPrimitives.add(new Cesium.GroundPolylinePrimitive({
      geometryInstances: outlineInstances,
      appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
      classificationType: _classificationType,
      asynchronous: true,
    }));
    _outline.show = _enabled;
  }
  _prismTally = tally;
  scheduleColdFloorRebuild(payload, tally);
}

/**
 * Ask again once the shared ground grid has landed.
 *
 * Once per commune: a genuinely unreachable terrain proxy costs one extra
 * rebuild, not a loop. The rebuild is local — the pack is still in hand, so
 * this is a re-tessellation and no network at all.
 * @param {?object} payload
 * @param {object} tally
 */
function scheduleColdFloorRebuild(payload, tally) {
  clearColdFloorRetry();
  const key = String(payload?.insee ?? '');
  if (!tally.coldFloor || !key || _coldFloorKey === key) return;
  _coldFloorKey = key;
  _coldFloorTimer = setTimeout(() => {
    _coldFloorTimer = null;
    if (!_enabled || !_payload) return;
    const selected = _selectedId;
    drawSurfaces(_payload);
    if (selected && _records.has(selected)) selectPermit(selected);
    governorRequestRender('sitadel-fr-cold-floor');
  }, SITADEL_COLD_FLOOR_RETRY_MS);
}

/** The render id of the permit that owns a parcel, from the owner entry. */
function recordIdFor(payload, owner) {
  return `${SITADEL_FR_LAYER_ID}:${String(payload?.insee ?? '')}:${owner.permit?.f || 'lgt'}:${owner.index}`;
}

/** Shared, because `PointPrimitive` CLONES both of these on assignment. */
const POINT_FADE = new Cesium.NearFarScalar(300, 1.0, 30_000, 0.4);
const _colorCache = new Map();
function cssColor(css) {
  let color = _colorCache.get(css);
  if (!color) {
    color = Cesium.Color.fromCssColorString(css);
    _colorCache.set(css, color);
  }
  return color;
}

/**
 * Rebuild every record and every primitive from the pack in hand.
 *
 * The selection is dropped rather than restored, unlike `fraicheur-fr`'s
 * refresh: this only runs when the COMMUNE changed, so the card the operator
 * was reading describes a permit that is no longer on the screen.
 * `applyClassification` re-selects, because that rebuild is the same commune.
 * @param {?object} payload
 */
function drawPack(payload) {
  clearSelection();
  clearColdFloorRetry();
  _records = new Map();
  _owners = sitadelParcelOwners(payload);
  _points?.removeAll();

  const warm = [];
  for (const record of sitadelPermitRecords(payload)) {
    if (_points) {
      const floor = cachedGroundFloor(record.at.lat, record.at.lon);
      record.point = _points.add({
        id: record.id,
        position: Cesium.Cartesian3.fromDegrees(
          record.at.lon, record.at.lat, (Number.isFinite(floor) ? floor : 0) + 1,
        ),
        color: cssColor(record.color),
        pixelSize: record.basePixelSize,
        outlineColor: POINT_OUTLINE_COLOR,
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        translucencyByDistance: POINT_FADE,
      });
    }
    _records.set(record.id, record);
    if (warm.length < FLOOR_WARM_LIMIT) warm.push(record.at);
  }
  drawSurfaces(payload);
  if (warm.length) warmGroundFloor(warm);
  governorRequestRender('sitadel-fr-draw');
}

/** Re-classify against the active surface, rebuilding the baked ground batches. */
function applyClassification(next) {
  if (next === undefined || next === _classificationType) return;
  _classificationType = next;
  // The prisms have no classification type, but they DO move: the shared floor
  // grid prefers the rendered photoreal mesh over the DEM the moment that stack
  // is active, so the ground a parcel stands on changes with the basemap. The
  // rebuild below covers both, and re-arms the cold-floor retry because the
  // mesh cells for this commune have not been sampled yet.
  _coldFloorKey = null;
  // `classificationType` is read when a ground primitive is built, so an
  // already-built one has to be rebuilt rather than mutated. The pack is still
  // in hand, so this costs a re-tessellation and no network at all.
  const selected = _selectedId;
  if (_payload) drawSurfaces(_payload);
  // `drawSurfaces` tears down the highlight with the batch it was drawn over,
  // so a permit selected when the operator switches map stack would keep its
  // card and silently lose its outline.
  if (selected && _records.has(selected)) selectPermit(selected);
  _viewer?.scene?.requestRender?.();
}

// --- Cards ------------------------------------------------------------------

/** French thousands separator, matching the rest of the French packs. */
function fr(value) {
  return Number(value).toLocaleString('fr-FR');
}

function pct(part, whole) {
  if (!(whole > 0)) return null;
  return `${((100 * part) / whole).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
}

/**
 * The provenance block every card ends with.
 *
 * Three lines, and none of them is optional. The first is the commune's own
 * join rate, because a permit drawn in Toulouse (7.6% placed) and a permit
 * drawn in Paris (91.3%) are not the same kind of claim. The second is the
 * YEAR's rate, because the failure is age-dependent — a parcel is divided and
 * renumbered precisely when somebody builds on it, so 2013 places at 60% in
 * Nantes and 2026 at 97%. The third names the two editions the join was made
 * between, since neither is pinned.
 * @param {?object} payload
 * @param {?object} [permit] Adds the permit's own year band when given.
 * @returns {string[]}
 */
export function sitadelJoinLines(payload, permit = null) {
  const summary = payload?.summary;
  if (!summary) return [];
  const lines = [];
  const name = payload.commune || payload.insee || 'cette commune';
  lines.push(`${name} : ${fr(summary.placed)} des ${fr(summary.permits)} autorisations posées`
    + ` (${pct(summary.placed, summary.permits) || '—'}) — jointure cadastrale, aucune coordonnée publiée`);
  const year = permit?.y;
  const tally = year ? (payload.years || []).find((entry) => entry.year === year) : null;
  if (tally && tally.permits > 0) {
    lines.push(`Autorisations de ${year} ici : ${fr(tally.placed)} des ${fr(tally.permits)} posées`
      + ` (${pct(tally.placed, tally.permits)}) — une parcelle est divisée quand on y construit`);
  }
  lines.push(`Sitadel millésime ${payload.millesime || '—'} · cadastre Etalab ${payload.cadastreEdition || '—'}`);
  return lines;
}

/**
 * Card copy for one selected permit.
 *
 * The feed builds the permit's own card — what was authorised, how far it has
 * got, what it creates, what it removes, which parcel and how well the area
 * checks out. This adds the two things only the drawing knows: how many OTHER
 * authorisations share this plot, and the rates above.
 * @param {?object} record
 * @param {?object} [payload]
 * @returns {string}
 */
export function buildSitadelSelectionLabel(record, payload = _payload) {
  const permit = record?.permit;
  if (!permit) return '';
  const parcels = Array.isArray(payload?.parcels) ? payload.parcels : [];
  const [title, ...details] = buildSitadelPermitCard(permit, parcels);

  // The plot's own history. `owners` counts every permit that names the parcel,
  // so the "others" are that minus this one — and it is only printed when the
  // parcel really is shared, which measured on Nantes is the minority.
  let shared = 0;
  for (const slot of permit.px || []) {
    shared = Math.max(shared, (_owners.get(slot)?.permits || 1) - 1);
  }
  if (shared > 0) {
    details.push(`${fr(shared)} autre${shared > 1 ? 's' : ''} autorisation${shared > 1 ? 's' : ''}`
      + ' sur cette parcelle depuis 2013');
  }
  details.push(...sitadelJoinLines(payload, permit));
  details.push(`SDES / CGDD — ${SITADEL_LICENCE} · parcelles DGFiP / Etalab`);
  return [title, ...details.filter(Boolean)].join('\n');
}

/** Protected selected-permit entry for the shared overlay host. */
export function createSitadelSelectedOverlayEntry(record, payload = _payload) {
  if (!record?.id || !record?.at) return null;
  const floor = cachedGroundFloor(record.at.lat, record.at.lon);
  const position = Cesium.Cartesian3.fromDegrees(
    record.at.lon, record.at.lat, (Number.isFinite(floor) ? floor : 0) + CARD_LIFT_M,
  );
  const text = buildSitadelSelectionLabel(record, payload);
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
    accent: record.color || SELECTED_COLOR,
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
    record.point.outlineColor = POINT_OUTLINE_COLOR;
    record.point.outlineWidth = 1;
  }
  if (_selectedId) {
    _selectedId = null;
    _overlayHost.clearSource(SITADEL_FR_OVERLAY_SOURCE_ID);
    governorRequestRender('sitadel-fr-deselect');
  }
}

/**
 * Select one permit, from its dot or from any parcel it was drawn on.
 *
 * The dot is a `PointPrimitive` and mutable, so it is enlarged in place. The
 * parcels are batched geometry instances and are not, so the plot is ringed
 * with a second ground polyline — the same technique `cadastre-fr`,
 * `fraicheur-fr` and `comptages-fr` use, and for the same reason: rebuilding
 * 70 766 vertices to light one plot is not a click.
 * @param {string} id
 */
function selectPermit(id) {
  clearSelection();
  const record = _records.get(id);
  if (!record || !_viewer) return;
  _selectedId = id;
  if (record.point && !record.point.isDestroyed?.()) {
    record.point.pixelSize = record.basePixelSize + SELECTED_POINT_BONUS_PX;
    record.point.outlineColor = Cesium.Color.fromCssColorString(SELECTED_COLOR);
    record.point.outlineWidth = 2;
  }
  const parcels = Array.isArray(_payload?.parcels) ? _payload.parcels : [];
  // The ring goes on the ROOF of an extruded plot and on the GROUND of a flat
  // one. A ground-clamped highlight under an opaque prism is a selection the
  // operator cannot see, and "the plot I clicked" is the one thing the card
  // cannot draw.
  const heightM = sitadelPrismHeightM(record.permit);
  const cyan = Cesium.Color.fromCssColorString(SELECTED_COLOR).withAlpha(0.85);
  const groundInstances = [];
  const airInstances = [];
  for (const slot of record.permit?.px || []) {
    const floorM = heightM > 0 ? sitadelParcelFloorM(parcels[slot]) : null;
    const roofM = floorM === null ? null : floorM + heightM;
    for (const part of parcels[slot]?.g || []) {
      for (const ring of part) {
        if (roofM !== null) {
          const lifted = sitadelRingPositionsAtHeight(ring, roofM);
          if (lifted) {
            airInstances.push(new Cesium.GeometryInstance({
              geometry: new Cesium.PolylineGeometry({
                positions: [...lifted, lifted[0]],
                width: SELECTED_WIDTH_PX,
                vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT,
              }),
              attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(cyan) },
            }));
            continue;
          }
        }
        const positions = sitadelRingPositions(ring);
        if (!positions) continue;
        groundInstances.push(new Cesium.GeometryInstance({
          geometry: new Cesium.GroundPolylineGeometry({
            positions: [...positions, positions[0]],
            width: SELECTED_WIDTH_PX,
          }),
          attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(cyan) },
        }));
      }
    }
  }
  if (groundInstances.length && groundLinesSupported()) {
    _highlight = _viewer.scene.groundPrimitives.add(new Cesium.GroundPolylinePrimitive({
      geometryInstances: groundInstances,
      appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
      classificationType: _classificationType,
    }));
  }
  if (airInstances.length) {
    _highlightAir = _viewer.scene.primitives.add(new Cesium.Primitive({
      geometryInstances: airInstances,
      appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
      asynchronous: false,
      allowPicking: false,
    }));
  }
  const entry = createSitadelSelectedOverlayEntry(record, _payload);
  if (entry) {
    _overlayHost.setEntries(
      SITADEL_FR_OVERLAY_SOURCE_ID, [entry], SITADEL_FR_OVERLAY_SOURCE_OPTIONS,
    );
  }
  governorRequestRender('sitadel-fr-select');
}

function onKeyDown(event) {
  if (event.key === 'Escape' && _selectedId) clearSelection();
}

/**
 * Resolve a Cesium pick into one of this layer's ids.
 *
 * A `PointPrimitive` reports the id it was added with; a batched ground
 * primitive reports the `GeometryInstance` id. Both are strings here and both
 * are checked against the record index rather than trusted, because
 * `cadastre-fr` clamps its own parcels to the same ground.
 * @param {?object} picked
 * @param {(id: string) => boolean} [has]
 * @returns {?string}
 */
export function resolveSitadelPickId(picked, has = (id) => _records.has(id)) {
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
    const id = resolveSitadelPickId(viewer.scene.pick(movement.position));
    if (id) {
      selectPermit(id);
      return;
    }
    if (_selectedId) clearSelection();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  if (typeof document !== 'undefined') document.addEventListener('keydown', onKeyDown);
}

// --- Loading ----------------------------------------------------------------

/**
 * Ask the proxy about the commune under the middle of the screen.
 *
 * `have=` is the whole reason this is cheap. The proxy resolves the commune
 * from `geo.api.gouv.fr` — which is the only service that knows where a commune
 * boundary is — and when the answer is the commune already in hand it replies
 * `{unchanged: true}` in a few hundred bytes instead of the 0.07–0.68 MB pack.
 * So panning across a city costs one small round trip per 0.01° cell and
 * crossing into the next commune costs the pack once.
 * @param {object} [options]
 * @returns {Promise<boolean>} Whether anything was redrawn.
 */
async function load({ force = false } = {}) {
  if (!_enabled || !_viewer) return false;
  const { focus, reason } = sitadelViewport(_viewer);
  if (!focus) {
    // A refusal is guidance, not a fault, and it must not blank a pack the
    // operator can still read by descending again. The drawing stays; the row
    // says why nothing new is coming.
    _status = reason === 'too-high' ? 'too-high' : 'no-view';
    _loading = false;
    _focusKey = null;
    return false;
  }
  const key = sitadelFocusKey(focus);
  if (!force && key && key === _focusKey) return false;
  _focusKey = key;

  _abort?.abort();
  const controller = new AbortController();
  _abort = controller;
  _loading = !_payload;
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const fetchImpl = _fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!fetchImpl) throw new Error('no fetch available');
    const params = new URLSearchParams({ lat: focus.lat.toFixed(6), lon: focus.lon.toFixed(6) });
    if (_payload?.insee && !force) params.set('have', String(_payload.insee));
    const response = await fetchImpl(`${SITADEL_COMMUNE_URL}?${params}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (controller.signal.aborted || !_enabled) return false;

    if (body?.unchanged === true) {
      _error = null;
      _status = _records.size ? 'ready' : 'empty';
      return false;
    }
    if (!body?.insee) {
      // geo.api.gouv.fr found no French commune under that point. Not an error:
      // the operator is over the sea, over Switzerland, or over a lake. The
      // previous commune is cleared, because leaving it drawn would attribute
      // its permits to ground it does not cover.
      _communeName = null;
      _payload = null;
      _records = new Map();
      _owners = new Map();
      _points?.removeAll();
      clearColdFloorRetry();
      clearSurfaces();
      governorRequestRender('sitadel-fr-no-commune');
      _status = 'no-commune';
      _error = null;
      return true;
    }
    if (!Array.isArray(body.permits) || !Array.isArray(body.parcels)) throw new Error('malformed payload');
    _payload = body;
    _communeName = body.commune || body.insee;
    _stale = Boolean(body.stale);
    _lastUpdate = Number(body.fetchedAt) || Date.now();
    _error = null;
    drawPack(body);
    _status = _records.size ? 'ready' : 'empty';
    return true;
  } catch (error) {
    if (error?.name === 'AbortError') return false;
    console.warn('[Data:Sitadel FR] commune unavailable:', error?.message || error);
    // A pack already in hand still describes the same commune — DiDo publishes
    // monthly. Keep drawing it and say the refresh failed rather than blanking
    // a city because one query timed out.
    _error = _payload
      ? 'rafraîchissement des autorisations d’urbanisme indisponible'
      : 'autorisations d’urbanisme (Sitadel) indisponibles';
    _status = _payload ? 'ready' : 'unavailable';
    // Re-arm: the cell was never actually answered, so the next camera settle
    // must be allowed to ask again.
    _focusKey = null;
    return false;
  } finally {
    clearTimeout(timer);
    _loading = false;
    if (_abort === controller) _abort = null;
  }
}

function scheduleLoad() {
  clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(() => { void load(); }, CAMERA_DEBOUNCE_MS);
}

// --- Detection --------------------------------------------------------------

/**
 * Candidates for the DETECT callout, in the order they are worth calling out.
 *
 * NOT a stride over every permit. A commune answers with up to 4 753 of them
 * and they are not equally interesting: what is being BUILT right now
 * (`Chantier ouvert`) is the finding, then what is authorised and has not
 * started, then what is coming down, and a permit finished years ago is the
 * thing `bdtopo-buildings` already draws. Inside each tier the biggest
 * creations come first, because "553 dwellings" is a callout and "1 dwelling"
 * is a hundred thousand callouts.
 * @param {object} [options]
 * @returns {Array<object>}
 */
function collectDetectableObjects(options = {}) {
  if (!_enabled || !_records.size) return [];
  const maxCount = Number.isFinite(options.maxCount)
    ? Math.max(1, Math.floor(options.maxCount))
    : 2600;
  const tiers = [[], [], [], []];
  for (const record of _records.values()) {
    const band = record.permit?.b;
    if (band === 'commence') tiers[0].push(record);
    else if (band === 'autorise') tiers[1].push(record);
    else if (band === 'demolition') tiers[2].push(record);
    else tiers[3].push(record);
  }
  const byDwellings = (a, b) => (finiteOrNull(b.permit?.lgt) ?? 0) - (finiteOrNull(a.permit?.lgt) ?? 0);
  const ordered = [];
  for (const tier of tiers) ordered.push(...tier.sort(byDwellings));
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
      id: sitadelDetectLabel(record),
      type: sitadelDetectType(record),
      skipLabel: record.id === _selectedId,
    });
    if (result.length >= maxCount) break;
  }
  return result;
}

/** The one line the DETECT callout shows for a permit. */
export function sitadelDetectLabel(record) {
  const permit = record?.permit;
  if (!permit) return 'Autorisation d’urbanisme';
  const street = [permit.an, permit.av].filter(Boolean).join(' ');
  return street || permit.dem || sitadelPermitTitle(permit);
}

/** English type noun for the DETECT callout. */
export function sitadelDetectType(record) {
  if (record?.permit?.f === 'dem') return 'Demolition permit';
  if (record?.permit?.b === 'commence') return 'Building site';
  return 'Building permit';
}

/**
 * The height key — the rows without a swatch.
 *
 * A height scale is not a colour, so these entries carry `color: null`, which
 * the map legend renders as an aligned "not drawn here" line rather than as a
 * class (`manager.js` handles it explicitly). Without them the prisms are a
 * relief nobody can read a number off, which is D1 applied to the one channel
 * this layer just took possession of.
 *
 * The count on each row is what makes it a legend row and not a caption: the
 * scale row counts the plots that stand up, the flat row counts the plots that
 * do not, and the sum is every parcel drawn.
 * @param {?object} tally From the last `drawSurfaces`.
 * @returns {Array<object>}
 */
export function sitadelHeightLegend(tally) {
  if (!tally || !tally.parcels) return [];
  const rows = [];
  const flat = tally.demolition + tally.noDwellings;
  if (tally.prisms) {
    rows.push({
      label: `Hauteur = logements autorisés · 1 logement = ${SITADEL_METRES_PER_DWELLING} m`,
      color: null,
      count: tally.prisms,
      blurb: `Parcelles extrudées. Échelle linéaire — deux fois plus haut, deux fois plus de `
        + `logements — plafonnée à ${SITADEL_PRISM_MAX_M} m (${SITADEL_SIZE_CEILING_LGT} logements, `
        + `99ᵉ centile mesuré à 190 sur 22 474 permis)`
        + (tally.clipped
          ? ` · ${fr(tally.clipped)} parcelle${tally.clipped > 1 ? 's' : ''} écrêtée${tally.clipped > 1 ? 's' : ''}, la fiche garde le vrai compte.`
          : ' · aucune parcelle écrêtée ici.'),
    });
  }
  if (flat) {
    rows.push({
      label: 'Sans hauteur — parcelle à plat, bordée de sa propre couleur',
      color: null,
      count: flat,
      blurb: `${fr(tally.demolition)} permis de démolir, dont le fichier a 33 colonnes et pas `
        + `une qui compte un logement, et ${fr(tally.noDwellings)} autorisation`
        + `${tally.noDwellings > 1 ? 's' : ''} ne créant aucun logement ou n'en publiant pas le `
        + 'nombre — les deux arrivent ici confondues. Aucune hauteur nulle : un chiffre que le '
        + 'fichier ne donne pas ne se dessine pas.',
    });
  }
  if (tally.coldFloor) {
    rows.push({
      label: 'Sol pas encore résolu — à plat en attendant',
      color: null,
      count: tally.coldFloor,
      blurb: 'État transitoire, pas une classe : la grille d’altitude partagée n’a pas encore '
        + 'répondu pour ces parcelles. Une seule nouvelle tentative, trois secondes plus tard. '
        + 'Leur bordure reste neutre, parce qu’elles vont se lever.',
    });
  }
  return rows;
}

// --- Row label --------------------------------------------------------------

/**
 * One line under the layer's toggle: which commune answered, and what it did
 * NOT place.
 *
 * The commune comes first on purpose. This layer holds ONE commune, and a
 * reader who does not know that reads the empty commune next door as "nothing
 * was authorised there" instead of "that was never asked".
 * @param {object} [state]
 * @returns {?string}
 */
export function buildSitadelLoadingLabel({
  payload = _payload,
  status = _status,
  loading = _loading,
  commune = _communeName,
  tally = _prismTally,
} = {}) {
  if (loading) return sitadelLoadingLabel({ status: 'loading', commune });
  if (status === 'too-high') return sitadelLoadingLabel({ status: 'too-high' });
  if (status === 'no-view') return 'Le centre de l’écran ne touche pas le sol — vise le terrain';
  if (status === 'no-commune') return sitadelLoadingLabel({ status: 'no-commune' });
  if (!payload?.summary) return null;
  const head = sitadelLoadingLabel({
    status: 'ready',
    commune: payload.commune,
    summary: payload.summary,
    millesime: payload.millesime,
  });
  const notes = [];
  if (payload.summary.demolitionAvailable === false) notes.push('fichier des démolitions indisponible');
  if (payload.outline?.simplified) notes.push('contour communal simplifié');
  // The scale, on the line that is visible without opening anything. A relief
  // whose unit is only in a panel is a relief nobody can read (D1).
  if (tally?.prisms) {
    notes.push(`${fr(tally.prisms)} parcelles en volume · 1 logement = `
      + `${SITADEL_METRES_PER_DWELLING} m, plafond ${SITADEL_PRISM_MAX_M} m`);
    const flat = tally.demolition + tally.noDwellings;
    if (flat) notes.push(`${fr(flat)} à plat, sans logement publié`);
  }
  return notes.length ? `${head} · ${notes.join(' · ')}` : head;
}

// --- Layer ------------------------------------------------------------------

const sitadelFranceLayer = {
  id: SITADEL_FR_LAYER_ID,
  name: 'Autorisations d’urbanisme (Sitadel)',
  // 🏗 and not 🏠/🏢: the BÂTI & TERRITOIRE neighbours are € (DVF), ▤ (DPE and
  // GPU), ▦ (bâti 3D and cadastre), 🎓 (écoles) and 🏛 (enseignement
  // supérieur). A crane is the one glyph on that shelf that says "not built
  // yet", which is the entire distinction between this layer and its siblings.
  icon: '🏗',
  source: SITADEL_SOURCE,
  updateInterval: UPDATE_INTERVAL_MS,

  init(viewer) {
    _viewer = viewer;
    _enabled = false;
    _records = new Map();
    _owners = new Map();
    _payload = null;
    _selectedId = null;
    _loading = false;
    _error = null;
    _status = 'idle';
    _stale = false;
    _lastUpdate = null;
    _focusKey = null;
    _communeName = null;
    _prismTally = null;
    _coldFloorKey = null;
    clearColdFloorRetry();
    _classificationType = powerClassificationTypeForScene(viewer?.scene);

    _points = new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT });
    _points.show = false;
    viewer.scene.primitives.add(_points);
    registerSpriteCollection(SITADEL_FR_LAYER_ID, _points);
    restoreSpriteOrder(viewer);

    if (typeof window !== 'undefined' && !_mapStackListener) {
      _mapStackListener = (event) => {
        applyClassification(event?.detail?.activeId !== undefined
          ? powerClassificationTypeForStack(event.detail.activeId)
          : powerClassificationTypeForScene(_viewer?.scene));
      };
      window.addEventListener('gev:map-stack-changed', _mapStackListener);
    }
    _overlayHost.setVisible(SITADEL_FR_OVERLAY_SOURCE_ID, false);
    console.log('[Data:Sitadel FR] Initialized');
  },

  enable(viewer) {
    _enabled = true;
    _error = null;
    if (_points) _points.show = true;
    if (_fills) _fills.show = true;
    if (_prisms) _prisms.show = true;
    if (_edges) _edges.show = true;
    if (_outline) _outline.show = true;
    // The boot-time stack settle fires no event, so re-derive on every enable
    // rather than trusting whatever the last event left behind.
    applyClassification(powerClassificationTypeForScene(viewer?.scene || _viewer?.scene));
    restoreSpriteOrder(viewer);
    _overlayHost.setVisible(SITADEL_FR_OVERLAY_SOURCE_ID, true);
    installClickHandler(viewer);
    registerPickOwner(SITADEL_FR_LAYER_ID, (pickedId) => _records.has(pickedId));
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
    if (_points) _points.show = false;
    if (_fills) _fills.show = false;
    if (_prisms) _prisms.show = false;
    if (_edges) _edges.show = false;
    if (_outline) _outline.show = false;
    clearColdFloorRetry();
    _overlayHost.setVisible(SITADEL_FR_OVERLAY_SOURCE_ID, false);
    if (_clickHandler) {
      _clickHandler.destroy();
      _clickHandler = null;
    }
    if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeyDown);
    unregisterPickOwner(SITADEL_FR_LAYER_ID);
    if (_moveEndRemover) {
      _moveEndRemover();
      _moveEndRemover = null;
    }
    _loading = false;
    _status = 'idle';
  },

  async update() {
    if (!_enabled) return false;
    // `load()` answers "did I redraw", which is false for a camera above the
    // gate and false when the commune has not changed. Neither is a refusal of
    // the lifecycle transition, and DataLayerManager reads a literal `false`
    // from update() as exactly that.
    await load({ force: true });
    return true;
  },

  getDetectableObjects(options = {}) {
    return collectDetectableObjects(options);
  },

  getStats() {
    const summary = _payload?.summary || null;
    const stats = {
      count: _records.size,
      lastUpdate: _lastUpdate,
      loading: _loading,
      // `zoom-in` and `empty` are GUIDANCE_STATUSES: the panel keeps a green ON
      // chip and shows the prompt, instead of reading a camera that is too
      // high as a broken feed.
      status: _status === 'ready' ? 'ok'
        : _status === 'too-high' ? 'zoom-in'
          : _status === 'no-commune' || _status === 'no-view' ? 'empty'
            : _status,
      stale: _stale,
      insee: _payload?.insee ?? null,
      commune: _communeName,
      departement: _payload?.deptName ?? null,
      // The honesty numbers, surfaced rather than buried in a tooltip.
      permits: summary?.permits ?? null,
      placed: summary?.placed ?? null,
      ambiguous: summary?.ambiguous ?? null,
      missing: summary?.missing ?? null,
      noref: summary?.noref ?? null,
      placementRate: summary && summary.permits > 0
        ? Math.round((1000 * summary.placed) / summary.permits) / 10 : null,
      parcels: summary?.parcels ?? null,
      multiParcel: summary?.multiParcel ?? null,
      dwellings: summary?.dwellings ?? null,
      dwellingsDrawn: summary?.dwellingsDrawn ?? null,
      surfaceCreated: summary?.surfaceCreated ?? null,
      dwellingsDemolished: summary?.dwellingsDemolished ?? null,
      terrainChecked: summary?.terrainChecked ?? null,
      terrainAgreeing: summary?.terrainAgreeing ?? null,
      mojibakeRepaired: summary?.mojibake ?? null,
      demolitionAvailable: summary?.demolitionAvailable ?? null,
      cadastreParcels: summary?.cadastreParcels ?? null,
      millesime: _payload?.millesime ?? null,
      cadastreEdition: _payload?.cadastreEdition ?? null,
      // The height channel, declared: how many plots stand up, how many are
      // flat because their file counts no dwelling, and how many are flat only
      // because the ground under them has not been resolved yet.
      prisms: _prismTally?.prisms ?? null,
      prismsClipped: _prismTally?.clipped ?? null,
      prismTallestM: _prismTally?.tallestM ?? null,
      flatDemolition: _prismTally?.demolition ?? null,
      flatNoDwellings: _prismTally?.noDwellings ?? null,
      flatColdFloor: _prismTally?.coldFloor ?? null,
      metresPerDwelling: SITADEL_METRES_PER_DWELLING,
      prismCeilingM: SITADEL_PRISM_MAX_M,
    };
    const label = buildSitadelLoadingLabel();
    if (label) stats.loadingLabel = label;
    if (_error) stats.error = _error;
    return stats;
  },

  /** Provenance for the attribution popover and the analyst surfaces. */
  getViewportSummary() {
    if (!_payload) return null;
    const { permits, parcels, outline, ...rest } = _payload;
    return {
      ...rest,
      drawn: _records.size,
      parcelsDrawn: parcels?.length ?? 0,
      outline: outline ? { parts: outline.parts?.length ?? 0, simplified: Boolean(outline.simplified) } : null,
      unplaced: sitadelUnplacedLines(_payload.summary),
      maxAltitudeM: SITADEL_MAX_ALTITUDE_M,
    };
  },

  /**
   * Colour legend for the control-panel row.
   *
   * ONLY the five bands, and only the ones that actually have a permit on
   * screen. The permits that could not be placed are NOT here: the panel's
   * swatch is the colour those objects are painted, and there is no colour for
   * an object that is nowhere. They are on the row line, in `getStats()` and on
   * every card instead.
   */
  getRowControls() {
    const bands = _payload?.summary?.bands;
    if (!Array.isArray(bands)) return { chips: [], legend: [] };
    const legend = [];
    for (const band of bands) {
      if (!(band.count > 0)) continue;
      legend.push({
        label: band.label,
        color: band.color,
        count: band.count,
        blurb: band.blurb,
      });
    }
    legend.push(...sitadelHeightLegend(_prismTally));
    // Declared only while something is still drawn flat: a commune whose every
    // plot stands up has no ground-classified thematic surface left to drape.
    const flat = _prismTally
      ? _prismTally.demolition + _prismTally.noDwellings + _prismTally.coldFloor
      : 0;
    return { chips: [], legend, surfaceFill: flat > 0 };
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
      unregisterPickOwner(SITADEL_FR_LAYER_ID);
    }
    if (typeof window !== 'undefined' && _mapStackListener) {
      window.removeEventListener('gev:map-stack-changed', _mapStackListener);
      _mapStackListener = null;
    }
    if (_moveEndRemover) {
      _moveEndRemover();
      _moveEndRemover = null;
    }
    clearColdFloorRetry();
    clearSurfaces();
    if (_points) {
      unregisterSpriteCollection(SITADEL_FR_LAYER_ID, _points);
      (viewer || _viewer)?.scene?.primitives?.remove?.(_points);
      _points = null;
    }
    _records.clear();
    _owners.clear();
    _payload = null;
    _viewer = null;
  },
};

// --- Test seams -------------------------------------------------------------

/**
 * Seed rendered records so the selection, card, legend, stats and detection
 * paths run without WebGL.
 *
 * The dots are seeded as plain objects rather than Cesium primitives, so a test
 * can drive `selectPermit()` — which mutates the primitive it selected — with
 * no GL context. `viewer` is still supplied by the tests that exercise the
 * parcel highlight, which really does add a `GroundPolylinePrimitive`.
 * @param {object} [state]
 */
export function _setSitadelStateForTest({
  viewer, payload = null, overlayHost, enabled = true, status = 'ready',
  loading = false, fetchImpl, focusKey = null, error = null,
} = {}) {
  _fetchImpl = fetchImpl || null;
  _viewer = viewer || null;
  _overlayHost = overlayHost || DEFAULT_OVERLAY_HOST;
  _payload = payload;
  _owners = sitadelParcelOwners(payload);
  _records = new Map();
  for (const record of sitadelPermitRecords(payload)) {
    record.point = { pixelSize: record.basePixelSize, outlineColor: null, outlineWidth: 1 };
    _records.set(record.id, record);
  }
  _enabled = enabled;
  _selectedId = null;
  _loading = loading;
  _error = error;
  _status = status;
  _stale = Boolean(payload?.stale);
  _lastUpdate = payload ? (Number(payload.fetchedAt) || Date.now()) : null;
  _focusKey = focusKey;
  _communeName = payload?.commune || payload?.insee || null;
  // `GroundPolylinePrimitive.isSupported` reads a live WebGL context and there
  // is none under `node --test`. A test that supplies a viewer is asking for
  // the parcel-highlight and outline paths to RUN, so the capability probe is
  // answered here instead of being asked; `_clearSitadelSelectionForTest`
  // puts it back to null so production still probes for itself.
  _groundLinesSupported = Boolean(viewer);
}

/** Exercise the production selection path in focused runtime tests. */
export function _selectSitadelForTest(id) {
  selectPermit(id);
}

/** Exercise the production clear path and restore the production seams. */
export function _clearSitadelSelectionForTest() {
  clearSelection();
  clearColdFloorRetry();
  _prismTally = null;
  _coldFloorKey = null;
  _fetchImpl = null;
  _overlayHost = DEFAULT_OVERLAY_HOST;
  _payload = null;
  _records = new Map();
  _owners = new Map();
  _enabled = false;
  _status = 'idle';
  _loading = false;
  _error = null;
  _stale = false;
  _focusKey = null;
  _communeName = null;
  _groundLinesSupported = null;
  _viewer = null;
}

/** @returns {?string} */
export function _sitadelSelectedIdForTest() {
  return _selectedId;
}

/** Row-control legend, for tests that do not construct a viewer. */
export function _sitadelRowControlsForTest() {
  return sitadelFranceLayer.getRowControls();
}

/** Stats, for tests that do not construct a viewer. */
export function _sitadelStatsForTest() {
  return sitadelFranceLayer.getStats();
}

/** Detection candidates, for tests that do not construct a viewer. */
export function _sitadelDetectablesForTest(options = {}) {
  return collectDetectableObjects(options);
}

/** One render record by id, so a test can assert on what was seeded. */
export function _sitadelRecordForTest(id) {
  return _records.get(id) || null;
}

/** Every render id, in draw order. */
export function _sitadelRecordIdsForTest() {
  return [..._records.keys()];
}

/**
 * Drive the real `load()` — the gate, the focus key, the `have=` round trip,
 * the no-commune branch and the degraded branch — against an injected fetch.
 * @param {object} [options]
 * @returns {Promise<boolean>}
 */
export async function _sitadelLoadForTest(options = {}) {
  return load(options);
}

/**
 * Build the three ground batches and the prism batch against a seeded pack.
 *
 * `_setSitadelStateForTest` deliberately does not draw — it seeds records so the
 * card and legend paths run without a scene. This is the seam for the geometry
 * itself: it runs the REAL `drawSurfaces`, so the height decision, the edge
 * colour and the cold-floor bookkeeping are the production ones.
 * @returns {{tally: ?object, prisms: ?object, fills: ?object, edges: ?object}}
 */
export function _drawSitadelSurfacesForTest(payload = _payload) {
  drawSurfaces(payload);
  return {
    tally: _prismTally, prisms: _prisms, fills: _fills, edges: _edges, outline: _outline,
  };
}

/** The height bookkeeping of the last draw. */
export function _sitadelPrismTallyForTest() {
  return _prismTally;
}

/** Whether a cold-floor rebuild is pending, without exposing the timer. */
export function _sitadelColdFloorPendingForTest() {
  return Boolean(_coldFloorTimer);
}

/** What the layer thinks about its own camera state right now. */
export function _sitadelGateStateForTest() {
  return { status: _status, focusKey: _focusKey, commune: _communeName, drawn: _records.size };
}

export default sitadelFranceLayer;
