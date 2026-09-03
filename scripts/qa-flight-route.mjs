#!/usr/bin/env node
/**
 * qa-flight-route — phase 3c: seeing where a tracked flight came from and
 * where it is going, on one view.
 *
 * The unit tests pin the geometry (`flightRoutePlan`, `flightRouteArc`) and the
 * framing arithmetic, but none of them can prove the thing that was actually
 * asked for: that after one press, BOTH airports are on screen at the same
 * time, that the aircraft is still selected while they are, and that the arc
 * between them cannot be mistaken for the track behind the aircraft.
 *
 * What it proves, on a live sky:
 *
 *   A. THE CONTROL APPEARS ONLY WHEN THERE IS A ROUTE. adsbdb answers a
 *      callsign, not an airframe, and `routePlausible` rejects a wrong-leg
 *      answer outright — so the harness tracks live contacts until one has a
 *      plausible leg, and checks the button is offered then and hidden before.
 *
 *   B. BOTH AIRPORTS ARE IN FRAME. The two endpoint coordinates are projected
 *      to screen coordinates after the framing settles and must both land
 *      inside the canvas. This is the user's sentence, tested literally.
 *
 *   C. THE SELECTION SURVIVES THE EXCURSION. The camera pulls back thousands
 *      of kilometres, and the contact must still be tracked, still be the
 *      Context subject, and still have its readout card painted — the route
 *      view moves the camera, it does not deselect.
 *
 *   D. THE ARC IS DRAWN, AND IS NOT A TRACK. One dashed polyline, two pins,
 *      three captions including ESTIMATED FLIGHT PLAN, in a colour that is not
 *      the trail's cyan.
 *
 *   E. IT COMES BACK. Hiding returns the camera to the close follow frame and
 *      removes every entity and caption the arc added.
 *
 * Run: node scripts/qa-flight-route.mjs --url http://localhost:4173
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'flight-route');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = option('--url', process.env.QA_BASE_URL || 'http://localhost:4173');
const HEADFUL = args.includes('--headful');
/** Where the sky is busy enough that some contact has a known scheduled leg. */
const VIEW = { lon: 2.4, lat: 48.85, height: 700_000 };
/** How many live contacts to try before giving up on finding one with a route. */
const TRACK_ATTEMPTS = 40;

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

const failures = [];
function check(label, condition, detail = '') {
  const ok = Boolean(condition);
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
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
      destination: ellipsoid.cartographicToCartesian({
        longitude: lo * d2r, latitude: la * d2r, height: h,
      }),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    gev.viewer.scene.requestRender?.();
  }, lon, lat, height);
  await pump(page, 4);
}

/**
 * Everything the harness needs to know about the current route view, in one
 * read. Deliberately reaches only for viewer/scene methods — the app does not
 * publish the Cesium namespace on `window`, so `scene.cartesianToCanvasCoordinates`
 * and the ellipsoid instance are how a harness projects a coordinate here.
 */
