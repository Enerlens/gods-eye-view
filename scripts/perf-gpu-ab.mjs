#!/usr/bin/env node
/**
 * perf:gpu-ab — what each fixed render cost actually costs, one lever at a time.
 *
 * ── THE PREMISE THIS FILE CORRECTS ──────────────────────────────────────────
 *
 * `perf-boot-probe.mjs`, `perf-real-gpu-console.js` and § 0 of
 * `docs/PLAN-PERFORMANCE.md` all say the same thing: headless Chromium renders
 * through SwiftShader, in software, so the fixed GPU costs (MSAA, the sharpen
 * pass, `preserveDrawingBuffer`, render resolution) are invisible in the lab
 * and phase 2 cannot start without borrowed hardware.
 *
 * That was true of the OLD headless mode. It is not true of `headless: 'new'`,
 * which is the full browser with the window suppressed: measured on this Mac,
 * Cesium's own GL context reports `ANGLE (Apple, ANGLE Metal Renderer: Apple
 * M5)`. The lab has had a real GPU all along. So this harness refuses to run
 * on a software renderer — the same refusal as the pasted snippet — and
 * otherwise measures the four levers directly.
 *
 * ── WHY IT IS STILL NOT AN INTEL UHD 620 ────────────────────────────────────
 *
 * An M5 is roughly an order of magnitude past the machine § 0 cares about, and
 * at 1366×768 every one of these levers hides under the 16.7 ms vsync floor.
 * Two things fix that, and neither pretends to be the laptop:
 *
 *   1. `--scale N` renders at N× the linear resolution (N² the pixels). All
 *      four levers are bounded by pixel fill, so this reproduces their RATIO
 *      on a machine that has to work for its frames. It does not reproduce the
 *      absolute p90 of a UHD 620, and no number printed here should ever be
 *      copied into the plan's exit criteria — that line stays "attend 0.3".
 *   2. `--mode burst` (the default) never waits for a frame. It calls
 *      `scene.render()` back to back and forces the pipeline to drain with a
 *      one-pixel `readPixels`, so the number is render work per frame, not
 *      the display's refresh interval. `--mode orbit` runs the rAF orbit of
 *      `perf:boot` instead, for a figure comparable to the lab column.
 *
 * ── WHY THE CONDITIONS ARE INTERLEAVED ──────────────────────────────────────
 *
 * This Mac is shared with other agents and its load average moves between 4
 * and 22 within one bench. A/B/A/B with a median per condition cancels the
 * drift that a "measure all of A, then all of B" pass would bank as a result.
 * Every lever is measured against the baseline that ran BESIDE it, never
 * against a baseline from another minute.
 *
 * Usage:
 *   node scripts/perf-gpu-ab.mjs --url http://127.0.0.1:4179
 *   node scripts/perf-gpu-ab.mjs --scale 3 --at lyon --layers irve-fr,schools-fr,transit-fr
 *   node scripts/perf-gpu-ab.mjs --levers msaa,sharpen --repeats 5 --json
 */
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const has = (k) => argv.includes(k);

const url = arg('--url', 'http://127.0.0.1:4179');
const scale = Number(arg('--scale', '2'));
const at = arg('--at', 'paris');
const layers = arg('--layers', '').split(',').map((s) => s.trim()).filter(Boolean);
const repeats = Number(arg('--repeats', '3'));
const frames = Number(arg('--frames', '60'));
const settleMs = Number(arg('--settle', '0'));
const mode = arg('--mode', 'burst');
const asJson = has('--json');
const wanted = arg('--levers', 'msaa,sharpen,preserve,res08,sse3,detect50')
  .split(',').map((s) => s.trim()).filter(Boolean);

/** Same parked views as `perf:boot`, so a viewpoint never explains a delta. */
const VIEWS = {
  paris: { lon: 2.2945, lat: 48.8584, height: 12_000 },
  lyon: { lon: 4.8357, lat: 45.7640, height: 12_000 },
  globe: { lon: 2.2945, lat: 48.8584, height: 12_000_000 },
};
const view = VIEWS[at] || VIEWS.paris;

