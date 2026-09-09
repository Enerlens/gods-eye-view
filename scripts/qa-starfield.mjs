#!/usr/bin/env node
/**
 * qa:starfield — the sky costs nothing to open the map, and still exists.
 *
 * Two halves, and both are load-bearing. "Never load the star field" passes
 * the first check trivially by deleting the feature; "always load it" passes
 * the second one by undoing the 848 kB this change is about. Only asserting
 * both pins what was actually decided: no stars on a drawn basemap, stars on a
 * photographic one, and never inside the boot.
 *
 *   1. a cold boot on the default basemap fetches ZERO `tycho2t3_80_*.jpg`;
 *   2. switching to a photographic basemap fetches all six, and the sky shows;
 *   3. switching back hides it WITHOUT re-downloading — a reader comparing two
 *      basemaps must not pay for the sky twice;
 *   4. switching to it again re-shows it, still without a second download.
 *
 * `ign-ortho` is the photographic stack used here because it is keyless and
 * works from France: `photoreal` is 403 in the EEA and `bing-*` needs an ion
 * token, so either would make this harness pass or fail for reasons that have
 * nothing to do with the sky.
 *
 * Usage: node scripts/qa-starfield.mjs [--url http://127.0.0.1:4179]
 */
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const argv = process.argv.slice(2);
const url = argv.includes('--url') ? argv[argv.indexOf('--url') + 1] : 'http://127.0.0.1:4179';

const SKYBOX_RE = /tycho2t3_80_[a-z]{2}\.jpg/;
/** Past the boot burst AND past the starfield's own idle timeout (4 s). */
const BOOT_WATCH_MS = 20_000;

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${JSON.stringify(detail)}` : ''}`);
};

const browser = await puppeteer.launch({
  headless: 'new',
  protocolTimeout: 300_000,
  args: [
    '--no-sandbox', '--disable-setuid-sandbox', '--window-size=1366,768',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
  ],
});

try {
  const page = await newQaPage(browser);
  await page.setViewport({ width: 1366, height: 768 });
  const skyRequests = [];
  page.on('request', (req) => { if (SKYBOX_RE.test(req.url())) skyRequests.push(req.url()); });

  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => !!window.__godsEyeView?.viewer, { timeout: 120_000 });
  await new Promise((r) => setTimeout(r, BOOT_WATCH_MS - (Date.now() - t0)));

  const bootStack = await page.evaluate(() => window.__godsEyeView.mapStackController.getActiveId());
  const bootSky = await page.evaluate(() => ({
    built: window.__godsEyeView.starfield.isLoaded(),
    shown: Boolean(window.__godsEyeView.viewer.scene.skyBox?.show),
  }));

  // A build that happens to open on a photographic basemap is a different
  // contract (deferred, not absent), and asserting "zero" there would be wrong.
  const bootIsDrawn = !['photoreal', 'bing-aerial', 'bing-labels', 'ign-ortho'].includes(bootStack);
  if (bootIsDrawn) {
    check(
      'a cold boot on a drawn basemap never fetches the star field',
      skyRequests.length === 0 && !bootSky.built,
      { bootStack, requests: skyRequests.length, ...bootSky },
    );
  } else {
    check(
      'a cold boot on a photographic basemap defers the star field past the boot',
      skyRequests.length === 6,
      { bootStack, note: 'deferred, not absent', requests: skyRequests.length },
    );
  }

  const switchTo = (id) => page.evaluate(
    (stackId) => window.__godsEyeView.mapStackController.setStack(stackId), id,
  );

  await switchTo('ign-ortho');
  await new Promise((r) => setTimeout(r, 6_000));
  const onSat = await page.evaluate(() => ({
    stack: window.__godsEyeView.mapStackController.getActiveId(),
    shown: Boolean(window.__godsEyeView.viewer.scene.skyBox?.show),
  }));
  const afterSatellite = skyRequests.length;
  check(
    'a photographic basemap brings the sky back, all six faces',
    onSat.stack === 'ign-ortho' && onSat.shown && afterSatellite === 6,
    { ...onSat, faces: afterSatellite },
  );

  await switchTo('osm');
  await new Promise((r) => setTimeout(r, 4_000));
  const onDrawn = await page.evaluate(() => ({
    stack: window.__godsEyeView.mapStackController.getActiveId(),
    shown: Boolean(window.__godsEyeView.viewer.scene.skyBox?.show),
  }));
  check(
    'a drawn basemap hides the sky again',
    onDrawn.stack === 'osm' && onDrawn.shown === false,
    onDrawn,
  );

  await switchTo('ign-ortho');
  await new Promise((r) => setTimeout(r, 4_000));
  const backOnSat = await page.evaluate(
    () => Boolean(window.__godsEyeView.viewer.scene.skyBox?.show),
  );
  check(
    'going back and forth never re-downloads the sky',
    backOnSat && skyRequests.length === afterSatellite,
    { shown: backOnSat, totalFaceRequests: skyRequests.length, expected: afterSatellite },
  );
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.pass).length;
console.log(`\nqa:starfield ${passed}/${results.length}`);
process.exit(passed === results.length ? 0 : 1);
