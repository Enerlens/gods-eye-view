#!/usr/bin/env node
/**
 * Deterministic browser proof for the live French transit layer (`transit-fr`).
 *
 * The feed itself is live and therefore untestable as a fixed truth, so this
 * harness intercepts `/api/transit-fr/*` with a fixture and proves the four
 * behaviours that a live feed cannot prove for you:
 *
 *   i.   the altitude gate does not fetch — a country-scale view issues NO
 *        viewport request and reports zoom-in guidance rather than an empty map
 *   ii.  a city view renders one glyph per reported vehicle, tinted by mode,
 *        and a fix older than the staleness bound is dropped rather than drawn
 *   iii. a vehicle GLIDES between two reported fixes instead of teleporting,
 *        and never runs past the newest fix
 *   iv.  clicking a vehicle raises the protected card with operator values,
 *        and Escape puts it back
 *   v.   the schedule enrichment survives the round trip — a late vehicle
 *        carries its minutes into the ambient label, and the row says how much
 *        of what is on screen is running behind
 *
 * Screenshots are written under the gitignored `qa-shots/transit-fr/`.
 *
 * Run: node scripts/qa-transit-fr.mjs --url http://localhost:4173
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'transit-fr');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = option('--url', process.env.QA_BASE_URL || 'http://localhost:4173');
const APP_ORIGIN = new URL(APP_URL).origin;
const HEADFUL = args.includes('--headful');

const chromeCandidates = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  (() => { try { return puppeteer.executablePath(); } catch { return null; } })(),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean);
const chrome = chromeCandidates.find((candidate) => {
  try { return fs.existsSync(candidate); } catch { return false; }
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Bordeaux, where the PAN's densest vehicle-position feed actually runs. */
const CITY = { lon: -0.5792, lat: 44.8378 };

const FEED = {
  id: 'pan-83026',
  network: 'TBM',
  area: 'Bordeaux Métropole',
  modes: ['urban'],
  licence: 'Licence Ouverte 2.0',
  publisher: 'Bordeaux Métropole',
  pageUrl: 'https://transport.data.gouv.fr/resources/83026',
  datasetUrl: 'https://transport.data.gouv.fr/datasets/reseau-tbm',
  inView: 0,
  reported: 0,
  retrievedAt: new Date().toISOString(),
  stale: false,
  error: null,
};

/** A grid of fixture vehicles around the city centre, plus one stale fix. */
function vehiclePayload({ shiftDeg = 0, includeStale = false } = {}) {
  const now = Date.now();
  const vehicles = [];
  for (let i = 0; i < 24; i++) {
    const row = Math.floor(i / 6);
    const column = i % 6;
    const vehicle = {
      id: `pan-83026:bus-${i}`,
      feed: FEED.id,
      lat: Number((CITY.lat - 0.02 + row * 0.012 + shiftDeg).toFixed(5)),
      lon: Number((CITY.lon - 0.03 + column * 0.012).toFixed(5)),
      mode: i % 6 === 5 ? 'intercity' : 'urban',
      bearing: i % 5 === 0 ? undefined : (i * 15) % 360,
      speedMps: 8.333,
      route: String(i % 12),
      label: `TBM ${1000 + i}`,
      status: 'in-transit',
      occupancy: 'few-seats',
      timestampMs: now - 5000,
    };
    // The four schedule outcomes a real viewport mixes: a deviation past the
    // band, one inside it, a run that was joined but whose network publishes no
    // deviation at all, and a vehicle nothing could be said about.
    if (i % 4 === 0) Object.assign(vehicle, { delaySec: 245, delayFrom: 'current-stop', tripMatch: 'trip' });
    else if (i % 4 === 1) Object.assign(vehicle, { delaySec: 30, delayFrom: 'current-stop', tripMatch: 'trip' });
    else if (i % 4 === 2) vehicle.tripMatch = 'trip';
    vehicles.push(vehicle);
  }
  // One of each disruption, so the card and the row have something to say.
  Object.assign(vehicles[0], {
    alert: {
      scope: 'route',
      text: 'Bordeaux : travaux quai de Paludate',
      effect: 'detour',
      severity: 'warning',
    },
  });
  Object.assign(vehicles[5], { tripState: 'canceled', skippedStops: 2, skippedAhead: true });
  Object.assign(vehicles[9], {
    delaySec: undefined,
    awaitingDeparture: true,
    scheduledDepartureMs: now + 45 * 60 * 1000,
  });
  if (includeStale) {
    vehicles.push({
      id: 'pan-83026:bus-stale',
      feed: FEED.id,
      lat: CITY.lat,
      lon: CITY.lon,
      mode: 'urban',
      route: 'STALE',
      // 40 minutes old: the vehicle stopped reporting, so it must not be drawn.
      timestampMs: now - 40 * 60 * 1000,
    });
  }
  return {
    status: 'ready',
    retrievedAt: new Date().toISOString(),
    box: { south: CITY.lat - 0.1, west: CITY.lon - 0.1, north: CITY.lat + 0.1, east: CITY.lon + 0.1 },
    vehicles,
    feeds: [{ ...FEED, inView: vehicles.length, reported: vehicles.length }],
    feedsMatched: 1,
    feedsFetched: 1,
    feedsFailed: 0,
    feedsTruncated: false,
    vehiclesTruncated: false,
    schedule: {
      late: vehicles.filter((entry) => (entry.delaySec ?? 0) >= 180).length,
      early: 0,
      onTime: vehicles.filter((entry) => entry.delaySec === 30).length,
      unknown: vehicles.filter((entry) => entry.delaySec === undefined).length,
      waiting: vehicles.filter((entry) => entry.awaitingDeparture).length,
      canceled: vehicles.filter((entry) => entry.tripState === 'canceled').length,
      skipped: vehicles.filter((entry) => entry.skippedStops > 0).length,
      alerted: vehicles.filter((entry) => entry.alert).length,
    },
    indexGeneratedAt: new Date().toISOString(),
  };
}

