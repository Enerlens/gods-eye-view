#!/usr/bin/env node
/**
 * qa:boot-spend — a page anyone can open must not be a page anyone can bill.
 *
 * WHAT THIS PINS. Opening the globe and touching nothing costs zero metered
 * calls. Measured on 2026-09-09, before the gate: the intro fly-to settles on
 * its own at t≈6.3 s, `moveEnd` fires, and the HUD's semantic summary runs in
 * full — a Google reverse geocode per viewport sample (three of them, the key
 * in the query string, straight from the browser), one
 * `/api/google/nearby-places`, one `/api/openai/hud-summary` POST. Five billed
 * calls per page view, for a visitor who had not clicked anything. Reload in a
 * loop and that is somebody else's invoice.
 *
 * The fix is an engagement gate in `src/hud.js` (`_installEngagementGate`).
 * This harness is the gate's teeth, and it asserts BOTH halves, because half of
 * it is trivially satisfiable by breaking the feature:
 *
 *   1. no metered call in the boot window — which spans past the intro settle
 *      AND past a full 15 s summary tick, so a gate that only delayed the spend
 *      would still be caught here;
 *   2. the summary DOES fire after one gesture — so "never spend" cannot pass.
 *
 * The gesture is dispatched on the canvas rather than driven through
 * `page.mouse`, deliberately: on this app a real Puppeteer click hangs (see
 * `docs/CURRENT-STATE.md`, and the DOM-click pattern every other harness here
 * uses), and what is under test is the listener, not Chromium's input plumbing.
 *
 * Usage: node scripts/qa-boot-spend.mjs [--url http://127.0.0.1:4179]
 */
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const argv = process.argv.slice(2);
const url = argv.includes('--url') ? argv[argv.indexOf('--url') + 1] : 'http://127.0.0.1:4179';

/** Every request below either bills a vendor or burns a rate-limited quota. */
const METERED = [
  { name: 'google reverse geocode', re: /maps\.googleapis\.com\/maps\/api\/geocode/ },
  { name: 'google nearby-places', re: /\/api\/google\/nearby-places/ },
  { name: 'openai hud-summary', re: /\/api\/openai\/hud-summary/ },
];
/** Past the intro settle (~6 s) and past one full 15 s summary tick. */
const BOOT_WATCH_MS = 24_000;
const AFTER_GESTURE_MS = 8_000;

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

  const spend = [];
  page.on('request', (req) => {
    const hit = METERED.find((m) => m.re.test(req.url()));
    if (hit) spend.push({ at: Date.now(), what: hit.name, url: req.url().slice(0, 120) });
  });

  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => !!window.__godsEyeView?.viewer, { timeout: 120_000 });
  await new Promise((r) => setTimeout(r, BOOT_WATCH_MS - (Date.now() - t0)));

  const beforeGesture = spend.map((s) => ({ ...s, t: s.at - t0 }));
  check(
    'no metered call before the visitor touches anything',
    beforeGesture.length === 0,
    beforeGesture.length ? beforeGesture : { watchedMs: BOOT_WATCH_MS },
  );

  // The HUD has to be on for the second half to mean anything; it is on by
  // default (VISUAL_DEFAULTS.hudVisible), and a tree that turned it off would
  // otherwise pass part 2 for the wrong reason.
  const hudVisible = await page.evaluate(() => {
    const el = document.getElementById('intel-hud');
    return !!el && el.classList.contains('active');
  });
  check('the HUD is visible, so the summary path is live', hudVisible);

  const mark = spend.length;
  await page.evaluate(() => {
    const target = document.querySelector('#cesiumContainer canvas') || document.body;
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  });
  await new Promise((r) => setTimeout(r, AFTER_GESTURE_MS));

  const afterGesture = spend.slice(mark).map((s) => ({ ...s, t: s.at - t0 }));
  check(
    'one gesture releases the summary',
    afterGesture.some((s) => s.what === 'openai hud-summary'),
    afterGesture.length ? afterGesture : { watchedMs: AFTER_GESTURE_MS },
  );
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.pass).length;
console.log(`\nqa:boot-spend ${passed}/${results.length}`);
process.exit(passed === results.length ? 0 : 1);
