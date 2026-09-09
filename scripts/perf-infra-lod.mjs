#!/usr/bin/env node
/**
 * perf-infra-lod — the bench phase 3.1 asks for, and did not have.
 *
 * `docs/PLAN-PERFORMANCE.md` § phase 3.1 names one measurement and one target:
 * "tas et p90 avec les quatre packs sur Terre entière, CPU ÷4 puis machine de
 * référence. Cible : tas −60 %, p90 ≤ 33 ms." Nothing in `scripts/` produced
 * either number — `qa-overlay-baseline.mjs` measures two of the four packs, on
 * a US view, without a heap reading — so the task could not be closed even if
 * the code were right. This is that bench.
 *
 * ── WHAT IT MEASURES, AND WHY IN THAT ORDER ────────────────────────────────
 *
 * Three scenes, each on its own fresh page, because a pack's cost is a
 * function of what the camera can see and mixing scenes in one page would let
 * the first scene's heap be attributed to the second:
 *
 *   world   full earth, all four packs        — the scene phase 3.1 targets
 *   region  2 000 km over France, all four    — the LOD threshold's own edge
 *   city    120 km over Lyon, all four        — the "en dessous, tout" side
 *
 * The heap is read THREE times per scene: after boot with nothing enabled,
 * after the four packs have loaded, and after the sampling. The reported
 * number is the DELTA (loaded − boot), because that is what the packs cost and
 * what a −60 % target can be checked against; the absolute figure moves with
 * Cesium's own tile cache and would drown the signal. Every read is preceded
 * by an explicit `HeapProfiler.collectGarbage`, so what is reported is retained
 * memory rather than whatever the allocator had not swept yet.
 *
 * CPU throttling is applied AFTER the packs have loaded, never during. A ÷4
 * load would measure the parse, which is task 1.3's subject, not this one — and
 * it would push the 60 s layer wait past its timeout on a cold cache. What is
 * throttled is exactly the render loop this task is about.
 *
 * Frame intervals are read from `requestAnimationFrame`, the same way
 * `qa-overlay-baseline.mjs` reads them, so the two benches stay comparable.
 * p90 is reported alongside p50/p95/p99 because p90 is the number the plan set
 * the target on and reporting only it would hide a bimodal frame time.
 *
 * ── WHAT THE NUMBERS ARE WORTH ─────────────────────────────────────────────
 *
 * Under SwiftShader (the default headless renderer) absolute frame times are
 * not representative of any real machine — they are, however, perfectly
 * comparable BEFORE and AFTER a change on this machine, which is what an
 * optimisation needs. Pass `--hardware-gpu` for a headful run against the real
 * GPU when an absolute number is wanted, and record the renderer string the
 * header prints with any figure you quote.
 *
 * Usage:
 *   node scripts/perf-infra-lod.mjs --url http://localhost:4231
 *   node scripts/perf-infra-lod.mjs --url http://localhost:4231 --scene world
 *   node scripts/perf-infra-lod.mjs --url http://localhost:4231 --cpu 1
 *   node scripts/perf-infra-lod.mjs --url http://localhost:4231 --per-pack
 *   node scripts/perf-infra-lod.mjs --url http://localhost:4231 --profile full
 *   node scripts/perf-infra-lod.mjs --url http://localhost:4231 --json before.json
 *   node scripts/perf-infra-lod.mjs --url http://localhost:4231 --baseline before.json
 */
import fs from 'node:fs';
import os from 'node:os';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const CHROME_EXECUTABLE = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEFAULT_URL = 'http://localhost:4231';
const VIEWPORT = Object.freeze({ width: 1440, height: 900 });
const SAMPLE_MS = 5_000;
const SETTLE_MS = 3_000;
const LAYER_WAIT_MS = 90_000;
/**
 * Deliberately half an hour, and that is not paranoia.
 *
 * The scene this bench exists to fix draws about one frame per second BEFORE
 * the fix, and a `page.evaluate` cannot run until the main thread yields — so
 * on the baseline a single inventory read waits behind several seconds of
 * render, several times over, and the stock 10-minute protocol timeout expires
 * on the very run the numbers are needed from. A bench that can only measure
 * the fast side of its own comparison is not a bench.
 */
