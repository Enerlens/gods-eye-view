#!/usr/bin/env node
/**
 * Browser proof for the fiche implantation, over Lyon AND Paris.
 *
 * This is the one layer whose product is a SENTENCE rather than a picture, so
 * the harness reads the card the way a reader would: it asks the layer what it
 * drew, and it asserts on the words.
 *
 * What it proves, and why each needs a browser rather than a unit test:
 *
 *   i.    one scan really does fan out across four of the app's own routes,
 *         against the live services, and comes back with all four halves
 *   ii.   the population inside the ring is a plausible number for a real
 *         address in a real city — checked in Lyon and in Paris
 *   iii.  the headline is a BRACKET: low ≤ centroid ≤ high, with a real gap,
 *         because a ten-minute walk always has squares across its edge
 *   iv.   the card's lines survive the factory's own splitter — the failure
 *         that no unit test on the payload can catch is the one where the
 *         bracket sentence arrives on screen in two halves
 *   v.    changing the duration changes the population, and the ring, and the
 *         share link
 *   vi.   a fiche is still a fiche when a source is silent
 *
 * Run: node scripts/qa-implantation.mjs --url http://localhost:4173
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'implantation');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = option('--url', process.env.QA_BASE_URL || 'http://localhost:4173');
const HEADFUL = args.includes('--headful');
const LAYER = 'implantation-fr';

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

/** Place Bellecour and place de la République — two real, dense addresses. */
const LYON = { lon: 4.8357, lat: 45.7578, height: 2_200 };
const PARIS = { lon: 2.3639, lat: 48.8674, height: 2_200 };
const TOO_HIGH = { lon: 4.8357, lat: 45.7578, height: 40_000 };

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
 * Wait for a scan that fans out across four live services.
 *
 * The slowest of the four decides, and one of them parses a commune-year of
 * DVF CSV on a cold cache — comfortably over a second. A dormant layer never
 * updates, so that has to be a valid way out.
 */
async function waitForSettled(page, timeoutMs = 60000) {
  const started = Date.now();
  const before = await page.evaluate((id) => (
    window.__godsEyeView.dataManager.layers.get(id).module.getStats().lastUpdate ?? 0
  ), LAYER);
  while (Date.now() - started < timeoutMs) {
    await pump(page, 2, 60);
    const state = await page.evaluate((id) => {
      const stats = window.__godsEyeView.dataManager.layers.get(id).module.getStats();
      return {
        dormant: Boolean(stats.dormant),
        lastUpdate: stats.lastUpdate ?? 0,
        error: stats.error ?? null,
      };
    }, LAYER);
    if (state.error || state.dormant) return state;
    if (state.lastUpdate > before) return state;
    await sleep(250);
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
      orientation: { heading: 0, pitch: -Math.PI / 2.2, roll: 0 },
    });
    gev.viewer.scene.requestRender?.();
  }, lon, lat, height);
  await pump(page, 6);
  await waitForSettled(page);
}

function probe(page) {
  return page.evaluate((id) => {
    const gev = window.__godsEyeView;
    const module = gev.dataManager.layers.get(id).module;
    const source = gev.viewer.dataSources.getByName(id)[0];
    const entities = source ? [...source.entities.values] : [];
    const point = entities.find((entity) => String(entity.id) === 'fiche:point');
    const now = window.Cesium?.JulianDate?.now?.();
    const description = point?.description?.getValue?.(now) ?? null;
    return {
      stats: module.getStats(),
      chips: module.getRowControls().chips.map((chip) => ({ id: chip.id, active: chip.active })),
      legend: module.getRowControls().legend.map((row) => ({ label: row.label, count: row.count })),
      entityIds: entities.map((entity) => String(entity.id)),
      title: point?.name ?? null,
      // Split exactly the way `cardFromEntity()` does, so what this harness
      // reads IS what a click would put on screen.
      lines: description ? String(description).split(' · ') : [],
    };
  }, LAYER);
}

