#!/usr/bin/env node
/**
 * QA the airports layer in a real browser.
 *
 *   local-airports  OurAirports, bundled pack (7,464 airports & aerodromes)
 *
 * Checks that the layer registers under the id the share-link registry and the
 * voice enums use, enables, loads every bundled feature, and puts real entities
 * on the globe — plus the three properties this pack claims and could silently
 * lose:
 *
 *   1. IDENTITY survives the round trip. Roissy renders with LFPG/CDG and its
 *      4 215 m runway, because the card is written from these properties and a
 *      dropped field would read as a blank line, not as an error.
 *   2. The FRENCH LONG TAIL is actually there. The whole point of the selection
 *      is that France carries its small aerodromes; a filter regression that
 *      quietly reverted to "large + medium only" would still look like a
 *      working global layer from orbit.
 *   3. NO CLOSED AERODROMES. 13,482 ghost fields sit one clause away.
 *
 * Usage: node scripts/qa-airports.mjs [--url http://localhost:4174] [--headful]
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
const SHOT_DIR = path.join(ROOT, 'qa-shots', 'airports');

/** Rebuilt 2026-08-31. A floor, not an equality — see the pack's README. */
const MIN_FEATURES = 7000;
const MIN_FRENCH_SMALL_FIELDS = 900;

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
      const entry = all.find((layer) => layer.id === 'local-airports') || null;
      return entry ? { name: entry.name, category: entry.category ?? null } : null;
    });
    record('local-airports is registered', !!registered,
      registered ? `name="${registered.name}" category=${registered.category}` : 'absent');
    record('the layer lands in AIR & ESPACE', registered?.category === 'air-space',
      `category=${registered?.category}`);

    await page.evaluate(async () => {
      const dm = window.__godsEyeView.dataManager;
      await dm.setEnabled('local-airports', true, { origin: 'user' });
      await dm.waitForLayerSettled?.('local-airports');
    });

    const stats = await waitFor(page, () => {
      const all = window.__godsEyeView.dataManager.getAll() || [];
      const entry = all.find((layer) => layer.id === 'local-airports');
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
      const source = viewer?.dataSources?.getByName?.('Aéroports')?.[0];
      const entities = source?.entities?.values ?? [];
      if (!entities.length) return null;
      const now = window.Cesium?.JulianDate?.now?.();
      const props = entities.map((entity) => entity.properties?.getValue?.(now) ?? {});
      const byIcao = new Map(props.filter((p) => p.icao).map((p) => [p.icao, p]));
      const french = new Set(['BL', 'FR', 'GF', 'GP', 'MF', 'MQ', 'NC', 'PF', 'PM', 'RE', 'TF', 'WF', 'YT']);
      return {
        entities: entities.length,
        closed: props.filter((p) => p.type === 'closed').length,
        unnamed: props.filter((p) => !p.name).length,
        frenchSmallFields: props.filter((p) => french.has(p.countryCode)
          && ['small_airport', 'seaplane_base', 'balloonport'].includes(p.type)).length,
        withRunway: props.filter((p) => p.runways?.longestM).length,
        cdg: byIcao.get('LFPG') || null,
        issy: byIcao.get('LFPI') || null,
        reunion: byIcao.get('FMEE') || null,
      };
    });

    record('airports render as globe entities',
      !!sample && sample.entities >= MIN_FEATURES,
      sample ? `${sample.entities} entities` : 'no data source named "Aéroports"');
    if (!sample) return;

    // (1) Identity survives the pack → GeoJSON → Cesium round trip.
    const cdg = sample.cdg;
    record('Roissy keeps its identity through the round trip',
      cdg?.iata === 'CDG' && cdg?.type === 'large_airport' && cdg?.scheduled === true,
      cdg ? `iata=${cdg.iata} type=${cdg.type} scheduled=${cdg.scheduled}` : 'LFPG not found');
    record('Roissy reports its longest OPEN runway, in metres',
      cdg?.runways?.longestM === 4215 && cdg?.runways?.surface === 'revêtue',
      cdg ? `longestM=${cdg.runways?.longestM} surface=${cdg.runways?.surface}` : 'LFPG not found');

    // (2) The French long tail is the reason this pack is not global-only.
    record('the French long tail actually shipped',
      sample.frenchSmallFields >= MIN_FRENCH_SMALL_FIELDS,
      `${sample.frenchSmallFields} small French fields (floor ${MIN_FRENCH_SMALL_FIELDS})`);
    record('a published French heliport survives clause (d)', !!sample.issy,
      sample.issy ? sample.issy.name : 'LFPI absent');
    record('the overseas territories are France too', !!sample.reunion,
      sample.reunion ? `${sample.reunion.name} (${sample.reunion.countryCode})` : 'FMEE absent');

    // (3) The two ways this pack could quietly rot.
    record('no closed aerodrome reached the globe', sample.closed === 0,
      `${sample.closed} closed`);
    record('every rendered feature is named', sample.unnamed === 0,
      `${sample.unnamed} unnamed`);
    record('most features carry a measured runway',
      sample.withRunway / sample.entities > 0.7,
      `${sample.withRunway} of ${sample.entities}`);

    // ── Importance is visible, and the floors work ───────────────────────
    const tiers = await page.evaluate(() => {
      const dm = window.__godsEyeView.dataManager;
      const module = dm.layers?.get?.('local-airports')?.module;
      const controls = module?.getRowControls?.() || null;
      const viewer = window.__godsEyeView.styleManager?.viewer;
      const entities = viewer?.dataSources?.getByName?.('Aéroports')?.[0]?.entities?.values ?? [];
      const now = window.Cesium?.JulianDate?.now?.();
      const sizes = new Map();
      for (const entity of entities) {
        const p = entity.properties?.getValue?.(now) ?? {};
        const tier = p.type === 'large_airport' ? 'hub'
          : p.scheduled ? 'airline'
            : p.type === 'medium_airport' ? 'airport' : 'airfield';
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

    record('the row offers the four display floors',
      tiers.chips.join(',') === 'all,airports,airlines,hubs', tiers.chips.join(','));
    record('the legend names every tier that shipped',
      tiers.legend.length === 4,
      tiers.legend.map((item) => `${item.label}=${item.count}`).join(' · '));

    const sizeOf = new Map(tiers.sizes.map(([tier, set]) => [tier, set]));
    const oneSizePerTier = [...sizeOf.values()].every((set) => set.length === 1);
    const ladder = ['hub', 'airline', 'airport', 'airfield'].map((tier) => sizeOf.get(tier)?.[0]);
    record('each tier draws at exactly one dot size', oneSizePerTier,
      tiers.sizes.map(([tier, set]) => `${tier}=[${set}]`).join(' '));
    record('the dot sizes descend with importance',
      ladder.every((size, index) => index === 0 || size < ladder[index - 1]),
      `hub=${ladder[0]} airline=${ladder[1]} airport=${ladder[2]} airfield=${ladder[3]}`);

    // A floor must actually remove markers from the globe — and give them back.
    const floored = await page.evaluate(async () => {
      const dm = window.__godsEyeView.dataManager;
      const viewer = window.__godsEyeView.styleManager?.viewer;
      const entities = viewer?.dataSources?.getByName?.('Aéroports')?.[0]?.entities?.values ?? [];
      const shown = () => entities.filter((entity) => entity.show !== false).length;
      dm.setLayerParams('local-airports', { floor: 'hubs' }, { origin: 'user' });
      viewer.scene.render();
      const afterFloor = shown();
      const module = dm.layers?.get?.('local-airports')?.module;
      const legendAtFloor = (module?.getRowControls?.()?.legend || [])
        .map((item) => `${item.label}=${item.count}`);
      const statsAtFloor = dm.getAll().find((l) => l.id === 'local-airports')?.stats?.count;
      dm.setLayerParams('local-airports', { floor: 'all' }, { origin: 'user' });
      viewer.scene.render();
      return { afterFloor, restored: shown(), legendAtFloor, statsAtFloor };
    });

    record('the GRANDS floor hides everything below the top tier',
      floored.afterFloor > 0 && floored.afterFloor < 1500,
      `${floored.afterFloor} markers drawn (of ${stats.count})`);
    record('the legend follows the floor instead of claiming the whole pack',
      floored.legendAtFloor.some((entry) => /=0$/.test(entry)),
      floored.legendAtFloor.join(' · '));
    record('a floor hides markers WITHOUT losing them',
      floored.statsAtFloor === stats.count,
      `stats.count=${floored.statsAtFloor} while ${floored.afterFloor} were drawn`);
    record('lifting the floor gives every marker back',
      floored.restored > floored.afterFloor,
      `${floored.afterFloor} → ${floored.restored}`);

    // ── Shot ──────────────────────────────────────────────────────────────
    // newQaPage() suppressed the launcher before boot; this asserts the card is
    // actually out of the shot rather than trusting that it worked.
    record('first-run launcher stays suppressed for the shot',
      await firstRunLauncherSuppressed(page));
    await page.evaluate(() => {
      const viewer = window.__godsEyeView.styleManager?.viewer;
      const Cesium = window.Cesium;
      if (!viewer || !Cesium) return;
      // Cancel the boot fly-to first, or the tween drags the camera back to
      // Paris under the manual render pump.
      viewer.camera.cancelFlight?.();
      // Île-de-France at départemental scale: eleven fields in one frame, from
      // Roissy and Orly down to the grass strips the long tail is made of.
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(2.4, 48.7, 260_000),
        orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 },
      });
      viewer.scene.requestRender();
    });
    await sleep(6000);

    await page.screenshot({ path: path.join(SHOT_DIR, 'airports-idf.png') });
    console.log(`\n  shot → ${path.join(SHOT_DIR, 'airports-idf.png')}`);

    const relevantErrors = consoleErrors.filter((text) => /airport|aéroport|ourairports/i.test(text));
    record('no console errors mentioning the new layer', relevantErrors.length === 0,
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
