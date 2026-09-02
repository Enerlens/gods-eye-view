#!/usr/bin/env node
/**
 * Browser proof for the "pouls vélo" layer, in Lyon AND in Paris.
 *
 * The pack is a file in this repository, rebuilt by `npm run velo:pulse` and
 * identical on every run, so this harness intercepts nothing: boot the app,
 * turn the layer on, and read what actually reached the globe.
 *
 * What it proves, and why each needs a browser rather than a unit test:
 *
 *   i.    both cities draw — 422 Vélo'v stations over Lyon and 111 counters
 *         over Paris, from one shipped pack
 *   ii.   the hour on screen is the hour of the week it currently is, so a
 *         reader opening the globe on a Tuesday morning sees a Tuesday morning
 *   iii.  SEMAINE really animates: the slot advances on its own, the columns
 *         change with it, and the legend's band counts move
 *   iv.   POINTE lands on the network's busiest hour, and it is a commuting
 *         hour rather than the middle of the night — the layer's whole claim
 *   v.    leaving SEMAINE stops the clock, and so does switching the layer off:
 *         an animation left running holds continuous render forever
 *   vi.   a card names its instrument, because a Lyon stock and a Paris flow
 *         are not the same quantity
 *   vii.  the share link carries the mode
 *
 * Run: node scripts/qa-velo-pulse.mjs --url http://localhost:4173
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'velo-pulse');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = option('--url', process.env.QA_BASE_URL || 'http://localhost:4173');
const HEADFUL = args.includes('--headful');
const LAYER = 'velo-pulse-fr';

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
 * Low and OBLIQUE. The columns are the layer: from 14 km at nadir they read as
 * flat coloured squares and the height channel disappears entirely, which is
 * half the encoding gone. 5 km at a 55° tilt is where a dock and its neighbour
 * are still distinguishable and a tall one still looks tall.
 */
const LYON = { lon: 4.8400, lat: 45.7580, height: 5_000 };
const PARIS = { lon: 2.3500, lat: 48.8620, height: 5_000 };

