import * as Cesium from 'cesium';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { publishJoin } from './layerJoins.js';
// The prism module is pure arithmetic and strings; only its legend primitives
// are borrowed here. `prismHeightGlyph` draws the bar swatch, and the graphite
// is deliberately one constant colour so the stem rows cannot smuggle in a
// second encoding (A3) — the hue rows below them are where colour means
// something. Nothing else about a départemental prism applies to a buoy: no
// base polygon, no rate fill.
import {
  PRISM_HEIGHT_SWATCH_COLOR,
  prismHeightGlyph,
} from './choroplethPrism.js';
// The far-side cull. `horizonOccluder()` is the same shared occluder twelve
// other depth-test-free layers use; `boxContains`/`padBox` are the shared
// lat/lon box primitives, so "is this station on screen" is answered by the
// arithmetic every viewport-driven layer already agrees on.
import { horizonOccluder } from './iconOrientation.js';
import { boxContains, padBox } from './viewportBox.js';
import { claimCameraSensitivity, releaseCameraSensitivity } from './cameraSensitivity.js';
import { ensureGeoidReady, geoidHeight } from './geoid.js';

/**
 * NOAA NDBC marine observation buoys — latest report per station.
 *
 * Fetched live through the keyless `/api/ndbc` proxy (10-minute TTL, disk
 * cache, serve-stale). Stations are FIXED points, so unlike vessels or
 * aircraft nothing here interpolates or animates: a poll replaces values in
 * place and the render governor is only nudged on that discrete change.
 *
 * NOAA IS THE OPERATOR, NOT THE EXTENT
 * ------------------------------------
 * `latest_obs` republishes international partner moorings beside NOAA's own,
 * so this layer is not a map of American waters. Counted on the 2026-09-01
 * report: 882 stations, 38 in the eastern hemisphere — 28 in the North Sea
 * and north-east Atlantic, 19 in the western Pacific, 2 in the Indian Ocean.
 * The network is DENSEST over the Americas, which the map shows for itself;
 * that density is why the layer used to carry a `US` scope chip, and why it
 * no longer does — see the `marine-buoys` entry in `layerTaxonomy.js`.
 *
 * WHY MOST BUOYS SHOW NO WAVE HEIGHT
 * ----------------------------------
 * The network is not homogeneous. Measured over the full 892-station report on
 * 2026-08-26: 21% carry wave height, 57% sea temperature, 72% wind. Only 533
 * of 892 report wave height OR sea temperature at all. A station with no wave
 * sensor is not a station reporting a flat sea, so a missing value renders as
 * an omitted line — never as `0.0 m` and never as `—` styled like a reading.
 * The layer's status line carries the measured/total split so the sparseness
 * is visible rather than inferred from gaps. Re-counted on the 2026-09-03
 * report: 266 of 898 (30%) carry wave height. The coverage MOVES, which is why
 * neither the tally nor the legend below is hard-coded from one day's count.
 *
 * COLOR ENCODES SEA STATE, AND ONLY WHERE SEA STATE IS KNOWN
 * ----------------------------------------------------------
 * Buoys reporting wave height are colored on the WMO sea-state ladder. Buoys
 * that report nothing marine stay neutral grey: coloring them by their air
 * temperature or wind would imply a sea reading they never took.
 *
 * HEIGHT ENCODES THE SWELL — IN WORLD UNITS, NOT IN PIXELS
 * --------------------------------------------------------
 * Significant wave height is the reason anyone looks at a buoy, it is a
 * continuous physical LENGTH in metres, and it used to be locked inside a
 * nine-step hue. It now also drives a vertical STEM rising from the station.
 *
 * B2 allows a quantity on a globe through exactly two channels: constant
 * screen pixels, or world units. This layer takes WORLD UNITS.
 *
 *  1. Hs *is* a length. A stem in metres is that same length magnified, which
 *     is what lets the exaggeration be inverted by eye — "30 km of stem,
 *     therefore 3 m of swell". A bar measured in pixels supports no such
 *     sentence; it is a chart glued to the sea.
 *  2. Nothing here composes with a `scaleByDistance` — the layer has none, and
 *     the dot's `pixelSize` is now CONSTANT (see the next section), so the two
 *     size channels cannot multiply into the inversion B2 warns about. A stem
 *     that shrinks with distance shrinks because it is far away, not because
 *     its value fell, and that is the reading a relief map wants.
 *  3. 266 constant-pixel bars over the western Atlantic would fuse into a
 *     picket fence at every zoom. World-unit stems thin out with the view.
 *
 * THE EXAGGERATION, AND WHERE IT IS PUBLISHED
 * -------------------------------------------
 * ×10 000 — one metre of swell draws ten kilometres of stem. At true scale an
 * 8 m sea on a 6 371 km globe is 1.3 millionths of the radius, i.e. nothing;
 * so the factor is a READING SCALE rather than a measurement, and it is
 * LINEAR, so a stem twice as tall is twice the swell.
 *
 * THE FACTOR IS ON THE GLOBE; THE ARGUMENT FOR IT IS HERE. `CARTOGRAPHIE.md`
 * F7(a) is P0 and requires the REGISTER to be named in the legend in full
 * words, so the stem row reads "Échelle de lecture, pas une hauteur réelle :
 * 1 m de houle dessine 10 km de tige" — fourteen words. What went is the
 * hundred that followed it, and the three ruler marks and the floor row below:
 * 99 words teaching an inversion no reader performs, because the card on the
 * buoy already prints `1.0 m` and the cohort that gets a card is sorted by Hs
 * (`selectBuoyOverlayCohort`). What the stem carries on screen is the relief
 * and the order; why the scale is shaped this way is for whoever changes it.
 * Apparent heights,
 * computed with `choroplethPrism.prismApparentPx()` (viewport 1000 px, aspect
 * 1.6, fov π/3), for a stem seen side-on:
 *
 *     camera →     200 km   500 km   1 500 km   3 000 km   8 000 km
 *     Hs  8 m      570 px   231 px      77 px      38 px      14 px
 *     Hs  2 m      144 px    58 px      19 px      10 px       4 px
 *     Hs  0.8 m     58 px    23 px       8 px       4 px       1 px
 *
 * Linear was preferred to the sqrt mode `choroplethPrism.js` offers, and the
 * price is stated rather than hidden. On the report of 2026-09-03 — 898
 * stations, 266 with a wave sensor, median Hs 0.8 m, tallest 4.1 m — most
 * stems are under 10 px at ocean-basin range and the map looks flat. THE SEA
 * WAS FLAT. A scale that made a calm day look eventful would be the defect.
 * The same scale puts a Biscay storm at 8 m on 80 km of stem, readable from
 * 3 000 km out, which is the whole point of the channel.
 *
 * The stem does NOT disable the depth test, unlike the dot above it. A relief
 * has to be hidden by the Earth's limb, or a Pacific swell would draw across
 * Europe. The dot keeps `disableDepthTestDistance` because a station marker is
 * a locator, not a relief — two marks, two policies, on purpose.
 *
 * WHY THE BUOYS LOOKED LIKE THEY DRIFTED, AND WHAT ACTUALLY MOVES
 * --------------------------------------------------------------
 * Field report, 2026-09-03: the buoys "drift and cross the globe". Nothing
 * here animates — positions come from one `Cartesian3.fromDegrees` per poll,
 * the parser is positionally correct, and no property is a callback. The
 * motion was an ASYMMETRY between the layer's three marks, all on the same
 * station: the dot ignored depth AND was never culled, so a Pacific station
 * painted straight through the planet; its own stem was depth-tested and so
 * disappeared behind the limb; and its card was already horizon-culled by the
 * overlay host (`horizonCull: true`). A dot with no stem and no card, sliding
 * across the disc of the globe as the camera turned, is what "drift" was.
 *
 * THE FIX IS THE CULL, NOT THE DEPTH TEST. The dot keeps
 * `disableDepthTestDistance: POSITIVE_INFINITY`, and the far side is removed
 * by an `EllipsoidalOccluder` instead — the settled convention of this repo,
 * reached twice from bug reports. `flights.js` states it at
 * `_groundDepthDistance()` ("far-side planes are still removed by the fleet
 * tick's horizon occluder, which never depended on depth") and
 * `aisLiveVessels.js` states it again at its billboard ("the tile sea mesh is
 * not the geoid exactly, so a depth-tested chevron at the geoid still clips
 * out behind local tide/mesh noise"). A finite depth distance here would buy
 * the same far-side hiding at the price of buoys that blink out over photoreal
 * water, and would not help at all when Google 3D tiles own the planet and
 * nothing writes far-side depth.
 *
 * WHAT IS DRAWN IS WHAT IS IN FRAME
 * ---------------------------------
 * Beyond the limb test, a station outside the camera's own view rectangle is
 * hidden too, and the card cohort is re-picked from the survivors. Both marks
 * and the card now agree on one visibility for one station, which is the
 * property that was missing. The pass runs on `camera.changed` at the shared
 * 5 % sensitivity (`cameraSensitivity.js`, ref-counted — this layer claims and
 * releases like the other eleven), costs one occluder test and one box test
 * per station over ~900 stations, and republishes cards ONLY when some
 * station's visibility actually flipped.
 *
 * A station's position is on the SEA SURFACE — the geoid, `h = N` — not on the
 * ellipsoid. `heightReference: NONE` was pinning every dot to h = 0 while the
 * EGM96 undulation runs -106..+85 m; the AIS layer already anchors its vessels
 * this way, and two maritime layers disagreeing about where the sea is would
 * show as buoys floating above or under the ships beside them.
 *
 * A1 · NO SENSOR MEANS NO STEM, AND THE DOT SAYS SO TOO
 * ----------------------------------------------------
 * A station with no wave sensor gets NO STEM — not a stem of height zero. And
 * because a vertical mark has zero apparent length when viewed from directly
 * overhead, the absence cannot rest on the stem alone: the dot itself changes
 * SHAPE. A measured station is a filled disc on the WMO ladder; an unmeasured
 * one is a hollow grey ring (15 % fill, 2 px outline). Shape, not size, and a
 * ring survives the NVG and FLIR passes that flatten a tint (D3).
 *
 * A measured 0.0 m is the opposite case and is drawn as a measurement: it gets
 * the floor stem below, because a flat sea was observed. That pair — 0.0 m
 * with a stem, no-sensor with none — is A1 in one image.
 *
 * A3 · WHAT EACH CHANNEL CARRIED, AND WHAT IT CARRIES NOW
 * ------------------------------------------------------
 *   DOT SIZE   before: 9 px measured / 6 px unmeasured — the size channel,
 *              the only one Bertin gives to an absolute quantity, spent on a
 *              two-state qualitative flag.
 *              now:    CONSTANT for every station. It carries nothing.
 *   DOT SHAPE  before: nothing.
 *              now:    filled disc = wave sensor, hollow ring = none.
 *   HEIGHT     before: unused. `extrudedHeight`/vertical marks appeared in one
 *              data layer in the whole repo.
 *              now:    Hs in metres, ×10 000, linear, floored and clipped.
 *   HUE        before: the WMO sea-state class. Unchanged.
 *              now:    the WMO sea-state class. Unchanged.
 *
 * DECLARED REDUNDANCY: hue and height both carry Hs, and that is deliberate.
 * Two reasons, both specific to a globe. (a) A vertical stem seen from the
 * nadir has no apparent length at all — its projected length goes as the sine
 * of the angle between the stem and the view ray — so at top-down framing the
 * colour is the ONLY surviving reading. (b) They are not the same statement:
 * the height is the continuous metre value, the hue is the named WMO class a
 * mariner actually speaks ("mer forte"). The legend no longer says this out
 * loud — a reader who sees one colour per stem is not harmed by not being told
 * it is deliberate, and the sentence cost 83 words of the right-hand rail. It
 * is a claim about the DESIGN, addressed to whoever changes the design, so it
 * is stated here.
 *
 * A5 · THE FLOOR AND THE CEILING, BOTH COUNTED
 * --------------------------------------------
 * FLOOR — a stem shorter than 2 km is invisible at any useful range, so a
 * measured value below 0.2 m is drawn at 2 km and says "measured", not "how
 * much". The NDBC field is quantised to the decimetre, so the floor covers
 * exactly the 0.0 and 0.1 m readings: 24 of 266 wave stations on 2026-09-03
 * (9 %). It costs 1.4 % of the scale. The floor has NO legend row — it is a
 * 1.4 % distortion at the bottom of a channel whose whole job is the order of
 * the big values — but it is still counted, in `getStats().swell.floored`.
 * CEILING — the domain is frozen at 14 m, the top of the last NAMED band of
 * the WMO ladder, so the two channels clip at the same place for the same
 * published reason. Above it the stem stays at 140 km and switches to DASHES,
 * the repo's existing sign for "this attribute is not being asserted". That
 * one DOES keep a legend row, with a dashed swatch to match, because dashes on
 * a stem are a mark a reader can see and cannot decode — and the row appears
 * only when a station is actually clipped. The frozen bound is never
 * re-derived from a poll (C1): the same buoy is the same height in every
 * share link.
 *
 * PERF
 * ----
 * One entity per station, as before — the stem is a second graphic on the SAME
 * entity, so the entity count and the QA harness's station tally are unchanged.
 * Only the ~21–30 % of stations with a wave sensor get a polyline (266 of 898
 * on 2026-09-03), each two vertices with `arcType: NONE` so Cesium subdivides
 * nothing. Every property is a constant, so the stems are static geometry: no
 * per-frame callback, no `CallbackProperty`, nothing to re-evaluate between
 * the five-minute polls.
 */

