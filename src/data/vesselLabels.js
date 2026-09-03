/**
 * @module vesselLabels
 * @description Shared AIS semiology: the type→hue table, the world-overlay card
 * policy, and — since the size pass — the HULL, which is the one quantitative
 * channel this layer was throwing away.
 *
 * ── What this module now owns, and why it is here ───────────────────────────
 *
 * `aisLiveVessels.js` draws the chevrons and `aisStreamAdapter.js` decodes the
 * socket; both need the same answer to "how big is this ship, and did anyone
 * actually say?". Putting that answer in one pure module (no Cesium, no I/O)
 * is what keeps the transponder's sentinel values from being interpreted twice
 * in two slightly different ways — which is exactly how the default CARGO hue
 * survived for so long.
 *
 * ── The measurement that decides everything ─────────────────────────────────
 *
 * Two independent runs on the live AISStream feed, world bounding box,
 * 2026-09-03 (5 min, then 4 min):
 *
 *   · 18 308 then 15 982 distinct MMSIs carried a position;
 *   · 18.0 % then **16.2 %** published a usable hull. Restricted to the French
 *     bounding box — the product's actual view — 666 of 3 756 contacts, 17.7 %;
 *   · 1 709 of 4 307 dimension blocks were ALL ZEROS: the "not available"
 *     default of an unconfigured transponder, and the commonest shape on the
 *     wire. 4 more carried a beam wider than the hull was long (a transposed
 *     field). None was saturated at 511/63, and none was under 3 m.
 *
 * So **four contacts in five publish no hull**, and any design that gives them
 * a default size would be inventing the size of 82 % of the map. That is the
 * aircraft defect this repo has just finished correcting ("97 % de la flotte
 * visible portait une silhouette inventée", docs/PLAN-CARTOGRAPHIE.md § 1.4),
 * and it is not worth repeating at sea.
 *
 * Length distribution over the measured hulls (m):
 * min 4 · p05 12 · p10 15 · p25 22 · **median 40** · p75 105 · p90 183 ·
 * p95 229 · p99 332 · max 400. Beam: median 10 · p90 30 · max 80.
 * The median contact is a 40 m workboat, not a container ship — which is why
 * the ramp is anchored at 200 m rather than at the maximum, and why the floor
 * is set at the measured p10 (16 m, where 12.2 % of hulls sit) instead of at
 * zero.
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

// ---------------------------------------------------------------------------
// Hull dimensions — the size channel
// ---------------------------------------------------------------------------

/**
 * AIS hull dimensions, and what they are allowed to draw.
 *
 * ── What is in the data ─────────────────────────────────────────────────────
 *
 * Message 5 (`ShipStaticData`) and message 24 part B (`StaticDataReport`)
 * publish four integers referenced to the transponder antenna, not to the
 * hull's centre: A = to bow, B = to stern, C = to port, D = to starboard
 * (ITU-R M.1371-5, table 51). Length overall is A + B and beam is C + D. The
 * repo threw all four away: `vite.config.js:17281` kept only name, type,
 * destination and IMO from exactly the message that carries them.
 *
 * ── The three sentinel values, which are NOT measurements ───────────────────
 *
 * Every field defaults to 0 for "not available", and that default reaches the
 * wire constantly — a Class B transponder that has never been configured
 * broadcasts 0/0/0/0 forever. A + B = 0 is therefore the single most common
 * "dimension" on the feed and it must never become a hull.
 *
 * A and B saturate at 511 ("511 m or greater"), C and D at 63. The largest
 * ship ever built was 458 m (Seawise Giant, scrapped 2010); the widest hull
 * afloat is 124 m (Pioneering Spirit) and it is a twin-hull outlier. So a
 * reported 511 is the transponder saying "off my scale", not a measurement,
 * and it is refused. {@link VESSEL_LOA_MAX_M} / {@link VESSEL_BEAM_MAX_M} are
 * the plausibility ceilings above which the quadruple is discarded whole: a
 * transposed or mis-scaled field is far more likely than a record-breaking
 * hull, and a 4 km chevron in a harbour is a worse error than a missing one.
 *
 * Length and beam are resolved SEPARATELY on purpose. A + B > 0 with
 * C + D = 0 is a real and frequent shape (length configured, beam left at the
 * default): the arrow's area may carry the length, and no hull may be drawn,
 * because a hull needs a width and inventing one is exactly rule A1.
 *
 * @param {number|string|null|undefined} toBow A — antenna to bow (m).
 * @param {number|string|null|undefined} toStern B — antenna to stern (m).
 * @param {number|string|null|undefined} toPort C — antenna to port (m).
 * @param {number|string|null|undefined} toStarboard D — antenna to starboard (m).
 * @returns {{loaM: number|null, beamM: number|null, toBowM: number|null,
 *   toPortM: number|null}} Nulls where the feed published nothing usable.
 */