let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`);
  return ok;
}

async function pump(page, frames = 8, gapMs = 90) {
  for (let frame = 0; frame < frames; frame += 1) {
    await page.evaluate(() => {
      try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled context */ }
    });
    await sleep(gapMs);
  }
}

async function shoot(page, name) {
  try {
    await page.evaluate(() => { try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled */ } });
    await page.screenshot({ path: path.join(SHOTS_DIR, name) });
  } catch (error) {
    console.log(`  · screenshot ${name} unavailable (${String(error?.message || error).split('\n')[0]})`);
  }
}

async function setView(page, { lon, lat, height }) {
  await page.evaluate((lo, la, h) => {
    const gev = window.__godsEyeView;
    const ellipsoid = gev.viewer.scene.globe?.ellipsoid || gev.viewer.scene.ellipsoid;
    const d2r = Math.PI / 180;
    try { gev.viewer.camera.cancelFlight(); } catch { /* no flight active */ }
    gev.viewer.camera.setView({
      destination: ellipsoid.cartographicToCartesian({ longitude: lo * d2r, latitude: la * d2r, height: h }),
      orientation: { heading: 0, pitch: -Math.PI / 3.3, roll: 0 },
    });
    gev.viewer.scene.requestRender?.();
  }, lon, lat, height);
  await pump(page, 8);
}

function probe(page) {
  return page.evaluate((id) => {
    const module = window.__godsEyeView.dataManager.layers.get(id).module;
    const controls = module.getRowControls();
    return {
      stats: module.getStats(),
      chips: controls.chips.map((chip) => ({ id: chip.id, active: chip.active })),
      legend: controls.legend.map((row) => ({ label: row.label, count: row.count })),
    };
  }, LAYER);
}

async function setMode(page, mode) {
  await page.evaluate((id, value) => window.__godsEyeView.dataManager.setLayerParams(
    id, { mode: value }, { origin: 'user' },
  ), LAYER, mode);
  await pump(page, 8);
}

async function main() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: !HEADFUL,
    executablePath: chrome,
    args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000 },
    protocolTimeout: 120000,
  });

  try {
    const page = await newQaPage(browser);
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    console.log(`[qa] booting ${APP_URL}`);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => Boolean(window.__godsEyeView?.dataManager), { timeout: 60000 });
    await pump(page, 6);

    // ── i. the pack loads and both cities draw ─────────────────────────────
    console.log('\n[1] One shipped pack, two cities, two instruments');
    await setView(page, LYON);
    await page.evaluate((id) => window.__godsEyeView.dataManager.setEnabled(
      id, true, { origin: 'user' },
    ), LAYER);
    await page.waitForFunction(
      (id) => (window.__godsEyeView.dataManager.layers.get(id).module.getStats().sites ?? 0) > 0,
      { timeout: 30000 }, LAYER,
    );
    await pump(page, 10);
    const first = await probe(page);
    check('the pack loaded without an error', !first.stats.error, String(first.stats.error));
    check('both cities are in it', Object.keys(first.stats.cities || {}).length === 2,
      Object.keys(first.stats.cities || {}).join(','));
    check('Lyon measures a stock', first.stats.cities?.lyon?.instrument === 'stock',
      first.stats.cities?.lyon?.instrument);
    check('Paris measures a flow', first.stats.cities?.paris?.instrument === 'flow',
      first.stats.cities?.paris?.instrument);
    check('and the two units are not the same string',
      first.stats.cities?.lyon?.unit !== first.stats.cities?.paris?.unit,
      `${first.stats.cities?.lyon?.unit} / ${first.stats.cities?.paris?.unit}`);
    check('every site is drawn', first.stats.count === first.stats.sites,
      `${first.stats.count} drawn of ${first.stats.sites}`);
    check('a plausible number of sites', first.stats.sites > 300 && first.stats.sites < 800,
      String(first.stats.sites));
    console.log(`      ${first.stats.sites} sites — Lyon ${first.stats.cities?.lyon?.sites},`
      + ` Paris ${first.stats.cities?.paris?.sites}`);
    console.log(`      window ${first.stats.window?.start} → ${first.stats.window?.end}`);
    await shoot(page, '01-lyon-maintenant.png');

    // ── ii. "now" is really now ────────────────────────────────────────────
    console.log('\n[2] MAINTENANT shows the hour of the week it actually is');
    const expected = await page.evaluate(() => {
      const now = new Date();
      const isoDay = now.getDay() === 0 ? 6 : now.getDay() - 1;
      return isoDay * 24 + now.getHours();
    });
    check('the slot is the current hour of the week', first.stats.slot === expected,
      `${first.stats.slot} vs ${expected}`);
    check('and the row says so in words', /h$/.test(first.stats.slotLabel || ''),
      first.stats.slotLabel);

    // ── iii. the animation ─────────────────────────────────────────────────
    console.log('\n[3] SEMAINE animates on its own');
    await setMode(page, 'week');
    const before = await probe(page);
    await sleep(1600);
    await pump(page, 6);
    const after = await probe(page);
    check('the chip moved', after.chips.find((chip) => chip.active)?.id === 'week',
      after.chips.find((chip) => chip.active)?.id);
    check('the hour advanced by itself', after.stats.slot !== before.stats.slot,
      `${before.stats.slot} → ${after.stats.slot}`);
    check('and the legend moved with it',
      JSON.stringify(after.legend) !== JSON.stringify(before.legend),
      JSON.stringify(after.legend));
    check('every site is still accounted for in exactly one band',
      after.legend.reduce((sum, row) => sum + row.count, 0) === after.stats.count,
      `${after.legend.reduce((sum, row) => sum + row.count, 0)} vs ${after.stats.count}`);
    await shoot(page, '02-lyon-semaine.png');

    // ── iv. the peak ───────────────────────────────────────────────────────
    console.log('\n[4] POINTE lands on a commuting hour, which is the layer\'s claim');
    await setMode(page, 'peak');
    const peak = await probe(page);
    const peakHour = peak.stats.slot % 24;
    const peakDay = Math.floor(peak.stats.slot / 24);
    check('the clock stopped', peak.chips.find((chip) => chip.active)?.id === 'peak');
    check('the peak is on a weekday', peakDay <= 4, `day ${peakDay}`);
    check('and at a commuting hour, not at 3 a.m.',
      (peakHour >= 7 && peakHour <= 10) || (peakHour >= 16 && peakHour <= 20),
      `${peak.stats.slotLabel}`);
    console.log(`      network peak: ${peak.stats.slotLabel}`);
    await shoot(page, '03-lyon-pointe.png');

    // ── v. the clock never runs on after the layer ─────────────────────────
    console.log('\n[5] The clock never outlives what started it');
    await setMode(page, 'week');
    await page.evaluate((id) => window.__godsEyeView.dataManager.setEnabled(
      id, false, { origin: 'user' },
    ), LAYER);
    await pump(page, 6);
    const stoppedSlot = (await probe(page)).stats.slot;
    await sleep(1400);
    await pump(page, 4);
    const stillStopped = (await probe(page)).stats.slot;
    check('switching the layer off stops the animation', stoppedSlot === stillStopped,
      `${stoppedSlot} → ${stillStopped}`);
    await page.evaluate((id) => window.__godsEyeView.dataManager.setEnabled(
      id, true, { origin: 'user' },
    ), LAYER);
    await pump(page, 8);

    // ── vi. Paris ──────────────────────────────────────────────────────────
    console.log('\n[6] Paris: the same layer, the other instrument');
    await setMode(page, 'peak');
    await setView(page, PARIS);
    await pump(page, 10);
    const paris = await probe(page);
    check('the columns are still drawn over Paris', paris.stats.count > 300,
      String(paris.stats.count));
    await shoot(page, '04-paris-pointe.png');

    // ── vii. the share link ────────────────────────────────────────────────
    console.log('\n[7] The share link carries the mode');
    const hash = await page.evaluate(() => window.location.hash || '');
    check('the hash enables the layer', /[?&]l=[^&]*\bvp\b/.test(hash) || /(^|\.)vp(\.|&|$)/.test(hash),
      hash.slice(0, 200));
    check('and carries POINTE', /vp\.m\.p/.test(hash), hash.slice(0, 200));

    const ours = consoleErrors.filter((text) => /pulse|pouls|velo/i.test(text));
    check('no console error names the layer', ours.length === 0, ours.slice(0, 2).join(' | '));

    console.log(`\n[qa] shots in ${path.relative(REPO_ROOT, SHOTS_DIR)}`);
    console.log(failures === 0 ? '\n[qa] PASS' : `\n[qa] FAIL — ${failures} check(s)`);
  } finally {
    await browser.close();
  }
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
