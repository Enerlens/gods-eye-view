#!/usr/bin/env node
/**
 * Deterministic browser proof that the aircraft-noise layer is READABLE FROM
 * A DEZOOMED CAMERA.
 *
 * THE DEFECT THIS HARNESS EXISTS TO CATCH. A PEB is a set of nested rings, a
 * WMS GetFeatureInfo answers within a few pixels of the coordinate it is given,
 * and the reference point of an aerodrome sits inside zone A. So a point probe
 * returns ONE band — the innermost — and zones B, C and D, the ones anybody
 * dezooming has come to look at, are never asked for. On top of that the layer
 * shared the address-scan ceiling of 12 km and cleared itself above it, while
 * the widest plan in France (Le Bourget's zone D) is 65.8 km across. The shape
 * could not be on screen whole at any altitude the layer would answer at.
 *
 * None of that is visible to a unit test: the projection is correct, the
 * fixtures are real, the payload validates. It is a fact about what reaches the
 * screen at a given camera height, so it needs a camera.
 *
 * The checks, over Roissy — the aerodrome whose zone D only a coarse probe
 * returns and whose plan is the largest in the register:
 *
 *   i.   at 6 km the layer is in POINT mode: one probe, the fine scale, and
 *        the winner rule intact. Nothing about the overview may regress this.
 *   ii.  at 60 km it is NOT dormant and NOT cleared — the failure this whole
 *        change is about — and it draws strictly MORE bands than the point
 *        scan did, because it is now asking a wider question.
 *   iii. Roissy's four bands A, B, C and D are all on screen at once, from a
 *        camera that can see the whole 41 km of zone C.
 *   iv.  every one of those bands is drawn SOLID. The dash is the point-mode
 *        channel for "the service found this near your pixel"; there is no
 *        pixel, and a dashed ring would answer a question nobody asked.
 *   v.   several aerodromes are drawn at once, each with its own marker, and
 *        clicking one opens ITS card and not another's.
 *   vi.  the card names the overview's own generalisation scale — a hundred
 *        times coarser than a point scan's — so the two can never be read as
 *        each other.
 *   vii. at 400 km, above the overview ceiling, it goes dormant and clears, so
 *        the old honest behaviour survives at the altitude it now belongs at.
 *
 * Screenshots are written under the gitignored `qa-shots/bruit-overview/`.
 *
 * Run: node scripts/qa-bruit-overview.mjs --url http://localhost:4173
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'bruit-overview');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = option('--url', process.env.QA_BASE_URL || 'http://localhost:4173');
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

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const LAYER = 'bruit-fr';
/**
 * Roissy-Charles-de-Gaulle's aerodrome reference point, from the arrêté
 * register itself. The one aerodrome in France whose zone D a probe only
 * returns at the overview scale, and whose zone C is 41.5 km across.
 */
const CDG = { lon: 2.5479, lat: 49.0097 };
/** Point mode: under the 12 km ceiling, where the fine probe is the answer. */
const CLOSE_VIEW = { ...CDG, height: 6_000 };
/** Overview: high enough that the whole plan fits on screen. */
const WIDE_VIEW = { ...CDG, height: 60_000 };
/** Above the overview ceiling of 250 km, where the layer must go dormant. */
const DORMANT_VIEW = { ...CDG, height: 400_000 };

