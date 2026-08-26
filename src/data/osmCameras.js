/**
 * @module osmCameras
 *
 * Pure OpenStreetMap -> CCTV-source mapping for the opt-in **OSM mapped
 * cameras** source (bbox proxy in `vite.config.js`, viewport merge in
 * `cctv.js`, gated on `CCTV_OSM_CAMERAS_ENABLED=1`).
 *
 * What this dataset IS: the mapped POSITIONS and pose tags of publicly mapped
 * outdoor surveillance cameras (`man_made=surveillance`) — 563k worldwide,
 * 76k of them in France — © OpenStreetMap contributors under ODbL 1.0. It is
 * loaded for the VIEWPORT the operator is actually looking at (plus a snapped
 * margin), never as a country-wide download.
 *
 * What it is NOT: a feed. OSM records where a camera is, never what it sees, so
 * every camera in this pack is registered with NO upstream URL and resolves
 * through the CCTV proxy's existing honest fallback chain — a Street View frame
 * (health `degraded` / `SRC STREETVIEW`) or the synthetic
 * `NO UPSTREAM CONFIGURED` placeholder. That is also why the pack is opt-in:
 * a feedless camera bills a Street View request on every ambient card refresh.
 *
 * What the tags DO carry, and what they don't (taginfo, 2026-08-26): the
 * horizontal bearing (`camera:direction`, ~141k uses worldwide) and the tilt from
 * the horizon (`camera:angle`, ~16k) are real mapped values and are used as-is.
 * The horizontal APERTURE is not: `camera:fov` has ~61 uses worldwide, so the
 * cone width almost always comes from a `camera:type` prior here. Every value
 * without a tag behind it is a MODELED PRIOR (down to a deterministic id-hash
 * heading), not survey truth: these cameras stay `RAW PRIOR` in the CAL badge
 * until a human calibrates them, exactly like the Austin/Caltrans/TfL packs.
 *
 * Dependency-free and side-effect-free so the tag mapping is unit-testable
 * without a Vite server — same shape as `directionText.js`.
 */
import { directionToHeading } from './directionText.js';

/** `sourceKind` stamped on every camera from this source (client + health label). */
export const OSM_CAMERA_SOURCE_KIND = 'osm-camera';
/** ODbL attribution string carried on each source row (see DATA_SOURCES.md). */
export const OSM_CAMERA_LICENSE = '© OpenStreetMap contributors (ODbL 1.0)';
/** Provider label used when a camera carries no `operator` tag. */
export const OSM_CAMERA_PROVIDER = 'OpenStreetMap contributors';
/** Camera-id prefix; `osm-n1234` (node), `osm-w1234` (way centroid). */
export const OSM_CAMERA_ID_PREFIX = 'osm-';

/**
 * `surveillance=*` values kept by this pack. Public/outdoor/traffic cameras are
 * the publicly-relevant subset the product is about; everything else (indoor,
 * untagged, private premises) is deliberately excluded rather than presented as
 * a public camera.
 */
export const OSM_PUBLIC_SURVEILLANCE_VALUES = Object.freeze(['public', 'outdoor', 'traffic']);

/** `surveillance:type=*` values kept. ALPR/guard posts are not cameras-with-a-view. */
const KEPT_SURVEILLANCE_TYPES = new Set(['camera', '']);

/** Upper sanity bound on a parsed `height` (m) — matches the client mount clamp. */
export const OSM_MAX_MOUNT_HEIGHT_M = 120;

/** 16-point compass abbreviations, the legal non-numeric form of `direction`. */
const COMPASS_16 = Object.freeze({
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5,
  E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5,
  W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
});

/**
 * Largest viewport this source will answer, in degrees. Mapped cameras are a
 * street-scale dataset: a request wider than this is a continental view where
 * per-camera icons mean nothing and the element cap would truncate arbitrarily.
 */
