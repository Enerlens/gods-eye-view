#!/usr/bin/env node
/**
 * Browser proof that a camera coming to REST is an event every viewport layer
 * hears — in the real app, on the real layer modules, one layer at a time.
 *
 * WHY THIS CANNOT BE A UNIT TEST, AND WHY IT IS NOT A FLIGHT.
 * `cameraSettle.test.mjs` pins the module against a fake camera; what it
 * cannot pin is that eleven separate layer files actually WIRED it, on enable
 * and on disable. And the bug being fixed is about an event that does not
 * fire: `camera.changed` stops as soon as the motion left falls under
 * `percentageChanged`, which on an eased fly-to is most of a second before the
 * flight ends (measured Paris → Rouen: last `changed` t=2.5 s, `moveEnd`
 * t=3.3 s). So the tail of every flight is a camera that moves and comes to
 * rest with NO `changed` behind it, and until this landed nothing re-read the
 * view it stopped on: the row kept the verdict of a half-way pose — "zoom in"
 * over a city at 23 km, or UNAVAILABLE with the explanation of the city you
 * had just left — until the layer's next poll. Six HOURS, for the registers.
 *
 * Flying here would prove nothing: this harness pumps frames by hand, so
 * `changed` would fire on nearly every one of them and the debounce alone
 * would pass. The tail is reproduced honestly instead — the threshold is
 * raised so the move is under it, exactly as it is at the end of a real
 * flight — and the assertion is that the layer reads anyway.
 *
 * Each layer gets the same four questions, alone on the globe so that every
 * request seen belongs to it and no other:
 *
 *   1. enabling it subscribes it to arrival
 *   2. a rest somewhere NEW is re-read, with `camera.changed` never raised and
 *      the layer's own poll stopped — so the read has one possible author
 *   3. a rest too small to change the question costs NOTHING, which is the
 *      half that decides whether this is a fix or a map that reloads forever
 *   4. disabling it takes the watch away rather than leaking a listener
 *
 * ONE LAYER AT A TIME, deliberately: eleven at once is a render this machine
 * cannot pump under SwiftShader while other harnesses hold the CPU, and the
 * run dies on `Runtime.callFunctionOn timed out` before asserting anything. It
 * also makes every `/api/` request attributable by construction.
 *
 * Run: node scripts/qa-camera-settle.mjs --url http://localhost:4173
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'camera-settle');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = option('--url', process.env.QA_BASE_URL || 'http://localhost:4173');
const HEADFUL = args.includes('--headful');
const ONLY = option('--layer', null);

const chromeCandidates = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  (() => { try { return puppeteer.executablePath(); } catch { return null; } })(),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean);
const chrome = chromeCandidates.find((candidate) => {
  try { return fs.existsSync(candidate); } catch { return false; }
});

/**
 * The eleven layers this change wired, and nothing else. `transit-fr` is
 * deliberately absent: it answers arrival with its own `onCameraSettled`, and
 * `qa:transit-fr` section vii is its proof. The source guard in
 * `cameraSettle.test.mjs` is what keeps these two lists from drifting apart.
 */
const LAYERS = [
  // `traffic` goes FIRST, and the order is a measurement, not a preference. It
  // is the only one of the eleven that holds CONTINUOUS render, so the page
  // draws every frame it can for the whole of its turn. Run last, over a
  // scene still carrying ten layers' worth of hidden primitives, that
  // saturates the main thread and the run dies on `Runtime.callFunctionOn
  // timed out` — measured twice, on a machine at a load average of 8 as well
  // as one at 50, and the same layer passes all its checks alone. The wedge is
  // SwiftShader plus CDP, not the layer: give it the lightest scene.
  'traffic',
  'shared-mobility-fr',
  'irve-fr',
  'bikeshare',
  'amenities-fr',
  'schools-fr',
  'petite-enfance-fr',
  'sup-fr',
  'anfr-fr',
  'delinquance-fr',
  'marine-buoys',
];

