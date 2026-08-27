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
 *   whole country in view — **the 96 départements**, filled by how many charge
 *       (span ≥ 9°)         points each holds, in six quantile bins, with the
 *                           leaders labelled. 18 KB, no clutter.
 *   part of the country   — **the maillage**: real site positions, thinned by
 *       (9° … 0.35°)        a geographic grid so every occupied cell keeps its
 *                           largest site before any cell gets a second dot.
 *                           1 100–2 200 dots, densifying as you close in.
 *   one city              — **every site**, with its operators, connectors,
 *       (below ~45 km)      access conditions and freshness.
 *
 * The three never draw at once and each has its own legend, so a colour can
 * never be read against the wrong scale. The choropleth reuses the bundled IGN
 * département polygons and the clamp-to-ground technique that
 * `meteoFranceVigilance.js` and `franceEnergy.js` already paint on; the
 * maillage's thinning is `cctvLod.js`'s ambient-ring distribution transposed
 * from screen space to geographic space (see `irveMesh.js`).
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
import { governorRequestRender } from '../renderGovernor.js';
import { registerSpriteCollection, restoreSpriteOrder, unregisterSpriteCollection } from './spriteOrder.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import { cachedGroundFloor, warmGroundFloor } from './groundFloor.js';
import { horizonOccluder } from './iconOrientation.js';
import { parseDepartements } from './meteoFranceVigilance.js';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
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
 * Choropleth ramp, low to high — a violet-to-pink sequential scale.
 *
 * Deliberately a family that appears nowhere else on this globe: not the power
 * ramp above (which means a *kind* of charging, not an amount), not Mix élec's
 * teal/amber balance, not Vigilance's green→red. The two IRVE regimes never
 * draw at the same time, but a reader who zooms out must not carry a
 * category's meaning into a quantity's.
 */
const DEPARTEMENT_COLORS = Object.freeze([
  '#2f1b52', '#4d2a86', '#7239b4', '#9b4fd0', '#c774e0', '#eba9ef',
]);
/** Fill alpha per bin — density reads as weight as well as hue. */
const DEPARTEMENT_ALPHA = Object.freeze([0.34, 0.40, 0.46, 0.53, 0.60, 0.68]);
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
 * Bin index, or -1 for anything that is not one.
 *
 * `Number(null)` is 0, not NaN, so a plain coercion would give a département
 * with NO bin the colour of the LOWEST one — painting "we have no figure for
 * this" as "this is the emptiest part of France". Absence has to be rejected
 * before the numeric check, exactly as it is in `irveFeed.js`.
 */
function departementBinIndex(bin) {
  if (bin === null || bin === undefined || bin === '') return -1;
  const index = Math.trunc(Number(bin));
  return Number.isFinite(index) && index >= 0 ? index : -1;
}

/** Colour for a choropleth bin; an empty département has no colour at all. */
export function irveDepartementColor(bin) {
  const index = departementBinIndex(bin);
  if (index < 0) return null;
  return DEPARTEMENT_COLORS[Math.min(index, DEPARTEMENT_COLORS.length - 1)];
}

/** Fill alpha for a choropleth bin. */
export function irveDepartementAlpha(bin) {
  const index = departementBinIndex(bin);
  if (index < 0) return 0;
  return DEPARTEMENT_ALPHA[Math.min(index, DEPARTEMENT_ALPHA.length - 1)];
}

/**
 * Legend row labels for the quantile bins, built from the thresholds the
 * server measured. The numbers matter: a quantile scale is only honest if the
 * reader can see the boundaries it chose.
 *
 * @param {Array<number>} thresholds Ascending upper bounds, `bins - 1` of them.
 * @returns {Array<string>}
 */