const log = (...a) => { if (!asJson) console.log(...a); };
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const round = (n, d = 2) => Number(n.toFixed(d));

/**
 * The levers, as in-page mutations. Each one is `{ on, off }` so a condition is
 * always LEFT as it was found — a lever that leaked would poison every
 * measurement after it.
 *
 * `preserve` is absent on purpose: `preserveDrawingBuffer` is a context
 * attribute fixed at `new Cesium.Viewer(...)`, so it cannot be flipped in
 * place. It is measured as a second page whose `getContext` is patched before
 * any app code runs — see `measurePreserve()`.
 */
const RUNTIME_LEVERS = {
  msaa: {
    label: 'msaaSamples 4 → 1',
    apply: (v) => { const p = v.scene.msaaSamples; v.scene.msaaSamples = 1; return p; },
    restore: (v, p) => { v.scene.msaaSamples = p; },
  },
  sharpen: {
    label: 'sharpen stage OFF',
    apply: () => {
      const sm = window.__godsEyeView.styleManager;
      const previous = sm.sharpenEnabled;
      sm._setSharpenEnabled(false);
      return previous;
    },
    restore: (v, p) => { window.__godsEyeView.styleManager._setSharpenEnabled(p); },
  },
  res08: {
    label: 'resolutionScale ×0.8',
    apply: (v) => { const p = v.resolutionScale; v.resolutionScale = p * 0.8; return p; },
    restore: (v, p) => { v.resolutionScale = p; },
  },
  sse3: {
    label: 'globe maximumScreenSpaceError 2 → 3',
    apply: (v) => {
      const p = v.scene.globe.maximumScreenSpaceError;
      v.scene.globe.maximumScreenSpaceError = 3;
      return p;
    },
    restore: (v, p) => { v.scene.globe.maximumScreenSpaceError = p; },
  },
  /**
   * The two levers `lite` can change WITHOUT a reload, together, on one page.
   *
   * This exists because the two-boot `profile` comparison came back at −86 %
   * while the product of the individual levers predicts −66 %, and two boots
   * are two different sets of resolved tiles. Interleaved on one page, this
   * says how much of the gap is real compounding — Cesium skips the whole
   * post-process ping-pong when no stage is enabled, which is a step, not a
   * factor — and how much was the boots differing.
   */
  liteRuntime: {
    label: 'msaa 1 + sharpen off (one page)',
    apply: (v) => {
      const sm = window.__godsEyeView.styleManager;
      const previous = { msaa: v.scene.msaaSamples, sharpen: sm.sharpenEnabled };
      v.scene.msaaSamples = 1;
      sm._setSharpenEnabled(false);
      return previous;
    },
    restore: (v, p) => {
      v.scene.msaaSamples = p.msaa;
      window.__godsEyeView.styleManager._setSharpenEnabled(p.sharpen);
    },
  },
  // The plan asks for "75 → 40 %". 40 is not a stop: `canonicalizeDensity`
  // snaps the slider to 0/25/50/75/100, so 40 lands on 50 — BALANCED. The
  // lever measures the stop the app can actually reach.
  detect50: {
    label: 'detection density 75 → 50 % (Balanced)',
    apply: () => {
      const sm = window.__godsEyeView.styleManager;
      const slider = sm._detectionDensitySlider;
      if (!slider) return null;
      const previous = slider.value;
      slider.value = '50';
      sm._applyDetectionDensityFromUi();
      return previous;
    },
    restore: (v, p) => {
      if (p == null) return;
      const sm = window.__godsEyeView.styleManager;
      sm._detectionDensitySlider.value = String(p);
      sm._applyDetectionDensityFromUi();
    },
  },
};

/**
 * Install the in-page measurement kit. Defined as a source string because it
 * has to survive `evaluateOnNewDocument` AND be callable again after a reload.
 */
