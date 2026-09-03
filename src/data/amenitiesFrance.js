/**
 * @module amenitiesFrance
 *
 * Où est le plus proche — the seven things a daily life in France actually
 * touches, drawn from the two registers that publish them and refusing the five
 * things another layer on this globe already draws better.
 *
 * `amenitiesFeed.js` holds the reading of INSEE's Base permanente des
 * équipements and the FINESS register and every trap in both;
 * `amenitiesDepartements.js` holds the national fold; `amenitiesMesh.js` holds
 * the thinning. This file is the rendering.
 *
 * ── What is on the map ─────────────────────────────────────────────────────
 * **95 406 dots**, folded from 126 859 register rows, in seven families:
 * 30 215 médecins généralistes · 19 354 commerces alimentaires · 19 216
 * pharmacies · 16 832 points de contact La Poste · 3 953 gendarmeries et
 * commissariats · 3 625 bassins de natation · 2 211 hôpitaux.
 *
 * ── The refusal is a feature of this layer, not an omission ─────────────────
 * The brief's row opens with *écoles*, and this layer draws none. `schools-fr`
 * already draws 68 158 open, geolocated schools from the ministry's own
 * Annuaire keyed on the UAI, and `sup-fr` 6 914 higher-education sites. BPE's
 * enseignement domain is 79 743 rows over the same buildings from a source that
 * **carries no UAI column at all**, so the two could not even be reconciled.
 * Redrawing them would double every school in France from the worse of the two
 * registers. The legend therefore carries a row for écoles with a count and no
 * swatch, because a reader who does not find schools here should be told where
 * they are rather than left to conclude the data is missing.
 *
 * Four more refusals, each with the measurement behind it, are argued in
 * `amenitiesFeed.js`: BPE's 28 819 charge points (`irve-fr` has 39 579, live),
 * its 20 334 pharmacies (FINESS has a stable key and a monthly refresh), its
 * 695 urgences (547 of them within 200 m of a hospital already drawn), and its
 * 99 280 transport rows (96 253 of which are taxi operators' addresses).
 *
 * ── Three regimes, and what decides between them ───────────────────────────
 *   national — 96 painted départements, shaded by the SHARE of the
 *              département's communes that hold at least one everyday
 *              equipment. A count would have been a population map; see
 *              `amenitiesDepartements.js`. Entered on the view's LATITUDE span
 *              (≥ 9.5°, metropolitan France being 9.8° tall).
 *   maillage — real positions, thinned per family so no family can be squeezed
 *              off the map by a bigger one. See `amenitiesMesh.js`.
 *   sites    — every amenity in the box, with its card, from the proxy's
 *              `/sites` route. Gated at 0.35°, and the densest square that
 *              ceiling allows anywhere in France — 48.65 N, 2.20 E, which is
 *              Paris and its inner south-eastern suburbs — holds 9 139 dots.
 *
 * ── What the colour means, and what the size does NOT mean ──────────────────
 * Colour is the FAMILY, and it is a categorical ladder, never a ramp — a
 * pharmacy is not "more" than a post office.
 *
 * Size is where this layer differs from every French point layer beside it, and
 * the difference is deliberate. `schools-fr` sizes by roll, `sup-fr` by
 * enrolment, `irve-fr` by charging power. **This point set has no magnitude at
 * all.** A pharmacy is one pharmacy; neither register publishes a capacity, a
 * headcount or a turnover for any of the seven families. So size here is a
 * LEGIBILITY rule and is stated as one: the rarer a family is nationally, the
 * larger its dot, so that 2 211 hospitals are not lost under 30 215 GPs. It is
 * a property of the palette, not a property of the equipment, and no card ever
 * reads a size back as a quantity.
 *
 * What the card DOES read back is the multiplicity, because that is real:
 * 60 270 GP rows sit on 30 215 coordinates and the biggest single address holds
 * **146 médecins généralistes** (Paris 14e). The dot is the address; the card
 * says how many practitioners are at it.
 *
 * ── The second visual channel is honesty about position ─────────────────────
 * Both registers publish how well they know where a thing is, and this layer
 * draws that rather than hiding it. A dot whose position is a street number
 * (79 043 of the 95 406 dots) is drawn solid with a warm halo; one the register
 * only places in the street (11 216), or grades no better than "voie probable"
 * (766), or declines to grade at all (4 381, of which 3 626 are bassins de
 * natation whose census publishes no precision anywhere) is drawn softer, and
 * the two weakest bands lose the halo entirely. The halo is also this layer's signature against its neighbours:
 * `schools-fr` outlines in black, `sup-fr` in white, and these outline in sand,
 * so on a stacked address the ring says which register drew the dot.
 *
 * And where a register admits it drew the position rather than found it — BPE's
 * `QUALITE_GEOLOC = 33`, "position aléatoire dans la commune", and FINESS's
 * 4 646 ADMIN-EXPRESS commune centroids — there is no dot at all. **2 182 rows
 * in the drawn families are refused on those grounds and 170 more publish no
 * coordinate**, all of them counted and reported on the national card. 100 of
 * those 170 are the whole of Mayotte's everyday BPE equipment, which is why the
 * island carries FINESS pharmacies and hospitals and nothing else.
 */

import * as Cesium from 'cesium';
import { claimCameraSensitivity, releaseCameraSensitivity } from './cameraSensitivity.js';
import { CHOROPLETH_FILL_ALPHA } from './choroplethAlpha.js';
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
  AMENITIES_MAX_BOX_DEG,
  AMENITY_FAMILIES,
  AMENITY_FAMILY_BLURBS,
  AMENITY_FAMILY_LABELS,
  AMENITY_FAMILY_PLURALS,
  AMENITY_PRECISION_LABELS,
  amenityPrecisionRank,
} from './amenitiesFeed.js';
import {
  MESH_FAMILY,
  MESH_LAT,
  MESH_LON,
  MESH_PRECISION,
  amenitiesMeshBudget,
  meshAmenityFamily,
  meshAmenityId,
  meshAmenityPrecision,
  selectAmenitiesMesh,
} from './amenitiesMesh.js';
import { amenitiesDepartementBinLabels } from './amenitiesDepartements.js';
import { boxKey, validBox } from './viewportBox.js';

