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
 * ── The MAST: the support drawn at its real height, in world metres ─────────
 * The register publishes `sup_nm_haut` and this layer read it, printed it on a
 * card, and drew a flat dot. A 343 m guyed mast and a 12 m rooftop pole were
 * the same mark on a 3D globe.
 *
 * The coverage was measured before anything was drawn (the count is in
 * `anfrFeed.js`, Trap 3): **72 149 of the 72 700 supports publish a usable
 * height — 99.24 %**. Median 30 m, p95 48 m, max 343.3 m. That is dense enough
 * to extrude, so the support is extruded.
 *
 * **IN WORLD UNITS, NOT IN PIXELS, and that is the whole B2 decision.** A
 * support is a physical object with a real height; drawing it at 1 m of shaft
 * per 1 m of mast means the mark shrinks with distance exactly as the mast
 * itself does, which is the branch of B2 that is legitimate — the forbidden one
 * is a thematic size composed with `scaleByDistance`, and there is none here.
 * The dot keeps its own channel unchanged: pixel size is still the operator
 * count, and it is NOT multiplied by anything. Two orthogonal channels, one
 * screen-space and one world-space.
 *
 * The dot is seated on TOP of the shaft, at the height the register gives,
 * because that is where the antennas are. It is lifted in the exact regime at
 * every span, not only where the shaft is drawn, so that crossing the shaft
 * threshold never makes a dot jump: at 0.32° of span a 30 m lift is about one
 * pixel.
 *
 * WHEN. Shafts are drawn only under **0.06° of view span** (about 6.7 km
 * across), with the exit at 0.09°. That is not a taste: at 0.32° — the top of
 * the exact regime — a median 30 m mast is about one screen pixel and a shaft
 * would be noise that changes nothing. The cost of the closest regime is
 * measured on the real positions: the fullest possible 0.06° box in France
 * holds **1 063 supports** (48.83278 N, 2.31639 E, central Paris) and the
 * fullest 0.09° box holds **1 913**, against a ceiling of 2 400 polylines that
 * therefore never bites.
 *
 * WHERE THE HEIGHT IS MISSING, THERE IS NO SHAFT — and that is the A1 half.
 * The 551 supports without one keep their dot on the ground and get no mast at
 * all, because the fallback here is the ABSENCE of the mark and never a
 * default value of it. It costs nothing to be right about, since the 551 are
 * not a random hole: **all 551 are `Intérieur sous-terrain` (506), `Tunnel`
 * (38) or `Intérieur galerie` (7)** — the register omits the height because
 * the equipment is underground and there is no mast to measure. A shaft there
 * would be an invention twice over. The count travels with the row label and
 * the legend.
 *
 * A support that radiates nothing gets a DASHED shaft. Its height is a
 * declared figure on an authorised file, not a measurement of something built,
 * and the dash is the same statement the hollow ring already makes on the dot.
 * A motif rather than a tint, per D3, because it survives the FLIR and NVG
 * passes that would flatten a colour difference.
 *
 * OCCLUSION, declared per F1: the shaft is world geometry and is depth-tested,
 * so a building in front of it hides it — which is information. The dot keeps
 * `disableDepthTestDistance` as it always had, so a mast in a dense city stays
 * clickable. The two marks are not the same sign and do not claim to be.
 *
 * ── The AZIMUTHS: one mast at a time, because that is where they exist ──────
 * A mobile antenna is not omnidirectional and the direction it faces is the
 * field a map of masts most obviously wants. **It is not in the observatoire**
 * — the CSV is 22 columns and none of them is a bearing, re-verified against
 * the live file on 2026-09-03 (the header is quoted in `anfrFeed.js`). It IS
 * in Cartoradio, per antenna, on the same on-demand call this layer already
 * makes for a clicked mast: measured over 40 supports spread through the
 * register, **324 of 328 antennas publish an orientation, 98.8 %**.
 *
 * So the sectors are drawn for the SELECTED support and for nothing else. That
 * is a limit of the transport, not a design flourish: one Cartoradio call per
 * mast is what this layer is allowed to make, and a viewport of sectors would
 * mean thousands. Saying so is the honest form; drawing a default fan on every
 * dot would be the dishonest one.
 *
 * RAYS, NOT WEDGES. ANFR publishes the bearing and publishes neither a
 * beamwidth nor a range, so a wedge would have to invent an aperture and a
 * distance. The ray is drawn at a declared **60 m** — twice the national
 * median mast height, chosen so it reads against the shaft it springs from —
 * and the card says in French that this length is a convention and not a
 * coverage claim. `orientation: 0` is drawn as due north, because it was
 * checked and it is one: 26 of 138 measured installations carry a 0, none
 * carries it alone, and 18 of the 26 are the three-sector `0/120/240`.
 *
 * An antenna whose bearing is not filed gets no ray and is counted on the
 * card. That is the same case `cctv.js` meets with an unsurveyed camera
 * heading and answers with a dashed cone — the difference is that `cctv.js`
 * has a placeholder bearing to disown, and this layer has none to draw, so the
 * stricter answer is available and is taken.
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
import { claimCameraSensitivity, releaseCameraSensitivity } from './cameraSensitivity.js';
import { governorRequestRender } from '../renderGovernor.js';
import { registerSpriteCollection, restoreSpriteOrder, unregisterSpriteCollection } from './spriteOrder.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import { cachedGroundFloor, warmGroundFloor } from './groundFloor.js';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { prismHatchGlyph, prismHeightGlyph } from './choroplethPrism.js';
import {
  ANFR_BANDS,
  ANFR_BAND_LABELS,
  ANFR_EXPOSURE_RADIUS_M,
  ANFR_GENERATIONS,
  ANFR_HEIGHTLESS_NATURES,
  ANFR_HEIGHT_MAX_M,
  ANFR_HEIGHT_MEDIAN_M,
  ANFR_HEIGHT_MISSING,
  ANFR_HEIGHT_P05_M,
  ANFR_HEIGHT_P95_M,
  ANFR_HEIGHT_PUBLISHED,
  ANFR_STATUS_LABELS,
  anfrBand,
  anfrDecodeMask,
  anfrProjectPoint,
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

// --- The shaft sub-regime ---------------------------------------------------
/**
 * View span (max of the two, degrees) at or below which the supports are drawn
 * as SHAFTS at their real height, and above which the shafts go away again.
 *
 * 0.06° is about 6.7 km across the screen. On a 1 000-pixel-wide viewport that
 * puts the national median mast (30 m) at roughly 4.5 px of shaft, which is the
 * point where a height starts being comparable between two neighbours. At the
 * top of the exact regime (0.32°) the same mast is about one pixel: a shaft
 * there would be a rendering cost that changes nothing a reader can use.
 *
 * The exit sits above the entry so a camera resting on the boundary cannot
 * flicker the whole shaft field on and off.
 */
export const ANFR_MAST_ENTER_SPAN_DEG = 0.06;
export const ANFR_MAST_EXIT_SPAN_DEG = 0.09;
/**
 * Hard cap on drawn shafts.
 *
 * 2 400, above the 1 913 of the fullest possible 0.09° box in France (measured
 * by sweeping every candidate box over the real 72 700 positions; the fullest
 * 0.06° box holds 1 063). It exists so a malformed payload cannot ask Cesium
 * for a million polylines, and anything it drops is counted and printed — A5.
 */
const MAX_RENDERED_MASTS = 2_400;
/**
 * Shaft width, in pixels, and it carries NOTHING.
 *
 * The quantity is the shaft's LENGTH, in metres of the world. The width is a
 * legibility constant: a world-space width would vanish at the far end of the
 * same view that the length is meant to be read across.
 */
const MAST_WIDTH_PX = 1.6;
const MAST_ALPHA = 0.7;
/** Dash length (pixels) of a shaft whose mast is authorised and not built. */
const MAST_DASH_LENGTH = 8;

// --- The azimuth rays of the selected support -------------------------------
/**
 * Ray length in metres — a DECLARED CONVENTION, never a range.
 *
 * Twice the national median mast height, so a ray reads against the shaft it
 * springs from at the scale the shafts are drawn at. ANFR publishes no
 * beamwidth and no coverage distance; the card says as much in French beside
 * the bearings, because a reader who takes 60 m for a cell radius has been
 * misled by the map and not by the register.
 */
export const ANFR_SECTOR_RAY_M = 60;
const SECTOR_WIDTH_PX = 2.2;
const SECTOR_ALPHA = 0.9;
/**
 * Cap on rays for one selected mast.
 *
 * 96, well above the busiest measured site (33 distinct bearing/height pairs on
 * support 449714, five operators). Overflow is counted and said, not silently
 * dropped.
 */
const MAX_RENDERED_SECTORS = 96;
/** How many distinct bearings the card prints before summarising. */
const CARD_AZIMUTH_LIMIT = 8;

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

/**
 * The height marks the legend publishes, in metres — FROZEN (C1).
 *
 * Three, because a size channel with no numbered mark says only "taller than
 * that one" (D1), and because the whole distribution is what these three
 * position a reader inside: p05, median and p95 of the 72 149 published
 * heights, counted once over the national register and never recomputed from
 * what is on screen. The swatch bar is drawn against the p95 so the tallest
 * mark fills it; the 343.3 m maximum is named in the blurb rather than given a
 * mark of its own, since a bar 7× the median would flatten the other two.
 */
const MAST_LEGEND_TICKS_M = Object.freeze([
  ANFR_HEIGHT_P05_M, ANFR_HEIGHT_MEDIAN_M, ANFR_HEIGHT_P95_M,
]);
const MAST_LEGEND_BLURBS = Object.freeze({
  [ANFR_HEIGHT_P05_M]: '5ᵉ centile du parc : un support sur vingt est plus court. Toiture basse, mât urbain, mobilier.',
  [ANFR_HEIGHT_MEDIAN_M]: 'Médiane des 72 149 hauteurs publiées. Un pylône autostable français fait 32,1 m de médiane, un immeuble porteur 25,7 m.',
  [ANFR_HEIGHT_P95_M]: '95ᵉ centile : un support sur vingt est plus haut. Le plus haut du registre est un pylône haubané de 343,3 m.',
});
/** The swatch colour of a height mark — the same neutral the prisms use. */
const MAST_LEGEND_SWATCH = '#c3ccd8';

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
/** Shafts. Depth-tested world geometry, deliberately NOT a sprite collection. */
let _masts = null;
/** Azimuth rays of the selected support only. */
let _sectors = null;
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
/** Whether the camera is close enough for the shafts to say anything. */
let _mastRegime = false;
let _mastsDrawn = 0;
let _mastsUnpublished = 0;
let _mastsClipped = 0;
let _sectorsDrawn = 0;
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

// --- The shaft and the rays -------------------------------------------------

/**
 * The height a support's shaft is drawn at, in metres, or null for no shaft.
 *
 * Null is the answer for the 551 supports the register leaves blank, and it is
 * the whole A1 content of this layer's new channel: the fallback is the
 * absence of the mark, never a default length of it. Zero and negatives are
 * refused for the same reason the feed refuses them — the register writes `0`
 * where nobody filled the field in, and a 0 m mast is not a fact.
 *
 * @param {object} support Pack row from the `/supports` route.
 * @returns {?number}
 */
export function anfrMastHeightM(support) {
  const metres = Number(support?.heightM);
  if (!Number.isFinite(metres) || metres <= 0) return null;
  return metres;
}

/**
 * Whether the camera is close enough for shafts, with hysteresis.
 *
 * Pure, so the threshold pair can be tested without a viewer — the bug this
 * shape prevents is a boundary that flickers the whole shaft field on and off
 * while the reader holds still.
 *
 * @param {number} spanDeg The view's widest span, in degrees.
 * @param {boolean} current Whether shafts are drawn right now.
 * @returns {boolean}
 */
export function anfrMastRegime(spanDeg, current = false) {
  const span = Number(spanDeg);
  if (!Number.isFinite(span)) return false;
  return current ? span <= ANFR_MAST_EXIT_SPAN_DEG : span <= ANFR_MAST_ENTER_SPAN_DEG;
}

/**
 * The rays drawable for one Cartoradio card, and what had to be refused.
 *
 * A pair with no mounting height is NOT seated on the support's own height:
 * the mast height and the antenna height are two different published numbers
 * and substituting one for the other would be a measured-looking invention.
 * It is refused and counted instead — `unplaced` — exactly as an antenna with
 * no bearing is refused and counted as `unaimed`.
 *
 * @param {?object} detail The Cartoradio payload held on the record.
 * @returns {{rays:Array<{deg:number, heightM:number, antennas:number}>,
 *   unplaced:number, unaimed:number, bearings:Array<number>, clipped:number}}
 */
export function anfrSectorRays(detail) {
  const pairs = Array.isArray(detail?.antennas?.azimuths) ? detail.antennas.azimuths : [];
  const rays = [];
  let unplaced = 0;
  let clipped = 0;
  for (const pair of pairs) {
    const deg = Number(pair?.deg);
    const heightM = Number(pair?.heightM);
    if (!Number.isFinite(deg)) continue;
    if (!Number.isFinite(heightM) || heightM <= 0) {
      unplaced += 1;
      continue;
    }
    if (rays.length >= MAX_RENDERED_SECTORS) {
      clipped += 1;
      continue;
    }
    rays.push({ deg, heightM, antennas: Number(pair?.antennas) || 1 });
  }
  // The card lists BEARINGS, not pairs: a five-operator mast files the same
  // three sectors a dozen times at a dozen mounting heights, and a card that
  // printed all of them would read as thirty-three directions.
  const bearings = [...new Set(pairs
    .map((pair) => Number(pair?.deg))
    .filter(Number.isFinite))].sort((a, b) => a - b);
  return {
    rays,
    unplaced,
    unaimed: Number(detail?.antennas?.withoutAzimuth) || 0,
    bearings,
    clipped,
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
  // The shaft sub-regime is nested inside the exact one: the maillage has no
  // support heights in its tuple and could only guess at them.
  _mastRegime = _regime === 'supports' && anfrMastRegime(span.max, _mastRegime);
  return _regime;
}

/**
 * A support's two anchors, seated on the shared coarse ground floor: the foot
 * of the shaft and the top of it.
 *
 * Only the exact regime uses them. The maillage lifts its dots by
 * `POINT_LIFT_M` off the ellipsoid instead: at those altitudes a metre of
 * vertical error is invisible and 2 200 terrain lookups per pan would not be.
 *
 * The dot goes on TOP — at the published support height — at every span of the
 * exact regime and not only where the shaft is drawn, so crossing the shaft
 * threshold never moves a dot. Where no height is published the top IS the
 * foot, which is the same statement the missing shaft makes.
 */
function supportAnchors(lat, lon, heightM) {
  const floor = cachedGroundFloor(lat, lon);
  const base = (Number.isFinite(floor) ? floor : 0) + POINT_LIFT_M;
  const lift = Number.isFinite(heightM) && heightM > 0 ? heightM : 0;
  return {
    ground: Cesium.Cartesian3.fromDegrees(lon, lat, base),
    top: Cesium.Cartesian3.fromDegrees(lon, lat, base + lift),
  };
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

// --- Shaft and ray primitives ------------------------------------------------

/**
 * Colour of one shaft: its own band, so a shaft belongs to its dot.
 *
 * MEMOIZED, and that is not micro-optimisation. A `PolylineCollection` buckets
 * its polylines by material instance, so handing 1 063 shafts 1 063 fresh
 * `Material` objects would build 1 063 buckets and 1 063 draw calls for what
 * is at most five distinct appearances — four band fills plus the dashed one.
 */
const _mastMaterials = new Map();
function mastMaterial(style) {
  const key = `${style.color}|${style.hollow ? 'dash' : 'solid'}`;
  let material = _mastMaterials.get(key);
  if (!material) {
    const color = Cesium.Color.fromCssColorString(style.color).withAlpha(MAST_ALPHA);
    // A support that radiates nothing is an authorised file, not a built mast:
    // its height is declared and not observed, and the dash says so with the
    // same motif the hollow ring already uses on the dot. D3 — a pattern
    // survives the sensor passes that flatten a tint.
    material = style.hollow
      ? Cesium.Material.fromType('PolylineDash', { color, dashLength: MAST_DASH_LENGTH })
      : Cesium.Material.fromType('Color', { color });
    _mastMaterials.set(key, material);
  }
  return material;
}

/** The one cyan the selected support's rays share. Same bucketing argument. */
let _sectorMaterial = null;
function sectorMaterial() {
  if (!_sectorMaterial) {
    _sectorMaterial = Cesium.Material.fromType('Color', {
      color: Cesium.Color.fromCssColorString(SELECTED_COLOR).withAlpha(SECTOR_ALPHA),
    });
  }
  return _sectorMaterial;
}

/**
 * Rebuild the shaft field from the records already drawn.
 *
 * Recycles the polylines rather than clearing the collection, for the reason
 * G2 names: `removeAll()` sets `_createVertexArray` and rebuilds the whole
 * vertex array on the next frame, which is exactly the stutter a pan must not
 * have. Polylines past the end are hidden and reused on the way back in.
 *
 * Everything it refuses is counted: `_mastsUnpublished` are the supports the
 * register gives no height for, `_mastsClipped` is the cap biting. Both reach
 * the row label and the legend (A1, A5).
 */
function reconcileMasts() {
  _mastsDrawn = 0;
  _mastsUnpublished = 0;
  _mastsClipped = 0;
  const draw = _enabled && _regime === 'supports' && _mastRegime;
  let index = 0;
  if (draw) {
    for (const record of _records.values()) {
      const heightM = anfrMastHeightM(record.support);
      if (heightM === null) {
        _mastsUnpublished += 1;
        continue;
      }
      if (index >= MAX_RENDERED_MASTS) {
        _mastsClipped += 1;
        continue;
      }
      // The tally is kept whether or not there is a collection to draw into,
      // so the row label and the legend say the same thing in a headless test
      // as they do on screen.
      if (_masts) {
        const positions = [record.groundPosition || record.position, record.position];
        let line = _masts.get(index);
        if (!line) {
          line = _masts.add({
            positions,
            width: MAST_WIDTH_PX,
            material: mastMaterial(record.style),
            show: true,
          });
        } else {
          line.positions = positions;
          line.width = MAST_WIDTH_PX;
          const material = mastMaterial(record.style);
          if (line.material !== material) line.material = material;
          line.show = true;
        }
      }
      index += 1;
    }
  }
  _mastsDrawn = index;
  if (!_masts) return;
  for (let i = index; i < _masts.length; i += 1) _masts.get(i).show = false;
  _masts.show = draw && index > 0;
}

/** Hide every ray and forget what they said. */
function clearSectors() {
  _sectorsDrawn = 0;
  if (!_sectors) return;
  for (let i = 0; i < _sectors.length; i += 1) _sectors.get(i).show = false;
  _sectors.show = false;
}

/**
 * Draw the published bearings of ONE support, at the mounting heights
 * Cartoradio publishes for them.
 *
 * Cyan, the selection colour, because that is what these rays are: a detail of
 * the object the reader clicked, not a channel of the layer. Nothing else on
 * this map is cyan while a selection is live, so there is no reading in which
 * a ray belongs to a mast other than the selected one.
 */
function drawSectors(record) {
  clearSectors();
  if (!_sectors || !_mastRegime || _regime !== 'supports') return;
  const support = record?.support;
  if (!Number.isFinite(support?.lat) || !Number.isFinite(support?.lon)) return;
  const { rays } = anfrSectorRays(record.detail);
  if (!rays.length) return;

  const floor = cachedGroundFloor(support.lat, support.lon);
  const base = (Number.isFinite(floor) ? floor : 0) + POINT_LIFT_M;
  const material = sectorMaterial();
  let index = 0;
  for (const ray of rays) {
    const far = anfrProjectPoint(support.lat, support.lon, ray.deg, ANFR_SECTOR_RAY_M);
    if (!far) continue;
    const altitude = base + ray.heightM;
    const positions = [
      Cesium.Cartesian3.fromDegrees(support.lon, support.lat, altitude),
      Cesium.Cartesian3.fromDegrees(far.lon, far.lat, altitude),
    ];
    let line = _sectors.get(index);
    if (!line) {
      line = _sectors.add({
        positions, width: SECTOR_WIDTH_PX, material, show: true,
      });
    } else {
      line.positions = positions;
      line.width = SECTOR_WIDTH_PX;
      line.show = true;
    }
    index += 1;
  }
  for (let i = index; i < _sectors.length; i += 1) _sectors.get(i).show = false;
  _sectors.show = index > 0;
  _sectorsDrawn = index;
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
  // and the card says so rather than printing "0 m". The sentence names what
  // the map does about it, because the missing shaft is otherwise a silence.
  details.push(Number.isFinite(support.heightM)
    ? `Support de ${fr(support.heightM)} m — fût dessiné à cette hauteur`
    : `Hauteur du support non publiée — aucun fût dessiné (${fr(ANFR_HEIGHT_MISSING)} supports du registre, tous `
      + `${ANFR_HEIGHTLESS_NATURES.join(' · ').toLowerCase()})`);

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
  lines.push(...anfrAzimuthLines(detail));

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

/**
 * The bearing lines of a card: what is drawn, and what could not be.
 *
 * Kept apart so a test can assert on it without the rest of the Cartoradio
 * card, and because it is the one place in this layer where a number is
 * published that the observatoire does not have — the sentence names its
 * source rather than letting it read as part of the register.
 *
 * @param {?object} detail Cartoradio payload.
 * @returns {Array<string>}
 */
export function anfrAzimuthLines(detail) {
  const { bearings, unplaced, unaimed } = anfrSectorRays(detail);
  const lines = [];
  if (bearings.length) {
    const shown = bearings.slice(0, CARD_AZIMUTH_LIMIT)
      .map((deg) => `${deg.toLocaleString('fr-FR')}°`).join(' · ');
    const rest = bearings.length - CARD_AZIMUTH_LIMIT;
    lines.push(`Azimuts publiés : ${shown}${rest > 0 ? ` +${fr(rest)}` : ''} — Cartoradio`);
    // The ray length is a drawing convention and the register has no coverage
    // figure at all. A reader who took 60 m for a cell radius would have been
    // misled by the map, so the map says it.
    lines.push(`Rayons de ${fr(ANFR_SECTOR_RAY_M)} m : la direction est publiée, ni l’ouverture ni la portée`);
  }
  if (unplaced > 0) {
    lines.push(`⚠ ${fr(unplaced)} azimut${unplaced > 1 ? 's' : ''} sans hauteur de fixation publiée — non tracé${unplaced > 1 ? 's' : ''}`);
  }
  if (unaimed > 0) {
    lines.push(`⚠ ${fr(unaimed)} antenne${unaimed > 1 ? 's' : ''} sans azimut publié — aucune direction dessinée`);
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
  clearSectors();
  _overlayHost.clearSource(ANFR_FR_OVERLAY_SOURCE_ID);
  governorRequestRender('anfr-fr-deselect');
}

/** Redraw the selected card in place, if `id` is still what is selected. */
function repaintSelectedCard(id) {
  if (_selectedId !== id) return;
  const record = _records.get(id);
  // The Cartoradio card is what carries the bearings, so the arrival that
  // repaints the text is also the arrival that can finally draw the rays.
  if (record) drawSectors(record);
  const entry = createAnfrSelectedOverlayEntry(record, activePayload());
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
  // `repaintSelectedCard` draws the rays: whatever bearings this session
  // already holds go up now, and the ones the Cartoradio call is about to
  // bring go up when it lands and repaints.
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
  // The maillage tuple carries no height, so there is nothing to extrude and
  // the shaft field is put away rather than left over from the last close-up.
  reconcileMasts();
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
    const heightM = anfrMastHeightM(support);
    const { ground, top } = supportAnchors(support.lat, support.lon, heightM);
    const position = top;
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
      groundPosition: ground,
      mastHeightM: heightM,
      style,
    });
    warm.push({ lat: support.lat, lon: support.lon });
  }
  _count = _records.size;
  _inView = Number(payload?.inBox) || _count;
  warmGroundFloor(warm.slice(0, GROUND_WARM_LIMIT));
  reconcileMasts();
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
      // `loadSupports` short-circuits when the box has not moved, so a zoom
      // that only crosses the shaft threshold would otherwise leave the field
      // as it was. Reconciling here is idempotent and costs one walk of the
      // records the layer already holds.
      if (_enabled && _regime === 'supports') reconcileMasts();
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
  mastRegime = _mastRegime,
  masts = _mastsDrawn,
  mastsUnpublished = _mastsUnpublished,
  mastsClipped = _mastsClipped,
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
  // The shafts are the layer's only world-space channel, and a reader who sees
  // none has to be able to tell "too far to draw them" from "no height
  // published" from "the cap bit". A4 has three empties and these are three of
  // them, so they get three different sentences.
  if (!mastRegime) {
    parts.push('fûts à leur hauteur en vue rapprochée');
  } else {
    if (masts > 0) parts.push(`${fr(masts)} fûts à leur hauteur`);
    if (mastsUnpublished > 0) {
      parts.push(mastsUnpublished > 1
        ? `${fr(mastsUnpublished)} sans hauteur publiée, sans fût`
        : '1 sans hauteur publiée, sans fût');
    }
    if (mastsClipped > 0) parts.push(`${fr(mastsClipped)} fûts écrêtés par le plafond`);
  }
  return parts.join(' · ');
}

/**
 * The size scale, published as legend rows — D1.
 *
 * A length channel with no numbered mark is unreadable, and this one is
 * unusual in that its scale is 1:1 — one drawn metre is one metre of support —
 * so what the reader needs is not a conversion but a POSITION in the national
 * distribution. Hence three frozen marks and a fourth row for the shape that
 * means "no measurement", which is hatched rather than tinted (D3).
 *
 * The rows only appear where the channel does. Publishing a height key beside
 * a maillage that draws no shafts would be a legend for a mark that is not on
 * the screen.
 *
 * @param {object} [state] Injected for tests.
 * @returns {Array<object>}
 */
export function anfrMastLegend({
  mastRegime = _mastRegime,
  regime = _regime,
  masts = _mastsDrawn,
  mastsUnpublished = _mastsUnpublished,
  mastsClipped = _mastsClipped,
  sectors = _sectorsDrawn,
} = {}) {
  if (regime !== 'supports' || !mastRegime) return [];
  const rows = [{
    label: 'Fût — la hauteur réelle du support',
    color: null,
    count: masts,
    blurb: 'Une seule échelle, et c’est celle du monde : un mètre dessiné vaut un mètre de support, '
      + 'donc le fût rapetisse avec la distance comme le mât lui-même. La taille en pixels du point '
      + 'reste le nombre d’opérateurs et n’est multipliée par rien. '
      + `${fr(ANFR_HEIGHT_PUBLISHED)} des 72 700 supports publient une hauteur (99,24 %).`,
  }];
  for (const tick of MAST_LEGEND_TICKS_M) {
    rows.push({
      label: `${fr(tick)} m`,
      color: MAST_LEGEND_SWATCH,
      glyph: prismHeightGlyph(tick / ANFR_HEIGHT_P95_M),
      blurb: MAST_LEGEND_BLURBS[tick],
    });
  }
  rows.push({
    label: 'sans fût — hauteur non publiée',
    color: null,
    count: mastsUnpublished,
    glyph: prismHatchGlyph(),
    blurb: `${fr(ANFR_HEIGHT_MISSING)} supports du registre, et les ${fr(ANFR_HEIGHT_MISSING)} sont `
      + `${ANFR_HEIGHTLESS_NATURES.join(', ').toLowerCase()} : l’ANFR laisse la case vide parce qu’il `
      + 'n’y a pas de mât à mesurer. Le point reste au sol et aucun fût n’est dessiné — une mesure '
      + `absente ne prend jamais la longueur par défaut. Maximum du registre : ${fr(ANFR_HEIGHT_MAX_M)} m.`,
  });
  if (mastsClipped > 0) {
    rows.push({
      label: 'fûts écrêtés',
      color: null,
      count: mastsClipped,
      blurb: `Plafond de ${fr(MAX_RENDERED_MASTS)} fûts, au-dessus des 1 913 de la vue la plus dense `
        + 'de France : le point est dessiné, le fût non.',
    });
  }
  if (sectors > 0) {
    rows.push({
      label: 'azimuts du support sélectionné',
      color: SELECTED_COLOR,
      count: sectors,
      blurb: 'Un rayon par direction publiée, à la hauteur de fixation de l’antenne. L’azimut n’est '
        + 'pas dans l’observatoire — il vient de la fiche Cartoradio du mât cliqué, un mât à la fois. '
        + `La longueur de ${fr(ANFR_SECTOR_RAY_M)} m est une convention de dessin : ni l’ouverture du `
        + 'lobe ni la portée ne sont publiées.',
    });
  }
  return rows;
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
    // NOT registered with the sprite order, and the reason is the same one
    // `irve-fr` gives for its beams: that registry arbitrates near-plane
    // clamped sprites, and a shaft is depth-bearing geometry that has to sort
    // against the world — against the terrain and the buildings — rather than
    // against other sprites. See the occlusion note in the module header.
    _masts = new Cesium.PolylineCollection();
    _masts.show = false;
    viewer.scene.primitives.add(_masts);
    _sectors = new Cesium.PolylineCollection();
    _sectors.show = false;
    viewer.scene.primitives.add(_sectors);

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
    _mastRegime = false;
    _mastsDrawn = 0;
    _mastsUnpublished = 0;
    _mastsClipped = 0;
    _sectorsDrawn = 0;
    _meshPick = null;

    _overlayHost.setVisible(ANFR_FR_OVERLAY_SOURCE_ID, false);
    restoreSpriteOrder(viewer);
    console.log('[Data:ANFR FR] Initialized');
  },

  enable(viewer) {
    _enabled = true;
    _error = null;
    if (_points) _points.show = true;
    // The shafts and rays stay hidden until a reconcile decides they belong on
    // screen — the camera may well be over the Atlantic when the row is ticked.
    _overlayHost.setVisible(ANFR_FR_OVERLAY_SOURCE_ID, true);
    installClickHandler(viewer);
    registerPickOwner(ANFR_FR_LAYER_ID, (pickedId) => _records.has(pickedId));
    if (!_cameraChangedAttached) {
      viewer.camera.changed.addEventListener(onCameraChanged);
      claimCameraSensitivity(viewer, ANFR_FR_LAYER_ID);
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
    _mastRegime = false;
    clearTimeout(_cameraDebounceTimer);
    _cameraDebounceTimer = null;
    clearSelection();
    _points?.removeAll();
    _masts?.removeAll();
    _sectors?.removeAll();
    _records = new Map();
    _count = 0;
    _inView = 0;
    _mastsDrawn = 0;
    _mastsUnpublished = 0;
    _mastsClipped = 0;
    _sectorsDrawn = 0;
    _overlayHost.setVisible(ANFR_FR_OVERLAY_SOURCE_ID, false);
    if (_clickHandler) {
      _clickHandler.destroy();
      _clickHandler = null;
    }
    if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeyDown);
    unregisterPickOwner(ANFR_FR_LAYER_ID);
    if (_cameraChangedAttached && viewer) {
      viewer.camera.changed.removeEventListener(onCameraChanged);
      releaseCameraSensitivity(viewer, ANFR_FR_LAYER_ID);
      _cameraChangedAttached = false;
    }
    if (_preRenderRemover) {
      _preRenderRemover();
      _preRenderRemover = null;
    }
    if (_points) _points.show = false;
    if (_masts) _masts.show = false;
    if (_sectors) _sectors.show = false;
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
      // The world-space channel, and everything it had to refuse.
      mastRegime: _mastRegime,
      masts: _mastsDrawn,
      mastsUnpublished: _mastsUnpublished,
      mastsClipped: _mastsClipped,
      sectors: _sectorsDrawn,
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
      mastRegime: _mastRegime,
      masts: _mastsDrawn,
      mastsUnpublished: _mastsUnpublished,
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
    legend.push(...anfrMastLegend());
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
    if (_masts) {
      viewer?.scene?.primitives?.remove?.(_masts);
      _masts = null;
    }
    if (_sectors) {
      viewer?.scene?.primitives?.remove?.(_sectors);
      _sectors = null;
    }
    // The memoized materials outlive the collections that used them, and a
    // second `init()` on a new viewer would otherwise hand a fresh context
    // objects built against the old one.
    _mastMaterials.clear();
    _sectorMaterial = null;
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
  mastRegime = false,
} = {}) {
  _viewer = viewer || null;
  _overlayHost = overlayHost || DEFAULT_OVERLAY_HOST;
  _http = http || DEFAULT_HTTP;
  _mesh = mesh;
  _pack = pack;
  _packBoxKey = pack ? 'test' : null;
  _meshPick = meshPick;
  _regime = regime;
  _mastRegime = Boolean(mastRegime) && regime === 'supports';
  _mastsDrawn = 0;
  _mastsUnpublished = 0;
  _mastsClipped = 0;
  _sectorsDrawn = 0;
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
      const heightM = anfrMastHeightM(support);
      _records.set(id, {
        id,
        mesh: false,
        support,
        coSited: 0,
        detail: _details.get(support.id) || null,
        detailPending: false,
        detailError: null,
        point: null,
        position: Cesium.Cartesian3.fromDegrees(
          support.lon, support.lat, POINT_LIFT_M + (heightM || 0),
        ),
        groundPosition: Cesium.Cartesian3.fromDegrees(support.lon, support.lat, POINT_LIFT_M),
        mastHeightM: heightM,
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
  // Counts the shafts the same production walk would, so the row label and the
  // legend a test reads are the ones the drawn map would publish.
  reconcileMasts();
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
  _mastRegime = false;
  _enabled = false;
  _count = 0;
  _inView = 0;
  clearSectors();
  reconcileMasts();
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

/** The shaft/ray tallies the drawing produced, for tests. */
export function _anfrMastTallyForTest() {
  return {
    mastRegime: _mastRegime,
    masts: _mastsDrawn,
    unpublished: _mastsUnpublished,
    clipped: _mastsClipped,
    sectors: _sectorsDrawn,
  };
}

/** Detection candidates, for tests that do not construct a viewer. */
export function _anfrDetectablesForTest(options = {}) {
  return collectDetectableObjects(options);
}

export default anfrFranceLayer;
