#!/usr/bin/env node
/**
 * Deterministic browser proof that the selected parcel's highlight covers the
 * parcel — the whole parcel, and nothing but the parcel.
 *
 * WHY THIS HARNESS EXISTS. A batched `GroundPrimitive` does not colour a ground
 * pixel by the polygon that contains it. Cesium classifies the entire batch in
 * ONE stencil pass, which only records "some instance in this batch covers this
 * pixel"; the colour pass then keeps the first instance whose kilometres-tall
 * shadow volume rasterises over the pixel and whose own AXIS-ALIGNED BOUNDING
 * RECTANGLE contains it (`ShadowVolumeAppearanceFS.glsl`, `CULL_FRAGMENTS`).
 * Parcel bounding rectangles overlap their neighbours' constantly, so inside a
 * single batch neighbours repaint each other along rectangle edges.
 *
 * That is invisible while every instance in a batch shares one colour, and
 * glaring the moment one differs. Selection used to differ: it recoloured the
 * clicked instance in place, and the highlight came out as a wedge whose cuts
 * were the NEIGHBOUR's bounding-box edges — on a parcel whose outline, drawn
 * beside it by a polyline primitive that has no such rule, was perfectly
 * correct. Reported over Ustaritz on 2026-09-02, parcel AN 0512: the two cuts
 * through the highlight sat on AN 0511's east and north bbox edges to within a
 * pixel, and 41% of the parcel was filled.
 *
 * No unit test can see this. The geometry handed to Cesium was right, the
 * record was right, the card was right; only the pixels were wrong. So the
 * check is on pixels:
 *
 *   i.   the highlight's PIXELS match the parcel's own polygon, projected
 *        independently through the camera — intersection over union ≥ 0.90
 *   ii.  it does not bleed onto the neighbours: no highlight pixel sits more
 *        than a hair outside the polygon
 *   iii. it holds from an OBLIQUE camera too, which is where the shadow volume
 *        smears furthest across the screen and where the bug was reported
 *   iv.  the fills are batched by colour rather than one primitive per parcel —
 *        the regression that would fix the pixels and cost the frame rate
 *   v.   deselecting takes the highlight away
 *
 * Screenshots are written under the gitignored `qa-shots/cadastre-highlight/`.
 *
 * Run: node scripts/qa-cadastre-highlight.mjs --url http://localhost:4173
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'cadastre-highlight');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = option('--url', process.env.QA_BASE_URL || 'http://localhost:4173');
const HEADFUL = args.includes('--headful');

/**
 * Ustaritz, Pyrénées-Atlantiques — parcel AN 0512, the one the bug was reported
 * on. A seven-sided plot at a street corner, wedged between neighbours whose
 * bounding boxes overlap it on two sides, which is exactly the arrangement the
 * batched draw got wrong.
 */
const PARCEL = { idu: '64547000AN0512', lon: -1.453655, lat: 43.394475 };
/** IoU floor. Anti-aliasing and the 1.2 px outline cost a few percent honestly. */
const MIN_IOU = 0.9;
/** How far outside the polygon a highlight pixel may sit, in metres. */
const MAX_BLEED_M = 1.5;

