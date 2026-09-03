#!/usr/bin/env node
/**
 * Browser proof that a NAME on the globe is a click surface.
 *
 * The unit tests pin the seam (`overlayLabelPick.test.mjs`) and each layer's
 * resolution order, but neither can prove the thing that was actually broken:
 * the names are painted onto a `pointer-events: none` canvas stacked over the
 * Cesium viewport, so until they published a hit rectangle, a click aimed at a
 * station's name reached the terrain behind it and DISMISSED the selection.
 * Only a real scene can show a rectangle being published where the text is, and
 * a real pointer event landing inside it selecting the object.
 *
 * What it proves, per layer:
 *   i.   the layer's names publish hit rectangles at all
 *   ii.  the host resolves a point inside a painted name back to that entry
 *   iii. a real pointer click at the name's CENTRE — nowhere near the dot —
 *        selects the object
 *   iv.  a click on empty space still clears that selection, for the layers
 *        that have ever had a deselect branch
 *
 * Layers covered live, and why each one is here:
 *   - Hub'Eau (the layer the request came from) and Réseau gaz — two ambient
 *     LABEL entries through different id conventions (`gas-fr-label:<id>`
 *     against a bare `hubeau:<code>`).
 *   - Vols — a DETECT callsign, which is not an entry at all: the detection
 *     lane solves its own placement and publishes the rectangle itself, under
 *     its own per-layer source id.
 *   - Aéroports — an ambient CARD, the biggest of the four targets, on a layer
 *     whose click also frames the feature.
 *
 * Run: node scripts/qa-label-click.mjs --url http://localhost:4173
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'label-click');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = option('--url', process.env.QA_BASE_URL || 'http://localhost:4173');
const HEADFUL = args.includes('--headful');

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

/**
 * How to read "something is selected" for one layer. Each returns a value that
 * changes on selection and returns to `null` on deselection, so the same three
 * checks fit a painted card, a followed aircraft and a picked entity alike.
 */
const SELECTION_PROBES = {
  paintedSource: (source) => (page) => page.evaluate((id) => {
    const painted = window.__gevWorldOverlay?.getDiagnostics?.()?.paintedBySource || {};
    return painted[id] > 0 ? `${painted[id]} painted` : null;
  }, source),
  trackedFlight: () => (page) => page.evaluate(() => {
    const layer = window.__godsEyeView?.dataManager?.layers?.get('flights')?.module;
    return layer?.getTrackedInfo?.()?.icao24 || null;
  }),
  selectedEntity: () => (page) => page.evaluate(
    () => window.__godsEyeView?.viewer?.selectedEntity?.id ?? null,
  ),
};

/**
 * One camera per layer, chosen so the layer's own viewport gate is satisfied:
 * Hub'Eau refuses a box wider than 20°, the gas register is national, and the
 * two aviation layers want a busy sky over Paris.
 */
const SUBJECTS = [
  {
    layerId: 'hubeau-hydro',
    name: "Hub'Eau Gauges",
    labelSource: 'hubeau-hydro',
    view: { lon: 0.6, lat: 44.0, height: 420_000 },
    selection: SELECTION_PROBES.paintedSource('hubeau-hydro-selected'),
    clearsOnEmpty: true,
  },
  {
    layerId: 'gas-fr',
    name: 'Réseau gaz',
    labelSource: 'gas-fr',
    view: { lon: 2.6, lat: 46.6, height: 1_600_000 },
    selection: SELECTION_PROBES.paintedSource('gas-fr-selected'),
    clearsOnEmpty: true,
  },
  {
    layerId: 'flights',
    name: 'Vols — la callsign DETECT',
    // Not an entry source: `detect:<layerId>`, published by the detection lane.
    labelSource: 'detect:flights',
    needsDetect: true,
    view: { lon: 2.4, lat: 48.85, height: 600_000 },
    selection: SELECTION_PROBES.trackedFlight(),
    clearsOnEmpty: true,
  },
  {
    layerId: 'local-airports',
    name: 'Aéroports — le nom sur le globe',
    labelSource: 'local-airports',
    view: { lon: 2.55, lat: 48.9, height: 300_000 },
    selection: SELECTION_PROBES.selectedEntity(),
    // This layer never had a deselect branch: clicking nothing does nothing.
    clearsOnEmpty: false,
  },
];

