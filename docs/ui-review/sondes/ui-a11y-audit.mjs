import fs from 'node:fs';
import puppeteer from 'puppeteer';
import { newQaPage } from '/Users/memel/conductor/workspaces/gods-eye-view/manila-v1/scripts/lib/qa-first-run.mjs';

const URL = 'http://localhost:4290/?welcome=0';
const VIEWPORT = { width: 1440, height: 900 };

const browser = await puppeteer.launch({
  headless: 'new', protocolTimeout: 300000,
  args: ['--enable-unsafe-swiftshader', '--use-gl=swiftshader', '--no-sandbox',
    '--disable-setuid-sandbox', '--disable-dev-shm-usage',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`],
});
const page = await newQaPage(browser);
await page.setViewport(VIEWPORT);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
for (let i = 0; i < 60; i++) {
  const ok = await page.evaluate(() => Boolean(window.__godsEyeView?.viewer && window.__godsEyeView?.dataManager));
  if (ok) break;
  await new Promise((r) => setTimeout(r, 500));
}
// V-GLOBE
await page.evaluate(() => {
  const { viewer } = window.__godsEyeView;
  viewer.camera.cancelFlight?.();
  const e = viewer.scene.globe.ellipsoid;
  viewer.camera.setView({
    destination: e.cartographicToCartesian({ longitude: 10 * Math.PI / 180, latitude: 48 * Math.PI / 180, height: 12000000 }),
    orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
  });
  for (let i = 0; i < 10; i++) viewer.scene.render();
});
await new Promise((r) => setTimeout(r, 2000));

const describe = `(el) => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return {
    tag: el.tagName, id: el.id || null,
    cls: (el.className && typeof el.className === 'string') ? el.className.slice(0,80) : null,
    role: el.getAttribute('role'), ariaLabel: el.getAttribute('aria-label'),
    title: el.getAttribute('title'),
    text: (el.textContent || '').trim().replace(/\\s+/g,' ').slice(0, 50),
    tabindex: el.getAttribute('tabindex'),
    rect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
    inViewport: r.width>0 && r.height>0 && r.left < innerWidth && r.right > 0 && r.top < innerHeight && r.bottom > 0,
    focusStyle: { outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, outlineColor: cs.outlineColor,
      outlineOffset: cs.outlineOffset, boxShadow: cs.boxShadow, backgroundColor: cs.backgroundColor,
      borderColor: cs.borderTopColor, color: cs.color, filter: cs.filter },
    ancestors: (() => { const a=[]; let n=el.parentElement; while(n && a.length<6){ a.push(n.id?'#'+n.id:n.tagName); n=n.parentElement;} return a; })(),
  };
}`;

// ---- 1. TAB ORDER WALK ----
await page.evaluate(() => { document.body.focus(); if (document.activeElement) document.activeElement.blur(); });
const tabWalk = [];
const MAX_TABS = 150;
let loopedAt = null;
const seenKeys = new Map();
for (let i = 0; i < MAX_TABS; i++) {
  await page.keyboard.press('Tab');
  const info = await page.evaluate(`(${describe})(document.activeElement)`);
  if (!info) { tabWalk.push({ step: i + 1, none: true }); continue; }
  const key = `${info.tag}#${info.id}.${info.cls}:${info.text}`;
  if (seenKeys.has(key) && loopedAt === null && i > 3) { loopedAt = { step: i + 1, first: seenKeys.get(key), key }; }
  if (!seenKeys.has(key)) seenKeys.set(key, i + 1);
  tabWalk.push({ step: i + 1, ...info });
  if (loopedAt && i > loopedAt.first + 2) break;
}

// ---- 2. FOCUS RING DIFF ----
// For each unique tabbable node, compare computed style focused vs. blurred.
const focusDiff = await page.evaluate(() => {
  const SEL = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), summary, details';
  const nodes = [...document.querySelectorAll(SEL)].filter((el) => {
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'
      && !el.disabled && r.left < innerWidth && r.right > 0 && r.top < innerHeight && r.bottom > 0;
  });
  const props = ['outlineStyle','outlineWidth','outlineColor','outlineOffset','boxShadow','backgroundColor','borderTopColor','color','filter','textDecorationLine','transform'];
  const snap = (el) => { const cs = getComputedStyle(el); const o = {}; for (const p of props) o[p] = cs[p]; return o; };
  const out = [];
  for (const el of nodes) {
    const before = snap(el);
    el.focus();
    const after = snap(el);
    el.blur();
    const changed = props.filter((p) => before[p] !== after[p]);
    const r = el.getBoundingClientRect();
    out.push({
      sel: (el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : '')),
      label: el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 30) || el.getAttribute('title'),
      w: +r.width.toFixed(1), h: +r.height.toFixed(1),
      changed, focusedOutline: after.outlineStyle + ' ' + after.outlineWidth + ' ' + after.outlineColor,
      focusedBoxShadow: after.boxShadow === 'none' ? 'none' : after.boxShadow.slice(0, 60),
      overCanvas: (() => { let n = el; while (n) { if (n.id === 'cesiumContainer' || n.tagName === 'CANVAS') return true; n = n.parentElement; } return false; })(),
    });
  }
  return out;
});

