#!/usr/bin/env node
/**
 * Deterministic browser proof for the Stations météo layer (`meteo-stations-fr`).
 *
 * The network is a SHIPPED file, so unlike the live layers there is nothing to
 * intercept — this harness reads the same `stations.json` the browser does and
 * proves the six things only a real Cesium scene can prove:
 *
 *   i.   all 2 144 stations reach the globe, and the layer reports the
 *        network's own totals rather than the marker count
 *   ii.  colour is the measured class: the palette on screen matches what each
 *        station's inventory says it can measure, and the six undocumented
 *        stations are grey rather than empty
 *   iii. the VENT chip deletes 60 % of the map — the layer's whole argument,
 *        read off the rendered primitives rather than off the model
 *   iv.  a live station is drawn with its ring and a silent one is not, and the
 *        190 rings are not the 62 the SYNOP list names
 *   v.   clicking a station opens a card, and clicking a station that does not
 *        publish still opens a full one
 *   vi.  markers stand ON the terrain — this network holds the three highest
 *        instruments in France and an unclamped point at 3 845 m slides across
 *        the map as the camera pans
 *
 * Screenshots are written under the gitignored `qa-shots/meteo-stations/`.
 *
 * Run: node scripts/qa-meteo-stations-fr.mjs --url http://localhost:4173
 *
 * The live-observation half needs the DEV SERVER: `/api/meteo-stations/*` is a
 * Vite middleware, and `vite preview` answers those paths with the SPA's HTML.
 * The harness probes for it and reports "not testable here" rather than
 * "broken" when run against a preview build.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'meteo-stations');
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

const REGISTRY = JSON.parse(fs.readFileSync(
  path.join(REPO_ROOT, 'src', 'data', 'local_data', 'meteo_stations_fr', 'stations.json'), 'utf8',
));
const byName = (name) => REGISTRY.stations.find((station) => station.name === name);

const LAYER_ID = 'meteo-stations-fr';
/** A station that publishes hourly and is absent from the published SYNOP list. */
const BOULOGNE_OMM = '07002';
const PREFIX = 'meteo-station:';

/** The palette, restated rather than imported: a QA harness asserts, it doesn't style. */
const SYNOPTIC = '#7ee8fa';
const TEMP_RAIN = '#ffd166';
const UNKNOWN = '#5c6b7a';
const LIVE_RING = '#e8f6ff';

/** A view holding all of metropolitan France, and one holding the Mont-Blanc massif. */
const FRANCE = { lon: 2.6, lat: 46.6, height: 2_200_000 };
const CHAMONIX = { lon: 6.887, lat: 45.879, height: 40_000 };

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
 * Read the layer's rendered state out of the live scene.
 *
 * Reads the POINT PRIMITIVES, not the layer's model: the point of a browser
 * proof is that the paint reached the globe, so sizes, colours, outlines and
 * alphas come off the collection and positions are unprojected back to degrees.
 */
