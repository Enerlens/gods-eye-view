#!/usr/bin/env node
/**
 * Where is IGN's orthophoto REALLY opaque? — the calibration behind
 * `IGN_OPAQUE_BOXES` in src/mapStackController.js.
 *
 * WHY THIS EXISTS. The world satellite base under `ign-ortho` is downloaded in
 * full even where IGN hides every pixel of it (`cutoutRectangle` cuts the draw,
 * not the fetch — measured in `qa:world-imagery-cost`). `show = false` is the
 * only lever, and pulling it needs certainty that IGN covers the WHOLE view,
 * or the globe grows white holes. That certainty cannot be inferred from the
 * layer's rectangle: `IGN_FRANCE_RECTANGLE` also contains Belgium, Luxembourg,
 * northern Spain, northern Italy and a great deal of Atlantic and
 * Mediterranean, none of which the Geoplateforme serves.
 *
 * So the boxes were hand-drawn from spot checks, five of them, small enough
 * that the cockpit's own default -30° tilt fell outside them over Paris. This
 * script replaces the guesswork with a measurement.
 *
 * HOW IT PROBES, AND WHY IT IS CHEAP. `data.geopf.fr` answers a tile it does
 * not have with `404 text/xml`, 137 bytes, and a tile it does have with
 * `200 image/jpeg` at 10-25 kB. Both verdicts are in the RESPONSE HEADERS, so
 * every body is cancelled unread: a 15 000-point sweep of metropolitan France
 * costs kilobytes, not the ~200 MB the same sweep would cost if it downloaded
 * the imagery.
 *
 * A `200` alone is not enough. Coastal tiles come back as ~1.6 kB near-blank
 * JPEGs — technically served, visually nothing. `COVERED_MIN_BYTES` treats
 * those as uncovered, which is the safe direction: a missed box costs a
 * missed optimisation, an over-large box costs a white hole in the globe.
 *
 * THREE STAGES:
 *   1. sweep  — a `STEP`-degree grid over `IGN_FRANCE_RECTANGLE`.
 *   2. erode  — a sample is usable only if its eight neighbours are covered
 *               too, so a box interior is never within one step of a hole the
 *               grid was too coarse to see.
 *   3. verify — every derived box is re-probed at HALF the sweep spacing, so
 *               the probe lands on the midpoints the sweep never saw, and any
 *               box with a single miss is DROPPED rather than shrunk. This is
 *               not ceremony: the first run dropped three boxes of fifteen,
 *               each for one miss at a longitude between two sweep columns.
 *
 *   node scripts/qa-ign-opaque-boxes.mjs            # sweep, derive, verify
 *   node scripts/qa-ign-opaque-boxes.mjs --check    # verify the SHIPPED boxes only (fast, CI-shaped)
 *   node scripts/qa-ign-opaque-boxes.mjs --replay   # re-derive from the cached sweep, no network
 *   node scripts/qa-ign-opaque-boxes.mjs --quick    # 9x9 smoke verification instead of STEP/2
 *   node scripts/qa-ign-opaque-boxes.mjs --json     # machine-readable result
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { IGN_FRANCE_RECTANGLE, IGN_OPAQUE_BOXES } from '../src/mapStackController.js';

const WMTS = 'https://data.geopf.fr/wmts';
const LAYER = 'ORTHOIMAGERY.ORTHOPHOTOS';
/** Probe zoom. z13 tiles span ~0.044 deg, comfortably finer than `STEP`. */
const ZOOM = 13;
/** Sweep spacing, degrees. ~11 km — finer than any real gap in the product. */
const STEP = 0.1;
/**
 * Smallest response that counts as imagery. Real z13 orthophoto is 10-25 kB;
 * the near-blank coastal tiles measured 1.6 kB. 6 kB sits in the empty middle.
 */
const COVERED_MIN_BYTES = 6_000;
/** Politeness: the WMTS endpoint is unmetered, our manners are not. */
const CONCURRENCY = 8;
/** A box smaller than this is not worth the union test's time. */
const MIN_BOX_DEG = 0.6;
/** Ceiling on the box count. The union test is O(cells x boxes) per camera rest. */
const MAX_BOXES = 24;
/** Ceiling on one box's verification grid; the grown boxes can be 10° wide. */
const MAX_VERIFY_POINTS = 1_500;
/** Where the raw sweep is kept, so a derivation can be retuned without re-probing. */
const CACHE_PATH = new URL('../.context/perf/ign-coverage-grid.json', import.meta.url);

