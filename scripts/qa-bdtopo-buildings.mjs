#!/usr/bin/env node
/**
 * Deterministic browser proof for the French building layer (`bdtopo-buildings`).
 *
 * Unlike the gas and grid harnesses this one runs LIVE against IGN's own tile
 * service rather than an intercepted fixture, for a reason worth stating: the
 * layer has no proxy to intercept. It reads `data.geopf.fr/tms` straight from
 * the browser, so the only honest end-to-end check is the real one. The trade
 * is that a Géoplateforme outage fails this harness; `npm test` holds the
 * schema and the arithmetic against a captured fixture and does not.
 *
 * What it proves, in order:
 *   1. the layer draws real buildings over Lyon on a keyless globe stack;
 *   2. their floors are re-anchored onto the surface the globe renders, at a
 *      bounded cost in terrain samples;
 *   3. the seating bases are reported separately, not averaged;
 *   4. a real click selects a building and publishes exactly one card, and
 *      Escape takes it away;
 *   5. a viewport that is too wide, or outside France, says which instead of
 *      failing silently;
 *   6. a viewport the Géoplateforme only PARTLY answers still draws, and says
 *      it is incomplete rather than reporting the layer dead;
 *   7. toggling the layer off leaves nothing drawn and nothing selected.
 *
 * ── Two things this harness works around, both the app being itself ─────────
 *
 * • **The render governor renders on demand.** `waitForFunction` polls with
 *   requestAnimationFrame by default, and rAF can be starved here for as long
 *   as the governor stays idle — the predicate is then never evaluated and the
 *   wait times out while the app is perfectly healthy. Every wait below polls
 *   on an interval instead.
 * • **`camera.setView` does not fire `moveEnd`.** The layer loads on camera
 *   settle, so a harness that teleports the camera and waits sees nothing
 *   happen. Each move is followed by an explicit `update()` — the same refresh
 *   the data manager runs on its own interval.
 *
 * Screenshots land in the gitignored `qa-shots/bdtopo-buildings/`.
 *
 * Run: node scripts/qa-bdtopo-buildings.mjs --url http://localhost:5173
 */
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newQaPage } from './lib/qa-first-run.mjs';
import { MAX_GROUND_CORRECTION_M } from '../src/data/bdtopoBuildingsFeed.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'bdtopo-buildings');
const LAYER_ID = 'bdtopo-buildings';

const argUrl = process.argv.indexOf('--url');
const URL_BASE = argUrl >= 0 ? process.argv[argUrl + 1] : 'http://localhost:5173';

/** Fourvière and the Saône, obliquely — a district-sized load. */
const LYON_WIDE = { lon: 4.8237, lat: 45.7605, height: 1400, pitch: -45 };
/**
 * The same place from almost straight down. A near-nadir view has no horizon in
 * it, so the request box is a few hundred metres rather than several kilometres
 * — the difference between a few hundred extruded polygons and fourteen
 * thousand. A headless run has no GPU, and SwiftShader cannot rasterise the
 * latter inside any sane screenshot timeout.
 */
const LYON_TIGHT = { lon: 4.8237, lat: 45.7605, height: 600, pitch: -80 };
/** A continental view of France: in coverage, far too wide to load. */
const FRANCE_WIDE = { lon: 4.8237, lat: 45.7605, height: 260_000, pitch: -90 };
/** Mid-Atlantic: no BD TOPO, and the layer has to say that rather than retry. */
const ATLANTIC = { lon: -30, lat: 40, height: 1400, pitch: -45 };

const failures = [];
const check = (ok, label, detail = '') => {
  if (ok) console.log(`  ✔ ${label}`);
  else { failures.push(`${label}${detail ? ` — ${detail}` : ''}`); console.log(`  ✖ ${label} ${detail}`); }
};

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

mkdirSync(SHOTS_DIR, { recursive: true });

