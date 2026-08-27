import * as Cesium from 'cesium';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { departementAnchor, parseDepartements } from './meteoFranceVigilance.js';

/**
 * éCO2mix — where French electricity actually comes from, right now.
 *
 * RTE publishes the national grid's state every 15 minutes: how much the
 * country is consuming, how much each generation filière is producing, the
 * carbon content of the kWh, and the commercial balance with each of the five
 * neighbouring markets. ODRÉ republishes it keyless under Licence Ouverte 2.0.
 *
 * ── Where the data comes from ───────────────────────────────────────────────
 * Through the `/api/energy-fr` proxy, which merges `eco2mix-national-tr` and
 * `eco2mix-regional-tr` into one ~4 KB document. RTE's own API carries the
 * same figures behind an OAuth2 account; ODRÉ needs no credential, so this
 * layer works on `git clone`. The upstream's sign conventions and type traps
 * are absorbed in `eco2mixFeed.js`, under test against captured payloads.
 *
 * ── What is drawn, and why THAT ─────────────────────────────────────────────
 * The national figures are a scalar time series with no geometry — a gauge,
 * not a map. So the globe shows the two things in this dataset that ARE
 * spatial:
 *
 * 1. **Which regions power France, and which draw on it.** Each region's
 *    `ech_physiques` is its consumption minus its generation, so its sign
 *    says whether it is a net exporter or a net importer. Measured 2026-08-27
 *    07:45Z: Auvergne-Rhône-Alpes −7 781 MW and Normandie −6 712 MW against
 *    Île-de-France +6 478 MW. That asymmetry — the capital importing almost
 *    its entire load from the nuclear and hydro regions — is the structural
 *    fact about the French grid, and it is legible at a glance in a way the
 *    national mix never is.
 *
 * 2. **The five border flows**, as arcs whose direction is the direction the
 *    power is going.
 *
 * ── Honesty rules this layer is built around ────────────────────────────────
 *
 * • **The régions are painted, but the DÉPARTEMENTS are the geometry.** There
 *   are no bundled region polygons; the 96 département shapes already carried
 *   for Vigilance are grouped by region and every département in a region is
 *   painted with its REGION's value. That is a presentational grouping, not a
 *   departmental measurement, so no label ever names a département.
 *
 * • **Corse is never painted.** éCO2mix régional covers 12 metropolitan
 *   regions; Corsica runs on its own system and is absent upstream. 2A and 2B
 *   are therefore held permanently hidden rather than inheriting a neighbour's
 *   colour or defaulting to zero.
 *
 * • **A zero flow is drawn as nothing.** A border at 0 MW is not a thin arc,
 *   it is no arc — the same "absence is not a colour" rule the Vigilance layer
 *   established for level vert.
 *
 * • **The arcs are country-to-country balances, not cables.** `ech_comm_*` is
 *   a commercial nomination between two market areas, so the endpoints here
 *   are COUNTRY REFERENCE POINTS, deliberately not interconnection sites.
 *   Drawing them at Calais or Baixas would claim a precision about physical
 *   routing that this field does not carry. `ech_comm_allemagne_belgique` is
 *   one field for two countries and stays one arc, labelled with both.
 *
 * • **Commercial ≠ physical.** The five commercial balances do not sum to
 *   `ech_physiques` (measured: −2 893 against −3 633 MW). The arcs show the
 *   commercial figures and say so; the national net shown in `getStats()` is
 *   the physical one and is labelled separately.
 *
 * • **Carbon intensity is national only.** RTE publishes no regional CO₂
 *   content, so none is painted per region — only reported for France.
 */

const API_URL = '/api/energy-fr';
const DEPARTEMENTS_URL = new URL(
  './local_data/france_departements/departements.geojson',
  import.meta.url,
).href;

/** Shared world-overlay source id (matches the layer id). */
export const ENERGY_OVERLAY_SOURCE_ID = 'france-energy';
/** Bounded label cohort offered to the shared overlay host: 12 regions + 5 borders. */
export const ENERGY_OVERLAY_COHORT_LIMIT = 20;
/** Shared ambient-label paint budget, matching the sibling French sources. */
export const ENERGY_OVERLAY_COLLISION_CAPACITY = 18;

/**
 * Idle refresh cadence. The proxy holds a 4-minute cache in front of ODRÉ and
 * the product itself steps every 15 minutes, so polling faster than this buys
 * nothing; polling slower would let a cached document age past its own step.
 */
const UPDATE_INTERVAL_MS = 180_000;