const args = new Set(process.argv.slice(2));
const asJson = args.has('--json');
const log = (...parts) => { if (!asJson) console.log(...parts); };

function tileXY(lon, lat, z) {
  const n = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  return {
    x: Math.floor(((lon + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n),
  };
}

/**
 * One point's verdict, from headers alone.
 *
 * THREE OUTCOMES, NOT TWO. "The server said no" and "the network dropped" look
 * identical to a boolean, and collapsing them made this script noisy in the
 * expensive direction: a run touches ~25 000 URLs, so a handful of timeouts is
 * normal, and each one used to read as a hole and drop an otherwise sound box.
 * `null` means unknown — the sweep treats it as uncovered (safe: it only
 * forfeits an optimisation) while verification excludes it from the count
 * rather than convicting a box on a dropped connection.
 * @returns {Promise<boolean|null>} covered, not covered, or unknown.
 */
async function isCovered(lon, lat) {
  const { x, y } = tileXY(lon, lat, ZOOM);
  const url = `${WMTS}?service=WMTS&version=1.0.0&request=GetTile&layer=${LAYER}`
    + `&style=normal&format=image/jpeg&tilematrixset=PM`
    + `&tilematrix=${ZOOM}&tilerow=${y}&tilecol=${x}`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const res = await fetch(url);
      const bytes = Number(res.headers.get('content-length') ?? 0);
      await res.body?.cancel();
      if (res.status === 404) return false;
      if (res.status === 200) return bytes >= COVERED_MIN_BYTES;
      // 5xx is the server having a moment, not a statement about coverage.
    } catch { /* transient — retry */ }
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  return null;
}

/**
 * `isCovered`, but a "no" has to be said twice.
 *
 * The Géoplateforme intermittently 404s tiles it does serve. Two derivation
 * runs over the identical lattice disagreed on the same box —
 * `1.4,42.9 -> 2.9,49.9` scored 1024/1024 in one and 1022/1024 in the next —
 * which is not a coverage question, it is a flaky backend. Since the thing
 * being measured is "does IGN HAVE imagery here", one 200 outranks one 404,
 * and only a point that refuses twice counts against a box. Verification only:
 * the sweep can afford to be pessimistic, this stage cannot, because a single
 * spurious 404 drops a 10 deg² box.
 */
async function isCoveredTwice(lon, lat) {
  const first = await isCovered(lon, lat);
  if (first !== false) return first;
  await new Promise((resolve) => setTimeout(resolve, 400));
  const second = await isCovered(lon, lat);
  return second === false ? false : second;
}

/** Runs `task` over `items` at most `CONCURRENCY` at a time, in order. */
async function mapLimit(items, task, onTick) {
  const out = new Array(items.length);
  let next = 0;
  let done = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (let i = next; i < items.length; i = next) {
      next = i + 1;
      out[i] = await task(items[i], i);
      done += 1;
      onTick?.(done, items.length);
    }
  }));
  return out;
}

const round = (n) => Number(n.toFixed(4));

/**
 * Grows a single cell into a rectangle nothing can extend, in the FULL grid.
 *
 * `axisFirst` decides the SHAPE, and both shapes are wanted. Expanding rows to
 * exhaustion before columns yields a tall narrow box; columns first yields a
 * wide flat one; the same seed gives two different maximal rectangles. That
 * matters because France is not rectangular: the Rhône corridor and the
 * Atlantic seaboard are only coverable by tall boxes, while the Paris basin
 * wants wide ones, and an area-first search finds only the second kind.
 * @param {{r0:number,c0:number,r1:number,c1:number}} seed
 * @param {boolean[][]} grid
 * @param {'rows'|'cols'} axisFirst
 */
