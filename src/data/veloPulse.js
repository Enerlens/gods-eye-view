import * as Cesium from 'cesium';
import { governorRequestRender, holdContinuousRender, releaseContinuousRender } from '../renderGovernor.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import {
  PULSE_RAMP,
  PULSE_SLOTS,
  networkBusiest,
  pulseBand,
  pulseColor,
  pulseHeightM,
  pulseReading,
  sitePeak,
  slotForDate,
  slotLabel,
  summarizePack,
  validatePack,
  valueAt,
} from './veloPulseFeed.js';

/**
 * Pouls vélo — one typical week of cycling in Lyon and in Paris, and the reason
 * the two cannot be drawn the same way.
 *
 * THE FINDING IS THE LAYER. The Métropole de Lyon publishes the availability of
 * every Vélo'v station continuously since 2023-03-27 — a real archive,
 * filterable per station and per date, the only one of its kind in France.
 * **Paris publishes no equivalent for Vélib' at all.** Verified 2026-09-02:
 * opendata.paris.fr carries two Vélib' datasets and both are real-time only,
 * data.gouv.fr has no availability history, transport.data.gouv.fr's `history`
 * array for the Vélib' dataset is empty, and the community archive everyone
 * cites — `lovasoa/historique-velib-opendata` — was last pushed 2023-04-04 with
 * release assets dated 2021.
 *
 * So the two cities answer through different instruments, and the layer says so
 * on every card rather than quietly averaging them:
 *
 *   · **Lyon measures STOCKS.** How full each dock is, hour by hour. A station
 *     that empties every weekday morning and refills every evening is a
 *     commuter origin; the reverse is a destination. 422 stations.
 *   · **Paris measures FLOWS.** How many cyclists pass each permanent counter,
 *     hour by hour. People going by, not bicycles standing still. 111 counters.
 *
 * WHAT IS COMPARABLE IS EACH SITE AGAINST ITSELF. The colour ramp is the share
 * of that site's own weekly maximum, so "this is a busy hour here" reads the
 * same in both cities; the HEIGHT keeps each city's own unit, and the card
 * spells it out. The two cities are 390 km apart and never on screen together,
 * so a shared absolute scale would buy nothing and cost the truth.
 *
 * IT IS A TYPICAL WEEK, NOT THE WEEK. Four weeks of June 2026, averaged hour by
 * hour — stated in the pack, on the row and on every card, because a typical
 * week in June is not a typical week in January and a reader who does not know
 * which four weeks these are cannot judge them.
 *
 * @module data/veloPulse
 */

/** Layer id — share-link registry key and voice-tool enum value. */
export const PULSE_LAYER_ID = 'velo-pulse-fr';
export const PULSE_LAYER_NAME = 'Pouls vélo';
export const PULSE_SELECTED_OVERLAY_SOURCE_ID = 'velo-pulse-fr-selected';
export const PULSE_SELECTED_OVERLAY_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 1,
  moving: false,
});

const PACK_URL = new URL('./local_data/velo_pulse/pulse.json', import.meta.url).href;

/** The pack never changes at runtime; this is a re-check, not a poll. */
const UPDATE_INTERVAL_MS = 6 * 60 * 60_000;

/**
 * How long one hour of the typical week lasts while the animation runs.
 *
 * 220 ms puts a whole week on screen in 37 seconds — long enough to read the
 * two commuter peaks and the weekend, short enough that nobody walks away
 * before Sunday.
 */
const ANIMATION_MS_PER_SLOT = 220;

const SELECTED_COLOR = '#ffffff';
/** Reused so a 533-site redraw does not mint 533 Cartographics. */
const _groundScratch = new Cesium.Cartographic();

/**
 * The three ways to look at a typical week.
 *
 * `now` is the default and it is the one that makes the layer feel alive: it
 * shows the hour of the week it currently is, so a reader opening the globe on
 * a Tuesday morning sees a Tuesday morning. `week` animates. `peak` freezes on
 * the busiest hour the network as a whole records.
 */
export const PULSE_MODES = Object.freeze([
  Object.freeze({ id: 'now', label: 'MAINTENANT', blurb: 'L’heure de la semaine qu’il est en ce moment.' }),
  Object.freeze({ id: 'week', label: 'SEMAINE', blurb: 'Déroule les 168 heures d’une semaine type.' }),
  Object.freeze({ id: 'peak', label: 'POINTE', blurb: 'L’heure la plus chargée du réseau.' }),
]);

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});

