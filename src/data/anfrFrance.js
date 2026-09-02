/**
 * @module anfrFrance
 *
 * Every mast in France, drawn by WHICH GENERATION ACTUALLY TRANSMITS FROM IT.
 *
 * `anfrFeed.js` holds the reading of the 826 418-row observatoire and every
 * trap in it; `anfrMesh.js` holds the thinning policy for the middle zooms;
 * this file is the drawing.
 *
 * ── NAME COLLISION, NOT DATA COLLISION ──────────────────────────────────────
 * This repo already ships a layer called `radio`. That one is
 * radio-browser.info — internet AUDIO streams, keyed by a station UUID, played
 * through an `HTMLAudioElement`, ids prefixed `radio:`. This one is physical
 * masts keyed by ANFR's `SUP_ID`, ids prefixed `anfr-fr:`. The two share a
 * panel shelf (RÉSEAUX & CAPTEURS) and nothing else: no field, no identifier,
 * no upstream, no pick id. Anyone reading `radio` in this directory expecting
 * antennas is reading the wrong file.
 *
 * ── Two regimes, and why there is no choropleth ─────────────────────────────
 * `schools-fr`, `irve-fr` and `sup-fr` all open on 96 painted départements.
 * This layer deliberately does not, and the reason is a measurement rather
 * than a preference.
 *
 * The bundled outlines are METROPOLITAN: 96 features, no overseas geometry
 * (counted in `local_data/france_departements/departements.geojson`). Measured
 * over the whole register on 2026-09-02, the share of supports whose newest
 * radiating generation is 5G runs **59.7 % → 75.5 % across the metropolitan
 * interquartile range** — a nearly flat map — while the territories a
 * metropolitan choropleth cannot draw are the entire story: Nouvelle-Calédonie
 * **1.0 %** (611 supports), Polynésie française **8.7 %** (644),
 * Guadeloupe 29.8 %, Martinique 28.8 %, against Val-d'Oise's **84.1 %**. A
 * département choropleth here would spend the whole national view painting the
 * 59–76 % band and would silently drop the 3 822 supports where the finding
 * is. So the national view is the maillage: real mast positions, thinned, in
 * every French territory, coloured by the same channel as every other zoom.
 *
 *   maillage — real positions, spatially thinned to 1 100–2 200 dots. Measured
 *              on the real 72 700 tuples: a whole-France box (10.4° of
 *              latitude) holds **68 878** supports and 305 occupied cells, and
 *              the pick costs 15.3 ms — well inside one camera settle.
 *   supports — every support in the box, with its card. Entered at ≤ 0.32° of
 *              view span and capped by the proxy at 0.35°, because the
 *              worst-placed 0.35° box in France (anchored at 48.6725 N,
 *              2.19556 E — Paris and the inner suburbs) holds **6 462**
 *              supports, which the proxy serves as 112 831 bytes gzipped and
 *              which is one PointPrimitiveCollection.
 *
 * ── What the fill claims, what the size claims, what the RING claims ────────
 * FILL is the newest generation that RADIATES — `anfrBand(live)`, which reads
 * the in-service and technically-operational systems and never the approved
 * projects. Measured over the 72 700: **5G 50 148 · 4G 18 698 · 3G 127 ·
 * 2G 89 · rien 3 638**.
 *
 * That distribution is why the palette has two anchors and not five steps.
 * Three quarters of a five-step ramp would be spent on 216 masts — 0.30 % of
 * the country. So 5G is the one saturated colour on this layer (amber) and
 * everything older is one low-chroma steel family at three luminances. The map
 * reads "amber where 5G is, quiet where it is not", which is what the data
 * says. Nothing else on this globe uses a low-chroma steel as a categorical
 * dot fill: the greys in `schools-fr`, `irve-fr` and `radio` are all
 * *unknown-value* catch-alls, and this is a measured value.
 *
 * SIZE is the number of distinct operators on the mast, which is the only
 * "how big" this register publishes and is never missing — every row names its
 * operator. Measured: **36 671 supports carry one operator, 16 786 two,
 * 8 230 three, 11 012 four, and exactly one carries five** (SUP_ID 506104,
 * Saint-Barthélemy).
 *
 * THE PALE RING IS THE HONEST HALF, and it means one thing everywhere:
 * *an approved project is on file at this position*. **`Projet approuvé` is
 * 66 508 of the 826 418 rows — 8.05 %**, re-counted from the portal's own
 * `refine.statut` on 2026-09-02, not sampled. Two shapes carry it:
 *
 *   hollow ring   — 3 638 supports (5.00 %) where NOTHING radiates. A file at
 *                   ANFR, not a mast. Never drawn as a generation.
 *   ring on a dot — 3 776 supports that radiate today and whose approved
 *                   project would ADD a generation they do not have. Counted
 *                   with the feed's own rule: an operator re-filing for a band
 *                   already on the air is paperwork, not an upgrade, and
 *                   11 830 of the 15 606 live supports with a project on file
 *                   are exactly that.
 *
 * ── The register's status field is about 5G, not about maturity ─────────────
 * Cross-tabulated over all 826 418 rows on 2026-09-02: `Techniquement
 * opérationnel` appears on **5G rows and nothing else** — all 120 891 of them —
 * and **no 5G row in this edition is ever `En service`**. The 2G/3G/4G rows
 * are `En service` (639 019) or `Projet approuvé`. So "technically operational"
 * is not a fact about one operator's rollout at one mast; it is how ANFR files
 * 5G as a whole. The card says which generations are in which status because
 * that is what the register published, and the legend says why they always
 * come out the same way, so nobody reads a national policy as a local one.
 *
 * ── What this map cannot show, by statute ───────────────────────────────────
 * Quoted from the canonical dataset: *"Installations radioélectriques de plus
 * de 5 watts, hormis celles de l'Aviation Civile et des ministères de la
 * Défense et de l'Intérieur."* Blank ground beside a base or an airport is
 * policy, not a gap in the data. And the observatoire is PUBLIC MOBILE only:
 * a support that also carries a microwave link, TNT or PMR is drawn here as a
 * mobile mast and its card names the rest from Cartoradio rather than letting
 * the dot imply the whole installation.
 */

import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import { registerSpriteCollection, restoreSpriteOrder, unregisterSpriteCollection } from './spriteOrder.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import { cachedGroundFloor, warmGroundFloor } from './groundFloor.js';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import {
  ANFR_BANDS,
  ANFR_BAND_LABELS,
  ANFR_EXPOSURE_RADIUS_M,
  ANFR_GENERATIONS,
  ANFR_STATUS_LABELS,
  anfrBand,
  anfrDecodeMask,
} from './anfrFeed.js';
import {
  MESH_LAT,
  MESH_LON,
  MESH_OPERATORS,
  meshSupportBand,
  meshSupportId,
  selectAnfrMesh,
} from './anfrMesh.js';

/** Layer id — also the share-link registry key and the voice-tool enum value. */
export const ANFR_FR_LAYER_ID = 'anfr-fr';

/** Selected-support card, on its own protected overlay source. */
export const ANFR_FR_OVERLAY_SOURCE_ID = 'anfr-fr-selected';
export const ANFR_FR_OVERLAY_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 1,
  moving: false,
});

/** Keyless, same-origin. See `anfrFranceProxy` in vite.config.js. */
const MESH_URL = '/api/anfr-fr/mesh';
const SUPPORTS_URL = '/api/anfr-fr/supports';
const DETAIL_URL = '/api/anfr-fr/support';

// --- Activation / load gating ----------------------------------------------
/**
 * Widest box the supports route will answer, in degrees.
 *
 * 0.35, the same ceiling `schools-fr` settled on, and it holds here for a
 * measured reason rather than by imitation: sweeping every candidate 0.35° box
 * over the real 72 700 positions, the fullest one holds **6 462** supports
 * (anchored at 48.6725 N, 2.19556 E). At 0.5° it is 7 793 and at 0.25° it is
 * 5 006 — the curve is flat, because Île-de-France's masts are already inside
 * any box that reaches Paris, so widening the ceiling buys density nobody can
 * read and narrowing it costs a regime handover for nothing.
 */
