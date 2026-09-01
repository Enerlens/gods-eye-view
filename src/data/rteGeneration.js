import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import { registerSpriteCollection, restoreSpriteOrder, unregisterSpriteCollection } from './spriteOrder.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import { cachedGroundFloor, warmGroundFloor } from './groundFloor.js';
import { horizonOccluder } from './iconOrientation.js';
import {
  clearOverlaySource,
  hitTestWorldOverlay,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { pickOverlayLabelId } from './overlayLabelPick.js';
import {
  RTE_CLASS_ORDER,
  RTE_GENERATION_CLASSES,
  generationSparkline,
  joinGenerationToRegistry,
  rteGenerationClass,
} from './rteGenerationFeed.js';

/**
 * Groupes de prod (FR) — every French power station of 100 MW or more, at the
 * output RTE last published for each of its units.
 *
 * This is the layer the Réseau gaz card points at when it says a station's live
 * output "is the Mix élec layer's `gaz` filière, a national figure that RTE
 * does not break down per station without an API account". This is that
 * account, and this is that breakdown: 171 units across 108 stations, 63.0 GW
 * of it in 57 reactors.
 *
 * ── Two halves, and only one of them needs a key ────────────────────────────
 *
 * The FLEET is a shipped file — `local_data/rte_production_units/units.json`,
 * built from ODRÉ's register by `scripts/build-rte-units-registry.mjs`. Names,
 * installed power, filière, commune, position: all of it draws on `git clone`
 * with no credential at all.
 *
 * The OUTPUT comes from `/api/rte-generation`, which needs a free RTE account.
 * Without one the layer is a complete map of French generating capacity that
 * says, on every card and in the readout, that nobody has told it what these
 * machines are doing. With one, the discs fill.
 *
 * ── The grammar of a station ────────────────────────────────────────────────
 *
 * Every station is a RING sized by its installed power, and the ring is the
 * only thing this layer is ever certain about. Inside it:
 *
 *   faint ring, empty     RTE published nothing for this station in the window
 *                         (or there is no key). NOT the same as "it is off".
 *   crisp ring, empty     measured, and producing zero. A station in outage —
 *                         which for a reactor is the most interesting state it
 *                         has, and the one a `value || 0` guard would erase.
 *   crisp ring + disc     measured and producing; the disc fills the ring at
 *                         full load, on a √ ramp so area tracks power.
 *   magenta disc          measured and DRAWING from the grid. Usually a unit
 *                         that is shut down and still running its own pumps and
 *                         instrumentation — a stopped 1 500 MW reactor is a
 *                         ~50 MW load — and sometimes pumped storage filling
 *                         its upper lake. Not a small amount of generation; the
 *                         opposite of generation.
 *
 * That distinction between "unknown" and "zero" is the whole reason the ring
 * and the disc are two primitives rather than one coloured point.
 *
 * ── What this layer refuses to do ───────────────────────────────────────────
 *
 * • **It never draws a reactor.** No open source publishes where an individual
 *   reactor building is — OpenStreetMap has zero `generator:source=nuclear`
 *   elements over France. So Gravelines is ONE ring with six groups on its
 *   card, not six discs in a row invented from a site outline.
 *
 * • **It never hides where the ring came from.** RTE publishes no coordinate,
 *   so every position is derived and every card names its own anchor: 69 of
 *   the 108 stations sit on EDF's own published coordinate for its own
 *   station, 11 on an OpenStreetMap `power=plant` outline, 13 on the RTE
 *   switchyard their register entry names, and 15 at the centre of their
 *   commune because nothing better is published — including four offshore wind
 *   farms whose rings are therefore on the beach.
 *
 * • **It never reconciles the two capacities.** RTE's `installed_capacity` and
 *   the register's `puismaxinstallee` are different administrative numbers for
 *   the same machine; when they disagree the card shows both.
 *
 * • **It never quietly drops a unit.** A unit RTE reports that the shipped
 *   register has never heard of is counted in the readout as unplaced, with
 *   its megawatts, because there is nowhere honest to draw it.
 *
 * The upstream traps live in `rteGenerationFeed.js` under test; this module is
 * the drawing.
 */

const LIVE_URL = '/api/rte-generation';
const REGISTRY_URL = new URL(
  './local_data/rte_production_units/units.json',
  import.meta.url,
).href;

/** Layer id — also the share-link registry key and the voice-tool enum value. */
export const RTE_GEN_LAYER_ID = 'rte-generation';
/**
 * Prefix for every render id this layer puts in the scene.
 *
 * A station's registry id is its RTE substation code — `GRAV5`, `BUGEY`,
 * `INSEE:2A004` — which is short, opaque and owned by nobody. Namespacing the
 * render id keeps a pick from ever crossing into another layer's ids, the rule
 * `power-grid:` and `gas-fr:` already follow.
 */
export const RTE_GEN_RENDER_PREFIX = 'rte-gen:';
/** Suffix marking the OUTPUT disc drawn inside a station's capacity ring. */
export const RTE_GEN_OUTPUT_SUFFIX = ':out';

/** Ambient labels: the biggest stations. */
export const RTE_GEN_OVERLAY_SOURCE_ID = 'rte-generation';
/** Selected-object card, on its own protected source. */
export const RTE_GEN_SELECTED_OVERLAY_SOURCE_ID = 'rte-generation-selected';
/** Ambient-label entry-id prefix — the click surface the station's NAME provides. */
export const RTE_GEN_LABEL_PREFIX = 'rte-gen-label:';
/** 108 stations; the label cohort is the handful worth naming at a glance. */
export const RTE_GEN_OVERLAY_COHORT_LIMIT = 14;
/** Shared ambient-label paint budget, matching the sibling French sources. */
export const RTE_GEN_OVERLAY_COLLISION_CAPACITY = 12;

export const RTE_GEN_SELECTED_OVERLAY_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 1,
  moving: false,
});