let _viewer = null;
let _overlayHost = DEFAULT_OVERLAY_HOST;
let _enabled = false;
let _pack = null;
let _summary = null;
let _mode = 'now';
let _slot = slotForDate();
let _primitive = null;
/** record id -> drawn record */
let _records = new Map();
let _selectedId = null;
let _loading = false;
let _error = null;
let _lastUpdate = null;
let _clickHandler = null;
let _tickHandle = null;
let _tickStartedAt = 0;
let _tickStartSlot = 0;

/**
 * Resolve a requested mode to one the layer offers.
 * @param {unknown} value
 * @returns {string|null}
 */
export function resolveMode(value) {
  const key = String(value ?? '').trim().toLowerCase();
  return PULSE_MODES.some((mode) => mode.id === key) ? key : null;
}

/** The slot a mode should display, given the pack. */
export function slotForMode(mode, pack, { now = new Date() } = {}) {
  if (mode === 'peak') {
    return networkBusiest(pack?.cities)?.slot ?? slotForDate(now);
  }
  return slotForDate(now);
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------
/** Terrain height the globe is rendering under a point, or 0. */
function renderedGroundM(lat, lon) {
  const globe = _viewer?.scene?.globe;
  if (!globe?.getHeight) return 0;
  _groundScratch.longitude = Cesium.Math.toRadians(lon);
  _groundScratch.latitude = Cesium.Math.toRadians(lat);
  _groundScratch.height = 0;
  const height = globe.getHeight(_groundScratch);
  return Number.isFinite(height) ? height : 0;
}

/** A stable id for one drawn site. */
export function siteId(cityKey, site) {
  return `pulse:${cityKey}:${site.id}`;
}

/**
 * The square footprint a column stands on, in degrees.
 *
 * A fixed 40 m half-width rather than something derived from the data: the
 * column's MEANING is entirely in its height and colour, and letting the
 * footprint vary too would add a third channel nobody asked to read.
 */
const FOOTPRINT_HALF_M = 40;

function footprintDegrees(lon, lat) {
  const dLat = FOOTPRINT_HALF_M / 111_320;
  const dLon = dLat / Math.max(0.2, Math.cos(Cesium.Math.toRadians(lat)));
  return [
    lon - dLon, lat - dLat,
    lon + dLon, lat - dLat,
    lon + dLon, lat + dLat,
    lon - dLon, lat + dLat,
  ];
}

function clearPrimitive() {
  if (_primitive && _viewer?.scene) _viewer.scene.primitives.remove(_primitive);
  _primitive = null;
  _records = new Map();
  _selectedId = null;
}

/**
 * Build the records for one slot.
 * @returns {Array<object>}
 */
export function buildRecords(pack, slot) {
  const records = [];
  for (const [cityKey, city] of Object.entries(pack?.cities || {})) {
    const scale = Number(city.scale) || 1;
    for (const site of city.sites || []) {
      const value = valueAt(site, slot, scale);
      const peakRaw = sitePeak(site);
      const peak = peakRaw ? (scale > 1 ? peakRaw.value / (scale / 100) : peakRaw.value) : null;
      records.push({
        id: siteId(cityKey, site),
        cityKey,
        city,
        site,
        value,
        peak,
        peakSlot: peakRaw?.slot ?? null,
        color: pulseColor(value, peak),
        heightM: pulseHeightM(value, city, site),
      });
    }
  }
  return records;
}

/** Draw one batched primitive for every site at the current slot. */
function drawRecords(records) {
  clearPrimitive();
  if (!records.length || !_viewer) return;
  const instances = [];
  for (const record of records) {
    _records.set(record.id, record);
    const base = renderedGroundM(record.site.lat, record.site.lon);
    instances.push(new Cesium.GeometryInstance({
      id: record.id,
      geometry: new Cesium.PolygonGeometry({
        polygonHierarchy: new Cesium.PolygonHierarchy(
          Cesium.Cartesian3.fromDegreesArray(footprintDegrees(record.site.lon, record.site.lat)),
        ),
        height: base,
        extrudedHeight: base + record.heightM,
        vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
        closeTop: true,
        closeBottom: false,
      }),
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(
          Cesium.Color.fromCssColorString(record.color),
        ),
      },
    }));
  }
  _primitive = new Cesium.Primitive({
    geometryInstances: instances,
    appearance: new Cesium.PerInstanceColorAppearance({ closed: false, translucent: false }),
    // SYNCHRONOUS. The whole point of this layer is that the columns change
    // together every 220 ms; an asynchronous primitive tessellates on a worker
    // and lands a frame or two late, which turns one week's animation into a
    // stutter of half-drawn cities.
    asynchronous: false,
    releaseGeometryInstances: false,
  });
  _primitive.show = _enabled;
  _viewer.scene.primitives.add(_primitive);
  governorRequestRender('velo-pulse');
}

