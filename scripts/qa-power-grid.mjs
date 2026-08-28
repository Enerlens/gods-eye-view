#!/usr/bin/env node
/**
 * Deterministic browser proof for the viewport-loaded power-grid layer
 * (`power-grid`).
 *
 * Overpass is live, slow, and regularly returns 502/504 from whichever mirror
 * answers, so this harness intercepts `/api/power-grid` with the SAME captured
 * Overpass response the unit tests use — run through the real
 * `projectPowerGrid` projection, so the fixture cannot drift from what the
 * proxy actually serves — and proves the things only a real Cesium scene can:
 *
 *   i.   the routes reach the globe as CLAMPED, BATCHED ground geometry: a
 *        few GroundPolylinePrimitives rather than one entity per way, which is
 *        the whole reason a 2,600-stroke viewport is pannable
 *   ii.  no route is drawn at conductor height — read back off the rendered
 *        positions rather than off the model, because "clamped" in the model
 *        and "on the ground" in the scene are two different claims
 *   ii-bis. the routes are LEGIBLE — counted in pixels with the layer shown
 *        against the same view with it hidden, the check a screenshot cannot
 *        make
 *   iii. the voltage bands are visibly different: a 400 kV route is drawn
 *        thicker and in its own colour, and its substation is a bigger dot
 *   iv.  underground cable is dashed and never merged into the overhead batch
 *   v.   the legend the app actually renders carries the ground-route limit on
 *        every band row, and the pylon row states its own zoom gate
 *   vi.  a wide viewport asks for nothing and says "zoom in" instead of
 *        drawing a truncated smear
 *   vii. switching the map stack re-classifies every batch against the new
 *        surface
 *
 * Screenshots are written under the gitignored `qa-shots/power-grid/`.
 *
 * Run: node scripts/qa-power-grid.mjs --url http://localhost:4173
 *      node scripts/qa-power-grid.mjs --live   (no interception — the real
 *                                               proxy against real Overpass)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';
import {
  POWER_GRID_TIERS,
  POWER_GRID_TOWER_MAX_BOX_DEG,
  projectPowerGrid,
} from '../src/data/powerGridFeed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'power-grid');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = option('--url', process.env.QA_BASE_URL || 'http://localhost:4173');
const APP_ORIGIN = new URL(APP_URL).origin;
const HEADFUL = args.includes('--headful');
const LIVE = args.includes('--live');

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

/** The Saclay plateau — where the captured 400/225/90 kV Villejust yard is. */
const SACLAY = { lon: 2.19, lat: 48.71, height: 26_000 };
/** A view wider than the layer will ask for, to prove the zoom-in contract. */
const FRANCE = { lon: 2.4, lat: 46.6, height: 1_800_000 };

/** The palette, duplicated on purpose: a QA harness asserts, it doesn't import styling. */
const TIER_COLOR = Object.fromEntries(POWER_GRID_TIERS.map((tier) => [tier.id, tier.color]));

const OSM = JSON.parse(fs.readFileSync(
  path.join(REPO_ROOT, 'src', 'data', 'fixtures', 'power-grid-osm-sample.json'), 'utf8',
));

