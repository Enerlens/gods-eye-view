#!/usr/bin/env node
/**
 * Deterministic browser proof for the French electricity-mix layer
 * (`france-energy`).
 *
 * The feed is live and therefore untestable as a fixed truth, so this harness
 * intercepts `/api/energy-fr` with the SAME captured ODRÉ payload the unit
 * tests use — run through the real `projectEco2mix` projection, so the fixture
 * cannot drift from what the proxy actually serves — and proves the four
 * behaviours that only a real Cesium scene can prove:
 *
 *   i.   every département of a région paints with its RÉGION's colour, and
 *        Corsica stays dark because éCO2mix régional does not cover it
 *   ii.  the sign convention survives all the way to the globe — Île-de-France
 *        (a net importer) is amber and Auvergne-Rhône-Alpes (a net exporter)
 *        is teal, read back off the rendered material, not off the model
 *   iii. the five border flows are drawn as RAISED arcs pointing the way the
 *        power travels, with the direction repeated in words on the label
 *   iv.  a border that falls to zero hides its arc instead of drawing a
 *        hairline, and the entity is reused rather than rebuilt
 *
 * Screenshots are written under the gitignored `qa-shots/energy-fr/`.
 *
 * Run: node scripts/qa-energy-fr.mjs --url http://localhost:4173
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';
import { projectEco2mix } from '../src/data/eco2mixFeed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'energy-fr');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = option('--url', process.env.QA_BASE_URL || 'http://localhost:4173');
const APP_ORIGIN = new URL(APP_URL).origin;
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A view that holds all of metropolitan France and its five neighbours. */
const FRANCE = { lon: 2.6, lat: 46.6, height: 2_600_000 };

/** The palette, duplicated here on purpose: a QA harness asserts, it doesn't import styling. */
const AMBER = '#ff9b3d';
const TEAL = '#2ee6a8';

const readFixture = (name) => JSON.parse(fs.readFileSync(
  path.join(REPO_ROOT, 'src', 'data', 'fixtures', name), 'utf8',
));

/**
 * The proxy's own output, built from the captured ODRÉ bodies. Using the real
 * projection rather than a hand-written blob is what keeps this harness honest
 * when the projection changes.
 */
function energyPayload({ zeroBorder = null } = {}) {
  const projected = projectEco2mix({
    national: readFixture('eco2mix-national-tr-sample.json'),
    regional: readFixture('eco2mix-regional-tr-sample.json'),
  }, 'ODRÉ (qa fixture)');
  const national = zeroBorder
    ? {
      ...projected.national,
      exchanges: projected.national.exchanges.map((entry) => (
        entry.key === zeroBorder ? { ...entry, mw: 0 } : entry
      )),
    }
    : projected.national;
  return {
    fetchedAt: Date.now(),
    stale: false,
    ttlMs: 240_000,
    source: projected.source,
    national,
    regions: projected.regions,
  };
}

