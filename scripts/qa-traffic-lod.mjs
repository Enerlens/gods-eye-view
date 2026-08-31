#!/usr/bin/env node
/**
 * Deterministic browser proof for the road layer's ALTITUDE BANDS
 * (`src/data/trafficBounds.js` → `ROAD_FETCH_TIERS`).
 *
 * WHAT THIS EXISTS TO PROVE. The layer used to switch off above 8 km with a
 * fetch box capped at 0.05° (~5.5 km) at every altitude. Bordeaux Métropole is
 * 23 × 26 km, so the animated-road view and the live-transit view could not be
 * the same view: at the altitude where cars moved you saw a fraction of the
 * city's 450-odd live transit vehicles, and at the altitude that showed them
 * all the cars were gone. The bands fix that, and the four things worth
 * proving are the ones a unit test cannot reach:
 *
 *   i.   at metro altitude the layer fetches a CITY-sized box of arterials,
 *        and the road dots and the live transit fleet are on screen TOGETHER
 *   ii.  each band asks Overpass for its own road classes
 *   iii. descending a band re-fetches, even though the finer box sits entirely
 *        inside the coarser one (100% overlap, zero centre shift — the exact
 *        state the skip gate would otherwise read as "nothing changed")
 *   iv.  above every band the layer clears rather than leaving stale dots
 *
 * `camera.changed` does not fire under software-rendered headless WebGL, so
 * the harness raises the real event against the real camera state. The layer
 * is never toggled between altitudes: `disable()` resets the last-fetch
 * bookkeeping, which is precisely the state (iii) has to be judged against.
 *
 * Run: node scripts/qa-traffic-lod.mjs --url http://localhost:4173
 */
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';
import { ROAD_FETCH_TIERS } from '../src/data/trafficBounds.js';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = option('--url', process.env.QA_BASE_URL || 'http://localhost:4173');
const HEADFUL = args.includes('--headful');

/** Bordeaux, the best-covered French city: 453 live transit vehicles. */
const CITY = { lon: -0.5792, lat: 44.8378 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
let failed = 0;
function check(label, ok, detail = '') {
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (ok) passed += 1; else failed += 1;
}

async function main() {
  const browser = await puppeteer.launch({
    headless: HEADFUL ? false : 'new',
    protocolTimeout: 240000,
    args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000 },
  });

  try {
    const page = await newQaPage(browser);
    const overpassBodies = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/overpass')) overpassBodies.push(request.postData() || '');
    });

    console.log(`[qa] booting ${APP_URL}`);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForFunction(
      () => window.__godsEyeView?.viewer && window.__godsEyeView?.dataManager,
      { timeout: 90000, polling: 200 },
    );
    await sleep(2500);

    const pump = async (frames = 4) => {
      for (let i = 0; i < frames; i++) {
        await page.evaluate(() => { try { window.__godsEyeView.viewer.scene.render(); } catch { /* stalled context */ } });
        await sleep(260);
      }
    };

    await page.evaluate(() => {
      window.__godsEyeView.dataManager.setEnabled('traffic', true);
      window.__godsEyeView.dataManager.setEnabled('transit-fr', true);
    });

    const probe = () => page.evaluate(() => {
      const layer = (id) => window.__godsEyeView.dataManager.layers.get(id)?.module;
      return {
        traffic: layer('traffic')?.getStats?.() ?? null,
        transit: layer('transit-fr')?.getStats?.() ?? null,
      };
    });

    /** Teleport, raise the real camera event, settle, and report. */
    async function visit(altitude, { expectEmpty = false } = {}) {
      overpassBodies.length = 0;
      await page.evaluate((lon, lat, height) => {
        const gev = window.__godsEyeView;
        const ellipsoid = gev.viewer.scene.globe?.ellipsoid || gev.viewer.scene.ellipsoid;
        const d2r = Math.PI / 180;
        try { gev.viewer.camera.cancelFlight(); } catch { /* no flight active */ }
        gev.viewer.camera.setView({
          destination: ellipsoid.cartographicToCartesian({ longitude: lon * d2r, latitude: lat * d2r, height }),
          orientation: { heading: 0, pitch: -55 * d2r, roll: 0 },
        });
        gev.viewer.camera.changed.raiseEvent();
      }, CITY.lon, CITY.lat, altitude);

      for (let i = 0; i < 45; i++) {
        await pump(3);
        const stats = await probe();
        const settled = expectEmpty
          ? stats.traffic?.count === 0
          : (!stats.traffic?.loading && stats.traffic?.count > 0);
        if (settled) break;
      }
      await pump(6);

      const bodies = overpassBodies.map((body) => decodeURIComponent(body || ''));
      const classes = [...new Set(bodies
        .map((body) => body.match(/highway"~"\^\(([^)]*)\)/)?.[1])
        .filter(Boolean))];
      const firstBox = bodies.map((body) => body.match(/\]\(([-0-9.,]+)\)/)?.[1]).filter(Boolean)[0];
      const spanDeg = firstBox
        ? (() => { const p = firstBox.split(',').map(Number); return Math.max(p[2] - p[0], p[3] - p[1]); })()
        : 0;
      return { ...(await probe()), classes, spanDeg, queries: bodies.length };
    }

    const [street, district, metro] = ROAD_FETCH_TIERS;

    console.log('[qa] i. metro band — a city-sized box, and both layers at once');
    const high = await visit(metro.maxAltitudeM - 8000);
    check('the fetch box is city-sized, not neighbourhood-sized',
      high.spanDeg > street.spanDeg * 4, `${high.spanDeg.toFixed(2)}° (street band is ${street.spanDeg}°)`);
    check('road dots are rendered at metro altitude',
      high.traffic?.count > 0, `${high.traffic?.count ?? 0} dots`);
    check('live transit vehicles share the frame with them',
      high.transit?.count > 0, `${high.transit?.count ?? 0} vehicles`);
    check('only arterials are asked for',
      high.classes.length === 1 && high.classes[0] === metro.classes.join('|'),
      JSON.stringify(high.classes));

    console.log('[qa] ii. district band — a finer class set');
    const mid = await visit(district.maxAltitudeM - 2000);
    check('descending into the district band re-fetched',
      mid.queries > 0, `${mid.queries} Overpass request(s)`);
    check('and asked for the band\'s own classes',
      mid.classes.includes(district.classes.join('|')), JSON.stringify(mid.classes));

    console.log('[qa] iii. street band — the descent gate does not swallow the fetch');
    const low = await visit(2200);
    check('descending again re-fetched, despite 100% box overlap',
      low.queries > 0, `${low.queries} Overpass request(s)`);
    check('and the full road graph was requested',
      low.classes.includes(street.fullClasses.join('|')), JSON.stringify(low.classes));
    check('street level draws more dots than metro level',
      low.traffic?.count > high.traffic?.count, `${low.traffic?.count} vs ${high.traffic?.count}`);

    console.log('[qa] iv. above every band — cleared, not stale');
    const above = await visit(metro.maxAltitudeM + 15000, { expectEmpty: true });
    check('no dots remain above the coarsest band',
      above.traffic?.count === 0, `${above.traffic?.count} dots`);
    check('and nothing was fetched up there',
      above.queries === 0, `${above.queries} Overpass request(s)`);

    console.log(`\n[qa] ${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed`);
  } finally {
    await browser.close();
  }
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('[qa] harness error:', error?.message || error);
  process.exitCode = 1;
});