/**
 * Région INSEE code → the département codes it contains (2016 boundaries,
 * which are the ones `code_insee_region` uses).
 *
 * Corse (94, départements 2A/2B) is present so the join can state that it is
 * KNOWN and deliberately unpainted, rather than silently missing — éCO2mix
 * régional publishes no Corsican row. The DOM regions are absent because the
 * bundled polygons are metropolitan only.
 */
export const REGION_DEPARTEMENTS = Object.freeze({
  11: Object.freeze(['75', '77', '78', '91', '92', '93', '94', '95']),
  24: Object.freeze(['18', '28', '36', '37', '41', '45']),
  27: Object.freeze(['21', '25', '39', '58', '70', '71', '89', '90']),
  28: Object.freeze(['14', '27', '50', '61', '76']),
  32: Object.freeze(['02', '59', '60', '62', '80']),
  44: Object.freeze(['08', '10', '51', '52', '54', '55', '57', '67', '68', '88']),
  52: Object.freeze(['44', '49', '53', '72', '85']),
  53: Object.freeze(['22', '29', '35', '56']),
  75: Object.freeze(['16', '17', '19', '23', '24', '33', '40', '47', '64', '79', '86', '87']),
  76: Object.freeze(['09', '11', '12', '30', '31', '32', '34', '46', '48', '65', '66', '81', '82']),
  84: Object.freeze(['01', '03', '07', '15', '26', '38', '42', '43', '63', '69', '73', '74']),
  93: Object.freeze(['04', '05', '06', '13', '83', '84']),
  94: Object.freeze(['2A', '2B']),
});

/** Régions the upstream dataset does not cover — never painted. See header. */
export const UNCOVERED_REGIONS = Object.freeze(['94']);

/**
 * The balance palette.
 *
 * Teal for surplus and amber for deficit, chosen to survive the deuteranopia
 * collision that a red/green pair would walk straight into. Colour is never
 * the only carrier: every label states the verb (EXPORTE / IMPORTE) and the
 * megawatts in words.
 */
export const BALANCE_STYLES = Object.freeze({
  exporter: Object.freeze({
    key: 'exporter', verb: 'EXPORTE', color: '#2ee6a8', label: 'Excédentaire',
    blurb: 'Produit plus qu’elle ne consomme',
  }),
  importer: Object.freeze({
    key: 'importer', verb: 'IMPORTE', color: '#ff9b3d', label: 'Déficitaire',
    blurb: 'Consomme plus qu’elle ne produit',
  }),
});

/** Below this many megawatts a balance is drawn as nothing. See header. */
export const BALANCE_DEADBAND_MW = 1;

/** Alpha floor and ceiling for the region fill, ramped by |balance| / load. */
const FILL_ALPHA_MIN = 0.12;
const FILL_ALPHA_MAX = 0.52;
/**
 * The ratio at which the fill saturates. 1.5 means "exports half again its own
 * consumption" — Auvergne-Rhône-Alpes sat at 1.21 on the captured snapshot, so
 * the strongest real region lands near but not at the ceiling, leaving headroom
 * for a winter peak instead of clipping the whole country to one flat colour.
 */
const FILL_RATIO_SATURATION = 1.5;

/**
 * Country reference points for the border arcs — NOT interconnection sites.
 * See the header: `ech_comm_*` is a market-area balance, and anchoring it at a
 * converter station would claim a routing precision the field does not carry.
 */
export const BORDER_ANCHORS = Object.freeze({
  france: Object.freeze([2.60, 46.60]),
  angleterre: Object.freeze([-1.55, 52.60]),
  espagne: Object.freeze([-3.70, 40.42]),
  italie: Object.freeze([12.50, 42.80]),
  suisse: Object.freeze([8.23, 46.80]),
  // One point standing in for the field's two countries, placed between the
  // Belgian border and western Germany so it favours neither.
  allemagne_belgique: Object.freeze([7.20, 50.40]),
});

/** Vertices per arc. Enough for a smooth curve at country scale, cheap to rebuild. */
const ARC_SAMPLES = 48;
/** Arc apex as a fraction of the chord, clamped to keep short hops readable. */
const ARC_APEX_RATIO = 0.16;
const ARC_APEX_MIN_M = 60_000;
const ARC_APEX_MAX_M = 400_000;
/** Arc stroke width in pixels, ramped by |MW| up to the saturation flow. */
const ARC_WIDTH_MIN_PX = 3;
const ARC_WIDTH_MAX_PX = 15;
const ARC_SATURATION_MW = 3000;

/**
 * Invert `REGION_DEPARTEMENTS` into a département → région lookup.
 * @returns {Map<string, string>}
 */
