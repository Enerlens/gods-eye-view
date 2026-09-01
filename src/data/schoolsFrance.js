/**
 * @module schoolsFrance
 *
 * Every school France has registered, answered at the scale you ask.
 *
 * The source is the MENJ's own **Annuaire de l'éducation**
 * (`fr-en-annuaire-education`, Licence Ouverte 2.0, rebuilt daily), read
 * keylessly through the dev-server proxy. Measured 2026-09-01: 68 939 rows,
 * of which **68 158 are open and carry a coordinate** — the set this layer
 * draws. `schoolsFeed.js` holds the reading of the register and every trap in
 * it; this file is the rendering.
 *
 * ── Three regimes, and what decides between them ────────────────────────────
 * The same ladder the charge-point layer settled on, for the same reason: one
 * answer cannot serve both "which parts of France" and "which building".
 *
 *   national — 96 painted départements. Entered on the view's LATITUDE span
 *              (≥ 9.5°, metropolitan France being 9.8° tall), never on the
 *              larger of the two spans, which on a 16:10 viewport is mostly a
 *              statement about the window's shape.
 *   mesh     — real school positions, spatially thinned to 1 100–2 200 dots.
 *              The middle zooms, where a région fills the screen.
 *   sites    — every school in the box, with its card. Gated by the proxy's
 *              own 0.35° ceiling, which bites before the altitude gate does.
 *
 * ── What the colour means, and what the size means ──────────────────────────
 * Colour is the school LEVEL — école, collège, lycée, adapted, non-teaching —
 * and it is a categorical ladder by age, not a ramp. Size is the ROLL, joined
 * from four separate per-level datasets on the UAI.
 *
 * The two are deliberately different kinds of thing, and the layer never lets
 * the second impersonate the first: **8.3% of teaching establishments have no
 * published roll** (measured — 5 235 of 62 918, mostly SEGPA and SEP sections
 * whose pupils are counted inside their parent school). Those draw at the base
 * size and their card says *effectif non publié*. A zero-sized dot, or a dot
 * silently drawn as if it held no pupils, would turn a gap in the roll files
 * into a claim about a school.
 *
 * ── What the national regime cannot show ────────────────────────────────────
 * The bundled département polygons are metropolitan: 96 features, no overseas
 * geometry. So 2 762 open, geolocated schools — La Réunion's 855, Guadeloupe's
 * 448, and the rest — cannot be painted, and the national card says so rather
 * than letting the choropleth imply France has 65 396 schools. They are all
 * present in the other two regimes, which draw positions and not polygons.
 *
 * A second absence is worth the same honesty and is stated on the same card:
 * **French Polynesia's 311 establishments and Wallis-et-Futuna's 21 carry no
 * coordinate at all** — every single one — as do 49 in New Caledonia. They are
 * 332 of the register's 399 uncoordinated rows, and they are not on this map
 * anywhere. Only 18 uncoordinated rows are metropolitan.
 */

import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import { registerSpriteCollection, restoreSpriteOrder, unregisterSpriteCollection } from './spriteOrder.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import { cachedGroundFloor, warmGroundFloor } from './groundFloor.js';
import { parseDepartements } from './meteoFranceVigilance.js';
import {
  clearOverlaySource,
  hitTestWorldOverlay,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { pickOverlayLabelId } from './overlayLabelPick.js';
import {
  SCHOOLS_MAX_BOX_DEG,
  SCHOOL_LEVELS,
  SCHOOL_LEVEL_LABELS,
  SCHOOL_PRECISION_LABELS,
  schoolDisplayName,
  schoolSiteKey,
} from './schoolsFeed.js';
import {
  meshSchoolId,
  selectSchoolsMesh,
  MESH_LAT,
  MESH_LEVEL,
  MESH_LON,
  MESH_PUPILS,
} from './schoolsMesh.js';

export const SCHOOLS_FR_LAYER_ID = 'schools-fr';

export const SCHOOLS_FR_OVERLAY_SOURCE_ID = 'schools-fr-selected';
export const SCHOOLS_FR_OVERLAY_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 1,
  moving: false,
});
export const SCHOOLS_FR_LABEL_SOURCE_ID = 'schools-fr-departements';
/** Ambient-label entry-id prefix — the click surface the département NAME provides. */
export const SCHOOLS_FR_DEP_LABEL_PREFIX = 'schools-fr:dep:';
export const SCHOOLS_FR_LABEL_COHORT_LIMIT = 14;
export const SCHOOLS_FR_LABEL_COLLISION_CAPACITY = 12;

const DEPARTEMENTS_URL = new URL(
  './local_data/france_departements/departements.geojson',
  import.meta.url,
).href;

// --- Activation / load gating ----------------------------------------------
/**
 * Altitude (m) below which the layer draws individual schools. A school is a
 * street-scale object and the proxy refuses a box wider than 0.35° anyway.
 */
const SITE_ALTITUDE_M = 45_000;
const SITE_ENTER_ALTITUDE_M = SITE_ALTITUDE_M - 3_000;
const SITE_EXIT_ALTITUDE_M = SITE_ALTITUDE_M + 3_000;
/**
 * View LATITUDE span (degrees) at or above which the choropleth answers.
 * Metropolitan France is 9.8° tall. The exit threshold is lower than the entry
 * one so a camera resting on the boundary does not swap the whole map back and
 * forth on sub-pixel drift.
 */
const NATIONAL_ENTER_SPAN_DEG = 9.5;
const NATIONAL_EXIT_SPAN_DEG = 8;
const CAMERA_DEBOUNCE_MS = 450;
/**
 * Poll cadence (ms). Long on purpose: the register is rebuilt once a day, so
 * anything faster re-asks a question whose answer cannot have changed. The
 * camera, not the clock, drives this layer.
 */