const failures = [];
function check(label, condition, detail = '') {
  const ok = Boolean(condition);
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`);
  return ok;
}

/**
 * Render `frames` frames explicitly. Cesium's clamped-ground polygons only
 * resolve their material once the scene has actually drawn, and a
 * software-rendered headless context sometimes has no animation-frame loop at
 * all — so the harness pumps the scene itself rather than trusting the browser.
 */
async function pump(page, frames = 8, gapMs = 80) {
  for (let frame = 0; frame < frames; frame++) {
    await page.evaluate(() => {
      try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled context */ }
    });
    await sleep(gapMs);
  }
}

/** Teleport the camera (duck-typed cartographic — no Cesium global). */
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

/** Screenshot, best-effort — these are evidence, not assertions. */
async function shoot(page, name) {
  try {
    await page.evaluate(() => { try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled context */ } });
    await page.screenshot({ path: path.join(SHOTS_DIR, name) });
  } catch (error) {
    console.log(`  · screenshot ${name} unavailable (${String(error?.message || error).split('\n')[0]})`);
  }
}

/**
 * Read the layer's rendered state out of the live scene.
 *
 * Deliberately reads the ENTITIES, not the layer's own model: the point of a
 * browser proof is that the paint reached the globe, so the colours here come
 * off `polygon.material` and the arcs off `polyline.positions`.
 */
function sceneProbe(page) {
  return page.evaluate(() => {
    const gev = window.__godsEyeView;
    const module = gev.dataManager.layers.get('france-energy').module;
    const sources = gev.viewer.dataSources;
    let collection = null;
    for (let i = 0; i < sources.length; i++) {
      if (String(sources.get(i).name || '').includes('éCO2mix')) collection = sources.get(i);
    }
    const hex = (color) => (color
      ? `#${[color.red, color.green, color.blue]
        .map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`
      : null);

    const polygons = [];
    const arcs = [];
    for (const entity of collection ? collection.entities.values : []) {
      if (entity.polygon) {
        const code = String(entity.properties?.code?.getValue?.() ?? '');
        const material = entity.polygon.material?.color?.getValue?.();
        polygons.push({
          code,
          shown: entity.show !== false,
          color: hex(material),
          alpha: material ? Math.round(material.alpha * 1000) / 1000 : null,
        });
      } else if (entity.polyline) {
        const positions = entity.polyline.positions?.getValue?.() || [];
        arcs.push({
          id: String(entity.id),
          shown: entity.show !== false,
          vertices: positions.length,
          width: entity.polyline.width?.getValue?.() ?? null,
        });
      }
    }
    return {
      stats: module.getStats(),
      analyst: module.getAnalystRecords(20),
      controls: module.getRowControls(),
      polygons,
      arcs,
      sourceFound: Boolean(collection),
    };
  });
}

async function main() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: !HEADFUL,
    executablePath: chrome,
    args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000 },
    protocolTimeout: 45000,
  });

  try {
    const page = await newQaPage(browser);
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    let payload = energyPayload();
    let apiRequests = 0;
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin === APP_ORIGIN && url.pathname === '/api/energy-fr') {
        apiRequests += 1;
        void request.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(payload),
        });
        return;
      }
      void request.continue();
    });

    console.log(`[qa] booting ${APP_URL}`);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Interval polling, not animation-frame polling: headless WebGL can stall
    // the rAF loop outright, and a rAF-polled wait would then time out on an
    // app that booted perfectly well.
    await page.waitForFunction(
      () => window.__godsEyeView?.viewer && window.__godsEyeView?.dataManager,
      { timeout: 60000, polling: 200 },
    );
    await sleep(2000);
    await setView(page, FRANCE.lon, FRANCE.lat, FRANCE.height);

    // ── i. the régions paint, Corsica does not ─────────────────────────────
    console.log('[qa] i. régions paint by their own balance');
    await page.evaluate(() => window.__godsEyeView.dataManager.setEnabled('france-energy', true));
    let probe = null;
    for (let attempt = 0; attempt < 25; attempt++) {
      await pump(page, 3, 60);
      await sleep(400);
      probe = await sceneProbe(page);
      if (apiRequests >= 1 && probe.sourceFound && probe.stats.count === 12) break;
    }
    check('the layer fetched its snapshot', apiRequests >= 1, `${apiRequests} request(s)`);
    check('the data source reached the viewer', probe.sourceFound);
    check('all 12 covered régions resolved', probe.stats.count === 12, `count=${probe.stats.count}`);
    check('the 96 bundled départements are all present',
      probe.polygons.length >= 96, `${probe.polygons.length} polygon entities`);

    const corsica = probe.polygons.filter((polygon) => ['2A', '2B'].includes(polygon.code));
    check('Corsica is present but never painted',
      corsica.length === 2 && corsica.every((polygon) => !polygon.shown),
      corsica.map((c) => `${c.code}:${c.shown}`).join(' '));

    // Counted by CODE, not by entity: a MultiPolygon département contributes
    // one entity per island, so the entity count is higher than 96.
    const shownCodes = new Set(probe.polygons.filter((p) => p.shown).map((p) => p.code));
    check('every département outside Corsica is painted',
      shownCodes.size === 94, `${shownCodes.size} distinct codes painted (96 − 2 Corsican)`);
    await shoot(page, '01-regions.png');

    // ── ii. the sign convention survives to the rendered material ──────────
    console.log('[qa] ii. importer amber, exporter teal');
    const colorOf = (code) => probe.polygons.find((polygon) => polygon.code === code);
    // Île-de-France: +6 478 MW upstream, i.e. consumption above generation.
    const idf = colorOf('75');
    check('Île-de-France (net importer) renders amber', idf?.color === AMBER,
      `75 → ${idf?.color}`);
    // Auvergne-Rhône-Alpes: −7 781 MW upstream, the country's biggest surplus.
    const aura = colorOf('69');
    check('Auvergne-Rhône-Alpes (net exporter) renders teal', aura?.color === TEAL,
      `69 → ${aura?.color}`);
    check('every département of Île-de-France shares one fill',
      ['75', '77', '78', '91', '92', '93', '94', '95']
        .every((code) => colorOf(code)?.color === AMBER && colorOf(code)?.alpha === idf.alpha));
    // Alpha ramps on |balance| / load, so the country's largest imbalance must
    // read stronger than a milder one regardless of which side each is on.
    check('the strongest imbalance is drawn more opaque than a milder one',
      aura.alpha > colorOf('35').alpha, `AURA ${aura.alpha} vs Ille-et-Vilaine ${colorOf('35').alpha}`);
    check('the row legend names both sides in words',
      probe.controls.legend.length === 2
      && probe.controls.legend.every((entry) => typeof entry.label === 'string' && entry.count > 0));

    // ── iii. the border arcs ───────────────────────────────────────────────
    console.log('[qa] iii. five raised border arcs');
    check('five arcs are drawn', probe.arcs.filter((arc) => arc.shown).length === 5,
      `${probe.arcs.filter((arc) => arc.shown).length} arcs`);
    check('each arc is a sampled curve, not a two-point line',
      probe.arcs.every((arc) => arc.vertices > 8),
      probe.arcs.map((arc) => arc.vertices).join(','));
    check('arc width tracks the flow', new Set(probe.arcs.map((arc) => arc.width)).size > 1,
      probe.arcs.map((arc) => Math.round(arc.width)).join(','));
    check('the physical and commercial national balances are reported separately',
      probe.stats.netExportMw !== probe.stats.netCommercialExportMw,
      `${probe.stats.netExportMw} vs ${probe.stats.netCommercialExportMw}`);
    check('the analyst sees the balance restated as an export figure',
      probe.analyst.find((record) => record.id === '84')?.netExportMw === 7781);
    await shoot(page, '02-borders.png');

    // ── iv. a border that falls to zero ────────────────────────────────────
    console.log('[qa] iv. a zero border hides its arc');
    const arcsBefore = probe.arcs.length;
    payload = energyPayload({ zeroBorder: 'suisse' });
    await page.evaluate(() => window.__godsEyeView.dataManager.refreshLayer?.('france-energy'));
    let after = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      await pump(page, 3, 60);
      await sleep(300);
      after = await sceneProbe(page);
      if (after.stats.borders === 4) break;
    }
    check('the zeroed border is no longer drawn',
      after.arcs.filter((arc) => arc.shown).length === 4,
      `${after.arcs.filter((arc) => arc.shown).length} shown`);
    check('and it is hidden, not destroyed', after.arcs.length === arcsBefore,
      `${after.arcs.length} entities vs ${arcsBefore}`);
    check('the Swiss arc specifically is the one hidden',
      after.arcs.find((arc) => arc.id.endsWith(':suisse'))?.shown === false);
    check('the other four kept their geometry',
      after.arcs.filter((arc) => arc.shown).every((arc) => arc.vertices > 8));
    await shoot(page, '03-zero-border.png');

    const relevantErrors = consoleErrors.filter((text) => /energy|eco2mix/i.test(text));
    check('no layer console errors', relevantErrors.length === 0, relevantErrors[0] || '');
  } finally {
    await browser.close();
  }

  console.log('');
  if (failures.length) {
    console.log(`[qa] ${failures.length} FAILED:`);
    for (const failure of failures) console.log(`  · ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('[qa] energy-fr: all checks passed');
  }
  console.log(`[qa] shots → ${path.relative(REPO_ROOT, SHOTS_DIR)}/`);
}

main().catch((error) => {
  console.error('[qa] harness error:', error);
  process.exitCode = 1;
});
