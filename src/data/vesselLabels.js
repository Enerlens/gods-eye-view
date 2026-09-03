/**
 * @module vesselLabels
 * @description AIS type formatting and shared world-overlay policy retained
 * after the vessel cards moved out of their dedicated canvas renderer.
 */

export const VESSEL_OVERLAY_SOURCE_ID = 'ais-live-vessels';
/** Existing selector grid size; one ambient winner is retained per cell. */
export const VESSEL_LABEL_GRID_PX = 118;
/** Existing environment-default ceiling for ambient vessel rows. */
export const VESSEL_DEFAULT_LABEL_LIMIT = 900;
/** Existing configured absolute ceiling; viewport grid demand is usually lower. */
export const VESSEL_OVERLAY_MAX_COHORT = VESSEL_DEFAULT_LABEL_LIMIT;
/** Existing ambient vessel-card distance fade reaches zero at 5000 km. */
export const VESSEL_CARD_FADE_DISTANCE_M = 5_000_000;

/**
 * AIS type family → chevron hue + card accent. Single source of truth for
 * vessel type colors so billboard chevrons and host cards cannot drift apart.
 */
const TYPE_STYLES = [
  { pattern: /tanker/i, css: '#ffb347', accent: '255, 179, 71' },
  { pattern: /cargo|container|bulk|carrier/i, css: '#39d5ff', accent: '57, 213, 255' },
  { pattern: /passenger|ferry|cruise/i, css: '#ff7adf', accent: '255, 122, 223' },
  { pattern: /fishing/i, css: '#7cff9b', accent: '124, 255, 155' },
  { pattern: /tug|tow|pilot|supply|service/i, css: '#f7f0a3', accent: '247, 240, 163' },
];
/**
 * Vessels whose AIS type matches no family — including the very common case of
 * a vessel that has broadcast no type at all.
 *
 * This used to be `#39d5ff` / `57, 213, 255`: byte-for-byte the CARGO colour.
 * A ship that had declared nothing was drawn as a container ship, in a palette
 * where the reader's only cue is hue (CARTOGRAPHIE A1). The replacement is
 * deliberately OFF the family ramp — a desaturated slate among five saturated
 * hues — so "no family" reads as its own state rather than as membership in
 * whichever family happened to be the default.
 */
const DEFAULT_STYLE = { css: '#9aa7b5', accent: '154, 167, 181' };

const NUMERIC_TYPE_SPECIALS = {
  30: 'FISHING', 31: 'TOWING', 32: 'TOWING', 33: 'DREDGER', 34: 'DIVE OPS',
  35: 'MILITARY', 36: 'SAILING', 37: 'PLEASURE',
  50: 'PILOT', 51: 'SAR', 52: 'TUG', 53: 'PORT TENDER', 54: 'ANTI-POLLUTION',
  55: 'LAW ENFORCE', 58: 'MEDICAL',
};
const NUMERIC_TYPE_FAMILIES = {
  4: 'HIGH-SPEED', 6: 'PASSENGER', 7: 'CARGO', 8: 'TANKER', 9: 'OTHER',
};

/**
 * Resolve an AIS type to display text: bare numeric ship-type codes map to
 * family names ("71" → "CARGO"); text types pass through unchanged.
 * @param {string} type Raw AIS type.
 * @returns {string}
 */
export function normalizeVesselType(type) {
  const text = String(type || '').trim();
  if (!text || !/^\d{1,2}$/.test(text)) return text;
  const code = Number(text);
  if (code <= 0) return '';
  if (NUMERIC_TYPE_SPECIALS[code]) return NUMERIC_TYPE_SPECIALS[code];
  return NUMERIC_TYPE_FAMILIES[Math.floor(code / 10)] || 'OTHER';
}

/** AIS ship type → CSS hex hue for the billboard chevron. */
export function vesselTypeCss(type) {
  return styleForType(type).css;
}

/** AIS ship type → "r, g, b" accent string for the host card. */
export function accentForVesselType(type) {
  return styleForType(type).accent;
}