export const ANFR_MAX_BOX_DEG = 0.35;
/**
 * View span (max of the two, degrees) at or below which the exact regime
 * answers, and above which it hands back to the maillage.
 *
 * The exit threshold IS the box ceiling, and the entry threshold sits under
 * it, so a camera resting on the boundary cannot oscillate and the box that is
 * actually requested is never one the proxy would refuse.
 */
const SUPPORTS_ENTER_SPAN_DEG = 0.32;
const SUPPORTS_EXIT_SPAN_DEG = ANFR_MAX_BOX_DEG;
const CAMERA_DEBOUNCE_MS = 450;
/**
 * Poll cadence (ms). The observatoire is rebuilt WEEKLY — `extras.frequency`
 * is `weekly` and all 826 418 rows carry one identical `date_maj` — so
 * anything faster re-asks a question whose answer cannot have changed. The
 * camera, not the clock, drives this layer.
 */
const POLL_INTERVAL_MS = 6 * 60 * 60_000;
/** The national mesh is 392 KB gzipped and the proxy may be building it. */
const NATIONAL_TIMEOUT_MS = 120_000;
const REQUEST_TIMEOUT_MS = 45_000;
/** A click's worth of patience, not a viewport's. */
const DETAIL_TIMEOUT_MS = 20_000;
/**
 * Half-width (degrees, ~55 m) of the box a MAILLAGE click asks about.
 *
 * The mesh tuple carries a position, an operator count and a band — it does
 * NOT carry the `SUP_ID`, because carrying it costs 392 KB → 611 KB gzipped
 * for a field the maillage never draws. So the id is fetched for the ONE dot
 * that was clicked. The pad is deliberately tiny: ANFR derives its coordinates
 * from integer arc-seconds, so masts sit on a ~31 m lattice and a wider box
 * would sweep in the neighbouring lattice cell.
 */
const MESH_LOOKUP_PAD_DEG = 0.0005;
/**
 * Hard cap on rendered supports, independent of what the proxy returns.
 *
 * 8 000, above the 6 462 of the fullest possible box, so it never bites in
 * production — it exists so a malformed payload cannot ask Cesium for a
 * million primitives.
 */
const MAX_RENDERED_SUPPORTS = 8_000;
const POINT_LIFT_M = 2.5;
const GROUND_WARM_LIMIT = 500;

// --- Presentation -----------------------------------------------------------
/**
 * The band ladder's fills — ONE saturated hue and one steel family.
 *
 * See the module header for why this is not a five-step ramp. Every hex here
 * is unused elsewhere in `src/data` (checked, not assumed), and the steel
 * family is deliberately low-chroma so it cannot be mistaken for a saturated
 * categorical swatch from `schools-fr`, `irve-fr` or `road-events-fr` when
 * those dots stack on these.
 */
export const ANFR_BAND_COLORS = Object.freeze({
  projet: '#c9d4e2',
  '2g': '#4c6076',
  '3g': '#6f8aa8',
  '4g': '#9fb4cc',
  '5g': '#ffcb2b',
});

/**
 * The ring. It means "an approved project is on file here" and nothing else.
 *
 * Pale, so it reads against every fill in the ladder including its own.
 */
const PROJECT_RING_COLOR = '#c9d4e2';
const PROJECT_RING_ALPHA = 0.95;
const PROJECT_RING_WIDTH = 1.8;
/** Fill alpha for a support where NOTHING radiates — a hollow ring. */
const PROJECT_FILL_ALPHA = 0.12;
/** The ordinary outline: near-black, so a pale dot keeps an edge on bright terrain. */
const PLAIN_OUTLINE_COLOR = '#0d1420';
const PLAIN_OUTLINE_ALPHA = 0.6;
const PLAIN_OUTLINE_WIDTH = 1;

const SELECTED_COLOR = '#00ffff';
const SELECTED_POINT_PX = 18;
const POINT_MIN_PX = 4.5;
const POINT_MAX_PX = 11;
/**
 * Operator count at which a dot reaches full size.
 *
 * Five, which is the measured maximum and not a round number — exactly one
 * support in France carries five operators. Linear rather than square-rooted:
 * the channel has five integer values, not a continuous magnitude, and the
 * eye should read "one more operator" as one more step.
 */
const SIZE_CEILING_OPERATORS = 5;

/** How many `emr_lb_systeme` labels a card prints before summarising. */
const CARD_SYSTEM_LIMIT = 5;
/** How many operators a card names before summarising. */
const CARD_OPERATOR_LIMIT = 5;

/** One-line explanations behind each band swatch. */
const BAND_BLURBS = Object.freeze({
  '5g': 'Un mât sur lequel la 5G émet : 50 148 des 72 700 supports du registre, la couleur du réseau actuel. '
    + 'Dans cette édition l’ANFR ne déclare AUCUN émetteur 5G « en service » — les 120 891 lignes 5G qui émettent '
    + 'sont toutes « techniquement opérationnel », et les 639 019 lignes 2G/3G/4G toutes « en service ». '
    + 'Le statut décrit la génération, pas ce mât-ci.',
  '4g': 'La 4G est la génération la plus récente qui émet ici. 18 698 supports : un quart du parc, sans 5G.',
  '3g': 'La 3G est la plus récente qui émet ici. 127 supports dans toute la France — 54 757 mâts émettent de la 3G, mais 54 630 émettent aussi de la 4G ou de la 5G.',
  '2g': '2G seule. 89 supports. Le fond du registre, pas une catégorie du réseau.',
  projet: 'Anneau creux : rien n’émet. Une autorisation ANFR et aucune installation. 3 638 supports, 5,00 % du registre — jamais dessinés comme des mâts en service.',
});

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});
let _overlayHost = DEFAULT_OVERLAY_HOST;

/**
 * The HTTP seam.
 *
 * One function, so a test can drive every production path — the maillage, the
 * viewport, the mesh-dot lookup and the Cartoradio card — with no network and
 * no WebGL, and so a failure injected here exercises the same degradation the
 * real one would.
 */
const DEFAULT_HTTP = (url, options) => fetch(url, options);
let _http = DEFAULT_HTTP;

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
let _inView = 0;
let _lastUpdate = null;
let _loading = false;
let _error = null;
let _status = 'idle';
let _regime = 'maillage';
let _requestGeneration = 0;

let _mesh = null;
let _meshPromise = null;
let _meshPick = null;

let _pack = null;
let _packBoxKey = null;

/** Coordinate id → the supports the register places there, or null. */
const _meshLookups = new Map();
/** SUP_ID → the Cartoradio card, or null when Cartoradio refused. */
const _details = new Map();

// --- Colour, size and style -------------------------------------------------

/** Hex fill for one band. Anything unrecognised is drawn as the project ring. */
export function anfrBandColor(band) {
  return ANFR_BAND_COLORS[band] || ANFR_BAND_COLORS.projet;
}

/** French label for one band. */
export function anfrBandLabelFor(band) {
  return ANFR_BAND_LABELS[band] || ANFR_BAND_LABELS.projet;
}

/**
 * Dot size for one support, by how many operators are on it.
 *
 * Clamped at both ends: a support the register somehow places with no operator
 * still gets the base size rather than a zero-pixel dot, because it is a
 * position the register published and a dot the reader can click.
 */
export function anfrPointSize(operators) {
  const count = Number(operators);
  if (!Number.isFinite(count) || count <= 1) return POINT_MIN_PX;
  const span = POINT_MAX_PX - POINT_MIN_PX;
  const scale = Math.min(count, SIZE_CEILING_OPERATORS) - 1;
  return POINT_MIN_PX + (span * scale) / (SIZE_CEILING_OPERATORS - 1);
}

