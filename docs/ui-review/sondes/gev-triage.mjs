// Triage des défauts « hors lentille » de la revue UI. Lecture seule.
import puppeteer from 'puppeteer';
import { newQaPage } from '/Users/memel/conductor/workspaces/gods-eye-view/manila-v1/scripts/lib/qa-first-run.mjs';

const URL = 'http://localhost:4290/';
const out = {};
const t0 = Date.now();
setTimeout(() => { console.log(JSON.stringify({ ...out, TIMEOUT: true }, null, 2)); process.exit(1); }, 150000);

const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 140000,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await newQaPage(browser);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

// attendre le handle, sans waitForFunction (ne tique pas sous SwiftShader)
for (let i = 0; i < 120; i++) {
  if (await page.evaluate(() => Boolean(window.__godsEyeView?.dataManager))) break;
  await new Promise((r) => setTimeout(r, 500));
}
const pump = () => page.evaluate(() => { for (let i = 0; i < 10; i++) window.__godsEyeView.viewer.scene.render(); });
await pump();

// --- 1. le lien de partage emporte-t-il une couche allumée PAR LE CHEMIN UI ? ---
out.share = await page.evaluate(async () => {
  const row = document.querySelector('#data-toggles [data-layer-id="earthquakes"]');
  const btn = row?.querySelector('button') || row;
  const before = location.hash;
  btn?.click();
  return { clicked: Boolean(btn), hashBefore: before.slice(0, 120) };
});
for (let i = 0; i < 30; i++) { await pump(); await new Promise((r) => setTimeout(r, 500)); 
  const on = await page.evaluate(() => window.__godsEyeView.dataManager.isEffectivelyEnabled('earthquakes'));
  if (on) break; }
out.share.enabled = await page.evaluate(() => window.__godsEyeView.dataManager.isEffectivelyEnabled('earthquakes'));
await page.evaluate(() => document.getElementById('share-btn')?.click());
await new Promise((r) => setTimeout(r, 1500));
await pump();
out.share.hashAfter = await page.evaluate(() => location.hash.slice(0, 200));
out.share.clipboard = await page.evaluate(async () => {
  try { return (await navigator.clipboard.readText()).slice(0, 250); } catch (e) { return 'ERR ' + e.message; }
});

// --- 2. divergence d'altitude HUD ---
out.altitude = await page.evaluate(() => ({
  summary: document.getElementById('hud-summary')?.textContent?.trim().slice(0, 160) || null,
  alt: document.getElementById('hud-alt')?.textContent?.trim() || null,
  cameraAlt: Math.round(window.__godsEyeView.viewer.camera.positionCartographic.height),
}));

// --- 3. miroir accessible des étiquettes du globe ---
out.worldOverlay = await page.evaluate(() => {
  const list = document.getElementById('world-overlay-action-list');
  const canvas = document.getElementById('world-overlay-canvas');
  return {
    actionChildren: list ? list.children.length : 'absent',
    status: document.getElementById('world-overlay-status')?.textContent?.trim() || '',
    overlayPresent: Boolean(canvas),
    painted: window.__gevWorldOverlay?.getLabels?.()?.length ?? 'api absente',
  };
});

out.errors = errors.slice(0, 12);
out.elapsedMs = Date.now() - t0;
console.log(JSON.stringify(out, null, 2));
await browser.close();
process.exit(0);
