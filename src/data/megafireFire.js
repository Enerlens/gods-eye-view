/*
 * MEGAFIRE FIRE — the flame and smoke of the Gironde reconstruction.
 *
 * Every decision this file could get wrong lives next door in
 * `megafireFireMath.js`, which is pure and unit-tested. What is left here is
 * the part that needs a GPU: two sprites, two `BillboardCollection`s, and a
 * per-frame write of position, size and colour.
 *
 * ── WHY NOT `Cesium.ParticleSystem` ─────────────────────────────────────────
 *
 * It derives its per-frame delta from `frameState.time`, i.e. from
 * `viewer.clock`, and this app never animates that clock — request-render mode,
 * `shouldAnimate` false, measured at zero ticks in a minute. A `ParticleSystem`
 * dropped in here emits once and then stands still. Rolling the field by hand
 * on a `performance.now()` delta is the same trade the megafire cursor already
 * makes, and it buys two things beside: every plume shares ONE draw batch
 * instead of taking one each, and the whole simulation is testable in Node.
 *
 * ── THE THREE GATES, AND WHY A FIRE IS NOT FREE ─────────────────────────────
 *
 * Animated particles need a frame every frame, so this holds the render
 * governor open — the one thing in the repo that is allowed to cost a core.
 * That is bounded by three gates, all of which must be open:
 *
 *   1. DATA. A plume only stands where NASA FIRMS saw a thermal anomaly within
 *      twelve hours of the cursor. The layer opens on the CLOSING frame of
 *      1 August, where nothing was burning — so switching the layer on costs
 *      exactly nothing until the reader presses play or picks an earlier frame.
 *   2. DISTANCE. Nothing is emitted while the camera is further than
 *      {@link MEGAFIRE_FIRE_RANGE_M} from the fire. From orbit a kilometre of
 *      smoke is a third of a pixel, and the reader is looking at perimeters.
 *   3. PROFILE. `lite` halves the plume count AND the emission rate behind
 *      each one, so the field a weak machine draws is smaller in both
 *      dimensions that cost it — count and fill.
 *
 * When all three close, the hold is released and the app returns to idle.
 */

import * as Cesium from 'cesium';
import { governorRequestRender, holdContinuousRender, releaseContinuousRender } from '../renderGovernor.js';
import { isLiteProfile, profileCountBudget } from '../perfProfile.js';
import {
  MEGAFIRE_FLAME,
  MEGAFIRE_SMOKE,
  MEGAFIRE_SMOKE_DRIFT_MS,
  megafireAssignPlumes,
  megafireEmitParticle,
  megafireFireClusters,
  megafireParticleAppearance,
  megafirePlumeBudget,
  megafirePlumeIntensity,
  megafireRandom,
  megafireSlidePlume,
  megafireStepParticle,
} from './megafireFireMath.js';

/** @constant {string} Render-governor owner id. Distinct from the cursor's. */
export const MEGAFIRE_FIRE_HOLD = 'gironde-megafire-flames';

/**
 * @constant {number} How close the camera must be for anything to burn, metres.
 *
 * 400 km. The fire is 40 km across, so at this range it fills a fifth of the
 * screen and a 1 km smoke column is a couple of pixels — the last distance at
 * which a plume is a picture rather than a cost.
 */
export const MEGAFIRE_FIRE_RANGE_M = 400_000;

/** @constant {number} Ground height used where terrain has not loaded, metres. */
const GROUND_FALLBACK_M = 25;

/**
 * @constant {number} Particles emitted per second by a plume at full intensity.
 *
 * These are the `full` figures and they are scaled at init by
 * `profileCountBudget()`, the repo's own share for any count budget — because
 * that is exactly what this is. It matters more here than for a layer that
 * draws marks: a smoke puff is up to 1 150 m of translucent quad, so the fill
 * cost of the field is roughly linear in the emission rate, and `lite` is by
 * definition the machine that cannot pay for overdraw.
 */
const SMOKE_RATE = 30;
const FLAME_RATE = 30;

/** @type {number} Emission rates actually used, after the profile share. */
let _smokeRate = SMOKE_RATE;
let _flameRate = FLAME_RATE;

/** @constant {number} Base of the column, metres above the ground. */
const BASE_OFFSET_M = 8;

/** @constant {number} Longest a single frame may advance the field, seconds. */
const MAX_STEP_SEC = 0.1;

/**
 * @constant {number} How often the plume sites are recomputed, in wall-clock
 * seconds. Four times a second: the clusters walk with the cursor, and between
 * recomputes each plume SLIDES towards its site, so the picture moves smoothly
 * on a quarter of the clustering work.
 */
