/**
 * @module petiteEnfanceFrance
 *
 * Where a childcare place is easy to find in France, and where it is not.
 *
 * The source is the CNAF's own *taux de couverture d'accueil du jeune enfant*
 * (data.caf.fr, Licence Ouverte 2.0) at the three scales it is published:
 * département, intercommunalité, commune. `petiteEnfanceFeed.js` holds the
 * reading of the seven files and every trap in them — including WHY this layer
 * draws a rate rather than a register of crèches, which is a measured answer
 * and not a shortcut. `petiteEnfanceDepartements.js` holds the national fold.
 * This file is the rendering.
 *
 * ── Two regimes, and one of them draws points on purpose ────────────────────
 *   national — the 96 bundled metropolitan département polygons, filled by
 *              how the département compares with France. Entered on the view's
 *              LATITUDE span (≥ 9.5°, metropolitan France being 9.8° tall).
 *   local    — the 1 250 intercommunalités as points at their administrative
 *              centre, plus the 1 061 communes the CNAF breaks out, below a
 *              closer altitude.
 *
 * The local regime draws POINTS and not a choropleth, and that is a stated
 * limit rather than an oversight. A rate belongs in an area fill, so the
 * honest thing would be EPCI polygons — but they are not bundled and not
 * free: `geo.api.gouv.fr` refuses an unfiltered contour request, so the pack
 * would be 1 255 separate calls, **66 MB and 3,1 million vertices** (measured),
 * simplified down to a new ~1,5 MB asset whose vintage drifts away from the
 * data's every January. Until that pack exists, this layer puts the number at
 * the area's centre and says on the card which area it belongs to, rather than
 * inventing a boundary or pretending the EPCI scale does not exist.
 *
 * The commune scale is points for a second, harder reason: the CNAF publishes
 * it only for communes over 10 000 inhabitants — **1 061 of France's ~34 875**
 * — so a commune choropleth would be 97% holes.
 *
 * ── What the colour means ───────────────────────────────────────────────────
 * How the area compares with France, as a ratio to the national rate of the
 * same edition (60,9 places per 100 children under three, in 2023). NOT a
 * quantile: this layer paints three nested scales, and a quantile band would
 * mean "the top sixth of what is on screen", so an area would change colour
 * as you zoomed without anything changing about it. Anchoring on the one
 * national figure makes a colour mean the same thing at every zoom.
 *
 * ── What the size means, and the one number it is not ───────────────────────
 * Places. A dot's area is the total number of formal childcare places offered
 * in that area, so a big dot is a lot of childcare and a pale dot is not
 * enough of it per child — the two channels answer different questions on
 * purpose. Neither is a count of crèches: nothing in open data is.
 */

import * as Cesium from 'cesium';
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
  PE_BANDS,
  PE_BAND_LABELS,
  PE_BAND_RATIOS,
  PE_MODES,
  PE_MODE_LABELS,
  PE_MODE_SHORT,
  PE_SCALE_LABELS,
} from './petiteEnfanceFeed.js';

export const PE_FR_LAYER_ID = 'petite-enfance-fr';

export const PE_FR_OVERLAY_SOURCE_ID = 'petite-enfance-fr-selected';
export const PE_FR_OVERLAY_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 1,
  moving: false,
});
export const PE_FR_LABEL_SOURCE_ID = 'petite-enfance-fr-departements';
export const PE_FR_LABEL_COHORT_LIMIT = 14;
export const PE_FR_LABEL_COLLISION_CAPACITY = 12;

const DEPARTEMENTS_URL = new URL(
  './local_data/france_departements/departements.geojson',
  import.meta.url,
).href;

// --- Activation / load gating ----------------------------------------------
/** View LATITUDE span (degrees) at or above which the choropleth answers. */
const NATIONAL_ENTER_SPAN_DEG = 9.5;
const NATIONAL_EXIT_SPAN_DEG = 8;
/**
 * View latitude span below which communes are drawn alongside their EPCI.
 * ~1.1° is a large metropolitan area on screen, which is the first zoom at
 * which "which commune" is a question a reader can even ask.
 */
const COMMUNE_SPAN_DEG = 1.1;
const CAMERA_DEBOUNCE_MS = 450;
/**
 * Poll cadence (ms). The CNAF publishes this once a year, in January, so
 * anything faster re-asks a question whose answer cannot have changed.
 */