function sceneProbe(page) {
  return page.evaluate((layerId, prefix) => {
    const gev = window.__godsEyeView;
    // `dataManager` exists before every layer has registered into it, so the
    // boot poll can win the race and this can still be undefined. Reporting
    // "not registered yet" lets the caller keep polling; reading `.module` off
    // undefined turned a slow boot into a crash that looked like a bug.
    const entry = gev.dataManager.layers.get(layerId);
    if (!entry?.module) return { registered: false, points: [], collectionFound: false };
    const { module } = entry;
    const scene = gev.viewer.scene;
    const ellipsoid = scene.globe?.ellipsoid || scene.ellipsoid;
    const r2d = 180 / Math.PI;

    let collection = null;
    for (let i = 0; i < scene.primitives.length; i += 1) {
      const primitive = scene.primitives.get(i);
      if (typeof primitive?.get !== 'function' || !(primitive.length > 0)) continue;
      if (String(primitive.get(0)?.id || '').startsWith(prefix)) collection = primitive;
    }
    const hex = (color) => (color
      ? `#${[color.red, color.green, color.blue]
        .map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`
      : null);

    const points = [];
    for (let i = 0; collection && i < collection.length; i += 1) {
      const point = collection.get(i);
      const carto = point.position ? ellipsoid.cartesianToCartographic(point.position) : null;
      points.push({
        id: String(point.id),
        pixelSize: point.pixelSize,
        color: hex(point.color),
        alpha: point.color?.alpha ?? null,
        outline: hex(point.outlineColor),
        outlineWidth: point.outlineWidth,
        lat: carto ? carto.latitude * r2d : null,
        lon: carto ? carto.longitude * r2d : null,
        // The rendered ELLIPSOIDAL height. A marker left at 0 under the
        // Aiguille du Midi is nearly four kilometres underground, and drifts
        // on screen as the camera pans.
        height: carto ? carto.height : null,
      });
    }
    return {
      registered: true,
      stats: module.getStats(),
      controls: module.getRowControls(),
      analyst: module.getAnalystRecords(40),
      overlay: window.__gevWorldOverlay?.getDiagnostics?.() || null,
      points,
      collectionFound: Boolean(collection),
      shown: collection ? collection.show !== false : null,
    };
  }, LAYER_ID, PREFIX);
}

/** Screen position of a rendered marker, by its render id. */
async function markerAt(page, renderId) {
  return page.evaluate((id, prefix) => {
    const scene = window.__godsEyeView.viewer.scene;
    let collection = null;
    for (let i = 0; i < scene.primitives.length; i += 1) {
      const primitive = scene.primitives.get(i);
      if (typeof primitive?.get !== 'function' || !(primitive.length > 0)) continue;
      if (String(primitive.get(0)?.id || '').startsWith(prefix)) collection = primitive;
    }
    if (!collection) return null;
    for (let i = 0; i < collection.length; i += 1) {
      const point = collection.get(i);
      if (String(point.id) !== id) continue;
      const window2d = scene.cartesianToCanvasCoordinates(point.position);
      if (!window2d) return null;
      return { x: Math.round(window2d.x), y: Math.round(window2d.y) };
    }
    return null;
  }, renderId, PREFIX);
}

/**
 * Click the canvas with synthetic pointer events.
 *
 * `page.mouse.click` needs a layout round trip that starves under SwiftShader,
 * and Cesium's `ScreenSpaceEventHandler` listens for pointer events on the
 * canvas rather than for a synthesised `click`.
 */
async function pointerClick(page, x, y) {
  await page.evaluate((cx, cy) => {
    const canvas = window.__godsEyeView?.viewer?.scene?.canvas;
    if (!canvas) return;
    const box = canvas.getBoundingClientRect();
    const common = {
      bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: 'mouse',
      isPrimary: true, button: 0, buttons: 1,
      clientX: box.left + cx, clientY: box.top + cy,
    };
    canvas.dispatchEvent(new PointerEvent('pointerdown', common));
    canvas.dispatchEvent(new PointerEvent('pointerup', { ...common, buttons: 0 }));
  }, x, y);
}

/**
 * How many entries each overlay source actually PAINTED.
 *
 * The cards are drawn to a canvas, not to the DOM, so a browser proof can
 * assert that the selected-card source painted — never what it says. The
 * card's text is pinned in `meteoStationsFrance.test.mjs`, against the same
 * shipped file.
 */
function paintedBySource(page) {
  return page.evaluate(() => window.__gevWorldOverlay?.getDiagnostics?.()?.paintedBySource || {});
}

async function setFilter(page, filter) {
  await page.evaluate((layerId, value) => {
    window.__godsEyeView.dataManager.layers.get(layerId).module.setParams({ filter: value });
  }, LAYER_ID, filter);
  await pump(page, 4);
}