function redraw() {
  if (!_pack || !_viewer) return;
  const selected = _selectedId;
  drawRecords(buildRecords(_pack, _slot));
  if (selected && _records.has(selected)) selectSite(selected);
}

// ---------------------------------------------------------------------------
// The animation
// ---------------------------------------------------------------------------
function stopTick() {
  if (_tickHandle) {
    clearInterval(_tickHandle);
    _tickHandle = null;
    releaseContinuousRender(PULSE_LAYER_ID);
  }
}

function startTick() {
  stopTick();
  _tickStartedAt = Date.now();
  _tickStartSlot = _slot;
  // The governor runs the scene in requestRenderMode; without a hold, a redraw
  // nobody asks to paint simply never appears.
  holdContinuousRender(PULSE_LAYER_ID);
  _tickHandle = setInterval(() => {
    const elapsed = Date.now() - _tickStartedAt;
    const next = (_tickStartSlot + Math.floor(elapsed / ANIMATION_MS_PER_SLOT)) % PULSE_SLOTS;
    if (next === _slot) return;
    _slot = next;
    redraw();
  }, ANIMATION_MS_PER_SLOT);
}

function applyMode(mode) {
  _mode = mode;
  if (mode === 'week') {
    startTick();
    return;
  }
  stopTick();
  _slot = slotForMode(mode, _pack);
  redraw();
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------
const _fr = new Intl.NumberFormat('fr-FR');

/**
 * The card for one selected site.
 *
 * The instrument is named on every card, first, because the two cities are not
 * measuring the same thing and a reader who has just flown from Lyon to Paris
 * has no other way to know.
 *
 * @param {object} record
 * @param {object} pack
 * @returns {object|null}
 */
export function createPulseOverlayEntry(record, pack) {
  if (!record?.site) return null;
  const { site, city, value, peak, peakSlot } = record;
  const details = [];
  details.push(`${slotLabel(_slot)} — ${pulseReading(value, city, site)}`);
  details.push(city.instrument === 'stock'
    ? 'Mesure un STOCK : combien de vélos sont garés là'
    : 'Mesure un FLUX : combien de cyclistes passent là');
  if (peak !== null && peakSlot !== null) {
    // MAXIMUM, not "pointe": a Vélo'v station is at its maximum when it is
    // fullest, which is the middle of the night, and calling that a peak of
    // activity would be exactly backwards. The next line says which it is.
    details.push(`Maximum de la semaine ${slotLabel(peakSlot)} — ${pulseReading(peak, city, site)}`);
    details.push(city.instrument === 'stock'
      ? 'Une station pleine = des vélos garés ; une station vide = des vélos sur la route'
      : 'Un compteur élevé = des cyclistes qui passent en ce moment');
  }
  const samples = site.samples?.[_slot];
  details.push(Number.isFinite(samples) && samples > 0
    ? `Moyenne de ${samples} semaine${samples > 1 ? 's' : ''} sur les 4 relevées`
    : 'Aucun relevé à cette heure de la semaine');
  if (site.commune) details.push(site.commune);
  if (site.direction) details.push(`Sens ${site.direction}`);
  if (site.installedOn) details.push(`Compteur installé le ${site.installedOn}`);
  if (city.instrument === 'stock' && Number.isFinite(site.capacity)) {
    details.push(`${site.capacity} bornettes`);
  }
  details.push(`Semaine type ${pack?.window?.start} → ${pack?.window?.end}`);
  details.push(city.source);

  return {
    id: String(record.id),
    position: Cesium.Cartesian3.fromDegrees(
      site.lon, site.lat, renderedGroundM(site.lat, site.lon) + record.heightM,
    ),
    variant: 'selected',
    selected: true,
    protected: true,
    paintLane: 'selected',
    collisionGroup: 'ambient-card',
    priority: Number.MAX_SAFE_INTEGER,
    title: site.name,
    details,
    accent: record.color,
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

function applyInstanceColor(id, color) {
  if (!_primitive?.ready) return;
  const attributes = _primitive.getGeometryInstanceAttributes(id);
  if (!attributes) return;
  attributes.color = Cesium.ColorGeometryInstanceAttribute.toValue(color, attributes.color);
  governorRequestRender('velo-pulse-recolor');
}

function clearSelection() {
  if (_selectedId) {
    const record = _records.get(_selectedId);
    if (record) applyInstanceColor(_selectedId, Cesium.Color.fromCssColorString(record.color));
  }
  _selectedId = null;
  _overlayHost.clearSource(PULSE_SELECTED_OVERLAY_SOURCE_ID);
}

function selectSite(id) {
  const record = _records.get(id);
  if (!record) return false;
  clearSelection();
  _selectedId = id;
  applyInstanceColor(id, Cesium.Color.fromCssColorString(SELECTED_COLOR));
  const entry = createPulseOverlayEntry(record, _pack);
  if (entry) {
    _overlayHost.setVisible(PULSE_SELECTED_OVERLAY_SOURCE_ID, true);
    _overlayHost.setEntries(PULSE_SELECTED_OVERLAY_SOURCE_ID, [entry], PULSE_SELECTED_OVERLAY_SOURCE_OPTIONS);
  }
  governorRequestRender('velo-pulse-select');
  return true;
}

/** @param {*} picked @param {(id:string)=>boolean} has @returns {?string} */
export function resolvePulsePickId(picked, has = (id) => _records.has(id)) {
  const id = typeof picked?.id === 'string' ? picked.id : picked?.id?.id;
  return typeof id === 'string' && has(id) ? id : null;
}

function onKeyDown(event) {
  if (event.key === 'Escape' && _selectedId) clearSelection();
}

function installClickHandler(viewer) {
  if (_clickHandler || !viewer?.scene?.canvas) return;
  _clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  _clickHandler.setInputAction((click) => {
    const picked = viewer.scene.pick(click.position);
    const id = resolvePulsePickId(picked);
    if (id) { selectSite(id); return; }
    if (!picked && _selectedId) clearSelection();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  if (typeof document !== 'undefined') document.addEventListener('keydown', onKeyDown);
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------
async function loadPack(fetchImpl = fetch) {
  if (_pack) return true;
  _loading = true;
  _error = null;
  try {
    const response = await fetchImpl(PACK_URL);
    if (!response.ok) throw new Error(`pack HTTP ${response.status}`);
    const pack = await response.json();
    const verdict = validatePack(pack);
    // A malformed pack is refused LOUDLY. Drawing half of it would put a city
    // on screen with holes in its week and nothing to say they are holes.
    if (!verdict.ok) throw new Error(`pack invalide : ${verdict.reason}`);
    _pack = pack;
    _summary = summarizePack(pack);
    _lastUpdate = Date.now();
    return true;
  } catch (error) {
    _error = error?.message || String(error);
    console.warn('[Data:Pouls vélo] pack unavailable:', error);
    return false;
  } finally {
    _loading = false;
  }
}

// ---------------------------------------------------------------------------
// The layer
// ---------------------------------------------------------------------------
const veloPulseLayer = {
  id: PULSE_LAYER_ID,
  name: PULSE_LAYER_NAME,
  icon: '◷',
  source: 'Métropole de Lyon · Ville de Paris',
  updateInterval: UPDATE_INTERVAL_MS,

  init(viewer) {
    _viewer = viewer;
    _enabled = false;
    _records = new Map();
    _selectedId = null;
    _error = null;
    _mode = 'now';
    _slot = slotForDate();
    _overlayHost.setVisible(PULSE_SELECTED_OVERLAY_SOURCE_ID, false);
    console.log('[Data:Pouls vélo] Initialized');
  },

  enable(viewer) {
    _enabled = true;
    if (viewer) _viewer = viewer;
    if (_primitive) _primitive.show = true;
    _overlayHost.setVisible(PULSE_SELECTED_OVERLAY_SOURCE_ID, true);
    installClickHandler(_viewer);
    registerPickOwner(PULSE_LAYER_ID, (pickedId) => _records.has(pickedId));
    if (_mode === 'week') startTick();
  },

  disable() {
    _enabled = false;
    stopTick();
    clearSelection();
    if (_primitive) _primitive.show = false;
    _overlayHost.setVisible(PULSE_SELECTED_OVERLAY_SOURCE_ID, false);
    if (_clickHandler) { _clickHandler.destroy(); _clickHandler = null; }
    if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeyDown);
    unregisterPickOwner(PULSE_LAYER_ID);
  },

  async update() {
    if (!_enabled) return false;
    const ok = await loadPack();
    if (!ok) return false;
    // `now` moves with the wall clock, so an idle refresh is what keeps an
    // overnight session showing the right hour of the week.
    if (_mode !== 'week') _slot = slotForMode(_mode, _pack);
    redraw();
    return true;
  },

  /**
   * A typical week is not a contact. Nothing here is live, nothing moves in
   * the world, and a detection reticle over 533 columns would drown every
   * layer that does have something to report.
   * @returns {Array}
   */
  getDetectableObjects() {
    return [];
  },

  /**
   * Runtime params. The mode is what the layer IS showing, so it is serialized.
   * @param {{mode?: string}} [params]
   * @returns {boolean}
   */
  setParams(params = {}) {
    if (params.mode === undefined) return false;
    const next = resolveMode(params.mode);
    if (!next || next === _mode) return false;
    applyMode(next);
    return true;
  },

  /** @returns {{mode: string}} */
  getParams() {
    return { mode: _mode };
  },

  getRowControls() {
    const chips = PULSE_MODES.map((mode) => ({
      id: mode.id,
      label: mode.label,
      active: _mode === mode.id,
      state: _mode === mode.id ? 'active' : 'idle',
      title: mode.blurb,
      params: { mode: mode.id },
    }));
    // The legend counts SITES IN EACH BAND at the hour on screen, so it moves
    // with the animation: watching the "pointe" band fill at 8 a.m. and empty
    // at 3 a.m. is the layer's argument, in the row.
    const counts = new Array(PULSE_RAMP.length).fill(0);
    let unsampled = 0;
    for (const record of _records.values()) {
      // `pulseBand` and not a second copy of the same comparison: the legend
      // and the columns must never disagree about which band a site is in.
      const band = pulseBand(record.value, record.peak);
      if (band < 0) unsampled += 1;
      else counts[band] += 1;
    }
    const legend = PULSE_RAMP.map((entry, index) => ({
      label: entry.label,
      color: entry.color,
      count: counts[index],
      blurb: `Part du maximum hebdomadaire du site — ${entry.label}`,
    }));
    if (unsampled > 0) {
      legend.push({
        label: 'non relevé',
        color: '#4a5568',
        count: unsampled,
        blurb: 'Aucun relevé à cette heure de la semaine pour ce site.',
      });
    }
    return { chips, legend };
  },

  getStats() {
    const result = {
      count: _records.size,
      slot: _slot,
      slotLabel: slotLabel(_slot),
      mode: _mode,
      sites: _summary?.sites ?? 0,
      cities: _summary?.byCity ?? null,
      window: _summary?.window ?? null,
      lastUpdate: _lastUpdate,
      loading: _loading,
      status: _error ? 'unavailable' : 'ok',
      feedSource: 'Métropole de Lyon (Licence Ouverte 2.0) · Ville de Paris (ODbL)',
    };
    if (_error) result.error = _error;
    else if (_loading) result.loadingLabel = 'Semaine type…';
    else result.loadingLabel = `${slotLabel(_slot)} — semaine type de juin 2026`;
    return result;
  },

  destroy(viewer) {
    if (_enabled) this.disable(viewer);
    else {
      stopTick();
      clearSelection();
      if (_clickHandler) { _clickHandler.destroy(); _clickHandler = null; }
      if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeyDown);
      unregisterPickOwner(PULSE_LAYER_ID);
    }
    clearPrimitive();
    _pack = null;
    _summary = null;
    _viewer = null;
  },
};

/** Seed drawn state so selection, card and legend paths run without WebGL. */
export function _setPulseStateForTest({
  viewer, pack, records, overlayHost, mode, slot, enabled = true,
} = {}) {
  _viewer = viewer || null;
  if (pack !== undefined) {
    _pack = pack;
    _summary = pack ? summarizePack(pack) : null;
  }
  if (records) _records = records instanceof Map ? records : new Map(Object.entries(records));
  _overlayHost = overlayHost || DEFAULT_OVERLAY_HOST;
  if (mode) _mode = mode;
  if (Number.isInteger(slot)) _slot = slot;
  _enabled = enabled;
  _selectedId = null;
  _error = null;
}

/** @returns {{mode: string, slot: number}} Test seam. */
export function _pulseStateForTest() {
  return { mode: _mode, slot: _slot, ticking: Boolean(_tickHandle) };
}

export function _pulseRowControlsForTest() {
  return veloPulseLayer.getRowControls();
}

export function _pulseStatsForTest() {
  return veloPulseLayer.getStats();
}

export function _pulseSetParamsForTest(params) {
  return veloPulseLayer.setParams(params);
}

export function _pulseStopTickForTest() {
  stopTick();
}

export function _loadPulsePackForTest(fetchImpl) {
  _pack = null;
  return loadPack(fetchImpl);
}

export default veloPulseLayer;
