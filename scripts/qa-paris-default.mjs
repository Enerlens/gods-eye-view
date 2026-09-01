// Ad-hoc visual/state check: the globe opens on Paris and the LOCATION tray
// offers the eight largest French communes.
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
import { newQaPage } from './lib/qa-first-run.mjs';

mkdirSync('qa-shots', { recursive: true });
const URL = process.env.QA_URL || 'http://localhost:4183/';
const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await newQaPage(browser);
await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 90000 });
await page.waitForFunction(() => Boolean(window.__godsEyeView?.viewer), { timeout: 90000 });
// 500 ms pause + 4 s cinematic flight, plus slack for the swiftshader renderer.
await new Promise((r) => setTimeout(r, 12000));

const report = await page.evaluate(() => {
  const viewer = window.__godsEyeView.viewer;
  const carto = viewer.camera.positionCartographic;
  const deg = (rad) => +(rad * 180 / Math.PI).toFixed(4);
  return {
    camera: { lat: deg(carto.latitude), lon: deg(carto.longitude), heightM: Math.round(carto.height) },
    pills: [...document.querySelectorAll('#location-pills .location-pill')]
      .map((p) => `${p.dataset.locationId}:${p.textContent.trim()}`),
  };
});
console.log(JSON.stringify({ ...report, errors: errors.slice(0, 5) }, null, 2));
await page.screenshot({ path: 'qa-shots/paris-default.png' });
await browser.close();
