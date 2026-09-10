#!/usr/bin/env node
/**
 * Deterministic browser proof for the merged Île-de-France layer (`idfm-network`).
 *
 * The layer draws TWO publications on one row since 2026-09-10 — the ODbL stop
 * referential and the Licence Ouverte hourly offer — and the whole point of the
 * merge is that a reader never has to know that. Both upstreams are live and
 * therefore untestable as a fixed truth, so this harness intercepts
 * `/api/idfm/stops` and `/api/idfm-frequency/stops` with fixtures and proves
 * the six things the merge is answerable for:
 *
 *   i.   the panel offers ONE IDFM control, not two — no `Fréquence IDFM` chip
 *        survives anywhere in the layer panel
 *   ii.  above 20 km the layer is dormant and asks for nothing at all
 *   iii. inside the gate, one toggle draws BOTH marks — a mode pictogram per
 *        referential stop and a rate disc per profiled stop, on the same points
 *   iv.  one click prints one card carrying both halves: fare zone and step-free
 *        status from the referential, departures per hour from the offer — and
 *        a stop that only one publication holds says WHICH half is missing
 *        instead of showing a zero
 *   v.   the seven moment chips repaint what the browser already holds: a
 *        different hour, different colours, and NO new request
 *   vi.  between the two gates the pictograms stay and the discs go, and the
 *        card says the hourly offer is not read at that altitude
 *
 * Selection is driven through the layer module's own `resolveSelection` /
 * `buildStopCard` rather than through a synthetic click, deliberately: headless
 * Chrome-for-Testing has been measured on this app picking ZERO Cesium entities
 * out of 23 on screen, so a click-driven card test proves the renderer's pick
 * buffer and not the layer.
 *
 * THE MODULE IS IMPORTED BY THE URL THE APP ITSELF LOADED, read back off the
 * page's resource timeline, and the harness asserts it got the SAME singleton
 * before it asserts anything else. Importing `/src/data/idfmNetwork.js` by hand
 * is not equivalent: as soon as the file has been edited since the dev server
 * started, Vite serves the app `…/idfmNetwork.js?t=1789049721184` and a bare
 * import creates a SECOND module instance with its own empty state. Measured —
 * every card assertion then fails against a layer that is drawing perfectly.
 *
 * Screenshots are written under the gitignored `qa-shots/idfm-network/`.
 *
 * Run: node scripts/qa-idfm-network.mjs --url http://localhost:5173
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'idfm-network');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = option('--url', process.env.QA_BASE_URL || 'http://localhost:5173');
const APP_ORIGIN = new URL(APP_URL).origin;
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The exact URLs the page loaded the two modules this harness reads from.
 *
 * Filled once, after the layer is on — see {@link loadedModuleUrl} and the
 * module docstring for why a hard-coded `/src/...` path is not equivalent.
 */
const MODULE_URLS = { layer: '/src/data/idfmNetwork.js', overlay: '/src/overlays/worldOverlay.js' };

/** Alésia, where the committed frequency fixture was measured. */
const CITY = { lon: 2.3272, lat: 48.8282 };

/**
 * The fixture stops, in the two shapes the two proxies serve.
 *
 * `23613` and `22154` are in BOTH — that is the 95.6 % case, and the card that
 * has to carry two halves. `999001` is referential-only (the 8.0 % of stops
 * with no row in the offer file) and `23997` is offer-only (a stop past the
 * referential's 100-row page). Each of the four is a distinct card sentence.
 */
const REFERENTIAL = {
  total: 4,
  truncated: false,
  byMode: { bus: 2, metro: 1, rail: 1 },
  stops: [
    {
      id: '23613', name: 'Alésia - Général Leclerc', mode: 'bus', modeLabel: 'Bus',
      town: 'Paris 14e', communeCode: '75114', zoneId: '43135', fareZone: '1',
      accessible: true, lon: 2.322076, lat: 48.829576, distanceM: null,
    },
    {
      id: '22154', name: 'Alésia', mode: 'metro', modeLabel: 'Métro',
      town: 'Paris 14e', communeCode: '75114', zoneId: '43136', fareZone: '1',
      accessible: false, lon: 2.327093, lat: 48.828201, distanceM: null,
    },
    {
      id: '23611', name: 'Les Plantes', mode: 'bus', modeLabel: 'Bus',
      town: 'Paris 14e', communeCode: '75114', zoneId: '43138', fareZone: '1',
      accessible: null, lon: 2.323009, lat: 48.829077, distanceM: null,
    },
    {
      id: '999001', name: 'Quai sans profil', mode: 'rail', modeLabel: 'RER / Transilien',
      town: 'Paris 14e', communeCode: '75114', zoneId: '43137', fareZone: '1',
      accessible: null, lon: 2.3240, lat: 48.8300, distanceM: null,
    },
  ],
};

