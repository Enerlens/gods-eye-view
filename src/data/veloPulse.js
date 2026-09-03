import * as Cesium from 'cesium';
import { governorRequestRender, holdContinuousRender, releaseContinuousRender } from '../renderGovernor.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { mountPulseHud } from './veloPulseHud.js';
import {
  PULSE_RAMP,
  networkBusiest,
  networkCurve,
  pulseBand,
  pulseRadiusM,
  pulseRampRgb,
  pulseSiteDetails,
  sitePeak,
  slotForDate,
  slotLabel,
  summarizePack,
  validatePack,
  valueAt,
  valueAtFraction,
  wrapSlot,
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
 *     commuter origin; the reverse is a destination. 450 stations.
 *   · **Paris measures FLOWS.** How many cyclists pass each permanent counter,
 *     hour by hour. People going by, not bicycles standing still. 111 counters.
 *
 * ── A HEAT FIELD, AND WHY THE COLUMNS HAD TO GO ─────────────────────────────
 * This layer first shipped as 561 extruded squares: colour for the share, HEIGHT
 * for the absolute quantity. On screen that is a field of floating cubes — one
 * hiding the next, unreadable at nadir where the height channel disappears
 * entirely, and unreadable from far enough away to see a city's shape. A
 * scatter of confetti is not a picture of a city's week.
 *
 * It is drawn as a heat field now: one soft, ground-clamped blob per site,
 * overlapping its neighbours the way a density map does.
 *
 *   · **Colour** is the share of that site's own weekly maximum, on the same
 *     five-band ramp the legend counts — interpolated between the bands, so a
 *     site crossing a threshold swells rather than snaps.
 *   · **Area** is the absolute quantity in that city's own unit — bikes standing
 *     at a Vélo'v dock, cyclists counted in an hour at a Paris counter. Area and
 *     not radius: doubling a radius quadruples the ink, and a reader comparing
 *     two discs reads the ink.
 *
 * Nothing is extruded and nothing floats. What was in the height is now in the
 * spread, and the map reads as one surface instead of 561 objects.
 *
 * ── THE ANIMATION IS EXPLAINED, SLOWER, AND CAN BE STOPPED ──────────────────
 * SEMAINE used to jump a whole hour every 220 ms — 168 discrete states in 37
 * seconds, with no hour on screen, no shape of the week, and no way to stop on
 * one. The clock now runs BETWEEN the hours at 520 ms each (a week in about 87
 * seconds) and every blob eases toward its next value, so the picture swells
 * instead of strobing.
 *
 * The panel under the globe (`veloPulseHud.js`) is the other half of that fix:
 * the hour in words, what the network is doing at it, the whole week as one
 * strip with a cursor — and that strip is a transport the reader can grab.
 *
 * WHAT IS COMPARABLE IS EACH SITE AGAINST ITSELF. The colour ramp is the share
 * of that site's own weekly maximum, so "this is a busy hour here" reads the
 * same in both cities; the AREA keeps each city's own unit, and the card spells
 * it out. The two cities are 390 km apart and never on screen together, so a
 * shared absolute scale would buy nothing and cost the truth.
 *
 * IT IS A TYPICAL WEEK, NOT THE WEEK. Four weeks of June 2026, averaged hour by
 * hour — stated in the pack, on the row, in the panel and on every card, because
 * a typical week in June is not a typical week in January and a reader who does
 * not know which four weeks these are cannot judge them.
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
 * 520 ms, up from 220. The whole week takes about 87 seconds instead of 37 —
 * slow enough that a reader can watch the morning peak arrive, read the hour it
 * arrived at, and still be there when the evening one does. The old pace was
 * chosen so nobody would walk away before Sunday; what actually happened is
 * that nobody could tell what had changed between one frame and the next.
 */
export const ANIMATION_MS_PER_SLOT = 520;

/**
 * How often the clock is sampled while it runs.
 *
 * 40 ms — 25 times a second — because the blobs are now interpolated BETWEEN
 * the hours and the whole point is that no frame looks like a step. This is a
 * sampling rate, not the speed: the speed is `ANIMATION_MS_PER_SLOT` above.
 */
const ANIMATION_FRAME_MS = 40;

/** The row's legend is repainted at most this often while the clock runs. */
const ROW_REFRESH_MS = 900;

/**
 * Alpha at the bottom of the ramp, and how much more the top band gets.
 *
 * Measured against the basemap the layer is read over, which is bright: at 0.42
 * a busy dock washed out into the streets under it. The gain matters as much as
 * the base — a hot site is more opaque as well as more orange, which is what
 * makes a peak visible from far enough away to see the whole city.
 */
const BLOB_ALPHA_BASE = 0.5;
const BLOB_ALPHA_GAIN = 0.4;
/** An hour nobody sampled: present, and unmistakably not a measurement. */
const BLOB_ALPHA_UNSAMPLED = 0.22;

/**
 * How much wider the sprite's quad is than the blob it draws.
 *
 * The sprite is a radial falloff, so its outer third is nearly transparent: the
 * quad has to be bigger than the radius the data asks for, or the visible disc
 * comes out too small. 2.3 puts the half-alpha ring at the requested radius.
 */
const BLOB_SPRITE_SPREAD = 2.3;

/**
 * Keeps a city's field visible from higher up without inflating it up close.
 *
 * The blobs are sized IN METRES — a 150 m dock is 150 m at every altitude,
 * which is what makes the field a map rather than a scatter of pins. Far away
 * that is honest and invisible: at 100 km a 150 m blob is a pixel. This grows
 * them on the way out so a reader pulling back to see both cities still has
 * something to see, and leaves them alone below 6 km where the field is read.
 */
const BLOB_SCALE_BY_DISTANCE = new Cesium.NearFarScalar(6_000, 1.0, 140_000, 4.5);

/** Card anchor: above the blob, clear of its own glow. */
const CARD_LIFT_M = 70;

/**
 * How a blob finds the ground. `CLAMP_TO_TERRAIN` where the runtime knows it,
 * `CLAMP_TO_GROUND` otherwise — the difference only shows over photogrammetry,
 * where the first keeps the field on the street and the second lifts it onto
 * roofs.
 */
const GROUND_REFERENCE = Cesium.HeightReference.CLAMP_TO_TERRAIN
  ?? Cesium.HeightReference.CLAMP_TO_GROUND;

/** Reused so a 561-site redraw does not mint 561 Cartographics. */
const _groundScratch = new Cesium.Cartographic();
const _colorScratch = new Cesium.Color();

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
  Object.freeze({ id: 'week', label: 'SEMAINE', blurb: 'Déroule les 168 heures d’une semaine type, une heure toutes les 0,5 s.' }),
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
let _curve = null;
let _mode = 'now';
/** Fractional hour of the week actually being drawn. */
let _position = slotForDate();
/** The whole hour every printed number belongs to: `Math.floor(_position)`. */
let _slot = Math.floor(_position);
/** Whether the clock is running. `week` with this false is a paused week. */
let _playing = false;
let _blobs = null;
let _selectionRing = null;
/** record id -> drawn record */
let _records = new Map();
let _selectedId = null;
let _loading = false;
let _error = null;
let _lastUpdate = null;
let _clickHandler = null;
let _tickHandle = null;
let _tickStartedAt = 0;
let _tickStartPosition = 0;
let _hud = null;
let _rowListener = null;
let _rowRefreshedAt = 0;

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

let _blobSprite = null;
let _ringSprite = null;

/**
 * The blob, baked once: a radial falloff, white, tinted per site at draw time.
 *
 * White because a billboard's colour MULTIPLIES its texture, so one sprite
 * serves the whole ramp and the collection stays a single draw call. The
 * falloff is deliberately soft to about 85 % of the radius: hard-edged discs
 * read as 561 objects, and the thing being drawn is one field.
 */
function blobSprite() {
  if (_blobSprite || typeof document === 'undefined') return _blobSprite;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const half = size / 2;
  const gradient = context.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.22, 'rgba(255, 255, 255, 0.92)');
  gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.45)');
  gradient.addColorStop(0.78, 'rgba(255, 255, 255, 0.12)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  _blobSprite = canvas;
  return _blobSprite;
}