export function departementRegionIndex() {
  const index = new Map();
  for (const [region, departements] of Object.entries(REGION_DEPARTEMENTS)) {
    for (const code of departements) index.set(code, region);
  }
  return index;
}

/**
 * Format megawatts the way a French control-room readout would: thin-space
 * grouping, no decimals, sign carried by the verb rather than a minus.
 * @param {number|null|undefined} mw
 * @returns {string}
 */
export function formatMegawatts(mw) {
  if (!Number.isFinite(mw)) return '— MW';
  // `toLocaleString('fr-FR')` groups with U+202F on modern ICU and U+00A0 on
  // older ones. Both are normalised to a plain space so the label measures
  // and wraps predictably in the overlay's text layout.
  return `${Math.round(Math.abs(mw)).toLocaleString('fr-FR').replace(/[\u00a0\u202f]/g, ' ')} MW`;
}

/**
 * Classify one balance into its paint style.
 *
 * `netPhysical` is published as consumption minus generation, so POSITIVE is a
 * net importer — the inverse of the intuition that a positive number means a
 * surplus. That inversion is handled here, once.
 *
 * @param {number|null|undefined} netPhysical Megawatts, upstream sign.
 * @param {number|null|undefined} load Regional consumption, for the ratio.
 * @returns {{style:object, ratio:number, alpha:number}|null} Null inside the deadband.
 */
export function balanceStyle(netPhysical, load) {
  if (!Number.isFinite(netPhysical)) return null;
  if (Math.abs(netPhysical) < BALANCE_DEADBAND_MW) return null;
  const style = netPhysical > 0 ? BALANCE_STYLES.importer : BALANCE_STYLES.exporter;
  // Ratio against the region's own load, so the picture is comparable across
  // regions AND across time — normalising against the current maximum would
  // repaint the whole country every time one region moved.
  const ratio = Number.isFinite(load) && load > 0 ? Math.abs(netPhysical) / load : 0;
  const t = Math.min(ratio, FILL_RATIO_SATURATION) / FILL_RATIO_SATURATION;
  return {
    style,
    ratio,
    alpha: FILL_ALPHA_MIN + (FILL_ALPHA_MAX - FILL_ALPHA_MIN) * t,
  };
}

/**
 * Join a `/api/energy-fr` payload to the known régions.
 *
 * The région code set is the whitelist: a `code_insee_region` the département
 * grouping does not know is not a metropolitan région and is discarded, which
 * is what keeps a future DOM row off a metropolitan map.
 *
 * @param {object|null|undefined} payload `/api/energy-fr` body.
 * @param {Map<string, object>} departements From `parseDepartements`.
 * @returns {Array<object>} One record per KNOWN, COVERED région present upstream.
 */
export function buildRegionRecords(payload, departements) {
  const regions = Array.isArray(payload?.regions) ? payload.regions : [];
  const uncovered = new Set(UNCOVERED_REGIONS);
  const records = [];
  for (const region of regions) {
    const code = String(region?.code ?? '').trim();
    const codes = REGION_DEPARTEMENTS[code];
    if (!codes || uncovered.has(code)) continue;
    const balance = balanceStyle(region.netPhysical, region.load);
    records.push({
      code,
      name: String(region?.name ?? '').trim() || code,
      at: String(region?.at ?? '').trim() || null,
      load: Number.isFinite(region?.load) ? region.load : null,
      generation: Number.isFinite(region?.generation) ? region.generation : null,
      lowCarbon: Number.isFinite(region?.lowCarbon) ? region.lowCarbon : null,
      netPhysical: Number.isFinite(region?.netPhysical) ? region.netPhysical : null,
      mix: Array.isArray(region?.mix) ? region.mix : [],
      departements: codes,
      anchor: regionAnchor(codes, departements),
      balance,
    });
  }
  // Strongest balance last, so a heavy region's fill paints over a lighter
  // neighbour's where their borders touch.
  return records.sort((a, b) => Math.abs(a.netPhysical ?? 0) - Math.abs(b.netPhysical ?? 0)
    || a.code.localeCompare(b.code));
}

/**
 * Label anchor for a région: the unweighted mean of its départements' anchors.
 *
 * This is a LABEL ANCHOR, not a centre of mass — the départements of a région
 * are not equal in area, so the mean sits wherever the small ones pull it. It
 * only has to land inside the right région, which it does for all twelve.
 *
 * @param {ReadonlyArray<string>} codes
 * @param {Map<string, object>} departements
 * @returns {number[]|null}
 */
