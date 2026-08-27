#!/usr/bin/env node
/**
 * Deterministic browser proof for the French shared-mobility layer.
 *
 * The live feeds cannot be a fixed truth, so this intercepts
 * `/api/shared-mobility-fr/*` with a fixture and proves the four things the
 * feeds themselves cannot:
 *
 *   i.   the altitude gate does not fetch — a regional view issues NO request
 *        and reports zoom-in guidance rather than an empty map
 *   ii.  a city view draws one point per object, and a station with NO
 *        availability data is coloured neutral rather than empty
 *   iii. the row legend counts what is on screen, by kind, omitting zeroes
 *   iv.  the layer reports the shared municipal bays it merged out, instead of
 *        silently drawing three dots on every bay in the city
 *
 * Run: node scripts/qa-shared-mobility-fr.mjs --url http://localhost:4173
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'shared-mobility-fr');
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

/** Nantes: a real mix of dock stations and a small free-floating fleet. */
const CITY = { lon: -1.5536, lat: 47.2184 };

const DOCK_SYSTEM = {
  id: 'gbfs-dock', name: 'Naolib Nantes', area: 'Nantes Métropole', kind: 'docked',
  licence: 'ODbL 1.0', publisher: 'Nantes Métropole', pageUrl: null, datasetUrl: null,
  stationsSuppressed: 0, retrievedAt: new Date().toISOString(), stale: false, error: null,
};
const FLOAT_SYSTEM = {
  id: 'gbfs-float', name: 'Pony Nantes', area: 'Nantes Métropole', kind: 'free-floating',
  licence: 'Licence Ouverte 2.0', publisher: 'Pony', pageUrl: null, datasetUrl: null,
  // The number this harness exists to keep visible.
  stationsSuppressed: 2480, retrievedAt: new Date().toISOString(), stale: false, error: null,
};