/** The selected site's ring — the one mark on the field that is not data. */
function ringSprite() {
  if (_ringSprite || typeof document === 'undefined') return _ringSprite;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  context.lineWidth = 5;
  context.beginPath();
  context.arc(size / 2, size / 2, size / 2 - 8, 0, Math.PI * 2);
  context.stroke();
  _ringSprite = canvas;
  return _ringSprite;
}

function clearCollections() {
  if (_blobs && _viewer?.scene) _viewer.scene.primitives.remove(_blobs);
  _blobs = null;
  _selectionRing = null;
  _records = new Map();
  _selectedId = null;
}

/**
 * Build the records for one whole hour.
 *
 * The value here is read AT THE HOUR, not between hours: this is what the first
 * draw and every test sees, and what every card prints. The animation's
 * in-between values are written straight onto the billboards by
 * {@link paintPosition}.
 *
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
      const share = value !== null && peak ? value / peak : null;
      records.push({
        id: siteId(cityKey, site),
        cityKey,
        city,
        scale,
        site,
        value,
        peak,
        peakSlot: peakRaw?.slot ?? null,
        share,
        color: blobCss(share),
        radiusM: pulseRadiusM(value, city, site),
      });
    }
  }
  return records;
}

/** The map colour for a share, as CSS — for the card accent and the legend. */
function blobCss(share) {
  const { r, g, b } = pulseRampRgb(share);
  return `rgb(${r}, ${g}, ${b})`;
}