export function regionAnchor(codes, departements) {
  let lon = 0;
  let lat = 0;
  let count = 0;
  for (const code of codes || []) {
    const anchor = departements?.get?.(code)?.anchor;
    if (!Array.isArray(anchor) || !Number.isFinite(anchor[0]) || !Number.isFinite(anchor[1])) continue;
    lon += anchor[0];
    lat += anchor[1];
    count += 1;
  }
  if (!count) return null;
  return [lon / count, lat / count];
}

/**
 * Sample a great-circle arc between two lon/lat points, raised to an apex in
 * the middle so it reads as a flow over the globe rather than a line on it.
 *
 * Spherical interpolation on unit vectors, not a lon/lat lerp: the latter
 * bends visibly wrong at these distances and breaks outright across the
 * antimeridian. The height profile is a sine bow — zero at both ends, so the
 * arc touches down on the two countries it connects.
 *
 * @param {ReadonlyArray<number>} from `[lon, lat]` degrees.
 * @param {ReadonlyArray<number>} to `[lon, lat]` degrees.
 * @param {{samples?:number, apexRatio?:number}} [options]
 * @returns {number[]} Flat `[lon, lat, height, …]`, ready for Cesium.
 */
export function greatCircleArc(from, to, options = {}) {
  const samples = Math.max(2, Math.floor(options.samples ?? ARC_SAMPLES));
  const apexRatio = Number.isFinite(options.apexRatio) ? options.apexRatio : ARC_APEX_RATIO;
  const toRad = Math.PI / 180;
  const a = {
    x: Math.cos(from[1] * toRad) * Math.cos(from[0] * toRad),
    y: Math.cos(from[1] * toRad) * Math.sin(from[0] * toRad),
    z: Math.sin(from[1] * toRad),
  };
  const b = {
    x: Math.cos(to[1] * toRad) * Math.cos(to[0] * toRad),
    y: Math.cos(to[1] * toRad) * Math.sin(to[0] * toRad),
    z: Math.sin(to[1] * toRad),
  };
  const dot = Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z));
  const omega = Math.acos(dot);
  const chordM = omega * 6_371_000;
  const apex = Math.min(ARC_APEX_MAX_M, Math.max(ARC_APEX_MIN_M, chordM * apexRatio));
  const sinOmega = Math.sin(omega);

  const positions = [];
  for (let i = 0; i < samples; i += 1) {
    const t = i / (samples - 1);
    // Coincident endpoints have no great circle; fall back to the linear blend,
    // which for identical points is just the point itself.
    const wa = sinOmega < 1e-9 ? 1 - t : Math.sin((1 - t) * omega) / sinOmega;
    const wb = sinOmega < 1e-9 ? t : Math.sin(t * omega) / sinOmega;
    const x = a.x * wa + b.x * wb;
    const y = a.y * wa + b.y * wb;
    const z = a.z * wa + b.z * wb;
    const hyp = Math.hypot(x, y, z) || 1;
    positions.push(
      Math.atan2(y, x) / toRad,
      Math.asin(Math.min(1, Math.max(-1, z / hyp))) / toRad,
      Math.sin(t * Math.PI) * apex,
    );
  }
  return positions;
}

/**
 * Turn the national exchange list into drawable arcs.
 *
 * Direction is the direction the electricity travels: a POSITIVE `mw` is an
 * import into France, so the arc starts abroad and ends in France, and the
 * arrow head lands on France. Zero flows produce no arc at all.
 *
 * @param {Array<object>|null|undefined} exchanges From `/api/energy-fr`.
 * @returns {Array<object>}
 */
export function buildBorderArcs(exchanges) {
  const arcs = [];
  for (const exchange of Array.isArray(exchanges) ? exchanges : []) {
    const key = String(exchange?.key ?? '').trim();
    const anchor = BORDER_ANCHORS[key];
    const mw = Number(exchange?.mw);
    if (!anchor || !Number.isFinite(mw)) continue;
    if (Math.abs(mw) < BALANCE_DEADBAND_MW) continue;
    const importing = mw > 0;
    const style = importing ? BALANCE_STYLES.importer : BALANCE_STYLES.exporter;
    const from = importing ? anchor : BORDER_ANCHORS.france;
    const to = importing ? BORDER_ANCHORS.france : anchor;
    const magnitude = Math.min(Math.abs(mw), ARC_SATURATION_MW) / ARC_SATURATION_MW;
    arcs.push({
      key,
      label: String(exchange?.label ?? '').trim() || key,
      mw,
      importing,
      style,
      width: ARC_WIDTH_MIN_PX + (ARC_WIDTH_MAX_PX - ARC_WIDTH_MIN_PX) * magnitude,
      positions: greatCircleArc(from, to),
      // Midpoint of the sampled arc, which is also its apex — where a label
      // sits clear of both countries.
      anchorIndex: Math.floor(ARC_SAMPLES / 2),
    });
  }
  return arcs;
}