export function vesselHullFromAisDimensions(toBow, toStern, toPort, toStarboard) {
  const a = plausibleDimension(toBow, VESSEL_LOA_MAX_M, AIS_LENGTH_SATURATION);
  const b = plausibleDimension(toStern, VESSEL_LOA_MAX_M, AIS_LENGTH_SATURATION);
  const c = plausibleDimension(toPort, VESSEL_BEAM_MAX_M, AIS_BEAM_SATURATION);
  const d = plausibleDimension(toStarboard, VESSEL_BEAM_MAX_M, AIS_BEAM_SATURATION);

  const loaRaw = a === null || b === null ? null : a + b;
  const beamRaw = c === null || d === null ? null : c + d;
  const loaM = loaRaw !== null && loaRaw >= VESSEL_LOA_MIN_M && loaRaw <= VESSEL_LOA_MAX_M
    ? loaRaw
    : null;
  let beamM = beamRaw !== null && beamRaw > 0 && beamRaw <= VESSEL_BEAM_MAX_M ? beamRaw : null;
  // A beam wider than the hull is long is a field transposition, not a barge.
  if (beamM !== null && loaM !== null && beamM > loaM) beamM = null;

  return {
    loaM,
    beamM,
    // The antenna offsets are kept only when BOTH ends are usable; a hull
    // drawn from one of them would be centred on a guess.
    toBowM: loaM !== null ? a : null,
    toPortM: beamM !== null ? c : null,
  };
}

/** Shortest hull the feed can plausibly mean (m). Below this it is a sentinel. */
export const VESSEL_LOA_MIN_M = 3;
/** Length ceiling (m) — above it the quadruple is a sentinel or a transposition. */
export const VESSEL_LOA_MAX_M = 500;
/** Beam ceiling (m) — Pioneering Spirit, the widest hull afloat, is 124 m. */
export const VESSEL_BEAM_MAX_M = 90;

/**
 * The value each AIS field takes to mean "this dimension is off my scale".
 * A/B are 9-bit and saturate at 511 m, C/D are 6-bit and saturate at 63 m.
 * These are NOT measurements and are refused independently of the plausibility
 * ceilings — 63 m of half-beam would otherwise slip under a 90 m beam ceiling
 * and draw a hull nobody reported.
 */
const AIS_LENGTH_SATURATION = 511;
const AIS_BEAM_SATURATION = 63;

/** One AIS dimension field, or null when absent / sentinel / implausible. */
function plausibleDimension(value, ceiling, saturation) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n >= saturation) return null;
  if (n > ceiling) return null;
  return n;
}

/**
 * Pull the four dimensions out of an AIS static message body.
 *
 * `ShipStaticData` carries `Dimension` at the top level; `StaticDataReport`
 * (message 24) splits itself in two and puts it under `ReportB`. Both spellings
 * are read, because a Class B vessel only ever sends the second one and that is
 * precisely the population whose size the map most misrepresents.
 * @param {Object|null|undefined} message AISStream message body.
 * @returns {{loaM: number|null, beamM: number|null, toBowM: number|null,
 *   toPortM: number|null}}
 */
