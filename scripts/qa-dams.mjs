#!/usr/bin/env node
/**
 * QA the dams layer in a real browser.
 *
 *   local-dams  OpenStreetMap, bundled pack (6,189 ouvrages, 5,529 in France)
 *
 * The regression this harness exists to catch is the one the layer shipped with
 * for a year: a France fork where "Barrages" switched on and drew 44 objects.
 * So the checks are, in order:
 *
 *   1. FRANCE IS ACTUALLY THERE. A count alone cannot say that — the old pack
 *      also reported a healthy 704 — so the French features are counted inside
 *      a metropolitan box, and Serre-Ponçon is looked up by name.
 *   2. THE PROPERTIES SURVIVE the pack → GeoJSON → Cesium round trip, because
 *      the card is written from them and a dropped field reads as a blank line.
 *   3. THE LADDER IS VISIBLE: three dot sizes, three legend rows, and a floor
 *      that removes markers from the globe and gives them back.
 *
 * Usage: node scripts/qa-dams.mjs [--url http://localhost:4174] [--headful]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { firstRunLauncherSuppressed, newQaPage } from './lib/qa-first-run.mjs';

const args = process.argv.slice(2);
const getOpt = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = getOpt('--url', 'http://localhost:4174').replace(/\/$/, '');
const HEADFUL = args.includes('--headful');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOT_DIR = path.join(ROOT, 'qa-shots', 'dams');

/** Rebuilt 2026-09-01. Floors, not equalities — see the pack's README. */
const MIN_FEATURES = 5800;
const MIN_FRENCH = 5000;

