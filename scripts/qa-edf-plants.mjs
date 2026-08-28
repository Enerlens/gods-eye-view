#!/usr/bin/env node
/**
 * Deterministic browser proof for the EDF generating-fleet layer
 * (`edf-power-plants`).
 *
 * The upstream is annual rather than live, but it is still not a fixed truth —
 * EDF republishes these files and the numbers move. So this harness intercepts
 * `/api/edf-plants` with the SAME captured EDF payloads the unit tests use, run
 * through the real `projectEdfPlants` projection so the fixture cannot drift
 * from what the proxy actually serves, and proves the four things only a real
 * Cesium scene can prove:
 *
 *   i.   19 published rows become 11 DISCS — six Gravelines reactor rows draw
 *        one marker, not six stacked on one pixel
 *   ii.  capacity reaches the globe as AREA: Gravelines saturates, Grand-Maison
 *        sits between it and Grandval, read off the rendered primitives
 *   iii. the hydro file's x=latitude convention survives all the way to the
 *        rendered position — Grand-Maison unprojects to 45.15 N 6.05 E, and
 *        every site lands inside metropolitan France
 *   iv.  the labels are actually PAINTED, and each one says what its object is
 *
 * Screenshots are written under the gitignored `qa-shots/edf-plants/`.
 *
 * Run: node scripts/qa-edf-plants.mjs --url http://localhost:4173
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';
import { projectEdfPlants } from '../src/data/edfPlantsFeed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'edf-plants');
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

/** A view that holds all of metropolitan France. */
const FRANCE = { lon: 2.6, lat: 46.6, height: 2_200_000 };

/** The palette, duplicated here on purpose: a QA harness asserts, it doesn't import styling. */
const NUCLEAR = '#ffd166';
const HYDRO = '#4fc3f7';
const THERMAL = '#f4736b';
/** The size ramp's ceiling, likewise restated rather than imported. */
const PIXEL_MAX = 26;

const readFixture = (name) => JSON.parse(fs.readFileSync(
  path.join(REPO_ROOT, 'src', 'data', 'fixtures', `edf-plants-${name}.json`), 'utf8',
));

/**
 * The proxy's own output, built from the captured EDF bodies. Using the real
 * projection rather than a hand-written blob is what keeps this harness honest
 * when the projection changes.
 */