const RESITE_SEC = 0.25;

let _viewer = null;
let _enabled = false;
let _held = false;
let _smokeSprite = null;
let _flameSprite = null;
/** @type {?Cesium.BillboardCollection} */
let _smoke = null;
/** @type {?Cesium.BillboardCollection} */
let _flame = null;
/** @type {Array<object>} One entry per plume slot. */
let _plumes = [];
let _random = megafireRandom(0x6E1F1A);
let _lastResite = 0;
let _clusterCount = 0;
let _liveParticles = 0;
let _teleports = 0;

const _scratchLocal = new Cesium.Cartesian3();
const _scratchWorld = new Cesium.Cartesian3();
const _scratchTarget = new Cesium.Cartesian3();
const _scratchColor = new Cesium.Color();
const _scratchCarto = new Cesium.Cartographic();

/**
 * A puff sprite: an irregular cloud, not a disc.
 *
 * Returned as a DATA URL and not as the canvas itself, which is not a detail:
 * `BillboardCollection.add({image: <canvas>})` runs Cesium's `image` setter,
 * and that setter mints a `createGuid()` atlas key for anything that is not a
 * string. Six hundred billboards sharing one canvas would then take six hundred
 * 128x128 entries in the texture atlas — tens of megabytes of texture for one
 * sprite, reallocated as the atlas doubles. A string key is shared, so the
 * atlas holds exactly two entries: smoke and flame.
 *
 * WHY IT IS NOT A RADIAL GRADIENT. It was, and at 8 km the column visibly came
 * apart into circles — the oldest tell that a fire is billboards. A silhouette
 * built from overlapping blobs has no axis of symmetry to recognise, and with
 * the per-particle rotation `runSet` applies on emission, no two puffs in a
 * column present the same shape. The outer edge is still feathered by a mask:
 * a hard rim would put the billboard's own square back on screen.
 *
 * Seeded, so the sprite is the same in every session — this app's fire is
 * meant to be the same fire twice.
 *
 * @param {object} options
 * @param {number} options.blobs - Lobes composited into the silhouette.
 * @param {number} options.core - Opacity of the central lobe, 0..1.
 * @param {number} options.seed
 * @returns {?string} PNG data URL.
 */
function buildSprite({ blobs, core, seed }) {
  if (typeof document === 'undefined') return null;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const half = size / 2;
  const blob = (cx, cy, radius, alpha) => {
    const gradient = context.createRadialGradient(cx, cy, 0, cx, cy, radius);
    gradient.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
    gradient.addColorStop(0.5, `rgba(255, 255, 255, ${alpha * 0.6})`);
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  };
  blob(half, half, half * 0.62, core);
  const random = megafireRandom(seed);
  for (let i = 0; i < blobs; i += 1) {
    const radius = half * (0.26 + random() * 0.24);
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random()) * (half - radius) * 0.98;
    blob(half + Math.cos(angle) * distance, half + Math.sin(angle) * distance,
      radius, 0.55 + random() * 0.35);
  }
  // Feather the rim, so the silhouette is a cloud and not a cropped square.
  context.globalCompositeOperation = 'destination-in';
  const mask = context.createRadialGradient(half, half, 0, half, half, half);
  mask.addColorStop(0, 'rgba(255, 255, 255, 1)');
  mask.addColorStop(0.66, 'rgba(255, 255, 255, 1)');
  mask.addColorStop(0.88, 'rgba(255, 255, 255, 0.45)');
  mask.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = mask;
  context.fillRect(0, 0, size, size);
  context.globalCompositeOperation = 'source-over';
  return canvas.toDataURL('image/png');
}

/**
 * Build one plume slot: its particle pools and the billboards that draw them.
 * @param {number} index - Slot index.
 * @param {number} smokePool - Particles reserved for smoke.
 * @param {number} flamePool - Particles reserved for flame.
 * @see buildSprite for why `sprite` is a data URL rather than a canvas.
 * @returns {object} Slot.
 */
function buildPlume(index, smokePool, flamePool) {
  const make = (count, collection, sprite) => {
    const particles = [];
    for (let i = 0; i < count; i += 1) {
      particles.push({
        alive: false,
        age: 0,
        life: 1,
        east: 0,
        north: 0,
        up: 0,
        rise: 0,
        driftEast: 0,
        driftNorth: 0,
        seed: 0,
        sizeScale: 1,
        billboard: collection.add({
          position: Cesium.Cartesian3.ZERO,
          image: sprite,
          sizeInMeters: true,
          width: 1,
          height: 1,
          show: false,
        }),
      });
    }
    return particles;
  };
  return {
    index,
    lon: 0,
    lat: 0,
    height: GROUND_FALLBACK_M,
    active: false,
    intensity: 0,
    targetIntensity: 0,
    // Overwritten by the layer's measured vector on the first resite; this is
    // only what a plume leans before anyone has told it anything.
    drift: { east: -0.92388, north: 0.38268 },
    matrix: new Cesium.Matrix4(),
    matrixValid: false,
    smokeAcc: 0,
    flameAcc: 0,
    smoke: make(smokePool, _smoke, _smokeSprite),
    flame: make(flamePool, _flame, _flameSprite),
  };
}