const API_URL = '/api/ndbc';

export const BUOY_OVERLAY_SOURCE_ID = 'marine-buoys';
export const BUOY_OVERLAY_COHORT_LIMIT = 96;
export const BUOY_OVERLAY_COLLISION_CAPACITY = 48;

/** Poll cadence. The proxy TTL is 10 min; this only has to not lag it. */
const UPDATE_INTERVAL_MS = 5 * 60_000;

/** Owner id for the ref-counted `camera.percentageChanged` claim. */
const BUOY_LAYER_ID = 'marine-buoys';

/**
 * Margin added around the view rectangle before a station is called off-frame,
 * in degrees.
 *
 * The cull decides what is DRAWN, and the camera moves between two of its own
 * `changed` events. Without a margin a station entering from the edge would
 * pop in one whole camera step late. Two degrees is ~220 km — more than the
 * 5 % of view the shared sensitivity lets the camera travel unannounced at any
 * framing where a single buoy is still legible.
 */
export const BUOY_VIEW_PAD_DEG = 2;

/**
 * The lat/lon boxes the camera is looking at, padded, and split at the
 * antimeridian rather than left as one inverted box.
 *
 * Returns null when the rectangle is unusable — a camera pointed at space, or
 * a degenerate box. Null means NO frame restriction, not an empty frame: a
 * view that cannot be measured must not be mistaken for a view containing
 * nothing, and the horizon cull is still in force either way.
 *
 * A pad that would run off the end of the world is clamped by `padBox` rather
 * than wrapped around it. The margin is a courtesy against pop-in, not part of
 * the correctness of the test, so losing two degrees of it at the seam costs
 * one camera step of lead on stations that are about to be culled anyway.
 *
 * @param {?{south:number, west:number, north:number, east:number}} view Degrees; west > east means the view crosses the antimeridian.
 * @param {number} [padDeg]
 * @returns {?Array<{south:number, west:number, north:number, east:number}>}
 */