export const OSM_CAMERA_MAX_BOX_DEG = 2;
/**
 * Outward snap grid (~2.2 km). This is the "load a bit more than what is on
 * screen" margin: neighbouring viewports quantize onto the SAME box, so panning
 * a few streets re-uses the cached answer instead of hitting Overpass, and the
 * snap only ever GROWS the box so a cached answer is always a superset of what
 * was asked for. Same technique as the mapped-installation proxy, at a tighter
 * step because cameras are looked at from closer in.
 */
export const OSM_CAMERA_BOX_STEP_DEG = 0.02;
/** Per-request `out body` element cap. */
export const OSM_CAMERA_QUERY_CAP = 400;
/** Overpass `[timeout:]` for one bbox probe (seconds). */
export const OSM_CAMERA_QUERY_TIMEOUT_SEC = 15;

/**
 * Snap a request box OUTWARD onto the shared cache grid.
 *
 * Rounding the ratio first matters: 2.2999.../0.02 lands a hair under an exact
 * grid line in binary floating point, which would snap a whole cell too far.
 *
 * @param {{south:number, west:number, north:number, east:number}} box
 * @param {number} [stepDeg]
 * @returns {{south:number, west:number, north:number, east:number}}
 */
export function snapOsmCameraBox(box, stepDeg = OSM_CAMERA_BOX_STEP_DEG) {
  const snap = (value, grow) => {
    const cells = Number((value / stepDeg).toFixed(9));
    return Number(((grow > 0 ? Math.ceil(cells) : Math.floor(cells)) * stepDeg).toFixed(6));
  };
  return {
    south: Math.max(-90, snap(box.south, -1)),
    west: Math.max(-180, snap(box.west, -1)),
    north: Math.min(90, snap(box.north, 1)),
    east: Math.min(180, snap(box.east, 1)),
  };
}

/**
 * Validate a camera bbox: finite, ordered, non-dateline, and no wider than
 * OSM_CAMERA_MAX_BOX_DEG on either axis.
 *
 * @param {{south:*, west:*, north:*, east:*}} box
 * @returns {?{south:number, west:number, north:number, east:number}} Null if unusable.
 */
export function validOsmCameraBox(box) {
  const south = Number(box?.south);
  const west = Number(box?.west);
  const north = Number(box?.north);
  const east = Number(box?.east);
  if (![south, west, north, east].every(Number.isFinite)) return null;
  if (south < -90 || north > 90 || west < -180 || east > 180) return null;
  if (south >= north || west >= east) return null;
  if (north - south > OSM_CAMERA_MAX_BOX_DEG || east - west > OSM_CAMERA_MAX_BOX_DEG) return null;
  return { south, west, north, east };
}

/** Stable cache key for a camera bbox, at the precision the query itself uses. */
export function osmCameraBoxKey(box, decimals = 3) {
  return [box.south, box.west, box.north, box.east]
    .map((value) => Number(value).toFixed(decimals))
    .join(',');
}

/**
 * Parse an OSM direction value to a compass heading.
 *
 * Accepts the three legal forms in tag order of reliability: a numeric bearing
 * ("135", "22.5"), a 16-point abbreviation ("NNE"), then a spelled-out cardinal
 * via the shared direction parser. Way-relative values (`forward`/`backward`)
 * are meaningless for a standalone camera node and resolve to NaN.
 *
 * @param {*} value - Raw tag value.
 * @returns {number} Heading in degrees [0..360), or NaN if unresolvable.
 */
export function parseOsmDirection(value) {
  const text = String(value ?? '').trim();
  if (!text) return NaN;
  if (/^[+-]?\d+(?:\.\d+)?$/.test(text)) {
    const deg = Number(text);
    return Number.isFinite(deg) ? ((deg % 360) + 360) % 360 : NaN;
  }
  const abbreviated = COMPASS_16[text.toUpperCase()];
  if (Number.isFinite(abbreviated)) return abbreviated;
  // Dedicated direction field → bare cardinals ("north") are real facings.
  return directionToHeading(text, true);
}