/**
 * Install the collections and the plume pools. Idempotent.
 * @param {Cesium.Viewer} viewer
 * @returns {void}
 */
export function initMegafireFire(viewer) {
  if (_viewer || !viewer?.scene) return;
  _viewer = viewer;
  _smokeSprite = buildSprite({ blobs: 7, core: 0.62, seed: 0x5A17 });
  // Fewer lobes and a hot middle: a flame is a mass with a centre, smoke is a
  // mass without one.
  _flameSprite = buildSprite({ blobs: 4, core: 0.95, seed: 0x0F1A });
  if (!_smokeSprite || !_flameSprite) {
    // No canvas (a stubbed DOM in a unit test) — the layer still draws its
    // perimeters, hotspots and clock, and simply never catches fire.
    _viewer = null;
    return;
  }
  _smoke = new Cesium.BillboardCollection({
    scene: viewer.scene,
    blendOption: Cesium.BlendOption.TRANSLUCENT,
  });
  _flame = new Cesium.BillboardCollection({
    scene: viewer.scene,
    blendOption: Cesium.BlendOption.TRANSLUCENT,
  });
  _smoke.show = false;
  _flame.show = false;
  const budget = megafirePlumeBudget(isLiteProfile());
  _smokeRate = profileCountBudget(SMOKE_RATE);
  _flameRate = profileCountBudget(FLAME_RATE);
  // Pool = rate x longest life, with a fifth of headroom for the jitter. Sized
  // off the SCALED rate, so a `lite` machine allocates the smaller field
  // instead of allocating the big one and never filling it.
  const pool = (rate, envelope) => Math.ceil(
    rate * (envelope.life + envelope.lifeJitter / 2) * 1.2,
  );
  _plumes = [];
  for (let i = 0; i < budget; i += 1) {
    _plumes.push(buildPlume(i, pool(_smokeRate, MEGAFIRE_SMOKE), pool(_flameRate, MEGAFIRE_FLAME)));
  }
  viewer.scene.primitives.add(_smoke);
  viewer.scene.primitives.add(_flame);
}

/** Stop emitting, hide everything, and release the governor. */
function extinguish() {
  for (const plume of _plumes) {
    plume.active = false;
    plume.intensity = 0;
    plume.targetIntensity = 0;
    for (const set of [plume.smoke, plume.flame]) {
      for (const particle of set) {
        particle.alive = false;
        if (particle.billboard.show) particle.billboard.show = false;
      }
    }
  }
  _liveParticles = 0;
  _clusterCount = 0;
  if (_smoke) _smoke.show = false;
  if (_flame) _flame.show = false;
  if (_held) {
    releaseContinuousRender(MEGAFIRE_FIRE_HOLD);
    _held = false;
    governorRequestRender('megafire-fire-out');
  }
}

/**
 * Turn the fire on or off with the layer.
 * @param {boolean} enabled
 * @returns {void}
 */
export function setMegafireFireEnabled(enabled) {
  _enabled = Boolean(enabled) && Boolean(_viewer);
  if (!_enabled) extinguish();
}

/**
 * Is the camera close enough for anything to burn?
 * @param {{lon: number, lat: number}} centre - Fire centroid.
 * @returns {boolean}
 */
function cameraInRange(centre) {
  const camera = _viewer?.camera;
  if (!camera?.positionWC) return false;
  const target = Cesium.Cartesian3.fromDegrees(centre.lon, centre.lat, 0, undefined, _scratchTarget);
  return Cesium.Cartesian3.distance(camera.positionWC, target) <= MEGAFIRE_FIRE_RANGE_M;
}

/** Refresh a plume's east-north-up frame after it has moved. */
function reseat(plume) {
  const globe = _viewer?.scene?.globe;
  let ground = GROUND_FALLBACK_M;
  if (globe?.getHeight) {
    _scratchCarto.longitude = Cesium.Math.toRadians(plume.lon);
    _scratchCarto.latitude = Cesium.Math.toRadians(plume.lat);
    _scratchCarto.height = 0;
    const sampled = globe.getHeight(_scratchCarto);
    if (Number.isFinite(sampled)) ground = sampled;
  }
  plume.height = ground + BASE_OFFSET_M;
  Cesium.Transforms.eastNorthUpToFixedFrame(
    Cesium.Cartesian3.fromDegrees(plume.lon, plume.lat, plume.height),
    undefined,
    plume.matrix,
  );
  plume.matrixValid = true;
}