const PROTOCOL_TIMEOUT_MS = 1_800_000;

/** The four bundled infrastructure packs, in registry order. */
const INFRA_PACKS = Object.freeze([
  'local-airports',
  'local-datacenters',
  'local-dams',
  'local-ports',
]);

/**
 * Camera is `[lon, lat, height, heading, pitch]`, matching `setCamera` in
 * `qa-overlay-baseline.mjs` so a reading can be reproduced there.
 *
 * `world` sits at 20 000 km looking straight down at 20°N/10°E: that framing
 * puts Europe, Africa and the whole Atlantic on screen at once, which is the
 * densest half of three of the four packs. A pole-on or Pacific view would
 * flatter the numbers by showing water.
 */
const SCENES = Object.freeze([
  { id: 'world', camera: [10, 20, 20_000_000, 0, -Math.PI / 2] },
  { id: 'region', camera: [3.5, 46.5, 2_000_000, 0, -Math.PI / 2] },
  { id: 'city', camera: [4.85, 45.75, 120_000, 0, -Math.PI / 2] },
]);

const argv = process.argv.slice(2);
const getOpt = (name, fallback = null) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const hasFlag = (name) => argv.includes(name);

const url = getOpt('--url', DEFAULT_URL);
const cpuRate = Math.max(1, Number(getOpt('--cpu', '4')) || 4);
const jsonOut = getOpt('--json');
const baselinePath = getOpt('--baseline');
const hardwareGpu = hasFlag('--hardware-gpu');
const perPackHeap = hasFlag('--per-pack');
const forcedProfile = getOpt('--profile');
if (forcedProfile && !['full', 'lite'].includes(forcedProfile)) {
  console.error(`--profile takes 'full' or 'lite', not '${forcedProfile}'`);
  process.exit(2);
}
const sceneFilter = (getOpt('--scene') || '').split(',').map((s) => s.trim()).filter(Boolean);
const scenes = sceneFilter.length
  ? SCENES.filter((scene) => sceneFilter.includes(scene.id))
  : [...SCENES];
if (!scenes.length) {
  console.error(`Unknown scene. Available: ${SCENES.map((s) => s.id).join(', ')}`);
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round = (value, digits = 2) => (Number.isFinite(value)
  ? Math.round(value * 10 ** digits) / 10 ** digits
  : null);

function percentile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

function summarizeIntervals(intervals) {
  const usable = intervals.filter((value) => Number.isFinite(value) && value > 0);
  if (!usable.length) return { samples: 0 };
  return {
    samples: usable.length,
    meanMs: round(usable.reduce((sum, value) => sum + value, 0) / usable.length),
    p50Ms: round(percentile(usable, 0.50)),
    p90Ms: round(percentile(usable, 0.90)),
    p95Ms: round(percentile(usable, 0.95)),
    p99Ms: round(percentile(usable, 0.99)),
    maxMs: round(Math.max(...usable)),
  };
}

/**
 * Retained heap, in MiB. Collected first: without the sweep this reports the
 * allocator's high-water mark, which moves by tens of MiB between identical
 * runs and would make any before/after comparison noise.
 */
async function readHeapMiB(client) {
  await client.send('HeapProfiler.collectGarbage');
  await sleep(250);
  const { usedSize } = await client.send('Runtime.getHeapUsage');
  return round(usedSize / (1024 * 1024), 1);
}

/**
 * Wait for the app to publish its viewer, surviving the same-document
 * navigation it performs on boot.
 *
 * The app rewrites its own URL hash once the camera settles (`#v=2&lat=...`),
 * and puppeteer tears down the isolated world it evaluates in when that lands —
 * so a single `waitForFunction` spanning the boot dies with
 * "Execution context was destroyed" rather than timing out on anything real.
 * Polling and swallowing that one class of failure is the honest fix; a real
 * absence still expires the deadline.
 */
async function waitForApp(page, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const ready = await page.evaluate(() => Boolean(window.__godsEyeView?.viewer));
      if (ready) return;
    } catch { /* the context went away mid-poll; the next one gets the new one */ }
    if (Date.now() > deadline) throw new Error(`app never published a viewer within ${timeoutMs} ms`);
    await sleep(500);
  }
}