function installKit() {
  window.__gpuab = {
    /**
     * Render `n` frames back to back and return ms per frame. No rAF: the
     * point is render work, not the display's 16.7 ms cadence. The final
     * `readPixels` is the only reliable way to make WebGL admit the GPU has
     * finished — without it the loop times command submission.
     */
    burst(n) {
      const v = window.__godsEyeView.viewer;
      const { scene } = v;
      const gl = scene.context._gl || scene.context.gl;
      const px = new Uint8Array(4);
      // One warm frame outside the clock: the first render after a state
      // change recompiles shaders and re-uploads uniforms, and that cost
      // belongs to the change, not to the steady state being measured.
      v.camera.rotateRight(0.002);
      scene.render();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const t0 = performance.now();
      for (let i = 0; i < n; i++) {
        v.camera.rotateRight(0.002);
        scene.render();
      }
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return (performance.now() - t0) / n;
    },
    /** The rAF orbit of `perf:boot`, for a figure comparable to the lab column. */
    orbit(ms) {
      return new Promise((resolve) => {
        const v = window.__godsEyeView.viewer;
        const { scene } = v;
        const times = [];
        let last = performance.now();
        const off = scene.postRender.addEventListener(() => {
          const now = performance.now(); times.push(now - last); last = now;
        });
        const start = performance.now();
        const spin = () => {
          if (performance.now() - start > ms) {
            off(); times.sort((a, b) => a - b);
            const p = (q) => times[Math.floor(times.length * q)] || 0;
            return resolve({ p50: p(0.5), p90: p(0.9), p99: p(0.99), fps: times.length / (ms / 1000) });
          }
          v.camera.rotateRight(0.004); scene.requestRender(); requestAnimationFrame(spin);
        };
        requestAnimationFrame(spin);
      });
    },
  };
}

/**
 * Refuse to report on a software renderer. A SwiftShader run is not a failed
 * run, it is a meaningless one — every conclusion below is about GPU work.
 */
async function rendererOf(page) {
  return page.evaluate(() => {
    const { scene } = window.__godsEyeView.viewer;
    const gl = scene.context._gl || scene.context.gl;
    const d = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: String(d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
      preserve: !!gl.getContextAttributes().preserveDrawingBuffer,
      msaa: scene.msaaSamples,
      canvas: `${scene.canvas.width}×${scene.canvas.height}`,
      cores: navigator.hardwareConcurrency ?? null,
    };
  });
}

const LAUNCH = {
  headless: 'new',
  protocolTimeout: 600_000,
  args: [
    '--no-sandbox', '--disable-setuid-sandbox', '--window-size=1366,768',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
  ],
};

/**
 * Boot the app, park the camera, turn the asked-for layers on, and let the
 * scene drain. Shared by the runtime pass and the `preserve` pass so the two
 * numbers describe the same scene.
 * @param {import('puppeteer').Browser} browser
 * @param {{patchContext?: boolean, profile?: 'full'|'lite'|null}} [options]
 *   `patchContext` forces `preserveDrawingBuffer: false` before any app code
 *   runs; `profile` appends `?perf=` so the app decides for itself.
 */
async function bootParked(browser, { patchContext = false, profile = null } = {}) {
  const page = await newQaPage(browser);
  await page.setViewport({ width: 1366, height: 768, deviceScaleFactor: 1 });
  if (patchContext) {
    // The only honest way to A/B a context attribute: change it at the source,
    // before the Viewer that would otherwise fix it for the page's lifetime.
    await page.evaluateOnNewDocument(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function patched(type, attrs) {
        if (/webgl/i.test(String(type)) && attrs && typeof attrs === 'object') {
          return original.call(this, type, { ...attrs, preserveDrawingBuffer: false });
        }
        return original.call(this, type, attrs);
      };
    });
  }
  await page.evaluateOnNewDocument(installKit);
  const target = profile
    ? `${url}${url.includes('?') ? '&' : '?'}perf=${profile}`
    : url;
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  await page.waitForFunction(() => !!window.__godsEyeView?.viewer, { timeout: 180_000, polling: 500 });
  await page.evaluate(async ({ v, ids, s }) => {
    const gev = window.__godsEyeView;
    const viewer = gev.viewer;
    // Cancel first: the intro tween resumes under a later setView and drags
    // the camera out of the measured view mid-bench.
    viewer.camera.cancelFlight();
    viewer.camera.setView({
      destination: viewer.scene.globe.ellipsoid.cartographicToCartesian({
        longitude: v.lon * Math.PI / 180, latitude: v.lat * Math.PI / 180, height: v.height,
      }),
      orientation: { heading: 0, pitch: -Math.PI / 4, roll: 0 },
    });
    if (s !== 1) viewer.resolutionScale = s;
    for (const id of ids) {
      try { await gev.dataManager.setEnabled(id, true, { origin: 'user' }); } catch { /* reported by the caller */ }
    }
  }, { v: view, ids: layers, s: scale });
  await new Promise((res) => setTimeout(res, settleMs || (layers.length ? 15_000 : 8_000)));
  // The kit is installed on the document, but a reload-free boot needs it
  // present now; re-running it is idempotent.
  await page.evaluate(installKit);
  return page;
}

