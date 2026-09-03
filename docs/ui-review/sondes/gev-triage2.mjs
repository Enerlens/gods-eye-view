import puppeteer from 'puppeteer';
import { newQaPage } from '/Users/memel/conductor/workspaces/gods-eye-view/manila-v1/scripts/lib/qa-first-run.mjs';
const out = { samples: [] };
setTimeout(() => { console.log(JSON.stringify({ ...out, TIMEOUT: true }, null, 2)); process.exit(1); }, 150000);
const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 140000,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await newQaPage(browser);
await page.goto('http://localhost:4290/', { waitUntil: 'domcontentloaded', timeout: 60000 });
for (let i = 0; i < 120; i++) {
  if (await page.evaluate(() => Boolean(window.__godsEyeView?.viewer))) break;
  await new Promise((r) => setTimeout(r, 500));
}
const pump = () => page.evaluate(() => { for (let i = 0; i < 12; i++) window.__godsEyeView.viewer.scene.render(); });

out.overlayApi = await page.evaluate(() => Object.keys(window.__gevWorldOverlay || {}).slice(0, 20));

// caméra POSÉE, vol annulé, aux trois vues canoniques
const views = [
  ['V-PARIS', 2.3364, 48.8600, 900, -35, 160],
  ['V-FRANCE', 2.4, 46.6, 1600000, -90, 0],
  ['V-GLOBE', 10, 48, 12000000, -90, 0],
];
for (const [name, lon, lat, alt, pitch, heading] of views) {
  await page.evaluate(({ lon, lat, alt, pitch, heading }) => {
    const { viewer } = window.__godsEyeView;
    viewer.camera.cancelFlight();
    const Cartesian3 = viewer.camera.position.constructor;
    const rad = (d) => (d * Math.PI) / 180;
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(lon, lat, alt),
      orientation: { heading: rad(heading), pitch: rad(pitch), roll: 0 },
    });
  }, { lon, lat, alt, pitch, heading });
  // laisser le HUD converger : plusieurs cycles de rendu espacés
  for (let i = 0; i < 8; i++) { await pump(); await new Promise((r) => setTimeout(r, 400)); }
  const s = await page.evaluate(() => {
    const sum = document.getElementById('hud-summary')?.textContent || '';
    return {
      summaryRaw: sum.trim().replace(/\s+/g, ' ').slice(0, 200),
      hudAlt: (document.getElementById('hud-alt')?.textContent || '').trim(),
      cameraAlt: Math.round(window.__godsEyeView.viewer.camera.positionCartographic.height),
      overlayChildren: document.getElementById('world-overlay-action-list')?.children.length ?? 'absent',
      overlayLabelsPainted: (window.__gevWorldOverlay?.labels || window.__gevWorldOverlay?.getState?.()?.labels || []).length ?? '?',
    };
  });
  out.samples.push({ view: name, requestedAlt: alt, ...s });
}
console.log(JSON.stringify(out, null, 2));
await browser.close(); process.exit(0);