/**
 * Parse an OSM `height`-style value to metres.
 *
 * Handles the metric forms ("4", "4.5 m") and the imperial form OSM allows
 * ("12'", "12'6\""). Anything else — ranges, units we do not model, absurd
 * values — is NaN so the caller falls back to a mount-type prior rather than
 * placing a camera on a bad number.
 *
 * @param {*} value - Raw tag value.
 * @returns {number} Height in metres, or NaN.
 */
export function parseOsmHeightM(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return NaN;
  const imperial = text.match(/^(\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*")?$/);
  if (imperial) {
    const meters = (Number(imperial[1]) * 12 + Number(imperial[2] || 0)) * 0.0254;
    return meters > 0 && meters <= OSM_MAX_MOUNT_HEIGHT_M ? meters : NaN;
  }
  const metric = text.match(/^(\d+(?:\.\d+)?)\s*(?:m|meter|meters|metre|metres)?$/);
  if (!metric) return NaN;
  const meters = Number(metric[1]);
  return meters > 0 && meters <= OSM_MAX_MOUNT_HEIGHT_M ? meters : NaN;
}

/**
 * Mount-height priors (m) by `camera:mount`, used only when `height` is absent.
 * Values below the client's 6 m mount floor are still reported as mapped — the
 * clamp is the renderer's business, and understating a wall camera is honest
 * where inflating it to clear the floor would not be.
 */
const MOUNT_HEIGHT_PRIORS_M = Object.freeze({
  ceiling: 3,
  wall: 4,
  pole: 6,
  post: 6,
  street_lamp: 7,
  mast: 10,
  tower: 14,
});
/** Fallback mount height (m) when neither `height` nor `camera:mount` says anything. */
const DEFAULT_MOUNT_HEIGHT_M = 6;

/** Pitch clamp, matched to the client's own [-55, -2] mount-pitch range. */
const MIN_PITCH_DEG = -55;
const MAX_PITCH_DEG = -2;

/**
 * Optical priors by `camera:type`. `rangeM` sits at/above the client's 220 m
 * range floor on purpose — quoting a true 120 m street throw would be silently
 * clamped up anyway, so the pack states the geometry that will actually render.
 */
const CAMERA_TYPE_OPTICS = Object.freeze({
  dome: { fovDeg: 90, rangeM: 260 },
  panning: { fovDeg: 62, rangeM: 300 },
  fixed: { fovDeg: 48, rangeM: 220 },
});
const DEFAULT_OPTICS = CAMERA_TYPE_OPTICS.fixed;

/**
 * Derive a modeled camera pose from OSM tags.
 *
 * Heading confidence mirrors the other packs: a dedicated camera-direction field
 * is `high`, a generic `direction` (which often describes the MOUNT, not the
 * optics) is `medium`, and a tagless camera is `low` on the caller's
 * deterministic id-hash heading.
 *
 * @param {Record<string,string>} [tags] - OSM tags.
 * @param {object} [options]
 * @param {number} [options.fallbackHeadingDeg] - Deterministic heading used when
 *   no direction tag resolves.
 * @returns {{headingDeg:number, headingConfidence:'high'|'medium'|'low',
 *   fovDeg:number, rangeM:number, pitchDeg:number, mountHeightM:number}}
 */
export function osmCameraPose(tags = {}, { fallbackHeadingDeg = 0 } = {}) {
  // Multi-direction cameras are mapped as a `;` list ("270;170" — live-sampled
  // in central Paris, 2026-08-26). One frustum cannot show two facings, so the
  // pack renders the FIRST value and demotes the confidence: the tag is real,
  // the single heading drawn from it is only part of the story.
  const cameraDirectionRaw = String(tags['camera:direction'] ?? '');
  const cameraIsMultiValue = cameraDirectionRaw.includes(';');
  const cameraDirection = parseOsmDirection(cameraDirectionRaw.split(';')[0]);
  const genericDirection = parseOsmDirection(String(tags.direction ?? '').split(';')[0]);
  let headingDeg = Number(fallbackHeadingDeg);
  let headingConfidence = 'low';
  if (Number.isFinite(cameraDirection)) {
    headingDeg = cameraDirection;
    headingConfidence = cameraIsMultiValue ? 'medium' : 'high';
  } else if (Number.isFinite(genericDirection)) {
    headingDeg = genericDirection;
    headingConfidence = 'medium';
  }
  if (!Number.isFinite(headingDeg)) headingDeg = 0;

  const mount = String(tags['camera:mount'] || '').trim().toLowerCase();
  const taggedHeight = parseOsmHeightM(tags.height ?? tags['camera:height']);
  const mountHeightM = Number.isFinite(taggedHeight)
    ? taggedHeight
    : (MOUNT_HEIGHT_PRIORS_M[mount] ?? DEFAULT_MOUNT_HEIGHT_M);

  const optics = CAMERA_TYPE_OPTICS[String(tags['camera:type'] || '').trim().toLowerCase()]
    || DEFAULT_OPTICS;
  // `camera:fov` is a real aperture when mapped, but it is vanishingly rare
  // (61 uses worldwide, taginfo 2026-08-26) — so it is honoured when present
  // and the camera:type prior carries every other camera.
  const taggedFov = Number(tags['camera:fov']);
  const fovDeg = Number.isFinite(taggedFov) && taggedFov >= 20 && taggedFov <= 125
    ? taggedFov
    : optics.fovDeg;

  // `camera:angle` is the mapped TILT from the horizon plane (OSM wiki), which
  // is exactly this pack's pitch — mapped data beats a prior. Its sign is not
  // consistently tagged and the renderer only draws downward-looking cameras,
  // so the magnitude is taken and clamped to the client's own pitch range.
  const taggedTilt = Number(tags['camera:angle']);
  const pitchDeg = Number.isFinite(taggedTilt)
    ? Math.min(MAX_PITCH_DEG, Math.max(MIN_PITCH_DEG, -Math.abs(taggedTilt)))
    // No tilt tag: higher mounts look further down. Three coarse steps rather
    // than a fabricated formula — a starting pose for the gizmo, not a measurement.
    : (mountHeightM >= 15 ? -32 : (mountHeightM >= 8 ? -26 : -20));

  return {
    headingDeg,
    headingConfidence,
    fovDeg,
    rangeM: optics.rangeM,
    pitchDeg,
    mountHeightM,
  };
}

/**
 * Whether an OSM element is a publicly mapped outdoor surveillance camera.
 *
 * @param {object} element - Overpass element.
 * @returns {boolean}
 */
export function isPublicOsmCamera(element) {
  const tags = element?.tags;
  if (!tags || typeof tags !== 'object') return false;
  if (String(tags.man_made || '').toLowerCase() !== 'surveillance') return false;
  if (!OSM_PUBLIC_SURVEILLANCE_VALUES.includes(String(tags.surveillance || '').toLowerCase())) return false;
  if (!KEPT_SURVEILLANCE_TYPES.has(String(tags['surveillance:type'] || '').toLowerCase())) return false;
  if (String(tags.indoor || '').toLowerCase() === 'yes') return false;
  return true;
}

/**
 * Human-readable camera label. OSM camera nodes are usually unnamed, so the
 * label degrades: `name` → `<operator> camera` → a stable id-derived label. The
 * city name travels in its own field, so the label never fakes a street address.
 *
 * @param {Record<string,string>} tags
 * @param {string} shortId - Element id without the pack prefix.
 * @returns {string}
 */
export function osmCameraLabel(tags = {}, shortId = '') {
  const name = String(tags.name || '').trim();
  if (name) return name;
  const operator = String(tags.operator || '').trim();
  if (operator) return `${operator} camera`;
  const ref = String(tags.ref || '').trim();
  return `Surveillance camera ${ref || shortId}`;
}

/**
 * Map one Overpass element to a CCTV source row.
 *
 * Returns null for anything that is not a public outdoor camera with usable
 * coordinates — a rejected element is dropped, never coerced.
 *
 * Locality is deliberately NOT invented here: a viewport-loaded camera has no
 * metro anchor, so `city`/`cityId` are left to the caller (the client resolves
 * a known city by name when there is one, and shows "Global" otherwise) and
 * `groundElevationM` stays 0 — the Re:Earth ellipsoidal ground prior the CCTV
 * layer resolves per camera is the real datum, not a hand-written city guess.
 *
 * @param {object} element - Overpass element (node, or way/relation with `center`).
 * @param {object} [options]
 * @param {(cameraId:string)=>number} [options.fallbackHeading] - Deterministic
 *   heading source for cameras with no direction tag.
 * @param {string} [options.city] - Optional locality label.
 * @param {string} [options.cityId] - Optional locality id.
 * @returns {?object} Normalized source row, or null.
 */
export function osmCameraFromElement(element, { fallbackHeading = null, city = '', cityId = '' } = {}) {
  if (!isPublicOsmCamera(element)) return null;
  const lat = Number(element.lat ?? element.center?.lat);
  const lon = Number(element.lon ?? element.center?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const osmId = Number(element.id);
  if (!Number.isFinite(osmId)) return null;

  const typeLetter = String(element.type || 'node').trim().toLowerCase().charAt(0) || 'n';
  const shortId = `${typeLetter}${osmId}`;
  const cameraId = `${OSM_CAMERA_ID_PREFIX}${shortId}`;
  const tags = element.tags;
  const pose = osmCameraPose(tags, {
    fallbackHeadingDeg: typeof fallbackHeading === 'function' ? fallbackHeading(cameraId) : 0,
  });
  const operator = String(tags.operator || '').trim();

  return {
    id: cameraId,
    name: osmCameraLabel(tags, shortId),
    city: String(city || ''),
    cityId: String(cityId || ''),
    provider: operator ? `${operator} (OpenStreetMap)` : OSM_CAMERA_PROVIDER,
    lat,
    lon,
    headingDeg: pose.headingDeg,
    headingConfidence: pose.headingConfidence,
    pitchDeg: pose.pitchDeg,
    fovDeg: pose.fovDeg,
    rangeM: pose.rangeM,
    mountHeightM: pose.mountHeightM,
    groundElevationM: 0,
    feedType: 'image',
    // No feed by design: OSM maps camera POSITIONS, never their imagery. The
    // proxy's fallback chain labels this honestly (Street View / NO UPSTREAM
    // CONFIGURED) instead of implying a live view.
    url: '',
    snapshotUrl: '',
    sourceKind: OSM_CAMERA_SOURCE_KIND,
    license: OSM_CAMERA_LICENSE,
  };
}

/**
 * Build the Overpass QL probe for one viewport box.
 *
 * One bounded bbox per request (never an area/country scan), capped output,
 * clamped timeout — the same discipline the client-facing Overpass proxy
 * enforces on app queries. The `surveillance:type` filter is negative on
 * purpose: in Overpass `!~` also matches a MISSING key, so untagged cameras
 * survive while ALPR/guard posts are dropped upstream instead of downloaded
 * and discarded here.
 *
 * @param {{south:number, west:number, north:number, east:number}} box
 * @param {object} [options]
 * @param {number} [options.elementCap]
 * @param {number} [options.timeoutSec]
 * @returns {string} Overpass QL.
 */
export function osmCameraBboxQuery(box, {
  elementCap = OSM_CAMERA_QUERY_CAP,
  timeoutSec = OSM_CAMERA_QUERY_TIMEOUT_SEC,
} = {}) {
  const cap = Math.max(1, Math.min(1000, Math.floor(elementCap)));
  const timeout = Math.max(5, Math.min(30, Math.floor(timeoutSec)));
  const surveillance = OSM_PUBLIC_SURVEILLANCE_VALUES.join('|');
  const bbox = [box.south, box.west, box.north, box.east]
    .map((value) => Number(value).toFixed(6))
    .join(',');
  // `out body` (not `out tags`) — nodes must carry their coordinates.
  return `[out:json][timeout:${timeout}];`
    + `node["man_made"="surveillance"]["surveillance"~"^(${surveillance})$"]`
    + `["surveillance:type"!~"^(ALPR|guard)$"]`
    + `(${bbox});`
    + `out body ${cap};`;
}