/**
 * A 7 × 24 profile, flat except for a morning peak and a night collapse.
 *
 * Built rather than recorded, because what is under test here is the merge and
 * the repaint, not the fold — `idfmFrequencyFeed.test.mjs` already holds the
 * fold to the real portal rows. Band 4 is 04:00; the peak sits on band 8 and
 * band 25 (01:00) is the one that has to read as silence.
 */
function profile({ peak = 30, midday = 12, night = 0 }) {
  return Array.from({ length: 7 }, () => Array.from({ length: 24 }, (_, slot) => {
    const band = slot + 4;
    if (band === 8) return peak;
    if (band >= 24) return night;
    if (band >= 6 && band <= 22) return midday;
    return 0;
  }));
}

const OFFER = {
  count: 4,
  stopsInBox: 4,
  refused: 0,
  unplaced: 549,
  silent: 0,
  year: '2025',
  edition: '2026-08-18T15:54:55+00:00',
  licence: 'Licence Ouverte v2.0 (Etalab)',
  windows: { asked: 4, answered: 4 },
  stops: [
    {
      id: '23613', name: 'Alésia - Général Leclerc', aliases: ['Les Plantes'],
      commune: 'Paris', dept: '75', mode: 'bus', lat: 48.829576, lon: 2.322076,
      profile: profile({ peak: 30, midday: 12, night: 0 }), bands: 21, week: 1000,
    },
    {
      id: '22154', name: 'Alésia', aliases: null,
      commune: 'Paris', dept: '75', mode: 'metro', lat: 48.828201, lon: 2.327093,
      profile: profile({ peak: 36, midday: 20, night: 3 }), bands: 24, week: 2000,
    },
    {
      id: '23611', name: 'Les Plantes', aliases: null,
      commune: 'Paris', dept: '75', mode: 'bus', lat: 48.829077, lon: 2.323009,
      profile: profile({ peak: 6, midday: 3, night: 0 }), bands: 20, week: 300,
    },
    {
      id: '23997', name: 'Rue Benard', aliases: null,
      commune: 'Paris', dept: '75', mode: 'bus', lat: 48.831134, lon: 2.32399,
      profile: profile({ peak: 3, midday: 1.5, night: 0 }), bands: 19, week: 150,
    },
  ],
};

