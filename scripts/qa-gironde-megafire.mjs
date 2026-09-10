#!/usr/bin/env node
/**
 * Deterministic browser proof for the Mégafeu de Gironde layer
 * (`gironde-megafire-2026`).
 *
 * The pack is a SHIPPED file and its numbers are already guarded offline by
 * `src/data/megafirePack.test.mjs`. What no unit test can reach is whether the
 * reconstruction actually arrives on a globe, so this harness proves the six
 * things that only a live Cesium scene can:
 *
 *   i.   the layer loads its two pack files and lands on the CLOSING frame —
 *        a reader who switches it on sees the finished fire, not an empty pine
 *        forest waiting to be played
 *   ii.  a ground perimeter really reaches the scene, with holes: the polygon
 *        count on screen matches the pack, and the batch carries ONE colour
 *        (the Cesium rectangle-classification trap)
 *   iii. every step chip seeks, and the perimeter, the fronts, the flames and
 *        the hectares on the card all change together and agree with the pack
 *   iv.  the ember field is CAUSAL: at the first frame only detections older
 *        than that instant are shown, and the count climbs monotonically as
 *        the cursor advances
 *   v.   playback moves the cursor, holds the render governor open while it
 *        runs, and releases it when it stops at the end
 *   vi.  disabling the layer removes every primitive it added
 *
 * Screenshots are written under the gitignored `qa-shots/gironde-megafire/`
 * and are OPT-IN (`--shots`): on this app `page.screenshot()` can hang for
 * minutes, so a proof must never depend on one.
 *
 * Run: node scripts/qa-gironde-megafire.mjs --url http://localhost:4173
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'gironde-megafire');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = option('--url', process.env.QA_BASE_URL || 'http://localhost:4173');
const HEADFUL = args.includes('--headful');
const SHOTS = args.includes('--shots');

const LAYER_ID = 'gironde-megafire-2026';
const PACK = JSON.parse(fs.readFileSync(
  path.join(REPO_ROOT, 'src', 'data', 'local_data', 'gironde_megafire_2026', 'event.json'), 'utf8',
));

const HOTSPOTS = JSON.parse(fs.readFileSync(
  path.join(REPO_ROOT, 'src', 'data', 'local_data', 'gironde_megafire_2026', 'hotspots.json'), 'utf8',
));
const LAST_STEP_MINUTES = Math.round(
  (Date.parse(PACK.steps[PACK.steps.length - 1].acq) - Date.parse(HOTSPOTS.epoch)) / 60000,
);
const EXPECTED_AT_LAST_STEP = HOTSPOTS.rows
  .filter((row) => row[2] <= LAST_STEP_MINUTES).length;

/** A view that holds the whole burn scar, from the Bassin to Saint-Médard. */
const GIRONDE = { lon: -1.03, lat: 44.89, height: 120_000 };

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

/**
 * Poll a predicate with `page.evaluate`, never `page.waitForFunction`.
 *
 * Under SwiftShader the default rAF polling never ticks, and the interval form
 * has been seen to time out at the protocol layer on this machine — the same
 * finding `qa-fr-hydro.mjs` records. Every wait in this harness goes through
 * here.
 *
 * @param {import('puppeteer').Page} page
 * @param {Function} predicate - Runs in the page; truthy ends the wait.
 * @param {{tries?: number, gapMs?: number, arg?: unknown, render?: number}} [options]
 *   `render` forces that many scene renders per iteration — needed whenever the
 *   thing being waited for advances ON a frame, because headless rAF here fires
 *   about twice a second and playback would crawl.
 * @returns {Promise<boolean>}
 */
async function pollUntil(page, predicate, { tries = 120, gapMs = 500, arg = null, render = 0 } = {}) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const done = await page.evaluate(predicate, arg).catch(() => false);
    if (done) return true;
    if (render) await pump(page, render, 0);
    await sleep(gapMs);
  }
  return false;
}

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

async function setView(page, { lon, lat, height }) {
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
  if (!SHOTS) return;
  try {
    fs.mkdirSync(SHOTS_DIR, { recursive: true });
    await page.evaluate(() => { try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled */ } });
    await page.screenshot({ path: path.join(SHOTS_DIR, name) });
  } catch (error) {
    console.log(`  · screenshot ${name} unavailable (${String(error?.message || error).split('\n')[0]})`);
  }
}

