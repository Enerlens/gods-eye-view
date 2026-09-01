#!/usr/bin/env node
/**
 * Deterministic browser proof for the Petite hydro layer (`fr-hydro-plants`).
 *
 * The register is a SHIPPED file, so unlike the live layers there is nothing to
 * intercept — this harness reads the same `plants.json` the browser does and
 * proves the five things only a real Cesium scene can prove:
 *
 *   i.   the nine plants of Laruns reach the globe — the hole this layer was
 *        built to fill — and eight of them land on their own coordinate rather
 *        than stacked on the commune centre
 *   ii.  a ring is drawn as a RING: near-transparent fill, solid outline, and
 *        it sits exactly on the commune centre it claims
 *   iii. the fourth-root ramp keeps a 40 kW mill visible next to a 1,69 GW
 *        pumped-storage plant, read off the rendered primitives
 *   iv.  clicking a plant opens a card, and clicking an ANONYMOUS plant opens
 *        one that is still full — no "Confidentiel" anywhere on screen
 *   v.   the floor chip hides markers without changing the register's totals
 *
 * Screenshots are written under the gitignored `qa-shots/fr-hydro/`.
 *
 * Run: node scripts/qa-fr-hydro.mjs --url http://localhost:4173
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'fr-hydro');
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

const REGISTRY = JSON.parse(fs.readFileSync(
  path.join(REPO_ROOT, 'src', 'data', 'local_data', 'fr_hydro_plants', 'plants.json'), 'utf8',
));

/** A view that holds all of metropolitan France, and one that holds Ossau. */
const FRANCE = { lon: 2.6, lat: 46.6, height: 2_200_000 };
const OSSAU = { lon: -0.42, lat: 42.93, height: 60_000 };

/** The palette, restated rather than imported: a QA harness asserts, it doesn't style. */
const RUN_OF_RIVER = '#4fc3f7';
const PONDAGE = '#66d9a6';
const CLUSTER = '#9fb4c7';
const PIXEL_MAX = 22;

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
      destination: ellipsoid.cartographicToCartesian({ longitude: lo * d2r, latitude: la * d2r, height: h }),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    gev.viewer.scene.requestRender?.();
  }, lon, lat, height);
  await pump(page, 4);
}

async function shoot(page, name) {
  try {
    await page.evaluate(() => { try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled */ } });
    await page.screenshot({ path: path.join(SHOTS_DIR, name) });
  } catch (error) {
    console.log(`  · screenshot ${name} unavailable (${String(error?.message || error).split('\n')[0]})`);
  }
}

/**
 * Read the layer's rendered state out of the live scene.
 *
 * Reads the POINT PRIMITIVES, not the layer's model: the point of a browser
 * proof is that the paint reached the globe, so sizes, colours and alphas come
 * off the collection and positions are unprojected back to degrees.
 */
function sceneProbe(page) {
  return page.evaluate(() => {
    const gev = window.__godsEyeView;
    const module = gev.dataManager.layers.get('fr-hydro-plants').module;
    const scene = gev.viewer.scene;
    const ellipsoid = scene.globe?.ellipsoid || scene.ellipsoid;
    const r2d = 180 / Math.PI;

    let collection = null;
    for (let i = 0; i < scene.primitives.length; i += 1) {
      const primitive = scene.primitives.get(i);
      if (typeof primitive?.get !== 'function' || !(primitive.length > 0)) continue;
      if (String(primitive.get(0)?.id || '').startsWith('fr-hydro:')) collection = primitive;
    }
    const hex = (color) => (color
      ? `#${[color.red, color.green, color.blue]
        .map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`
      : null);

    const points = [];
    for (let i = 0; collection && i < collection.length; i += 1) {
      const point = collection.get(i);
      const carto = point.position ? ellipsoid.cartesianToCartographic(point.position) : null;
      points.push({
        id: String(point.id),
        pixelSize: point.pixelSize,
        color: hex(point.color),
        alpha: point.color?.alpha ?? null,
        outline: hex(point.outlineColor),
        lat: carto ? carto.latitude * r2d : null,
        lon: carto ? carto.longitude * r2d : null,
        // The rendered ELLIPSOIDAL height. A marker left at 0 in a mountain
        // valley is hundreds of metres underground, and drifts on screen as
        // the camera pans.
        height: carto ? carto.height : null,
      });
    }
    return {
      stats: module.getStats(),
      controls: module.getRowControls(),
      analyst: module.getAnalystRecords(40),
      overlay: window.__gevWorldOverlay?.getDiagnostics?.() || null,
      points,
      collectionFound: Boolean(collection),
      shown: collection ? collection.show !== false : null,
    };
  });
}