function readRouteState(page) {
  return page.evaluate(() => {
    const gev = window.__godsEyeView;
    const layer = gev?.dataManager?.layers?.get('flights')?.module;
    const viewer = gev?.viewer;
    const scene = viewer?.scene;
    const state = layer?.getTrackedRouteState?.() || null;
    const entities = viewer ? viewer.entities.values : [];
    const routeEntities = entities
      .filter((entity) => String(entity.id || '').startsWith('gev-flight-route:'))
      .map((entity) => String(entity.id));
    const diagnostics = window.__gevWorldOverlay?.getDiagnostics?.() || {};
    const tracked = layer?.getTrackedInfo?.() || null;
    const ellipsoid = scene?.globe?.ellipsoid || scene?.ellipsoid;
    // Where the two airports land on screen — the literal reading of "see its
    // origin and its destination on one view".
    const project = (lon, lat) => {
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || !scene || !ellipsoid) return null;
      const d2r = Math.PI / 180;
      const world = ellipsoid.cartographicToCartesian({
        longitude: lon * d2r, latitude: lat * d2r, height: 0,
      });
      const window2d = scene.cartesianToCanvasCoordinates(world);
      return window2d ? { x: Math.round(window2d.x), y: Math.round(window2d.y) } : null;
    };
    const arc = entities.find((entity) => String(entity.id || '').includes(':arc:'));
    return {
      state,
      tracked: tracked ? {
        icao24: tracked.icao24,
        route: tracked.route
          ? {
            origin: { ...tracked.route.origin },
            destination: { ...tracked.route.destination },
          }
          : null,
      } : null,
      trackedEntitySet: Boolean(viewer?.trackedEntity),
      contextSubject: window.__gevContextStore?.selectedEntityId || null,
      routeEntities,
      // A dash length is what makes the line dashed; asserting on it beats
      // asserting on a constructor name a bundler is free to rename.
      arcIsDashed: Number(arc?.polyline?.material?.dashLength?.getValue?.()) > 0,
      overlayEntries: diagnostics.entriesBySource?.['flight-route'] ?? 0,
      trackedCardPainted: (diagnostics.paintedBySource?.tracked ?? 0) > 0,
      cameraHeightM: Math.round(viewer?.camera?.positionCartographic?.height ?? 0),
      canvas: scene ? { width: scene.canvas.clientWidth, height: scene.canvas.clientHeight } : null,
      originOnScreen: tracked?.route ? project(tracked.route.origin.lon, tracked.route.origin.lat) : null,
      destinationOnScreen: tracked?.route
        ? project(tracked.route.destination.lon, tracked.route.destination.lat)
        : null,
    };
  });
}

/**
 * Track live contacts until one of them has a plausible scheduled leg.
 *
 * The route lookup only fires for the TRACKED plane (it is the head-of-queue
 * enrichment, deliberately), so there is no way to ask this question without
 * selecting contacts one at a time and waiting on adsbdb.
 */
async function findContactWithRoute(page) {
  const tried = new Set();
  for (let attempt = 0; attempt < TRACK_ATTEMPTS; attempt += 1) {
    const picked = await page.evaluate((seen, view) => {
      const layer = window.__godsEyeView?.dataManager?.layers?.get('flights')?.module;
      const contacts = layer?.getAllPositions?.(400) || [];
      // A callsign is what adsbdb answers; a contact without one cannot have a
      // route, so trying it would only spend the attempt budget.
      // Near the framed view, not anywhere on the planet: `getAllPositions`
      // is worldwide, and a contact over Peru would have the harness prove the
      // framing on a route nobody was looking at.
      const candidate = contacts.find((contact) => (
        !seen.includes(contact.id)
        && String(contact.label || '').trim().length >= 5
        && Math.abs(contact.latitude - view.lat) < 12
        && Math.abs(contact.longitude - view.lon) < 18
        // AIRBORNE only. A taxiing contact drops in and out of the OpenSky
        // snapshot, and one evicted between the hunt and the press untracks
        // itself — which reads as twelve failed assertions about a feature
        // that was never given a selection to work on.
        && Number(contact.altitudeM) > 3000
      ));
      if (!candidate) return null;
      layer.trackById(candidate.id, { origin: 'user' });
      return { id: candidate.id, label: candidate.label };
    }, [...tried], VIEW);
    if (!picked) {
      await pump(page, 4, 120);
      continue;
    }
    tried.add(picked.id);
    // adsbdb is rate-limited and the answer lands asynchronously.
    for (let wait = 0; wait < 8; wait += 1) {
      await pump(page, 3, 90);
      const state = await page.evaluate(() => (
        window.__godsEyeView?.dataManager?.layers?.get('flights')?.module
          ?.getTrackedRouteState?.() || null
      ));
      if (state?.available) return { ...picked, state };
    }
  }
  return null;
}

/**
 * Best-effort screenshot. Under SwiftShader a 1440x900 globe capture can miss
 * the CDP timeout, and a lost picture must never fail a run whose assertions
 * all passed — the checks read the scene graph, not the pixels.
 */
