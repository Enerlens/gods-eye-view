/*
 * MEGAFIRE FIRE MATH — where the flame and smoke plumes go, and how they move.
 *
 * Pure: no Cesium, no DOM, no timers, no `Math.random`. The renderer
 * (`megafireFire.js`) owns billboards and textures; this module owns every
 * decision that can be wrong — which detections are burning at an instant,
 * how many plumes that is worth, which way the smoke leans, and where one
 * particle is a frame later. All of it is therefore unit-testable without a
 * GPU, which is the only way a hand-rolled particle field stays honest.
 *
 * ── WHY A HAND-ROLLED FIELD AND NOT `Cesium.ParticleSystem` ─────────────────
 *
 * Cesium's own particle system derives its per-frame delta from
 * `frameState.time`, i.e. from `viewer.clock`. This app never animates that
 * clock — it runs the scene in request-render mode and the app clock is frozen,
 * measured at ZERO ticks in a minute (see `megafireClock.js` and
 * `cameraVerbs.js:877`, which carries the same remark for the camera). A
 * `ParticleSystem` dropped into this scene therefore emits its first particles
 * and then stands perfectly still. Everything here runs on a wall-clock delta
 * instead, and one `BillboardCollection` carries every plume, so six plumes
 * cost one draw batch rather than twelve.
 *
 * ── WHAT IS MEASURED HERE AND WHAT IS DRAWN ─────────────────────────────────
 *
 * This is the first thing in the Gironde reconstruction that is not a
 * photo-interpreted polygon, so the line has to be drawn explicitly:
 *
 *   MEASURED — WHERE a plume stands. A plume exists only where NASA FIRMS
 *   detected a thermal anomaly within {@link MEGAFIRE_PLUME_HOURS} of the
 *   cursor, and its weight is that cluster's fire radiative power. No
 *   detections at the cursor, no plumes: the quiet days at the end of the
 *   window are quiet on screen too.
 *
 *   MEASURED — WHICH WAY the smoke leans. The drift bearing of a step is the
 *   direction its photo-interpreted flames moved between the previous
 *   Copernicus frame and this one, which is the direction the fire actually
 *   ran, which is downwind. It is read off the pack, never assumed.
 *
 *   DRAWN — everything else. Column height, puff size, rise rate, drift speed,
 *   the number of particles. Nobody measured the smoke column of this fire;
 *   these are a rendering of "a forest fire is burning here", scaled by a
 *   quantity that WAS measured. They are named as constants below so the
 *   invented half of the picture is countable — and the map's key says as much
 *   in as many words, on the one line of it that is a drawing.
 */

import { MEGAFIRE_FRP_LADDER } from './megafirePack.js';

/**
 * @constant {number} How recently FIRMS must have seen a pixel for a plume to
 * stand on it, in hours of event time.
 *
 * Twelve hours is two VIIRS revisits of this latitude, which is the smallest
 * window that does not blink a plume out between two passes of the same
 * satellite. It is also what makes plumes legible during playback: the window
 * replays in 24 s, so one wall-clock second is ten event-hours and a 12 h plume
 * is on screen for a little over a second — long enough to read as a fire head
 * walking north-west, short enough that the whole burn scar is never alight at
 * once. A 3 h window, which is what "burning right now" would mean if you were
 * standing there, flickers at 0.3 s.
 */
export const MEGAFIRE_PLUME_HOURS = 12;

/**
 * @constant {number} Grid pitch used to cluster detections into plumes, metres.
 *
 * A VIIRS pixel is 375 m across and an active fire head here ran several
 * kilometres wide, so 2.5 km groups a head into one plume without merging the
 * two ends of a 20 km front.
 */
export const MEGAFIRE_PLUME_CELL_M = 2500;

/**
 * @constant {number} Furthest a plume may SLIDE to its next position, metres.
 *
 * Below this the plume walks — which is the fire advancing, and the best thing
 * on screen. Above it, the cluster it was following has gone out and a
 * different one is now the nearest: the plume teleports rather than sliding
 * across 30 km of unburnt forest it never crossed.
 */