export function vesselHullFromAisMessage(message) {
  const dimension = message?.Dimension
    || message?.ReportB?.Dimension
    || message?.Dimensions
    || null;
  if (!dimension) return { loaM: null, beamM: null, toBowM: null, toPortM: null };
  return vesselHullFromAisDimensions(dimension.A, dimension.B, dimension.C, dimension.D);
}

// ---------------------------------------------------------------------------
// The size ramp — pixels, deliberately not world units, above the hull altitude
// ---------------------------------------------------------------------------

/**
 * Reference length (m) drawn at chevron scale 1.0, i.e. the shipped 32 px art.
 *
 * 200 m is not a statistic of the visible sample — it is a frozen domain
 * anchor (rule C1). Recomputing it from what is on screen would make a tug
 * change size when a container ship sails into frame.
 */
export const VESSEL_ARROW_REF_LOA_M = 200;
/** Chevron artwork edge (px) at scale 1.0. */
export const VESSEL_ARROW_ART_PX = 32;
/**
 * Floor of the ramp, in METRES rather than in scale, so the bound the legend
 * publishes is the bound the code applies. 16 m is the measured p10 of the
 * length distribution (see the module header — 12.2 % of measured hulls are
 * shorter): below it the ramp would produce marks under 9 px, which stop being
 * clickable and stop being chevrons. The legend counts every contact drawn at
 * the floor, because a clamped mark no longer measures anything.
 */
export const VESSEL_ARROW_MIN_LOA_M = 16;
/**
 * Ceiling of the ramp. 450 m is just under the longest ship ever built (458 m,
 * Seawise Giant, scrapped 2010) and above the longest observed on the feed
 * (400 m, with zero contacts over 450 m in either run), so this bound is
 * expected never to bite — it exists so that if it
 * ever does, the count is declared instead of the mark silently lying.
 */
export const VESSEL_ARROW_MAX_LOA_M = 450;
/**
 * Fixed size for a vessel whose dimensions are NOT published.
 *
 * It sits inside the ramp's numeric span on purpose — putting it below the
 * floor would read "smallest ship here", which is a claim. What separates it is
 * not its size but its SHAPE: {@link VESSEL_UNMEASURED_DASH} draws it hollow
 * and dashed, the repo's existing convention for "not surveyed" (the CCTV
 * layer's dashed cone for an unrecorded bearing). The legend then says, in
 * words, that this mark is off the scale.
 */
export const VESSEL_ARROW_UNMEASURED_SCALE = 0.66;
/** Dash pattern (SVG units) of the unmeasured chevron outline. */
export const VESSEL_UNMEASURED_DASH = '3 2.2';

/**
 * Billboard scale for a measured hull — AREA proportional to length overall.
 *
 * AREA, not edge: the eye integrates the mark's surface, so an edge ∝ L makes a
 * 400 m ship claim four times a 200 m one. `edfPowerPlants.js` already states
 * this rule for its discs ("l'aire plutôt que le rayon porte les mégawatts");
 * this is the same rule on a chevron. Hence scale = sqrt(L / 200).
 *
 * It is PIXELS, not world units, and that is the whole of rule B2: the arrow
 * regime exists above the altitude where a real hull is legible, so its size
 * must not also be divided by the distance. The layer sets no
 * `scaleByDistance`, which is what makes this legal — verified, not assumed.
 * @param {number|null|undefined} loaM Length overall (m), or null when unpublished.
 * @returns {number|null} Billboard scale, or null when nothing was measured.
 */
export function vesselArrowScale(loaM) {
  if (!Number.isFinite(loaM) || loaM <= 0) return null;
  const clamped = Math.min(VESSEL_ARROW_MAX_LOA_M, Math.max(VESSEL_ARROW_MIN_LOA_M, loaM));
  return Math.sqrt(clamped / VESSEL_ARROW_REF_LOA_M);
}