/**
 * Paris, low enough that each of the eleven has something to say.
 */
const CITY = { lon: 2.3522, lat: 48.8566, height: 9_000 };
/**
 * What a flight has left to travel once `changed` has gone quiet is metres,
 * not degrees — but 0.02° still moves every layer's request box, which is the
 * whole question this asks.
 */
const HOP_DEG = 0.02;

/**
 * Shared infrastructure every layer draws through, and which therefore says
 * nothing about whether a LAYER asked again. `/api/terrain/heights` is the
 * ground-floor sampler in `groundFloor.js`: it fires whenever a point needs a
 * floor, including for records drawn long before the camera moved, and
 * `/api/geoid` is the one-off ellipsoid-to-sea-level model.
 */
const SHARED_ENDPOINTS = [/^\/api\/terrain\//, /^\/api\/geoid/];
const isLayerRequest = (pathname) => !SHARED_ENDPOINTS.some((pattern) => pattern.test(pathname));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const failures = [];
function check(label, ok, detail = '') {
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

/**
 * Poll with `page.evaluate`, never `page.waitForFunction`: the default polling
 * is `raf`, and the app's render governor keeps the scene at rest, so the wait
 * sits out its whole timeout while the condition has been true for a minute.
 */
async function waitFor(page, fn, arg = null, { timeoutMs = 60_000, gapMs = 250 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (await page.evaluate(fn, arg)) return true;
    } catch { /* context still swapping */ }
    await sleep(gapMs);
  }
  return false;
}

/**
 * Pump frames by hand — the governor is in `requestRenderMode`, so nothing
 * repaints on its own, and Cesium raises `moveEnd` from inside `render()`.
 *
 * `percentageChanged` is re-applied on EVERY frame when silencing, because it
 * is ONE number shared by the whole app (`cameraSensitivity.js`): the layer
 * under test claims it on enable and would otherwise hand `changed` its voice
 * straight back, and the case would prove nothing.
 */
const PUMP_GAP_MS = 70;

/**
 * How long to wait between hand-pumped frames for THIS layer.
 *
 * One of the eleven — `traffic` — holds CONTINUOUS render, which takes the
 * scene out of `requestRenderMode`: the page is already drawing every frame it
 * can get. Pumping on top of that, over a scene still carrying the hidden
 * primitives of the ten layers before it, saturates the main thread and
 * starves the CDP channel. Measured: the run dies on `Runtime.callFunctionOn
 * timed out` on the last layer, while that same layer passes all seven
 * checks when run alone with `--layer traffic`. Giving its frames room is the
 * whole fix, and it belongs in the harness rather than in the layer.
 */
async function pumpGapFor(page) {
  const continuous = await page.evaluate(() => (
    window.__godsEyeView?.viewer?.scene?.requestRenderMode === false
  )).catch(() => false);
  return continuous ? 400 : PUMP_GAP_MS;
}

async function pump(page, frames = 10, gapMs = PUMP_GAP_MS, { silenceChanged = false } = {}) {
  for (let frame = 0; frame < frames; frame += 1) {
    await page.evaluate((silence) => {
      try {
        if (silence) window.__godsEyeView.viewer.camera.percentageChanged = 1e6;
        window.__godsEyeView?.viewer?.scene?.render();
      } catch { /* stalled context */ }
    }, silenceChanged);
    await sleep(gapMs);
  }
}

async function shoot(page, name) {
  try {
    await page.evaluate(() => { try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled */ } });
    await page.screenshot({ path: path.join(SHOTS_DIR, name) });
  } catch (error) {
    console.log(`  · screenshot ${name} unavailable (${String(error?.message || error).split('\n')[0]})`);
  }
}

