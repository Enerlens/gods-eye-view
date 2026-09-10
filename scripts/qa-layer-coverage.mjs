#!/usr/bin/env node
/**
 * QA the territorial controls, in a real browser.
 *
 * `comptages-fr` draws 2 946 arcs of Paris street and nothing else on Earth. It
 * used to FOLLOW the « Trafic routier » row, so switching road traffic on over
 * Tokyo switched it on too and contributed seven hour chips to a strip of
 * fifteen — all steering a layer with no payload.
 *
 * The unit tests pin the tables and the composition. What only a live page can
 * answer is whether the STRIP a reader actually sees changes when the camera
 * moves, and whether the card that explains the layer opens, briefs, and takes
 * the camera where it promised:
 *
 *   1. Over Tokyo, ON carries `road-status-fr` and leaves `comptages-fr` off.
 *   2. The strip holds no hour chip, and the chip that names Paris is dimmed.
 *   3. Pressing it opens the card rather than switching the layer on.
 *   4. « Aller à Paris » arms the layer and moves the camera into coverage.
 *   5. Once there, the seven hour chips are back and nothing is dimmed.
 *   6. Over Paris, `road-status-fr` is the one that goes quiet — DIRIF publishes
 *      nothing — and the reciprocal is legible on one strip.
 *   7. Pressing the chip over Paris switches the layer on with NO card.
 *
 * Clicks go through the DOM, never `page.click()`: this app's canvas swallows
 * puppeteer's synthesized pointer events and the call hangs until the protocol
 * timeout, while `page.evaluate` answers in a millisecond.
 *
 * Usage: node scripts/qa-layer-coverage.mjs [--url http://localhost:4174] [--headful]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const args = process.argv.slice(2);
const getOpt = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = getOpt('--url', 'http://localhost:4174').replace(/\/$/, '');
const HEADFUL = args.includes('--headful');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS_DIR = path.join(ROOT, 'qa-shots', 'layer-coverage');

const CHROME_CANDIDATES = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  (() => { try { return puppeteer.executablePath(); } catch { return null; } })(),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const chrome = CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate));

const TOKYO = { lon: 139.70, lat: 35.68 };
const PARIS = { lon: 2.34, lat: 48.86 };

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Render N frames by hand: headless WebGL can stall the rAF loop outright. */
async function pump(page, frames = 6, gapMs = 80) {
  for (let frame = 0; frame < frames; frame += 1) {
    await page.evaluate(() => {
      try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled context */ }
    });
    await sleep(gapMs);
  }
}

/**
 * Poll a predicate WHILE RENDERING.
 *
 * `page.waitForFunction` waits without ever driving the page, and this app is
 * headless on SwiftShader, where the frame loop stalls: nothing that needs a
 * frame to advance ever advances inside such a wait. Two things here need one —
 * a Cesium `flyTo`, which is stepped by `scene.render()`, and a CSS opacity
 * transition, whose computed value is resolved against the same clock. Waiting
 * without pumping reports a card that never opened and a flight that never
 * left, and both would be artifacts of the harness.
 */
async function waitWhileRendering(page, predicate, { timeout = 60000, gapMs = 120 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate)) return true;
    await pump(page, 1, gapMs);
  }
  return false;
}

/**
 * Teleport, then make the panel read the arrival.
 *
 * `setView` fires no `moveEnd`, and `moveEnd` is what the coverage watch
 * listens to — deliberately, because `camera.changed` goes quiet up to 0,8 s
 * before a real flight settles. So the harness raises it itself rather than
 * asserting against a panel that was never told the camera moved.
 */
async function setView(page, lon, lat, height = 12_000) {
  await page.evaluate((lo, la, h) => {
    const gev = window.__godsEyeView;
    const ellipsoid = gev.viewer.scene.globe?.ellipsoid || gev.viewer.scene.ellipsoid;
    const d2r = Math.PI / 180;
    try { gev.viewer.camera.cancelFlight(); } catch { /* no flight active */ }
    gev.viewer.camera.setView({
      destination: ellipsoid.cartographicToCartesian({ longitude: lo * d2r, latitude: la * d2r, height: h }),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    gev.viewer.camera.moveEnd.raiseEvent();
    gev.viewer.scene.requestRender?.();
  }, lon, lat, height);
  await pump(page, 4);
}

/**
 * Wait for the page's main thread to answer a trivial question.
 *
 * Photorealistic Paris on SwiftShader blocks it for seconds at a time. Nothing
 * below this point needs a frame — they are DOM reads — but they do need the
 * thread, and asking for it once is how a harness reports a failure that is
 * really a stall.
 */
async function settlePage(page, { attempts = 20, gapMs = 1000 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await page.evaluate(() => true);
      return true;
    } catch {
      await sleep(gapMs);
    }
  }
  return false;
}

/** Evaluate, retrying past the stalls above rather than failing on one. */
async function retryWithArg(page, fn, arg, { attempts = 8, gapMs = 1500 } = {}) {
  let last = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return arg === undefined ? await page.evaluate(fn) : await page.evaluate(fn, arg);
    } catch (error) {
      last = error;
      await sleep(gapMs);
    }
  }
  throw last;
}

