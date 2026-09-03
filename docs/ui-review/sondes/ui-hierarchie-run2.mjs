/** HIERARCHIE & LISIBILITE — clean pass: no request interception, PNG decoded in Node. */
import fs from 'node:fs';
import sharp from '/Users/memel/conductor/workspaces/gods-eye-view/manila-v1/node_modules/sharp/lib/index.js';
import puppeteer from 'puppeteer';
import { newQaPage } from '/Users/memel/conductor/workspaces/gods-eye-view/manila-v1/scripts/lib/qa-first-run.mjs';

const URL = 'http://localhost:4290/?welcome=0';
const OUT = '/tmp/ui-hierarchie';
const VIEWS = {
  'V-GLOBE': { lon: 10, lat: 48, alt: 12000000, heading: 0, pitch: -90 },
  'V-FRANCE': { lon: 2.4, lat: 46.6, alt: 1600000, heading: 0, pitch: -90 },
  'V-PARIS': { lon: 2.3364, lat: 48.86, alt: 900, heading: 160, pitch: -35 },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SCEN = process.env.SCEN || 'S-VIDE';

const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 120000, args: ['--no-sandbox'] });
const page = await newQaPage(browser);
// Stub the Vite HMR socket only: a shared dev server full-reloads mid-capture.
await page.evaluateOnNewDocument(() => {
  const Orig = window.WebSocket;
  const dead = () => ({ readyState: 3, send() {}, close() {}, addEventListener() {}, removeEventListener() {} });
  const Patched = function (url, protocols) {
    const p = Array.isArray(protocols) ? protocols.join(',') : String(protocols || '');
    if (p.includes('vite-hmr')) return dead();
    return new Orig(url, protocols);
  };
  Patched.prototype = Orig.prototype;
  Object.assign(Patched, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  window.WebSocket = Patched;
});
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 240)); });
page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log('NAV'); });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
for (let i = 0; i < 180; i++) { if (await page.evaluate(() => !!window.__godsEyeView?.viewer)) break; await sleep(1000); }
await sleep(8000);

const pump = (n = 14) => page.evaluate((c) => { const { viewer } = window.__godsEyeView; for (let i = 0; i < c; i++) viewer.scene.render(); }, n);
const setCam = (v) => page.evaluate((view) => {
  const { viewer } = window.__godsEyeView;
  viewer.camera.cancelFlight();
  const Cartographic = viewer.camera.positionCartographic.constructor;
  const rad = (d) => (d * Math.PI) / 180;
  const dest = viewer.scene.globe.ellipsoid.cartographicToCartesian(new Cartographic(rad(view.lon), rad(view.lat), view.alt));
  viewer.camera.setView({ destination: dest, orientation: { heading: rad(view.heading), pitch: rad(view.pitch), roll: 0 } });
  for (let i = 0; i < 8; i++) viewer.scene.render();
}, v);
const errorPanel = () => page.evaluate(() => {
  const el = document.querySelector('.cesium-widget-errorPanel');
  return el && getComputedStyle(el).display !== 'none' ? el.textContent.slice(0, 160) : null;
});

const INVENTORY = () => {
  const out = []; const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('#cesiumContainer')) continue;
    if (['SCRIPT', 'STYLE', 'CANVAS', 'SVG', 'PATH'].includes(el.tagName)) continue;
    const direct = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
    if (!direct) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') < 0.05) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) continue;
    let anc = el, hidden = false, plate = null, plateSel = null;
    while (anc && anc !== document.body) {
      const acs = getComputedStyle(anc);
      if (acs.display === 'none' || acs.visibility === 'hidden' || anc.hidden) { hidden = true; break; }
      if (!plate) {
        const m = acs.backgroundColor.match(/rgba?\(([^)]+)\)/);
        if (m) { const p = m[1].split(',').map(Number.parseFloat); const a = p.length > 3 ? p[3] : 1;
          if (a > 0.02) { plate = { rgb: [p[0], p[1], p[2]], a }; plateSel = anc.id ? '#' + anc.id : anc.tagName + '.' + [...anc.classList].join('.'); } }
      }
      anc = anc.parentElement;
    }
    if (hidden) continue;
    const sel = el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.classList.length ? '.' + [...el.classList].join('.') : '');
    const key = sel + '|' + Math.round(r.x) + ',' + Math.round(r.y);
    if (seen.has(key)) continue; seen.add(key);
    out.push({ sel, text: direct.slice(0, 60), fontSize: parseFloat(cs.fontSize), fontWeight: cs.fontWeight,
      letterSpacing: cs.letterSpacing, textTransform: cs.textTransform, color: cs.color,
      textShadow: cs.textShadow === 'none' ? null : cs.textShadow.slice(0, 90), opacity: parseFloat(cs.opacity || '1'),
      plate, plateSel, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } });
  }
  return out;
};

