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
 *   national — 96 painted départements, shaded by STUDENTS. Entered on the
 *              view's LATITUDE span (≥ 9.5°, metropolitan France being 9.8°
 *              tall), never on the larger of the two spans, which on a 16:10
 *              viewport is mostly a statement about the window's shape.
 *   sites    — every site in view, from the pack, with its card.
 *
 * ── What the colour means, and what the size means ──────────────────────────
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
  SUP_CYCLES,
  SUP_CYCLE_LABELS,
  SUP_KINDS,
  SUP_KIND_LABELS,
  SUP_PLACEMENT_LABELS,
} from './supFeed.js';

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
 * Choropleth ramp, low to high — a sequential violet scale.
 *
 * Violet because the layer's largest band is, so a reader zooming out from a
 * screen full of universities into the national view is not handed a colour
 * that means something else. Distinct from every other French layer's ramp,
 * and in particular from the `schools-fr` green one: the two national views
 * never draw at the same time, but an operator who toggles between them must
 * not carry one quantity's colour into the other's.
 */
const DEPARTEMENT_COLORS = Object.freeze([
  '#241452', '#35207d', '#4b2fae', '#6544dd', '#8e73f0', '#bfaefa',
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

function departementBinIndex(bin) {
  const index = Number(bin);
  if (!Number.isFinite(index) || index < 0) return -1;
  return Math.min(DEPARTEMENT_COLORS.length - 1, Math.floor(index));
}

/** Fill colour for one choropleth bin, or null for a département with none. */
export function supDepartementColor(bin) {
  const index = departementBinIndex(bin);
  return index < 0 ? null : DEPARTEMENT_COLORS[index];
}

/** Fill alpha for one choropleth bin. */
export function supDepartementAlpha(bin) {
  const index = departementBinIndex(bin);
  return index < 0 ? 0 : DEPARTEMENT_ALPHA[index];
}

/**
 * Legend labels for the quantile ramp, built from the measured thresholds.
 * @param {Array<number>} thresholds
 * @returns {Array<string>}
 */
export function supDepartementBinLabels(thresholds) {
  const bounds = Array.isArray(thresholds) ? thresholds : [];
  const labels = [];
  let previous = 0;
  for (const bound of bounds) {
    labels.push(`${fr(previous + 1)}–${fr(bound)}`);
    previous = bound;
  }
  labels.push(`> ${fr(previous)}`);
  return labels;
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

/** Card copy for one département at national altitude. */
export function buildSupDepartementLabel(row) {
  const details = [];
  details.push(`${fr(row.students)} étudiants`);
  details.push(`${fr(row.etabs)} établissements sur ${fr(row.sites)} sites`);
  const cycles = cycleLine(row.cycles);
  if (cycles) details.push(cycles);
  const mix = [];
  if (row.public > 0) mix.push(`${fr(row.public)} sites publics`);
  if (row.prive > 0) mix.push(`${fr(row.prive)} privés`);
  if (mix.length) details.push(mix.join(' · '));
  if (row.per1000Km2 > 0) {
    details.push(`${fr(Math.round(row.per1000Km2))} étudiants pour 1 000 km²`);
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

/** Ambient label for one département at national altitude. */
export function createSupDepartementOverlayEntry(row, position) {
  return {
    id: `sup-fr:dep:${row.code}`,
    position,
    variant: 'label',
    title: `${row.name} · ${fr(row.students)}`,
    accent: supDepartementColor(row.bin) || KIND_COLORS.autre,
    priority: Number(row.students) || 0,
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
    _overlayHost.clearSource(SUP_FR_OVERLAY_SOURCE_ID);
  }
}

function clearSelection() {
  if (_selectedId?.startsWith?.('dep:')) {
    repaintDepartements();
  } else if (_selectedId) {
    restoreRecordStyle(_records.get(_selectedId));
  }
  _selectedId = null;
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

function selectDepartement(code) {
  const row = (_national?.departements || []).find((entry) => entry.code === code);
  if (!row || !(row.students > 0)) return;
  if (_selectedId && _selectedId !== `dep:${code}`) clearSelection();
  _selectedId = `dep:${code}`;
  highlightSelectedDepartement();
  const anchor = _depMeta.get(code)?.anchor;
  if (anchor) {
    const entry = selectedOverlayEntry(
      `sup-fr:dep-card:${code}`,
      Cesium.Cartesian3.fromDegrees(anchor[0], anchor[1]),
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
    const source = await Cesium.GeoJsonDataSource.load(geojson, {
      clampToGround: true,
      fill: Cesium.Color.TRANSPARENT,
      stroke: Cesium.Color.TRANSPARENT,
      strokeWidth: 0,
    });
    source.name = 'Enseignement supérieur — étudiants par département';
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
    if (!(row.students > 0)) continue;
    const color = supDepartementColor(row.bin);
    if (!color) continue;
    let material = materials.get(row.bin);
    if (!material) {
      material = new Cesium.ColorMaterialProperty(
        Cesium.Color.fromCssColorString(color).withAlpha(supDepartementAlpha(row.bin)),
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
    _overlayHost.clearSource(SUP_FR_LABEL_SOURCE_ID);
    return;
  }
  const entries = [];
  for (const row of _national?.departements || []) {
    if (!(row.students > 0)) continue;
    const anchor = _depMeta.get(row.code)?.anchor;
    if (!anchor) continue;
    entries.push(createSupDepartementOverlayEntry(
      row,
      Cesium.Cartesian3.fromDegrees(anchor[0], anchor[1]),
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
    // The choropleth's own blind spot, stated where the choropleth is read.
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
   * Colour legend for the control-panel row — whichever scale is actually on
   * screen, never both.
   */
  getRowControls() {
    if (_regime === 'national') {
      if (!_national) return { chips: [], legend: [] };
      const labels = supDepartementBinLabels(_national.thresholds);
      const counts = new Array(labels.length).fill(0);
      for (const row of _national.departements || []) {
        if (row.bin >= 0 && row.bin < counts.length) counts[row.bin] += 1;
      }
      const legend = labels.map((label, bin) => ({
        label: `${label} étudiants`,
        color: supDepartementColor(bin),
        count: counts[bin],
        blurb: bin === labels.length - 1
          ? 'Départements du sixième supérieur. Le remplissage compte les ÉTUDIANTS, pas les sites — la moitié du supérieur français tient dans dix départements, ce qu’un compte de sites n’aurait pas dit.'
          : 'Un sixième des 96 départements. Bins par quantile : sur une échelle linéaire, Paris écrase tout le reste.',
      })).filter((row) => row.count > 0);
      return { chips: [], legend };
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
    if (!(row.students > 0)) continue;
    const anchor = _depMeta.get(row.code)?.anchor;
    if (!anchor) continue;
    entries.push(createSupDepartementOverlayEntry(row, { anchor }));
  }
  return selectSupLabelCohort(entries);
}

export default supFranceLayer;