/** The scene id for one station. */
export function rteRenderId(siteId) {
  return `${RTE_GEN_RENDER_PREFIX}${siteId}`;
}

/**
 * Idle refresh cadence.
 *
 * The resource publishes hourly and the proxy holds a 5-minute cache in front
 * of it, so three minutes is already faster than anything can change. It is
 * this short because the interesting event on this layer — a reactor coming
 * back or dropping out — is a step change, and a step change is worth seeing
 * within one poll.
 */
const UPDATE_INTERVAL_MS = 180_000;

const REQUEST_TIMEOUT_MS = 45_000;

/** Stations sit this far above the local ground floor. */
const POINT_LIFT_M = 2.5;

/** Capacity ring: 100 MW → ~12 px, Gravelines' 5 460 MW → 30 px, on a √ ramp. */
const RING_MIN_PX = 9;
const RING_MAX_PX = 30;
const RING_REFERENCE_MW = 5460;

/** A producing station always shows SOMETHING, even at 1% of nameplate. */
const DISC_MIN_PX = 3;

/** Ring outline opacity, measured vs unmeasured. The whole grammar in two numbers. */
const RING_ALPHA_MEASURED = 0.95;
const RING_ALPHA_UNMEASURED = 0.32;
/** Ring fill. Nearly transparent — it is a boundary, not a body. */
const RING_FILL_ALPHA = 0.1;

/** A negative reading is consumption, and gets its own colour rather than a smaller disc. */
export const RTE_PUMPING_COLOR = '#ff4dd2';

const SELECTED_COLOR = '#00ffff';

/** Unit rows printed on a station card before the tail is summarised. */
const CARD_UNIT_ROWS = 8;

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
  hitTest: hitTestWorldOverlay,
});

/** Human caption for each placement anchor, printed on every card. */
export const RTE_PLACEMENT_NOTES = Object.freeze({
  'edf-published': 'drawn on EDF’s own published coordinate for this station',
  'osm-plant': 'drawn on the OpenStreetMap outline of the station itself',
  'rte-switchyard': 'drawn on the RTE switchyard its register entry names — the yard, not the hall',
  'commune-centre': 'drawn at the centre of its commune — no open source publishes the station',
});

/**
 * Ring diameter for an installed capacity.
 * A station with no published power still draws, at the floor size, so it is
 * present and visibly unquantified rather than absent.
 * @param {?number} mw
 * @returns {number}
 */
export function rteRingSize(mw) {
  if (!Number.isFinite(mw) || mw <= 0) return RING_MIN_PX;
  const ratio = Math.min(1, Math.sqrt(mw / RING_REFERENCE_MW));
  return Math.round(RING_MIN_PX + ratio * (RING_MAX_PX - RING_MIN_PX));
}

/**
 * Disc diameter inside a ring, for a load fraction.
 *
 * √ so the disc's AREA tracks the power, which is what the eye reads. The sign
 * is dropped here and carried by the colour instead: a station pumping at 80%
 * is as big an event as one generating at 80%, and drawing it small would say
 * the opposite.
 * @param {number} ringPx
 * @param {?number} load - Signed output ÷ installed capacity.
 * @returns {number} 0 when there is nothing to draw.
 */
export function rteDiscSize(ringPx, load) {
  if (!Number.isFinite(load) || load === 0) return 0;
  const ratio = Math.min(1, Math.sqrt(Math.abs(load)));
  return Math.max(DISC_MIN_PX, Math.round(ringPx * ratio));
}

/**
 * Format a megawatt figure the way a control room writes it.
 *
 * The minus is U+2212, not a hyphen: this layer prints negative megawatts
 * beside negative percentages and the two have to look like the same sign.
 */
export function formatGenMw(mw) {
  if (!Number.isFinite(mw)) return '—';
  const abs = Math.abs(mw);
  const sign = mw < 0 ? '−' : '';
  if (abs >= 10_000) return `${sign}${(abs / 1000).toFixed(1)} GW`;
  return `${sign}${Math.round(abs).toLocaleString('en-US')} MW`;
}

/** Format a load fraction as a percentage, keeping its sign. */
export function formatLoad(load) {
  if (!Number.isFinite(load)) return '—';
  return `${load < 0 ? '−' : ''}${Math.round(Math.abs(load) * 100)}%`;
}

/**
 * How long ago a published step was, in words.
 * @param {?number} at - Epoch ms of the step's start.
 * @param {number} now
 * @returns {?string}
 */
export function formatPublishedAge(at, now = Date.now()) {
  if (!Number.isFinite(at)) return null;
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 0) return 'published for the hour ahead';
  if (minutes < 90) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/** The clock hour a published step belongs to, in the viewer's own timezone. */
function formatStepClock(at) {
  if (!Number.isFinite(at)) return null;
  try {
    return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return null;
  }
}