export const AMENITIES_FR_LAYER_ID = 'amenities-fr';

export const AMENITIES_FR_OVERLAY_SOURCE_ID = 'amenities-fr-selected';
export const AMENITIES_FR_OVERLAY_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 1,
  moving: false,
});
export const AMENITIES_FR_LABEL_SOURCE_ID = 'amenities-fr-departements';
export const AMENITIES_FR_LABEL_COHORT_LIMIT = 14;
export const AMENITIES_FR_LABEL_COLLISION_CAPACITY = 12;

const DEPARTEMENTS_URL = new URL(
  './local_data/france_departements/departements.geojson',
  import.meta.url,
).href;

// --- Activation / load gating ----------------------------------------------
/**
 * View LATITUDE span (degrees) at or above which the choropleth answers, with
 * the lower exit threshold that stops a camera resting on the boundary from
 * swapping the whole map back and forth on sub-pixel drift. The pair
 * `schools-fr` and `sup-fr` settled on, because it is a fact about France
 * (9.8° tall) and the screen rather than about any register.
 */
const NATIONAL_ENTER_SPAN_DEG = 9.5;
const NATIONAL_EXIT_SPAN_DEG = 8;
/** Where the exact regime takes over from the maillage, with the same hysteresis. */
const SITES_ENTER_SPAN_DEG = 0.32;
const SITES_EXIT_SPAN_DEG = AMENITIES_MAX_BOX_DEG;
const CAMERA_DEBOUNCE_MS = 450;
/**
 * Poll cadence (ms). Very long on purpose: BPE is published once a year and
 * FINESS once a month. Six hours is already a hundred times faster than the
 * slower of the two changes; the camera, not the clock, drives this layer.
 */
const POLL_INTERVAL_MS = 6 * 60 * 60_000;
const NATIONAL_TIMEOUT_MS = 180_000;
const VIEWPORT_TIMEOUT_MS = 45_000;
/**
 * Hard cap on rendered dots.
 *
 * 12 000, above the densest square the 0.35° ceiling allows anywhere in France
 * (9 139 dots at 48.65 N, 2.20 E), so it never bites in production — it exists
 * so a malformed payload cannot ask Cesium for a million primitives. If it ever
 * did bite, what survives is what a reader would keep: the proxy sends the
 * payload sorted rarest-family-first, so a cap drops médecins généralistes, of
 * which that same square holds 3 426, and never its 218 hospitals. Whatever is
 * dropped is counted and printed under the toggle.
 */
const MAX_RENDERED_SITES = 12_000;
const POINT_LIFT_M = 2.5;
const GROUND_WARM_LIMIT = 600;

// --- Presentation -----------------------------------------------------------

/**
 * The family hues.
 *
 * Seven distinct hues rather than seven steps of one, because this is a
 * category and not a quantity. They are chosen against what is already on this
 * globe: `schools-fr` is pastel (mint, sky, rose, apricot), `sup-fr` is deep
 * jewel (violet, amber, teal, crimson), `irve-fr` is a blue→red power ramp and
 * `anfr-fr` is grey-blue with one yellow. These are mid-dark and warm-leaning,
 * and each has an obvious mnemonic — the pharmacy's green cross, La Poste's
 * blue, the water of a pool — so a reader does not have to hold seven arbitrary
 * mappings in their head.
 */
export const AMENITY_COLORS = Object.freeze({
  medecin: '#c92a2a',
  courses: '#d9480f',
  pharmacie: '#0f8a5f',
  poste: '#1864ab',
  piscine: '#15aabf',
  gendarmerie: '#862e9c',
  hopital: '#a61e4d',
});

/**
 * Base pixel size per family — a LEGIBILITY rule, not a magnitude.
 *
 * Rarer families are drawn larger so they survive being stacked on the dense
 * ones. The ladder is the inverse of the national counts (30 215 GPs down to
 * 2 211 hospitals) and it is the only thing size means anywhere in this layer.
 */
export const AMENITY_POINT_PX = Object.freeze({
  medecin: 6.5,
  courses: 8,
  pharmacie: 8,
  poste: 8.5,
  piscine: 10,
  gendarmerie: 10,
  hopital: 12,
});

/**
 * Fill alpha per precision band.
 *
 * Not decoration: a dot the register places at a street number and one it
 * places somewhere in the street are different claims, and 17 286 of the 95 406
 * are the second kind. The two best bands also carry the sand outline; the two
 * worst carry none, so the difference survives being read at a glance.
 */
export const AMENITY_PRECISION_ALPHA = Object.freeze({
  numero: 1,
  voie: 0.88,
  approchee: 0.6,
  indeterminee: 0.5,
});

/**
 * Choropleth ramp, low to high — a sequential sand-to-rust scale.
 *
 * Distinct from `schools-fr`'s green and `sup-fr`'s violet on purpose: the
 * three national views never draw at once, but an operator who toggles between
 * them must not carry one quantity's colour into another's. And this one is not
 * even the same KIND of quantity — it is a share, where those two are counts.
 */
const DEPARTEMENT_COLORS = Object.freeze([
  '#5c3510', '#8a4a12', '#b26a26', '#d18f45', '#e3b778', '#f0d9b5',
]);
/**
 * Fill alpha per bin — DESCENDING, and shared with the three sibling count
 * choropleths so one edit cannot desynchronise them.
 *
 * It used to ascend, on the reasoning that "density reads as weight as well as
 * hue". That is true over a constant backdrop and false over live imagery: the
 * darkest swatch was also the most transparent, so on a light city the ground
 * washed it out and the composited lightness ran 67.4 · 65.9 · 65.3 · 65.8 ·
 * 69.6 · 78.0 — a U, with class 1 reading lighter than classes 2 to 4. See
 * `choroplethAlpha.js` for the measurements and the search that produced these
 * numbers, and `choroplethAlpha.test.mjs`, which recomputes the compositing
 * over eight backgrounds and fails on any inversion.
 */