const retry = (page, fn, options) => retryWithArg(page, fn, undefined, options);

/** The traffic row's strip, as a reader sees it. Runs IN the page. */
const readStripInPage = () => {
  const row = document.querySelector('[data-layer-id="traffic"]');
  if (!row) return null;
  return [...row.querySelectorAll('.data-toggle-chip')].map((chip) => ({
    label: chip.textContent,
    dimmed: chip.classList.contains('chip-offcoverage'),
    disabled: chip.disabled === true,
    title: chip.title,
    // What the reader's eye actually receives, read off the live cascade.
    opacity: Number.parseFloat(window.getComputedStyle(chip).opacity || '1'),
    borderStyle: window.getComputedStyle(chip).borderTopStyle,
  }));
};

const readStrip = (page) => page.evaluate(readStripInPage);

/**
 * Press a chip by its visible label, THROUGH THE DOM.
 *
 * Never `page.click()`: this app's canvas swallows puppeteer's synthesized
 * pointer events and the call hangs until the protocol timeout, while a DOM
 * click answers in a millisecond.
 */
function pressChip(page, label) {
  return retryWithArg(page, (wanted) => {
    const row = document.querySelector('[data-layer-id="traffic"]');
    const chip = [...(row?.querySelectorAll('.data-toggle-chip') || [])]
      .find((node) => node.textContent === wanted);
    if (!chip) return false;
    chip.click();
    return true;
  }, label);
}

/** Whether the briefing card is on screen, and what it says. Runs IN the page. */
const readCardInPage = () => {
    const node = document.getElementById('coverage-briefing');
    if (!node) return { present: false };
    const styles = window.getComputedStyle(node);
    const visible = !node.hidden && styles.display !== 'none'
      && Number.parseFloat(styles.opacity || '1') > 0.01;
    return {
      present: true,
      visible,
      // The class the code SETS, as opposed to where the opacity transition
      // has got to. On a page whose compositor is starved the two disagree for
      // seconds at a time, and only one of them is under test here.
      revealed: node.classList.contains('visible'),
      opacity: Number.parseFloat(styles.opacity || '0'),
      title: node.querySelector('[data-coverage-title]')?.textContent || '',
      scope: node.querySelector('[data-coverage-scope]')?.textContent || '',
      lines: [...node.querySelectorAll('[data-coverage-body] p')].map((p) => p.textContent),
      gotoLabel: node.querySelector('[data-coverage-goto-label]')?.textContent || '',
      gotoHidden: node.querySelector('[data-coverage-choice="goto"]')?.hidden === true,
    };
};

const readCard = (page) => retry(page, readCardInPage);

const isEnabled = (page, id) => retryWithArg(
  page, (layerId) => window.__godsEyeView.dataManager.isEnabled(layerId), id,
);

const HOUR_CHIPS = ['Moyenne ouvrée', 'À cette heure', 'Sem. 04 h', 'Sem. 08 h', 'Sem. 18 h', 'W-E 04 h', 'W-E 18 h'];
const countHourChips = (strip) => strip.filter((chip) => HOUR_CHIPS.includes(chip.label)).length;

async function shoot(page, name) {
  try {
    // The traffic row sits well below the fold of a panel holding thirty
    // layers, so a screenshot of the default scroll position proves nothing
    // about the one strip this harness exists to look at.
    await page.evaluate(() => {
      document.querySelector('[data-layer-id="traffic"]')
        ?.scrollIntoView({ block: 'center' });
      try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled */ }
    });
    await page.screenshot({ path: path.join(SHOTS_DIR, name) });
  } catch (error) {
    console.log(`  · screenshot ${name} unavailable (${String(error?.message || error).split('\n')[0]})`);
  }
}