async function setCamera(page, camera) {
  await page.evaluate(([lon, lat, height, heading, pitch]) => {
    const viewer = window.__godsEyeView.viewer;
    viewer.camera.cancelFlight?.();
    viewer.scene.tweens?.removeAll?.();
    viewer.camera.setView({
      destination: viewer.scene.globe.ellipsoid.cartographicToCartesian({
        longitude: lon * Math.PI / 180,
        latitude: lat * Math.PI / 180,
        height,
      }),
      orientation: { heading, pitch, roll: 0 },
    });
    viewer.scene.requestRender?.();
  }, camera);
}

/**
 * What is loaded against what is DRAWN — the distinction this whole task is
 * about. `entities` is what the packs put in the scene graph; `shownEntities`
 * is what survived the occluder, the row floors and (after 3.1) the globe-LOD
 * budget. A change that moves the first is a data change; a change that moves
 * only the second is this one.
 */
async function readInventory(page) {
  return page.evaluate((packIds) => {
    const viewer = window.__godsEyeView.viewer;
    const perPack = {};
    let entities = 0;
    let shownEntities = 0;
    let shownPolylines = 0;
    let shownPolygons = 0;
    let pinBillboards = 0;
    let descriptionTables = 0;
    for (let index = 0; index < viewer.dataSources.length; index++) {
      const dataSource = viewer.dataSources.get(index);
      const values = dataSource.entities?.values || [];
      let localId = null;
      for (const entity of values) {
        if (entity.__localLayerId) { localId = entity.__localLayerId; break; }
      }
      if (!localId || !packIds.includes(localId)) continue;
      const row = {
        entities: values.length, shown: 0, polylines: 0, polygons: 0, billboards: 0, descriptions: 0,
      };
      for (const entity of values) {
        // Counted over ALL features, not just the drawn ones: a pin billboard
        // and an HTML description table are load-time costs that a hidden
        // entity still carries. Both should read 0 on every pack.
        if (entity.billboard) row.billboards += 1;
        if (entity.description) row.descriptions += 1;
        const visible = dataSource.show !== false && entity.show !== false;
        if (!visible) continue;
        row.shown += 1;
        if (entity.polyline) row.polylines += 1;
        if (entity.polygon && entity.polygon.show?.getValue?.() !== false) row.polygons += 1;
      }
      perPack[localId] = row;
      entities += row.entities;
      shownEntities += row.shown;
      shownPolylines += row.polylines;
      shownPolygons += row.polygons;
      pinBillboards += row.billboards;
      descriptionTables += row.descriptions;
    }

    // Cesium batches the stems and dots into scene primitives; counting those
    // is the only reading that survives a future move off Entities, so both
    // are reported and a comparison can follow whichever one still exists.
    let primitivePoints = 0;
    let primitiveBillboards = 0;
    let primitivePolylines = 0;
    const seen = new Set();
    const visit = (collection, depth = 0) => {
      if (!collection || depth > 5 || seen.has(collection)) return;
      seen.add(collection);
      const length = Number(collection.length || 0);
      for (let index = 0; index < length; index++) {
        let primitive;
        try { primitive = collection.get(index); } catch { primitive = null; }
        if (!primitive || seen.has(primitive)) continue;
        if (Array.isArray(primitive._pointPrimitives)) primitivePoints += primitive._pointPrimitives.length;
        if (Array.isArray(primitive._billboards)) primitiveBillboards += primitive._billboards.length;
        if (Array.isArray(primitive._polylines)) primitivePolylines += primitive._polylines.length;
        if (typeof primitive.length === 'number' && typeof primitive.get === 'function') {
          visit(primitive, depth + 1);
        }
      }
    };
    visit(viewer.scene.primitives);

    return {
      entities,
      shownEntities,
      shownPolylines,
      shownPolygons,
      pinBillboards,
      descriptionTables,
      primitivePoints,
      primitiveBillboards,
      primitivePolylines,
      perPack,
    };
  }, INFRA_PACKS);
}

