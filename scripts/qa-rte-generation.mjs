#!/usr/bin/env node
/**
 * Deterministic browser proof for the French per-unit generation layer
 * (`rte-generation`).
 *
 * The unit tests already pin the projection and the card copy. What only a real
 * Cesium scene can settle is whether the RING-AND-DISC GRAMMAR survives
 * contact with a renderer — because the whole layer rests on a reader being
 * able to tell three things apart at a glance:
 *
 *     a station nobody published an output for   (faint ring, no disc)
 *     a station measured at zero                 (crisp ring, no disc)
 *     a station consuming the grid               (crisp ring, magenta disc)
 *
 * A bug that collapses any two of those is invisible to a screenshot and
 * invisible to the projection tests. So this harness reads the pixel sizes and
 * outline opacities back off the primitives Cesium actually built, and counts
 * canvas pixels with the layer on and off to prove the fleet reached a human
 * eye at all.
 *
 * It also proves the thing that makes this layer unusual: **it draws with no
 * credential.** `/api/rte-generation` is intercepted twice — once answering
 * `auth: "missing"` with no units at all, once with the contract fixture's
 * output — and the same 108 stations have to be on the globe both times.
 *
 *   i.    the shipped fleet reaches the globe with NO live data and NO key
 *   ii.   every ring is faint and discless in that state, and the readout says
 *         why rather than reporting zero megawatts
 *   iii.  with output, an unmeasured station and a stopped one are still
 *         visibly different
 *   iv.   a consuming station is magenta and full-sized, not a small green dot
 *   v.    the fleet is legible — counted in pixels, layer on vs layer off
 *   vi.   a real mouse click on a station's own pixels selects it — clicked
 *         through the DOM, at coordinates computed from the scene, after
 *         proving nothing is painted over them
 *   vii.  the legend leads with the grammar, and every station states which of
 *         the four published anchors its ring was placed on
 *   viii. disabling clears the globe
 *
 * Screenshots are written under the gitignored `qa-shots/rte-generation/`.
 *
 * Run: node scripts/qa-rte-generation.mjs --url http://localhost:4173
 *      node scripts/qa-rte-generation.mjs --live   (no interception — the real
 *                                                   proxy against real RTE)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';
import {
  RTE_GENERATION_CLASSES,
  projectActualGenerations,
} from '../src/data/rteGenerationFeed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'rte-generation');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = option('--url', process.env.QA_BASE_URL || 'http://localhost:4173');
const APP_ORIGIN = new URL(APP_URL).origin;
const HEADFUL = args.includes('--headful');
const LIVE = args.includes('--live');

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

/** Northern France — Gravelines, Penly, Paluel and the Dunkirk gas fleet. */
const NORD = { lon: 2.2, lat: 50.2, height: 420_000 };
/** The whole métropole, for the fleet-wide shots. */
const FRANCE = { lon: 2.6, lat: 46.8, height: 1_900_000 };

const NUCLEAR_COLOR = RTE_GENERATION_CLASSES.nuclear.color;
/** Duplicated on purpose: a QA harness asserts, it does not import styling. */
const PUMPING_COLOR = '#ff4dd2';

const GENERATION = JSON.parse(fs.readFileSync(
  path.join(REPO_ROOT, 'src', 'data', 'fixtures', 'rte-actual-generation-sample.json'), 'utf8',
));

/** The proxy's own output with a key, built from the contract fixture. */
function livePayload() {
  const projected = projectActualGenerations(GENERATION);
  return {
    fetchedAt: Date.now(),
    stale: false,
    ttlMs: 300_000,
    source: 'RTE (qa fixture)',
    auth: 'ok',
    authDetail: null,
    window: { mode: 'dated', startDate: '2026-08-27T00:00:00+02:00', endDate: '2026-08-29T00:00:00+02:00' },
    units: projected.units,
    stats: projected.stats,
  };
}

/** The proxy's own output with NO key — a complete answer, not an error. */
function keylessPayload() {
  return {
    fetchedAt: Date.now(),
    stale: false,
    ttlMs: 300_000,
    source: 'RTE (qa fixture)',
    auth: 'missing',
    authDetail: 'set RTE_CLIENT_ID and RTE_CLIENT_SECRET in .env',
    window: { mode: 'none' },
    units: [],
    stats: { units: 0, reporting: 0, totalMw: 0 },
  };
}

