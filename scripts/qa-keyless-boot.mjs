#!/usr/bin/env node
/**
 * The keyless build's acceptance test: `git clone && npm i && npm run dev`
 * with no credential of any kind must boot to a usable globe.
 *
 * Point it at a dev server started WITHOUT a Google Maps key:
 *
 *   GOOGLE_MAPS_API_KEY= npx vite --port 4174
 *   QA_BASE_URL=http://localhost:4174 node scripts/qa-keyless-boot.mjs
 *
 * `scripts/dev-fresh.sh` is the KEYED launcher and warns its way past a
 * missing key; plain `vite` is the keyless path this harness measures.
 *
 * Deliberately narrow. `scripts/qa-map-source-tray.mjs` owns the tray's
 * layout, keyboard, and pointer contracts; this one owns the single question
 * "does a credential-free checkout come up, does it show France, can it find a
 * place, and does it tell the truth about what it still cannot do".
 *
 * Local environment note (macOS, Chrome for Testing): `requestAnimationFrame`
 * does not run reliably in this headless GPU configuration, so this harness
 * polls with `page.evaluate` rather than `page.waitForFunction`, drives clicks
 * through `element.click()` in-page rather than `page.click`, and pumps
 * `scene.render()` by hand when it needs painted frames. Screenshots are
 * best-effort evidence, never an assertion.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shotsDir = path.join(repoRoot, 'qa-shots', 'keyless-boot');
const appUrl = process.env.QA_BASE_URL || 'http://localhost:4174';
const headful = process.argv.includes('--headful');
const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH
  || (() => { try { return puppeteer.executablePath(); } catch { return null; } })();

if (!executablePath || !fs.existsSync(executablePath)) {
  throw new Error('Puppeteer Chrome for Testing is unavailable');
}
fs.mkdirSync(shotsDir, { recursive: true });

const failures = [];
const check = (name, passed, detail = '') => {
  console.log(`  [${passed ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (!passed) failures.push(name);
};

const browser = await puppeteer.launch({
  headless: headful ? false : 'new',
  executablePath,
  args: ['--use-angle=metal', '--enable-gpu', '--no-sandbox'],
});
// The first-run mission card returns for every fresh session, and a headless
// run is always one — `newQaPage()` is the repo's single answer to that.
const page = await newQaPage(browser);
const consoleErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 240));
});
page.on('pageerror', (error) => consoleErrors.push(`PAGEERROR: ${error.message.slice(0, 300)}`));

/** Poll in-page instead of `waitForFunction` — see the rAF note in the header. */
const poll = async (fn, timeoutMs = 60_000, stepMs = 300) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await page.evaluate(fn).catch(() => null);
    if (value) return value;
    if (Date.now() > deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
};