async function enablePacks(page, client) {
  const states = {};
  // Reading BETWEEN packs answers "which one to attack" — 695 MiB across four
  // says nothing on its own. It is off by default because each read is a full
  // collection of a heap that large, which costs minutes on the slow side of
  // the comparison; `--per-pack` turns it on when the attribution is what is
  // wanted rather than the before/after.
  let previousMiB = perPackHeap ? await readHeapMiB(client) : null;
  for (const layerId of INFRA_PACKS) {
    await page.evaluate(async (id) => {
      const manager = window.__godsEyeView.dataManager;
      if (!manager.layers.has(id)) return;
      if (!manager.isEnabled(id)) await manager.toggle(id);
    }, layerId);
    try {
      await page.waitForFunction((id) => {
        const entry = window.__godsEyeView?.dataManager?.layers?.get(id);
        if (!entry?.enabled || !entry.initialized) return false;
        let stats;
        try { stats = entry.module.getStats?.() || {}; } catch { return false; }
        if (stats.error) return true;
        return Number(stats.count || 0) > 0;
      }, { timeout: LAYER_WAIT_MS, polling: 250 }, layerId);
    } catch { /* recorded below as a zero count, not thrown */ }
    const state = await page.evaluate((id) => {
      const entry = window.__godsEyeView.dataManager.layers.get(id);
      if (!entry) return { missing: true };
      let stats = {};
      try { stats = entry.module.getStats?.() || {}; } catch (error) { stats = { error: error.message }; }
      return { enabled: entry.enabled, count: stats.count ?? null, error: stats.error ?? null };
    }, layerId);
    if (perPackHeap) {
      const nowMiB = await readHeapMiB(client);
      state.heapMiB = round(nowMiB - previousMiB, 1);
      state.kibPerFeature = state.count
        ? round(((nowMiB - previousMiB) * 1024) / state.count, 1)
        : null;
      previousMiB = nowMiB;
    }
    states[layerId] = state;
  }
  return states;
}

/**
 * One sampling window. `moving` orbits the camera at the same rates
 * `qa-overlay-baseline.mjs` uses, so the two benches describe the same motion.
 */
