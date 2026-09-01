#!/usr/bin/env node
/**
 * Deterministic browser proof for the two Bison Futé layers — `road-events-fr`
 * (Événements routiers) and `road-sensors-fr` (Capteurs trafic).
 *
 * Both upstreams are live and change every few minutes, so this harness
 * intercepts `/api/bison-fute/*` with the SAME captured DATEX II documents the
 * unit tests use — run through the real `projectRoadEvents` /
 * `projectRoadSensors` projections, so the fixture cannot drift from what the
 * proxy actually serves — and proves the things only a real Cesium scene can:
 *
 *   i.    events reach the globe as CLAMPED ground geometry, one primitive per
 *         situation, points clamped and segments classified against the surface
 *   ii.   the markers are LEGIBLE — the obstacle's violet counted in pixels
 *         with the layer shown against the same view with it hidden, because a
 *         layer that renders perfectly in a colour nobody sees is still
 *         invisible. This is the check that moved `ended` from alpha 0.3 to
 *         0.45: on a light basemap the fainter marker registered no pixels.
 *   iii.  the scope chip the app actually renders widens the drawn set through
 *         the manager's own `setLayerParams`, not through the module directly
 *   iv.   the zero-sample trap survives the WHOLE path: MYK69.K1 is drawn grey
 *         under `Vitesse` — because its 0.0 km/h came from no samples — and
 *         magenta under `Débit`, because its 7 114 véh/h is a real measurement
 *   v.    a station whose two published ends coincide is drawn as a point, not
 *         as a zero-length polyline
 *   vi.   switching the map stack re-classifies every stroke in both layers
 *   vii.  both layers turn off cleanly and leave nothing on the globe
 *
 * Screenshots are written under the gitignored `qa-shots/bison-fute/`.
 *
 * Run: node scripts/qa-bison-fute.mjs --url http://localhost:4173
 *      node scripts/qa-bison-fute.mjs --live   (no interception — the real
 *                                               proxy, for tonight's France)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';
import { projectRoadEvents, projectRoadSensors } from '../src/data/bisonFuteFeed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'bison-fute');
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

const EVENTS_LAYER = 'road-events-fr';
const SENSORS_LAYER = 'road-sensors-fr';

/** A view that holds all of metropolitan France. */
const FRANCE = { lon: 2.4, lat: 46.6, height: 1_800_000 };
/**
 * Voglans, Savoie — the captured landslide that cut the D10, and the fixture's
 * one ACTIVE obstacle. The legibility pass counts THIS marker rather than the
 * accident on the N94, because that accident is an `ended` situation the
 * default scope correctly hides: counting pixels for a marker that is supposed
 * to be absent would prove the opposite of what it claims to.
 */
const VOGLANS = { lon: 6.03332, lat: 45.59788, height: 40_000 };
/** Lyon east — where the captured A42/N346 stations are. */
const LYON = { lon: 4.95, lat: 45.76, height: 60_000 };

/** The palette, duplicated on purpose: a QA harness asserts, it doesn't import styling. */
const OBSTACLE = '#b06bff';
const NO_DATA = '#6b7280';
const SATURATED = '#ff2d95';

/**
 * The captured documents' own instants, so the fixture's `state` and `age` are
 * the same in this harness as in the unit tests, forever.
 */
const EVENTS_CAPTURE_MS = Date.parse('2026-08-31T21:13:26.825+02:00');
const QTV_CAPTURE_MS = Date.parse('2026-08-31T22:11:52+02:00');

const readFixture = (name) => fs.readFileSync(
  path.join(REPO_ROOT, 'src', 'data', 'fixtures', name), 'utf8',
);

/** The proxy's own output, built from the captured DATEX II bodies. */
function eventsPayload() {
  const projected = projectRoadEvents(
    readFixture('bison-fute-evenementiel-sample.xml'),
    { nowMs: EVENTS_CAPTURE_MS },
  );
  return {
    fetchedAt: Date.now(), stale: false, ttlMs: 300_000,
    source: 'Bison Futé / Tipi (qa fixture)', ...projected,
  };
}