export const MEGAFIRE_PLUME_TELEPORT_M = 9000;

/** @constant {number} Seconds a plume takes to slide one whole {@link MEGAFIRE_PLUME_TELEPORT_M}. */
export const MEGAFIRE_PLUME_SLIDE_SECONDS = 1.6;

/**
 * @constant {number} Downwind speed given to smoke, metres per second OF
 * SCREEN TIME. DRAWN, not measured.
 *
 * Every rate in this file is per second of wall clock, and wall clock here is
 * not event time: the ten-day window replays in 24 s, so one screen second is
 * up to ten event hours. A smoke column that took half an hour to stand up has
 * to be drawn in the seven seconds a puff lives, which is why these numbers
 * look like hundreds of metres a second where a real plume rises at ten. What
 * is being matched is the SHAPE — the height, the width and the lean a
 * wind-driven crown fire makes — not the physics of getting there.
 *
 * THE SIZE IS SET BY THE READING DISTANCE, AND THAT IS NOT A LIBERTY. This fire
 * is 40 km across and is read from 40 to 100 km out, where one kilometre of
 * ground is about thirty pixels. The first version of this file drew a 1.4 km
 * column, which is a plausible column and forty pixels of screen: measured on a
 * real frame, it was invisible. The plume this fire actually made reached
 * several kilometres and its smoke was reported from Bordeaux, 50 km east — so
 * the honest figure and the legible one are the same one.
 *
 * At 1 400 m/s against {@link MEGAFIRE_SMOKE}'s rise, through the lean ramp in
 * {@link megafireStepParticle}, a puff ends its life about 7 km downwind of
 * 4 km up.
 */
export const MEGAFIRE_SMOKE_DRIFT_MS = 1400;

/**
 * @constant {number} Weakest cluster that still gets a plume, in megawatts of
 * freshness-weighted radiative power.
 *
 * Not a new number: it is the bottom rung of the pack's own frozen FRP ladder,
 * the boundary the layer already draws between "< 10 MW" and everything the
 * legend gives a name to. A cluster below the smallest class this layer is
 * willing to name is not a fire head.
 *
 * The floor is not cosmetic. At the close of the window — 1 August 12:44, the
 * instant the layer OPENS on — the pack still carries two cooling detections
 * worth 4 MW between them. Without a floor, a fire that was declared out three
 * days earlier raises a smoke column, and the render governor is held open for
 * the whole session on the default state of the layer. Measured: with it, the
 * closing frame emits nothing at all, and the reprises of 31 July (21, 19, 18,
 * 17 MW…) still burn.
 */
export const MEGAFIRE_PLUME_MIN_MW = MEGAFIRE_FRP_LADDER[1].min;

/** @constant {ReadonlyArray<number>} Plume budget, `[full, lite]`. */
export const MEGAFIRE_PLUME_BUDGET = Object.freeze([6, 3]);

/**
 * @constant {object} Smoke particle envelope. Sizes are metres on the ground,
 * speeds m/s, lives seconds of WALL clock (a puff is a puff whatever speed the
 * cursor runs at — tying it to event time would make smoke a strobe).
 */
export const MEGAFIRE_SMOKE = Object.freeze({
  life: 7,
  lifeJitter: 2.5,
  // ~4 000 m of column over a 7 s life. See MEGAFIRE_SMOKE_DRIFT_MS for why a
  // rate in this file is not a rate in the world, and why the column is this
  // tall rather than the ten-times-smaller one that was tried first.
  rise: 570,
  riseJitter: 260,
  spreadM: 350,
  // A PUFF MUST BE SMALLER THAN THE COLUMN IT BUILDS. The first attempt grew
  // one to 3 000 m against a 4 000 m column and a 7 000 m smear, so every plume
  // was a single soft blob the size of itself — measured on a frame, it read as
  // haze over the forest rather than as smoke coming off a fire. At a fifth of
  // the column's height the stack has structure, and it is the structure that
  // says "this is rising from there".
  startSize: 260,
  endSize: 1400,
  startAlpha: 0.72,
  // Grey-brown: a pine-forest crown fire makes dark smoke, and pure grey over a
  // red perimeter reads as cloud.
  startColor: Object.freeze([0.62, 0.57, 0.53]),
  endColor: Object.freeze([0.38, 0.36, 0.36]),
});

