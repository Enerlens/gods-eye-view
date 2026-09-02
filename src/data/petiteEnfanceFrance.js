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
 * ── Two regimes, and neither of them draws a point ──────────────────────────
 *   national — the 96 bundled metropolitan département polygons, filled by
 *              how the département compares with France. It holds from orbit
 *              all the way down to {@link NATIONAL_EXIT_SPAN_DEG}.
 *   local    — the intercommunalité and commune TERRITORIES themselves, from
 *              `geo.api.gouv.fr` commune outlines, fetched a département at a
 *              time for the départements in view.
 *
 * This layer used to draw the local scales as dots at each area's
 * administrative centre, and that was wrong in a way worth recording. A
 * coverage rate is a property of a TERRITORY; drawn as a dot it becomes a
 * property of a coordinate, and the coordinate is a centroid — a field outside
 * the seat commune of a rural intercommunalité, a spot in the 5th for a
 * Métropole. Nothing on screen said where the number stopped applying.
 *
 * ── How an EPCI is drawn when it has no contour ─────────────────────────────
 * `geo.api.gouv.fr` publishes no EPCI outline and refuses an unfiltered
 * contour request. It does publish `codeEpci` alongside every commune, at no
 * extra call — so an intercommunalité is filled as its MEMBER COMMUNES, all
 * carrying one colour and no internal outline, which reads as one territory
 * rather than as a mosaic. What is missing is the union's outer stroke, and
 * nothing here fakes one.
 *
 * ── Where the two grains meet ───────────────────────────────────────────────
 * The CNAF publishes the commune scale only above 10 000 inhabitants —
 * **1 061 of France's ~34 875** — so it can never tile anything. Below
 * {@link COMMUNE_SPAN_DEG} those 1 061 communes are CUT OUT of their EPCI's
 * wash and filled with their own rate instead. The two grains therefore never
 * overlap: every piece of ground carries exactly one number, the finest one
 * published for it, and the outline says which. Above that span the EPCI wash
 * is continuous.
 *
 * ── What the map no longer says, and why that is the right trade ────────────
 * The dots were sized by total places, so the layer used to answer "how much
 * childcare is here?" and "how much per child?" at once. A fill has one
 * channel and it is spent on the rate — the question the indicator exists to
 * answer. The places count is on every card, and the alternative (a dot
 * floating over its own territory) is exactly the thing this regime removed.
 *
 * ── What the colour means ───────────────────────────────────────────────────
 * How the area compares with France, as a ratio to the national rate of the
 * same edition (60,9 places per 100 children under three, in 2023). NOT a
 * quantile: this layer paints three nested scales, and a quantile band would
 * mean "the top sixth of what is on screen", so an area would change colour
 * as you zoomed without anything changing about it. Anchoring on the one
 * national figure makes a colour mean the same thing at every zoom.
 *
 * And it is never a count of crèches: nothing in open data is one. The
 * measurement behind that sentence — 210 CNAF datasets, FINESS, the BPE and
 * Sirene, all checked — is in `petiteEnfanceFeed.js`.
 */

