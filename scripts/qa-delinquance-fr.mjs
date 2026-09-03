#!/usr/bin/env node
/**
 * qa-delinquance-fr.mjs — browser proof for the SSMSI recorded-crime layer's
 * two most recent changes, both of which are about what a reader can READ.
 *
 * ── 1. The card that covered the screen, and the card that vanished ─────────
 * This layer quotes its publisher verbatim — the suppression rule, the
 * reporting-rate sentence — and card width used to be "as wide as the longest
 * line", with no ceiling and no wrap. The SSMSI reporting-rate quote alone
 * measures ~1 900 px, so a clicked commune produced a card that spanned the
 * whole viewport (reported 2026-09-02 on the Gironde). Worse, and reported in
 * the same breath from around Aubazine in the Corrèze: once a card is wider
 * than the screen the placement clamp pins it to the margin, which drags its
 * CENTRE away from its anchor — and the keyhole fade reads the centre. Outside
 * the scope circle every entry is painted at `KEYHOLE_OUTSIDE_OPACITY_DEFAULT`,
 * 0.01, so the same overflow that made one card too big made the next one
 * invisible. Both symptoms, one cause, and this harness measures the cause:
 * **the painted rectangle**.
 *
 * ── 2. The total, so no reader has to pick an offence first ────────────────
 * The layer now opens on a computed all-offences total. It is GEV's arithmetic
 * and not the register's, so the harness checks that the card SAYS so, that it
 * calls itself a minorant where the register withholds a contributor, and that
 * a commune with nothing published is drawn slate rather than quiet.
 *
 * What it proves, in order:
 *   1. the layer registers, opens on the total, and the chip row leads with it;
 *   2. a clicked DÉPARTEMENT card fits inside the card ceiling and the viewport;
 *   3. at commune scale over the Corrèze, a clicked commune card does too —
 *      including Aubazine, whose fourteen contributors are ten withheld and
 *      four zeros, the exact shape that used to produce the longest card;
 *   4. every painted card's centre stays inside the keyhole, so nothing is
 *      painted at the outside-opacity floor;
 *   5. switching to a per-offence chip still works, and switching back does.
 *
 * Screenshots land in the gitignored `qa-shots/delinquance-fr/`.
 *
 * Run: node scripts/qa-delinquance-fr.mjs --url http://localhost:5290
 */
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newQaPage } from './lib/qa-first-run.mjs';
import { WORLD_OVERLAY_STYLE } from '../src/overlays/worldOverlayTokens.js';
import { KEYHOLE_OUTER_RADIUS } from '../src/celestialRing.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'delinquance-fr');
const LAYER_ID = 'delinquance-fr';
const OVERLAY_SOURCE = 'delinquance-fr-selected';

const argUrl = process.argv.indexOf('--url');
const URL_BASE = argUrl >= 0 ? process.argv[argUrl + 1] : 'http://localhost:5290';
const VIEWPORT = { width: 1440, height: 860 };

/** All of metropolitan France: the département regime, where the total is exact. */
const FRANCE = { lon: 2.6, lat: 46.6, height: 1_500_000 };
/**
 * Aubazine, Corrèze. Reported as the case where the card was unreadable, and
 * measured on the live 2025 edition as the worst shape for card length: of its
 * fourteen contributing indicators, **ten are withheld and four are published
 * zeros**, so the total is suppressed and the card carries the suppression
 * rule verbatim on top of everything else it already says.
 */
const AUBAZINE = { lon: 1.6733, lat: 45.1725, height: 26_000 };

/**
 * Upstreams this workspace cannot reach and the layer does not need:
 * Photorealistic 3D Tiles (the key is EEA-blocked, 403) and the HUD summary
 * (no OpenAI key, 503). Everything else that 4xx/5xx is a real failure.
 */
const KEYLESS_UPSTREAMS = /tile\.googleapis\.com|\/api\/openai\//;