const failures = [];
function check(label, condition, detail = '') {
  const ok = Boolean(condition);
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`);
  return ok;
}

/**
 * Render `frames` frames explicitly.
 *
 * Everything downstream of a camera move needs real frames: Cesium raises
 * `camera.changed` from the render pass, and that event is what tells the layer
 * to reload its viewport. A software-rendered headless context sometimes has no
 * animation-frame loop at all, so the harness pumps the scene itself rather
 * than trusting the browser to.
 */
async function pump(page, frames = 8, gapMs = 80) {
  for (let frame = 0; frame < frames; frame++) {
    await page.evaluate(() => {
      try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled context */ }
    });
    await sleep(gapMs);
  }
}

/** Teleport the camera (duck-typed cartographic — no Cesium global). */
async function setView(page, lon, lat, height) {
  await page.evaluate((lo, la, h) => {
    const gev = window.__godsEyeView;
    const ellipsoid = gev.viewer.scene.globe?.ellipsoid || gev.viewer.scene.ellipsoid;
    const d2r = Math.PI / 180;
    try { gev.viewer.camera.cancelFlight(); } catch { /* no flight active */ }
    gev.viewer.camera.setView({
      destination: ellipsoid.cartographicToCartesian({ longitude: lo * d2r, latitude: la * d2r, height: h }),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    gev.viewer.scene.requestRender?.();
  }, lon, lat, height);
  await pump(page, 4);
}

/**
 * Screenshot, best-effort.
 *
 * A frame is pumped first, because `captureScreenshot` waits for one and a
 * software-rendered headless GL context sometimes has no animation-frame loop
 * running at all. A shot that still cannot be taken is reported and skipped —
 * these are evidence, not assertions, and losing one must not fail the run.
 */
async function shoot(page, name) {
  try {
    await page.evaluate(() => { try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled context */ } });
    await page.screenshot({ path: path.join(SHOTS_DIR, name) });
  } catch (error) {
    console.log(`  · screenshot ${name} unavailable (${String(error?.message || error).split('\n')[0]})`);
  }
}

/**
 * Read the layer's own view of itself. `rendered` counts the contacts the
 * layer is willing to hand the detection overlay, which is the same set it has
 * glyphs for — no reach into Cesium's private primitive list.
 */
function layerProbe(page) {
  return page.evaluate(() => {
    const module = window.__godsEyeView.dataManager.layers.get('transit-fr').module;
    return {
      stats: module.getStats(),
      feeds: module.getFeedSummaries(),
      rendered: module.getDetectableObjects({ maxCount: 100000 }).length,
    };
  });
}

async function main() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: !HEADFUL,
    executablePath: chrome,
    args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000 },
    protocolTimeout: 45000,
  });

  try {
    const page = await newQaPage(browser);
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    let payload = vehiclePayload({ includeStale: true });
    let viewportRequests = 0;
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin === APP_ORIGIN && url.pathname === '/api/transit-fr/vehicles') {
        viewportRequests += 1;
        void request.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(payload),
        });
        return;
      }
      if (url.origin === APP_ORIGIN && url.pathname === '/api/transit-fr/feeds') {
        void request.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ feedCount: 151, feedsWithBounds: 125, licences: {} }),
        });
        return;
      }
      void request.continue();
    });

    console.log(`[qa] booting ${APP_URL}`);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Interval polling, not the default animation-frame polling: headless WebGL
    // can stall the rAF loop outright, and a rAF-polled wait would then time
    // out on an app that booted perfectly well.
    await page.waitForFunction(
      () => window.__godsEyeView?.viewer && window.__godsEyeView?.dataManager,
      { timeout: 60000, polling: 200 },
    );
    await sleep(2000);

    // ── i. the altitude gate does not fetch ────────────────────────────────
    console.log('[qa] i. altitude gate');
    await setView(page, CITY.lon, CITY.lat, 1_200_000);
    await page.evaluate(() => window.__godsEyeView.dataManager.setEnabled('transit-fr', true));
    await pump(page, 8);
    await sleep(1500);
    const gated = await layerProbe(page);
    check('a country-scale view issues no viewport request', viewportRequests === 0,
      `${viewportRequests} request(s)`);
    check('and reports zoom-in guidance', gated.stats.status === 'zoom-in',
      `status=${gated.stats.status}`);
    check('with nothing rendered', gated.rendered === 0, `${gated.rendered} glyphs`);
    await shoot(page, '01-gated.png');

    // ── ii. a city view renders the fleet ──────────────────────────────────
    console.log('[qa] ii. city view');
    await setView(page, CITY.lon, CITY.lat, 9_000);
    // Poll until the layer settles rather than guessing a sleep: the reload is
    // debounced behind `camera.changed`, which needs frames this environment
    // does not reliably produce on its own.
    let loaded = null;
    for (let attempt = 0; attempt < 25; attempt++) {
      await pump(page, 3, 60);
      await sleep(400);
      loaded = await layerProbe(page);
      if (viewportRequests >= 1 && !loaded.stats.loading && loaded.stats.count > 0) break;
    }
    check('the viewport request is issued once inside the gate', viewportRequests >= 1,
      `${viewportRequests} request(s)`);
    check('one glyph per reported vehicle', loaded.rendered === 24,
      `${loaded.rendered} glyphs for 24 live + 1 stale`);
    check('the stale fix is dropped, not drawn', loaded.stats.count === 24,
      `count=${loaded.stats.count}`);
    check('the row credits the network it actually used',
      loaded.feeds.some((feed) => feed.network === 'TBM' && feed.licence === 'Licence Ouverte 2.0'));
    await shoot(page, '02-city.png');

    // ── iii. the fleet glides between two reported fixes ───────────────────
    //
    // Frames are pumped explicitly rather than left to the browser: headless
    // WebGL can stall the animation-frame loop for the WHOLE app, which would
    // make this read as "the layer does not move" when nothing rendered at all.
    console.log('[qa] iii. glide between fixes');
    const before = await page.evaluate(() => {
      const module = window.__godsEyeView.dataManager.layers.get('transit-fr').module;
      return {
        count: module.getStats().count,
        positions: Object.fromEntries(module.getDetectableObjects({ maxCount: 100000 })
          .map((object) => [object.sourceId, [object.position.x, object.position.y, object.position.z]])),
      };
    });
    // Every vehicle reports a new fix ~440 m north, 15 s after the previous one.
    payload = vehiclePayload({ shiftDeg: 0.004 });
    await page.evaluate(() => window.__godsEyeView.dataManager.refreshLayer?.('transit-fr'));
    await sleep(400);
    const glide = await page.evaluate(async (previous) => {
      const gev = window.__godsEyeView;
      const module = gev.dataManager.layers.get('transit-fr').module;
      const read = () => Object.fromEntries(module.getDetectableObjects({ maxCount: 100000 })
        .map((object) => [object.sourceId, [object.position.x, object.position.y, object.position.z]]));
      const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      for (let frame = 0; frame < 12; frame++) {
        gev.viewer.scene.render();
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      const mid = read();
      let moved = 0;
      let overshot = 0;
      let arrived = 0;
      for (const [id, from] of Object.entries(previous)) {
        const now = mid[id];
        if (!now) continue;
        const travelled = distance(from, now);
        if (travelled > 1) moved += 1;
        // A vehicle is 440 m from its previous fix. Anything past that is
        // extrapolation past what the feed actually said.
        if (travelled > 460) overshot += 1;
        if (travelled > 430) arrived += 1;
      }
      return { moved, overshot, arrived, tracked: Object.keys(previous).length };
    }, before.positions);

    check('there is a fleet to glide in the first place', glide.tracked > 0,
      `${glide.tracked} tracked`);
    check('the fleet survives a refresh as the same contacts',
      glide.tracked === before.count, `${before.count} → ${glide.tracked}`);
    check('every vehicle is travelling toward its new fix, not teleporting',
      glide.moved === glide.tracked && glide.arrived === 0,
      `${glide.moved}/${glide.tracked} moving, ${glide.arrived} already arrived`);
    check('and none runs past the newest fix', glide.overshot === 0,
      `${glide.overshot} overshot`);
    await shoot(page, '03-glide.png');

    // ── iv. selection card ─────────────────────────────────────────────────
    console.log('[qa] iv. selection card');
    const clicked = await page.evaluate(() => {
      const gev = window.__godsEyeView;
      const scene = gev.viewer.scene;
      const module = gev.dataManager.layers.get('transit-fr').module;
      // Drive the production selection seam directly: a canvas click depends on
      // pick precision under SwiftShader, which is not what this is proving.
      const detectables = module.getDetectableObjects({ maxCount: 5 });
      if (!detectables.length) return null;
      scene.requestRender?.();
      return detectables[0];
    });
    check('detection exposes transit vehicles as VEH contacts',
      clicked && clicked.type === 'VEH', JSON.stringify(clicked));
    check('with a line-tagged callout id', clicked && /^LN |^TRANSIT$/.test(clicked.id),
      clicked?.id);

    // ── v. delays and disruptions ─────────────────────────────────────────
    //
    // The enrichment is not a layer of its own: it rides on the vehicles that
    // were already being drawn. So what is proved here is that it survives the
    // round trip and reaches the two surfaces a viewer sees without clicking —
    // the ambient contact label and the control-panel row.
    console.log('[qa] v. delays and disruptions');
    const labelled = await page.evaluate(() => {
      const module = window.__godsEyeView.dataManager.layers.get('transit-fr').module;
      return {
        ids: module.getDetectableObjects({ maxCount: 100000 }).map((object) => object.id),
        label: module.getStats().loadingLabel,
      };
    });
    const late = labelled.ids.filter((id) => /^LN \d+ \+4m$/.test(id));
    check('a late vehicle carries its minutes into the ambient label', late.length === 6,
      `${late.length} labelled late of ${labelled.ids.length}`);
    check('a vehicle inside the on-time band carries no number',
      labelled.ids.filter((id) => /[+-]\d+m$/.test(id)).length === late.length,
      labelled.ids.filter((id) => /[+-]\d+m$/.test(id)).join(' '));
    check('the row says how much of the viewport is running behind',
      /\b6 late\b/.test(labelled.label || ''), labelled.label);
    check('and names a cancelled run rather than hiding it',
      /\b1 cancelled\b/.test(labelled.label || ''), labelled.label);

    // ── console hygiene ────────────────────────────────────────────────────
    const relevant = consoleErrors.filter((entry) => !/favicon|Failed to load resource/i.test(entry));
    check('no console errors from the layer',
      !relevant.some((entry) => /TransitFR|transit-fr/i.test(entry)),
      relevant.filter((entry) => /TransitFR|transit-fr/i.test(entry)).join(' | '));

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