import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import { ringAnchor } from './communeContours.js';
import { parseDepartements } from './meteoFranceVigilance.js';
import { boxKey, snapBoxOutward } from './viewportBox.js';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import {
  PE_BANDS,
  PE_BOX_STEP_DEG,
  PE_GEO_SOURCE,
  PE_MAX_BOX_DEG,
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
/**
 * View LATITUDE span (degrees) at or above which the choropleth answers.
 *
 * It used to be 9,5° — the height of metropolitan France — because below it
 * the dots took over. What is below it now is real geometry, and the ceiling
 * is how much of it a view can hold: measured on the ground, a 0,9° box holds
 * about 1 450 communes, which is the same order as the parcel batches this
 * app already draws. So the choropleth answers everything above that and the
 * territories take over below it.
 *
 * The exit threshold is lower than the entry one so a camera resting on the
 * boundary does not swap the whole map back and forth on sub-pixel drift.
 */
export const NATIONAL_ENTER_SPAN_DEG = PE_MAX_BOX_DEG;
export const NATIONAL_EXIT_SPAN_DEG = 0.9;
/**
 * View latitude span below which communes are cut out of their EPCI's wash.
 *
 * 0,45° is about 50 km of France — a metropolitan area and its ring — which
 * is the first zoom at which "which commune" is a question a reader can act
 * on, and comfortably inside the regime that is already drawing territory.
 */
export const COMMUNE_SPAN_DEG = 0.45;
/** Box answers kept in the browser between views, LRU. */
export const PE_BOX_CACHE = 6;
const CAMERA_DEBOUNCE_MS = 450;
/**
 * Poll cadence (ms). The CNAF publishes this once a year, in January, so
 * anything faster re-asks a question whose answer cannot have changed.
 */
const POLL_INTERVAL_MS = 6 * 60 * 60_000;
const REQUEST_TIMEOUT_MS = 120_000;
/**
 * Territories one view may fill.
 *
 * Well above what the proxy will send — `PE_MAX_BOX_COMMUNES` caps one answer
 * at 2 400 communes, and several of those share an EPCI — which makes this a
 * runaway guard rather than a policy. What it drops is reported on the row.
 */
const MAX_RENDERED_AREAS = 4_000;

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

/**
 * Fill alpha per band in the LOCAL regime.
 *
 * The choropleth's own alphas, scaled to 55%. A département fill covers ground
 * a reader is looking at from 500 km up, where there is nothing underneath it
 * to lose; an EPCI fill sits over streets and buildings at city zoom, and at
 * the choropleth's weight it stops being a highlight and becomes a lid. The
 * RATIO between the bands is preserved exactly, so the extremes still carry
 * more weight than the middle, both ways.
 */
const TERRITORY_ALPHA = Object.freeze({
  'tres-bas': 0.374,
  bas: 0.330,
  'sous-moyenne': 0.275,
  'sur-moyenne': 0.275,
  haut: 0.330,
  'tres-haut': 0.374,
});

const SELECTED_COLOR = '#00ffff';
/**
 * The commune grain outlines, the EPCI grain does not.
 *
 * The two never overlap — a commune the CNAF publishes is cut out of its
 * EPCI's wash — so the hairline is not a border between two fills, it is the
 * one mark that says "this piece carries its own number". Drawing the EPCI's
 * member communes with the same hairline would turn one territory into a
 * mosaic of thirty, which is precisely the reading this regime exists to
 * prevent.
 */
const COMMUNE_OUTLINE_COLOR = '#ffffff';
const COMMUNE_OUTLINE_ALPHA = 0.34;
const COMMUNE_OUTLINE_WIDTH_PX = 1.4;
const SELECTED_OUTLINE_WIDTH_PX = 3;
/** The selected territory's own wash, laid over the band fill it belongs to. */
const SELECTED_FILL_ALPHA = 0.16;

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
let _records = new Map();
let _enabled = false;
let _clickHandler = null;
let _cameraChangedAttached = false;
let _cameraDebounceTimer = null;
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
let _unpainted = 0;

/** INSEE code → the CNAF area drawn for it, rebuilt whenever the pack lands. */
let _areaIndex = new Map();
/** snapped box key → the outlines it answered, LRU-capped at `PE_BOX_CACHE`. */
const _contourPacks = new Map();
const _contourPromises = new Map();
let _contourError = null;
let _visibleDeps = [];
let _dropped = 0;
/** The box+grain currently drawn, so a camera nudge is not a rebuild. */
let _drawKey = null;
/** One `GroundPrimitive` per band colour — never one per territory. */
let _fills = [];
let _outlines = null;
let _selectionFill = null;
let _selectionOutline = null;

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
 * Fill alpha for one band in the LOCAL regime.
 *
 * Derived from the choropleth's alpha rather than typed independently, so the
 * two regimes can never disagree about which end of the ramp carries weight.
 */
export function peTerritoryAlpha(band) {
  return TERRITORY_ALPHA[band] ?? 0;
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

/**
 * Where a territory's card hangs.
 *
 * The centroid of its biggest drawn ring, and NOT the administrative centre
 * the `/areas` pack carries: the card must point at the shape on screen, and
 * for a multi-part area those two can be tens of kilometres apart. The centre
 * is still the fallback for an area whose outline never arrived.
 */
function territoryAnchor(record) {
  const anchor = record?.anchor
    || (Number.isFinite(record?.area?.lon) ? [record.area.lon, record.area.lat] : null);
  if (!anchor) return null;
  return Cesium.Cartesian3.fromDegrees(anchor[0], anchor[1]);
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
    details.push('Territoire dessiné : les communes membres, sous une seule couleur — geo.api.gouv.fr ne publie pas de contour d’EPCI');
  }
  if (record?.simplified) details.push('Contour communal simplifié');

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
  const position = record?.position || territoryAnchor(record);
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
  if (_selectedId?.startsWith?.('dep:')) repaintDepartements();
  else clearSelectionPrimitives();
  _selectedId = null;
  _overlayHost.clearSource(PE_FR_OVERLAY_SOURCE_ID);
  governorRequestRender('petite-enfance-fr-deselect');
}

function selectArea(id) {
  const record = _records.get(id);
  if (!record) return;
  if (_selectedId && _selectedId !== id) clearSelection();
  _selectedId = id;
  drawSelectionPrimitives(record);
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
 * Commune outlines for one snapped view box.
 *
 * The box is snapped OUTWARD to a 0,1° grid before it is asked about, so
 * panning across a city re-asks once every few screens instead of once per
 * camera settle, and the answers are worth keeping in an LRU at all. The pack
 * carries no rate — the browser already holds those from `/areas` — so it is
 * fetched independently of the coverage build and never invalidated by it.
 * Geography does not change between two camera moves.
 */
async function ensureContours(box) {
  const key = boxKey(box);
  if (_contourPacks.has(key)) return _contourPacks.get(key);
  if (_contourPromises.has(key)) return _contourPromises.get(key);
  const params = new URLSearchParams({
    south: box.south.toFixed(4),
    west: box.west.toFixed(4),
    north: box.north.toFixed(4),
    east: box.east.toFixed(4),
  });
  const promise = fetchJson(`/api/petite-enfance-fr/contours?${params}`, (p) => Array.isArray(p?.communes))
    .then((payload) => {
      _contourPacks.set(key, payload);
      _contourError = null;
      // LRU by insertion order: a Map preserves it, so the oldest key is first.
      while (_contourPacks.size > PE_BOX_CACHE) {
        const oldest = _contourPacks.keys().next().value;
        if (oldest === undefined) break;
        _contourPacks.delete(oldest);
      }
      return payload;
    })
    .catch((error) => {
      if (error?.name !== 'AbortError') {
        console.warn('[Data:PetiteEnfance-FR] contours unavailable:', error?.message || error);
        _contourError = error?.message || 'indisponible';
      }
      return null;
    })
    .finally(() => { _contourPromises.delete(key); });
  _contourPromises.set(key, promise);
  return promise;
}

/** The view box this layer asks about: the camera's, snapped to the cache grid. */
export function peContourBox(viewer) {
  const box = cameraPeBox(viewer, 0);
  return box ? snapBoxOutward(box, PE_BOX_STEP_DEG) : null;
}

/** The `/areas` pack indexed by its own `scale:code` id. */
export function indexPeAreas(areas) {
  const index = new Map();
  for (const area of Array.isArray(areas) ? areas : []) {
    if (area?.id) index.set(area.id, area);
  }
  return index;
}

/**
 * Turn contour packs plus published rates into the territories to fill.
 *
 * Exported and pure so the whole nesting decision can be tested without a
 * viewer: given outlines and rates, this is exactly what would be painted.
 *
 * ── The one rule ────────────────────────────────────────────────────────────
 * Every piece of ground goes to the FINEST scale the CNAF published for it,
 * and to exactly one scale. Below `COMMUNE_SPAN_DEG` a commune with its own
 * row takes its ground out of the EPCI's wash; above it, or where no commune
 * row exists, the ground belongs to the EPCI. So the two fills never overlap,
 * two translucent colours never blend into a third that means nothing, and a
 * reader clicking anywhere gets the number that actually covers that spot.
 *
 * ── The arrondissements ─────────────────────────────────────────────────────
 * Paris, Lyon and Marseille are published by arrondissement municipal, and
 * their parent commune is the same ground. Where an arrondissement carries a
 * row, the parent is dropped entirely — drawing both would paint Paris twice,
 * once in its EPCI's colour and once in twenty of its own. An arrondissement
 * the CNAF did not publish falls back to its parent's EPCI, which is why the
 * pack carries `codeEpci` on it.
 *
 * Ground whose area has no published rate is drawn as ABSENCE and counted, not
 * as one end of the ramp: both ends of a diverging ramp are strong claims.
 *
 * @param {object} input
 * @param {Array<object>} input.packs Contour packs, one per département.
 * @param {Array<object>|Map<string,object>} input.areas The `/areas` rows.
 * @param {boolean} [input.withCommunes] Whether the commune grain is on.
 * @param {?number} [input.national] National rate, for the cards.
 * @param {?number} [input.year]
 * @param {number} [input.limit]
 * @returns {{records:Array<object>, epci:number, communes:number, unmatched:number, unrated:number}}
 */
export function buildPeTerritoryRecords({
  packs, areas, withCommunes = false, national = null, year = null, limit = MAX_RENDERED_AREAS,
} = {}) {
  const byId = areas instanceof Map ? areas : indexPeAreas(areas);
  const pieces = new Map();
  const order = [];
  const seen = new Set();
  let unmatched = 0;
  let unrated = 0;

  for (const pack of Array.isArray(packs) ? packs : []) {
    const rows = Array.isArray(pack?.communes) ? pack.communes : [];
    // Which parent communes their own arrondissements replace in this pack.
    // Computed over the WHOLE pack first: the parent row can be read before
    // the arrondissement that supersedes it.
    const replaced = new Set();
    if (withCommunes) {
      for (const row of rows) {
        if (row?.a && byId.has(`com:${row.c}`)) replaced.add(row.a);
      }
    }
    for (const row of rows) {
      if (!Array.isArray(row?.p) || !row.p.length) continue;
      if (row.a ? !replaced.has(row.a) : replaced.has(row.c)) continue;
      if (seen.has(row.c)) continue;
      seen.add(row.c);
      const area = (withCommunes ? byId.get(`com:${row.c}`) : null)
        || (row.e ? byId.get(`epci:${row.e}`) : null);
      if (!area) {
        unmatched += 1;
        continue;
      }
      if (!area.band) {
        unrated += 1;
        continue;
      }
      let piece = pieces.get(area.id);
      if (!piece) {
        if (pieces.size >= limit) {
          unmatched += 1;
          continue;
        }
        piece = { area, parts: [], simplified: false };
        pieces.set(area.id, piece);
        order.push(piece);
      }
      for (const part of row.p) piece.parts.push(part);
      if (row.s) piece.simplified = true;
    }
  }

  let epci = 0;
  let communes = 0;
  const records = [];
  for (const piece of order) {
    if (!piece.parts.length) continue;
    if (piece.area.scale === 'com') communes += 1;
    else epci += 1;
    let biggest = piece.parts[0];
    for (const part of piece.parts) if (part.length > biggest.length) biggest = part;
    records.push({
      id: piece.area.id,
      area: piece.area,
      scale: piece.area.scale,
      parts: piece.parts,
      simplified: piece.simplified,
      anchor: ringAnchor(biggest),
      color: peBandColor(piece.area.band),
      alpha: peTerritoryAlpha(piece.area.band),
      national,
      year,
    });
  }
  return { records, epci, communes, unmatched, unrated };
}

/** Flat `[lon, lat, …]` to Cartesian positions. */
function ringPositions(flat) {
  if (!Array.isArray(flat) || flat.length < 8) return null;
  return Cesium.Cartesian3.fromDegreesArray(flat);
}

/** One filled ring, as a ground-classified instance. */
function fillInstance(id, positions, color) {
  return new Cesium.GeometryInstance({
    id,
    geometry: new Cesium.PolygonGeometry({
      // Outer rings only: a commune's interior ring is another commune, and
      // that one is drawn in its own right at the same moment.
      polygonHierarchy: new Cesium.PolygonHierarchy(positions),
      vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
    }),
    attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(color) },
  });
}

/** One ring's outline, as a ground-classified polyline instance. */
function outlineInstance(id, positions, color, width) {
  return new Cesium.GeometryInstance({
    id,
    geometry: new Cesium.GroundPolylineGeometry({ positions: [...positions, positions[0]], width }),
    attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(color) },
  });
}

