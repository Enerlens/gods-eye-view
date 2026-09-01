#!/usr/bin/env node
/**
 * Deterministic browser proof for the live French road-status layer
 * (`road-status-fr`).
 *
 * The feed is live and therefore untestable as a fixed truth, so this harness
 * intercepts `/api/road-status-fr/*` with a fixture and proves the four things
 * a unit test cannot:
 *
 *   i.   the altitude gate does not fetch — a view above the ceiling issues NO
 *        request and reports zoom-in guidance rather than an empty map
 *   ii.  a city view actually puts the segments on the scene: one record per
 *        published segment, in a ground-clamped batch that is `show` and
 *        classified against the active surface, with the legend counting what
 *        is drawn rather than what was sent
 *   iii. a viewport over Paris — where no DIR publishes anything — reports the
 *        coverage notice naming DIRIF, instead of a blank map that reads as a
 *        bug
 *   iv.  a segment nobody reports a state for is still drawn, in the grey that
 *        means "measured, unwatched" rather than folded into free flow
 *
 * Screenshots are written under the gitignored `qa-shots/road-status-fr/`.
 *
 * Run: node scripts/qa-road-status-fr.mjs --url http://localhost:4173
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'road-status-fr');
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

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** Bordeaux, whose ring road carries the densest drawable set in the country. */
const CITY = { lon: -0.5792, lat: 44.8378 };
/** Paris, where nothing at all is published. */
const DARK = { lon: 2.2945, lat: 48.8584 };

/** How many fixture segments carry each state. */
const FIXTURE_STATES = Object.freeze({
  freeFlow: 18, heavy: 4, congested: 3, unknown: 5,
});

/** A ring of fixture segments around the city centre, in published shape. */
function segmentPayload() {
  const segments = [];
  const plan = Object.entries(FIXTURE_STATES).flatMap(([state, count]) => Array.from({ length: count }, () => state));
  plan.forEach((state, index) => {
    const angle = (index / plan.length) * Math.PI * 2;
    const lon = CITY.lon + Math.cos(angle) * 0.045;
    const lat = CITY.lat + Math.sin(angle) * 0.035;
    segments.push({
      id: `MQA${String(index).padStart(3, '0')}.A1`,
      c: [
        Number(lon.toFixed(5)), Number(lat.toFixed(5)),
        Number((lon + 0.006).toFixed(5)), Number((lat + 0.004).toFixed(5)),
      ],
      s: state,
      d: 'DIRA',
      a: 'A630',
      z: 'BX33',
      // The grey ones are the point of check iv: located and counted, but no
      // traffic-management centre publishes a state for them.
      src: state === 'unknown' ? [] : ['ALIENOR'],
      at: state === 'unknown' ? null : new Date(Date.now() - 40_000).toISOString(),
      f: 410 + index * 10,
      v: 88.5,
      n: 53,
    });
  });
  const counts = {
    freeFlow: 0, heavy: 0, congested: 0, impossible: 0, unknown: 0,
  };
  for (const segment of segments) counts[segment.s] += 1;
  return {
    status: 'ready',
    retrievedAt: new Date().toISOString(),
    stale: false,
    box: {
      south: CITY.lat - 0.1, west: CITY.lon - 0.1, north: CITY.lat + 0.1, east: CITY.lon + 0.1,
    },
    segments,
    counts,
    segmentsTruncated: false,
    nationalSegments: 832,
    nationalCounts: counts,
    measured: segments.length,
    feeds: [{
      directory: 'ALIENOR',
      label: 'Bordeaux',
      sites: 196,
      drawable: 144,
      publishedAt: new Date().toISOString(),
      file: 'ALIENOR_DataTRT_20260831_224040.xml',
      error: null,
    }],
    feedsFailed: 0,
    sitesTotal: 1195,
    sitesLocated: 832,
    sitesUnlocated: 363,
    lengthKm: 918.1,
    flow: {
      publishedAt: new Date().toISOString(),
      windowStart: new Date(Date.now() - 360_000).toISOString(),
      windowEnd: new Date().toISOString(),
      stations: 1193,
    },
    licence: 'Licence Ouverte 2.0',
    attribution: 'Bison Futé / DIR — Licence Ouverte 2.0',
    datasetPage: 'https://www.data.gouv.fr/fr/datasets/etat-de-circulation-en-temps-reel-sur-le-reseau-national-routier-non-concede/',
    geometryGeneratedAt: new Date().toISOString(),
  };
}

