#!/usr/bin/env node
/**
 * Browser proof for the avis de valeur, over Paris, the Lozère and Strasbourg.
 *
 * The unit tests pin the arithmetic against a fixture. What only a browser and
 * the live register can prove is that the three ANSWERS are all reachable on
 * real ground, that each one says which of them it is, and that the sentence a
 * reader clicks arrives whole.
 *
 *   i.    from 40 km up nothing is estimated, and no source is queried
 *   ii.   a Paris block answers: a centre, a band, an interval, and the ring
 *         of the rung the ladder actually stopped at
 *   iii.  the card survives the factory's own ` · ` splitter — the failure no
 *         unit test on the payload can catch
 *   iv.   the comparables drawn are the ones the answer was computed from, and
 *         they are painted in the three classes of the published band
 *   v.    changing the subject changes the comparables, the answer, and the
 *         share link — a 150 m² flat is not a rescaling of a 60 m² one
 *   vi.   a click on bare ground pins the subject and puts its card up
 *   vii.  over the Lozère the layer publishes a band and REFUSES a centre, on
 *         live data, naming the clause that refused it
 *   viii. over Strasbourg it says the register does not reach there — which is
 *         not the same sentence as "no sale was found"
 *
 * Run: node scripts/qa-avis-valeur.mjs --url http://localhost:4173
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'avis-valeur');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = option('--url', process.env.QA_BASE_URL || 'http://localhost:4173');
const HEADFUL = args.includes('--headful');
const LAYER = 'avis-valeur';

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

/**
 * Poll with `page.evaluate`, never `page.waitForFunction`.
 *
 * Puppeteer's default polling is `raf`, and under SwiftShader with the app's
 * render governor in `requestRenderMode` nothing ever schedules a frame — so
 * the wait sits out its whole timeout while the condition has been true for a
 * minute. The failure reads as "the app never booted".
 */
async function waitFor(page, fn, { timeoutMs = 60000, gapMs = 250 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (await page.evaluate(fn)) return true;
    } catch { /* context still swapping */ }
    await sleep(gapMs);
  }
  return false;
}