export function buoyViewBoxes(view, padDeg = BUOY_VIEW_PAD_DEG) {
  const south = Number(view?.south);
  const north = Number(view?.north);
  const west = Number(view?.west);
  const east = Number(view?.east);
  if (![south, west, north, east].every(Number.isFinite)) return null;
  if (south >= north) return null;
  if (south < -90 || north > 90 || west < -180 || east > 180) return null;
  const pad = Math.max(0, Number(padDeg) || 0);
  if (west > east) {
    // Crossing the seam: two boxes, each padded on its own. The inner edges
    // ARE the antimeridian, and `padBox` clamps them there, which is right.
    return [
      padBox({ south, west, north, east: 180 }, pad),
      padBox({ south, west: -180, north, east }, pad),
    ];
  }
  if (west === east) return null;
  return [padBox({ south, west, north, east }, pad)];
}

/**
 * Read {@link buoyViewBoxes} off a live camera.
 * @param {?object} viewer Cesium viewer.
 * @param {number} [padDeg]
 * @returns {?Array<{south:number, west:number, north:number, east:number}>}
 */
export function cameraBuoyBoxes(viewer, padDeg = BUOY_VIEW_PAD_DEG) {
  const rectangle = viewer?.camera?.computeViewRectangle?.();
  if (!rectangle) return null;
  return buoyViewBoxes({
    south: Cesium.Math.toDegrees(rectangle.south),
    west: Cesium.Math.toDegrees(rectangle.west),
    north: Cesium.Math.toDegrees(rectangle.north),
    east: Cesium.Math.toDegrees(rectangle.east),
  }, padDeg);
}

/**
 * Whether a station falls inside the frame.
 * A null box list is "the frame could not be measured" and admits everything;
 * see {@link buoyViewBoxes}.
 * @param {?Array<object>} boxes
 * @param {number} lat
 * @param {number} lon
 * @returns {boolean}
 */
export function buoyInView(boxes, lat, lon) {
  if (!boxes) return true;
  for (const box of boxes) {
    if (boxContains(box, lat, lon)) return true;
  }
  return false;
}

/**
 * The geoid lookup, as an injectable seam.
 *
 * A test that pins the STEM's exaggeration wants a flat datum, or it measures
 * two things at once; a test that pins the DATUM wants a known undulation.
 * Both are expressible here, and the default is the real EGM96 grid.
 */
const DEFAULT_GEOID = Object.freeze({
  ensureReady: ensureGeoidReady,
  heightAt: geoidHeight,
});

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});

/**
 * WMO sea-state bands by significant wave height (metres).
 * Boundaries follow the WMO sea-state code; the colors run calm→severe.
 * @type {ReadonlyArray<{maxM:number, label:string, css:string}>}
 */
export const SEA_STATE_BANDS = Object.freeze([
  Object.freeze({ maxM: 0.1, label: 'Calm', css: '#7fe7ff' }),
  Object.freeze({ maxM: 0.5, label: 'Smooth', css: '#4fd0e0' }),
  Object.freeze({ maxM: 1.25, label: 'Slight', css: '#3ec46f' }),
  Object.freeze({ maxM: 2.5, label: 'Moderate', css: '#d6d13a' }),
  Object.freeze({ maxM: 4, label: 'Rough', css: '#f0a33c' }),
  Object.freeze({ maxM: 6, label: 'Very rough', css: '#f2683c' }),
  Object.freeze({ maxM: 9, label: 'High', css: '#e5453f' }),
  Object.freeze({ maxM: 14, label: 'Very high', css: '#c62dab' }),
  Object.freeze({ maxM: Infinity, label: 'Phenomenal', css: '#9b5bff' }),
]);

/**
 * The same nine bands under their official French names.
 *
 * Not a translation of the English strings above — those are the WMO
 * sea-state code's own English terms, and these are its own French ones
 * ("mer forte", "mer grosse"), which is the vocabulary a French mariner
 * actually uses. Card copy stays in English with the rest of this module's
 * readouts; the LEGEND is French, like every other legend in the repo.
 * @type {ReadonlyArray<string>}
 */
export const SEA_STATE_LABELS_FR = Object.freeze([
  'Calme', 'Belle', 'Peu agitée', 'Agitée', 'Forte',
  'Très forte', 'Grosse', 'Très grosse', 'Énorme',
]);

/** Neutral color for a station that reports no wave height. */
export const NO_SEA_STATE_CSS = '#8a97a8';

/** Constant dot diameter, in pixels, for EVERY station — see A3 in the header. */
export const BUOY_POINT_PX = 8;

/**
 * Classify a wave height onto the WMO ladder.
 * @param {number|null|undefined} waveHeightM Significant wave height, metres.
 * @returns {{label:string|null, css:string}} Band label (null when unmeasured) and color.
 */
export function seaState(waveHeightM) {
  if (!Number.isFinite(waveHeightM) || waveHeightM < 0) {
    return { label: null, css: NO_SEA_STATE_CSS };
  }
  const band = SEA_STATE_BANDS.find((entry) => waveHeightM <= entry.maxM);
  return { label: band.label, css: band.css };
}

/**
 * How far a buoy may be from a ship and still describe its sea, in metres.
 *
 * 250 km, and the card always prints the actual distance beside the reading so
 * a reader can discount it — the cap is not a claim that a wave field is
 * coherent to exactly that range, it is a floor under absurdity: without one, a
 * vessel in mid-Atlantic would be told the sea state off Florida.
 *
 * The network's density is what makes a cap necessary rather than academic.
 * Counted on the 2026-09-01 report, 882 reporting stations worldwide and 38 of
 * them in the eastern hemisphere, so a ship off Dunkerque has a buoy within
 * tens of kilometres and a ship off Dakar has none within a thousand.
 */
export const SEA_STATE_JOIN_MAX_M = 250_000;

/** Great-circle metres. Local, so this file needs no scene to be tested. */
function buoyDistanceM(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every((value) => Number.isFinite(value))) return Infinity;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 6_371_008.8 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * The nearest station that actually MEASURES the sea, and what it reads.
 *
 * A station without a wave sensor is skipped rather than reported as calm —
 * the same distinction the map draws with a hollow ring, and the reason this
 * module says "one without renders neutral rather than calm". Four fifths of
 * the network has no wave sensor, so a nearest-station join that ignored this
 * would answer "0 m, calm" for most of the ocean.
 *
 * Pure, and exported, because it is the whole content of the vessel-card join
 * and it has to be testable without a scene.
 *
 * @param {ReadonlyArray<object>} stations NDBC observation rows.
 * @param {number} lat @param {number} lon Where the reading is wanted.
 * @param {number} [maxM] Ceiling, {@link SEA_STATE_JOIN_MAX_M} by default.
 * @returns {?{station: string, waveHeightM: number, label: string, css: string,
 *   distanceM: number, observedAt: ?number}}
 */
