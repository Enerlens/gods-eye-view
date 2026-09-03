import * as Cesium from 'cesium';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
// The prism module is pure arithmetic and strings; only its legend primitives
// are borrowed here. `prismHeightGlyph` draws the bar swatch whose HEIGHT is
// the datum, and the graphite is deliberately one constant colour so a ruler
// tick cannot smuggle in a second encoding (A3). Nothing else about a
// départemental prism applies to a buoy: no base polygon, no rate fill.
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
 * THE EXAGGERATION, PUBLISHED IN THE LEGEND
 * -----------------------------------------
 * ×10 000 — one metre of swell draws ten kilometres of stem. At true scale an
 * 8 m sea on a 6 371 km globe is 1.3 millionths of the radius, i.e. nothing;
 * so the factor is a READING SCALE, the legend says so in those words, and it
 * is LINEAR, so a stem twice as tall is twice the swell. Apparent heights,
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
 * mariner actually speaks ("mer forte"). The legend says this out loud rather
 * than letting a reader discover a doubled channel.
 *
 * A5 · THE FLOOR AND THE CEILING, BOTH COUNTED
 * --------------------------------------------
 * FLOOR — a stem shorter than 2 km is invisible at any useful range, so a
 * measured value below 0.2 m is drawn at 2 km and says "measured", not "how
 * much". The NDBC field is quantised to the decimetre, so the floor covers
 * exactly the 0.0 and 0.1 m readings: 24 of 266 wave stations on 2026-09-03
 * (9 %). It costs 1.4 % of the scale, and the count is in the legend.
 * CEILING — the domain is frozen at 14 m, the top of the last NAMED band of
 * the WMO ladder, so the two channels clip at the same place for the same
 * published reason. Above it the stem stays at 140 km and switches to DASHES,
 * the repo's existing sign for "this attribute is not being asserted", and the
 * legend counts the clipped stations. The frozen bound is never re-derived
 * from a poll (C1): the same buoy is the same height in every share link.
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
  /** Legend ruler marks, metres of Hs, descending. */
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

/** French number, flattened so the legend measures and wraps identically everywhere. */
function fr(value) {
  return Number(value).toLocaleString('fr-FR').replace(/[\u00a0\u202f]/g, ' ');
}