function buildFillPrimitive(instances) {
  if (!instances.length) return null;
  return new Cesium.GroundPrimitive({
    geometryInstances: instances,
    appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true }),
    classificationType: Cesium.ClassificationType.BOTH,
    asynchronous: true,
    releaseGeometryInstances: false,
  });
}

function buildOutlinePrimitive(instances) {
  if (!instances.length) return null;
  return new Cesium.GroundPolylinePrimitive({
    geometryInstances: instances,
    appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
    classificationType: Cesium.ClassificationType.BOTH,
    asynchronous: true,
    releaseGeometryInstances: false,
  });
}

function clearSelectionPrimitives() {
  const primitives = _viewer?.scene?.primitives;
  for (const primitive of [_selectionFill, _selectionOutline]) {
    if (primitive && primitives) primitives.remove(primitive);
  }
  _selectionFill = null;
  _selectionOutline = null;
}

/** Show or hide every drawn territory, without rebuilding any of them. */
function showTerritories(show) {
  for (const primitive of [..._fills, _outlines, _selectionFill, _selectionOutline]) {
    if (primitive) primitive.show = show;
  }
}

function clearTerritoryPrimitives() {
  const primitives = _viewer?.scene?.primitives;
  clearSelectionPrimitives();
  for (const primitive of [..._fills, _outlines]) {
    if (primitive && primitives) primitives.remove(primitive);
  }
  _fills = [];
  _outlines = null;
}