/**
 * Whether an approved project at this support would ADD a generation it does
 * not already radiate.
 *
 * The feed's rule, applied at draw time to one support: an operator re-filing
 * for a band that is already on the air is paperwork, and 11 830 of the 15 606
 * live supports carrying a project are exactly that. Ringing all 15 606 would
 * make the ring mean "somebody filed something", which is not worth a channel.
 */
export function anfrHasPlannedUpgrade(support) {
  const live = Number(support?.live) || 0;
  const plan = Number(support?.plan) || 0;
  return Boolean(plan & ~live);
}

/**
 * Fill, outline and size for one support — the whole visual grammar in one
 * pure function, so the legend, the tests and the primitives cannot drift.
 *
 * @param {object} support Pack row (`live`, `plan`, `operators`).
 * @returns {{band:string, color:string, alpha:number, outlineColor:string,
 *   outlineAlpha:number, outlineWidth:number, sizePx:number, ringed:boolean,
 *   hollow:boolean, operators:number}}
 */
export function anfrSupportStyle(support) {
  const live = Number(support?.live) || 0;
  const band = anfrBand(live);
  const operators = Array.isArray(support?.operators)
    ? support.operators.length
    : Number(support?.operators) || 0;
  const hollow = live === 0;
  const ringed = hollow || anfrHasPlannedUpgrade(support);
  return {
    band,
    color: anfrBandColor(band),
    alpha: hollow ? PROJECT_FILL_ALPHA : 1,
    outlineColor: ringed ? PROJECT_RING_COLOR : PLAIN_OUTLINE_COLOR,
    outlineAlpha: ringed ? PROJECT_RING_ALPHA : PLAIN_OUTLINE_ALPHA,
    outlineWidth: ringed ? PROJECT_RING_WIDTH : PLAIN_OUTLINE_WIDTH,
    sizePx: anfrPointSize(operators),
    ringed,
    hollow,
    operators,
  };
}

/**
 * Style for a MAILLAGE tuple.
 *
 * The tuple carries `[lat, lon, operators, band]` and no plan mask, so the
 * only ring the maillage can draw honestly is the hollow one — a cell whose
 * modal band is `projet`. A dot that radiates AND has an upgrade pending is
 * indistinguishable from one that does not at this zoom, and the row label
 * says so rather than the map implying the ring is exhaustive.
 */
export function anfrMeshStyle(tuple) {
  const band = meshSupportBand(tuple);
  const hollow = band === 'projet';
  return {
    band,
    color: anfrBandColor(band),
    alpha: hollow ? PROJECT_FILL_ALPHA : 1,
    outlineColor: hollow ? PROJECT_RING_COLOR : PLAIN_OUTLINE_COLOR,
    outlineAlpha: hollow ? PROJECT_RING_ALPHA : PLAIN_OUTLINE_ALPHA,
    outlineWidth: hollow ? PROJECT_RING_WIDTH : PLAIN_OUTLINE_WIDTH,
    sizePx: anfrPointSize(Number(tuple?.[MESH_OPERATORS]) || 0),
    ringed: hollow,
    hollow,
    operators: Number(tuple?.[MESH_OPERATORS]) || 0,
  };
}

// --- Identity ---------------------------------------------------------------

/**
 * Render id for one support, from its ANFR `SUP_ID`.
 *
 * The id is the SUP_ID and NOT the coordinate, and that is load-bearing:
 * measured over the real 72 700 supports, **952 of them share a five-decimal
 * coordinate with at least one other** (71 748 distinct positions, 895 of them
 * occupied twice or more, the worst by six masts). ANFR derives positions from
 * integer arc-seconds, so co-sited masts land on exactly the same lattice
 * point. A coordinate-keyed record map would silently drop those 952.
 */
export function anfrSupportId(supId) {
  return `${ANFR_FR_LAYER_ID}:${supId}`;
}

/**
 * Render id for one maillage dot.
 *
 * Coordinate-based, because the tuple carries nothing else — and namespaced
 * apart from the exact ids precisely BECAUSE the two cannot be equated: the
 * same position can hold several supports. A maillage selection is therefore
 * not carried across the handover into the exact regime; the layer clears it
 * rather than guessing which of six co-sited masts the reader meant.
 */
export function anfrMeshRecordId(tuple) {
  return `${ANFR_FR_LAYER_ID}:mesh:${meshSupportId(tuple)}`;
}

/**
 * The supports the register places at one maillage dot's position.
 *
 * Returns every one of them, not the "best" one: co-siting is a fact about the
 * mast and the card names it. Ordered by operator count then by SUP_ID, so the
 * card is stable between two clicks on the same dot.
 *
 * @param {Array<object>} supports Rows from the supports route.
 * @param {number} lat
 * @param {number} lon
 * @returns {Array<object>}
 */
export function pickAnfrSupportsAt(supports, lat, lon) {
  const key = `${Number(lat).toFixed(5)},${Number(lon).toFixed(5)}`;
  return (Array.isArray(supports) ? supports : [])
    .filter((row) => Number.isFinite(row?.lat) && Number.isFinite(row?.lon)
      && `${row.lat.toFixed(5)},${row.lon.toFixed(5)}` === key)
    .sort((a, b) => (b.operators?.length || 0) - (a.operators?.length || 0)
      || Number(a.id) - Number(b.id));
}

// --- Camera -----------------------------------------------------------------

/**
 * Camera view box, clamped to the proxy's ceiling. A wider view returns null
 * and the layer falls back to the maillage rather than asking for a box the
 * proxy would refuse.
 */
export function cameraAnfrBox(viewer) {
  const rectangle = viewer?.camera?.computeViewRectangle?.();
  if (!rectangle) return null;
  const south = Cesium.Math.toDegrees(rectangle.south);
  const north = Cesium.Math.toDegrees(rectangle.north);
  const west = Cesium.Math.toDegrees(rectangle.west);
  const east = Cesium.Math.toDegrees(rectangle.east);
  if (![south, west, north, east].every(Number.isFinite)) return null;
  if (west >= east || south >= north) return null;
  if (north - south > ANFR_MAX_BOX_DEG || east - west > ANFR_MAX_BOX_DEG) return null;
  return { south, west, north, east };
}

/**
 * View box for the maillage — the camera rectangle, padded.
 *
 * No ceiling: the pick runs over tuples the client already holds, so a wide
 * view costs nothing upstream. The padding means a dot does not pop into
 * existence exactly at the screen edge as the camera pans.
 */
