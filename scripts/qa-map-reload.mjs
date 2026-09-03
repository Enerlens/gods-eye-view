#!/usr/bin/env node
/**
 * qa-map-reload — the four session-global knobs behind the 2026-09-03 field
 * report: "the map reloads, jumps from one preset to another, and goes from a
 * sharp render to a blurry one".
 *
 * Nothing here is a pixel comparison. Each of the four causes was a NUMBER left
 * in the wrong state, so each check reads that number:
 *
 *  A. IMAGERY CONSTRUCTIONS PER PAGE LOAD. `_activateGlobeStack()` destroys and
 *     rebuilds every `Cesium.ImageryLayer`, so a second activation is a visible
 *     coarse→sharp reload of a basemap that did not change. A `#map=` link used
 *     to cost two (the build default, then the requested stack). Target: the
 *     stack's own layer count and not one more — 1 for OSM, 2 for the IGN pair.
 *
 *  B. `globe.maximumScreenSpaceError` AFTER A CANCELLED FLIGHT. The detail
 *     governor doubles it on `moveStart` and restores it on `moveEnd`; a flight
 *     cancelled in between left the globe pinned at the coarse value for the
 *     rest of the session. Target: back to the settled value, with the stall
 *     guard having fired.
 *
 *  C. `camera.percentageChanged` AFTER A LAYER IS TURNED OFF. Eleven layers
 *     lowered this shared global to 0.05 on enable and never restored it, so one
 *     activation of Transports en commun degraded every OTHER viewport-driven
 *     layer for the session. Target: 0.05 while the layer is on, the app's own
 *     baseline once it is off, and an empty claim set.
 *
 *  D. THE MAP SOURCE CHIP NAMES A FAILED PHOTOREAL BOOT. A basemap that is not
 *     the one the app asked for has to say so. Only checked when this build
 *     actually has a Google key and it actually failed; a keyless build is
 *     configured, not broken, and is reported as N/A.
 *
 * Usage: node scripts/qa-map-reload.mjs [--url http://localhost:4216]
 *        node scripts/qa-map-reload.mjs --url https://gev.enerlens.com --map ign-plan
 */
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const argv = process.argv;
const arg = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const baseUrl = arg('--url', 'http://localhost:4216');
/** The stack the share link asks for. Plan IGN is the one the report was filed on. */
const mapStack = arg('--map', 'ign-plan');
/** Paris, so the IGN stacks have tiles to serve. */
const SHARE_HASH = `#lat=48.8566&lon=2.3522&alt=4000&heading=0&pitch=-35&map=${mapStack}`;
const TRANSIT_LAYER_ID = 'transit-fr';
/** Layers whose imagery composition the target depends on. */
const EXPECTED_BUILDS = { 'ign-plan': 2, 'ign-ortho': 2 };

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  const mark = ok === null ? '–' : (ok ? '✓' : '✗');
  console.log(`  ${mark} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await puppeteer.launch({
  headless: 'new',
  protocolTimeout: 300_000,
  args: [
    '--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
  ],
});

try {
  const page = await newQaPage(browser);
  await page.setViewport({ width: 1440, height: 860 });
  await page.goto(`${baseUrl}/${SHARE_HASH}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__godsEyeView?.viewer, { timeout: 90_000 });
  // The share restore is deliberately deferred 1.5 s; wait well past it, since
  // the whole point of check A is what that deferred restore does NOT rebuild.
  await new Promise((r) => setTimeout(r, 12_000));

  // ── A. one imagery construction per page load ────────────────────────────
  const imagery = await page.evaluate(() => {
    const controller = window.__godsEyeView.mapStackController;
    return {
      builds: controller.getImageryBuildCount?.() ?? null,
      activeId: controller.getActiveId(),
      live: window.__godsEyeView.viewer.imageryLayers.length,
    };
  });
  const expectedBuilds = EXPECTED_BUILDS[mapStack] ?? 1;
  record(
    `A. imagery constructions for #map=${mapStack}`,
    imagery.builds === expectedBuilds && imagery.activeId === mapStack,
    `built ${imagery.builds} (target ${expectedBuilds}), live ${imagery.live}, active ${imagery.activeId}`,
  );

  // ── B. a cancelled flight does not strand the coarse tolerance ────────────
  //
  // The GUARD ITSELF is pinned deterministically in
  // `src/globeDetailGovernor.test.mjs`; what a browser can add is the end-to-end
  // invariant, on the real path that produced the report — a fly-to cancelled
  // mid-air, which is what the share-link restore does. Whether the settled
  // value comes back from the stall guard or from a `moveEnd` the app raised
  // later is reported, not asserted: either way the globe must not be left soft,
  // and only the "left soft" outcome is a failure.
  const flying = await page.evaluate(() => {
    const gev = window.__godsEyeView;
    const before = gev.getGlobeDetailDiagnostics?.() ?? null;
    const ell = gev.viewer.scene.globe.ellipsoid;
    gev.viewer.camera.flyTo({
      destination: ell.cartographicToCartesian({
        longitude: 4.85 * Math.PI / 180, latitude: 45.75 * Math.PI / 180, height: 900_000,
      }),
      duration: 20,
    });
    return { settledSse: before?.settledSse ?? null, recoveriesBefore: before?.stallRecoveries ?? 0 };
  });
  await new Promise((r) => setTimeout(r, 1_200));
  const cancelled = await page.evaluate(() => {
    const gev = window.__godsEyeView;
    const midFlight = gev.viewer.scene.globe.maximumScreenSpaceError;
    gev.viewer.camera.cancelFlight();
    return { midFlight, armed: gev.getGlobeDetailDiagnostics?.()?.stallGuardArmed ?? null };
  });
  // Two full stall-guard intervals: one to sample the pose, one to find it unchanged.
  await new Promise((r) => setTimeout(r, 6_000));
  const recovered = await page.evaluate(() => {
    const gev = window.__godsEyeView;
    return {
      sse: gev.viewer.scene.globe.maximumScreenSpaceError,
      diagnostics: gev.getGlobeDetailDiagnostics?.() ?? null,
    };
  });
  const byGuard = (recovered.diagnostics?.stallRecoveries ?? 0) > flying.recoveriesBefore;
  record(
    'B. a cancelled flight never strands the coarse tolerance',
    flying.settledSse !== null && recovered.sse === flying.settledSse,
    `settled ${flying.settledSse} → mid-flight ${cancelled.midFlight} (guard armed ${cancelled.armed})`
      + ` → after cancel ${recovered.sse}, recovered by ${byGuard ? 'the stall guard' : 'a later moveEnd'}`,
  );

  // ── C. the camera's change threshold is given back ───────────────────────
  const baseline = await page.evaluate(() => window.__godsEyeView.viewer.camera.percentageChanged);
  const enabled = await page.evaluate(async (layerId) => {
    const gev = window.__godsEyeView;
    try { await gev.dataManager.setEnabled(layerId, true, { origin: 'user' }); } catch { /* probe */ }
    return {
      percentageChanged: gev.viewer.camera.percentageChanged,
      diagnostics: gev.getCameraSensitivityDiagnostics?.() ?? null,
    };
  }, TRANSIT_LAYER_ID);
  await new Promise((r) => setTimeout(r, 4_000));
  const disabled = await page.evaluate(async (layerId) => {
    const gev = window.__godsEyeView;
    try { await gev.dataManager.setEnabled(layerId, false, { origin: 'user' }); } catch { /* probe */ }
    return {
      percentageChanged: gev.viewer.camera.percentageChanged,
      diagnostics: gev.getCameraSensitivityDiagnostics?.() ?? null,
    };
  }, TRANSIT_LAYER_ID);
  record(
    'C. camera.percentageChanged returns to its baseline',
    enabled.percentageChanged === 0.05
      && disabled.percentageChanged === baseline
      && (disabled.diagnostics?.owners?.length ?? -1) === 0,
    `baseline ${baseline} → layer on ${enabled.percentageChanged}`
      + ` (owners ${JSON.stringify(enabled.diagnostics?.owners ?? null)})`
      + ` → layer off ${disabled.percentageChanged}`
      + ` (owners ${JSON.stringify(disabled.diagnostics?.owners ?? null)})`,
  );

  // ── D. a degraded basemap says so ────────────────────────────────────────
  const source = await page.evaluate(() => {
    const state = window.__godsEyeView.mapStackController.getState();
    const chip = document.getElementById('map-stack-status');
    return {
      notice: state.notice || null,
      photorealAvailable: state.stacks.find((stack) => stack.id === 'photoreal')?.available === true,
      photorealReason: state.stacks.find((stack) => stack.id === 'photoreal')?.unavailableReason || null,
      chipWarn: chip ? chip.classList.contains('warn') : null,
      chipTitle: chip ? chip.title : null,
    };
  });
  if (source.photorealAvailable) {
    record('D. photoreal loaded — nothing to report', null, 'Google 3D Tiles are on the globe');
  } else if (!source.notice) {
    record('D. photoreal unavailable by configuration', null, source.photorealReason || 'no key');
  } else {
    record(
      'D. a failed photoreal boot is named on the source chip',
      source.chipWarn === true && !!source.chipTitle,
      `${source.notice} | chip warn=${source.chipWarn}`,
    );
  }

  const failed = results.filter((entry) => entry.ok === false);
  const graded = results.filter((entry) => entry.ok !== null);
  console.log(`\n${graded.length - failed.length}/${graded.length} checks passed`);
  if (failed.length) process.exitCode = 1;
} finally {
  await browser.close();
}