/**
 * Draw the highlight for one territory, as two primitives of its own.
 *
 * Its own primitives and NOT a recolour of the batch. A batched
 * `GroundPrimitive` does not colour a pixel by the polygon that contains it:
 * Cesium classifies the whole batch in one stencil pass, then keeps the first
 * instance whose shadow volume covers the pixel and whose axis-aligned
 * BOUNDING RECTANGLE contains it (`ShadowVolumeAppearanceFS.glsl`,
 * `CULL_FRAGMENTS`). Communes' bounding rectangles overlap constantly, so a
 * lone differently-coloured instance inside a batch is painted over its
 * neighbours' boxes — a highlight with straight cuts through it belonging to
 * the commune next door. Measured on `cadastre-fr` in September 2026, which is
 * where this rule was written down.
 */
function drawSelectionPrimitives(record) {
  clearSelectionPrimitives();
  if (!record?.parts?.length || !_viewer?.scene?.primitives) return;
  const color = Cesium.Color.fromCssColorString(SELECTED_COLOR);
  const fills = [];
  const outlines = [];
  for (const part of record.parts) {
    const positions = ringPositions(part);
    if (!positions) continue;
    fills.push(fillInstance(record.id, positions, color.withAlpha(SELECTED_FILL_ALPHA)));
    outlines.push(outlineInstance(record.id, positions, color, SELECTED_OUTLINE_WIDTH_PX));
  }
  _selectionFill = buildFillPrimitive(fills);
  _selectionOutline = buildOutlinePrimitive(outlines);
  for (const primitive of [_selectionFill, _selectionOutline]) {
    if (!primitive) continue;
    primitive.show = _enabled;
    _viewer.scene.primitives.add(primitive);
  }
}