const POLL_INTERVAL_MS = 6 * 60 * 60_000;
const REQUEST_TIMEOUT_MS = 120_000;
/** Above the whole register (1 250 + 1 061), so it never bites in production. */
const MAX_RENDERED_AREAS = 4_000;
const POINT_LIFT_M = 2.5;
const GROUND_WARM_LIMIT = 400;

// --- Presentation -----------------------------------------------------------
/**
 * The band ramp: a DIVERGING scale, because the quantity has a meaningful
 * midpoint — the national rate — and the question a reader actually asks is
 * "is it worse than average here?", which a sequential ramp cannot answer
 * without counting swatches.
 *
 * Orange below France, blue above, with the break falling exactly between
 * index 2 and index 3 where the ratio crosses 1. No green anywhere, on
 * purpose: Vigilance's ramp is green→red and the schools choropleth is
 * sequential green, and this map must not be mistaken for either at a glance.
 * It is also not the charge-point ramp, which runs blue→red the other way.
 */
const BAND_COLORS = Object.freeze({
  'tres-bas': '#8c2d04',
  bas: '#e6550d',
  'sous-moyenne': '#fdae6b',
  'sur-moyenne': '#9ecae1',
  haut: '#4292c6',
  'tres-haut': '#08519c',
});

/** Fill alpha per band. The extremes carry more weight, both ways. */
const BAND_ALPHA = Object.freeze({
  'tres-bas': 0.68,
  bas: 0.60,
  'sous-moyenne': 0.50,
  'sur-moyenne': 0.50,
  haut: 0.60,
  'tres-haut': 0.68,
});

const SELECTED_COLOR = '#00ffff';
/**
 * EPCI dots outline in white, commune dots in black — the two scales are
 * nested, so at city zoom a commune dot sits inside its own EPCI dot, and the
 * ring is what tells a reader which of the two numbers they are reading.
 */
const EPCI_OUTLINE = Cesium.Color.WHITE.withAlpha(0.75);
const COMMUNE_OUTLINE = Cesium.Color.BLACK.withAlpha(0.55);
const EPCI_POINT_MIN_PX = 7;
const EPCI_POINT_MAX_PX = 22;
const COMMUNE_POINT_MIN_PX = 5;
const COMMUNE_POINT_MAX_PX = 15;
const SELECTED_POINT_PX = 24;
/**
 * Places at which a dot reaches full size.
 *
 * 40 000, measured rather than rounded to taste: the largest single EPCI
 * offer in the file is the Métropole de Lyon, and a ceiling at the maximum
 * would spend the whole top of the scale on one dot. Square-rooted, because
 * the eye reads area.
 */
const SIZE_CEILING_PLACES = 40_000;