/**
 * Whether the ramp had to clamp this length, and at which end.
 *
 * A5: a mark drawn at the floor no longer counts, so the legend states how many
 * there are. On the measured distribution this fires for roughly one measured
 * hull in ten at the floor and never at the ceiling.
 * @param {number|null|undefined} loaM Length overall (m).
 * @returns {'below'|'above'|null}
 */
export function vesselArrowClamp(loaM) {
  if (!Number.isFinite(loaM) || loaM <= 0) return null;
  if (loaM < VESSEL_ARROW_MIN_LOA_M) return 'below';
  if (loaM > VESSEL_ARROW_MAX_LOA_M) return 'above';
  return null;
}

/** Rendered chevron edge (px) for a length, for the legend's numbered marks. */
export function vesselArrowPx(loaM) {
  const scale = vesselArrowScale(loaM);
  return scale === null ? null : scale * VESSEL_ARROW_ART_PX;
}

// ---------------------------------------------------------------------------
// The hull — world units, below the altitude where it is legible
// ---------------------------------------------------------------------------

/** Reference hull (m) used to derive the altitude at which hulls switch on. */
export const HULL_REFERENCE_LOA_M = 200;
/** Screen size (px) the reference hull must reach before hulls are worth drawing. */
export const HULL_MIN_SCREEN_PX = 10;
/** Hulls drawn at once. Above this the nearest are kept and the rest declared. */
export const HULL_RENDER_CAP = 400;
/** Fraction of length overall occupied by the bow taper. */
const HULL_BOW_TAPER = 0.20;

/**
 * Camera height (m) below which a real hull is worth drawing.
 *
 * Derived, not chosen. A perspective camera shows
 * `2·d·tan(fovy/2)` metres over `H` pixels, so one pixel is
 * `2·d·tan(fovy/2)/H` metres and a hull of length L spans `L·H / (2·d·tan(fovy/2))`
 * pixels. Solving for the distance at which a 200 m hull reaches 10 px, with
 * Cesium's default fovy of 60° on a 900 px canvas, gives 15.6 km. Above that a
 * hull is a smear and the chevron is the honest mark; below it the hull is the
 * measurement and the chevron becomes the contact marker on top of it.
 *
 * REPRESENTATION.md proposed "~10 km" by eye. The arithmetic says 15.6 km for
 * a 200 m ship, and it is worth saying out loud what that hides: a 30 m fishing
 * boat only reaches 10 px at 2.3 km. There is no single altitude at which every
 * hull becomes legible, which is why the chevron never leaves.
 * @param {number} [canvasHeightPx=900] Canvas height in CSS pixels.
 * @param {number} [fovyRad=Math.PI/3] Vertical field of view (radians).
 * @returns {number} Camera height in metres.
 */
export function hullAltitudeM(canvasHeightPx = 900, fovyRad = Math.PI / 3) {
  const h = Number(canvasHeightPx);
  const fovy = Number(fovyRad);
  if (!(h > 0) || !(fovy > 0) || fovy >= Math.PI) return 0;
  return (HULL_REFERENCE_LOA_M * h) / (HULL_MIN_SCREEN_PX * 2 * Math.tan(fovy / 2));
}