/**
 * Label text for a région. The verb and the megawatts carry the meaning; the
 * fill colour only reinforces it.
 * @param {object} record
 * @returns {string}
 */
export function regionLabelText(record) {
  if (!record?.balance) return `${record?.name ?? ''} · ÉQUILIBRÉE`;
  return `${record.name} · ${record.balance.style.verb} ${formatMegawatts(record.netPhysical)}`;
}

/**
 * Label text for a border arc. "vers"/"depuis" states the direction in words,
 * because an arrow head is the first thing lost at a shallow camera angle.
 * @param {object} arc
 * @returns {string}
 */
export function borderLabelText(arc) {
  const direction = arc?.importing ? 'depuis' : 'vers';
  return `${formatMegawatts(arc?.mw)} ${direction} ${arc?.label}`;
}

/**
 * Build the source-owned presentation for one région label.
 * @param {object} record
 * @param {Cesium.Cartesian3} position
 * @returns {object}
 */
export function createRegionOverlayEntry(record, position) {
  return {
    id: `energy-fr:region:${record.code}`,
    position,
    variant: 'label',
    title: regionLabelText(record),
    accent: record.balance ? record.balance.style.color : '#8fa3b8',
    priority: Math.round(Math.abs(record.netPhysical ?? 0)),
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

/**
 * Build the source-owned presentation for one border-flow label.
 *
 * Border flows outrank régions in the collision cohort: there are only five of
 * them, they carry the headline "France is exporting tonight", and they sit
 * out over water or abroad where nothing else competes.
 * @param {object} arc
 * @param {Cesium.Cartesian3} position
 * @returns {object}
 */
export function createBorderOverlayEntry(arc, position) {
  return {
    id: `energy-fr:border:${arc.key}`,
    position,
    variant: 'label',
    title: borderLabelText(arc),
    accent: arc.style.color,
    priority: 1_000_000 + Math.round(Math.abs(arc.mw)),
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

/** Keep the strongest flows, with stable identity as tie-break. */
export function selectEnergyOverlayCohort(entries, limit = ENERGY_OVERLAY_COHORT_LIMIT) {
  const cap = Math.max(0, Math.min(
    ENERGY_OVERLAY_COHORT_LIMIT,
    Math.floor(Number(limit) || 0),
  ));
  if (!Array.isArray(entries) || cap === 0) return [];
  return entries.slice().sort((a, b) => (
    b.priority - a.priority || String(a.id).localeCompare(String(b.id))
  )).slice(0, cap);
}

/**
 * Roll the national block up into the figures the HUD and the analyst read.
 *
 * `lowCarbonShare` is computed against GENERATION, not consumption: the
 * denominator has to be what France produced, or a heavy export hour reports a
 * share above 100%.
 *
 * @param {object|null|undefined} national
 * @returns {object}
 */
export function summarizeNational(national) {
  const generation = Number.isFinite(national?.generation) ? national.generation : null;
  const lowCarbon = Number.isFinite(national?.lowCarbon) ? national.lowCarbon : null;
  return {
    at: national?.at || null,
    load: Number.isFinite(national?.load) ? national.load : null,
    co2: Number.isFinite(national?.co2) ? national.co2 : null,
    generation,
    lowCarbonShare: generation && generation > 0 && lowCarbon !== null
      ? Math.round((lowCarbon / generation) * 1000) / 10
      : null,
    netPhysical: Number.isFinite(national?.netPhysical) ? national.netPhysical : null,
    netCommercial: Number.isFinite(national?.netCommercial) ? national.netCommercial : null,
    topFiliere: Array.isArray(national?.mix) && national.mix.length ? national.mix[0] : null,
  };
}

/**
 * Legend for the toggle row: the balance palette, with how many régions sit on
 * each side right now.
 * @param {Array<object>} records
 * @returns {Array<{label:string,color:string,blurb:string,count:number}>}
 */
export function balanceLegend(records) {
  const counts = { exporter: 0, importer: 0 };
  for (const record of Array.isArray(records) ? records : []) {
    const key = record?.balance?.style?.key;
    if (key in counts) counts[key] += 1;
  }
  const legend = [];
  for (const key of ['exporter', 'importer']) {
    if (!(counts[key] > 0)) continue;
    const spec = BALANCE_STYLES[key];
    legend.push({ label: spec.label, color: spec.color, blurb: spec.blurb, count: counts[key] });
  }
  return legend;
}

/**
 * Map one région to a JSON-safe analyst record (analyst query engine seam).
 * Pure — no Cesium types. Missing fields are null, never NaN.
 * @param {object|null|undefined} record
 * @param {number} [index=0]
 * @returns {object}
 */
export function mapAnalystRecord(record, index = 0) {
  const text = (v) => { const t = String(v ?? '').trim(); return t || null; };
  const num = (v) => (Number.isFinite(v) ? v : null);
  return {
    id: text(record?.code) || `REGION-${String(index).padStart(4, '0')}`,
    name: text(record?.name),
    loadMw: num(record?.load),
    generationMw: num(record?.generation),
    // Restated in the direction a human asks the question in: positive means
    // this région sent power to the rest of France.
    netExportMw: Number.isFinite(record?.netPhysical) ? -record.netPhysical : null,
    balance: text(record?.balance?.style?.key),
    topFiliere: record?.mix?.length ? text(record.mix[0].label) : null,
    observedAt: text(record?.at),
    lat: record?.anchor ? record.anchor[1] : null,
    lon: record?.anchor ? record.anchor[0] : null,
  };
}

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  clearSource: clearOverlaySource,
  setVisible: setOverlaySourceVisible,
});

/**
 * Which Cesium classification surface a clamped région fill should target.
 * Same rule the Vigicrues and Vigilance layers established: classify against
 * ONLY the active surface, and fall back to BOTH for an unknown stack rather
 * than risk drawing nothing.
 * @param {string|null|undefined} activeId Active map-stack id.
 * @returns {Cesium.ClassificationType}
 */
export function energyClassificationTypeForStack(activeId) {
  const id = String(activeId || '').toLowerCase();
  if (!id) return Cesium.ClassificationType.BOTH;
  if (id.includes('photo') || id.includes('google') || id.includes('3d')) {
    return Cesium.ClassificationType.CESIUM_3D_TILE;
  }
  return Cesium.ClassificationType.TERRAIN;
}

/**
 * @param {object} [options]
 * @returns {object} Data-manager layer module.
 */
export function createFranceEnergyLayer({
  overlayHost = DEFAULT_OVERLAY_HOST,
  apiUrl = API_URL,
  departementsUrl = DEPARTEMENTS_URL,
  departementsGeoJson = null,
  mapStackEventTarget = typeof window === 'undefined' ? null : window,
} = {}) {
  let _viewer = null;
  let _dataSource = null;
  /** @type {Map<string, object>} INSEE code → bundled polygon metadata. */
  let _departements = new Map();
  /**
   * Département code → EVERY entity Cesium made for it. A `MultiPolygon`
   * département becomes one entity PER PART — see the Vigilance layer's note
   * on the ten départements that carry islands.
   * @type {Map<string, Cesium.Entity[]>}
   */
  let _entities = new Map();
  /** @type {Map<string, Cesium.Entity>} border key → arc polyline entity. */
  let _arcEntities = new Map();
  let _shapesPromise = null;
  let _records = [];
  let _arcs = [];
  let _national = summarizeNational(null);
  let _signature = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _stale = false;
  let _enabled = false;
  let _feedSource = null;
  let _classificationType = Cesium.ClassificationType.BOTH;
  let _mapStackListener = null;

  function applyClassification(next) {
    if (next === undefined || next === _classificationType) return;
    _classificationType = next;
    for (const parts of _entities.values()) {
      for (const entity of parts) {
        if (entity.polygon) entity.polygon.classificationType = next;
      }
    }
    _viewer?.scene?.requestRender?.();
  }

  /**
   * Load the bundled polygons ONCE, hidden. Every département gets an entity up
   * front so a refresh only flips `show` and swaps a material.
   */
  async function ensureShapes() {
    if (_shapesPromise) return _shapesPromise;
    _shapesPromise = (async () => {
      const geojson = departementsGeoJson
        || await (await fetch(departementsUrl)).json();
      _departements = parseDepartements(geojson);
      const source = await Cesium.GeoJsonDataSource.load(geojson, {
        clampToGround: true,
        fill: Cesium.Color.TRANSPARENT,
        stroke: Cesium.Color.TRANSPARENT,
        strokeWidth: 0,
      });
      source.name = 'éCO2mix — mix électrique français';
      source.show = _enabled;
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
        const parts = _entities.get(code);
        if (parts) parts.push(entity);
        else _entities.set(code, [entity]);
      }
      if (_viewer) await _viewer.dataSources.add(source);
      _dataSource = source;
      return source;
    })().catch((error) => {
      // A failed shape load must be retryable, not a permanently poisoned
      // promise that leaves the layer silently empty for the session.
      _shapesPromise = null;
      throw error;
    });
    return _shapesPromise;
  }

  /** Paint the current régions onto the pre-built département entities. */
  function repaint() {
    const painted = new Set();
    for (const record of _records) {
      if (!record.balance) continue;
      // One material instance per région, shared across all its départements:
      // they are one measurement, not eight.
      const material = new Cesium.ColorMaterialProperty(
        Cesium.Color.fromCssColorString(record.balance.style.color)
          .withAlpha(record.balance.alpha),
      );
      for (const code of record.departements) {
        const parts = _entities.get(code);
        if (!parts) continue;
        painted.add(code);
        for (const entity of parts) {
          if (!entity.polygon) continue;
          entity.polygon.material = material;
          entity.show = true;
        }
      }
    }
    // Everything else — Corse, and any région the upstream dropped this
    // refresh — is drawn as absence rather than as a stale colour.
    for (const [code, parts] of _entities) {
      if (painted.has(code)) continue;
      for (const entity of parts) entity.show = false;
    }
    repaintArcs();
    _viewer?.scene?.requestRender?.();
  }

  /** Rebuild the border arcs. Five entities at most, so they are recreated whole. */
  function repaintArcs() {
    if (!_dataSource) return;
    const live = new Set();
    for (const arc of _arcs) {
      live.add(arc.key);
      let entity = _arcEntities.get(arc.key);
      const positions = Cesium.Cartesian3.fromDegreesArrayHeights(arc.positions);
      const color = Cesium.Color.fromCssColorString(arc.style.color);
      if (!entity) {
        entity = _dataSource.entities.add({
          id: `energy-fr:arc:${arc.key}`,
          polyline: {
            positions,
            width: arc.width,
            // The arrow head is the direction of travel; `borderLabelText`
            // repeats it in words for the angles where the head is not legible.
            material: new Cesium.PolylineArrowMaterialProperty(color),
            arcType: Cesium.ArcType.NONE,
          },
        });
        _arcEntities.set(arc.key, entity);
      } else {
        entity.polyline.positions = positions;
        entity.polyline.width = arc.width;
        entity.polyline.material = new Cesium.PolylineArrowMaterialProperty(color);
      }
      entity.show = true;
    }
    for (const [key, entity] of _arcEntities) {
      if (!live.has(key)) entity.show = false;
    }
  }

  function publishOverlay() {
    if (!_enabled) return;
    const entries = [];
    for (const record of _records) {
      if (!record.balance || !record.anchor) continue;
      entries.push(createRegionOverlayEntry(
        record,
        Cesium.Cartesian3.fromDegrees(record.anchor[0], record.anchor[1]),
      ));
    }
    for (const arc of _arcs) {
      const i = arc.anchorIndex * 3;
      if (!Number.isFinite(arc.positions[i])) continue;
      entries.push(createBorderOverlayEntry(
        arc,
        Cesium.Cartesian3.fromDegrees(arc.positions[i], arc.positions[i + 1], arc.positions[i + 2]),
      ));
    }
    overlayHost.setEntries(
      ENERGY_OVERLAY_SOURCE_ID,
      selectEnergyOverlayCohort(entries),
      {
        cohortLimit: ENERGY_OVERLAY_COHORT_LIMIT,
        collisionCapacity: ENERGY_OVERLAY_COLLISION_CAPACITY,
        moving: false,
      },
    );
  }

  /** Fingerprint of the painted state, so an unchanged snapshot repaints nothing. */
  function signatureOf(records, arcs) {
    return [
      records.map((r) => `${r.code}:${Math.round(r.netPhysical ?? 0)}`).join(','),
      arcs.map((a) => `${a.key}:${Math.round(a.mw)}`).join(','),
    ].join('|');
  }

  const layer = {
    id: 'france-energy',
    name: 'Mix élec (FR)',
    icon: '⚡',
    source: 'RTE / ODRÉ',
    updateInterval: UPDATE_INTERVAL_MS,

    init(viewer) {
      _viewer = viewer;
      _records = [];
      _arcs = [];
      _national = summarizeNational(null);
      _signature = null;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      _enabled = false;
      _feedSource = null;
      _classificationType = energyClassificationTypeForStack(null);
      if (mapStackEventTarget && !_mapStackListener) {
        _mapStackListener = (event) => {
          applyClassification(energyClassificationTypeForStack(event?.detail?.activeId));
        };
        mapStackEventTarget.addEventListener('gev:map-stack-changed', _mapStackListener);
      }
      overlayHost.setVisible(ENERGY_OVERLAY_SOURCE_ID, false);
      console.log('[Data:Energy FR] Initialized');
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(ENERGY_OVERLAY_SOURCE_ID, true);
      publishOverlay();
    },

    disable() {
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(ENERGY_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(ENERGY_OVERLAY_SOURCE_ID, false);
    },

    async update() {
      try {
        await ensureShapes();
      } catch (error) {
        console.warn('[Data:Energy FR] Département polygons unavailable:', error);
        _lastError = 'Département polygons unavailable';
        return false;
      }
      try {
        const response = await fetch(apiUrl);
        if (!response.ok) {
          _lastError = `éCO2mix HTTP ${response.status}`;
          console.warn(`[Data:Energy FR] API returned ${response.status}`);
          return false;
        }
        const payload = await response.json();
        if (!payload?.national && !Array.isArray(payload?.regions)) {
          _lastError = 'Malformed éCO2mix response';
          return false;
        }

        const records = buildRegionRecords(payload, _departements);
        const arcs = buildBorderArcs(payload?.national?.exchanges);
        const signature = signatureOf(records, arcs);
        _records = records;
        _arcs = arcs;
        _national = summarizeNational(payload.national);
        _feedSource = String(payload.source ?? '').trim() || null;
        _stale = payload.stale === true;
        _lastUpdate = Date.now();
        _lastError = null;

        if (signature !== _signature) {
          _signature = signature;
          repaint();
          publishOverlay();
        }

        const share = _national.lowCarbonShare;
        console.log(
          `[Data:Energy FR] Updated: ${_records.length} régions,`
          + ` ${formatMegawatts(_national.load)} appelés,`
          + ` ${share === null ? '—' : `${share}%`} bas-carbone,`
          + ` ${_national.co2 ?? '—'} gCO₂/kWh`,
        );
        return true;
      } catch (error) {
        console.warn('[Data:Energy FR] Fetch error:', error);
        _lastError = 'éCO2mix network error';
        return false;
      }
    },

    destroy(viewer) {
      _enabled = false;
      overlayHost.clearSource(ENERGY_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(ENERGY_OVERLAY_SOURCE_ID, false);
      if (mapStackEventTarget && _mapStackListener) {
        mapStackEventTarget.removeEventListener('gev:map-stack-changed', _mapStackListener);
        _mapStackListener = null;
      }
      if (_dataSource) {
        viewer?.dataSources?.remove?.(_dataSource, true);
        _dataSource = null;
      }
      _viewer = null;
      _departements = new Map();
      _entities = new Map();
      _arcEntities = new Map();
      _shapesPromise = null;
      _records = [];
      _arcs = [];
      _national = summarizeNational(null);
      _signature = null;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      _feedSource = null;
    },

    /**
     * Snapshot the régions as plain JSON-safe objects for the analyst query
     * engine. On-demand only. Returns [] while the layer is off.
     * @param {number} [maxCount=200]
     * @returns {Array<Object>}
     */
    getAnalystRecords(maxCount = 200) {
      if (!_enabled) return [];
      const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 200;
      const result = [];
      for (const record of _records) {
        if (result.length >= limit) break;
        result.push(mapAnalystRecord(record, result.length));
      }
      return result;
    },

    /**
     * Colour legend for the toggle row. No chips: the layer has no options.
     * @returns {{chips: Array<object>, legend: Array<object>}}
     */
    getRowControls() {
      return { chips: [], legend: balanceLegend(_records) };
    },

    getStats() {
      return {
        // Régions actually painted. Corse is excluded upstream, so 12 is a
        // full house and reporting 13 would imply a coverage that is not there.
        count: _records.length,
        lastUpdate: _lastUpdate,
        error: _lastError,
        stale: _stale,
        loadMw: _national.load,
        co2gPerKwh: _national.co2,
        lowCarbonShare: _national.lowCarbonShare,
        // Restated as "France sent this much abroad" — the upstream sign is
        // consumption-minus-generation, which reads backwards in a HUD.
        netExportMw: Number.isFinite(_national.netPhysical) ? -_national.netPhysical : null,
        // Kept separate and separately named: the five commercial balances do
        // not sum to the physical one. See the module header.
        netCommercialExportMw: Number.isFinite(_national.netCommercial)
          ? -_national.netCommercial
          : null,
        topFiliere: _national.topFiliere ? _national.topFiliere.label : null,
        borders: _arcs.length,
        // Licence Ouverte 2.0 obliges the producer AND the last-update date.
        updateTime: _national.at,
        feedSource: _feedSource,
      };
    },
  };

  return layer;
}

const franceEnergyLayer = createFranceEnergyLayer();

export default franceEnergyLayer;