/** One measurement of the current scene state, in the selected mode. */
async function sample(page) {
  if (mode === 'orbit') {
    const r = await page.evaluate((ms) => window.__gpuab.orbit(ms), 5000);
    return r.p90;
  }
  return page.evaluate((n) => window.__gpuab.burst(n), frames);
}

/**
 * A/B one runtime lever, interleaved. Returns the two medians and the ratio.
 */
async function measureLever(page, key) {
  const lever = RUNTIME_LEVERS[key];
  const base = [];
  const alt = [];
  for (let i = 0; i < repeats; i++) {
    base.push(await sample(page));
    const saved = await page.evaluate((fn) => {
      // eslint-disable-next-line no-new-func
      const apply = new Function(`return (${fn})`)();
      return apply(window.__godsEyeView.viewer);
    }, lever.apply.toString());
    alt.push(await sample(page));
    await page.evaluate(({ fn, p }) => {
      // eslint-disable-next-line no-new-func
      const restore = new Function(`return (${fn})`)();
      restore(window.__godsEyeView.viewer, p);
    }, { fn: lever.restore.toString(), p: saved });
  }
  const b = median(base);
  const a = median(alt);
  return {
    lever: key, label: lever.label,
    baseMs: round(b), leverMs: round(a),
    deltaMs: round(b - a), gainPct: round(((b - a) / b) * 100, 1),
    base, alt,
  };
}

/**
 * `preserveDrawingBuffer` cannot be flipped in place, so it gets two boots and
 * a between-page comparison. That comparison is weaker than the interleaved
 * ones — two boots are two different scenes' worth of tiles — so the pass runs
 * `repeats` samples on each page and reports both spreads.
 */
async function measurePreserve(browser) {
  const out = { lever: 'preserve', label: 'preserveDrawingBuffer true → false' };
  const pages = [];
  for (const patch of [false, true]) {
    const page = await bootParked(browser, { patchContext: patch });
    const info = await rendererOf(page);
    const samples = [];
    for (let i = 0; i < repeats; i++) samples.push(await sample(page));
    pages.push({ patch, samples, actual: info.preserve });
    await page.close();
  }
  const [on, off] = pages;
  out.baseMs = round(median(on.samples));
  out.leverMs = round(median(off.samples));
  out.deltaMs = round(out.baseMs - out.leverMs);
  out.gainPct = round(((out.baseMs - out.leverMs) / out.baseMs) * 100, 1);
  out.base = on.samples;
  out.alt = off.samples;
  out.contextHonored = on.actual === true && off.actual === false;
  return out;
}

/**
 * The whole `lite` profile against the whole `full` one, as the app ships it.
 *
 * Not a lever — the SUM of them, including the two that no runtime toggle can
 * reach. Two boots, `?perf=full` and `?perf=lite`, and the same burst on each.
 *
 * ── READ THIS BEFORE QUOTING THE NUMBER ─────────────────────────────────────
 *
 * It is the weakest measurement in this file and it has already been wrong
 * once. On 2026-09-09 it reported −86 % and −89 % on two consecutive runs at
 * `--scale 2`, while the same two levers interleaved ON ONE PAGE reported
 * −63 %, and the product of their individual gains predicts −58 %. Two boots
 * are two different sets of resolved tiles, and the difference banked as a
 * result. Use `--levers liteRuntime` for a figure that survives scrutiny; use
 * this one only to confirm that `?perf=` reaches the Viewer at all.
 */