function growRectangle(seed, grid, axisFirst) {
  const rows = grid.length;
  const cols = grid[0].length;
  let { r0, r1, c0, c1 } = seed;
  const rowSafe = (r, from, to) => {
    for (let c = from; c <= to; c += 1) if (!grid[r][c]) return false;
    return true;
  };
  const colSafe = (c, from, to) => {
    for (let r = from; r <= to; r += 1) if (!grid[r][c]) return false;
    return true;
  };
  const growRows = () => {
    let grew = false;
    for (; r0 > 0 && rowSafe(r0 - 1, c0, c1); r0 -= 1) grew = true;
    for (; r1 < rows - 1 && rowSafe(r1 + 1, c0, c1); r1 += 1) grew = true;
    return grew;
  };
  const growCols = () => {
    let grew = false;
    for (; c0 > 0 && colSafe(c0 - 1, r0, r1); c0 -= 1) grew = true;
    for (; c1 < cols - 1 && colSafe(c1 + 1, r0, r1); c1 += 1) grew = true;
    return grew;
  };
  const [first, second] = axisFirst === 'rows' ? [growRows, growCols] : [growCols, growRows];
  // Alternate until neither direction moves: one pass is not a fixed point,
  // since widening can unlock further height and the reverse.
  for (let grew = true; grew;) grew = first() | second();
  return { r0, r1, c0, c1 };
}

/**
 * Every distinct maximal rectangle reachable from a lattice of seeds.
 *
 * WHY SEEDS AND NOT LARGEST-FIRST CARVING, which is what this did first.
 * Carving out the biggest rectangle and repeating hands back DISJOINT boxes
 * with seams between them, and it is blind to any shape that is not locally
 * the largest: the first derivation split central France and the Paris basin
 * across a 0.4° seam of solid Beauce belonging to neither, and never proposed
 * a tall box down the Rhône at all. Seeding everywhere and growing in both
 * axis orders produces overlapping candidates of both shapes, which is what
 * the union test downstream was written to exploit.
 * @param {boolean[][]} grid
 * @param {number} stride - seed lattice spacing, in cells.
 */
function candidateRectangles(grid, stride = 3) {
  const seen = new Map();
  for (let r = 0; r < grid.length; r += stride) {
    for (let c = 0; c < grid[0].length; c += stride) {
      if (!grid[r][c]) continue;
      for (const axisFirst of ['rows', 'cols']) {
        const rect = growRectangle({ r0: r, r1: r, c0: c, c1: c }, grid, axisFirst);
        seen.set(`${rect.r0},${rect.r1},${rect.c0},${rect.c1}`, rect);
      }
    }
  }
  const all = [...seen.values()];
  const contains = (a, b) => a.r0 <= b.r0 && a.r1 >= b.r1 && a.c0 <= b.c0 && a.c1 >= b.c1;
  return all.filter((rect, i) => !all.some((other, j) => j !== i && contains(other, rect)
    && (!contains(rect, other) || j < i)));
}

/**
 * Picks the subset whose UNION covers the most of the grid, greedily.
 *
 * Marginal gain, not area: two boxes that overlap almost entirely are worth
 * barely more than one, and the union test does not care which box a point
 * came from. Greedy set cover is within a log factor of optimal and the exact
 * version is NP-hard, which is not a trade worth making for seven rectangles.
 */
function selectByMarginalGain(rects, grid, limit) {
  const claimed = grid.map((row) => row.map(() => false));
  const chosen = [];
  const pool = [...rects];
  while (chosen.length < limit && pool.length) {
    let best = null;
    for (const rect of pool) {
      let gain = 0;
      for (let r = rect.r0; r <= rect.r1; r += 1) {
        for (let c = rect.c0; c <= rect.c1; c += 1) if (!claimed[r][c]) gain += 1;
      }
      if (!best || gain > best.gain) best = { rect, gain };
    }
    if (!best || best.gain < 4) break;
    chosen.push(best.rect);
    pool.splice(pool.indexOf(best.rect), 1);
    for (let r = best.rect.r0; r <= best.rect.r1; r += 1) {
      for (let c = best.rect.c0; c <= best.rect.c1; c += 1) claimed[r][c] = true;
    }
  }
  return chosen;
}

/**
 * Re-probes one box at HALF the sweep's spacing. Returns the miss count.
 *
 * WHY HALF A STEP AND NOT A FIXED 9x9. The first run of this script verified
 * each box on a 9x9 grid and dropped three of fifteen for a single miss each —
 * every one of them at a longitude that fell BETWEEN two sweep columns. So
 * gaps narrower than `STEP` genuinely exist (the Swiss and Italian borders cut
 * across the grid at an angle), and erosion cannot see them: it only knows
 * about samples the sweep actually took.
 *
 * Sampling at `STEP / 2` therefore probes exactly the midpoints the sweep was
 * blind to, which is the only verification that adds information rather than
 * repeating the sweep more slowly.
 *
 * THE OFFSET IS THE POINT, NOT THE SPACING. `MAX_VERIFY_POINTS` has to thin
 * the biggest boxes — 7° x 1.5° is 4 371 points at half a step — and thinning
 * by halving walked the samples straight back ONTO the sweep grid at 0.1°, and
 * then past it to 0.2°, so the "verification" of the largest boxes was
 * re-reading the sweep. Every sample is therefore offset by `STEP / 4` from the
 * box's own edge and the spacing grows by 1.5x rather than 2x, which keeps the
 * lattice off the sweep grid at every density it can degrade to.
 */
