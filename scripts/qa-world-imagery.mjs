#!/usr/bin/env node
/**
 * The one thing the unit tests cannot show: what the seam LOOKS like.
 *
 * `ign-ortho` now draws IGN's 20 cm orthophoto over a worldwide satellite base,
 * so the interesting place is not Paris (all IGN) or Texas (all Esri) — it is
 * the coastline and the land border, where the two meet inside one frame. If
 * the composition is wrong, this is where it shows: a hard rectangle edge in
 * open sea, or Esri's edge pixels smeared across the Atlantic.
 *
 *   GOOGLE_MAPS_API_KEY= npx vite --port 4174
 *   QA_BASE_URL=http://localhost:4174 npm run qa:world-imagery
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shotsDir = path.join(repoRoot, 'qa-shots', 'world-imagery-seam');
const appUrl = process.env.QA_BASE_URL || 'http://localhost:4174';

// Three framings that each put the boundary inside the frame, plus one control
// far from France where only the world base can be responsible for the pixels.
const VIEWS = [
  { name: 'dover-strait', lat: 50.95, lon: 1.60, height: 120_000, note: 'Calais → Kent: sea, then a foreign coast' },
  { name: 'rhine-border', lat: 48.60, lon: 7.85, height: 90_000, note: 'Strasbourg → Baden: a LAND border, no coastline to hide it' },
  { name: 'pyrenees', lat: 42.60, lon: 0.90, height: 140_000, note: 'the Spanish side must be imagery, not OSM lines' },
  { name: 'manhattan-control', lat: 40.7128, lon: -74.006, height: 6_000, note: 'control: 6000 km from any IGN tile' },
];

const results = [];
let failures = 0;
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(),
  args: ['--use-angle=metal', '--enable-gpu', '--no-sandbox'],
});
const page = await newQaPage(browser);
fs.mkdirSync(shotsDir, { recursive: true });
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
await page.goto(`${appUrl}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
for (let wait = 0; wait < 200; wait += 1) {
  if (await page.evaluate(() => Boolean(window.__godsEyeView?.styleManager)).catch(() => false)) break;
  await new Promise((resolve) => setTimeout(resolve, 300));
}

const tiles = { ign: 0, esri: 0, eox: 0, bad: [] };
page.on('response', (response) => {
  const url = response.url();
  const which = url.includes('data.geopf.fr') ? 'ign'
    : url.includes('arcgisonline.com') ? 'esri'
      : url.includes('tiles.maps.eox.at') ? 'eox' : null;
  if (!which) return;
  if (response.status() === 200) tiles[which] += 1;
  else if (tiles.bad.length < 5) tiles.bad.push(`${response.status()} ${which} ${url.slice(0, 120)}`);
});

await page.evaluate(() => window.__godsEyeView.styleManager.setMapStack('ign-ortho'));

// Kill the boot fly-to BEFORE the first framing. Without this the tween resumes
// under the render pump below and drags the camera back to Paris, so the first
// screenshot silently showed the wrong place while every check still passed.
await page.evaluate(() => { window.__godsEyeView.viewer.camera.cancelFlight(); });
for (let frame = 0; frame < 10; frame += 1) {
  await page.evaluate(() => { window.__godsEyeView.viewer.scene.render(); });
  await new Promise((resolve) => setTimeout(resolve, 100));
}

for (const view of VIEWS) {
  await page.evaluate(({ lat, lon, height }) => {
    const viewer = window.__godsEyeView.viewer;
    viewer.camera.cancelFlight();
    const Cartographic = viewer.camera.positionCartographic.constructor;
    viewer.camera.setView({
      destination: viewer.scene.globe.ellipsoid
        .cartographicToCartesian(Cartographic.fromDegrees(lon, lat, height)),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
  }, view);
  // rAF is unreliable in this headless GPU config, so frames are pumped by hand.
  for (let frame = 0; frame < 60; frame += 1) {
    await page.evaluate(() => { window.__godsEyeView.viewer.scene.render(); });
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const where = await page.evaluate(() => {
    const c = window.__godsEyeView.viewer.camera.positionCartographic;
    return { lat: (c.latitude * 180) / Math.PI, lon: (c.longitude * 180) / Math.PI };
  });
  const onTarget = Math.abs(where.lat - view.lat) < 0.5 && Math.abs(where.lon - view.lon) < 0.5;
  await page.screenshot({ path: path.join(shotsDir, `${view.name}.png`) });
  check(
    `${view.name}: the camera is where the framing asked — ${view.note}`,
    onTarget,
    `asked ${view.lat.toFixed(2)}/${view.lon.toFixed(2)}, got ${where.lat.toFixed(2)}/${where.lon.toFixed(2)}`,
  );
}

const state = await page.evaluate(() => {
  const viewer = window.__godsEyeView.viewer;
  const layers = viewer.imageryLayers;
  const providers = [];
  for (let index = 0; index < layers.length; index += 1) {
    const provider = layers.get(index).imageryProvider;
    providers.push({ type: provider?.constructor?.name, url: provider?.url || null });
  }
  return { providers, credits: document.getElementById('cesium-credits')?.innerText || '' };
});

check(
  'the stack is world satellite UNDER the IGN orthophoto, in that order',
  state.providers.length === 2
    && /arcgisonline/.test(state.providers[0].url || '')
    && state.providers[1].type === 'WebMapTileServiceImageryProvider',
  JSON.stringify(state.providers.map((p) => p.type)),
);
// A ratio, not zero failures. The Géoplateforme returns spurious errors under
// concurrency: the SAME URL fetched 30 times in parallel came back 29x200 and
// 1x400 "Layer ORTHOIMAGERY.ORTHOPHOTOS unknown" — a message that is simply
// false, since the other 29 served the layer it claims not to know (measured
// 2026-09-08). Asserting perfection here would make this harness flaky for a
// reason that has nothing to do with the composition it exists to check.
const ignTotal = tiles.ign + tiles.bad.filter((b) => b.includes(' ign ')).length;
check(
  'both sources served tiles in the same session — the seam is real, not one layer winning',
  tiles.ign > 0 && tiles.esri > 0
    && tiles.bad.filter((b) => b.includes(' ign ')).length / Math.max(ignTotal, 1) < 0.1,
  JSON.stringify({ ...tiles, bad: tiles.bad.length }),
);
check(
  'Esri is credited on the globe alongside IGN, as both licences require',
  /Esri/.test(state.credits) && /IGN/.test(state.credits),
  JSON.stringify(state.credits.replace(/\s+/g, ' ').trim()),
);
check(
  'no Sentinel-2 fallback tile was needed — Esri held for the whole run',
  tiles.eox === 0,
  `eox=${tiles.eox}`,
);

await browser.close();
console.log(`\nScreenshots: ${shotsDir}`);
console.log(failures === 0 ? 'World imagery seam QA passed.' : `${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
