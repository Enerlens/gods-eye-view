#!/usr/bin/env node
/**
 * perf:boot — what a small laptop pays to open the globe, and what it pays
 * per frame once it is open.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * `docs/PERFORMANCE.md` was written on an M5: a machine that hides every cost
 * this file measures. The reader we care about — an elected official, a town
 * hall officer, a local journalist — is on a 2018-2020 laptop: 2 cores, Intel
 * UHD integrated graphics, 8 GB, 1366×768, a domestic or 4G line. The default
 * profile here (`--cpu 4 --net 4g`) is that machine, and it is the default so
 * that running the probe with no flags answers the question that matters
 * rather than the flattering one.
 *
 * ── WHAT IT MEASURES, AND WHAT IT CANNOT ────────────────────────────────────
 *
 * Measured honestly: bytes and requests on the wire before the first tile,
 * DOMContentLoaded, the moment `window.__godsEyeView.viewer` exists, the first
 * `postRender`, the JS heap, and the frame-time distribution of a 5 s orbit.
 *
 * NOT measured: the GPU. Headless Chromium renders through SwiftShader, in
 * software, so every millisecond below is a CPU millisecond. Frame times are
 * comparable BETWEEN RUNS OF THIS PROBE and nothing else — they are not what a
 * UHD 620 will show. The fixed GPU costs (MSAA, post-processing,
 * `preserveDrawingBuffer`) are invisible here by construction; they need real
 * hardware. See `docs/PLAN-PERFORMANCE.md` § phase 0.3.
 *
 * ── WHY THE RENDER MEASUREMENTS PARK THE CAMERA FIRST ───────────────────────
 *
 * The app opens with a cinematic fly-in to Paris. Measuring "parked" frames
 * while that flight is still easing would count the flight, and the flight's
 * length depends on the machine — so the same tree would score differently on
 * two laptops for a reason that has nothing to do with what changed. Both
 * render phases therefore cancel the flight and set an explicit view, exactly
 * as `qa-perf.mjs` does, before counting anything.
 *
 * ── SCENARIO ────────────────────────────────────────────────────────────────
 *
 * `--layers` runs the scene a real visitor actually looks at rather than a
 * bare globe: `--layers irve-fr,schools-fr,transit-fr --at lyon` enables them
 * after boot, lets them settle, and reports heap and frame times with them on.
 * A bare globe is the floor, not the target.
 *
 * Usage:
 *   node scripts/perf-boot-probe.mjs --url http://127.0.0.1:4179
 *   node scripts/perf-boot-probe.mjs --cpu 1 --net none          # unthrottled
 *   node scripts/perf-boot-probe.mjs --layers irve-fr,schools-fr,transit-fr --at lyon
 *   node scripts/perf-boot-probe.mjs --warm                       # second visit
 *   node scripts/perf-boot-probe.mjs --json > /tmp/before.json
 */
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const has = (k) => argv.includes(k);

const url = arg('--url', 'http://127.0.0.1:4179');
const cpu = Number(arg('--cpu', '4'));
const net = arg('--net', '4g');
const runs = Number(arg('--runs', '3'));
const windowMs = Number(arg('--window', '25000'));
const layers = arg('--layers', '').split(',').map((s) => s.trim()).filter(Boolean);
const at = arg('--at', 'paris');
const asJson = has('--json');
/**
 * How long to let the scene drain before counting parked frames. The default
 * (8 s bare, 15 s with layers) is enough at the boot viewpoint, but NOT
 * everywhere: at Lyon a bare globe still counted 56 renders / 5 s because the
 * imagery for a viewpoint the boot never flew to was still arriving. Raising
 * this separates "still loading" from "never parks", and those are different
 * bugs with different owners.
 */
const settleMs = Number(arg('--settle', '0'));
/**
 * `--warm` measures the SECOND visit, not the first. The cold number answers
 * "what does a stranger pay"; this one answers "what does the person who comes
 * back tomorrow pay", and they have different levers — bytes for the first,
 * parse/compile for the second, because a warm HTTP cache removes the wire and
 * leaves the 8.2 MB of JavaScript exactly where they were. The priming visit
 * runs UNTHROTTLED on purpose: it is not measured, and throttling it only adds
 * a minute per run.
 */
const warm = has('--warm');

/** 10 Mbit/s down / 60 ms is a domestic line or a good 4G; 3g is the bad day. */
const NET = {
  '4g': { downloadThroughput: 10e6 / 8, uploadThroughput: 3e6 / 8, latency: 60 },
  '3g': { downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8, latency: 150 },
};

/** Where the render phases park. Height is a city overview, not a globe view. */
const VIEWS = {
  paris: { lon: 2.2945, lat: 48.8584, height: 12_000 },
  lyon: { lon: 4.8357, lat: 45.7640, height: 12_000 },
  globe: { lon: 2.2945, lat: 48.8584, height: 12_000_000 },
};
const view = VIEWS[at] || VIEWS.paris;