export function cameraAnfrMeshBox(viewer, padFraction = 0.12) {
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
export function anfrViewSpanDeg(viewer) {
  const rectangle = viewer?.camera?.computeViewRectangle?.();
  if (!rectangle) return { lat: Infinity, max: Infinity };
  const lat = Cesium.Math.toDegrees(rectangle.north - rectangle.south);
  const lon = Cesium.Math.toDegrees(rectangle.east - rectangle.west);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { lat: Infinity, max: Infinity };
  return { lat, max: Math.max(lat, lon) };
}

/** Which regime the camera is in, with hysteresis at the boundary. */
function updateRegime(viewer) {
  const span = anfrViewSpanDeg(viewer);
  if (_regime === 'supports') {
    if (span.max > SUPPORTS_EXIT_SPAN_DEG) _regime = 'maillage';
  } else if (span.max <= SUPPORTS_ENTER_SPAN_DEG) {
    _regime = 'supports';
  }
  return _regime;
}

/**
 * A support's anchor, seated on the shared coarse ground floor.
 *
 * Only the exact regime uses it. The maillage lifts its dots by
 * `POINT_LIFT_M` off the ellipsoid instead: at those altitudes a metre of
 * vertical error is invisible and 2 200 terrain lookups per pan would not be.
 */
function supportPosition(lat, lon) {
  const floor = cachedGroundFloor(lat, lon);
  return Cesium.Cartesian3.fromDegrees(lon, lat, (Number.isFinite(floor) ? floor : 0) + POINT_LIFT_M);
}

/** French thousands separator, matching the rest of the French packs. */
function fr(value) {
  return Number(value).toLocaleString('fr-FR');
}

/** `2026-08-27` → `27 août 2026`. */
export function anfrEditionLabel(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return null;
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

// --- Card copy --------------------------------------------------------------

/**
 * Whether any generation here radiates without being declared *En service*.
 *
 * True on every 5G support in this edition and on nothing else — see the
 * module header — which is why the card explains the status rather than
 * repeating it as if it were a local fact.
 */
export function anfrHasTechnicalGeneration(support) {
  const live = Number(support?.live) || 0;
  const svc = Number(support?.svc) || 0;
  return Boolean(live & ~svc);
}

/** Generations that radiate, newest first, or null. */
export function anfrLiveGenerationsLine(support) {
  const live = anfrDecodeMask(support?.live, ANFR_GENERATIONS).reverse();
  if (!live.length) return null;
  const svc = new Set(anfrDecodeMask(support?.svc, ANFR_GENERATIONS));
  const inService = live.filter((gen) => svc.has(gen));
  const technical = live.filter((gen) => !svc.has(gen));
  const parts = [];
  // The order matters: what is technically operational is the newer half in
  // every row of this edition, and the reader should meet it first.
  if (technical.length) parts.push(`${technical.join(' · ')} techniquement opérationnelle${technical.length > 1 ? 's' : ''}`);
  if (inService.length) parts.push(`${inService.join(' · ')} en service`);
  return parts.join(' — ');
}

/** The approved project, named by what it would add, or null. */
export function anfrPlanLine(support) {
  const plan = Number(support?.plan) || 0;
  if (!plan) return null;
  const live = Number(support?.live) || 0;
  const adds = anfrDecodeMask(plan & ~live, ANFR_GENERATIONS).reverse();
  const again = anfrDecodeMask(plan & live, ANFR_GENERATIONS).reverse();
  if (adds.length) {
    return live
      ? `Projet approuvé : ${adds.join(' · ')} — autorisé, pas encore émis d’ici`
      : `Projet approuvé : ${adds.join(' · ')} — autorisé, rien n’émet à cette position`;
  }
  return `Projet approuvé sur ${again.join(' · ')} — bande déjà à l’antenne, dossier rouvert`;
}

/**
 * Card copy for one selected support.
 *
 * Every line is a published value, a count of published values, or a stated
 * absence of one. The Cartoradio half is appended only once it has arrived and
 * says so while it has not, because a card that silently omits the address is
 * indistinguishable from a mast whose address ANFR does not publish.
 *
 * @param {object} record Render record.
 * @param {object} [payload] The document the record came from.
 * @returns {string} Newline-separated card copy.
 */
export function buildAnfrSelectionLabel(record, payload = null) {
  const support = record?.support || {};
  const details = [];
  const title = support.nature
    ? `Support ${support.id} · ${support.nature}`
    : `Support ANFR ${support.id}`;

  const generations = anfrLiveGenerationsLine(support);
  details.push(generations || 'Aucune génération n’émet à cette position');
  // ANFR's own gloss for the status, quoted from the feed's vocabulary rather
  // than paraphrased here, so the register's wording and the card's cannot
  // drift apart. It is the status a reader is most likely to misread: the
  // carrier is switched on, it is simply not declared commercially open.
  if (anfrHasTechnicalGeneration(support)) {
    details.push(ANFR_STATUS_LABELS['Techniquement opérationnel']);
  }

  const operators = Array.isArray(support.operators) ? support.operators : [];
  if (operators.length) {
    const shown = operators.slice(0, CARD_OPERATOR_LIMIT).join(', ');
    const rest = operators.length - CARD_OPERATOR_LIMIT;
    details.push(`${fr(operators.length)} opérateur${operators.length > 1 ? 's' : ''} : ${shown}${rest > 0 ? ` +${rest}` : ''}`);
  }

  const systems = Array.isArray(support.systems) ? support.systems : [];
  if (systems.length) {
    const shown = systems.slice(0, CARD_SYSTEM_LIMIT).join(' · ');
    const rest = systems.length - CARD_SYSTEM_LIMIT;
    details.push(`${shown}${rest > 0 ? ` · +${rest} systèmes` : ''}`);
  }

  const plan = anfrPlanLine(support);
  if (plan) details.push(plan);

  // 551 of the 72 700 supports publish a height of 0, which is the register's
  // way of saying nobody filled the field in. The feed returns null for those
  // and the card says so rather than printing "0 m".
  details.push(Number.isFinite(support.heightM)
    ? `Support de ${fr(support.heightM)} m`
    : 'Hauteur du support non publiée');

  // Everything below is Cartoradio's, on demand, and is labelled as such by
  // being absent until it arrives.
  if (record?.detailPending) {
    details.push('Cartoradio : lecture de la fiche du support…');
  } else if (record?.detailError) {
    details.push(`⚠ Fiche Cartoradio indisponible — ${record.detailError}`);
  } else if (record?.detail) {
    details.push(...anfrDetailLines(record.detail));
  }

  if (record?.coSited > 0) {
    details.push(`⚠ ${fr(record.coSited)} autre${record.coSited > 1 ? 's' : ''} support${record.coSited > 1 ? 's' : ''} à cette position exacte`);
  }

  const edition = anfrEditionLabel(payload?.edition);
  details.push(`Observatoire ANFR du ${edition || '—'} · Licence Ouverte 2.0`);
  return [title, ...details].join('\n');
}

/**
 * The Cartoradio half of the card.
 *
 * Kept apart from `buildAnfrSelectionLabel` so a test can assert on it alone,
 * and because it comes from a DIFFERENT upstream with a different licence
 * footing — the observatoire is published for reuse, the Cartoradio REST API
 * is the private backend of ANFR's own map.
 */
export function anfrDetailLines(detail) {
  const lines = [];
  const site = detail?.site;
  if (site) {
    const where = [site.address, site.postcode, site.commune].filter(Boolean).join(', ');
    if (where) lines.push(where);
    if (site.owner) lines.push(`Propriétaire : ${site.owner}`);
    // The observatoire is public mobile ONLY. Naming the rest is how the layer
    // admits its dot is not the whole installation.
    if (site.otherCategories?.length) {
      lines.push(`Porte aussi ${site.otherCategories.join(' · ')} — non tracé par cette couche`);
    }
  }
  const antennas = detail?.antennas;
  if (antennas?.antennas > 0) {
    const parts = [`${fr(antennas.antennas)} antennes sur ${fr(antennas.stations)} stations`];
    if (antennas.newestService) {
      parts.push(`dernier équipement en service le ${anfrFrenchDate(antennas.newestService)}`);
    }
    lines.push(parts.join(' · '));
  }

  const exposure = detail?.exposure;
  if (exposure && exposure.within === 0) {
    lines.push(`Aucune mesure d’exposition publiée dans ${fr(exposure.radiusM ?? ANFR_EXPOSURE_RADIUS_M)} m`);
  } else if (exposure?.report) {
    const report = exposure.report;
    const value = Number.isFinite(report.globalVoltsPerM)
      ? `${report.globalVoltsPerM.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} V/m`
      : 'valeur non publiée';
    lines.push(`Exposition mesurée ${value} à ${fr(exposure.nearest?.metres ?? 0)} m — ${anfrFrenchDate(report.measuredOn) || 'date inconnue'}`);
    const context = [report.laboratory, report.protocol, report.setting].filter(Boolean);
    if (context.length) lines.push(context.join(' · '));
    // The sharpest line on this card. A measurement taken before the mast
    // gained its current equipment is a true reading of a different
    // installation, and printing the number without the date would be a lie
    // by omission.
    if (report.predatesEquipment) {
      lines.push(`⚠ Mesure antérieure au dernier équipement installé (${anfrFrenchDate(report.newestService)})`);
    }
    if (report.conforming === false) lines.push('⚠ Non conforme selon le rapport ANFR');
    if (exposure.within > 1) {
      lines.push(`${fr(exposure.within)} mesures publiées dans ${fr(exposure.radiusM)} m — celle-ci est la plus proche`);
    }
    lines.push('Mesure d’un LIEU, pas de ce mât — Cartoradio (ANFR)');
  } else if (exposure?.nearest) {
    lines.push(`Mesure d’exposition à ${fr(exposure.nearest.metres)} m — rapport non lisible`);
  }

  // A leg of the Cartoradio card that did not answer is NAMED. Measured on a
  // SUP_ID the register does not hold: `/sites/999999999` returns HTTP 200
  // with a zero-byte body, so the card would otherwise be indistinguishable
  // from a mast Cartoradio has nothing to say about.
  if (Array.isArray(detail?.degraded) && detail.degraded.length) {
    lines.push(`⚠ Cartoradio muet sur : ${detail.degraded.join(' · ')}`);
  }
  return lines;
}

/** `2025-07-18` → `18/07/2025`. */
export function anfrFrenchDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : null;
}

/**
 * Card copy for one maillage dot, before and after its lookup.
 *
 * Unlike `schools-fr`'s maillage, both channels the map uses ARE in the tuple,
 * so this card is never a placeholder: it says the band and the operator count
 * truthfully at first paint. What the lookup adds is the identity — the
 * SUP_ID, the operators by name, the systems, the height — and until it lands
 * the card says which of the two it is showing.
 */
export function buildAnfrMeshLabel(record, payload = null) {
  const tuple = record?.tuple || [];
  const band = meshSupportBand(tuple);
  const operators = Number(tuple[MESH_OPERATORS]) || 0;
  const details = [anfrBandLabelFor(band)];
  details.push(`${fr(operators)} opérateur${operators > 1 ? 's' : ''} déclaré${operators > 1 ? 's' : ''}`);
  if (record?.lookupPending) {
    details.push('Lecture du support dans le registre…');
  } else if (record?.lookupError) {
    details.push(`⚠ Registre injoignable pour ce point — ${record.lookupError}`);
  } else if (record?.lookupEmpty) {
    details.push('⚠ Aucun support du registre à cette position exacte');
  }
  const edition = anfrEditionLabel(payload?.edition);
  details.push(`Maillage — un point par cellule · observatoire du ${edition || '—'}`);
  return [`Support ANFR (maillage)`, ...details].join('\n');
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

/** Protected selected-support entry for the shared overlay host. */
export function createAnfrSelectedOverlayEntry(record, payload = null) {
  const position = record?.position;
  if (!record?.id || !position) return null;
  const copy = record.mesh && !record.support
    ? buildAnfrMeshLabel(record, payload)
    : buildAnfrSelectionLabel(record, payload);
  return selectedOverlayEntry(record.id, position, copy);
}

// --- Selection --------------------------------------------------------------

function restoreRecordStyle(record) {
  if (!record?.point) return;
  record.point.color = Cesium.Color.fromCssColorString(record.style.color)
    .withAlpha(record.style.alpha);
  record.point.pixelSize = record.style.sizePx;
}

function clearSelection() {
  if (!_selectedId) return;
  restoreRecordStyle(_records.get(_selectedId));
  _selectedId = null;
  _overlayHost.clearSource(ANFR_FR_OVERLAY_SOURCE_ID);
  governorRequestRender('anfr-fr-deselect');
}

/** Redraw the selected card in place, if `id` is still what is selected. */
function repaintSelectedCard(id) {
  if (_selectedId !== id) return;
  const entry = createAnfrSelectedOverlayEntry(_records.get(id), activePayload());
  if (entry) {
    _overlayHost.setEntries(ANFR_FR_OVERLAY_SOURCE_ID, [entry], ANFR_FR_OVERLAY_SOURCE_OPTIONS);
  }
  governorRequestRender('anfr-fr-card');
}

function selectSupport(id) {
  const record = _records.get(id);
  if (!record) return;
  if (_selectedId && _selectedId !== id) clearSelection();
  _selectedId = id;
  if (record.point) {
    record.point.color = Cesium.Color.fromCssColorString(SELECTED_COLOR);
    record.point.pixelSize = SELECTED_POINT_PX;
  }
  // A maillage dot knows its band and its operator count but not its identity.
  // Ask the register for it, and paint the card twice rather than making the
  // reader zoom in to find out what they clicked on.
  if (record.mesh && !record.support && !record.lookupPending) {
    void resolveMeshSupport(record);
  } else if (record.support && !record.detail && !record.detailPending) {
    void resolveDetail(record);
  }
  repaintSelectedCard(id);
}

function onKeyDown(event) {
  if (event.key === 'Escape' && _selectedId) clearSelection();
}

function installClickHandler(viewer) {
  if (_clickHandler) return;
  _clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  _clickHandler.setInputAction((movement) => {
    const picked = viewer.scene.pick(movement.position);
    const id = picked?.id;
    if (typeof id === 'string' && _records.has(id)) {
      selectSupport(id);
      return;
    }
    if (_selectedId) clearSelection();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  if (typeof document !== 'undefined') document.addEventListener('keydown', onKeyDown);
}

/**
 * Keep the selected card pinned to its dot as the camera moves.
 *
 * Republishes the entry and deliberately does NOT call
 * `governorRequestRender`: this runs inside `scene.preRender`, so asking for a
 * render here would ask for the next frame on every frame and pin the whole
 * app at full rate for as long as anything is selected. The frame this runs in
 * is already happening; the overlay host draws in it.
 */
function onPreRender() {
  if (!_enabled || !_selectedId) return;
  const entry = createAnfrSelectedOverlayEntry(_records.get(_selectedId), activePayload());
  if (entry) {
    _overlayHost.setEntries(ANFR_FR_OVERLAY_SOURCE_ID, [entry], ANFR_FR_OVERLAY_SOURCE_OPTIONS);
  }
}

// --- HTTP -------------------------------------------------------------------

async function fetchJson(url, { timeoutMs = REQUEST_TIMEOUT_MS, validate } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await _http(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (validate && !validate(payload)) throw new Error('malformed payload');
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

// --- Maillage regime --------------------------------------------------------

async function ensureMesh() {
  if (_mesh) return _mesh;
  if (_meshPromise) return _meshPromise;
  _meshPromise = fetchJson(MESH_URL, {
    timeoutMs: NATIONAL_TIMEOUT_MS,
    validate: (payload) => Array.isArray(payload?.mesh),
  })
    .then((payload) => {
      _mesh = payload;
      return payload;
    })
    .catch((error) => {
      if (error?.name !== 'AbortError') {
        console.warn('[Data:ANFR FR] national mesh failed:', error?.message || error);
      }
      return null;
    })
    .finally(() => { _meshPromise = null; });
  return _meshPromise;
}

/**
 * Draw a thinned selection of real mast positions for the current view.
 *
 * Re-picked on every camera settle rather than cached: measured over the real
 * 72 700 tuples, the pick costs 15.3 ms for a whole-France box and 1.7 ms for
 * Paris, against a round trip that would cost a few hundred.
 */
function reconcileMesh(box) {
  const pick = selectAnfrMesh(_mesh?.mesh, { box });
  _meshPick = pick;
  clearSelection();
  _points?.removeAll();
  _records = new Map();

  for (const tuple of pick.picked) {
    if (_records.size >= MAX_RENDERED_SUPPORTS) break;
    const lat = Number(tuple[MESH_LAT]);
    const lon = Number(tuple[MESH_LON]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const id = anfrMeshRecordId(tuple);
    if (_records.has(id)) continue;
    const style = anfrMeshStyle(tuple);
    // No ground warm-up at these altitudes: a metre of vertical error is
    // invisible and 2 200 terrain lookups per pan would not be.
    const position = Cesium.Cartesian3.fromDegrees(lon, lat, POINT_LIFT_M);
    const point = _points?.add({
      id,
      position,
      color: Cesium.Color.fromCssColorString(style.color).withAlpha(style.alpha),
      pixelSize: style.sizePx,
      outlineColor: Cesium.Color.fromCssColorString(style.outlineColor)
        .withAlpha(style.outlineAlpha),
      outlineWidth: style.outlineWidth,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    }) || null;
    // A dot this session has already identified keeps its identity across pans
    // and zooms — the lookup is memoized, so re-entering a city redraws the
    // cards it earned rather than re-asking for them.
    const known = _meshLookups.get(id);
    const support = Array.isArray(known) && known.length ? known[0] : null;
    _records.set(id, {
      id,
      mesh: true,
      tuple,
      support,
      coSited: Array.isArray(known) ? Math.max(0, known.length - 1) : 0,
      lookupEmpty: known === null,
      lookupPending: false,
      lookupError: null,
      detail: support ? _details.get(support.id) || null : null,
      detailPending: false,
      detailError: null,
      point,
      position,
      style,
    });
  }
  _count = _records.size;
  _inView = pick.inBox;
  governorRequestRender('anfr-fr-mesh');
}

async function loadMesh(box) {
  _error = null;
  _loading = !_mesh;
  const generation = ++_requestGeneration;
  await ensureMesh();
  if (generation !== _requestGeneration || !_enabled || _regime !== 'maillage') return;
  _loading = false;
  if (!_mesh) {
    // The upstream's own words go to the console; the row gets a sentence a
    // reader can act on. `HTTP 503` and `malformed payload` are diagnostics,
    // not user copy, and this is a French UI.
    _error = 'maillage national ANFR indisponible';
    _status = 'error';
    return;
  }
  reconcileMesh(box);
  _lastUpdate = Number(_mesh.fetchedAt) || Date.now();
  _status = _count > 0 ? 'ready' : 'empty';
}

/**
 * Ask the register which support is under one maillage dot.
 *
 * Deliberately NOT abortable on camera movement: the reader asked for this
 * mast, and a pan while the answer is in flight should not silently cancel it.
 */
async function resolveMeshSupport(record) {
  const id = record?.id;
  if (!id || !record.tuple) return;
  const cached = _meshLookups.get(id);
  if (cached !== undefined) {
    applyLookup(record, cached);
    return;
  }
  record.lookupPending = true;
  record.lookupError = null;
  repaintSelectedCard(id);

  const lat = Number(record.tuple[MESH_LAT]);
  const lon = Number(record.tuple[MESH_LON]);
  const params = new URLSearchParams({
    south: (lat - MESH_LOOKUP_PAD_DEG).toFixed(5),
    west: (lon - MESH_LOOKUP_PAD_DEG).toFixed(5),
    north: (lat + MESH_LOOKUP_PAD_DEG).toFixed(5),
    east: (lon + MESH_LOOKUP_PAD_DEG).toFixed(5),
  });
  try {
    const payload = await fetchJson(`${SUPPORTS_URL}?${params}`, {
      timeoutMs: DETAIL_TIMEOUT_MS,
      validate: (body) => Array.isArray(body?.supports),
    });
    const here = pickAnfrSupportsAt(payload.supports, lat, lon);
    // A lookup that found nothing is CACHED as nothing: the same answer paid
    // for again on every click is not worth a round trip.
    _meshLookups.set(id, here.length ? here : null);
    applyLookup(record, here.length ? here : null);
  } catch (error) {
    // Not cached — a timeout is not the register's answer, and the next click
    // should be allowed to ask again.
    if (error?.name !== 'AbortError') {
      console.warn('[Data:ANFR FR] mesh support lookup failed:', error?.message || error);
    }
    record.lookupError = error?.message || 'délai dépassé';
  } finally {
    record.lookupPending = false;
    repaintSelectedCard(id);
  }
}

function applyLookup(record, here) {
  if (Array.isArray(here) && here.length) {
    record.support = here[0];
    record.coSited = here.length - 1;
    record.lookupEmpty = false;
    record.detail = _details.get(here[0].id) || null;
    if (!record.detail) void resolveDetail(record);
  } else {
    record.lookupEmpty = true;
  }
}

// --- Supports regime --------------------------------------------------------

function boxKeyOf(box) {
  return [box.south, box.west, box.north, box.east].map((v) => v.toFixed(4)).join(',');
}

function reconcileSupports(payload) {
  clearSelection();
  _points?.removeAll();
  _records = new Map();
  const warm = [];
  for (const support of payload?.supports || []) {
    if (!Number.isFinite(support?.lat) || !Number.isFinite(support?.lon)) continue;
    if (_records.size >= MAX_RENDERED_SUPPORTS) break;
    const id = anfrSupportId(support.id);
    if (_records.has(id)) continue;
    const style = anfrSupportStyle(support);
    const position = supportPosition(support.lat, support.lon);
    const point = _points?.add({
      id,
      position,
      color: Cesium.Color.fromCssColorString(style.color).withAlpha(style.alpha),
      pixelSize: style.sizePx,
      outlineColor: Cesium.Color.fromCssColorString(style.outlineColor)
        .withAlpha(style.outlineAlpha),
      outlineWidth: style.outlineWidth,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      translucencyByDistance: new Cesium.NearFarScalar(500, 1.0, 400_000, 0.45),
    }) || null;
    _records.set(id, {
      id,
      mesh: false,
      support,
      coSited: 0,
      detail: _details.get(support.id) || null,
      detailPending: false,
      detailError: null,
      point,
      position,
      style,
    });
    warm.push({ lat: support.lat, lon: support.lon });
  }
  _count = _records.size;
  _inView = Number(payload?.inBox) || _count;
  warmGroundFloor(warm.slice(0, GROUND_WARM_LIMIT));
  governorRequestRender('anfr-fr-supports');
}

async function loadSupports(box, { force = false } = {}) {
  const key = boxKeyOf(box);
  if (!force && _pack && _packBoxKey === key) return;
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
    const payload = await fetchJson(`${SUPPORTS_URL}?${params}`, {
      validate: (body) => Array.isArray(body?.supports),
    });
    if (generation !== _requestGeneration || !_enabled || _regime !== 'supports') return;
    _pack = payload;
    _packBoxKey = key;
    reconcileSupports(payload);
    _lastUpdate = Number(payload.fetchedAt) || Date.now();
    _status = _count > 0 ? 'ready' : 'empty';
  } catch (error) {
    if (generation !== _requestGeneration || !_enabled) return;
    if (error?.name !== 'AbortError') {
      console.warn('[Data:ANFR FR] supports unavailable:', error?.message || error);
    }
    // Keep whatever is drawn: an older box is still a true map of the masts in
    // it, and blanking the screen would say France has no antennas.
    _error = _records.size
      ? 'rafraîchissement du registre ANFR indisponible'
      : 'registre ANFR indisponible';
    _status = _records.size ? 'ready' : 'error';
  } finally {
    if (generation === _requestGeneration) _loading = false;
  }
}

/**
 * The Cartoradio card for one support, on demand and once per session.
 *
 * ONE call per clicked mast, never a per-frame or per-viewport loop. The
 * Cartoradio REST API is the undocumented backend of ANFR's own map: the DATA
 * it serves is the same Licence Ouverte data, but nothing grants the right to
 * hammer the endpoint, so the proxy caches it and this asks for it once.
 */
async function resolveDetail(record) {
  const supId = record?.support?.id;
  if (!Number.isFinite(Number(supId))) return;
  const cached = _details.get(supId);
  if (cached !== undefined) {
    record.detail = cached;
    return;
  }
  record.detailPending = true;
  record.detailError = null;
  repaintSelectedCard(record.id);
  try {
    const payload = await fetchJson(`${DETAIL_URL}/${supId}`, {
      timeoutMs: DETAIL_TIMEOUT_MS,
      validate: (body) => Number.isFinite(Number(body?.supId)),
    });
    _details.set(supId, payload);
    record.detail = payload;
  } catch (error) {
    if (error?.name !== 'AbortError') {
      console.warn('[Data:ANFR FR] Cartoradio detail failed:', error?.message || error);
    }
    record.detailError = error?.message || 'délai dépassé';
  } finally {
    record.detailPending = false;
    repaintSelectedCard(record.id);
  }
}

// --- Viewport ---------------------------------------------------------------

/** Whichever payload is answering right now — the two carry the same provenance. */
function activePayload() {
  return _regime === 'supports' ? (_pack || _mesh) : (_mesh || _pack);
}

/** The national totals, from whichever payload has arrived. */
function nationalSummary() {
  if (_mesh) {
    return {
      count: _mesh.count,
      live: _mesh.live,
      projectOnly: _mesh.projectOnly,
      plannedUpgrades: _mesh.plannedUpgrades,
      bands: _mesh.bands,
      generations: _mesh.generations,
    };
  }
  return _pack?.national || null;
}

async function loadViewport({ force = false } = {}) {
  if (!_enabled || !_viewer) return;
  const regime = updateRegime(_viewer);
  if (regime === 'supports') {
    const box = cameraAnfrBox(_viewer);
    // A camera inside the exact regime that gives no usable rectangle — an
    // oblique horizon shot, or a view crossing the dateline — has no box to
    // ask about. The maillage is the honest fallback, not an empty map.
    if (box) {
      await loadSupports(box, { force });
      return;
    }
    _regime = 'maillage';
  }
  _pack = null;
  _packBoxKey = null;
  const meshBox = cameraAnfrMeshBox(_viewer);
  if (!meshBox) {
    _status = 'empty';
    _loading = false;
    return;
  }
  await loadMesh(meshBox);
}

function onCameraChanged() {
  clearTimeout(_cameraDebounceTimer);
  _cameraDebounceTimer = setTimeout(() => { void loadViewport(); }, CAMERA_DEBOUNCE_MS);
}

// --- Detection --------------------------------------------------------------

function collectDetectableObjects(options = {}) {
  if (!_enabled || !_records.size) return [];
  const records = [];
  for (const record of _records.values()) {
    // A support where nothing radiates is not offered to DETECT. The callout
    // names a generation, and "5G" over a mast that has never transmitted is
    // exactly the claim this layer exists to refuse.
    if (record.style?.hollow) continue;
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
    const band = record.style?.band || 'projet';
    const operators = record.style?.operators || 0;
    result.push({
      position: record.position,
      sourceId: record.id,
      id: operators > 1
        ? `${band.toUpperCase()} · ${operators} opérateurs`
        : band.toUpperCase(),
      type: 'Antenna mast',
      skipLabel: record.id === _selectedId,
    });
    if (result.length >= maxCount) break;
  }
  return result;
}

// --- Row label --------------------------------------------------------------

/** One line under the layer's toggle: what this view actually contains. */
export function buildAnfrLoadingLabel({
  regime = _regime,
  status = _status,
  loading = _loading,
  count = _count,
  inView = _inView,
  national = nationalSummary(),
  pick = _meshPick,
  records = _records,
} = {}) {
  if (loading) return 'lecture du registre ANFR...';
  if (status === 'error') return '';
  const parts = [];
  if (regime === 'maillage') {
    // A camera over the Pacific is not a broken layer and not an empty
    // register: `layerFeedState()` renders `empty` as a green ON chip, and the
    // sentence is what tells a reader which of the two they are looking at.
    if (!count) return national?.count ? 'aucun support ANFR dans cette vue' : '';
    parts.push(pick?.thinned
      ? `${fr(count)} points pour ${fr(inView)} supports dans la vue`
      : `${fr(count)} supports`);
    if (national?.count) parts.push(`${fr(national.count)} en France`);
    // The maillage cannot draw the upgrade ring — the tuple has no plan mask —
    // so it says how many rings it is NOT showing rather than letting the
    // absence read as absence.
    if (national?.plannedUpgrades > 0) {
      parts.push(`${fr(national.plannedUpgrades)} projets d’extension visibles seulement en zoom`);
    }
    return parts.join(' · ');
  }
  if (!count) return 'aucun support ANFR dans cette vue';
  parts.push(`${fr(count)} supports`);
  if (inView > count) parts.push(`${fr(inView - count)} non tracés`);
  let hollow = 0;
  let ringed = 0;
  for (const record of records.values()) {
    if (record.style?.hollow) hollow += 1;
    else if (record.style?.ringed) ringed += 1;
  }
  if (hollow > 0) {
    parts.push(hollow > 1
      ? `${fr(hollow)} projets approuvés, rien n’émet`
      : '1 projet approuvé, rien n’émet');
  }
  if (ringed > 0) {
    parts.push(ringed > 1
      ? `${fr(ringed)} extensions autorisées`
      : '1 extension autorisée');
  }
  return parts.join(' · ');
}

// --- Layer ------------------------------------------------------------------

const anfrFranceLayer = {
  id: ANFR_FR_LAYER_ID,
  name: 'Antennes mobiles (ANFR)',
  // NOT the ≋ the RÉSEAUX & CAPTEURS group uses, and pointedly not anything the
  // `radio` row could be confused with: that layer is audio streams and this
  // one is the masts. 📡 is the transmitting dish, unused elsewhere on the globe.
  icon: '📡',
  source: 'Observatoire des réseaux mobiles — ANFR',
  updateInterval: POLL_INTERVAL_MS,

  init(viewer) {
    _viewer = viewer;
    _points = new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT });
    _points.show = false;
    viewer.scene.primitives.add(_points);
    registerSpriteCollection(ANFR_FR_LAYER_ID, _points);

    _enabled = false;
    _records = new Map();
    _selectedId = null;
    _count = 0;
    _inView = 0;
    _lastUpdate = null;
    _loading = false;
    _error = null;
    _status = 'idle';
    _regime = 'maillage';
    _meshPick = null;

    _overlayHost.setVisible(ANFR_FR_OVERLAY_SOURCE_ID, false);
    restoreSpriteOrder(viewer);
    console.log('[Data:ANFR FR] Initialized');
  },

  enable(viewer) {
    _enabled = true;
    _error = null;
    if (_points) _points.show = true;
    _overlayHost.setVisible(ANFR_FR_OVERLAY_SOURCE_ID, true);
    installClickHandler(viewer);
    registerPickOwner(ANFR_FR_LAYER_ID, (pickedId) => _records.has(pickedId));
    if (!_cameraChangedAttached) {
      viewer.camera.changed.addEventListener(onCameraChanged);
      viewer.camera.percentageChanged = Math.min(viewer.camera.percentageChanged || 1, 0.05);
      _cameraChangedAttached = true;
    }
    if (!_preRenderRemover) {
      _preRenderRemover = viewer.scene.preRender.addEventListener(onPreRender);
    }
    restoreSpriteOrder(viewer);
    // DataLayerManager calls update() immediately after enable(), which owns
    // the first fetch. Avoid racing it with a second request here.
  },

  disable(viewer) {
    _enabled = false;
    _requestGeneration += 1;
    _regime = 'maillage';
    clearTimeout(_cameraDebounceTimer);
    _cameraDebounceTimer = null;
    clearSelection();
    _points?.removeAll();
    _records = new Map();
    _count = 0;
    _inView = 0;
    _overlayHost.setVisible(ANFR_FR_OVERLAY_SOURCE_ID, false);
    if (_clickHandler) {
      _clickHandler.destroy();
      _clickHandler = null;
    }
    if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeyDown);
    unregisterPickOwner(ANFR_FR_LAYER_ID);
    if (_cameraChangedAttached && viewer) {
      viewer.camera.changed.removeEventListener(onCameraChanged);
      _cameraChangedAttached = false;
    }
    if (_preRenderRemover) {
      _preRenderRemover();
      _preRenderRemover = null;
    }
    if (_points) _points.show = false;
    _loading = false;
    _status = 'idle';
  },

  async update() {
    if (!_enabled) return true;
    await loadViewport({ force: true });
    return true;
  },

  getDetectableObjects(options = {}) {
    return collectDetectableObjects(options);
  },

  getStats() {
    const national = nationalSummary();
    const stats = {
      count: _count,
      lastUpdate: _lastUpdate,
      loading: _loading,
      status: _status === 'ready' ? 'ok' : _status,
      regime: _regime,
      supportsInView: _inView,
      // The layer's own honesty numbers, surfaced rather than buried.
      supportsNational: national?.count ?? null,
      projectOnly: national?.projectOnly ?? null,
      plannedUpgrades: national?.plannedUpgrades ?? null,
      edition: activePayload()?.edition ?? null,
    };
    if (activePayload()?.stale) stats.stale = true;
    const label = buildAnfrLoadingLabel();
    if (label) stats.loadingLabel = label;
    if (_error) stats.error = _error;
    return stats;
  },

  /** Register provenance for the attribution popover and analyst surfaces. */
  getViewportSummary() {
    const payload = activePayload();
    if (!payload) return null;
    const { mesh, supports, ...summary } = payload;
    return {
      ...summary,
      regime: _regime,
      drawn: _count,
      inView: _inView,
      thinned: Boolean(_regime === 'maillage' && _meshPick?.thinned),
    };
  },

  /**
   * Colour legend for the control-panel row — whichever scale is on screen.
   *
   * Counted over the RECORDS, which is what is actually drawn, and ordered
   * newest-generation-first because that is the order the map is read in. The
   * `projet` row is kept even at zero: "a hollow ring means nothing transmits
   * here" is the entry a reader has to be given.
   */
  getRowControls() {
    if (!_records.size) return { chips: [], legend: [] };
    const tally = new Map();
    for (const record of _records.values()) {
      const band = record.style?.band;
      if (band) tally.set(band, (tally.get(band) || 0) + 1);
    }
    const legend = [...ANFR_BANDS].reverse()
      .filter((band) => tally.get(band) > 0 || band === 'projet')
      .map((band) => ({
        label: anfrBandLabelFor(band),
        color: anfrBandColor(band),
        count: tally.get(band) || 0,
        blurb: BAND_BLURBS[band],
      }));
    // No chips: the manager renders a chip as a BUTTON keyed by `chip.id` and
    // dispatches `chip.params` on click, so an informational one would be a
    // control that looks clickable and does nothing. The national fact that
    // belongs beside the ramp — that the status field describes the
    // GENERATION and not this mast — is in the `5g` blurb, which renders as
    // the legend entry's tooltip.
    return { chips: [], legend };
  },

  destroy(viewer) {
    if (_enabled) this.disable(viewer);
    else {
      clearSelection();
      _overlayHost.setVisible(ANFR_FR_OVERLAY_SOURCE_ID, false);
      if (_clickHandler) {
        _clickHandler.destroy();
        _clickHandler = null;
      }
      if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeyDown);
      unregisterPickOwner(ANFR_FR_LAYER_ID);
    }
    if (_preRenderRemover) {
      _preRenderRemover();
      _preRenderRemover = null;
    }
    if (_points) {
      unregisterSpriteCollection(ANFR_FR_LAYER_ID, _points);
      viewer?.scene?.primitives?.remove?.(_points);
      _points = null;
    }
    _records.clear();
    _mesh = null;
    _pack = null;
    _packBoxKey = null;
    _meshLookups.clear();
    _details.clear();
    _viewer = null;
  },
};

// --- Test seams -------------------------------------------------------------

/**
 * Seed rendered records so selection, card, legend, DETECT and stats paths run
 * against the production code with no WebGL and no network.
 *
 * `supports` and `mesh` are the two payload shapes the proxy serves; passing
 * either builds the records exactly as `reconcileSupports` / `reconcileMesh`
 * would, minus the primitives.
 */
export function _setAnfrStateForTest({
  viewer, overlayHost, http, mesh = null, pack = null, meshPick = null,
  regime = pack ? 'supports' : 'maillage', enabled = true, details = null, lookups = null,
} = {}) {
  _viewer = viewer || null;
  _overlayHost = overlayHost || DEFAULT_OVERLAY_HOST;
  _http = http || DEFAULT_HTTP;
  _mesh = mesh;
  _pack = pack;
  _packBoxKey = pack ? 'test' : null;
  _meshPick = meshPick;
  _regime = regime;
  _enabled = enabled;
  _selectedId = null;
  _loading = false;
  _error = null;
  _status = 'ready';
  _records = new Map();
  _meshLookups.clear();
  _details.clear();
  for (const [key, value] of details || []) _details.set(key, value);
  for (const [key, value] of lookups || []) _meshLookups.set(key, value);

  if (regime === 'supports') {
    for (const support of pack?.supports || []) {
      const id = anfrSupportId(support.id);
      _records.set(id, {
        id,
        mesh: false,
        support,
        coSited: 0,
        detail: _details.get(support.id) || null,
        detailPending: false,
        detailError: null,
        point: null,
        position: Cesium.Cartesian3.fromDegrees(support.lon, support.lat, POINT_LIFT_M),
        style: anfrSupportStyle(support),
      });
    }
  } else {
    for (const tuple of meshPick?.picked || mesh?.mesh || []) {
      const id = anfrMeshRecordId(tuple);
      const known = _meshLookups.get(id);
      const support = Array.isArray(known) && known.length ? known[0] : null;
      _records.set(id, {
        id,
        mesh: true,
        tuple,
        support,
        coSited: Array.isArray(known) ? Math.max(0, known.length - 1) : 0,
        lookupEmpty: known === null,
        lookupPending: false,
        lookupError: null,
        detail: support ? _details.get(support.id) || null : null,
        detailPending: false,
        detailError: null,
        point: null,
        position: Cesium.Cartesian3.fromDegrees(tuple[MESH_LON], tuple[MESH_LAT], POINT_LIFT_M),
        style: anfrMeshStyle(tuple),
      });
    }
  }
  _count = _records.size;
  _inView = meshPick?.inBox ?? Number(pack?.inBox) ?? _count;
}

/** Exercise the production selection path in focused runtime tests. */
export function _selectAnfrForTest(id) {
  selectSupport(id);
}

/**
 * Drive the real viewport load — regime choice, fetch, reconcile, degradation.
 *
 * The seam takes the whole path rather than one leg of it, because the bugs
 * this layer can have are handovers: a regime that asks for a box the proxy
 * refuses, a failed refresh that blanks a drawn map, a mesh payload adopted in
 * the exact regime. None of those is visible from a unit-tested leg.
 */
export async function _loadAnfrViewportForTest(viewer, options = {}) {
  _viewer = viewer || _viewer;
  _enabled = true;
  await loadViewport(options);
  return { regime: _regime, count: _count, inView: _inView, status: _status, error: _error };
}

/** Exercise the production clear path and restore the production seams. */
export function _clearAnfrSelectionForTest() {
  clearSelection();
  _overlayHost = DEFAULT_OVERLAY_HOST;
  _http = DEFAULT_HTTP;
  _mesh = null;
  _pack = null;
  _packBoxKey = null;
  _meshPick = null;
  _records = new Map();
  _meshLookups.clear();
  _details.clear();
  _regime = 'maillage';
  _enabled = false;
  _count = 0;
  _inView = 0;
  _status = 'idle';
}

/** @returns {?string} */
export function _anfrSelectedIdForTest() {
  return _selectedId;
}

/** The live record for one id, for tests that assert on the resolved card. */
export function _anfrRecordForTest(id) {
  return _records.get(id) || null;
}

/** Row-control legend, for tests that do not construct a viewer. */
export function _anfrRowControlsForTest() {
  return anfrFranceLayer.getRowControls();
}

/** Stats, for tests that do not construct a viewer. */
export function _anfrStatsForTest() {
  return anfrFranceLayer.getStats();
}

/** Detection candidates, for tests that do not construct a viewer. */
export function _anfrDetectablesForTest(options = {}) {
  return collectDetectableObjects(options);
}

export default anfrFranceLayer;