const POLL_INTERVAL_MS = 30 * 60_000;
const REQUEST_TIMEOUT_MS = 45_000;
const NATIONAL_TIMEOUT_MS = 120_000;
/** Hard cap on rendered schools, independent of what the proxy returns. */
const MAX_RENDERED_SITES = 6_000;
/**
 * Half-width (degrees, ~550 m) of the box a MAILLAGE click asks the register
 * about.
 *
 * The national pack ships no names — carrying them would take it from 1.66 MB
 * to 5.42 MB for two fields the maillage never draws (see `schoolsMesh.js`).
 * But a card that says "Établissement" at one altitude and "Collège Jean
 * Moulin" at the next is the pack's wire budget leaking into what a reader is
 * told, so the name is fetched for the ONE dot that was clicked instead. The
 * proxy snaps the box outward onto its 0.02° cache grid anyway, so a second
 * click on a neighbouring school is a cache hit both here and there.
 */
const MESH_LOOKUP_PAD_DEG = 0.005;
/** A mesh lookup is one click's worth of patience, not a viewport's. */
const MESH_LOOKUP_TIMEOUT_MS = 15_000;
const POINT_LIFT_M = 2.5;
const GROUND_WARM_LIMIT = 600;

// --- Presentation -----------------------------------------------------------
/**
 * The level ladder, young to old, then the two that are not a level at all.
 *
 * A categorical scale and not a ramp — a collège is not "more" than an école —
 * so the four teaching bands are four distinguishable hues rather than four
 * steps of one. They run cool-to-warm with age purely so the eye can order
 * them without the legend, which is the one ordinal thing about a school.
 *
 * The family is chosen to collide with nothing else on this globe: not the
 * charge-point power ramp (blue→red), not Mix élec's teal/amber, not
 * Vigilance's green→red. `autre` is deliberately outside the family, in
 * neutral slate — a rectorat is not a school and should not read as one.
 */
const LEVEL_COLORS = Object.freeze({
  ecole: '#38d9a9',
  college: '#4dabf7',
  lycee: '#f783ac',
  adapte: '#ffa94d',
  autre: '#7c8899',
});

/**
 * Choropleth ramp, low to high — a sequential green scale.
 *
 * Distinct from the level hues above and from every other French layer's ramp:
 * the two schools regimes never draw at the same time, but a reader who zooms
 * out must not carry a category's meaning into a quantity's.
 */
const DEPARTEMENT_COLORS = Object.freeze([
  '#0b3d2e', '#125c44', '#1a7f5a', '#27a373', '#4ec99b', '#8fe8c4',
]);
/** Fill alpha per bin — density reads as weight as well as hue. */
const DEPARTEMENT_ALPHA = Object.freeze([0.34, 0.40, 0.46, 0.53, 0.60, 0.68]);
const SELECTED_COLOR = '#00ffff';
const OUTLINE_COLOR = Cesium.Color.BLACK.withAlpha(0.35);
const SITE_POINT_MIN_PX = 5;
const SITE_POINT_MAX_PX = 15;
const SELECTED_POINT_PX = 18;
/**
 * Mesh dots are smaller and flatter than exact sites. They stand for a sampled
 * network rather than a counted inventory, and a mesh dot the size of a site
 * dot would invite the eye to read one as the other.
 */
const MESH_POINT_MIN_PX = 3.4;
const MESH_POINT_MAX_PX = 9;

/** One-line explanations behind each level swatch. */
const LEVEL_BLURBS = Object.freeze({
  ecole: 'Maternelle et élémentaire — 71% du registre, et la texture réelle du pays.',
  college: 'Collèges publics et privés, le maillage de secteur le plus régulier de France.',
  lycee: 'Lycées généraux, technologiques, professionnels et polyvalents.',
  adapte: 'EREA et établissements médico-sociaux — la scolarisation adaptée.',
  autre: 'Rectorats, DSDEN et CIO. Dans le registre, mais ce ne sont pas des écoles.',
});

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
let _summary = null;
let _regime = 'national';
let _lastBox = null;
let _inFlight = null;
let _requestGeneration = 0;

let _national = null;
let _nationalPromise = null;
let _nationalError = null;
let _nationalPainted = false;
let _depDataSource = null;
let _depEntities = new Map();
let _depMeta = new Map();
let _depShapesPromise = null;

let _mesh = null;
let _meshPromise = null;
let _meshError = null;
let _meshPick = null;
/**
 * Coordinate id → the register's answer for that dot.
 *
 * `'pending'` while a lookup is in flight, a projected site once it lands,
 * `null` when the register has nothing there. Session-scoped and never
 * invalidated: the annuaire is rebuilt daily and a name does not move.
 */
let _meshNames = new Map();

// --- Colour and size --------------------------------------------------------

/** Hex for one level. Anything unrecognised gets the neutral slate. */
export function schoolLevelColor(level) {
  return LEVEL_COLORS[level] || LEVEL_COLORS.autre;
}

/** French label for one level. */
export function schoolLevelLabel(level) {
  return SCHOOL_LEVEL_LABELS[level] || SCHOOL_LEVEL_LABELS.autre;
}

function departementBinIndex(bin) {
  const index = Number(bin);
  if (!Number.isFinite(index) || index < 0) return -1;
  return Math.min(DEPARTEMENT_COLORS.length - 1, Math.floor(index));
}

/** Fill colour for one choropleth bin, or null for a département with none. */
export function schoolsDepartementColor(bin) {
  const index = departementBinIndex(bin);
  return index < 0 ? null : DEPARTEMENT_COLORS[index];
}

