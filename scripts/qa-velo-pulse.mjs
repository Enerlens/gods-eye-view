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
 *   i.    both cities draw — 450 Vélo'v stations over Lyon and 111 counters
 *         over Paris, from one shipped pack, as one heat field
 *   ii.   the hour on screen is the hour of the week it currently is, so a
 *         reader opening the globe on a Tuesday morning sees a Tuesday morning
 *   iii.  SEMAINE really animates, and it animates BETWEEN the hours: the
 *         position advances by fractions of an hour at a readable pace, the
 *         field changes with it, and the legend's band counts move
 *   iv.   the panel under the globe says what is happening — the hour in
 *         words, what the network is doing at it, and the week as a strip —
 *         and it is ON SCREEN, which the anchored card is not obliged to be
 *   v.    that strip is a transport: a click on it pauses the week on the hour
 *         asked for, and the play button resumes from exactly there
 *   vi.   POINTE lands on the network's busiest hour, and it is a commuting
 *         hour rather than the middle of the night — the layer's whole claim
 *   vii.  leaving SEMAINE stops the clock, and so does switching the layer off:
 *         an animation left running holds continuous render forever
 *   viii. a clicked site fills the panel's fiche — the copy of the answer that
 *         cannot be hidden — and names its instrument, because a Lyon stock
 *         and a Paris flow are not the same quantity
 *   ix.   the share link carries the mode
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
 * Low and NEARLY FLAT ON. The heat field is a surface: it is read from above,
 * the way a density map is, and the oblique 55° framing this harness used for
 * the extruded columns now stacks the near blobs over the far ones and hides
 * half the city behind the other half. 5 km at 15° off nadir keeps the streets
 * legible under the field without foreshortening it.
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
      orientation: { heading: 0, pitch: -Math.PI / 2.4, roll: 0 },
    });
    gev.viewer.scene.requestRender?.();
  }, lon, lat, height);
  await pump(page, 8);
}

function probe(page) {
  return page.evaluate((id) => {
    const module = window.__godsEyeView.dataManager.layers.get(id).module;
    const controls = module.getRowControls();
    const panel = document.getElementById('velo-pulse-hud');
    const box = panel?.getBoundingClientRect();
    const site = panel?.querySelector('[data-pulse-site]');
    return {
      stats: module.getStats(),
      chips: controls.chips.map((chip) => ({ id: chip.id, active: chip.active })),
      legend: controls.legend.map((row) => ({ label: row.label, count: row.count })),
      hud: panel ? {
        hour: panel.querySelector('[data-pulse-hour]')?.textContent || '',
        phase: panel.querySelector('[data-pulse-phase]')?.textContent || '',
        legend: panel.querySelector('[data-pulse-legend]')?.textContent || '',
        cursor: panel.querySelector('[data-pulse-cursor]')?.style.left || '',
        play: panel.querySelector('.velo-pulse-play-label')?.textContent || '',
        siteOpen: site ? site.hidden === false : false,
        siteName: panel.querySelector('[data-pulse-site-name]')?.textContent || '',
        siteLines: [...panel.querySelectorAll('[data-pulse-site-lines] li')].map((li) => li.textContent),
        // On screen means ON SCREEN: inside the viewport, painted, and not
        // parked behind the command dock.
        onScreen: Boolean(box) && box.width > 200 && box.height > 80
          && box.top >= 0 && box.left >= 0
          && box.bottom <= window.innerHeight && box.right <= window.innerWidth,
        box: box ? { top: Math.round(box.top), bottom: Math.round(box.bottom) } : null,
      } : null,
    };
  }, LAYER);
}