/**
 * Who serves tiles. Everything else is the APP: the bytes a visitor pays
 * before, and independently of, whatever the basemap decides to stream.
 *
 * This split is the whole point of the boot measurement. "Bytes at the moment
 * the Viewer exists" was the first attempt and it is a race — the Viewer can
 * appear before or after the skybox lands, and the same tree then reports
 * 2.66 MB or 3.51 MB for no reason a reader could act on. Classifying by
 * ORIGIN is deterministic: the app is what this repo ships and phase 1
 * attacks, the tiles are what phase 2.3 attacks, and they never share a
 * column again.
 */
const TILE_HOST_RE = /(^|\.)(tile\.googleapis\.com|assets\.ion\.cesium\.com|api\.cesium\.com|tile\.openstreetmap\.org|data\.geopf\.fr|server\.arcgisonline\.com|tiles\.maps\.eox\.at|virtualearth\.net)$/;

const log = (...a) => { if (!asJson) console.log(...a); };
const sorted = (a) => [...a].sort((x, y) => x - y);
const median = (a) => sorted(a)[Math.floor(a.length / 2)];
const spread = (a) => ({ median: median(a), min: sorted(a)[0], max: sorted(a)[a.length - 1] });
const round = (n, d = 1) => Number(n.toFixed(d));

const results = [];
const failures = [];