function styleForType(type) {
  const text = normalizeVesselType(type);
  return TYPE_STYLES.find((entry) => entry.pattern.test(text)) || DEFAULT_STYLE;
}

/**
 * The family a chevron's hue actually stands for, as a legend key.
 *
 * `null` is the unfamilied bucket — an AIS type this palette has no pattern
 * for, and, far more often, a vessel that broadcast no type at all. It is a
 * bucket the map has always drawn and never named.
 * @param {string} type Raw AIS type.
 * @returns {string|null} Family key, or null when nothing matched.
 */
export function vesselTypeFamily(type) {
  const text = normalizeVesselType(type);
  const index = TYPE_STYLES.findIndex((entry) => entry.pattern.test(text));
  return index < 0 ? null : VESSEL_FAMILY_KEYS[index];
}

/** Family keys, parallel to TYPE_STYLES, with the caption a reader gets. */
const VESSEL_FAMILY_KEYS = Object.freeze(['tanker', 'cargo', 'passenger', 'fishing', 'service']);

/** Legend captions, keyed as {@link vesselTypeFamily} reports. */
export const VESSEL_FAMILY_LABELS = Object.freeze({
  tanker: 'Pétrolier / chimiquier',
  cargo: 'Cargo, porte-conteneurs, vraquier',
  passenger: 'Passagers, ferry, croisière',
  fishing: 'Pêche',
  service: 'Remorquage, pilotage, servitude',
  unknown: 'Type non déclaré',
});

/** Swatch colour for a family key, including the unfamilied bucket. */
export function vesselFamilyCss(family) {
  const index = VESSEL_FAMILY_KEYS.indexOf(family);
  return index < 0 ? DEFAULT_STYLE.css : TYPE_STYLES[index].css;
}

/**
 * Derive the source's ambient cohort from the shipped selector grid. This is
 * an upper bound; the existing greedy 150 px separation usually yields fewer.
 * Selected vessels are protected and do not consume this budget.
 * @param {number} width CSS viewport width.
 * @param {number} height CSS viewport height.
 * @param {number} [rowLimit=900] Configured source row ceiling.
 * @returns {number}
 */
export function vesselOverlayCohortLimit(width, height, rowLimit = VESSEL_DEFAULT_LABEL_LIMIT) {
  const w = Number(width);
  const h = Number(height);
  const requested = Number(rowLimit);
  if (!(w > 0) || !(h > 0) || !(requested > 0)) return 0;
  const gridCapacity = Math.ceil(w / VESSEL_LABEL_GRID_PX) * Math.ceil(h / VESSEL_LABEL_GRID_PX);
  return Math.min(VESSEL_OVERLAY_MAX_COHORT, Math.floor(requested), gridCapacity);
}

/**
 * Add host-owned layout, fade, collision and paint-lane fields to a formatted
 * vessel card. Ambient and selected cards share `ambient-card`, so the host's
 * protected selected rectangle excludes ambient cards while bypassing quotas.
 * @param {Object} card Source-formatted vessel card.
 * @param {number} [fadeDistance=5000000] Ambient distance-fade endpoint.
 * @returns {Object}
 */
export function applyVesselOverlayPolicy(card, fadeDistance = VESSEL_CARD_FADE_DISTANCE_M) {
  const selected = card?.selected === true;
  const rawGap = Number(card?.gapPx) || 10;
  const gapPx = Math.max(12, rawGap + 8);
  return {
    ...card,
    variant: selected ? 'selected' : 'card',
    protected: selected,
    collisionGroup: 'ambient-card',
    cardStyle: 'tactical',
    gapPx,
    leaderOffsetPx: Math.max(2, gapPx - 6),
    verticalOnly: true,
    viewportMargin: 4,
    maxDistance: selected ? Number.POSITIVE_INFINITY : fadeDistance,
    distanceFadeStartRatio: 0.7,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    // Only MMSI-keyed cards can resolve back to one actionable vessel.
    interactive: card?.actionable === true,
  };
}
