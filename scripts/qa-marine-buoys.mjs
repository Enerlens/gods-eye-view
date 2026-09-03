#!/usr/bin/env node
/**
 * qa-marine-buoys — the 2026-09-03 field report: "the buoys drift and cross
 * the globe".
 *
 * Nothing here animated, so nothing here could drift. What the report saw was
 * an ASYMMETRY: the station dot ignored the depth test AND was never culled,
 * so a Pacific buoy painted straight through the planet while its own stem
 * (depth-tested) and its own card (`horizonCull: true`) were correctly gone.
 * A dot with no stem and no card, sliding across the disc of the globe as the
 * camera turns, is what "drift" was.
 *
 * So this harness counts, it does not look. Each check is a number read off
 * the live scene:
 *
 *  A. FAR SIDE, NORTH ATLANTIC. Camera over 45N 30W at hemisphere range; count
 *     the DRAWN stations whose position is more than 90 deg of great circle
 *     from the sub-camera point. Target: zero.
 *
 *     And then the tighter bound, because 90 deg is generous: the horizon at
 *     that altitude closes near 67 deg, so no DRAWN station may sit past it and
 *     no HIDDEN one may sit inside it. Measured on 2026-09-03 from this
 *     harness's own camera: furthest drawn 71.47 deg, horizon 71.78 deg,
 *     nearest hidden 72.12 deg — the cull lands ON the limb, not near it.
 *
 *  B. THE SAME COUNT AFTER A 180 DEG ROTATION. Camera to the antipode, count
 *     again. Target: zero far-side stations, a non-empty near side, and two
 *     visible sets that share NO station — a globe that hides the right half
 *     twice, rather than one that happens to hide the half nobody looked at.
 *
 *  C. WHAT IS DRAWN IS IN FRAME. At Gulf-of-Mexico range every drawn station
 *     must fall inside the camera's own view rectangle, plus the layer's
 *     published pop-in margin. Target: zero outside.
 *
 *  D. THE STATIONS AND THE CARDS AGREE. `getStats()` publishes `visible` and
 *     `culled`; they must equal the entities actually shown and hidden. A
 *     layer that reports a cull it did not perform is the original defect
 *     wearing a number.
 *
 *  E. THE SEA SURFACE, NOT THE ELLIPSOID. Station heights must sit inside the
 *     EGM96 undulation range and must NOT all be zero: `heightReference: NONE`
 *     at h = 0 put every buoy on the ellipsoid, up to ~100 m from the water the
 *     AIS layer draws its hulls on.
 *
 * NEEDS THE DEV SERVER: `/api/ndbc` is a Vite middleware, and `vite preview`
 * answers that path with the SPA's HTML. The harness says so rather than
 * reporting an empty ocean as a failure.
 *
 * Usage: node scripts/qa-marine-buoys.mjs [--url http://localhost:4216]
 */
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const argv = process.argv;
const arg = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const baseUrl = arg('--url', process.env.QA_BASE_URL || 'http://localhost:4216');

const LAYER_ID = 'marine-buoys';
/** North Atlantic, at hemisphere range: check A's camera. */
const ATLANTIC = { lat: 45, lon: -30, height: 14_000_000 };
/** Its antipode, to the degree: check B. */
const ANTIPODE = { lat: -45, lon: 150, height: 14_000_000 };
/** The Gulf of Mexico, close enough that the view rectangle bites: check C. */
const GULF = { lat: 25, lon: -90, height: 1_800_000 };
/** The layer's published pop-in margin (`BUOY_VIEW_PAD_DEG`), restated. */
const PAD_DEG = 2;
/** EGM96 runs about -106..+85 m; the bound is the sanity check, not the datum. */
const GEOID_RANGE_M = 120;

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  const mark = ok === null ? '–' : (ok ? '✓' : '✗');
  console.log(`  ${mark} ${name}${detail ? ` — ${detail}` : ''}`);
};

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Poll a page-side predicate on a real timer.
 * `page.waitForFunction` polls on `requestAnimationFrame` by default, and this
 * app renders on demand (`requestRenderMode`), so under SwiftShader that clock
 * simply never ticks.
 */
async function pollUntil(page, fn, { timeoutMs = 90_000, everyMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let hit = false;
    try { hit = await page.evaluate(fn); } catch { hit = false; }
    if (hit) return true;
    await sleep(everyMs);
  }
  return false;
}

/**
 * Move the eye and let the layer's `camera.changed` pass run.
 * The cull is on the shared 5 % sensitivity, which Cesium evaluates per frame,
 * so the pass needs frames — not a timer.
 */
