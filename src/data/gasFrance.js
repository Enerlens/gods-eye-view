import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import { registerSpriteCollection, restoreSpriteOrder, unregisterSpriteCollection } from './spriteOrder.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import { cachedGroundFloor, warmGroundFloor } from './groundFloor.js';
import { horizonOccluder } from './iconOrientation.js';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import {
  GAS_INJECTION_COLOR,
  GAS_NETWORK_OPERATORS,
  GAS_NETWORK_TIERS,
  GAS_PLANT_COLOR,
} from './gasFranceFeed.js';

/**
 * Réseau gaz (FR) — the French gas system as three things at once.
 *
 * The globe draws what ODRÉ publishes about the transmission system, and the
 * three datasets answer three different questions that only make sense next to
 * each other:
 *
 *   **the pipes**   — NaTran (ex-GRTgaz) and Teréga's own simplified traces of
 *                     the high-pressure transmission network, 36 106 km of it,
 *                     clamped to the ground
 *   **the inlets**  — 850 renewable-methane injection points, sized by the
 *                     capacity each declares
 *   **the outlets** — the 14 centralised gas-fired power stations, sized by
 *                     installed MW, which is where a good part of that gas
 *                     leaves the system as the `gaz` filière of the Mix élec
 *                     layer already on this globe
 *
 * Keyless, all four datasets under Licence Ouverte 2.0, all through the
 * `/api/gas-fr` proxy. The upstream traps live in `gasFranceFeed.js` under
 * test against captured payloads; this module is the drawing.
 *
 * ── What the drawing is careful about ───────────────────────────────────────
 *
 * • **A stroke is a published trace, not a pipe location.** Both operators
 *   publish deliberately simplified geometry — the titles say "précis à
 *   environ 250 m" — so the strokes are drawn thin and calm, and every card
 *   says so. Nothing here is a dig permit.
 *
 * • **The two networks never merge.** NaTran and Teréga are two companies;
 *   they get two colours, two legend rows and two length figures, and a
 *   stroke of one is never chained onto a stroke of the other.
 *
 * • **An injection point is not connected to the stroke beside it.** 741 of
 *   the 850 drawn inject into the local *distribution* network, which this
 *   layer does not draw at all; only 109 reach the transmission trace on
 *   screen. The two are drawn at different opacities and counted separately,
 *   and no connector line is ever drawn between a site and a pipe, because no
 *   dataset here publishes that link.
 *
 * • **The power stations are an inventory, not a live output.** The file is
 *   installed capacity by annual edition; what those machines are producing
 *   right now is the Mix élec layer's `gaz` filière, a national figure that
 *   RTE does not break down per station without an API account. So this layer
 *   sizes by nameplate MW and never implies a station is running.
 *
 * • **The ground is where these objects are.** Sites are placed on the local
 *   ground floor, and pipes are clamped ground polylines classified against
 *   ONLY the active surface — the rule the submarine-cable and Vigicrues
 *   layers established, with BOTH as the safe fallback for an unknown stack.
 */

const NETWORK_URL = '/api/gas-fr/network';
const SITES_URL = '/api/gas-fr/sites';

/** Layer id — also the share-link registry key and the voice-tool enum value. */
export const GAS_FR_LAYER_ID = 'gas-fr';
/** Ambient labels: the power stations, which are few and are the headline. */
export const GAS_FR_OVERLAY_SOURCE_ID = 'gas-fr';
/** Selected-object card, on its own protected source. */
export const GAS_FR_SELECTED_OVERLAY_SOURCE_ID = 'gas-fr-selected';
/** There are 14 stations; the cohort limit is the whole set, not a sample. */
export const GAS_FR_OVERLAY_COHORT_LIMIT = 16;
/** Shared ambient-label paint budget, matching the sibling French sources. */
export const GAS_FR_OVERLAY_COLLISION_CAPACITY = 14;

export const GAS_FR_SELECTED_OVERLAY_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 1,
  moving: false,
});

/**
 * Idle refresh cadence.
 *
 * Everything here is quasi-static: the two traces are republished about once a
 * year, the power-station file gains one edition a year, and the injection
 * register moves a few sites a month. The proxy holds a 12-hour cache in front
 * of ODRÉ; this cadence exists so a session left open overnight picks up a new
 * register, not because anything is expected to move.
 */
const UPDATE_INTERVAL_MS = 30 * 60_000;

const REQUEST_TIMEOUT_MS = 45_000;

/** Sites sit this far above the local ground floor. */
const POINT_LIFT_M = 2.5;

/** Power stations: 210…930 MW across the fleet, on a √ ramp. */
const PLANT_MIN_PX = 11;
const PLANT_MAX_PX = 22;
const PLANT_REFERENCE_MW = 930;