async function samplePhase(page, moving) {
  const raw = await page.evaluate(async ({ durationMs, movingCamera }) => {
    const viewer = window.__godsEyeView.viewer;
    const intervals = [];
    const startedAt = performance.now();
    let lastFrameAt = null;
    await new Promise((resolve) => {
      const step = (now) => {
        if (lastFrameAt != null) intervals.push(now - lastFrameAt);
        lastFrameAt = now;
        const elapsed = now - startedAt;
        if (movingCamera) {
          viewer.camera.rotateRight(0.00035);
          viewer.camera.rotateUp(0.00008 * Math.sin(elapsed / 600));
        }
        viewer.scene.requestRender?.();
        if (elapsed >= durationMs) resolve();
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    return { intervals, elapsedMs: performance.now() - startedAt };
  }, { durationMs: SAMPLE_MS, movingCamera: moving });
  return { ...summarizeIntervals(raw.intervals), windowMs: round(raw.elapsedMs) };
}

async function runScene(scene) {
  // A browser per scene, not a page per scene: on the baseline the renderer can
  // run out of memory outright, and a crash in `world` used to end the run
  // before `region` and `city` were measured at all.
  const browser = await puppeteer.launch(launchOptions);
  const page = await newQaPage(browser);
  await page.setViewport({ ...VIEWPORT, deviceScaleFactor: 1 });
  if (forcedProfile) {
    // The app's own stored preference, written before any of its script runs —
    // the same state the DISPLAY-rail switch persists. Pinning it through the
    // URL would edit a URL this bench also asserts nothing about, but which the
    // app rewrites on boot.
    await page.evaluateOnNewDocument((profile) => {
      try { window.localStorage.setItem('gev:perf-profile', profile); } catch { /* no storage */ }
    }, forcedProfile);
  }
  const client = await page.createCDPSession();
  await client.send('HeapProfiler.enable');
  const consoleErrors = [];
  page.on('pageerror', (error) => consoleErrors.push(String(error?.message || error)));

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await waitForApp(page);
    await sleep(SETTLE_MS);
    await setCamera(page, scene.camera);
    await sleep(SETTLE_MS);

    // Which render profile the page actually resolved. Load-bearing, not
    // decoration: `perfProfile.js` sends any SwiftShader renderer to `lite`
    // (`SMALL_GPU_RE`), so the DEFAULT headless run measures the LITE budget —
    // 60 % of the marks — and a figure quoted without it would be read as the
    // `full` one. `--profile` pins it when the other side is what is wanted.
    const perfProfile = await page.evaluate(
      () => window.__godsEyeView?.getPerfProfileDiagnostics?.() || null,
    );

    const heapBootMiB = await readHeapMiB(client);
    const packs = await enablePacks(page, client);
    // Re-assert the camera: a pack's enable() can fly (a row that frames its
    // own data would silently move the scene out from under the measurement).
    await setCamera(page, scene.camera);
    await sleep(SETTLE_MS);
    const heapLoadedMiB = await readHeapMiB(client);
    const inventory = await readInventory(page);

    await client.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
    await sleep(1_000);
    const motion = await samplePhase(page, true);
    await setCamera(page, scene.camera);
    await sleep(1_500);
    const rest = await samplePhase(page, false);
    await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });

    const heapAfterMiB = await readHeapMiB(client);
    return {
      scene: scene.id,
      status: 'ok',
      camera: scene.camera,
      perfProfile,
      packs,
      heap: {
        bootMiB: heapBootMiB,
        loadedMiB: heapLoadedMiB,
        afterSampleMiB: heapAfterMiB,
        packsMiB: round(heapLoadedMiB - heapBootMiB, 1),
      },
      inventory,
      samples: { motion, rest },
      pageErrors: consoleErrors.slice(0, 5),
    };
  } catch (error) {
    return { scene: scene.id, status: 'error', reason: String(error?.message || error) };
  } finally {
    await browser.close().catch(() => {});
  }
}

function printScene(result, baseline) {
  if (result.status !== 'ok') {
    console.log(`[ERROR] ${result.scene} — ${result.reason}\n`);
    return;
  }
  const prior = baseline?.scenes?.find((row) => row.scene === result.scene) || null;
  const delta = (now, before, unit) => {
    if (!Number.isFinite(now) || !Number.isFinite(before)) return '';
    const change = now - before;
    const pct = before ? ` / ${change >= 0 ? '+' : ''}${Math.round((change / before) * 100)} %` : '';
    return `  (${change >= 0 ? '+' : ''}${round(change, 1)} ${unit}${pct})`;
  };

  console.log(`[OK] ${result.scene}  camera ${result.camera[2] / 1000} km over ${result.camera[0]}°, ${result.camera[1]}°`);
  console.log(`  profile      ${result.perfProfile?.profile ?? '(unknown)'} (source: ${result.perfProfile?.source ?? 'n/a'})`);
  for (const [id, state] of Object.entries(result.packs)) {
    const heapNote = state.heapMiB == null
      ? ''
      : ` · heap ${String(state.heapMiB).padStart(6)} MiB (${state.kibPerFeature ?? '—'} KiB/feature)`;
    console.log(`  ${id.padEnd(20)} count=${String(state.count ?? '—').padStart(6)}${heapNote}${state.error ? ` error=${state.error}` : ''}`);
  }
  const inv = result.inventory;
  console.log(`  entities     ${String(inv.entities).padStart(6)} loaded · ${String(inv.shownEntities).padStart(6)} shown${delta(inv.shownEntities, prior?.inventory?.shownEntities, 'shown')}`);
  console.log(`  per feature  pin billboards ${String(inv.pinBillboards).padStart(6)} · description tables ${String(inv.descriptionTables).padStart(6)}`);
  if (inv.primitivePoints || inv.primitivePolylines || inv.primitiveBillboards) {
    console.log(`  primitives   points ${String(inv.primitivePoints).padStart(6)} · polylines ${String(inv.primitivePolylines).padStart(6)} · billboards ${String(inv.primitiveBillboards).padStart(6)}`);
  }
  console.log(`  heap         boot ${result.heap.bootMiB} MiB → loaded ${result.heap.loadedMiB} MiB · packs ${result.heap.packsMiB} MiB${delta(result.heap.packsMiB, prior?.heap?.packsMiB, 'MiB')}`);
  for (const phase of ['motion', 'rest']) {
    const sample = result.samples[phase];
    if (!sample?.samples) continue;
    console.log(`  ${phase.padEnd(6)}       n=${String(sample.samples).padStart(4)} p50=${sample.p50Ms} ms p90=${sample.p90Ms} ms p95=${sample.p95Ms} ms max=${sample.maxMs} ms${delta(sample.p90Ms, prior?.samples?.[phase]?.p90Ms, 'ms')}`);
  }
  console.log('');
}