const chromeCandidates = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  (() => { try { return puppeteer.executablePath(); } catch { return null; } })(),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean);
const chrome = chromeCandidates.find((candidate) => {
  try { return fs.existsSync(candidate); } catch { return false; }
});

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${detail ? ` — ${detail}` : ''}`);
}

/**
 * Draw frames by hand. The render governor runs in `requestRenderMode`, so
 * nothing repaints on its own and a classification primitive that is still
 * tessellating never becomes ready.
 */
async function pump(page, frames = 8, gapMs = 100) {
  for (let frame = 0; frame < frames; frame += 1) {
    await page.evaluate(() => { try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled */ } });
    await sleep(gapMs);
  }
}

async function poll(page, fn, label, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await page.evaluate(fn);
    if (value) return value;
    await pump(page, 2, 60);
  }
  throw new Error(`timed out waiting for ${label}`);
}

/**
 * Park the camera, nadir or oblique.
 *
 * The boot fly-to resumes under a hand-pumped render loop, so this is called
 * more than once and always after `cancelFlight`.
 */
async function park(page, { pitchDeg = -90, rangeM = 260 } = {}) {
  await page.evaluate((lon, lat, pitch, range) => {
    const gev = window.__godsEyeView;
    const scene = gev.viewer.scene;
    const ellipsoid = scene.globe?.ellipsoid || scene.ellipsoid;
    const d2r = Math.PI / 180;
    try { gev.viewer.camera.cancelFlight(); } catch { /* no flight active */ }
    const ground = scene.globe?.getHeight?.({ longitude: lon * d2r, latitude: lat * d2r, height: 0 }) || 0;
    const up = range * Math.sin(-pitch * d2r);
    const back = range * Math.cos(-pitch * d2r);
    gev.viewer.camera.setView({
      destination: ellipsoid.cartographicToCartesian({
        longitude: lon * d2r,
        latitude: (lat - back / 111_320) * d2r,
        height: ground + up,
      }),
      orientation: { heading: 0, pitch: pitch * d2r, roll: 0 },
    });
    scene.requestRender?.();
  }, PARCEL.lon, PARCEL.lat, pitchDeg, rangeM);
  await pump(page, 8, 110);
}

/** Point-in-ring, on screen coordinates. */
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Shortest distance from a point to a closed ring, in pixels. */
function distanceToRing(x, y, ring) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const dx = xj - xi;
    const dy = yj - yi;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - xi) * dx + (y - yi) * dy) / lengthSquared));
    best = Math.min(best, Math.hypot(x - (xi + t * dx), y - (yi + t * dy)));
  }
  return best;
}

/**
 * Where the highlight actually landed, and where it should have.
 *
 * The polygon is projected through the LIVE camera by the page itself, so the
 * comparison never depends on this harness reproducing Cesium's projection —
 * only on it reading the same pixels the operator sees.
 */
async function measureHighlight(page, label) {
  const projected = await page.evaluate((idu) => {
    const gev = window.__godsEyeView;
    const scene = gev.viewer.scene;
    const layer = gev.dataManager.layers.get('cadastre-fr').module;
    const polygons = layer.getSelectedParcelPolygonsForQa?.(idu);
    if (!polygons) return null;
    const d2r = Math.PI / 180;
    const ellipsoid = scene.globe.ellipsoid;
    return polygons.map((polygon) => polygon.map((ring) => ring.map(([lon, lat]) => {
      const height = scene.globe.getHeight({ longitude: lon * d2r, latitude: lat * d2r, height: 0 }) || 0;
      const cartesian = ellipsoid.cartographicToCartesian({
        longitude: lon * d2r, latitude: lat * d2r, height,
      });
      const window_ = scene.cartesianToCanvasCoordinates(cartesian);
      return window_ ? [window_.x, window_.y] : null;
    }).filter(Boolean)));
  }, PARCEL.idu);
  if (!projected?.length) throw new Error(`${label}: the page would not project the parcel`);
  const ring = projected[0][0];

  // Metres per pixel, from the projected ring's own longest edge against the
  // ground distance the same edge covers — no camera maths repeated here.
  const scale = await page.evaluate((idu) => {
    const gev = window.__godsEyeView;
    const scene = gev.viewer.scene;
    const layer = gev.dataManager.layers.get('cadastre-fr').module;
    const ring2 = layer.getSelectedParcelPolygonsForQa(idu)[0][0];
    const d2r = Math.PI / 180;
    const ellipsoid = scene.globe.ellipsoid;
    const [aLon, aLat] = ring2[0];
    const [bLon, bLat] = ring2[Math.floor(ring2.length / 2)];
    const toWindow = (lon, lat) => {
      const height = scene.globe.getHeight({ longitude: lon * d2r, latitude: lat * d2r, height: 0 }) || 0;
      return scene.cartesianToCanvasCoordinates(
        ellipsoid.cartographicToCartesian({ longitude: lon * d2r, latitude: lat * d2r, height }),
      );
    };
    const a = toWindow(aLon, aLat);
    const b = toWindow(bLon, bLat);
    const metres = Math.hypot(
      (bLon - aLon) * 111_320 * Math.cos(aLat * d2r),
      (bLat - aLat) * 111_132,
    );
    return metres / Math.hypot(b.x - a.x, b.y - a.y);
  }, PARCEL.idu);

  const clip = await page.evaluate(() => {
    const canvas = window.__godsEyeView.viewer.scene.canvas;
    return { width: canvas.clientWidth, height: canvas.clientHeight };
  });

  // Puppeteer answers a Uint8Array; the reader below wants Buffer's readers.
  const buffer = Buffer.from(await page.screenshot({ encoding: 'binary' }));
  const pixels = decodePng(buffer);
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)) - 40);
  const x1 = Math.min(clip.width - 1, Math.ceil(Math.max(...xs)) + 40);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)) - 40);
  const y1 = Math.min(clip.height - 1, Math.ceil(Math.max(...ys)) + 40);

  let both = 0;
  let onlyHighlight = 0;
  let onlyPolygon = 0;
  let worstBleedPx = 0;
  let worstBleedAt = null;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const highlighted = isHighlightPixel(pixels, x, y);
      const inside = inRing(x + 0.5, y + 0.5, ring);
      if (highlighted && inside) both += 1;
      else if (highlighted) {
        onlyHighlight += 1;
        const away = distanceToRing(x + 0.5, y + 0.5, ring);
        if (away > worstBleedPx) { worstBleedPx = away; worstBleedAt = [x, y]; }
      } else if (inside) onlyPolygon += 1;
    }
  }
  const union = both + onlyHighlight + onlyPolygon;
  return {
    iou: union ? both / union : 0,
    covered: both + onlyPolygon ? both / (both + onlyPolygon) : 0,
    bleedM: worstBleedPx * scale,
    bleedAt: worstBleedAt,
    highlightPx: both + onlyHighlight,
    polygonPx: both + onlyPolygon,
  };
}

/**
 * Is this pixel the cyan highlight?
 *
 * `#00ffff` composited over anything keeps green and blue equal and both far
 * above red. Loosening any of the three thresholds picks up OSM's own mint
 * greens — the sports pitch south of this parcel reads (147, 232, 213), which
 * a "g and b are high, r is lowish" test accepts and this one rejects on the
 * blue-minus-red margin.
 */