// ---- 3. TARGET SIZES ----
const targets = await page.evaluate(() => {
  const SEL = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [role="button"], [role="switch"], [role="checkbox"], [role="radio"], [role="tab"], label[for], [data-layer-id]';
  const seen = new Set(); const out = [];
  for (const el of document.querySelectorAll(SEL)) {
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    if (!(r.width > 0 && r.height > 0)) continue;
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity < 0.05) continue;
    if (!(r.left < innerWidth && r.right > 0 && r.top < innerHeight && r.bottom > 0)) continue;
    const key = el.id || (el.tagName + r.x + r.y + r.width);
    if (seen.has(key)) continue; seen.add(key);
    out.push({
      sel: el.id ? '#' + el.id : el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0,2).join('.') : ''),
      label: el.getAttribute('aria-label') || (el.textContent || '').trim().replace(/\s+/g,' ').slice(0, 28) || el.getAttribute('title') || '',
      w: +r.width.toFixed(1), h: +r.height.toFixed(1), x: +r.x.toFixed(0), y: +r.y.toFixed(0),
      min: +Math.min(r.width, r.height).toFixed(1),
      type: el.tagName.toLowerCase() + (el.type ? ':' + el.type : ''),
    });
  }
  return out.sort((a, b) => a.min - b.min);
});

// ---- 4. ARIA / SEMANTICS ----
const aria = await page.evaluate(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')].map((h) => ({
    level: h.tagName.match(/H(\d)/) ? +h.tagName[1] : +(h.getAttribute('aria-level') || 0),
    text: (h.textContent || '').trim().replace(/\s+/g,' ').slice(0, 45), visible: vis(h), id: h.id || null,
  }));
  const unlabelledButtons = [...document.querySelectorAll('button,[role="button"]')].filter((b) => {
    if (!vis(b)) return false;
    const t = (b.textContent || '').trim();
    return !b.getAttribute('aria-label') && !b.getAttribute('aria-labelledby') && (!t || /^[^\p{L}\p{N}]+$/u.test(t));
  }).map((b) => ({ sel: b.id ? '#' + b.id : b.className, text: (b.textContent||'').trim().slice(0,12), title: b.getAttribute('title') }));
  const imgsNoAlt = [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).map((i) => i.src.slice(-50));
  const svgNoTitle = [...document.querySelectorAll('svg')].filter((s) => vis(s) && !s.getAttribute('aria-hidden') && !s.querySelector('title') && !s.getAttribute('aria-label')).length;
  const liveRegions = [...document.querySelectorAll('[aria-live],[role="status"],[role="alert"],[role="log"]')].map((n) => ({
    sel: n.id ? '#' + n.id : n.tagName + '.' + (typeof n.className === 'string' ? n.className.slice(0,30) : ''),
    live: n.getAttribute('aria-live'), role: n.getAttribute('role'), atomic: n.getAttribute('aria-atomic'),
    hidden: n.hasAttribute('hidden'), display: getComputedStyle(n).display, visible: vis(n),
    textLen: (n.textContent || '').trim().length,
  }));
  const inputsNoLabel = [...document.querySelectorAll('input,select,textarea')].filter((el) => {
    if (!vis(el)) return false;
    if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return false;
    if (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) return false;
    if (el.closest('label')) return false;
    return true;
  }).map((el) => ({ sel: el.id ? '#' + el.id : el.tagName, type: el.type }));
  const landmarks = [...document.querySelectorAll('main,nav,aside,header,footer,section[aria-label],[role="region"],[role="main"],[role="navigation"]')]
    .filter(vis).map((n) => ({ tag: n.tagName, id: n.id || null, label: n.getAttribute('aria-label') }));
  return { headings, unlabelledButtons, imgsNoAlt, svgNoTitle, liveRegions, inputsNoLabel,
    landmarkCount: landmarks.length, landmarks: landmarks.slice(0, 20),
    hasMain: Boolean(document.querySelector('main,[role="main"]')),
    htmlLang: document.documentElement.lang || null,
    title: document.title,
    skipLink: Boolean(document.querySelector('a[href^="#"].skip, .skip-link, [class*="skip"]')),
    canvasRole: (() => { const c = document.querySelector('#cesiumContainer canvas'); return c ? { role: c.getAttribute('role'), label: c.getAttribute('aria-label'), tabindex: c.getAttribute('tabindex') } : null; })(),
  };
});