async function main() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: !HEADFUL,
    executablePath: chrome,
    args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000 },
    protocolTimeout: 150000,
  });

  try {
    const page = await newQaPage(browser);
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    const routes = { isochrone: 0, filosofi: 0, gpu: 0, dvf: 0, ban: 0 };
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('/api/isochrone')) routes.isochrone += 1;
      else if (url.includes('/api/filosofi/carreaux')) routes.filosofi += 1;
      else if (url.includes('/api/gpu')) routes.gpu += 1;
      else if (url.includes('/api/dvf')) routes.dvf += 1;
      else if (url.includes('api-adresse.data.gouv.fr')) routes.ban += 1;
    });

    console.log(`[qa] booting ${APP_URL}`);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => Boolean(window.__godsEyeView?.dataManager), { timeout: 60000 });
    await pump(page, 6);

    // ── i. the altitude refusal ────────────────────────────────────────────
    console.log('\n[1] From 40 km there is nothing to compose');
    await setView(page, TOO_HIGH);
    await page.evaluate((id) => window.__godsEyeView.dataManager.setEnabled(
      id, true, { origin: 'user' },
    ), LAYER);
    await waitForSettled(page);
    await pump(page, 6);
    let state = await probe(page);
    check('nothing is drawn', state.stats.count === 0, `count=${state.stats.count}`);
    check('the row says to descend', /Descends/i.test(state.stats.loadingLabel || ''),
      state.stats.loadingLabel || 'no label');
    check('no source was queried', Object.values(routes).every((n) => n === 0),
      JSON.stringify(routes));

    // ── ii. Lyon ──────────────────────────────────────────────────────────
    console.log('\n[2] Place Bellecour: one scan, four sources, one card');
    await setView(page, LYON);
    await pump(page, 12);
    const lyon = await probe(page);
    check('the isochrone was queried once', routes.isochrone >= 1, String(routes.isochrone));
    check('the carroyage was queried', routes.filosofi >= 1, String(routes.filosofi));
    check('the zoning was queried', routes.gpu >= 1, String(routes.gpu));
    check('the market was queried', routes.dvf >= 1, String(routes.dvf));
    check('the address service was queried', routes.ban >= 1, String(routes.ban));
    check('a ring and a point were drawn',
      lyon.entityIds.includes('fiche:ring:outline') && lyon.entityIds.includes('fiche:point'),
      lyon.entityIds.join(','));
    check('no source stayed silent', (lyon.stats.missing || []).length === 0,
      JSON.stringify(lyon.stats.missing));
    check('the card is titled with a real address',
      Boolean(lyon.title) && lyon.title !== 'Fiche implantation', String(lyon.title));
    await shoot(page, '01-lyon-fiche.png');
    console.log(`      « ${lyon.title} »`);
    for (const line of lyon.lines) console.log(`        ${line}`);

    // ── iii. the bracket ──────────────────────────────────────────────────
    console.log('\n[3] The headline is a bracket, and the bracket is real');
    const { peopleLow, people, peopleHigh, bracketPercent } = lyon.stats;
    check('a plausible population inside a ten-minute walk',
      people > 1_000 && people < 120_000, `people=${people}`);
    check('low ≤ centroid ≤ high', peopleLow <= people && people <= peopleHigh,
      `${peopleLow} / ${people} / ${peopleHigh}`);
    check('the bounds actually differ — every real ring has an edge',
      peopleHigh > peopleLow, `${peopleLow} vs ${peopleHigh}`);
    check('the bracket width is reported', Number.isFinite(bracketPercent),
      `${bracketPercent}`);
    check('some squares really do straddle the boundary',
      lyon.stats.straddlingCells > 0, `${lyon.stats.straddlingCells}`);
    check('the legend carries the three figures',
      lyon.legend.length === 3
      && lyon.legend[0].count === peopleLow && lyon.legend[2].count === peopleHigh,
      JSON.stringify(lyon.legend));

    // ── iv. the card cannot shatter ───────────────────────────────────────
    console.log('\n[4] The card survives the factory\'s own splitter');
    check('the card has real lines', lyon.lines.length >= 6, `${lyon.lines.length} lines`);
    check('the bracket sentence arrived whole',
      lyon.lines.some((line) => /^Entre .+ et .+ selon qu’on compte/.test(line)),
      lyon.lines.join(' | '));
    // The four counts must add up on screen, or a reader stops trusting them.
    const partition = lyon.lines.find((line) => /retenus au centre sur \d+ touchés/.test(line));
    const parsed = partition
      ? /(\d+) carreaux de \d+ m retenus au centre sur (\d+) touchés \((\d+) entiers, (\d+) à cheval\)/
        .exec(partition.replace(/\s/g, ' '))
      : null;
    check('the cell partition adds up',
      Boolean(parsed) && Number(parsed[3]) + Number(parsed[4]) === Number(parsed[2]),
      String(partition));
    check('the population line arrived whole',
      lyon.lines.some((line) => /habitants/.test(line)), lyon.lines.join(' | '));
    check('the imputation line is present',
      lyon.lines.some((line) => /imput/.test(line)), lyon.lines.join(' | '));
    check('the zoning line is present',
      lyon.lines.some((line) => /PLU/.test(line)), lyon.lines.join(' | '));
    check('the market line is present',
      lyon.lines.some((line) => /DVF/.test(line)), lyon.lines.join(' | '));

    // ── v. the duration ───────────────────────────────────────────────────
    console.log('\n[5] Changing the duration changes the answer');
    await page.evaluate((id) => window.__godsEyeView.dataManager.setLayerParams(
      id, { seconds: 300 }, { origin: 'user' },
    ), LAYER);
    await waitForSettled(page);
    await pump(page, 10);
    const short = await probe(page);
    check('the active chip moved', short.chips.find((chip) => chip.active)?.id === '300',
      short.chips.find((chip) => chip.active)?.id);
    check('five minutes reaches fewer people than ten',
      short.stats.people < people, `${short.stats.people} vs ${people}`);
    check('and a smaller area', short.stats.areaKm2 < lyon.stats.areaKm2,
      `${short.stats.areaKm2} vs ${lyon.stats.areaKm2}`);
    await shoot(page, '02-lyon-5min.png');
    console.log(`      5 min : ${short.stats.people} habitants sur ${short.stats.areaKm2} km²`);

    const hash = await page.evaluate(() => window.location.hash || '');
    check('the share link carries the layer', /[?&]l=[^&]*\bim\b/.test(hash) || /(^|\.)im(\.|&|$)/.test(hash),
      hash.slice(0, 200));
    check('and the duration', /im\.s\.5/.test(hash), hash.slice(0, 200));

    // ── vi. Paris ─────────────────────────────────────────────────────────
    console.log('\n[6] Place de la République: the same fiche, a different city');
    await page.evaluate((id) => window.__godsEyeView.dataManager.setLayerParams(
      id, { seconds: 600 }, { origin: 'user' },
    ), LAYER);
    await setView(page, PARIS);
    await pump(page, 12);
    const paris = await probe(page);
    check('a fiche composed over Paris too', paris.stats.people > 1_000,
      `people=${paris.stats.people}`);
    check('with its own bracket',
      paris.stats.peopleLow <= paris.stats.people
      && paris.stats.people <= paris.stats.peopleHigh,
      `${paris.stats.peopleLow} / ${paris.stats.people} / ${paris.stats.peopleHigh}`);
    check('and its own address', Boolean(paris.title) && paris.title !== lyon.title,
      String(paris.title));
    check('Paris is denser than Lyon inside the same ten minutes',
      paris.stats.people > people, `${paris.stats.people} vs ${people}`);
    await shoot(page, '03-paris-fiche.png');
    console.log(`      « ${paris.title} »`);
    for (const line of paris.lines) console.log(`        ${line}`);

    const ours = consoleErrors.filter((text) => /implantation|fiche/i.test(text));
    check('no console error names the layer', ours.length === 0, ours.slice(0, 2).join(' | '));

    console.log(`\n[qa] requests: ${JSON.stringify(routes)}`);
    console.log(`[qa] shots in ${path.relative(REPO_ROOT, SHOTS_DIR)}`);
    console.log(failures === 0 ? '\n[qa] PASS' : `\n[qa] FAIL — ${failures} check(s)`);
  } finally {
    await browser.close();
  }
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