async function shoot(page, name) {
  try {
    await page.screenshot({ path: path.join(SHOTS_DIR, name) });
  } catch (error) {
    console.log(`  · screenshot ${name} skipped (${error.message.split('.')[0]})`);
  }
}

async function main() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: !HEADFUL,
    executablePath: chrome,
    args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1440,900'],
    defaultViewport: { width: 1440, height: 900 },
    protocolTimeout: 180000,
  });

  try {
    const page = await newQaPage(browser);
    console.log(`[qa] booting ${APP_URL}`);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(
      () => window.__godsEyeView?.viewer && window.__godsEyeView?.dataManager,
      { timeout: 60000, polling: 200 },
    );
    await page.waitForFunction(() => Boolean(window.__gevWorldOverlay?.hitRects), {
      timeout: 30000, polling: 200,
    });
    await sleep(2500);

    await setView(page, VIEW);
    await page.evaluate(() => window.__godsEyeView.dataManager.setEnabled('flights', true));
    await page.waitForFunction(
      () => (window.__godsEyeView?.dataManager?.layers?.get('flights')?.module
        ?.getAllPositions?.(50) || []).length > 0,
      { timeout: 90000, polling: 500 },
    );

    // Open CONTACTS so the tracked-contact action row (COCKPIT, the route
    // control) is on screen — the same two clicks an operator makes.
    await page.evaluate(() => {
      document.getElementById('global-context-flights-btn')?.click();
    });
    await sleep(1200);

    // ── A. the control is offered only when there is a route ────────────────
    const idle = await page.evaluate(() => {
      const button = document.getElementById('flight-route-btn');
      return { present: Boolean(button), hidden: button?.hidden !== false };
    });
    check('the route control exists in the Contacts action row', idle.present);
    check('with nothing tracked, it is hidden rather than inert', idle.hidden);

    console.log('[qa] hunting a live contact with a plausible scheduled leg…');
    const found = await findContactWithRoute(page);
    if (!found) {
      console.error(`[qa] no contact with a plausible route after ${TRACK_ATTEMPTS} attempts.`);
      console.error('[qa] this is a LIVE-SKY precondition, not a regression: adsbdb only knows');
      console.error('[qa] scheduled callsigns, and the sky over Paris may be all GA right now.');
      process.exitCode = 2;
      return;
    }
    console.log(`[qa] tracking ${found.label} (${found.id}) — ${found.state.origin} → ${found.state.destination}`);
    await pump(page, 6, 90);
    const offered = await page.evaluate(() => {
      const button = document.getElementById('flight-route-btn');
      return { hidden: button?.hidden !== false, text: button?.textContent?.trim() || '' };
    });
    check('the control appears for a contact that has a route', !offered.hidden);
    check('and reads SHOW ROUTE before it is pressed', offered.text === 'SHOW ROUTE', offered.text);
    await shoot(page, '01-tracked-before-route.png');

    const before = await readRouteState(page);
    check('before the press, nothing of the route is drawn', before.routeEntities.length === 0);
    // The sky is live: a contact can leave the feed between the hunt and the
    // press. Confirm the selection is still there rather than assert twelve
    // times about a feature that has nothing selected to act on.
    if (before.tracked?.icao24 !== found.id || !before.state?.available) {
      console.error(`[qa] ${found.label} left the feed before the press (tracked=${before.tracked?.icao24}).`);
      console.error('[qa] LIVE-SKY precondition lost, not a regression — re-run.');
      process.exitCode = 2;
      return;
    }

    // ── B/C/D. press it ────────────────────────────────────────────────────
    await page.evaluate(() => { document.getElementById('flight-route-btn')?.click(); });
    // The tracked frame is applied on a preUpdate pass, then the camera settles.
    await pump(page, 8, 400);
    const after = await readRouteState(page);
    await shoot(page, '02-route-framed.png');

    const margin = 4;
    const inFrame = (point) => Boolean(point)
      && point.x >= -margin && point.y >= -margin
      && point.x <= after.canvas.width + margin
      && point.y <= after.canvas.height + margin;
    check(
      'B. the origin airport is on screen',
      inFrame(after.originOnScreen),
      JSON.stringify(after.originOnScreen),
    );
    check(
      'B. the destination airport is on screen at the same time',
      inFrame(after.destinationOnScreen),
      JSON.stringify(after.destinationOnScreen),
    );
    // The layer says WHY when it did not frame; without that a camera that
    // did not move is a mystery rather than a diagnosis.
    const framing = await page.evaluate(() => {
      try {
        const layer = window.__godsEyeView?.dataManager?.layers?.get('flights')?.module;
        return { result: layer?.showTrackedRoute?.() ?? null };
      } catch (error) { return { error: String(error) }; }
    });
    await pump(page, 6, 350);
    const settled = await readRouteState(page);
    check(
      'B. the camera really pulled back to the height the plan asked for',
      // The DOM press is the path under test; `settled` and the layer's own
      // verdict are printed so a failure names its cause instead of posing one.
      after.cameraHeightM > before.cameraHeightM * 1.5,
      `${before.cameraHeightM} m → ${after.cameraHeightM} m (settled ${settled.cameraHeightM} m) · ${JSON.stringify(framing)}`,
    );

    check(
      'C. the aircraft is still tracked after the excursion',
      after.tracked?.icao24 === found.id && after.trackedEntitySet,
      `${after.tracked?.icao24} / trackedEntity=${after.trackedEntitySet}`,
    );
    check(
      'C. it is still the Context subject',
      String(after.contextSubject || '').toLowerCase() === String(found.id).toLowerCase(),
      String(after.contextSubject),
    );
    check('C. its readout card is still painted', after.trackedCardPainted);
    const control = await page.evaluate(() => {
      const button = document.getElementById('flight-route-btn');
      return { text: button?.textContent?.trim() || '', hidden: button?.hidden !== false };
    });
    check(
      'C. the control stays offered, and now reads HIDE ROUTE',
      control.text === 'HIDE ROUTE' && !control.hidden,
      `${control.text}${control.hidden ? ' (hidden)' : ''} · state=${JSON.stringify(after.state)}`,
    );

    check(
      'D. one arc and two airport pins are drawn',
      after.routeEntities.filter((id) => id.includes(':arc:')).length === 1
        && after.routeEntities.filter((id) => id.includes(':pin:')).length === 2,
      after.routeEntities.join(', '),
    );
    check('D. the arc is dashed — it must not read as the flown track', after.arcIsDashed);
    check(
      'D. three captions are published, including the ESTIMATED FLIGHT PLAN kicker',
      after.overlayEntries === 3,
      `${after.overlayEntries} entries`,
    );

    // ── E. and it comes back ───────────────────────────────────────────────
    await page.evaluate(() => { document.getElementById('flight-route-btn')?.click(); });
    await pump(page, 8, 400);
    const restored = await readRouteState(page);
    await shoot(page, '03-route-hidden.png');
    check('E. every route entity is removed', restored.routeEntities.length === 0);
    check('E. every route caption is withdrawn', restored.overlayEntries === 0);
    check(
      'E. the camera returns to the close follow frame',
      restored.cameraHeightM < after.cameraHeightM / 3,
      `${after.cameraHeightM} m → ${restored.cameraHeightM} m`,
    );
    check(
      'E. and the contact is still tracked afterwards',
      restored.tracked?.icao24 === found.id,
      String(restored.tracked?.icao24),
    );
  } finally {
    await browser.close();
  }

  console.log('');
  if (failures.length) {
    console.error(`[qa] ${failures.length} failure(s):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log('[qa] flight route view: all checks passed');
}

main().catch((error) => {
  console.error('[qa] harness error:', error);
  process.exitCode = 1;
});
