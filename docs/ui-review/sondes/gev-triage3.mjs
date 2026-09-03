import puppeteer from 'puppeteer';
import { newQaPage } from '/Users/memel/conductor/workspaces/gods-eye-view/manila-v1/scripts/lib/qa-first-run.mjs';
const out = {};
setTimeout(() => { console.log(JSON.stringify({ ...out, TIMEOUT: true })); process.exit(1); }, 140000);
const b = await puppeteer.launch({ headless: 'new', protocolTimeout: 130000,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await newQaPage(b);
await page.goto('http://localhost:4290/', { waitUntil: 'domcontentloaded', timeout: 60000 });
for (let i = 0; i < 120; i++) { if (await page.evaluate(() => Boolean(window.__godsEyeView?.viewer))) break; await new Promise(r => setTimeout(r, 500)); }
const pump = () => page.evaluate(() => { for (let i = 0; i < 12; i++) window.__godsEyeView.viewer.scene.render(); });
// une couche nationale allumée par le chemin UI, puis V-FRANCE
await page.evaluate(() => document.querySelector('#data-toggles [data-layer-id="delinquance-fr"] button')?.click());
for (let i = 0; i < 40; i++) { await pump(); await new Promise(r => setTimeout(r, 500));
  if (await page.evaluate(() => window.__godsEyeView.dataManager.isEffectivelyEnabled('delinquance-fr'))) break; }
await page.evaluate(() => { const { viewer } = window.__godsEyeView; viewer.camera.cancelFlight();
  const C = viewer.camera.position.constructor; const rad = d => d*Math.PI/180;
  viewer.camera.setView({ destination: C.fromDegrees(2.4, 46.6, 1600000), orientation: { heading: 0, pitch: rad(-90), roll: 0 } }); });
for (let i = 0; i < 10; i++) { await pump(); await new Promise(r => setTimeout(r, 500)); }
out.result = await page.evaluate(() => ({
  layerOn: window.__godsEyeView.dataManager.isEffectivelyEnabled('delinquance-fr'),
  diagnostics: window.__gevWorldOverlay?.getDiagnostics?.() ?? 'absent',
  actionChildren: document.getElementById('world-overlay-action-list')?.children.length ?? 'absent',
  status: document.getElementById('world-overlay-status')?.textContent?.trim() || '(vide)',
  summaryAtFrance: document.getElementById('hud-summary')?.textContent?.trim().replace(/\s+/g,' ').slice(0,120),
}));
console.log(JSON.stringify(out, null, 2));
await b.close(); process.exit(0);