/**
 * Card copy for a selected station. Every line is a published value or a
 * statement about where a published value came from.
 * @param {object} site - Joined site record.
 * @param {number} [now]
 * @returns {string} Newline-separated card copy.
 */
export function buildRteSelectionLabel(site, now = Date.now()) {
  const klass = rteGenerationClass(site?.class);
  const details = [];
  const installed = Number.isFinite(site?.installedMw) ? site.installedMw : null;

  if (Number.isFinite(site?.mw)) {
    const load = Number.isFinite(site.load) ? ` · ${formatLoad(site.load)} of nameplate` : '';
    details.push(
      `${site.mw < 0 ? '🔌' : '⚡'} ${formatGenMw(site.mw)}`
      + `${installed ? ` / ${formatGenMw(installed)} installed` : ''}${load}`,
    );
    if (site.mw < 0) {
      details.push('↓ drawing from the grid — its own pumps and instruments, or storage charging');
    }
    const clock = formatStepClock(site.latestAt);
    const age = formatPublishedAge(site.latestAt, now);
    if (clock || age) {
      details.push(`🕐 hour of ${clock || '—'}${age ? ` · published ${age}` : ''}`);
    }
    if (site.reporting < site.units.length) {
      details.push(`▸ ${site.reporting} of ${site.units.length} groups reporting`);
    }
    // Where RTE publishes the turbine groups inside a plant the register only
    // carries whole, those groups reached this station by NAME, not by code.
    // That is weaker evidence and the card says so rather than blending it in.
    const byName = site.units.filter((unit) => unit.matchedBy === 'name').length;
    if (byName) {
      details.push(`↳ ${byName} of them matched by station name — RTE publishes this `
        + 'plant group by group, the register only as a whole');
    }
  } else {
    details.push(`◌ ${installed ? `${formatGenMw(installed)} installed` : 'installed power not published'}`);
    details.push('RTE published no output for this station — not the same as producing nothing');
  }

  details.push(`◈ ${klass.label}`);
  if (site?.commune) {
    details.push(`📍 ${site.commune}${site.departement ? ` · ${site.departement}` : ''}`);
  }
  const note = RTE_PLACEMENT_NOTES[site?.placement];
  if (note) {
    const km = Number.isFinite(site.anchorKm) && site.anchorKm > 0
      ? ` (${site.anchorKm.toFixed(1)} km from the commune centre)`
      : '';
    details.push(`◎ ${note}${km}`);
  }

  const units = Array.isArray(site?.units) ? site.units : [];
  if (units.length) {
    details.push(`── ${units.length} groupe${units.length > 1 ? 's' : ''} ──`);
    for (const unit of units.slice(0, CARD_UNIT_ROWS)) {
      details.push(buildUnitRow(unit));
    }
    if (units.length > CARD_UNIT_ROWS) {
      details.push(`… and ${units.length - CARD_UNIT_ROWS} more`);
    }
  }
  return [site?.name || 'Site de production', ...details].join('\n');
}

/**
 * One unit's card row: what it is doing, against what it can do, over the last
 * published day.
 * @param {object} unit
 * @returns {string}
 */
export function buildUnitRow(unit) {
  const name = unit?.name || unit?.code || unit?.eic || 'groupe';
  const capacity = Number.isFinite(unit?.installedMw) ? unit.installedMw : null;
  if (!Number.isFinite(unit?.mw)) {
    return `${name} · ${capacity ? `${Math.round(capacity)} MW` : '—'} · not reported`;
  }
  const spark = generationSparkline(unit.history, capacity);
  const value = `${Math.round(unit.mw)}${capacity ? `/${Math.round(capacity)}` : ''} MW`;
  // Trap 7 surfaced where it matters: RTE and the register disagree about this
  // machine's nameplate, so the card shows both rather than picking one.
  // One whole megawatt is the threshold, not a percentage: the register
  // publishes tenths (a plant split across two groups as 180.4 + 225.6), so
  // anything below a megawatt is the rounding this layer did itself, and
  // anything above it is the two administrations genuinely disagreeing.
  const registry = Number.isFinite(unit?.registryMw)
    && Number.isFinite(capacity)
    && Math.abs(unit.registryMw - capacity) >= 1
      ? ` (register: ${Math.round(unit.registryMw)} MW)`
      : '';
  return `${name} · ${value}${registry}${spark ? `  ${spark}` : ''}`;
}

/**
 * Protected selected-object entry for the shared overlay host.
 * @param {object} record
 * @param {number} [now]
 * @returns {?object}
 */