async function measureProfiles(browser) {
  const out = { lever: 'profile', label: 'the whole lite profile' };
  const readings = {};
  for (const profile of ['full', 'lite']) {
    const page = await bootParked(browser, { profile });
    const info = await rendererOf(page);
    const samples = [];
    for (let i = 0; i < repeats; i++) samples.push(await sample(page));
    readings[profile] = { samples, msaa: info.msaa, preserve: info.preserve };
    await page.close();
  }
  out.baseMs = round(median(readings.full.samples));
  out.leverMs = round(median(readings.lite.samples));
  out.deltaMs = round(out.baseMs - out.leverMs);
  out.gainPct = round(((out.baseMs - out.leverMs) / out.baseMs) * 100, 1);
  out.base = readings.full.samples;
  out.alt = readings.lite.samples;
  // A `lite` boot that still reports msaa 4 means the profile never reached
  // the Viewer, and the number above would be two identical builds.
  out.profileHonored = readings.full.msaa === 4 && readings.lite.msaa === 1
    && readings.full.preserve === true && readings.lite.preserve === false;
  return out;
}

const browser = await puppeteer.launch(LAUNCH);
const findings = [];
let header = null;
try {
  const page = await bootParked(browser);
  header = await rendererOf(page);
  if (/swiftshader|software|llvmpipe/i.test(header.renderer)) {
    console.error(`SOFTWARE renderer (${header.renderer}) — every number below would be a CPU millisecond. Refusing.`);
    await browser.close();
    process.exit(2);
  }
  log(`renderer: ${header.renderer}`);
  log(`canvas ${header.canvas} · scale ×${scale} · msaa ${header.msaa} · preserve ${header.preserve} · mode ${mode}${mode === 'burst' ? ` (${frames} frames)` : ''}`);
  log(`view ${at} · layers ${layers.join(',') || '(none)'} · ${repeats} interleaved repeats`);
  log('');

  for (const key of wanted) {
    if (key === 'preserve' || key === 'profile') continue;
    if (!RUNTIME_LEVERS[key]) { log(`(unknown lever ${key}, skipped)`); continue; }
    const r = await measureLever(page, key);
    findings.push(r);
    log(`${r.label.padEnd(38)} ${String(r.baseMs).padStart(7)} → ${String(r.leverMs).padStart(7)} ms   ${r.gainPct >= 0 ? '−' : '+'}${Math.abs(r.gainPct)} %`);
  }
  await page.close();

  if (wanted.includes('preserve')) {
    const r = await measurePreserve(browser);
    findings.push(r);
    log(`${r.label.padEnd(38)} ${String(r.baseMs).padStart(7)} → ${String(r.leverMs).padStart(7)} ms   ${r.gainPct >= 0 ? '−' : '+'}${Math.abs(r.gainPct)} %${r.contextHonored ? '' : '  ⚠ context attribute NOT honored'}`);
  }

  if (wanted.includes('profile')) {
    const r = await measureProfiles(browser);
    findings.push(r);
    log('');
    log(`${r.label.padEnd(38)} ${String(r.baseMs).padStart(7)} → ${String(r.leverMs).padStart(7)} ms   ${r.gainPct >= 0 ? '−' : '+'}${Math.abs(r.gainPct)} %${r.profileHonored ? '' : '  ⚠ ?perf= did NOT reach the Viewer'}`);
    log('  ↑ two boots, two sets of tiles — indicative only. Quote `liteRuntime` instead.');
  }
} finally {
  await browser.close();
}

if (asJson) {
  console.log(JSON.stringify({ url, at, layers, scale, mode, frames, repeats, header, findings }, null, 2));
} else {
  log('');
  log('Interleaved medians on a real GPU that is NOT the reference machine.');
  log('Ranking is the deliverable; the absolute p90 of an Intel UHD 620 is still task 0.3.');
}