function isHighlightPixel({ width, channels, data }, x, y) {
  const i = (y * width + x) * channels;
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  return g - r >= 80 && b - r >= 80 && Math.abs(g - b) <= 25;
}

/** A minimal 8-bit PNG reader, so the harness needs no image dependency. */
function decodePng(buffer) {
  const zlib = require('node:zlib');
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (pos < buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.toString('ascii', pos + 4, pos + 8);
    const body = buffer.subarray(pos + 8, pos + 8 + length);
    pos += 12 + length;
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colorType = body[9];
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
  }
  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported PNG colour type ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let previous = Buffer.alloc(stride);
  let read = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[read];
    read += 1;
    const line = Buffer.from(raw.subarray(read, read + stride));
    read += stride;
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = previous[i];
      const c = i >= channels ? previous[i - channels] : 0;
      if (filter === 1) line[i] = (line[i] + a) & 255;
      else if (filter === 2) line[i] = (line[i] + b) & 255;
      else if (filter === 3) line[i] = (line[i] + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    line.copy(out, y * stride);
    previous = line;
  }
  return { width, height, channels, data: out };
}

// `require` inside an ES module, for the one stdlib call decodePng needs.
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);

async function main() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: HEADFUL ? false : 'new',
    executablePath: chrome,
    protocolTimeout: 240_000,
    args: ['--no-sandbox', '--use-gl=angle', '--enable-unsafe-swiftshader', '--window-size=1600,1000'],
  });
  const page = await newQaPage(browser);
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  const consoleErrors = [];
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  try {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await poll(page, () => Boolean(window.__godsEyeView?.viewer), 'the viewer');
    // The boot fly-to keeps resuming under a hand-pumped loop; park repeatedly
    // until it has actually given up on its destination.
    for (let i = 0; i < 6; i += 1) await park(page);

    await page.evaluate(() => window.__godsEyeView.dataManager.setEnabled('cadastre-fr', true, { origin: 'qa' }));
    await park(page);
    await poll(page, () => {
      const layer = window.__godsEyeView.dataManager.layers.get('cadastre-fr')?.module;
      return (layer?.getDrawnParcels?.() || []).some((record) => record.idu === '64547000AN0512');
    }, 'the parcel to be drawn');
    await pump(page, 14);

    // The selected-parcel card is painted over the globe and would be counted
    // as missing highlight; it is the one piece of the app this harness hides.
    await page.evaluate(() => {
      const root = document.getElementById('world-overlay-root') || document.getElementById('world-overlay-canvas')?.parentElement;
      if (root) root.style.opacity = '0';
    });

    const selected = await page.evaluate((idu) => {
      const layer = window.__godsEyeView.dataManager.layers.get('cadastre-fr').module;
      const record = layer.getDrawnParcels().find((entry) => entry.idu === idu);
      if (!record) return false;
      const ok = layer.selectParcel(record.id);
      window.__godsEyeView.viewer.scene.requestRender();
      return ok;
    }, PARCEL.idu);
    check('the parcel selects', selected === true);
    await pump(page, 40, 110);

    const nadir = await measureHighlight(page, 'nadir');
    await page.screenshot({ path: path.join(SHOTS_DIR, 'nadir.png') });
    check(
      'nadir: the highlight matches the parcel polygon',
      nadir.iou >= MIN_IOU,
      `IoU ${nadir.iou.toFixed(3)} (floor ${MIN_IOU}), ${(nadir.covered * 100).toFixed(1)}% of the parcel covered`,
    );
    check(
      'nadir: the highlight does not bleed onto the neighbours',
      nadir.bleedM <= MAX_BLEED_M,
      `worst ${nadir.bleedM.toFixed(2)} m outside at ${JSON.stringify(nadir.bleedAt)} (ceiling ${MAX_BLEED_M} m)`,
    );

    await park(page, { pitchDeg: -35, rangeM: 420 });
    await pump(page, 30, 110);
    const oblique = await measureHighlight(page, 'oblique');
    await page.screenshot({ path: path.join(SHOTS_DIR, 'oblique.png') });
    check(
      'oblique: the highlight matches the parcel polygon',
      oblique.iou >= MIN_IOU,
      `IoU ${oblique.iou.toFixed(3)}, ${(oblique.covered * 100).toFixed(1)}% of the parcel covered`,
    );
    check(
      'oblique: the highlight does not bleed onto the neighbours',
      oblique.bleedM <= MAX_BLEED_M,
      `worst ${oblique.bleedM.toFixed(2)} m outside at ${JSON.stringify(oblique.bleedAt)}`,
    );

    // iv. batched by colour, not one primitive per parcel.
    const shape = await page.evaluate(() => {
      const layer = window.__godsEyeView.dataManager.layers.get('cadastre-fr').module;
      return layer.getPrimitiveShapeForQa();
    });
    const bands = new Set((await page.evaluate(() => {
      const layer = window.__godsEyeView.dataManager.layers.get('cadastre-fr').module;
      return layer.getDrawnParcels().map((record) => record.color);
    }))).size;
    check(
      'the fills are batched by band colour, not one primitive per parcel',
      shape.fills === bands && shape.fills <= 6,
      `${shape.fills} fill primitive(s) for ${bands} band colour(s) over ${shape.records} parcels`,
    );
    check(
      'the selection is drawn as its own pair of primitives',
      shape.selectedFill === true && shape.selectedOutline === true,
      `fill ${shape.selectedFill}, outline ${shape.selectedOutline}`,
    );

    // v. deselecting takes it away.
    await park(page);
    await pump(page, 20, 110);
    await page.evaluate(() => {
      window.__godsEyeView.dataManager.layers.get('cadastre-fr').module.selectParcel('cadastre:nobody');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      window.__godsEyeView.viewer.scene.requestRender();
    });
    await pump(page, 20, 110);
    const cleared = await page.evaluate(() => {
      const layer = window.__godsEyeView.dataManager.layers.get('cadastre-fr').module;
      return { selected: layer.getSelectedParcel(), shape: layer.getPrimitiveShapeForQa() };
    });
    check(
      'deselecting removes the highlight primitives',
      cleared.selected === null && cleared.shape.selectedFill === false && cleared.shape.selectedOutline === false,
      JSON.stringify(cleared.shape),
    );

    check('no uncaught page errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
  }

  const failed = checks.filter((entry) => !entry.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed · shots in ${path.relative(REPO_ROOT, SHOTS_DIR)}`);
  process.exitCode = failed.length ? 1 : 0;
}

await main();