/**
 * Read the layer's rendered state out of the live scene.
 *
 * Ground primitives are counted off `scene.groundPrimitives` and their instance
 * colours read back, because "one colour per batch" is a rendering INVARIANT
 * here, not a style choice — a batch carrying two would repaint itself along
 * bounding-rectangle edges.
 */
function sceneProbe(page, layerId) {
  return page.evaluate((id) => {
    const gev = window.__godsEyeView;
    const module = gev.dataManager.layers.get(id)?.module;
    if (!module) return { missing: true };
    const scene = gev.viewer.scene;
    const hex = (color) => (color
      ? `#${[color.red, color.green, color.blue]
        .map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`
      : null);

    const ground = [];
    for (let i = 0; i < scene.groundPrimitives.length; i += 1) {
      const primitive = scene.groundPrimitives.get(i);
      if (!primitive) continue;
      // Recorded by CONSTRUCTOR first and detail second: Cesium releases a
      // primitive's geometry instances as soon as it is ready unless asked not
      // to, so "no instances" must never read as "no primitive".
      const instances = primitive.geometryInstances;
      const list = instances ? (Array.isArray(instances) ? instances : [instances]) : null;
      const colors = new Set();
      let holes = 0;
      for (const instance of list || []) {
        const attribute = instance?.attributes?.color?.value;
        if (attribute) colors.add([...attribute].join(','));
        const hierarchy = instance?.geometry?._polygonHierarchy
          || instance?.geometry?.polygonHierarchy;
        if (hierarchy?.holes?.length) holes += hierarchy.holes.length;
      }
      // Named by the INSTANCE ID and not by the constructor: a production
      // bundle minifies every Cesium class, so `primitive.constructor.name`
      // reads `$o` and a harness keyed on it silently sees nothing. The layer
      // tags each instance `<layer-id>:<role>:...`, which survives minification.
      const firstId = String(list?.[0]?.id ?? '');
      const role = firstId.startsWith(`${id}:`) ? firstId.split(':')[1] : null;
      ground.push({
        role,
        foreign: role === null,
        instances: list ? list.length : null,
        colors: list ? colors.size : null,
        holes: list ? holes : null,
        show: primitive.show !== false,
      });
    }

    let embers = 0;
    let emberShown = 0;
    let emberCollectionShown = null;
    let flames = 0;
    let flameCollectionShown = null;
    const flameColors = new Set();
    for (let i = 0; i < scene.primitives.length; i += 1) {
      const primitive = scene.primitives.get(i);
      if (typeof primitive?.get !== 'function') continue;
      // The two collections this layer owns are told apart by size: the ember
      // field is thousands of points, the flame set is at most a few hundred.
      if (primitive.length > 1000) {
        embers = primitive.length;
        emberCollectionShown = primitive.show !== false;
        for (let p = 0; p < primitive.length; p += 1) if (primitive.get(p).show) emberShown += 1;
      } else if (primitive.length > 0 && primitive.length <= 300) {
        const sample = primitive.get(0);
        if (sample?.pixelSize >= 8) {
          flames = primitive.length;
          flameCollectionShown = primitive.show !== false;
          flameColors.add(hex(sample.color));
        }
      }
    }

    return {
      stats: module.getStats(),
      controls: module.getRowControls(),
      params: module.getParams(),
      ground,
      embers,
      emberShown,
      emberCollectionShown,
      flames,
      flameCollectionShown,
      flameColor: [...flameColors][0] ?? null,
      governor: window.__godsEyeView?.renderGovernor?.getDiagnostics?.()
        || gev.getRenderGovernorDiagnostics?.() || null,
    };
  }, layerId);
}

const pressChip = (page, layerId, params) => page.evaluate(
  (id, next) => window.__godsEyeView.dataManager.setLayerParams(id, next),
  layerId, params,
);

