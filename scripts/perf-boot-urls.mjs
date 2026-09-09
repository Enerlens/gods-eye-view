#!/usr/bin/env node
/**
 * perf:urls — one cold boot, every request listed by bytes.
 *
 * The companion to `perf:boot`: that one says how long and how much, this one
 * says WHAT. Sorted by encoded bytes descending, with the content-encoding
 * column, because the two questions that keep coming back are "what is the
 * biggest thing we ship before the globe" and "is it actually compressed".
 *
 * The STACK line at the top is the scene the numbers belong to — imagery
 * layers, MSAA, skybox, water, canvas size. A boot with zero imagery layers
 * (no key, or the EEA block on Google 3D Tiles) is a legitimate measurement of
 * the JS cost and a useless one for tiles, and the only way to tell the two
 * apart afterwards is to have recorded it.
 *
 * Usage:
 *   node scripts/perf-boot-urls.mjs --url http://127.0.0.1:4179
 *   node scripts/perf-boot-urls.mjs --url ... --top 60 --json
 */
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
// Positional URL kept working: this script was a one-liner before it was a tool.
const url = arg('--url', argv[0]?.startsWith('http') ? argv[0] : 'http://127.0.0.1:4179');
const top = Number(arg('--top', '45'));
const windowMs = Number(arg('--window', '20000'));
const asJson = argv.includes('--json');

const browser = await puppeteer.launch({
  headless: 'new',
  protocolTimeout: 300_000,
  args: [
    '--no-sandbox', '--disable-setuid-sandbox', '--window-size=1366,768',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  ],
});
const page = await newQaPage(browser);
await page.setViewport({ width: 1366, height: 768, deviceScaleFactor: 1 });
const cdp = await page.createCDPSession();
await cdp.send('Network.enable');
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

const t0 = Date.now();
const rows = new Map();
cdp.on('Network.requestWillBeSent', (e) => rows.set(e.requestId, {
  url: e.request.url, type: e.type, start: Date.now() - t0, bytes: 0, status: null, enc: '',
}));
cdp.on('Network.responseReceived', (e) => {
  const r = rows.get(e.requestId); if (!r) return;
  r.status = e.response.status;
  r.enc = e.response.headers['content-encoding'] || e.response.headers['Content-Encoding'] || '';
});
cdp.on('Network.loadingFinished', (e) => {
  const r = rows.get(e.requestId); if (r) { r.bytes = e.encodedDataLength; r.end = Date.now() - t0; }
});
cdp.on('Network.loadingFailed', (e) => {
  const r = rows.get(e.requestId); if (r) { r.status = `FAILED ${e.errorText}`; r.end = Date.now() - t0; }
});

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => !!window.__godsEyeView?.viewer, { timeout: 120_000 });
await new Promise((r) => setTimeout(r, windowMs));

const stack = await page.evaluate(() => {
  const g = window.__godsEyeView; const v = g.viewer;
  return {
    stack: g.mapStackController?.activeStackId ?? null,
    imageryLayers: v.imageryLayers.length,
    globeShow: v.scene.globe.show,
    primitives: v.scene.primitives.length,
    water: v.scene.globe.showWaterEffect,
    sky: !!v.scene.skyBox?.show,
    atm: !!v.scene.skyAtmosphere?.show,
    msaa: v.scene.msaaSamples,
    dpr: window.devicePixelRatio,
    canvas: [v.canvas.width, v.canvas.height],
    layers: g.dataManager?.getEnabledLayerIds?.() ?? null,
  };
});

const list = [...rows.values()].sort((a, b) => b.bytes - a.bytes);
const total = list.reduce((n, r) => n + r.bytes, 0);
const origin = new URL(url).origin;

if (asJson) {
  console.log(JSON.stringify({
    url, stack, reqs: list.length, MB: +(total / 1048576).toFixed(2),
    rows: list.map((r) => ({ ...r, kB: Math.round(r.bytes / 1024) })),
  }, null, 2));
} else {
  console.log('STACK', JSON.stringify(stack));
  console.log(`TOTAL ${list.length} req, ${(total / 1048576).toFixed(2)} MB`);
  for (const r of list.slice(0, top)) {
    console.log(
      `${String(Math.round(r.bytes / 1024)).padStart(6)} kB  ${String(r.status).padEnd(6)}`
      + ` ${String(r.start).padStart(5)}-${String(r.end ?? '?').padStart(5)}ms`
      + `  ${String(r.type ?? '?').padEnd(10)} ${String(r.enc ?? '').padEnd(4)}`
      + ` ${r.url.replace(origin, '').slice(0, 110)}`,
    );
  }
}
await browser.close();
