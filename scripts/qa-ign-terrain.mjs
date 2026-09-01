#!/usr/bin/env node
/**
 * The IGN terrain SPIKE's decision instrument.
 *
 *   node scripts/qa-ign-terrain.mjs
 *
 * The spike in `src/data/ignBilTerrain.js` exists to answer one question with
 * numbers instead of opinions: is the full terrain chantier worth financing?
 * This script produces the numbers. It talks to the live Géoplateforme, so it
 * needs network but no credential, no dev server, and no browser.
 *
 * Four exit criteria, in the order the plan set them:
 *
 *   1. SEAMS      — do neighbouring tiles agree at their shared edge at z12-14?
 *                   Reported raw (what the service sends) AND after the
 *                   edge-inclusive resample, because the delta between those
 *                   two numbers is the whole argument for that function.
 *   2. CONTROL    — asymmetric ground truth: the Mont Blanc summit (4805.6 m
 *                   orthometric) and the sea surface at Nice.
 *   3. FAILURE    — the three shapes that break naive code: an all-NoData tile,
 *                   a mixed tile, and the 137-byte 404 body.
 *   4. COST       — decode wall time and resident bytes per tile.
 *
 * `--json <path>` also writes the raw measurements.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import {
  decodeBilTile,
  resampleToEdgeInclusive,
  isRealElevationSample,
  validateBilResponse,
  ignBilTileUrl,
} from '../src/data/ignBilTerrain.js';
import { ensureGeoidReady, geoidHeight } from '../src/data/geoid.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const jsonArg = argv.indexOf('--json');
const jsonPath = jsonArg >= 0 ? path.resolve(repoRoot, argv[jsonArg + 1]) : null;

const SOURCE_SIZE = 256;
/** `WGS84G` level L has 2·2^L columns and 2^L rows over the whole globe. */
const tileSpanDeg = (level) => 360 / (2 * 2 ** level);
const tileColFor = (lonDeg, level) => Math.floor((lonDeg + 180) / tileSpanDeg(level));
const tileRowFor = (latDeg, level) => Math.floor((90 - latDeg) / tileSpanDeg(level));
const tileRectDeg = (col, row, level) => {
  const span = tileSpanDeg(level);
  return {
    west: -180 + col * span,
    east: -180 + (col + 1) * span,
    north: 90 - row * span,
    south: 90 - (row + 1) * span,
  };
};