async function flyTo(page, view) {
  await page.evaluate((lon, lat, height) => {
    const gev = window.__godsEyeView;
    if (!gev?.viewer) throw new Error('viewer unavailable');
    const scene = gev.viewer.scene;
    const ellipsoid = scene.globe?.ellipsoid || scene.ellipsoid;
    const d2r = Math.PI / 180;
    try { gev.viewer.camera.cancelFlight(); } catch { /* no flight active */ }
    gev.viewer.camera.setView({
      destination: ellipsoid.cartographicToCartesian({
        longitude: lon * d2r, latitude: lat * d2r, height,
      }),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    scene.requestRender?.();
  }, view.lon, view.lat, view.height);
  await pump(page, 4, 80);
}

/** Draw frames by hand — the render governor runs in `requestRenderMode`. */
async function pump(page, frames = 6, gapMs = 90) {
  for (let frame = 0; frame < frames; frame += 1) {
    await page.evaluate(() => { try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled */ } });
    await sleep(gapMs);
  }
}

/**
 * Best-effort evidence for a human, never a check.
 *
 * `Page.captureScreenshot` waits for the page to COMMIT a new frame, and the
 * render governor runs in `requestRenderMode` — so a settled scene commits
 * nothing and the call sits there until the protocol timeout. Pumping a frame
 * by hand is not enough here: the commit has to land inside the capture's own
 * window. So the governor is switched off for the duration of the shot and put
 * back exactly as it was, which is the difference between this harness having
 * pictures and not.
 */
async function shoot(page, name) {
  try {
    const previous = await page.evaluate(() => {
      const scene = window.__godsEyeView?.viewer?.scene;
      if (!scene) return null;
      const was = scene.requestRenderMode;
      scene.requestRenderMode = false;
      return was;
    });
    await pump(page, 3, 60);
    await page.screenshot({ path: path.join(SHOTS_DIR, name), timeout: 20_000 });
    if (previous !== null) {
      await page.evaluate((was) => {
        const scene = window.__godsEyeView?.viewer?.scene;
        if (scene) scene.requestRenderMode = was;
      }, previous);
    }
  } catch (error) {
    console.log(`  ·    screenshot ${name} skipped: ${String(error.message).split('\n')[0]}`);
  }
}

/** `toLocaleString('fr-FR')` separates thousands with U+202F, not a space. */
const norm = (value) => String(value ?? '').replace(/[\s ]+/g, ' ');

/** The layer's own cadence is 15 minutes; a harness cannot wait on it. */
async function refresh(page) {
  await page.evaluate(async (id) => {
    try { await window.__godsEyeView.dataManager.refreshLayer(id); } catch { /* reported via stats */ }
  }, LAYER);
}

/**
 * Everything drawn, read off the live data source.
 *
 * The bands are counted from the ENTITY properties rather than from the stats,
 * because the whole question is what reached the screen: a payload with forty
 * bands and a renderer that drew none of them reports perfectly on both sides
 * of the boundary this harness is testing.
 */
async function readLayer(page) {
  return page.evaluate((id) => {
    const app = window.__godsEyeView;
    const entry = app?.dataManager?.layers?.get(id);
    const source = app?.viewer?.dataSources?.getByName?.(id)?.[0] || null;
    const time = app?.viewer?.clock?.currentTime;
    let stats = null;
    try { stats = entry?.module?.getStats?.() ?? null; } catch { stats = null; }
    const zones = new Set();
    const aerodromes = [];
    let dashed = 0;
    let polylines = 0;
    for (const entity of source?.entities?.values || []) {
      const kind = entity.properties?.kind?.getValue?.(time);
      if (kind === 'peb-zone') {
        zones.add(String(entity.properties?.zone?.getValue?.(time) ?? '?'));
      }
      if (kind === 'bruit-aerodrome') {
        aerodromes.push({
          id: entity.id,
          name: entity.name,
          description: entity.description?.getValue?.(time) ?? null,
        });
      }
      if (entity.polyline) {
        polylines += 1;
        // A dash material is a PolylineDashMaterialProperty; a solid one is a
        // ColorMaterialProperty. `dashLength` only exists on the first.
        if (entity.polyline.material?.dashLength !== undefined) dashed += 1;
      }
    }
    return {
      registered: Boolean(entry),
      entities: source ? source.entities.values.length : null,
      zones: [...zones].sort(),
      aerodromes,
      dashed,
      polylines,
      stats,
    };
  }, LAYER);
}

/** Wait for the layer to settle into a state the caller recognises. */
async function settle(page, accept, tries = 20, gapMs = 1500) {
  let state = await readLayer(page);
  for (let i = 0; i < tries && !accept(state); i += 1) {
    await refresh(page);
    await pump(page, 2, 80);
    await sleep(gapMs);
    state = await readLayer(page);
  }
  return state;
}

const failures = [];
const note = (ok, message) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${message}`);
  if (!ok) failures.push(message);
};

(async () => {
  if (!chrome) {
    console.error('No Chrome/Chromium binary found. Set PUPPETEER_EXECUTABLE_PATH.');
    process.exit(2);
  }
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: !HEADFUL,
    args: ['--no-sandbox', '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000 },
  });
  try {
    const page = await newQaPage(browser);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });

    let booted = false;
    for (let i = 0; i < 90 && !booted; i += 1) {
      booted = await page.evaluate(() => Boolean(window.__godsEyeView?.dataManager));
      if (!booted) await sleep(1000);
    }
    if (!booted) throw new Error('App did not boot within 90 s');
    note((await readLayer(page)).registered, `${LAYER} is registered`);

    console.log('\n— point mode, under the 12 km ceiling —');
    await flyTo(page, CLOSE_VIEW);
    await page.evaluate((id) => window.__godsEyeView.dataManager.setEnabled(id, true), LAYER);
    const close = await settle(page, (state) => (state.entities ?? 0) > 0);
    await shoot(page, 'bruit-point-6km.png');
    note((close.entities ?? 0) > 0, `point mode drew ${close.entities} entities`);
    note(close.stats?.area !== true, 'point mode is not an overview');
    note(close.stats?.scaleDenominator === 39_757,
      `point mode reads the fine scale (1:${close.stats?.scaleDenominator})`);
    const pointZones = close.zones.length;
    console.log(`  ·    point mode has zones [${close.zones.join(', ')}] on screen`);

    console.log('\n— overview, at 60 km —');
    await flyTo(page, WIDE_VIEW);
    const wide = await settle(page, (state) => state.stats?.area === true && (state.entities ?? 0) > 0);
    await shoot(page, 'bruit-overview-60km.png');
    // THE DEFECT, IN ONE LINE. This is what used to be `dormant: true` with an
    // empty data source.
    note(wide.stats?.dormant !== true, 'the layer is NOT dormant at 60 km');
    note((wide.entities ?? 0) > 0, `the overview drew ${wide.entities} entities at 60 km`);
    note(wide.stats?.area === true, 'the layer switched to the overview question');
    note(wide.zones.length > pointZones,
      `the overview shows ${wide.zones.length} zone letters against the point scan's ${pointZones}`);
    // Roissy's whole plan: the fine probe at this very coordinate returns zone
    // C alone, and zone D only ever comes back at the overview scale.
    for (const zone of ['A', 'B', 'C', 'D']) {
      note(wide.zones.includes(zone), `Roissy's zone ${zone} is on screen`);
    }
    note(wide.dashed === 0 && wide.polylines > 0,
      `all ${wide.polylines} rings are solid — no marker, so no "you are not in this one" dash`);
    note(wide.aerodromes.length > 1,
      `${wide.aerodromes.length} aerodromes drawn at once, each with its own marker`);
    const cdgMarker = wide.aerodromes.find((entry) => String(entry.name).includes('LFPG'));
    note(Boolean(cdgMarker), `Roissy has a marker of its own (${cdgMarker?.name ?? 'missing'})`);
    // A HUNDRED TIMES COARSER, said out loud on the card rather than implied.
    note(norm(cdgMarker?.description).includes('1:3 975 696'),
      'the card names the overview generalisation, not the point probe\'s');
    note(!/le repère/.test(String(cdgMarker?.description ?? '')),
      'no overview card mentions a marker the reader does not have');
    note(wide.stats?.aerodromes > 0 && wide.stats?.zonesHere === 0,
      `stats count aerodromes (${wide.stats?.aerodromes}), not bands under a marker`);

    console.log('\n— a click opens the aerodrome it landed on —');
    // The marker nearest the middle of the CANVAS, not the first in the list.
    // An overview draws eighteen aerodromes and most of them are outside the
    // frame; `cartesianToCanvasCoordinates` answers for those too, so clicking
    // the first one lands on empty page and the check fails for a reason that
    // has nothing to do with the layer.
    const clicked = await page.evaluate((id) => {
      const app = window.__godsEyeView;
      const viewer = app.viewer;
      const source = viewer.dataSources.getByName(id)?.[0];
      const time = viewer.clock.currentTime;
      const scene = viewer.scene;
      const width = scene.canvas.clientWidth;
      const height = scene.canvas.clientHeight;
      let best = null;
      for (const entity of source?.entities?.values || []) {
        if (entity.properties?.kind?.getValue?.(time) !== 'bruit-aerodrome') continue;
        const window2d = scene.cartesianToCanvasCoordinates(entity.position.getValue(time));
        if (!window2d || !Number.isFinite(window2d.x) || !Number.isFinite(window2d.y)) continue;
        if (window2d.x < 8 || window2d.y < 8 || window2d.x > width - 8 || window2d.y > height - 8) continue;
        const offset = Math.hypot(window2d.x - width / 2, window2d.y - height / 2);
        if (!best || offset < best.offset) {
          best = { id: entity.id, x: Math.round(window2d.x), y: Math.round(window2d.y), offset };
        }
      }
      return best;
    }, LAYER);
    if (clicked) {
      await page.mouse.click(clicked.x, clicked.y);
      await pump(page, 4, 100);
      const selected = await page.evaluate(
        (id) => window.__godsEyeView.dataManager.layers.get(id)?.module?.getStats?.()?.selectedId ?? null,
        LAYER,
      );
      // EITHER card is a pass, and the reason is measured: `scene.pick` on the
      // marker's own pixel returns the ground-classification WASH under it, not
      // the billboard — the marker is only second in the drill list. So this
      // click legitimately resolves to the ground card, which is the one that
      // makes the inside of a band clickable at all. What must not happen is
      // nothing.
      note(selected === clicked.id || selected === `${LAYER}:ground`,
        `clicking ${clicked.id} opened ${selected ?? 'nothing'}`);
      await shoot(page, 'bruit-overview-card.png');
    } else {
      note(false, 'no aerodrome marker was projectable for a click');
    }

    console.log('\n— the inside of a band answers, not just its outline —');
    // The defect this proves gone: the wash is a polygon, a polygon entity has
    // no position, and the shell's click index is built from positions — so
    // every pixel inside a zone used to answer nothing at all.
    const insideBand = await page.evaluate((id) => {
      const app = window.__godsEyeView;
      const viewer = app.viewer;
      const scene = viewer.scene;
      const source = viewer.dataSources.getByName(id)?.[0];
      const time = viewer.clock.currentTime;
      const width = scene.canvas.clientWidth;
      const height = scene.canvas.clientHeight;
      // Walk outward from the centre until a pick lands on one of our washes.
      for (let radius = 0; radius < 320; radius += 12) {
        for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1]]) {
          const x = Math.round(width / 2 + dx * radius);
          const y = Math.round(height / 2 + dy * radius);
          // A plain `{x, y}` is enough: Cesium reads the two fields off it.
          const picked = scene.pick({ x, y });
          const pickedId = typeof picked?.id === 'string' ? picked.id : picked?.id?.id;
          if (typeof pickedId === 'string' && pickedId.includes(':fill:')
            && source?.entities?.getById?.(pickedId)) {
            return { x, y, pickedId };
          }
        }
      }
      return null;
    }, LAYER);
    if (insideBand) {
      await page.mouse.click(insideBand.x, insideBand.y);
      await pump(page, 4, 100);
      const card = await page.evaluate((id) => {
        const stats = window.__godsEyeView.dataManager.layers.get(id)?.module?.getStats?.();
        return { selectedId: stats?.selectedId ?? null, ground: stats?.groundCard ?? null };
      }, LAYER);
      note(card.selectedId === `${LAYER}:ground` && Boolean(card.ground?.title),
        `a click on the wash ${insideBand.pickedId} opened «${card.ground?.title ?? 'nothing'}»`);
      note(/^Zone [A-D1-3]/.test(String(card.ground?.title ?? '')),
        'the ground card names the band the click actually landed in');
    } else {
      note(false, 'no wash was pickable near the centre of the view');
    }

    console.log('\n— dormancy above the overview ceiling —');
    await flyTo(page, DORMANT_VIEW);
    const dormant = await settle(page, (state) => state.stats?.dormant === true, 10);
    await shoot(page, 'bruit-dormant-400km.png');
    note(dormant.stats?.dormant === true && (dormant.entities ?? 0) === 0,
      `dormant and cleared at 400 km (dormant=${dormant.stats?.dormant}, entities=${dormant.entities})`);

    console.log('\n— and back down to point mode —');
    await flyTo(page, CLOSE_VIEW);
    const back = await settle(page, (state) => (state.entities ?? 0) > 0 && state.stats?.area !== true);
    note(back.stats?.area !== true && (back.entities ?? 0) > 0,
      `descending re-asks the point question (${back.entities} entities, area=${back.stats?.area})`);

    console.log(`\nScreenshots: ${SHOTS_DIR}`);
  } finally {
    await browser.close();
  }
  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed:`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log('\nAll checks passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
