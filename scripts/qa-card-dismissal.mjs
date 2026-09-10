#!/usr/bin/env node
/**
 * Deterministic browser proof that a card can be DISMISSED.
 *
 * ── The bug class this guards, and why a unit test is not enough ────────────
 * A layer that opens a card on click also has to close it, and "the reader
 * clicked the map" used to be written `!picked` — `scene.pick` answers nothing
 * for the bare globe, which is not a primitive. The photorealistic surface
 * ended that silently: every on-globe pixel picks a 3D Tiles feature, so
 * `!picked` became false everywhere a reader could click and four handlers lost
 * the ability to close their own cards. Reported as exactly that, on
 * `idfm-network`, in the plainest possible terms: "j'ai beau cliquer ailleurs
 * sur la carte, je ne peux pas me séparer de cette fenêtre".
 *
 * Every layer's unit tests now pin the rule against a HAND-WRITTEN pick shape.
 * That is worth having and it is not the same claim: a hand-written shape is
 * this harness author's belief about what Cesium returns. So this harness takes
 * the pick from the RUNNING TILESET — `scene.pick` at real screen coordinates,
 * over Paris, with the photoreal tiles loaded — and feeds that object to each
 * layer's own click rule. If Cesium ever starts labelling tile picks with an
 * id, or the app starts drawing the surface some other way, this fails and the
 * unit tests do not.
 *
 * ── What it does NOT do ─────────────────────────────────────────────────────
 * It does not dispatch a synthetic canvas click. Chrome-for-Testing on this app
 * has been measured picking ZERO Cesium entities out of 23 on screen, so a
 * click-driven test would prove the renderer's pick buffer rather than the
 * layer — and `page.click()` on this canvas hangs. The layers expose their
 * click rule as a named function precisely so it can be exercised without one.
 *
 * Run: node scripts/qa-card-dismissal.mjs --url http://localhost:5173
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = option('--url', process.env.QA_BASE_URL || 'http://localhost:5173');
const HEADFUL = args.includes('--headful');

/** Paris, low and nadir, so the photoreal tileset is what is under the cursor. */
const CITY = { lon: 2.3488, lat: 48.8534, height: 700 };

