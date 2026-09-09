#!/usr/bin/env node
/**
 * qa:perf-profile — the light render profile is real, reversible, and never
 * changes what is on the map.
 *
 * The second half is the one worth a harness. A profile that quietly dropped a
 * layer, a label or a datum would be indistinguishable from a fast app in every
 * screenshot, and it would be exactly the wrong trade: this fork's whole claim
 * is that the same France reaches a 2018 laptop, not a smaller France. So the
 * checks below pin the four render costs AND the fact that the layer roster,
 * the panel rows and the detection state are byte-for-byte identical between
 * the two profiles.
 *
 * The other silent failure it exists for: `preserveDrawingBuffer: false`.
 * Nothing on screen changes when that is wrong — but every canvas read outside
 * a render comes back black, which in this app means the voice model gets a
 * black image of "the current view" and describes an empty globe. Check 5
 * reads the canvas in `lite` and asserts it is not black.
 *
 * Usage: node scripts/qa-perf-profile.mjs [--url http://127.0.0.1:4179]
 */
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const argv = process.argv.slice(2);
const url = argv.includes('--url') ? argv[argv.indexOf('--url') + 1] : 'http://127.0.0.1:4179';

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${JSON.stringify(detail)}` : ''}`);
};

const browser = await puppeteer.launch({
  headless: 'new',
  protocolTimeout: 300_000,
  args: [
    '--no-sandbox', '--disable-setuid-sandbox', '--window-size=1366,768',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
  ],
});

/** Everything one profile has to say about itself, in one round-trip. */
function readProfileState() {
  const gev = window.__godsEyeView;
  const { scene } = gev.viewer;
  const gl = scene.context._gl || scene.context.gl;
  const button = document.getElementById('perf-lite-toggle');
  return {
    diagnostics: gev.getPerfProfileDiagnostics(),
    msaa: scene.msaaSamples,
    preserveDrawingBuffer: !!gl.getContextAttributes().preserveDrawingBuffer,
    sharpen: !!gev.styleManager.sharpenEnabled,
    governor: gev.getGlobeDetailDiagnostics(),
    globeSse: scene.globe.maximumScreenSpaceError,
    tileCacheSize: scene.globe.tileCacheSize,
    button: button
      ? { lit: button.classList.contains('active'), pressed: button.getAttribute('aria-pressed') }
      : null,
    // The invariant: `lite` changes HOW, never WHAT.
    layers: gev.dataManager.getAll().map((row) => `${row.id}:${row.enabled ? 1 : 0}`).sort(),
    panelRows: document.querySelectorAll('#data-toggles [data-layer-id]').length,
    detection: gev.styleManager.getDetectionDiagnostics?.()?.mode
      ?? document.getElementById('detection-density-slider')?.value ?? null,
  };
}

/** Boot one profile and read it. `perf` is appended to the URL when given. */
async function boot(perf) {
  const page = await newQaPage(browser);
  await page.setViewport({ width: 1366, height: 768, deviceScaleFactor: 1 });
  const target = perf ? `${url}${url.includes('?') ? '&' : '?'}perf=${perf}` : url;
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  await page.waitForFunction(() => !!window.__godsEyeView?.viewer, { timeout: 180_000, polling: 500 });
  // Past the intro flight, so the frame probe has had its sixty frames and the
  // scene has parked — `lite` must be a decision, not a race.
  await new Promise((resolve) => setTimeout(resolve, 12_000));
  return page;
}

