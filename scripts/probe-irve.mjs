import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: true, executablePath: puppeteer.executablePath(),
  args: ['--enable-unsafe-swiftshader','--no-sandbox','--window-size=1600,1000'],
  defaultViewport: { width: 1600, height: 1000 }, protocolTimeout: 60000 });
const page = await browser.newPage();
const bad = [];
page.on('response', r => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url().slice(0,120)}`); });
page.on('requestfailed', r => bad.push(`FAIL ${r.failure()?.errorText} ${r.url().slice(0,120)}`));
page.on('pageerror', e => bad.push(`PAGEERROR ${String(e).slice(0,200)}`));
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('gev:first-run-mission:v1','suppressed'); } catch {} });
await page.goto('http://localhost:4173', { waitUntil:'domcontentloaded', timeout:60000 });
await page.waitForFunction(() => window.__godsEyeView?.dataManager, { timeout:60000, polling:200 });
await sleep(2500);
await page.evaluate(() => { const g=window.__godsEyeView; const e=g.viewer.scene.globe?.ellipsoid||g.viewer.scene.ellipsoid;
  try{g.viewer.camera.cancelFlight()}catch{}
  g.viewer.camera.setView({destination:e.cartographicToCartesian({longitude:2.4*Math.PI/180,latitude:46.6*Math.PI/180,height:900000}),orientation:{heading:0,pitch:-Math.PI/2,roll:0}}); });
const LAYER = process.argv[2] || 'irve-fr';
await page.evaluate((id) => window.__godsEyeView.dataManager.setEnabled(id, true), LAYER);
for (let i=0;i<60;i++){ await page.evaluate(()=>{try{window.__godsEyeView.viewer.scene.render()}catch{}}); await sleep(150); }
const out = await page.evaluate((id) => {
  const v = window.__godsEyeView.viewer;
  const res = { sources: [] };
  for (let i=0;i<v.dataSources.length;i++) {
    const s = v.dataSources.get(i);
    const shown = s.entities.values.filter(e => e.polygon && e.show);
    let state = null, radius = null;
    if (shown.length) { const sph = {}; state = v.dataSourceDisplay.getBoundingSphere(shown[0], false, sph); radius = sph.radius; }
    res.sources.push({ name: s.name, show: s.show, entities: s.entities.values.length, shown: shown.length, bsState: state, radius });
  }
  return res;
}, LAYER);
console.log(LAYER, JSON.stringify(out, null, 1));
console.log('NETWORK PROBLEMS:'); for (const b of [...new Set(bad)]) console.log('  ', b);
await browser.close();
