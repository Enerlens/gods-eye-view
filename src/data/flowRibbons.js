import * as Cesium from 'cesium';
import { flowBucket } from './trafficFlowStyle.js';
import { powerClassificationTypeForScene } from './powerGrid.js';

/**
 * @file TomTom flow drawn as ITSELF — the measurement, not a colour on someone
 * else's geometry.
 *
 * WHY THIS EXISTS. The traffic layer animates dots along OSM road polylines
 * (Overpass) and lets TomTom decide only their COLOUR. That made live
 * congestion a passenger: with Overpass slow or down, the flow tiles arrived,
 * decoded, and had nothing to paint on, so the layer sat on "syncing LIVE
 * traffic flow" indefinitely. Measured 2026-09-10 on the hosted origin,
 * `/api/overpass` answered 502 after 25 s while the two TomTom tiles covering
 * the same view fetched and decoded in ~200 ms and carried 3 447 polylines of
 * their own. This module draws those polylines.
 *
 * So the layer now has two independent halves that degrade separately:
 *  - the RIBBON (here) is the measurement, and needs only TomTom;
 *  - the DOTS are the animation, and still need Overpass.
 * Either can be on screen without the other.
 *
 * Rendering is the `roadStatusFrance.js` idiom: ONE batched
 * `GroundPolylinePrimitive`, colour AND width travelling per geometry instance
 * (`GroundPolylineGeometry` bakes its own width, `PolylineColorAppearance`
 * reads a per-instance colour attribute). 3 447 segments is one draw call.
 *
 * @module data/flowRibbons
 */

/**
 * @const {number} Hard cap on ribbon segments per render.
 *
 * Paris at the street band is 2 tiles and ~3 450 segments, so this is roughly
 * a 1.7× headroom rather than a routine truncation. Overflow drops the least
 * interesting first (see `rankRibbonSegments`): a cap must never be able to
 * hide a jam.
 */
export const RIBBON_SEGMENT_CAP = 6000;

/**
 * Per-bucket ribbon weight.
 *
 * Free flow is drawn THIN and faint on purpose. It is most of the network, and
 * a ribbon that shouts "everything is fine" in the same voice it uses for a
 * jam is a ribbon nobody reads. It still has to be drawn, though: a map that
 * only appears when there is trouble is indistinguishable from a broken one.
 *
 * `rank` is the eviction order under the cap — higher survives.
 */
export const RIBBON_BUCKETS = Object.freeze({
  closure: Object.freeze({ color: '#ff3b30', alpha: 0.95, width: 6, rank: 4 }),
  jam: Object.freeze({ color: '#e05252', alpha: 0.85, width: 5, rank: 3 }),
  slow: Object.freeze({ color: '#f0b23e', alpha: 0.70, width: 4, rank: 2 }),
  free: Object.freeze({ color: '#2ecc71', alpha: 0.32, width: 2, rank: 1 }),
});

/**
 * Width multiplier and importance rank by TomTom's own road class.
 *
 * The keys are the strings the tiles actually carry (verified against the
 * Austin fixture: Motorway, Major road, Secondary road, Major local road,
 * Connecting road). An unlisted class keeps width 1 and a middling rank rather
 * than vanishing — a road we cannot name is still a road.
 *
 * `rank` exists because a flow tile does not thin out with the camera. Measured
 * over Paris 2026-09-10: the four z10 tiles covering the metro band's 0.30° box
 * decode 27 080 segments, nearly all of them streets that are sub-pixel from
 * 20 km up. The band filters on this the same way it already filters the
 * Overpass query down to arterials.
 */
const ROAD_CLASS = Object.freeze({
  Motorway: Object.freeze({ width: 1.6, rank: 5 }),
  'International road': Object.freeze({ width: 1.35, rank: 4 }),
  'Major road': Object.freeze({ width: 1.35, rank: 4 }),
  'Secondary road': Object.freeze({ width: 1.1, rank: 3 }),
  'Major local road': Object.freeze({ width: 1, rank: 2 }),
  'Connecting road': Object.freeze({ width: 0.85, rank: 1 }),
  'Local road': Object.freeze({ width: 0.75, rank: 1 }),
});
/** @const {{width:number, rank:number}} Presentation for a class this build has never seen. */
const UNKNOWN_ROAD_CLASS = Object.freeze({ width: 1, rank: 2 });