/**
 * Draw the territories currently in view.
 *
 * ONE primitive per band colour, never one per territory and never one batch
 * carrying several colours — the first is the frame-rate cost batching exists
 * to avoid and the second draws the wrong shapes outright. See
 * `drawSelectionPrimitives` for the whole of why.
 */
function drawTerritories(records) {
  clearTerritoryPrimitives();
  _records.clear();
  if (!records.length || !_viewer?.scene?.primitives) return;

  /** @type {Map<string, Array<object>>} band colour → its fill instances. */
  const fillsByColor = new Map();
  const outlineInstances = [];
  const outlineColor = Cesium.Color
    .fromCssColorString(COMMUNE_OUTLINE_COLOR).withAlpha(COMMUNE_OUTLINE_ALPHA);

  for (const record of records) {
    _records.set(record.id, record);
    const color = Cesium.Color.fromCssColorString(record.color).withAlpha(record.alpha);
    const key = `${record.color}|${record.alpha}`;
    let bucket = fillsByColor.get(key);
    if (!bucket) {
      bucket = [];
      fillsByColor.set(key, bucket);
    }
    for (const part of record.parts) {
      const positions = ringPositions(part);
      if (!positions) continue;
      bucket.push(fillInstance(record.id, positions, color));
      // Only the commune grain is outlined — the EPCI's member communes share
      // one wash and must not read as thirty separate areas.
      if (record.scale === 'com') {
        outlineInstances.push(outlineInstance(
          record.id, positions, outlineColor, COMMUNE_OUTLINE_WIDTH_PX,
        ));
      }
    }
  }

  for (const instances of fillsByColor.values()) {
    const primitive = buildFillPrimitive(instances);
    if (!primitive) continue;
    primitive.show = _enabled;
    _fills.push(primitive);
    _viewer.scene.primitives.add(primitive);
  }
  _outlines = buildOutlinePrimitive(outlineInstances);
  if (_outlines) {
    _outlines.show = _enabled;
    _viewer.scene.primitives.add(_outlines);
  }
  governorRequestRender('petite-enfance-fr-territories');
}