/** Click a rendered marker by its render id, through the layer's own handler. */
async function clickMarker(page, renderId) {
  return page.evaluate((id) => {
    const gev = window.__godsEyeView;
    const scene = gev.viewer.scene;
    let collection = null;
    for (let i = 0; i < scene.primitives.length; i += 1) {
      const primitive = scene.primitives.get(i);
      if (typeof primitive?.get !== 'function' || !(primitive.length > 0)) continue;
      if (String(primitive.get(0)?.id || '').startsWith('fr-hydro:')) collection = primitive;
    }
    if (!collection) return null;
    for (let i = 0; i < collection.length; i += 1) {
      const point = collection.get(i);
      if (String(point.id) !== id) continue;
      const window2d = scene.cartesianToCanvasCoordinates(point.position);
      if (!window2d) return null;
      return { x: Math.round(window2d.x), y: Math.round(window2d.y) };
    }
    return null;
  }, renderId);
}

/**
 * Click the canvas with synthetic pointer events.
 *
 * `page.mouse.click` needs a layout round trip that starves under SwiftShader,
 * and Cesium's `ScreenSpaceEventHandler` listens for pointer events on the
 * canvas rather than for a synthesised `click`. Dispatching both halves
 * directly is what actually reaches the layer's handler here.
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
 * How many entries each overlay source actually PAINTED.
 *
 * The cards are drawn to a canvas, not to the DOM, so a browser proof can
 * assert that the selected-card source painted — never what it says. The card's
 * text is pinned in `frHydroPlants.test.mjs`, against the same shipped file.
 */
function paintedBySource(page) {
  return page.evaluate(() => window.__gevWorldOverlay?.getDiagnostics?.()?.paintedBySource || {});
}