const failures = [];
function check(label, condition, detail = '') {
  const ok = Boolean(condition);
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`);
  return ok;
}

/** Render `frames` frames explicitly; requestRenderMode is on in production. */
async function pump(page, frames = 8, gapMs = 80) {
  for (let frame = 0; frame < frames; frame += 1) {
    await page.evaluate(() => {
      try {
        window.__godsEyeView?.viewer?.scene?.requestRender();
        window.__godsEyeView?.viewer?.scene?.render();
      } catch { /* stalled context */ }
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
    gev.viewer.camera.moveEnd.raiseEvent();
  }, lon, lat, height);
  await pump(page, 4);
}

/** Capture one shot with its own deadline; a shot is evidence, not an assertion. */
async function shoot(page, name) {
  try {
    await page.evaluate(() => { try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled */ } });
    await Promise.race([
      page.screenshot({ path: path.join(SHOTS_DIR, name) }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('capture timed out')), 20000)),
    ]);
  } catch (error) {
    console.log(`  · screenshot ${name} unavailable (${String(error?.message || error).split('\n')[0]})`);
  }
}

/** Read the layer's rendered state back off the primitives Cesium built. */
function sceneProbe(page) {
  return page.evaluate(() => {
    const gev = window.__godsEyeView;
    const module = gev.dataManager.layers.get('rte-generation').module;
    return {
      stats: module.getStats(),
      controls: module.getRowControls(),
      analyst: module.getAnalystRecords(200),
      stations: module.getRenderDiagnostics(),
    };
  });
}

/** Count canvas pixels within `tolerance` of a colour. */
function countPixels(page, hex, tolerance = 24) {
  return page.evaluate((color, tol) => {
    const target = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
    const canvas = window.__godsEyeView.viewer.scene.canvas;
    const off = document.createElement('canvas');
    off.width = canvas.width;
    off.height = canvas.height;
    const context = off.getContext('2d');
    context.drawImage(canvas, 0, 0);
    const data = context.getImageData(0, 0, off.width, off.height).data;
    let hits = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (Math.abs(data[i] - target[0]) < tol
        && Math.abs(data[i + 1] - target[1]) < tol
        && Math.abs(data[i + 2] - target[2]) < tol) hits += 1;
    }
    return hits;
  }, hex, tolerance);
}

async function setLayerEnabled(page, enabled) {
  await page.evaluate(
    (on) => window.__godsEyeView.dataManager.setEnabled('rte-generation', on),
    enabled,
  );
  await pump(page, 12, 80);
}

/** Wait for the layer to have built its stations. */
async function waitForStations(page, minimum = 50) {
  let probe = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await pump(page, 3, 60);
    await sleep(400);
    probe = await sceneProbe(page);
    if (probe.stations.length >= minimum) break;
  }
  return probe;
}

async function main() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: !HEADFUL,
    executablePath: chrome,
    args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1280,800'],
    defaultViewport: { width: 1280, height: 800 },
    protocolTimeout: 120000,
  });

  try {
    const page = await newQaPage(browser);
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    // The interception starts KEYLESS: that is the state every reader who has
    // not made an RTE account is in, and it is the one most likely to rot.
    let mode = 'keyless';
    let apiRequests = 0;
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin === APP_ORIGIN && url.pathname === '/api/rte-generation') {
        apiRequests += 1;
        if (!LIVE) {
          void request.respond({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(mode === 'keyless' ? keylessPayload() : livePayload()),
          });
          return;
        }
      }
      void request.continue();
    });

    console.log(`[qa] booting ${APP_URL}${LIVE ? ' (LIVE proxy)' : ''}`);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(
      () => window.__godsEyeView?.viewer && window.__godsEyeView?.dataManager,
      { timeout: 60000, polling: 200 },
    );
    await sleep(2000);
    await setView(page, FRANCE.lon, FRANCE.lat, FRANCE.height);

    // ── i. the fleet draws with no key at all ──────────────────────────────
    console.log('[qa] i. the shipped fleet reaches the globe with no credential');
    await page.evaluate(() => window.__godsEyeView.dataManager.setEnabled('rte-generation', true));
    let probe = await waitForStations(page);
    check('the layer asked the proxy for output', apiRequests >= 1, `${apiRequests} request(s)`);
    check('the whole fleet is on the globe anyway',
      probe.stations.length >= 100, `${probe.stations.length} stations`);
    check('with the register’s installed power, not a placeholder',
      probe.stats.installedMw > 90_000, `${probe.stats.installedMw} MW`);
    check('every station carries a namespaced render id',
      probe.stations.every((station) => station.id.startsWith('rte-gen:')));
    check('and every one of them is somewhere real',
      probe.analyst.every((record) => Number.isFinite(record.lat) && Number.isFinite(record.lon)));
    await shoot(page, '01-fleet-keyless.png');

    // ── ii. keyless says why, and never reports zero ───────────────────────
    console.log('[qa] ii. no key means no disc and no claim, not zero megawatts');
    check('not one station drew an output disc', probe.stations.every((s) => !s.hasDisc),
      `${probe.stations.filter((s) => s.hasDisc).length} discs`);
    check('every ring is drawn in the unmeasured, faint state',
      probe.stations.every((s) => s.ringOutlineAlpha !== null && s.ringOutlineAlpha < 0.5),
      `max alpha ${Math.max(...probe.stations.map((s) => s.ringOutlineAlpha ?? 0))}`);
    check('no station claims an output figure',
      probe.stations.every((s) => s.mw === null && s.load === null));
    check('the readout says a key is what is missing',
      /capacity only/i.test(probe.stats.loadingLabel || ''), probe.stats.loadingLabel);
    check('and the legend says what to set',
      /RTE_CLIENT_ID/.test(probe.controls.legend[0]?.blurb || ''));
    check('the analyst records report no output rather than zero output',
      probe.analyst.every((record) => record.outputMw === null));

    // ── iii. with output, unknown and stopped stay different ───────────────
    console.log('[qa] iii. with output, an unmeasured station and a stopped one are different');
    mode = 'live';
    await setLayerEnabled(page, false);
    await setLayerEnabled(page, true);
    probe = await waitForStations(page);

    const measured = probe.stations.filter((station) => station.measured);
    const unmeasured = probe.stations.filter((station) => !station.measured);
    check('some stations are now measured', measured.length >= 4, `${measured.length} measured`);
    check('and most still are not, because the fixture is seven units',
      unmeasured.length > measured.length, `${unmeasured.length} unmeasured`);

    const stopped = measured.filter((station) => station.mw === 0);
    check('the fixture puts at least one station at a measured zero',
      stopped.length >= 1, `${stopped.length} stopped`);
    check('a stopped station draws NO disc — there is nothing to draw',
      stopped.every((station) => !station.hasDisc));
    check('but its ring is CRISP, unlike an unmeasured one',
      stopped.every((station) => station.ringOutlineAlpha > 0.5),
      stopped.map((s) => s.ringOutlineAlpha).join(','));
    check('and the unmeasured rings stayed faint',
      unmeasured.every((station) => station.ringOutlineAlpha < 0.5));
    check('so the two states are told apart by opacity, in the scene, not just on a card',
      stopped.length > 0 && unmeasured.length > 0
        && Math.min(...stopped.map((s) => s.ringOutlineAlpha))
          > Math.max(...unmeasured.map((s) => s.ringOutlineAlpha)) + 0.3);

    const running = measured.filter((station) => station.mw > 0);
    check('a producing station draws a disc inside its own ring',
      running.length > 0 && running.every((station) => station.hasDisc && station.discPx <= station.ringPx),
      running.map((s) => `${s.discPx}/${s.ringPx}`).join(' '));
    await shoot(page, '02-fleet-live.png');

    // ── iv. a consuming machine is not a small generating one ──────────────
    console.log('[qa] iv. a pumping station is magenta and full-sized');
    const pumping = probe.stations.filter((station) => station.mw !== null && station.mw < 0);
    check('the fixture has a station consuming the grid', pumping.length === 1,
      `${pumping.length}`);
    check('it draws a disc — consumption is an event, not an absence',
      pumping.every((station) => station.hasDisc));
    check('in the consumption colour, not its filière’s',
      pumping.every((station) => station.discColor === PUMPING_COLOR),
      pumping.map((s) => s.discColor).join(','));
    check('and sized on the magnitude, so 70% pumping reads as loudly as 70% generating',
      pumping.every((station) => station.discPx >= station.ringPx * 0.6),
      pumping.map((s) => `${s.discPx}/${s.ringPx}`).join(' '));

    // ── v. the fleet is legible ────────────────────────────────────────────
    console.log('[qa] v. the discs are actually visible on the basemap');
    // Measured against the OSM stack on purpose: the photoreal stack streams
    // Google 3D tiles that a headless software renderer may never finish
    // loading, and counting pixels over a surface that did not arrive proves
    // nothing either way.
    await page.evaluate(async () => {
      await window.__godsEyeView.mapStackController?.setStack?.('osm');
    });
    await sleep(4000);

    // Counted on the OUTPUT DISCS, not the rings. A ring is a 1.6 px outline
    // drawn at 0.32 alpha when unmeasured — over a pale basemap it blends to
    // within a few units of the map itself, and a colour match there measures
    // the basemap, not the layer. The discs are opaque, tens of pixels across,
    // and they are the thing this layer exists to show.
    const legible = async (lon, lat, hex, label) => {
      await setView(page, lon, lat, 60_000);
      await sleep(1500);
      await pump(page, 24, 80);
      const shown = await countPixels(page, hex);
      await setLayerEnabled(page, false);
      const hidden = await countPixels(page, hex);
      await setLayerEnabled(page, true);
      await sleep(1200);
      await pump(page, 24, 80);
      return { shown, hidden, label };
    };

    // Belleville: 655 MW of a 1 310 MW reactor in the fixture, so a crisp ring
    // with a disc half its width inside it.
    const nuclear = await legible(2.8766, 47.5088, NUCLEAR_COLOR, 'nuclear');
    check('a producing reactor paints pixels nothing else on screen was painting',
      nuclear.shown - nuclear.hidden > 40, `${nuclear.hidden} → ${nuclear.shown}`);
    check('and the basemap was not already that colour', nuclear.hidden < 200,
      `${nuclear.hidden} before`);
    await shoot(page, '03-legible-nuclear.png');

    // Grand'Maison, pumping at 1 180 MW of 1 690 — the loudest thing on the
    // layer, and the one a reader is most likely to misread as generation.
    const pumped = await legible(6.0757, 45.1889, PUMPING_COLOR, 'pumping');
    check('and a station CONSUMING the grid is unmistakable',
      pumped.shown - pumped.hidden > 40, `${pumped.hidden} → ${pumped.shown}`);
    check('in a colour the map never uses on its own', pumped.hidden < 50,
      `${pumped.hidden} before`);
    await shoot(page, '03-legible-pumping.png');

    // ── vi. picking, through a real click on the station's own pixels ─────
    console.log('[qa] vi. clicking a station selects it, and Escape lets go');
    probe = await waitForStations(page);
    const target = probe.analyst.find((record) => Number.isFinite(record.outputMw)
      && record.outputMw > 0)
      || probe.analyst[0];
    check('the harness has a producing station to click',
      Boolean(target) && Number.isFinite(target.lat), target?.name);

    // Aimed OFF the station on purpose. The app paints its own HUD over the
    // middle of the screen, so a click at the canvas centre lands on a `<strong>`
    // and Cesium never sees it — which an earlier version of this harness
    // "passed" by accident, on a frame where that text happened to be elsewhere.
    // The station is put a little below centre and the click goes to ITS pixels.
    await setView(page, target.lon, target.lat + 0.11, 60_000);
    await sleep(1200);
    await pump(page, 12, 80);

    const aim = await page.evaluate((lon, lat) => {
      const gev = window.__godsEyeView;
      const scene = gev.viewer.scene;
      const ellipsoid = scene.globe?.ellipsoid || scene.ellipsoid;
      const d2r = Math.PI / 180;
      const world = ellipsoid.cartographicToCartesian({
        longitude: lon * d2r, latitude: lat * d2r, height: 0,
      });
      const canvas = scene.cartesianToCanvasCoordinates(world);
      if (!canvas) return { ok: false, reason: 'station is not on screen' };
      const rect = scene.canvas.getBoundingClientRect();
      const x = rect.left + canvas.x;
      const y = rect.top + canvas.y;
      const top = document.elementFromPoint(x, y);
      return {
        ok: top === scene.canvas,
        x,
        y,
        blockedBy: top === scene.canvas ? null : `${top?.tagName || '?'}${top?.id ? `#${top.id}` : ''}`,
        picked: scene.pick({ x: canvas.x, y: canvas.y })?.primitive?.id ?? null,
      };
    }, target.lon, target.lat);

    check('the station is on screen and nothing is painted over it',
      aim.ok, aim.blockedBy || aim.reason || '');
    // The OUTPUT DISC is what the cursor lands on for a producing station — it
    // is painted above its own ring — and folding that back to the station is
    // exactly what `resolveRtePickId` is for. Either id is a hit; which one it
    // is says whether the disc reached the screen.
    check('and the scene picks that station at that pixel',
      aim.picked === `rte-gen:${target.id}` || aim.picked === `rte-gen:${target.id}:out`,
      `${aim.picked}`);
    check('a producing station is picked by its DISC, not its ring',
      aim.picked === `rte-gen:${target.id}:out`, `${aim.picked}`);

    if (aim.ok) {
      await page.mouse.click(aim.x, aim.y);
      await pump(page, 8, 80);
      const afterClick = await sceneProbe(page);
      const selected = afterClick.stations.filter((s) => s.ringOutline === '#00ffff');
      check('a real mouse click on those pixels selects exactly one station',
        selected.length === 1, `${selected.length} selected`);
      check('and it is the one under the cursor',
        selected[0]?.siteId === target.id, `${selected[0]?.siteId} vs ${target.id}`);
      const before = probe.stations.find((s) => s.siteId === target.id);
      check('its ring grew, so the selection is visible and not only in state',
        selected[0] && before && selected[0].ringPx > before.ringPx,
        `${before?.ringPx} → ${selected[0]?.ringPx}`);
      await shoot(page, '04-selected.png');

      // Escape releases it, the contract every other card on this globe has.
      await page.keyboard.press('Escape');
      await pump(page, 6, 60);
      const afterEscape = await sceneProbe(page);
      check('Escape clears the selection',
        afterEscape.stations.every((s) => s.ringOutline !== '#00ffff'));
    }

    // ── vii. the legend and the placement ──────────────────────────────────
    console.log('[qa] vii. the legend leads with the grammar and every ring states its anchor');
    check('the first legend row is the ring/disc grammar, not a filière',
      /ring/i.test(probe.controls.legend[0]?.label || ''), probe.controls.legend[0]?.label);
    check('and it names all three states a reader has to tell apart',
      /faint empty ring/i.test(probe.controls.legend[0]?.blurb || '')
      && /crisp empty ring/i.test(probe.controls.legend[0]?.blurb || '')
      && /CONSUMING/.test(probe.controls.legend[0]?.blurb || ''));
    check('nuclear has its own legend row, counted in stations',
      probe.controls.legend.some((row) => row.label === RTE_GENERATION_CLASSES.nuclear.label
        && row.count >= 15));
    const placements = new Set(probe.analyst.map((record) => record.placement));
    check('every station states which published anchor its ring sits on',
      probe.analyst.every((record) => Boolean(record.placement)),
      [...placements].join(', '));
    check('and all four anchors are represented in the shipped register',
      placements.has('edf-published') && placements.has('osm-plant')
      && placements.has('rte-switchyard') && placements.has('commune-centre'),
      [...placements].join(', '));

    // ── viii. the layer turns off cleanly ──────────────────────────────────
    console.log('[qa] viii. disabling clears the globe');
    await setLayerEnabled(page, false);
    const disabled = await sceneProbe(page);
    check('the ring collection is hidden when the layer is off',
      disabled.stations.every((station) => !station.collectionShown),
      `${disabled.stations.filter((s) => s.collectionShown).length} still shown`);
    await shoot(page, '05-off.png');

    const relevantErrors = consoleErrors.filter((text) => /rte-generation|RTE Gen/i.test(text));
    check('no layer console errors', relevantErrors.length === 0, relevantErrors[0] || '');
  } finally {
    await browser.close();
  }

  console.log('');
  if (failures.length) {
    console.log(`[qa] ${failures.length} FAILED:`);
    for (const failure of failures) console.log(`  · ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('[qa] rte-generation: all checks passed');
  }
  console.log(`[qa] shots → ${path.relative(REPO_ROOT, SHOTS_DIR)}/`);
}

main().catch((error) => {
  console.error('[qa] harness error:', error);
  process.exitCode = 1;
});