async function lookAt(page, { lat, lon, height }) {
  await page.evaluate((la, lo, h) => {
    const viewer = window.__godsEyeView.viewer;
    try { viewer.camera.cancelFlight(); } catch { /* no flight active */ }
    viewer.camera.setView({
      destination: window.Cesium
        ? window.Cesium.Cartesian3.fromDegrees(lo, la, h)
        : viewer.scene.globe.ellipsoid.cartographicToCartesian({
          longitude: lo * Math.PI / 180, latitude: la * Math.PI / 180, height: h,
        }),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    viewer.scene.requestRender?.();
  }, lat, lon, height);
  for (let frame = 0; frame < 12; frame += 1) {
    await page.evaluate(() => {
      try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled context */ }
    });
    await sleep(80);
  }
}

/**
 * Read the drawn stations back off the scene: where each one is, whether it is
 * shown, and where the camera is standing. Positions are unprojected to
 * degrees so the great-circle arithmetic happens here, in the harness, on
 * numbers the browser cannot round in its favour.
 */
function probe(page) {
  return page.evaluate((layerId) => {
    const gev = window.__godsEyeView;
    const viewer = gev.viewer;
    const scene = viewer.scene;
    const ellipsoid = scene.globe?.ellipsoid || scene.ellipsoid;
    const r2d = 180 / Math.PI;

    let source = null;
    for (let i = 0; i < viewer.dataSources.length; i += 1) {
      const candidate = viewer.dataSources.get(i);
      if (candidate?.name === layerId) source = candidate;
    }
    const stations = [];
    const now = viewer.clock?.currentTime;
    for (const entity of source ? source.entities.values : []) {
      const position = entity.position?.getValue?.(now);
      if (!position) continue;
      const carto = ellipsoid.cartesianToCartographic(position);
      stations.push({
        id: String(entity.id),
        lat: carto.latitude * r2d,
        lon: carto.longitude * r2d,
        heightM: carto.height,
        shown: entity.show !== false,
        hasStem: Boolean(entity.polyline),
      });
    }

    const eye = ellipsoid.cartesianToCartographic(viewer.camera.positionWC);
    const rectangle = viewer.camera.computeViewRectangle?.();
    const stats = gev.dataManager.layers.get(layerId)?.module?.getStats?.() || null;
    return {
      stations,
      sourceFound: Boolean(source),
      eye: { lat: eye.latitude * r2d, lon: eye.longitude * r2d, heightM: eye.height },
      view: rectangle ? {
        south: rectangle.south * r2d,
        west: rectangle.west * r2d,
        north: rectangle.north * r2d,
        east: rectangle.east * r2d,
      } : null,
      stats: stats && {
        count: stats.count, visible: stats.visible, culled: stats.culled, error: stats.error,
      },
    };
  }, LAYER_ID);
}

/** Great-circle angle in degrees between two points. */
function angleDeg(aLat, aLon, bLat, bLon) {
  const r = Math.PI / 180;
  const cos = Math.sin(aLat * r) * Math.sin(bLat * r)
    + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.cos((aLon - bLon) * r);
  return Math.acos(Math.min(1, Math.max(-1, cos))) / r;
}

/** Mean Earth radius, for the horizon angle. The tolerance below absorbs the flattening. */
const EARTH_R_M = 6_371_000;
/** Angular radius of the visible cap from an eye at `heightM`. */
const horizonDeg = (heightM) => Math.acos(EARTH_R_M / (EARTH_R_M + heightM)) * 180 / Math.PI;
/** Slack for the spherical approximation above against Cesium's WGS84 occluder. */
const HORIZON_TOLERANCE_DEG = 1;

/**
 * Sort the stations by where they fall relative to the limb, and report the
 * two numbers that decide whether the cull is exact: the furthest station
 * still drawn and the nearest one already hidden.
 */
function limbSplit(probeResult) {
  const { eye } = probeResult;
  const horizon = horizonDeg(eye.heightM);
  let furthestShown = 0;
  let nearestHidden = Infinity;
  const drawnPastLimb = [];
  const hiddenInsideLimb = [];
  for (const station of probeResult.stations) {
    const angle = angleDeg(eye.lat, eye.lon, station.lat, station.lon);
    if (station.shown) {
      furthestShown = Math.max(furthestShown, angle);
      if (angle > horizon + HORIZON_TOLERANCE_DEG) drawnPastLimb.push(station);
    } else {
      nearestHidden = Math.min(nearestHidden, angle);
      if (angle < horizon - HORIZON_TOLERANCE_DEG) hiddenInsideLimb.push(station);
    }
  }
  return { horizon, furthestShown, nearestHidden, drawnPastLimb, hiddenInsideLimb };
}

/** Whether a station is inside the frame, seam-aware and padded. */
function inFrame(view, lat, lon) {
  if (!view) return true;
  if (lat < view.south - PAD_DEG || lat > view.north + PAD_DEG) return false;
  const west = view.west - PAD_DEG;
  const east = view.east + PAD_DEG;
  if (view.west > view.east) return lon >= west || lon <= east;
  if (east - west >= 360) return true;
  return lon >= west && lon <= east;
}

const shownOf = (probeResult) => probeResult.stations.filter((s) => s.shown);

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
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  const booted = await pollUntil(
    page,
    () => Boolean(window.__godsEyeView?.viewer && window.__godsEyeView?.dataManager),
  );
  if (!booted) throw new Error('the app never created window.__godsEyeView');

  await page.evaluate((id) => window.__godsEyeView.dataManager.toggle(id), LAYER_ID);
  // The first poll goes through the proxy's disk cache; give it a real budget.
  const arrived = await pollUntil(page, () => {
    const stats = window.__godsEyeView.dataManager.layers.get('marine-buoys')
      ?.module?.getStats?.();
    return Boolean(stats && (stats.count > 0 || stats.error));
  }, { timeoutMs: 120_000 });

  const boot = await probe(page);
  if (!arrived || !boot.stats || !(boot.stats.count > 0)) {
    const why = boot.stats?.error || 'no stations reached the globe';
    record('the NDBC feed answered', null, `${why} — /api/ndbc needs the dev server`);
    console.log('\n  Nothing further is testable without stations. Run against `npm run dev`.');
    process.exit(0);
  }
  record('the NDBC feed answered', true, `${boot.stats.count} stations drawn`);

  // ── A. the far side, from the North Atlantic ─────────────────────────────
  await lookAt(page, ATLANTIC);
  const atlantic = await probe(page);
  const atlanticShown = shownOf(atlantic);
  const atlanticFarSide = atlanticShown.filter(
    (s) => angleDeg(atlantic.eye.lat, atlantic.eye.lon, s.lat, s.lon) > 90,
  );
  record(
    'A. no station past 90 deg from the sub-camera point is drawn',
    atlanticFarSide.length === 0,
    `${atlanticFarSide.length} far-side of ${atlanticShown.length} drawn`
      + `, ${atlantic.stations.length - atlanticShown.length} culled`,
  );

  const limb = limbSplit(atlantic);
  record(
    'A. and the cull lands ON the limb, not merely inside 90 deg',
    limb.drawnPastLimb.length === 0 && limb.hiddenInsideLimb.length === 0,
    `furthest drawn ${limb.furthestShown.toFixed(2)} deg`
      + `, horizon ${limb.horizon.toFixed(2)} deg`
      + `, nearest hidden ${limb.nearestHidden.toFixed(2)} deg`
      + ` (${limb.drawnPastLimb.length} drawn past it,`
      + ` ${limb.hiddenInsideLimb.length} hidden inside it)`,
  );

  // ── B. the same, after a 180 deg rotation ────────────────────────────────
  await lookAt(page, ANTIPODE);
  const antipode = await probe(page);
  const antipodeShown = shownOf(antipode);
  const antipodeFarSide = antipodeShown.filter(
    (s) => angleDeg(antipode.eye.lat, antipode.eye.lon, s.lat, s.lon) > 90,
  );
  record(
    'B. the rotated view hides its own far side too',
    antipodeFarSide.length === 0 && antipodeShown.length > 0,
    `${antipodeFarSide.length} far-side of ${antipodeShown.length} drawn`,
  );

  const atlanticIds = new Set(atlanticShown.map((s) => s.id));
  const overlap = antipodeShown.filter((s) => atlanticIds.has(s.id));
  record(
    'B. the two hemispheres share no station',
    overlap.length === 0,
    `${overlap.length} stations drawn from both sides`,
  );

  // ── C. what is drawn is in frame ─────────────────────────────────────────
  await lookAt(page, GULF);
  const gulf = await probe(page);
  const gulfShown = shownOf(gulf);
  const offFrame = gulfShown.filter((s) => !inFrame(gulf.view, s.lat, s.lon));
  record(
    'C. every drawn station is inside the view rectangle',
    gulf.view ? offFrame.length === 0 : null,
    gulf.view
      ? `${offFrame.length} off-frame of ${gulfShown.length} drawn`
      : 'the camera returned no view rectangle at this framing',
  );

  // ── D. the reported cull is the performed cull ───────────────────────────
  const hidden = gulf.stations.length - gulfShown.length;
  record(
    'D. getStats() reports the cull it actually performed',
    gulf.stats?.visible === gulfShown.length && gulf.stats?.culled === hidden,
    `stats ${gulf.stats?.visible}/${gulf.stats?.culled}, scene ${gulfShown.length}/${hidden}`,
  );

  // ── E. the sea surface, not the ellipsoid ────────────────────────────────
  const heights = boot.stations.map((s) => s.heightM);
  const outOfRange = heights.filter((h) => Math.abs(h) > GEOID_RANGE_M);
  const offEllipsoid = heights.filter((h) => Math.abs(h) > 5);
  const maxAbs = heights.reduce((max, h) => Math.max(max, Math.abs(h)), 0);
  record(
    'E. stations sit on the geoid, inside the EGM96 range',
    outOfRange.length === 0 && offEllipsoid.length > 0,
    `${offEllipsoid.length} of ${heights.length} off the ellipsoid, |N| max ${maxAbs.toFixed(1)} m`,
  );

  const failed = results.filter((r) => r.ok === false).length;
  const skipped = results.filter((r) => r.ok === null).length;
  console.log(`\n  ${results.length - failed - skipped}/${results.length - skipped} checks passed`
    + `${skipped ? ` (${skipped} not testable here)` : ''}`);
  process.exit(failed ? 1 : 0);
} finally {
  await browser.close();
}