/**
 * Classify one decoded flow segment for the ribbon.
 *
 * Closure outranks level because a closed road has no meaningful speed: the
 * decoder already reports `trafficLevel: 0` for one, which `flowBucket` would
 * otherwise render as an ordinary jam.
 *
 * @param {{trafficLevel:number, closure:boolean, roadType:string}} segment
 * @returns {{bucket:'closure'|'jam'|'slow'|'free', width:number, rank:number, classRank:number}}
 */
export function ribbonStyle(segment) {
  const bucket = segment?.closure === true ? 'closure' : flowBucket(segment?.trafficLevel);
  const spec = RIBBON_BUCKETS[bucket] || RIBBON_BUCKETS.free;
  const roadClass = ROAD_CLASS[segment?.roadType] || UNKNOWN_ROAD_CLASS;
  return {
    bucket: RIBBON_BUCKETS[bucket] ? bucket : 'free',
    width: Math.max(1, Math.round(spec.width * roadClass.width)),
    rank: spec.rank,
    classRank: roadClass.rank,
  };
}

/**
 * Order segments worst-first and truncate to `cap`.
 *
 * Within a bucket the longer segment wins, for the same reason the heat-lines
 * sort that way: a 2 km stretch of jam is the one a reader is looking for and
 * a 30 m stub of it is noise. Sorting a copy — the caller's array is a decode
 * cache entry shared with the road matcher.
 *
 * @param {Array<object>} segments - Decoded flow segments.
 * @param {number} [cap=RIBBON_SEGMENT_CAP]
 * @param {number} [minClassRank=0] - Drop road classes below this rank BEFORE
 *   the cap. Filtering by importance is not the same as truncating by count:
 *   the band knows a residential street is sub-pixel, the cap only knows there
 *   are too many.
 * @returns {{kept:Array<{segment:object, style:object}>, dropped:number, filtered:number}}
 */
export function rankRibbonSegments(segments, cap = RIBBON_SEGMENT_CAP, minClassRank = 0) {
  const scored = [];
  let filtered = 0;
  for (const segment of Array.isArray(segments) ? segments : []) {
    const coords = segment?.coords;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const style = ribbonStyle(segment);
    if (style.classRank < minClassRank) { filtered += 1; continue; }
    scored.push({ segment, style, points: coords.length });
  }
  if (scored.length <= cap) return { kept: scored, dropped: 0, filtered };
  scored.sort((a, b) => (b.style.rank - a.style.rank) || (b.points - a.points));
  return { kept: scored.slice(0, cap), dropped: scored.length - cap, filtered };
}

/**
 * Flatten a [[lon,lat],…] polyline into the flat degrees array Cesium wants.
 * Returns null for anything that would not tessellate.
 *
 * @param {number[][]} coords
 * @returns {?number[]}
 */