const CHROME_CANDIDATES = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  (() => { try { return puppeteer.executablePath(); } catch { return null; } })(),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  [${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** Poll until `check` returns truthy or the budget runs out. */
async function waitFor(page, check, { timeoutMs = 60_000, everyMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(check);
    if (last) return last;
    await sleep(everyMs);
  }
  return last;
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const executablePath = CHROME_CANDIDATES.find((candidate) => {
    try { return fs.existsSync(candidate); } catch { return false; }
  });

  const browser = await puppeteer.launch({
    headless: HEADFUL ? false : 'new',
    ...(executablePath ? { executablePath } : {}),
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist',
      '--disable-dev-shm-usage', '--window-size=1440,900',
    ],
  });

  const consoleErrors = [];
  try {
    const page = await newQaPage(browser);
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300));
    });
    page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message.slice(0, 300)}`));

    console.log(`\nOpening ${APP_URL} …`);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });

    const ready = await waitFor(page, () => !!window.__godsEyeView?.dataManager);
    record('app boots and exposes the data manager', !!ready);
    if (!ready) return;

    const registered = await page.evaluate(() => {
      const all = window.__godsEyeView.dataManager.getAll() || [];
      const entry = all.find((layer) => layer.id === 'local-dams') || null;
      return entry ? { name: entry.name, source: entry.source ?? null } : null;
    });
    record('local-dams is registered', !!registered,
      registered ? `name="${registered.name}" source=${registered.source}` : 'absent');
    record('the row is named in French and credits OpenStreetMap',
      registered?.name === 'Barrages' && registered?.source === 'OpenStreetMap',
      `name=${registered?.name} source=${registered?.source}`);

    await page.evaluate(async () => {
      const dm = window.__godsEyeView.dataManager;
      await dm.setEnabled('local-dams', true, { origin: 'user' });
      await dm.waitForLayerSettled?.('local-dams');
    });

    const stats = await waitFor(page, () => {
      const all = window.__godsEyeView.dataManager.getAll() || [];
      const entry = all.find((layer) => layer.id === 'local-dams');
      const s = entry?.stats ?? null;
      return s && (Number(s.count) > 0 || s.error) ? s : null;
    }, { timeoutMs: 90_000 });

    if (!stats) {
      record('the layer settles within 90 s', false, 'timed out');
      return;
    }

    record('layer reports no error', !stats.error, stats.error || 'clean');
    record('the pack loads every bundled feature', stats.count >= MIN_FEATURES,
      `count=${stats.count} (floor ${MIN_FEATURES})`);

    // ── What actually reached the globe ──────────────────────────────────
    const sample = await page.evaluate(() => {
      const viewer = window.__godsEyeView.styleManager?.viewer;
      const source = viewer?.dataSources?.getByName?.('Barrages')?.[0];
      const entities = source?.entities?.values ?? [];
      if (!entities.length) return null;
      const now = window.Cesium?.JulianDate?.now?.();
      const props = entities.map((entity) => entity.properties?.getValue?.(now) ?? {});
      const byName = new Map(props.filter((p) => p.name).map((p) => [p.name, p]));

      // Positions, so "is France populated?" is answered by geography rather
      // than by a field that could be right while the pack is empty. The layer
      // parks each feature's base Cartographic (radians) on the entity when it
      // builds the stem; the app does not expose Cesium on `window`, so that
      // stash is the only way to read a coordinate back from here.
      const DEG = 180 / Math.PI;
      let french = 0;
      let located = 0;
      for (const entity of entities) {
        const carto = entity.__localBaseCarto;
        if (!carto) continue;
        located += 1;
        const lon = carto.longitude * DEG;
        const lat = carto.latitude * DEG;
        if (lon >= -5.5 && lon <= 9.8 && lat >= 41.2 && lat <= 51.5) french += 1;
      }

      return {
        entities: entities.length,
        french,
        located,
        named: props.filter((p) => p.name).length,
        hydro: props.filter((p) => p.hydro === true).length,
        withSpan: props.filter((p) => Number.isFinite(p.spanM)).length,
        // The allowlist is the privacy transform; a raw tag bag reaching the
        // browser means the build stopped projecting.
        withRawTags: props.filter((p) => p.tags).length,
        serrePoncon: byName.get('Barrage de Serre-Ponçon') || null,
        roselend: byName.get('Barrage de Roselend') || null,
        vouglans: byName.get('Barrage de Vouglans') || null,
      };
    });

    record('dams render as globe entities',
      !!sample && sample.entities >= MIN_FEATURES,
      sample ? `${sample.entities} entities` : 'no data source named "Barrages"');
    if (!sample) return;

    // (1) The regression this layer shipped with: France was 44 features.
    record('France is actually populated', sample.french >= MIN_FRENCH,
      `${sample.french} inside the metropolitan box (floor ${MIN_FRENCH})`);
    record('the world half survived the rebuild',
      sample.located - sample.french > 400,
      `${sample.located - sample.french} of ${sample.located} located outside France`);

    // (2) Properties survive the round trip, and nothing else rides along.
    const serre = sample.serrePoncon;
    record('Serre-Ponçon keeps its measurements through the round trip',
      serre?.heightM === 124 && serre?.operator === 'EDF' && serre?.hydro === true,
      serre ? `heightM=${serre.heightM} operator=${serre.operator} hydro=${serre.hydro}` : 'absent');
    record('Roselend keeps its material family',
      sample.roselend?.material === 'béton' && sample.roselend?.heightM === 150,
      sample.roselend ? `${sample.roselend.heightM} m ${sample.roselend.material}` : 'absent');
    record('the allowlist held — no raw OSM tag bag reached the browser',
      sample.withRawTags === 0, `${sample.withRawTags} features carrying tags`);
    record('most features carry a measured span',
      sample.withSpan / sample.entities > 0.6,
      `${sample.withSpan} of ${sample.entities}`);

    // ── Importance is visible, and the floors work ───────────────────────
    const tiers = await page.evaluate(() => {
      const dm = window.__godsEyeView.dataManager;
      const module = dm.layers?.get?.('local-dams')?.module;
      const controls = module?.getRowControls?.() || null;
      const viewer = window.__godsEyeView.styleManager?.viewer;
      const entities = viewer?.dataSources?.getByName?.('Barrages')?.[0]?.entities?.values ?? [];
      const now = window.Cesium?.JulianDate?.now?.();
      const sizes = new Map();
      for (const entity of entities) {
        const p = entity.properties?.getValue?.(now) ?? {};
        const tier = (p.heightM >= 15 || p.hydro === true
          || (p.name && p.spanM >= 300)) ? 'major' : p.name ? 'named' : 'minor';
        const size = entity.point?.pixelSize?.getValue?.(now) ?? entity.point?.pixelSize;
        if (!sizes.has(tier)) sizes.set(tier, new Set());
        sizes.get(tier).add(Number(size));
      }
      return {
        chips: (controls?.chips || []).map((chip) => chip.id),
        legend: (controls?.legend || []).map((item) => ({ label: item.label, count: item.count })),
        sizes: [...sizes.entries()].map(([tier, set]) => [tier, [...set]]),
      };
    });

    record('the row offers the three display floors',
      tiers.chips.join(',') === 'all,named,major', tiers.chips.join(','));
    record('the legend names every tier that shipped',
      tiers.legend.length === 3,
      tiers.legend.map((item) => `${item.label}=${item.count}`).join(' · '));

    const sizeOf = new Map(tiers.sizes.map(([tier, set]) => [tier, set]));
    const oneSizePerTier = [...sizeOf.values()].every((set) => set.length === 1);
    const ladder = ['major', 'named', 'minor'].map((tier) => sizeOf.get(tier)?.[0]);
    record('each tier draws at exactly one dot size', oneSizePerTier,
      tiers.sizes.map(([tier, set]) => `${tier}=[${set}]`).join(' '));
    record('the dot sizes descend with importance',
      ladder.every((size, index) => index === 0 || size < ladder[index - 1]),
      `major=${ladder[0]} named=${ladder[1]} minor=${ladder[2]}`);

    // ── Fly to the dams BEFORE measuring what a floor draws ──────────────
    // `entity.show` is written by the pre-render walk, which is also where
    // horizon occlusion lands: measured over the default view, every count
    // below would be zero whatever the floor does. `window.Cesium` is not
    // exposed by the app, so the camera is moved through the viewer's own API.
    await page.evaluate(() => {
      const viewer = window.__godsEyeView.styleManager?.viewer;
      if (!viewer) return;
      viewer.camera.cancelFlight?.();
      // The Alps between Grenoble and the Maurienne: Grand'Maison, Monteynard,
      // Le Chevril and the storage lakes above them in one frame.
      viewer.camera.setView({
        destination: viewer.scene.globe.ellipsoid.cartographicToCartesian({
          longitude: 6.2 * Math.PI / 180,
          latitude: 45.3 * Math.PI / 180,
          height: 220_000,
        }),
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
      });
      viewer.scene.requestRender();
      viewer.scene.render();
    });
    await sleep(4000);

    const floored = await page.evaluate(async () => {
      const dm = window.__godsEyeView.dataManager;
      const viewer = window.__godsEyeView.styleManager?.viewer;
      const entities = viewer?.dataSources?.getByName?.('Barrages')?.[0]?.entities?.values ?? [];
      const shown = () => entities.filter((entity) => entity.show !== false).length;
      viewer.scene.render();
      const before = shown();
      dm.setLayerParams('local-dams', { floor: 'major' }, { origin: 'user' });
      viewer.scene.render();
      const afterFloor = shown();
      const module = dm.layers?.get?.('local-dams')?.module;
      const legendAtFloor = (module?.getRowControls?.()?.legend || [])
        .map((item) => `${item.label}=${item.count}`);
      const statsAtFloor = dm.getAll().find((l) => l.id === 'local-dams')?.stats?.count;
      dm.setLayerParams('local-dams', { floor: 'all' }, { origin: 'user' });
      viewer.scene.render();
      return { before, afterFloor, restored: shown(), legendAtFloor, statsAtFloor };
    });

    record('the GRANDS floor hides everything below the top tier',
      floored.before > 0 && floored.afterFloor > 0 && floored.afterFloor < floored.before,
      `${floored.before} markers drawn in view → ${floored.afterFloor} under the floor`);
    record('the legend follows the floor instead of claiming the whole pack',
      floored.legendAtFloor.some((entry) => /=0$/.test(entry)),
      floored.legendAtFloor.join(' · '));
    record('a floor hides markers WITHOUT losing them',
      floored.statsAtFloor === stats.count,
      `stats.count=${floored.statsAtFloor} while ${floored.afterFloor} were drawn`);
    record('lifting the floor gives every marker back',
      floored.restored === floored.before,
      `${floored.afterFloor} → ${floored.restored} (was ${floored.before})`);

    // ── Shot ──────────────────────────────────────────────────────────────
    record('first-run launcher stays suppressed for the shot',
      await firstRunLauncherSuppressed(page));
    await page.evaluate(() => {
      const viewer = window.__godsEyeView.styleManager?.viewer;
      viewer?.scene?.requestRender?.();
      viewer?.scene?.render?.();
    });
    await sleep(4000);
    await page.screenshot({ path: path.join(SHOT_DIR, 'dams-alpes.png') });
    console.log(`\n  shot → ${path.join(SHOT_DIR, 'dams-alpes.png')}`);

    const relevantErrors = consoleErrors.filter((text) => /dam|barrage/i.test(text));
    record('no console errors mentioning the layer', relevantErrors.length === 0,
      relevantErrors[0] || 'clean');
  } finally {
    await browser.close();
  }

  const failed = results.filter((entry) => !entry.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('\nFailures:');
    for (const entry of failed) console.log(`  - ${entry.name}${entry.detail ? ` — ${entry.detail}` : ''}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