export function nearestSeaState(stations, lat, lon, maxM = SEA_STATE_JOIN_MAX_M) {
  const ceiling = Number.isFinite(maxM) && maxM > 0 ? maxM : SEA_STATE_JOIN_MAX_M;
  if (!Array.isArray(stations) || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  let best = null;
  let bestM = Infinity;
  for (const row of stations) {
    const hs = row?.waveHeightM;
    if (!Number.isFinite(hs) || hs < 0) continue;
    const metres = buoyDistanceM(lat, lon, Number(row.lat), Number(row.lon));
    if (metres >= bestM || metres > ceiling) continue;
    bestM = metres;
    best = row;
  }
  if (!best) return null;
  const band = seaState(best.waveHeightM);
  return {
    station: String(best.station || ''),
    waveHeightM: best.waveHeightM,
    label: band.label,
    css: band.css,
    distanceM: bestM,
    observedAt: Number.isFinite(best.observedAt) ? best.observedAt : null,
  };
}

/**
 * Index of the WMO band a wave height falls in, or -1 when unmeasured.
 * Shared by the tally and the legend so both walk the same ladder.
 * @param {number|null|undefined} waveHeightM Significant wave height, metres.
 * @returns {number} 0-based band index, or -1.
 */
export function seaStateBandIndex(waveHeightM) {
  if (!Number.isFinite(waveHeightM) || waveHeightM < 0) return -1;
  return SEA_STATE_BANDS.findIndex((entry) => waveHeightM <= entry.maxM);
}

// ---------------------------------------------------------------------------
// The swell stem — the size channel, in world units
// ---------------------------------------------------------------------------

/**
 * The FROZEN stem scale. Every number is a literal measured once and argued in
 * the module header; none of it is ever re-derived from a poll, from the
 * viewport or from the rows in hand (C1), which is what makes the same buoy
 * the same height in every session and every share link.
 *
 * `domainMaxM` is 14 m because that is the top of the last NAMED band of the
 * WMO ladder — so hue and height clip at the same boundary, for the same
 * published reason, rather than at two arbitrary ones. The NDBC parser accepts
 * up to 40 m (`ndbcObservations.js`, `NDBC_BOUNDS.waveHeightM`); the 26 m
 * between the two is the band where a real reading is drawn clipped and
 * dashed rather than dropped.
 */
export const SWELL_STEM_SCALE = Object.freeze({
  /** Metres of stem per metre of swell. A reading scale, published as such. */
  exaggeration: 10_000,
  /** Top of the frozen domain, metres of Hs. Above it the stem is clipped. */
  domainMaxM: 14,
  /** Stem drawn at `domainMaxM`, metres. */
  maxStemM: 140_000,
  /** Shortest stem a measured value may draw, metres. Floors Hs < 0.2 m. */
  minStemM: 2_000,
  /** Stem width, in pixels. Constant — the width carries nothing. */
  widthPx: 2,
  /** Dash length for a clipped stem, in pixels. */
  clippedDashLength: 12,
  /**
   * Cumulative histogram bounds, metres of Hs, descending.
   *
   * These were the legend's three ruler marks. The legend no longer prints a
   * ruler (see {@link buoyLegend}), and they stayed because
   * {@link summarizeSwellStems} still walks them into `atOrAbove`, which
   * `getStats().swell` publishes: "how many buoys are at 2 m or more" is a
   * reading worth having, it is simply not one a key on a globe delivers.
   */
  ticksM: Object.freeze([8, 2, 0.5]),
});

// A published scale that contradicts itself must fail where an author sees it,
// at module load, not at paint time where only a reader would.
if (SWELL_STEM_SCALE.maxStemM
    !== SWELL_STEM_SCALE.domainMaxM * SWELL_STEM_SCALE.exaggeration) {
  throw new RangeError('marineBuoys: maxStemM must be domainMaxM × exaggeration');
}

/**
 * Stem height for one station, in metres above the ellipsoid.
 *
 * Returns `null` — meaning NO STEM AT ALL — when the station published no wave
 * height. That is A1: a buoy with no wave sensor must not be drawn as a buoy
 * that measured a flat sea, so it gets no mark on this channel rather than a
 * mark of length zero. A measured `0` is the other case entirely and returns
 * the floor.
 *
 * @param {number|null|undefined} waveHeightM Significant wave height, metres.
 * @returns {number|null} Stem height in metres, or null when there is no stem.
 */
export function swellStemHeightM(waveHeightM) {
  if (!Number.isFinite(waveHeightM) || waveHeightM < 0) return null;
  const raw = waveHeightM * SWELL_STEM_SCALE.exaggeration;
  return Math.min(SWELL_STEM_SCALE.maxStemM, Math.max(SWELL_STEM_SCALE.minStemM, raw));
}

/** True when Hs sits above the frozen domain and the stem stops measuring (A5). */
export function swellStemIsClipped(waveHeightM) {
  return Number.isFinite(waveHeightM) && waveHeightM > SWELL_STEM_SCALE.domainMaxM;
}

/** True when a measured value is short enough to be drawn at the floor (A5). */
export function swellStemIsFloored(waveHeightM) {
  if (!Number.isFinite(waveHeightM) || waveHeightM < 0) return false;
  return waveHeightM * SWELL_STEM_SCALE.exaggeration < SWELL_STEM_SCALE.minStemM;
}

/**
 * Tally what the render actually drew, for the legend and the stats line.
 *
 * Counted over the stations HANDED TO THE RENDERER, not over what happens to
 * be on screen: the legend has to describe the layer, and a tally that moved
 * with the camera would make two readers of the same share link see two
 * different keys (D2).
 *
 * WIDER THAN THE LEGEND, ON PURPOSE. `floored` and `atOrAbove` no longer reach
 * a legend row — `getStats().swell` is where they surface now. A5 asks for the
 * distortions at both ends of the scale to be COUNTABLE, not to be printed on
 * the globe, and a caller that wants them (the analyst seam, a QA harness, a
 * future card) reads them from the same tally the key does.
 *
 * @param {Array<object>} stations Parsed NDBC observations.
 * @returns {{stations:number, stems:number, noStem:number, floored:number,
 *   clipped:number, tallestHsM:number|null, atOrAbove:Array<number>,
 *   bands:Array<{label:string, css:string, count:number}>}}
 */
export function summarizeSwellStems(stations) {
  const rows = Array.isArray(stations) ? stations : [];
  const ticks = SWELL_STEM_SCALE.ticksM;
  const atOrAbove = ticks.map(() => 0);
  const bandCounts = SEA_STATE_BANDS.map(() => 0);
  let stems = 0;
  let noStem = 0;
  let floored = 0;
  let clipped = 0;
  let tallestHsM = null;

  for (const row of rows) {
    const hs = row?.waveHeightM;
    if (swellStemHeightM(hs) === null) {
      noStem += 1;
      continue;
    }
    stems += 1;
    if (swellStemIsFloored(hs)) floored += 1;
    if (swellStemIsClipped(hs)) clipped += 1;
    for (let i = 0; i < ticks.length; i += 1) {
      if (hs >= ticks[i]) atOrAbove[i] += 1;
    }
    if (tallestHsM === null || hs > tallestHsM) tallestHsM = hs;
    const band = seaStateBandIndex(hs);
    if (band >= 0) bandCounts[band] += 1;
  }

  return {
    stations: rows.length,
    stems,
    noStem,
    floored,
    clipped,
    tallestHsM,
    atOrAbove,
    bands: SEA_STATE_BANDS.map((band, index) => ({
      label: SEA_STATE_LABELS_FR[index],
      css: band.css,
      count: bandCounts[index],
    })),
  };
}

// ---------------------------------------------------------------------------
// Legend (D1)
// ---------------------------------------------------------------------------

/** @type {Map<string,string>} glyph cache. */
const _glyphCache = new Map();

const _b64 = (text) => (typeof btoa === 'function'
  ? btoa(text)
  : Buffer.from(text, 'utf8').toString('base64'));

/**
 * The hollow-ring swatch, for the row that has no stem.
 *
 * A SHAPE, handed to the legend as the very shape the map draws — the swatch
 * is masked with the entry's colour, so the ring shows in the same grey the
 * sensorless buoys are drawn in. D3 asks for a motif rather than a tint on a
 * globe where no colour is neutral; an outline is the cheapest motif there is,
 * and it is the one encoding that survives the NVG and FLIR passes.
 * @returns {string} `data:image/svg+xml;base64,…`
 */
export function buoyRingGlyph() {
  const cached = _glyphCache.get('ring');
  if (cached) return cached;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">'
    + '<circle cx="8" cy="8" r="5" fill="none" stroke="#000" stroke-width="2.5"/>'
    + '</svg>';
  const uri = `data:image/svg+xml;base64,${_b64(svg)}`;
  _glyphCache.set('ring', uri);
  return uri;
}

/**
 * The dashed stem, for the row that says a reading left the scale.
 *
 * The clipped stem is DRAWN in dashes on the map — this repo's sign for "this
 * attribute is not being asserted" — so the swatch has to be dashed too. It
 * used to be the same solid bar as every other stem row, which had the key
 * describing a mark the map does not draw. Same 16-unit box as the prism
 * glyphs, so the two sit at one weight in the rail.
 * @returns {string} `data:image/svg+xml;base64,…`
 */
export function buoyDashedStemGlyph() {
  const cached = _glyphCache.get('dashed-stem');
  if (cached) return cached;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">'
    + '<line x1="8" y1="1" x2="8" y2="15" stroke="#000" stroke-width="6" '
    + 'stroke-dasharray="3 2.5"/>'
    + '</svg>';
  const uri = `data:image/svg+xml;base64,${_b64(svg)}`;
  _glyphCache.set('dashed-stem', uri);
  return uri;
}

/** French number, flattened so the legend measures and wraps identically everywhere. */
function fr(value) {
  return Number(value).toLocaleString('fr-FR').replace(/[\u00a0\u202f]/g, ' ');
}

/** French range label for one WMO band, from the frozen boundaries. */
export function seaStateBandLabel(index) {
  const name = SEA_STATE_LABELS_FR[index];
  if (!name) return '';
  const low = index === 0 ? 0 : SEA_STATE_BANDS[index - 1].maxM;
  const high = SEA_STATE_BANDS[index].maxM;
  if (index === 0) return `${name} · ≤ ${fr(high)} m`;
  if (!Number.isFinite(high)) return `${name} · > ${fr(low)} m`;
  return `${name} · ${fr(low)} – ${fr(high)} m`;
}

/**
 * The key this layer publishes through `getRowControls().legend`, which
 * `manager.js` mounts in the on-map block — the mount D1 actually requires,
 * since the panel ships collapsed and a share link ignores the recipient's
 * stored panel preference.
 *
 * ── WHAT THIS BLOCK USED TO BE ──────────────────────────────────────────────
 *
 * Eleven rows and 388 words on a calm report; seventeen rows on a rough one,
 * enough to overflow the rail and push the layer's own name off the top. Four
 * of those rows were a graduated RULER — 8 m, 2 m, 0,5 m, and the floor — 99
 * words spent teaching a reader to invert ×10 000 by eye. Three more carried
 * this layer's design defence: `ÉCHELLE DE LECTURE`, `REDONDANCE DÉLIBÉRÉE`,
 * `Domaine gelé`, `Coût : 1,4 % de l'échelle`.
 *
 * THE RULER WENT BECAUSE THE MAP ALREADY PRINTS THE METRES. Up to
 * {@link BUOY_OVERLAY_COHORT_LIMIT} = 96 stations carry a card, and
 * {@link selectBuoyOverlayCohort} sorts that cohort by `priority`, which is Hs
 * — so the tallest stems on screen are precisely the ones with their exact
 * reading written beside them, `1.0 m · Slight`. A scale nobody has to invert
 * needs no marks. What the stem still carries is the RELIEF and the ORDER, and
 * an order is decoded off the marks themselves: the Biscay storm towers over
 * the Channel beside it whether or not a key prints "8 m". That is the
 * argument `airportsPack.airportMarkLegend` makes for the disc diameters, in
 * the one other place this repo spent a legend on a size ladder.
 *
 * THE DEFENCE WENT BECAUSE IT WAS NEVER ADDRESSED TO THE READER. Every one of
 * those statements is still true and still frozen (C1); they are argued at
 * length in this module's header, where the person who can act on them reads.
 * The counts they came with are not lost either — `getStats().swell` publishes
 * the whole tally, `floored` and `atOrAbove` included, which is where A5's
 * "countable" belongs. Printed on the globe, they were answering a question
 * the reader had not asked. The reader needs to know that a stick means waves.
 *
 * ── WHAT SURVIVES, AND WHY EACH ONE HAD TO ──────────────────────────────────
 *
 * Three drawn marks no reader can decode unaided, and the colour ladder:
 *
 *   the STEM    a vertical bar rising out of the sea is not self-evident on a
 *               globe; nothing else on screen says it means waves.
 *   the RING    hollow = no wave sensor. A shape, per A1 — the only channel
 *               separating "measured a flat sea" from "never measured", and
 *               the one that survives the NVG and FLIR passes (D3).
 *   the DASHES  off the top of the frozen domain. A shape again, and a row
 *               that appears only when a station is actually in that state.
 * AND WHY THE TWO SHAPE ROWS SURVIVED WHERE THE AIRPORTS' DID NOT. #138 struck
 * "Piste tracée" and "Emprise au sol" on the grounds that a shape is decoded
 * without a key — "a line laid along a runway IS a runway". That test is about
 * ICONICITY, and it is the right one: those marks resemble what they name.
 * Neither of these does. Nothing about a hollow ring says "no wave sensor", and
 * nothing about a dash says "past 14 metres"; both are arbitrary signs, and an
 * arbitrary sign is exactly the case D1 reserves a key for. A future pass
 * tidying legends by symmetry with the airports would be removing the rows that
 * carry the layer's two silent failure modes.
 *
 *   the HUE     the WMO ladder, with its counts — which are the reading of the
 *               day ("144 buoys in a slight sea, 12 in a moderate one") and
 *               the reason the bands stay one row each rather than collapsing
 *               into a gradient strip that could carry no tally.
 *
 * ── ONE ROW KEEPS A `blurb`, AND IT IS NOT OPTIONAL ────────────────────────
 *
 * `CARTOGRAPHIE.md` F7(a), P0: a vertical length belongs to one of four
 * REGISTERS, nothing on screen distinguishes them, and the register is to be
 * named "in full words, in the module header AND in the legend" — the document
 * says "ÉCHELLE DE LECTURE" and "hauteur réelle" must never be left to be
 * guessed. This layer is register (3), a published convention, and it shares
 * the globe with register (1) layers that draw metres at 1:1.
 *
 * So the stem row carries fourteen words. Not the hundred and one it used to:
 * F7(a) asks for the register to be NAMED, and the argument for the register —
 * why ×10 000, why linear, why 14 m — is what belongs to this header. The
 * factor rides along because it is the shortest thing that makes "échelle de
 * lecture" concrete, and because F7(b) does the real work here anyway: the
 * shortest stem is 2 km, above every world height in the repo, so the two
 * registers cannot be confused by amplitude even before a word is read.
 *
 * Every other row is its own whole message, which is what lets it survive at
 * any rail width and reach a screen reader as one string rather than as a
 * heading trailed by a paragraph.
 *
 * Every entry still carries a finite `count` ON PURPOSE. The panel-row
 * renderer appends `_formatCount(item.count)` unconditionally and
 * `_formatCount(undefined)` renders the string "undefined" (`manager.js`, a
 * known pre-existing defect that `choroplethPrism.prismLegend` documents and
 * lives with). Giving every row a real tally sidesteps it here without
 * touching a file this layer does not own.
 *
 * @param {ReturnType<typeof summarizeSwellStems>} summary Render tally.
 * @returns {Array<{label:string, color:?string, count:number, glyph?:string}>}
 */
export function buoyLegend(summary) {
  if (!summary || !Number.isFinite(summary.stations) || summary.stations <= 0) return [];
  const entries = [];

  entries.push({
    label: 'Une tige = des vagues mesurées. Plus haute, plus grosses',
    color: PRISM_HEIGHT_SWATCH_COLOR,
    glyph: prismHeightGlyph(1),
    count: summary.stems,
    // F7(a), P0 — the register, in full words, on the map. The factor is
    // derived from the frozen scale rather than typed, so a key that drifted
    // from what the renderer draws is not expressible.
    blurb: `Échelle de lecture, pas une hauteur réelle : 1 m de houle dessine `
      + `${fr(SWELL_STEM_SCALE.exaggeration / 1000)} km de tige.`,
  });

  entries.push({
    label: 'Cercle creux = bouée sans capteur de vagues',
    color: NO_SEA_STATE_CSS,
    glyph: buoyRingGlyph(),
    count: summary.noStem,
  });

  // A5 — the ceiling is a STATE, so its row exists exactly when something is
  // in it. On a calm day the dashes are not on the map, and a key that
  // described them anyway would be describing a mark the reader cannot find.
  if (summary.clipped) {
    entries.push({
      label: `Tige en tirets = mer au-delà de ${fr(SWELL_STEM_SCALE.domainMaxM)} m, hors échelle`,
      color: PRISM_HEIGHT_SWATCH_COLOR,
      glyph: buoyDashedStemGlyph(),
      count: summary.clipped,
    });
  }

  // `color: null` renders the "not drawn here" slot — this row names the
  // channel, the nine below it are the channel. A swatch would imply the
  // heading itself was mapped to something.
  entries.push({
    label: "Couleur = état de la mer, le nom qu'en donnent les marins",
    color: null,
    count: summary.stems,
  });

  summary.bands.forEach((band, index) => {
    if (!band.count) return;
    entries.push({
      label: seaStateBandLabel(index),
      color: band.css,
      count: band.count,
    });
  });

  return entries;
}

/** Compass point for a bearing in degrees. */
function compass(deg) {
  if (!Number.isFinite(deg)) return '';
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return points[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

/** Metres per second → knots. */
export function msToKnots(ms) {
  return Number.isFinite(ms) ? ms * 1.9438444924406 : null;
}

/**
 * Build the card copy for one station.
 *
 * Every line is omitted when its measurement is absent — the sparse-network
 * rule from the module header. A station with no marine reading yields a
 * title and no detail lines at all, which is the honest rendering of a buoy
 * that reported only a timestamp.
 *
 * @param {object} station Parsed NDBC observation.
 * @returns {{title:string, details:string[]}}
 */
export function buoyOverlayCopy(station) {
  const details = [];

  if (Number.isFinite(station?.waveHeightM)) {
    const { label } = seaState(station.waveHeightM);
    const period = Number.isFinite(station.dominantPeriodS)
      ? ` · ${station.dominantPeriodS.toFixed(0)}s`
      : '';
    const direction = Number.isFinite(station.waveDirDeg)
      ? ` ${compass(station.waveDirDeg)}`
      : '';
    details.push(`${station.waveHeightM.toFixed(1)} m${direction}${period} · ${label}`);
  }

  if (Number.isFinite(station?.seaTempC)) {
    details.push(`Sea ${station.seaTempC.toFixed(1)} °C`);
  }

  if (Number.isFinite(station?.windSpeedMs)) {
    const knots = msToKnots(station.windSpeedMs);
    const direction = Number.isFinite(station.windDirDeg)
      ? `${compass(station.windDirDeg)} `
      : '';
    details.push(`Wind ${direction}${knots.toFixed(0)} kt`);
  }

  return { title: String(station?.station ?? 'BUOY'), details };
}

/**
 * Source-owned overlay entry for one buoy.
 * Priority favours the roughest measured seas, so the cohort cap keeps the
 * stations that matter when the screen is crowded. Unmeasured stations sort
 * below every measured one rather than winning a slot by accident.
 */
export function createBuoyOverlayEntry({ id, position, station, accent }) {
  const copy = buoyOverlayCopy(station);
  const wave = Number.isFinite(station?.waveHeightM) ? station.waveHeightM : -1;
  return {
    id: String(id),
    source: BUOY_OVERLAY_SOURCE_ID,
    position,
    variant: 'card',
    title: copy.title,
    details: copy.details,
    accent,
    priority: Math.round(wave * 1000),
    collisionGroup: 'ambient-card',
    zIndex: 30,
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    placement: 'above',
  };
}

/**
 * Render the measured/total split as the one-line `coverage` string the
 * manager prints into the control chip.
 *
 * This field is part of the layer-stats contract as a STRING — `manager.js`
 * interpolates it straight into chip text and into the fallback-detection
 * source string. Handing it an object prints "[object Object]" on the chip,
 * so the numeric breakdown travels separately under `measuring`.
 *
 * @param {?{stations:number, marine:number}} coverage Proxy coverage summary.
 * @returns {string} Chip-ready text, empty when the summary is unusable.
 */
export function coverageLabel(coverage) {
  const stations = Number(coverage?.stations);
  const marine = Number(coverage?.marine);
  if (!Number.isFinite(stations) || stations <= 0) return '';
  if (!Number.isFinite(marine)) return `${stations} stations`;
  return `${marine} of ${stations} measuring sea`;
}

/** Keep the roughest seas, with stable identity as the tie-break. */
export function selectBuoyOverlayCohort(entries, limit = BUOY_OVERLAY_COHORT_LIMIT) {
  const cap = Math.max(0, Math.min(
    BUOY_OVERLAY_COHORT_LIMIT,
    Math.floor(Number(limit) || 0),
  ));
  if (!Array.isArray(entries) || cap === 0) return [];
  return entries.slice().sort((a, b) => (
    b.priority - a.priority || String(a.id).localeCompare(String(b.id))
  )).slice(0, cap);
}

/**
 * Map one station to a JSON-safe analyst record (analyst query engine seam).
 * Missing fields stay null, never NaN or undefined.
 */
export function mapAnalystRecord(station, index = 0) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const id = String(station?.station ?? '').trim();
  return {
    id: id || `BUOY-${String(index).padStart(4, '0')}`,
    lat: num(station?.lat),
    lon: num(station?.lon),
    timeMs: num(station?.observedAt),
    waveHeightM: num(station?.waveHeightM),
    dominantPeriodS: num(station?.dominantPeriodS),
    waveDirectionDeg: num(station?.waveDirDeg),
    seaTempC: num(station?.seaTempC),
    airTempC: num(station?.airTempC),
    windSpeedMs: num(station?.windSpeedMs),
    windDirectionDeg: num(station?.windDirDeg),
    pressureHpa: num(station?.pressureHpa),
    seaState: seaState(station?.waveHeightM).label,
  };
}

export function createMarineBuoysLayer({
  overlayHost = DEFAULT_OVERLAY_HOST,
  fetchImpl = (...args) => fetch(...args),
  geoid = DEFAULT_GEOID,
} = {}) {
  let _dataSource = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;
  let _stale = false;
  /** @type {?{stations:number, waveHeight:number, seaTemp:number, wind:number, marine:number}} */
  let _coverage = null;
  /** @type {Array<object>} Latest parsed stations, kept for the analyst seam. */
  let _stations = [];
  /** Takes the `buoys/nearest` offer down. Null while the layer is off. */
  let _releaseJoin = null;
  /** @type {?ReturnType<typeof summarizeSwellStems>} Render tally for the legend. */
  let _swell = null;
  /** @type {?object} The viewer, kept so the cull can read the camera. */
  let _viewer = null;
  /**
   * @type {Array<{entity:object, lat:number, lon:number, surface:object, overlay:object, visible:boolean}>}
   * One record per DRAWN station: its entity, the sea-surface point the limb
   * test uses, and the card it would publish. This is the cull's working set.
   */
  let _drawn = [];
  /** How many of `_drawn` survived the last cull — published in `getStats()`. */
  let _visible = 0;
  let _cameraChangedAttached = false;
  /** True once the EGM96 grid has loaded; until then the datum is the ellipsoid. */
  let _geoidReady = false;

  /**
   * Sea-surface ellipsoidal height at a station: the geoid undulation N, or 0
   * (the ellipsoid) while the grid is cold. A cold grid degrades the DATUM by
   * up to ~100 m; it never fails the layer.
   */
  function seaSurfaceHeightM(lat, lon) {
    if (!_geoidReady) return 0;
    try {
      const n = geoid.heightAt(lat, lon);
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  }

  /** Publish the card cohort, picked from the stations that survived the cull. */
  function publishCards() {
    if (!_enabled) return;
    const entries = [];
    for (const record of _drawn) {
      if (record.visible) entries.push(record.overlay);
    }
    overlayHost.setEntries(
      BUOY_OVERLAY_SOURCE_ID,
      selectBuoyOverlayCohort(entries),
      {
        cohortLimit: BUOY_OVERLAY_COHORT_LIMIT,
        collisionCapacity: BUOY_OVERLAY_COLLISION_CAPACITY,
        moving: false,
      },
    );
  }

  /**
   * Hide every station that is behind the limb or out of frame, and re-pick the
   * cards from what is left.
   *
   * Both marks of a station live on ONE entity, so `entity.show` moves the dot
   * and its stem together — which is the asymmetry this exists to remove. The
   * card follows because the cohort is re-picked from the survivors.
   *
   * @returns {boolean} True when some station's visibility changed.
   */
  function applyVisibility() {
    if (!_drawn.length) {
      _visible = 0;
      return false;
    }
    const camera = _viewer?.camera;
    // No camera to ask (a headless unit-test viewer, or a torn-down one):
    // nothing is culled. Drawing everything is the honest failure here — the
    // far side painting through the globe is a defect, an empty ocean is a lie.
    if (!camera) {
      let changed = false;
      for (const record of _drawn) {
        if (!record.visible) changed = true;
        record.visible = true;
        record.entity.show = true;
      }
      _visible = _drawn.length;
      if (changed) _viewer?.scene?.requestRender?.();
      return changed;
    }

    const occluder = horizonOccluder(camera);
    const boxes = cameraBuoyBoxes(_viewer);
    let changed = false;
    let visible = 0;
    for (const record of _drawn) {
      const next = occluder.isPointVisible(record.surface)
        && buoyInView(boxes, record.lat, record.lon);
      if (next !== record.visible) {
        record.visible = next;
        record.entity.show = next;
        changed = true;
      }
      if (next) visible += 1;
    }
    _visible = visible;
    // The app renders on demand. A camera move requests a frame of its own, but
    // the cull must not depend on the ORDER in which Cesium raises
    // `camera.changed` against that frame — ask for the one that shows the
    // result, and only when there is a result to show.
    if (changed) _viewer?.scene?.requestRender?.();
    return changed;
  }

  /**
   * The cull pass, on the shared viewport cadence. Cards are only rebuilt when
   * a station actually crossed the limb or the frame edge: the cohort is a
   * function of the visible set alone, so an unchanged set is an unchanged
   * cohort, and `setOverlayEntries` is not free.
   */
  function onCameraChanged() {
    if (!_enabled) return;
    if (applyVisibility()) publishCards();
  }

  function attachCamera(viewer) {
    if (viewer) _viewer = viewer;
    const camera = _viewer?.camera;
    if (_cameraChangedAttached || !camera?.changed?.addEventListener) return;
    camera.changed.addEventListener(onCameraChanged);
    claimCameraSensitivity(_viewer, BUOY_LAYER_ID);
    _cameraChangedAttached = true;
  }

  function detachCamera() {
    if (!_cameraChangedAttached) return;
    _viewer?.camera?.changed?.removeEventListener?.(onCameraChanged);
    releaseCameraSensitivity(_viewer, BUOY_LAYER_ID);
    _cameraChangedAttached = false;
  }

  const layer = {
    id: 'marine-buoys',
    name: 'Marine Buoys',
    icon: '⬡',
    source: 'NOAA NDBC',
    updateInterval: UPDATE_INTERVAL_MS,

    init(viewer) {
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('marine-buoys');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      _stale = false;
      _coverage = null;
      _stations = [];
      _swell = null;
      _drawn = [];
      _visible = 0;
      overlayHost.setVisible(BUOY_OVERLAY_SOURCE_ID, false);
    },

    enable(viewer) {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(BUOY_OVERLAY_SOURCE_ID, true);
      attachCamera(viewer);
      // A layer re-enabled over stations drawn before still has to answer for
      // where the camera is NOW, and `camera.changed` will not fire until the
      // operator moves.
      applyVisibility();
      publishCards();
      // ── The sea state, offered to whoever is on it ────────────────────────
      // A vessel card says where a ship is going and never what it is going
      // through, and this layer is holding the answer 40 km away. Offered
      // while ENABLED rather than while loaded (`layerJoins.js`): a reader who
      // switched the buoys off asked not to see them, and a vessel card that
      // kept quoting them would be answering a question they had closed.
      _releaseJoin?.();
      _releaseJoin = publishJoin('buoys/nearest', (lat, lon, maxM) => (
        nearestSeaState(_stations, lat, lon, maxM)
      ));
    },

    disable() {
      _enabled = false;
      detachCamera();
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(BUOY_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(BUOY_OVERLAY_SOURCE_ID, false);
      _releaseJoin?.();
      _releaseJoin = null;
    },

    async update() {
      try {
        const response = await fetchImpl(API_URL);
        if (!response.ok) {
          _lastError = `NDBC HTTP ${response.status}`;
          return false;
        }

        const payload = await response.json();
        if (!payload || !Array.isArray(payload.stations)) {
          _lastError = 'Malformed NDBC response';
          return false;
        }

        // The proxy already dropped stale rows and rejected non-report bodies;
        // an empty array here therefore means the cache is empty, not that the
        // ocean fell silent. Surface it rather than clearing a good render.
        if (!payload.stations.length) {
          _lastError = 'NDBC reported no stations';
          return false;
        }

        if (!_dataSource) return false;

        // Sea-surface datum. The grid is a lazy ~2.7 MB dynamic import; warm it
        // before the first draw and never let a failed chunk be reported as a
        // feed error, because it is not one — it costs the datum, not the data.
        if (!_geoidReady) {
          try {
            await geoid.ensureReady();
            _geoidReady = true;
          } catch {
            _geoidReady = false;
          }
        }

        _dataSource.entities.removeAll();
        _drawn = [];

        const drawn = [];

        for (const station of payload.stations) {
          if (!Number.isFinite(station?.lat) || !Number.isFinite(station?.lon)) continue;
          const { css } = seaState(station.waveHeightM);
          const color = Cesium.Color.fromCssColorString(css);
          // On the geoid, not on the ellipsoid — the sea surface is where the
          // AIS layer already puts its hulls.
          const seaSurfaceM = seaSurfaceHeightM(station.lat, station.lon);
          const position = Cesium.Cartesian3.fromDegrees(
            station.lon, station.lat, seaSurfaceM,
          );
          const stemM = swellStemHeightM(station.waveHeightM);
          const measured = stemM !== null;

          const entity = {
            id: `marine-buoy:${station.station}`,
            position,
            point: {
              // CONSTANT for every station: the size channel is spent on the
              // stem now, and a dot that also varied would compose with it.
              // What tells the two apart is SHAPE — a filled disc took a wave
              // reading, a hollow ring did not (A1, and D3's motif-not-tint).
              pixelSize: BUOY_POINT_PX,
              color: color.withAlpha(measured ? 0.95 : 0.15),
              outlineColor: measured
                ? Cesium.Color.BLACK.withAlpha(0.5)
                : color.withAlpha(0.95),
              outlineWidth: measured ? 1 : 2,
              heightReference: Cesium.HeightReference.NONE,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            properties: {
              ndbcStation: station.station,
              observedAt: station.observedAt ?? null,
              waveHeightM: station.waveHeightM ?? null,
              swellStemM: stemM,
              dominantPeriodS: station.dominantPeriodS ?? null,
              waveDirDeg: station.waveDirDeg ?? null,
              seaTempC: station.seaTempC ?? null,
              airTempC: station.airTempC ?? null,
              windSpeedMs: station.windSpeedMs ?? null,
              windDirDeg: station.windDirDeg ?? null,
              pressureHpa: station.pressureHpa ?? null,
            },
          };

          if (measured) {
            const clipped = swellStemIsClipped(station.waveHeightM);
            // Second graphic on the SAME entity, so the entity count still
            // equals the station count. `arcType: NONE` keeps it two vertices:
            // the geodesic default would try to subdivide a segment whose two
            // ends share a longitude. No depth-test override — a relief must
            // be occluded by the limb, unlike the locator dot above it.
            entity.polyline = {
              positions: [
                position,
                Cesium.Cartesian3.fromDegrees(
                  station.lon, station.lat, seaSurfaceM + stemM,
                ),
              ],
              width: SWELL_STEM_SCALE.widthPx,
              arcType: Cesium.ArcType.NONE,
              material: clipped
                ? new Cesium.PolylineDashMaterialProperty({
                  color: color.withAlpha(0.9),
                  dashLength: SWELL_STEM_SCALE.clippedDashLength,
                })
                : color.withAlpha(0.9),
            };
          }

          const added = _dataSource.entities.add(entity);
          drawn.push(station);

          _drawn.push({
            entity: added,
            lat: station.lat,
            lon: station.lon,
            surface: position,
            overlay: createBuoyOverlayEntry({
              id: station.station,
              position,
              station,
              accent: css,
            }),
            // Assume drawn, then let the cull below have the last word. The
            // dot must never render for one frame at a place the card and the
            // stem already agree it is not.
            visible: true,
          });
        }

        // Before the first frame of this poll, not after it.
        applyVisibility();

        // Tallied over what was DRAWN, not over what is on screen (D2).
        _swell = summarizeSwellStems(drawn);

        publishCards();

        _stations = payload.stations;
        _count = _dataSource.entities.values.length;
        _coverage = payload.coverage ?? null;
        _stale = payload.stale === true;
        _lastUpdate = Number.isFinite(payload.fetchedAt) ? payload.fetchedAt : Date.now();
        _lastError = null;
        return true;
      } catch (error) {
        console.warn('[Data:MarineBuoys] Fetch error:', error);
        _lastError = 'NDBC network error';
        return false;
      }
    },

    destroy(viewer) {
      _enabled = false;
      detachCamera();
      overlayHost.clearSource(BUOY_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(BUOY_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _viewer = null;
      _releaseJoin?.();
      _releaseJoin = null;
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      _coverage = null;
      _stations = [];
      _swell = null;
      _drawn = [];
      _visible = 0;
    },

    /**
     * Snapshot stations as plain JSON-safe records for the analyst engine.
     * On-demand only; returns [] while disabled or empty.
     */
    getAnalystRecords(maxCount = 2000) {
      if (!_dataSource || !_dataSource.show) return [];
      const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 2000;
      return _stations.slice(0, limit).map((station, index) => mapAnalystRecord(station, index));
    },

    getStats() {
      return {
        count: _count,
        lastUpdate: _lastUpdate,
        error: _lastError,
        stale: _stale,
        // A string by contract — the manager prints it into the chip. It says
        // "533 of 892 measuring sea" so the display never implies that every
        // rendered buoy carries a sea reading.
        coverage: coverageLabel(_coverage),
        // Numeric breakdown for callers that want the counts rather than the
        // sentence (tests, analyst seam).
        measuring: _coverage,
        // What the SIZE channel actually drew: stems, the ones floored, the
        // ones clipped, and the stations that got none. A5 wants the écrêtage
        // countable from outside the legend too.
        swell: _swell,
        // The cull, as two numbers rather than as pixels: how many of the
        // drawn stations the last camera pass left on screen, and how many the
        // limb or the frame edge removed. `count` stays the station tally, so
        // the chip and the QA harness's existing reading are unchanged.
        visible: _visible,
        culled: Math.max(0, _count - _visible),
      };
    },

    /**
     * The key to the stems and the hues (D1).
     *
     * Published here rather than only in `getStats()` because `manager.js`
     * reads `getRowControls().legend` for BOTH mount points — the panel row
     * and the on-map block — and only the second one is visible with the map
     * in the default, collapsed-panel state a share link lands in.
     * @returns {{chips: Array<object>, legend: Array<object>}|null} Controls, or null while empty.
     */
    getRowControls() {
      if (!_swell || !_swell.stations) return null;
      return { chips: [], legend: buoyLegend(_swell) };
    },
  };

  return layer;
}

const marineBuoysLayer = createMarineBuoysLayer();

export default marineBuoysLayer;