const chromeCandidates = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  (() => { try { return puppeteer.executablePath(); } catch { return null; } })(),
].filter(Boolean);
const chrome = chromeCandidates.find((candidate) => {
  try { return fs.existsSync(candidate); } catch { return false; }
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];
function check(label, ok, detail = '') {
  if (ok) { console.log(`  ✓ ${label}`); return; }
  failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
}

async function pump(page, frames = 8, gapMs = 100) {
  for (let frame = 0; frame < frames; frame++) {
    await page.evaluate(() => {
      try {
        const scene = window.__godsEyeView?.viewer?.scene;
        scene?.requestRender();
        scene?.render();
      } catch { /* stalled context */ }
    });
    await sleep(gapMs);
  }
}

/**
 * The URL the running app actually loaded a source module from.
 *
 * Under the dev server this is `…?t=<mtime>` for any file edited since the
 * server started, and importing the bare path gets a DIFFERENT instance with
 * its own module state — which is how a card assertion fails against a layer
 * that is working perfectly.
 */
function loadedModuleUrl(page, suffix) {
  return page.evaluate((wanted) => {
    const names = performance.getEntriesByType('resource').map((entry) => entry.name);
    const matches = names.filter((name) => new URL(name, location.href).pathname === wanted);
    return matches.length ? matches[matches.length - 1] : wanted;
  }, suffix);
}

async function main() {
  const browser = await puppeteer.launch({
    headless: !HEADFUL,
    executablePath: chrome,
    args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1400,900'],
    defaultViewport: { width: 1400, height: 900 },
    protocolTimeout: 120000,
  });

  try {
    const page = await newQaPage(browser);
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    console.log(`[qa] booting ${APP_URL}`);
    // Vite reloads the page outright the first time it optimises a dependency
    // the boot pulled in, which detaches the frame mid-navigation. The
    // navigation result is advisory; the app's own readiness gate decides.
    let booted = false;
    for (let attempt = 1; attempt <= 3 && !booted; attempt += 1) {
      await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      booted = await page.waitForFunction(
        () => window.__godsEyeView?.viewer && window.__godsEyeView?.dataManager,
        { timeout: 40000, polling: 200 },
      ).then(() => true).catch(() => false);
      if (!booted) console.log(`  · boot attempt ${attempt} did not settle`);
    }
    if (!booted) throw new Error(`the app never reached __godsEyeView at ${APP_URL}`);
    await sleep(2000);

    // ── i. the surface answers every pick ──────────────────────────────────
    console.log('[qa] i. what the photorealistic globe picks');
    await page.evaluate((lon, lat, height) => {
      const gev = window.__godsEyeView;
      const ellipsoid = gev.viewer.scene.globe?.ellipsoid || gev.viewer.scene.ellipsoid;
      const d2r = Math.PI / 180;
      try { gev.viewer.camera.cancelFlight(); } catch { /* no flight */ }
      gev.viewer.camera.setView({
        destination: ellipsoid.cartographicToCartesian({
          longitude: lon * d2r, latitude: lat * d2r, height,
        }),
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
      });
    }, CITY.lon, CITY.lat, CITY.height);
    // The question is what a LOADED tileset picks, so the tiles are waited for.
    let surface = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await pump(page, 3, 120);
      surface = await page.evaluate(() => {
        const scene = window.__godsEyeView.viewer.scene;
        scene.requestRender(); scene.render();
        let loaded = 0;
        for (let i = 0; i < scene.primitives.length; i += 1) {
          const primitive = scene.primitives.get(i);
          if (primitive?.constructor?.name !== 'Cesium3DTileset') continue;
          loaded += primitive.statistics?.numberOfTilesWithContentReady ?? 0;
        }
        const Point = function Point(x, y) { this.x = x; this.y = y; };
        const probes = [[700, 450], [400, 250], [1000, 650], [250, 700], [1150, 200]]
          .map(([x, y]) => {
            let picked;
            try { picked = scene.pick(new Point(x, y)); } catch { return { error: true }; }
            return {
              falsy: !picked,
              tileset: picked?.primitive?.constructor?.name === 'Cesium3DTileset',
              hasId: picked?.id !== undefined || picked?.primitive?.id !== undefined,
            };
          });
        return { loaded, probes };
      });
      if (surface.loaded > 50 && surface.probes.every((probe) => !probe.falsy)) break;
    }
    check('the photorealistic tileset has streamed in', surface.loaded > 50,
      `${surface.loaded} tiles with content ready`);
    check('and it answers EVERY pick, which is what ended `!picked`',
      surface.probes.every((probe) => probe.falsy === false),
      JSON.stringify(surface.probes));
    check('with a tileset pick that carries no id, so nobody can own it',
      surface.probes.every((probe) => probe.tileset === true && probe.hasId === false),
      JSON.stringify(surface.probes));

    // ── ii. each layer's rule, fed the REAL pick ────────────────────────────
    console.log('[qa] ii. the click rule, against that pick');
    const registry = await loadedModuleUrl(page, '/src/data/pickRegistry.js');
    const verdict = await page.evaluate(async (registryUrl) => {
      const scene = window.__godsEyeView.viewer.scene;
      const { isWorldPick } = await import(registryUrl);
      const Point = function Point(x, y) { this.x = x; this.y = y; };
      scene.requestRender(); scene.render();
      const picked = scene.pick(new Point(700, 450));
      return {
        falsy: !picked,
        world: isWorldPick(picked),
        // The two shapes the fix rests on, read off the live object rather than
        // asserted from memory.
        ctor: picked?.constructor?.name ?? null,
        primitive: picked?.primitive?.constructor?.name ?? null,
      };
    }, registry);
    check('a live tileset pick is NOT falsy', verdict.falsy === false, JSON.stringify(verdict));
    check('and `isWorldPick` still calls it the map', verdict.world === true,
      JSON.stringify(verdict));

    // Each layer's own rule, fed the live pick object.
    const perLayer = await page.evaluate(async (registryUrl) => {
      const gev = window.__godsEyeView;
      const scene = gev.viewer.scene;
      const Point = function Point(x, y) { this.x = x; this.y = y; };
      scene.requestRender(); scene.render();
      const picked = scene.pick(new Point(700, 450));
      void registryUrl;
      const out = {};

      // Every layer that owns a card and a click rule, exercised through the
      // rule the handler itself calls. The module URL is the one the app
      // loaded, read off its own resource timeline.
      const url = (suffix) => {
        const names = performance.getEntriesByType('resource').map((entry) => entry.name);
        const matches = names.filter((name) => new URL(name, location.href).pathname === suffix);
        return matches.length ? matches[matches.length - 1] : suffix;
      };

      // — idfm-network: two id spaces, one card.
      try {
        const m = await import(url('/src/data/idfmNetwork.js'));
        out['idfm-network'] = {
          onMap: m.clickDecision(picked, { selectedId: 'idfm:stop:1' }).action,
          idle: m.clickDecision(picked, { selectedId: null }).action,
        };
      } catch (error) { out['idfm-network'] = { error: String(error.message).slice(0, 120) }; }

      // A capturing overlay host, so "the card went" is read off the host the
      // layer actually publishes to rather than inferred from a return value.
      const host = () => {
        const entries = new Map();
        return {
          entries,
          setEntries: (id, list) => entries.set(id, list),
          setVisible: () => {},
          clearSource: (id) => entries.delete(id),
        };
      };

      // — velo-pulse-fr. Seeded through its own test seam and then CLICKED:
      //   the point is to run the real `clearSelection` against the real pick,
      //   so the card has to be really open first.
      try {
        const m = await import(url('/src/data/veloPulse.js'));
        const site = {
          id: '1024', name: 'Bellecour', commune: 'Lyon 2e', lon: 4.83, lat: 45.75,
          capacity: 40,
          profile: new Array(168).fill(200),
          samples: new Array(168).fill(4),
        };
        const pack = {
          slots: 168,
          window: { start: '2026-06-01', end: '2026-06-28', weeks: 4 },
          cities: {
            lyon: {
              label: 'Lyon — Vélo\'v', instrument: 'stock', unit: '%', scale: 1000,
              source: 'Métropole de Lyon', sites: [site],
            },
          },
        };
        const overlay = host();
        const records = new Map(m.buildRecords(pack, 16).map((r) => [r.id, r]));
        m._setPulseStateForTest({ pack, records, overlayHost: overlay, mode: 'now', slot: 16 });
        const opened = m.pulseClick({ id: [...records.keys()][0] });
        const cardOpen = overlay.entries.size > 0;
        const onMap = m.pulseClick(picked);
        out['velo-pulse-fr'] = {
          rule: typeof m.pulseClick, opened, cardOpen, onMap, cardGone: overlay.entries.size === 0,
        };
      } catch (error) { out['velo-pulse-fr'] = { error: String(error.message).slice(0, 140) }; }

      // — filosofi-fr, the same way.
      try {
        const m = await import(url('/src/data/filosofiCarreaux.js'));
        const cell = {
          i: 1, j: 1, lon: 2.3488, lat: 48.8534, men: 120, ind: 260,
          ind_snv: 5_200_000, men_pauv: 12,
        };
        const id = m.cellId(cell, 200);
        const overlay = host();
        // A drawn record, not a stub: `selectCell` builds a card from it, and a
        // card that throws would fail this check for the wrong reason.
        const drawn = {
          id, cell, resolution: 200, color: '#4f97c4', fill: 0.8, baseM: 40,
          lon: cell.lon, lat: cell.lat, corners: m.drawnOutline(cell, 200, 0.8),
          holeCorners: null,
        };
        m._setFilosofiStateForTest({
          records: new Map([[id, drawn]]),
          payload: { communes: {} },
          overlayHost: overlay,
          metric: 'niveau',
        });
        const opened = m.filosofiClick({ id });
        const wasSelected = m._filosofiSelectedIdForTest() === id;
        const onMap = m.filosofiClick(picked);
        out['filosofi-fr'] = {
          rule: typeof m.filosofiClick, opened, wasSelected, onMap,
          cleared: m._filosofiSelectedIdForTest() === null,
        };
      } catch (error) { out['filosofi-fr'] = { error: String(error.message).slice(0, 140) }; }

      // — the shared address-scan factory: seven layers, and BOTH of its
      //   map-facing outcomes died with `!picked`.
      try {
        const m = await import(url('/src/data/addressScanLayer.js'));
        const reg = await import(url('/src/data/pickRegistry.js'));
        const world = reg.isWorldPick(picked);
        out['address-scan'] = {
          world,
          ground: m.addressScanClickIntent({ world, answersGround: true }),
          dismiss: m.addressScanClickIntent({ world, selected: true }),
          foreign: m.addressScanClickIntent({ world: false, selected: true }),
        };
      } catch (error) { out['address-scan'] = { error: String(error.message).slice(0, 120) }; }

      return out;
    }, registry);

    check('idfm-network closes its card on the live pick',
      perLayer['idfm-network']?.onMap === 'close' && perLayer['idfm-network']?.idle === 'ignore',
      JSON.stringify(perLayer['idfm-network']));
    check('velo-pulse-fr opens a card, then closes it on the live pick',
      perLayer['velo-pulse-fr']?.opened === 'select'
      && perLayer['velo-pulse-fr']?.cardOpen === true
      && perLayer['velo-pulse-fr']?.onMap === 'close'
      && perLayer['velo-pulse-fr']?.cardGone === true,
      JSON.stringify(perLayer['velo-pulse-fr']));
    check('filosofi-fr opens a card, then closes it on the live pick',
      perLayer['filosofi-fr']?.opened === 'cell'
      && perLayer['filosofi-fr']?.wasSelected === true
      && perLayer['filosofi-fr']?.onMap === 'close'
      && perLayer['filosofi-fr']?.cleared === true,
      JSON.stringify(perLayer['filosofi-fr']));
    check('the address-scan factory reads the live pick as the GROUND again',
      perLayer['address-scan']?.ground === 'ground',
      JSON.stringify(perLayer['address-scan']));
    check('and dismisses on it',
      perLayer['address-scan']?.dismiss === 'dismiss',
      JSON.stringify(perLayer['address-scan']));
    check('while a sibling`s marker is still a sibling`s click',
      perLayer['address-scan']?.foreign === 'ignore',
      JSON.stringify(perLayer['address-scan']));

    const relevant = consoleErrors.filter((entry) => !/favicon|Failed to load resource/i.test(entry));
    check('no console errors from the click rules',
      !relevant.some((entry) => /pick|click|dismiss/i.test(entry)),
      relevant.filter((entry) => /pick|click|dismiss/i.test(entry)).join(' | '));
  } finally {
    await browser.close();
  }

  void REPO_ROOT;
  if (failures.length) {
    console.error(`\n[qa] FAILED (${failures.length}):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('\n[qa] PASS');
  }
}

main().catch((error) => {
  console.error('[qa] harness error:', error);
  process.exitCode = 1;
});