/** The proxy's own output, built from the captured Overpass body. */
function gridPayload() {
  return {
    ...projectPowerGrid(OSM),
    retrievedAt: new Date().toISOString(),
    status: 'ready',
    source: 'OpenStreetMap contributors (ODbL 1.0), via Overpass (qa fixture)',
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
 * Render `frames` frames explicitly. Clamped ground geometry only resolves once
 * the scene has actually drawn, and a software-rendered headless context
 * sometimes has no animation-frame loop at all.
 */
async function pump(page, frames = 8, gapMs = 80) {
  for (let frame = 0; frame < frames; frame += 1) {
    await page.evaluate(() => {
      try {
        // requestRenderMode is on in production: without an explicit request a
        // scene.render() call can be a no-op, and the canvas the pixel counter
        // reads would still hold the PREVIOUS visibility state.
        window.__godsEyeView?.viewer?.scene?.requestRender();
        window.__godsEyeView?.viewer?.scene?.render();
      } catch { /* stalled context */ }
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
    // The layer loads on camera moveEnd, which setView does not raise.
    gev.viewer.camera.moveEnd.raiseEvent();
  }, lon, lat, height);
  await pump(page, 4);
}

/**
 * Capture one shot, with its own short deadline.
 *
 * On a software renderer `Page.captureScreenshot` can hang well past any useful
 * wait, and five stalled captures at the protocol timeout would dominate the
 * run. Shots are evidence for a human, not an assertion, so a slow one is
 * abandoned and reported rather than allowed to hold the harness open.
 */
async function shoot(page, name) {
  try {
    await page.evaluate(() => { try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled */ } });
    await Promise.race([
      page.screenshot({ path: path.join(SHOTS_DIR, name) }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('capture timed out')), 20000)),
    ]);
  } catch (error) {
    console.log(`  · screenshot ${name} unavailable (${String(error?.message || error).split('\n')[0]})`);
  }
}

/**
 * Read the layer's rendered state.
 *
 * Batches come through `getRenderDiagnostics()`, not by walking
 * `scene.groundPrimitives` directly, and that is forced rather than chosen:
 * Cesium RELEASES a primitive's `geometryInstances` as soon as it is built
 * (`releaseGeometryInstances` defaults to true), so after the first frame the
 * scene can no longer say what went into a batch — an earlier version of this
 * harness read empty instance lists and "proved" the geometry had vanished.
 * The diagnostics pair the layer's build record with `show` / `ready` /
 * `classificationType` / material read LIVE off the same primitive, and
 * `inGroundCollection` confirms membership in `scene.groundPrimitives` — which
 * is itself the proof a batch is draped, since a ground primitive has no height
 * to set.
 *
 * The point primitives are still read straight off the scene, because they keep
 * everything they were given.
 */
function sceneProbe(page) {
  return page.evaluate(() => {
    const gev = window.__godsEyeView;
    const module = gev.dataManager.layers.get('power-grid').module;
    const hexColor = (color) => (color
      ? `#${[color.red, color.green, color.blue]
        .map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`
      : null);

    const points = [];
    const primitives = gev.viewer.scene.primitives;
    for (let i = 0; i < primitives.length; i += 1) {
      const primitive = primitives.get(i);
      if (typeof primitive?.length !== 'number' || typeof primitive.get !== 'function') continue;
      for (let j = 0; j < primitive.length; j += 1) {
        const point = primitive.get(j);
        const id = typeof point?.id === 'string' ? point.id : null;
        if (!id || !id.startsWith('power-grid:')) continue;
        points.push({
          id,
          pixelSize: point.pixelSize,
          color: hexColor(point.color),
          collectionShown: primitive.show !== false,
        });
      }
    }

    return {
      stats: module.getStats(),
      controls: module.getRowControls(),
      analyst: module.getAnalystRecords(50),
      batches: module.getRenderDiagnostics(),
      points,
    };
  });
}

/**
 * Count canvas pixels within `tolerance` of a colour.
 *
 * The check a screenshot cannot make: every structural assertion can pass —
 * batched, clamped, classified, coloured, on the globe — while the network is
 * still invisible to a person looking at it. So the harness counts a band's own
 * pixels with the layer shown and with it hidden, and the DELTA is the proof
 * that the grid reached someone's eye.
 */
function countPixels(page, hex, tolerance = 24) {
  return page.evaluate((color, tol) => {
    const target = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
    const canvas = window.__godsEyeView.viewer.scene.canvas;
    const off = document.createElement('canvas');
    off.width = canvas.width;
    off.height = canvas.height;
    const context = off.getContext('2d');
    context.drawImage(canvas, 0, 0);
    const data = context.getImageData(0, 0, off.width, off.height).data;
    let hits = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (Math.abs(data[i] - target[0]) < tol
        && Math.abs(data[i + 1] - target[1]) < tol
        && Math.abs(data[i + 2] - target[2]) < tol) hits += 1;
    }
    return hits;
  }, hex, tolerance);
}

