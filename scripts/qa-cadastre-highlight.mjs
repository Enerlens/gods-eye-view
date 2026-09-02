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
 *   v.   the highlight drapes onto the SAME classification surface as the
 *        batch under it — a primitive that classifies the wrong one draws
 *        nothing at all, and nothing on screen tells that apart from a layer
 *        that fetched nothing
 *   vi.  deselecting takes the highlight away
 *
 * Screenshots are written under the gitignored `qa-shots/cadastre-highlight/`.
 *
 * Run: node scripts/qa-cadastre-highlight.mjs --url http://localhost:4173
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { newQaPage } from './lib/qa-first-run.mjs';
import { pointInRing } from '../src/data/ringGeometry.js';
import { CADASTRE_SCALE_BANDS } from '../src/data/cadastreFeed.js';

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
/**
 * How much ground around the parcel the comparison reads.
 *
 * Bleed is the whole point of check ii, so the window has to reach past the
 * parcel — a pixel outside it is never read, and a highlight spilling onto the
 * neighbour would score as a clean MISS instead of as a spill. Measured on this
 * run, 40 px is 7.5 m of ground at the nadir park and 15 m at the oblique one,
 * both comfortably past the 1.5 m the spill is judged against.
 */
const WINDOW_PAD_PX = 40;
/**
 * The most fill primitives a correct draw can hold: one per band COLOUR, and
 * the colours are the four scale bands plus the unknown one — five, not six.
 * Read off the band table itself so a fifth scale band moves this with it.
 */
const MAX_FILL_PRIMITIVES = CADASTRE_SCALE_BANDS.length + 1;

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

/**
 * Wait for something the PAGE can answer.
 *
 * `args` are forwarded to `page.evaluate`, so a predicate takes the IDU it is
 * looking for rather than closing over a copy of it: a second hardcoded
 * `64547000AN0512` in here is a full 120 s timeout the day `PARCEL` moves.
 */