for (let r = 0; r < runs; r++) {
  // One bad run must not discard the good ones. This Mac is shared with other
  // agents, and a starved SwiftShader answers `Runtime.callFunctionOn timed
  // out` — a browser failure, not an application one. Losing four valid runs
  // to it costs ten minutes and teaches nothing, so a run that throws is
  // counted and skipped, and the failure count rides in the summary where a
  // reader can weigh it.
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      protocolTimeout: 300_000,
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--window-size=1366,768',
        // Occlusion/background throttling would freeze rAF and lie about the
        // frame clock in a headless window that is never "visible".
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling',
      ],
    });
    // newQaPage, not browser.newPage: the first-run mission card returns on
    // every fresh session and would paint over — and hold focus in front of —
    // everything measured below. See scripts/lib/qa-first-run.mjs.
    const page = await newQaPage(browser);
    await page.setViewport({ width: 1366, height: 768, deviceScaleFactor: 1 });

    // The first-frame probe is installed BEFORE any app code runs, and it hooks
    // `postRender` the moment the Viewer exists. Attaching it after the fact —
    // which is what this script used to do — loses the race on a fast boot: the
    // scene draws its first frame, the render governor parks it, and a listener
    // added a beat later never hears anything. The symptom was a 180 s timeout
    // on the FASTEST configuration measurable here (`--warm`), which reads as a
    // broken app rather than as a broken measurement.
    //
    // setInterval, not requestAnimationFrame: rAF is tied to the compositor, and
    // before the first paint of a headless window there is nothing to drive it.
    await page.evaluateOnNewDocument(() => {
      window.__probe = { firstRender: null, viewerAt: null };
      const timer = setInterval(() => {
        const viewer = window.__godsEyeView?.viewer;
        if (!viewer) return;
        clearInterval(timer);
        window.__probe.viewerAt = performance.now();
        // If a frame is already on screen when we get here, that frame IS the
        // answer; `performance.now()` is then a late but honest upper bound.
        if (viewer.scene.frameState?.frameNumber > 0) window.__probe.firstRender = performance.now();
        viewer.scene.postRender.addEventListener(() => {
          if (window.__probe.firstRender == null) window.__probe.firstRender = performance.now();
        });
      }, 16);
    });

    const cdp = await page.createCDPSession();
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: !warm });

    // The priming visit, when asked for. It fills the HTTP cache and V8's code
    // cache, then is thrown away: the counters below are attached AFTER it, so
    // nothing it paid appears in the run. It waits for the Viewer and then sits
    // out eight more seconds, because the assets that matter most to a second
    // visit — Cesium's terrain-height table, the fonts, the icon subset — are
    // still in flight at the moment the Viewer exists, and a cache primed
    // without them would measure a half-warm boot.
    if (warm) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180_000 });
      await page.waitForFunction(() => !!window.__godsEyeView?.viewer, { timeout: 180_000, polling: 500 });
      await new Promise((res) => setTimeout(res, 8000));
    }

    if (NET[net]) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...NET[net] });
    if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });

    const byType = {}; let reqs = 0; let bytes = 0;
    let appReqs = 0; let appBytes = 0;
    const typeOf = new Map();
    cdp.on('Network.requestWillBeSent', (e) => {
      reqs++;
      const host = new URL(e.request.url).host;
      if (!TILE_HOST_RE.test(host)) appReqs++;
      typeOf.set(e.requestId, { type: e.type, host, url: e.request.url });
    });
    cdp.on('Network.loadingFinished', (e) => {
      const m = typeOf.get(e.requestId); if (!m) return;
      bytes += e.encodedDataLength;
      if (!TILE_HOST_RE.test(m.host)) appBytes += e.encodedDataLength;
      const local = m.host.startsWith('127.') || m.host.startsWith('localhost');
      const k = local ? (m.url.includes('/api/') ? 'api' : m.type) : `ext:${m.host}`;
      byType[k] = byType[k] || { n: 0, kB: 0 };
      byType[k].n++; byType[k].kB += e.encodedDataLength / 1024;
    });

    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180_000 });
    const tDcl = Date.now() - t0;
    await page.waitForFunction(() => !!window.__godsEyeView?.viewer, { timeout: 180_000, polling: 500 });
    const tViewer = Date.now() - t0;
    // The SHELL cost: everything paid to get a Viewer at all — Cesium, the
    // entry chunk, the fonts, the skybox. Tiles arrive after this line and are
    // a different budget with different levers, so the two are never summed
    // into one number again. (The plan's "3.83 MB before the first tile" was
    // this figure measured on a boot where the tiles happened to 404.)
    const shellReqs = reqs; const shellMB = round(bytes / 1048576, 2);
    await page.waitForFunction(() => window.__probe?.firstRender != null, { timeout: 180_000, polling: 250 });
    const tFirstRender = Date.now() - t0;

    // Fixed wall-clock window: globe.tilesLoaded flips true early and often, so
    // it cannot mark "done loading". Everything above this line is the boot cost.
    await new Promise((res) => setTimeout(res, Math.max(0, windowMs - (Date.now() - t0))));
    // Snapshot, not a reference: the listeners keep accumulating through the
    // parked and orbit phases, and a byType that kept growing would not add up
    // to the reqs/MB printed beside it.
    const bootReqs = reqs; const bootBytes = bytes;
    const bootAppReqs = appReqs; const bootAppBytes = appBytes;
    const bootByType = Object.fromEntries(
      Object.entries(byType).map(([k, v]) => [k, { n: v.n, kB: Math.round(v.kB) }]),
    );
    const nav = await page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0];
      return { dcl: n?.domContentLoadedEventEnd, load: n?.loadEventEnd };
    });
    const heapBoot = (await page.metrics()).JSHeapUsedSize / 1048576;

    // Park before counting frames (see header). Layers, if any, go on here.
    // Everything paid AFTER the boot window: the layers, and the imagery of the
    // viewpoint we are about to park at. The boot counters were snapshotted at
    // the 25 s mark, before this line, so without a second pair of marks
    // `--layers` reported the same bytes as a bare globe — which is what it did
    // until 2026-09-09, and which quietly made the "bytes" half of task 0.2
    // unmeasurable.
    //
    // It is `settle`, not `layers`, on purpose: with `--at lyon` and no layer at
    // all this still counted 1.51 MB over 148 requests, because moving the
    // camera to a city the boot never flew to loads that city's tiles. To price
    // the layers alone, run the same viewpoint and the same `--settle` without
    // them and subtract.
    const beforeSettleReqs = reqs; const beforeSettleBytes = bytes;
    const enabled = await page.evaluate(async ({ v, ids }) => {
      const gev = window.__godsEyeView;
      const viewer = gev.viewer;
      viewer.camera.cancelFlight();
      viewer.camera.setView({
        destination: viewer.scene.globe.ellipsoid.cartographicToCartesian({
          longitude: v.lon * Math.PI / 180, latitude: v.lat * Math.PI / 180, height: v.height,
        }),
        orientation: { heading: 0, pitch: -Math.PI / 4, roll: 0 },
      });
      const on = [];
      for (const id of ids) {
        try { await gev.dataManager.setEnabled(id, true, { origin: 'user' }); on.push(id); }
        catch (error) { on.push(`${id}:FAILED ${error?.message ?? error}`); }
      }
      return on;
    }, { v: view, ids: layers });
    // Tiles, fades and layer fetches drain; the settling frames must not land
    // inside the parked count.
    await new Promise((res) => setTimeout(res, settleMs || (layers.length ? 15_000 : 8_000)));

    const settleReqs = reqs - beforeSettleReqs;
    const settleBytes = bytes - beforeSettleBytes;

    const heap = (await page.metrics()).JSHeapUsedSize / 1048576;

    const parked = await page.evaluate(() => new Promise((resolve) => {
      const { scene } = window.__godsEyeView.viewer;
      let renders = 0; let raf = 0; let stop = false;
      const off = scene.postRender.addEventListener(() => { renders++; });
      const tick = () => { if (stop) return; raf++; requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      setTimeout(() => { stop = true; off(); resolve({ renders, raf }); }, 5000);
    }));

    const motion = await page.evaluate(() => new Promise((resolve) => {
      const v = window.__godsEyeView.viewer; const { scene } = v;
      const times = []; let last = performance.now(); let renders = 0;
      const off = scene.postRender.addEventListener(() => {
        const now = performance.now(); times.push(now - last); last = now; renders++;
      });
      const start = performance.now();
      const spin = () => {
        if (performance.now() - start > 5000) {
          off(); times.sort((a, b) => a - b);
          const p = (q) => times[Math.floor(times.length * q)] || 0;
          return resolve({
            renders, fps: renders / 5, p50: p(0.5), p90: p(0.9), p99: p(0.99),
            over33ms: times.filter((t) => t > 33).length,
            over100ms: times.filter((t) => t > 100).length,
          });
        }
        v.camera.rotateRight(0.004); scene.requestRender(); requestAnimationFrame(spin);
      };
      requestAnimationFrame(spin);
    }));

    const heapAfter = (await page.metrics()).JSHeapUsedSize / 1048576;
    const res = {
      run: r + 1, tDcl, tViewer, tFirstRender,
      navDcl: Math.round(nav.dcl), navLoad: Math.round(nav.load),
      shellReqs, shellMB,
      appReqs: bootAppReqs, appMB: round(bootAppBytes / 1048576, 2),
      reqs: bootReqs, MB: round(bootBytes / 1048576, 2),
      heapBootMB: Math.round(heapBoot), heapMB: Math.round(heap), heapAfterMB: Math.round(heapAfter),
      layers: enabled, settleReqs, settleMB: round(settleBytes / 1048576, 2), parked, motion,
      byType: bootByType,
      endReqs: reqs, endMB: round(bytes / 1048576, 2),
    };
    results.push(res);
    log(JSON.stringify(res));
  } catch (error) {
    failures.push(`run ${r + 1}: ${error?.message ?? error}`);
    log(`run ${r + 1} FAILED: ${error?.message ?? error}`);
  } finally {
    await browser?.close().catch(() => {});
  }
}