/** Fill alpha for one choropleth bin. */
export function schoolsDepartementAlpha(bin) {
  const index = departementBinIndex(bin);
  return index < 0 ? 0 : DEPARTEMENT_ALPHA[index];
}

/**
 * Legend labels for the quantile ramp, built from the measured thresholds.
 * @param {Array<number>} thresholds
 * @returns {Array<string>}
 */
export function schoolsDepartementBinLabels(thresholds) {
  const bounds = Array.isArray(thresholds) ? thresholds : [];
  const labels = [];
  let previous = 0;
  for (const bound of bounds) {
    labels.push(previous + 1 === bound ? `${bound}` : `${previous + 1}–${bound}`);
    previous = bound;
  }
  labels.push(`> ${previous}`);
  return labels;
}

/**
 * Dot size for one school, by roll.
 *
 * Square-rooted and capped at 2 000 pupils, so a 1 600-pupil lycée is bigger
 * than a 60-pupil village school without being twenty-seven times the area —
 * the eye reads area, and a linear scale would make the rural half of France
 * invisible. A school with NO published roll draws at the minimum, which is
 * also what a 1-pupil school would draw at; the card is what distinguishes
 * "small" from "not published", because a dot cannot.
 */
export function schoolPointSize(pupils) {
  const count = Number(pupils);
  if (!Number.isFinite(count) || count <= 0) return SITE_POINT_MIN_PX;
  return Math.min(SITE_POINT_MAX_PX, SITE_POINT_MIN_PX + Math.sqrt(Math.min(count, 2000)) * 0.24);
}

/** Pixel size for a mesh dot — smaller than an exact site, and flatter. */
export function schoolsMeshPointSize(pupils) {
  const count = Number(pupils);
  if (!Number.isFinite(count) || count <= 0) return MESH_POINT_MIN_PX;
  return Math.min(MESH_POINT_MAX_PX, MESH_POINT_MIN_PX + Math.sqrt(Math.min(count, 2000)) * 0.13);
}

// --- Camera -----------------------------------------------------------------

/**
 * Camera view box, clamped to the proxy's ceiling. A wider view returns null
 * and the layer falls back to the maillage rather than asking for a box the
 * proxy would refuse.
 */
export function cameraSchoolsBox(viewer) {
  const rectangle = viewer?.camera?.computeViewRectangle?.();
  if (!rectangle) return null;
  const south = Cesium.Math.toDegrees(rectangle.south);
  const north = Cesium.Math.toDegrees(rectangle.north);
  const west = Cesium.Math.toDegrees(rectangle.west);
  const east = Cesium.Math.toDegrees(rectangle.east);
  if (![south, west, north, east].every(Number.isFinite)) return null;
  if (west >= east || south >= north) return null;
  if (north - south > SCHOOLS_MAX_BOX_DEG || east - west > SCHOOLS_MAX_BOX_DEG) return null;
  return { south, west, north, east };
}

/**
 * View box for the mesh regime — the camera rectangle, padded.
 *
 * No ceiling here: the mesh is picked from a set the client already holds, so
 * a wide view costs nothing upstream. The padding means a dot does not pop
 * into existence exactly at the screen edge as you pan.
 */