const DEPARTEMENT_ALPHA = CHOROPLETH_FILL_ALPHA;
const SELECTED_COLOR = '#00ffff';
/**
 * Sand, at 0.75 — where `schools-fr` outlines in black at 0.35 and `sup-fr` in
 * white at 0.55. The outline is the half of this layer's signature that
 * survives a stacked dot, and it is also the precision channel: a dot without
 * one is a dot whose position the register would not vouch for.
 */
const OUTLINE_COLOR = Cesium.Color.fromCssColorString('#ffd8a8').withAlpha(0.75);
const SELECTED_POINT_PX = 18;
/** Mesh dots are flatter than exact ones: a sample must not read as an inventory. */
const MESH_SIZE_FACTOR = 0.8;

/** One line behind each légende swatch, from the feed's measured vocabulary. */
const FAMILY_BLURBS = AMENITY_FAMILY_BLURBS;

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});

// --- Module state -----------------------------------------------------------

let _viewer = null;
let _points = null;
let _enabled = false;
let _records = new Map();
let _selectedId = null;
let _count = 0;
let _lastUpdate = null;
let _loading = false;
let _error = null;
let _status = 'idle';
let _regime = 'national';
let _summary = null;
let _national = null;
let _nationalError = null;
let _nationalPromise = null;
let _nationalPainted = false;
let _mesh = null;
let _meshError = null;
let _meshPromise = null;
let _meshPick = null;
let _truncated = 0;
let _requestGeneration = 0;
let _inFlight = null;
let _cameraDebounceTimer = null;
let _cameraChangedAttached = false;
let _preRenderRemover = null;
let _clickHandler = null;
let _depDataSource = null;
let _depEntities = new Map();
let _depMeta = new Map();
let _depShapesPromise = null;
let _lastBoxKey = null;
let _overlayHost = DEFAULT_OVERLAY_HOST;

// --- Pure presentation helpers ---------------------------------------------

/** Hue for one family. Never a fallback colour for an unknown one — null. */
export function amenityFamilyColor(family) {
  return AMENITY_COLORS[family] || null;
}

/** French label for one family. */
export function amenityFamilyLabel(family) {
  return AMENITY_FAMILY_LABELS[family] || family || '';
}

/**
 * Pixel size for one dot.
 *
 * `mesh` shrinks it by a fifth, because a maillage dot stands for a sampled
 * neighbourhood and a dot the size of an exact one would invite the eye to read
 * the sample as the inventory.
 */
export function amenityPointSize(family, { mesh = false } = {}) {
  const base = AMENITY_POINT_PX[family];
  if (typeof base !== 'number') return 6;
  return mesh ? Number((base * MESH_SIZE_FACTOR).toFixed(2)) : base;
}

/**
 * Fill alpha for one precision band.
 *
 * Guarded with `typeof`, not coerced: an absent band must not become the best
 * one by way of a default, and `AMENITY_PRECISION_ALPHA[undefined]` is
 * `undefined`, which Cesium would take as opaque.
 */
export function amenityPrecisionAlpha(precision) {
  const alpha = AMENITY_PRECISION_ALPHA[precision];
  return typeof alpha === 'number' ? alpha : AMENITY_PRECISION_ALPHA.indeterminee;
}

/** Whether a dot at this precision earns the sand halo. */
export function amenityHasOutline(precision) {
  return amenityPrecisionRank(precision) >= 2;
}

/**
 * Ramp colour for one choropleth bin.
 *
 * A guard that coerced would be a bug: `Number(null)` is 0, which would paint a
 * département with no communes in the fold as the bottom of the scale instead
 * of leaving it unpainted.
 */
export function amenitiesDepartementColor(bin) {
  if (typeof bin !== 'number' || !Number.isInteger(bin)) return null;
  if (bin < 0 || bin >= DEPARTEMENT_COLORS.length) return null;
  return DEPARTEMENT_COLORS[bin];
}

/** Fill alpha for one choropleth bin. */
export function amenitiesDepartementAlpha(bin) {
  if (typeof bin !== 'number' || !Number.isInteger(bin)) return DEPARTEMENT_ALPHA[0];
  if (bin < 0 || bin >= DEPARTEMENT_ALPHA.length) return DEPARTEMENT_ALPHA[0];
  return DEPARTEMENT_ALPHA[bin];
}

/** The camera rectangle's two spans, in degrees. */
export function amenitiesViewSpanDeg(viewer) {
  const rectangle = viewer?.camera?.computeViewRectangle?.();
  if (!rectangle) return { lat: Infinity, max: Infinity };
  const lat = Cesium.Math.toDegrees(rectangle.north - rectangle.south);
  const lon = Cesium.Math.toDegrees(rectangle.east - rectangle.west);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { lat: Infinity, max: Infinity };
  return { lat, max: Math.max(lat, lon) };
}

