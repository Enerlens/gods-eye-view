#!/usr/bin/env node
/**
 * QA the two maritime layers in a real browser.
 *
 *   local-ports   NGA World Port Index, bundled pack (2,951 ports)
 *   marine-buoys  NOAA NDBC latest observations, live via /api/ndbc
 *
 * Checks that each layer enables, loads, reports honest stats, and puts real
 * entities on the globe — plus the two honesty properties the layers claim:
 * ports carry decoded harbour metadata, and buoys distinguish "no wave sensor"
 * from "flat sea" instead of collapsing both to zero.
 *
 * Usage: node scripts/qa-maritime.mjs [--url http://localhost:4174] [--headful]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const args = process.argv.slice(2);
const getOpt = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = getOpt('--url', 'http://localhost:4174').replace(/\/$/, '');
const HEADFUL = args.includes('--headful');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOT_DIR = path.join(ROOT, 'qa-shots', 'maritime');

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
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300));
    });
    page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message.slice(0, 300)}`));

    // Suppress the first-run mission launcher BEFORE the app boots. Clicking
    // it away afterwards loses the race: the chosen mission drives the camera,
    // and the modal covers the globe in every shot taken before that settles.
    await page.evaluateOnNewDocument(() => {
      try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch { /* private mode */ }
    });

    console.log(`\nOpening ${APP_URL} …`);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });

    const ready = await waitFor(page, () => !!window.__godsEyeView?.dataManager);
    record('app boots and exposes the data manager', !!ready);
    if (!ready) return;

    // Both layers must be registered under the ids the share-link registry and
    // the voice enums use — a mismatch here is a silently dead layer.
    const registered = await page.evaluate(() => {
      const all = window.__godsEyeView.dataManager.getAll() || [];
      const ids = all.map((entry) => entry.id);
      return {
        ports: ids.includes('local-ports'),
        buoys: ids.includes('marine-buoys'),
      };
    });
    record('local-ports is registered', registered.ports);
    record('marine-buoys is registered', registered.buoys);

    // ── Enable both layers ────────────────────────────────────────────────
    await page.evaluate(async () => {
      const dm = window.__godsEyeView.dataManager;
      await dm.setEnabled('local-ports', true, { origin: 'user' });
      await dm.setEnabled('marine-buoys', true, { origin: 'user' });
      await dm.waitForLayerSettled?.('local-ports');
      await dm.waitForLayerSettled?.('marine-buoys');
    });

    const stats = await waitFor(page, () => {
      const all = window.__godsEyeView.dataManager.getAll() || [];
      const get = (id) => all.find((entry) => entry.id === id)?.stats ?? null;
      const ports = get('local-ports');
      const buoys = get('marine-buoys');
      // Wait until both have either produced a count or reported an error.
      const settled = (s) => s && (Number(s.count) > 0 || s.error);
      return settled(ports) && settled(buoys) ? { ports, buoys } : null;
    }, { timeoutMs: 90_000 });

    if (!stats) {
      record('both layers settle within 90 s', false, 'timed out');
      return;
    }

    // ── Ports ─────────────────────────────────────────────────────────────
    record(
      'ports pack loads every bundled feature',
      stats.ports.count === 2951,
      `count=${stats.ports.count} (expected 2951)`,
    );
    record('ports layer reports no error', !stats.ports.error, stats.ports.error || 'clean');

    const portSample = await page.evaluate(() => {
      const viewer = window.__godsEyeView.styleManager?.viewer;
      const source = viewer?.dataSources?.getByName?.('Ports')?.[0];
      const entities = source?.entities?.values ?? [];
      if (!entities.length) return null;
      const now = window.Cesium?.JulianDate?.now?.();
      const read = (entity) => {
        const raw = entity.properties?.getValue?.(now) ?? {};
        return raw;
      };
      const named = entities.map(read).filter((p) => p && p.name);
      const rotterdam = named.find((p) => p.name === 'Rotterdam');
      return {
        entities: entities.length,
        named: named.length,
        rotterdam: rotterdam || null,
        withHarborSize: named.filter((p) => p.harborSize).length,
        withDepth: named.filter((p) => p.approxDepthM).length,
      };
    });

    record(
      'ports render as globe entities',
      !!portSample && portSample.entities === 2951,
      portSample ? `${portSample.entities} entities` : 'no data source named "Ports"',
    );

    if (portSample?.rotterdam) {
      const r = portSample.rotterdam;
      // The size scale is the thing most easily inverted: 'L' is the top tier
      // and Rotterdam must land on it, never on "Very small".
      record(
        'harbour size decodes with the right polarity (Rotterdam = Large)',
        r.harborSize === 'Large',
        `harborSize=${JSON.stringify(r.harborSize)}`,
      );
      record(
        'port metadata survives the pack round-trip',
        r.country === 'Netherlands' && r.unlocode === 'NL RTM',
        `country=${r.country} unlocode=${r.unlocode}`,
      );
    } else {
      record('Rotterdam is present in the rendered pack', false, 'not found');
    }

    record(
      'most ports carry decoded harbour metadata',
      (portSample?.withHarborSize ?? 0) > 2500,
      `${portSample?.withHarborSize} of ${portSample?.named} named ports have a size`,
    );

    // ── Buoys ─────────────────────────────────────────────────────────────
    record('buoys layer reports no error', !stats.buoys.error, stats.buoys.error || 'clean');
    record(
      'buoys load a plausible station count',
      stats.buoys.count > 400 && stats.buoys.count < 2000,
      `count=${stats.buoys.count}`,
    );
    record(
      'buoy coverage is a chip-ready string, not an object',
      typeof stats.buoys.coverage === 'string' && /measuring sea|stations/.test(stats.buoys.coverage),
      `coverage=${JSON.stringify(stats.buoys.coverage)}`,
    );

    const buoySample = await page.evaluate(() => {
      const viewer = window.__godsEyeView.styleManager?.viewer;
      const source = viewer?.dataSources?.getByName?.('marine-buoys')?.[0];
      const entities = source?.entities?.values ?? [];
      if (!entities.length) return null;
      const now = window.Cesium?.JulianDate?.now?.();
      let measured = 0;
      let unmeasured = 0;
      let flatSea = 0;
      for (const entity of entities) {
        const p = entity.properties?.getValue?.(now) ?? {};
        if (p.waveHeightM === null || p.waveHeightM === undefined) unmeasured += 1;
        else {
          measured += 1;
          if (p.waveHeightM === 0) flatSea += 1;
        }
      }
      return { entities: entities.length, measured, unmeasured, flatSea };
    });

    record(
      'buoys render as globe entities',
      !!buoySample && buoySample.entities > 400,
      buoySample ? `${buoySample.entities} entities` : 'no data source named "marine-buoys"',
    );

    // The core honesty property: the network is sparse, and the layer shows it.
    // If every station claimed a wave height, something is fabricating values.
    record(
      'most buoys honestly report NO wave height',
      !!buoySample && buoySample.unmeasured > buoySample.measured,
      buoySample
        ? `${buoySample.measured} measured / ${buoySample.unmeasured} without a wave sensor`
        : 'no sample',
    );

    // Fly somewhere the two layers actually overlap, so the shot shows the
    // feature rather than the default view.
    const launcherGone = await page.evaluate(
      () => !document.querySelector('#first-run-launcher')?.classList.contains('visible'),
    );
    record('first-run launcher stays suppressed for the shot', launcherGone);
    await page.evaluate(() => {
      const viewer = window.__godsEyeView.styleManager?.viewer;
      const Cesium = window.Cesium;
      if (!viewer || !Cesium) return;
      // North Sea / Channel: dense NGA port coverage, live UK + NL buoys.
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(2.5, 52.0, 1_400_000),
        orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 },
      });
      viewer.scene.requestRender();
    });
    await sleep(6000);

    await page.screenshot({ path: path.join(SHOT_DIR, 'maritime-layers.png') });
    console.log(`\n  shot → ${path.join(SHOT_DIR, 'maritime-layers.png')}`);

    const relevantErrors = consoleErrors.filter((text) => (
      /port|buoy|ndbc|marine/i.test(text)
    ));
    record(
      'no console errors mentioning the new layers',
      relevantErrors.length === 0,
      relevantErrors[0] || 'clean',
    );
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