export function createRteSelectedOverlayEntry(record, now = Date.now()) {
  const position = record?.position;
  if (!record?.id || !position) return null;
  const [title, ...details] = buildRteSelectionLabel(record.site, now).split('\n');
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
 * Ambient label for one station.
 * @param {object} site
 * @param {Cesium.Cartesian3} position
 * @returns {object}
 */
export function createRteStationOverlayEntry(site, position) {
  const klass = rteGenerationClass(site.class);
  const value = Number.isFinite(site.mw)
    ? `${formatGenMw(site.mw)} / ${formatGenMw(site.installedMw)}`
    : `${formatGenMw(site.installedMw)} installed`;
  return {
    id: `${RTE_GEN_LABEL_PREFIX}${site.id}`,
    position,
    variant: 'label',
    title: `${site.name} · ${value}`,
    accent: Number.isFinite(site.mw) && site.mw < 0 ? RTE_PUMPING_COLOR : klass.color,
    // The biggest machine wins the collision; ties break on id in the selector.
    priority: Math.round(Number.isFinite(site.installedMw) ? site.installedMw : 0),
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    // The station's name is a click surface, not a caption — see
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

/** Keep the largest stations, with stable identity as the tie-break. */
export function selectRteOverlayCohort(entries, limit = RTE_GEN_OVERLAY_COHORT_LIMIT) {
  const cap = Math.max(0, Math.min(
    RTE_GEN_OVERLAY_COHORT_LIMIT,
    Math.floor(Number(limit) || 0),
  ));
  if (!Array.isArray(entries) || cap === 0) return [];
  return entries.slice().sort((a, b) => (
    b.priority - a.priority || String(a.id).localeCompare(String(b.id))
  )).slice(0, cap);
}

/**
 * Map one station to a JSON-safe analyst record. Pure — no Cesium types.
 * @param {object|null|undefined} site
 * @param {number} [index=0]
 * @returns {object}
 */
export function mapRteAnalystRecord(site, index = 0) {
  const str = (value) => {
    const trimmed = String(value ?? '').trim();
    return trimmed || null;
  };
  const num = (value) => (Number.isFinite(value) ? value : null);
  return {
    id: str(site?.id) || `GEN-${String(index).padStart(4, '0')}`,
    name: str(site?.name),
    kind: 'power-station',
    generationClass: str(site?.class),
    lat: num(site?.lat),
    lon: num(site?.lon),
    installedMw: num(site?.installedMw),
    outputMw: num(site?.mw),
    loadFactor: num(site?.load),
    units: Array.isArray(site?.units) ? site.units.length : null,
    unitsReporting: num(site?.reporting),
    commune: str(site?.commune),
    departement: str(site?.departement),
    region: str(site?.region),
    placement: str(site?.placement),
  };
}

/**
 * Per-class legend rows for whatever is on screen.
 * @param {Array<object>} sites - Joined sites.
 * @returns {Array<object>}
 */
export function buildRteLegend(sites) {
  const buckets = new Map();
  for (const site of Array.isArray(sites) ? sites : []) {
    const id = site?.class || 'other';
    const bucket = buckets.get(id) || { sites: 0, installedMw: 0, mw: 0, reporting: 0 };
    bucket.sites += 1;
    if (Number.isFinite(site.installedMw)) bucket.installedMw += site.installedMw;
    if (Number.isFinite(site.mw)) { bucket.mw += site.mw; bucket.reporting += 1; }
    buckets.set(id, bucket);
  }
  const legend = [];
  for (const id of RTE_CLASS_ORDER) {
    const bucket = buckets.get(id);
    if (!bucket) continue;
    const klass = RTE_GENERATION_CLASSES[id];
    const live = bucket.reporting
      ? `${formatGenMw(bucket.mw)} of ${formatGenMw(bucket.installedMw)} — `
      : `${formatGenMw(bucket.installedMw)} installed, no output published — `;
    legend.push({
      label: klass.label,
      color: klass.color,
      count: bucket.sites,
      blurb: live + klass.blurb,
    });
  }
  return legend;
}

// --- Module state -----------------------------------------------------------

let _viewer = null;
let _rings = null;
let _discs = null;
let _overlayHost = DEFAULT_OVERLAY_HOST;
let _enabled = false;
let _clickHandler = null;
let _preRenderRemover = null;

/** @type {Map<string, object>} render id → record. */
let _records = new Map();
/** @type {?string} */
let _selectedId = null;

/** @type {?object} Shipped registry document. */
let _registry = null;
/** @type {?Promise<?object>} */
let _registryPromise = null;
/** @type {Array<object>} Joined stations, most installed power first. */
let _sites = [];
/** @type {Array<object>} Live units RTE reports that the registry cannot place. */
let _unplaced = [];

let _loading = false;
let _error = null;
let _status = 'idle';
let _auth = 'unknown';
let _authDetail = null;
let _lastUpdate = null;
let _liveStats = null;
let _joinStats = null;
let _window = null;
let _source = null;

function sitePosition(site) {
  const floor = cachedGroundFloor(site.lat, site.lon);
  const height = (Number.isFinite(floor) ? floor : 0) + POINT_LIFT_M;
  return Cesium.Cartesian3.fromDegrees(site.lon, site.lat, height);
}

/** Ring and disc colours for one joined station. */
function stationStyle(site) {
  const klass = rteGenerationClass(site.class);
  const base = Cesium.Color.fromCssColorString(klass.color);
  const measured = Number.isFinite(site.mw);
  return {
    ringOutline: base.withAlpha(measured ? RING_ALPHA_MEASURED : RING_ALPHA_UNMEASURED),
    ringFill: base.withAlpha(measured ? RING_FILL_ALPHA : RING_FILL_ALPHA * 0.5),
    disc: site.mw < 0 ? Cesium.Color.fromCssColorString(RTE_PUMPING_COLOR) : base,
  };
}

/**
 * Replace the drawn stations with a freshly joined fleet.
 *
 * The registry never changes within a session, so the collections are rebuilt
 * rather than diffed: 108 stations is two `removeAll` calls and 216 adds, far
 * below the cost of tracking which reactor changed.
 */
function buildStations(sites) {
  if (!_rings || !_discs) return;
  const previouslySelected = _selectedId;
  clearSelection();
  _rings.removeAll();
  _discs.removeAll();
  _records.clear();

  const warm = [];
  for (const site of sites) {
    if (!Number.isFinite(site?.lat) || !Number.isFinite(site?.lon)) continue;
    const position = sitePosition(site);
    const style = stationStyle(site);
    const ringPx = rteRingSize(site.installedMw);
    const renderId = rteRenderId(site.id);
    const ring = _rings.add({
      id: renderId,
      position,
      color: style.ringFill,
      pixelSize: ringPx,
      outlineColor: style.ringOutline,
      outlineWidth: 1.6,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
    const discPx = rteDiscSize(ringPx, site.load);
    // A station with nothing to draw inside its ring gets NO disc primitive at
    // all rather than a zero-sized one: a 0 px point still costs a draw slot,
    // and half the fleet is idle most of the time.
    const disc = discPx > 0
      ? _discs.add({
        id: `${renderId}${RTE_GEN_OUTPUT_SUFFIX}`,
        position,
        color: style.disc,
        pixelSize: discPx,
        outlineWidth: 0,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      })
      : null;
    _records.set(renderId, {
      id: renderId,
      siteId: site.id,
      site,
      position,
      ring,
      disc,
      baseRingColor: style.ringFill,
      baseRingOutline: style.ringOutline,
      baseRingSize: ringPx,
    });
    warm.push({ lat: site.lat, lon: site.lon });
  }
  _sites = sites;
  warmGroundFloor(warm.slice(0, 300));
  if (previouslySelected && _records.has(previouslySelected)) selectObject(previouslySelected);
  publishOverlay();
}

/** Ambient labels: the biggest stations. 108 labels is not a map. */
function publishOverlay() {
  if (!_enabled) {
    _overlayHost.clearSource(RTE_GEN_OVERLAY_SOURCE_ID);
    return;
  }
  const entries = [];
  for (const site of _sites) {
    const record = _records.get(rteRenderId(site.id));
    if (!record?.position) continue;
    entries.push(createRteStationOverlayEntry(site, record.position));
  }
  _overlayHost.setEntries(
    RTE_GEN_OVERLAY_SOURCE_ID,
    selectRteOverlayCohort(entries),
    {
      cohortLimit: RTE_GEN_OVERLAY_COHORT_LIMIT,
      collisionCapacity: RTE_GEN_OVERLAY_COLLISION_CAPACITY,
      moving: false,
    },
  );
}

function restoreRecordStyle(record) {
  if (!record?.ring) return;
  record.ring.color = record.baseRingColor;
  record.ring.outlineColor = record.baseRingOutline;
  record.ring.pixelSize = record.baseRingSize;
}

function clearSelection() {
  if (_selectedId) restoreRecordStyle(_records.get(_selectedId));
  _selectedId = null;
  _overlayHost.clearSource(RTE_GEN_SELECTED_OVERLAY_SOURCE_ID);
}

function selectObject(id) {
  clearSelection();
  const record = _records.get(id);
  if (!record) return;
  _selectedId = id;
  const selected = Cesium.Color.fromCssColorString(SELECTED_COLOR);
  if (record.ring) {
    record.ring.outlineColor = selected;
    record.ring.color = selected.withAlpha(RING_FILL_ALPHA);
    record.ring.pixelSize = record.baseRingSize + 6;
  }
  const entry = createRteSelectedOverlayEntry(record);
  if (entry) {
    _overlayHost.setEntries(
      RTE_GEN_SELECTED_OVERLAY_SOURCE_ID,
      [entry],
      RTE_GEN_SELECTED_OVERLAY_SOURCE_OPTIONS,
    );
  }
  governorRequestRender('rte-generation-select');
}

function onKeyDown(event) {
  if (event.key === 'Escape' && _selectedId) clearSelection();
}

/**
 * Resolve a Cesium pick into one of this layer's station ids.
 *
 * The output disc carries the station id with an `:out` suffix so it can be
 * told apart in the collection; clicking it selects the STATION, because the
 * disc is not a separate object, it is the same station's reading.
 */
export function resolveRtePickId(picked, has = (id) => _records.has(id)) {
  const candidate = (value) => {
    if (typeof value !== 'string' || !value.startsWith(RTE_GEN_RENDER_PREFIX)) return null;
    if (has(value)) return value;
    const station = value.endsWith(RTE_GEN_OUTPUT_SUFFIX)
      ? value.slice(0, -RTE_GEN_OUTPUT_SUFFIX.length)
      : null;
    return station && has(station) ? station : null;
  };
  if (!picked) return null;
  return candidate(picked.primitive?.id)
    || candidate(picked.id)
    || candidate(picked.id?.id)
    || null;
}

function installClickHandler(viewer) {
  if (_clickHandler) return;
  _clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  _clickHandler.setInputAction((click) => {
    const id = resolveRtePickId(viewer.scene.pick(click.position));
    if (id) { selectObject(id); return; }
    // The label plane the depth buffer knows nothing about, resolved after the
    // native pick so a name drawn across a neighbouring site cannot steal it.
    const labelled = pickOverlayLabelId(click.position, {
      sourceId: RTE_GEN_OVERLAY_SOURCE_ID,
      prefix: RTE_GEN_LABEL_PREFIX,
      has: (recordId) => _records.has(recordId),
      hitTest: _overlayHost.hitTest,
    });
    if (labelled) { selectObject(labelled); return; }
    if (_selectedId) clearSelection();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  if (typeof document !== 'undefined') document.addEventListener('keydown', onKeyDown);
}

/**
 * Per-frame horizon pass.
 *
 * Points draw with depth testing disabled so a station is not swallowed by the
 * terrain it sits on, which also means one on the far side of the planet would
 * paint straight through the globe. Nothing here animates between polls, so
 * this is the layer's only per-frame work.
 */
function onPreRender() {
  if (!_enabled || !_records.size) return;
  const camera = _viewer?.camera;
  if (!camera) return;
  const occluder = horizonOccluder(camera);
  for (const record of _records.values()) {
    const visible = occluder.isPointVisible(record.position);
    if (record.ring) record.ring.show = visible;
    if (record.disc) record.disc.show = visible;
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
 * Load the shipped fleet once per session.
 *
 * A failed load nulls the promise so the next refresh retries rather than
 * leaving the layer permanently empty — and without this file there is nothing
 * to draw at all, because RTE publishes no coordinates.
 */
function ensureRegistry() {
  if (_registryPromise) return _registryPromise;
  _registryPromise = fetchJson(REGISTRY_URL)
    .then((payload) => {
      if (!Array.isArray(payload?.sites) || !Array.isArray(payload?.units)) {
        throw new Error('malformed unit registry');
      }
      _registry = payload;
      return payload;
    })
    .catch((error) => {
      _registryPromise = null;
      throw error;
    });
  return _registryPromise;
}

async function load() {
  _loading = true;
  try {
    const [registry, live] = await Promise.allSettled([
      ensureRegistry(),
      fetchJson(LIVE_URL),
    ]);
    if (registry.status === 'rejected') {
      console.warn('[Data:RTE Gen] unit registry unavailable:', registry.reason?.message || registry.reason);
      _error = 'unit registry unavailable';
      _status = 'error';
      return false;
    }

    // The fleet draws with or without RTE. A rejected live half is a missing
    // NUMBER, not a missing map, and must not blank 93.5 GW of stations.
    let units = [];
    if (live.status === 'fulfilled') {
      _auth = live.value?.auth || 'unknown';
      _authDetail = live.value?.authDetail || null;
      _liveStats = live.value?.stats || null;
      _window = live.value?.window || null;
      _source = live.value?.source || _source;
      units = Array.isArray(live.value?.units) ? live.value.units : [];
    } else {
      console.warn('[Data:RTE Gen] live output unavailable:', live.reason?.message || live.reason);
      _auth = 'failed';
      _authDetail = live.reason?.message || String(live.reason);
      _liveStats = null;
    }

    const joined = joinGenerationToRegistry(registry.value, units);
    _joinStats = joined.stats;
    _unplaced = joined.unplaced;
    buildStations(joined.sites.slice().sort((a, b) => (
      (b.installedMw || 0) - (a.installedMw || 0) || a.id.localeCompare(b.id)
    )));

    _error = generationErrorFor(_auth);
    _status = 'ready';
    _lastUpdate = Date.now();
    governorRequestRender('rte-generation-load');
    console.log(
      `[Data:RTE Gen] ${_sites.length} stations, `
      + `${joined.stats.placedUnits}/${registry.value.units.length} units reporting, `
      + `${formatGenMw(joined.stats.placedMw)}`
      + (joined.stats.unplacedUnits
        ? `, ${joined.stats.unplacedUnits} unplaced (${formatGenMw(joined.stats.unplacedMw)})`
        : ''),
    );
    return true;
  } catch (error) {
    console.warn('[Data:RTE Gen] load error:', error);
    _error = 'RTE generation error';
    _status = 'error';
    return false;
  } finally {
    _loading = false;
  }
}

/** Deterministic subsample of drawn stations for the detection overlay. */
function collectDetectableObjects(options = {}) {
  if (!_enabled) return [];
  const stations = [];
  for (const record of _records.values()) {
    if (!record.ring?.show && record.id !== _selectedId) continue;
    stations.push(record);
  }
  if (!stations.length) return [];

  const maxCount = Number.isFinite(options.maxCount)
    ? Math.max(1, Math.floor(options.maxCount))
    : stations.length;
  const seed = Number.isFinite(options.seed) ? Math.floor(options.seed) : 0;
  const stride = Math.max(1, Math.ceil(stations.length / maxCount));
  const start = ((seed % stride) + stride) % stride;

  const result = [];
  for (let i = start; i < stations.length; i += stride) {
    const record = stations[i];
    result.push({
      position: record.position,
      sourceId: record.id,
      id: String(record.site?.name || 'CENTRALE').toUpperCase().slice(0, 24),
      type: detectionTypeFor(record.site?.class),
      skipLabel: record.id === _selectedId,
    });
    if (result.length >= maxCount) break;
  }
  return result;
}

/**
 * The error string for one auth outcome, or null.
 *
 * Having no RTE credential is a documented MODE, not an error: it is the state
 * every reader who has not made an account is in, and the layer is complete in
 * it — 108 stations, 93.5 GW, every name and filière. Reporting it as an error
 * would put a red readout in front of someone whose globe is working. Only a
 * credential that exists and does not work, or an upstream that refused, is a
 * failure.
 * @param {string} auth - `ok`, `missing`, `failed` or `unknown`.
 * @returns {?string}
 */
export function generationErrorFor(auth) {
  if (auth === 'ok' || auth === 'missing') return null;
  return 'RTE output unavailable';
}

/** Three-letter detection tag per class. */
export function detectionTypeFor(klass) {
  if (klass === 'nuclear') return 'NUC';
  if (typeof klass === 'string' && klass.startsWith('hydro')) return 'HYD';
  if (klass === 'fossil-gas') return 'GAZ';
  if (klass === 'fossil-coal') return 'CHA';
  if (klass === 'fossil-oil') return 'FIO';
  if (klass === 'wind') return 'EOL';
  if (klass === 'solar') return 'PV';
  if (klass === 'battery') return 'BAT';
  if (klass === 'marine') return 'MAR';
  if (klass === 'biomass') return 'BIO';
  return 'GEN';
}

function buildLoadingLabel() {
  if (_loading && !_registry) return 'loading the unit register...';
  if (_loading) return 'refreshing unit output...';
  if (_status === 'error') return _error || 'unavailable';
  const parts = [];
  if (_sites.length) parts.push(`${_sites.length} centrales`);
  if (_joinStats?.placedUnits) {
    parts.push(`${_joinStats.placedUnits} groupes · ${formatGenMw(_joinStats.placedMw)}`);
  } else if (_auth === 'missing') {
    parts.push('no RTE key — installed capacity only');
  }
  if (_joinStats?.unplacedUnits) parts.push(`${_joinStats.unplacedUnits} unplaced`);
  return parts.join(' · ');
}

/** Groupes de prod (FR) layer. @type {Object} */
const rteGenerationLayer = {
  id: RTE_GEN_LAYER_ID,
  name: 'Groupes de prod (FR)',
  icon: '☢',
  source: 'RTE · ODRÉ · EDF · OpenStreetMap',
  updateInterval: UPDATE_INTERVAL_MS,

  init(viewer) {
    _viewer = viewer;
    _rings = new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT });
    _rings.show = false;
    viewer.scene.primitives.add(_rings);
    registerSpriteCollection(RTE_GEN_LAYER_ID, _rings);

    // Registered second so the output disc always paints ABOVE its own ring.
    _discs = new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT });
    _discs.show = false;
    viewer.scene.primitives.add(_discs);
    registerSpriteCollection(RTE_GEN_LAYER_ID, _discs);

    _enabled = false;
    _records = new Map();
    _sites = [];
    _unplaced = [];
    _selectedId = null;
    _registry = null;
    _registryPromise = null;
    _loading = false;
    _error = null;
    _status = 'idle';
    _auth = 'unknown';
    _authDetail = null;
    _lastUpdate = null;
    _liveStats = null;
    _joinStats = null;
    _window = null;
    _source = null;

    _overlayHost.setVisible(RTE_GEN_OVERLAY_SOURCE_ID, false);
    _overlayHost.setVisible(RTE_GEN_SELECTED_OVERLAY_SOURCE_ID, false);
    restoreSpriteOrder(viewer);
    console.log('[Data:RTE Gen] Initialized');
  },

  enable(viewer) {
    _enabled = true;
    _error = null;
    if (_rings) _rings.show = true;
    if (_discs) _discs.show = true;
    _overlayHost.setVisible(RTE_GEN_OVERLAY_SOURCE_ID, true);
    _overlayHost.setVisible(RTE_GEN_SELECTED_OVERLAY_SOURCE_ID, true);
    installClickHandler(viewer);
    registerPickOwner(RTE_GEN_LAYER_ID, (pickedId) => (
      resolveRtePickId({ primitive: { id: pickedId } }) !== null
    ));
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
    if (_rings) _rings.show = false;
    if (_discs) _discs.show = false;
    _overlayHost.clearSource(RTE_GEN_OVERLAY_SOURCE_ID);
    _overlayHost.setVisible(RTE_GEN_OVERLAY_SOURCE_ID, false);
    _overlayHost.setVisible(RTE_GEN_SELECTED_OVERLAY_SOURCE_ID, false);
    if (_clickHandler) {
      _clickHandler.destroy();
      _clickHandler = null;
    }
    if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeyDown);
    unregisterPickOwner(RTE_GEN_LAYER_ID);
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
   * What the scene actually holds, for the browser harness.
   *
   * The ring-and-disc grammar is a claim about PIXELS, and the only way to
   * check a claim about pixels is to read them back off the primitives that
   * were built rather than off the model that asked for them. Sizes and
   * opacities come from the live primitive; the presence or absence of a disc
   * is the assertion that matters most, because that is the difference between
   * "unmeasured" and "producing nothing".
   * @returns {Array<object>}
   */
  getRenderDiagnostics() {
    const hex = (color) => (color
      ? `#${[color.red, color.green, color.blue]
        .map((channel) => Math.round(channel * 255).toString(16).padStart(2, '0')).join('')}`
      : null);
    const rows = [];
    for (const record of _records.values()) {
      rows.push({
        id: record.id,
        siteId: record.siteId,
        name: record.site?.name || null,
        class: record.site?.class || null,
        installedMw: record.site?.installedMw ?? null,
        mw: record.site?.mw ?? null,
        load: record.site?.load ?? null,
        measured: Number.isFinite(record.site?.mw),
        ringPx: record.ring?.pixelSize ?? null,
        ringOutlineAlpha: record.ring?.outlineColor?.alpha ?? null,
        ringOutline: hex(record.ring?.outlineColor),
        hasDisc: Boolean(record.disc),
        discPx: record.disc?.pixelSize ?? null,
        discColor: hex(record.disc?.color),
        shown: record.ring?.show !== false,
        collectionShown: _rings?.show !== false,
      });
    }
    return rows;
  },

  /**
   * Snapshot the stations for the analyst query engine. On-demand only.
   * @param {number} [maxCount=200]
   * @returns {Array<Object>}
   */
  getAnalystRecords(maxCount = 200) {
    if (!_enabled) return [];
    const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 200;
    const result = [];
    for (const site of _sites) {
      if (result.length >= limit) break;
      result.push(mapRteAnalystRecord(site, result.length));
    }
    return result;
  },

  /**
   * The key to what is on screen.
   *
   * The first row is not a filière: it is the ring-and-disc grammar, because a
   * reader who does not know that a faint empty ring means "unmeasured" and a
   * crisp empty ring means "stopped" will read half this map backwards.
   * @returns {{chips: Array<object>, legend: Array<object>}}
   */
  getRowControls() {
    const legend = [];
    const measured = _joinStats?.placedUnits || 0;
    legend.push({
      label: measured ? 'Ring = installed · disc = output' : 'Ring = installed capacity',
      color: '#dfe7ef',
      count: _sites.length,
      blurb: measured
        ? 'A faint empty ring is a station RTE published nothing for; a crisp empty ring is a '
          + 'station measured at zero — an outage. A magenta disc is a station DRAWING from the '
          + 'grid: a stopped reactor still runs its own pumps, and reads as a ~50 MW load.'
        : 'No RTE credential, so no output is drawn. Set RTE_CLIENT_ID and RTE_CLIENT_SECRET '
          + 'from a free data.rte-france.com account and the rings fill.',
    });
    legend.push(...buildRteLegend(_sites));
    return { chips: [], legend };
  },

  getStats() {
    const stats = {
      count: _sites.length,
      lastUpdate: _lastUpdate,
      loading: _loading,
      status: _status === 'ready' ? 'ok' : _status,
      stations: _sites.length,
      units: _registry?.units?.length ?? null,
      unitsReporting: _joinStats?.placedUnits ?? 0,
      outputMw: _joinStats?.placedMw ?? null,
      installedMw: _registry?.stats?.installedMw ?? null,
      unplacedUnits: _joinStats?.unplacedUnits ?? 0,
      unplacedMw: _joinStats?.unplacedMw ?? 0,
      silentUnits: _joinStats?.silentUnits ?? null,
      latestAt: _liveStats?.latestAt ?? null,
      stepMinutes: _liveStats?.stepMinutes ?? null,
      pumpingUnits: _liveStats?.pumping ?? 0,
      auth: _auth,
      windowMode: _window?.mode || null,
      // Licence Ouverte 2.0 obliges the producer AND the data's update date;
      // the register's own edition IS that date.
      registryEdition: _registry?.registre?.edition ?? null,
      feedSource: _source,
    };
    const label = buildLoadingLabel();
    if (label) stats.loadingLabel = label;
    if (_authDetail && _auth !== 'ok') stats.authDetail = _authDetail;
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
      unregisterPickOwner(RTE_GEN_LAYER_ID);
    }
    if (_preRenderRemover) {
      _preRenderRemover();
      _preRenderRemover = null;
    }
    for (const collection of [_rings, _discs]) {
      if (!collection) continue;
      unregisterSpriteCollection(RTE_GEN_LAYER_ID, collection);
      viewer?.scene?.primitives?.remove?.(collection);
    }
    _rings = null;
    _discs = null;
    _records.clear();
    _sites = [];
    _unplaced = [];
    _registry = null;
    _registryPromise = null;
    _viewer = null;
  },
};

/** Seed rendered records so selection/card/legend paths run without WebGL. */
export function _setRteStateForTest({
  viewer, records, sites, unplaced, overlayHost, registry, joinStats, liveStats, auth,
  enabled = true,
} = {}) {
  _viewer = viewer || null;
  if (records) _records = records instanceof Map ? records : new Map(Object.entries(records));
  if (sites) _sites = sites;
  if (unplaced) _unplaced = unplaced;
  if (registry !== undefined) _registry = registry;
  if (joinStats !== undefined) _joinStats = joinStats;
  if (liveStats !== undefined) _liveStats = liveStats;
  if (auth !== undefined) _auth = auth;
  _overlayHost = overlayHost || DEFAULT_OVERLAY_HOST;
  _enabled = enabled;
  _selectedId = null;
}

/** @returns {?string} */
export function _rteSelectedIdForTest() {
  return _selectedId;
}

export function _selectRteObjectForTest(id) {
  selectObject(id);
}

export function _clearRteSelectionForTest() {
  clearSelection();
}

export function _rteRowControlsForTest() {
  return rteGenerationLayer.getRowControls();
}

export function _rteStatsForTest() {
  return rteGenerationLayer.getStats();
}

export function _rteDetectablesForTest(options) {
  return collectDetectableObjects(options);
}

export default rteGenerationLayer;