export function irveDepartementBinLabels(thresholds) {
  const bounds = (Array.isArray(thresholds) ? thresholds : []).map(Number).filter(Number.isFinite);
  const labels = [];
  for (let i = 0; i <= bounds.length; i += 1) {
    const low = i === 0 ? 1 : bounds[i - 1] + 1;
    const high = i < bounds.length ? bounds[i] : null;
    labels.push(high === null ? `${fr(low)}+` : `${fr(low)}–${fr(high)}`);
  }
  return labels;
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
  details.push(`🔌 ${fr(pdc)} point${pdc === 1 ? '' : 's'} de charge`);
  if (Number(row.sites) > 0) {
    details.push(`📍 ${fr(row.sites)} site${row.sites === 1 ? '' : 's'}`);
  }
  const bands = row.bands || {};
  const split = IRVE_BAND_KEYS
    .filter((band) => Number(bands[band]) > 0)
    .map((band) => `${fr(bands[band])} × ${irveBandLabel(band).replace(/\s*\(.*\)$/, '').toLowerCase()}`);
  if (split.length) details.push(`⚡ ${split.join(' · ')}`);
  if (Number.isFinite(row.per1000Km2)) {
    details.push(`▦ ${row.per1000Km2.toLocaleString('fr-FR')} pour 1 000 km² (${fr(row.areaKm2)} km²)`);
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
    id: `irve-fr:dep:${row.code}`,
    position,
    variant: 'label',
    title: `${row.name} · ${fr(row.pdc)}`,
    accent: irveDepartementColor(row.bin) || BAND_COLORS.inconnue,
    // The cohort is bounded, so priority decides WHICH départements get named:
    // the biggest, which is the same ranking the fill already shows.
    priority: Number(row.pdc) || 0,
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
  record.point.pixelSize = record.baseSize;
}

function clearSelection() {
  if (_selectedId?.startsWith?.('dep:')) {
    // Nothing to restore: a département's fill is owned by the repaint, which
    // is idempotent, so re-running it puts the bin colour back.
    repaintDepartements();
  } else if (_selectedId) {
    restoreRecordStyle(_records.get(_selectedId));
  }
  _selectedId = null;
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
function onPreRender() {
  if (!_enabled || !_records.size) return;
  const camera = _viewer?.camera;
  if (!camera) return;
  const occluder = horizonOccluder(camera);
  for (const record of _records.values()) {
    if (!record.point) continue;
    record.point.show = occluder.isPointVisible(record.position);
  }
}

// --- National regime --------------------------------------------------------

function applyClassification(next) {
  if (next === undefined || next === _classificationType) return;
  _classificationType = next;
  for (const parts of _depEntities.values()) {
    for (const entity of parts) {
      if (entity.polygon) entity.polygon.classificationType = next;
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
  const highlight = new Cesium.ColorMaterialProperty(
    Cesium.Color.fromCssColorString(SELECTED_COLOR).withAlpha(0.42),
  );
  for (const entity of _depEntities.get(_selectedId.slice(4)) || []) {
    if (entity.polygon) entity.polygon.material = highlight;
  }
}

/**
 * Paint the current rollup onto the pre-built département entities.
 *
 * Idempotent, and it re-asserts a live selection at the end: a repaint resets
 * every material, so without that a camera nudge would silently drop the cyan
 * highlight while the card stayed on screen.
 */
function repaintDepartements() {
  if (!_depEntities.size) return;
  const painted = new Set();
  const rows = _national?.departements || [];
  // One material instance per BIN, shared by every département in it: they are
  // one step of the scale, not 16 separate colours.
  const materials = new Map();
  for (const row of rows) {
    const color = irveDepartementColor(row.bin);
    if (!color) continue;
    let material = materials.get(row.bin);
    if (!material) {
      material = new Cesium.ColorMaterialProperty(
        Cesium.Color.fromCssColorString(color).withAlpha(irveDepartementAlpha(row.bin)),
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
  // the bottom of the scale — the same rule Mix élec applies to Corse.
  for (const [code, parts] of _depEntities) {
    if (painted.has(code)) continue;
    for (const entity of parts) entity.show = false;
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
      baseColor: color,
      baseSize: size,
    });
  }
  _count = _records.size;
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
    _records.set(id, { id, site, point, position, baseColor: color, baseSize: size });
    warm.push(site);
  }

  _count = _records.size;
  warmGroundFloor(warm.slice(0, GROUND_WARM_LIMIT));
  governorRequestRender('irve-fr-reconcile');
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
      const labels = irveDepartementBinLabels(_national.thresholds);
      const counts = new Array(labels.length).fill(0);
      for (const row of _national.departements || []) {
        if (row.bin >= 0 && row.bin < counts.length) counts[row.bin] += 1;
      }
      const legend = labels.map((label, bin) => ({
        label: `${label} bornes`,
        color: irveDepartementColor(bin),
        count: counts[bin],
        blurb: bin === labels.length - 1
          ? 'Départements in the top sixth by installed charge points. The fill is an absolute count, so the card also gives the rate per 1 000 km².'
          : 'One sixth of the 96 départements. Quantile bins, because on a linear scale Paris alone takes the top fifth.',
      })).filter((row) => row.count > 0);
      return { chips: [], legend };
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