/** The window position of one drawn site, or null when it is off screen. */
function siteWindowPosition(page, siteId) {
  return page.evaluate((id, target) => {
    const gev = window.__godsEyeView;
    const module = gev.dataManager.layers.get(id).module;
    const stats = module.getStats();
    if (!stats.count) return null;
    const scene = gev.viewer.scene;
    const collections = [];
    for (let index = 0; index < scene.primitives.length; index += 1) {
      const primitive = scene.primitives.get(index);
      if (primitive?.constructor?.name === 'BillboardCollection') collections.push(primitive);
    }
    const collection = collections.find((entry) => entry.length > 100);
    if (!collection) return null;
    for (let index = 0; index < collection.length; index += 1) {
      const billboard = collection.get(index);
      const billboardId = typeof billboard.id === 'string' ? billboard.id : null;
      if (!billboardId || (target && billboardId !== target)) continue;
      const picked = scene.cartesianToCanvasCoordinates(billboard.position);
      if (!picked) continue;
      const { clientWidth, clientHeight } = scene.canvas;
      if (picked.x < 60 || picked.y < 60 || picked.x > clientWidth - 60 || picked.y > clientHeight - 320) continue;
      return { id: billboardId, x: Math.round(picked.x), y: Math.round(picked.y) };
    }
    return null;
  }, LAYER, siteId || null);
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
    // POLLED ON A TIMER, not on animation frames. Puppeteer's default waits on
    // requestAnimationFrame, and this app runs an idle render governor that
    // stops producing frames the moment nothing animates — a headless boot can
    // therefore park with everything ready and no frame in which to notice.
    await page.waitForFunction(
      () => Boolean(window.__godsEyeView?.dataManager),
      { timeout: 60000, polling: 300 },
    );
    await pump(page, 6);

    // ── i. the pack loads and both cities draw ─────────────────────────────
    console.log('\n[1] One shipped pack, two cities, two instruments');
    await setView(page, LYON);
    await page.evaluate((id) => window.__godsEyeView.dataManager.setEnabled(
      id, true, { origin: 'user' },
    ), LAYER);
    await page.waitForFunction(
      (id) => (window.__godsEyeView.dataManager.layers.get(id).module.getStats().sites ?? 0) > 0,
      { timeout: 30000, polling: 300 }, LAYER,
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
    // PARIS TIME, not the machine's. The harness runs on whatever zone the
    // laptop is set to; asserting against `getHours()` would have passed
    // everywhere and hidden the very bug the layer had.
    const expected = await page.evaluate(() => {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Europe/Paris', weekday: 'short', hour: '2-digit', hourCycle: 'h23',
      }).formatToParts(new Date());
      const days = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
      const day = days[parts.find((part) => part.type === 'weekday')?.value] ?? 0;
      const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
      return day * 24 + (hour % 24);
    });
    check('the slot is the current hour of the week', first.stats.slot === expected,
      `${first.stats.slot} vs ${expected}`);
    check('and the row says so in words', /h$/.test(first.stats.slotLabel || ''),
      first.stats.slotLabel);

    // ── iii. the animation, between the hours ──────────────────────────────
    console.log('\n[3] SEMAINE animates on its own, and it animates SMOOTHLY');
    await setMode(page, 'week');
    const before = await probe(page);
    // MEASURED IN THE PAGE, not across the wire. A CDP round trip under
    // swiftshader can cost the better part of a second, and a pace computed
    // from timestamps taken on this side of it reported 317 ms an hour for a
    // clock genuinely running at 523.
    const pace = await page.evaluate(async (id) => {
      const module = window.__godsEyeView.dataManager.layers.get(id).module;
      const started = performance.now();
      const from = module.getStats().position;
      const seen = [];
      for (let step = 0; step < 8; step += 1) {
        await new Promise((resolve) => { setTimeout(resolve, 250); });
        seen.push(module.getStats().position);
      }
      const elapsed = performance.now() - started;
      const to = seen[seen.length - 1];
      return { from, to, elapsed, seen, hours: ((to - from) + 168) % 168 };
    }, LAYER);
    const after = await probe(page);
    check('the hour advanced by itself', after.stats.slot !== before.stats.slot,
      `${before.stats.slot} → ${after.stats.slot}`);
    // The pace is half the fix: 520 ms an hour rather than 220, so a whole
    // week takes about 87 seconds and a reader can watch a peak arrive.
    const msPerHour = pace.hours > 0 ? pace.elapsed / pace.hours : Infinity;
    check('it is paced for a reader, not for a stopwatch',
      msPerHour > 420 && msPerHour < 650, `${Math.round(msPerHour)} ms per hour`);
    // The other half: it moves BETWEEN the hours. 168 whole-hour jumps is the
    // strobe this layer shipped with, and a whole-number position every time
    // would mean it is back.
    const fractional = pace.seen.filter((value) => Math.abs(value - Math.round(value)) > 0.02);
    check('and it eases between them rather than jumping hour to hour',
      fractional.length >= pace.seen.length - 1,
      pace.seen.map((value) => value.toFixed(2)).join(' '));
    check('and the legend moved with it',
      JSON.stringify(after.legend) !== JSON.stringify(before.legend),
      JSON.stringify(after.legend));
    check('every site is still accounted for in exactly one band',
      after.legend.reduce((sum, row) => sum + row.count, 0) === after.stats.count,
      `${after.legend.reduce((sum, row) => sum + row.count, 0)} vs ${after.stats.count}`);
    // A blob's colour has to be able to sit BETWEEN two bands, or the field is
    // still stepping through five states 168 times a week.
    const offBand = await page.evaluate(() => {
      const scene = window.__godsEyeView.viewer.scene;
      let collection = null;
      for (let index = 0; index < scene.primitives.length; index += 1) {
        const primitive = scene.primitives.get(index);
        if (primitive?.constructor?.name === 'BillboardCollection' && primitive.length > 100) {
          collection = primitive;
        }
      }
      if (!collection) return null;
      const anchors = new Set(['44,62,107', '59,123,181', '73,179,176', '240,192,74', '232,96,60', '74,85,104']);
      let between = 0;
      let total = 0;
      for (let index = 0; index < collection.length; index += 1) {
        const colour = collection.get(index).color;
        if (!colour) continue;
        total += 1;
        const key = [colour.red, colour.green, colour.blue]
          .map((channel) => Math.round(channel * 255)).join(',');
        if (!anchors.has(key)) between += 1;
      }
      return { between, total };
    });
    check('the field paints colours BETWEEN the legend\'s five bands',
      Boolean(offBand) && offBand.between > offBand.total * 0.5,
      JSON.stringify(offBand));

    await shoot(page, '02-lyon-semaine.png');

    // ── iv. the panel that says what is happening ──────────────────────────
    console.log('\n[4] The panel under the globe explains the animation');
    check('the panel is mounted', Boolean(after.hud), 'no #velo-pulse-hud');
    check('and it is on screen, not off the edge or under the dock',
      after.hud?.onScreen === true, JSON.stringify(after.hud?.box));
    check('it names the hour being drawn, in words',
      after.hud?.hour?.toLowerCase().includes(after.stats.slotLabel.split(' ')[0]),
      `${after.hud?.hour} vs ${after.stats.slotLabel}`);
    check('it says what the network is doing at that hour',
      Boolean(after.hud?.phase) && after.hud.phase !== 'heure non relevée', after.hud?.phase);
    check('it says what a colour and a size mean',
      /couleur/.test(after.hud?.legend || '') && /surface/.test(after.hud?.legend || ''),
      (after.hud?.legend || '').slice(0, 80));
    check('and both cities are named with their instrument',
      /STOCK/.test(after.hud?.legend || '') && /FLUX/.test(after.hud?.legend || ''),
      (after.hud?.legend || '').slice(0, 160));
    check('the cursor rides the week strip',
      /%$/.test(after.hud?.cursor || ''), after.hud?.cursor);
    check('and the transport offers a pause while it runs',
      after.hud?.play === 'PAUSE', after.hud?.play);

    // ── v. the strip is the transport ──────────────────────────────────────
    console.log('\n[5] The week strip is a control, not a decoration');
    const stripBox = await page.evaluate(() => {
      const strip = document.querySelector('#velo-pulse-hud [data-pulse-strip]');
      if (!strip) return null;
      const box = strip.getBoundingClientRect();
      return { x: box.left, y: box.top, w: box.width, h: box.height };
    });
    check('the strip is there and is wide enough to aim at',
      Boolean(stripBox) && stripBox.w > 300, JSON.stringify(stripBox));
    if (stripBox) {
      // A quarter of the way across the week is Tuesday morning; the exact hour
      // is whatever pixel lands, so the assertion is on the DAY and on the fact
      // that the clock stopped there.
      await page.mouse.click(stripBox.x + stripBox.w * 0.25, stripBox.y + stripBox.h / 2);
      await pump(page, 4);
      const scrubbed = await probe(page);
      const parked = scrubbed.stats.slot;
      check('clicking the strip lands on the hour under the cursor',
        parked >= 36 && parked <= 48, `slot ${parked} — ${scrubbed.stats.slotLabel}`);
      check('and it stops the week there', scrubbed.stats.playing === false,
        `playing ${scrubbed.stats.playing}`);
      check('the panel says so', scrubbed.hud?.play === 'DÉROULER', scrubbed.hud?.play);
      await sleep(1200);
      const stillParked = await probe(page);
      check('a paused week really is paused', stillParked.stats.slot === parked,
        `${parked} → ${stillParked.stats.slot}`);
      await shoot(page, '03-semaine-en-pause.png');
      // And play resumes from exactly there rather than from the top of the
      // week. Pressed and read in the same page turn, before the clock's first
      // tick, so what is proved is the resume point and not the round trip.
      const resumed = await page.evaluate((id) => {
        const module = window.__godsEyeView.dataManager.layers.get(id).module;
        const paused = module.getStats().position;
        document.querySelector('#velo-pulse-hud [data-pulse-play]').click();
        const stats = module.getStats();
        return { paused, position: stats.position, playing: stats.playing };
      }, LAYER);
      check('play resumes from the hour the reader chose, not from Monday',
        resumed.playing === true && resumed.position === resumed.paused,
        `${resumed.paused} → ${resumed.position}`);
      await pump(page, 3);
    }

    // ── vi. the peak ───────────────────────────────────────────────────────
    console.log('\n[6] POINTE lands on a commuting hour, which is the layer\'s claim');
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
    await shoot(page, '04-lyon-pointe.png');

    // ── vii. the clock never runs on after the layer ───────────────────────
    console.log('\n[7] The clock never outlives what started it');
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

    // ── viii. a clicked site, and the answer that cannot be hidden ─────────
    console.log('\n[8] A clicked site fills the fiche the keyhole cannot fade');
    await setMode(page, 'peak');
    await setView(page, LYON);
    await pump(page, 8);
    const target = await siteWindowPosition(page);
    check('a drawn site can be aimed at', Boolean(target), 'none on screen');
    if (target) {
      await page.mouse.click(target.x, target.y);
      await pump(page, 6);
      const picked = await probe(page);
      check('the fiche opened', picked.hud?.siteOpen === true, JSON.stringify(picked.hud?.box));
      check('it names the site', Boolean(picked.hud?.siteName), picked.hud?.siteName);
      const lines = (picked.hud?.siteLines || []).join(' | ');
      check('it names the instrument, because two cities do not share one',
        /Mesure un (STOCK|FLUX)/.test(lines), lines.slice(0, 120));
      check('it prints a reading in that city\'s own unit',
        /% pleine|cyclistes par heure|non échantillonné/.test(lines), lines.slice(0, 120));
      check('it says which four weeks it is averaging',
        /2026-06-01 → 2026-06-28/.test(lines), lines.slice(0, 200));
      check('and the fiche is on screen, which the anchored card need not be',
        picked.hud?.onScreen === true, JSON.stringify(picked.hud?.box));
      await shoot(page, '05-fiche-site.png');
    }

    // ── ix. Paris ──────────────────────────────────────────────────────────
    console.log('\n[9] Paris: the same layer, the other instrument');
    await setView(page, PARIS);
    await pump(page, 10);
    const paris = await probe(page);
    check('the field is still drawn over Paris', paris.stats.count > 300,
      String(paris.stats.count));
    await shoot(page, '06-paris-pointe.png');

    // ── x. the share link ──────────────────────────────────────────────────
    console.log('\n[10] The share link carries the mode');
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
