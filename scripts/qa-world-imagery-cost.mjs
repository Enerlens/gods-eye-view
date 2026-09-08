#!/usr/bin/env node
/**
 * What the second layer actually COSTS, per viewpoint, in requests and bytes.
 *
 * `ign-ortho` composites two imagery layers. Over France the lower one is
 * invisible — IGN's opaque orthophoto covers it completely — so every byte it
 * fetches there is waste. This bench measures that waste and tests whether
 * Cesium's `cutoutRectangle` and `show` avoid the FETCH or only the DRAW,
 * which is the whole question: a cutout that still downloads is worthless.
 *
 *   GOOGLE_MAPS_API_KEY= npx vite --port 4174
 *   QA_BASE_URL=http://localhost:4174 npm run qa:world-imagery-cost
 */
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const appUrl = process.env.QA_BASE_URL || 'http://localhost:4174';

// Deep inside France (the lower layer is 100% wasted) and far outside it (the
// lower layer is the ONLY thing drawing). The contrast is the measurement.
const VIEWS = [
  { name: 'paris   (all IGN)', lat: 48.8584, lon: 2.2945, height: 4_000 },
  { name: 'manhattan (no IGN)', lat: 40.7128, lon: -74.006, height: 6_000 },
];

// `shipped` leaves the controller alone and measures what a visitor actually
// pays. The other three NEUTRALISE `_syncWorldBaseVisibility()` first, or the
// product's own sleep would overwrite the strategy under test and every row
// would read zero — which is exactly what this bench looked like once the sleep
// landed, and why it now disables it explicitly instead of racing it.
const STRATEGIES = [
  { key: 'shipped', label: 'as shipped (sleep enabled)', sleep: true },
  { key: 'stacked', label: 'stacked, no sleep', sleep: false },
  { key: 'cutout', label: 'cutoutRectangle, no sleep', sleep: false },
  { key: 'hidden', label: 'show=false', sleep: false },
];

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(),
  args: ['--use-angle=metal', '--enable-gpu', '--no-sandbox'],
});
const page = await newQaPage(browser);
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
await page.goto(`${appUrl}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
for (let wait = 0; wait < 200; wait += 1) {
  if (await page.evaluate(() => Boolean(window.__godsEyeView?.styleManager)).catch(() => false)) break;
  await new Promise((resolve) => setTimeout(resolve, 300));
}

let tally = null;
page.on('response', async (response) => {
  if (!tally) return;
  const url = response.url();
  const which = url.includes('data.geopf.fr') ? 'ign'
    : url.includes('arcgisonline.com') ? 'world' : null;
  if (!which) return;
  tally[which].n += 1;
  try {
    const buffer = await response.buffer();
    tally[which].bytes += buffer.length;
  } catch { /* body already gone — count the request anyway */ }
});

await page.evaluate(() => window.__godsEyeView.styleManager.setMapStack('ign-ortho'));

const rows = [];
for (const view of VIEWS) {
  for (const strategy of STRATEGIES) {
    // Fresh tile caches per run, or the second measurement reads the first's.
    // Restoring the real method matters as much as the layer state: a previous
    // row may have stubbed it out.
    await page.evaluate((keepSleep) => {
      const app = window.__godsEyeView;
      const controller = app.mapStackController;
      const proto = Object.getPrototypeOf(controller);
      if (keepSleep) delete controller._syncWorldBaseVisibility;
      else controller._syncWorldBaseVisibility = () => {};
      void proto;
      const base = app.viewer.imageryLayers.get(0);
      base.show = true;
      base.cutoutRectangle = undefined;
      app.viewer.scene.globe._surface.tileProvider._imageryLayers._update?.();
    }, strategy.sleep);
    await page.evaluate(({ lat, lon, height }) => {
      const viewer = window.__godsEyeView.viewer;
      viewer.camera.cancelFlight();
      const Cartographic = viewer.camera.positionCartographic.constructor;
      // Park somewhere else first so the target view's tiles are never already
      // resident from the previous strategy's run.
      viewer.camera.setView({
        destination: viewer.scene.globe.ellipsoid
          .cartographicToCartesian(Cartographic.fromDegrees(lon + 60, lat, 9_000_000)),
      });
      void height;
    }, view);
    for (let frame = 0; frame < 12; frame += 1) {
      await page.evaluate(() => { window.__godsEyeView.viewer.scene.render(); });
      await new Promise((resolve) => setTimeout(resolve, 120));
    }

    await page.evaluate((key) => {
      const viewer = window.__godsEyeView.viewer;
      const base = viewer.imageryLayers.get(0);
      if (key === 'cutout') {
        // Cesium is not on `window`; the IGN layer above already carries
        // exactly the rectangle we want to cut out, in radians.
        base.cutoutRectangle = viewer.imageryLayers.get(1).imageryProvider.rectangle;
      } else if (key === 'hidden') {
        base.show = false;
      }
    }, strategy.key);

    tally = { ign: { n: 0, bytes: 0 }, world: { n: 0, bytes: 0 } };
    await page.evaluate(({ lat, lon, height }) => {
      const viewer = window.__godsEyeView.viewer;
      viewer.camera.cancelFlight();
      const Cartographic = viewer.camera.positionCartographic.constructor;
      viewer.camera.setView({
        destination: viewer.scene.globe.ellipsoid
          .cartographicToCartesian(Cartographic.fromDegrees(lon, lat, height)),
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
      });
      // The sleep decides on camera rest; raising it here makes the `shipped`
      // row deterministic instead of dependent on how many frames were pumped.
      viewer.camera.moveEnd.raiseEvent();
    }, view);
    for (let frame = 0; frame < 50; frame += 1) {
      await page.evaluate(() => { window.__godsEyeView.viewer.scene.render(); });
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    // Let in-flight bodies land before the tally is read.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    rows.push({ view: view.name, strategy: strategy.label, ...tally });
    tally = null;
  }
}

await browser.close();

const kb = (n) => `${(n / 1024).toFixed(0)} kB`;
console.log('\n  view                 strategy                      IGN tiles      world tiles');
console.log('  ' + '-'.repeat(84));
for (const row of rows) {
  console.log(
    `  ${row.view.padEnd(20)} ${row.strategy.padEnd(28)} `
    + `${String(row.ign.n).padStart(4)} / ${kb(row.ign.bytes).padStart(8)}   `
    + `${String(row.world.n).padStart(4)} / ${kb(row.world.bytes).padStart(8)}`,
  );
}
console.log('');
