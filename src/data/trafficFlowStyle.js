/**
 * @file Pure styling helpers for live traffic flow — level → bucket/color/
 * speed/density. Cesium-free so thresholds are unit-testable; the traffic
 * layer maps buckets to Cesium colors at spawn time.
 *
 * `level` is TomTom's `traffic_level`: current speed / free-flow speed,
 * 0..1 where 1 = free flow. Non-finite input degrades to free-flow/neutral
 * everywhere — a road with unusable data must render like the simulation,
 * never as a phantom traffic jam.
 *
 * @module data/trafficFlowStyle
 */

import { CONGESTION_RUNGS } from './congestionLadder.js';

/**
 * The two cuts, as fractions of free-flow speed.
 *
 * EXPORTED because the key has to print them. Rule C1 asks for frozen domain
 * thresholds published in the panel, and a legend row reading "Ralenti" tells a
 * reader the word without telling them what earned it. `road-status-fr` shares
 * this block's ink and vocabulary and CANNOT share these numbers — its rungs
 * are an enumeration a human operator picks, not a ratio — so each block prints
 * its own cut under its own source. That is the honest form of one ladder read
 * two ways.
 * @type {{free: number, slow: number}}
 */
export const FLOW_THRESHOLDS = Object.freeze({
  /** Levels at/above this render as free-flowing. */
  free: 0.85,
  /** At/above this (and below `free`) is slow; below it is a jam. */
  slow: 0.55,
});

const FREE_THRESHOLD = FLOW_THRESHOLDS.free;
const SLOW_THRESHOLD = FLOW_THRESHOLDS.slow;

/** `#2ecc71` → `[46, 204, 113]`. Keeps the ladder as the single source. */
function rgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

/**
 * Bucket color palette as Cesium-free rgba tuples ([r, g, b] 0–255 + alpha 0–1).
 *
 * READ FROM {@link CONGESTION_RUNGS}, not typed: `road-status-fr` draws the
 * same three inks for the same three rungs, and the two used to hold private
 * copies — this one in decimal, that one in hex. One of them moving would have
 * left the fused row printing two greens for one meaning, which is exactly the
 * defect the ladder was extracted to end.
 * @type {{free:number[], slow:number[], jam:number[]}}
 */
export const FLOW_BUCKET_RGBA = {
  free: [...rgb(CONGESTION_RUNGS.free.color), 0.9],
  slow: [...rgb(CONGESTION_RUNGS.slow.color), 0.9],
  jam: [...rgb(CONGESTION_RUNGS.jam.color), 0.9],
};

/**
 * Classify a traffic level into a congestion bucket.
 * @param {number} level - traffic_level 0..1 (1 = free flow).
 * @returns {'free'|'slow'|'jam'} Bucket name; non-finite input → 'free'.
 */
export function flowBucket(level) {
  if (!Number.isFinite(level)) return 'free';
  if (level >= FREE_THRESHOLD) return 'free';
  if (level >= SLOW_THRESHOLD) return 'slow';
  return 'jam';
}

/**
 * rgba tuple for a traffic level (bucket palette lookup).
 * @param {number} level - traffic_level 0..1.
 * @returns {number[]} [r, g, b, a] with rgb 0–255, alpha 0–1.
 */
export function flowColor(level) {
  return FLOW_BUCKET_RGBA[flowBucket(level)];
}

/**
 * Dot speed multiplier for a traffic level. Jammed roads crawl but never
 * freeze (0.15 floor keeps the layer visibly alive); free flow is unchanged.
 * @param {number} level - traffic_level 0..1.
 * @returns {number} Multiplier within [0.15, 1]; non-finite input → 1.
 */
export function flowSpeedScale(level) {
  if (!Number.isFinite(level)) return 1;
  return Math.min(1, Math.max(0.15, level));
}

/**
 * Dot density multiplier for a traffic level — congestion means more cars on
 * the road, so slower roads pack more dots: 1/max(level, 0.4), capped at 2.5.
 *
 * With `jamBoost` (the jamViz density prototype) the same curve keeps
 * climbing through deep jams — 1/max(level, 0.25), capped at 4.0 — so
 * gridlock gets visibly denser while ordinary jams barely change. The two
 * curves are identical for level ≥ 0.4.
 *
 * @param {number} level - traffic_level 0..1.
 * @param {Object}  [opts]
 * @param {boolean} [opts.jamBoost=false] - Deepen the curve below the 2.5 cap.
 * @returns {number} Multiplier within [1, 2.5] (or [1, 4] boosted); non-finite input → 1.
 */
export function flowDensityMult(level, { jamBoost = false } = {}) {
  if (!Number.isFinite(level)) return 1;
  if (jamBoost) return Math.min(4, 1 / Math.max(level, 0.25));
  return Math.min(2.5, 1 / Math.max(level, 0.4));
}