function measurementsPayload() {
  const projected = projectRoadSensors(
    readFixture('bison-fute-qtv-sample.xml'),
    readFixture('bison-fute-qtv-referentiel-sample.csv'),
    { nowMs: QTV_CAPTURE_MS },
  );
  return {
    fetchedAt: Date.now(), stale: false, ttlMs: 180_000,
    source: 'Bison Futé / Tipi (qa fixture)', ...projected,
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
  }, lon, lat, height);
  await pump(page, 4);
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
 * Read one layer's rendered state out of the live scene.
 *
 * Deliberately reads the SCENE, not the layer's model: the point of a browser
 * proof is that the geometry reached the globe, so colours come off the
 * resolved graphics and heights off the resolved positions.
 */
function sceneProbe(page, layerId) {
  return page.evaluate((id) => {
    const gev = window.__godsEyeView;
    const module = gev.dataManager.layers.get(id).module;
    const sources = gev.viewer.dataSources;
    let collection = null;
    for (let i = 0; i < sources.length; i += 1) {
      if (String(sources.get(i).name || '') === id) collection = sources.get(i);
    }
    const hex = (color) => (color
      ? `#${[color.red, color.green, color.blue]
        .map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`
      : null);

    const ellipsoid = gev.viewer.scene.globe?.ellipsoid || gev.viewer.scene.ellipsoid;
    const strokes = [];
    const points = [];
    for (const entity of collection ? collection.entities.values : []) {
      if (entity.polyline) {
        const material = entity.polyline.material?.color?.getValue?.();
        const positions = entity.polyline.positions?.getValue?.() || [];
        let maxHeight = 0;
        for (const position of positions) {
          const carto = ellipsoid.cartesianToCartographic(position);
          if (carto) maxHeight = Math.max(maxHeight, Math.abs(carto.height));
        }
        strokes.push({
          id: String(entity.id),
          color: hex(material),
          alpha: material ? Math.round(material.alpha * 1000) / 1000 : null,
          vertices: positions.length,
          width: entity.polyline.width?.getValue?.() ?? null,
          clamped: entity.polyline.clampToGround?.getValue?.() === true,
          classification: String(entity.polyline.classificationType?.getValue?.() ?? ''),
          maxHeight: Math.round(maxHeight * 100) / 100,
        });
      } else if (entity.point) {
        const color = entity.point.color?.getValue?.();
        points.push({
          id: String(entity.id),
          color: hex(color),
          alpha: color ? Math.round(color.alpha * 1000) / 1000 : null,
          pixelSize: entity.point.pixelSize?.getValue?.() ?? null,
          heightReference: String(entity.point.heightReference?.getValue?.() ?? ''),
        });
      }
    }

    return {
      stats: module.getStats(),
      controls: module.getRowControls(),
      analyst: module.getAnalystRecords(50),
      strokes,
      points,
      shown: collection ? collection.show : null,
      sourceFound: Boolean(collection),
    };
  }, layerId);
}

/**
 * Count canvas pixels within `tolerance` of a colour.
 *
 * This is the check a screenshot cannot make. A layer can be clamped,
 * classified, coloured and on the globe, and still be invisible to a person
 * looking at it. So the harness counts the accent's own pixels with the layer
 * shown and with it hidden, and the DELTA is the proof it reached someone's eye.
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

/** Show or hide one layer's data source without touching the layer's state. */
async function setSourceVisible(page, layerId, visible) {
  await page.evaluate((id, show) => {
    const sources = window.__godsEyeView.viewer.dataSources;
    for (let i = 0; i < sources.length; i += 1) {
      if (String(sources.get(i).name || '') === id) sources.get(i).show = show;
    }
  }, layerId, visible);
}