const failures = [];
function check(label, condition, detail = '') {
  const ok = Boolean(condition);
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`);
  return ok;
}

/**
 * Render `frames` frames explicitly.
 *
 * Everything downstream of a camera move needs real frames: Cesium raises
 * `camera.moveEnd` from the render pass, and that event is what tells the layer
 * to re-read the viewport it settled on. A software-rendered headless context
 * sometimes has no animation-frame loop at all, so the harness pumps the scene
 * itself rather than trusting the browser to.
 */
async function pump(page, frames = 8, gapMs = 80) {
  for (let frame = 0; frame < frames; frame++) {
    await page.evaluate(() => {
      try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled context */ }
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

/** Screenshot, best-effort — these are evidence, not assertions. */
async function shoot(page, name) {
  try {
    await page.evaluate(() => { try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled context */ } });
    await page.screenshot({ path: path.join(SHOTS_DIR, name) });
  } catch (error) {
    console.log(`  · screenshot ${name} unavailable (${String(error?.message || error).split('\n')[0]})`);
  }
}

/**
 * Read the layer's own view of itself, plus what Cesium was actually handed.
 *
 * `billboards` counts the referential pictograms on the data source and `discs`
 * counts the rate primitives — the two marks the merge puts on one coordinate,
 * counted separately so "both drew" is a measurement and not an inference from
 * one number.
 */
function layerProbe(page) {
  return page.evaluate(() => {
    const gev = window.__godsEyeView;
    const module = gev.dataManager.layers.get('idfm-network').module;
    const source = gev.viewer.dataSources.getByName('idfm-network')[0] || null;
    const billboards = source
      ? source.entities.values.filter((entity) => Boolean(entity.billboard)).length
      : 0;
    let discs = 0;
    const primitives = gev.viewer.scene.primitives;
    for (let i = 0; i < primitives.length; i += 1) {
      const primitive = primitives.get(i);
      if (primitive?.constructor?.name !== 'PointPrimitiveCollection') continue;
      for (let p = 0; p < primitive.length; p += 1) {
        if (String(primitive.get(p)?.id || '').startsWith('idfm-freq:')) discs += 1;
      }
    }
    return {
      stats: module.getStats(),
      controls: module.getRowControls?.() || null,
      detectables: module.getDetectableObjects({ maxCount: 100000 }).length,
      billboards,
      discs,
    };
  });
}

/**
 * The URL the running app actually loaded a source module from.
 *
 * See the module docstring: under the dev server this is `…?t=<mtime>` for any
 * file edited since the server started, and importing the bare path gets a
 * different instance. `null` when the app has not loaded it (yet).
 *
 * @param {import('puppeteer').Page} page
 * @param {string} suffix e.g. `/src/data/idfmNetwork.js`
 * @returns {Promise<string|null>}
 */
function loadedModuleUrl(page, suffix) {
  return page.evaluate((path) => {
    const names = performance.getEntriesByType('resource').map((entry) => entry.name);
    const matches = names.filter((name) => new URL(name, location.href).pathname === path);
    // Newest wins: a page that reloaded after an edit holds both.
    return matches.length ? matches[matches.length - 1] : null;
  }, suffix);
}

/**
 * The card the app raises for one id, driven through the production select.
 *
 * See the module docstring for why this does not go through a click. It is
 * still the real path: `_selectIdfmNetworkForTest` is the layer's own
 * `selectStop`, so the copy read back here is the copy the shared overlay host
 * was handed, not one the harness composed. `halves` says which of the two
 * publications the id reached, which is the merge's whole claim.
 */
function cardFor(page, id) {
  return page.evaluate(async (target, layerUrl, overlayUrl) => {
    const module = await import(layerUrl);
    const overlay = await import(overlayUrl);
    const resolved = module.resolveSelection(target);
    if (!resolved) return null;
    module._selectIdfmNetworkForTest(target);
    const [entry] = overlay.getOverlaySourceEntries(module.IDFM_OVERLAY_SOURCE_ID);
    return {
      halves: { ref: Boolean(resolved.ref), freq: Boolean(resolved.freq) },
      selectedId: entry?.id ?? null,
      copy: entry ? [entry.title, ...entry.details].join('\n') : null,
    };
  }, id, MODULE_URLS.layer, MODULE_URLS.overlay);
}

/**
 * Whether the selected card actually reached PIXELS this frame.
 *
 * `getOverlayPaintRect` only answers for the frame that just painted, so the
 * scene is rendered first. A green entry count proves the host accepted the
 * card; only a rect proves it drew one.
 */
async function cardPaintRect(page, id) {
  await pump(page, 2, 60);
  return page.evaluate(async (target, overlayUrl) => {
    const overlay = await import(overlayUrl);
    window.__godsEyeView?.viewer?.scene?.render();
    const rect = overlay.getOverlayPaintRect('idfm-network', target);
    return rect ? { x: rect.x, y: rect.y, w: rect.w, h: rect.h } : null;
  }, id, MODULE_URLS.overlay);
}

async function main() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: !HEADFUL,
    executablePath: chrome,
    args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000 },
    // 120 s and not the 45 s its siblings use. CDP calls against THIS app —
    // `captureScreenshot` above all — intermittently sit for a minute or more
    // while a software-rendered WebGL context is busy, and the call that times
    // out is almost never the one under test. A generous protocol timeout costs
    // nothing on a healthy run and removes a whole class of false failure.
    protocolTimeout: 120000,
  });

  try {
    const page = await newQaPage(browser);
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    let referentialRequests = 0;
    let offerRequests = 0;
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      // Defensive on BOTH sides: an interception handler that throws leaves the
      // request hanging for ever, and under the dev server a page carries
      // `data:` and `blob:` URLs this route has no opinion about. One escaped
      // exception here reads as "the app does not boot".
      let url = null;
      try { url = new URL(request.url()); } catch { /* not an absolute URL */ }
      if (!url) { void request.continue().catch(() => {}); return; }
      if (url.origin === APP_ORIGIN && url.pathname === '/api/idfm/stops') {
        referentialRequests += 1;
        void request.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...REFERENTIAL, fetchedAt: Date.now(), stale: false }),
        }).catch(() => {});
        return;
      }
      if (url.origin === APP_ORIGIN && url.pathname === '/api/idfm-frequency/stops') {
        offerRequests += 1;
        void request.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...OFFER, fetchedAt: Date.now(), stale: false }),
        }).catch(() => {});
        return;
      }
      void request.continue().catch(() => {});
    });

    console.log(`[qa] booting ${APP_URL}`);
    // BOOT IS RETRIED, and the navigation's lifecycle event is not the signal.
    // This harness runs against the DEV server — it has to, it imports the
    // layer module by source URL — and Vite reloads the page outright the first
    // time it optimises a dependency the boot pulled in. That detaches the
    // frame mid-navigation: measured, one attempt in three either times out on
    // DOMContentLoaded or throws "Navigating frame was detached", with the app
    // behind it perfectly alive. So the navigation result is advisory and the
    // app's OWN readiness gate decides, up to three times.
    const ready = () => page.waitForFunction(
      () => window.__godsEyeView?.viewer && window.__godsEyeView?.dataManager,
      { timeout: 40000, polling: 200 },
    ).then(() => true).catch(() => false);

    let booted = false;
    for (let attempt = 1; attempt <= 3 && !booted; attempt += 1) {
      await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 20000 })
        .catch(() => {});
      booted = await ready();
      if (!booted) console.log(`  · boot attempt ${attempt} did not settle — retrying`);
    }
    if (!booted) throw new Error(`the app never reached __godsEyeView at ${APP_URL}`);
    await sleep(2000);

    // ── i. one IDFM control, not two ───────────────────────────────────────
    console.log('[qa] i. one control');
    const panel = await page.evaluate(() => {
      const text = (node) => (node?.textContent || '').replace(/\s+/g, ' ').trim();
      const chips = [...document.querySelectorAll('#dataLayersPanel .chip, #dataLayersPanel button')]
        .map(text).filter(Boolean);
      return {
        chips,
        registered: [...window.__godsEyeView.dataManager.layers.keys()],
      };
    });
    check('no `Fréquence IDFM` chip anywhere in the panel',
      !panel.chips.some((label) => /Fr[ée]quence\s+IDFM/i.test(label)),
      panel.chips.filter((label) => /Fr[ée]quence/i.test(label)).join(' | '));
    check('and `idfm-frequency` is not a registered layer at all',
      !panel.registered.includes('idfm-frequency'));
    check('`idfm-network` is', panel.registered.includes('idfm-network'));

    // ── ii. the altitude gate does not fetch ───────────────────────────────
    console.log('[qa] ii. altitude gate');
    await setView(page, CITY.lon, CITY.lat, 1_200_000);
    await page.evaluate(() => window.__godsEyeView.dataManager.setEnabled('idfm-network', true));
    await pump(page, 8);
    await sleep(1500);
    const gated = await layerProbe(page);
    check('a country-scale view reports dormant', gated.stats.dormant === true,
      `dormant=${gated.stats.dormant}`);
    check('with nothing rendered', gated.billboards === 0 && gated.discs === 0,
      `${gated.billboards} pictograms, ${gated.discs} discs`);
    check('and the row says how to get the map back',
      /rapprochez-vous/i.test(gated.stats.loadingLabel || ''), gated.stats.loadingLabel);
    await shoot(page, '01-dormant.png');

    // ── iii. one toggle, two marks ─────────────────────────────────────────
    console.log('[qa] iii. both marks from one toggle');
    await setView(page, CITY.lon, CITY.lat, 1_200);
    let drawn = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      await pump(page, 3, 60);
      await sleep(400);
      drawn = await layerProbe(page);
      if (drawn.billboards > 0 && drawn.discs > 0) break;
    }
    check('the referential drew a pictogram per stop', drawn.billboards === 4,
      `${drawn.billboards} pictograms`);
    check('the offer drew a rate disc per profiled stop', drawn.discs === 4,
      `${drawn.discs} discs`);
    check('both upstreams were asked, once each per box',
      referentialRequests >= 1 && offerRequests >= 1,
      `${referentialRequests} referential, ${offerRequests} offer`);
    check('the layer reports the frequency regime it is in',
      drawn.stats.regime === 'arrets', `regime=${drawn.stats.regime}`);
    check('and counts both halves separately',
      drawn.stats.count === 4 && drawn.stats.charted === 4,
      `count=${drawn.stats.count} charted=${drawn.stats.charted}`);
    await shoot(page, '02-both-marks.png');

    // The layer is loaded now, so the page can be asked which URL it loaded it
    // FROM. Everything below reads the layer's own state through that URL, and
    // the identity check turns a whole class of silent wrongness — a second
    // module instance with its own empty maps — into one legible failure.
    MODULE_URLS.layer = (await loadedModuleUrl(page, '/src/data/idfmNetwork.js')) || MODULE_URLS.layer;
    MODULE_URLS.overlay = (await loadedModuleUrl(page, '/src/overlays/worldOverlay.js')) || MODULE_URLS.overlay;
    // Identity is checked on STATE and not on object identity: `main.js`
    // registers a lazy stub per layer, so `layers.get(id).module` is a wrapper
    // and never the raw default export. What has to be true is narrower and
    // more useful — the module reached through this URL is looking at the same
    // drawn records the app just reported.
    const sharedState = await page.evaluate(async (layerUrl) => {
      const module = await import(layerUrl);
      return {
        discs: ['23613', '22154', '23611', '23997']
          .filter((id) => Boolean(module._idfmNetworkRecordForTest(`idfm-freq:${id}`))).length,
        slot: module._idfmNetworkSlotForTest(),
      };
    }, MODULE_URLS.layer);
    check('the harness reads the module instance the app is running',
      sharedState.discs === drawn.stats.charted && sharedState.slot?.band === drawn.stats.band,
      `${sharedState.discs}/${drawn.stats.charted} discs via ${MODULE_URLS.layer}`);

    // ── iv. one click, one card, both halves ───────────────────────────────
    console.log('[qa] iv. the merged card');
    await page.evaluate(() => window.__godsEyeView.dataManager
      .setLayerParams?.('idfm-network', { band: 8 })
      ?? window.__godsEyeView.dataManager.layers.get('idfm-network').module.setParams({ band: 8 }));
    await pump(page, 2);
    const viaPictogram = await cardFor(page, 'idfm:stop:23613');
    const viaDisc = await cardFor(page, 'idfm-freq:23613');
    check('the pictogram reaches both publications',
      viaPictogram?.halves.ref === true && viaPictogram?.halves.freq === true,
      JSON.stringify(viaPictogram?.halves));
    check('and so does the disc on the same coordinate',
      viaDisc?.halves.ref === true && viaDisc?.halves.freq === true,
      JSON.stringify(viaDisc?.halves));
    check('clicking either mark prints the SAME card',
      viaPictogram?.copy === viaDisc?.copy);
    const merged = String(viaPictogram?.copy || '');
    check('the card carries the referential half',
      /Bus · Paris 14e · zone 1 · accessible/.test(merged), merged.split('\n')[1]);
    check('and the hourly half, for the band the row is on',
      /08:00–08:59 — 30 départs\/h/.test(merged),
      merged.split('\n').find((line) => /départs\/h/.test(line)));
    check('and names both licences, because the row now carries two',
      /réseau ODbL 1\.0 · fréquence Licence Ouverte v2\.0/.test(merged));
    check('the card the host was handed is the one that was clicked',
      viaPictogram?.selectedId === 'idfm:stop:23613', String(viaPictogram?.selectedId));
    const painted = await cardPaintRect(page, 'idfm-freq:23613');
    check('and it reaches pixels, not just the entry count',
      Number(painted?.w) > 0 && Number(painted?.h) > 0, JSON.stringify(painted));

    const refOnly = String((await cardFor(page, 'idfm:stop:999001'))?.copy || '');
    check('a referential stop outside the offer says WHICH half is missing',
      /Aucun profil horaire publié/.test(refOnly) && !/départs\/h/.test(refOnly),
      refOnly.split('\n').slice(1).join(' | '));
    const offerOnly = String((await cardFor(page, 'idfm-freq:23997'))?.copy || '');
    check('an offer stop outside the referential quotes the offer’s own mode',
      /Bus · Paris \(75\)/.test(offerOnly) && !/zone 1/.test(offerOnly),
      offerOnly.split('\n')[1]);
    // Back to the stop that has BOTH halves, so the shot is evidence of the
    // merge rather than of one of its edges.
    await cardFor(page, 'idfm:stop:23613');
    await shoot(page, '03-card.png');

    // ── v. the chips repaint, they do not re-fetch ─────────────────────────
    console.log('[qa] v. scrubbing the hour');
    const before = await layerProbe(page);
    const requestsBefore = offerRequests;
    const discLevels = () => page.evaluate(async (layerUrl) => {
      const module = await import(layerUrl);
      return ['23613', '22154', '23611', '23997']
        .map((id) => module._idfmNetworkRecordForTest(`idfm-freq:${id}`)?.style.level ?? null);
    }, MODULE_URLS.layer);
    const stylesBefore = await discLevels();
    await page.evaluate(() => window.__godsEyeView.dataManager.layers
      .get('idfm-network').module.setParams({ band: 25 }));
    await pump(page, 3);
    await sleep(400);
    const stylesAfter = await discLevels();
    const after = await layerProbe(page);
    check('the row offers seven moments, exactly one lit',
      before.controls?.chips.length === 7
      && before.controls.chips.filter((chip) => chip.active).length === 1,
      `${before.controls?.chips.length} chips`);
    check('01 h repaints every disc onto a different rung',
      JSON.stringify(stylesBefore) !== JSON.stringify(stylesAfter),
      `${JSON.stringify(stylesBefore)} → ${JSON.stringify(stylesAfter)}`);
    check('three of the four collapse onto measured silence',
      stylesAfter.filter((level) => level === -1).length === 3,
      JSON.stringify(stylesAfter));
    check('and NOTHING was fetched — the 7 × 24 profile was already here',
      offerRequests === requestsBefore,
      `${offerRequests - requestsBefore} extra request(s)`);
    check('the discs are still all on screen', after.discs === 4, `${after.discs} discs`);
    await shoot(page, '04-night.png');

    // ── vi. between the gates ──────────────────────────────────────────────
    console.log('[qa] vi. between the two gates');
    await setView(page, CITY.lon, CITY.lat, 12_000);
    let wide = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      await pump(page, 3, 60);
      await sleep(400);
      wide = await layerProbe(page);
      if (wide.stats.regime !== 'arrets') break;
    }
    check('the pictograms stay above the frequency gate', wide.billboards === 4,
      `${wide.billboards} pictograms`);
    check('the discs go', wide.discs === 0, `${wide.discs} discs`);
    check('the row says the offer is not read here, with a distance',
      /fréquence à partir/i.test(wide.stats.loadingLabel || ''), wide.stats.loadingLabel);
    const wideCard = String((await cardFor(page, 'idfm:stop:23613'))?.copy || '');
    check('and a card up here says so instead of showing a zero',
      /Offre horaire non lue à cette altitude/.test(wideCard)
      && !/départs\/h/.test(wideCard),
      wideCard.split('\n').slice(1).join(' | '));
    check('DETECT quotes no rate it has not read',
      wide.detectables === 0, `${wide.detectables} callouts`);
    await shoot(page, '05-wide.png');

    // ── console hygiene ────────────────────────────────────────────────────
    const relevant = consoleErrors.filter((entry) => !/favicon|Failed to load resource/i.test(entry));
    check('no console errors from the layer',
      !relevant.some((entry) => /idfm/i.test(entry)),
      relevant.filter((entry) => /idfm/i.test(entry)).join(' | '));

    console.log(`\n[qa] shots → ${path.relative(REPO_ROOT, SHOTS_DIR)}`);
  } finally {
    await browser.close();
  }

  if (failures.length) {
    console.error(`\n[qa] FAILED (${failures.length}):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('\n[qa] PASS');
  }
}

main().catch((error) => {
  console.error('[qa] harness error:', error);
  process.exitCode = 1;
});
