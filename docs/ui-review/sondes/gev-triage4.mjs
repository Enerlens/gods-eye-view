import puppeteer from 'puppeteer';
import { newQaPage } from '/Users/memel/conductor/workspaces/gods-eye-view/manila-v1/scripts/lib/qa-first-run.mjs';
const out = {};
setTimeout(() => { console.log(JSON.stringify({ ...out, TIMEOUT: true })); process.exit(1); }, 150000);
const b = await puppeteer.launch({ headless: 'new', protocolTimeout: 140000,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await newQaPage(b);
await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
await page.goto('http://localhost:4290/', { waitUntil: 'domcontentloaded', timeout: 60000 });
for (let i = 0; i < 120; i++) { if (await page.evaluate(() => Boolean(window.__godsEyeView?.viewer))) break; await new Promise(r => setTimeout(r, 500)); }
const pump = () => page.evaluate(() => { for (let i = 0; i < 12; i++) window.__godsEyeView.viewer.scene.render(); });

// --- A. contrôles de formulaire sans nom accessible ---
out.namelessControls = await page.evaluate(() => {
  const res = [];
  for (const el of document.querySelectorAll('input, select, textarea')) {
    const id = el.id || '(sans id)';
    const labelled = document.querySelector(`label[for="${CSS.escape(el.id || '~')}"]`)
      || el.closest('label')
      || el.getAttribute('aria-label')
      || (el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby')))
      || el.getAttribute('title');
    if (!labelled) res.push({ id, type: el.type || el.tagName.toLowerCase(), hidden: el.offsetParent === null });
  }
  return res;
});

// --- B. couleur composite des départements sous trois choroplèthes ---
for (const id of ['delinquance-fr', 'irve-fr', 'schools-fr']) {
  await page.evaluate((l) => document.querySelector(`#data-toggles [data-layer-id="${l}"] button`)?.click(), id);
  for (let i = 0; i < 30; i++) { await pump(); await new Promise(r => setTimeout(r, 500));
    if (await page.evaluate((l) => window.__godsEyeView.dataManager.isEffectivelyEnabled(l), id)) break; }
}
out.layersOn = await page.evaluate(() => ['delinquance-fr','irve-fr','schools-fr']
  .filter(l => window.__godsEyeView.dataManager.isEffectivelyEnabled(l)));
await page.evaluate(() => { const { viewer } = window.__godsEyeView; viewer.camera.cancelFlight();
  const C = viewer.camera.position.constructor;
  viewer.camera.setView({ destination: C.fromDegrees(2.4, 46.6, 1600000), orientation: { heading: 0, pitch: -Math.PI/2, roll: 0 } }); });
for (let i = 0; i < 14; i++) { await pump(); await new Promise(r => setTimeout(r, 500)); }

// échantillon de pixel sur la Gironde + les couleurs déclarées par les légendes visibles
out.pixel = await page.evaluate(() => {
  const { viewer } = window.__godsEyeView;
  const canvas = viewer.scene.canvas;
  const C = viewer.camera.position.constructor;
  // Gironde ≈ -0.6 / 44.8
  const pos = C.fromDegrees(-0.6, 44.8, 0);
  const win = viewer.scene.cartesianToCanvasCoordinates(pos);
  if (!win) return { error: 'hors écran' };
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  const px = new Uint8Array(4);
  const x = Math.round(win.x * (canvas.width / canvas.clientWidth));
  const y = Math.round((canvas.clientHeight - win.y) * (canvas.height / canvas.clientHeight));
  gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return { win: { x: Math.round(win.x), y: Math.round(win.y) }, rgba: [...px] };
});
out.legendSwatches = await page.evaluate(() => [...document.querySelectorAll('.data-toggle-legend-item')]
  .map(el => { const sw = el.querySelector('span, i, .swatch') || el;
    return getComputedStyle(sw).backgroundColor; })
  .filter(c => c && c !== 'rgba(0, 0, 0, 0)').slice(0, 40));
console.log(JSON.stringify(out, null, 2));
await b.close(); process.exit(0);
