#!/usr/bin/env node
/**
 * Deterministic browser proof for the view gate: turning on a layer that only
 * answers for a close camera, from a camera that is nowhere near close enough.
 *
 * The bug this harness exists to keep dead: from a continental view of France,
 * enabling `bdtopo-buildings` used to return false out of the layer's first
 * `update()` — a load that fetched nothing because the box was too wide. The
 * manager reads false as the module REJECTING its lifecycle, so it tore the
 * layer straight back down, flipped the toggle to OFF and toasted
 * "bdtopo-buildings could not start cleanly". A perfectly healthy layer, an
 * error message, and nothing on screen.
 *
 * What it proves, in order:
 *   1. from orbit, an explicit enable FLIES the camera in and draws buildings;
 *   2. no failure event and no failure toast are published along the way;
 *   3. the layer settles ON, with real counts behind it;
 *   4. a non-explicit origin (a share link, a Context restore) keeps its own
 *      camera — the gate is for the operator who just asked, nobody else;
 *   5. the same gate on the mapped grid, whose ceiling is ten times wider;
 *   6. off coverage still refuses to fly: no altitude makes Berlin French.
 *
 * Same two workarounds as the other layer harnesses: every wait polls on an
 * interval (the render governor can starve rAF), and every teleport is followed
 * by an explicit refresh (`camera.setView` fires no `moveEnd`).
 *
 * Run: node scripts/qa-view-gate.mjs --url http://localhost:5173
 */
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const argUrl = process.argv.indexOf('--url');
const URL_BASE = argUrl >= 0 ? process.argv[argUrl + 1] : 'http://localhost:5173';

/** A continental view of France: in coverage, far too wide for either layer. */
const FRANCE_WIDE = { lon: 4.8237, lat: 45.7605, height: 420_000, pitch: -90 };
/**
 * Northern Germany, equally wide. BD TOPO has nothing there — and at this
 * altitude the eastern edge of France can clip into shot, which is exactly the
 * case the focus rule refuses to fly for: the operator is looking at Berlin.
 */
const GERMANY_WIDE = { lon: 13.4, lat: 52.5, height: 420_000, pitch: -90 };

