#!/usr/bin/env node
/**
 * Browser proof that a NAME on the globe is a click surface.
 *
 * The unit tests pin the seam (`overlayLabelPick.test.mjs`) and each layer's
 * resolution order, but neither can prove the thing that was actually broken:
 * the ambient labels are painted onto a `pointer-events: none` canvas stacked
 * over the Cesium viewport, so until they published a hit rectangle, a click
 * aimed at a station's name reached the terrain behind it and DISMISSED the
 * selection. Only a real scene can show a rectangle being published where the
 * text is, and a real pointer event landing inside it selecting the object.
 *
 * What it proves, per layer:
 *   i.   the layer's ambient labels publish hit rectangles at all
 *   ii.  the host resolves a point inside a painted label back to that entry
 *   iii. a real pointer click at the label's CENTRE — nowhere near the dot —
 *        makes the layer paint its selected card
 *   iv.  a click on empty space still clears that card (the regression this
 *        change could plausibly have caused)
 *
 * Layers covered live: Hub'Eau (the layer the request came from) and Réseau
 * gaz, which is the same mechanism through a different id convention
 * (`gas-fr-label:<id>` against a bare `hubeau:<code>`).
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
 * One camera per layer, chosen so the layer's own viewport gate is satisfied:
 * Hub'Eau refuses a box wider than 20°, and the gas register is national.
 */
const SUBJECTS = [
  {
    layerId: 'hubeau-hydro',
    name: "Hub'Eau Gauges",
    labelSource: 'hubeau-hydro',
    selectedSource: 'hubeau-hydro-selected',
    view: { lon: 0.6, lat: 44.0, height: 420_000 },
  },
  {
    layerId: 'gas-fr',
    name: 'Réseau gaz',
    labelSource: 'gas-fr',
    selectedSource: 'gas-fr-selected',
    view: { lon: 2.6, lat: 46.6, height: 1_600_000 },
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
 * Where the host actually painted this source's labels, and whether it
 * published a hit rectangle for each. Reads the same facade the app's own
 * diagnostics use — the text is on a canvas and is never scraped.
 */
function paintedLabelRects(page, sourceId) {
  return page.evaluate((source) => {
    const overlay = window.__gevWorldOverlay;
    const diagnostics = overlay?.getDiagnostics?.() || {};
    const painted = diagnostics.paintedBySource?.[source] || 0;
    // The host indexes rectangles by entry id, so the entry ids come from the
    // layer's own published cohort rather than from a private host structure.
    const rects = [];
    for (const id of window.__gevQaLabelIds?.[source] || []) {
      const rect = overlay?.getPaintRect?.(source, id);
      if (!rect) continue;
      const cx = Math.round(rect.x + rect.w / 2);
      const cy = Math.round(rect.y + rect.h / 2);
      rects.push({
        id,
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        cx,
        cy,
        // What the host says is under the centre of the painted text.
        hit: overlay?.hitTest?.(cx, cy, { sourceId: source })?.entryId || null,
      });
    }
    return { painted, hitRectCount: diagnostics.hitRectCount || 0, rects };
  }, sourceId);
}

/** Give the page the bag `readEntryIds` fills before any app code runs. */
async function captureEntryIds(page) {
  await page.evaluateOnNewDocument(() => {
    window.__gevQaLabelIds = {};
  });
}

/**
 * Candidate entry ids, derived from the live scene rather than guessed.
 *
 * A harness cannot know which stations Hub'Eau is reporting this minute, so the
 * ids come off the drawn point primitives and the host is asked which of them
 * it actually painted a label for. Anything it did not paint drops out.
 */
function readEntryIds(page, sourceId, layerId) {
  return page.evaluate((source, layer) => {
    window.__gevQaLabelIds = window.__gevQaLabelIds || {};
    const scene = window.__godsEyeView?.viewer?.scene;
    const ids = new Set();
    // Point primitives carry the same identity the ambient label is keyed on
    // for Hub'Eau (`hubeau:<code>`); the gas layer prefixes its labels, so both
    // spellings are offered and the host answers only for the one it painted.
    for (let i = 0; i < (scene?.primitives?.length || 0); i += 1) {
      const primitive = scene.primitives.get(i);
      if (typeof primitive?.get !== 'function' || !(primitive.length > 0)) continue;
      for (let j = 0; j < primitive.length; j += 1) {
        const id = primitive.get(j)?.id;
        if (typeof id !== 'string') continue;
        if (layer === 'hubeau-hydro' && id.startsWith('hubeau:')) ids.add(id);
        if (layer === 'gas-fr') ids.add(`gas-fr-label:${id}`);
      }
    }
    window.__gevQaLabelIds[source] = [...ids];
    return window.__gevQaLabelIds[source].length;
  }, sourceId, layerId);
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

function paintedBySource(page) {
  return page.evaluate(() => window.__gevWorldOverlay?.getDiagnostics?.()?.paintedBySource || {});
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
    await captureEntryIds(page);
    console.log(`[qa] booting ${APP_URL}`);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(
      () => window.__godsEyeView?.viewer && window.__godsEyeView?.dataManager,
      { timeout: 60000, polling: 200 },
    );
    await page.waitForFunction(() => Boolean(window.__gevWorldOverlay?.getPaintRect), {
      timeout: 30000,
      polling: 200,
    });
    await sleep(2500);

    for (const subject of SUBJECTS) {
      console.log(`\n[qa] ${subject.name} (${subject.layerId})`);
      await setView(page, subject.view.lon, subject.view.lat, subject.view.height);
      await page.evaluate((id) => window.__godsEyeView.dataManager.setEnabled(id, true), subject.layerId);

      // ── i. labels reach the screen AND publish a hit rectangle ───────────
      let probe = { painted: 0, hitRectCount: 0, rects: [] };
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await pump(page, 3, 70);
        await sleep(500);
        await readEntryIds(page, subject.labelSource, subject.layerId);
        probe = await paintedLabelRects(page, subject.labelSource);
        if (probe.rects.some((rect) => rect.hit)) break;
      }
      const resolved = probe.rects.filter((rect) => rect.hit === rect.id);
      check(`${subject.name}: ambient labels painted`, probe.painted > 0, `${probe.painted} painted`);
      check(
        `${subject.name}: the host publishes hit rectangles for them`,
        resolved.length > 0,
        `${resolved.length} of ${probe.rects.length} probed entries resolve at their own centre`,
      );
      if (!resolved.length) {
        await shoot(page, `${subject.layerId}-00-no-label.png`);
        continue;
      }

      // ── ii/iii. a click at the label's centre selects the object ─────────
      const target = resolved[0];
      const before = (await paintedBySource(page))[subject.selectedSource] || 0;
      await pointerClick(page, target.cx, target.cy);
      await pump(page, 6, 70);
      const afterClick = (await paintedBySource(page))[subject.selectedSource] || 0;
      check(
        `${subject.name}: clicking the NAME opens the card`,
        afterClick > before,
        `${subject.selectedSource} painted ${before} → ${afterClick} at (${target.cx}, ${target.cy}) for ${target.id}`,
      );
      await shoot(page, `${subject.layerId}-01-label-click.png`);

      // ── iv. empty space still clears it ──────────────────────────────────
      await pointerClick(page, 40, 960);
      await pump(page, 6, 70);
      const afterEmpty = (await paintedBySource(page))[subject.selectedSource] || 0;
      check(
        `${subject.name}: a click on nothing still clears the card`,
        afterEmpty === 0,
        `${subject.selectedSource} still painting ${afterEmpty}`,
      );

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
