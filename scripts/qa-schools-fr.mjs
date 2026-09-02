#!/usr/bin/env node
/**
 * Deterministic browser proof for the French school register (`schools-fr`).
 *
 * The layer answers at three scales — a choropleth of 96 départements, a
 * spatially thinned maillage, and every establishment in the box — and the
 * thing worth proving in a browser is that **what a reader is told about one
 * school does not depend on which of the three they happen to be in**.
 *
 * That used to be false. The national pack ships coordinates and not names
 * (1.66 MB against 5.42 MB — `schoolsMesh.js`), so a dot clicked in the
 * maillage produced a card titled "Établissement" and an instruction to zoom
 * in, while the same school two zoom steps later was "Collège Jean Moulin". A
 * click now asks the register for that one coordinate, so the name arrives at
 * every altitude the dot is drawn at.
 *
 * What it proves, in order:
 *   1. the layer registers, and the choropleth answers at national scale;
 *   2. the maillage draws real positions and says it is a sample;
 *   3. a maillage dot that is CLICKED gets its published name, and the name is
 *      the register's own — not a level, not a pupil count;
 *   4. a second click on the same dot is answered from memory, not from a
 *      second round trip;
 *   5. at site scale every dot already carries its name;
 *   6. toggling the layer off leaves nothing drawn and nothing selected.
 *
 * ── Two things this harness works around, both the app being itself ─────────
 *
 * • **The render governor renders on demand**, so every wait polls on an
 *   interval rather than on requestAnimationFrame, which can be starved.
 * • **`camera.setView` fires no `moveEnd`**, so each teleport is followed by an
 *   explicit `update()` — the refresh the data manager runs on its own timer.
 *
 * The cards are painted on the WebGL canvas and cannot be read as DOM text, so
 * the naming assertions read the DETECT callout instead: it is built from the
 * same record by the same `schoolCalloutText`, so a name there is a name on
 * the card.
 *
 * Screenshots land in the gitignored `qa-shots/schools-fr/`.
 *
 * Run: node scripts/qa-schools-fr.mjs --url http://localhost:5173
 */
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newQaPage } from './lib/qa-first-run.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'schools-fr');
const LAYER_ID = 'schools-fr';
const OVERLAY_SOURCE = 'schools-fr-selected';

const argUrl = process.argv.indexOf('--url');
const URL_BASE = argUrl >= 0 ? process.argv[argUrl + 1] : 'http://localhost:5173';

/** All of metropolitan France: the choropleth's own regime. */
const FRANCE = { lon: 2.6, lat: 46.6, height: 1_500_000, pitch: -90 };
/** Rhône-Alpes from altitude: a région fills the screen, so the maillage answers. */
const REGION = { lon: 4.8357, lat: 45.7640, height: 120_000, pitch: -90 };
/** Lyon, close enough for the proxy's 0.35° ceiling: every school in the box. */
const CITY = { lon: 4.8357, lat: 45.7640, height: 6_000, pitch: -90 };

const failures = [];
const check = (ok, label, detail = '') => {
  if (ok) console.log(`  ✔ ${label}`);
  else { failures.push(`${label}${detail ? ` — ${detail}` : ''}`); console.log(`  ✖ ${label} ${detail}`); }
};

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

mkdirSync(SHOTS_DIR, { recursive: true });

const browser = await puppeteer.launch({
  headless: 'new',
  protocolTimeout: 300_000,
  args: [
    '--use-gl=angle',
    '--use-angle=metal',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
  ],
});