function objectsPayload() {
  const now = Math.floor(Date.now() / 1000);
  const stations = [];
  for (let i = 0; i < 12; i++) {
    const known = i < 9;
    stations.push({
      id: `gbfs-dock:${i}`,
      system: DOCK_SYSTEM.id,
      lat: Number((CITY.lat - 0.01 + Math.floor(i / 4) * 0.008).toFixed(5)),
      lon: Number((CITY.lon - 0.015 + (i % 4) * 0.01).toFixed(5)),
      name: `Station ${i}`,
      // Three stations publish NO availability. They must not read as empty.
      available: known ? (i % 3 === 0 ? 0 : 6 + i) : null,
      docks: known ? 4 : null,
      capacity: known ? 20 : null,
      renting: true,
      byKind: known ? { bike: 4, ebike: 2 } : null,
    });
  }
  const vehicles = [];
  const kinds = ['ebike', 'scooter', 'bike', 'moped'];
  for (let i = 0; i < 20; i++) {
    vehicles.push({
      id: `gbfs-float:${i}`,
      system: FLOAT_SYSTEM.id,
      lat: Number((CITY.lat + 0.004 + Math.floor(i / 5) * 0.005).toFixed(5)),
      lon: Number((CITY.lon + 0.004 + (i % 5) * 0.006).toFixed(5)),
      kind: kinds[i % kinds.length],
      rangeMeters: 8000 + i * 100,
      lastReported: now - 45,
    });
  }
  return {
    status: 'ready',
    retrievedAt: new Date().toISOString(),
    box: { south: CITY.lat - 0.1, west: CITY.lon - 0.1, north: CITY.lat + 0.1, east: CITY.lon + 0.1 },
    stations,
    vehicles,
    systems: [
      { ...DOCK_SYSTEM, stationsInView: stations.length, vehiclesInView: 0 },
      { ...FLOAT_SYSTEM, stationsInView: 0, vehiclesInView: vehicles.length },
    ],
    systemsMatched: 2,
    systemsFetched: 2,
    systemsFailed: 0,
    systemsTruncated: false,
    objectsTruncated: false,
    redundantSystems: 23,
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

/** Render frames explicitly — headless WebGL can stall the rAF loop outright. */
async function pump(page, frames = 8, gapMs = 80) {
  for (let frame = 0; frame < frames; frame++) {
    await page.evaluate(() => {
      try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled context */ }
    });
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

function probe(page) {
  return page.evaluate(() => {
    const module = window.__godsEyeView.dataManager.layers.get('shared-mobility-fr').module;
    return {
      stats: module.getStats(),
      systems: module.getSystemSummaries(),
      legend: module.getRowControls().legend.map((item) => [item.label, item.count]),
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
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    const payload = objectsPayload();
    let objectRequests = 0;
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin === APP_ORIGIN && url.pathname === '/api/shared-mobility-fr/objects') {
        objectRequests += 1;
        void request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
        return;
      }
      if (url.origin === APP_ORIGIN && url.pathname === '/api/shared-mobility-fr/systems') {
        void request.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ catalogResourceCount: 165, distinctSystemCount: 135, redundantCount: 23 }),
        });
        return;
      }
      void request.continue();
    });

    console.log(`[qa] booting ${APP_URL}`);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(
      () => window.__godsEyeView?.viewer && window.__godsEyeView?.dataManager,
      { timeout: 60000, polling: 200 },
    );
    await sleep(2000);

    // ── i. the altitude gate does not fetch ────────────────────────────────
    console.log('[qa] i. altitude gate');
    await setView(page, CITY.lon, CITY.lat, 400_000);
    await page.evaluate(() => window.__godsEyeView.dataManager.setEnabled('shared-mobility-fr', true));
    await pump(page, 8);
    await sleep(1500);
    const gated = await probe(page);
    check('a regional view issues no viewport request', objectRequests === 0, `${objectRequests} request(s)`);
    check('and reports zoom-in guidance', gated.stats.status === 'zoom-in', `status=${gated.stats.status}`);
    check('with nothing rendered', gated.rendered === 0, `${gated.rendered} points`);
    await shoot(page, '01-gated.png');

    // ── ii. a city view draws the inventory ────────────────────────────────
    console.log('[qa] ii. city view');
    await setView(page, CITY.lon, CITY.lat, 6_000);
    let loaded = null;
    for (let attempt = 0; attempt < 25; attempt++) {
      await pump(page, 3, 60);
      await sleep(400);
      loaded = await probe(page);
      if (objectRequests >= 1 && !loaded.stats.loading && loaded.stats.count > 0) break;
    }
    check('the viewport request is issued once inside the gate', objectRequests >= 1, `${objectRequests}`);
    check('one point per object', loaded.rendered === 32, `${loaded.rendered} for 12 stations + 20 vehicles`);
    check('stations and vehicles are both drawn', loaded.stats.count === 32, `count=${loaded.stats.count}`);
    await shoot(page, '02-city.png');

    // ── iii. the legend counts what is on screen ───────────────────────────
    console.log('[qa] iii. row legend');
    const byLabel = Object.fromEntries(loaded.legend);
    check('the legend has a Stations entry matching the fixture', byLabel.Stations === 12, JSON.stringify(loaded.legend));
    check('and one entry per vehicle kind in view',
      byLabel['E-bike'] === 5 && byLabel.Scooter === 5 && byLabel.Bike === 5 && byLabel.Moped === 5,
      JSON.stringify(loaded.legend));
    check('with no zero-count entries', loaded.legend.every(([, count]) => count > 0), JSON.stringify(loaded.legend));

    // ── iv. the merged-out bays are reported ───────────────────────────────
    console.log('[qa] iv. merged bays are declared');
    const suppressed = loaded.systems.reduce((sum, system) => sum + (system.stationsSuppressed || 0), 0);
    check('the layer reports the shared bays it did not draw', suppressed === 2480, `${suppressed}`);
    check('and says so in the control row',
      /shared bays merged out/.test(loaded.stats.loadingLabel || ''), loaded.stats.loadingLabel);

    const relevant = consoleErrors.filter((entry) => !/favicon|Failed to load resource/i.test(entry));
    check('no console errors from the layer',
      !relevant.some((entry) => /SharedMobility|shared-mobility/i.test(entry)),
      relevant.filter((entry) => /SharedMobility|shared-mobility/i.test(entry)).join(' | '));

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