// ---- 5. CONTRAST: declared chain ----
const contrast = await page.evaluate(() => {
  const lum = (rgb) => { const [r,g,b] = rgb.map((v)=>{const c=v/255; return c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4;}); return 0.2126*r+0.7152*g+0.0722*b; };
  const ratio = (a,b) => { const [hi,lo] = [lum(a),lum(b)].sort((x,y)=>y-x); return (hi+0.05)/(lo+0.05); };
  const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return { rgb: p.slice(0,3), a: p.length>3?p[3]:1 }; };
  const over = (fg, bg) => fg.rgb.map((c,i)=> c*fg.a + bg[i]*(1-fg.a));
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  let node;
  while ((node = walker.nextNode())) {
    const t = (node.nodeValue || '').trim();
    if (!t) continue;
    const el = node.parentElement;
    if (!el || seen.has(el)) continue; seen.add(el);
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    if (!(r.width>0 && r.height>0)) continue;
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity < 0.1) continue;
    if (!(r.left < innerWidth && r.right > 0 && r.top < innerHeight && r.bottom > 0)) continue;
    if (el.closest('[hidden]')) continue;
    const fg = parse(cs.color); if (!fg) continue;
    // walk up compositing declared backgrounds
    let bg = null; let n = el; const chain = [];
    let acc = null; // resolved background from top down
    const layers = [];
    while (n) { const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) { layers.push({ node: n.id ? '#'+n.id : n.tagName, c }); if (c.a >= 0.999) break; }
      n = n.parentElement; }
    let base = [0,0,0]; // page root fallback
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i].c, base);
    bg = base;
    const fs = parseFloat(cs.fontSize); const fw = cs.fontWeight;
    const large = fs >= 24 || (fs >= 18.66 && (+fw >= 700 || fw === 'bold'));
    const cr = ratio(over(fg, bg), bg);
    out.push({
      sel: el.id ? '#'+el.id : el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.'+el.className.trim().split(/\s+/).slice(0,2).join('.') : ''),
      text: t.slice(0, 40), fontSize: +fs.toFixed(1), weight: fw, large,
      color: cs.color, bgChain: layers.map((l)=>l.node+':'+ (l.c.a<1? `a${l.c.a}`:'opaque')).join('>') || 'NONE(canvas)',
      opaqueBackdrop: layers.some((l)=>l.c.a>=0.999),
      ratio: +cr.toFixed(2), pass: cr >= (large ? 3 : 4.5),
      x: +(r.x + r.width/2).toFixed(0), y: +(r.y + r.height/2).toFixed(0),
      rect: { x:+r.x.toFixed(0), y:+r.y.toFixed(0), w:+r.width.toFixed(0), h:+r.height.toFixed(0) },
    });
  }
  return out.sort((a,b)=>a.ratio-b.ratio);
});

try { await page.screenshot({ path: '/tmp/ui-accessibilite-vglobe.png' }); } catch (e) { console.log('shot fail', e.message); }

fs.writeFileSync('/tmp/ui-a11y-1.json', JSON.stringify({ tabWalk, loopedAt, focusDiff, targets, aria, contrast, errors }, null, 2));
console.log('tabWalk steps:', tabWalk.length, 'loopedAt:', JSON.stringify(loopedAt));
console.log('focusable visible:', focusDiff.length, 'no visual change on focus:', focusDiff.filter(f=>f.changed.length===0).length);
console.log('targets:', targets.length, '<24px min:', targets.filter(t=>t.min<24).length, '<44px min:', targets.filter(t=>t.min<44).length);
console.log('text nodes measured:', contrast.length, 'fail AA (declared bg):', contrast.filter(c=>!c.pass).length, 'no opaque backdrop:', contrast.filter(c=>!c.opaqueBackdrop).length);
console.log('pageerrors:', errors.length);
await browser.close();