function clearAreas() {
  if (_selectedId && !_selectedId.startsWith('dep:')) clearSelection();
  clearTerritoryPrimitives();
  _drawKey = null;
  _records.clear();
  _count = 0;
  _inView = 0;
  _communesShown = 0;
  _unpainted = 0;
  _dropped = 0;
  _visibleDeps = [];
}

/**
 * Fill the départements in view.
 *
 * The rates come once, nationally; the outlines come per département and only
 * for the ones on screen. A département whose outlines fail to arrive leaves
 * its ground unfilled and says so on the row — it is never filled from a
 * neighbour's pack, and the rest of the view is still drawn.
 */
async function loadLocal(box, span, { force = false } = {}) {
  hideDepartements();
  _nationalPainted = false;
  dropDepartementSelection();
  // `_error` is NOT cleared here. It describes the drawing that is on screen,
  // and a settle that changes nothing must not quietly retract the sentence
  // explaining a département whose outlines never arrived. Every path below
  // sets it, including to null.
  if (force) {
    _pack = null;
    _contourPacks.clear();
    _contourError = null;
    _drawKey = null;
  }
  _loading = !_pack;
  const generation = ++_requestGeneration;
  await ensurePack();
  if (generation !== _requestGeneration || !_enabled || _regime !== 'local') return;
  if (!_pack) {
    _loading = false;
    _error = _packError || 'area pack unavailable';
    _status = 'error';
    return;
  }
  if (!_areaIndex.size) _areaIndex = indexPeAreas(_pack.areas);

  const withCommunes = Number.isFinite(span) && span <= COMMUNE_SPAN_DEG;
  // A camera settle that lands on the same snapped box, at the same grain, is
  // the same drawing — rebuilding it would re-tessellate every polygon and
  // drop the card the operator is reading, once per nudge of the mouse.
  const drawKey = `${boxKey(box)}|${withCommunes ? 'com' : 'epci'}`;
  if (!force && drawKey === _drawKey && _records.size) {
    _loading = false;
    _status = 'ready';
    return;
  }

  _loading = !_contourPacks.has(boxKey(box));
  const pack = await ensureContours(box);
  if (generation !== _requestGeneration || !_enabled || _regime !== 'local') return;
  _loading = false;
  if (!pack) {
    // The rates are still in hand and the choropleth above is untouched; what
    // failed is the geometry, and the row says exactly that.
    clearAreas();
    _error = _contourError
      ? `contours communaux indisponibles (${_contourError})`
      : 'contours communaux indisponibles';
    _status = 'error';
    return;
  }

  const { records, epci, communes, unmatched, unrated } = buildPeTerritoryRecords({
    packs: [pack],
    areas: _areaIndex,
    withCommunes,
    national: _pack.national ?? null,
    year: _pack.year ?? null,
  });
  clearSelection();
  drawTerritories(records);
  _drawKey = drawKey;
  _count = records.length;
  _inView = epci + communes;
  _communesShown = communes;
  _unpainted = unmatched + unrated;
  _visibleDeps = Array.isArray(pack.departements) ? pack.departements : [];
  _dropped = Number(pack.dropped) || 0;
  _lastUpdate = Number(_pack.fetchedAt) || Date.now();
  // A département whose outlines never arrived is ground with no shape, which
  // looks exactly like ground with no rate and means something else entirely.
  _error = pack.unavailable?.length
    ? `contours indisponibles : ${pack.unavailable.join(', ')}`
    : null;
  _status = _count > 0 ? 'ready' : 'empty';
}