/** Injection points: a 15.6 GWh/an median against a 268 GWh/an maximum. */
const INJECTION_MIN_PX = 6;
const INJECTION_MAX_PX = 15;
const INJECTION_REFERENCE_GWH = 270;

const SELECTED_COLOR = '#00ffff';
const SELECTED_POINT_PX = 20;

/** Transmission-connected injection points draw solid; distribution ones dim. */
const TIER_ALPHA = Object.freeze({ transport: 1, distribution: 0.55 });

/** Stroke widths — quiet infrastructure, not a warning. */
const STROKE_WIDTH = 1.8;
const STROKE_ALPHA = 0.85;
const SELECTED_STROKE_WIDTH = 4;

/**
 * `MAP_STACKS` ids that render imagery on the SHOWN Cesium globe. An explicit
 * allowlist for the same reason the cable layer keeps one: a stack id this
 * module has never heard of must reach the documented BOTH fallback rather
 * than be asserted onto a surface that is not there.
 */
const GAS_GLOBE_STACK_IDS = Object.freeze(new Set(['bing-aerial', 'bing-labels', 'osm']));

/**
 * Ground-line classification for one map stack.
 * @param {string|null|undefined} activeId MapStackController stack id.
 * @returns {Cesium.ClassificationType}
 */
export function gasClassificationTypeForStack(activeId) {
  if (activeId === 'photoreal') return Cesium.ClassificationType.CESIUM_3D_TILE;
  if (GAS_GLOBE_STACK_IDS.has(activeId)) return Cesium.ClassificationType.TERRAIN;
  return Cesium.ClassificationType.BOTH;
}

/**
 * Derive the active surface from live scene state, for the boot-time stack
 * settle that fires no `gev:map-stack-changed` event.
 * @param {Cesium.Scene|null|undefined} scene
 * @returns {Cesium.ClassificationType}
 */