if (!results.length) {
  console.error(`All ${runs} runs failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
const col = (pick) => spread(results.map(pick));
const summary = {
  url, cpu, net, runs, windowMs, at, layers, settleMs: settleMs || (layers.length ? 15_000 : 8_000),
  cache: warm ? 'warm' : 'cold',
  ok: results.length, failures,
  viewerMs: col((r) => r.tViewer),
  dclMs: col((r) => r.tDcl),
  firstRenderMs: col((r) => r.tFirstRender),
  appReqs: col((r) => r.appReqs),
  appMB: col((r) => r.appMB),
  shellReqs: col((r) => r.shellReqs),
  shellMB: col((r) => r.shellMB),
  reqs: col((r) => r.reqs),
  MB: col((r) => r.MB),
  heapMB: col((r) => r.heapMB),
  settleReqs: col((r) => r.settleReqs),
  settleMB: col((r) => r.settleMB),
  parkedRenders5s: col((r) => r.parked.renders),
  motionFps: col((r) => r.motion.fps),
  p90Ms: col((r) => r.motion.p90),
  p99Ms: col((r) => r.motion.p99),
  over33: col((r) => r.motion.over33ms),
  over100: col((r) => r.motion.over100ms),
};

if (asJson) {
  console.log(JSON.stringify({ summary, results }, null, 2));
} else {
  // One line, dispersion included: a median with no spread is not a measurement.
  const f = (s, d = 0) => `${round(s.median, d)} [${round(s.min, d)}–${round(s.max, d)}]`;
  console.log(
    `\nMEDIAN runs=${results.length}/${runs} cpu×${cpu} net=${net} cache=${warm ? 'warm' : 'cold'} at=${at}${layers.length ? ` layers=${layers.join('+')}` : ''}`
    + ` viewer=${f(summary.viewerMs)}ms firstRender=${f(summary.firstRenderMs)}ms`
    + ` app=${f(summary.appMB, 2)}MB/${f(summary.appReqs)}req`
    + ` window=${f(summary.MB, 2)}MB/${f(summary.reqs)}req`
    + ` settle=${f(summary.settleMB, 2)}MB/${f(summary.settleReqs)}req`
    + ` heap=${f(summary.heapMB)}MB`
    + ` parked/5s=${f(summary.parkedRenders5s)} fps=${f(summary.motionFps, 1)}`
    + ` p90=${f(summary.p90Ms, 1)}ms p99=${f(summary.p99Ms, 1)}ms`
    + ` >33ms=${f(summary.over33)} >100ms=${f(summary.over100)}`,
  );
}
