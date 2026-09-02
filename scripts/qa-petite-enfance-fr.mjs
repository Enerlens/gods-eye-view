#!/usr/bin/env node
/**
 * Deterministic browser proof that the childcare layer fills TERRITORIES —
 * the right ground, in the right colour, exactly once.
 *
 * WHY THIS HARNESS EXISTS. The layer used to draw its two local scales as dots
 * at each area's administrative centre, and the complaint that ended that was
 * not about styling: a coverage rate is a property of a territory, and a dot
 * put it on a coordinate that is a centroid — a field outside the seat commune
 * of a rural intercommunalité. What replaced it is ground classification, and
 * ground classification has two failure modes that no unit test can see:
 *
 *   · A batched `GroundPrimitive` does not colour a pixel by the polygon that
 *     contains it. Cesium classifies the whole batch in ONE stencil pass and
 *     then keeps the first instance whose shadow volume covers the pixel and
 *     whose own AXIS-ALIGNED BOUNDING RECTANGLE contains it
 *     (`ShadowVolumeAppearanceFS.glsl`, `CULL_FRAGMENTS`). Communes' bounding
 *     rectangles overlap constantly, so the moment one instance in a batch
 *     carries a different colour it is painted over its neighbours' boxes.
 *     One primitive per COLOUR is the rule; one primitive per territory would
 *     fix the pixels and cost the frame rate. Both are checked.
 *   · The two grains must TILE. A commune the CNAF publishes is cut out of its
 *     EPCI's wash, so every piece of ground carries exactly one number. Drawn
 *     twice, two translucent colours blend into a third that means nothing and
 *     a click returns whichever primitive Cesium reached first.
 *
 * So the checks are:
 *
 *   i.   the local regime draws ground, and only ground — no sprite survives
 *   ii.  the fills are batched by band colour, never one per territory
 *   iii. no ring is drawn twice: the EPCI wash and the commune cut-outs tile
 *   iv.  the PIXELS over a territory actually move toward its band colour when
 *        the layer is turned on — the end-to-end proof that the right ground
 *        got the right colour
 *   v.   clicking a territory selects it as its own pair of primitives, laid
 *        over the batch rather than recoloured inside it
 *   vi.  Escape puts it back
 *   vii. above the hand-over span the choropleth answers and no territory
 *        primitive is left behind
 *
 * Screenshots are written under the gitignored `qa-shots/petite-enfance-fr/`.
 *
 * Run: node scripts/qa-petite-enfance-fr.mjs --url http://localhost:4173
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { newQaPage } from './lib/qa-first-run.mjs';
import { pointInRing } from '../src/data/ringGeometry.js';
import { PE_BANDS } from '../src/data/petiteEnfanceFeed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'petite-enfance-fr');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = option('--url', process.env.QA_BASE_URL || 'http://localhost:4173');
const HEADFUL = args.includes('--headful');

/**
 * Lyon. The one city where every rule in this layer is exercised at once: the
 * Métropole is an EPCI, 9 of its communes are arrondissements municipaux the
 * CNAF publishes and `geo.api.gouv.fr` only answers on a second request, and
 * the ring of intercommunalités around it carries the wash the cut-outs are
 * cut out of.
 */
const CITY = { lon: 4.8357, lat: 45.764 };
/** Camera range for the commune grain — about a 0,3° span, well inside 0,45°. */
const CLOSE_RANGE_M = 45_000;
/** Camera range above the hand-over, where the choropleth answers. */
const WIDE_RANGE_M = 400_000;
/** The most fill primitives a correct draw can hold: one per band colour. */
const MAX_FILL_PRIMITIVES = PE_BANDS.length;
/** Pixels of a territory sampled for check iv. */
const MIN_SAMPLE_PX = 400;

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
async function pump(page, frames = 8, gapMs = 110) {
  for (let frame = 0; frame < frames; frame += 1) {
    await page.evaluate(() => { try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled */ } });
    await sleep(gapMs);
  }
}