async function main() {
  if (!chrome) {
    console.error('[qa] no Chrome found — set PUPPETEER_EXECUTABLE_PATH');
    process.exit(2);
  }
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: !HEADFUL,
    executablePath: chrome,
    args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000 },
    protocolTimeout: 180000,
  });

  try {
    const page = await newQaPage(browser);
    // A refused flight and a thrown briefing both report themselves through
    // `console.warn` and nowhere else. Without this the harness sees only the
    // consequence — a camera that did not move — and has to guess the cause.
    const pageLog = [];
    page.on('console', (message) => {
      const type = message.type();
      if (type !== 'warning' && type !== 'error') return;
      const text = message.text();
      if (/coverage|Comptages|comptages-fr|flight/i.test(text)) pageLog.push(text.slice(0, 300));
    });
    page.on('pageerror', (error) => pageLog.push(`pageerror: ${String(error?.message || error)}`));
    console.log(`[qa] booting ${APP_URL}`);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(
      () => window.__godsEyeView?.viewer && window.__godsEyeView?.dataManager,
      { timeout: 60000, polling: 200 },
    );
    await sleep(2000);
    // The panel ships collapsed; the rows have to exist before anything here
    // can read a chip off one.
    await page.evaluate(() => {
      document.querySelector('#data-panel')?.classList.remove('collapsed');
    });

    // ── 1 & 2. Over Tokyo ──────────────────────────────────────────────────
    console.log('[qa] 1-2. over Tokyo');
    await setView(page, TOKYO.lon, TOKYO.lat);
    // FIRE AND FORGET, deliberately. `_setRowEnabled` resolves only once the
    // road graph has come back from Overpass, which can take tens of seconds
    // from this machine — and an `evaluate` that awaits it hits the CDP
    // protocol timeout and kills the harness before a single assertion runs.
    // What is under test here is the panel, and the panel is repainted by the
    // enable INTENT, not by the fetch.
    await page.evaluate(() => {
      void window.__godsEyeView.dataManager._setRowEnabled('traffic', true);
    });
    // Generous, and it has to be: `traffic` over Tokyo waits on Overpass for a
    // road graph, and the follower settles behind it. Measured at ~6 s on an
    // idle machine and well past 30 s with another build running beside it.
    check('the row toggle settled', await waitWhileRendering(
      page,
      () => window.__godsEyeView.dataManager.isEnabled('road-status-fr'),
      { timeout: 90000 },
    ));
    await sleep(800);
    await pump(page, 4);

    check('the row toggle carries the national companion', await isEnabled(page, 'road-status-fr'));
    check(
      'and leaves the Paris-only layer off',
      (await isEnabled(page, 'comptages-fr')) === false,
    );

    let strip = await readStrip(page);
    check('the strip holds no hour chip over Tokyo', countHourChips(strip) === 0,
      `${countHourChips(strip)} found of ${strip.length} chips`);
    const parisChip = strip.find((chip) => chip.label === 'Comptages · Paris');
    check('the chip that names Paris is still there', !!parisChip);
    check('it is dimmed', parisChip?.dimmed === true, `opacity ${parisChip?.opacity}`);
    check('it is dashed, so the state survives a hue-free preset',
      parisChip?.borderStyle === 'dashed', String(parisChip?.borderStyle));
    check('it is NOT disabled — clicking is how you ask to be taken there',
      parisChip?.disabled === false);
    check('its tooltip says where it works and offers the flight',
      /Paris intra-muros/.test(parisChip?.title || '') && /Cliquer pour y aller/.test(parisChip?.title || ''),
      parisChip?.title);
    await shoot(page, '01-tokyo-strip.png');

    // ── 3. The card ────────────────────────────────────────────────────────
    console.log('[qa] 3. the card');
    check('the chip was found and pressed', await pressChip(page, 'Comptages · Paris'));
    const opened = await waitWhileRendering(
      page,
      () => {
        const node = document.getElementById('coverage-briefing');
        return !!node && !node.hidden && node.classList.contains('visible');
      },
      { timeout: 20000 },
    );
    const card = await readCard(page);
    // `revealed` is the assertion; `opacity` rides along as evidence, because a
    // card that is revealed and stuck at zero opacity would be a real defect
    // and this is where it would show up.
    check('the card opened instead of the layer', opened && card.revealed === true,
      `opacity ${card.opacity}`);
    check('the layer is still off while the question is open',
      (await isEnabled(page, 'comptages-fr')) === false);
    check('it says what the layer is', /Comptages/.test(card.title), card.title);
    check('it carries three lines', card.lines.length === 3, String(card.lines.length));
    check('it makes the distinction the layer rests on',
      card.lines.some((line) => /pas de la congestion/i.test(line)));
    check('it never says live', !card.lines.some((line) => /\blive\b/i.test(line)));
    check('it names the destination', card.gotoLabel === 'Aller à Paris', card.gotoLabel);
    await shoot(page, '02-card.png');

    // ── 4 & 5. The flight ──────────────────────────────────────────────────
    console.log('[qa] 4-5. the flight');
    await retry(page, () => {
      document.querySelector('[data-coverage-choice="goto"]')?.click();
    });

    check('the layer is armed by the answer', await waitWhileRendering(
      page,
      () => window.__godsEyeView.dataManager.isEnabled('comptages-fr'),
      { timeout: 60000 },
    ));
    check('the layer is armed before the camera lands', await isEnabled(page, 'comptages-fr'));
    // A Cesium flight is stepped by `scene.render()`, so it only leaves while
    // something is rendering. That is what `waitWhileRendering` is for.
    const arrived = await waitWhileRendering(page, () => {
      const gev = window.__godsEyeView;
      const carto = gev?.viewer?.camera?.positionCartographic;
      if (!carto) return false;
      const lon = (carto.longitude * 180) / Math.PI;
      const lat = (carto.latitude * 180) / Math.PI;
      return lon > 1.5 && lon < 3.2 && lat > 48.4 && lat < 49.3;
    }, { timeout: 60000 });
    check('the flight completed', arrived,
      arrived ? '' : `page said: ${pageLog.join(' ¶ ') || '(nothing)'}`);
    // Paris in photorealistic 3D on SwiftShader pins the page's main thread for
    // seconds at a time, and an `evaluate` that lands in one of those windows
    // hits the CDP timeout. Everything from here is a DOM read against a busy
    // page, so it is retried rather than trusted to answer first time.
    await settlePage(page);
    // `setView` fires no `moveEnd`, and neither does a flight the harness
    // stepped by hand, so the panel is told the camera arrived rather than left
    // waiting for an event nobody raised.
    await retry(page, () => window.__godsEyeView.viewer.camera.moveEnd.raiseEvent());
    const landed = await retry(page, () => {
      const carto = window.__godsEyeView.viewer.camera.positionCartographic;
      return {
        lon: (carto.longitude * 180) / Math.PI,
        lat: (carto.latitude * 180) / Math.PI,
      };
    });
    check('the camera is over Paris', landed.lat > 48.4 && landed.lat < 49.3,
      `${landed.lat.toFixed(3)} N / ${landed.lon.toFixed(3)} E`);
    check('the card closed behind it', (await readCard(page)).visible === false);

    check('the layer is still on after the flight', await isEnabled(page, 'comptages-fr'));
    strip = await retry(page, readStripInPage);
    check('the seven hour chips are back', countHourChips(strip) === 7,
      `${countHourChips(strip)} of 7 — strip is [${strip.map((chip) => chip.label).join(' | ')}]`);
    const litChip = strip.find((chip) => chip.label === 'Comptages · Paris');
    check('and the chip that named Paris is no longer dimmed', litChip?.dimmed === false);
    await shoot(page, '03-paris-strip.png');

    // ── 6. The reciprocal ──────────────────────────────────────────────────
    console.log('[qa] 6. the reciprocal');
    const status = strip.find((chip) => chip.label === 'État du réseau');
    check('over Paris the national road layer is the one that goes quiet',
      status?.dimmed === true, `opacity ${status?.opacity}`);
    check('and its tooltip names the operator rather than shrugging',
      /DIRIF/.test(status?.title || ''), status?.title);
    check('it offers no flight — a national layer is not somewhere to leave',
      !/Cliquer pour y aller/.test(status?.title || ''));

    // ── 7. No card where there is nothing to say ───────────────────────────
    console.log('[qa] 7. no card over Paris');
    // Waited on, not slept through: re-enabling this layer is a full lifecycle
    // — module, draw, ground floor — and a fixed 800 ms passes on an idle
    // machine and fails beside another build. What is under test is that no
    // card appears, so the card is read at the moment the toggle settles.
    await pressChip(page, 'Comptages · Paris');
    check('pressing it OFF turns it off', await waitWhileRendering(
      page,
      () => window.__godsEyeView.dataManager.isEnabled('comptages-fr') === false,
      { timeout: 30000 },
    ));
    check('and raises no card', (await readCard(page)).visible === false);

    await pressChip(page, 'Comptages · Paris');
    check('pressing it ON over Paris turns it on', await waitWhileRendering(
      page,
      () => window.__godsEyeView.dataManager.isEnabled('comptages-fr'),
      { timeout: 30000 },
    ));
    check('and raises no card either', (await readCard(page)).visible === false);

    console.log(failures === 0
      ? `\n[qa] PASS — shots in ${path.relative(ROOT, SHOTS_DIR)}`
      : `\n[qa] ${failures} FAILED — shots in ${path.relative(ROOT, SHOTS_DIR)}`);
  } finally {
    await browser.close();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('[qa] harness error:', error);
  process.exit(2);
});