try {
  const page = await newQaPage(browser);
  await page.setViewport({ width: 1440, height: 860 });

  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

  /** Every register lookup the page makes, so a cache hit can be told apart. */
  const lookups = [];
  page.on('request', (request) => {
    if (/\/api\/schools-fr\/sites\?/.test(request.url())) lookups.push(request.url());
  });

  await page.goto(URL_BASE, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(() => !!window.__godsEyeView?.viewer, { polling: 250, timeout: 120_000 });
  } catch {
    const loader = await page.evaluate(() => document.getElementById('loading-screen')?.innerText || '(no loader)');
    console.error(`[qa] the app never finished booting at ${URL_BASE}`);
    console.error(`[qa] loader said: ${loader.replace(/\s+/g, ' ').slice(0, 200)}`);
    console.error(`[qa] console errors: ${consoleErrors.slice(0, 5).join(' | ') || '(none)'}`);
    throw new Error('app did not boot');
  }
  await settle(10_000);

  await page.evaluate(async () => {
    await window.__godsEyeView.mapStackController?.setStack?.('osm');
  });
  await settle(3_000);

  /**
   * Wait until the app is on the page — again, if it has to be.
   *
   * The dev server force-reloads the page the first time it optimizes a new
   * dependency, which wipes `window.__godsEyeView` from under a run that has
   * already started. Every step re-establishes the app rather than assuming
   * the boot it did once still holds.
   */
  const waitForApp = () => page.waitForFunction(
    () => !!window.__godsEyeView?.dataManager,
    { polling: 250, timeout: 120_000 },
  );

  const stats = async () => {
    await waitForApp();
    return page.evaluate((layerId) => {
      const module = window.__godsEyeView.dataManager.layers.get(layerId)?.module;
      return module?.getStats?.() || null;
    }, LAYER_ID);
  };

  const callouts = async (maxCount = 4000) => {
    await waitForApp();
    return page.evaluate((layerId, cap) => {
      const module = window.__godsEyeView.dataManager.layers.get(layerId)?.module;
      return (module?.getDetectableObjects?.({ maxCount: cap, seed: 0 }) || [])
        .map((item) => ({ sourceId: item.sourceId, text: item.id }));
    }, LAYER_ID, maxCount);
  };

  /**
   * How many cards this layer has published, or null when it cannot be known.
   *
   * The overlay's diagnostics facade is installed only under `import.meta.env
   * .DEV`, so a run against a BUILT bundle (`vite preview`, or the deployment)
   * has no way to count cards. That returns null and the card assertions are
   * skipped out loud — reporting 0 there would be a passing check that proved
   * nothing, and a failing one would blame the layer for the harness.
   */
  const cardCount = () => page.evaluate((source) => {
    const diagnostics = window.__gevWorldOverlay?.getDiagnostics?.();
    return diagnostics ? (diagnostics.entriesBySource?.[source] ?? 0) : null;
  }, OVERLAY_SOURCE);

  const checkCards = async (expected, label) => {
    const count = await cardCount();
    if (count === null) {
      console.log(`  – ${label} (skipped: overlay diagnostics are DEV-only)`);
      return;
    }
    check(count === expected, label, `cards=${count}`);
  };

  /** Teleport, then ask the layer to reload — `setView` fires no `moveEnd`. */
  const goTo = async (site, { refresh = true, wait = 12_000 } = {}) => {
    await waitForApp();
    await page.evaluate((target) => {
      const viewer = window.__godsEyeView.viewer;
      viewer.camera.cancelFlight();
      viewer.camera.setView({
        destination: viewer.scene.globe.ellipsoid.cartographicToCartesian({
          longitude: (target.lon * Math.PI) / 180,
          latitude: (target.lat * Math.PI) / 180,
          height: target.height,
        }),
        orientation: { heading: 0, pitch: (target.pitch * Math.PI) / 180, roll: 0 },
      });
    }, site);
    await settle(2_500);
    if (refresh) {
      await page.evaluate(
        (layerId) => window.__godsEyeView.dataManager.layers.get(layerId)?.module?.update?.(),
        LAYER_ID,
      );
      await settle(wait);
    }
  };

  const shoot = async (name) => {
    const restore = await page.evaluate(() => {
      const scene = window.__godsEyeView?.viewer?.scene;
      if (!scene) return null;
      const previous = scene.requestRenderMode;
      scene.requestRenderMode = false;
      return previous;
    });
    await settle(3_000);
    try {
      await page.screenshot({ path: path.join(SHOTS_DIR, name), timeout: 120_000 });
      console.log(`  … ${name}`);
    } catch (error) {
      console.log(`  … screenshot ${name} skipped (${error.message.split('\n')[0]})`);
    }
    if (restore !== null) {
      await page.evaluate((value) => {
        const scene = window.__godsEyeView?.viewer?.scene;
        if (scene) scene.requestRenderMode = value;
      }, restore);
    }
  };

  /**
   * Click a drawn dot for real.
   *
   * Projects each candidate to window coordinates and picks there first, so the
   * click that follows is aimed at something the scene agrees is on screen —
   * a blind click at a projected pixel lands on empty globe as often as not.
   * @returns {Promise<{x:number, y:number, id:string, text:string}|{error:string}>}
   */
  const clickADot = async () => {
    await waitForApp();
    return page.evaluate((layerId) => {
      const scene = window.__godsEyeView.viewer.scene;
      const module = window.__godsEyeView.dataManager.layers.get(layerId)?.module;
      const items = module?.getDetectableObjects?.({ maxCount: 400, seed: 0 }) || [];
      if (!items.length) return { error: 'no dots to click' };
      // `scene.cartesianToCanvasCoordinates` and not `Cesium.SceneTransforms`:
      // the dev server serves Cesium as an ES module with no window global, so
      // reaching for `window.Cesium` here silently projected nothing and the
      // harness reported a healthy layer unpickable.
      for (const item of items) {
        const win = scene.cartesianToCanvasCoordinates(item.position);
        if (!win || !Number.isFinite(win.x) || !Number.isFinite(win.y)) continue;
        if (win.x < 24 || win.y < 24) continue;
        if (win.x > scene.canvas.clientWidth - 24 || win.y > scene.canvas.clientHeight - 24) continue;
        const picked = scene.pick(win);
        if (typeof picked?.id === 'string' && picked.id === item.sourceId) {
          return { x: Math.round(win.x), y: Math.round(win.y), id: picked.id, text: item.id };
        }
      }
      return { error: 'nothing pickable on screen' };
    }, LAYER_ID);
  };

  // ── 1. registered, and the choropleth answers for the whole country ──────
  console.log('\n[qa] France — the choropleth');
  check(
    await page.evaluate((layerId) => !!window.__godsEyeView.dataManager.layers.get(layerId), LAYER_ID),
    'layer is registered with the data manager',
  );
  await goTo(FRANCE, { refresh: false });
  await page.evaluate(
    (layerId) => window.__godsEyeView.dataManager.setEnabled(layerId, true, { origin: 'user' }),
    LAYER_ID,
  );
  await page.waitForFunction((layerId) => {
    const s = window.__godsEyeView.dataManager.layers.get(layerId)?.module?.getStats?.();
    return s && (s.count > 0 || s.error || /département/i.test(s.loadingLabel || ''));
  }, { polling: 400, timeout: 180_000 }, LAYER_ID).catch(() => {});
  await settle(6_000);
  const national = await stats();
  console.log('  stats:', JSON.stringify({ status: national?.status, label: national?.loadingLabel }));
  check(!national?.error, 'the national rollup loads', national?.error || '');
  check(/départements/i.test(national?.loadingLabel || ''),
    'and the line counts establishments across départements', national?.loadingLabel || '(none)');

  // ── 2. the maillage draws real positions, and says it is a sample ────────
  console.log('\n[qa] Rhône-Alpes — the maillage');
  await goTo(REGION, { wait: 16_000 });
  const mesh = await stats();
  console.log('  stats:', JSON.stringify({ count: mesh?.count, label: mesh?.loadingLabel }));
  check((mesh?.count || 0) > 100, 'the maillage draws a region-sized set', `count=${mesh?.count}`);
  check(/échantillon spatial|établissements dans la vue/.test(mesh?.loadingLabel || ''),
    'and never claims to be the whole register', mesh?.loadingLabel || '(none)');
  await shoot('01-maillage.png');

  // ── 3. a clicked maillage dot is NAMED ──────────────────────────────────
  //
  // The regression this file exists for. The pack ships no names, so before
  // the lookup this card was titled "Établissement" and told the reader to
  // zoom in — making the identity of a school a property of the altitude.
  console.log('\n[qa] a maillage dot, clicked');
  const target = await clickADot();
  console.log('  pick:', JSON.stringify(target));
  if (target.error) {
    check(false, 'a maillage dot is pickable from the scene', target.error);
  } else {
    const lookupsBefore = lookups.length;
    await page.mouse.click(target.x, target.y);
    await settle(1_500);
    await checkCards(1, 'the click publishes exactly one card');

    await page.waitForFunction((layerId, id) => {
      const module = window.__godsEyeView.dataManager.layers.get(layerId)?.module;
      const items = module?.getDetectableObjects?.({ maxCount: 4000, seed: 0 }) || [];
      const hit = items.find((item) => item.sourceId === id);
      return Boolean(hit) && hit.id !== undefined;
    }, { polling: 400, timeout: 40_000 }, LAYER_ID, target.id).catch(() => {});
    await settle(9_000);

    const after = (await callouts()).find((item) => item.sourceId === target.id);
    console.log(`  callout: ${JSON.stringify(target.text)} → ${JSON.stringify(after?.text)}`);
    check(Boolean(after?.text), 'the dot still exists after the lookup', String(after?.text));
    check(after?.text !== target.text, 'and it is no longer described by its level alone',
      `${target.text} → ${after?.text}`);
    // A published name, not a fabricated one: the register's names carry real
    // words, where a level label is one or two known strings.
    check(!/^(École|Collège|Lycée|Adapté & médico-social|Administratif & orientation)$/.test(after?.text || ''),
      'the callout carries the establishment name', String(after?.text));
    check(lookups.length > lookupsBefore, 'the name came from the register, not from the pack',
      `${lookups.length - lookupsBefore} lookup(s)`);

    // ── 4. the answer is remembered ───────────────────────────────────────
    const lookupsAfterFirst = lookups.length;
    await page.mouse.click(20, 20); // deselect on empty globe
    await settle(1_200);
    await page.mouse.click(target.x, target.y);
    await settle(4_000);
    check(lookups.length === lookupsAfterFirst,
      'clicking the same dot again asks the register nothing', `${lookups.length - lookupsAfterFirst} extra`);
    const again = (await callouts()).find((item) => item.sourceId === target.id);
    check(again?.text === after?.text, 'and the name it already has is the name it keeps',
      `${again?.text}`);
  }

  // ── 5. at site scale the names are already there ────────────────────────
  console.log('\n[qa] Lyon — every school in the box');
  await goTo(CITY, { wait: 16_000 });
  const sites = await stats();
  console.log('  stats:', JSON.stringify({ count: sites?.count, label: sites?.loadingLabel }));
  check((sites?.count || 0) > 20, 'the exact regime draws the schools in the box', `count=${sites?.count}`);
  const named = await callouts();
  const levelsOnly = named.filter(
    (item) => /^(École|Collège|Lycée|Adapté & médico-social|Administratif & orientation)$/.test(item.text || ''),
  );
  console.log(`  ${named.length} callouts, ${levelsOnly.length} of them unnamed`);
  check(named.length > 0, 'schools are offered to DETECT at all');
  // The register carries a name on every open row; a bare level here would
  // mean the projection dropped it.
  check(levelsOnly.length === 0, 'and every one of them is named, not merely typed',
    levelsOnly.slice(0, 3).map((item) => item.sourceId).join(', '));
  await shoot('02-sites.png');

  // ── 6. toggle off ───────────────────────────────────────────────────────
  console.log('\n[qa] teardown');
  await page.evaluate(
    (layerId) => window.__godsEyeView.dataManager.setEnabled(layerId, false, { origin: 'user' }),
    LAYER_ID,
  );
  await settle(2_500);
  await checkCards(0, 'disabling clears the card');
  check((await callouts()).length === 0, 'and stops offering schools to DETECT');

  const relevant = consoleErrors.filter((text) => /schools-fr|annuaire/i.test(text));
  check(relevant.length === 0, 'no console errors from this layer', relevant.slice(0, 3).join(' | '));

  console.log(`\n[qa] screenshots -> ${SHOTS_DIR}`);
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\n[qa] schools-fr: ${failures.length} check(s) failed`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('\n[qa] schools-fr: all checks passed');