const launchOptions = hardwareGpu
  ? {
    headless: false,
    executablePath: fs.existsSync(CHROME_EXECUTABLE) ? CHROME_EXECUTABLE : undefined,
    protocolTimeout: PROTOCOL_TIMEOUT_MS,
    args: ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
  }
  : {
    headless: 'new',
    protocolTimeout: PROTOCOL_TIMEOUT_MS,
    args: [
      '--use-gl=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      // The BASELINE crashes the renderer without this — measured twice on
      // this machine, `Target closed` partway through the world scene. The
      // four packs retain ~695 MiB of JS heap on their own, SwiftShader keeps
      // its framebuffers in the same process, and the default old-space cap is
      // below the sum. Raising it is what makes the slow side measurable at
      // all; it does not flatter it, because the fast side gets the same cap.
      '--js-flags=--expose-gc --max-old-space-size=4096',
    ],
  };

const baseline = baselinePath && fs.existsSync(baselinePath)
  ? JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
  : null;

const versionBrowser = await puppeteer.launch(launchOptions);
const browserVersion = await versionBrowser.version();
await versionBrowser.close();
const context = {
  url,
  ranAt: new Date().toISOString(),
  cpuThrottlingRate: cpuRate,
  gpuMode: hardwareGpu ? 'hardware' : 'swiftshader',
  viewport: VIEWPORT,
  machine: {
    hostname: os.hostname(),
    platform: `${os.platform()} ${os.release()}`,
    cpuModel: os.cpus()?.[0]?.model || 'unknown',
    logicalCpuCount: os.cpus()?.length || 0,
    totalMemoryGiB: round(os.totalmem() / 1024 ** 3, 1),
  },
  browser: { version: browserVersion },
};

console.log('\nperf-infra-lod — the four bundled infrastructure packs');
console.log(`  URL        : ${context.url}`);
console.log(`  Machine    : ${context.machine.hostname} · ${context.machine.cpuModel} · ${context.machine.logicalCpuCount} logical · ${context.machine.totalMemoryGiB} GiB`);
console.log(`  Browser    : ${context.browser.version} · ${context.gpuMode}`);
console.log(`  CPU throttle: ÷${cpuRate}, applied to the sampling only`);
if (baseline) console.log(`  Baseline   : ${baselinePath} (${baseline.context?.ranAt || 'undated'})`);
console.log(context.gpuMode === 'hardware'
  ? '  Timing note: hardware GPU — quote the renderer with any absolute figure.\n'
  : '  Timing note: SwiftShader absolute frame times are not representative; compare before/after on this machine.\n');

const results = [];
for (const scene of scenes) {
  results.push(await runScene(scene));
  printScene(results.at(-1), baseline);
}

if (jsonOut) {
  fs.writeFileSync(jsonOut, `${JSON.stringify({ context, scenes: results }, null, 2)}\n`);
  console.log(`Wrote ${jsonOut}`);
}

const failed = results.filter((row) => row.status !== 'ok');
if (failed.length) {
  console.error(`${failed.length} scene(s) failed to run.`);
  process.exit(1);
}
