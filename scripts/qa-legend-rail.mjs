#!/usr/bin/env node
/**
 * QA the map legend's move into the right rail, in a real browser.
 *
 * The legend used to be a fixed card in the bottom-left corner, switched OFF by
 * a stylesheet rule the moment DATA LAYERS opened. Everything below is a claim
 * that can only be checked against a live cascade and a live layout pass:
 *
 *   1. The key is a MEMBER of `#right-context-rail`, painted inside its box.
 *   2. Opening DATA LAYERS no longer takes it away — the whole point.
 *   3. It LEADS the rail, so it is the panel the auto-collapse pass spares.
 *   4. Its collapse button works and survives a reload (localStorage).
 *   5. The list scrolls inside the height the rail allocates it.
 *   6. Cockpit still shows it, in the corner, because the rail's own column is
 *      where Cockpit puts DISPLAY and RADIO.
 *   7. Nothing named "bloom" is left in DISPLAY.
 *
 * Usage: node scripts/qa-legend-rail.mjs [--url http://localhost:4174] [--headful]
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
const SHOT_DIR = path.join(ROOT, 'qa-shots', 'legend-rail');

/** Layers with a rich key, so the legend has real height to allocate. */
const LEGEND_LAYERS = ['earthquakes', 'flights', 'local-airports'];

