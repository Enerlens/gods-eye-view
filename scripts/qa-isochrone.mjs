#!/usr/bin/env node
/**
 * Browser proof for the catchment-area layer, over Lyon AND Paris.
 *
 * Intercepts nothing: the Géoplateforme isochrone service is keyless and public,
 * and the proxy caches per point, so the strongest available proof is the real
 * one — boot the app, turn the layer on, read what reached the globe.
 *
 * What it proves, and why each needs a browser rather than a unit test:
 *
 *   i.    from too high the layer draws NOTHING and says to descend — a 2 km²
 *         ring seen from 12 km up is a smudge, and a smudge that looks like an
 *         answer is worse than no answer
 *   ii.   over a city three nested rings appear, each with a REAL measured area,
 *         growing outward — in both Lyon and Paris
 *   iii.  the expansion reading is present and is not a constant: the two cities
 *         obstruct differently, which is the whole point of measuring it
 *   iv.   switching to VOITURE refetches and the areas grow by an order of
 *         magnitude — a drive is not a recolouring of a walk
 *   v.    the VÉLO chip works, and what it draws declares itself an ENVELOPE:
 *         a second upstream (OSM/OSRM), a dashed outline, a majorant area
 *   vi.   the ceiling follows the mode — 30 km is dormant on foot and drawing
 *         by car, which is the whole point of measuring a driving catchment
 *   vii.  a click on the globe PINS the centre, the camera stops moving it,
 *         and the ceiling stops applying
 *   viii. the share link carries the mode
 *   ix.   every ring label is pickable and opens a card — the ONLY reachable
 *         card path, since a clamped outline answers scene.pick with null
 *
 * Run: node scripts/qa-isochrone.mjs --url http://localhost:4173
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'isochrone');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = option('--url', process.env.QA_BASE_URL || 'http://localhost:4173');
const HEADFUL = args.includes('--headful');
const LAYER = 'isochrone-fr';

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

/** Above the walking ceiling of 8 km — the view it must refuse on foot. */
const TOO_HIGH = { lon: 4.8357, lat: 45.764, height: 40_000 };
/** Between the walking ceiling and the driving one: dormant on foot, live by car. */
const HIGH_ENOUGH_TO_DRIVE = { lon: 4.8357, lat: 45.7578, height: 30_000 };
/** Place Bellecour and place de la République: two dense, well-connected centres. */
const LYON = { lon: 4.8357, lat: 45.7578, height: 2_400 };
const PARIS = { lon: 2.3639, lat: 48.8674, height: 2_400 };

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
 * Wait for the scan the camera move started.
 *
 * Three rings are three sequential upstream round trips, so a cold point is
 * comfortably over a second; polling the layer's own `lastUpdate` is the only
 * beat that is not a guess. A DORMANT layer never updates at all, so that has
 * to be a valid way out or the harness hangs on the state test (i) is about.
 */