/**
 * Emit, step and paint one particle set of one plume.
 *
 * @param {object} plume - Slot.
 * @param {Array<object>} particles - Its pool for this set.
 * @param {object} envelope - `MEGAFIRE_SMOKE` or `MEGAFIRE_FLAME`.
 * @param {number} rate - Particles per second at full intensity.
 * @param {number} driftMs - Downwind speed; 0 for flame.
 * @param {number} dtSec - Wall-clock delta.
 * @param {'smokeAcc'|'flameAcc'} accKey - Which emission accumulator to spend.
 * @returns {number} Particles still alive in this set.
 */
function runSet(plume, particles, envelope, rate, driftMs, dtSec, accKey) {
  // Emission is accumulated rather than rounded per frame: at 22 particles a
  // second and a 16 ms frame that is 0.35 of a particle, and rounding would
  // emit either zero or one — a plume that pulses at frame rate.
  if (plume.active && plume.intensity > 0.02) {
    plume[accKey] += rate * plume.intensity * dtSec;
  }
  let budget = Math.floor(plume[accKey]);
  if (budget > 0) plume[accKey] -= budget;

  let alive = 0;
  for (let i = 0; i < particles.length; i += 1) {
    const particle = particles[i];
    const billboard = particle.billboard;
    if (!particle.alive) {
      if (budget > 0) {
        megafireEmitParticle(particle, plume, envelope, _random);
        // Set ONCE, on emission. One sprite drawn at one angle six hundred
        // times is a texture a reader learns; rotated per puff it is a cloud.
        billboard.rotation = particle.seed * Math.PI * 2;
        budget -= 1;
      } else {
        if (billboard.show) billboard.show = false;
        continue;
      }
    }
    if (!megafireStepParticle(particle, dtSec, envelope, driftMs)) {
      if (billboard.show) billboard.show = false;
      continue;
    }
    const look = megafireParticleAppearance(particle, envelope, plume.intensity);
    if (look.alpha <= 0.004) {
      if (billboard.show) billboard.show = false;
      continue;
    }
    _scratchLocal.x = particle.east;
    _scratchLocal.y = particle.north;
    _scratchLocal.z = particle.up;
    // Through the SETTER, from a scratch that is not the billboard's own
    // vector. Cesium's `position` getter hands back the live `_position`, and
    // writing a matrix product straight into it moves the particle without
    // ever marking the billboard dirty — the whole field would then be
    // uploaded once and never again.
    Cesium.Matrix4.multiplyByPoint(plume.matrix, _scratchLocal, _scratchWorld);
    billboard.position = _scratchWorld;
    billboard.width = look.size;
    billboard.height = look.size;
    _scratchColor.red = look.r;
    _scratchColor.green = look.g;
    _scratchColor.blue = look.b;
    _scratchColor.alpha = look.alpha;
    billboard.color = _scratchColor;
    billboard.show = true;
    alive += 1;
  }
  return alive;
}

/**
 * Advance the fire one frame.
 *
 * Called from the layer's `postRender` listener, which is the only cadence
 * that can be right — advancing a fire nobody is rendering is work with no
 * picture at the end of it.
 *
 * @param {object} options
 * @param {ReadonlyArray<{lon: number, lat: number, frp: number, ms: number}>}
 *   options.detections - The whole FIRMS pack; freshness is decided here.
 * @param {number} options.cursorMs - Event instant under the cursor.
 * @param {{east: number, north: number}} options.drift - Downwind unit vector.
 * @param {{lon: number, lat: number}} options.centre - Fire centroid, for the
 *   camera-range gate.
 * @param {number} options.dtSec - Wall-clock seconds since the last call.
 * @param {number} options.nowSec - Wall clock, seconds, for the resite timer.
 * @returns {boolean} True while anything is burning.
 */