/**
 * @constant {object} Flame particle envelope. Short, small, bright, and it
 * never leaves the first hundred metres — the flame is what says "this is a
 * fire and not a factory", the smoke is what carries the distance.
 */
export const MEGAFIRE_FLAME = Object.freeze({
  life: 1.15,
  lifeJitter: 0.5,
  // ~200 m at the top of its life, an order of magnitude under the column
  // above it — the flame is the bright base, not the plume. Wide rather than
  // tall on purpose: what is burning is a head kilometres across, so half a
  // kilometre of glow at the foot of the column is the front, not a tree.
  rise: 170,
  riseJitter: 70,
  spreadM: 380,
  startSize: 260,
  endSize: 620,
  startAlpha: 0.95,
  startColor: Object.freeze([1.0, 0.86, 0.45]),
  endColor: Object.freeze([0.98, 0.28, 0.07]),
});

const HOUR_MS = 3600_000;
const DEG = Math.PI / 180;

/** Metres per degree of latitude at this fire's latitude. Matches `megafirePack.js`. */
const M_PER_DEG_LAT = 111132;

/**
 * Metres per degree of longitude at a latitude.
 * @param {number} lat - Degrees.
 * @returns {number} Metres.
 */
export function metresPerDegreeLon(lat) {
  return 111320 * Math.cos(lat * DEG);
}

/**
 * A seeded pseudo-random generator (mulberry32).
 *
 * Seeded and not `Math.random`, for two reasons that both matter: the unit
 * tests below assert on actual particle paths, and a reader who replays the
 * same ten days twice gets the same fire — a reconstruction whose picture
 * changes between viewings invites the question of what else changed.
 *
 * @param {number} seed - Any 32-bit integer.
 * @returns {() => number} Uniform in [0, 1).
 */