async function waitForSettled(page, timeoutMs = 40000) {
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
        rings: stats.ringsDrawn ?? 0,
      };
    }, LAYER);
    if (state.error) return state;
    if (state.dormant) return state;
    if (state.lastUpdate > before && state.rings > 0) return state;
    await sleep(200);
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
    const stats = module.getStats();
    const controls = module.getRowControls();
    const source = gev.viewer.dataSources.getByName(id)[0];
    const entities = source ? [...source.entities.values] : [];
    return {
      stats,
      chips: controls.chips.map((chip) => ({
        id: chip.id, active: chip.active, disabled: Boolean(chip.disabled),
        state: chip.state, title: chip.title,
      })),
      legend: controls.legend.map((row) => ({ label: row.label, count: row.count })),
      entityIds: entities.map((entity) => String(entity.id)),
      // What a click could actually reach: an entity with a position AND a
      // description is a card; a clamped polyline is neither.
      cardIds: entities
        .filter((entity) => entity.position && entity.description)
        .map((entity) => String(entity.id)),
      // The one visual difference between a polygon and an envelope that a
      // harness can read: an envelope's outline is a dash material.
      outlineMaterials: entities
        .filter((entity) => String(entity.id).includes(':outline'))
        .map((entity) => entity.polyline?.material?.constructor?.name || 'none'),
      centreCard: entities.find((entity) => String(entity.id) === 'isochrone:centre')
        ?.description?.getValue?.(window.__godsEyeView.viewer.clock.currentTime) || null,
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
    protocolTimeout: 120000,
  });

  try {
    const page = await newQaPage(browser);
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    let isochroneRequests = 0;
    const isochroneResponses = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/isochrone')) isochroneRequests += 1;
    });
    page.on('response', (response) => {
      if (response.url().includes('/api/isochrone')) {
        isochroneResponses.push({ status: response.status(), url: response.url().slice(-90) });
      }
    });

    console.log(`[qa] booting ${APP_URL}`);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => Boolean(window.__godsEyeView?.dataManager), { timeout: 60000 });
    await pump(page, 6);

    // ── i. the altitude refusal ────────────────────────────────────────────
    console.log('\n[1] From 40 km the layer refuses, and says to descend');
    await setView(page, TOO_HIGH);
    await page.evaluate((id) => window.__godsEyeView.dataManager.setEnabled(
      id, true, { origin: 'user' },
    ), LAYER);
    await waitForSettled(page);
    await pump(page, 6);
    let state = await probe(page);
    check('nothing is drawn', state.stats.count === 0, `count=${state.stats.count}`);
    check('the row says to descend rather than reporting an error',
      /descends/i.test(state.stats.loadingLabel || ''), state.stats.loadingLabel || 'no label');
    check('no request was spent on a view it would refuse', isochroneRequests === 0,
      `${isochroneRequests} requests`);
    await shoot(page, '01-too-high.png');

    // ── ii. Lyon on foot ──────────────────────────────────────────────────
    console.log('\n[2] Place Bellecour, on foot: three nested rings');
    await setView(page, LYON);
    await pump(page, 10);
    const lyonFoot = await probe(page);
    check('three rings are drawn', lyonFoot.stats.ringsDrawn === 3,
      `ringsDrawn=${lyonFoot.stats.ringsDrawn}`);
    check('none was refused by the service', lyonFoot.stats.ringsMissing === 0,
      `missing=${lyonFoot.stats.ringsMissing}`);
    const areas = lyonFoot.stats.areasKm2 || [];
    check('the areas grow outward',
      areas.length === 3 && areas[0] < areas[1] && areas[1] < areas[2], JSON.stringify(areas));
    check('a fifteen-minute walk is a plausible size',
      areas[2] > 0.5 && areas[2] < 12, `${areas[2]} km²`);
    check('an equivalent radius is reported beside the shape',
      Number.isFinite(lyonFoot.stats.outerRadiusM), `${lyonFoot.stats.outerRadiusM} m`);
    // The layer draws 3 fills + 3 outlines + 3 labels + 1 centre marker.
    check('every ring drew a fill, an outline and a label',
      lyonFoot.entityIds.filter((id) => id.endsWith(':fill')).length === 3
      && lyonFoot.entityIds.filter((id) => id.endsWith(':outline')).length === 3
      && lyonFoot.entityIds.filter((id) => id.endsWith(':label')).length === 3,
      lyonFoot.entityIds.join(','));
    check('four things carry a card — three labels and the centre',
      lyonFoot.cardIds.length === 4, lyonFoot.cardIds.join(','));
    await shoot(page, '02-lyon-pied.png');
    console.log(`      ${areas.join(' / ')} km² · cercle équivalent ${lyonFoot.stats.outerRadiusM} m`
      + ` · expansion ${lyonFoot.stats.expansionShare} %`);

    // ── iii. the expansion reading ────────────────────────────────────────
    console.log('\n[3] The expansion reading is a measurement, not a constant');
    check('Lyon reports an expansion share', Number.isFinite(lyonFoot.stats.expansionShare),
      `${lyonFoot.stats.expansionShare}`);
    check('and it is in a plausible band',
      lyonFoot.stats.expansionShare > 20 && lyonFoot.stats.expansionShare < 200,
      `${lyonFoot.stats.expansionShare} %`);

    // ── iv. by car ────────────────────────────────────────────────────────
    console.log('\n[4] Switching to VOITURE refetches, and the rings grow');
    const beforeCar = isochroneRequests;
    await page.evaluate((id) => window.__godsEyeView.dataManager.setLayerParams(
      id, { profile: 'car' }, { origin: 'user' },
    ), LAYER);
    await waitForSettled(page);
    await pump(page, 10);
    const lyonCar = await probe(page);
    check('the active chip moved', lyonCar.chips.find((chip) => chip.active)?.id === 'car',
      lyonCar.chips.find((chip) => chip.active)?.id);
    check('a request WAS spent — a drive is a different question, not a recolour',
      isochroneRequests > beforeCar, `${isochroneRequests - beforeCar} extra`);
    const carAreas = lyonCar.stats.areasKm2 || [];
    check('driving reaches much further than walking',
      carAreas[2] > areas[2] * 3, `${carAreas[2]} vs ${areas[2]} km²`);
    await shoot(page, '03-lyon-voiture.png');
    console.log(`      ${carAreas.join(' / ')} km² · cercle équivalent ${lyonCar.stats.outerRadiusM} m`);

    // ── v. the cycling envelope ───────────────────────────────────────────
    console.log('\n[5] VÉLO measures on a second network, and says so');
    const bikeChip = lyonCar.chips.find((chip) => chip.id === 'bike');
    check('the chip is there and can be pressed', bikeChip?.disabled === false,
      JSON.stringify(bikeChip));
    check('it names the other network before it is pressed',
      /OSM|OSRM/.test(bikeChip?.title || ''), bikeChip?.title);
    const beforeBike = isochroneRequests;
    const tookBike = await page.evaluate((id) => window.__godsEyeView.dataManager.setLayerParams(
      id, { profile: 'bike' }, { origin: 'user' },
    ), LAYER);
    await waitForSettled(page);
    await pump(page, 10);
    const lyonBike = await probe(page);
    check('setLayerParams accepts it', tookBike === true, String(tookBike));
    check('a request was spent on it', isochroneRequests > beforeBike,
      `${isochroneRequests - beforeBike} extra`);
    check('three rings came back', lyonBike.stats.ringsDrawn === 3,
      `ringsDrawn=${lyonBike.stats.ringsDrawn}`);
    const bikeAreas = lyonBike.stats.areasKm2 || [];
    check('cycling lands between walking and driving',
      bikeAreas[2] > areas[2] && bikeAreas[2] < carAreas[2],
      `${areas[2]} < ${bikeAreas[2]} < ${carAreas[2]} km²`);
    check('the row says it is an envelope, not a polygon',
      lyonBike.stats.envelope === true, String(lyonBike.stats.envelope));
    check('and names the network it was measured on',
      /ODbL|OSRM|OpenStreetMap/.test(lyonBike.stats.feedSource || ''), lyonBike.stats.feedSource);
    check('every outline is drawn dashed, so the two kinds never look alike',
      lyonBike.outlineMaterials.length === 3
      && lyonBike.outlineMaterials.every((name) => /Dash/.test(name)),
      lyonBike.outlineMaterials.join(','));
    check('the centre card refuses to be read as the IGN polygon',
      /majorée|enveloppe/i.test(lyonBike.centreCard || ''), (lyonBike.centreCard || '').slice(0, 120));
    check('the legend calls the area a majorant',
      /majorée/.test(await page.evaluate((id) => window.__godsEyeView.dataManager.layers
        .get(id).module.getRowControls().legend[0].blurb, LAYER)));
    await shoot(page, '05-lyon-velo.png');
    console.log(`      ${bikeAreas.join(' / ')} km² · enveloppe sur 36 directions`);

    // A ring label opened from the envelope has to carry the caveat too.
    const bikeLabelCard = await page.evaluate((id) => {
      const source = window.__godsEyeView.viewer.dataSources.getByName(id)[0];
      const entity = [...source.entities.values].find((e) => String(e.id) === 'isochrone:900:label');
      return entity?.description?.getValue?.(window.__godsEyeView.viewer.clock.currentTime) || null;
    }, LAYER);
    check('a ring card prints the spoke count and the reach spread',
      /36 directions/.test(bikeLabelCard || '') && /portée mesurée/.test(bikeLabelCard || ''),
      (bikeLabelCard || '').slice(0, 160));

    // ── vi. the ceiling follows the mode ──────────────────────────────────
    console.log('\n[6] 30 km up: dormant on foot, still measuring by car');
    await page.evaluate((id) => window.__godsEyeView.dataManager.setLayerParams(
      id, { profile: 'foot' }, { origin: 'user' },
    ), LAYER);
    await setView(page, HIGH_ENOUGH_TO_DRIVE);
    await pump(page, 8);
    const highFoot = await probe(page);
    check('on foot at 30 km the layer is dormant', highFoot.stats.dormant === true,
      `dormant=${highFoot.stats.dormant}`);
    check('and the sentence offers both ways out',
      /descends/i.test(highFoot.stats.loadingLabel || '')
      && /clique/i.test(highFoot.stats.loadingLabel || ''), highFoot.stats.loadingLabel);
    await page.evaluate((id) => window.__godsEyeView.dataManager.setLayerParams(
      id, { profile: 'car' }, { origin: 'user' },
    ), LAYER);
    await waitForSettled(page);
    await pump(page, 10);
    const highCar = await probe(page);
    check('by car at the same 30 km it measures', highCar.stats.dormant === false
      && highCar.stats.ringsDrawn === 3, `dormant=${highCar.stats.dormant} rings=${highCar.stats.ringsDrawn}`);
    check('the reported ceiling is the driving one',
      highCar.stats.maxAltitudeM >= 30_000, `${highCar.stats.maxAltitudeM} m`);
    await shoot(page, '06-voiture-30km.png');

    // ── vii. the centre the reader chose ──────────────────────────────────
    console.log('\n[7] A click pins the centre, and the camera stops owning it');
    const clicked = await page.evaluate(() => {
      const gev = window.__godsEyeView;
      const canvas = gev.viewer.scene.canvas;
      return { x: Math.round(canvas.clientWidth * 0.38), y: Math.round(canvas.clientHeight * 0.62) };
    });
    await page.mouse.click(clicked.x, clicked.y);
    await waitForSettled(page);
    await pump(page, 10);
    const pinned = await probe(page);
    check('a real canvas click set a pin', Boolean(pinned.stats.scanPin),
      JSON.stringify(pinned.stats.scanPin));
    check('the row reports it as pinned', pinned.stats.pinned === true);
    check('the scan centre IS the pin',
      Math.abs((pinned.stats.scanCentre?.lat ?? 0) - (pinned.stats.scanPin?.lat ?? 9)) < 1e-4
      && Math.abs((pinned.stats.scanCentre?.lon ?? 0) - (pinned.stats.scanPin?.lon ?? 9)) < 1e-4,
      JSON.stringify(pinned.stats.scanCentre));
    check('the centre marker says so on its card',
      /fixé/i.test(pinned.centreCard || ''), (pinned.centreCard || '').slice(0, 120));
    check('a release chip appeared',
      pinned.chips.some((chip) => chip.id === 'centre-camera'),
      pinned.chips.map((chip) => chip.id).join(','));
    await shoot(page, '07-point-fixe.png');

    // The ceiling no longer applies: pull back past the driving ceiling and the
    // catchment must still be on screen, which is the complaint this fixes.
    const beforeFly = isochroneRequests;
    await setView(page, { lon: 4.8357, lat: 45.7578, height: 90_000 });
    await pump(page, 10);
    const flown = await probe(page);
    check('90 km up, a pinned catchment is still drawn', flown.stats.dormant === false
      && flown.stats.ringsDrawn === 3, `dormant=${flown.stats.dormant} rings=${flown.stats.ringsDrawn}`);
    check('and flying there spent no request', isochroneRequests === beforeFly,
      `${isochroneRequests - beforeFly} extra`);
    check('the pin did not follow the camera',
      Math.abs((flown.stats.scanPin?.lat ?? 0) - (pinned.stats.scanPin?.lat ?? 9)) < 1e-9,
      JSON.stringify(flown.stats.scanPin));
    await shoot(page, '08-point-fixe-recul.png');

    const released = await page.evaluate((id) => {
      window.__godsEyeView.dataManager.setLayerParams(id, { centre: 'camera' }, { origin: 'user' });
      return window.__godsEyeView.dataManager.layers.get(id).module.getStats();
    }, LAYER);
    await pump(page, 8);
    const afterRelease = await probe(page);
    check('releasing the pin brings the ceiling back',
      afterRelease.stats.scanPin === null && afterRelease.stats.dormant === true,
      `pin=${JSON.stringify(afterRelease.stats.scanPin)} dormant=${afterRelease.stats.dormant}`);
    void released;

    // ── viii. the share link ──────────────────────────────────────────────
    console.log('\n[8] The share link carries the mode');
    const hash = await page.evaluate(() => window.location.hash || '');
    check('the hash enables the layer', /[?&]l=[^&]*\bis\b/.test(hash) || /(^|\.)is(\.|&|$)/.test(hash),
      hash.slice(0, 200));
    check('and carries the driving mode', /is\.p\.c/.test(hash), hash.slice(0, 200));
    // Cycling encodes too, now that it is a state the app can actually produce.
    await page.evaluate((id) => window.__godsEyeView.dataManager.setLayerParams(
      id, { profile: 'bike' }, { origin: 'user' },
    ), LAYER);
    // The share link is written on a 500 ms debounce, so this polls rather than
    // guessing a frame count.
    let bikeHash = '';
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await sleep(150);
      bikeHash = await page.evaluate(() => window.location.hash || '');
      if (/is\.p\.b/.test(bikeHash)) break;
    }
    check('and the cycling mode too', /is\.p\.b/.test(bikeHash),
      (bikeHash.match(/lo=[^&]*/) || ['no lo= in the hash'])[0]);

    // ── ix. Paris ─────────────────────────────────────────────────────────
    console.log('\n[9] Place de la République, on foot: the same layer, a different city');
    await page.evaluate((id) => window.__godsEyeView.dataManager.setLayerParams(
      id, { profile: 'foot' }, { origin: 'user' },
    ), LAYER);
    await setView(page, PARIS);
    await pump(page, 10);
    const paris = await probe(page);
    const parisAreas = paris.stats.areasKm2 || [];
    check('three rings over Paris too', paris.stats.ringsDrawn === 3,
      `ringsDrawn=${paris.stats.ringsDrawn}`);
    check('the areas grow outward',
      parisAreas.length === 3 && parisAreas[0] < parisAreas[1] && parisAreas[1] < parisAreas[2],
      JSON.stringify(parisAreas));
    check('Paris reports its own expansion, not Lyon\'s',
      Number.isFinite(paris.stats.expansionShare)
      && paris.stats.expansionShare !== lyonFoot.stats.expansionShare,
      `paris=${paris.stats.expansionShare} lyon=${lyonFoot.stats.expansionShare}`);
    await shoot(page, '04-paris-pied.png');
    console.log(`      ${parisAreas.join(' / ')} km² · cercle équivalent ${paris.stats.outerRadiusM} m`
      + ` · expansion ${paris.stats.expansionShare} %`);

    // ── the plumbing ──────────────────────────────────────────────────────
    const badResponses = isochroneResponses.filter((entry) => entry.status !== 200);
    check('every isochrone request answered 200', badResponses.length === 0,
      JSON.stringify(badResponses.slice(0, 2)));
    const ours = consoleErrors.filter((text) => /isochrone|chalandise/i.test(text));
    check('no console error names the layer', ours.length === 0, ours.slice(0, 2).join(' | '));

    console.log(`\n[qa] ${isochroneRequests} isochrone requests total`);
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