const failures = [];
const check = (ok, label, detail = '') => {
  if (ok) console.log(`  ✔ ${label}`);
  else { failures.push(`${label}${detail ? ` — ${detail}` : ''}`); console.log(`  ✖ ${label} ${detail}`); }
};
const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

mkdirSync(SHOTS_DIR, { recursive: true });

const browser = await puppeteer.launch({
  headless: 'new',
  protocolTimeout: 300_000,
  args: [
    '--use-gl=angle',
    '--use-angle=metal',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
  ],
});

try {
  const page = await newQaPage(browser);
  await page.setViewport(VIEWPORT);

  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
  const badResponses = [];
  page.on('response', (response) => {
    if (response.status() >= 400) badResponses.push({ status: response.status(), url: response.url() });
  });

  await page.goto(URL_BASE, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(() => !!window.__godsEyeView?.viewer, { polling: 250, timeout: 120_000 });
  } catch {
    const loader = await page.evaluate(() => document.getElementById('loading-screen')?.innerText || '(no loader)');
    console.error(`[qa] the app never finished booting at ${URL_BASE}`);
    console.error(`[qa] loader said: ${loader.replace(/\s+/g, ' ').slice(0, 200)}`);
    throw new Error('app did not boot');
  }
  await settle(8_000);

  const waitForApp = () => page.waitForFunction(
    () => !!window.__godsEyeView?.dataManager,
    { polling: 250, timeout: 120_000 },
  );

  /** Teleport, then ask the layer to reload — `setView` fires no `moveEnd`. */
  const goTo = async (site, wait = 20_000) => {
    await waitForApp();
    await page.evaluate((target) => {
      const viewer = window.__godsEyeView.viewer;
      viewer.camera.cancelFlight();
      viewer.camera.setView({
        destination: viewer.scene.globe.ellipsoid.cartographicToCartesian({
          longitude: (target.lon * Math.PI) / 180,
          latitude: (target.lat * Math.PI) / 180,
          height: target.height,
        }),
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
      });
    }, site);
    await settle(2_000);
    await page.evaluate(
      (layerId) => window.__godsEyeView.dataManager.layers.get(layerId)?.module?.update?.(),
      LAYER_ID,
    );
    await settle(wait);
  };

  const layerCall = (method, ...args) => page.evaluate((id, name, params) => {
    const module = window.__godsEyeView.dataManager.layers.get(id)?.module;
    return module?.[name]?.(...params) ?? null;
  }, LAYER_ID, method, args);

  /** Pump a frame, then read back where the host actually painted the card. */
  const paintedCard = (entryId) => page.evaluate(async (source, id) => {
    window.__godsEyeView.viewer.scene.render();
    const rect = window.__gevWorldOverlay?.getPaintRect?.(source, id);
    if (!rect) return null;
    return { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
  }, OVERLAY_SOURCE, entryId);

  /**
   * Click the canvas and report which overlay entry that click should select.
   *
   * A real pointer click, and not an `import()` of the layer module: the dev
   * server serves an invalidated module under a `?t=` query, so importing it
   * from the page yields a SECOND instance with empty state and a selection
   * that silently does nothing. What Cesium picks under the cursor is also
   * exactly what the layer's own handler picks, so the id is derived from the
   * same pick rather than guessed.
   *
   * `page.mouse.click` needs a layout round trip that starves under
   * SwiftShader; Cesium listens for pointer events on the canvas.
   */
  const clickAt = (x, y) => page.evaluate((cx, cy) => {
    const viewer = window.__godsEyeView?.viewer;
    const canvas = viewer?.scene?.canvas;
    if (!canvas) return null;
    const picked = viewer.scene.pick({ x: cx, y: cy });
    let entryId = null;
    if (typeof picked?.id === 'string') entryId = picked.id;
    else {
      const code = picked?.id?.properties?.code?.getValue?.();
      if (code) entryId = `dep:${String(code).trim()}`;
    }
    const box = canvas.getBoundingClientRect();
    const common = {
      bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: 'mouse',
      isPrimary: true, button: 0, buttons: 1,
      clientX: box.left + cx, clientY: box.top + cy,
    };
    canvas.dispatchEvent(new PointerEvent('pointerdown', common));
    canvas.dispatchEvent(new PointerEvent('pointerup', { ...common, buttons: 0 }));
    viewer.scene.render();
    return entryId;
  }, x, y);

  /** Poll for the card's rectangle, pumping frames — the governor renders on demand. */
  const waitForCard = async (entryId, tries = 20) => {
    for (let i = 0; i < tries; i += 1) {
      const rect = await paintedCard(entryId);
      if (rect) return rect;
      await settle(300);
    }
    return null;
  };

  const shoot = async (name) => {
    try {
      await page.screenshot({ path: path.join(SHOTS_DIR, name) });
    } catch (error) {
      console.log(`  – screenshot ${name} skipped (${error?.message || error})`);
    }
  };

  // --- 1. The layer opens on the total --------------------------------------
  console.log('\ni. the layer opens on the computed total');
  await page.evaluate(
    (layerId) => window.__godsEyeView.dataManager.setEnabled(layerId, true, { origin: 'user' }),
    LAYER_ID,
  );
  await goTo(FRANCE, 25_000);
  // A cold machine has to build the national fold first: the commune base is
  // 39.9 MB gzipped and the proxy streams all 5.24 million rows before it can
  // answer. That is minutes, once, and it is not a failure — so the layer is
  // given time to say `ok` rather than being asserted against mid-build.
  for (let i = 0; i < 40; i += 1) {
    const stats = await layerCall('getStats');
    if (stats?.status === 'ok') break;
    if (i === 0) console.log(`  … waiting for the SSMSI base (${stats?.loadingLabel || stats?.status})`);
    await settle(15_000);
    await layerCall('update');
  }

  const params = await layerCall('getParams');
  check(params?.indicator === 'tous', 'the default indicator is the computed total',
    `indicator=${params?.indicator}`);
  const controls = await layerCall('getRowControls');
  check(controls?.chips?.[0]?.id === 'tous', 'the chip row leads with it',
    `first=${controls?.chips?.[0]?.id}`);
  check(controls?.chips?.length === 7, 'the six derived chips still follow it',
    `chips=${controls?.chips?.length}`);
  check(/pas publié par le SSMSI/.test(controls?.chips?.[0]?.title || ''),
    'and the chip says whose arithmetic the total is');
  const summary = await layerCall('getNationalSummary');
  check((summary?.painted || 0) >= 90, 'the national choropleth paints on the total',
    `painted=${summary?.painted}`);
  await shoot('01-france-total.png');

  // --- 2. A département card fits ------------------------------------------
  console.log('\nii. a département card fits the ceiling and the viewport');
  const depEntry = await clickAt(VIEWPORT.width / 2, VIEWPORT.height / 2);
  check(/^dep:/.test(depEntry || ''), 'a click on the choropleth selects a département',
    `entry=${depEntry}`);
  const depRect = depEntry ? await waitForCard(depEntry) : null;
  check(!!depRect, 'the card is painted');
  if (depRect) {
    check(depRect.w <= WORLD_OVERLAY_STYLE.cardMaxWidth,
      `the card obeys the ${WORLD_OVERLAY_STYLE.cardMaxWidth}px ceiling`, `w=${depRect.w}`);
    check(depRect.x >= 0 && depRect.x + depRect.w <= VIEWPORT.width,
      'and stays inside the viewport', `x=${depRect.x} w=${depRect.w}`);
  }
  await shoot('02-departement-card.png');

  // --- 3. Commune scale, over the Corrèze -----------------------------------
  console.log('\niii. Aubazine — the card that could not be read');
  await goTo(AUBAZINE, 30_000);
  const communes = await page.evaluate((layerId) => {
    const module = window.__godsEyeView.dataManager.layers.get(layerId)?.module;
    const stats = module?.getStats?.() || {};
    return { count: stats.count || 0, status: stats.status };
  }, LAYER_ID);
  check(communes.count > 0, 'the commune regime drew its contours', JSON.stringify(communes));

  const keyhole = {
    centerX: VIEWPORT.width / 2,
    centerY: VIEWPORT.height / 2,
    radius: (VIEWPORT.height / 2) * KEYHOLE_OUTER_RADIUS,
  };
  // Aubazine sits under the camera; the other two aim at its neighbours, so a
  // single unlucky pick cannot pass the section on its own.
  const targets = [
    [VIEWPORT.width / 2, VIEWPORT.height / 2],
    [VIEWPORT.width / 2 - 220, VIEWPORT.height / 2 - 90],
    [VIEWPORT.width / 2 + 210, VIEWPORT.height / 2 + 110],
  ];
  let measured = 0;
  for (const [x, y] of targets) {
    const entryId = await clickAt(x, y);
    if (!/^delinquance-fr:com:/.test(entryId || '')) continue;
    const rect = await waitForCard(entryId);
    if (!rect) continue;
    const code = entryId.split(':').pop();
    measured += 1;
    check(rect.w <= WORLD_OVERLAY_STYLE.cardMaxWidth,
      `${code} obeys the card ceiling`, `w=${rect.w}`);
    check(rect.x >= 0 && rect.x + rect.w <= VIEWPORT.width,
      `${code} stays inside the viewport`, `x=${rect.x} w=${rect.w}`);
    // The regression that made a card invisible: an over-wide card is clamped
    // to the margin, its centre leaves the scope circle, and the keyhole fade
    // paints it at 0.01. A card that fits keeps its centre near its anchor.
    const dx = rect.x + rect.w / 2 - keyhole.centerX;
    const dy = rect.y + rect.h / 2 - keyhole.centerY;
    check(Math.sqrt(dx * dx + dy * dy) <= keyhole.radius,
      `${code} is painted inside the keyhole, not at the fade floor`,
      `d=${Math.round(Math.sqrt(dx * dx + dy * dy))} r=${Math.round(keyhole.radius)}`);
    if (measured === 1) await shoot('03-aubazine-card.png');
  }
  check(measured > 0, 'at least one commune card was measured', `measured=${measured}`);

  // --- 4. The chips still narrow -------------------------------------------
  console.log('\niv. a per-offence chip still narrows the map');
  await layerCall('setParams', { indicator: 'cambriolages' });
  await settle(6_000);
  const narrowed = await layerCall('getParams');
  check(narrowed?.indicator === 'cambriolages', 'a chip selects its indicator',
    `indicator=${narrowed?.indicator}`);
  await shoot('04-cambriolages.png');
  await layerCall('setParams', { indicator: 'tous' });
  await settle(6_000);
  const back = await layerCall('getParams');
  check(back?.indicator === 'tous', 'and the total is reachable again',
    `indicator=${back?.indicator}`);
  await shoot('05-back-to-total.png');

  // A console error here is almost always a failed request, and two of those
  // are the workspace rather than the layer — both reproduced on a clean boot
  // before this harness touched anything. So the responses are judged by URL
  // instead of by the console's own opaque "Failed to load resource" text.
  const unexpected = badResponses.filter(({ url }) => !KEYLESS_UPSTREAMS.test(url));
  check(unexpected.length === 0, 'every request the layer needs succeeded',
    unexpected.slice(0, 3).map((entry) => `${entry.status} ${entry.url}`).join(' | '));
  const scriptErrors = consoleErrors.filter((text) => !/Failed to load resource|favicon/.test(text));
  check(scriptErrors.length === 0, 'no script errors', scriptErrors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}

console.log(`\n${failures.length ? `✖ ${failures.length} failure(s)` : '✔ all checks passed'}`);
for (const failure of failures) console.log(`   ${failure}`);
process.exit(failures.length ? 1 : 0);