const CHROME_CANDIDATES = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  (() => { try { return puppeteer.executablePath(); } catch { return null; } })(),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  [${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Shots are evidence, not a check. Cesium under headless ANGLE occasionally
 * stalls `Page.captureScreenshot` past the protocol timeout; losing the frame
 * must not cost the run the assertions that already passed.
 */
async function shoot(page, name) {
  try {
    await page.screenshot({ path: path.join(SHOT_DIR, name) });
    return true;
  } catch (error) {
    console.log(`  [\x1b[33mSKIP\x1b[0m] shot ${name} — ${String(error.message).slice(0, 80)}`);
    return false;
  }
}

/**
 * Drive one animation frame and let the rail's layout pass run.
 *
 * The pass is scheduled with `requestAnimationFrame`, and a Cesium scene in
 * `requestRenderMode` that has gone idle produces no frames — headless
 * Chromium then leaves the callback pending indefinitely and every geometry
 * read below sees a rail that has never been laid out. Two frames: one to
 * flush whatever was already queued, one for the pass this awaits.
 */
async function settleLayout(page) {
  await page.evaluate(() => new Promise((resolve) => {
    window.__godsEyeView?.styleManager?.viewer?.scene?.requestRender?.();
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

async function waitFor(page, check, { timeoutMs = 60_000, everyMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(check);
    if (last) return last;
    await sleep(everyMs);
  }
  return last;
}

/** Everything the checks need about the legend, read in one page pass. */
const readLegend = () => {
  const legend = document.getElementById('map-legend');
  const rail = document.getElementById('right-context-rail');
  const items = document.getElementById('map-legend-items');
  if (!legend || !rail) return null;
  const style = getComputedStyle(legend);
  const box = legend.getBoundingClientRect();
  const railBox = rail.getBoundingClientRect();
  const members = [...rail.children]
    .filter((child) => child.matches('[data-panel-id]'))
    .map((child) => child.id);
  return {
    inRail: rail.contains(legend),
    hidden: legend.hidden,
    collapsed: legend.classList.contains('collapsed'),
    position: style.position,
    pointerEvents: style.pointerEvents,
    visibility: style.visibility,
    display: style.display,
    firstMember: members[0] || null,
    members,
    box: { top: box.top, left: box.left, width: box.width, height: box.height },
    railBox: { top: railBox.top, left: railBox.left, width: railBox.width },
    entries: legend.querySelectorAll('.map-legend-entry').length,
    itemsScrollable: items ? items.scrollHeight > items.clientHeight + 1 : false,
    itemsOverflow: items ? getComputedStyle(items).overflowY : null,
    allocated: legend.style.getPropertyValue('--right-panel-allocated-height') || null,
  };
};

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const executablePath = CHROME_CANDIDATES.find((candidate) => {
    try { return fs.existsSync(candidate); } catch { return false; }
  });

  const browser = await puppeteer.launch({
    headless: HEADFUL ? false : 'new',
    ...(executablePath ? { executablePath } : {}),
    protocolTimeout: 180_000,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist',
      '--disable-dev-shm-usage', '--window-size=1440,900',
    ],
  });

  const consoleErrors = [];
  try {
    const page = await newQaPage(browser);
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300));
    });
    page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message.slice(0, 300)}`));

    console.log(`\nOpening ${APP_URL} …`);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });

    const ready = await waitFor(page, () => !!window.__godsEyeView?.dataManager);
    record('app boots and exposes the data manager', !!ready);
    if (!ready) return;

    // ── 7. DISPLAY has no bloom control left ──────────────────────────────
    const bloom = await page.evaluate(() => ({
      toggle: !!document.getElementById('bloom-toggle'),
      slider: !!document.getElementById('bloom-intensity-slider'),
      stage: !!window.__godsEyeView?.styleManager?.viewer?.scene
        ?.postProcessStages?.bloom?.enabled,
      facade: typeof window.__godsEyeView?.styleManager?.setBloom,
      sharpen: !!document.getElementById('sharpen-toggle'),
      hash: window.location.hash,
    }));
    record('the Bloom button and slider are gone from DISPLAY',
      !bloom.toggle && !bloom.slider, `toggle=${bloom.toggle} slider=${bloom.slider}`);
    record('the Cesium bloom stage is never switched on', bloom.stage === false,
      `scene.postProcessStages.bloom.enabled=${bloom.stage}`);
    record('the setBloom facade is gone', bloom.facade === 'undefined', `typeof=${bloom.facade}`);
    record('Sharpen survives the removal (D1: bloom only)', bloom.sharpen);
    record('a fresh share hash no longer writes bloom/bi/bv',
      !/[?&#](bloom|bi|bv)=/.test(bloom.hash), bloom.hash.slice(0, 120) || '(empty)');

    // ── The legend needs something to key ─────────────────────────────────
    await page.evaluate(async (ids) => {
      const dm = window.__godsEyeView.dataManager;
      for (const id of ids) {
        try {
          await dm.setEnabled(id, true, { origin: 'user' });
          await dm.waitForLayerSettled?.(id);
        } catch { /* a keyless build may not have every layer */ }
      }
    }, LEGEND_LAYERS);
    await waitFor(page, () => {
      const legend = document.getElementById('map-legend');
      return !!legend && !legend.hidden && legend.querySelectorAll('.map-legend-entry').length > 0;
    }, { timeoutMs: 45_000 });

    // Read the key's geometry BEFORE the layout pass has been given a frame:
    // the floor has to hold on its own, because a `requestRenderMode` scene
    // that goes idle can leave that frame pending indefinitely.
    const unlaid = await page.evaluate(() => {
      const legend = document.getElementById('map-legend');
      const rail = document.getElementById('right-context-rail');
      const box = legend.getBoundingClientRect();
      return {
        railLaidOut: !!rail.dataset.layoutMode,
        allocated: legend.style.getPropertyValue('--right-panel-allocated-height') || null,
        bottom: box.top + box.height,
        height: box.height,
      };
    });
    record('the key stays on screen even before the rail lays it out',
      unlaid.bottom <= 900 + 1,
      `bottom=${Math.round(unlaid.bottom)}px of 900`
        + ` (rail laid out: ${unlaid.railLaidOut}, allocation: ${unlaid.allocated || 'none'})`);

    await settleLayout(page);
    const shut = await page.evaluate(readLegend);
    record('the legend is painted, with entries', !!shut && !shut.hidden && shut.entries > 0,
      `${shut?.entries} entries, hidden=${shut?.hidden}`);

    // ── 1 & 3. A rail member, and the leading one ─────────────────────────
    record('the legend is a child of #right-context-rail', shut?.inRail === true);
    record('it LEADS the rail', shut?.firstMember === 'map-legend',
      `rail order: ${shut?.members.join(' → ')}`);
    record('it is laid out in flow, not floating over the rail',
      shut?.position === 'relative', `position: ${shut?.position}`);
    record('it takes back the pointer events the rail switches off',
      shut?.pointerEvents === 'auto', `pointer-events: ${shut?.pointerEvents}`);
    record('it is painted INSIDE the rail box',
      !!shut && Math.abs(shut.box.left - shut.railBox.left) < 40
        && shut.box.top >= shut.railBox.top - 2,
      `legend@${Math.round(shut?.box.left)},${Math.round(shut?.box.top)} rail@${Math.round(shut?.railBox.left)},${Math.round(shut?.railBox.top)}`);
    record('it sits in the right half of the viewport',
      !!shut && shut.box.left > 1440 / 2,
      `left=${Math.round(shut?.box.left)}px of 1440`);

    // Tactical HUD hides collapsed launchers while a panel is EXPANDED. The
    // key ships expanded, so counting it would take DISPLAY, CCTV and CONTEXT
    // off screen for anyone who merely enabled a layer.
    const launchers = await page.evaluate(() => {
      const rail = document.getElementById('right-context-rail');
      const painted = (id) => {
        const el = document.getElementById(id);
        return !!el && el.getBoundingClientRect().height > 0
          && getComputedStyle(el).display !== 'none';
      };
      return {
        exclusive: rail.classList.contains('layout-exclusive'),
        display: painted('pp-toggles'),
        cctv: painted('cctv-panel'),
        context: painted('global-context-panel'),
      };
    });
    record('an open key does not take the DISPLAY / CCTV / CONTEXT launchers away',
      launchers.display && launchers.cctv && launchers.context && !launchers.exclusive,
      `exclusive=${launchers.exclusive} display=${launchers.display} cctv=${launchers.cctv} context=${launchers.context}`);

    await shoot(page, '1-rail-panel-shut.png');

    // ── 2. DATA LAYERS no longer takes the key away ───────────────────────
    await page.evaluate(() => {
      window.__godsEyeView.styleManager.setPanelCollapsed('data-panel', false, { explicit: true });
    });
    await sleep(1200);
    await settleLayout(page);
    const withPanel = await page.evaluate(() => {
      const panel = document.getElementById('data-panel');
      const legend = document.getElementById('map-legend');
      const style = getComputedStyle(legend);
      const box = legend.getBoundingClientRect();
      const panelBox = panel.getBoundingClientRect();
      return {
        panelOpen: !panel.classList.contains('collapsed'),
        display: style.display,
        visibility: style.visibility,
        opacity: Number(style.opacity),
        width: box.width,
        height: box.height,
        overlapsPanel: box.left < panelBox.right && box.right > panelBox.left,
      };
    });
    record('DATA LAYERS opens', withPanel.panelOpen);
    record('the key SURVIVES an open DATA LAYERS — the whole point',
      withPanel.display !== 'none' && withPanel.visibility === 'visible'
        && withPanel.opacity > 0 && withPanel.width > 0 && withPanel.height > 0,
      `display=${withPanel.display} visibility=${withPanel.visibility} ${Math.round(withPanel.width)}×${Math.round(withPanel.height)}`);
    record('and the panel is nowhere near it', withPanel.overlapsPanel === false);
    await shoot(page, '2-rail-panel-open.png');

    // ── 5. The list scrolls inside the allocation ─────────────────────────
    await settleLayout(page);
    const scroll = await page.evaluate(readLegend);
    record('#map-legend-items is the scrolling surface',
      scroll?.itemsOverflow === 'auto' || scroll?.itemsOverflow === 'scroll',
      `overflow-y: ${scroll?.itemsOverflow}`);
    record('the rail allocates the key a height once it lays out',
      !!scroll?.allocated, `--right-panel-allocated-height: ${scroll?.allocated || 'unset'}`);
    record('the legend fits the viewport instead of growing past it',
      !!scroll && scroll.box.top + scroll.box.height <= 900 + 1,
      `bottom=${Math.round((scroll?.box.top || 0) + (scroll?.box.height || 0))}px of 900`
        + (scroll?.allocated ? ` (allocated ${scroll.allocated})` : ' (natural height)'));
    record('and the list is what gives — the key scrolls, it does not spill',
      scroll?.itemsScrollable === true,
      `items scrollHeight > clientHeight: ${scroll?.itemsScrollable}`);

    // ── 4. Collapse, and survive a reload ─────────────────────────────────
    await page.evaluate(() => {
      document.querySelector('.panel-collapse-btn[data-collapse-target="map-legend"]')?.click();
    });
    // The share hash is written on a 500 ms debounce, and a link's panel state
    // OVERRIDES localStorage on restore (`allowStored: !this._initialShareState`).
    // Reloading before the debounce lands would restore the PREVIOUS hash and
    // test nothing but the timer.
    const tokened = await waitFor(page, () => (
      /[=&#_]e\.c\.1(?:$|[&_])/.test(window.location.hash) ? window.location.hash : null
    ), { timeoutMs: 10_000, everyMs: 250 });
    const collapsed = await page.evaluate(() => {
      const legend = document.getElementById('map-legend');
      const items = document.getElementById('map-legend-items');
      const btn = document.querySelector('.panel-collapse-btn[data-collapse-target="map-legend"]');
      return {
        collapsed: legend.classList.contains('collapsed'),
        itemsDisplay: getComputedStyle(items).display,
        glyph: btn?.textContent?.trim() || null,
        headerVisible: legend.getBoundingClientRect().height > 0,
        stored: localStorage.getItem('godsEyeView.v6.panelCollapsed.map-legend'),
      };
    });
    record('the collapse button collapses the key', collapsed.collapsed === true);
    record('collapsed hides the list and keeps the header',
      collapsed.itemsDisplay === 'none' && collapsed.headerVisible,
      `items display=${collapsed.itemsDisplay}`);
    record('the glyph is the rail arrow, not the left stack +/−',
      collapsed.glyph === '◀', `glyph="${collapsed.glyph}"`);
    record('the choice is persisted', collapsed.stored === '1', `stored=${collapsed.stored}`);
    record('and it reaches the share link under its own token `e`', !!tokened,
      tokened ? `ui=${/ui=([^&]*)/.exec(tokened)?.[1] || ''}`.slice(0, 100) : 'no e.c.1 in the hash');

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90_000 });
    await waitFor(page, () => !!window.__godsEyeView?.dataManager);
    await sleep(2500);
    await settleLayout(page);
    const afterReload = await page.evaluate(() => (
      document.getElementById('map-legend')?.classList.contains('collapsed') ?? null
    ));
    record('and it survives a reload', afterReload === true, `collapsed=${afterReload}`);
    await page.evaluate(() => {
      window.__godsEyeView.styleManager.setPanelCollapsed('map-legend', false, { explicit: true });
    });

    // ── 6. Cockpit keeps the key, in the corner ───────────────────────────
    const cockpit = await page.evaluate(async () => {
      const sm = window.__godsEyeView.styleManager;
      document.body.classList.add('cockpit-mode');
      await new Promise((resolve) => { requestAnimationFrame(() => resolve()); });
      const legend = document.getElementById('map-legend');
      const rail = document.getElementById('right-context-rail');
      const display = document.getElementById('pp-toggles');
      const style = getComputedStyle(legend);
      const box = legend.getBoundingClientRect();
      const out = {
        legendVisibility: style.visibility,
        legendPosition: style.position,
        railVisibility: getComputedStyle(rail).visibility,
        displayVisibility: getComputedStyle(display).visibility,
        left: box.left,
        bottom: window.innerHeight - box.bottom,
        width: box.width,
      };
      document.body.classList.remove('cockpit-mode');
      void sm;
      return out;
    });
    record('Cockpit hides the rail', cockpit.railVisibility === 'hidden',
      `rail visibility=${cockpit.railVisibility}`);
    record('…and DISPLAY with it', cockpit.displayVisibility === 'hidden',
      `display visibility=${cockpit.displayVisibility}`);
    record('…but the map key stays, back in its corner',
      cockpit.legendVisibility === 'visible' && cockpit.legendPosition === 'fixed'
        && cockpit.left < 60 && cockpit.bottom > 40 && cockpit.width > 0,
      `visibility=${cockpit.legendVisibility} at left=${Math.round(cockpit.left)} bottom=${Math.round(cockpit.bottom)} width=${Math.round(cockpit.width)}`);

    const relevantErrors = consoleErrors.filter((text) => /legend|bloom|rail/i.test(text));
    record('no console errors mentioning the legend, the rail, or bloom',
      relevantErrors.length === 0, relevantErrors[0] || 'clean');
    console.log(`\n  shots → ${SHOT_DIR}`);
  } finally {
    await browser.close();
  }

  const failed = results.filter((entry) => !entry.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('\nFailures:');
    for (const entry of failed) console.log(`  - ${entry.name}${entry.detail ? ` — ${entry.detail}` : ''}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