/** The camera rectangle as a padded box, or null past the limb. */
export function cameraAmenitiesBox(viewer, padFraction = 0.12) {
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
 * A box the `/sites` route will answer, or null when it is over the ceiling.
 *
 * The ceiling is checked with the SAME `validBox` the proxy uses, so the client
 * never spends a round trip discovering a 400 the shared helper could have told
 * it about — and so the two can never drift apart on what "0.35°" means at the
 * dateline or at a degenerate rectangle.
 */
export function amenitiesSitesBox(viewer) {
  const box = cameraAmenitiesBox(viewer, 0.08);
  if (!box) return null;
  return validBox(box, AMENITIES_MAX_BOX_DEG);
}

/** Which regime the camera is in, with hysteresis at both boundaries. */
function updateRegime(viewer) {
  const span = amenitiesViewSpanDeg(viewer);
  if (_regime === 'national') {
    if (span.lat >= NATIONAL_EXIT_SPAN_DEG) return _regime;
  } else if (span.lat >= NATIONAL_ENTER_SPAN_DEG) {
    _regime = 'national';
    return _regime;
  }
  if (_regime === 'sites') {
    if (span.max > SITES_EXIT_SPAN_DEG) _regime = 'maillage';
  } else if (span.max <= SITES_ENTER_SPAN_DEG) {
    _regime = 'sites';
  } else {
    _regime = 'maillage';
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

/** French decimal for a share. */
function pct(value) {
  return String(Number(value)).replace('.', ',');
}

// --- Cards ------------------------------------------------------------------

/**
 * Card copy for one selected dot.
 *
 * Every line is a published value or a stated absence of one. Three of them
 * exist only because a reader would otherwise draw a wrong conclusion from the
 * dot alone: the multiplicity (an address with 146 GPs is one dot), the
 * precision (a dot in the right street is not a dot at the right number), and
 * the register (a pharmacy comes from FINESS and the supermarket next to it
 * from the BPE, and they were geocoded by different people).
 */
export function buildAmenitySelectionLabel(record) {
  const site = record?.site || {};
  const family = site.family;
  const names = Array.isArray(site.names) ? site.names : [];
  const count = Number(site.count) || 0;
  const title = names[0] || amenityFamilyLabel(family) || 'Équipement';
  const details = [];

  const kinds = Array.isArray(site.kinds) ? site.kinds.filter(Boolean) : [];
  details.push(kinds.length ? kinds.join(' · ') : amenityFamilyLabel(family));

  if (record?.mesh) {
    // A maillage dot carries the family and the precision and nothing else —
    // saying so is what stops the empty half of the card reading as an absence
    // in the register.
    details.push('Point du maillage — zoomer pour la fiche complète');
  } else if (count > 1) {
    details.push(`${fr(count)} ${AMENITY_FAMILY_PLURALS[family] || 'équipements'} à cette adresse`);
    for (const name of names.slice(1)) details.push(`· ${name}`);
    if (site.moreNames > 0) details.push(`· et ${fr(site.moreNames)} autres`);
    if (site.unnamed > 0) details.push(`· ${fr(site.unnamed)} sans raison sociale publiée`);
  } else if (!names.length) {
    details.push('Raison sociale non diffusée');
  }

  if (site.commune) details.push(site.commune);

  const precision = site.precision;
  if (precision) {
    const label = AMENITY_PRECISION_LABELS[precision] || precision;
    details.push(amenityHasOutline(precision)
      ? `Position : ${label}`
      : `⚠ Position : ${label}`);
  }
  if (site.distance) details.push(`Distance à l’adresse : ${site.distance}`);
  if (typeof site.score === 'number') {
    details.push(`Géocodage ${site.geocoder || 'ATLASANTE'} — score ${fr(site.score)}/100`);
  }
  if (site.crs) details.push(`Coordonnées reprojetées depuis ${site.crs}`);
  if (site.uai) details.push(`UAI ${site.uai} — aussi dans schools-fr / sup-fr`);
  if (Array.isArray(site.finess) && site.finess.length) {
    details.push(`FINESS ${site.finess.join(', ')}`);
  }

  details.push(site.register === 'finess'
    ? 'FINESS — ARS / Agence du Numérique en Santé'
    : 'Base permanente des équipements 2025 — Insee');
  return [title, ...details].join('\n');
}

/** Card copy for one selected département. */
export function buildAmenitiesDepartementLabel(row) {
  if (!row) return '';
  const details = [];
  details.push(row.communes > 0
    ? `${pct(row.share)} % des communes équipées — ${fr(row.covered)} sur ${fr(row.communes)}`
    : 'Aucune commune rattachée à ce polygone');
  details.push(`${fr(row.amenities)} équipements dessinés`);
  const mix = AMENITY_FAMILIES
    .filter((family) => (row.families?.[family] || 0) > 0)
    .map((family) => `${fr(row.families[family])} ${AMENITY_FAMILY_PLURALS[family]}`);
  for (const line of mix) details.push(`· ${line}`);
  // The ratio's own blind spot, stated where the ratio is read.
  details.push('Part calculée sur les 5 familles de la BPE : FINESS ne publie pas de code commune.');
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

/** Protected selected-dot entry for the shared overlay host. */
export function createAmenitySelectedOverlayEntry(record) {
  const position = record?.position;
  if (!record?.id || !position) return null;
  return selectedOverlayEntry(record.id, position, buildAmenitySelectionLabel(record));
}

/** Ambient label for one département at national altitude. */
export function createAmenitiesDepartementOverlayEntry(row, position) {
  return {
    id: `amenities-fr:dep:${row.code}`,
    position,
    variant: 'label',
    title: `${row.name} · ${pct(row.share)} %`,
    accent: amenitiesDepartementColor(row.bin) || DEPARTEMENT_COLORS[0],
    // Lowest coverage first: the départements worth labelling on this map are
    // the ones where the answer to "where is the nearest one" is "far".
    priority: 100 - (Number(row.share) || 0),
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

/** Keep the least-equipped départements, with stable identity as tie-break. */
export function selectAmenitiesLabelCohort(entries, limit = AMENITIES_FR_LABEL_COHORT_LIMIT) {
  const cap = Math.max(0, Math.min(AMENITIES_FR_LABEL_COHORT_LIMIT, Math.floor(Number(limit) || 0)));
  if (!Array.isArray(entries) || cap === 0) return [];
  return entries.slice()
    .sort((a, b) => b.priority - a.priority || String(a.id).localeCompare(String(b.id)))
    .slice(0, cap);
}

// --- Selection --------------------------------------------------------------

function restoreRecordStyle(record) {
  if (!record?.point) return;
  record.point.color = Cesium.Color.fromCssColorString(record.baseColor)
    .withAlpha(record.baseAlpha);
  record.point.pixelSize = record.baseSize;
}

function highlightSelectedDepartement() {
  if (!_selectedId?.startsWith?.('dep:')) return;
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
    _overlayHost.clearSource(AMENITIES_FR_OVERLAY_SOURCE_ID);
  }
}

function clearSelection() {
  if (_selectedId?.startsWith?.('dep:')) {
    repaintDepartements();
  } else if (_selectedId) {
    restoreRecordStyle(_records.get(_selectedId));
  }
  _selectedId = null;
  _overlayHost.clearSource(AMENITIES_FR_OVERLAY_SOURCE_ID);
  governorRequestRender('amenities-fr-clear');
}

function selectSite(id) {
  const record = _records.get(id);
  if (!record) return;
  clearSelection();
  _selectedId = id;
  if (record.point) {
    record.point.color = Cesium.Color.fromCssColorString(SELECTED_COLOR);
    record.point.pixelSize = SELECTED_POINT_PX;
  }
  const entry = createAmenitySelectedOverlayEntry(record);
  if (entry) {
    _overlayHost.setEntries(AMENITIES_FR_OVERLAY_SOURCE_ID, [entry], AMENITIES_FR_OVERLAY_SOURCE_OPTIONS);
  }
  governorRequestRender('amenities-fr-select');
}

function selectDepartement(code) {
  const row = (_national?.departements || []).find((entry) => entry.code === code);
  if (!row) return;
  clearSelection();
  _selectedId = `dep:${code}`;
  highlightSelectedDepartement();
  const anchor = _depMeta.get(code)?.anchor;
  if (anchor) {
    const entry = selectedOverlayEntry(
      _selectedId,
      Cesium.Cartesian3.fromDegrees(anchor[0], anchor[1]),
      buildAmenitiesDepartementLabel(row),
    );
    _overlayHost.setEntries(AMENITIES_FR_OVERLAY_SOURCE_ID, [entry], AMENITIES_FR_OVERLAY_SOURCE_OPTIONS);
  }
  governorRequestRender('amenities-fr-select-dep');
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
  const entry = createAmenitySelectedOverlayEntry(record);
  if (entry) {
    _overlayHost.setEntries(AMENITIES_FR_OVERLAY_SOURCE_ID, [entry], AMENITIES_FR_OVERLAY_SOURCE_OPTIONS);
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
    source.name = 'Équipements du quotidien — part des communes équipées';
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
    // A failed shape load must be retryable, not a permanently poisoned promise
    // that leaves the national view silently empty for the session.
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
    const color = amenitiesDepartementColor(row.bin);
    if (!color) continue;
    let material = materials.get(row.bin);
    if (!material) {
      material = new Cesium.ColorMaterialProperty(
        Cesium.Color.fromCssColorString(color).withAlpha(amenitiesDepartementAlpha(row.bin)),
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
    _overlayHost.clearSource(AMENITIES_FR_LABEL_SOURCE_ID);
    return;
  }
  const entries = [];
  for (const row of _national?.departements || []) {
    if (!(row.communes > 0)) continue;
    const anchor = _depMeta.get(row.code)?.anchor;
    if (!anchor) continue;
    entries.push(createAmenitiesDepartementOverlayEntry(
      row,
      Cesium.Cartesian3.fromDegrees(anchor[0], anchor[1]),
    ));
  }
  _overlayHost.setEntries(AMENITIES_FR_LABEL_SOURCE_ID, selectAmenitiesLabelCohort(entries), {
    cohortLimit: AMENITIES_FR_LABEL_COHORT_LIMIT,
    collisionCapacity: AMENITIES_FR_LABEL_COLLISION_CAPACITY,
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
      const response = await fetch('/api/amenities-fr/departements', { signal: controller.signal });
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
      console.warn('[Data:Amenities-FR] national rollup failed:', error?.message || error);
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
  _overlayHost.clearSource(AMENITIES_FR_LABEL_SOURCE_ID);
}

async function loadNational({ force = false } = {}) {
  _error = null;
  clearSites();
  if (force) {
    _national = null;
    _nationalPainted = false;
  }
  _loading = !_national;
  const generation = ++_requestGeneration;
  try {
    await ensureDepartementShapes();
  } catch (error) {
    console.warn('[Data:Amenities-FR] département polygons failed:', error?.message || error);
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
  governorRequestRender('amenities-fr-national');
}

// --- Maillage regime --------------------------------------------------------

async function ensureMesh() {
  if (_mesh) return _mesh;
  if (_meshPromise) return _meshPromise;
  _meshPromise = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NATIONAL_TIMEOUT_MS);
    try {
      const response = await fetch('/api/amenities-fr/mesh', { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload?.rows)) throw new Error('malformed mesh');
      _mesh = payload;
      _meshError = null;
      return payload;
    } finally {
      clearTimeout(timer);
      _meshPromise = null;
    }
  })().catch((error) => {
    if (error?.name !== 'AbortError') {
      console.warn('[Data:Amenities-FR] national mesh failed:', error?.message || error);
      _meshError = error?.message || 'national mesh unavailable';
    }
    return null;
  });
  return _meshPromise;
}

/**
 * Draw a thinned, family-balanced selection of real positions for this view.
 *
 * Re-picked on every camera settle rather than cached: the pick is a function
 * of the box, and re-running seven passes over 95 406 tuples costs a few
 * milliseconds against a round trip that would cost a few hundred.
 */
function reconcileMesh(box) {
  const pick = selectAmenitiesMesh(_mesh?.rows, { box });
  _meshPick = pick;
  _truncated = 0;

  clearSelection();
  _points.removeAll();
  _records.clear();

  for (const row of pick.picked) {
    if (_records.size >= MAX_RENDERED_SITES) break;
    const lat = row[MESH_LAT];
    const lon = row[MESH_LON];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const family = meshAmenityFamily(row);
    const color = amenityFamilyColor(family);
    if (!color) continue;
    const id = meshAmenityId(row);
    if (_records.has(id)) continue;
    const precision = meshAmenityPrecision(row);
    const size = amenityPointSize(family, { mesh: true });
    const alpha = amenityPrecisionAlpha(precision);
    // No ground warm-up here: at these altitudes a metre of vertical error is
    // invisible, and 2 200 terrain lookups per pan would not be.
    const position = Cesium.Cartesian3.fromDegrees(lon, lat, POINT_LIFT_M);
    const point = _points.add({
      id,
      position,
      color: Cesium.Color.fromCssColorString(color).withAlpha(alpha),
      pixelSize: size,
      outlineColor: OUTLINE_COLOR,
      outlineWidth: amenityHasOutline(precision) ? 1 : 0,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
    _records.set(id, {
      id,
      mesh: true,
      site: {
        id, family, lat, lon, precision, count: 0, names: [], kinds: [], commune: '',
        register: row[MESH_FAMILY] >= 0 ? null : null,
      },
      point,
      position,
      baseColor: color,
      baseAlpha: alpha,
      baseSize: size,
    });
  }
  _count = _records.size;
  governorRequestRender('amenities-fr-mesh');
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
  if (generation !== _requestGeneration || !_enabled || _regime !== 'maillage') return;
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

// --- Sites regime -----------------------------------------------------------

function reconcile(payload) {
  const sites = Array.isArray(payload?.sites) ? payload.sites : [];

  clearSelection();
  _points.removeAll();
  _records.clear();
  _meshPick = null;

  const warm = [];
  for (const site of sites) {
    if (_records.size >= MAX_RENDERED_SITES) break;
    const id = site?.id;
    if (!id || _records.has(id)) continue;
    if (!Number.isFinite(site.lat) || !Number.isFinite(site.lon)) continue;
    const color = amenityFamilyColor(site.family);
    if (!color) continue;
    const position = sitePosition(site);
    const size = amenityPointSize(site.family);
    const alpha = amenityPrecisionAlpha(site.precision);
    const point = _points.add({
      id,
      position,
      color: Cesium.Color.fromCssColorString(color).withAlpha(alpha),
      pixelSize: size,
      outlineColor: OUTLINE_COLOR,
      outlineWidth: amenityHasOutline(site.precision) ? 1 : 0,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      translucencyByDistance: new Cesium.NearFarScalar(500, 1.0, 60_000, 0.4),
    });
    _records.set(id, { id, site, point, position, baseColor: color, baseAlpha: alpha, baseSize: size });
    warm.push(site);
  }
  // Everything the payload carried and this layer did not draw — the render cap
  // if it ever bit, plus any row whose family the palette does not know. The
  // label below does not name a cause it cannot prove; it names the count,
  // which is the difference between a bounded map and a quietly incomplete one.
  _truncated = Math.max(0, sites.length - _records.size);
  _count = _records.size;
  warmGroundFloor(warm.slice(0, GROUND_WARM_LIMIT));
  governorRequestRender('amenities-fr-reconcile');
}

function clearSites() {
  if (_selectedId && !_selectedId.startsWith('dep:')) clearSelection();
  if (_points) _points.removeAll();
  _records.clear();
  _count = 0;
  _summary = null;
  _meshPick = null;
  _truncated = 0;
}

async function loadSites(box, { force = false } = {}) {
  const key = boxKey(box);
  if (!force && key === _lastBoxKey && _records.size && _regime === 'sites') return;
  hideDepartements();
  _nationalPainted = false;
  dropDepartementSelection();
  _lastBoxKey = key;

  const generation = ++_requestGeneration;
  _inFlight?.abort?.();
  const controller = new AbortController();
  _inFlight = controller;
  const timer = setTimeout(() => controller.abort(), VIEWPORT_TIMEOUT_MS);
  _loading = true;
  try {
    const params = new URLSearchParams({
      south: String(box.south), west: String(box.west),
      north: String(box.north), east: String(box.east),
    });
    const response = await fetch(`/api/amenities-fr/sites?${params}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
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
    console.warn('[Data:Amenities-FR] viewport failed:', error?.message || error);
    _error = error?.message || 'viewport unavailable';
    _status = 'error';
  } finally {
    clearTimeout(timer);
    if (_inFlight === controller) _inFlight = null;
    _loading = false;
  }
}

async function loadViewport({ force = false } = {}) {
  if (!_enabled || !_viewer) return;
  const regime = updateRegime(_viewer);
  if (regime === 'national') {
    _lastBoxKey = null;
    await loadNational({ force });
    return;
  }
  if (regime === 'maillage') {
    _lastBoxKey = null;
    const box = cameraAmenitiesBox(_viewer);
    if (!box) return;
    await loadMesh(box);
    return;
  }
  const box = amenitiesSitesBox(_viewer);
  if (!box) {
    // Inside the span gate but looking at more than the ceiling allows — an
    // oblique horizon shot. The maillage is the honest fallback, not a blank.
    _regime = 'maillage';
    const wide = cameraAmenitiesBox(_viewer);
    if (wide) await loadMesh(wide);
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
    result.push({
      position: record.position,
      sourceId: record.id,
      id: amenityCalloutText(record),
      type: 'Amenity',
      skipLabel: record.id === _selectedId,
    });
    if (result.length >= maxCount) break;
  }
  return result;
}

/**
 * The one line a DETECT callout gets.
 *
 * The name first where there is one, because that is what identifies the thing
 * on screen. A maillage dot has none — the national document carries no names,
 * by design and for 1.5 MB of good reason — so the family label is the honest
 * fallback: it is what the pack actually shipped.
 * @param {object} record
 * @returns {string}
 */
export function amenityCalloutText(record) {
  const site = record?.site || {};
  const label = amenityFamilyLabel(site.family);
  const names = Array.isArray(site.names) ? site.names : [];
  if (!names.length) return label;
  const count = Number(site.count) || 1;
  return count > 1 ? `${names[0]} · +${fr(count - 1)}` : names[0];
}

/** One line under the layer's toggle: what this view actually contains. */
export function buildAmenitiesLoadingLabel({
  regime = _regime,
  status = _status,
  loading = _loading,
  count = _count,
  summary = _summary,
  national = _national,
  meshPick = _meshPick,
  truncated = _truncated,
} = {}) {
  if (regime === 'maillage') {
    if (loading) return 'lecture du maillage national...';
    if (status === 'error') return '';
    if (!meshPick) return '';
    if (!meshPick.inBox) return 'aucun équipement dans cette vue';
    // Naming both numbers is the whole contract of this regime: a thinned map
    // that does not say it is thinned claims France has 1 100 amenities.
    return meshPick.thinned
      ? `${fr(meshPick.picked.length)} tracé${meshPick.picked.length > 1 ? 's' : ''} sur ${fr(meshPick.inBox)} dans la vue — échantillon par famille`
      : `${fr(meshPick.picked.length)} équipements dans la vue`;
  }
  if (regime === 'national') {
    if (loading) return 'lecture du registre national...';
    if (status === 'error') return '';
    if (!national) return '';
    const parts = [
      `${pct(national.nationalShare)} % des ${fr(national.communesPlaced)} communes équipées`,
      `${fr(national.assigned)} équipements sur ${fr(national.painted)} départements`,
    ];
    // The choropleth's own blind spot, stated where the choropleth is read.
    if (national.unassigned > 0) {
      parts.push(`${fr(national.unassigned)} hors métropole non peints`);
    }
    return parts.join(' · ');
  }
  if (loading) return 'lecture du registre...';
  if (status === 'error') return '';
  if (!count) return 'aucun équipement dans cette vue';
  const parts = [`${fr(count)} équipements`];
  if (summary?.rows > 0 && summary.rows !== count) {
    parts.push(`${fr(summary.rows)} lignes de registre`);
  }
  if (truncated > 0) parts.push(`${fr(truncated)} reçus mais non tracés`);
  return parts.join(' · ');
}

// --- Layer ------------------------------------------------------------------

const amenitiesFranceLayer = {
  id: AMENITIES_FR_LAYER_ID,
  name: 'Équipements du quotidien (FR)',
  icon: '🏪',
  source: 'BPE 2025 — Insee · FINESS — ARS/ANS',
  updateInterval: POLL_INTERVAL_MS,

  init(viewer) {
    _viewer = viewer;
    _points = new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT });
    _points.show = false;
    viewer.scene.primitives.add(_points);
    registerSpriteCollection(AMENITIES_FR_LAYER_ID, _points);

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
    _truncated = 0;
    _lastBoxKey = null;

    _overlayHost.setVisible(AMENITIES_FR_OVERLAY_SOURCE_ID, false);
    _overlayHost.setVisible(AMENITIES_FR_LABEL_SOURCE_ID, false);
    restoreSpriteOrder(viewer);
  },

  enable(viewer) {
    _enabled = true;
    _error = null;
    _points.show = true;
    if (_depDataSource) _depDataSource.show = true;
    _overlayHost.setVisible(AMENITIES_FR_OVERLAY_SOURCE_ID, true);
    _overlayHost.setVisible(AMENITIES_FR_LABEL_SOURCE_ID, true);
    installClickHandler(viewer);
    registerPickOwner(AMENITIES_FR_LAYER_ID, (pickedId) => _records.has(pickedId));

    if (!_cameraChangedAttached) {
      viewer.camera.changed.addEventListener(onCameraChanged);
      claimCameraSensitivity(viewer, AMENITIES_FR_LAYER_ID);
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
    _overlayHost.setVisible(AMENITIES_FR_OVERLAY_SOURCE_ID, false);
    _overlayHost.setVisible(AMENITIES_FR_LABEL_SOURCE_ID, false);

    if (_clickHandler) {
      _clickHandler.destroy();
      _clickHandler = null;
    }
    document.removeEventListener('keydown', onKeyDown);
    unregisterPickOwner(AMENITIES_FR_LAYER_ID);

    if (_cameraChangedAttached) {
      viewer.camera.changed.removeEventListener(onCameraChanged);
      releaseCameraSensitivity(viewer, AMENITIES_FR_LAYER_ID);
      _cameraChangedAttached = false;
    }
    if (_preRenderRemover) {
      _preRenderRemover();
      _preRenderRemover = null;
    }

    _points.show = false;
    _loading = false;
    _status = 'idle';
    _lastBoxKey = null;
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
    const label = buildAmenitiesLoadingLabel();
    if (label) stats.loadingLabel = label;
    if (_regime === 'national' ? _national?.stale : _summary?.stale) stats.stale = true;
    if (_error) stats.error = _error;
    return stats;
  },

  /** Viewport provenance for the attribution popover and analyst surfaces. */
  getViewportSummary() {
    return _summary ? { ..._summary } : null;
  },

  /** What the maillage actually drew, against what was in view, per family. */
  getMeshSummary() {
    if (!_meshPick) return null;
    return {
      shown: _meshPick.picked.length,
      inBox: _meshPick.inBox,
      budget: _meshPick.budget,
      cells: _meshPick.cells,
      thinned: _meshPick.thinned,
      perFamily: _meshPick.perFamily,
      nationalRows: _mesh?.rowCount ?? null,
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
   * screen, never both, plus the one row that has no swatch because it has no
   * dots.
   */
  getRowControls() {
    if (_regime === 'national') {
      if (!_national) return { chips: [], legend: [] };
      const shares = (_national.departements || [])
        .filter((row) => row.bin >= 0)
        .map((row) => row.share);
      const floor = shares.length ? Math.min(...shares) : 0;
      const labels = amenitiesDepartementBinLabels(_national.thresholds, floor);
      const counts = new Array(labels.length).fill(0);
      for (const row of _national.departements || []) {
        if (row.bin >= 0 && row.bin < counts.length) counts[row.bin] += 1;
      }
      const legend = labels.map((label, bin) => ({
        label,
        color: amenitiesDepartementColor(bin),
        count: counts[bin],
        blurb: bin === 0
          ? 'Le sixième le moins équipé. La part des communes du département où l’on trouve au moins un médecin, un commerce alimentaire, un bureau de poste, un bassin ou une gendarmerie.'
          : 'Un sixième des 96 départements. Bins par quantile. Pharmacies et hôpitaux ne sont PAS dans ce ratio : FINESS ne publie pas de code commune.',
      })).filter((row) => row.count > 0);
      return { chips: [], legend };
    }

    const tally = new Map();
    for (const record of _records.values()) {
      const family = record.site?.family;
      if (family) tally.set(family, (tally.get(family) || 0) + 1);
    }
    const meshRegime = _regime === 'maillage';
    const inView = new Map(
      (_meshPick?.perFamily || []).map((row) => [row.family, row.inBox]),
    );
    const legend = AMENITY_FAMILIES
      .filter((family) => tally.get(family) > 0)
      .map((family) => ({
        label: amenityFamilyLabel(family),
        color: amenityFamilyColor(family),
        count: tally.get(family),
        blurb: meshRegime && inView.has(family)
          // Naming the sample per family is the point: the mix on screen is NOT
          // the mix in view, because the thinning deliberately floors the rare
          // families. See `amenitiesMesh.js`.
          ? `${FAMILY_BLURBS[family]} Échantillon : ${fr(tally.get(family))} tracé${tally.get(family) > 1 ? 's' : ''} sur ${fr(inView.get(family))} dans la vue.`
          : FAMILY_BLURBS[family],
      }));
    // The refusal, given a row of its own so a reader who came looking for
    // schools is told where they are instead of concluding they are missing.
    legend.push({
      label: 'Écoles — non dessinées ici',
      color: null,
      count: 0,
      blurb: 'Les 79 743 lignes « enseignement » de la BPE ne sont pas reprises : schools-fr dessine 68 158 établissements du registre du ministère (clé UAI, que la BPE n’a pas) et sup-fr 6 914 sites du supérieur.',
    });
    return { chips: [], legend };
  },

  destroy(viewer) {
    if (_enabled) this.disable(viewer);
    else {
      clearSelection();
      _overlayHost.setVisible(AMENITIES_FR_OVERLAY_SOURCE_ID, false);
      _overlayHost.setVisible(AMENITIES_FR_LABEL_SOURCE_ID, false);
      if (_clickHandler) {
        _clickHandler.destroy();
        _clickHandler = null;
      }
      document.removeEventListener('keydown', onKeyDown);
      unregisterPickOwner(AMENITIES_FR_LAYER_ID);
    }
    if (_preRenderRemover) {
      _preRenderRemover();
      _preRenderRemover = null;
    }
    if (_depDataSource) {
      viewer.dataSources?.remove?.(_depDataSource, true);
      _depDataSource = null;
    }
    _depEntities = new Map();
    _depMeta = new Map();
    _depShapesPromise = null;
    if (_points) {
      unregisterSpriteCollection(AMENITIES_FR_LAYER_ID, _points);
      viewer.scene?.primitives?.remove?.(_points);
      _points = null;
    }
    _viewer = null;
    _national = null;
    _mesh = null;
  },
};

// --- Test seams -------------------------------------------------------------

/**
 * Drive the production paths with no WebGL viewer.
 *
 * Everything the layer draws goes through `_records`, `_national` and `_mesh`,
 * so a test that sets those three exercises the real card builders, the real
 * legend and the real stats rather than re-implementations of them.
 */
export function _setAmenitiesStateForTest({
  regime, records, national, mesh, meshPick, count, status, loading, error,
  summary, selectedId, enabled, viewer, points, overlayHost, depEntities, depMeta,
  truncated, lastUpdate,
} = {}) {
  if (regime !== undefined) _regime = regime;
  if (records !== undefined) _records = records instanceof Map ? records : new Map(records);
  if (national !== undefined) _national = national;
  if (mesh !== undefined) _mesh = mesh;
  if (meshPick !== undefined) _meshPick = meshPick;
  if (count !== undefined) _count = count;
  if (status !== undefined) _status = status;
  if (loading !== undefined) _loading = loading;
  if (error !== undefined) _error = error;
  if (summary !== undefined) _summary = summary;
  if (selectedId !== undefined) _selectedId = selectedId;
  if (enabled !== undefined) _enabled = enabled;
  if (viewer !== undefined) _viewer = viewer;
  if (points !== undefined) _points = points;
  if (overlayHost !== undefined) _overlayHost = overlayHost || DEFAULT_OVERLAY_HOST;
  if (depEntities !== undefined) _depEntities = depEntities;
  if (depMeta !== undefined) _depMeta = depMeta;
  if (truncated !== undefined) _truncated = truncated;
  if (lastUpdate !== undefined) _lastUpdate = lastUpdate;
}

export function _selectAmenityForTest(id) { selectSite(id); }
export function _selectAmenitiesDepartementForTest(code) { selectDepartement(code); }
export function _clearAmenitiesSelectionForTest() { clearSelection(); }
export function _amenitiesSelectedIdForTest() { return _selectedId; }
export function _amenitiesRowControlsForTest() { return amenitiesFranceLayer.getRowControls(); }
export function _amenitiesStatsForTest() { return amenitiesFranceLayer.getStats(); }
export function _amenitiesDetectablesForTest(options) { return collectDetectableObjects(options); }
export function _amenitiesReconcileForTest(payload) { reconcile(payload); }
export function _amenitiesReconcileMeshForTest(box) { reconcileMesh(box); }
export function _amenitiesUpdateRegimeForTest(viewer) { return updateRegime(viewer); }
export function _amenitiesTruncatedForTest() { return _truncated; }

export default amenitiesFranceLayer;