const browser = await puppeteer.launch({
  headless: 'new',
  // The app renders on demand and this run has no GPU, so a frame can take a
  // long time to arrive. The default 180 s protocol timeout is not enough.
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
  // Device scale 1 on purpose: at 2 this is a 3200x1900 WebGL surface, which a
  // software renderer takes minutes to boot.
  await page.setViewport({ width: 1440, height: 860 });

  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

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

  // A keyless globe stack, which is where this layer is meant to be looked at:
  // on Google 3D the photoreal mesh already contains these buildings.
  await page.evaluate(async () => {
    await window.__godsEyeView.mapStackController?.setStack?.('osm');
  });
  await settle(4_000);

  const stats = () => page.evaluate((layerId) => {
    const module = window.__godsEyeView.dataManager.layers.get(layerId)?.module;
    return module?.getStats?.() || null;
  }, LAYER_ID);

  /** Teleport, then ask the layer to reload — `setView` fires no `moveEnd`. */
  const goTo = async (site, { refresh = true } = {}) => {
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
    await settle(2_000);
    if (refresh) {
      await page.evaluate(
        (layerId) => window.__godsEyeView.dataManager.layers.get(layerId)?.module?.update?.(),
        LAYER_ID,
      );
      await settle(7_000);
    }
  };

  /**
   * Screenshot.
   *
   * `captureScreenshot` waits for the compositor to commit a NEW frame, and
   * this app renders on demand — a single `requestRender()` produces one frame
   * that the capture can easily miss, and then nothing else is ever drawn, so
   * the capture waits out its whole timeout. Continuous rendering is turned on
   * for the duration of the shot and put back afterwards.
   */
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
      // Best-effort by design: the proof is the assertions, and a software
      // rasteriser that cannot finish a frame must not fail a healthy layer.
      console.log(`  … screenshot ${name} skipped (${error.message.split('\n')[0]})`);
    }
    if (restore !== null) {
      await page.evaluate((value) => {
        const scene = window.__godsEyeView?.viewer?.scene;
        if (scene) scene.requestRenderMode = value;
      }, restore);
    }
  };

  // ── 1. the layer is registered and draws over Lyon ───────────────────────
  console.log('\n[qa] Lyon — Fourvière, oblique');
  check(
    await page.evaluate((layerId) => !!window.__godsEyeView.dataManager.layers.get(layerId), LAYER_ID),
    'layer is registered with the data manager',
  );

  await goTo(LYON_WIDE, { refresh: false });
  await page.evaluate(
    (layerId) => window.__godsEyeView.dataManager.setEnabled(layerId, true, { origin: 'user' }),
    LAYER_ID,
  );
  await page.waitForFunction((layerId) => {
    const s = window.__godsEyeView.dataManager.layers.get(layerId)?.module?.getStats?.();
    return s && (s.count > 0 || s.error);
  }, { polling: 250, timeout: 90_000 }, LAYER_ID).catch(() => {});
  await settle(9_000);

  const lyon = await stats();
  console.log('  stats:', JSON.stringify(lyon));
  check(!lyon?.error, 'no load error', lyon?.error || '');
  check((lyon?.count || 0) > 500, 'draws a city-sized building set', `count=${lyon?.count}`);
  check((lyon?.volumes || 0) >= (lyon?.count || 0),
    'volumes >= distinct buildings (split footprints are drawn, counted once)');
  check((lyon?.dwellings || 0) > 0, 'dwelling counts survive the projection');
  check((lyon?.tallestM || 0) > 10, 'heights are real metres', `tallest=${lyon?.tallestM}`);
  check((lyon?.rnbCoverage || 0) > 0.9, 'buildings keep their national identifier', `rnb=${lyon?.rnbCoverage}`);

  // ── 2. the buildings are seated on the ground the globe draws ────────────
  check(Number.isFinite(lyon?.datumOffsetM), 'a datum offset was computed', `offset=${lyon?.datumOffsetM}`);
  check((lyon?.datumCells || 0) > 0, 'at least one offset cell was trusted on its own',
    `cells=${lyon?.datumCells}/${lyon?.datumCellsRequested}`);
  check((lyon?.datumCellsRequested || 0) <= 200,
    'the coarse DEM fallback stays bounded when it is needed at all',
    `requested=${lyon?.datumCellsRequested}`);
  check(Math.abs(lyon?.datumOffsetM ?? 999) < 120,
    'the offset is a terrain disagreement, not a datum blunder', `offset=${lyon?.datumOffsetM}`);
  // Fourvière is a hill, and a hill is where the old cell-centre sampling
  // turned 40 m of relief into 40 m of daylight under a whole block. What is
  // left after a per-building measurement is the mesh disagreeing with the
  // survey, which over a 30 m global terrain is metres — not tens of metres.
  check(Number.isFinite(lyon?.groundGapMedianM) && lyon.groundGapMedianM < 8,
    'on a hillside the survey and the rendered mesh agree to a few metres',
    `median=${lyon?.groundGapMedianM} worst5%=${lyon?.groundGapWorstM}`);
  check((lyon?.groundGapWorstM ?? 999) < MAX_GROUND_CORRECTION_M,
    'and the worst of them is still a residual, not a bad sample',
    `worst5%=${lyon?.groundGapWorstM}`);

  // ── 3. seating bases are reported apart ──────────────────────────────────
  const basis = lyon?.basis || {};
  const basisTotal = Object.values(basis).reduce((sum, n) => sum + n, 0);
  console.log('  basis:', JSON.stringify(basis));
  check(basisTotal === lyon?.count, 'every counted building has a stated basis', `${basisTotal} vs ${lyon?.count}`);
  check((basis.published || 0) > 0, 'Lyon buildings stand on their two published altitudes');
  check((basis.height || 0) > 0, 'and the ones with no roof altitude stand on floor + height');

  // ── 4. selection, through the real click path, on a light viewport ───────
  console.log('\n[qa] Lyon — near nadir, pick and card');
  await goTo(LYON_TIGHT);
  const tight = await stats();
  console.log('  stats:', JSON.stringify({ count: tight?.count, volumes: tight?.volumes, saturated: tight?.saturated }));
  check((tight?.count || 0) > 0, 'a tighter viewport still draws buildings', `count=${tight?.count}`);
  await shoot('01-lyon.png');

  const target = await page.evaluate(async () => {
    const viewer = window.__godsEyeView.viewer;
    const width = viewer.canvas.clientWidth;
    const height = viewer.canvas.clientHeight;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // The batched primitive tessellates in a worker pool, so the first frames
    // after a load have nothing to pick. Poll rather than assume.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      viewer.scene.requestRender();
      await sleep(1_000);
      for (let dy = -120; dy <= 120; dy += 20) {
        for (let dx = -200; dx <= 200; dx += 20) {
          const x = width / 2 + dx;
          const y = height / 2 + dy;
          const picked = viewer.scene.pick({ x, y });
          const id = typeof picked?.id === 'string' ? picked.id : null;
          if (id && id.startsWith('bdtopo:')) return { id, x, y, attempt };
        }
      }
    }
    return null;
  });
  console.log('  pick:', JSON.stringify(target));
  check(!!target?.id, 'a drawn building is pickable from the scene');

  if (target) {
    // A real mouse click, not a test hook: the click handler, the pick
    // resolver and the overlay publish are the path that can actually break.
    const cardsFor = () => page.evaluate(() => window.__gevWorldOverlay?.getDiagnostics?.()
      ?.entriesBySource?.['bdtopo-buildings-selected'] ?? 0);

    await page.mouse.click(target.x, target.y);
    await settle(1_500);
    const cards = await cardsFor();
    check(cards === 1, 'clicking a building publishes exactly one card', `cards=${cards}`);
    await shoot('02-lyon-selected.png');

    await page.keyboard.press('Escape');
    await settle(1_000);
    check((await cardsFor()) === 0, 'Escape clears the card');
  }

  // ── 5. the two honest empty states ───────────────────────────────────────
  console.log('\n[qa] empty states');
  await goTo(FRANCE_WIDE);
  const wide = await stats();
  check(/zoom/i.test(wide?.loadingLabel || ''),
    'a continental view of France asks for a zoom instead of loading', wide?.loadingLabel || '(none)');
  check(!wide?.error, 'a too-wide view is not an error state');

  await goTo(ATLANTIC);
  const away = await stats();
  check(/couverture/i.test(away?.loadingLabel || ''),
    'outside France the layer names the coverage limit', away?.loadingLabel || '(none)');
  check(!away?.error, 'being outside France is not an error state');

  // ── 6. a Géoplateforme that refuses part of the viewport ─────────────────
  //
  // The one failure this harness CANNOT wait for the real service to produce,
  // and the one that took the layer down on the hosted deployment: a city box
  // is 24–60 separate tile requests against a free service that rate-limits at
  // 400 req/min, and gathering them with `Promise.all` let one 503 out of
  // sixty report the whole layer UNAVAILABLE with fifty-nine good tiles in
  // hand. So the refusal is injected here rather than hoped for.
  //
  // The refusal is injected by wrapping `window.fetch` rather than through
  // Puppeteer's request interception: `request.continue()` re-issues the tile
  // request without its CORS preflight, so every SURVIVING tile would fail too
  // and the harness would be proving the wrong outage.
  console.log('\n[qa] a partial Géoplateforme outage');
  await page.evaluate(() => {
    window.__qaTileRefusals = 0;
    window.__qaRealFetch = window.fetch;
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (/data\.geopf\.fr\/tms\/1\.0\.0\/BDTOPO\//.test(url)) {
        window.__qaTileRefusals += 1;
        if (window.__qaTileRefusals % 4 === 0) {
          return Promise.resolve(new Response('rate limited', { status: 503 }));
        }
      }
      return window.__qaRealFetch(input, init);
    };
  });
  await goTo(LYON_WIDE);
  const partial = await stats();
  console.log('  stats:', JSON.stringify({
    status: partial?.status,
    count: partial?.count,
    missingTiles: partial?.missingTiles,
    degraded: partial?.degraded,
    error: partial?.error,
  }));
  check((partial?.missingTiles || 0) > 0, 'the injected refusals actually reached the layer',
    `missing=${partial?.missingTiles}`);
  check((partial?.count || 0) > 500, 'the squares that answered are still drawn', `count=${partial?.count}`);
  check(!partial?.error && partial?.status === 'ok',
    'a partial answer is not reported as a dead layer', partial?.error || '');
  check(partial?.degraded === true, 'but it IS reported as incomplete, not as the whole city');
  check(/tuiles? BD TOPO refusées?/.test(partial?.loadingLabel || ''),
    'and the row names the shortfall', partial?.loadingLabel || '(none)');
  await page.evaluate(() => {
    if (window.__qaRealFetch) window.fetch = window.__qaRealFetch;
  });

  // ── 7. toggle off ────────────────────────────────────────────────────────
  console.log('\n[qa] teardown');
  await goTo(LYON_TIGHT);
  await page.evaluate(
    (layerId) => window.__godsEyeView.dataManager.setEnabled(layerId, false, { origin: 'user' }),
    LAYER_ID,
  );
  await settle(2_500);
  const off = await page.evaluate((layerId) => ({
    stats: window.__godsEyeView.dataManager.layers.get(layerId).module.getStats(),
    cards: window.__gevWorldOverlay?.getDiagnostics?.()?.entriesBySource?.['bdtopo-buildings-selected'] ?? 0,
  }), LAYER_ID);
  check(!off.cards, 'disabling clears the card', `cards=${off.cards}`);
  check(!off.stats.loading, 'disabling stops the layer loading');

  const relevant = consoleErrors.filter((text) => /bdtopo|geopf/i.test(text));
  check(relevant.length === 0, 'no console errors from this layer', relevant.slice(0, 3).join(' | '));

  console.log(`\n[qa] screenshots -> ${SHOTS_DIR}`);
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\n[qa] bdtopo-buildings: ${failures.length} check(s) failed`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('\n[qa] bdtopo-buildings: all checks passed');