/**
 * The hull outline in the local tangent plane, metres east and north.
 *
 * Five vertices — a rectangle with a pointed bow — laid out in the SHIP frame
 * (x to starboard, y to bow) about the AIS reference point, which is the
 * antenna and not the centre of the hull. That is why `toBowM` and `toPortM`
 * are carried through {@link vesselHullFromAisDimensions} rather than being
 * reduced to a length and a beam: recentring the polygon on the position fix
 * would move a 400 m ship by up to 200 m, which at the altitude where hulls
 * draw is a visible lie about where the bow is.
 *
 * When the antenna offsets are absent the outline is centred, and the caller is
 * expected to have refused the hull already — this function does not invent.
 *
 * The polygon is then rotated by the vessel's heading, clockwise from north, in
 * the tangent plane. Heading is NOT defaulted: a hull is a directional object
 * and an undirected one drawn pointing north is a fabricated orientation, so
 * the caller filters on a published heading before calling.
 * @param {{loaM: number, beamM: number, toBowM?: number|null, toPortM?: number|null}} hull
 * @param {number} headingDeg Direction of travel, degrees clockwise from north.
 * @returns {Array<[number, number]>|null} `[east, north]` offsets (m), or null.
 */
export function hullOutlineOffsetsM(hull, headingDeg) {
  const loaM = Number(hull?.loaM);
  const beamM = Number(hull?.beamM);
  if (!(loaM > 0) || !(beamM > 0) || !Number.isFinite(headingDeg)) return null;

  const toBow = Number.isFinite(hull?.toBowM) && hull.toBowM > 0 && hull.toBowM <= loaM
    ? hull.toBowM
    : loaM / 2;
  const toStern = loaM - toBow;
  const toPort = Number.isFinite(hull?.toPortM) && hull.toPortM > 0 && hull.toPortM <= beamM
    ? hull.toPortM
    : beamM / 2;
  const toStarboard = beamM - toPort;

  // The bow taper is capped by the forward half so a hull whose antenna sits
  // near the bow never folds its shoulders behind its own stern.
  const shoulder = Math.max(-toStern, toBow - HULL_BOW_TAPER * loaM);
  const ship = [
    [0, toBow],
    [toStarboard, shoulder],
    [toStarboard, -toStern],
    [-toPort, -toStern],
    [-toPort, shoulder],
  ];

  const rad = (headingDeg * Math.PI) / 180;
  const sin = Math.sin(rad);
  const cos = Math.cos(rad);
  // Clockwise-from-north heading into the ENU tangent frame: north is +y,
  // east is +x, and a heading of 90° must put the bow due east.
  return ship.map(([x, y]) => [x * cos + y * sin, -x * sin + y * cos]);
}

// ---------------------------------------------------------------------------
// Glyphs and the legend — a size without a scale is unreadable (D1)
// ---------------------------------------------------------------------------

const _b64 = (text) => (typeof btoa === 'function'
  ? btoa(text)
  : Buffer.from(text, 'utf8').toString('base64'));

/** @type {Map<string, string>} cache key → data URI. */
const _vesselGlyphCache = new Map();

const GLYPH_VIEW_BOX = 16;
/** The shipped chevron path, in a 32-unit box centred on the origin. */
const CHEVRON_PATH = 'M0,-14 L11,10 L4,7 L0,14 L-4,7 L-11,10 Z';

/**
 * A legend swatch shaped like the chevron actually drawn, at the size actually
 * drawn, relative to the widest mark on the ramp.
 *
 * The host masks the swatch with this glyph (`manager.js:2460`), so only the
 * shape survives and the row's declared colour is what the reader sees. That is
 * what lets one legend row be simultaneously the colour key and the size key
 * without either channel borrowing the other's meaning.
 * @param {number} fraction Rendered edge as a fraction of the largest mark, 0..1.
 * @param {boolean} [hollow=false] Draw the outline only (dimensions unpublished).
 * @returns {string} `data:image/svg+xml;base64,…`
 */