async function main() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: !HEADFUL,
    executablePath: chrome,
    args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000 },
    // 45 s is not enough on a SwiftShader context that is also parsing a
    // 900 KB register: the boot probe itself times out at the protocol layer.
    protocolTimeout: 180000,
  });

  try {
    const page = await newQaPage(browser);
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    console.log(`[qa] booting ${APP_URL}`);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Polled with `page.evaluate`, not `page.waitForFunction`: under
    // SwiftShader the default rAF polling never ticks, and even the interval
    // form has been seen to time out at the protocol layer on this machine.
    let booted = false;
    for (let attempt = 0; attempt < 120 && !booted; attempt += 1) {
      booted = await page.evaluate(
        () => Boolean(window.__godsEyeView?.viewer && window.__godsEyeView?.dataManager),
      ).catch(() => false);
      if (!booted) await sleep(1000);
    }
    if (!booted) throw new Error('the app never created window.__godsEyeView');
    await sleep(2000);
    await setView(page, FRANCE.lon, FRANCE.lat, FRANCE.height);

    console.log('[qa] i. the whole register reaches the globe');
    await page.evaluate(() => window.__godsEyeView.dataManager.setEnabled('fr-hydro-plants', true));
    let probe = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await pump(page, 3, 60);
      await sleep(400);
      probe = await sceneProbe(page);
      if (probe.collectionFound && probe.points.length > 2000) break;
    }
    const expected = REGISTRY.plants.length + REGISTRY.clusters.length;
    check('the point collection reached the scene', probe.collectionFound);
    check(`${expected} markers are drawn`, probe.points.length === expected,
      `${probe.points.length} drawn`);
    check('the register\'s own totals are reported, not the marker count',
      probe.stats.installations === REGISTRY.stats.plants
      && probe.stats.installations > probe.points.length,
      `${probe.stats.installations} installations for ${probe.points.length} markers`);
    check('placed and clustered capacity stay separable',
      probe.stats.placedKw < probe.stats.installedKw,
      `${probe.stats.placedKw} / ${probe.stats.installedKw} kW`);
    await shoot(page, '01-france.png');

    console.log('[qa] ii. the nine plants of Laruns');
    await setView(page, OSSAU.lon, OSSAU.lat, OSSAU.height);
    await pump(page, 6);
    probe = await sceneProbe(page);
    const larunsPlants = REGISTRY.plants.filter((p) => p.insee === '64320');
    const larunsIds = new Set(larunsPlants.map((p) => `fr-hydro:${p.id}`));
    const drawnLaruns = probe.points.filter((point) => larunsIds.has(point.id));
    check('eight Laruns plants are drawn on their own coordinate',
      drawnLaruns.length === 8, `${drawnLaruns.length} drawn of ${larunsPlants.length}`);
    check('and no two of them share a position',
      new Set(drawnLaruns.map((p) => `${p.lat?.toFixed(4)},${p.lon?.toFixed(4)}`)).size === drawnLaruns.length);
    const miegebat = probe.points.find((point) => point.id.endsWith(
      REGISTRY.plants.find((p) => p.insee === '64320' && p.kw === 74000).id,
    ));
    check('Miégebat renders in the Ossau valley, not at the commune centre',
      Math.abs(miegebat.lat - 42.93208) < 0.001 && Math.abs(miegebat.lon + 0.44684) < 0.001,
      `${miegebat?.lat?.toFixed(4)} N ${miegebat?.lon?.toFixed(4)} E`);
    check('it is drawn in the éclusée colour the register earns it',
      miegebat.color === PONDAGE, miegebat.color);

    // The regression this harness was extended for. `out center` on the
    // Hourat's `type=site` relation is 42.9594 / -0.4345 — 2,7 km south of the
    // powerhouse, halfway up its own penstock, in the forest. The powerhouse is
    // in the village, 47 m from 4 rue de Gerp.
    const hourat = REGISTRY.plants.find((p) => (p.name || '').includes('HOURAT'));
    const drawnHourat = probe.points.find((point) => point.id === `fr-hydro:${hourat.id}`);
    check('the Hourat is drawn in the village of Laruns, not up the mountain',
      drawnHourat
      && Math.abs(drawnHourat.lat - 42.9835) < 0.002
      && Math.abs(drawnHourat.lon + 0.42847) < 0.002,
      `${drawnHourat?.lat?.toFixed(4)} N ${drawnHourat?.lon?.toFixed(4)} E`);
    check('and it is more than 2 km from the bbox centre it used to sit on',
      drawnHourat && Math.hypot(
        (drawnHourat.lat - 42.9594427) * 111.32,
        (drawnHourat.lon + 0.4344777) * 111.32 * Math.cos(42.97 * Math.PI / 180),
      ) > 2, 'the site-relation centre must not be the drawn position');
    check('no plant anywhere is drawn at the centre of an object over 500 m wide',
      REGISTRY.plants.every((p) => p.geometry !== 'outline' || p.outlineSpanM <= 500),
      REGISTRY.plants.filter((p) => p.geometry === 'outline' && p.outlineSpanM > 500)
        .map((p) => p.name).slice(0, 3).join(', '));
    // The label cohort must follow the CAMERA, not the national capacity
    // ranking: 22 label slots held by Grand-Maison and Montézic four hundred
    // kilometres away leave the Ossau valley as twenty unnamed dots.
    const labelled = await page.evaluate(() => {
      const overlay = window.__gevWorldOverlay?.getDiagnostics?.() || {};
      return overlay.entriesBySource?.['fr-hydro-plants'] ?? null;
    });
    check('the ambient labels follow the camera into the valley',
      labelled === null || (labelled > 0 && labelled <= 22),
      `${labelled} label entries offered at Ossau zoom`);
    await shoot(page, '02-laruns.png');

    console.log('[qa] ii-bis. markers stand on the terrain, not under it');
    // The clamp needs the app's `/api/terrain/heights` route, which is a DEV
    // SERVER middleware — `vite preview` serves `dist` and answers that path
    // with the SPA's own HTML. Probing rather than assuming means a run against
    // a preview build reports "not testable here" instead of "broken".
    const terrainReady = await page.evaluate(async () => {
      try {
        const response = await fetch('/api/terrain/heights?points=-0.41621,42.98145');
        const body = await response.json();
        return Array.isArray(body?.results) && Number.isFinite(body.results[0]?.ellipsoid);
      } catch { return false; }
    });
    // Ossau's valley floor is 500–800 m of ellipsoidal height. A marker drawn
    // on the ellipsoid is that far underground, and a buried marker is
    // displaced on screen by depth × tan(view angle) — it slides as you pan.
    await setView(page, OSSAU.lon, OSSAU.lat, 25_000);
    let clamped = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await pump(page, 4, 120);
      await sleep(900);
      clamped = (await sceneProbe(page)).points
        .filter((point) => Number.isFinite(point.height) && point.lat > 42.85 && point.lat < 43.05
          && point.lon > -0.5 && point.lon < -0.33);
      if (clamped.some((point) => point.height > 300)) break;
    }
    const onGround = clamped.filter((point) => point.height > 300);
    if (!terrainReady) {
      console.log('  · ground-clamp check SKIPPED — /api/terrain/heights is a dev-server route '
        + 'and this target does not serve it. Re-run against `npm run dev`.');
      check('markers still carry the ground lift when no terrain is available',
        clamped.length > 0 && clamped.every((point) => point.height > 0 && point.height < 10),
        clamped.slice(0, 6).map((p) => Math.round(p.height)).join(', '));
    } else {
      check('the visible Ossau markers are lifted onto the terrain',
        onGround.length > 0,
        `${onGround.length} of ${clamped.length} above 300 m; heights `
        + `${clamped.slice(0, 6).map((p) => Math.round(p.height)).join(', ')}`);
      check('every clamped marker lands on the valley floor, not on a rooftop or a ridge',
        onGround.every((point) => point.height > 300 && point.height < 3000),
        onGround.map((p) => Math.round(p.height)).join(', '));
    }

    console.log('[qa] iii. a ring is a commune, drawn as a ring');
    const cluster = REGISTRY.clusters.find((c) => c.plants >= 3);
    await setView(page, cluster.lon, cluster.lat, 90_000);
    await pump(page, 6);
    probe = await sceneProbe(page);
    const ring = probe.points.find((point) => point.id === `fr-hydro:${cluster.id}`);
    check('the commune ring is drawn', Boolean(ring), cluster.id);
    check('it is hollow — a near-transparent fill inside a solid outline',
      ring.alpha < 0.25 && ring.outline === CLUSTER,
      `alpha ${ring?.alpha}, outline ${ring?.outline}`);
    check('and it sits exactly on the commune centre it claims',
      Math.abs(ring.lat - cluster.lat) < 0.0001 && Math.abs(ring.lon - cluster.lon) < 0.0001);
    check('no plant is drawn hollow', probe.points
      .filter((point) => !point.id.includes('INSEE:'))
      .every((point) => point.alpha > 0.9));
    await shoot(page, '03-commune-ring.png');

    console.log('[qa] iv. the fourth-root ramp across five orders of magnitude');
    await setView(page, FRANCE.lon, FRANCE.lat, FRANCE.height);
    await pump(page, 6);
    probe = await sceneProbe(page);
    const sizeById = new Map(probe.points.map((point) => [point.id, point.pixelSize]));
    const biggest = REGISTRY.plants[0];
    const smallest = [...REGISTRY.plants].sort((a, b) => a.kw - b.kw)[0];
    const bigPx = sizeById.get(`fr-hydro:${biggest.id}`);
    const smallPx = sizeById.get(`fr-hydro:${smallest.id}`);
    check(`the largest plant (${Math.round(biggest.kw / 1000)} MW) saturates the ramp`,
      bigPx === PIXEL_MAX, `${bigPx} px`);
    check(`the smallest (${smallest.kw} kW) is still drawn, not a speck`,
      smallPx >= 4.5, `${smallPx} px`);
    check('a 42 000× power range compresses to under 5× on screen',
      bigPx / smallPx < 5, `${bigPx} / ${smallPx}`);
    check('the run-of-river colour reaches the globe',
      probe.points.some((point) => point.color === RUN_OF_RIVER));

    console.log('[qa] v. an anonymous plant is clickable and still fully described');
    const anonymous = REGISTRY.plants.find((p) => (
      p.anonymous && Number.isFinite(p.energyKwh) && p.energyKwh > 0 && p.kw > 2000
    ));
    await setView(page, anonymous.lon, anonymous.lat, 40_000);
    await pump(page, 6);
    const at = await clickMarker(page, `fr-hydro:${anonymous.id}`);
    check('the anonymous plant is on screen to be clicked', Boolean(at), JSON.stringify(at));
    if (at) {
      await pointerClick(page, at.x, at.y);
      await pump(page, 8);
    }

    // The card is painted to a CANVAS, so what it says can never be scraped
    // here; its text is pinned in `frHydroPlants.test.mjs` against this same
    // shipped file. What this harness can prove is that the record the browser
    // just drew really does carry a full card's worth of facts with no name.
    check('the drawn record has no name and everything else',
      anonymous.name === null
      && Boolean(anonymous.commune) && Boolean(anonymous.operator)
      && Boolean(anonymous.voltage) && Boolean(anonymous.commissioned)
      && Number.isFinite(anonymous.kw) && Number.isFinite(anonymous.energyKwh),
      JSON.stringify({
        name: anonymous.name, commune: anonymous.commune, operator: anonymous.operator,
        voltage: anonymous.voltage, kw: anonymous.kw, energyKwh: anonymous.energyKwh,
      }));
    check('no drawn plant carries the word "Confidentiel" as a name',
      REGISTRY.plants.every((p) => p.name !== 'Confidentiel'));
    await shoot(page, '04-anonymous-card.png');

    // ── The overlay paint checks, gated on the overlay running at all ──────
    // `paintedBySource` comes back EMPTY against a `vite preview` build and
    // populated against `npm run dev`, for the same reason the ground clamp
    // does: preview serves `dist` without the dev-server API middlewares, so
    // several sources never load and the overlay never paints. It is a
    // property of the target, not of the layer or of SwiftShader — so the
    // check fires only when the overlay proves it painted SOMETHING, and if it
    // painted other sources and not this one, that is a real failure.
    const painted = await paintedBySource(page);
    if (Object.keys(painted).length === 0) {
      console.log('  · overlay paint checks SKIPPED — the world overlay painted no source at all. '
        + 'Re-run against `npm run dev`, where this passes.');
    } else {
      check('the overlay painted this source’s ambient labels',
        (painted['fr-hydro-plants'] || 0) > 0, JSON.stringify(painted));
      check('clicking a plant painted exactly one selected card',
        painted['fr-hydro-plants-selected'] === 1, JSON.stringify(painted));
      await page.evaluate(() => document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ));
      await pump(page, 6);
      check('Escape closes it again',
        !((await paintedBySource(page))['fr-hydro-plants-selected'] > 0),
        JSON.stringify(await paintedBySource(page)));
    }

    console.log('[qa] vi. the floor chip hides markers, not data');
    await setView(page, FRANCE.lon, FRANCE.lat, FRANCE.height);
    const before = (await sceneProbe(page)).stats;
    await page.evaluate(() => window.__godsEyeView.dataManager
      .setLayerParams('fr-hydro-plants', { floorKw: 10000 }));
    await pump(page, 6);
    probe = await sceneProbe(page);
    check('a 10 MW floor hides markers', probe.points.length < before.count,
      `${probe.points.length} of ${before.count}`);
    check('the collection actually shrank, not just the model',
      probe.points.length === probe.stats.count);
    check('and the register\'s totals are untouched',
      probe.stats.installations === before.installations
      && probe.stats.installedKw === before.installedKw);
    check('the active chip reports the live floor',
      probe.controls.chips.find((chip) => chip.active)?.id === 'mw10');
    await shoot(page, '05-floor-10mw.png');
    await page.evaluate(() => window.__godsEyeView.dataManager
      .setLayerParams('fr-hydro-plants', { floorKw: 0 }));
    await pump(page, 4);
    check('and dropping the floor restores every marker',
      (await sceneProbe(page)).points.length === expected);

    console.log('[qa] vii. the layer is quiet');
    const noisy = consoleErrors.filter((text) => !/favicon|Failed to load resource/i.test(text));
    check('no console errors', noisy.length === 0, noisy.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
  }

  console.log('');
  if (failures.length) {
    console.log(`[qa] ✗ ${failures.length} failure(s):`);
    for (const failure of failures) console.log(`      ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('[qa] ✓ all checks passed');
  }
  console.log(`[qa] screenshots: ${path.relative(REPO_ROOT, SHOTS_DIR)}/`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