/** One-line explanations behind each band swatch. */
const BAND_BLURBS = Object.freeze({
  'tres-bas': 'Moins de 60 % de la moyenne nationale. Aucun département métropolitain n’y figure — ils sont tous outre-mer.',
  bas: 'Entre 60 et 85 % de la moyenne. Trouver une place y demande une recherche, pas un choix.',
  'sous-moyenne': 'Entre 85 et 100 % de la moyenne nationale.',
  'sur-moyenne': 'Entre 100 et 115 % de la moyenne nationale.',
  haut: 'Entre 115 et 140 % de la moyenne. L’offre y dépasse nettement le pays.',
  'tres-haut': 'Plus de 140 % de la moyenne. Presque toujours porté par l’assistante maternelle, pas par la crèche.',
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
let _communesShown = 0;

// --- Colour and size --------------------------------------------------------

/** Hex for one band, or null when the area has no published rate. */
export function peBandColor(band) {
  return BAND_COLORS[band] || null;
}

/** Fill alpha for one band. */
export function peBandAlpha(band) {
  return BAND_ALPHA[band] ?? 0;
}

/** French label for one band. */
export function peBandLabel(band) {
  return PE_BAND_LABELS[band] || 'Taux non publié';
}

/**
 * Legend labels for the ramp, expressed against the edition's national rate.
 *
 * Built from the ratios rather than typed, so the legend and the colours can
 * never disagree, and so the numbers move with the national rate between
 * editions instead of going quietly stale.
 */
export function peBandRangeLabels(national) {
  const reference = Number(national);
  const has = Number.isFinite(reference) && reference > 0;
  const at = (ratio) => (has ? `${(ratio * reference).toFixed(0)}` : `${Math.round(ratio * 100)} %`);
  const labels = [];
  for (let i = 0; i < PE_BAND_RATIOS.length; i += 1) {
    labels.push(i === 0
      ? `< ${at(PE_BAND_RATIOS[0])}`
      : `${at(PE_BAND_RATIOS[i - 1])}–${at(PE_BAND_RATIOS[i])}`);
  }
  labels.push(`> ${at(PE_BAND_RATIOS[PE_BAND_RATIOS.length - 1])}`);
  return labels;
}

/**
 * Dot size for one area, by the number of places it offers.
 *
 * Square-rooted and capped — see `SIZE_CEILING_PLACES`. Communes draw on a
 * strictly smaller scale than the EPCI they sit inside, so a nested pair never
 * reads as one dot.
 */
export function pePointSize(places, scale = 'epci') {
  const commune = scale === 'com';
  const min = commune ? COMMUNE_POINT_MIN_PX : EPCI_POINT_MIN_PX;
  const max = commune ? COMMUNE_POINT_MAX_PX : EPCI_POINT_MAX_PX;
  const count = Number(places);
  if (!Number.isFinite(count) || count <= 0) return min;
  const scaled = Math.sqrt(Math.min(count, SIZE_CEILING_PLACES)) / Math.sqrt(SIZE_CEILING_PLACES);
  return min + (max - min) * scaled;
}

// --- Camera -----------------------------------------------------------------

/** View box for the local regime — the camera rectangle, padded. */
export function cameraPeBox(viewer, padFraction = 0.12) {
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

/** A view rectangle's latitude span, in degrees; Infinity past the limb. */
export function peViewSpanDeg(viewer) {
  const rectangle = viewer?.camera?.computeViewRectangle?.();
  if (!rectangle) return Infinity;
  const lat = Cesium.Math.toDegrees(rectangle.north - rectangle.south);
  return Number.isFinite(lat) ? lat : Infinity;
}

/** Whether one area falls inside a box (edges count). */
export function peAreaInBox(area, box) {
  if (!box) return false;
  return area.lat >= box.south && area.lat <= box.north
    && area.lon >= box.west && area.lon <= box.east;
}

/** Which regime the camera is in, with hysteresis at the boundary. */
function updateRegime(viewer) {
  const span = peViewSpanDeg(viewer);
  if (_regime === 'national') {
    if (span < NATIONAL_EXIT_SPAN_DEG) _regime = 'local';
  } else if (span >= NATIONAL_ENTER_SPAN_DEG) {
    _regime = 'national';
  }
  return _regime;
}

function areaPosition(area) {
  const floor = cachedGroundFloor(area.lat, area.lon);
  const height = (Number.isFinite(floor) ? floor : 0) + POINT_LIFT_M;
  return Cesium.Cartesian3.fromDegrees(area.lon, area.lat, height);
}

/** French thousands separator, matching the rest of the French packs. */
function fr(value) {
  return Number(value).toLocaleString('fr-FR');
}

/** A published rate, with the French decimal comma. */
function rate(value) {
  return Number.isFinite(value) ? value.toFixed(1).replace('.', ',') : null;
}

// --- Cards ------------------------------------------------------------------

/**
 * The mode breakdown as card lines — the five leaves, largest first, each with
 * its rate and its places.
 *
 * Only the leaves. The CNAF also publishes two subtotals (`eaje`, `ind`) that
 * are sums of these, and printing both on one card would make the same
 * children appear twice to a reader adding the column up.
 */
function modeLines(area) {
  const rows = [];
  for (const mode of PE_MODES) {
    const value = Number(area?.modes?.[mode]);
    if (!Number.isFinite(value) || value <= 0) continue;
    const places = Number(area?.places?.[mode]);
    rows.push({ mode, value, places: Number.isFinite(places) ? places : null });
  }
  rows.sort((a, b) => b.value - a.value);
  return rows.map((row) => {
    const places = row.places !== null ? ` · ${fr(row.places)} places` : '';
    return `${PE_MODE_LABELS[row.mode]} : ${rate(row.value)}${places}`;
  });
}

/** The one line that says how this area sits against France. */
function comparisonLine(area, national) {
  if (!Number.isFinite(area?.rate)) return 'Taux non publié pour cette zone';
  const parts = [`${rate(area.rate)} places pour 100 enfants de moins de 3 ans`];
  if (Number.isFinite(national) && national > 0) {
    const ratio = area.rate / national;
    const pct = Math.round(Math.abs(ratio - 1) * 100);
    if (pct === 0) parts.push('au niveau de la moyenne nationale');
    else parts.push(`${pct} % ${ratio > 1 ? 'au-dessus' : 'en dessous'} de la moyenne nationale (${rate(national)})`);
  }
  return parts.join(' — ');
}

/**
 * Card copy for one selected area. Every line is a published value or a stated
 * absence of one; nothing here is inferred.
 */
export function buildPeSelectionLabel(record) {
  const area = record?.area || {};
  const national = record?.national ?? null;
  const details = [];
  const title = area.name || area.code || 'Zone';

  // The scale is the first thing on the card, because three nested scales sit
  // under the cursor and a rate is meaningless without knowing whose it is.
  const scale = PE_SCALE_LABELS[area.scale] || 'Zone';
  details.push(record?.year ? `${scale} · millésime ${record.year}` : scale);

  details.push(comparisonLine(area, national));

  if (Number.isFinite(area.totalPlaces)) {
    details.push(`${fr(area.totalPlaces)} places d’accueil formel au total`);
  }

  const lines = modeLines(area);
  if (lines.length) details.push(...lines);

  if (area.dominant) {
    details.push(`Mode dominant : ${PE_MODE_SHORT[area.dominant]}`);
  }

  const where = [area.deptName, area.region].filter(Boolean).join(' · ');
  if (where && area.scale !== 'dep') details.push(where);

  // The commune scale exists only above 10 000 inhabitants, and a reader
  // looking at one needs to know it is not a complete map of communes.
  if (area.scale === 'com') {
    details.push('⚠ Échelle communale publiée seulement pour les communes de plus de 10 000 habitants');
  }
  if (area.scale === 'epci') {
    details.push('Point placé au centre de l’intercommunalité — le taux vaut pour tout son territoire');
  }

  if (area.code) details.push(`Code ${area.code}`);
  return [title, ...details].join('\n');
}

/** Card copy for one département at national altitude. */
export function buildPeDepartementLabel(row, national) {
  const details = [];
  details.push(comparisonLine(row, national));
  if (Number.isFinite(row.totalPlaces)) {
    details.push(`${fr(row.totalPlaces)} places d’accueil formel`);
  }
  details.push(...modeLines(row));
  if (row.dominant) details.push(`Mode dominant : ${PE_MODE_SHORT[row.dominant]}`);
  if (row.region) details.push(row.region);
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

/** Protected selected-area entry for the shared overlay host. */
export function createPeSelectedOverlayEntry(record) {
  const position = record?.position;
  if (!record?.id || !position) return null;
  return selectedOverlayEntry(record.id, position, buildPeSelectionLabel(record));
}

/** Ambient label for one département at national altitude. */
export function createPeDepartementOverlayEntry(row, position) {
  return {
    id: `petite-enfance-fr:dep:${row.code}`,
    position,
    variant: 'label',
    title: `${row.name} · ${rate(row.rate) ?? '—'}`,
    accent: peBandColor(row.band) || '#9aa4ad',
    // The most extreme areas earn a label, both ways round: a diverging ramp
    // whose labels all sat at one end would report half the finding.
    priority: Number.isFinite(row.ratio) ? Math.abs(row.ratio - 1) * 1000 : 0,
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

/** Keep the most extreme départements, with stable identity as tie-break. */
export function selectPeLabelCohort(entries, limit = PE_FR_LABEL_COHORT_LIMIT) {
  const cap = Math.max(0, Math.min(PE_FR_LABEL_COHORT_LIMIT, Math.floor(Number(limit) || 0)));
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
    _overlayHost.clearSource(PE_FR_OVERLAY_SOURCE_ID);
  }
}

function clearSelection() {
  if (_selectedId?.startsWith?.('dep:')) {
    repaintDepartements();
  } else if (_selectedId) {
    restoreRecordStyle(_records.get(_selectedId));
  }
  _selectedId = null;
  _overlayHost.clearSource(PE_FR_OVERLAY_SOURCE_ID);
  governorRequestRender('petite-enfance-fr-deselect');
}

function selectArea(id) {
  const record = _records.get(id);
  if (!record) return;
  if (_selectedId && _selectedId !== id) clearSelection();
  _selectedId = id;
  if (record.point) {
    record.point.color = Cesium.Color.fromCssColorString(SELECTED_COLOR);
    record.point.pixelSize = SELECTED_POINT_PX;
  }
  const entry = createPeSelectedOverlayEntry(record);
  if (entry) {
    _overlayHost.setEntries(PE_FR_OVERLAY_SOURCE_ID, [entry], PE_FR_OVERLAY_SOURCE_OPTIONS);
  }
  governorRequestRender('petite-enfance-fr-select');
}

function selectDepartement(code) {
  const row = (_national?.departements || []).find((entry) => entry.code === code);
  if (!row || !row.band) return;
  if (_selectedId && _selectedId !== `dep:${code}`) clearSelection();
  _selectedId = `dep:${code}`;
  highlightSelectedDepartement();
  const anchor = _depMeta.get(code)?.anchor;
  if (anchor) {
    const entry = selectedOverlayEntry(
      `petite-enfance-fr:dep-card:${code}`,
      Cesium.Cartesian3.fromDegrees(anchor[0], anchor[1]),
      buildPeDepartementLabel(row, _national?.national),
    );
    _overlayHost.setEntries(PE_FR_OVERLAY_SOURCE_ID, [entry], PE_FR_OVERLAY_SOURCE_OPTIONS);
  }
  governorRequestRender('petite-enfance-fr-select-dep');
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
      selectArea(id);
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
  const entry = createPeSelectedOverlayEntry(record);
  if (entry) {
    _overlayHost.setEntries(PE_FR_OVERLAY_SOURCE_ID, [entry], PE_FR_OVERLAY_SOURCE_OPTIONS);
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
    source.name = 'Accueil du jeune enfant — taux de couverture par département';
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
    const color = peBandColor(row.band);
    if (!color) continue;
    let material = materials.get(row.band);
    if (!material) {
      material = new Cesium.ColorMaterialProperty(
        Cesium.Color.fromCssColorString(color).withAlpha(peBandAlpha(row.band)),
      );
      materials.set(row.band, material);
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
  // A département the CNAF does not cover is drawn as absence rather than as
  // one end of the diverging ramp — which would be the worst possible default,
  // because both ends of this ramp are strong claims.
  for (const [code, parts] of _depEntities) {
    if (painted.has(code)) continue;
    for (const entity of parts) entity.show = false;
  }
  highlightSelectedDepartement();
  _viewer?.scene?.requestRender?.();
}

function publishDepartementOverlay() {
  if (!_enabled || _regime !== 'national') {
    _overlayHost.clearSource(PE_FR_LABEL_SOURCE_ID);
    return;
  }
  const entries = [];
  for (const row of _national?.departements || []) {
    if (!row.band) continue;
    const anchor = _depMeta.get(row.code)?.anchor;
    if (!anchor) continue;
    entries.push(createPeDepartementOverlayEntry(
      row,
      Cesium.Cartesian3.fromDegrees(anchor[0], anchor[1]),
    ));
  }
  _overlayHost.setEntries(PE_FR_LABEL_SOURCE_ID, selectPeLabelCohort(entries), {
    cohortLimit: PE_FR_LABEL_COHORT_LIMIT,
    collisionCapacity: PE_FR_LABEL_COLLISION_CAPACITY,
    moving: false,
  });
}

async function fetchJson(path, validate) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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
  _nationalPromise = fetchJson('/api/petite-enfance-fr/departements', (p) => Array.isArray(p?.departements))
    .then((payload) => {
      _national = payload;
      _nationalError = null;
      return payload;
    })
    .catch((error) => {
      if (error?.name !== 'AbortError') {
        console.warn('[Data:PetiteEnfance-FR] national rollup failed:', error?.message || error);
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
  _overlayHost.clearSource(PE_FR_LABEL_SOURCE_ID);
}

async function loadNational({ force = false } = {}) {
  _error = null;
  clearAreas();
  if (force) {
    _national = null;
    _nationalPainted = false;
  }
  _loading = !_national;
  const generation = _requestGeneration;
  try {
    await ensureDepartementShapes();
  } catch (error) {
    console.warn('[Data:PetiteEnfance-FR] département polygons failed:', error?.message || error);
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
  governorRequestRender('petite-enfance-fr-national');
}

// --- Local regime -----------------------------------------------------------

/**
 * The EPCI and commune areas, fetched once.
 *
 * Deferred until the camera leaves the choropleth: the national view is
 * answered by a ~35 KB rollup, and an operator who never zooms in should not
 * pay for a pack they will not see.
 */
async function ensurePack() {
  if (_pack) return _pack;
  if (_packPromise) return _packPromise;
  _packPromise = fetchJson('/api/petite-enfance-fr/areas', (p) => Array.isArray(p?.areas))
    .then((payload) => {
      _pack = payload;
      _packError = null;
      return payload;
    })
    .catch((error) => {
      if (error?.name !== 'AbortError') {
        console.warn('[Data:PetiteEnfance-FR] area pack failed:', error?.message || error);
        _packError = error?.message || 'area pack unavailable';
      }
      return null;
    })
    .finally(() => { _packPromise = null; });
  return _packPromise;
}

/**
 * Draw the areas in view.
 *
 * EPCI always; communes only below `COMMUNE_SPAN_DEG`, because a commune point
 * at regional zoom is a dot inside a dot that says nothing the EPCI has not
 * already said, and because the commune scale is a city-level detail by
 * construction.
 */
function reconcile(box, span) {
  clearSelection();
  _points.removeAll();
  _records.clear();

  const withCommunes = Number.isFinite(span) && span <= COMMUNE_SPAN_DEG;
  const national = _pack?.national ?? null;
  const year = _pack?.year ?? null;
  const warm = [];
  let inView = 0;
  let communes = 0;

  for (const area of _pack?.areas || []) {
    if (!Number.isFinite(area?.lat) || !Number.isFinite(area?.lon)) continue;
    if (area.scale === 'com' && !withCommunes) continue;
    if (!peAreaInBox(area, box)) continue;
    inView += 1;
    if (_records.size >= MAX_RENDERED_AREAS) continue;
    const id = area.id;
    if (!id || _records.has(id)) continue;
    const color = peBandColor(area.band) || '#9aa4ad';
    const size = pePointSize(area.totalPlaces, area.scale);
    const position = areaPosition(area);
    const point = _points.add({
      id,
      position,
      color: Cesium.Color.fromCssColorString(color),
      pixelSize: size,
      outlineColor: area.scale === 'com' ? COMMUNE_OUTLINE : EPCI_OUTLINE,
      outlineWidth: area.scale === 'com' ? 1 : 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      translucencyByDistance: new Cesium.NearFarScalar(500, 1.0, 600_000, 0.45),
    });
    if (area.scale === 'com') communes += 1;
    _records.set(id, {
      id, area, national, year, point, position, baseColor: color, baseSize: size,
    });
    warm.push(area);
  }

  _inView = inView;
  _communesShown = communes;
  _count = _records.size;
  warmGroundFloor(warm.slice(0, GROUND_WARM_LIMIT));
  governorRequestRender('petite-enfance-fr-reconcile');
}

function clearAreas() {
  if (_selectedId && !_selectedId.startsWith('dep:')) clearSelection();
  if (_points) _points.removeAll();
  _records.clear();
  _count = 0;
  _inView = 0;
  _communesShown = 0;
}

async function loadLocal(box, span, { force = false } = {}) {
  hideDepartements();
  _nationalPainted = false;
  dropDepartementSelection();
  _error = null;
  if (force) _pack = null;
  _loading = !_pack;
  const generation = ++_requestGeneration;
  await ensurePack();
  if (generation !== _requestGeneration || !_enabled || _regime !== 'local') return;
  _loading = false;
  if (!_pack) {
    _error = _packError || 'area pack unavailable';
    _status = 'error';
    return;
  }
  reconcile(box, span);
  _lastUpdate = Number(_pack.fetchedAt) || Date.now();
  _status = _count > 0 ? 'ready' : 'empty';
}

async function loadViewport({ force = false } = {}) {
  if (!_enabled || !_viewer) return;
  const regime = updateRegime(_viewer);
  const box = regime === 'national' ? null : cameraPeBox(_viewer);
  // A camera inside the local regime that gives no usable rectangle has
  // nothing to filter against; the choropleth is the honest fallback.
  if (regime === 'national' || !box) {
    _regime = 'national';
    await loadNational({ force });
    return;
  }
  await loadLocal(box, peViewSpanDeg(_viewer), { force });
}

function onCameraChanged() {
  clearTimeout(_cameraDebounceTimer);
  _cameraDebounceTimer = setTimeout(() => {
    void loadViewport();
  }, CAMERA_DEBOUNCE_MS);
}

function collectDetectableObjects(options = {}) {
  if (!_enabled || !_points?.show || !_records.size) return [];
  const records = [...dispatchable()];
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
      id: Number.isFinite(record.area?.rate) ? `${rate(record.area.rate)} / 100` : (record.area?.name || ''),
      type: 'Childcare Area',
      skipLabel: record.id === _selectedId,
    });
    if (result.length >= maxCount) break;
  }
  return result;
}

function* dispatchable() {
  for (const record of _records.values()) {
    if (!record.point?.show && record.id !== _selectedId) continue;
    yield record;
  }
}

/** One line under the layer's toggle: what this view actually contains. */
export function buildPeLoadingLabel({
  regime = _regime,
  status = _status,
  loading = _loading,
  count = _count,
  inView = _inView,
  communes = _communesShown,
  national = _national,
} = {}) {
  if (regime === 'national') {
    if (loading) return 'lecture du registre national...';
    if (status === 'error') return '';
    if (!national) return '';
    const parts = [`${national.painted} départements · moyenne nationale ${rate(national.national)} places / 100 enfants`];
    // The choropleth's own blind spot, stated where the choropleth is read —
    // and here it is the finding, not a footnote.
    if (national.unpainted?.length) {
      parts.push(`${national.unpainted.length} territoires ultramarins non cartographiés, tous sous la moyenne`);
    }
    return parts.join(' · ');
  }
  if (loading) return 'lecture du registre national...';
  if (status === 'error') return '';
  if (!inView) return 'aucune zone dans cette vue';
  const parts = [`${fr(count - communes)} intercommunalités`];
  if (communes > 0) parts.push(`${fr(communes)} communes`);
  if (inView > count) parts.push(`${fr(inView - count)} non tracées`);
  return parts.join(' · ');
}

// --- Layer ------------------------------------------------------------------

const petiteEnfanceFranceLayer = {
  id: PE_FR_LAYER_ID,
  name: 'Accueil du jeune enfant (FR)',
  icon: '🧸',
  source: 'Taux de couverture — Cnaf',
  updateInterval: POLL_INTERVAL_MS,

  init(viewer) {
    _viewer = viewer;
    _points = new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT });
    _points.show = false;
    viewer.scene.primitives.add(_points);
    registerSpriteCollection(PE_FR_LAYER_ID, _points);

    _enabled = false;
    _records = new Map();
    _selectedId = null;
    _count = 0;
    _inView = 0;
    _communesShown = 0;
    _lastUpdate = null;
    _loading = false;
    _error = null;
    _status = 'idle';
    _regime = 'national';
    _nationalPainted = false;

    _overlayHost.setVisible(PE_FR_OVERLAY_SOURCE_ID, false);
    _overlayHost.setVisible(PE_FR_LABEL_SOURCE_ID, false);
    restoreSpriteOrder(viewer);
  },

  enable(viewer) {
    _enabled = true;
    _error = null;
    _points.show = true;
    if (_depDataSource) _depDataSource.show = true;
    _overlayHost.setVisible(PE_FR_OVERLAY_SOURCE_ID, true);
    _overlayHost.setVisible(PE_FR_LABEL_SOURCE_ID, true);
    installClickHandler(viewer);
    registerPickOwner(PE_FR_LAYER_ID, (pickedId) => _records.has(pickedId));

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
    clearAreas();
    hideDepartements();
    if (_depDataSource) _depDataSource.show = false;
    _overlayHost.setVisible(PE_FR_OVERLAY_SOURCE_ID, false);
    _overlayHost.setVisible(PE_FR_LABEL_SOURCE_ID, false);

    if (_clickHandler) {
      _clickHandler.destroy();
      _clickHandler = null;
    }
    document.removeEventListener('keydown', onKeyDown);
    unregisterPickOwner(PE_FR_LAYER_ID);

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
    const label = buildPeLoadingLabel();
    if (label) stats.loadingLabel = label;
    if (_regime === 'national' ? _national?.stale : _pack?.stale) stats.stale = true;
    if (_error) stats.error = _error;
    return stats;
  },

  /** Provenance for the attribution popover and analyst surfaces. */
  getViewportSummary() {
    if (!_pack) return null;
    const { areas, ...summary } = _pack;
    return {
      ...summary, inView: _inView, drawn: _count, communes: _communesShown,
    };
  },

  /** National rollup, for the analyst and for tests. */
  getNationalSummary() {
    if (!_national) return null;
    const { departements, ...rest } = _national;
    return { ...rest, regime: _regime };
  },

  /** Colour legend for the control-panel row. */
  getRowControls() {
    const national = _regime === 'national' ? _national?.national : _pack?.national;
    const labels = peBandRangeLabels(national);
    const counts = Object.fromEntries(PE_BANDS.map((band) => [band, 0]));
    if (_regime === 'national') {
      for (const row of _national?.departements || []) {
        if (row.band) counts[row.band] += 1;
      }
    } else {
      for (const record of _records.values()) {
        const band = record.area?.band;
        if (band) counts[band] += 1;
      }
    }
    const legend = PE_BANDS
      .map((band, index) => ({
        label: `${labels[index]} places / 100 enfants`,
        color: peBandColor(band),
        count: counts[band],
        blurb: BAND_BLURBS[band],
      }))
      .filter((row) => row.count > 0);
    return { chips: [], legend };
  },

  destroy(viewer) {
    if (_enabled) this.disable(viewer);
    else {
      clearSelection();
      _overlayHost.setVisible(PE_FR_OVERLAY_SOURCE_ID, false);
      _overlayHost.setVisible(PE_FR_LABEL_SOURCE_ID, false);
      if (_clickHandler) {
        _clickHandler.destroy();
        _clickHandler = null;
      }
      document.removeEventListener('keydown', onKeyDown);
      unregisterPickOwner(PE_FR_LAYER_ID);
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
      unregisterSpriteCollection(PE_FR_LAYER_ID, _points);
      viewer.scene.primitives.remove(_points);
      _points = null;
    }
    _records.clear();
    _viewer = null;
  },
};

/** Seed rendered records so selection/card/legend paths run without WebGL. */
export function _setPeStateForTest({
  viewer, records, overlayHost, status, count, regime, national, depEntities, depMeta,
  pack, inView, communes,
} = {}) {
  _viewer = viewer || null;
  _records = new Map((records || []).map((record) => [record.id, record]));
  _selectedId = null;
  _overlayHost = overlayHost || DEFAULT_OVERLAY_HOST;
  _status = status || 'ready';
  _count = Number.isFinite(count) ? count : _records.size;
  _inView = Number.isFinite(inView) ? inView : _count;
  _communesShown = Number.isFinite(communes) ? communes : 0;
  _loading = false;
  _regime = regime || 'local';
  _national = national || null;
  _pack = pack || null;
  _depEntities = new Map(depEntities || []);
  _depMeta = new Map(depMeta || []);
  _enabled = true;
}

/** Exercise the production selection path in focused runtime tests. */
export function _selectPeForTest(id) {
  selectArea(id);
}

/** Exercise the production département selection path. */
export function _selectPeDepartementForTest(code) {
  selectDepartement(code);
}

/** Exercise the production clear path and restore the production host seam. */
export function _clearPeSelectionForTest() {
  clearSelection();
  _overlayHost = DEFAULT_OVERLAY_HOST;
  _national = null;
  _nationalPainted = false;
  _pack = null;
  _depEntities = new Map();
  _depMeta = new Map();
  _regime = 'local';
  _enabled = false;
}

/** Row-control legend, for tests that do not construct a viewer. */
export function _peRowControlsForTest() {
  return petiteEnfanceFranceLayer.getRowControls();
}

/** Ambient département label cohort, for tests that do not construct a viewer. */
export function _peDepartementOverlayForTest() {
  const entries = [];
  for (const row of _national?.departements || []) {
    if (!row.band) continue;
    const anchor = _depMeta.get(row.code)?.anchor;
    if (!anchor) continue;
    entries.push(createPeDepartementOverlayEntry(row, { anchor }));
  }
  return selectPeLabelCohort(entries);
}

export default petiteEnfanceFranceLayer;
