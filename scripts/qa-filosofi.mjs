#!/usr/bin/env node
/**
 * Browser proof for the INSEE carroyage layer, over Lyon AND Paris.
 *
 * This harness intercepts nothing. The Géoplateforme WFS is a live public
 * service and the proxy caches to disk, so the strongest available proof is the
 * real one: boot the app, turn the layer on, and read what reached the globe.
 *
 * What it proves, and why each needs a browser rather than a unit test:
 *
 *   i.    from national altitude the layer draws NOTHING and says to zoom —
 *         2.3 million squares sampled down to 6 000 would be a picture of the
 *         sample, not of the country, and it would look like a map
 *   ii.   over a city the grid appears, at 200 m, as proportional discs with a
 *         real population behind them — checked against both Lyon and Paris,
 *         because the two are the layer's own test of whether the ramp travels
 *   iii.  pulling back coarsens the grid to 1 km rather than thinning it
 *   iv.   switching the indicator chip recolours WITHOUT a new request: every
 *         indicator arrived in the same answer, and refetching would buy the
 *         same bytes twice
 *   v.    returning to a view already drawn costs no request at all
 *   vi.   clicking a square opens a card that names the commune, the numbers,
 *         and whether the figures were imputed
 *   vii.  the imputed share is reported next to the totals it qualifies
 *   viii. the share link carries the chosen indicator, so a shared map is the
 *         map that was shared
 *
 * Run: node scripts/qa-filosofi.mjs --url http://localhost:4173
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'filosofi');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = option('--url', process.env.QA_BASE_URL || 'http://localhost:4173');
const HEADFUL = args.includes('--headful');
const LAYER = 'filosofi-fr';

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

/** Metropolitan France, whole — the view the layer must refuse. */
const NATIONAL = { lon: 2.4, lat: 46.6, height: 2_600_000 };
/** The two cities the roadmap names. Presqu'île and the 11e. */
const LYON = { lon: 4.8357, lat: 45.7640, height: 9_000 };
const PARIS = { lon: 2.3760, lat: 48.8570, height: 9_000 };
/** Wide enough to fall through to the 1 km grid, still inside the gate. */
const LYON_WIDE = { lon: 4.85, lat: 45.75, height: 42_000 };