async function shotBuf(name) {
  for (let i = 0; i < 3; i++) {
    try { const b = await page.screenshot(); fs.writeFileSync(`${OUT}/${name}.png`, b); return b; }
    catch (e) { console.error('shot retry', name, e.message); await sleep(1500); }
  }
  return null;
}

/** Median RGB of each rect, read from the raw PNG in Node. */
async function sampleRects(buf, rects) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const sx = info.width / 1600;
  return rects.map((r) => {
    const x0 = Math.max(0, Math.round(r.x * sx)), y0 = Math.max(0, Math.round(r.y * sx));
    const x1 = Math.min(info.width, Math.round((r.x + r.w) * sx)), y1 = Math.min(info.height, Math.round((r.y + r.h) * sx));
    const rs = [], gs = [], bs = [], ls = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * info.width + x) * info.channels;
      rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]);
      ls.push(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    }
    if (!rs.length) return null;
    const q = (a, t) => { const s = [...a].sort((p, v) => p - v); return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * t))]); };
    return { med: [q(rs, 0.5), q(gs, 0.5), q(bs, 0.5)], lumP05: q(ls, 0.05), lumP50: q(ls, 0.5), lumP95: q(ls, 0.95),
      darkest: [q(rs, 0.02), q(gs, 0.02), q(bs, 0.02)], brightest: [q(rs, 0.98), q(gs, 0.98), q(bs, 0.98)] };
  });
}

async function capture(viewName) {
  await setCam(VIEWS[viewName]);
  await sleep(9000); await pump(18); await sleep(5000); await pump(14);
  const tag = `${viewName}-${SCEN}`;
  const err = await errorPanel();
  const buf = await shotBuf(`c-${tag}`);
  const items = await page.evaluate(INVENTORY);
  await page.evaluate(() => {
    window.__hid = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('#cesiumContainer')) continue;
      const d = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('').trim();
      if (!d) continue;
      const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
      window.__hid.push([el, el.style.color, el.style.textShadow]);
      el.style.setProperty('color', 'transparent', 'important');
      el.style.setProperty('text-shadow', 'none', 'important');
    }
  });
  await pump(6);
  const bgBuf = await shotBuf(`c-${tag}-bg`);
  const bgs = bgBuf ? await sampleRects(bgBuf, items.map((i) => i.rect)) : items.map(() => null);
  await page.evaluate(() => { for (const [el, c, t] of window.__hid || []) { el.style.color = c; el.style.textShadow = t; } window.__hid = []; });
  await pump(6);
  fs.writeFileSync(`${OUT}/m-${tag}.json`, JSON.stringify({ items, bgs, err, consoleErrors: consoleErrors.slice(-15) }, null, 1));
  console.log(tag, 'items=', items.length, 'errorPanel=', err ? 'YES: ' + err : 'no');
}

if (SCEN === 'S-NAT') {
  await page.evaluate((ids) => { for (const id of ids) window.__godsEyeView.dataManager.setEnabled(id, true, { origin: 'qa' }); }, ['irve-fr', 'schools-fr', 'delinquance-fr']);
  await sleep(12000); await pump(16);
}
for (const v of Object.keys(VIEWS)) {
  try { await capture(v); } catch (e) { console.error('CAPTURE FAILED', v, e.message); }
}
fs.writeFileSync(`${OUT}/console-${SCEN}.json`, JSON.stringify(consoleErrors, null, 1));
await browser.close();
console.log('DONE', SCEN);