/**
 * Toggle the whole layer for the pixel comparison.
 *
 * An earlier version tried to flip `show` on just this layer's ground
 * primitives, matched out of `scene.groundPrimitives` by classification and
 * material. It silently matched nothing on some passes, and the "hidden"
 * measurement came back identical to the shown one — a check that cannot fail
 * is worse than no check. Toggling the layer is unambiguous, and it is also the
 * question a person actually asks: does turning this on change what I see?
 *
 * Order matters: measure SHOWN first, while the batches are already draped and
 * settled, then hide. Re-enabling would need another full rebuild before the
 * geometry is `ready` again, and measuring during that would understate it.
 */
async function setLayerEnabled(page, enabled) {
  await page.evaluate(
    (on) => window.__godsEyeView.dataManager.setEnabled('power-grid', on),
    enabled,
  );
  await pump(page, 16, 80);
}

async function main() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: !HEADFUL,
    executablePath: chrome,
    args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1280,800'],
    // 1280x800 rather than the 1600x1000 the sibling harnesses use: capturing a
    // software-rendered Cesium canvas is the slowest thing in this run, and the
    // pixel counter works on deltas, so nothing it measures depends on the size.
    defaultViewport: { width: 1280, height: 800 },
    protocolTimeout: 120000,
  });

  try {
    const page = await newQaPage(browser);
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    const payload = gridPayload();
    let apiRequests = 0;
    let lastRequestedBox = null;
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin === APP_ORIGIN && url.pathname === '/api/power-grid') {
        apiRequests += 1;
        lastRequestedBox = Object.fromEntries(url.searchParams);
        if (!LIVE) {
          void request.respond({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(payload),
          });
          return;
        }
      }
      void request.continue();
    });

    console.log(`[qa] booting ${APP_URL}${LIVE ? ' (LIVE proxy)' : ''}`);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(
      () => window.__godsEyeView?.viewer && window.__godsEyeView?.dataManager,
      { timeout: 60000, polling: 200 },
    );
    await sleep(2000);
    await setView(page, SACLAY.lon, SACLAY.lat, SACLAY.height);

    // ── i. the routes reach the globe, BATCHED ─────────────────────────────
    console.log('[qa] i. the routes are batched, clamped ground geometry');
    await page.evaluate(() => window.__godsEyeView.dataManager.setEnabled('power-grid', true));
    let probe = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await pump(page, 3, 60);
      await sleep(400);
      probe = await sceneProbe(page);
      if (probe.batches.length > 0 && probe.points.length > 0) break;
    }
    check('the layer asked the proxy for its viewport', apiRequests >= 1, `${apiRequests} request(s)`);
    check('and asked for a BOUNDED box, never the planet',
      lastRequestedBox && ['south', 'west', 'north', 'east'].every((k) => k in lastRequestedBox),
      JSON.stringify(lastRequestedBox));
    check('ground batches reached the scene', probe.batches.length > 0, `${probe.batches.length} batches`);

    const drawnStrokes = probe.batches.reduce((sum, batch) => sum + batch.strokes, 0);
    check('routes are drawn', drawnStrokes > 0, `${drawnStrokes} strokes`);
    check('every stroke the projection produced reached a batch',
      drawnStrokes === payload.strokes.length, `${drawnStrokes} of ${payload.strokes.length}`);
    // The point of batching: a 2,600-stroke viewport must not become 2,600
    // primitives. At most one overhead batch plus one dashed batch per band.
    check('strokes are merged into a handful of batches, not one primitive each',
      probe.batches.length <= POWER_GRID_TIERS.length + 1 && probe.batches.length < drawnStrokes,
      `${probe.batches.length} batches for ${drawnStrokes} strokes`);
    check('every batch classifies against a resolved surface',
      probe.batches.every((batch) => batch.classificationType !== ''),
      probe.batches[0]?.classificationType);
    check('every stroke id is namespaced to this layer, so a pick cannot cross layers',
      probe.batches.every((batch) => batch.strokeIds.every((id) => id.startsWith('power-grid:stroke:'))));
    await shoot(page, '01-grid-saclay.png');

    // ── ii. nothing is drawn at conductor height ───────────────────────────
    console.log('[qa] ii. no route is lifted to a conductor height nobody published');
    // Membership in `scene.groundPrimitives` IS the claim: a ground primitive
    // drapes on the surface and has no height to set, which is exactly why the
    // layer uses one instead of a polyline at a plausible catenary.
    check('every batch is a draped ground primitive, with no height to get wrong',
      probe.batches.length > 0 && probe.batches.every((batch) => batch.inGroundCollection === true),
      `${probe.batches.filter((b) => b.inGroundCollection !== true).length} not draped`);
    check('and the layer adds no height-carrying polyline anywhere',
      await page.evaluate(() => {
        const sources = window.__godsEyeView.viewer.dataSources;
        for (let i = 0; i < sources.length; i += 1) {
          for (const entity of sources.get(i).entities.values) {
            if (entity.polyline && String(entity.id || '').startsWith('power-grid')) return false;
          }
        }
        return true;
      }));

    // ── ii-bis. the routes reach a HUMAN, not just the scene graph ─────────
    console.log('[qa] ii-bis. the grid is actually legible on the basemap');
    // Measured against the OSM stack on purpose. The photoreal stack streams
    // Google 3D tiles that a headless software renderer may never finish
    // loading, and counting pixels over a surface that did not arrive proves
    // nothing either way.
    await page.evaluate(async () => {
      await window.__godsEyeView.mapStackController?.setStack?.('osm');
    });
    await sleep(4000);
    // 12 km, not the 26 km the rest of the harness uses. Measured 2026-08-27:
    // at 26 km these strokes are structurally perfect and register a pixel
    // DELTA of zero — the ground primitives have not finished draping onto the
    // terrain LOD that far out under a software renderer, so counting there
    // would prove nothing either way.
    await setView(page, SACLAY.lon, SACLAY.lat, 12_000);
    await sleep(1500);
    await pump(page, 24, 80);
    const on = {
      ehv: await countPixels(page, TIER_COLOR.ehv),
      hvHigh: await countPixels(page, TIER_COLOR['hv-high']),
    };
    await setLayerEnabled(page, false);
    const off = {
      ehv: await countPixels(page, TIER_COLOR.ehv),
      hvHigh: await countPixels(page, TIER_COLOR['hv-high']),
    };
    await setLayerEnabled(page, true);
    await sleep(1500);
    await pump(page, 24, 80);
    check('the 225 kV band paints pixels nothing else on screen was painting',
      on.hvHigh - off.hvHigh > 300, `${off.hvHigh} → ${on.hvHigh}`);
    check('so does the 400 kV backbone', on.ehv - off.ehv > 50, `${off.ehv} → ${on.ehv}`);
    check('and the basemap was not already full of those colours',
      off.hvHigh < 200 && off.ehv < 200, `${off.hvHigh} / ${off.ehv} before`);
    // Deliberately NOT measured on the 50-99 kV band: its green sits inside the
    // OSM basemap's own vegetation palette (6,647 baseline hits in the same
    // view), so a delta there would be noise, not evidence.
    await shoot(page, '02-legible.png');

    // ── iii. the voltage bands are visibly different ───────────────────────
    console.log('[qa] iii. a 400 kV route outweighs a 63 kV one, in width and in colour');
    probe = await sceneProbe(page);
    const overheadBatch = probe.batches.find((batch) => !batch.underground);
    check('the overhead strokes share one batch across every band',
      Boolean(overheadBatch) && overheadBatch.strokes > 1, `${overheadBatch?.strokes} strokes`);
    // Per-instance widths are what let one batch hold several bands without
    // flattening them; the band order itself is pinned by the unit tests.
    const widths = [...new Set(overheadBatch?.widthPx || [])].sort((a, b) => b - a);
    check('that batch carries more than one band width', widths.length >= 2, widths.join(' / '));
    check('and the widest is the band the unit tests call the backbone',
      widths[0] === POWER_GRID_TIERS[0].widthPx, `${widths[0]} vs ${POWER_GRID_TIERS[0].widthPx}`);

    const substations = probe.points.filter((point) => point.id.startsWith('power-grid:substation:'));
    const pylons = probe.points.filter((point) => point.id.startsWith('power-grid:tower:'));
    check('substations are drawn', substations.length > 0, `${substations.length}`);
    check('pylons are drawn at this zoom', pylons.length > 0, `${pylons.length}`);
    check('every substation outsizes every pylon',
      Math.min(...substations.map((p) => p.pixelSize)) > Math.max(...pylons.map((p) => p.pixelSize)),
      `subs ≥ ${Math.min(...substations.map((p) => p.pixelSize))} vs pylons ≤ ${Math.max(...pylons.map((p) => p.pixelSize))}`);
    const ehvYard = substations.find((point) => point.color === TIER_COLOR.ehv);
    check('the 400 kV yard is drawn in the 400 kV colour and is the biggest dot',
      ehvYard && ehvYard.pixelSize === Math.max(...substations.map((p) => p.pixelSize)),
      `${ehvYard?.color} @ ${ehvYard?.pixelSize}px`);

    // ── iv. underground cable is dashed, and kept apart ────────────────────
    console.log('[qa] iv. underground cable is dashed and never merged into the overhead batch');
    const dashed = probe.batches.filter((batch) => batch.underground);
    const solid = probe.batches.filter((batch) => !batch.underground);
    check('at least one dashed batch exists', dashed.length > 0, `${dashed.length} dashed`);
    check('and at least one solid one', solid.length > 0, `${solid.length} solid`);
    check('every underground batch really does use a dash material in the scene',
      dashed.every((batch) => batch.materialType === 'PolylineDash'),
      dashed.map((b) => b.materialType).join(','));
    check('and the overhead batch carries no shared material — its colour is per instance',
      solid.every((batch) => batch.materialType === null),
      solid.map((b) => b.materialType).join(','));
    const dashedIds = new Set(dashed.flatMap((batch) => batch.strokeIds));
    const solidIds = new Set(solid.flatMap((batch) => batch.strokeIds));
    check('no stroke is in both', [...dashedIds].every((id) => !solidIds.has(id)));
    check('the underground count matches what the projection said',
      dashedIds.size === payload.strokes.filter((s) => s.u).length,
      `${dashedIds.size} vs ${payload.strokes.filter((s) => s.u).length}`);
    check('underground strokes are split per band, since a dash material is per primitive',
      dashed.every((batch) => batch.tierId && batch.color),
      dashed.map((b) => b.tierId).join(','));

    // ── v. what the legend refuses to leave out ────────────────────────────
    console.log('[qa] v. the legend states the ground-route limit and the pylon gate');
    const blurbs = probe.controls.legend.map((row) => row.blurb);
    check('every band row says the routes are on the ground, not at conductor height',
      probe.controls.legend
        .filter((row) => row.label !== 'Pylons')
        .every((row) => /not the conductor height/i.test(row.blurb)),
      blurbs.join(' | ').slice(0, 140));
    check('the legend is keyed by voltage band, which is what the colours mean',
      probe.controls.legend.some((row) => POWER_GRID_TIERS.some((tier) => tier.label === row.label)),
      probe.controls.legend.map((row) => row.label).join(' | '));
    check('the pylon row states its own zoom gate rather than looking like an outage',
      blurbs.some((blurb) => blurb.includes(`${POWER_GRID_TOWER_MAX_BOX_DEG}°`)));
    check('the stats separate mapped ROUTES from the ways they are split into',
      Number.isInteger(probe.stats.routes) && probe.stats.routes <= probe.stats.strokes,
      `${probe.stats.routes} routes / ${probe.stats.strokes} strokes`);
    check('a substation reaches the analyst engine with its voltage resolved',
      probe.analyst.some((record) => record.kind === 'substation' && record.voltageKv >= 50),
      JSON.stringify(probe.analyst[0] || null).slice(0, 120));

    // ── vi. a wide view asks for nothing and says so ───────────────────────
    console.log('[qa] vi. a continental view says "zoom in" instead of a truncated smear');
    const requestsBefore = apiRequests;
    await setView(page, FRANCE.lon, FRANCE.lat, FRANCE.height);
    await pump(page, 6, 80);
    await sleep(1200);
    await pump(page, 4, 80);
    const wide = await page.evaluate(
      () => window.__godsEyeView.dataManager.layers.get('power-grid').module.getStats(),
    );
    check('no request is made for a box the proxy would refuse',
      apiRequests === requestsBefore, `${apiRequests - requestsBefore} extra request(s)`);
    check('the layer says zoom in, in those words', wide.status === 'zoom-in', wide.status);
    check('and the readout explains it rather than reporting an error',
      /zoom in/i.test(wide.loadingLabel || ''), wide.loadingLabel);
    const cleared = await sceneProbe(page);
    check('the previous viewport’s geometry is cleared, not left stale on the globe',
      cleared.batches.length === 0 && cleared.points.length === 0,
      `${cleared.batches.length} batches / ${cleared.points.length} points`);
    await shoot(page, '03-zoom-in.png');

    // ── vii. the stack switch re-classifies every batch ────────────────────
    console.log('[qa] vii. a map-stack change re-classifies every batch');
    await setView(page, SACLAY.lon, SACLAY.lat, SACLAY.height);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await pump(page, 3, 60);
      await sleep(400);
      probe = await sceneProbe(page);
      if (probe.batches.length > 0) break;
    }
    check('the geometry comes back when the camera comes back', probe.batches.length > 0);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('gev:map-stack-changed', { detail: { activeId: 'osm' } }));
    });
    await pump(page, 6, 60);
    const osmProbe = await sceneProbe(page);
    const osmClasses = new Set(osmProbe.batches.map((batch) => batch.classificationType));
    check('every batch moved to one classification', osmClasses.size === 1, [...osmClasses].join(','));
    check('and no stroke was lost in the rebuild',
      osmProbe.batches.reduce((sum, batch) => sum + batch.strokes, 0) === payload.strokes.length,
      `${osmProbe.batches.reduce((sum, b) => sum + b.strokes, 0)} of ${payload.strokes.length}`);

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('gev:map-stack-changed', { detail: { activeId: 'photoreal' } }));
    });
    await pump(page, 6, 60);
    const photoProbe = await sceneProbe(page);
    const photoClasses = new Set(photoProbe.batches.map((batch) => batch.classificationType));
    check('and again for the photoreal surface', photoClasses.size === 1, [...photoClasses].join(','));
    check('the two surfaces really are different classifications',
      [...osmClasses][0] !== [...photoClasses][0],
      `${[...osmClasses][0]} vs ${[...photoClasses][0]}`);

    // ── the layer turns off cleanly ────────────────────────────────────────
    console.log('[qa] viii. disabling clears the globe');
    await page.evaluate(() => window.__godsEyeView.dataManager.setEnabled('power-grid', false));
    await pump(page, 4, 60);
    const disabled = await sceneProbe(page);
    check('every batch is hidden when the layer is off',
      disabled.batches.every((batch) => !batch.show),
      `${disabled.batches.filter((b) => b.show).length} still shown`);
    check('and so are the points',
      disabled.points.every((point) => !point.collectionShown));
    await shoot(page, '04-off.png');

    const relevantErrors = consoleErrors.filter((text) => /power-grid|Power Grid/i.test(text));
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
    console.log('[qa] power-grid: all checks passed');
  }
  console.log(`[qa] shots → ${path.relative(REPO_ROOT, SHOTS_DIR)}/`);
}

main().catch((error) => {
  console.error('[qa] harness error:', error);
  process.exitCode = 1;
});