const failures = [];
const check = (ok, label, detail = '') => {
  if (ok) console.log(`  ✔ ${label}`);
  else { failures.push(`${label}${detail ? ` — ${detail}` : ''}`); console.log(`  ✖ ${label} ${detail}`); }
};
const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  await page.setViewport({ width: 1440, height: 860 });

  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

  await page.goto(URL_BASE, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(() => !!window.__godsEyeView?.viewer, { polling: 250, timeout: 120_000 });
  } catch {
    console.error(`[qa] the app never finished booting at ${URL_BASE}`);
    console.error(`[qa] console errors: ${consoleErrors.slice(0, 5).join(' | ') || '(none)'}`);
    throw new Error('app did not boot');
  }
  await settle(10_000);

  // The keyless globe stack: on Google 3D the photoreal mesh already contains
  // these buildings and the layer hides itself on purpose.
  await page.evaluate(async () => {
    await window.__godsEyeView.mapStackController?.setStack?.('osm');
  });
  await settle(4_000);

  /** Record every lifecycle failure the manager publishes, for the whole run. */
  await page.evaluate(() => {
    window.__gevGateEvents = [];
    window.__godsEyeView.dataManager.subscribe((event) => {
      if (['visibility-failed', 'visibility-blocked', 'refresh-failed'].includes(event.type)) {
        window.__gevGateEvents.push({
          type: event.type,
          layerId: event.layerId,
          error: String(event.error?.message || event.reason || ''),
        });
      }
    });
  });

  const goTo = async (site) => {
    await page.evaluate((target) => {
      const viewer = window.__godsEyeView.viewer;
      viewer.camera.cancelFlight();
      viewer.camera.setView({
        destination: viewer.scene.globe.ellipsoid.cartographicToCartesian({
          longitude: (target.lon * Math.PI) / 180,
          latitude: (target.lat * Math.PI) / 180,
          height: target.height,
        }),
        orientation: { heading: 0, pitch: (target.pitch * Math.PI) / 180, roll: 0 },
      });
    }, site);
    await settle(2_000);
  };

  const cameraHeightM = () => page.evaluate(
    () => window.__godsEyeView.viewer.camera.positionCartographic.height,
  );
  const layerState = (layerId) => page.evaluate((id) => {
    const entry = window.__godsEyeView.dataManager.layers.get(id);
    return {
      enabled: window.__godsEyeView.dataManager.isEnabled(id),
      lifecycleState: entry?.lifecycleState || null,
      managerRefreshError: entry?.managerRefreshError || null,
      stats: entry?.module?.getStats?.() || null,
    };
  }, layerId);
  const setEnabled = (layerId, enabled, origin) => page.evaluate(
    (id, value, from) => window.__godsEyeView.dataManager.setEnabled(id, value, { origin: from }),
    layerId, enabled, origin,
  );
  const toastText = () => page.evaluate(() => document.getElementById('toast')?.textContent || '');
  const gateEvents = () => page.evaluate(() => window.__gevGateEvents.slice());

  // ── 1. Bâti 3D, turned on from orbit ─────────────────────────────────────
  console.log('\n[qa] Bâti 3D — enabled from a continental view of France');
  await goTo(FRANCE_WIDE);
  const before = await cameraHeightM();
  const accepted = await setEnabled('bdtopo-buildings', true, 'user');
  check(accepted === true, 'the enable settles as accepted', `returned ${accepted}`);
  await settle(12_000);

  const after = await cameraHeightM();
  const bdtopo = await layerState('bdtopo-buildings');
  check(after < before / 10, 'the camera was flown in, not asked to move',
    `${Math.round(before)} m → ${Math.round(after)} m`);
  check(bdtopo.enabled === true, 'the layer settles ON');
  check(bdtopo.lifecycleState === 'enabled', 'and settled, not stuck ENABLING',
    String(bdtopo.lifecycleState));
  check(!bdtopo.managerRefreshError, 'with no manager-side refresh error',
    String(bdtopo.managerRefreshError));
  check(!bdtopo.stats?.error, 'and no layer error', String(bdtopo.stats?.error));
  check((bdtopo.stats?.count || 0) > 100, 'buildings are actually drawn',
    `count=${bdtopo.stats?.count}`);

  const events = await gateEvents();
  check(events.length === 0, 'no lifecycle failure was published at all',
    JSON.stringify(events.slice(0, 3)));
  const toast = await toastText();
  check(!/could not start/i.test(toast), 'and nothing was toasted about it', toast);

  // ── 2. a restored camera is left alone ───────────────────────────────────
  console.log('\n[qa] a share-link restore keeps its own camera');
  await setEnabled('bdtopo-buildings', false, 'user');
  await settle(1_500);
  await goTo(FRANCE_WIDE);
  const restoreBefore = await cameraHeightM();
  const restored = await setEnabled('bdtopo-buildings', true, 'share');
  await settle(6_000);
  const restoreAfter = await cameraHeightM();
  const shared = await layerState('bdtopo-buildings');
  check(restored === true, 'the restore settles as accepted', `returned ${restored}`);
  check(Math.abs(restoreAfter - restoreBefore) < 1_000, 'the camera did not move',
    `${Math.round(restoreBefore)} m → ${Math.round(restoreAfter)} m`);
  check(shared.enabled === true, 'and the layer is ON with its own guidance',
    JSON.stringify(shared.stats?.loadingLabel || ''));
  check(!shared.managerRefreshError, 'still with no refresh error',
    String(shared.managerRefreshError));
  await setEnabled('bdtopo-buildings', false, 'user');
  await settle(1_000);

  // ── 3. the same gate, ten times wider: the mapped grid ───────────────────
  console.log('\n[qa] Power Grid — the same gate at a different ceiling');
  await goTo(FRANCE_WIDE);
  const gridBefore = await cameraHeightM();
  const gridAccepted = await setEnabled('power-grid', true, 'user');
  await settle(15_000);
  const gridAfter = await cameraHeightM();
  const grid = await layerState('power-grid');
  check(gridAccepted === true, 'the enable settles as accepted', `returned ${gridAccepted}`);
  check(gridAfter < gridBefore / 5, 'the camera was flown in',
    `${Math.round(gridBefore)} m → ${Math.round(gridAfter)} m`);
  check(grid.enabled === true, 'the layer settles ON');
  check(grid.stats?.status !== 'zoom-in', 'and is past its own zoom gate',
    String(grid.stats?.status));
  await setEnabled('power-grid', false, 'user');
  await settle(1_000);

  // ── 4. off coverage never flies ──────────────────────────────────────────
  console.log('\n[qa] Berlin — off coverage, and no altitude changes that');
  await goTo(GERMANY_WIDE);
  const berlinBefore = await cameraHeightM();
  const berlinAccepted = await setEnabled('bdtopo-buildings', true, 'user');
  await settle(6_000);
  const berlinAfter = await cameraHeightM();
  const berlin = await layerState('bdtopo-buildings');
  check(berlinAccepted === true, 'the enable still settles as accepted',
    `returned ${berlinAccepted}`);
  check(Math.abs(berlinAfter - berlinBefore) < 1_000, 'the camera stays over Berlin',
    `${Math.round(berlinBefore)} m → ${Math.round(berlinAfter)} m`);
  check(berlin.enabled === true, 'the layer is ON');
  check(/couverture|Zoome/i.test(berlin.stats?.loadingLabel || ''),
    'saying what it needs instead of flying somewhere nobody asked for',
    String(berlin.stats?.loadingLabel));
  check(!berlin.stats?.error, 'which is guidance, not an error',
    String(berlin.stats?.error));

  const finalEvents = await gateEvents();
  check(finalEvents.length === 0, 'no lifecycle failure across the whole run',
    JSON.stringify(finalEvents.slice(0, 3)));
  const relevant = consoleErrors.filter((text) => /bdtopo|power-grid|view gate/i.test(text));
  check(relevant.length === 0, 'no console errors from the gated layers',
    relevant.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\n[qa] view-gate: ${failures.length} check(s) failed`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('\n[qa] view-gate: all checks passed');