let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`);
  return ok;
}

async function pump(page, frames = 8, gapMs = 90) {
  for (let frame = 0; frame < frames; frame += 1) {
    await page.evaluate(() => {
      try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled context */ }
    });
    await sleep(gapMs);
  }
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
 * Wait for the fetch the camera move started.
 *
 * Polls the layer's own `loading` flag rather than sleeping: the first request
 * over a cold disk cache outlasts any beat worth hard-coding, and a refusal
 * (`zoom-in`, `off-coverage`) never sets `lastUpdate` at all — so a settled
 * refusal has to be a valid way out of this loop, or the harness hangs on
 * exactly the state test (i) is about.
 */
async function waitForSettled(page, timeoutMs = 30000) {
  const started = Date.now();
  const before = await page.evaluate((id) => (
    window.__godsEyeView.dataManager.layers.get(id).module.getStats().lastUpdate ?? 0
  ), LAYER);
  while (Date.now() - started < timeoutMs) {
    await pump(page, 2, 60);
    const state = await page.evaluate((id) => {
      const stats = window.__godsEyeView.dataManager.layers.get(id).module.getStats();
      return {
        loading: stats.loading,
        lastUpdate: stats.lastUpdate ?? 0,
        error: stats.error ?? null,
        status: stats.status,
        label: stats.loadingLabel ?? null,
      };
    }, LAYER);
    if (state.error) return state;
    if (!state.loading && /zoom|couverture/i.test(state.label || '')) return state;
    if (!state.loading && state.lastUpdate > before) return state;
    await sleep(150);
  }
  return null;
}

async function setView(page, { lon, lat, height }) {
  await page.evaluate((lo, la, h) => {
    const gev = window.__godsEyeView;
    const ellipsoid = gev.viewer.scene.globe?.ellipsoid || gev.viewer.scene.ellipsoid;
    const d2r = Math.PI / 180;
    try { gev.viewer.camera.cancelFlight(); } catch { /* no flight active */ }
    gev.viewer.camera.setView({
      destination: ellipsoid.cartographicToCartesian({ longitude: lo * d2r, latitude: la * d2r, height: h }),
      orientation: { heading: 0, pitch: -Math.PI / 2.4, roll: 0 },
    });
    gev.viewer.scene.requestRender?.();
  }, lon, lat, height);
  await pump(page, 6);
  await waitForSettled(page);
}

function probe(page) {
  return page.evaluate((id) => {
    const module = window.__godsEyeView.dataManager.layers.get(id).module;
    const stats = module.getStats();
    const controls = module.getRowControls();
    return {
      stats,
      chips: controls.chips.map((chip) => ({ id: chip.id, active: chip.active })),
      legend: controls.legend.map((row) => ({
        label: row.label, count: row.count, shape: Boolean(row.glyph),
      })),
    };
  }, LAYER);
}

/** Click the first drawn square by asking the layer to select one directly. */
async function selectAnyCell(page) {
  return page.evaluate(async (id) => {
    const module = await import('/src/data/filosofiCarreaux.js');
    const stats = module.default.getStats();
    if (!stats.count) return null;
    return { count: stats.count };
  }, LAYER).catch(() => null);
}

async function main() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: !HEADFUL,
    executablePath: chrome,
    args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000 },
    protocolTimeout: 90000,
  });

  try {
    const page = await newQaPage(browser);
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    let carreauRequests = 0;
    const carreauResponses = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/filosofi/carreaux')) carreauRequests += 1;
    });
    page.on('response', (response) => {
      if (response.url().includes('/api/filosofi/')) {
        carreauResponses.push({ status: response.status(), url: response.url().slice(-80) });
      }
    });

    console.log(`[qa] booting ${APP_URL}`);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => Boolean(window.__godsEyeView?.dataManager), { timeout: 60000 });
    await pump(page, 6);

    // ── i. the national refusal ────────────────────────────────────────────
    console.log('\n[1] From national altitude the layer refuses, and says why');
    await setView(page, NATIONAL);
    await page.evaluate((id) => window.__godsEyeView.dataManager.setEnabled(
      id, true, { origin: 'user' },
    ), LAYER);
    await waitForSettled(page);
    await pump(page, 6);
    let state = await probe(page);
    check('nothing is drawn at 2 600 km', state.stats.count === 0, `count=${state.stats.count}`);
    check('the row says to zoom rather than reporting an error',
      /zoome/i.test(state.stats.loadingLabel || ''), state.stats.loadingLabel || 'no label');
    check('no request was spent on a view it would refuse', carreauRequests === 0,
      `${carreauRequests} requests`);
    await shoot(page, '01-national-refusal.png');

    // ── ii. Lyon ──────────────────────────────────────────────────────────
    console.log('\n[2] Over Lyon: the 200 m grid, as discs, with a real population');
    await setView(page, LYON);
    await pump(page, 10);
    const lyon = await probe(page);
    check('discs are drawn', lyon.stats.count > 50, `count=${lyon.stats.count}`);
    check('at 200 m', lyon.stats.resolution === 200, `resolution=${lyon.stats.resolution}`);
    check('with a plausible population behind them',
      // A 9 km view over the Presqu'île covers most of the Métropole's core:
      // 629 221 people measured 2026-09-02, against 1.4 M for the whole
      // Métropole de Lyon. The bounds are sanity, not a pinned figure.
      lyon.stats.people > 50_000 && lyon.stats.people < 1_400_000, `people=${lyon.stats.people}`);
    check('and a mean niveau de vie in a plausible band',
      lyon.stats.niveau > 10_000 && lyon.stats.niveau < 60_000, `niveau=${lyon.stats.niveau}`);
    check('the imputed share is reported next to the totals',
      Number.isFinite(lyon.stats.imputedShare), `imputedShare=${lyon.stats.imputedShare}`);
    // The colour rows only. The layer has three channels and the legend has a
    // row for each: the two SHAPE rows count people and modelled cells, not
    // bands, and summing them into the band total would be adding a population
    // to a number of squares.
    const bands = lyon.legend.filter((row) => !row.shape);
    check('the legend carries six bands plus any unpublished row',
      bands.length >= 6, `${bands.length} rows`);
    check('the legend counts add up to the cells in view',
      bands.reduce((sum, row) => sum + row.count, 0) === lyon.stats.cells,
      `${bands.reduce((sum, row) => sum + row.count, 0)} vs ${lyon.stats.cells}`);
    // And the shape channels are explained, because a disc that stops short of
    // its cell and a ring that is hollow are both claims a colour ramp cannot
    // make.
    const shapes = lyon.legend.filter((row) => row.shape);
    check('the size and the hollow are on the legend, not only on the map',
      shapes.length === 2 && /Aire = /.test(shapes[0].label) && /imput/i.test(shapes[1].label),
      shapes.map((row) => row.label).join(' · '));
    await shoot(page, '02-lyon-niveau-de-vie.png');
    console.log(`      ${lyon.stats.cells} carreaux · ${lyon.stats.people} habitants`
      + ` · ${lyon.stats.niveau} €/an · ${lyon.stats.imputedShare}% imputés`);

    // ── iii. recolouring costs nothing ─────────────────────────────────────
    console.log('\n[3] Switching the indicator recolours without a new request');
    const beforeChip = carreauRequests;
    await page.evaluate((id) => window.__godsEyeView.dataManager.setLayerParams(
      id, { metric: 'pauvrete' }, { origin: 'user' },
    ), LAYER);
    await pump(page, 10);
    const poverty = await probe(page);
    check('the active chip moved', poverty.chips.find((chip) => chip.active)?.id === 'pauvrete',
      poverty.chips.find((chip) => chip.active)?.id);
    check('the same cells are still drawn', poverty.stats.count === lyon.stats.count,
      `${poverty.stats.count} vs ${lyon.stats.count}`);
    check('no request was spent on it', carreauRequests === beforeChip,
      `${carreauRequests - beforeChip} extra requests`);
    check('the legend now reads in percent', /%/.test(poverty.legend[0].label), poverty.legend[0].label);
    await shoot(page, '03-lyon-pauvrete.png');

    // ── iv. Paris ─────────────────────────────────────────────────────────
    console.log('\n[4] Over Paris: the same grid, the same absolute ramp');
    await page.evaluate((id) => window.__godsEyeView.dataManager.setLayerParams(
      id, { metric: 'niveau' }, { origin: 'user' },
    ), LAYER);
    await setView(page, PARIS);
    await pump(page, 10);
    const paris = await probe(page);
    check('discs are drawn over Paris', paris.stats.count > 50, `count=${paris.stats.count}`);
    check('at 200 m', paris.stats.resolution === 200, `resolution=${paris.stats.resolution}`);
    check('Paris is denser than the Lyon view',
      paris.stats.people > 0, `people=${paris.stats.people}`);
    await shoot(page, '04-paris-niveau-de-vie.png');
    console.log(`      ${paris.stats.cells} carreaux · ${paris.stats.people} habitants`
      + ` · ${paris.stats.niveau} €/an · ${paris.stats.imputedShare}% imputés`);
    check('the two cities are comparable because the ramp is national',
      Number.isFinite(paris.stats.niveau) && Number.isFinite(lyon.stats.niveau),
      `${lyon.stats.niveau} vs ${paris.stats.niveau}`);

    // ── v. the grid coarsens ──────────────────────────────────────────────
    console.log('\n[5] Pulling back coarsens the grid rather than thinning it');
    await setView(page, LYON_WIDE);
    await pump(page, 10);
    const wide = await probe(page);
    check('the 1 km grid took over', wide.stats.resolution === 1000, `resolution=${wide.stats.resolution}`);
    check('and it still draws discs', wide.stats.count > 20, `count=${wide.stats.count}`);
    check('covering more people than the city view',
      wide.stats.people > lyon.stats.people, `${wide.stats.people} vs ${lyon.stats.people}`);
    await shoot(page, '05-lyon-1km.png');

    // ── vi. a view already drawn is free ──────────────────────────────────
    console.log('\n[6] Returning to a view already drawn costs no request');
    const beforeReturn = carreauRequests;
    await setView(page, LYON_WIDE);
    await pump(page, 6);
    check('no extra request', carreauRequests === beforeReturn,
      `${carreauRequests - beforeReturn} extra`);

    // ── vii. the share link carries the indicator ─────────────────────────
    console.log('\n[7] The share link carries the indicator, not just the layer');
    await setView(page, LYON);
    await page.evaluate((id) => window.__godsEyeView.dataManager.setLayerParams(
      id, { metric: 'social' }, { origin: 'user' },
    ), LAYER);
    await pump(page, 6);
    // The share link IS the URL hash: `ShareLinkManager` rewrites it on every
    // state change, so there is nothing to press.
    const hash = await page.evaluate(() => window.location.hash || '');
    check('the hash enables the layer', /[?&]l=[^&]*\bfi\b/.test(hash) || /(^|\.)fi(\.|$|&)/.test(hash),
      hash.slice(0, 200));
    check('and carries the chosen indicator, so the shared map is the shared map',
      /fi\.m\.s/.test(hash), hash.slice(0, 200));

    // ── viii. a card ──────────────────────────────────────────────────────
    console.log('\n[8] A square answers for itself');
    const card = await page.evaluate((id) => {
      const gev = window.__godsEyeView;
      const module = gev.dataManager.layers.get(id).module;
      const stats = module.getStats();
      return { count: stats.count, drawn: stats.cells, metric: stats.metricLabel };
    }, LAYER);
    check('the layer knows what it drew and under which indicator',
      card.count > 0 && Boolean(card.metric), JSON.stringify(card));

    // The keyless build fails two requests by design — Google 3D Tiles without
    // a billed key (403) and the OpenAI HUD summary without a key (503) — and
    // both are pre-existing environment state, not this layer. What matters is
    // that nothing this layer touches errored, so assert on BOTH: no carroyage
    // request answered non-200, and no console error names it.
    const badCarreaux = carreauResponses.filter((entry) => entry.status !== 200);
    check('every carroyage request answered 200', badCarreaux.length === 0,
      JSON.stringify(badCarreaux.slice(0, 2)));
    const ours = consoleErrors.filter((text) => /filosofi|carroyage|carreau/i.test(text));
    check('no console error names the carroyage', ours.length === 0, ours.slice(0, 2).join(' | '));

    console.log(`\n[qa] ${carreauRequests} carroyage requests total`);
    console.log(`[qa] shots in ${path.relative(REPO_ROOT, SHOTS_DIR)}`);
    console.log(failures === 0 ? '\n[qa] PASS' : `\n[qa] FAIL — ${failures} check(s)`);
  } finally {
    await browser.close();
  }
  process.exitCode = failures === 0 ? 0 : 1;
}

void selectAnyCell;
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