export function flattenRibbonCoords(coords) {
  const flat = [];
  let last = null;
  for (const point of coords) {
    const lon = Number(point?.[0]);
    const lat = Number(point?.[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    // A repeated vertex makes GroundPolylineGeometry throw; TomTom emits them
    // where two tile-clipped pieces meet.
    if (last && last[0] === lon && last[1] === lat) continue;
    flat.push(lon, lat);
    last = [lon, lat];
  }
  return flat.length >= 4 ? flat : null;
}

/**
 * Build the geometry instances for one ribbon render.
 *
 * Split out from `renderFlowRibbons` so the whole selection + styling path can
 * be exercised without a GL context — only `GroundPolylinePrimitive.isSupported`
 * needs one, and it is not called here.
 *
 * @param {Array<object>} segments - Decoded flow segments.
 * @param {Object} [opts]
 * @param {(bucket:string)=>?string} [opts.colorFor] - Override a bucket's CSS
 *   colour (the layer passes its preset-aware palette so the ribbon follows
 *   NVG/FLIR the way the dots do). Returning null keeps the shipped colour.
 * @param {number} [opts.cap=RIBBON_SEGMENT_CAP]
 * @param {number} [opts.minClassRank=0] - Road-class floor; see `rankRibbonSegments`.
 * @returns {{instances:Array, counts:Object<string,number>, dropped:number, filtered:number}}
 */
export function buildRibbonInstances(
  segments,
  { colorFor = null, cap = RIBBON_SEGMENT_CAP, minClassRank = 0 } = {},
) {
  const { kept, dropped, filtered } = rankRibbonSegments(segments, cap, minClassRank);
  const instances = [];
  const counts = { closure: 0, jam: 0, slow: 0, free: 0 };
  for (const { segment, style } of kept) {
    const flat = flattenRibbonCoords(segment.coords);
    if (!flat) continue;
    const spec = RIBBON_BUCKETS[style.bucket];
    const css = (colorFor && colorFor(style.bucket)) || spec.color;
    instances.push(new Cesium.GeometryInstance({
      geometry: new Cesium.GroundPolylineGeometry({
        positions: Cesium.Cartesian3.fromDegreesArray(flat),
        width: style.width,
      }),
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(
          Cesium.Color.fromCssColorString(css).withAlpha(spec.alpha),
        ),
      },
    }));
    counts[style.bucket] += 1;
  }
  return { instances, counts, dropped, filtered };
}

/** @type {?boolean} `GroundPolylinePrimitive.isSupported`, checked once per page. */
let _supported = null;

/**
 * Replace the ribbon in the scene with one built from `segments`.
 *
 * Returns the new primitive (or null) plus the per-bucket tally the legend
 * reads, so the caller owns the handle and this module owns no scene state
 * beyond the one-shot support probe.
 *
 * @param {Cesium.Viewer} viewer
 * @param {?Cesium.GroundPolylinePrimitive} previous - Primitive to remove first.
 * @param {Array<object>} segments - Decoded flow segments ([] clears).
 * @param {Object} [opts] - Forwarded to `buildRibbonInstances`, plus `show`.
 * @returns {{primitive:?object, counts:Object<string,number>, dropped:number}}
 */
export function renderFlowRibbons(viewer, previous, segments, opts = {}) {
  const empty = {
    primitive: null, counts: { closure: 0, jam: 0, slow: 0, free: 0 }, dropped: 0, filtered: 0,
  };
  if (previous) viewer?.scene?.groundPrimitives?.remove?.(previous);
  if (!viewer || !Array.isArray(segments) || segments.length === 0) return empty;

  if (_supported === null) {
    _supported = Cesium.GroundPolylinePrimitive.isSupported(viewer.scene);
    if (!_supported) {
      console.warn('[Data:Traffic] GroundPolylinePrimitive unsupported — flow ribbon disabled');
    }
  }
  if (!_supported) return empty;

  const { instances, counts, dropped, filtered } = buildRibbonInstances(segments, opts);
  if (instances.length === 0) return empty;

  const primitive = viewer.scene.groundPrimitives.add(new Cesium.GroundPolylinePrimitive({
    geometryInstances: instances,
    classificationType: powerClassificationTypeForScene(viewer.scene),
    appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
  }));
  primitive.show = opts.show !== false;
  if (dropped) {
    console.log(`[Data:Traffic] Flow ribbon capped at ${instances.length} (${dropped} segments dropped)`);
  }
  return { primitive, counts, dropped, filtered };
}

/**
 * Remove a ribbon primitive from the scene.
 * @param {Cesium.Viewer} viewer
 * @param {?object} primitive
 * @returns {null} Always null, so callers can assign the result.
 */
export function clearFlowRibbons(viewer, primitive) {
  if (primitive) viewer?.scene?.groundPrimitives?.remove?.(primitive);
  return null;
}

/** Reset the one-shot support probe (tests only). */
export function resetFlowRibbonSupport() {
  _supported = null;
}