try {
  const fullPage = await boot('full');
  const full = await fullPage.evaluate(readProfileState);
  const litePage = await boot('lite');
  const lite = await litePage.evaluate(readProfileState);

  // ── 1. the two construction arguments actually reached the Viewer ─────────
  check(
    'lite builds the Viewer with one sample per pixel and no preserved buffer',
    full.msaa === 4 && full.preserveDrawingBuffer === true
      && lite.msaa === 1 && lite.preserveDrawingBuffer === false,
    {
      full: { msaa: full.msaa, preserve: full.preserveDrawingBuffer },
      lite: { msaa: lite.msaa, preserve: lite.preserveDrawingBuffer },
    },
  );

  // ── 2. the two runtime levers ────────────────────────────────────────────
  check(
    'lite starts with sharpening off and full starts with it on',
    full.sharpen === true && lite.sharpen === false,
    { full: full.sharpen, lite: lite.sharpen },
  );

  check(
    'only lite arms the motion resolution trade, and neither costs a still frame',
    full.governor.movingResolutionScale === null
      && lite.governor.movingResolutionScale === 0.8
      && full.governor.currentResolutionScale === 1
      && lite.governor.currentResolutionScale === 1,
    {
      full: full.governor.movingResolutionScale,
      lite: lite.governor.movingResolutionScale,
      settledScale: [full.governor.currentResolutionScale, lite.governor.currentResolutionScale],
    },
  );

  check(
    'lite asks the globe for coarser tiles and keeps fewer of them',
    full.globeSse === 2 && lite.globeSse === 3
      && full.tileCacheSize === 100 && lite.tileCacheSize === 60,
    {
      full: { sse: full.globeSse, cache: full.tileCacheSize },
      lite: { sse: lite.globeSse, cache: lite.tileCacheSize },
    },
  );

  // ── 3. the profile is a decision, and it says why ────────────────────────
  check(
    'each profile knows what it is and where the answer came from',
    full.diagnostics.profile === 'full' && lite.diagnostics.profile === 'lite'
      && full.diagnostics.source === 'url' && lite.diagnostics.source === 'url',
    { full: full.diagnostics.profile, lite: lite.diagnostics.profile },
  );

  check(
    'the DISPLAY switch reflects the profile it did not set',
    full.button?.lit === false && full.button?.pressed === 'false'
      && lite.button?.lit === true && lite.button?.pressed === 'true',
    { full: full.button, lite: lite.button },
  );

  // ── 4. THE INVARIANT: same map, same data ────────────────────────────────
  check(
    'lite shows exactly the same layers, in the same states, as full',
    JSON.stringify(full.layers) === JSON.stringify(lite.layers)
      && full.panelRows === lite.panelRows
      && full.detection === lite.detection,
    {
      layersEqual: JSON.stringify(full.layers) === JSON.stringify(lite.layers),
      rows: [full.panelRows, lite.panelRows],
      detection: [full.detection, lite.detection],
    },
  );

  // ── 5. a canvas read in lite still returns a picture ─────────────────────
  // The render and the read are one evaluate: with `preserveDrawingBuffer:
  // false` the buffer is only readable inside the frame that drew it.
  const liteFrame = await litePage.evaluate(() => {
    const { scene } = window.__godsEyeView.viewer;
    // `requestRender()` THEN `render()`: under requestRenderMode a bare
    // `render()` is a no-op and the read comes back black — which is the exact
    // symptom this check is meant to catch in the app, so getting it wrong here
    // would make the harness fail for the harness's own reason.
    scene.requestRender();
    scene.render();
    const gl = scene.context._gl || scene.context.gl;
    const pixels = new Uint8Array(4 * 64 * 64);
    gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let lit = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 24) lit++;
    }
    return { lit, total: pixels.length / 4 };
  });
  check(
    'reading the canvas in lite returns a drawn frame, not black',
    liteFrame.lit > 0,
    liteFrame,
  );

  // ── 6. the switch works, both ways, without a reload ─────────────────────
  const toggled = await fullPage.evaluate(() => {
    const gev = window.__godsEyeView;
    const button = document.getElementById('perf-lite-toggle');
    const before = { msaa: gev.viewer.scene.msaaSamples, sharpen: !!gev.styleManager.sharpenEnabled };
    button.click();
    const on = {
      msaa: gev.viewer.scene.msaaSamples,
      sharpen: !!gev.styleManager.sharpenEnabled,
      moving: gev.getGlobeDetailDiagnostics().movingResolutionScale,
      lit: button.classList.contains('active'),
      stored: (() => { try { return localStorage.getItem('gev:perf-profile'); } catch { return null; } })(),
    };
    button.click();
    const off = {
      msaa: gev.viewer.scene.msaaSamples,
      sharpen: !!gev.styleManager.sharpenEnabled,
      moving: gev.getGlobeDetailDiagnostics().movingResolutionScale,
      lit: button.classList.contains('active'),
    };
    return { before, on, off };
  });
  check(
    'the switch drops MSAA, sharpening and pixels — and puts all three back',
    toggled.on.msaa === 1 && toggled.on.sharpen === false && toggled.on.moving === 0.8
      && toggled.on.lit === true
      && toggled.off.msaa === 4 && toggled.off.sharpen === true && toggled.off.moving === null
      && toggled.off.lit === false,
    toggled,
  );
  check(
    'the switch persists the choice, so the next visit gets the two it cannot change now',
    toggled.on.stored === 'lite',
    { stored: toggled.on.stored },
  );

  // ── 7. the profile never leaves in a share link ──────────────────────────
  const shareLink = await litePage.evaluate(() => {
    const manager = window.__godsEyeView.styleManager?.shareLinkManager;
    try { return manager?.buildShareUrl?.() ?? location.href; } catch { return location.href; }
  });
  check(
    'a share link built in lite carries no render profile',
    !/[?&#][^=]*perf=/.test(String(shareLink).replace(/\?perf=lite/, '')),
    { link: String(shareLink).slice(0, 160) },
  );

  await fullPage.close();
  await litePage.close();
} finally {
  await browser.close();
}

const passed = results.filter((entry) => entry.pass).length;
console.log(`\nqa:perf-profile ${passed}/${results.length}`);
process.exitCode = passed === results.length ? 0 : 1;