const failures = [];
const missedTargets = [];
const results = {};
/** A HARD criterion. Missing one is a reason not to fund the chantier as scoped. */
const check = (name, passed, detail = '') => {
  console.log(`  [${passed ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (!passed) failures.push(name);
};
/**
 * A TARGET: a number worth aiming at that does not by itself sink the design.
 *
 * Kept separate from `check` on purpose. A spike whose only outcomes are PASS
 * and FAIL invites two bad habits — quietly widening a threshold until it goes
 * green, or failing the whole run on a residual that is understood and
 * acceptable. A missed target is printed with its measurement and carried into
 * the summary, so it becomes a documented caveat instead of either.
 */
const target = (name, met, detail = '') => {
  console.log(`  [${met ? 'MET ' : 'MISS'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (!met) missedTargets.push(`${name} (${detail})`);
};
const note = (label, detail) => console.log(`  [DATA] ${label} — ${detail}`);

/** Fetches one BIL tile and reports what the guard would decide about it. */
async function fetchTile(col, row, level) {
  const response = await fetch(ignBilTileUrl(col, row, level));
  const buffer = await response.arrayBuffer();
  const validation = validateBilResponse({
    ok: response.ok,
    status: response.status,
    contentType: response.headers.get('content-type') || '',
    byteLength: buffer.byteLength,
  });
  return {
    col,
    row,
    level,
    status: response.status,
    contentType: response.headers.get('content-type') || '',
    contentLength: Number(response.headers.get('content-length')) || null,
    contentEncoding: response.headers.get('content-encoding') || null,
    byteLength: buffer.byteLength,
    validation,
    buffer,
    samples: validation.valid ? new Float32Array(buffer) : null,
  };
}

const absStats = (values) => {
  let sum = 0;
  let max = 0;
  for (const value of values) {
    const magnitude = Math.abs(value);
    sum += magnitude;
    if (magnitude > max) max = magnitude;
  }
  return { mean: sum / values.length, max, n: values.length };
};
const fmt = (value, digits = 3) => (Number.isFinite(value) ? value.toFixed(digits) : String(value));

await ensureGeoidReady();

// ── 1. Seams ────────────────────────────────────────────────────────────────
// The Alps at z12-14: the steepest real relief in the coverage, so a
// registration error shows at its largest here rather than being averaged away
// on a plain. Two pairs per level — one east-west, one north-south.
console.log('\n1. SEAM CONTINUITY (Alps, Mont Blanc massif)');
results.seams = [];
for (const level of [12, 13, 14]) {
  const col = tileColFor(6.8652, level);
  const row = tileRowFor(45.8326, level);
  const [here, east, south] = await Promise.all([
    fetchTile(col, row, level),
    fetchTile(col + 1, row, level),
    fetchTile(col, row + 1, level),
  ]);
  if (!here.validation.valid || !east.validation.valid || !south.validation.valid) {
    check(`z${level} seam pair fetched`, false, 'one of the three tiles did not validate');
    continue;
  }

  // RAW: the service's own cell-centre grids, compared column-to-column. This
  // is what a naive HeightmapTerrainData feed produces at the boundary.
  const rawEast = [];
  const rawSouth = [];
  for (let i = 0; i < SOURCE_SIZE; i += 1) {
    rawEast.push(here.samples[i * SOURCE_SIZE + (SOURCE_SIZE - 1)] - east.samples[i * SOURCE_SIZE]);
    rawSouth.push(here.samples[(SOURCE_SIZE - 1) * SOURCE_SIZE + i] - south.samples[i]);
  }
  // For scale: the step between two ADJACENT samples inside one tile, measured
  // PER AXIS. A raw seam error of about this size is the signature of a
  // one-cell offset, not of noise.
  //
  // Per axis and not once, because `WGS84G` cells are square in DEGREES and
  // therefore not square on the ground: at 45.8 N a degree of longitude is
  // ~0.70 of a degree of latitude, so a north-south cell covers ~1.4x the
  // ground an east-west one does and carries a proportionally larger height
  // step. Dividing the N-S seam by the E-W step compares two different
  // distances and makes the northern seam look worse than it is.
  const internalEastWest = [];
  const internalNorthSouth = [];
  for (let i = 0; i < SOURCE_SIZE; i += 1) {
    internalEastWest.push(
      here.samples[i * SOURCE_SIZE + (SOURCE_SIZE - 1)] - here.samples[i * SOURCE_SIZE + (SOURCE_SIZE - 2)],
    );
    internalNorthSouth.push(
      here.samples[(SOURCE_SIZE - 1) * SOURCE_SIZE + i] - here.samples[(SOURCE_SIZE - 2) * SOURCE_SIZE + i],
    );
  }

  // RESAMPLED: the same tiles through the edge-inclusive re-gridding the
  // provider actually uses.
  const OUT = 65;
  const grid = (tile) => resampleToEdgeInclusive(tile.samples, SOURCE_SIZE, OUT);
  const [gHere, gEast, gSouth] = [grid(here), grid(east), grid(south)];
  const fixedEast = [];
  const fixedSouth = [];
  for (let i = 0; i < OUT; i += 1) {
    fixedEast.push(gHere[i * OUT + (OUT - 1)] - gEast[i * OUT]);
    fixedSouth.push(gHere[(OUT - 1) * OUT + i] - gSouth[i]);
  }

  const entry = {
    level,
    rawEastWest: absStats(rawEast),
    rawNorthSouth: absStats(rawSouth),
    internalStepEastWest: absStats(internalEastWest),
    internalStepNorthSouth: absStats(internalNorthSouth),
    fixedEastWest: absStats(fixedEast),
    fixedNorthSouth: absStats(fixedSouth),
  };
  results.seams.push(entry);
  note(
    `z${level} raw`,
    `E-W mean ${fmt(entry.rawEastWest.mean)} m / max ${fmt(entry.rawEastWest.max)} m · `
    + `N-S mean ${fmt(entry.rawNorthSouth.mean)} m / max ${fmt(entry.rawNorthSouth.max)} m · `
    + `internal sample step E-W ${fmt(entry.internalStepEastWest.mean)} m / `
    + `N-S ${fmt(entry.internalStepNorthSouth.mean)} m`,
  );
  note(
    `z${level} resampled`,
    `E-W mean ${fmt(entry.fixedEastWest.mean)} m / max ${fmt(entry.fixedEastWest.max)} m · `
    + `N-S mean ${fmt(entry.fixedNorthSouth.mean)} m / max ${fmt(entry.fixedNorthSouth.max)} m`,
  );

  // The bar is RELATIVE to the terrain's own roughness, not a fixed number of
  // metres, because "is this crack visible" is not an absolute question: a
  // discontinuity smaller than the step between two neighbouring samples is
  // indistinguishable from real relief, while one the size of a full cell step
  // is the signature of a registration offset and reads as a wall.
  //
  // An absolute bar would also be the wrong shape here. One z12 cell is ~38 m
  // of Alpine ground and one z14 cell ~9.5 m, so the same metre count means
  // something different at each level, and the camera is correspondingly
  // further away at z12.
  const stepEW = entry.internalStepEastWest.mean;
  const stepNS = entry.internalStepNorthSouth.mean;
  entry.meanAsFractionOfStep = Math.max(
    entry.fixedEastWest.mean / stepEW,
    entry.fixedNorthSouth.mean / stepNS,
  );
  entry.maxAsFractionOfStep = Math.max(
    entry.fixedEastWest.max / stepEW,
    entry.fixedNorthSouth.max / stepNS,
  );
  entry.rawMeanAsFractionOfStep = Math.max(
    entry.rawEastWest.mean / stepEW,
    entry.rawNorthSouth.mean / stepNS,
  );
  note(
    `z${level} vs terrain roughness`,
    `seam mean is ${fmt(100 * entry.meanAsFractionOfStep, 1)} % of one sample step, `
    + `worst vertex ${fmt(100 * entry.maxAsFractionOfStep, 1)} % `
    + `(raw was ${fmt(100 * entry.rawMeanAsFractionOfStep, 1)} % — a full cell offset)`,
  );
  // TARGET, not a gate: an average seam under a tenth of the terrain's own
  // sample-to-sample step. Aimed at before the measurements were taken, and
  // left where it was afterwards.
  target(
    `z${level} average seam under 10 % of the terrain's own roughness`,
    entry.meanAsFractionOfStep < 0.1,
    `${fmt(100 * entry.meanAsFractionOfStep, 1)} % of a sample step`,
  );
  // HARD: no vertex may carry a full-cell offset. That is the registration bug
  // itself, and it is what reads as a wall rather than as relief.
  check(
    `z${level} not one vertex carries a full-cell offset`,
    entry.maxAsFractionOfStep < 1,
    `worst vertex is ${fmt(100 * entry.maxAsFractionOfStep, 1)} % of a sample step`,
  );
  check(
    `z${level} the resample is a real improvement, not a rounding change`,
    entry.meanAsFractionOfStep < entry.rawMeanAsFractionOfStep / 4,
    `${fmt(100 * entry.rawMeanAsFractionOfStep, 1)} % -> ${fmt(100 * entry.meanAsFractionOfStep, 1)} % of a sample step`,
  );
}

// ── 2. Control points ───────────────────────────────────────────────────────
// Asymmetric on purpose: the highest point in the coverage and a sea surface.
// A pipeline that is silently off by a datum passes one and fails the other.
console.log('\n2. CONTROL POINTS');
results.control = [];
const CONTROL = [
  {
    name: 'Mont Blanc summit',
    lat: 45.832622,
    lon: 6.865175,
    level: 14,
    expectOrthometricM: 4805.6,
    // 1 % of the height, not a metre count, and it is a RENDER-FIDELITY bar,
    // not an accuracy claim. Measured: this service tops out at 4778.8 m over
    // the massif — 26.8 m below IGN's own 4805.6 m ice summit, and still 13 m
    // below the 4792 m rock summit. That ceiling is a property of the published
    // product, not of sampling: the neighbouring eight z14 tiles are all lower,
    // and z10 through z13 converge on the same 4771-4779 m. So the honest
    // reading is "the model contains the right mountain, ~27 m short at the
    // apex", which is invisible in a viewer and disqualifying for measurement.
    // Anything past 1 % would mean the massif itself is wrong.
    toleranceM: 48,
    // A 4.3 m grid over a sharp ice dome does not put the apex in the cell
    // nearest the published coordinate. Reading the tile MAXIMUM asks the fair
    // question — "does the model contain this summit" — instead of testing
    // whether a floor() landed on the right cell.
    readTileMaximum: true,
  },
  {
    name: 'Mediterranean surface off Nice',
    lat: 43.6800,
    lon: 7.2800,
    level: 14,
    // Sea is NoData in RGE ALTI, so this exercises the SUBSTITUTION path: the
    // H = 0 geoid prior. Getting the sea to come out at the geoid is the whole
    // point — an unconverted pipeline puts the Mediterranean 47 m underground.
    expectOrthometricM: 0,
    toleranceM: 3,
    expectNodata: true,
  },
];
for (const point of CONTROL) {
  const col = tileColFor(point.lon, point.level);
  const row = tileRowFor(point.lat, point.level);
  const tile = await fetchTile(col, row, point.level);
  if (!tile.validation.valid) {
    check(`${point.name} tile is readable`, false, tile.validation.reason);
    continue;
  }
  const rect = tileRectDeg(col, row, point.level);
  const decoded = decodeBilTile(tile.buffer, rect, 65);

  // The service's own number, untouched by this code.
  const spanLon = (rect.east - rect.west) / SOURCE_SIZE;
  const spanLat = (rect.north - rect.south) / SOURCE_SIZE;
  const sampleCol = Math.min(SOURCE_SIZE - 1, Math.max(0, Math.floor((point.lon - rect.west) / spanLon)));
  const sampleRow = Math.min(SOURCE_SIZE - 1, Math.max(0, Math.floor((rect.north - point.lat) / spanLat)));
  const nearest = tile.samples[sampleRow * SOURCE_SIZE + sampleCol];
  let tileMaximum = -Infinity;
  for (const value of tile.samples) if (isRealElevationSample(value) && value > tileMaximum) tileMaximum = value;
  const raw = point.readTileMaximum && Number.isFinite(tileMaximum) ? tileMaximum : nearest;
  const isNodata = !isRealElevationSample(raw);
  const orthometric = isNodata ? 0 : raw;

  // And the ELLIPSOIDAL value the mesh actually carries at that spot.
  const outCol = Math.round(((point.lon - rect.west) / (rect.east - rect.west)) * 64);
  const outRow = Math.round(((rect.north - point.lat) / (rect.north - rect.south)) * 64);
  const meshed = decoded.heights[outRow * 65 + outCol];
  const undulation = geoidHeight(point.lat, point.lon);

  const entry = {
    ...point,
    rawSampleM: raw,
    nearestSampleM: nearest,
    tileMaximumM: Number.isFinite(tileMaximum) ? tileMaximum : null,
    deltaFromTruthM: raw - point.expectOrthometricM,
    isNodata,
    orthometricM: orthometric,
    geoidUndulationM: undulation,
    meshedEllipsoidalM: meshed,
    nodataPct: (100 * decoded.nodataCount) / (SOURCE_SIZE * SOURCE_SIZE),
  };
  results.control.push(entry);
  note(
    point.name,
    `read ${fmt(raw, 1)} m${isNodata ? ' (NoData -> H=0)' : ''} `
    + `(${fmt(entry.deltaFromTruthM, 1)} m vs the published ${point.expectOrthometricM} m) · `
    + `N ${fmt(undulation, 2)} m · meshed ellipsoidal ${fmt(meshed, 2)} m · `
    + `tile NoData ${fmt(entry.nodataPct, 1)} %`,
  );

  check(
    `${point.name}: orthometric height is within ${point.toleranceM} m of ground truth`,
    Math.abs(orthometric - point.expectOrthometricM) <= point.toleranceM,
    `${fmt(orthometric, 1)} m vs ${point.expectOrthometricM} m `
    + `(${fmt(entry.deltaFromTruthM, 1)} m)`,
  );
  if (point.expectNodata !== undefined) {
    check(`${point.name}: NoData classification is ${point.expectNodata}`, isNodata === point.expectNodata,
      `raw ${fmt(raw, 1)} m`);
  }
  // The mesh must carry h = H + N. If this fails the datum conversion is not
  // running, and every height on the globe is out by up to ~50 m in France.
  // The datum check must compare the SAME PLACE. `orthometric` may be the tile
  // maximum (the summit-presence reading, deliberately from wherever the apex
  // is); the meshed value is at the requested coordinate. Comparing those two
  // would measure the mountain's slope, not the datum.
  const nearestOrthometric = isRealElevationSample(nearest) ? nearest : 0;
  check(
    `${point.name}: the meshed height is ellipsoidal (h = H + N), not orthometric`,
    Math.abs(meshed - (nearestOrthometric + undulation)) <= 2,
    `meshed ${fmt(meshed, 2)} m vs H+N ${fmt(nearestOrthometric + undulation, 2)} m `
    + `at the same point`,
  );
}

// ── 3. Failure shapes ───────────────────────────────────────────────────────
console.log('\n3. FAILURE SHAPES (the cases that break naive code)');
results.failures = [];
const FAILURE_CASES = [
  { name: 'Breton coast z14 (open sea inside coverage)', lat: 48.30, lon: -4.90, level: 14, expect: 'all-nodata' },
  // A genuinely INTERLEAVED tile, which is the case that kills per-tile
  // fallbacks: 69 % of it is sea and the rest is the Estérel massif, so any
  // "the tile is mostly NoData, flatten it" shortcut destroys real relief.
  { name: "Côte d'Azur z10 (interleaved land and sea)", lat: 43.55, lon: 7.05, level: 10, expect: 'mixed' },
  { name: 'Atlantic z14 (outside coverage)', lat: 45.00, lon: -12.00, level: 14, expect: 'rejected' },
  { name: 'New York z12 (outside coverage)', lat: 40.70, lon: -74.00, level: 12, expect: 'rejected' },
];
for (const testCase of FAILURE_CASES) {
  const col = tileColFor(testCase.lon, testCase.level);
  const row = tileRowFor(testCase.lat, testCase.level);
  const tile = await fetchTile(col, row, testCase.level);

  if (testCase.expect === 'rejected') {
    results.failures.push({ ...testCase, status: tile.status, byteLength: tile.byteLength, valid: false });
    note(testCase.name, `HTTP ${tile.status}, ${tile.byteLength} bytes, ${tile.contentType}`);
    check(
      `${testCase.name}: the guard rejects it before Float32Array sees it`,
      tile.validation.valid === false,
      tile.validation.reason,
    );
    // Belt and braces: prove the constructor really would have thrown, so the
    // guard is protecting against something real rather than being decorative.
    if (tile.byteLength % 4 !== 0) {
      assertThrows(() => new Float32Array(tile.buffer), `${tile.byteLength} bytes`);
    }
    continue;
  }

  if (!tile.validation.valid) {
    check(`${testCase.name}: served a decodable tile`, false, tile.validation.reason);
    continue;
  }
  const rect = tileRectDeg(col, row, testCase.level);
  const decoded = decodeBilTile(tile.buffer, rect, 65);
  const nodataPct = (100 * decoded.nodataCount) / (SOURCE_SIZE * SOURCE_SIZE);
  // How many samples the DOCUMENTED sentinel check alone would have caught —
  // the gap between this and the floor is the smear.
  let exactSentinel = 0;
  for (const value of tile.samples) if (value === -99999) exactSentinel += 1;

  const entry = { ...testCase, nodataPct, exactSentinel, rejectedByFloor: decoded.nodataCount };
  results.failures.push(entry);
  note(
    testCase.name,
    `${fmt(nodataPct, 1)} % NoData · exactly -99999: ${exactSentinel} · rejected by the floor: ${decoded.nodataCount}`,
  );

  // Every meshed height must be finite and sane. This is the assertion that
  // would have caught the 100 km crater.
  let worst = 0;
  for (const height of decoded.heights) {
    if (!Number.isFinite(height)) { worst = NaN; break; }
    if (Math.abs(height) > Math.abs(worst)) worst = height;
  }
  check(
    `${testCase.name}: no crater survives into the mesh`,
    Number.isFinite(worst) && worst > -500 && worst < 9000,
    `most extreme meshed height ${fmt(worst, 1)} m`,
  );
  if (testCase.expect === 'mixed') {
    // Per-SAMPLE treatment or nothing: the land in this tile has to survive
    // alongside the sea, and the sea has to sit at the geoid.
    const sea = geoidHeight(testCase.lat, testCase.lon);
    let land = 0;
    let atGeoid = 0;
    for (const height of decoded.heights) {
      if (Math.abs(height - sea) < 5) atGeoid += 1; else land += 1;
    }
    entry.meshedLandVertices = land;
    entry.meshedSeaVertices = atGeoid;
    note(testCase.name, `meshed ${land} land vertices and ${atGeoid} at the geoid`);
    check(
      `${testCase.name}: land and sea both survive, so the fallback is per sample`,
      nodataPct > 5 && nodataPct < 95 && land > 0 && atGeoid > 0,
      `NoData ${fmt(nodataPct, 1)} %, ${land} land / ${atGeoid} sea vertices`,
    );
    check(
      `${testCase.name}: the smear is wider than the documented sentinel`,
      decoded.nodataCount >= exactSentinel,
      `floor caught ${decoded.nodataCount}, exact -99999 only ${exactSentinel}`,
    );
  }
  if (testCase.expect === 'all-nodata') {
    check(`${testCase.name}: recognised as fully NoData`, nodataPct === 100, `${fmt(nodataPct, 1)} %`);
    check(
      `${testCase.name}: the sea meshes at the geoid, not at -99999`,
      decoded.heights.every((height) => Math.abs(height - geoidHeight(testCase.lat, testCase.lon)) < 5),
      `first sample ${fmt(decoded.heights[0], 2)} m, N ${fmt(geoidHeight(testCase.lat, testCase.lon), 2)} m`,
    );
  }
}

function assertThrows(fn, detail) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  check(`a ${detail} body really does throw in Float32Array`, threw, detail);
}

// ── 4. Cost ─────────────────────────────────────────────────────────────────
// Decode cost per tile, measured on a real Paris tile. This is the per-tile CPU
// the spike adds on top of a normal quantized-mesh fetch, and it is the number
// that decides whether the full chantier needs a worker.
console.log('\n4. DECODE COST');
{
  const level = 14;
  const col = tileColFor(2.3522, level);
  const row = tileRowFor(48.8566, level);
  const tile = await fetchTile(col, row, level);
  if (!tile.validation.valid) {
    check('cost probe tile is readable', false, tile.validation.reason);
  } else {
    const rect = tileRectDeg(col, row, level);
    // Warm the geoid interpolator and the JIT before measuring.
    for (let i = 0; i < 3; i += 1) decodeBilTile(tile.buffer, rect, 65);
    const RUNS = 40;
    const started = performance.now();
    for (let i = 0; i < RUNS; i += 1) decodeBilTile(tile.buffer, rect, 65);
    const perTileMs = (performance.now() - started) / RUNS;

    // What one tile costs to hold: the 256² source arrives over the wire, and
    // the 65² Float32Array is what stays alive in the terrain cache.
    const wireBytes = tile.contentLength ?? tile.byteLength;
    const meshBytes = 65 * 65 * 4;
    results.cost = { perTileMs, wireBytes, decodedBytes: tile.byteLength, meshBytes };
    note(
      'per tile',
      `decode ${fmt(perTileMs, 2)} ms · ${wireBytes} B on the wire (${tile.contentEncoding || 'identity'}) `
      + `-> ${tile.byteLength} B decoded -> ${meshBytes} B retained`,
    );
    // 8 ms is a quarter of a 30 fps budget for ONE tile, and a moving camera
    // streams many. Past that the full chantier needs a worker, which is a
    // materially bigger piece of work and belongs in the estimate.
    check('decode fits on the main thread without a worker', perTileMs < 8, `${fmt(perTileMs, 2)} ms`);
  }
}

// The wire fact that would have broken a header-based guard.
console.log('\n5. TRANSPORT');
{
  const level = 14;
  const tile = await fetchTile(tileColFor(2.3522, level), tileRowFor(48.8566, level), level);
  note(
    'content-length vs decoded size',
    `${tile.contentLength} B (${tile.contentEncoding}) vs ${tile.byteLength} B after decode`,
  );
  check(
    'the guard measures the DECODED body, because the service deflates it',
    tile.contentEncoding === 'deflate' && tile.contentLength !== tile.byteLength && tile.validation.valid,
    'a content-length guard would reject every valid tile',
  );
}

if (jsonPath) {
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
  console.log(`\nRaw measurements written to ${jsonPath}`);
}

if (missedTargets.length) {
  console.log(`\nTargets missed (documented caveats, not blockers):\n  - ${missedTargets.join('\n  - ')}`);
}
if (failures.length) {
  console.error(`\nIGN terrain spike FAILED ${failures.length} hard criteria:\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log(
  `\nIGN terrain spike: every hard criterion met`
  + `${missedTargets.length ? `, ${missedTargets.length} target(s) missed — see above` : ''}.`,
);