/** Round metres as kilometres, for a height blurb. */
function km(metres) {
  return `${fr(Math.round(metres / 1000))} km`;
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
 * The two-part key this layer publishes through `getRowControls().legend`,
 * which `manager.js` mounts BOTH in the panel row and in the on-map block —
 * the second one being the mount D1 actually requires, since the panel ships
 * collapsed and a share link ignores the recipient's panel preference.
 *
 * Height first: it is the channel that just changed, and it is the one a size
 * without a ruler makes illegible. Three numbered marks, per D1, plus the
 * floor and (when it bites) the ceiling, both counted per A5.
 *
 * Every entry carries a finite `count` ON PURPOSE. The panel-row renderer
 * appends `_formatCount(item.count)` unconditionally and `_formatCount(
 * undefined)` returns the string "undefined" (`manager.js:2470`, a known
 * pre-existing defect that `choroplethPrism.prismLegend` documents and lives
 * with). Giving every row a real tally sidesteps it here without touching a
 * file this layer does not own — and the tallies are worth reading: the ruler
 * ticks double as a cumulative histogram of the report.
 *
 * @param {ReturnType<typeof summarizeSwellStems>} summary Render tally.
 * @returns {Array<{label:string, color:?string, count:number, glyph?:string, blurb?:string}>}
 */
export function buoyLegend(summary) {
  if (!summary || !Number.isFinite(summary.stations) || summary.stations <= 0) return [];
  const scale = SWELL_STEM_SCALE;
  const entries = [];

  const tallest = Number.isFinite(summary.tallestHsM)
    ? ` Plus haut relevé du rapport en cours : ${fr(summary.tallestHsM)} m.`
    : '';

  entries.push({
    label: 'Hauteur — houle significative (Hs)',
    color: null,
    count: summary.stems,
    blurb: `Une tige verticale, en unités monde : 1 m de houle dessine `
      + `${km(scale.exaggeration)} de tige, soit une exagération verticale `
      + `×${fr(scale.exaggeration)}. C'est une ÉCHELLE DE LECTURE, pas une mesure à `
      + `l'échelle — à l'échelle réelle, 8 m de mer sur un globe de 6 371 km ne font `
      + `rien de visible. Échelle linéaire : une tige deux fois plus haute vaut deux `
      + `fois plus de houle. Domaine gelé à ${fr(scale.domainMaxM)} m, jamais recalculé `
      + `depuis le relevé en cours ; au-delà la tige reste à ${km(scale.maxStemM)} et `
      + `passe en tirets.${tallest}`,
  });

  scale.ticksM.forEach((tick, index) => {
    const heightM = swellStemHeightM(tick);
    entries.push({
      label: `${fr(tick)} m`,
      color: PRISM_HEIGHT_SWATCH_COLOR,
      glyph: prismHeightGlyph((heightM ?? 0) / scale.maxStemM),
      count: summary.atOrAbove[index] ?? 0,
      blurb: `Tige de ${km(heightM ?? 0)}. Le compte est celui des bouées à `
        + `${fr(tick)} m ou plus.`,
    });
  });

  entries.push({
    label: `sous ${fr(scale.minStemM / scale.exaggeration)} m — tige au plancher`,
    color: PRISM_HEIGHT_SWATCH_COLOR,
    glyph: prismHeightGlyph(scale.minStemM / scale.maxStemM),
    count: summary.floored,
    blurb: `Sous ${fr(scale.minStemM / scale.exaggeration)} m la tige passerait sous le `
      + `pixel : elle est posée à son plancher de ${km(scale.minStemM)} et dit « mesuré », `
      + `pas « combien ». Le champ NDBC est quantifié au décimètre, donc ce plancher ne `
      + `couvre que les relevés à 0,0 et 0,1 m. Coût : `
      + `${fr(Math.round((scale.minStemM / scale.maxStemM) * 1000) / 10)} % de l'échelle.`,
  });

  if (summary.clipped) {
    entries.push({
      label: `au-dessus de ${fr(scale.domainMaxM)} m — tige écrêtée`,
      color: PRISM_HEIGHT_SWATCH_COLOR,
      glyph: prismHeightGlyph(1),
      count: summary.clipped,
      blurb: `Relevé supérieur au domaine gelé : la tige reste à ${km(scale.maxStemM)} `
        + `et passe en TIRETS pour dire qu'elle ne mesure plus. La valeur exacte reste `
        + `dans la fiche. Le domaine ne bouge pas : c'est ce qui garantit qu'une même `
        + `houle fait la même hauteur d'une session à l'autre.`,
    });
  }

  entries.push({
    label: 'Pas de capteur de houle — aucune tige',
    color: NO_SEA_STATE_CSS,
    glyph: buoyRingGlyph(),
    count: summary.noStem,
    blurb: `Cercle creux gris, et rien au-dessus. Une station sans capteur de vague `
      + `n'est pas une station qui rapporte une mer plate : elle n'a pas une tige de `
      + `hauteur nulle, elle n'a pas de tige. À l'inverse, une mer mesurée à 0,0 m a `
      + `bien sa tige, au plancher.`,
  });

  entries.push({
    label: 'Couleur — état de mer OMM',
    color: null,
    count: summary.stems,
    blurb: `La teinte suit l'échelle d'état de mer de l'OMM et porte, comme la hauteur, `
      + `la houle significative. REDONDANCE DÉLIBÉRÉE : une tige verticale vue à la `
      + `verticale n'a plus aucune longueur apparente, donc au nadir la couleur est la `
      + `seule lecture qui subsiste. Et les deux ne disent pas la même chose — la `
      + `hauteur donne le continu en mètres, la teinte donne la classe nommée que les `
      + `marins emploient. L'échelle compte neuf classes ; seules celles présentes dans `
      + `le relevé sont listées.`,
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
    },

    disable() {
      _enabled = false;
      detachCamera();
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(BUOY_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(BUOY_OVERLAY_SOURCE_ID, false);
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