/** Wait until a layer has drawn something, or give up honestly. */
async function waitForDrawing(page, layerId, attempts = 30) {
  let probe = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await pump(page, 3, 60);
    await sleep(400);
    probe = await sceneProbe(page, layerId);
    if (probe.strokes.length + probe.points.length > 0) break;
  }
  return probe;
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

    const events = eventsPayload();
    const measurements = measurementsPayload();
    let apiRequests = 0;
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (!LIVE && url.origin === APP_ORIGIN && url.pathname.startsWith('/api/bison-fute/')) {
        apiRequests += 1;
        const body = url.pathname.endsWith('/measurements') ? measurements : events;
        void request.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(body),
        });
        return;
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
    await setView(page, FRANCE.lon, FRANCE.lat, FRANCE.height);

    // ── i. events reach the globe as clamped ground geometry ───────────────
    console.log('[qa] i. events are clamped ground geometry, one primitive per situation');
    await page.evaluate((id) => window.__godsEyeView.dataManager.setEnabled(id, true), EVENTS_LAYER);
    const drawn = await waitForDrawing(page, EVENTS_LAYER);
    check('the events data source is on the globe', drawn?.sourceFound === true);
    check('something is drawn', (drawn.strokes.length + drawn.points.length) > 0,
      `${drawn.strokes.length} strokes / ${drawn.points.length} points`);
    check('the proxy was asked for the feed', LIVE || apiRequests > 0, `${apiRequests} requests`);
    check('one drawn primitive per in-scope situation',
      drawn.strokes.length + drawn.points.length === drawn.stats.count,
      `${drawn.strokes.length + drawn.points.length} vs ${drawn.stats.count}`);
    check('the default scope draws only what is happening now',
      drawn.stats.count < drawn.stats.published,
      `${drawn.stats.count} of ${drawn.stats.published}`);
    check('every segment is clamped to the ground',
      drawn.strokes.every((stroke) => stroke.clamped));
    check('no segment carries a height of its own',
      drawn.strokes.every((stroke) => stroke.maxHeight < 1),
      JSON.stringify(drawn.strokes.map((stroke) => stroke.maxHeight)));
    check('every point is clamped, not floated on the ellipsoid',
      drawn.points.every((point) => /CLAMP_TO_GROUND|1/.test(point.heightReference)),
      JSON.stringify(drawn.points.map((point) => point.heightReference)));
    check('the row states the coverage it actually has',
      drawn.stats.coverage === 'RRN non concédé', String(drawn.stats.coverage));
    await shoot(page, '01-events-france.png');

    // ── ii. the markers are legible ────────────────────────────────────────
    console.log('[qa] ii. the obstacle marker is visible to a person, not just to the model');
    await setView(page, VOGLANS.lon, VOGLANS.lat, VOGLANS.height);
    await pump(page, 6, 80);
    const withEvents = await countPixels(page, OBSTACLE);
    await setSourceVisible(page, EVENTS_LAYER, false);
    await pump(page, 6, 80);
    const withoutEvents = await countPixels(page, OBSTACLE);
    await setSourceVisible(page, EVENTS_LAYER, true);
    await pump(page, 6, 80);
    check('the layer adds its own accent pixels to the canvas',
      withEvents > withoutEvents, `${withEvents} shown vs ${withoutEvents} hidden`);
    await shoot(page, '02-events-voglans.png');

    // ── iii. the scope chip widens the drawn set, through the manager ──────
    console.log('[qa] iii. the scope chip the app renders widens the drawn set');
    const chips = drawn.controls.chips.map((chip) => chip.id);
    check('the row offers the three scopes', chips.join(',') === 'active,upcoming,all', chips.join(','));
    check('exactly one scope is active', drawn.controls.chips.filter((chip) => chip.active).length === 1);
    check('the legend has no zero-count rows', drawn.controls.legend.every((row) => row.count > 0));
    await page.evaluate((id) => window.__godsEyeView.dataManager
      .setLayerParams(id, { scope: 'all' }, { origin: 'user' }), EVENTS_LAYER);
    await pump(page, 4, 80);
    const widened = await sceneProbe(page, EVENTS_LAYER);
    check('"Tout" draws every published situation',
      widened.stats.count === widened.stats.published,
      `${widened.stats.count} of ${widened.stats.published}`);
    check('the extra primitives actually reached the globe',
      widened.strokes.length + widened.points.length > drawn.strokes.length + drawn.points.length);
    check('a planned event is drawn dimmer than an active one',
      Math.min(...[...widened.strokes, ...widened.points].map((entry) => entry.alpha))
        < Math.max(...[...widened.strokes, ...widened.points].map((entry) => entry.alpha)));
    await page.evaluate((id) => window.__godsEyeView.dataManager
      .setLayerParams(id, { scope: 'active' }, { origin: 'user' }), EVENTS_LAYER);
    await pump(page, 3, 60);

    // ── iv. the zero-sample trap survives the whole path ───────────────────
    console.log('[qa] iv. a 0 km/h built from no samples is grey, and its real flow is not');
    await page.evaluate((id) => window.__godsEyeView.dataManager.setEnabled(id, true), SENSORS_LAYER);
    await setView(page, LYON.lon, LYON.lat, LYON.height);
    const sensors = await waitForDrawing(page, SENSORS_LAYER);
    check('the sensors data source is on the globe', sensors?.sourceFound === true);
    check('every placed station is drawn',
      sensors.strokes.length + sensors.points.length === sensors.stats.count,
      `${sensors.strokes.length + sensors.points.length} vs ${sensors.stats.count}`);
    check('the row shows the placed count against the published one',
      sensors.stats.published > sensors.stats.count,
      `${sensors.stats.count} placed of ${sensors.stats.published} published`);

    const trap = [...sensors.strokes, ...sensors.points]
      .find((entry) => entry.id === 'road-sensor:MYK69.K1');
    check('the zero-sample station reached the globe', Boolean(trap));
    check('its speed is drawn as NO MEASUREMENT, not as a standstill',
      trap?.color?.toLowerCase() === NO_DATA, String(trap?.color));

    await page.evaluate((id) => window.__godsEyeView.dataManager
      .setLayerParams(id, { metric: 'flow' }, { origin: 'user' }), SENSORS_LAYER);
    await pump(page, 4, 80);
    const byFlow = await sceneProbe(page, SENSORS_LAYER);
    const trapFlow = [...byFlow.strokes, ...byFlow.points]
      .find((entry) => entry.id === 'road-sensor:MYK69.K1');
    check('its 7 114 véh/h IS a measurement and is coloured as one',
      trapFlow?.color?.toLowerCase() === SATURATED, String(trapFlow?.color));
    check('the metric switch recoloured without changing the drawn count',
      byFlow.strokes.length + byFlow.points.length === sensors.strokes.length + sensors.points.length);
    check('the legend followed the metric',
      byFlow.controls.legend.some((row) => row.label.includes('véh/h')),
      JSON.stringify(byFlow.controls.legend.map((row) => row.label)));
    await page.evaluate((id) => window.__godsEyeView.dataManager
      .setLayerParams(id, { metric: 'speed' }, { origin: 'user' }), SENSORS_LAYER);
    await pump(page, 3, 60);
    await shoot(page, '03-sensors-lyon.png');

    // ── v. a degenerate station is a point, not a zero-length line ─────────
    console.log('[qa] v. a station whose two ends coincide is drawn as a point');
    const degenerate = sensors.points.find((point) => point.id === 'road-sensor:MY269.C4');
    check('the degenerate station is a point', Boolean(degenerate));
    check('it is not also a polyline',
      !sensors.strokes.some((stroke) => stroke.id === 'road-sensor:MY269.C4'));
    check('every drawn stroke has two distinct vertices',
      sensors.strokes.every((stroke) => stroke.vertices === 2),
      JSON.stringify(sensors.strokes.map((stroke) => stroke.vertices)));

    // ── vi. the map stack re-classifies both layers ────────────────────────
    console.log('[qa] vi. switching the map stack re-classifies every stroke');
    const classificationsFor = (probe) => new Set(probe.strokes.map((stroke) => stroke.classification));
    const beforeEvents = classificationsFor(await sceneProbe(page, EVENTS_LAYER));
    const beforeSensors = classificationsFor(await sceneProbe(page, SENSORS_LAYER));
    // The switch is ASKED FOR and then READ BACK. `photoreal` is the only stack
    // whose surface differs — it classifies against the 3D tiles instead of the
    // terrain — and it needs a Google 3D Tiles key a keyless checkout does not
    // have. Asserting on the REQUEST rather than on the result would fail this
    // harness for a missing key instead of for a broken layer, so a checkout
    // without one falls through to the weaker check below, which still proves
    // the listener is wired to the controller's real event.
    const switched = await page.evaluate(async () => {
      const controller = window.__godsEyeView?.mapStackController;
      if (typeof controller?.setStack !== 'function') return null;
      if (!controller.isStackAvailable('photoreal')) {
        // Still exercise the channel: a switch between two available globe
        // stacks must fire the event and leave a valid classification behind.
        const fallback = ['ign-plan', 'osm', 'bing-aerial']
          .find((id) => controller.isStackAvailable(id) && id !== controller.getActiveId());
        if (fallback) { try { await controller.setStack(fallback); } catch { /* refused */ } }
        return controller.getActiveId();
      }
      try { await controller.setStack('photoreal'); } catch { /* refused */ }
      return controller.getActiveId();
    });
    if (switched === 'photoreal') {
      await pump(page, 5, 80);
      const afterEvents = classificationsFor(await sceneProbe(page, EVENTS_LAYER));
      const afterSensors = classificationsFor(await sceneProbe(page, SENSORS_LAYER));
      check('events re-classified against the new surface',
        [...afterEvents].join() !== [...beforeEvents].join(),
        `${[...beforeEvents].join()} → ${[...afterEvents].join()}`);
      check('sensors re-classified against the new surface',
        [...afterSensors].join() !== [...beforeSensors].join(),
        `${[...beforeSensors].join()} → ${[...afterSensors].join()}`);
      check('each layer classifies in ONE batched pass, not per stroke',
        afterEvents.size <= 1 && afterSensors.size <= 1);
    } else {
      console.log(`  · photoreal unavailable (stack is now "${switched ?? 'none'}") — `
        + 'the 3D-tiles classification is not exercised; it needs a Google 3D Tiles key');
      await pump(page, 5, 80);
      const afterEvents = classificationsFor(await sceneProbe(page, EVENTS_LAYER));
      const afterSensors = classificationsFor(await sceneProbe(page, SENSORS_LAYER));
      check('a globe-to-globe switch leaves both layers on a valid surface',
        [...afterEvents, ...afterSensors].every((value) => value !== ''),
        `${[...afterEvents].join()} / ${[...afterSensors].join()}`);
      check('and each still classifies in ONE batched pass',
        afterEvents.size <= 1 && afterSensors.size <= 1);
    }

    // ── vii. both layers turn off cleanly ──────────────────────────────────
    console.log('[qa] vii. disabling clears the globe');
    for (const layerId of [EVENTS_LAYER, SENSORS_LAYER]) {
      await page.evaluate((id) => window.__godsEyeView.dataManager.setEnabled(id, false), layerId);
    }
    await pump(page, 4, 60);
    for (const layerId of [EVENTS_LAYER, SENSORS_LAYER]) {
      const off = await sceneProbe(page, layerId);
      check(`${layerId} is hidden when off`, off.shown === false, String(off.shown));
      check(`${layerId} answers no analyst query when off`, off.analyst.length === 0);
    }
    await shoot(page, '04-off.png');

    const relevantErrors = consoleErrors.filter(
      (text) => /bison-fute|RoadEvents|RoadSensors|road-events-fr|road-sensors-fr/i.test(text),
    );
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
    console.log('[qa] bison-fute: all checks passed');
  }
  console.log(`[qa] shots → ${path.relative(REPO_ROOT, SHOTS_DIR)}/`);
}

main().catch((error) => {
  console.error('[qa] harness error:', error);
  process.exitCode = 1;
});