async function verifyBox(box, quick = false) {
  const width = box.east - box.west;
  const height = box.north - box.south;
  let spacing = quick ? Math.max(width, height) / 8 : STEP / 2;
  const size = () => (Math.floor(width / spacing) + 2) * (Math.floor(height / spacing) + 2);
  while (size() > MAX_VERIFY_POINTS) spacing *= 1.5;
  const axis = (low, high) => {
    // The two edges, plus an interior lattice that never lands on a sweep
    // sample. The edges are on the sweep grid and already known; they are here
    // because a box's own boundary is where a border most often cuts through.
    const out = new Set([low, high]);
    for (let v = low + STEP / 4; v < high; v += spacing) out.add(Number(v.toFixed(6)));
    return [...out].sort((a, b) => a - b);
  };
  const lons = axis(box.west, box.east);
  const lats = axis(box.south, box.north);
  const points = lons.flatMap((lon) => lats.map((lat) => [lon, lat]));
  const verdicts = await mapLimit(points, ([lon, lat]) => isCoveredTwice(lon, lat));
  const unknown = verdicts.filter((v) => v === null).length;
  return {
    total: points.length - unknown,
    misses: verdicts.filter((v) => v === false).length,
    unknown,
  };
}

// ── --check: verify what is shipped (or an arbitrary set), nothing else ─────
if (args.has('--check')) {
  // `--boxes '[{"west":…}]'` verifies a candidate set at the same standard as
  // the shipped one — what a re-derivation needs in order to argue that an
  // OLDER box, passed by a weaker check, should be kept.
  const explicit = [...args].find((a) => a.startsWith('--boxes='));
  const boxes = explicit ? JSON.parse(explicit.slice('--boxes='.length)) : IGN_OPAQUE_BOXES;
  log(`Verifying ${boxes.length} ${explicit ? 'candidate' : 'shipped'} boxes against live IGN…\n`);
  const results = [];
  for (const box of boxes) {
    const { total, misses, unknown } = await verifyBox(box, args.has('--quick'));
    results.push({ box, total, misses, unknown });
    log(`  ${misses === 0 ? 'OK  ' : 'FAIL'}  `
      + `${String(box.west).padStart(6)},${String(box.south).padStart(6)} -> `
      + `${String(box.east).padStart(6)},${String(box.north).padStart(6)}   `
      + `${total - misses}/${total} covered${unknown ? `, ${unknown} unreachable` : ''}`);
  }
  const bad = results.filter((r) => r.misses > 0);
  if (asJson) console.log(JSON.stringify({ mode: 'check', results }, null, 2));
  else log(`\n${bad.length === 0 ? 'All shipped boxes are opaque.' : `${bad.length} box(es) contain holes — the base must NOT sleep there.`}`);
  process.exit(bad.length === 0 ? 0 : 1);
}

// ── sweep ───────────────────────────────────────────────────────────────────
const lons = [];
for (let lon = IGN_FRANCE_RECTANGLE.west; lon <= IGN_FRANCE_RECTANGLE.east + 1e-9; lon += STEP) {
  lons.push(round(lon));
}
const lats = [];
for (let lat = IGN_FRANCE_RECTANGLE.south; lat <= IGN_FRANCE_RECTANGLE.north + 1e-9; lat += STEP) {
  lats.push(round(lat));
}
const points = [];
for (let r = 0; r < lats.length; r += 1) {
  for (let c = 0; c < lons.length; c += 1) points.push([lons[c], lats[r]]);
}
/**
 * The sweep is the slow part and the derivation is the part worth retuning, so
 * the raw verdicts are cached and `--replay` re-derives from them offline.
 * The cache is keyed on the geometry it was taken with: change `STEP` or the
 * clamp and it is ignored rather than silently reused.
 */