export function vesselChevronGlyph(fraction, hollow = false) {
  const clamped = Number.isFinite(fraction) ? Math.min(1, Math.max(0.08, fraction)) : 0.08;
  const key = `chev:${clamped.toFixed(3)}:${hollow ? 'hollow' : 'solid'}`;
  const cached = _vesselGlyphCache.get(key);
  if (cached) return cached;
  // The chevron art is 28 units tall inside its 32-unit box; the glyph box is
  // 16, so a full-size mark occupies 16/28 of the path's own scale.
  const scale = (clamped * GLYPH_VIEW_BOX) / 28;
  const body = hollow
    ? `<path d="${CHEVRON_PATH}" fill="none" stroke="#000" stroke-width="${(2.6 / Math.max(0.2, scale)).toFixed(2)}"`
      + ` stroke-dasharray="${VESSEL_UNMEASURED_DASH}" stroke-linejoin="round"/>`
    : `<path d="${CHEVRON_PATH}" fill="#000"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GLYPH_VIEW_BOX} ${GLYPH_VIEW_BOX}">`
    + `<g transform="translate(8,8) scale(${scale.toFixed(4)})">${body}</g>`
    + '</svg>';
  const uri = `data:image/svg+xml;base64,${_b64(svg)}`;
  _vesselGlyphCache.set(key, uri);
  return uri;
}

/** A hull footprint, for the legend row that announces the world-unit regime. */
export function vesselHullGlyph() {
  const cached = _vesselGlyphCache.get('hull');
  if (cached) return cached;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GLYPH_VIEW_BOX} ${GLYPH_VIEW_BOX}">`
    + '<path d="M8 1 L11 5 L11 15 L5 15 L5 5 Z" fill="#000"/>'
    + '</svg>';
  const uri = `data:image/svg+xml;base64,${_b64(svg)}`;
  _vesselGlyphCache.set('hull', uri);
  return uri;
}

/** Swatch colour of the size rows — one constant hue, because the datum is SIZE. */
export const VESSEL_SIZE_SWATCH_COLOR = '#c3ccd8';

/** Frozen, published marks of the size scale (m). Three, per D1. */
export const VESSEL_SIZE_TICKS_M = Object.freeze([30, 100, 300]);

/** French thousands separator, matching the other layers' legends. */
const fr = (value) => new Intl.NumberFormat('fr-FR').format(Math.round(value));

/**
 * The size key: three numbered marks, the unmeasured mark, and the two
 * declarations rules A5 and A1 require.
 *
 * @param {Object} tally Counts from the render pass.
 * @param {number} tally.measured Contacts whose length overall is published.
 * @param {number} tally.unmeasured Contacts drawn with the hollow dashed mark.
 * @param {number} [tally.clampedBelow] Measured hulls shorter than the ramp floor.
 * @param {number} [tally.clampedAbove] Measured hulls longer than the ramp ceiling.
 * @param {number} [tally.hullsDrawn] True-scale hulls currently in the scene.
 * @param {number} [tally.hullEligible] Hulls that qualified before the cap.
 * @param {number} [tally.hullNoHeading] Measured hulls refused for want of a heading.
 * @param {number} [tally.hullAltitudeM] Altitude below which hulls draw.
 * @param {boolean} [tally.hullActive] Whether the camera is under that altitude.
 * @returns {Array<Object>} Legend entries.
 */
