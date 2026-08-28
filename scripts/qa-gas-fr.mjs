#!/usr/bin/env node
/**
 * Deterministic browser proof for the French gas-system layer (`gas-fr`).
 *
 * The four upstream datasets are live, so this harness intercepts
 * `/api/gas-fr/network` and `/api/gas-fr/sites` with the SAME captured ODRÉ
 * rows the unit tests use — run through the real `projectGasNetwork` /
 * `projectGasSites` projections, so the fixture cannot drift from what the
 * proxy actually serves — and proves the things only a real Cesium scene can:
 *
 *   i.   the transmission trace reaches the globe as CLAMPED ground polylines,
 *        one colour per operator, with the two operators never merged
 *   ii.  Teréga's published third ordinate never reaches the scene: a stroke
 *        whose upstream row says −705.5 m is drawn on the ground, read back
 *        off the rendered positions rather than off the model
 *   ii-bis. the strokes are LEGIBLE — counted in pixels with the trace shown
 *        against the same view with it hidden, because the first version of
 *        this layer rendered a perfect network in a blue that read as a river
 *   iii. the two kinds of site draw as points, sized by their own published
 *        quantity, with a distribution-tier injection point visibly dimmer
 *        than a transmission-tier one
 *   iv.  the control-row legend the app actually renders carries all three
 *        disclaimers — simplified trace, installed capacity, and a
 *        distribution network this layer does not draw
 *   v.   switching the map stack re-classifies every stroke against the new
 *        surface, in one batched pass
 *
 * Screenshots are written under the gitignored `qa-shots/gas-fr/`.
 *
 * Run: node scripts/qa-gas-fr.mjs --url http://localhost:4173
 *      node scripts/qa-gas-fr.mjs --live    (no interception — the real proxy,
 *                                            for a look at all 36 106 km)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';
import { projectGasNetwork, projectGasSites } from '../src/data/gasFranceFeed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'gas-fr');
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

/** A view that holds all of metropolitan France. */
const FRANCE = { lon: 2.4, lat: 46.6, height: 1_800_000 };
/** Béarn — where the captured Teréga rows and BIOBEARN are. */
const BEARN = { lon: -0.6, lat: 43.4, height: 120_000 };

/** The palette, duplicated on purpose: a QA harness asserts, it doesn't import styling. */
const NATRAN = '#9d7ae6';
const TEREGA = '#e87ad0';
const PLANT = '#ff8c42';
const INJECTION = '#5ddc8f';

const readFixture = (name) => JSON.parse(fs.readFileSync(
  path.join(REPO_ROOT, 'src', 'data', 'fixtures', name), 'utf8',
));

/** The proxy's own output, built from the captured ODRÉ bodies. */
function networkPayload() {
  const projected = projectGasNetwork(readFixture('gas-fr-network-sample.json'), 'ODRÉ (qa fixture)');
  return {
    fetchedAt: Date.now(), stale: false, ttlMs: 604_800_000, ...projected,
  };
}

