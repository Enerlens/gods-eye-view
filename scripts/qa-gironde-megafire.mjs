#!/usr/bin/env node
/**
 * Deterministic browser proof for the Mégafeu de Gironde layer
 * (`gironde-megafire-2026`).
 *
 * The pack is a SHIPPED file and its numbers are already guarded offline by
 * `src/data/megafirePack.test.mjs`. What no unit test can reach is whether the
 * reconstruction actually arrives on a globe, so this harness proves the nine
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
 *   vi.  the five chips are REAL buttons in the toggle panel, and a DOM click
 *        on one moves the cursor — the layer's clock is reachable by a reader,
 *        not only by `setLayerParams`
 *   vii. the cursor is READABLE while it runs — the row repaints during
 *        playback, the chip of the frame being held lights up, and the play
 *        button says something different at the end than it did in the middle
 *   viii. the fire burns where FIRMS saw something and NOWHERE else: plumes at
 *        a burning instant, none at the closing frame, none from orbit, and the
 *        render governor handed back every time one of those gates closes
 *   ix.  disabling the layer removes every primitive it added
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
      // POINT collections only. The fire's two BillboardCollections are the
      // same shape and can be the same size, and the smoke pool on a `full`
      // profile is over a thousand billboards — which would have been counted
      // as the ember field. A billboard has no `pixelSize`; that is the
      // property that tells the two classes apart in a minified bundle.
      if (typeof primitive.get(0)?.pixelSize !== 'number') continue;
      // The two point collections this layer owns are told apart by size: the
      // ember field is thousands of points, the flame set at most a few hundred.
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
      // What the fire says about itself. Read off `getStats()` rather than
      // counted off the scene: a plume is 200 billboards whose only stable
      // property is that they exist, and the QUESTION here is how many heads
      // are alight, which only the layer knows.
      fire: module.getStats?.()?.fire ?? null,
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

    console.log('\nvi. les puces sont de vrais boutons, et un clic DOM les actionne');
    // Clicked through the DOM and never with `page.click()`: on this app the
    // real pointer path can hang for minutes, while `element.click()` answers
    // in about a millisecond and goes through the same delegated listener.
    const chipDom = await page.evaluate((id) => {
      const row = document.querySelector(`[data-layer-id="${id}"]`);
      if (!row) return { row: false };
      const buttons = [...row.querySelectorAll('.data-toggle-chip')];
      return {
        row: true,
        ids: buttons.map((button) => button.dataset.chipId),
        labels: buttons.map((button) => button.textContent),
        pressed: buttons.filter((button) => button.getAttribute('aria-pressed') === 'true')
          .map((button) => button.dataset.chipId),
      };
    }, LAYER_ID);
    check('la ligne de la couche porte ses puces',
      chipDom.row && chipDom.ids?.length === PACK.steps.length + 1,
      JSON.stringify(chipDom));
    check('les puces nomment la lecture puis les cinq images',
      chipDom.ids?.[0] === 'play'
      && chipDom.ids?.slice(1).join(',') === PACK.steps.map((step) => step.id).join(','),
      JSON.stringify(chipDom.ids));
    check('les libellés sont les instants du pack',
      chipDom.labels?.slice(1).join(' · ') === PACK.steps.map((step) => step.label).join(' · '),
      JSON.stringify(chipDom.labels));

    const target = PACK.steps[1];
    const clicked = await page.evaluate((id, chipId) => {
      const button = document.querySelector(`[data-layer-id="${id}"] [data-chip-id="${chipId}"]`);
      if (!button) return false;
      button.click();
      return true;
    }, LAYER_ID, target.id);
    await pump(page, 10, 100);
    probe = await sceneProbe(page, LAYER_ID);
    check('un clic DOM sur une puce déplace le curseur',
      clicked && probe.stats.acquired === `${target.label} UTC`
      && probe.stats.burntHa === target.burntHa,
      `${probe.stats.acquired} · ${probe.stats.burntHa} ha`);
    const afterClick = await page.evaluate((id, chipId) => document
      .querySelector(`[data-layer-id="${id}"] [data-chip-id="${chipId}"]`)
      ?.getAttribute('aria-pressed'), LAYER_ID, target.id);
    check('et la puce se marque enfoncée', afterClick === 'true', String(afterClick));

    console.log('\nvii. le curseur se lit à l’écran pendant qu’il court');
    // Chip ids are bare here: the manager only namespaces them
    // (`<layer>::<chip>`) on a row that carries FUSION COMPANIONS, and this row
    // carries none — section vi asserts the bare `play` id above.
    const chipText = (chipId) => page.evaluate((id, chip) => {
      const button = document.querySelector(`[data-layer-id="${id}"] [data-chip-id="${chip}"]`);
      return button ? { label: button.textContent, className: button.className } : null;
    }, LAYER_ID, chipId);

    await pressChip(page, LAYER_ID, { step: PACK.steps[0].id });
    await pump(page, 6, 80);
    probe = await sceneProbe(page, LAYER_ID);
    check('la ligne porte une lecture d’horloge, pas seulement une info-bulle',
      typeof probe.stats.coverage === 'string'
      && probe.stats.coverage.includes('24 juil. 09:05')
      && /jour \d+ sur 10/.test(probe.stats.coverage),
      String(probe.stats.coverage));
    check('la légende de carte s’ouvre sur l’instant du curseur',
      probe.controls.legend?.[0]?.label === probe.stats.coverage
      && probe.controls.legend?.[0]?.color === null,
      JSON.stringify(probe.controls.legend?.[0]));

    await pressChip(page, LAYER_ID, { play: true });
    await pump(page, 8, 60);
    const playingChip = await chipText('play');
    probe = await sceneProbe(page, LAYER_ID);
    check('le bouton porte l’instant pendant la lecture',
      /^❚❚ \d/.test(playingChip?.label || ''), JSON.stringify(playingChip));
    const passing = await page.evaluate((id) => [...document
      .querySelectorAll(`[data-layer-id="${id}"] .data-toggle-chip.chip-passing`)]
      .map((button) => button.textContent), LAYER_ID);
    check('la puce de l’image tenue s’allume — la bande devient la barre d’avancement',
      passing.length === 1, JSON.stringify(passing));
    check('la lecture repeint la ligne d’elle-même',
      probe.stats.coverage.startsWith('▶'), String(probe.stats.coverage));

    const finished = await pollUntil(page,
      (id) => window.__godsEyeView.dataManager.layers.get(id)?.module?.getParams?.()?.playing === false,
      { tries: 400, gapMs: 100, arg: LAYER_ID, render: 4 });
    check('la lecture atteint la fin de la fenêtre', finished);
    await pump(page, 6, 80);
    const endedChip = await chipText('play');
    probe = await sceneProbe(page, LAYER_ID);
    // THE REPORTED DEFECT. The layer shipped with nothing that repainted this
    // row, so a run that had already stopped left `❚❚ Pause` on the button and
    // no way to tell a finished replay from a running one.
    check('le bouton ne reste pas sur PAUSE une fois la lecture finie',
      endedChip?.label === '↺ Rejouer', JSON.stringify(endedChip));
    check('et la ligne dit que l’événement est terminé',
      probe.stats.atEnd === true && probe.stats.coverage.includes('fin de l’événement'),
      String(probe.stats.coverage));
    const noPassing = await page.evaluate((id) => document
      .querySelectorAll(`[data-layer-id="${id}"] .chip-passing`).length, LAYER_ID);
    check('plus aucune puce ne clignote à l’arrêt', noPassing === 0, String(noPassing));

    console.log('\nviii. le feu brûle là où FIRMS a vu quelque chose, et nulle part ailleurs');
    check('rien ne brûle sur l’image de clôture — le feu est éteint depuis le 1ᵉʳ août',
      (probe.stats.fire?.burning ?? 0) === 0 && (probe.stats.fire?.particles ?? 0) === 0,
      JSON.stringify(probe.stats.fire));
    check('et le gouverneur n’est pas tenu par des flammes qui n’existent pas',
      probe.governor === null || !probe.governor.holds?.includes('gironde-megafire-flames'),
      JSON.stringify(probe.governor?.holds ?? null));

    await pressChip(page, LAYER_ID, { step: 'del-product' });
    await pump(page, 25, 60);
    probe = await sceneProbe(page, LAYER_ID);
    check('des panaches se dressent sur l’image du 24 juillet',
      (probe.stats.fire?.burning ?? 0) > 0 && (probe.stats.fire?.particles ?? 0) > 50,
      JSON.stringify(probe.stats.fire));
    check('jamais plus de panaches que le budget du profil',
      probe.stats.fire.burning <= probe.stats.fire.plumes,
      `${probe.stats.fire?.burning} / ${probe.stats.fire?.plumes}`);
    check('un feu qui brûle tient le gouverneur ouvert',
      probe.governor === null || probe.governor.holds?.includes('gironde-megafire-flames'),
      JSON.stringify(probe.governor?.holds ?? null));
    await shoot(page, '04-plumes.png');

    // Distance gate: from orbit a kilometre of smoke is a third of a pixel.
    await setView(page, { lon: -1.03, lat: 44.89, height: 6_000_000 });
    await pump(page, 20, 60);
    probe = await sceneProbe(page, LAYER_ID);
    check('vu de l’orbite, plus rien ne brûle',
      (probe.stats.fire?.particles ?? 0) === 0, JSON.stringify(probe.stats.fire));
    check('et le gouverneur est rendu en s’éloignant',
      probe.governor === null || !probe.governor.holds?.includes('gironde-megafire-flames'),
      JSON.stringify(probe.governor?.holds ?? null));
    await setView(page, GIRONDE);
    await pump(page, 25, 60);
    probe = await sceneProbe(page, LAYER_ID);
    check('en revenant, le feu se rallume tout seul',
      (probe.stats.fire?.particles ?? 0) > 0, JSON.stringify(probe.stats.fire));

    console.log('\nix. l’extinction ne laisse rien derrière elle');
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
    check('les panaches sont éteints et leur hold relâché',
      (probe.stats.fire?.particles ?? 0) === 0
      && (probe.governor === null || !probe.governor.holds?.includes('gironde-megafire-flames')),
      `${JSON.stringify(probe.stats.fire)} · ${JSON.stringify(probe.governor?.holds ?? null)}`);
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