async function poll(page, fn, label, args = [], timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await page.evaluate(fn, ...args);
    if (value) return value;
    await pump(page, 2, 60);
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** The canvas as raw RGBA, in the shape `isHighlightPixel` reads. */
async function grabPixels(page) {
  // Puppeteer answers a Uint8Array; sharp wants a Buffer.
  const shot = Buffer.from(await page.screenshot({ encoding: 'binary' }));
  const { data, info } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
  return { ...info, data };
}

/**
 * Wait for something only a SCREENSHOT can answer.
 *
 * The twin of {@link poll}, and separate from it only because its predicate
 * does not run in the page: readiness here is `isHighlightPixel` over a
 * captured frame, which is the very reading — same capture, same thresholds —
 * the measurement is then scored on. Waiting on any other signal would be
 * waiting for one thing and measuring another.
 */
async function pollPixels(page, ready, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (ready(await grabPixels(page))) return;
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

/**
 * Is this pixel ON the parcel?
 *
 * Inside one of its PARTS and outside that part's courtyards — the same
 * even-odd rule `pointInPolygons` applies to lon/lat, run here on screen
 * coordinates, which `pointInRing` is happy to take because it is pure
 * two-dimensional arithmetic with no idea what its axes mean.
 *
 * Both halves matter the moment this harness is retargeted at a new report,
 * which is what it is for. A multi-part parcel measured against its first ring
 * alone counts every pixel of parts 2..n as bleed; a parcel with a courtyard
 * counts the courtyard as uncovered. `PARCEL` today is single-part and
 * hole-free, so neither would show up as anything but a green run.
 */
function onParcel(x, y, parts) {
  for (const part of parts) {
    if (!pointInRing(x, y, part[0])) continue;
    let inHole = false;
    for (let hole = 1; hole < part.length; hole += 1) {
      if (pointInRing(x, y, part[hole])) { inHole = true; break; }
    }
    if (!inHole) return true;
  }
  return false;
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

/** Shortest distance to ANY of the parcel's rings, outer or courtyard. */
function distanceToParcel(x, y, parts) {
  let best = Infinity;
  for (const part of parts) {
    for (const ring of part) best = Math.min(best, distanceToRing(x, y, ring));
  }
  return best;
}

/**
 * The parcel's rings as the camera sees them: `[lon, lat, x, y]` per vertex.
 *
 * The projection is done by the PAGE through the LIVE camera, so the comparison
 * never depends on this harness reproducing Cesium's projection — only on it
 * reading the same pixels the operator sees. Ground and screen coordinates come
 * back together because the metres-per-pixel scale below needs the ground
 * length of the very edge it measures on screen.
 */
async function projectParcel(page, label) {
  // The `drawn` flag rides back separately so a parcel the layer is not holding
  // fails BY NAME here, rather than as a `TypeError` on a null two lines down.
  const projected = await page.evaluate((idu) => {
    const gev = window.__godsEyeView;
    const scene = gev.viewer.scene;
    const layer = gev.dataManager.layers.get('cadastre-fr').module;
    const polygons = layer.getParcelPolygonsForQa?.(idu);
    if (!polygons) return { drawn: false, parts: [] };
    const d2r = Math.PI / 180;
    const ellipsoid = scene.globe.ellipsoid;
    return {
      drawn: true,
      parts: polygons.map((part) => part.map((ring) => ring.map(([lon, lat]) => {
        const height = scene.globe.getHeight({ longitude: lon * d2r, latitude: lat * d2r, height: 0 }) || 0;
        const cartesian = ellipsoid.cartographicToCartesian({
          longitude: lon * d2r, latitude: lat * d2r, height,
        });
        const window_ = scene.cartesianToCanvasCoordinates(cartesian);
        return window_ ? [lon, lat, window_.x, window_.y] : null;
      }))),
    };
  }, PARCEL.idu);
  if (!projected?.drawn) {
    throw new Error(`${label}: the layer is not holding ${PARCEL.idu}, so there is nothing to measure against`);
  }
  const { parts } = projected;
  if (!parts.length) throw new Error(`${label}: ${PARCEL.idu} is drawn with no rings at all`);

  // A vertex the camera cannot see comes back null. Dropping it would quietly
  // reshape the reference polygon and then score the pixels against a shape the
  // layer never drew — a distorted oracle reads as a layer bug and sends the
  // next person to the wrong file. Fail on the spot instead.
  const lost = parts.reduce((total, part) => total + part.reduce(
    (count, ring) => count + ring.filter((vertex) => !vertex).length, 0,
  ), 0);
  if (lost) throw new Error(`${label}: ${lost} of ${PARCEL.idu}'s vertices would not project`);
  return parts;
}

/**
 * Metres per pixel, from the LONGEST projected edge against the ground distance
 * that same edge covers — no camera maths repeated here.
 *
 * The longest edge and not an arbitrary chord: the ratio is a division by a
 * screen length, so the shortest edges carry the anti-aliased endpoint error
 * of a pixel or two as tens of percent, and the longest carries it as noise.
 */
function metresPerPixel(parts) {
  let longestPx = 0;
  let metres = 0;
  for (const part of parts) {
    for (const ring of part) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const [aLon, aLat, ax, ay] = ring[j];
        const [bLon, bLat, bx, by] = ring[i];
        const span = Math.hypot(bx - ax, by - ay);
        if (span <= longestPx) continue;
        longestPx = span;
        metres = Math.hypot(
          (bLon - aLon) * 111_320 * Math.cos(aLat * (Math.PI / 180)),
          (bLat - aLat) * 111_132,
        );
      }
    }
  }
  return longestPx ? metres / longestPx : 0;
}

/** The padded screen box the comparison runs over. */
function measurementWindow(parts, clip) {
  const xs = [];
  const ys = [];
  for (const part of parts) {
    for (const ring of part) for (const vertex of ring) { xs.push(vertex[2]); ys.push(vertex[3]); }
  }
  return {
    x0: Math.max(0, Math.floor(Math.min(...xs)) - WINDOW_PAD_PX),
    x1: Math.min(clip.width - 1, Math.ceil(Math.max(...xs)) + WINDOW_PAD_PX),
    y0: Math.max(0, Math.floor(Math.min(...ys)) - WINDOW_PAD_PX),
    y1: Math.min(clip.height - 1, Math.ceil(Math.max(...ys)) + WINDOW_PAD_PX),
  };
}

/** How many cyan pixels the window holds. */
function countHighlight(pixels, box) {
  let total = 0;
  for (let y = box.y0; y <= box.y1; y += 1) {
    for (let x = box.x0; x <= box.x1; x += 1) if (isHighlightPixel(pixels, x, y)) total += 1;
  }
  return total;
}

/**
 * Where the highlight actually landed, and where it should have.
 */
async function measureHighlight(page, label) {
  const clip = await page.evaluate(() => {
    const canvas = window.__godsEyeView.viewer.scene.canvas;
    return { width: canvas.clientWidth, height: canvas.clientHeight };
  });

  // Wait for the highlight to be DRAWN before scoring it. A fixed pump was a
  // bet on the machine: a ground primitive still tessellating is simply not on
  // screen yet, and measuring then reports IoU 0.000 — a red no operator can
  // tell from the wedge-shaped regression this harness exists to catch. The
  // readiness signal is the pixels themselves, which is also the only thing
  // this harness trusts anywhere else.
  const waitBox = measurementWindow(await projectParcel(page, label), clip);
  await pollPixels(
    page,
    (frame) => countHighlight(frame, waitBox) > 0,
    `${label}: the highlight to reach the screen`,
  );

  // Projected again, with nothing pumped between it and the frame it is scored
  // against: the frames drawn while waiting can resolve a terrain tile and move
  // the ground the rings are clamped to.
  const parts = await projectParcel(page, label);
  const screen = parts.map((part) => part.map((ring) => ring.map(([, , x, y]) => [x, y])));
  const scale = metresPerPixel(parts);
  const box = measurementWindow(parts, clip);
  const pixels = await grabPixels(page);

  let both = 0;
  let onlyHighlight = 0;
  let onlyPolygon = 0;
  let worstBleedPx = 0;
  let worstBleedAt = null;
  const bleeds = [];
  for (let y = box.y0; y <= box.y1; y += 1) {
    for (let x = box.x0; x <= box.x1; x += 1) {
      const highlighted = isHighlightPixel(pixels, x, y);
      const inside = onParcel(x + 0.5, y + 0.5, screen);
      if (highlighted && inside) both += 1;
      else if (highlighted) {
        onlyHighlight += 1;
        const away = distanceToParcel(x + 0.5, y + 0.5, screen);
        bleeds.push(away);
        if (away > worstBleedPx) { worstBleedPx = away; worstBleedAt = [x, y]; }
      } else if (inside) onlyPolygon += 1;
    }
  }
  const union = both + onlyHighlight + onlyPolygon;
  // A PERCENTILE, not the maximum. The window deliberately reads 40 px of
  // ground past the parcel, and that ground is orthophoto: one cyan-ish pixel
  // in it — a swimming pool, a painted court — is enough to fail a run whose
  // highlight is perfect, because a single pixel IS the maximum. Nothing in
  // this scene is currently that colour, which is exactly why the gate must not
  // rest on it staying that way. A correct highlight here bleeds 0.10 m at the
  // 99th percentile and 0.11 m at worst — 0.6 px of anti-aliased rim over 248
  // pixels — while the wedge this check exists for is thousands of pixels and
  // tens of metres out, and moves a percentile as loudly as it moves a maximum.
  // The maximum stays in the printed detail, where a surprise is worth reading
  // and not worth failing on.
  bleeds.sort((a, b) => a - b);
  const bleedP99Px = bleeds.length
    ? bleeds[Math.min(bleeds.length - 1, Math.floor(bleeds.length * 0.99))]
    : 0;
  return {
    iou: union ? both / union : 0,
    covered: both + onlyPolygon ? both / (both + onlyPolygon) : 0,
    bleedM: bleedP99Px * scale,
    worstBleedM: worstBleedPx * scale,
    bleedAt: worstBleedAt,
    bleedPx: bleeds.length,
    highlightPx: both + onlyHighlight,
    polygonPx: both + onlyPolygon,
    // Printed with the bleed, because "0.11 m outside" says nothing until you
    // know what one pixel is worth at the range the camera is parked at.
    metresPerPixel: scale,
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
    await poll(page, (idu) => {
      const layer = window.__godsEyeView.dataManager.layers.get('cadastre-fr')?.module;
      return (layer?.getDrawnParcels?.() || []).some((record) => record.idu === idu);
    }, 'the parcel to be drawn', [PARCEL.idu]);
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
      `p99 ${nadir.bleedM.toFixed(2)} m outside over ${nadir.bleedPx} px (ceiling ${MAX_BLEED_M} m), `
      + `worst ${nadir.worstBleedM.toFixed(2)} m at ${JSON.stringify(nadir.bleedAt)}, `
      + `1 px = ${nadir.metresPerPixel.toFixed(3)} m`,
    );

    await park(page, { pitchDeg: -35, rangeM: 420 });
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
      `p99 ${oblique.bleedM.toFixed(2)} m outside over ${oblique.bleedPx} px, `
      + `worst ${oblique.worstBleedM.toFixed(2)} m at ${JSON.stringify(oblique.bleedAt)}, `
      + `1 px = ${oblique.metresPerPixel.toFixed(3)} m`,
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
    // At MOST one primitive per colour, not exactly one. A colour bucket can
    // legitimately come out empty: `ringPositions` refuses a ring of fewer than
    // three points, so a band whose parcels are all unbuildable keeps its
    // records — and therefore its colour in `getDrawnParcels()` — while holding
    // no primitive at all. `cadastreParcels.test.mjs` pins that as intended, in
    // "a parcel whose rings cannot be built costs a primitive, not the draw".
    // The regression being gated is fills climbing toward `records`, and `<=`
    // catches that just as flatly as `===` would.
    check(
      'the fills are batched by band colour, not one primitive per parcel',
      shape.fills <= bands && shape.fills <= MAX_FILL_PRIMITIVES,
      `${shape.fills} fill primitive(s) for ${bands} band colour(s) over ${shape.records} parcels `
      + `(ceiling ${MAX_FILL_PRIMITIVES})`,
    );
    check(
      'the selection is drawn as its own pair of primitives',
      shape.selectedFill === true && shape.selectedOutline === true,
      `fill ${shape.selectedFill}, outline ${shape.selectedOutline}`,
    );

    // v. the highlight and the batch drape onto the same surface.
    //
    // Read off the SCENE and not off the layer, which holds one classification
    // for everything it builds and would therefore agree with itself whatever
    // the primitives on screen actually carry. The layer's own instance ids say
    // which primitives are the cadastre's, and the selection is the pair whose
    // instances are ALL the selected parcel — Cesium drops `geometryInstances`
    // the frame a primitive becomes ready, so the ids are read off the id list
    // it keeps for `getGeometryInstanceAttributes` instead.
    const surfaces = await page.evaluate((idu) => {
      const scene = window.__godsEyeView.viewer.scene;
      const out = [];
      for (let i = 0; i < scene.primitives.length; i += 1) {
        const primitive = scene.primitives.get(i);
        const ids = primitive?._primitive?._primitive?._instanceIds
          || primitive?._primitive?._instanceIds
          || primitive?._instanceIds;
        if (!Array.isArray(ids) || !ids.length) continue;
        if (!String(ids[0]).startsWith('cadastre:')) continue;
        out.push({
          classification: primitive.classificationType,
          selection: ids.every((id) => id === `cadastre:${idu}`),
          instances: ids.length,
        });
      }
      return out;
    }, PARCEL.idu);
    const batch = surfaces.filter((primitive) => !primitive.selection);
    const selection = surfaces.filter((primitive) => primitive.selection);
    const batchSurfaces = new Set(batch.map((primitive) => primitive.classification));
    const selectionSurfaces = new Set(selection.map((primitive) => primitive.classification));
    check(
      'the highlight classifies the same surface as the batch under it',
      selection.length === 2 && batchSurfaces.size === 1 && selectionSurfaces.size === 1
        && [...selectionSurfaces][0] === [...batchSurfaces][0]
        && [...batchSurfaces][0] === shape.classification,
      `${batch.length} batch primitive(s) on [${[...batchSurfaces]}], `
      + `${selection.length} selection primitive(s) on [${[...selectionSurfaces]}], `
      + `layer says ${shape.classification}`,
    );

    // vi. deselecting takes it away.
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