/** Write one record's current value onto its billboard. */
function paintRecord(record) {
  const billboard = record.billboard;
  if (!billboard) return;
  const { r, g, b } = pulseRampRgb(record.share);
  const alpha = record.share === null
    ? BLOB_ALPHA_UNSAMPLED
    : BLOB_ALPHA_BASE + BLOB_ALPHA_GAIN * Math.min(1, record.share);
  _colorScratch.red = r / 255;
  _colorScratch.green = g / 255;
  _colorScratch.blue = b / 255;
  _colorScratch.alpha = record.id === _selectedId ? Math.min(1, alpha + 0.28) : alpha;
  billboard.color = _colorScratch;
  const span = record.radiusM * 2 * BLOB_SPRITE_SPREAD;
  billboard.width = span;
  billboard.height = span;
}

/** Draw one billboard per site. Positions never move; only colour and size do. */
function drawRecords(records) {
  clearCollections();
  if (!records.length || !_viewer?.scene) return;
  const sprite = blobSprite();
  for (const record of records) {
    _records.set(record.id, record);
  }
  // No document, no sprite, no field — the records still exist so the legend,
  // the stats and the tests have something to read.
  if (!sprite) return;
  _blobs = new Cesium.BillboardCollection({
    scene: _viewer.scene,
    blendOption: Cesium.BlendOption.TRANSLUCENT,
  });
  for (const record of _records.values()) {
    record.billboard = _blobs.add({
      id: record.id,
      position: Cesium.Cartesian3.fromDegrees(record.site.lon, record.site.lat, 0),
      // CLAMPED, not sampled once. The field is built ONCE now, and a build
      // that happens before the terrain under Lyon has loaded would otherwise
      // leave 450 blobs pinned to the ellipsoid — 170 m under the city — for
      // the rest of the session. Cesium re-seats a clamped billboard as tiles
      // arrive; TERRAIN and not GROUND so the field stays on the street rather
      // than climbing onto photogrammetry roofs.
      heightReference: GROUND_REFERENCE,
      image: sprite,
      sizeInMeters: true,
      width: 1,
      height: 1,
      scaleByDistance: BLOB_SCALE_BY_DISTANCE,
      // A heat field belongs ON the city, not inside it: without this a blob
      // sits behind every building that happens to stand between it and the
      // camera, and the field dissolves the moment the 3D tiles load.
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
    paintRecord(record);
  }
  const ring = ringSprite();
  if (ring) {
    _selectionRing = _blobs.add({
      position: Cesium.Cartesian3.fromDegrees(0, 0, 0),
      heightReference: GROUND_REFERENCE,
      image: ring,
      sizeInMeters: true,
      width: 1,
      height: 1,
      scaleByDistance: BLOB_SCALE_BY_DISTANCE,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      show: false,
    });
  }
  _blobs.show = _enabled;
  _viewer.scene.primitives.add(_blobs);
  governorRequestRender('velo-pulse');
}

/**
 * Move every blob to a fractional position in the week.
 *
 * This is the animation's whole per-frame cost: one interpolation, one colour
 * and one size per site. Nothing is rebuilt, no geometry is tessellated, and
 * the positions were computed once — which is what lets the clock run at 25 Hz
 * over 561 sites without the scene stuttering the way the rebuilt-primitive
 * version did.
 */
function paintPosition(position) {
  for (const record of _records.values()) {
    const value = valueAtFraction(record.site, position, record.scale);
    record.value = value;
    record.share = value !== null && record.peak ? value / record.peak : null;
    record.radiusM = pulseRadiusM(value, record.city, record.site);
    // NOT `record.color`: that is a CSS string, one card reads it, and minting
    // 561 of them 25 times a second is 14 000 throwaway strings a second for
    // one accent. The blob takes its colour from the channels directly.
    paintRecord(record);
  }
  if (_selectedId) syncSelectionRing(_records.get(_selectedId));
  governorRequestRender('velo-pulse-frame');
}

/**
 * Build the field, once.
 *
 * THE OLD LAYER REBUILT ITS WHOLE PRIMITIVE EVERY HOUR OF THE ANIMATION —
 * 561 extruded polygons re-tessellated 168 times a week, which is why it had to
 * be synchronous and why it stuttered anyway. Nothing about a site's POSITION
 * depends on the hour, so the field is built once and every later hour is a
 * colour and a diameter on billboards that already exist. That is also what
 * makes the strip draggable: a scrub is a repaint, not a rebuild, so 30 seek
 * events during one drag cost 30 repaints instead of 17 000 polygons.
 *
 * @param {object} [options]
 * @param {boolean} [options.rebuild] Discard and rebuild — a new pack, or a
 *   re-enable that has to re-seat every blob on freshly loaded terrain.
 */
function ensureField({ rebuild = false } = {}) {
  if (!_pack || !_viewer) return;
  if (!rebuild && _records.size) return;
  const selected = _selectedId;
  drawRecords(buildRecords(_pack, _slot));
  paintPosition(_position);
  if (selected && _records.has(selected)) selectSite(selected);
}

/**
 * The one place the clock, the map, the panel and the row agree on an hour.
 *
 * @param {number} position Fractional hour of the week.
 * @param {object} [options]
 * @param {boolean} [options.force] Repaint even if the hour has not changed.
 */
function setPosition(position, { force = false } = {}) {
  const wrapped = wrapSlot(position);
  const slot = Math.floor(wrapped);
  const slotChanged = slot !== _slot;
  _position = wrapped;
  _slot = slot;
  paintPosition(wrapped);
  _hud?.setPosition(wrapped, _playing);
  if (!slotChanged && !force) return;
  // Everything below is per-HOUR, never per-frame: the card's numbers, the
  // fiche's numbers, and the row's band counts all describe a whole measured
  // hour, and repainting them 25 times a second would be 25 times the DOM for
  // the same sentence.
  if (_selectedId) {
    const record = _records.get(_selectedId);
    if (record) {
      publishSelectedCard(record);
      _hud?.refreshSelection(_pack, _slot);
    }
  }
  notifyRow();
}

function notifyRow({ immediate = false } = {}) {
  if (typeof _rowListener !== 'function') return;
  const now = Date.now();
  if (!immediate && now - _rowRefreshedAt < ROW_REFRESH_MS) return;
  _rowRefreshedAt = now;
  _rowListener();
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
  _playing = false;
}

function startTick() {
  stopTick();
  _playing = true;
  _tickStartedAt = Date.now();
  _tickStartPosition = _position;
  // The governor runs the scene in requestRenderMode; without a hold, a redraw
  // nobody asks to paint simply never appears.
  holdContinuousRender(PULSE_LAYER_ID);
  _tickHandle = setInterval(() => {
    const elapsed = Date.now() - _tickStartedAt;
    setPosition(_tickStartPosition + elapsed / ANIMATION_MS_PER_SLOT);
  }, ANIMATION_FRAME_MS);
  _hud?.setPosition(_position, true);
}

function applyMode(mode) {
  _mode = mode;
  if (mode === 'week') {
    startTick();
    return;
  }
  stopTick();
  showSlot(slotForMode(mode, _pack));
}

/** Jump to a whole hour and repaint everything that quotes it. */
function showSlot(slot) {
  _position = wrapSlot(slot);
  _slot = Math.floor(_position);
  ensureField();
  setPosition(_position, { force: true });
}

/**
 * A scrub on the panel's strip: stop on the hour asked for, and say so.
 *
 * Scrubbing IS the week — you are looking at an hour of it that is not the
 * current one — so it moves the layer into SEMAINE and pauses it there. The
 * mode chip in the layer row follows, because a row reading MAINTENANT over a
 * globe showing Thursday 15:00 would be a lie told by the interface.
 */
function seekTo(slot) {
  const wasWeek = _mode === 'week';
  stopTick();
  _mode = 'week';
  showSlot(slot);
  notifyRow({ immediate: !wasWeek });
}

function togglePlay() {
  if (_playing) {
    stopTick();
    _hud?.setPosition(_position, false);
    notifyRow({ immediate: true });
    return;
  }
  _mode = 'week';
  startTick();
  notifyRow({ immediate: true });
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

/**
 * The card for one selected site.
 *
 * The instrument is named on every card, first, because the two cities are not
 * measuring the same thing and a reader who has just flown from Lyon to Paris
 * has no other way to know. The lines themselves come from `pulseSiteDetails`,
 * which the panel under the globe reads too — the anchored card and the fiche
 * are the same claim, and they must never print two different numbers.
 *
 * @param {object} record
 * @param {object} pack
 * @returns {object|null}
 */
export function createPulseOverlayEntry(record, pack) {
  if (!record?.site) return null;
  const { site } = record;
  // Sampled at SELECTION time, not at build time: the card is anchored in the
  // world and a stale ground height would float it off its own dock.
  const lift = renderedGroundM(site.lat, site.lon) + CARD_LIFT_M;
  return {
    id: String(record.id),
    position: Cesium.Cartesian3.fromDegrees(site.lon, site.lat, lift),
    variant: 'selected',
    selected: true,
    protected: true,
    paintLane: 'selected',
    collisionGroup: 'ambient-card',
    priority: Number.MAX_SAFE_INTEGER,
    title: site.name,
    details: pulseSiteDetails(record, pack, _slot),
    accent: blobCss(record.share),
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

function syncSelectionRing(record) {
  if (!_selectionRing) return;
  if (!record) {
    _selectionRing.show = false;
    return;
  }
  _selectionRing.position = Cesium.Cartesian3.fromDegrees(record.site.lon, record.site.lat, 0);
  const span = Math.max(90, record.radiusM * 2) * 1.5;
  _selectionRing.width = span;
  _selectionRing.height = span;
  _selectionRing.show = true;
}

function publishSelectedCard(record) {
  const entry = createPulseOverlayEntry(record, _pack);
  if (!entry) return;
  _overlayHost.setVisible(PULSE_SELECTED_OVERLAY_SOURCE_ID, true);
  _overlayHost.setEntries(PULSE_SELECTED_OVERLAY_SOURCE_ID, [entry], PULSE_SELECTED_OVERLAY_SOURCE_OPTIONS);
}

function clearSelection() {
  const previous = _selectedId ? _records.get(_selectedId) : null;
  _selectedId = null;
  if (previous) paintRecord(previous);
  syncSelectionRing(null);
  _overlayHost.clearSource(PULSE_SELECTED_OVERLAY_SOURCE_ID);
  _hud?.setSelection(null, _pack, _slot);
  governorRequestRender('velo-pulse-deselect');
}

function selectSite(id) {
  const record = _records.get(id);
  if (!record) return false;
  clearSelection();
  _selectedId = id;
  paintRecord(record);
  syncSelectionRing(record);
  // BOTH, and that is the point. The anchored card ties the answer to the dock
  // it is about; the panel is the copy that cannot be hidden — outside the
  // keyhole the card fades to one per cent opacity, which is how a reader
  // clicking near the edge of the scope used to get no answer at all.
  publishSelectedCard(record);
  _hud?.setSelection(record, _pack, _slot);
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
// The panel
// ---------------------------------------------------------------------------
function ensureHud() {
  if (_hud) return _hud;
  _hud = mountPulseHud({
    onSeek: (slot) => seekTo(slot),
    onTogglePlay: () => togglePlay(),
    onClearSelection: () => clearSelection(),
  });
  if (_hud && _pack) _hud.setWeek(_pack, _curve, _summary);
  _hud?.setPosition(_position, _playing);
  return _hud;
}

function destroyHud() {
  _hud?.destroy();
  _hud = null;
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
    _curve = networkCurve(pack.cities);
    _hud?.setWeek(_pack, _curve, _summary);
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
    _position = slotForDate();
    _slot = Math.floor(_position);
    _overlayHost.setVisible(PULSE_SELECTED_OVERLAY_SOURCE_ID, false);
    console.log('[Data:Pouls vélo] Initialized');
  },

  enable(viewer) {
    _enabled = true;
    if (viewer) _viewer = viewer;
    if (_blobs) _blobs.show = true;
    _overlayHost.setVisible(PULSE_SELECTED_OVERLAY_SOURCE_ID, true);
    installClickHandler(_viewer);
    registerPickOwner(PULSE_LAYER_ID, (pickedId) => _records.has(pickedId));
    ensureHud();
    if (_mode === 'week') startTick();
  },

  disable() {
    _enabled = false;
    stopTick();
    clearSelection();
    destroyHud();
    if (_blobs) _blobs.show = false;
    _overlayHost.setVisible(PULSE_SELECTED_OVERLAY_SOURCE_ID, false);
    if (_clickHandler) { _clickHandler.destroy(); _clickHandler = null; }
    if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeyDown);
    unregisterPickOwner(PULSE_LAYER_ID);
  },

  async update() {
    if (!_enabled) return false;
    const ok = await loadPack();
    if (!ok) return false;
    ensureHud();
    ensureField();
    // `now` moves with the wall clock, so an idle refresh is what keeps an
    // overnight session showing the right hour of the week. A PAUSED week is
    // left exactly where the reader put it, and a RUNNING one is not touched:
    // its own clock is already painting it.
    if (_mode !== 'week') showSlot(slotForMode(_mode, _pack));
    else if (!_playing) setPosition(_position, { force: true });
    return true;
  },

  /**
   * A typical week is not a contact. Nothing here is live, nothing moves in
   * the world, and a detection reticle over 561 blobs would drown every
   * layer that does have something to report.
   * @returns {Array}
   */
  getDetectableObjects() {
    return [];
  },

  /**
   * Runtime params. The mode is what the layer IS showing, so it is serialized.
   *
   * The scrubbed HOUR is not: `week` restores as a week that plays, because the
   * option registry encodes a small fixed enum and a 168-value integer is a
   * different kind of link. A paused hour is a reading position, not a state of
   * the world, and it lives as long as the session does.
   *
   * @param {{mode?: string}} [params]
   * @returns {boolean}
   */
  setParams(params = {}) {
    if (params.mode === undefined) return false;
    const next = resolveMode(params.mode);
    if (!next) return false;
    // A repeated `week` is not a no-op when the week is PAUSED: pressing the
    // chip again is how a reader restarts it.
    if (next === _mode && !(next === 'week' && !_playing)) return false;
    applyMode(next);
    return true;
  },

  /** @returns {{mode: string}} */
  getParams() {
    return { mode: _mode };
  },

  /** The row repaints itself while the clock runs; see `notifyRow`. */
  setRowControlsListener(listener) {
    _rowListener = typeof listener === 'function' ? listener : null;
  },

  getRowControls() {
    const chips = PULSE_MODES.map((mode) => ({
      id: mode.id,
      label: mode.id === 'week' && _mode === 'week' && !_playing ? 'SEMAINE ❚❚' : mode.label,
      active: _mode === mode.id,
      state: _mode === mode.id ? 'active' : 'idle',
      title: mode.blurb,
      params: { mode: mode.id },
    }));
    // The legend counts SITES IN EACH BAND at the hour on screen, so it moves
    // with the animation: watching the "≥ 80 %" band fill at 8 a.m. and empty
    // at 3 a.m. is the layer's argument, in the row.
    const counts = new Array(PULSE_RAMP.length).fill(0);
    let unsampled = 0;
    for (const record of _records.values()) {
      // `pulseBand` and not a second copy of the same comparison: the legend
      // and the field must never disagree about which band a site is in.
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
      // The fractional hour actually on screen. The layer draws BETWEEN the
      // hours now, so a reading that only ever reported whole ones could not
      // tell a smooth week from a stepped one.
      position: Math.round(_position * 1000) / 1000,
      slotLabel: slotLabel(_slot),
      mode: _mode,
      playing: _playing,
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
      destroyHud();
      if (_clickHandler) { _clickHandler.destroy(); _clickHandler = null; }
      if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeyDown);
      unregisterPickOwner(PULSE_LAYER_ID);
    }
    clearCollections();
    _pack = null;
    _summary = null;
    _curve = null;
    _rowListener = null;
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
    _curve = pack ? networkCurve(pack.cities) : null;
  }
  if (records) _records = records instanceof Map ? records : new Map(Object.entries(records));
  _overlayHost = overlayHost || DEFAULT_OVERLAY_HOST;
  if (mode) _mode = mode;
  if (Number.isInteger(slot)) {
    _position = slot;
    _slot = slot;
  }
  _enabled = enabled;
  _selectedId = null;
  _error = null;
  _hud = null;
  _rowListener = null;
}

/** @returns {{mode: string, slot: number, ticking: boolean}} Test seam. */
export function _pulseStateForTest() {
  return {
    mode: _mode, slot: _slot, position: _position, playing: _playing, ticking: Boolean(_tickHandle),
  };
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

export function _pulseSeekForTest(slot) {
  seekTo(slot);
}

export function _pulseTogglePlayForTest() {
  togglePlay();
}

export function _pulseStopTickForTest() {
  stopTick();
}

export function _loadPulsePackForTest(fetchImpl) {
  _pack = null;
  return loadPack(fetchImpl);
}

export default veloPulseLayer;