function plantsPayload() {
  const projected = projectEdfPlants({
    nucleaire: { meta: readFixture('nucleaire-dataset'), lines: readFixture('nucleaire-sample') },
    hydraulique: { meta: readFixture('hydraulique-dataset'), lines: readFixture('hydraulique-sample') },
    thermique: { meta: readFixture('thermique-dataset'), lines: readFixture('thermique-sample') },
  }, 'EDF Open Data (qa fixture)');
  return {
    fetchedAt: Date.now(),
    stale: false,
    ttlMs: 86_400_000,
    source: projected.source,
    sites: projected.sites,
    datasets: projected.datasets,
    totals: projected.totals,
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
 * Render `frames` frames explicitly. A software-rendered headless context
 * sometimes has no animation-frame loop at all, so the harness pumps the scene
 * itself rather than trusting the browser.
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

/** Screenshot, best-effort — these are evidence, not assertions. */
async function shoot(page, name) {
  try {
    await page.evaluate(() => { try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled context */ } });
    await page.screenshot({ path: path.join(SHOTS_DIR, name) });
  } catch (error) {
    console.log(`  · screenshot ${name} unavailable (${String(error?.message || error).split('\n')[0]})`);
  }
}

/**
 * Read the layer's rendered state out of the live scene.
 *
 * Deliberately reads the POINT PRIMITIVES, not the layer's own model: the
 * point of a browser proof is that the paint reached the globe, so the sizes
 * and colours here come off the collection and the positions are unprojected
 * back to degrees from the rendered Cartesians.
 */
function sceneProbe(page) {
  return page.evaluate(() => {
    const gev = window.__godsEyeView;
    const module = gev.dataManager.layers.get('edf-power-plants').module;
    const scene = gev.viewer.scene;
    const ellipsoid = scene.globe?.ellipsoid || scene.ellipsoid;
    const r2d = 180 / Math.PI;

    // Duck-typed: the layer's collection is the one whose points carry its ids.
    let collection = null;
    for (let i = 0; i < scene.primitives.length; i++) {
      const primitive = scene.primitives.get(i);
      if (typeof primitive?.get !== 'function' || !(primitive.length > 0)) continue;
      if (String(primitive.get(0)?.id || '').startsWith('edf-plants:')) collection = primitive;
    }
    const hex = (color) => (color
      ? `#${[color.red, color.green, color.blue]
        .map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`
      : null);

    const points = [];
    for (let i = 0; collection && i < collection.length; i++) {
      const point = collection.get(i);
      const carto = point.position ? ellipsoid.cartesianToCartographic(point.position) : null;
      points.push({
        id: String(point.id),
        pixelSize: point.pixelSize,
        color: hex(point.color),
        lat: carto ? carto.latitude * r2d : null,
        lon: carto ? carto.longitude * r2d : null,
      });
    }
    return {
      stats: module.getStats(),
      analyst: module.getAnalystRecords(20),
      controls: module.getRowControls(),
      overlay: window.__gevWorldOverlay?.getDiagnostics?.() || null,
      points,
      shown: collection ? collection.show !== false : null,
      collectionFound: Boolean(collection),
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

    const payload = plantsPayload();
    let apiRequests = 0;
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin === APP_ORIGIN && url.pathname === '/api/edf-plants') {
        apiRequests += 1;
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
    await setView(page, FRANCE.lon, FRANCE.lat, FRANCE.height);

    // ── i. rows become sites ───────────────────────────────────────────────
    console.log('[qa] i. 19 published rows draw 11 site discs');
    await page.evaluate(() => window.__godsEyeView.dataManager.setEnabled('edf-power-plants', true));
    let probe = null;
    for (let attempt = 0; attempt < 25; attempt++) {
      await pump(page, 3, 60);
      await sleep(400);
      probe = await sceneProbe(page);
      if (apiRequests >= 1 && probe.collectionFound && probe.stats.count === 11) break;
    }
    check('the layer fetched its snapshot', apiRequests >= 1, `${apiRequests} request(s)`);
    check('the point collection reached the scene', probe.collectionFound);
    check('19 published rows drew 11 discs', probe.points.length === 11,
      `${probe.points.length} discs from ${payload.sites.length} sites`);
    const gravelines = probe.points.find((point) => point.id.endsWith('nucleaire:GRAVELINES'));
    check('the six Gravelines reactors are ONE marker',
      probe.points.filter((point) => point.id.includes('GRAVELINES')).length === 1);
    check('and it carries all six reactors of capacity',
      probe.analyst.find((record) => record.name === 'GRAVELINES')?.units === 6);
    check('every disc is a distinct site', new Set(probe.points.map((p) => p.id)).size === 11);
    await shoot(page, '01-fleet.png');

    // ── ii. capacity is drawn as area ──────────────────────────────────────
    console.log('[qa] ii. installed capacity reaches the globe as area');
    const sizeOf = (fragment) => probe.points.find((point) => point.id.endsWith(fragment))?.pixelSize;
    check('Gravelines (5 460 MW) saturates the ramp', sizeOf('nucleaire:GRAVELINES') === PIXEL_MAX,
      `${sizeOf('nucleaire:GRAVELINES')} px`);
    check('Grand-Maison (1 714 MW) is smaller than Gravelines and larger than Grandval',
      sizeOf('hydraulique:GRAND-MAISON') < PIXEL_MAX
      && sizeOf('hydraulique:GRAND-MAISON') > sizeOf('hydraulique:GRANDVAL'),
      `${sizeOf('hydraulique:GRAND-MAISON')} px vs ${sizeOf('hydraulique:GRANDVAL')} px`);
    // Area, not radius: four times the capacity is twice the diameter above the
    // floor. Bouchain 585 MW against Cordemais 1 160 MW is close enough to 2×
    // that the wrong ramp (linear in MW) would be visible here.
    const bouchain = sizeOf('thermique:BOUCHAIN');
    const cordemais = sizeOf('thermique:CORDEMAIS');
    check('a site with twice the capacity is NOT twice the radius',
      cordemais < bouchain * 1.6, `${cordemais} px vs ${bouchain} px`);
    check('the filière colours are the rendered ones',
      gravelines?.color === NUCLEAR
      && probe.points.find((p) => p.id.endsWith('hydraulique:RANCE'))?.color === HYDRO
      && probe.points.find((p) => p.id.endsWith('thermique:CORDEMAIS'))?.color === THERMAL,
      `${gravelines?.color} / ${probe.points.find((p) => p.id.endsWith('hydraulique:RANCE'))?.color}`);

    // ── iii. x is the latitude, all the way to the rendered position ───────
    console.log('[qa] iii. the hydro x/y convention survives to the globe');
    const grandMaison = probe.points.find((point) => point.id.endsWith('hydraulique:GRAND-MAISON'));
    check('Grand-Maison renders in the Alps, not in the Indian Ocean',
      Math.abs(grandMaison.lat - 45.1458) < 0.001 && Math.abs(grandMaison.lon - 6.0512) < 0.001,
      `${grandMaison.lat?.toFixed(4)} N ${grandMaison.lon?.toFixed(4)} E`);
    check('every rendered site lands inside metropolitan France',
      probe.points.every((point) => point.lat > 41 && point.lat < 51.5
        && point.lon > -5.5 && point.lon < 9.8),
      probe.points.filter((p) => !(p.lat > 41 && p.lat < 51.5)).map((p) => p.id).join(','));
    check('the nuclear "lat, lon" string parsed the same way',
      Math.abs(gravelines.lat - 51.0128) < 0.001 && Math.abs(gravelines.lon - 2.1393) < 0.001,
      `${gravelines.lat?.toFixed(4)} N ${gravelines.lon?.toFixed(4)} E`);
    await shoot(page, '02-positions.png');

    // ── iv. the labels are painted, and say what each object is ────────────
    console.log('[qa] iv. labels are painted and name the object');
    check('the overlay painted this source’s labels',
      (probe.overlay?.paintedBySource?.['edf-power-plants'] || 0) > 0,
      JSON.stringify(probe.overlay?.paintedBySource || {}));
    check('the legend names all three filières with their installed totals',
      probe.controls.legend.length === 3
      && probe.controls.legend.every((entry) => entry.count > 0 && /MW installés/.test(entry.blurb)),
      probe.controls.legend.map((entry) => `${entry.label}:${entry.count}`).join(' '));
    check('the two reference dates are both reported, never collapsed',
      probe.stats.referenceDates.length === 2
      && probe.stats.referenceDates.includes('2023-12-31')
      && probe.stats.referenceDates.includes('2025-12-31'),
      String(probe.stats.referenceDates));
    check('the operator whose fleet this is is named', probe.stats.operator === 'EDF SA');
    check('capacity is reported as installed, not as production',
      probe.stats.capacityMw === 13489.47 && probe.analyst[0].capacityMw === 5460,
      `${probe.stats.capacityMw} MW`);
    check('a hydro plant claims no unit count it was never given',
      probe.analyst.find((record) => record.name === 'GRAND-MAISON')?.units === null);

    // ── v. turning it off leaves nothing behind ────────────────────────────
    console.log('[qa] v. the fleet disappears when the layer is off');
    await page.evaluate(() => window.__godsEyeView.dataManager.setEnabled('edf-power-plants', false));
    let after = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      await pump(page, 3, 60);
      await sleep(300);
      after = await sceneProbe(page);
      if (after.shown === false) break;
    }
    check('the discs are hidden', after.shown === false);
    check('the labels are gone with them',
      !(after.overlay?.paintedBySource?.['edf-power-plants'] > 0),
      JSON.stringify(after.overlay?.paintedBySource || {}));
    check('and the analyst stops answering for a layer that is off',
      after.analyst.length === 0);
    await shoot(page, '03-off.png');

    const relevantErrors = consoleErrors.filter((text) => /edf|plant|centrale/i.test(text));
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
    console.log('[qa] edf-plants: all checks passed');
  }
  console.log(`[qa] shots → ${path.relative(REPO_ROOT, SHOTS_DIR)}/`);
}

main().catch((error) => {
  console.error('[qa] harness error:', error);
  process.exitCode = 1;
});