/** Move the camera without a flight, cancelling whatever the boot armed. */
async function setView(page, { lon, lat, height }) {
  await page.evaluate((view) => {
    const gev = window.__godsEyeView;
    const ellipsoid = gev.viewer.scene.globe?.ellipsoid || gev.viewer.scene.ellipsoid;
    const d2r = Math.PI / 180;
    try { gev.viewer.camera.cancelFlight(); } catch { /* no flight active */ }
    gev.viewer.camera.setView({
      destination: ellipsoid.cartographicToCartesian({
        longitude: view.lon * d2r, latitude: view.lat * d2r, height: view.height,
      }),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    gev.viewer.scene.requestRender?.();
  }, { lon, lat, height });
}

/**
 * Take away a layer's periodic poll, and say whether there was one to take.
 *
 * TIMING MATTERS HERE, AND IT IS NOT THE OBVIOUS ONE. The manager arms the
 * poll AFTER `enable()` returns — `_armUpdateLoop` runs past the first
 * `await module.update(...)` in `manager.js` — while `watchCameraSettle` runs
 * INSIDE `enable()`. So clearing the timer the moment the layer appears in the
 * settle diagnostics clears nothing at all, and the poll lives on: measured,
 * `shared-mobility-fr` (a 60 s poll) intermittently asked the proxy in the
 * middle of the no-op case, which reads exactly like a layer reloading on a
 * rest it should have ignored. Wait for the timer to EXIST, then take it.
 *
 * @returns {boolean} Whether a live timer was found and cleared.
 */
function stopPoll(page, id) {
  return page.evaluate((layerId) => {
    const entry = window.__godsEyeView.dataManager.layers.get(layerId);
    if (!entry?.intervalId) return false;
    clearInterval(entry.intervalId);
    entry.intervalId = null;
    return true;
  }, id);
}

/** The view key each watching layer last READ — the whole observable. */
function readMarks(page) {
  return page.evaluate(() => window.__godsEyeView.getCameraSettleDiagnostics());
}

/**
 * Wait until nothing new has been asked of the proxy for a beat.
 *
 * Between the arrival case and the no-op case there is a tail: a load issued
 * on arrival can put a SECOND request on the wire (IRVE asks `/sites` and
 * `/live`), and it lands after the arrival window has been sampled. Counted
 * against the no-op case it reads as "the layer asked again for a view it had
 * already read", which is exactly backwards — it asked once, for the view it
 * arrived on.
 */
async function quiesceNetwork(page, requested, { quietMs = 1_200, timeoutMs = 20_000 } = {}) {
  const started = Date.now();
  let lastCount = requested.length;
  let quietSince = Date.now();
  while (Date.now() - started < timeoutMs) {
    await pump(page, 1, 200, { silenceChanged: true });
    if (requested.length !== lastCount) {
      lastCount = requested.length;
      quietSince = Date.now();
    } else if (Date.now() - quietSince >= quietMs) return true;
  }
  return false;
}

/** Start counting `camera.changed` / `camera.moveEnd` over the next case. */
function armCameraCounters(page) {
  return page.evaluate(() => {
    const camera = window.__godsEyeView.viewer.camera;
    const state = { changed: 0, moveEnd: 0, restore: camera.percentageChanged };
    state.offChanged = camera.changed.addEventListener(() => { state.changed += 1; });
    state.offEnd = camera.moveEnd.addEventListener(() => { state.moveEnd += 1; });
    window.__qaSettle = state;
  });
}

function readCameraCounters(page) {
  return page.evaluate(() => {
    const camera = window.__godsEyeView.viewer.camera;
    const state = window.__qaSettle;
    state.offChanged();
    state.offEnd();
    camera.percentageChanged = state.restore;
    return { changed: state.changed, moveEnd: state.moveEnd };
  });
}

async function main() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: !HEADFUL,
    executablePath: chrome,
    protocolTimeout: 300_000,
    // `--enable-unsafe-swiftshader`, not `--use-gl=swiftshader`: without it
    // Chrome refuses software WebGL outright and the app dies on "Error
    // constructing CesiumWidget", which reads like a broken branch.
    // A SMALL canvas, deliberately. Nothing here is measured in pixels, and
    // SwiftShader's cost is very nearly linear in them: at 1440x900 a single
    // `scene.render()` over a Paris fleet takes tens of seconds while other
    // harnesses hold the CPU, and eleven layers do not finish inside an hour.
    args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=480,360'],
    defaultViewport: { width: 480, height: 360 },
  });

  const requested = [];
  try {
    const page = await newQaPage(browser);
    page.on('request', (request) => {
      const url = request.url();
      const { pathname } = new URL(url);
      if (pathname.startsWith('/api/') && isLayerRequest(pathname)) requested.push(pathname);
    });

    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 180_000 });
    const booted = await waitFor(page, () => Boolean(window.__godsEyeView?.dataManager
      && window.__godsEyeView?.viewer?.camera
      && window.__godsEyeView?.getCameraSettleDiagnostics), null, { timeoutMs: 180_000 });
    if (!booted) throw new Error('the app never published __godsEyeView.getCameraSettleDiagnostics');

    await setView(page, CITY);
    await pump(page, 6);

    const layers = ONLY ? LAYERS.filter((id) => id === ONLY) : LAYERS;
    let hopRequesters = 0;
    for (const [index, id] of layers.entries()) {
      console.log(`[qa] ${id}`);
      try {
      // Alternate sides of the city so consecutive layers never start from the
      // view the previous one left the camera on.
      const home = { ...CITY, lon: CITY.lon + (index % 2 ? HOP_DEG : 0) };
      const away = { ...CITY, lon: home.lon + (index % 2 ? -HOP_DEG : HOP_DEG) };
      await setView(page, home);
      await pump(page, 4);

      // ── 1. enabling subscribes it to arrival ──────────────────────────────
      await page.evaluate((layerId) => {
        // NEVER awaited: `traffic` waits on Overpass, and a harness that waited
        // for the load would die on the protocol timeout before asserting. The
        // mark this case reads is set at the TOP of the read path, before the
        // first `await`.
        void window.__godsEyeView.dataManager.setEnabled(layerId, true);
      }, id);
      const subscribed = await waitFor(page, (layerId) => (
        window.__godsEyeView.getCameraSettleDiagnostics().owners.includes(layerId)
      ), id, { timeoutMs: 60_000 });
      check('enabling it subscribes it to the camera coming to rest', subscribed);
      if (!subscribed) {
        await page.evaluate((layerId) => {
          void window.__godsEyeView.dataManager.setEnabled(layerId, false);
        }, id);
        continue;
      }
      const gap = await pumpGapFor(page);
      const restGap = Math.max(gap, 300);
      // Its own poll is stopped for the rest of this layer's turn, so that
      // every read below has exactly one possible author. Waiting for that
      // poll WAS the old behaviour; a harness that let it run could pass on it.
      const armed = await waitFor(page, (layerId) => Boolean(
        window.__godsEyeView.dataManager.layers.get(layerId)?.intervalId,
      ), id, { timeoutMs: 120_000 });
      check('its poll can be found and stopped, so a read has one author',
        armed && await stopPoll(page, id));
      await pump(page, 4, gap);

      // ── 2. a rest somewhere new is re-read ────────────────────────────────
      let pollCameBack = await stopPoll(page, id);
      const before = (await readMarks(page)).read[id];
      await armCameraCounters(page);
      const hopStart = requested.length;
      await setView(page, away);
      await pump(page, 6, restGap, { silenceChanged: true });
      const settle = await readCameraCounters(page);
      const after = (await readMarks(page)).read[id];
      const hopRequests = requested.length - hopStart;
      if (hopRequests > 0) hopRequesters += 1;
      check('the camera came to rest with `camera.changed` never firing',
        settle.moveEnd > 0 && settle.changed === 0,
        `changed=${settle.changed} moveEnd=${settle.moveEnd}`);
      check('and the layer read the view it settled on, poll stopped',
        typeof after === 'string' && after !== before,
        `${before} → ${after}${hopRequests ? `, ${hopRequests} request(s)` : ''}`);

      // ── 3. a rest that changes no question costs nothing ──────────────────
      //
      // The half that decides whether this is a fix or a new bug: `moveEnd`
      // fires at the end of EVERY gesture, and a layer that reloaded on each
      // would be the map-reloads-forever failure `cameraSensitivity.js` exists
      // to prevent.
      await quiesceNetwork(page, requested);
      pollCameBack = (await stopPoll(page, id)) || pollCameBack;
      await armCameraCounters(page);
      // A metre of altitude at a time: the rectangle moves by ~1 m, far less
      // than the 0.001° (~111 m) the read key is compared at. Far less is not
      // NEVER, though — a metre can still carry an edge across a rounding
      // boundary, and on that rest the question really did change and a read
      // is correct. So each rest is CLASSIFIED by the key rather than assumed,
      // and only those that landed back on the view already read are held to
      // costing nothing.
      //
      // The 300 ms frame gap is not padding: Cesium raises `moveEnd` from
      // `Scene.render` only once `cameraEventWaitTime` (500 ms) has passed
      // since the camera last moved, so a tighter pump ends before the event
      // it is waiting for and the case reads `moveEnd=0`.
      let freeRests = 0;
      let paidRests = 0;
      const freeAsked = [];
      for (let nudge = 1; nudge <= 4; nudge += 1) {
        const keyBefore = (await readMarks(page)).current[id];
        const askedBefore = requested.length;
        await setView(page, { ...away, height: away.height + nudge });
        await pump(page, 3, restGap, { silenceChanged: true });
        const asked = requested.slice(askedBefore);
        if ((await readMarks(page)).current[id] !== keyBefore) paidRests += 1;
        else {
          freeRests += 1;
          freeAsked.push(...asked);
        }
      }
      const nudged = await readCameraCounters(page);
      check('four rests too small to change the question really are rests',
        nudged.moveEnd >= 3, `moveEnd=${nudged.moveEnd}`);
      check('and a rest on the view already read asked for nothing',
        freeAsked.length === 0,
        `${freeRests} free / ${paidRests} across a rounding boundary`
        + `${freeAsked.length ? `, asked: ${[...new Set(freeAsked)].join(' ')}` : ''}`);
      check('and at least two of the four really were the same view',
        freeRests >= 2, `${freeRests} free / ${paidRests} paid`);

      // ── 4. disabling takes the watch away ─────────────────────────────────
      await page.evaluate((layerId) => {
        void window.__godsEyeView.dataManager.setEnabled(layerId, false);
      }, id);
      const released = await waitFor(page, (layerId) => (
        !window.__godsEyeView.getCameraSettleDiagnostics().owners.includes(layerId)
      ), id, { timeoutMs: 30_000 });
      check('and its poll stayed stopped, so nothing above had a second author',
        !pollCameBack, pollCameBack ? 'the manager re-armed it mid-case' : '');
      check('disabling it drops the watch rather than leaking a listener', released);
      await pump(page, 4, gap);
      } catch (error) {
        // One layer wedging the CDP session must not discard the results of the
        // eleven before it — the run is a per-layer contract, not one long
        // transaction. It IS reported as a failure, so a wedge cannot pass.
        check(`${id} finished its turn`, false, String(error?.message || error).split('\n')[0]);
      }
    }

    // A run where NOTHING asked the proxy for anything would pass case 3 for
    // the wrong reason, and case 2 on a mark the layer set for free.
    const expectedRequesters = Math.min(2, layers.length);
    check('the hops really did reach the network, on more than one layer',
      hopRequesters >= expectedRequesters,
      `${hopRequesters}/${layers.length} layer(s) requested on arrival`);
    await shoot(page, '01-after.png');

    console.log(`\n[qa] shots → ${path.relative(REPO_ROOT, SHOTS_DIR)}`);
  } finally {
    await browser.close();
  }

  if (failures.length) {
    console.error(`\n[qa] FAILED (${failures.length}):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('\n[qa] PASS');
  }
}

main().catch((error) => {
  console.error('[qa] harness error:', error);
  process.exitCode = 1;
});