/** Avenue de France, Paris 13e — the block the fixture was cut around. */
const PARIS = { lon: 2.3735, lat: 48.8300, height: 2_000 };
/** Les Monts-Verts (48012), Lozère: 23 mutations in three editions. */
const LOZERE = { lon: 3.251397, lat: 44.866577, height: 2_000 };
/** Strasbourg — the livre foncier, where DVF has no file at all. */
const STRASBOURG = { lon: 7.7455, lat: 48.5839, height: 2_000 };
const TOO_HIGH = { lon: 2.3735, lat: 48.8300, height: 40_000 };

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
 * A scan here parses up to three commune-years of DVF CSV on a cold cache —
 * comfortably over a second, and a Paris arrondissement is 750 KB a year.
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
    const subject = entities.find((entity) => String(entity.id) === 'avis:subject');
    const now = window.__godsEyeView?.viewer?.clock?.currentTime;
    const description = subject?.description?.getValue?.(now) ?? null;
    const controls = module.getRowControls() || {};
    const colourOf = (entity) => {
      const colour = entity?.billboard?.color?.getValue?.(now);
      if (!colour) return null;
      const hex = (value) => Math.round(value * 255).toString(16).padStart(2, '0');
      return `#${hex(colour.red)}${hex(colour.green)}${hex(colour.blue)}`;
    };
    return {
      stats: module.getStats(),
      params: module.getParams(),
      chips: (controls.chips || []).map((chip) => ({ id: chip.id, active: chip.active })),
      legend: (controls.legend || []).map((row) => ({
        label: row.label, count: row.count, color: row.color,
      })),
      entityIds: entities.map((entity) => String(entity.id)),
      comparableColours: entities
        .filter((entity) => String(entity.id).startsWith('avis:sale:'))
        .map(colourOf),
      subjectColour: colourOf(subject),
      title: subject?.name ?? null,
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
    const routes = { avis: 0, ban: 0 };
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('/api/avis-valeur')) routes.avis += 1;
      else if (url.includes('api-adresse.data.gouv.fr')) routes.ban += 1;
    });

    console.log(`[qa] booting ${APP_URL}`);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const booted = await waitFor(page, () => Boolean(window.__godsEyeView?.dataManager));
    if (!booted) throw new Error('the app never exposed its data manager');
    await pump(page, 6);

    // ── i. the altitude refusal ────────────────────────────────────────────
    console.log('\n[1] From 40 km up there is nothing to estimate');
    await setView(page, TOO_HIGH);
    await page.evaluate((id) => window.__godsEyeView.dataManager.setEnabled(
      id, true, { origin: 'user' },
    ), LAYER);
    await waitForSettled(page);
    await pump(page, 6);
    let state = await probe(page);
    check('nothing is drawn', state.stats.count === 0, `count=${state.stats.count}`);
    check('the layer says so rather than erroring', state.stats.dormant === true,
      JSON.stringify({ dormant: state.stats.dormant, error: state.stats.error }));
    check('the register was never asked', routes.avis === 0, String(routes.avis));
    check('the chips exist before any scan', state.chips.length >= 6,
      JSON.stringify(state.chips));

    // ── ii. a Paris block ─────────────────────────────────────────────────
    console.log('\n[2] Avenue de France: a centre, a band, and an interval');
    await setView(page, PARIS);
    await pump(page, 12);
    const paris = await probe(page);
    check('the estimate route was queried', routes.avis >= 1, String(routes.avis));
    check('an answer was published', paris.stats.basis === 'comparables',
      `${paris.stats.basis} / ${paris.stats.reason}`);
    check('on a plausible Paris price', paris.stats.prixM2Median > 4_000
      && paris.stats.prixM2Median < 20_000, `${paris.stats.prixM2Median} €/m²`);
    check('the band brackets the centre',
      paris.stats.prixM2P25 <= paris.stats.prixM2Median
      && paris.stats.prixM2Median <= paris.stats.prixM2P75,
      `${paris.stats.prixM2P25} / ${paris.stats.prixM2Median} / ${paris.stats.prixM2P75}`);
    check('the interval on the centre is published and tight',
      paris.stats.ciDeviationMaxPct > 0 && paris.stats.ciDeviationMaxPct <= 20,
      `${paris.stats.ciDeviationMaxPct} %`);
    check('and both ends of it are reported, not one ±',
      Number.isFinite(paris.stats.ciDeviationLowPct)
      && Number.isFinite(paris.stats.ciDeviationHighPct)
      && paris.stats.ciDeviationMaxPct
        === Math.max(paris.stats.ciDeviationLowPct, paris.stats.ciDeviationHighPct),
      `${paris.stats.ciDeviationLowPct} / ${paris.stats.ciDeviationHighPct}`);
    check('and it names its own coverage',
      paris.stats.ciCoverage >= 0.9 && paris.stats.ciCoverage <= 1,
      String(paris.stats.ciCoverage));
    check('the euro total is the €/m² times the surface, rounded',
      Math.abs(paris.stats.valeurMedian
        - paris.stats.prixM2Median * paris.stats.subjectSurfaceM2) <= 500,
      `${paris.stats.valeurMedian} vs ${paris.stats.prixM2Median * paris.stats.subjectSurfaceM2}`);
    check('the subject and its comparables are drawn',
      paris.entityIds.includes('avis:subject')
      && paris.entityIds.filter((id) => id.startsWith('avis:sale:')).length >= 5,
      `${paris.entityIds.length} entities`);
    check('the ring of the rung the ladder stopped at is drawn',
      paris.entityIds.includes('avis:rung'), paris.entityIds.join(',').slice(0, 200));
    check('every rung tried is reported', paris.stats.rungsTried >= 1,
      String(paris.stats.rungsTried));
    await shoot(page, '01-paris-avis.png');
    console.log(`      « ${paris.title} »`);
    for (const line of paris.lines) console.log(`        ${line}`);

    // ── iii. the card cannot shatter ──────────────────────────────────────
    console.log('\n[3] The card survives the factory\'s own splitter');
    check('the card has real lines', paris.lines.length >= 6, `${paris.lines.length} lines`);
    check('the value line arrived whole',
      paris.lines.some((line) => /^\d[\d   ]* €$/.test(line.trim())),
      paris.lines.join(' | '));
    check('the band sentence arrived whole, and it is a band of €/m²',
      paris.lines.some((line) => /^fourchette .*€\/m².* — la moitié des ventes comparables$/
        .test(line)),
      paris.lines.join(' | '));
    check('the euro total is separate, and says it is not a price anyone paid',
      paris.lines.some((line) => /^soit .+ ramené aux \d+ m² du sujet — pas des prix payés$/
        .test(line)),
      paris.lines.join(' | '));
    check('the interval sentence arrived whole',
      paris.lines.some((line) => /^milieu connu à .+ %/.test(line)),
      paris.lines.join(' | '));
    check('the rung is named on the card',
      paris.lines.some((line) => /^mesuré sur /.test(line)), paris.lines.join(' | '));
    check('and the card refuses to pass for a regulated valuation',
      paris.lines.some((line) => /pas un avis de valeur réglementaire/.test(line)),
      paris.lines.join(' | '));

    // ── iv. what the dots mean ────────────────────────────────────────────
    console.log('\n[4] The dots are the sales the answer was computed from');
    const classes = new Set(paris.comparableColours.filter(Boolean));
    check('the comparables are painted in the band classes',
      [...classes].every((hex) => ['#63b3ff', '#f4ece0', '#e05aa6'].includes(hex)),
      [...classes].join(','));
    check('and the band is actually populated', classes.has('#f4ece0'),
      [...classes].join(','));
    check('the subject is not painted like a sale',
      paris.subjectColour === '#00ffa3', String(paris.subjectColour));
    const bandRows = paris.legend.filter((row) => ['#63b3ff', '#f4ece0', '#e05aa6']
      .includes(row.color));
    check('the legend counts all three classes', bandRows.length === 3,
      JSON.stringify(bandRows));
    check('the three counts add up to the comparables drawn',
      bandRows.reduce((sum, row) => sum + (row.count || 0), 0) === paris.stats.served,
      `${bandRows.map((row) => row.count).join('+')} vs ${paris.stats.served}`);
    check('the headline legend row is the answer itself',
      /€/.test(paris.legend[0]?.label || ''), String(paris.legend[0]?.label));

    // ── v. the subject is the question ────────────────────────────────────
    console.log('\n[5] Changing the subject changes the answer, not its scale');
    await page.evaluate((id) => window.__godsEyeView.dataManager.setLayerParams(
      id, { surface: '150' }, { origin: 'user' },
    ), LAYER);
    await waitForSettled(page);
    await pump(page, 10);
    const large = await probe(page);
    check('the active chip moved',
      large.chips.some((chip) => chip.id === 'surface:150' && chip.active),
      JSON.stringify(large.chips));
    check('the comparable set is a different one',
      large.stats.comparableCount !== paris.stats.comparableCount,
      `${large.stats.comparableCount} vs ${paris.stats.comparableCount}`);
    check('a 150 m² flat is not a 60 m² flat times 2.5',
      large.stats.basis !== 'comparables'
      || large.stats.prixM2Median !== paris.stats.prixM2Median,
      `${large.stats.prixM2Median} vs ${paris.stats.prixM2Median}`);
    await shoot(page, '02-paris-150m2.png');
    console.log(`      150 m² : ${large.stats.basis} — ${large.stats.comparableCount} comparables `
      + `sur ${large.stats.rungId}`);

    const hash = await page.evaluate(() => window.location.hash || '');
    check('the share link carries the layer', /(^|[.&=])vv([.&]|$)/.test(hash),
      hash.slice(0, 200));
    check('and the subject surface', /vv\.[^&]*s\.x/.test(hash), hash.slice(0, 200));

    await page.evaluate((id) => window.__godsEyeView.dataManager.setLayerParams(
      id, { surface: '60' }, { origin: 'user' },
    ), LAYER);
    await waitForSettled(page);

    // ── vi. the pin ───────────────────────────────────────────────────────
    // Driven through `setLayerParams`, which is exactly what the layer's own
    // `groundClick` calls: a synthetic click on the Cesium canvas is the one
    // gesture that starves reliably under SwiftShader, and the shell's
    // click-to-pin path is already proven by `qa-isochrone.mjs`. What is under
    // test here is what the PIN does to this layer — rescan, card, chip.
    console.log('\n[6] Pinning the subject moves the answer to a chosen door');
    const before = await probe(page);
    await page.evaluate((id) => window.__godsEyeView.dataManager.setLayerParams(
      id, { centre: '2.3702,48.8285' }, { origin: 'user' },
    ), LAYER);
    await waitForSettled(page);
    await pump(page, 10);
    const pinned = await probe(page);
    check('the centre is now a coordinate, not the camera',
      pinned.params.centre !== 'camera', String(pinned.params.centre));
    check('the release chip appeared',
      pinned.chips.some((chip) => chip.id === 'centre:camera'),
      JSON.stringify(pinned.chips.map((chip) => chip.id)));
    check('the card of the pinned subject is open',
      pinned.stats.selectedId === 'avis:subject', String(pinned.stats.selectedId));
    check('and it still answers', pinned.stats.comparableCount > 0,
      `${pinned.stats.comparableCount}`);
    check('the scan really moved', pinned.params.centre !== before.params.centre,
      `${before.params.centre} → ${pinned.params.centre}`);
    await shoot(page, '03-paris-pinned.png');

    await page.evaluate((id) => window.__godsEyeView.dataManager.setLayerParams(
      id, { centre: 'camera' }, { origin: 'user' },
    ), LAYER);
    await waitForSettled(page);

    // ── vii. the Lozère ───────────────────────────────────────────────────
    // PINNED, not flown to. A camera-derived centre is pulled up to 6 km
    // toward what the screen centre hits, and Les Monts-Verts is 30 km² of
    // Lozère — measured, the flight lands in a neighbouring commune often
    // enough that the section would be a coin toss. The pin is the same
    // production path section [6] just proved.
    console.log('\n[7] Les Monts-Verts: a band, and a centre withheld out loud');
    await setView(page, LOZERE);
    await page.evaluate((id, centre) => window.__godsEyeView.dataManager.setLayerParams(
      id, { type: 'Maison', surface: '100', centre }, { origin: 'user' },
    ), LAYER, `${LOZERE.lon},${LOZERE.lat}`);
    await waitForSettled(page);
    await pump(page, 12);
    const lozere = await probe(page);
    check('the ladder had to walk out to the commune',
      lozere.stats.rungsTried >= 4, String(lozere.stats.rungsTried));
    check('no centre is published', lozere.stats.prixM2Median === null,
      String(lozere.stats.prixM2Median));
    check('but the centre it saw is named rather than hidden',
      lozere.stats.prixM2Withheld > 0, String(lozere.stats.prixM2Withheld));
    check('the band survives', lozere.stats.prixM2P25 > 0 && lozere.stats.prixM2P75 > 0,
      `${lozere.stats.prixM2P25}–${lozere.stats.prixM2P75}`);
    check('and the refusal names its clause',
      ['centre-softer-than-market', 'interval-too-wide'].includes(lozere.stats.reason),
      String(lozere.stats.reason));
    check('the subject is not painted as an answer',
      lozere.subjectColour !== '#00ffa3', String(lozere.subjectColour));
    // The pin opened the card, and `emphasiseAddressMarker()` recolours the
    // SELECTED marker — measured, it reads `#7fd7ff` while the card is up. So
    // the layer's own tint is read with the card dismissed, which is also the
    // state a reader sees the marker in from across the map.
    await page.evaluate(() => document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ));
    await pump(page, 6);
    const lozereQuiet = await probe(page);
    check('and once the card is dismissed it takes the withheld tint',
      lozereQuiet.subjectColour === '#9aa7bd', String(lozereQuiet.subjectColour));
    check('the card says which silence this is',
      lozere.lines.some((line) => /Fourchette seulement/.test(line)),
      lozere.lines.join(' | '));
    await shoot(page, '04-lozere-range.png');
    for (const line of lozere.lines) console.log(`        ${line}`);

    // ── viii. Strasbourg ──────────────────────────────────────────────────
    console.log('\n[8] Strasbourg: the register does not reach here');
    await setView(page, STRASBOURG);
    await page.evaluate((id, centre) => window.__godsEyeView.dataManager.setLayerParams(
      id, { type: 'Appartement', surface: '60', centre }, { origin: 'user' },
    ), LAYER, `${STRASBOURG.lon},${STRASBOURG.lat}`);
    await waitForSettled(page);
    await pump(page, 12);
    const alsace = await probe(page);
    check('nothing is published', alsace.stats.basis === 'none', String(alsace.stats.basis));
    check('and the reason is the register, not the market',
      alsace.stats.reason === 'register-does-not-cover', String(alsace.stats.reason));
    check('the coverage is named', alsace.stats.coverageBasis === 'livre-foncier',
      String(alsace.stats.coverageBasis));
    check('the card says livre foncier',
      alsace.lines.some((line) => /livre foncier/.test(line)), alsace.lines.join(' | '));
    await shoot(page, '05-strasbourg-uncovered.png');
    for (const line of alsace.lines) console.log(`        ${line}`);

    const ours = consoleErrors.filter((text) => /avis|valeur/i.test(text));
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