async function main() {
  console.log(`Mégafeu de Gironde — preuve navigateur sur ${APP_URL}`);
  if (!chrome) {
    console.error('No Chrome/Chromium found. Set PUPPETEER_EXECUTABLE_PATH.');
    process.exit(2);
  }
  const browser = await puppeteer.launch({
    headless: HEADFUL ? false : 'new',
    executablePath: chrome,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000 },
  });
  const page = await newQaPage(browser);
  page.on('pageerror', (error) => console.log(`  · page error: ${error.message}`));

  try {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    const booted = await pollUntil(page,
      () => Boolean(window.__godsEyeView?.viewer && window.__godsEyeView?.dataManager),
      { tries: 120, gapMs: 1000 });
    if (!booted) throw new Error('the app never created window.__godsEyeView');
    await sleep(1500);
    await setView(page, GIRONDE);

    console.log('\ni. la couche charge son pack et s’ouvre sur l’image de clôture');
    await page.evaluate((id) => window.__godsEyeView.dataManager.setEnabled(id, true), LAYER_ID);
    const loaded = await pollUntil(page,
      (id) => window.__godsEyeView.dataManager.layers.get(id)?.module?.getStats?.()?.status === 'ok',
      { tries: 90, gapMs: 500, arg: LAYER_ID });
    if (!loaded) throw new Error('the pack never finished loading');
    await pump(page, 12, 120);
    let probe = await sceneProbe(page, LAYER_ID);
    const lastStep = PACK.steps[PACK.steps.length - 1];
    check('le pack est chargé', probe.stats.detections === 9524,
      `${probe.stats.detections} détections`);
    check('le curseur ouvre sur la dernière image',
      probe.stats.acquired === '1ᵉʳ août 11:38 UTC', probe.stats.cursor);
    check('les hectares affichés sont ceux du publieur',
      probe.stats.burntHa === lastStep.burntHa, `${probe.stats.burntHa} ha`);
    check('les trois chiffres institutionnels sont tous là',
      probe.stats.effisHa === 37191 && probe.stats.gdacsHa === 47910,
      `EFFIS ${probe.stats.effisHa}, GDACS ${probe.stats.gdacsHa}`);
    check('la couche ne joue pas toute seule', probe.stats.playing === false);
    await shoot(page, '01-closing-frame.png');

    console.log('\nii. le périmètre atteint le sol, avec ses trous et une seule couleur');
    const fills = probe.ground.filter((entry) => entry.role === 'perimeter');
    check('un périmètre est dessiné au sol', fills.length === 1, JSON.stringify(probe.ground));
    check('il porte autant de polygones que le pack',
      fills[0]?.instances === lastStep.rings.length,
      `${fills[0]?.instances} dessinés / ${lastStep.rings.length} au pack`);
    check('une seule couleur par lot (piège du rectangle englobant Cesium)',
      fills[0]?.colors === 1, `${fills[0]?.colors} couleurs dans le lot`);
    const packHoles = lastStep.rings.reduce((sum, rings) => sum + rings.length - 1, 0);
    check('les clairières non brûlées sont découpées',
      fills[0]?.holes === packHoles, `${fills[0]?.holes} trous / ${packHoles} au pack`);
    check('le périmètre final EFFIS est tracé par-dessus',
      probe.ground.some((entry) => entry.role === 'effis'),
      JSON.stringify(probe.ground.map((entry) => entry.role)));

    console.log('\niii. chaque puce déplace le curseur, et tout bouge ensemble');
    for (let index = 0; index < PACK.steps.length; index += 1) {
      const step = PACK.steps[index];
      await pressChip(page, LAYER_ID, { step: step.id });
      await pump(page, 10, 100);
      probe = await sceneProbe(page, LAYER_ID);
      const fill = probe.ground.find((entry) => entry.role === 'perimeter');
      const fronts = probe.ground.filter((entry) => entry.role === 'front');
      check(`  ${step.label} — périmètre, fronts, flammes et hectares concordent`,
        probe.stats.burntHa === step.burntHa
        && probe.stats.fronts === step.fronts.length
        && probe.stats.flames === step.flames.length
        && probe.flames === step.flames.length
        && fill?.instances === step.rings.length
        && fill?.colors === 1
        && (fronts[0]?.instances ?? 0) === step.fronts.length,
        `carte ${probe.stats.burntHa} ha / ${probe.stats.fronts} fronts / ${probe.stats.flames} flammes`
        + ` · scène ${fill?.instances} polys, ${fronts[0]?.instances ?? 0} fronts, ${probe.flames} flammes`);
      if (index === 0) await shoot(page, '02-first-frame.png');
    }

    console.log('\niv. le champ de braises est causal et croît avec le curseur');
    const reached = [];
    for (const step of PACK.steps) {
      await pressChip(page, LAYER_ID, { step: step.id });
      await pump(page, 6, 90);
      probe = await sceneProbe(page, LAYER_ID);
      reached.push({ label: step.label, count: probe.stats.count, shown: probe.emberShown });
    }
    check('aucune détection future n’est affichée à la première image',
      reached[0].count < probe.stats.detections,
      `${reached[0].count} / ${probe.stats.detections}`);
    check('le compte de détections ne recule jamais',
      reached.every((entry, index) => index === 0 || entry.count >= reached[index - 1].count),
      JSON.stringify(reached.map((entry) => entry.count)));
    // NOT `=== detections`: the last chip is the 1 August image at 11:38 and
    // the window closes at 12:44, so a detection acquired in that last hour is
    // legitimately still ahead of the cursor. The expected count is computed
    // from the shipped table rather than assumed.
    check('la dernière image a atteint toutes les détections antérieures',
      reached[reached.length - 1].count === EXPECTED_AT_LAST_STEP,
      `${reached[reached.length - 1].count} / ${EXPECTED_AT_LAST_STEP} attendues`
      + ` (${probe.stats.detections} au pack)`);
    check('les braises dessinées suivent le curseur',
      reached[reached.length - 1].shown > reached[0].shown,
      JSON.stringify(reached.map((entry) => entry.shown)));

    console.log('\nv. la lecture avance le curseur puis rend la main');
    await pressChip(page, LAYER_ID, { step: PACK.steps[0].id });
    await pump(page, 4, 60);
    const before = (await sceneProbe(page, LAYER_ID)).params.cursorMs;
    await pressChip(page, LAYER_ID, { play: true });
    await pump(page, 20, 30);
    probe = await sceneProbe(page, LAYER_ID);
    check('le curseur avance pendant la lecture', probe.params.cursorMs > before,
      `${before} → ${probe.params.cursorMs}`);
    check('la lecture tient le gouverneur de rendu ouvert',
      probe.governor === null || probe.governor.holds?.includes(LAYER_ID),
      JSON.stringify(probe.governor?.holds ?? null));
    // Left to run to the end: 24 s of playthrough, polled rather than slept
    // through so a stall fails fast instead of passing on a timeout.
    const settled = await pollUntil(page,
      (id) => window.__godsEyeView.dataManager.layers.get(id)?.module?.getParams?.()?.playing === false,
      { tries: 300, gapMs: 100, arg: LAYER_ID, render: 4 });
    check('la lecture s’arrête d’elle-même à la fin', settled);
    await pump(page, 6, 80);
    probe = await sceneProbe(page, LAYER_ID);
    check('elle relâche le gouverneur en s’arrêtant',
      probe.governor === null || !probe.governor.holds?.includes(LAYER_ID),
      JSON.stringify(probe.governor?.holds ?? null));
    check('et elle finit sur l’image de clôture',
      probe.stats.acquired === '1ᵉʳ août 11:38 UTC', probe.stats.cursor);
    await shoot(page, '03-after-playback.png');

    console.log('\nvi. l’extinction ne laisse rien derrière elle');
    // Parked on a frame that HAS flames first (the closing product has none, so
    // switching off from there would prove the flame collection is hidden by
    // proving it is empty).
    await pressChip(page, LAYER_ID, { step: 'del-monit02' });
    await pump(page, 8, 80);
    check('la scène porte bien des flammes avant extinction',
      (await sceneProbe(page, LAYER_ID)).flames === 11);
    await page.evaluate((id) => window.__godsEyeView.dataManager.setEnabled(id, false), LAYER_ID);
    await pump(page, 8, 90);
    probe = await sceneProbe(page, LAYER_ID);
    // Counted against the BASELINE, not against zero: `scene.groundPrimitives`
    // is shared, and asserting an empty collection would make this harness fail
    // the day any other layer draws on the ground.
    check('plus aucune primitive au sol',
      probe.ground.filter((entry) => !entry.foreign).length === 0,
      JSON.stringify(probe.ground.map((entry) => entry.role)));
    check('le champ de braises est éteint',
      probe.emberCollectionShown === false && probe.flameCollectionShown === false,
      `braises ${probe.emberCollectionShown}, flammes ${probe.flameCollectionShown}`);
    check('le gouverneur est rendu',
      probe.governor === null || !probe.governor.holds?.includes(LAYER_ID),
      JSON.stringify(probe.governor?.holds ?? null));
  } finally {
    await browser.close();
  }

  console.log('');
  if (failures.length) {
    console.log(`✗ ${failures.length} échec(s) :`);
    for (const failure of failures) console.log(`   - ${failure}`);
    process.exit(1);
  }
  console.log('✓ tout est vert.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