async function poll(page, fn, label, args_ = [], timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await page.evaluate(fn, ...args_);
    if (value) return value;
    await pump(page, 2, 80);
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** Park the camera over Lyon at a given range, nadir. */
async function park(page, rangeM) {
  await page.evaluate((lon, lat, range) => {
    const gev = window.__godsEyeView;
    const scene = gev.viewer.scene;
    const ellipsoid = scene.globe?.ellipsoid || scene.ellipsoid;
    const d2r = Math.PI / 180;
    try { gev.viewer.camera.cancelFlight(); } catch { /* no flight active */ }
    gev.viewer.camera.setView({
      destination: ellipsoid.cartographicToCartesian({
        longitude: lon * d2r, latitude: lat * d2r, height: range,
      }),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    scene.requestRender?.();
  }, CITY.lon, CITY.lat, rangeM);
  await pump(page, 8, 120);
}

const territories = (page) => page.evaluate(() => window.__godsEyeView.dataManager
  .layers.get('petite-enfance-fr').module.getTerritoriesForQa());

/** The canvas as raw RGBA. */
async function grabPixels(page) {
  const shot = Buffer.from(await page.screenshot({ encoding: 'binary' }));
  const { data, info } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
  return { ...info, data };
}

/**
 * One territory's rings as the camera sees them, `[x, y]` per vertex.
 *
 * Projected by the PAGE through the LIVE camera, so the comparison never
 * depends on this harness reproducing Cesium's projection — only on it reading
 * the same pixels the operator sees.
 */
function projectTerritory(page, id) {
  return page.evaluate((wanted) => {
    const gev = window.__godsEyeView;
    const scene = gev.viewer.scene;
    const layer = gev.dataManager.layers.get('petite-enfance-fr').module;
    const record = layer.getTerritoriesForQa().territories.find((entry) => entry.id === wanted);
    if (!record) return null;
    const d2r = Math.PI / 180;
    const ellipsoid = scene.globe.ellipsoid;
    return record.parts.map((flat) => {
      const ring = [];
      for (let i = 0; i < flat.length; i += 2) {
        const height = scene.globe.getHeight({
          longitude: flat[i] * d2r, latitude: flat[i + 1] * d2r, height: 0,
        }) || 0;
        const window_ = scene.cartesianToCanvasCoordinates(ellipsoid.cartographicToCartesian({
          longitude: flat[i] * d2r, latitude: flat[i + 1] * d2r, height,
        }));
        if (!window_) return null;
        ring.push([window_.x, window_.y]);
      }
      return ring;
    }).filter(Boolean);
  }, id);
}

/** Mean red-minus-blue over the pixels inside a projected ring. */
function meanRedMinusBlue(frame, rings) {
  let total = 0;
  let count = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(frame.height - 1, Math.ceil(maxY)); y += 1) {
    for (let x = Math.max(0, Math.floor(minX)); x <= Math.min(frame.width - 1, Math.ceil(maxX)); x += 1) {
      if (!rings.some((ring) => pointInRing(x, y, ring))) continue;
      const i = (y * frame.width + x) * frame.channels;
      total += frame.data[i] - frame.data[i + 2];
      count += 1;
    }
  }
  return { mean: count ? total / count : null, count };
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
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await poll(page, () => Boolean(window.__godsEyeView?.viewer), 'the viewer');
    // The boot fly-to keeps resuming under a hand-pumped loop; park repeatedly
    // until it has actually given up on its destination.
    for (let i = 0; i < 6; i += 1) await park(page, CLOSE_RANGE_M);

    // iv-a. the ground BEFORE the layer is on, for the same pixels.
    const before = await grabPixels(page);

    await page.evaluate(() => window.__godsEyeView.dataManager.setEnabled('petite-enfance-fr', true, { origin: 'qa' }));
    await park(page, CLOSE_RANGE_M);
    const drawn = await poll(page, () => {
      const layer = window.__godsEyeView.dataManager.layers.get('petite-enfance-fr')?.module;
      const state = layer?.getTerritoriesForQa?.();
      return state?.regime === 'local' && state.territories.length > 0 ? state.territories.length : 0;
    }, 'the territories to be drawn');
    await pump(page, 16);
    await page.screenshot({ path: path.join(SHOTS_DIR, 'territories.png') });

    const state = await territories(page);
    const communes = state.territories.filter((entry) => entry.scale === 'com');
    const epci = state.territories.filter((entry) => entry.scale === 'epci');
    check(
      'both grains are drawn over a metropolis',
      communes.length > 0 && epci.length > 0,
      `${epci.length} intercommunalités, ${communes.length} communes (${drawn} territories)`,
    );

    // i. ground only. Every primitive holding one of this layer's instance ids
    //    must be a ground-classified one; a sprite collection would mean the
    //    dots came back.
    const kinds = await page.evaluate(() => {
      const scene = window.__godsEyeView.viewer.scene;
      const out = [];
      for (let i = 0; i < scene.primitives.length; i += 1) {
        const primitive = scene.primitives.get(i);
        const ids = primitive?._primitive?._primitive?._instanceIds
          || primitive?._primitive?._instanceIds
          || primitive?._instanceIds;
        if (!Array.isArray(ids) || !ids.length) continue;
        if (!/^(?:epci|com):/.test(String(ids[0]))) continue;
        out.push({ kind: primitive.constructor?.name, instances: ids.length });
      }
      return out;
    });
    check(
      'the layer draws ground classification and no sprite at all',
      kinds.length > 0 && kinds.every((entry) => /^Ground(Primitive|PolylinePrimitive)$/.test(entry.kind)),
      kinds.map((entry) => `${entry.kind}×${entry.instances}`).join(', ') || 'nothing found',
    );

    // ii. batched by colour.
    const colours = new Set(state.territories.map((entry) => `${entry.color}|${entry.alpha}`));
    check(
      'the fills are batched by band colour, not one primitive per territory',
      state.fills <= colours.size && state.fills <= MAX_FILL_PRIMITIVES,
      `${state.fills} fill primitive(s) for ${colours.size} colour(s) over ${state.territories.length} territories `
      + `(ceiling ${MAX_FILL_PRIMITIVES})`,
    );

    // iii. the two grains tile: no ring is drawn twice.
    const seen = new Map();
    let duplicates = 0;
    for (const entry of state.territories) {
      for (const part of entry.parts) {
        const key = `${part.length}:${part[0]},${part[1]},${part[2]},${part[3]}`;
        if (seen.has(key)) duplicates += 1;
        else seen.set(key, entry.id);
      }
    }
    check(
      'the EPCI wash and the commune cut-outs tile without overlapping',
      duplicates === 0,
      `${seen.size} rings drawn, ${duplicates} drawn twice`,
    );

    // iv-b. the pixels over one territory move toward its band colour.
    //
    // A commune, and the biggest one on screen so the sample is large: the
    // diverging ramp is orange below the national rate and blue above it, so
    // red-minus-blue has a SIGN that says which half of the ramp painted this
    // ground — and that is exactly what a bounding-rectangle repaint would get
    // wrong on a neighbour whose band differs.
    const target = communes
      .map((entry) => ({ entry, size: entry.parts.reduce((total, part) => total + part.length, 0) }))
      .sort((a, b) => b.size - a.size)[0]?.entry;
    if (!target) throw new Error('no commune territory to sample');
    const rings = await projectTerritory(page, target.id);
    const after = await grabPixels(page);
    const beforeMean = meanRedMinusBlue(before, rings);
    const afterMean = meanRedMinusBlue(after, rings);
    const wanted = Number.parseInt(target.color.slice(1, 3), 16)
      - Number.parseInt(target.color.slice(5, 7), 16);
    const shift = afterMean.mean - beforeMean.mean;
    check(
      'the ground under a territory takes that territory’s own band colour',
      afterMean.count >= MIN_SAMPLE_PX && Math.sign(shift) === Math.sign(wanted) && Math.abs(shift) > 3,
      `${target.code} (${target.band}, ${target.color}): red−blue moved ${shift.toFixed(1)} `
      + `over ${afterMean.count} px, band wants ${wanted > 0 ? '+' : ''}${wanted}`,
    );

    // v. selection is its own pair of primitives.
    const selected = await page.evaluate((id) => {
      const gev = window.__godsEyeView;
      gev.dataManager.layers.get('petite-enfance-fr').module.selectAreaForQa(id);
      gev.viewer.scene.requestRender();
      return true;
    }, target.id);
    await pump(page, 14);
    const afterSelect = await territories(page);
    await page.screenshot({ path: path.join(SHOTS_DIR, 'selected.png') });
    check(
      'a clicked territory is highlighted by primitives of its own, not by a recolour',
      selected && afterSelect.selected === target.id
        && afterSelect.selectionPrimitives === 2
        && afterSelect.fills === state.fills,
      `selected ${afterSelect.selected}, ${afterSelect.selectionPrimitives} selection primitive(s), `
      + `${afterSelect.fills} fill primitive(s) (was ${state.fills})`,
    );

    // vi. Escape puts it back.
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      window.__godsEyeView.viewer.scene.requestRender();
    });
    await pump(page, 12);
    const afterEscape = await territories(page);
    check(
      'Escape takes the highlight away and leaves the batch alone',
      afterEscape.selected === null && afterEscape.selectionPrimitives === 0
        && afterEscape.fills === state.fills,
      `selected ${afterEscape.selected}, ${afterEscape.selectionPrimitives} selection primitive(s)`,
    );

    // vii. above the hand-over, the choropleth answers and nothing is left over.
    await park(page, WIDE_RANGE_M);
    const wide = await poll(page, () => {
      const layer = window.__godsEyeView.dataManager.layers.get('petite-enfance-fr').module;
      const state_ = layer.getTerritoriesForQa();
      return state_.regime === 'national' ? state_ : null;
    }, 'the choropleth to take over');
    await pump(page, 12);
    await page.screenshot({ path: path.join(SHOTS_DIR, 'national.png') });
    check(
      'the choropleth takes over above the hand-over span, leaving no territory behind',
      wide.fills === 0 && wide.outlines === 0 && wide.territories.length === 0,
      `${wide.fills} fill(s), ${wide.outlines} outline(s), ${wide.territories.length} territories`,
    );

    check('no uncaught page error', pageErrors.length === 0, pageErrors.join(' | '));
  } finally {
    await browser.close();
  }

  const failed = checks.filter((entry) => !entry.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed — shots in ${SHOTS_DIR}`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