function sitesPayload() {
  const fixture = readFixture('gas-fr-sites-sample.json');
  const projected = projectGasSites(
    { plants: fixture.plants, injections: fixture.injections },
    'ODRÉ (qa fixture)',
  );
  return {
    fetchedAt: Date.now(), stale: false, ttlMs: 43_200_000, ...projected,
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
 * Render `frames` frames explicitly. Clamped ground geometry only resolves once
 * the scene has actually drawn, and a software-rendered headless context
 * sometimes has no animation-frame loop at all.
 */
async function pump(page, frames = 8, gapMs = 80) {
  for (let frame = 0; frame < frames; frame += 1) {
    await page.evaluate(() => {
      try {
        // requestRenderMode is on in production: without an explicit request a
        // scene.render() call can be a no-op, and the canvas the pixel counter
        // reads would still hold the PREVIOUS visibility state.
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
  }, lon, lat, height);
  await pump(page, 4);
}

async function shoot(page, name) {
  try {
    await page.evaluate(() => { try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled */ } });
    await page.screenshot({ path: path.join(SHOTS_DIR, name) });
  } catch (error) {
    console.log(`  · screenshot ${name} unavailable (${String(error?.message || error).split('\n')[0]})`);
  }
}

/**
 * Read the layer's rendered state out of the live scene.
 *
 * Deliberately reads the SCENE, not the layer's model: the point of a browser
 * proof is that the geometry reached the globe, so stroke colours come off
 * `polyline.material`, stroke heights off the resolved `positions`, and the
 * point sizes off the primitive collection.
 */
function sceneProbe(page) {
  return page.evaluate(() => {
    const gev = window.__godsEyeView;
    const module = gev.dataManager.layers.get('gas-fr').module;
    const sources = gev.viewer.dataSources;
    let collection = null;
    for (let i = 0; i < sources.length; i += 1) {
      if (String(sources.get(i).name || '').includes('Réseau gaz')) collection = sources.get(i);
    }
    const hex = (color) => (color
      ? `#${[color.red, color.green, color.blue]
        .map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`
      : null);

    const ellipsoid = gev.viewer.scene.globe?.ellipsoid || gev.viewer.scene.ellipsoid;
    const strokes = [];
    for (const entity of collection ? collection.entities.values : []) {
      if (!entity.polyline) continue;
      const material = entity.polyline.material?.color?.getValue?.();
      const positions = entity.polyline.positions?.getValue?.() || [];
      let maxHeight = 0;
      let minHeight = 0;
      for (const position of positions) {
        const carto = ellipsoid.cartesianToCartographic(position);
        if (!carto) continue;
        maxHeight = Math.max(maxHeight, carto.height);
        minHeight = Math.min(minHeight, carto.height);
      }
      strokes.push({
        id: String(entity.id),
        shown: entity.show !== false,
        color: hex(material),
        alpha: material ? Math.round(material.alpha * 1000) / 1000 : null,
        vertices: positions.length,
        width: entity.polyline.width?.getValue?.() ?? null,
        clamped: entity.polyline.clampToGround?.getValue?.() === true,
        classification: String(entity.polyline.classificationType?.getValue?.() ?? ''),
        maxHeight: Math.round(maxHeight * 100) / 100,
        minHeight: Math.round(minHeight * 100) / 100,
      });
    }

    const points = [];
    const primitives = gev.viewer.scene.primitives;
    for (let i = 0; i < primitives.length; i += 1) {
      const primitive = primitives.get(i);
      if (typeof primitive?.length !== 'number' || typeof primitive.get !== 'function') continue;
      for (let j = 0; j < primitive.length; j += 1) {
        const point = primitive.get(j);
        const id = typeof point?.id === 'string' ? point.id : null;
        if (!id || !id.startsWith('gas-')) continue;
        points.push({
          id,
          pixelSize: point.pixelSize,
          color: hex(point.color),
          alpha: point.color ? Math.round(point.color.alpha * 1000) / 1000 : null,
          collectionShown: primitive.show !== false,
        });
      }
    }

    return {
      stats: module.getStats(),
      controls: module.getRowControls(),
      analyst: module.getAnalystRecords(50),
      strokes,
      points,
      sourceFound: Boolean(collection),
    };
  });
}

/**
 * Count canvas pixels within `tolerance` of a colour.
 *
 * This is the check a screenshot cannot make. The first version of this layer
 * drew NaTran in a steel blue that rendered perfectly and read as a river:
 * every structural assertion passed — clamped, classified, coloured, on the
 * globe — and the network was still invisible to a person looking at it. So
 * the harness counts the operator's own pixels with the layer shown and with
 * it hidden, and the DELTA is the proof that the trace reached someone's eye.
 * @param {import('puppeteer').Page} page
 * @param {string} hex
 * @param {number} [tolerance]
 */
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

/** Show or hide the network data source without touching the layer's state. */
async function setNetworkVisible(page, visible) {
  await page.evaluate((show) => {
    const sources = window.__godsEyeView.viewer.dataSources;
    for (let i = 0; i < sources.length; i += 1) {
      if (String(sources.get(i).name || '').includes('Réseau gaz')) sources.get(i).show = show;
    }
  }, visible);
}

async function main() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: !HEADFUL,
    executablePath: chrome,
    args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000 },
    protocolTimeout: 90000,
  });

  try {
    const page = await newQaPage(browser);
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    const network = networkPayload();
    const sites = sitesPayload();
    let apiRequests = 0;
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (!LIVE && url.origin === APP_ORIGIN && url.pathname.startsWith('/api/gas-fr/')) {
        apiRequests += 1;
        const body = url.pathname.endsWith('/network') ? network : sites;
        void request.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(body),
        });
        return;
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

    // ── i. the trace reaches the globe ─────────────────────────────────────
    console.log('[qa] i. the transmission trace is clamped ground geometry');
    await page.evaluate(() => window.__godsEyeView.dataManager.setEnabled('gas-fr', true));
    let probe = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await pump(page, 3, 60);
      await sleep(400);
      probe = await sceneProbe(page);
      if (probe.strokes.length > 0 && probe.points.length > 0) break;
    }
    if (!LIVE) check('the layer fetched both documents', apiRequests >= 2, `${apiRequests} request(s)`);
    check('the network data source reached the viewer', probe.sourceFound);
    check('strokes are drawn', probe.strokes.length > 0, `${probe.strokes.length} strokes`);
    check('every stroke is clamped to the ground', probe.strokes.every((s) => s.clamped));
    check('every stroke classifies against a resolved surface',
      probe.strokes.every((s) => s.classification !== ''),
      probe.strokes[0]?.classification);
    check('every stroke is a real line, never a single point',
      probe.strokes.every((s) => s.vertices >= 2));

    const colours = new Set(probe.strokes.map((s) => s.color));
    check('the two operators keep two colours and are never merged',
      colours.has(NATRAN) && colours.has(TEREGA) && colours.size === 2,
      [...colours].join(' '));
    check('the row legend names both networks with their own lengths',
      probe.controls.legend.filter((row) => /NaTran|Teréga/.test(row.label)).length === 2,
      probe.controls.legend.map((row) => row.label).join(' | '));
    await shoot(page, '01-network-national.png');

    // ── ii. the published third ordinate never reaches the scene ───────────
    console.log('[qa] ii. Teréga’s third ordinate is dropped, not drawn');
    const teregaStrokes = probe.strokes.filter((s) => s.color === TEREGA);
    check('Teréga strokes are on screen', teregaStrokes.length > 0, `${teregaStrokes.length}`);
    // The captured Béarn row publishes a vertex at −705.5 m. Nothing in the
    // scene may sit below the ellipsoid because of it.
    check('no stroke is drawn below the ellipsoid',
      probe.strokes.every((s) => s.minHeight > -1),
      `min ${Math.min(...probe.strokes.map((s) => s.minHeight))} m`);
    check('and none is lifted off it either',
      probe.strokes.every((s) => s.maxHeight < 1),
      `max ${Math.max(...probe.strokes.map((s) => s.maxHeight))} m`);

    // ── ii-bis. the strokes reach a HUMAN, not just the scene graph ────────
    console.log('[qa] ii-bis. the trace is actually legible on the basemap');
    // Measured against the OSM stack on purpose. The photoreal stack streams
    // Google 3D tiles that a headless software renderer may never finish
    // loading, and counting pixels over a surface that did not arrive proves
    // nothing either way. OSM renders imagery on the shown globe, so what is
    // on the canvas here is what a person would see.
    await page.evaluate(async () => {
      await window.__godsEyeView.mapStackController?.setStack?.('osm');
    });
    await sleep(4000);
    await setView(page, 4.07, 48.36, 300_000);
    await pump(page, 20, 80);
    await setNetworkVisible(page, false);
    await pump(page, 20, 80);
    const natranOff = await countPixels(page, NATRAN);
    const teregaOff = await countPixels(page, TEREGA);
    await setNetworkVisible(page, true);
    await pump(page, 20, 80);
    const natranOn = await countPixels(page, NATRAN);
    check('NaTran paints pixels nothing else on screen was painting',
      natranOn - natranOff > 500, `${natranOff} → ${natranOn}`);
    check('and the basemap was not already full of that colour',
      natranOff < 200, `${natranOff} before`);
    await setView(page, BEARN.lon, BEARN.lat, 400_000);
    await pump(page, 8, 80);
    await setNetworkVisible(page, false);
    await pump(page, 20, 80);
    const teregaOffSw = await countPixels(page, TEREGA);
    await setNetworkVisible(page, true);
    await pump(page, 20, 80);
    const teregaOnSw = await countPixels(page, TEREGA);
    check('Teréga paints its own pixels over its own footprint',
      teregaOnSw - teregaOffSw > 200, `${teregaOffSw} → ${teregaOnSw}`);
    check('the two operators are told apart by colour, not by position',
      Math.abs(teregaOff - teregaOffSw) < 5000, `${teregaOff} vs ${teregaOffSw}`);
    await shoot(page, '02-legible.png');

    // ── iii. the two kinds of site ─────────────────────────────────────────
    console.log('[qa] iii. stations and injection points, each sized by its own unit');
    const plants = probe.points.filter((point) => point.id.startsWith('gas-plant:'));
    const injections = probe.points.filter((point) => point.id.startsWith('gas-injection:'));
    check('power stations are drawn', plants.length > 0, `${plants.length}`);
    check('injection points are drawn', injections.length > 0, `${injections.length}`);
    check('stations render in the station colour', plants.every((p) => p.color === PLANT));
    check('injection points render in the injection colour',
      injections.every((p) => p.color === INJECTION));
    check('the biggest station outsizes the biggest injection point',
      Math.min(...plants.map((p) => p.pixelSize)) > Math.max(...injections.map((p) => p.pixelSize)),
      `plants ${Math.min(...plants.map((p) => p.pixelSize))} vs injections ${Math.max(...injections.map((p) => p.pixelSize))}`);

    const tiers = new Map(probe.analyst
      .filter((record) => record.kind === 'biomethane-injection')
      .map((record) => [record.id, record.networkTier]));
    const transportPoints = injections.filter((p) => tiers.get(p.id) === 'transport');
    const distributionPoints = injections.filter((p) => tiers.get(p.id) === 'distribution');
    check('both tiers are on screen',
      transportPoints.length > 0 && distributionPoints.length > 0,
      `${transportPoints.length} transport / ${distributionPoints.length} distribution`);
    check('a distribution-tier point is drawn dimmer than a transmission-tier one',
      Math.max(...distributionPoints.map((p) => p.alpha))
        < Math.min(...transportPoints.map((p) => p.alpha)),
      `${distributionPoints[0]?.alpha} vs ${transportPoints[0]?.alpha}`);
    check('the legend counts the two tiers separately',
      probe.controls.legend.filter((row) => /Injection/.test(row.label)).length === 2);
    await setView(page, BEARN.lon, BEARN.lat, BEARN.height);
    await pump(page, 6, 80);
    await shoot(page, '02b-bearn.png');

    // ── iv. what the cards refuse to blur ──────────────────────────────────
    console.log('[qa] iv. the cards keep the three claims apart');
    const cards = await page.evaluate(() => {
      const gev = window.__godsEyeView;
      const module = gev.dataManager.layers.get('gas-fr').module;
      const controls = module.getRowControls();
      return {
        legendBlurbs: controls.legend.map((row) => row.blurb),
        stats: module.getStats(),
      };
    });
    check('the legend says the trace is the operator’s own simplification',
      cards.legendBlurbs.some((blurb) => /simplified to about 250 m/i.test(blurb)),
      cards.legendBlurbs.join(' | ').slice(0, 120));
    check('the legend says installed capacity is not live output',
      cards.legendBlurbs.some((blurb) => /Installed capacity/i.test(blurb)));
    check('the legend says the distribution network is not drawn',
      cards.legendBlurbs.some((blurb) => /does not draw/i.test(blurb)));
    check('the reported data date is the edition the projection read',
      Number.isInteger(cards.stats.plantEdition), `${cards.stats.plantEdition}`);

    // ── v. the stack switch re-classifies every stroke ─────────────────────
    console.log('[qa] v. a map-stack change re-classifies every stroke');
    const before = probe.strokes[0]?.classification;
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('gev:map-stack-changed', { detail: { activeId: 'osm' } }));
    });
    await pump(page, 4, 60);
    const osmProbe = await sceneProbe(page);
    const osmClasses = new Set(osmProbe.strokes.map((s) => s.classification));
    check('every stroke moved in one batched pass', osmClasses.size === 1, [...osmClasses].join(','));

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('gev:map-stack-changed', { detail: { activeId: 'photoreal' } }));
    });
    await pump(page, 4, 60);
    const photoProbe = await sceneProbe(page);
    const photoClasses = new Set(photoProbe.strokes.map((s) => s.classification));
    check('and again for the photoreal surface', photoClasses.size === 1, [...photoClasses].join(','));
    check('the two surfaces really are different classifications',
      [...osmClasses][0] !== [...photoClasses][0],
      `${[...osmClasses][0]} vs ${[...photoClasses][0]}`);
    check('an unknown stack falls back rather than vanishing', before !== undefined);

    // ── the layer turns off cleanly ────────────────────────────────────────
    console.log('[qa] vi. disabling clears the globe');
    await page.evaluate(() => window.__godsEyeView.dataManager.setEnabled('gas-fr', false));
    await pump(page, 4, 60);
    const off = await page.evaluate(() => {
      const gev = window.__godsEyeView;
      const sources = gev.viewer.dataSources;
      let shown = null;
      for (let i = 0; i < sources.length; i += 1) {
        if (String(sources.get(i).name || '').includes('Réseau gaz')) shown = sources.get(i).show;
      }
      return { sourceShown: shown };
    });
    check('the trace is hidden when the layer is off', off.sourceShown === false);
    await shoot(page, '03-off.png');

    const relevantErrors = consoleErrors.filter((text) => /gas-fr|Gas FR/i.test(text));
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
    console.log('[qa] gas-fr: all checks passed');
  }
  console.log(`[qa] shots → ${path.relative(REPO_ROOT, SHOTS_DIR)}/`);
}

main().catch((error) => {
  console.error('[qa] harness error:', error);
  process.exitCode = 1;
});