export function gasClassificationTypeForScene(scene) {
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

/**
 * Pixel size for a power station.
 * A station with no published power still draws — at the floor size, so it is
 * present and visibly unquantified rather than absent.
 * @param {?number} mw
 * @returns {number}
 */
export function gasPlantPointSize(mw) {
  if (!Number.isFinite(mw) || mw <= 0) return PLANT_MIN_PX;
  const ratio = Math.min(1, Math.sqrt(mw / PLANT_REFERENCE_MW));
  return Math.round(PLANT_MIN_PX + ratio * (PLANT_MAX_PX - PLANT_MIN_PX));
}

/**
 * Pixel size for an injection point.
 * @param {?number} gwh Declared production capacity, GWh/an.
 * @returns {number}
 */
export function gasInjectionPointSize(gwh) {
  if (!Number.isFinite(gwh) || gwh <= 0) return INJECTION_MIN_PX;
  const ratio = Math.min(1, Math.sqrt(gwh / INJECTION_REFERENCE_GWH));
  return Math.round(INJECTION_MIN_PX + ratio * (INJECTION_MAX_PX - INJECTION_MIN_PX));
}

/** Format a megawatt figure the way a control room writes it. */
export function formatMw(mw) {
  if (!Number.isFinite(mw)) return '—';
  if (mw >= 1000) return `${(mw / 1000).toFixed(mw >= 10_000 ? 0 : 1)} GW`;
  return `${Math.round(mw).toLocaleString('en-US')} MW`;
}

/** Format an annual energy figure. */
export function formatGwhPerYear(gwh) {
  if (!Number.isFinite(gwh)) return '—';
  if (gwh >= 1000) return `${(gwh / 1000).toFixed(1)} TWh/an`;
  return `${gwh.toFixed(gwh < 100 ? 1 : 0)} GWh/an`;
}

/** Format a network length. */
export function formatKm(km) {
  if (!Number.isFinite(km)) return '—';
  return `${Math.round(km).toLocaleString('en-US')} km`;
}

/**
 * Card copy for a selected object. Every line is a published value.
 * @param {object} record Render record (`kind` is `plant`, `injection` or `pipe`).
 * @returns {string} Newline-separated card copy.
 */
export function buildGasSelectionLabel(record) {
  const site = record?.site || {};
  const details = [];

  if (record?.kind === 'pipe') {
    const operator = GAS_NETWORK_OPERATORS[site.operator];
    const title = operator ? `${operator.label} — réseau de transport` : 'Réseau de transport';
    if (site.departement) {
      details.push(`📍 ${site.departement}${site.region ? ` · ${site.region}` : ''}`);
    }
    if (Number.isFinite(site.km)) details.push(`⌇ ${site.km.toFixed(1)} km of published trace`);
    details.push('Tracé simplifié — accurate to about 250 m, by design');
    details.push('Licence Ouverte 2.0 · ODRÉ');
    return [title, ...details].join('\n');
  }

  if (record?.kind === 'plant') {
    const title = site.name || 'Centrale gaz';
    details.push(`⚡ ${formatMw(site.mw)} installed`);
    if (site.operator) details.push(`🏭 ${site.operator}`);
    if (site.status) details.push(`▸ ${site.status}`);
    if (site.commissioned) details.push(`🗓 mise en service ${site.commissioned}`);
    // Trap 2 surfaced where it matters: this station said something else in an
    // earlier edition of the same file.
    if (Array.isArray(site.supersededBy) && site.supersededBy.length) {
      details.push(`↳ earlier editions said: ${site.supersededBy.join(', ')}`);
    }
    if (Number.isFinite(site.edition)) {
      details.push(`Edition ${site.edition}${
        site.editions?.length > 1 ? ` of ${site.editions.length}` : ''
      } — installed capacity, not live output`);
    }
    return [title, ...details].join('\n');
  }

  const title = site.name || 'Site d’injection';
  details.push(`♻️ ${formatGwhPerYear(site.gwh)} declared capacity`);
  if (site.feedstock) details.push(`🌾 ${site.feedstock}`);
  if (site.process && site.process !== 'Méthanisation') details.push(`⚗️ ${site.process}`);
  const tier = GAS_NETWORK_TIERS[site.tier];
  if (tier) {
    details.push(`⌇ ${tier.label}${site.network ? ` · ${site.network}` : ''}`);
    if (site.tier === 'distribution') details.push('↳ distribution network — not the trace drawn here');
  }
  if (site.commune) {
    details.push(`📍 ${site.commune}${site.departement ? ` · ${site.departement}` : ''}`);
  }
  if (site.commissioned) details.push(`🗓 mise en service ${site.commissioned}`);
  if (site.expanding) details.push('↗ an increase is declared as planned');
  return [title, ...details].join('\n');
}

/**
 * Protected selected-object entry for the shared overlay host.
 * @param {object} record
 * @returns {?object}
 */
export function createGasSelectedOverlayEntry(record) {
  const position = record?.position;
  if (!record?.id || !position) return null;
  const [title, ...details] = buildGasSelectionLabel(record).split('\n');
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
 * Ambient label for one power station.
 * @param {object} plant
 * @param {Cesium.Cartesian3} position
 * @returns {object}
 */
export function createGasPlantOverlayEntry(plant, position) {
  return {
    id: `gas-fr-label:${plant.id}`,
    position,
    variant: 'label',
    title: `${plant.name} · ${formatMw(plant.mw)}`,
    accent: GAS_PLANT_COLOR,
    // The biggest machine wins the collision; ties break on id in the selector.
    priority: Math.round(Number.isFinite(plant.mw) ? plant.mw : 0),
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

/** Keep the largest stations, with stable identity as the tie-break. */
export function selectGasOverlayCohort(entries, limit = GAS_FR_OVERLAY_COHORT_LIMIT) {
  const cap = Math.max(0, Math.min(
    GAS_FR_OVERLAY_COHORT_LIMIT,
    Math.floor(Number(limit) || 0),
  ));
  if (!Array.isArray(entries) || cap === 0) return [];
  return entries.slice().sort((a, b) => (
    b.priority - a.priority || String(a.id).localeCompare(String(b.id))
  )).slice(0, cap);
}

/**
 * Map one site to a JSON-safe analyst record. Pure — no Cesium types.
 * @param {object|null|undefined} site
 * @param {number} [index=0]
 * @returns {object}
 */
export function mapGasAnalystRecord(site, index = 0) {
  const str = (value) => {
    const trimmed = String(value ?? '').trim();
    return trimmed || null;
  };
  const num = (value) => (Number.isFinite(value) ? value : null);
  const isPlant = site?.kind === 'plant';
  return {
    id: str(site?.id) || `GAS-${String(index).padStart(4, '0')}`,
    name: str(site?.name),
    kind: isPlant ? 'gas-power-station' : 'biomethane-injection',
    lat: num(site?.lat),
    lon: num(site?.lon),
    installedMw: isPlant ? num(site?.mw) : null,
    capacityGwhPerYear: isPlant ? null : num(site?.gwh),
    operator: str(isPlant ? site?.operator : site?.network),
    networkTier: isPlant ? null : str(site?.tier),
    status: isPlant ? str(site?.status) : null,
    commune: str(site?.commune),
    departement: str(site?.departement),
    commissioned: str(site?.commissioned),
  };
}

// --- Module state -----------------------------------------------------------

let _viewer = null;
let _points = null;
let _networkSource = null;
let _overlayHost = DEFAULT_OVERLAY_HOST;
let _enabled = false;
let _classificationType = Cesium.ClassificationType.BOTH;
let _mapStackListener = null;
let _clickHandler = null;
let _preRenderRemover = null;

/** @type {Map<string, object>} render id → record (sites AND pipes). */
let _records = new Map();
/** @type {?string} */
let _selectedId = null;

/** @type {Array<object>} drawn power stations, largest first. */
let _plants = [];
/** @type {Array<object>} drawn injection points, largest first. */
let _injections = [];
/** @type {Array<object>} per-operator network summaries. */
let _operators = [];

let _networkPromise = null;
let _networkLoaded = false;
let _sitesLoaded = false;
let _loading = false;
let _error = null;
let _status = 'idle';
let _lastUpdate = null;
let _networkStats = null;
let _siteStats = null;
let _source = null;

function applyClassification(next) {
  if (next === undefined || next === _classificationType) return;
  _classificationType = next;
  if (!_networkSource) return;
  const entities = _networkSource.entities.values;
  for (let i = 0; i < entities.length; i += 1) {
    const polyline = entities[i].polyline;
    if (polyline) polyline.classificationType = next;
  }
  _viewer?.scene?.requestRender?.();
}

function sitePosition(site) {
  const floor = cachedGroundFloor(site.lat, site.lon);
  const height = (Number.isFinite(floor) ? floor : 0) + POINT_LIFT_M;
  return Cesium.Cartesian3.fromDegrees(site.lon, site.lat, height);
}

/**
 * Build the clamped ground strokes, ONCE.
 *
 * The traces are static — republished about once a year — so this runs on the
 * first enable and never again for the session. Static positions and a static
 * material are deliberate: a CallbackProperty on clamped ground geometry
 * re-tessellates it every frame, the lesson the earthquake layer paid for.
 * @param {object} payload `/api/gas-fr/network` document.
 */
function buildNetwork(payload) {
  if (!_networkSource) return;
  _networkSource.entities.removeAll();
  const groups = Array.isArray(payload?.groups) ? payload.groups : [];
  const strokes = Array.isArray(payload?.strokes) ? payload.strokes : [];
  // One material per operator, shared by every stroke it owns: they are one
  // network, not six thousand independently coloured lines.
  const materials = new Map();
  for (const id of Object.keys(GAS_NETWORK_OPERATORS)) {
    materials.set(id, new Cesium.ColorMaterialProperty(
      Cesium.Color.fromCssColorString(GAS_NETWORK_OPERATORS[id].color).withAlpha(STROKE_ALPHA),
    ));
  }
  // 7 199 adds against a live entity collection is 7 199 collection-changed
  // events, each one waking the geometry visualizer for a single stroke.
  // Suspended, the whole network lands as one batch.
  _networkSource.entities.suspendEvents();
  try {
  for (let i = 0; i < strokes.length; i += 1) {
    const stroke = strokes[i];
    const coordinates = stroke?.c;
    if (!Array.isArray(coordinates) || coordinates.length < 4) continue;
    const group = groups[stroke.g] || {};
    const material = materials.get(group.o);
    if (!material) continue;
    const id = `gas-fr:pipe:${i}`;
    const entity = _networkSource.entities.add({
      id,
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(coordinates),
        width: STROKE_WIDTH,
        material,
        clampToGround: true,
        classificationType: _classificationType,
      },
    });
    _records.set(id, {
      id,
      kind: 'pipe',
      entity,
      baseMaterial: material,
      site: {
        operator: group.o,
        departement: group.d,
        region: group.r,
        km: Number.isFinite(stroke.km) ? stroke.km : null,
      },
    });
  }
  } finally {
    // A throw mid-build must not leave the collection suspended forever — an
    // entity collection that never resumes never draws anything again.
    _networkSource.entities.resumeEvents();
  }
  _operators = Array.isArray(payload?.operators) ? payload.operators : [];
  _networkStats = payload?.stats || null;
  _networkSource.show = _enabled;
}

/** Replace the drawn sites with a fresh sites document. */
function buildSites(payload) {
  if (!_points) return;
  clearSelection();
  _points.removeAll();
  for (const [id, record] of [..._records]) {
    if (record.kind !== 'pipe') _records.delete(id);
  }

  const plants = Array.isArray(payload?.plants) ? payload.plants : [];
  const injections = Array.isArray(payload?.injections) ? payload.injections : [];
  const warm = [];

  // Injection points first, so a power station sharing a coordinate with one
  // paints over it rather than under it.
  for (const site of injections) {
    if (!Number.isFinite(site?.lat) || !Number.isFinite(site?.lon)) continue;
    const position = sitePosition(site);
    const size = gasInjectionPointSize(site.gwh);
    const alpha = TIER_ALPHA[site.tier] ?? TIER_ALPHA.distribution;
    const color = Cesium.Color.fromCssColorString(GAS_INJECTION_COLOR).withAlpha(alpha);
    const point = _points.add({
      id: site.id,
      position,
      color,
      pixelSize: size,
      outlineColor: Cesium.Color.BLACK.withAlpha(0.5),
      outlineWidth: 1,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
    _records.set(site.id, {
      id: site.id,
      kind: 'injection',
      site,
      position,
      point,
      baseColor: color,
      baseSize: size,
    });
    warm.push({ lat: site.lat, lon: site.lon });
  }

  for (const site of plants) {
    if (!Number.isFinite(site?.lat) || !Number.isFinite(site?.lon)) continue;
    const position = sitePosition(site);
    const size = gasPlantPointSize(site.mw);
    const color = Cesium.Color.fromCssColorString(GAS_PLANT_COLOR);
    const point = _points.add({
      id: site.id,
      position,
      color,
      pixelSize: size,
      outlineColor: Cesium.Color.BLACK.withAlpha(0.6),
      outlineWidth: 1.5,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
    _records.set(site.id, {
      id: site.id,
      kind: 'plant',
      site,
      position,
      point,
      baseColor: color,
      baseSize: size,
    });
    warm.push({ lat: site.lat, lon: site.lon });
  }

  _plants = plants;
  _injections = injections;
  _siteStats = payload?.stats || null;
  warmGroundFloor(warm.slice(0, 600));
  publishOverlay();
}

/** Ambient labels: the power stations only. 850 injection labels is not a map. */
function publishOverlay() {
  if (!_enabled) {
    _overlayHost.clearSource(GAS_FR_OVERLAY_SOURCE_ID);
    return;
  }
  const entries = [];
  for (const plant of _plants) {
    const record = _records.get(plant.id);
    if (!record?.position) continue;
    entries.push(createGasPlantOverlayEntry(plant, record.position));
  }
  _overlayHost.setEntries(
    GAS_FR_OVERLAY_SOURCE_ID,
    selectGasOverlayCohort(entries),
    {
      cohortLimit: GAS_FR_OVERLAY_COHORT_LIMIT,
      collisionCapacity: GAS_FR_OVERLAY_COLLISION_CAPACITY,
      moving: false,
    },
  );
}

function restoreRecordStyle(record) {
  if (!record) return;
  if (record.kind === 'pipe') {
    if (record.entity?.polyline) {
      record.entity.polyline.material = record.baseMaterial;
      record.entity.polyline.width = STROKE_WIDTH;
    }
    return;
  }
  if (!record.point) return;
  record.point.color = record.baseColor;
  record.point.pixelSize = record.baseSize;
}

function clearSelection() {
  if (_selectedId) restoreRecordStyle(_records.get(_selectedId));
  _selectedId = null;
  _overlayHost.clearSource(GAS_FR_SELECTED_OVERLAY_SOURCE_ID);
}

function selectObject(id) {
  clearSelection();
  const record = _records.get(id);
  if (!record) return;
  _selectedId = id;
  const selected = Cesium.Color.fromCssColorString(SELECTED_COLOR);
  if (record.kind === 'pipe') {
    if (record.entity?.polyline) {
      record.entity.polyline.material = new Cesium.ColorMaterialProperty(selected);
      record.entity.polyline.width = SELECTED_STROKE_WIDTH;
    }
  } else if (record.point) {
    record.point.color = selected;
    record.point.pixelSize = SELECTED_POINT_PX;
  }
  // A pipe has no single position, so its card is anchored where the user
  // clicked rather than at a midpoint that could be a département away.
  const entry = createGasSelectedOverlayEntry(record);
  if (entry) {
    _overlayHost.setEntries(
      GAS_FR_SELECTED_OVERLAY_SOURCE_ID,
      [entry],
      GAS_FR_SELECTED_OVERLAY_SOURCE_OPTIONS,
    );
  }
  governorRequestRender('gas-fr-select');
}

function onKeyDown(event) {
  if (event.key === 'Escape' && _selectedId) clearSelection();
}

/** Resolve a Cesium pick into one of this layer's render ids. */
export function resolveGasPickId(picked, has = (id) => _records.has(id)) {
  if (!picked) return null;
  const primitiveId = picked.primitive?.id;
  if (typeof primitiveId === 'string' && has(primitiveId)) return primitiveId;
  if (typeof picked.id === 'string' && has(picked.id)) return picked.id;
  // Clamped ground polylines come back as the Entity itself.
  const entityId = picked.id?.id;
  if (typeof entityId === 'string' && has(entityId)) return entityId;
  return null;
}

function installClickHandler(viewer) {
  if (_clickHandler) return;
  _clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  _clickHandler.setInputAction((click) => {
    const id = resolveGasPickId(viewer.scene.pick(click.position));
    if (id) {
      // A pipe card needs an anchor and the stroke has no one position, so the
      // clicked ground point becomes it.
      const record = _records.get(id);
      if (record?.kind === 'pipe') {
        record.position = viewer.scene.pickPosition?.(click.position)
          || viewer.camera.pickEllipsoid?.(click.position)
          || record.position;
        if (!record.position) return;
      }
      selectObject(id);
      return;
    }
    if (_selectedId) clearSelection();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  if (typeof document !== 'undefined') document.addEventListener('keydown', onKeyDown);
}

/**
 * Per-frame horizon pass for the site points.
 *
 * Points draw with depth testing disabled so a station is not swallowed by the
 * terrain it sits on, which also means one on the far side of the planet would
 * paint straight through the globe. Nothing here animates — an inventory does
 * not move — so this is the layer's only per-frame work. The pipes are clamped
 * ground geometry and need none of it.
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

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch the traces once per session.
 *
 * ~930 KB of projected geometry against a product republished once a year, so
 * it is fetched once and held. A failed load nulls the promise so the next
 * refresh retries rather than leaving the network permanently absent.
 */
function ensureNetwork() {
  if (_networkPromise) return _networkPromise;
  _networkPromise = fetchJson(NETWORK_URL)
    .then((payload) => {
      if (!Array.isArray(payload?.strokes)) throw new Error('malformed network document');
      buildNetwork(payload);
      _networkLoaded = true;
      _source = payload.source || _source;
      return payload;
    })
    .catch((error) => {
      _networkPromise = null;
      throw error;
    });
  return _networkPromise;
}

async function load() {
  _loading = true;
  try {
    const [network, sites] = await Promise.allSettled([
      ensureNetwork(),
      fetchJson(SITES_URL),
    ]);
    if (network.status === 'rejected') {
      console.warn('[Data:Gas FR] network trace unavailable:', network.reason?.message || network.reason);
    }
    if (sites.status === 'fulfilled' && Array.isArray(sites.value?.plants)) {
      buildSites(sites.value);
      _sitesLoaded = true;
      _source = sites.value.source || _source;
    } else if (sites.status === 'rejected') {
      console.warn('[Data:Gas FR] sites unavailable:', sites.reason?.message || sites.reason);
    }

    // Half a system is still a system — the layer reports which half is
    // missing rather than blanking the half that arrived.
    if (!_networkLoaded && !_sitesLoaded) {
      _error = 'ODRÉ gas datasets unavailable';
      _status = 'error';
      return false;
    }
    _error = _networkLoaded && _sitesLoaded
      ? null
      : (_networkLoaded ? 'sites unavailable' : 'network trace unavailable');
    _status = 'ready';
    _lastUpdate = Date.now();
    governorRequestRender('gas-fr-load');
    console.log(
      `[Data:Gas FR] ${_networkStats?.strokes ?? 0} strokes`
      + ` / ${formatKm(_networkStats?.lengthKm)},`
      + ` ${_plants.length} centrales, ${_injections.length} injection sites`,
    );
    return true;
  } catch (error) {
    console.warn('[Data:Gas FR] load error:', error);
    _error = 'ODRÉ gas network error';
    _status = 'error';
    return false;
  } finally {
    _loading = false;
  }
}

/** Deterministic subsample of drawn sites for the detection overlay. */
function collectDetectableObjects(options = {}) {
  if (!_enabled) return [];
  const sites = [];
  for (const record of _records.values()) {
    if (record.kind === 'pipe') continue;
    if (!record.point?.show && record.id !== _selectedId) continue;
    sites.push(record);
  }
  if (!sites.length) return [];

  const maxCount = Number.isFinite(options.maxCount)
    ? Math.max(1, Math.floor(options.maxCount))
    : sites.length;
  const seed = Number.isFinite(options.seed) ? Math.floor(options.seed) : 0;
  const stride = Math.max(1, Math.ceil(sites.length / maxCount));
  const start = ((seed % stride) + stride) % stride;

  const result = [];
  for (let i = start; i < sites.length; i += stride) {
    const record = sites[i];
    result.push({
      position: record.position,
      sourceId: record.id,
      id: String(record.site?.name || 'GAZ').toUpperCase().slice(0, 22),
      type: record.kind === 'plant' ? 'PWR' : 'GAS',
      skipLabel: record.id === _selectedId,
    });
    if (result.length >= maxCount) break;
  }
  return result;
}

function buildLoadingLabel() {
  if (_loading && !_networkLoaded) return 'loading the transmission trace...';
  if (_loading) return 'refreshing the gas register...';
  if (_status === 'error') return _error || 'unavailable';
  const parts = [];
  if (_networkStats?.lengthKm) parts.push(`${formatKm(_networkStats.lengthKm)} of trace`);
  if (_plants.length) parts.push(`${_plants.length} centrales`);
  if (_injections.length) parts.push(`${_injections.length} injection sites`);
  if (_error) parts.push(_error);
  return parts.join(' · ');
}

/** Réseau gaz (FR) layer. @type {Object} */
const gasFranceLayer = {
  id: GAS_FR_LAYER_ID,
  name: 'Réseau gaz (FR)',
  icon: '⬡',
  source: 'NaTran / Teréga / ODRÉ',
  updateInterval: UPDATE_INTERVAL_MS,

  init(viewer) {
    _viewer = viewer;
    _points = new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT });
    _points.show = false;
    viewer.scene.primitives.add(_points);
    registerSpriteCollection(GAS_FR_LAYER_ID, _points);

    _networkSource = new Cesium.CustomDataSource('Réseau gaz (FR) — tracé de transport');
    _networkSource.show = false;
    viewer.dataSources.add(_networkSource);

    _enabled = false;
    _records = new Map();
    _plants = [];
    _injections = [];
    _operators = [];
    _selectedId = null;
    _networkPromise = null;
    _networkLoaded = false;
    _sitesLoaded = false;
    _loading = false;
    _error = null;
    _status = 'idle';
    _lastUpdate = null;
    _networkStats = null;
    _siteStats = null;
    _source = null;
    _classificationType = gasClassificationTypeForScene(viewer?.scene);

    if (typeof window !== 'undefined' && !_mapStackListener) {
      _mapStackListener = (event) => {
        applyClassification(event?.detail?.activeId !== undefined
          ? gasClassificationTypeForStack(event.detail.activeId)
          : gasClassificationTypeForScene(_viewer?.scene));
      };
      window.addEventListener('gev:map-stack-changed', _mapStackListener);
    }

    _overlayHost.setVisible(GAS_FR_OVERLAY_SOURCE_ID, false);
    _overlayHost.setVisible(GAS_FR_SELECTED_OVERLAY_SOURCE_ID, false);
    restoreSpriteOrder(viewer);
    console.log('[Data:Gas FR] Initialized');
  },

  enable(viewer) {
    _enabled = true;
    _error = null;
    if (_points) _points.show = true;
    if (_networkSource) _networkSource.show = true;
    // The boot-time stack settle fires no event, so re-derive on every enable
    // rather than trusting whatever the last event left behind.
    applyClassification(gasClassificationTypeForScene(viewer?.scene || _viewer?.scene));
    _overlayHost.setVisible(GAS_FR_OVERLAY_SOURCE_ID, true);
    _overlayHost.setVisible(GAS_FR_SELECTED_OVERLAY_SOURCE_ID, true);
    installClickHandler(viewer);
    registerPickOwner(GAS_FR_LAYER_ID, (pickedId) => _records.has(pickedId));
    if (!_preRenderRemover) {
      _preRenderRemover = viewer.scene.preRender.addEventListener(onPreRender);
    }
    publishOverlay();
    void load();
    restoreSpriteOrder(viewer);
  },

  disable() {
    _enabled = false;
    clearSelection();
    if (_points) _points.show = false;
    if (_networkSource) _networkSource.show = false;
    _overlayHost.clearSource(GAS_FR_OVERLAY_SOURCE_ID);
    _overlayHost.setVisible(GAS_FR_OVERLAY_SOURCE_ID, false);
    _overlayHost.setVisible(GAS_FR_SELECTED_OVERLAY_SOURCE_ID, false);
    if (_clickHandler) {
      _clickHandler.destroy();
      _clickHandler = null;
    }
    if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeyDown);
    unregisterPickOwner(GAS_FR_LAYER_ID);
    if (_preRenderRemover) {
      _preRenderRemover();
      _preRenderRemover = null;
    }
    _loading = false;
    _status = 'idle';
  },

  async update() {
    if (!_enabled) return false;
    return load();
  },

  getDetectableObjects(options = {}) {
    return collectDetectableObjects(options);
  },

  /**
   * Snapshot the sites for the analyst query engine. On-demand only, and the
   * pipes are deliberately absent: a stroke is a trace fragment, not an object
   * anyone can ask a question about.
   * @param {number} [maxCount=900]
   * @returns {Array<Object>}
   */
  getAnalystRecords(maxCount = 900) {
    if (!_enabled) return [];
    const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 900;
    const result = [];
    for (const site of [..._plants, ..._injections]) {
      if (result.length >= limit) break;
      result.push(mapGasAnalystRecord(site, result.length));
    }
    return result;
  },

  /**
   * The key to what is on screen: two networks, two kinds of site.
   *
   * The injection rows are split by network tier because that split is the
   * layer's central honesty point — most of these sites feed a network that is
   * NOT drawn, and a single "850 injection points" row would let the eye join
   * every green dot to the nearest blue stroke.
   * @returns {{chips: Array<object>, legend: Array<object>}}
   */
  getRowControls() {
    const legend = [];
    for (const operator of _operators) {
      legend.push({
        label: operator.label,
        color: operator.color,
        count: operator.strokes,
        blurb: `${formatKm(operator.lengthKm)} of published trace across `
          + `${operator.departements} départements — simplified to about 250 m by the operator, `
          + 'never redrawn here.',
      });
    }
    if (_plants.length) {
      const mw = _siteStats?.plants?.fleetMw;
      legend.push({
        label: 'Centrales gaz',
        color: GAS_PLANT_COLOR,
        count: _plants.length,
        blurb: `${formatMw(mw)} installed, sized by nameplate power. Installed capacity — `
          + 'what these machines are producing right now is the Mix élec layer.',
      });
    }
    const transport = _injections.filter((site) => site.tier === 'transport').length;
    const distribution = _injections.length - transport;
    if (transport) {
      legend.push({
        label: 'Injection · transport',
        color: GAS_INJECTION_COLOR,
        count: transport,
        blurb: GAS_NETWORK_TIERS.transport.blurb,
      });
    }
    if (distribution) {
      legend.push({
        label: 'Injection · distribution',
        color: GAS_INJECTION_COLOR,
        count: distribution,
        blurb: GAS_NETWORK_TIERS.distribution.blurb,
      });
    }
    return { chips: [], legend };
  },

  getStats() {
    const stats = {
      count: _plants.length + _injections.length,
      lastUpdate: _lastUpdate,
      loading: _loading,
      status: _status === 'ready' ? 'ok' : _status,
      networkKm: _networkStats?.lengthKm ?? null,
      networkStrokes: _networkStats?.strokes ?? null,
      plants: _plants.length,
      plantMw: _siteStats?.plants?.fleetMw ?? null,
      injectionSites: _injections.length,
      injectionGwhPerYear: _siteStats?.injections?.capacityGwh ?? null,
      // Licence Ouverte 2.0 obliges the producer AND the data's update date.
      // The power-station file's own newest edition IS that date; the ODRÉ
      // catalogue's `modified` for it is six years older and is not used.
      plantEdition: _siteStats?.plants?.editionTo ?? null,
      feedSource: _source,
    };
    const label = buildLoadingLabel();
    if (label) stats.loadingLabel = label;
    if (_error) stats.error = _error;
    return stats;
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
      unregisterPickOwner(GAS_FR_LAYER_ID);
    }
    if (typeof window !== 'undefined' && _mapStackListener) {
      window.removeEventListener('gev:map-stack-changed', _mapStackListener);
      _mapStackListener = null;
    }
    if (_preRenderRemover) {
      _preRenderRemover();
      _preRenderRemover = null;
    }
    if (_points) {
      unregisterSpriteCollection(GAS_FR_LAYER_ID, _points);
      viewer?.scene?.primitives?.remove?.(_points);
      _points = null;
    }
    if (_networkSource) {
      viewer?.dataSources?.remove?.(_networkSource, true);
      _networkSource = null;
    }
    _records.clear();
    _plants = [];
    _injections = [];
    _operators = [];
    _networkPromise = null;
    _networkLoaded = false;
    _sitesLoaded = false;
    _viewer = null;
  },
};

/** Seed rendered records so selection/card/legend paths run without WebGL. */
export function _setGasStateForTest({
  viewer, records, plants, injections, operators, overlayHost, siteStats, networkStats,
  enabled = true,
} = {}) {
  _viewer = viewer || null;
  if (records) _records = records instanceof Map ? records : new Map(Object.entries(records));
  if (plants) _plants = plants;
  if (injections) _injections = injections;
  if (operators) _operators = operators;
  if (siteStats !== undefined) _siteStats = siteStats;
  if (networkStats !== undefined) _networkStats = networkStats;
  _overlayHost = overlayHost || DEFAULT_OVERLAY_HOST;
  _enabled = enabled;
  _selectedId = null;
}

/** @returns {?string} */
export function _gasSelectedIdForTest() {
  return _selectedId;
}

export function _selectGasObjectForTest(id) {
  selectObject(id);
}

export function _clearGasSelectionForTest() {
  clearSelection();
}

export function _gasRowControlsForTest() {
  return gasFranceLayer.getRowControls();
}

export function _gasDetectablesForTest(options) {
  return collectDetectableObjects(options);
}

export default gasFranceLayer;