/** What the proxy returns over Paris: a valid answer with nothing in it. */
function emptyPayload() {
  const base = segmentPayload();
  return {
    ...base,
    segments: [],
    counts: {
      freeFlow: 0, heavy: 0, congested: 0, impossible: 0, unknown: 0,
    },
    feeds: [],
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
 * The viewport reload hangs off `camera.moveEnd`, which Cesium raises from the
 * render pass; a software-rendered headless context sometimes has no
 * animation-frame loop at all, so the harness pumps the scene itself rather
 * than trusting the browser to.
 */
async function pump(page, frames = 8, gapMs = 80) {
  for (let frame = 0; frame < frames; frame += 1) {
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

async function shoot(page, name) {
  try {
    await page.evaluate(() => { try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled context */ } });
    await page.screenshot({ path: path.join(SHOTS_DIR, name) });
  } catch (error) {
    console.log(`  · screenshot ${name} unavailable (${String(error?.message || error).split('\n')[0]})`);
  }
}

/** Read the layer's own view of itself, including what reached the scene. */
function layerProbe(page) {
  return page.evaluate(() => {
    const { module } = window.__godsEyeView.dataManager.layers.get('road-status-fr');
    return {
      stats: module.getStats(),
      legend: module.getRowControls().legend,
      render: module.getRenderDiagnostics(),
      feeds: module.getFeedSummaries(),
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

    let payload = segmentPayload();
    let segmentRequests = 0;
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin === APP_ORIGIN && url.pathname === '/api/road-status-fr/segments') {
        segmentRequests += 1;
        void request.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(payload),
        });
        return;
      }
      void request.continue();
    });

    console.log(`[qa] booting ${APP_URL}`);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Interval polling, not animation-frame polling: headless WebGL can stall
    // the rAF loop outright, and a rAF-polled wait would then time out on an
    // app that booted perfectly well.
    await page.waitForFunction(
      () => window.__godsEyeView?.viewer && window.__godsEyeView?.dataManager,
      { timeout: 60000, polling: 200 },
    );
    await sleep(2000);

    // ── i. the altitude gate does not fetch ────────────────────────────────
    console.log('[qa] i. altitude gate');
    await setView(page, CITY.lon, CITY.lat, 3_000_000);
    await page.evaluate(() => window.__godsEyeView.dataManager.setEnabled('road-status-fr', true));
    await pump(page, 8);
    await sleep(1500);
    const gated = await layerProbe(page);
    check('a view above the ceiling issues no request', segmentRequests === 0,
      `${segmentRequests} request(s)`);
    check('and reports zoom-in guidance', gated.stats.status === 'zoom-in',
      `status=${gated.stats.status}`);
    check('with nothing on the scene', gated.render.records === 0,
      `${gated.render.records} records`);
    await shoot(page, '01-gated.png');

    // ── ii. a city view puts the segments on the scene ─────────────────────
    console.log('[qa] ii. city view');
    await setView(page, CITY.lon, CITY.lat, 20_000);
    let loaded = null;
    for (let attempt = 0; attempt < 25; attempt += 1) {
      await pump(page, 3, 60);
      await sleep(400);
      loaded = await layerProbe(page);
      if (segmentRequests >= 1 && !loaded.stats.loading && loaded.render.records > 0) break;
    }
    const expected = Object.values(FIXTURE_STATES).reduce((sum, count) => sum + count, 0);
    check('the request is issued once inside the gate', segmentRequests >= 1,
      `${segmentRequests} request(s)`);
    check('one record per published segment', loaded.render.records === expected,
      `${loaded.render.records} of ${expected}`);
    check('the strokes reached the scene as a shown ground batch',
      loaded.render.batches.length === 1 && loaded.render.batches[0].show === true,
      JSON.stringify(loaded.render.batches));
    check('classified against a surface, not left unclassified',
      Boolean(loaded.render.batches[0]?.classificationType),
      loaded.render.batches[0]?.classificationType);
    check('the legend counts what is drawn, in severity order',
      loaded.legend.map((row) => row.label).join('|') === 'Free flow|Heavy|Congested|Not reported',
      loaded.legend.map((row) => `${row.label}:${row.count}`).join(' '));
    check('and the counts are the published ones',
      loaded.legend.map((row) => row.count).join(',') === [
        FIXTURE_STATES.freeFlow, FIXTURE_STATES.heavy, FIXTURE_STATES.congested, FIXTURE_STATES.unknown,
      ].join(','),
      loaded.legend.map((row) => row.count).join(','));
    check('the row credits the publisher it actually used',
      loaded.feeds.some((feed) => feed.network === 'Bordeaux' && feed.licence === 'Licence Ouverte 2.0'));
    check('the honesty numbers are surfaced, not buried',
      loaded.stats.sitesUnlocated === 363 && loaded.stats.lengthKm === 918.1,
      `${loaded.stats.sitesUnlocated} unlocated / ${loaded.stats.lengthKm} km`);
    await shoot(page, '02-city.png');

    // ── iii. a segment nobody watches is still drawn, and stays grey ───────
    console.log('[qa] iii. unwatched segments stay grey');
    check('the grey state is drawn rather than folded into free flow',
      loaded.render.statuses.unknown === FIXTURE_STATES.unknown,
      JSON.stringify(loaded.render.statuses));
    check('and free flow is not inflated by it',
      loaded.render.statuses.freeFlow === FIXTURE_STATES.freeFlow,
      JSON.stringify(loaded.render.statuses));

    // ── iv. the dark viewport explains itself ──────────────────────────────
    console.log('[qa] iv. Paris says why it is empty');
    payload = emptyPayload();
    await setView(page, DARK.lon, DARK.lat, 20_000);
    let dark = null;
    for (let attempt = 0; attempt < 25; attempt += 1) {
      await pump(page, 3, 60);
      await sleep(400);
      dark = await layerProbe(page);
      if (dark.stats.status === 'empty') break;
    }
    check('an empty Paris viewport is reported as empty, not as ok',
      dark.stats.status === 'empty', `status=${dark.stats.status}`);
    check('and names the publisher that is missing', /DIRIF/.test(dark.stats.notice || ''),
      dark.stats.notice);
    check('and points at somewhere that works', /try \w/.test(dark.stats.notice || ''),
      dark.stats.notice);
    check('nothing is left drawn from the previous city', dark.render.records === 0,
      `${dark.render.records} records`);
    await shoot(page, '03-dark.png');

    // ── console hygiene ────────────────────────────────────────────────────
    const relevant = consoleErrors.filter((entry) => !/favicon|Failed to load resource/i.test(entry));
    check('no console errors from the layer',
      !relevant.some((entry) => /road-status|Road Status/i.test(entry)),
      relevant.filter((entry) => /road-status|Road Status/i.test(entry)).join(' | '));

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
