#!/usr/bin/env node
/**
 * Browser proof that picking a mission on the globe puts its readout on
 * screen — the thing no unit test can see.
 *
 * The bug this locks down: `#space-mission-panel` is painted inside the
 * Context panel's SPACE MISSIONS view, so a pick that only SELECTS fills a
 * node behind up to two closed doors. The unit suite can prove the policy said
 * "reveal"; only a real page can prove the readout ended up with a box, on
 * screen, and owning its own pixels. Both resting states are exercised,
 * because they fail differently and the second is the common one:
 *
 *   i.  the operator turned Space Missions on from DATA LAYERS. The mode was
 *       adopted, so the view is already the visible one — but the panel rests
 *       COLLAPSED, so the readout has no box at all.
 *   ii. the operator reloaded (or opened a share link). The layer comes back
 *       on with an origin the Context entry funnel deliberately refuses, so
 *       the mode was never adopted: the view is HIDDEN as well. Missions are
 *       drawn, clickable and rostered while the panel still offers SPACE
 *       MISSIONS as though it were not already running.
 *
 * And the property that keeps the fix honest: adoption is not a Context
 * ENTRY. A layer the operator had on before the pick — `local-firms` here —
 * must still be on after it, and still on after the mode is toggled back off.
 * If a rocket click ever starts clearing the layer set, this fails.
 *
 * Two habits this harness cannot do without, both learned the hard way:
 * `page.click()` and `page.screenshot()` hang on this app, so the pick is
 * dispatched through the DOM; and `newQaPage` supplies both the first-run
 * suppression and a timer-based `waitForFunction`, because the render governor
 * parks rAF on purpose.
 *
 * Run: node scripts/qa-mission-reveal.mjs --url http://localhost:4173
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = option('--url', process.env.QA_BASE_URL || 'http://localhost:4173');
const HEADFUL = args.includes('--headful');

/**
 * Installed Chrome BEFORE puppeteer's bundled Chrome for Testing, which is
 * the reverse of the rest of the fleet and the one deviation worth explaining.
 *
 * Measured 2026-09-10: on Chrome for Testing 145 driving SwiftShader,
 * `scene.drillPick` over a launch pad returns the globe surface and nothing
 * else — 23 pads on screen, 0 picked — while the same page, camera and code
 * on installed Chrome 3D-picks 15 of them. This harness exists to exercise a
 * CLICK on a pad, and the app's own handler drill-picks too, so on that binary
 * the gesture cannot be performed at all. `entityPickReach` below reports
 * that as a skip rather than letting it read as a broken reveal.
 */