export function updateMegafireFire({ detections, cursorMs, drift, centre, dtSec, nowSec }) {
  if (!_enabled || !_viewer || !_plumes.length) return false;
  if (!cameraInRange(centre)) {
    if (_liveParticles || _held) extinguish();
    return false;
  }
  const dt = Math.min(MAX_STEP_SEC, Math.max(0, dtSec) || 0);

  if (nowSec - _lastResite >= RESITE_SEC) {
    _lastResite = nowSec;
    const clusters = megafireFireClusters(detections, cursorMs, { maxClusters: _plumes.length });
    _clusterCount = clusters.length;
    const assignment = megafireAssignPlumes(_plumes, clusters);
    for (let i = 0; i < _plumes.length; i += 1) {
      const plume = _plumes[i];
      const cluster = assignment[i];
      if (!cluster) {
        // Stop EMITTING, do not tear down: the particles already in the air
        // finish burning, and that trailing smoke is the record of where this
        // head has just been.
        plume.active = false;
        plume.targetIntensity = 0;
        continue;
      }
      const wasActive = plume.active;
      plume.active = true;
      plume.targetIntensity = megafirePlumeIntensity(cluster.weight);
      plume.target = cluster;
      plume.drift = drift;
      if (!wasActive) {
        plume.lon = cluster.lon;
        plume.lat = cluster.lat;
        plume.matrixValid = false;
        // LIT, not ramped from zero. The ramp below needs frames; frames need
        // the governor hold; and the hold is taken because something is lit —
        // a plume that starts at intensity 0 emits nothing on the one frame it
        // is given, so nothing is lit, so no second frame ever comes and the
        // fire never starts. Measured: `burning: 3, particles: 0`, forever.
        plume.intensity = Math.max(plume.intensity, plume.targetIntensity * 0.25);
      }
    }
  }

  let live = 0;
  for (const plume of _plumes) {
    // Intensity follows its target over about a third of a second, so a plume
    // that loses half its detections dims instead of stepping.
    const chase = Math.min(1, dt / 0.35);
    plume.intensity += (plume.targetIntensity - plume.intensity) * chase;
    if (plume.active && plume.target) {
      if (megafireSlidePlume(plume, plume.target, dt)) _teleports += 1;
      plume.matrixValid = false;
    }
    if (!plume.matrixValid) reseat(plume);
    live += runSet(plume, plume.smoke, MEGAFIRE_SMOKE, _smokeRate,
      MEGAFIRE_SMOKE_DRIFT_MS, dt, 'smokeAcc');
    live += runSet(plume, plume.flame, MEGAFIRE_FLAME, _flameRate, 0, dt, 'flameAcc');
  }
  _liveParticles = live;

  const burning = live > 0;
  if (_smoke) _smoke.show = burning;
  if (_flame) _flame.show = burning;
  // The hold answers "is there a fire here", which is not the same question as
  // "is a particle on screen". A plume that has just been assigned a cluster
  // has no particles yet and needs the frames the hold buys to make any; a
  // plume that has just lost its cluster has no cluster and still has smoke in
  // the air that has to finish burning. Holding on EITHER covers both ends.
  const wanted = burning || _plumes.some((plume) => plume.active);
  if (wanted && !_held) {
    holdContinuousRender(MEGAFIRE_FIRE_HOLD);
    _held = true;
  } else if (!wanted && _held) {
    releaseContinuousRender(MEGAFIRE_FIRE_HOLD);
    _held = false;
    governorRequestRender('megafire-fire-out');
  }
  return burning;
}

/**
 * What the QA harness reads to prove a fire exists without looking at pixels.
 * @returns {{plumes: number, burning: number, particles: number,
 *   clusters: number, held: boolean, teleports: number, range: number}}
 */
export function megafireFireDiagnostics() {
  return {
    plumes: _plumes.length,
    burning: _plumes.filter((plume) => plume.active).length,
    particles: _liveParticles,
    clusters: _clusterCount,
    held: _held,
    teleports: _teleports,
    range: MEGAFIRE_FIRE_RANGE_M,
    smokeRate: _smokeRate,
    flameRate: _flameRate,
    pool: _plumes.reduce((sum, plume) => sum + plume.smoke.length + plume.flame.length, 0),
  };
}

/**
 * Remove both collections and forget every pool.
 * @param {Cesium.Viewer} viewer
 * @returns {void}
 */
export function destroyMegafireFire(viewer) {
  extinguish();
  for (const collection of [_smoke, _flame]) {
    if (!collection) continue;
    if (viewer?.scene?.primitives?.contains(collection)) viewer.scene.primitives.remove(collection);
    else if (!collection.isDestroyed?.()) collection.destroy?.();
  }
  _smoke = null;
  _flame = null;
  _smokeSprite = null;
  _flameSprite = null;
  _plumes = [];
  _viewer = null;
  _enabled = false;
  _lastResite = 0;
  _teleports = 0;
  _smokeRate = SMOKE_RATE;
  _flameRate = FLAME_RATE;
  _random = megafireRandom(0x6E1F1A);
}