const cacheKey = { zoom: ZOOM, step: STEP, rect: IGN_FRANCE_RECTANGLE, n: points.length };
let verdicts = null;
if (args.has('--replay')) {
  try {
    const cached = JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
    if (JSON.stringify(cached.key) === JSON.stringify(cacheKey)) {
      verdicts = cached.bits.split('').map((bit) => (bit === '1' ? true : bit === '0' ? false : null));
      log(`Replaying the sweep of ${cached.takenAt} — ${verdicts.length} points, no network.\n`);
    } else log('Cache was taken with different geometry; sweeping again.\n');
  } catch { log('No usable cache; sweeping.\n'); }
}
if (!verdicts) {
  log(`Sweeping ${points.length} points (${lons.length} x ${lats.length}) at z${ZOOM}, step ${STEP}°…`);
  const t0 = Date.now();
  verdicts = await mapLimit(points, ([lon, lat]) => isCovered(lon, lat), (done, total) => {
    if (done % 1000 === 0 || done === total) {
      process.stderr.write(`\r  ${done}/${total}  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
  });
  process.stderr.write('\n');
  try {
    mkdirSync(new URL('.', CACHE_PATH), { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify({
      takenAt: new Date().toISOString().slice(0, 10),
      key: cacheKey,
      lons,
      lats,
      bits: verdicts.map((v) => (v === true ? '1' : v === false ? '0' : '?')).join(''),
    }));
  } catch (error) { log(`  (could not cache the sweep: ${error.message})`); }
}

// `null` (unknown after five tries) is folded into "not covered" here: the
// sweep decides where a box MAY go, and being wrong that way costs an
// optimisation, never a white hole.
const covered = lats.map((_, r) => lons.map((__, c) => verdicts[r * lons.length + c] === true));
const nCovered = verdicts.filter(Boolean).length;
log(`  ${nCovered} covered, ${points.length - nCovered} not (${((nCovered / points.length) * 100).toFixed(1)}%)\n`);

// ── erode ───────────────────────────────────────────────────────────────────
const safe = covered.map((row, r) => row.map((ok, c) => {
  if (!ok) return false;
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (!covered[r + dr]?.[c + dc]) return false;
    }
  }
  return true;
}));
log(`  ${safe.flat().filter(Boolean).length} points survive erosion (a hole is never within ${STEP}° of a box interior)\n`);

// ── derive ──────────────────────────────────────────────────────────────────
const minCells = Math.round(MIN_BOX_DEG / STEP);
const maximal = candidateRectangles(safe)
  .filter((r) => (r.r1 - r.r0) >= minCells && (r.c1 - r.c0) >= minCells);
const candidates = selectByMarginalGain(maximal, safe, MAX_BOXES).map((r) => ({
  west: round(lons[r.c0]), south: round(lats[r.r0]),
  east: round(lons[r.c1]), north: round(lats[r.r1]),
}));
log(`${maximal.length} maximal boxes ≥ ${MIN_BOX_DEG}° on a side, `
  + `${candidates.length} selected by marginal union gain.`);
log('Verifying each at half the sweep spacing…\n');

// ── verify ──────────────────────────────────────────────────────────────────
const kept = [];
for (const box of candidates) {
  const { total, misses, unknown } = await verifyBox(box, args.has('--quick'));
  const area = (box.east - box.west) * (box.north - box.south);
  log(`  ${misses === 0 ? 'keep' : 'DROP'}  `
    + `${String(box.west).padStart(6)},${String(box.south).padStart(6)} -> `
    + `${String(box.east).padStart(6)},${String(box.north).padStart(6)}   `
    + `${(total - misses)}/${total}   ${area.toFixed(2)} deg²`
    + `${unknown ? `   (${unknown} unreachable)` : ''}`);
  if (misses === 0) kept.push({ ...box, area });
}
kept.sort((a, b) => b.area - a.area);

const totalArea = kept.reduce((s, b) => s + b.area, 0);
const shippedArea = IGN_OPAQUE_BOXES.reduce((s, b) => s + (b.east - b.west) * (b.north - b.south), 0);
log(`\n${kept.length} boxes kept, ${totalArea.toFixed(1)} deg² (shipped today: ${IGN_OPAQUE_BOXES.length} boxes, ${shippedArea.toFixed(1)} deg²)\n`);
log('Paste into src/mapStackController.js:\n');
for (const b of kept) {
  log(`  Object.freeze({ west: ${b.west}, south: ${b.south}, east: ${b.east}, north: ${b.north} }),`);
}
log('');

if (asJson) console.log(JSON.stringify({ mode: 'derive', step: STEP, zoom: ZOOM, boxes: kept }, null, 2));