try {
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await page.goto(`${appUrl}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  const booted = await poll(() => Boolean(window.__godsEyeView?.styleManager));
  check('the app boots with no Google Maps API key', Boolean(booted),
    'init() must not throw before the viewer exists');
  if (!booted) throw new Error('keyless boot never produced window.__godsEyeView');

  const loaderCleared = await poll(
    () => document.getElementById('loading-screen')?.classList.contains('hidden'),
  );
  check('the loading screen clears instead of stalling on a missing key', Boolean(loaderCleared));

  const state = await page.evaluate(() => {
    const app = window.__godsEyeView;
    const controller = app.mapStackController;
    const stackById = Object.fromEntries(controller.getStacks().map((stack) => [stack.id, stack]));
    return {
      tileset: app.tileset,
      googleKeyGlobal: window.__GOOGLE_MAPS_API_KEY__ ?? null,
      activeId: controller.getActiveId(),
      globeShown: app.viewer.scene.globe.show,
      stackById,
      chips: [...document.querySelectorAll('.map-stack-chip')].map((chip) => ({
        id: chip.dataset.stackId,
        ariaDisabled: chip.getAttribute('aria-disabled'),
        title: chip.title,
      })),
    };
  });

  check(
    'no Google key is published to the page, and no photoreal tileset is built',
    state.googleKeyGlobal === null && state.tileset === null,
    JSON.stringify({ googleKeyGlobal: state.googleKeyGlobal, tileset: state.tileset }),
  );
  check(
    'the globe is SHOWN and the active source is the keyless OSM stack',
    state.globeShown === true && state.activeId === 'osm',
    JSON.stringify({ globeShown: state.globeShown, activeId: state.activeId }),
  );
  check(
    'Google 3D names the credential it is missing, not a generic failure',
    state.stackById.photoreal?.available === false
      && /Google Maps API key/i.test(state.stackById.photoreal?.unavailableReason || ''),
    JSON.stringify(state.stackById.photoreal),
  );
  check(
    'every keyless source is selectable: OSM plus both IGN France stacks',
    ['osm', 'ign-ortho', 'ign-plan'].every((id) => state.stackById[id]?.available === true)
      && state.chips.filter((chip) => chip.ariaDisabled === 'false').length === 3,
    JSON.stringify(state.chips),
  );

  // The IGN stacks are the reason a keyless build is worth looking at, so
  // "the switch resolved" is not enough — a tile has to come back over France.
  const ignTiles = { ok: 0, bad: 0, samples: [] };
  page.on('response', (response) => {
    if (!response.url().includes('data.geopf.fr')) return;
    if (response.status() === 200) ignTiles.ok += 1;
    else {
      ignTiles.bad += 1;
      if (ignTiles.samples.length < 3) {
        ignTiles.samples.push(`${response.status()} ${response.url().slice(0, 140)}`);
      }
    }
  });

  const switched = await page.evaluate(() => window.__godsEyeView.styleManager.setMapStack('ign-ortho'));
  await page.evaluate(() => {
    // The boot fly-to tween would otherwise resume under the render pump below
    // and drag the camera back off France.
    const viewer = window.__godsEyeView.viewer;
    viewer.camera.cancelFlight();
    const Cartographic = viewer.camera.positionCartographic.constructor;
    viewer.camera.setView({
      destination: viewer.scene.globe.ellipsoid
        .cartographicToCartesian(Cartographic.fromDegrees(2.2945, 48.8584, 1600)),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
  });
  for (let frame = 0; frame < 70; frame += 1) {
    await page.evaluate(() => { window.__godsEyeView.viewer.scene.render(); });
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const composited = await page.evaluate(() => {
    const layers = window.__godsEyeView.viewer.imageryLayers;
    const providers = [];
    for (let index = 0; index < layers.length; index += 1) {
      providers.push(layers.get(index).imageryProvider?.constructor?.name);
    }
    return { providers, tilesLoaded: window.__godsEyeView.viewer.scene.globe.tilesLoaded };
  });
  check(
    'IGN Ortho switches keyless and composites over an OSM base layer',
    switched?.ok === true
      && switched?.activeStack === 'ign-ortho'
      && JSON.stringify(composited.providers) === JSON.stringify([
        'OpenStreetMapImageryProvider', 'WebMapTileServiceImageryProvider',
      ]),
    JSON.stringify({ switched, ...composited }),
  );
  check(
    'the Géoplateforme actually serves tiles over Paris, and none 404',
    ignTiles.ok > 0 && ignTiles.bad === 0,
    JSON.stringify(ignTiles),
  );
  await page.screenshot({ path: path.join(shotsDir, 'ign-ortho-paris.png') });

  // The on-globe attribution line is a licence requirement, not decoration:
  // Etalab 2.0 wants the source named wherever the data is shown.
  const credits = await page.evaluate(() => ({
    onGlobe: document.getElementById('cesium-credits')?.innerText?.replace(/\s+/g, ' ').trim() || '',
    popoverHasIgn: document.body.innerHTML.includes('data.geopf.fr')
      || document.body.innerHTML.includes('G&eacute;oplateforme')
      || document.body.innerHTML.includes('Géoplateforme'),
  }));
  check(
    'IGN is credited on the globe while its imagery is displayed',
    /IGN/.test(credits.onGlobe),
    JSON.stringify(credits),
  );

  // Search is the feature a keyless build used to lose outright. It now runs on
  // OpenStreetMap (Nominatim) and the IGN Géoplateforme through /api/geocode,
  // so the acceptance test is the whole trip: type a place, land on it.
  await page.evaluate(() => window.__godsEyeView.styleManager.setMapStack('osm'));
  const geocodeCalls = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/api/geocode')) geocodeCalls.push(url.slice(url.indexOf('/api/geocode')));
  });
  const searchStarted = await page.evaluate(() => {
    const input = document.getElementById('location-search');
    if (!input) return false;
    input.focus();
    input.value = 'Toulouse';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  });
  // Two Nominatim passes are serialized ~1.1 s apart behind one biased search,
  // then a 3 s flight — this is a slow trip by design, not a hung one.
  const arrived = await poll(() => {
    const viewer = window.__godsEyeView.viewer;
    viewer.scene.render();
    const carto = viewer.camera.positionCartographic;
    const lat = (carto.latitude * 180) / Math.PI;
    const lon = (carto.longitude * 180) / Math.PI;
    if (Math.abs(lat - 43.6045) > 0.6 || Math.abs(lon - 1.4442) > 0.6) return null;
    const toast = document.getElementById('toast');
    return { lat, lon, toast: toast?.textContent?.trim() || '' };
  }, 45_000);
  check(
    'a keyless search resolves a place and flies there',
    searchStarted === true && Boolean(arrived),
    JSON.stringify({ searchStarted, arrived }),
  );
  check(
    'the search goes to the keyless geocoder, and reports no missing credential',
    geocodeCalls.length > 0 && !/API key/i.test(arrived?.toast || ''),
    JSON.stringify({ geocodeCalls, toast: arrived?.toast ?? null }),
  );
  await page.screenshot({ path: path.join(shotsDir, 'keyless-search-toulouse.png') });

  // A keyless boot that spews failed requests reads as broken even when it is
  // not. Google-only endpoints must not be called at all.
  const googleRequests = consoleErrors.filter((text) => /googleapis|\/api\/google\//.test(text));
  check(
    'nothing reaches a Google endpoint on a keyless boot',
    googleRequests.length === 0,
    googleRequests.join(' | '),
  );
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\nKeyless boot QA failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nKeyless boot QA passed.');