export function vesselSizeLegend(tally = {}) {
  const entries = [];
  const largestPx = vesselArrowPx(VESSEL_SIZE_TICKS_M[VESSEL_SIZE_TICKS_M.length - 1]) || 1;

  entries.push({
    label: 'Taille — longueur hors-tout (AIS message 5 / 24B)',
    color: null,
    blurb: 'L’aire de la flèche est proportionnelle à la longueur : une flèche deux fois '
      + 'plus large annonce quatre fois la longueur, pas deux. Taille en pixels constants, '
      + 'jamais composée avec la distance — sur un globe c’est la profondeur qui prend '
      + 'déjà l’échelle écran.',
  });

  for (const tick of VESSEL_SIZE_TICKS_M) {
    const px = vesselArrowPx(tick) || 0;
    entries.push({
      label: `${fr(tick)} m`,
      color: VESSEL_SIZE_SWATCH_COLOR,
      glyph: vesselChevronGlyph(px / largestPx),
      blurb: `${Math.round(px)} px à l’écran.`,
    });
  }

  if (tally.unmeasured) {
    entries.push({
      label: 'dimensions non reportées',
      color: VESSEL_SIZE_SWATCH_COLOR,
      glyph: vesselChevronGlyph(0.62, true),
      count: tally.unmeasured,
      blurb: 'Flèche creuse et tiretée, à taille fixe hors de l’échelle : le transpondeur '
        + 'n’a rien publié. Quatre contacts sur cinq sont dans ce cas (16 à 18 % '
        + 'seulement publient leurs dimensions, mesuré sur le flux mondial et sur '
        + 'l’emprise France le 2026-09-03) — leur donner une taille par défaut '
        + 'reviendrait à inventer la taille de la carte.',
    });
  }

  if (tally.clampedBelow) {
    entries.push({
      label: `moins de ${VESSEL_ARROW_MIN_LOA_M} m`,
      color: VESSEL_SIZE_SWATCH_COLOR,
      glyph: vesselChevronGlyph((vesselArrowPx(VESSEL_ARROW_MIN_LOA_M) || 0) / largestPx),
      count: tally.clampedBelow,
      blurb: `Dessinés au plancher de l’échelle : en dessous la flèche passerait sous `
        + `9 px et cesserait d’être cliquable. La marque ne compte plus, elle situe.`,
    });
  }

  if (tally.clampedAbove) {
    entries.push({
      label: `plus de ${fr(VESSEL_ARROW_MAX_LOA_M)} m`,
      color: VESSEL_SIZE_SWATCH_COLOR,
      glyph: vesselChevronGlyph(1),
      count: tally.clampedAbove,
      blurb: 'Dessinés au plafond de l’échelle. Aucun navire construit n’atteint cette '
        + 'longueur : une valeur ici est presque sûrement un champ AIS mal renseigné.',
    });
  }

  const hullAltKm = Number.isFinite(tally.hullAltitudeM)
    ? Math.round(tally.hullAltitudeM / 100) / 10
    : null;
  if (hullAltKm !== null) {
    const eligible = Number(tally.hullEligible) || 0;
    const drawn = Number(tally.hullsDrawn) || 0;
    const clipped = Math.max(0, eligible - drawn);
    entries.push({
      label: tally.hullActive
        ? `Coques à l’échelle réelle — ${fr(drawn)} / ${fr(eligible)}`
        : `Coques à l’échelle réelle sous ${hullAltKm} km`,
      color: VESSEL_SIZE_SWATCH_COLOR,
      glyph: vesselHullGlyph(),
      blurb: tally.hullActive
        ? `Sous ${hullAltKm} km d’altitude, un navire mesuré est dessiné à sa longueur et `
          + `à sa largeur réelles, coque orientée au cap — en unités monde, donc il `
          + `rapetisse avec la distance comme le fait l’objet physique. `
          + (clipped
            ? `${fr(clipped)} coques éligibles ne sont pas dessinées : le plafond est de `
              + `${fr(HULL_RENDER_CAP)}, les plus proches de la caméra d’abord.`
            : `Plafond ${fr(HULL_RENDER_CAP)} coques, non atteint ici.`)
        : `Descendre sous ${hullAltKm} km d’altitude pour voir les coques mesurées à leur `
          + `taille réelle. Au-dessus, une coque de 200 m tomberait sous 10 px et ne dirait `
          + `plus rien : c’est la flèche qui porte la longueur.`,
    });
  }

  if (tally.hullNoHeading) {
    entries.push({
      label: 'cap non reporté — pas de coque',
      color: null,
      count: tally.hullNoHeading,
      blurb: 'Dimensions publiées mais ni cap vrai ni route sur le fond : une coque '
        + 'orientée au nord par défaut affirmerait une orientation que personne n’a '
        + 'mesurée. Seule la flèche est dessinée.',
    });
  }

  return entries;
}