const failures = [];
function check(label, condition, detail = '') {
  const ok = Boolean(condition);
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`);
  return ok;
}

async function pump(page, frames = 8, gapMs = 80) {
  for (let frame = 0; frame < frames; frame += 1) {
    await page.evaluate(() => {
      try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled context */ }
    });
    await sleep(gapMs);
  }
}

async function setView(page, lon, lat, height) {
  await page.evaluate((lo, la, h) => {
    const gev = window.__godsEyeView;
    const ellipsoid = gev.viewer.scene.globe?.ellipsoid || gev.viewer.scene.ellipsoid;
    const d2r = Math.PI / 180;
    try { gev.viewer.camera.cancelFlight(); } catch { /* no flight active */ }
    gev.viewer.camera.setView({
      destination: ellipsoid.cartographicToCartesian({
        longitude: lo * d2r, latitude: la * d2r, height: h,
      }),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    gev.viewer.scene.requestRender?.();
  }, lon, lat, height);
  await pump(page, 4);
}

/**
 * Where the host says this source's names are, and what it answers at the
 * centre of each. Reads the same facade the app's own diagnostics use — the
 * text is on a canvas and is never scraped, and the ids come from the host
 * rather than being guessed from the scene.
 */
function paintedLabelRects(page, sourceId) {
  return page.evaluate((source) => {
    const overlay = window.__gevWorldOverlay;
    const rects = (overlay?.hitRects?.({ sourceId: source }) || []).map((rect) => {
      const cx = Math.round(rect.x + rect.w / 2);
      const cy = Math.round(rect.y + rect.h / 2);
      return {
        id: rect.entryId,
        ...rect,
        cx,
        cy,
        // What the host says is under the centre of the painted text.
        hit: overlay?.hitTest?.(cx, cy, { sourceId: source })?.entryId || null,
      };
    });
    return { hitRectCount: overlay?.getDiagnostics?.()?.hitRectCount || 0, rects };
  }, sourceId);
}

/**
 * Click the canvas with synthetic pointer events. `page.mouse.click` needs a
 * layout round trip that starves under SwiftShader, and Cesium's
 * `ScreenSpaceEventHandler` listens for pointer events on the canvas.
 */
async function pointerClick(page, x, y) {
  await page.evaluate((cx, cy) => {
    const canvas = window.__godsEyeView?.viewer?.scene?.canvas;
    if (!canvas) return;
    const box = canvas.getBoundingClientRect();
    const common = {
      bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: 'mouse',
      isPrimary: true, button: 0, buttons: 1,
      clientX: box.left + cx, clientY: box.top + cy,
    };
    canvas.dispatchEvent(new PointerEvent('pointerdown', common));
    canvas.dispatchEvent(new PointerEvent('pointerup', { ...common, buttons: 0 }));
  }, x, y);
}

/**
 * Click a pixel that is genuinely nothing — no primitive under it and no
 * published click surface over it.
 *
 * Finding the pixel and clicking it happen in ONE page evaluation, and that is
 * the point: hit rectangles are rebuilt every painted frame, so a corner that
 * was empty when the harness asked can be under a callsign by the time it
 * clicks. Nothing renders between the emptiness test and the dispatch here, so
 * "empty" is true of the click and not merely of a moment before it. Returns
 * what blocked each rejected candidate so a failure names the obstacle instead
 * of leaving it to be guessed.
 */
function clickEmptyPixel(page, candidates) {
  return page.evaluate((points) => {
    const gev = window.__godsEyeView;
    const overlay = window.__gevWorldOverlay;
    const canvas = gev?.viewer?.scene?.canvas;
    const blocked = [];
    for (const [x, y] of points) {
      let picked = null;
      try { picked = gev?.viewer?.scene?.pick({ x, y }); } catch { /* mid-teardown */ }
      const hit = overlay?.hitTest?.(x, y);
      if (picked || hit) {
        blocked.push({
          x,
          y,
          picked: picked ? String(picked.id ?? picked.primitive?.id ?? 'primitive') : null,
          hit: hit ? `${hit.sourceId}/${hit.entryId}` : null,
        });
        continue;
      }
      if (!canvas) return { point: null, blocked };
      const box = canvas.getBoundingClientRect();
      const common = {
        bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: 'mouse',
        isPrimary: true, button: 0, buttons: 1,
        clientX: box.left + x, clientY: box.top + y,
      };
      canvas.dispatchEvent(new PointerEvent('pointerdown', common));
      canvas.dispatchEvent(new PointerEvent('pointerup', { ...common, buttons: 0 }));
      return { point: { x, y }, blocked };
    }
    return { point: null, blocked };
  }, candidates);
}

async function setDetection(page, enabled) {
  await page.evaluate((on) => {
    window.__godsEyeView?.styleManager?.setDetection?.({ enabled: on, mode: 'panoptic' });
  }, enabled);
}

async function shoot(page, name) {
  await page.screenshot({ path: path.join(SHOTS_DIR, name) });
}

async function main() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: !HEADFUL,
    executablePath: chrome,
    args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000 },
    protocolTimeout: 180000,
  });

  try {
    const page = await newQaPage(browser);
    console.log(`[qa] booting ${APP_URL}`);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(
      () => window.__godsEyeView?.viewer && window.__godsEyeView?.dataManager,
      { timeout: 60000, polling: 200 },
    );
    await page.waitForFunction(() => Boolean(window.__gevWorldOverlay?.hitRects), {
      timeout: 30000,
      polling: 200,
    });
    await sleep(2500);

    for (const subject of SUBJECTS) {
      console.log(`\n[qa] ${subject.name} (${subject.layerId})`);
      await setView(page, subject.view.lon, subject.view.lat, subject.view.height);
      await page.evaluate((id) => window.__godsEyeView.dataManager.setEnabled(id, true), subject.layerId);
      if (subject.needsDetect) await setDetection(page, true);

      // ── i/ii. the names publish hit rectangles, and each resolves at its
      //         own centre ────────────────────────────────────────────────────
      let probe = { hitRectCount: 0, rects: [] };
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await pump(page, 3, 70);
        await sleep(500);
        probe = await paintedLabelRects(page, subject.labelSource);
        if (probe.rects.some((rect) => rect.hit)) break;
      }
      const resolved = probe.rects.filter((rect) => rect.hit === rect.id);
      check(
        `${subject.name}: the host publishes hit rectangles for the names`,
        probe.rects.length > 0,
        `${probe.rects.length} rectangles under ${subject.labelSource}`,
      );
      check(
        `${subject.name}: each resolves back to its own record`,
        resolved.length > 0,
        `${resolved.length} of ${probe.rects.length} probed entries resolve at their own centre`,
      );
      if (!resolved.length) {
        await shoot(page, `${subject.layerId}-00-no-label.png`);
        if (subject.needsDetect) await setDetection(page, false);
        continue;
      }

      // ── iii. a click at the name's centre selects the object ─────────────
      const target = resolved[0];
      const before = await subject.selection(page);
      await pointerClick(page, target.cx, target.cy);
      await pump(page, 6, 70);
      const afterClick = await subject.selection(page);
      check(
        `${subject.name}: clicking the NAME selects the object`,
        afterClick !== null && afterClick !== before,
        `selection ${JSON.stringify(before)} → ${JSON.stringify(afterClick)} at (${target.cx}, ${target.cy}) for ${target.id}`,
      );
      await shoot(page, `${subject.layerId}-01-label-click.png`);

      // ── iv. empty space still clears it, where it always did ─────────────
      if (subject.clearsOnEmpty) {
        const empty = await clickEmptyPixel(page, [
          [40, 960], [1560, 960], [40, 40], [1560, 40], [800, 985], [20, 500],
        ]);
        if (!check(
          `${subject.name}: the viewport still has a pixel that is nothing`,
          empty.point,
          `every candidate was occupied: ${JSON.stringify(empty.blocked)}`,
        )) {
          await shoot(page, `${subject.layerId}-02-no-empty-pixel.png`);
        } else {
          await pump(page, 6, 70);
          const afterEmpty = await subject.selection(page);
          check(
            `${subject.name}: a click on nothing still clears the selection`,
            afterEmpty === null,
            `selection still ${JSON.stringify(afterEmpty)} after (${empty.point.x}, ${empty.point.y})`,
          );
        }
      }

      if (subject.needsDetect) await setDetection(page, false);
      await page.evaluate((id) => window.__godsEyeView.dataManager.setEnabled(id, false), subject.layerId);
      await pump(page, 4, 60);
    }
  } finally {
    await browser.close();
  }

  console.log('');
  if (failures.length) {
    console.error(`[qa] ${failures.length} failure(s):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log('[qa] the name is a click surface — proved in a real scene.');
}

main().catch((error) => {
  console.error('[qa] harness error:', error);
  process.exitCode = 1;
});