async function main() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: !HEADFUL,
    executablePath: chrome,
    args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000 },
    protocolTimeout: 180000,
  });

  try {
    const page = await newQaPage(browser);
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    console.log(`[qa] booting ${APP_URL}`);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Polled with `page.evaluate`, not `page.waitForFunction`: under
    // SwiftShader the default rAF polling never ticks.
    let booted = false;
    for (let attempt = 0; attempt < 120 && !booted; attempt += 1) {
      booted = await page.evaluate(
        () => Boolean(window.__godsEyeView?.viewer && window.__godsEyeView?.dataManager),
      ).catch(() => false);
      if (!booted) await sleep(1000);
    }
    if (!booted) throw new Error('the app never created window.__godsEyeView');
    await sleep(2000);
    await setView(page, FRANCE.lon, FRANCE.lat, FRANCE.height);

    console.log('[qa] i. the whole network reaches the globe');
    // Registration can still be in flight when the boot poll returns, so the
    // enable is retried until the layer is there to be enabled.
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const registered = await page.evaluate((layerId) => {
        const manager = window.__godsEyeView?.dataManager;
        if (!manager?.layers?.get(layerId)?.module) return false;
        manager.setEnabled(layerId, true);
        return true;
      }, LAYER_ID);
      if (registered) break;
      await sleep(500);
    }
    let probe = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await pump(page, 3, 60);
      await sleep(400);
      probe = await sceneProbe(page);
      if (probe.registered && probe.collectionFound && probe.points.length > 2000) break;
    }
    if (!probe?.registered) throw new Error(`${LAYER_ID} never registered into the data manager`);
    check('the point collection reached the scene', probe.collectionFound);
    check(`${REGISTRY.stations.length} markers are drawn`,
      probe.points.length === REGISTRY.stations.length, `${probe.points.length} drawn`);
    check('the network\'s own totals are reported',
      probe.stats.stations === REGISTRY.stats.stations
      && probe.stats.metropole + probe.stats.overseas === probe.stats.stations,
      `${probe.stats.stations} stations`);
    check('what publishes and what is merely listed stay separable',
      probe.stats.live === REGISTRY.stats.live
      && probe.stats.listedSynop === REGISTRY.stats.synop
      && probe.stats.live > probe.stats.listedSynop * 2,
      `${probe.stats.live} publish, ${probe.stats.listedSynop} listed`);
    await shoot(page, '01-france.png');

    console.log('[qa] ii. colour is the measured class');
    const drawn = new Map(probe.points.map((point) => [point.id.slice(PREFIX.length), point]));
    const toulouse = drawn.get(byName('TOULOUSE-BLAGNAC').id);
    const alba = drawn.get(byName('ALBA LA ROMAINE').id);
    check('a complete synoptic station is drawn in the synoptic colour',
      toulouse?.color === SYNOPTIC, toulouse?.color);
    check('a station with no published inventory is grey, not absent and not empty',
      alba?.color === UNKNOWN, alba?.color);
    const tempRain = REGISTRY.stations.filter((s) => s.klass === 'temp-rain');
    const tempRainDrawn = tempRain.filter((s) => drawn.get(s.id)?.color === TEMP_RAIN);
    check('every temperature-and-rain station carries that colour',
      tempRainDrawn.length === tempRain.length,
      `${tempRainDrawn.length} of ${tempRain.length}`);
    check('the majority of the map is that colour — the layer\'s argument, on screen',
      tempRain.length > REGISTRY.stations.length / 2,
      `${tempRain.length} of ${REGISTRY.stations.length}`);
    // Size must track the instrument count, not the altitude or the pack.
    const richest = REGISTRY.stations.reduce(
      (best, s) => ((s.fam?.length || 0) > (best.fam?.length || 0) ? s : best), REGISTRY.stations[0],
    );
    check('the best-instrumented station is drawn larger than a two-instrument poste',
      drawn.get(richest.id)?.pixelSize > drawn.get(tempRain[0].id)?.pixelSize,
      `${drawn.get(richest.id)?.pixelSize}px vs ${drawn.get(tempRain[0].id)?.pixelSize}px`);

    console.log('[qa] iii. a live station wears a ring, a silent one does not');
    const boulogne = drawn.get(byName('BOULOGNE-SEM').id);
    const capCepet = drawn.get(byName('CAP CEPET').id);
    check('BOULOGNE-SEM publishes hourly and is ringed, though the SYNOP list omits it',
      boulogne?.outline === LIVE_RING, boulogne?.outline);
    check('CAP CEPET is on that list, has written nothing all year, and gets no ring',
      capCepet && capCepet.outline !== LIVE_RING, capCepet?.outline);
    const ringed = probe.points.filter((point) => point.outline === LIVE_RING);
    check('the rings count the archive, not the list',
      ringed.length === REGISTRY.stats.live, `${ringed.length} rings for ${REGISTRY.stats.live} live`);

    console.log('[qa] iii-bis. a closed station is drawn hollow, not dropped');
    const marsillargues = drawn.get(byName('MARSILLARGUES').id);
    check('MARSILLARGUES closed on 2026-01-01 and is still drawn',
      Boolean(marsillargues));
    check('and it is drawn hollow', marsillargues && marsillargues.alpha < 0.3,
      `alpha ${marsillargues?.alpha}`);

    console.log('[qa] iv. the VENT chip deletes most of the map');
    await setFilter(page, 'wind');
    const windProbe = await sceneProbe(page);
    check('fewer than half the markers survive the wind filter',
      windProbe.points.length < probe.points.length / 2,
      `${windProbe.points.length} of ${probe.points.length}`);
    check('and it is exactly the stations with an anemometer',
      windProbe.points.length === REGISTRY.stats.byFamily.wind,
      `${windProbe.points.length} vs ${REGISTRY.stats.byFamily.wind}`);
    check('the network\'s totals are untouched by a display filter',
      windProbe.stats.stations === REGISTRY.stats.stations
      && windProbe.stats.hidden === probe.points.length - windProbe.points.length);
    await shoot(page, '02-vent.png');

    await setFilter(page, 'live');
    const liveProbe = await sceneProbe(page);
    check('the RELEVÉS chip leaves exactly the stations that publish',
      liveProbe.points.length === REGISTRY.stats.live, `${liveProbe.points.length} drawn`);
    await shoot(page, '03-releves.png');
    await setFilter(page, 'all');

    console.log('[qa] v. clicking a station opens a card');
    const observationsLive = await page.evaluate(async () => {
      try {
        const response = await fetch('/api/meteo-stations/status');
        const body = await response.json();
        return typeof body?.ttlMs === 'number';
      } catch { return false; }
    });
    if (!observationsLive) {
      console.log('  · /api/meteo-stations is a dev-server middleware — live readings not testable here');
    }

    // A station that does NOT publish must still open a full card: everything
    // that identifies it is in the shipped pack.
    const silent = REGISTRY.stations.find(
      (s) => !s.live && Array.isArray(s.fam) && s.fam.length >= 2 && s.dep === '01',
    ) || REGISTRY.stations.find((s) => !s.live && Array.isArray(s.fam));
    await setView(page, silent.lon, silent.lat, 30_000);
    await pump(page, 6);
    let at = await markerAt(page, `${PREFIX}${silent.id}`);
    check(`${silent.name} is on screen to be clicked`, Boolean(at), JSON.stringify(at));
    if (at) {
      await pointerClick(page, at.x, at.y);
      await pump(page, 6);
      const painted = await paintedBySource(page);
      check('a station that publishes nothing still opens a card',
        (painted['meteo-stations-fr-selected'] || 0) > 0,
        JSON.stringify(painted['meteo-stations-fr-selected']));
      await shoot(page, '04-carte-station-muette.png');
    }

    if (observationsLive) {
      // The headline feature: a station that publishes gets its last hour's
      // reading. Asserted against the PROXY's own answer rather than against a
      // literal temperature, because the weather moves and a harness that
      // pinned 17,4 °C would fail every hour by design.
      const reading = await page.evaluate(async (omm) => {
        const response = await fetch('/api/meteo-stations/observations');
        const body = await response.json();
        return { stations: body?.stations ?? 0, newest: body?.newest ?? null, mine: body?.observations?.[omm] ?? null };
      }, BOULOGNE_OMM);
      check('the observations proxy serves the archive, not the 62-station list',
        reading.stations === REGISTRY.stats.live, `${reading.stations} stations`);
      check('and it carries a reading for a station the SYNOP list omits',
        Boolean(reading.mine?.at), JSON.stringify(reading.mine)?.slice(0, 80));

      const live = byName('BOULOGNE-SEM');
      await setView(page, live.lon, live.lat, 30_000);
      await pump(page, 6);
      at = await markerAt(page, `${PREFIX}${live.id}`);
      if (check(`${live.name} is on screen to be clicked`, Boolean(at))) {
        await pointerClick(page, at.x, at.y);
        // Two paints: the local one, then the one the network completes.
        await pump(page, 10, 150);
        await sleep(1500);
        await pump(page, 6);
        const painted = await paintedBySource(page);
        check('a station that publishes opens a card too',
          (painted['meteo-stations-fr-selected'] || 0) > 0);
        await shoot(page, '06-carte-station-live.png');
      }
    }

    console.log('[qa] vi. markers stand on the terrain, not under it');
    // Two different reasons the clamp can be untestable, and they are NOT the
    // same as it being broken:
    //   · `/api/terrain/heights` is a DEV SERVER middleware, so a run against
    //     `vite preview` gets the SPA's HTML back;
    //   · the Re:Earth DEM behind that middleware answers 500 under load, and
    //     an unresolved cell simply does not clamp — by design, everywhere in
    //     this app.
    // Both are reported as "not testable here". A harness that failed on an
    // upstream outage would teach whoever reads it to ignore this check.
    const terrainProbe = async () => page.evaluate(async () => {
      try {
        // Points inside the Mont-Blanc massif that no earlier probe warmed, so
        // a cached hit cannot make a failing upstream look healthy.
        const response = await fetch(
          '/api/terrain/heights?points=6.8631,45.8339;6.9219,45.9012;6.8009,45.8551',
        );
        const body = await response.json();
        return Array.isArray(body?.results)
          && body.results.length === 3
          && body.results.every((point) => Number.isFinite(point?.ellipsoid));
      } catch { return false; }
    });

    if (!(await terrainProbe())) {
      console.log('  · /api/terrain/heights unavailable — clamp not testable in this run');
    } else {
      await setView(page, CHAMONIX.lon, CHAMONIX.lat, CHAMONIX.height);
      const aiguilleId = `${PREFIX}${byName('AIGUILLE DU MIDI').id}`;
      let clamped = null;
      for (let attempt = 0; attempt < 25 && !clamped; attempt += 1) {
        await pump(page, 4, 100);
        await sleep(400);
        const near = await sceneProbe(page);
        const aiguille = near.points.find((point) => point.id === aiguilleId);
        if (aiguille && aiguille.height > 1000) clamped = aiguille;
      }
      if (!clamped && !(await terrainProbe())) {
        // It resolved nothing AND the DEM has since started failing: that is
        // the outage, not the layer.
        console.log('  · the terrain DEM began failing mid-run — clamp not testable');
      } else {
        // The published altitude is 3 845 m; the clamp puts the marker on the
        // terrain under it, which the DEM will not place at exactly that
        // height. Measured 2026-09-02: 3 810,7 m ellipsoidal.
        check('the Aiguille du Midi marker is lifted onto the terrain, not left on the ellipsoid',
          clamped && clamped.height > 2500,
          clamped ? `${clamped.height.toFixed(0)} m` : 'never clamped');
      }
      await shoot(page, '05-aiguille-du-midi.png');
    }

    const fatal = consoleErrors.filter(
      (text) => !/favicon|ResizeObserver|WebGL|SwiftShader|Failed to load resource/i.test(text),
    );
    check('no unexpected console errors', fatal.length === 0, fatal.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
  }

  console.log('');
  if (failures.length) {
    console.log(`✖ ${failures.length} check(s) failed:`);
    for (const failure of failures) console.log(`   · ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('✓ Stations météo (FR) — every check passed');
  }
}

main().catch((error) => {
  console.error(`\n✖ ${error?.stack || error}`);
  process.exitCode = 1;
});