async function loadViewport({ force = false } = {}) {
  if (!_enabled || !_viewer) return;
  const regime = updateRegime(_viewer);
  const box = regime === 'national' ? null : peContourBox(_viewer);
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
  if (!_enabled || _regime !== 'local' || !_records.size) return [];
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
    const position = territoryAnchor(record);
    if (!position) continue;
    result.push({
      position,
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
    // A territory with no drawn ring has no place to put a callout — it is not
    // on screen in any sense a reader could act on.
    if (!record.parts?.length && record.id !== _selectedId) continue;
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
  unpainted = _unpainted,
  dropped = _dropped,
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
  if (loading) return 'lecture des contours communaux...';
  if (status === 'error') return '';
  if (!inView) return 'aucune zone dans cette vue';
  const parts = [`${fr(count - communes)} intercommunalités`];
  if (communes > 0) parts.push(`${fr(communes)} communes`);
  // The two silences this regime can produce, named where it is read: ground
  // whose area publishes no rate, and départements the pack cap left out.
  if (unpainted > 0) parts.push(`${fr(unpainted)} communes sans taux publié`);
  if (dropped > 0) parts.push(`${fr(dropped)} contours hors plafond`);
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

    _enabled = false;
    _records = new Map();
    _selectedId = null;
    _count = 0;
    _inView = 0;
    _communesShown = 0;
    _unpainted = 0;
    _visibleDeps = [];
    _lastUpdate = null;
    _loading = false;
    _error = null;
    _status = 'idle';
    _regime = 'national';
    _nationalPainted = false;

    _overlayHost.setVisible(PE_FR_OVERLAY_SOURCE_ID, false);
    _overlayHost.setVisible(PE_FR_LABEL_SOURCE_ID, false);
  },

  enable(viewer) {
    _enabled = true;
    _error = null;
    showTerritories(true);
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
    void loadViewport({ force: true });
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
      ...summary,
      inView: _inView,
      drawn: _count,
      communes: _communesShown,
      unpainted: _unpainted,
      departements: _visibleDeps.slice(),
      contourSource: PE_GEO_SOURCE,
    };
  },

  /**
   * The territories as they are actually drawn, for a harness.
   *
   * Verbatim from the records — the same rings that were handed to Cesium —
   * so a pixel check written against this compares the screen with the SOURCE
   * geometry rather than with the layer's own idea of it. `parts` is flat
   * `[lon, lat, …]`, exactly as it arrived on the wire.
   * @returns {{regime:string, selected:?string, territories:Array<object>}}
   */
  getTerritoriesForQa() {
    return {
      regime: _regime,
      selected: _selectedId,
      // One entry per FILL primitive, so a harness can assert the batching
      // rule (one colour per primitive, never one primitive per territory)
      // without reaching into Cesium's scene graph for the colours.
      fills: _fills.length,
      outlines: _outlines ? 1 : 0,
      selectionPrimitives: (_selectionFill ? 1 : 0) + (_selectionOutline ? 1 : 0),
      territories: [..._records.values()].map((record) => ({
        id: record.id,
        scale: record.scale,
        code: record.area?.code ?? null,
        band: record.area?.band ?? null,
        color: record.color,
        alpha: record.alpha,
        anchor: record.anchor,
        parts: record.parts,
      })),
    };
  },

  /**
   * Select one territory by id, for a harness that cannot click a pixel it is
   * about to measure — the card is painted over the very ground the check
   * reads. The production path, not a copy of it.
   * @param {string} id
   */
  selectAreaForQa(id) {
    selectArea(id);
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
    clearTerritoryPrimitives();
    if (_depDataSource) {
      viewer.dataSources?.remove?.(_depDataSource, true);
      _depDataSource = null;
    }
    _depEntities.clear();
    _depMeta = new Map();
    _depShapesPromise = null;
    _contourPacks.clear();
    _contourPromises.clear();
    _contourError = null;
    _areaIndex = new Map();
    _records.clear();
    _viewer = null;
  },
};

/** Seed rendered records so selection/card/legend paths run without WebGL. */
export function _setPeStateForTest({
  viewer, records, overlayHost, status, count, regime, national, depEntities, depMeta,
  pack, inView, communes, unpainted, dropped, visibleDeps,
} = {}) {
  _viewer = viewer || null;
  _records = new Map((records || []).map((record) => [record.id, record]));
  _selectedId = null;
  _overlayHost = overlayHost || DEFAULT_OVERLAY_HOST;
  _status = status || 'ready';
  _count = Number.isFinite(count) ? count : _records.size;
  _inView = Number.isFinite(inView) ? inView : _count;
  _communesShown = Number.isFinite(communes) ? communes : 0;
  _unpainted = Number.isFinite(unpainted) ? unpainted : 0;
  _visibleDeps = visibleDeps || [];
  _dropped = Number.isFinite(dropped) ? dropped : 0;
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
  _areaIndex = new Map();
  _contourPacks.clear();
  _visibleDeps = [];
  _unpainted = 0;
  _dropped = 0;
  _drawKey = null;
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