export function cameraSchoolsMeshBox(viewer, padFraction = 0.12) {
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
 * the limb and Cesium can give no rectangle at all.
 */
export function schoolsViewSpanDeg(viewer) {
  const rectangle = viewer?.camera?.computeViewRectangle?.();
  if (!rectangle) return { lat: Infinity, max: Infinity };
  const lat = Cesium.Math.toDegrees(rectangle.north - rectangle.south);
  const lon = Cesium.Math.toDegrees(rectangle.east - rectangle.west);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { lat: Infinity, max: Infinity };
  return { lat, max: Math.max(lat, lon) };
}

/** Which regime the camera is in, with hysteresis at both boundaries. */
function updateRegime(viewer) {
  const span = schoolsViewSpanDeg(viewer);
  const altitude = cameraAltitudeM(viewer);

  if (_regime === 'national') {
    if (span.lat >= NATIONAL_EXIT_SPAN_DEG) return _regime;
  } else if (span.lat >= NATIONAL_ENTER_SPAN_DEG) {
    _regime = 'national';
    return _regime;
  }

  if (_regime === 'sites') {
    if (altitude > SITE_EXIT_ALTITUDE_M || span.max > SCHOOLS_MAX_BOX_DEG) _regime = 'mesh';
  } else if (altitude < SITE_ENTER_ALTITUDE_M && span.max <= SCHOOLS_MAX_BOX_DEG) {
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

// --- Cards ------------------------------------------------------------------

/**
 * Card copy for one selected school. Every line is a published value or a
 * stated absence of one; nothing here is inferred.
 */
export function buildSchoolSelectionLabel(record) {
  const site = record?.site || {};
  const details = [];
  const title = site.name ? schoolDisplayName(site) : (site.commune || 'Établissement scolaire');

  const kind = [site.nature || schoolLevelLabel(site.level)];
  if (site.sector === 'public') kind.push('public');
  else if (site.sector === 'prive') kind.push('privé');
  details.push(kind.join(' · '));

  // The roll is the one number a reader will treat as the headline, so its
  // absence has to be as loud as its presence. "effectif non publié" is not
  // the same claim as "0 élève", and 8.3% of teaching establishments are in
  // the first category.
  details.push(Number.isFinite(site.enrolled) && site.enrolled > 0
    ? `${fr(site.enrolled)} élèves — rentrée 2025`
    : 'Effectif non publié pour cet UAI');

  if (site.ep) details.push(`Éducation prioritaire : ${site.ep}`);

  const services = [];
  if (site.services?.restauration) services.push('restauration');
  if (site.services?.hebergement) services.push('internat');
  if (site.services?.ulis) services.push('ULIS');
  if (site.services?.segpa) services.push('SEGPA');
  if (site.services?.apprentissage) services.push('apprentissage');
  if (services.length) details.push(services.join(' · '));

  const where = [site.address, site.postal || site.commune].filter(Boolean).join(', ');
  if (where) details.push(where);

  // A coordinate geocoded only to the commune is not where the school is, and
  // the card is the only place that can say so.
  if (site.precision === 'commune') {
    details.push(`⚠ Position : ${SCHOOL_PRECISION_LABELS.commune}`);
  } else if (site.precision === 'inconnue') {
    details.push(`Position : ${SCHOOL_PRECISION_LABELS.inconnue}`);
  }

  // Two dots at one address is the register's unit showing through, not a
  // duplicate. Naming the parent is what makes it legible.
  if (site.sharing > 0) {
    details.push(site.sharing === 1
      ? '1 autre UAI enregistré à cette position'
      : `${fr(site.sharing)} autres UAI enregistrés à cette position`);
  }
  if (site.motherUai) details.push(`Rattaché à l'UAI ${site.motherUai}`);
  if (site.uai) details.push(`UAI ${site.uai}`);

  return [title, ...details].join('\n');
}

/**
 * Card copy for a school picked in the MAILLAGE.
 *
 * A mesh record carries four numbers and no name, because the national pack
 * ships no names. It used to stop there and title the card "Établissement",
 * which made the ONE thing a reader wants — which school is this — a property
 * of how far they had zoomed. So a click now asks the register for that single
 * coordinate (`resolveMeshSite`), and this function reports whichever of the
 * three states the answer is in:
 *
 *   resolved  → the full card, identical to the one the exact regime draws;
 *   pending   → the tuple's own facts, and that the name is being fetched;
 *   refused   → the tuple's own facts, and that the lookup failed.
 *
 * The middle and last states are still honest cards, not placeholders: the
 * level and the roll come from the pack and are true whether or not the name
 * ever arrives.
 */
export function buildSchoolsMeshLabel(record) {
  if (record?.resolved) return buildSchoolSelectionLabel({ site: record.resolved });

  const site = record?.site || {};
  const details = [schoolLevelLabel(site.level)];
  details.push(Number.isFinite(site.enrolled) && site.enrolled > 0
    ? `${fr(site.enrolled)} élèves — rentrée 2025`
    : 'Effectif non publié pour cet UAI');
  details.push(record?.resolving
    ? 'Position réelle, échantillonnée — lecture du nom dans le registre…'
    : 'Position réelle, échantillonnée — nom introuvable dans le registre');
  return ['Établissement', ...details].join('\n');
}

/** Card copy for one département at national altitude. */
export function buildSchoolsDepartementLabel(row) {
  const details = [];
  details.push(`${fr(row.schools)} établissements`);
  if (row.pupils > 0) details.push(`${fr(row.pupils)} élèves — rentrée 2025`);
  const mix = [];
  if (row.public > 0) mix.push(`${fr(row.public)} public`);
  if (row.prive > 0) mix.push(`${fr(row.prive)} privé`);
  if (mix.length) details.push(mix.join(' · '));
  if (row.ep > 0) details.push(`${fr(row.ep)} en éducation prioritaire`);
  if (row.per1000Km2 > 0) {
    details.push(`${row.per1000Km2.toFixed(1)} pour 1 000 km²`);
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

/** Protected selected-school entry for the shared overlay host. */
export function createSchoolSelectedOverlayEntry(record) {
  const position = record?.position;
  if (!record?.id || !position) return null;
  const copy = record.mesh
    ? buildSchoolsMeshLabel(record)
    : buildSchoolSelectionLabel(record);
  return selectedOverlayEntry(record.id, position, copy);
}

/** Ambient label for one département at national altitude. */
export function createSchoolsDepartementOverlayEntry(row, position) {
  return {
    id: `${SCHOOLS_FR_DEP_LABEL_PREFIX}${row.code}`,
    position,
    variant: 'label',
    title: `${row.name} · ${fr(row.schools)}`,
    accent: schoolsDepartementColor(row.bin) || LEVEL_COLORS.autre,
    priority: Number(row.schools) || 0,
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
export function selectSchoolsLabelCohort(entries, limit = SCHOOLS_FR_LABEL_COHORT_LIMIT) {
  const cap = Math.max(0, Math.min(SCHOOLS_FR_LABEL_COHORT_LIMIT, Math.floor(Number(limit) || 0)));
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

function highlightSelectedDepartement() {
  if (!_selectedId?.startsWith('dep:')) return;
  const highlight = new Cesium.ColorMaterialProperty(
    Cesium.Color.fromCssColorString(SELECTED_COLOR).withAlpha(0.42),
  );
  for (const entity of _depEntities.get(_selectedId.slice(4)) || []) {
    if (entity.polygon) entity.polygon.material = highlight;
  }
}

function dropDepartementSelection() {
  if (_selectedId?.startsWith?.('dep:')) {
    _selectedId = null;
    _overlayHost.clearSource(SCHOOLS_FR_OVERLAY_SOURCE_ID);
  }
}

function clearSelection() {
  if (_selectedId?.startsWith?.('dep:')) {
    repaintDepartements();
  } else if (_selectedId) {
    restoreRecordStyle(_records.get(_selectedId));
  }
  _selectedId = null;
  _overlayHost.clearSource(SCHOOLS_FR_OVERLAY_SOURCE_ID);
  governorRequestRender('schools-fr-deselect');
}

/**
 * Choose which of the register's rows IS the dot that was clicked.
 *
 * A mesh id is a coordinate, and a coordinate is not a UAI: SEGPA and SEP
 * sections sit at the exact address of the collège or lycée that contains them
 * (2 212 of them nationally — `schoolsFeed.js`, Trap 1), so a lookup can come
 * back with two or three establishments on the same 5-decimal point.
 *
 * The tuple's own level breaks the tie, because that is the one thing the mesh
 * dot already claimed to be and the reader has been looking at. Failing that,
 * the largest roll — the parent establishment rather than the section inside
 * it. Nothing here invents a preference the pack did not already express.
 *
 * @param {Array<object>} sites Register rows for the lookup box.
 * @param {string} id The clicked dot's coordinate id.
 * @param {?string} level The level the mesh tuple carried.
 * @returns {{site: ?object, sharing: number}} `sharing` counts the OTHER UAIs
 *   at the same coordinate, so the card can say why two dots sit on one roof.
 */
export function pickMeshSite(sites, id, level) {
  const here = (Array.isArray(sites) ? sites : []).filter(
    (site) => Number.isFinite(site?.lat) && Number.isFinite(site?.lon)
      && schoolSiteKey(site.lat, site.lon) === id,
  );
  if (!here.length) return { site: null, sharing: 0 };
  const sameLevel = here.filter((site) => site.level === level);
  const pool = sameLevel.length ? sameLevel : here;
  const best = pool.slice().sort(
    (a, b) => (Number(b.enrolled) || 0) - (Number(a.enrolled) || 0)
      || String(a.uai || a.id).localeCompare(String(b.uai || b.id)),
  )[0];
  return { site: best, sharing: here.length - 1 };
}

/**
 * Ask the register for the establishment under one mesh dot.
 *
 * One request per clicked dot, memoized for the session — the annuaire is
 * rebuilt daily and a school's name does not move between two clicks. The
 * request is deliberately NOT abortable on camera movement: the reader asked
 * for this name, and a pan while it is in flight should not silently cancel
 * the answer to their question.
 * @param {object} record The mesh record that was selected.
 */
async function resolveMeshSite(record) {
  const id = record?.id;
  if (!id || !record.mesh) return;

  const cached = _meshNames.get(id);
  if (cached === 'pending') return;
  if (cached !== undefined) {
    record.resolved = cached;
    record.resolving = false;
    return;
  }

  _meshNames.set(id, 'pending');
  record.resolving = true;
  repaintSelectedCard(id);

  const { lat, lon } = record.site || {};
  const params = new URLSearchParams({
    south: (lat - MESH_LOOKUP_PAD_DEG).toFixed(5),
    west: (lon - MESH_LOOKUP_PAD_DEG).toFixed(5),
    north: (lat + MESH_LOOKUP_PAD_DEG).toFixed(5),
    east: (lon + MESH_LOOKUP_PAD_DEG).toFixed(5),
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MESH_LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(`/api/schools-fr/sites?${params}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const { site, sharing } = pickMeshSite(payload?.sites, id, record.site?.level);
    // A lookup that found nothing is CACHED as nothing. The alternative is a
    // fresh round trip on every click of a dot the register cannot name — the
    // same answer, paid for again each time.
    const resolved = site ? { ...site, sharing } : null;
    _meshNames.set(id, resolved);
    record.resolved = resolved;
  } catch (error) {
    // Not cached: a timeout or an offline moment is not the register's answer,
    // and the next click should be allowed to ask again.
    _meshNames.delete(id);
    if (error?.name !== 'AbortError') {
      console.warn('[Data:Schools-FR] mesh name lookup failed:', error?.message || error);
    }
  } finally {
    clearTimeout(timer);
    record.resolving = false;
    repaintSelectedCard(id);
  }
}

/** Redraw the selected card in place, if `id` is still what is selected. */
function repaintSelectedCard(id) {
  if (_selectedId !== id) return;
  const entry = createSchoolSelectedOverlayEntry(_records.get(id));
  if (entry) {
    _overlayHost.setEntries(
      SCHOOLS_FR_OVERLAY_SOURCE_ID,
      [entry],
      SCHOOLS_FR_OVERLAY_SOURCE_OPTIONS,
    );
  }
  governorRequestRender('schools-fr-name');
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
  // A maillage dot knows its level and its roll but not its name — ask the
  // register for it, and paint the card twice rather than making the reader
  // zoom in to find out what they clicked on.
  if (record.mesh && !record.resolved) void resolveMeshSite(record);
  const entry = createSchoolSelectedOverlayEntry(record);
  if (entry) {
    _overlayHost.setEntries(
      SCHOOLS_FR_OVERLAY_SOURCE_ID,
      [entry],
      SCHOOLS_FR_OVERLAY_SOURCE_OPTIONS,
    );
  }
  governorRequestRender('schools-fr-select');
}

function selectDepartement(code) {
  const row = (_national?.departements || []).find((entry) => entry.code === code);
  if (!row || !(row.schools > 0)) return;
  if (_selectedId && _selectedId !== `dep:${code}`) clearSelection();
  _selectedId = `dep:${code}`;
  highlightSelectedDepartement();
  const anchor = _depMeta.get(code)?.anchor;
  if (anchor) {
    const entry = selectedOverlayEntry(
      `schools-fr:dep-card:${code}`,
      Cesium.Cartesian3.fromDegrees(anchor[0], anchor[1]),
      buildSchoolsDepartementLabel(row),
    );
    _overlayHost.setEntries(
      SCHOOLS_FR_OVERLAY_SOURCE_ID,
      [entry],
      SCHOOLS_FR_OVERLAY_SOURCE_OPTIONS,
    );
  }
  governorRequestRender('schools-fr-select-dep');
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
      // The label plane the depth buffer knows nothing about, resolved after
      // the polygon pick. At national altitude the name floats clear of the
      // shape it belongs to, so it is often the only thing under the cursor.
      const labelled = pickOverlayLabelId(movement.position, {
        sourceId: SCHOOLS_FR_LABEL_SOURCE_ID,
        prefix: SCHOOLS_FR_DEP_LABEL_PREFIX,
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

/** Keep the selected card pinned to its dot as the camera moves. */
function onPreRender() {
  if (!_enabled || !_selectedId || _selectedId.startsWith('dep:')) return;
  const record = _records.get(_selectedId);
  if (!record) return;
  const entry = createSchoolSelectedOverlayEntry(record);
  if (entry) {
    _overlayHost.setEntries(
      SCHOOLS_FR_OVERLAY_SOURCE_ID,
      [entry],
      SCHOOLS_FR_OVERLAY_SOURCE_OPTIONS,
    );
  }
}

// --- National regime --------------------------------------------------------

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
    source.name = 'Établissements scolaires — implantation par département';
    source.show = _enabled;
    for (const entity of source.entities.values) {
      const code = String(entity.properties?.code?.getValue?.() ?? '').trim();
      if (!entity.polygon || !code) {
        entity.show = false;
        continue;
      }
      entity.polygon.outline = false;
      entity.polygon.classificationType = Cesium.ClassificationType.BOTH;
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

function repaintDepartements() {
  if (!_national) return;
  const materials = new Map();
  const painted = new Set();
  for (const row of _national.departements || []) {
    if (!(row.schools > 0)) continue;
    const color = schoolsDepartementColor(row.bin);
    if (!color) continue;
    let material = materials.get(row.bin);
    if (!material) {
      material = new Cesium.ColorMaterialProperty(
        Cesium.Color.fromCssColorString(color).withAlpha(schoolsDepartementAlpha(row.bin)),
      );
      materials.set(row.bin, material);
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
  // A département the rollup does not cover is drawn as absence rather than as
  // the bottom of the scale.
  for (const [code, parts] of _depEntities) {
    if (painted.has(code)) continue;
    for (const entity of parts) entity.show = false;
  }
  highlightSelectedDepartement();
  _viewer?.scene?.requestRender?.();
}

function publishDepartementOverlay() {
  if (!_enabled || _regime !== 'national') {
    _overlayHost.clearSource(SCHOOLS_FR_LABEL_SOURCE_ID);
    return;
  }
  const entries = [];
  for (const row of _national?.departements || []) {
    if (!(row.schools > 0)) continue;
    const anchor = _depMeta.get(row.code)?.anchor;
    if (!anchor) continue;
    entries.push(createSchoolsDepartementOverlayEntry(
      row,
      Cesium.Cartesian3.fromDegrees(anchor[0], anchor[1]),
    ));
  }
  _overlayHost.setEntries(SCHOOLS_FR_LABEL_SOURCE_ID, selectSchoolsLabelCohort(entries), {
    cohortLimit: SCHOOLS_FR_LABEL_COHORT_LIMIT,
    collisionCapacity: SCHOOLS_FR_LABEL_COLLISION_CAPACITY,
    moving: false,
  });
}

async function ensureNational() {
  if (_national) return _national;
  if (_nationalPromise) return _nationalPromise;
  _nationalPromise = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NATIONAL_TIMEOUT_MS);
    try {
      const response = await fetch('/api/schools-fr/departements', { signal: controller.signal });
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
      console.warn('[Data:Schools-FR] national rollup failed:', error?.message || error);
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
  _overlayHost.clearSource(SCHOOLS_FR_LABEL_SOURCE_ID);
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
    console.warn('[Data:Schools-FR] département polygons failed:', error?.message || error);
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
  governorRequestRender('schools-fr-national');
}

// --- Mesh regime ------------------------------------------------------------

async function ensureMesh() {
  if (_mesh) return _mesh;
  if (_meshPromise) return _meshPromise;
  _meshPromise = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NATIONAL_TIMEOUT_MS);
    try {
      const response = await fetch('/api/schools-fr/mesh', { signal: controller.signal });
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
      console.warn('[Data:Schools-FR] national mesh failed:', error?.message || error);
      _meshError = error?.message || 'national mesh unavailable';
    }
    return null;
  });
  return _meshPromise;
}

/**
 * Draw a thinned selection of real school positions for the current view.
 *
 * Re-picked on every camera settle rather than cached: the pick is a function
 * of the box, and re-running it over 68 158 tuples costs a few milliseconds
 * against a round trip that would cost a few hundred.
 */
function reconcileMesh(box) {
  const pick = selectSchoolsMesh(_mesh?.sites, { box });
  _meshPick = pick;

  clearSelection();
  _points.removeAll();
  _records.clear();

  for (const site of pick.picked) {
    if (_records.size >= MAX_RENDERED_SITES) break;
    const lat = site[MESH_LAT];
    const lon = site[MESH_LON];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const id = meshSchoolId(site);
    if (_records.has(id)) continue;
    const level = SCHOOL_LEVELS[site[MESH_LEVEL]] || 'autre';
    const color = schoolLevelColor(level);
    const pupils = Number(site[MESH_PUPILS]) || 0;
    const size = schoolsMeshPointSize(pupils);
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
    // A dot this session has already named keeps its name across pans and
    // zooms — the lookup is memoized, so re-entering a city redraws the cards
    // it earned rather than re-asking for them.
    const known = _meshNames.get(id);
    _records.set(id, {
      id,
      // A mesh record carries only what the national pack knows: no name, no
      // UAI. The flag is what lets the card say so instead of implying the
      // rest is absent — and what sends a click to the register for the rest.
      mesh: true,
      resolved: known && known !== 'pending' ? known : null,
      resolving: known === 'pending',
      site: { id, lat, lon, level, enrolled: pupils > 0 ? pupils : null },
      point,
      position,
      baseColor: color,
      baseSize: size,
    });
  }
  _count = _records.size;
  governorRequestRender('schools-fr-mesh');
}

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
    const color = schoolLevelColor(site.level);
    const size = schoolPointSize(site.enrolled);
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
    _records.set(id, { id, site, point, position, baseColor: color, baseSize: size });
    warm.push(site);
  }

  _count = _records.size;
  warmGroundFloor(warm.slice(0, GROUND_WARM_LIMIT));
  governorRequestRender('schools-fr-reconcile');
}

function clearSites() {
  if (_selectedId && !_selectedId.startsWith('dep:')) clearSelection();
  if (_points) _points.removeAll();
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
    await loadMesh(cameraSchoolsMeshBox(_viewer));
    return;
  }

  const box = cameraSchoolsBox(_viewer);
  if (!box) {
    // Inside the altitude gate but looking at more than the proxy will answer
    // — an oblique horizon shot. The maillage is the honest fallback, not an
    // empty map.
    _regime = 'mesh';
    await loadMesh(cameraSchoolsMeshBox(_viewer));
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
    const response = await fetch(`/api/schools-fr/sites?${params}`, { signal: controller.signal });
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
    _lastUpdate = Number(payload.fetchedAt) || Date.now();
    _status = _count > 0 ? 'ready' : 'empty';
    _error = null;
  } catch (error) {
    if (error?.name === 'AbortError') return;
    console.warn('[Data:Schools-FR] viewport failed:', error?.message || error);
    _error = error?.message || 'viewport unavailable';
    _status = 'error';
  } finally {
    clearTimeout(timer);
    if (_inFlight === controller) _inFlight = null;
    _loading = false;
  }
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
    result.push({
      position: record.position,
      sourceId: record.id,
      id: schoolCalloutText(record),
      type: 'School',
      skipLabel: record.id === _selectedId,
    });
    if (result.length >= maxCount) break;
  }
  return result;
}

/**
 * The one line a DETECT callout gets for a school.
 *
 * The name first, because that is what identifies the thing on screen — a
 * reader scanning a district wants "Collège Jean Moulin", not "412 élèves",
 * which names nothing and repeats a number the dot's size already carries.
 * Where no name is known (an un-clicked maillage dot) the level is the honest
 * fallback: it is what the pack actually shipped.
 * @param {object} record
 * @returns {string}
 */
export function schoolCalloutText(record) {
  const site = record?.resolved || record?.site || {};
  if (site.name) return schoolDisplayName(site);
  const pupils = Number(site.enrolled) || 0;
  return pupils > 0
    ? `${schoolLevelLabel(site.level)} · ${fr(pupils)} élèves`
    : schoolLevelLabel(site.level);
}

/** One line under the layer's toggle: what this view actually contains. */
export function buildSchoolsLoadingLabel({
  regime = _regime,
  status = _status,
  loading = _loading,
  count = _count,
  summary = _summary,
  national = _national,
  meshPick = _meshPick,
} = {}) {
  if (regime === 'mesh') {
    if (loading) return 'lecture du maillage national...';
    if (status === 'error') return '';
    if (!meshPick) return '';
    if (!meshPick.inBox) return 'aucun établissement dans cette vue';
    // Naming both numbers is the whole contract of this regime: a thinned map
    // that does not say it is thinned claims France has 1 100 schools.
    return meshPick.thinned
      ? `${fr(meshPick.picked.length)} tracés sur ${fr(meshPick.inBox)} dans la vue — échantillon spatial`
      : `${fr(meshPick.picked.length)} établissements dans la vue`;
  }
  if (regime === 'national') {
    if (loading) return 'lecture du registre national...';
    if (status === 'error') return '';
    if (!national) return '';
    const parts = [`${fr(national.assigned)} établissements sur ${fr(national.painted)} départements`];
    // The choropleth's own blind spot, stated where the choropleth is read.
    if (national.unassigned > 0) {
      parts.push(`${fr(national.unassigned)} hors métropole non cartographiés`);
    }
    return parts.join(' · ');
  }
  if (loading) return 'lecture du registre...';
  if (status === 'error') return '';
  if (!count) return 'aucun établissement dans cette vue';
  const parts = [`${fr(count)} établissements`];
  if (summary?.pupils > 0) parts.push(`${fr(summary.pupils)} élèves`);
  if (summary && summary.complete === false) parts.push('réponse tronquée en amont');
  return parts.join(' · ');
}

// --- Layer ------------------------------------------------------------------

const schoolsFranceLayer = {
  id: SCHOOLS_FR_LAYER_ID,
  name: 'Établissements scolaires (FR)',
  icon: '🎓',
  source: 'Annuaire de l’éducation — MENJ',
  updateInterval: POLL_INTERVAL_MS,

  init(viewer) {
    _viewer = viewer;
    _points = new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT });
    _points.show = false;
    viewer.scene.primitives.add(_points);
    registerSpriteCollection(SCHOOLS_FR_LAYER_ID, _points);

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
    _meshNames = new Map();
    _lastBox = null;

    _overlayHost.setVisible(SCHOOLS_FR_OVERLAY_SOURCE_ID, false);
    _overlayHost.setVisible(SCHOOLS_FR_LABEL_SOURCE_ID, false);
    restoreSpriteOrder(viewer);
  },

  enable(viewer) {
    _enabled = true;
    _error = null;
    _points.show = true;
    if (_depDataSource) _depDataSource.show = true;
    _overlayHost.setVisible(SCHOOLS_FR_OVERLAY_SOURCE_ID, true);
    _overlayHost.setVisible(SCHOOLS_FR_LABEL_SOURCE_ID, true);
    installClickHandler(viewer);
    registerPickOwner(SCHOOLS_FR_LAYER_ID, (pickedId) => _records.has(pickedId));

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
    _overlayHost.setVisible(SCHOOLS_FR_OVERLAY_SOURCE_ID, false);
    _overlayHost.setVisible(SCHOOLS_FR_LABEL_SOURCE_ID, false);

    if (_clickHandler) {
      _clickHandler.destroy();
      _clickHandler = null;
    }
    document.removeEventListener('keydown', onKeyDown);
    unregisterPickOwner(SCHOOLS_FR_LAYER_ID);

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
    const label = buildSchoolsLoadingLabel();
    if (label) stats.loadingLabel = label;
    if (_regime === 'national' ? _national?.stale : _summary?.stale) stats.stale = true;
    if (_error) stats.error = _error;
    return stats;
  },

  /** Viewport provenance for the attribution popover and analyst surfaces. */
  getViewportSummary() {
    return _summary ? { ..._summary } : null;
  },

  /** What the maillage actually drew, against what was in view. */
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
   * screen, never both.
   */
  getRowControls() {
    if (_regime === 'national') {
      if (!_national) return { chips: [], legend: [] };
      const labels = schoolsDepartementBinLabels(_national.thresholds);
      const counts = new Array(labels.length).fill(0);
      for (const row of _national.departements || []) {
        if (row.bin >= 0 && row.bin < counts.length) counts[row.bin] += 1;
      }
      const legend = labels.map((label, bin) => ({
        label: `${label} établissements`,
        color: schoolsDepartementColor(bin),
        count: counts[bin],
        blurb: bin === labels.length - 1
          ? 'Départements du sixième supérieur. Le remplissage est un compte absolu, donc la fiche donne aussi le taux pour 1 000 km².'
          : 'Un sixième des 96 départements. Bins par quantile, parce que sur une échelle linéaire le Nord écrase tout le reste.',
      })).filter((row) => row.count > 0);
      return { chips: [], legend };
    }
    const tally = new Map();
    for (const record of _records.values()) {
      const level = record.site?.level;
      if (level) tally.set(level, (tally.get(level) || 0) + 1);
    }
    const meshRegime = _regime === 'mesh';
    const legend = SCHOOL_LEVELS
      .filter((level) => tally.get(level) > 0)
      .map((level) => ({
        label: schoolLevelLabel(level),
        color: schoolLevelColor(level),
        count: tally.get(level),
        blurb: meshRegime
          // Naming the sample is the point: this mix is what the thinning
          // drew, close to the real one but not it. See `schoolsMesh.js`.
          ? `${LEVEL_BLURBS[level]} Compté sur le maillage échantillonné — un échantillon du mélange en vue, pas le chiffre national.`
          : LEVEL_BLURBS[level],
      }));
    return { chips: [], legend };
  },

  destroy(viewer) {
    if (_enabled) this.disable(viewer);
    else {
      clearSelection();
      _overlayHost.setVisible(SCHOOLS_FR_OVERLAY_SOURCE_ID, false);
      _overlayHost.setVisible(SCHOOLS_FR_LABEL_SOURCE_ID, false);
      if (_clickHandler) {
        _clickHandler.destroy();
        _clickHandler = null;
      }
      document.removeEventListener('keydown', onKeyDown);
      unregisterPickOwner(SCHOOLS_FR_LAYER_ID);
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
      unregisterSpriteCollection(SCHOOLS_FR_LAYER_ID, _points);
      viewer.scene.primitives.remove(_points);
      _points = null;
    }
    _records.clear();
    _meshNames = new Map();
    _viewer = null;
  },
};

/** Seed rendered records so selection/card/legend paths run without WebGL. */
export function _setSchoolsStateForTest({
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
  _enabled = true;
}

/** Exercise the production selection path in focused runtime tests. */
export function _selectSchoolForTest(id) {
  selectSite(id);
}

/** Exercise the production département selection path. */
export function _selectSchoolsDepartementForTest(code) {
  selectDepartement(code);
}

/** Exercise the production clear path and restore the production host seam. */
export function _clearSchoolsSelectionForTest() {
  clearSelection();
  _overlayHost = DEFAULT_OVERLAY_HOST;
  _national = null;
  _nationalPainted = false;
  _mesh = null;
  _meshPick = null;
  _depEntities = new Map();
  _depMeta = new Map();
  _regime = 'sites';
  _enabled = false;
}

/** Row-control legend, for tests that do not construct a viewer. */
export function _schoolsRowControlsForTest() {
  return schoolsFranceLayer.getRowControls();
}

/** Ambient département label cohort, for tests that do not construct a viewer. */
export function _schoolsDepartementOverlayForTest() {
  const entries = [];
  for (const row of _national?.departements || []) {
    if (!(row.schools > 0)) continue;
    const anchor = _depMeta.get(row.code)?.anchor;
    if (!anchor) continue;
    entries.push(createSchoolsDepartementOverlayEntry(row, { anchor }));
  }
  return selectSchoolsLabelCohort(entries);
}

export default schoolsFranceLayer;