export function megafireRandom(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * How many plumes this machine draws.
 * @param {boolean} lite - The `lite` render profile.
 * @returns {number} Plume slots.
 */
export function megafirePlumeBudget(lite) {
  return MEGAFIRE_PLUME_BUDGET[lite ? 1 : 0];
}

/**
 * Cluster the detections that are burning at an instant into plume sites.
 *
 * Grid bucketing rather than k-means: it is O(n) over 9 524 detections, it is
 * deterministic (a tie between two equal buckets is broken by cell position,
 * not by iteration order), and the quantity it has to get right — roughly where
 * the fire heads are — does not reward anything cleverer at a 2.5 km pitch.
 *
 * The weight of a cluster is its summed fire radiative power, not its detection
 * count. Two hundred 1 MW pixels along a cooling flank are not the story; six
 * pixels at 300 MW at the head are.
 *
 * @param {ReadonlyArray<{lon: number, lat: number, frp: number, ms: number}>} detections
 * @param {number} cursorMs - Event instant.
 * @param {object} [options]
 * @param {number} [options.maxClusters] - Cap on returned sites.
 * @param {number} [options.cellM] - Grid pitch, metres.
 * @param {number} [options.horizonHours] - Freshness window.
 * @returns {Array<{lon: number, lat: number, weight: number, count: number}>}
 *   Strongest first, at most `maxClusters`.
 */
export function megafireFireClusters(detections, cursorMs, {
  maxClusters = MEGAFIRE_PLUME_BUDGET[0],
  cellM = MEGAFIRE_PLUME_CELL_M,
  horizonHours = MEGAFIRE_PLUME_HOURS,
} = {}) {
  if (!detections?.length || !Number.isFinite(cursorMs) || maxClusters <= 0) return [];
  const oldest = cursorMs - horizonHours * HOUR_MS;
  const buckets = new Map();
  for (const detection of detections) {
    const { ms } = detection;
    if (!(ms <= cursorMs) || ms < oldest) continue;
    const mPerLon = metresPerDegreeLon(detection.lat);
    const cx = Math.floor((detection.lon * mPerLon) / cellM);
    const cy = Math.floor((detection.lat * M_PER_DEG_LAT) / cellM);
    const key = `${cx}|${cy}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { cx, cy, lon: 0, lat: 0, weight: 0, count: 0 };
      buckets.set(key, bucket);
    }
    // A detection at the ember floor of its freshness window contributes less
    // than one the satellite saw minutes ago, so a plume dims as its head
    // moves on instead of switching off on a frame boundary.
    const freshness = 1 - (cursorMs - ms) / (horizonHours * HOUR_MS);
    const frp = Number.isFinite(detection.frp) ? Math.max(0.1, detection.frp) : 0.1;
    const weight = frp * (0.25 + 0.75 * freshness);
    bucket.lon += detection.lon * weight;
    bucket.lat += detection.lat * weight;
    bucket.weight += weight;
    bucket.count += 1;
  }
  const sites = [];
  for (const bucket of buckets.values()) {
    if (bucket.weight < MEGAFIRE_PLUME_MIN_MW) continue;
    sites.push({
      lon: bucket.lon / bucket.weight,
      lat: bucket.lat / bucket.weight,
      weight: bucket.weight,
      count: bucket.count,
      cx: bucket.cx,
      cy: bucket.cy,
    });
  }
  sites.sort((a, b) => (b.weight - a.weight) || (a.cx - b.cx) || (a.cy - b.cy));
  return sites.slice(0, maxClusters)
    .map(({ lon, lat, weight, count }) => ({ lon, lat, weight, count }));
}

/**
 * Match plume slots to clusters so a plume FOLLOWS the head it was on.
 *
 * The naive answer — slot `i` takes cluster `i` — reshuffles every plume the
 * moment two clusters swap rank, and a fire that teleports twice a second is
 * unreadable. This is a greedy nearest-first assignment instead: the strongest
 * cluster picks the slot already closest to it, and so on down. Slots left over
 * are told to stop emitting; they are not torn down, because their particles
 * have to finish burning and that trailing smoke is the record of where the
 * head has just been.
 *
 * @param {ReadonlyArray<{lon: number, lat: number, active: boolean}>} slots
 * @param {ReadonlyArray<{lon: number, lat: number, weight: number}>} clusters
 * @returns {Array<?{lon: number, lat: number, weight: number}>} One entry per
 *   slot, in slot order; null where the slot has no cluster.
 */
export function megafireAssignPlumes(slots, clusters) {
  const assignment = new Array(slots.length).fill(null);
  const taken = new Set();
  for (const cluster of clusters) {
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < slots.length; i += 1) {
      if (taken.has(i)) continue;
      const slot = slots[i];
      // An idle slot is free real estate; a live one is only stolen by a
      // cluster that is genuinely near it. `Infinity`-free so the comparison
      // stays total and the result deterministic.
      const score = slot.active
        ? megafireGroundDistanceM(slot, cluster)
        : MEGAFIRE_PLUME_TELEPORT_M * 4;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) break;
    taken.add(best);
    assignment[best] = cluster;
  }
  return assignment;
}

/**
 * Flat-earth ground distance between two lon/lat points, metres. Good to
 * better than a metre over the 90 km this pack spans.
 * @param {{lon: number, lat: number}} a
 * @param {{lon: number, lat: number}} b
 * @returns {number} Metres.
 */
export function megafireGroundDistanceM(a, b) {
  const mPerLon = metresPerDegreeLon((a.lat + b.lat) / 2);
  const dx = (a.lon - b.lon) * mPerLon;
  const dy = (a.lat - b.lat) * M_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

/**
 * Slide a plume towards its target, or teleport when the target is a different
 * fire altogether.
 *
 * @param {{lon: number, lat: number}} from - Mutated in place.
 * @param {{lon: number, lat: number}} to
 * @param {number} dtSec
 * @returns {boolean} True when the move was a teleport.
 */
export function megafireSlidePlume(from, to, dtSec) {
  const distance = megafireGroundDistanceM(from, to);
  if (distance > MEGAFIRE_PLUME_TELEPORT_M || distance <= 0) {
    from.lon = to.lon;
    from.lat = to.lat;
    return distance > MEGAFIRE_PLUME_TELEPORT_M;
  }
  const reach = (MEGAFIRE_PLUME_TELEPORT_M / MEGAFIRE_PLUME_SLIDE_SECONDS) * Math.max(0, dtSec);
  const fraction = reach >= distance ? 1 : reach / distance;
  from.lon += (to.lon - from.lon) * fraction;
  from.lat += (to.lat - from.lat) * fraction;
  return false;
}

/**
 * The direction the fire RAN into each Copernicus frame — which is downwind,
 * and which is the way the smoke leans.
 *
 * Read off the pack rather than from any wind product: the displacement of a
 * step's photo-interpreted active flames from the previous step's is a measured
 * quantity, published by the people who drew both. The first step has no
 * predecessor and borrows the second's; a step with no flames (the closing
 * frame has none) borrows the last one that had them, and draws nothing anyway.
 *
 * @param {ReadonlyArray<{flames?: ReadonlyArray<[number, number]>}>} steps
 * @returns {Array<{east: number, north: number}>} Unit vectors, one per step.
 */
export function megafireDriftVectors(steps) {
  const centroids = (steps || []).map((step) => {
    const flames = step?.flames;
    if (!flames?.length) return null;
    let lon = 0;
    let lat = 0;
    for (const [x, y] of flames) {
      lon += x;
      lat += y;
    }
    return { lon: lon / flames.length, lat: lat / flames.length };
  });
  const vectors = centroids.map(() => null);
  for (let i = 1; i < centroids.length; i += 1) {
    const from = centroids[i - 1];
    const to = centroids[i];
    if (!from || !to) continue;
    const east = (to.lon - from.lon) * metresPerDegreeLon((from.lat + to.lat) / 2);
    const north = (to.lat - from.lat) * M_PER_DEG_LAT;
    const length = Math.hypot(east, north);
    if (length > 1) vectors[i] = { east: east / length, north: north / length };
  }
  // Fill forwards then backwards, so every step has a direction and none of
  // them is a guess about a direction nobody measured.
  let last = null;
  for (let i = 0; i < vectors.length; i += 1) {
    if (vectors[i]) last = vectors[i];
    else if (last) vectors[i] = last;
  }
  last = null;
  for (let i = vectors.length - 1; i >= 0; i -= 1) {
    if (vectors[i]) last = vectors[i];
    else if (last) vectors[i] = last;
  }
  // A pack with no flames at all in any step: lean the smoke the way this fire
  // is known to have run, west-north-west out of Saumos towards the Cap-Ferret
  // peninsula. Unreachable with the shipped pack; kept so the renderer never
  // has to handle a null.
  // West-north-west, bearing 292.5° — the way this fire is known to have run,
  // out of Saumos towards the Cap-Ferret peninsula. Unit by construction, so a
  // renderer can multiply it by a speed without checking.
  return vectors.map((vector) => vector || { east: -0.92388, north: 0.38268 });
}

/**
 * Reset one particle to a freshly emitted state at a plume's base.
 *
 * Mutated in place and never allocated: this runs a few hundred times a second
 * on the main thread while a fire is on screen.
 *
 * @param {object} particle - Slot to overwrite.
 * @param {object} plume - `{lon, lat, drift, intensity}`.
 * @param {object} envelope - {@link MEGAFIRE_SMOKE} or {@link MEGAFIRE_FLAME}.
 * @param {() => number} random
 * @returns {void}
 */
export function megafireEmitParticle(particle, plume, envelope, random) {
  const angle = random() * Math.PI * 2;
  const radius = Math.sqrt(random()) * envelope.spreadM;
  particle.east = Math.cos(angle) * radius;
  particle.north = Math.sin(angle) * radius;
  particle.up = random() * 12;
  particle.age = 0;
  particle.life = envelope.life + (random() - 0.5) * envelope.lifeJitter;
  particle.rise = envelope.rise + (random() - 0.5) * envelope.riseJitter;
  // Every puff of one plume drifts the same way; the spread comes from where
  // it started and how fast it climbed, which is what a real column does.
  particle.driftEast = plume.drift.east;
  particle.driftNorth = plume.drift.north;
  particle.seed = random();
  // Every puff a different size, so a column is a mass rather than a stack of
  // identical objects. Multiplies the envelope, so the envelope keeps meaning
  // "the average puff".
  particle.sizeScale = 0.72 + random() * 0.62;
  particle.alive = true;
}

/**
 * Advance one particle by a wall-clock delta.
 *
 * @param {object} particle - Mutated in place.
 * @param {number} dtSec
 * @param {object} envelope - {@link MEGAFIRE_SMOKE} or {@link MEGAFIRE_FLAME}.
 * @param {number} driftMs - Downwind speed, m/s. Zero for flame.
 * @returns {boolean} True while the particle is still alive.
 */
export function megafireStepParticle(particle, dtSec, envelope, driftMs) {
  if (!particle.alive) return false;
  particle.age += dtSec;
  if (particle.age >= particle.life) {
    particle.alive = false;
    return false;
  }
  particle.up += particle.rise * dtSec;
  if (driftMs) {
    // Smoke accelerates downwind as it leaves the ground: at the base it is
    // still being pushed up by the fire, at a kilometre it is simply in the
    // wind. A linear ramp with height is the cheapest shape that leans the
    // column instead of shearing it off at the base.
    const lean = Math.min(1, particle.up / 1500);
    const speed = driftMs * (0.25 + 0.75 * lean);
    particle.east += particle.driftEast * speed * dtSec;
    particle.north += particle.driftNorth * speed * dtSec;
  }
  return true;
}

/**
 * How a particle looks right now.
 * @param {object} particle
 * @param {object} envelope
 * @param {number} intensity - Plume strength in [0, 1]; scales opacity only.
 * @returns {{size: number, alpha: number, r: number, g: number, b: number}}
 */
export function megafireParticleAppearance(particle, envelope, intensity = 1) {
  const t = particle.life > 0 ? Math.min(1, Math.max(0, particle.age / particle.life)) : 1;
  const size = (envelope.startSize + (envelope.endSize - envelope.startSize) * t)
    * (particle.sizeScale ?? 1);
  // Fade in over the first tenth of the life and out linearly over the rest: a
  // puff that appears at full opacity pops, and the pop is the single most
  // obvious tell that a fire is billboards. LINEAR out, not squared — squared
  // spends two thirds of a puff's life below a twentieth of an opacity that is
  // already fractional, and the column it builds never reaches a density a
  // reader would call smoke.
  const fadeIn = Math.min(1, t / 0.12);
  const fadeOut = 1 - t;
  const alpha = envelope.startAlpha * fadeIn * fadeOut * intensity;
  const [r0, g0, b0] = envelope.startColor;
  const [r1, g1, b1] = envelope.endColor;
  return {
    size,
    alpha,
    r: r0 + (r1 - r0) * t,
    g: g0 + (g1 - g0) * t,
    b: b0 + (b1 - b0) * t,
  };
}

/**
 * A cluster's weight as a plume intensity in [0, 1].
 *
 * Logarithmic, because fire radiative power is: this pack's detections run from
 * 0.3 MW to 1 573 MW, so a linear map would leave every plume but one at zero.
 * The reference is 400 MW — a cluster at that total is a plume at full size.
 *
 * @param {number} weight - Summed, freshness-scaled FRP in megawatts.
 * @returns {number} Intensity.
 */
export function megafirePlumeIntensity(weight) {
  if (!Number.isFinite(weight) || weight <= 0) return 0;
  return Math.min(1, Math.log10(1 + weight) / Math.log10(1 + 400));
}