const chrome = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  (() => { try { return puppeteer.executablePath(); } catch { return null; } })(),
].filter(Boolean).find((candidate) => {
  try { return fs.existsSync(candidate); } catch { return false; }
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];
let skipped = 0;

function check(label, condition, detail = '') {
  const ok = Boolean(condition);
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`);
  return ok;
}

/**
 * What the operator can actually see, read off the live DOM.
 *
 * `readoutOwnsItsPixels` is the assertion that matters and the only one the
 * bug could not fake: `elementFromPoint` inside the readout's own box has to
 * come back as the readout. A populated node inside a collapsed panel has a
 * filled title and a zero box, and every softer check passes on it.
 */
function surfaceState() {
  const panel = document.getElementById('global-context-panel');
  const readout = document.getElementById('space-mission-panel');
  const box = readout?.getBoundingClientRect();
  const onScreen = Boolean(box && box.width > 4 && box.height > 4
    && box.right > 0 && box.left < window.innerWidth
    && box.bottom > 0 && box.top < window.innerHeight);
  const probe = onScreen
    ? document.elementFromPoint(
      Math.round(box.left + box.width / 2),
      Math.round(box.top + Math.min(24, box.height / 2)),
    )
    : null;
  return {
    contextMode: panel?.getAttribute('data-context-mode') || null,
    panelCollapsed: Boolean(panel?.classList.contains('collapsed')),
    missionsViewHidden: Boolean(document.getElementById('context-missions-view')?.hidden),
    missionsTabSelected: document.getElementById('global-context-missions-btn')
      ?.getAttribute('aria-selected') === 'true',
    readoutTitle: readout?.querySelector('[data-mission-title]')?.textContent?.trim() || null,
    readoutOnScreen: onScreen,
    readoutOwnsItsPixels: Boolean(probe?.closest('#space-mission-panel')),
    layersOn: [...(window.__godsEyeView?.dataManager?.getEnabledLayerIds?.() || [])].sort(),
  };
}

async function enableLayer(page, layerId) {
  return page.evaluate(
    (id) => window.__godsEyeView.dataManager.setEnabled(id, true, { origin: 'user' }),
    layerId,
  );
}

async function waitForMissions(page) {
  await page.waitForFunction(() => {
    const entry = window.__godsEyeView?.dataManager?.layers?.get('rocket-launches');
    return Boolean(entry?.enabled && entry.initialized && entry.module.getStats?.()?.count > 0);
  }, { timeout: 90_000 });
}

/**
 * Render `frames` frames explicitly.
 *
 * `drillPick` reads the scene as last drawn, and this app stops asking for
 * frames the moment nothing moves — that parking IS a shipped feature. A pick
 * against a scene that has not been rendered since the camera settled finds
 * nothing, which is indistinguishable from a pad that is not there.
 */
async function pump(page, frames = 8, gapMs = 80) {
  for (let frame = 0; frame < frames; frame++) {
    await page.evaluate(() => {
      try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled context */ }
    });
    await sleep(gapMs);
  }
}

/**
 * Park the camera where launch pads are actually on screen.
 *
 * Not cosmetic. A fresh profile boots the arrival cinematic, which leaves the
 * camera a few hundred metres over a city — and at that altitude
 * `cartesianToCanvasCoordinates` still returns in-bounds pixels for pads on
 * the far side of the planet, so a pick loop that trusts them clicks empty
 * globe 23 times and reports a reveal that never fired. Duck-typed on
 * purpose: `window.Cesium` does not exist in this build.
 */
async function viewWholeGlobe(page, attempts = 10) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const height = await page.evaluate(() => {
      const viewer = window.__godsEyeView.viewer;
      const scene = viewer.scene;
      const ellipsoid = scene.globe?.ellipsoid || scene.ellipsoid;
      const degrees = Math.PI / 180;
      // The arrival cinematic is a FLIGHT, and a flight in progress keeps
      // writing the camera every frame — a bare setView is overwritten a few
      // hundred metres over Paris and the harness never notices.
      viewer.camera.cancelFlight?.();
      viewer.camera.setView({
        destination: ellipsoid.cartographicToCartesian({
          longitude: -40 * degrees,
          latitude: 20 * degrees,
          height: 22_000_000,
        }),
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
      });
      return viewer.camera.positionCartographic.height;
    });
    await sleep(600);
    const settled = await page.evaluate(
      () => window.__godsEyeView.viewer.camera.positionCartographic.height,
    );
    if (height > 5_000_000 && settled > 5_000_000) return true;
  }
  return false;
}

/**
 * How many pads this browser can actually be made to click.
 *
 * Separated from the pick itself so a browser that cannot 3D-pick is reported
 * as a browser that cannot 3D-pick, rather than as a reveal that did not fire
 * — the two are indistinguishable from the DOM afterwards. `onScreen` above 0
 * with `pickable` at 0 is the SwiftShader case in the header.
 */
async function entityPickReach(page) {
  return page.evaluate(() => {
    const viewer = window.__godsEyeView.viewer;
    const source = viewer.dataSources.getByName('rocket-launches')[0];
    const time = viewer.clock.currentTime;
    const reach = {
      cameraHeightM: Math.round(viewer.camera.positionCartographic.height),
      drawn: Boolean(source?.show),
      pads: 0,
      onScreen: 0,
      pickable: 0,
    };
    for (const entity of source?.entities?.values || []) {
      if (!String(entity.id).startsWith('rocket-launch:')) continue;
      reach.pads += 1;
      const position = entity.position?.getValue(time);
      if (!position) continue;
      const screen = viewer.scene.cartesianToCanvasCoordinates(position);
      if (!screen || screen.x < 24 || screen.y < 24) continue;
      if (screen.x > window.innerWidth - 24 || screen.y > window.innerHeight - 24) continue;
      reach.onScreen += 1;
      if (viewer.scene.drillPick(screen, 12)
        .some((candidate) => String(candidate?.id?.id || '').startsWith('rocket-launch:'))) {
        reach.pickable += 1;
      }
    }
    return reach;
  });
}

/**
 * Pick a launch pad the way a mouse does.
 *
 * Retried, because the position is read one frame and clicked the next: an
 * idling camera can carry the pad off the edge or behind the limb in between,
 * and a pick that lands on empty globe looks exactly like a broken reveal.
 */
async function pickMissionOnGlobe(page, attempts = 6) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    await pump(page, 6, 60);
    const picked = await page.evaluate(() => {
      const viewer = window.__godsEyeView.viewer;
      const source = viewer.dataSources.getByName('rocket-launches')[0];
      if (!source) return null;
      const time = viewer.clock.currentTime;
      for (const entity of source.entities.values) {
        if (!String(entity.id).startsWith('rocket-launch:')) continue;
        const position = entity.position?.getValue(time);
        if (!position) continue;
        const screen = viewer.scene.cartesianToCanvasCoordinates(position);
        if (!screen) continue;
        if (screen.x < 24 || screen.y < 24) continue;
        if (screen.x > window.innerWidth - 24 || screen.y > window.innerHeight - 24) continue;
        // The limb hides half the pads; only a real pick proves this one faces us.
        const hit = viewer.scene.drillPick(screen, 12)
          .map((candidate) => candidate?.id)
          .find((candidate) => String(candidate?.id || '').startsWith('rocket-launch:'));
        if (!hit) continue;
        const canvas = viewer.scene.canvas;
        const shared = {
          bubbles: true,
          cancelable: true,
          clientX: screen.x,
          clientY: screen.y,
          button: 0,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
        };
        canvas.dispatchEvent(new PointerEvent('pointerdown', { ...shared, buttons: 1 }));
        canvas.dispatchEvent(new PointerEvent('pointerup', { ...shared, buttons: 0 }));
        return entity.id;
      }
      return null;
    });
    if (picked) return picked;
    await sleep(700);
  }
  return null;
}

async function bootWithMissions(browser, { reload }) {
  // `durable: true` — this harness reloads, and the per-session key alone
  // would let the launcher return over the second boot's globe.
  const page = await newQaPage(browser, { durable: true });
  await page.setViewport({ width: 1600, height: 1000 });
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForFunction(() => Boolean(window.__godsEyeView?.dataManager), { timeout: 90_000 });
  await enableLayer(page, 'rocket-launches');
  await waitForMissions(page);
  if (!reload) {
    await sleep(3_000);
    return page;
  }
  // Settle BEFORE reloading, not just after. The reload keeps the fragment,
  // and the share link in it outranks the stored layer set — reloading before
  // `l=` has caught up restores the empty list it still says, and the harness
  // then waits forever for a layer nothing turned on.
  await sleep(3_000);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 90_000 });
  await waitForMissions(page);
  // A bystander, added after the restore, so the non-destructive claim has
  // something to be non-destructive to. It can only be added here: the mode
  // is off after a restore, and while it is ON the mode refuses every layer
  // outside its own replay set.
  await enableLayer(page, 'local-firms');
  await sleep(3_000);
  return page;
}

async function main() {
  const response = await fetch(APP_URL).catch((error) => ({ ok: false, statusText: error.message }));
  if (!response.ok) {
    throw new Error(`App unavailable at ${APP_URL}: ${response.status || response.statusText}`);
  }
  const browser = await puppeteer.launch({
    headless: !HEADFUL,
    executablePath: chrome,
    args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000 },
    protocolTimeout: 120_000,
  });

  try {
    for (const scenario of [
      // `pickOwnsTheMode` is what makes the two exits differ. In i the
      // operator's own enable ran the real Context ENTRY — it isolated
      // `local-firms` off and captured a pre-entry session — so exiting
      // correctly RESTORES that session. In ii there was no entry to exit:
      // the pick adopted a mode whose layer was already running, captured
      // nothing, and so must give nothing back.
      { id: 'i. turned on from DATA LAYERS — the panel rests collapsed', reload: false, pickOwnsTheMode: false },
      { id: 'ii. after a reload — the mode was never adopted either', reload: true, pickOwnsTheMode: true },
    ]) {
      console.log(`\n[qa] ${scenario.id}`);
      // A fresh incognito context per scenario: panel collapse state and the
      // layer set are both persisted, so a shared profile would hand scenario
      // ii the panel scenario i just opened.
      const context = await browser.createBrowserContext();
      try {
        const page = await bootWithMissions(context, { reload: scenario.reload });
        const before = await page.evaluate(surfaceState);
        check('the readout is unreachable before the pick',
          !before.readoutOwnsItsPixels, JSON.stringify(before));
        check('the missions are on and clickable',
          before.layersOn.includes('rocket-launches'), JSON.stringify(before.layersOn));

        check('the camera holds a whole-globe view', await viewWholeGlobe(page));
        await pump(page, 10, 80);
        const reach = await entityPickReach(page);
        if (reach.pickable === 0) {
          console.log(`  ⚠ this browser cannot 3D-pick a pad (${JSON.stringify(reach)})`);
          console.log('  ⚠ the click gesture is unavailable here — SKIPPING the pick checks.');
          console.log('  ⚠ run with an installed Chrome: PUPPETEER_EXECUTABLE_PATH=… (see the header).');
          skipped += 1;
          await page.close();
          continue;
        }
        const picked = await pickMissionOnGlobe(page);
        check('a launch pad was picked on the globe', Boolean(picked), JSON.stringify(reach));
        await sleep(2_500);

        const after = await page.evaluate(surfaceState);
        check('the pick named a mission', Boolean(after.readoutTitle)
          && after.readoutTitle !== 'MISSION', String(after.readoutTitle));
        check('the SPACE MISSIONS view is the one showing',
          after.contextMode === 'space-missions'
          && !after.missionsViewHidden
          && after.missionsTabSelected,
          JSON.stringify(after));
        check('the Context panel opened itself', !after.panelCollapsed);
        check('and the readout owns its own pixels',
          after.readoutOnScreen && after.readoutOwnsItsPixels, JSON.stringify(after));
        if (scenario.pickOwnsTheMode) {
          check('the pick cleared no layer the operator had on',
            before.layersOn.includes('local-firms') && after.layersOn.includes('local-firms'),
            `${JSON.stringify(before.layersOn)} → ${JSON.stringify(after.layersOn)}`);
        }

        await page.evaluate(() => document.getElementById('global-context-missions-btn').click());
        await sleep(3_000);
        const exited = await page.evaluate(surfaceState);
        if (scenario.pickOwnsTheMode) {
          check('toggling off a mode the pick adopted gives nothing back',
            exited.layersOn.join(',') === after.layersOn.join(','),
            `${JSON.stringify(after.layersOn)} → ${JSON.stringify(exited.layersOn)}`);
        } else {
          check('toggling off a real entry still tears its own session down',
            !exited.layersOn.includes('rocket-launches'),
            `${JSON.stringify(after.layersOn)} → ${JSON.stringify(exited.layersOn)}`);
        }
        check('the mode is off and the readout is unreachable again',
          exited.contextMode !== 'space-missions' && !exited.readoutOwnsItsPixels,
          JSON.stringify(exited));
        await page.close();
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  console.log('');
  if (failures.length) {
    console.log(`[qa] ${failures.length} FAILED:`);
    for (const failure of failures) console.log(`  · ${failure}`);
    process.exitCode = 1;
  } else if (skipped) {
    // Not a pass. Nothing was disproved either — say which it is.
    console.log(`[qa] mission-reveal: ${skipped} scenario(s) SKIPPED, nothing exercised`);
    process.exitCode = 1;
  } else {
    console.log('[qa] mission-reveal: all checks passed');
  }
}

main().catch((error) => {
  console.error('[qa] harness error:', error);
  process.exitCode = 1;
});
