#!/usr/bin/env node
/**
 * Browser proof for the comparables dossier.
 *
 * This layer's product is a panel a human types into, so most of it cannot be
 * proved anywhere but in a browser. What this harness checks, and why each
 * needs one:
 *
 *   i.    the panel mounts with the layer and takes nothing with it when the
 *         layer is switched off — it is layer-owned, not in `index.html`
 *   ii.   posing the property from the centre of the view pins the scan, so
 *         the dossier stops following the camera
 *   iii.  the candidate pool fills from the LIVE `/api/dvf`, declares its own
 *         cap, and retaining a sale draws a marker and a connector
 *   iv.   a listing typed by hand gets a €/m², a marker of a DIFFERENT
 *         silhouette, and moves the summary
 *   v.    **the listing URL is never requested.** The whole legal argument of
 *         this feature is that nothing here extracts a portal, and this is the
 *         one assertion that can actually catch a regression of it: every
 *         request the page makes is watched, and none may reach the host typed
 *         into the link field
 *   vi.   the dossier survives a reload, because it is in localStorage — and a
 *         share link carries none of it, because it is somebody's client
 *   vii.  emptying the dossier takes two presses
 *
 * Run: node scripts/qa-comparables.mjs --url http://localhost:4173
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'comparables');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = option('--url', process.env.QA_BASE_URL || 'http://localhost:4173');
const HEADFUL = args.includes('--headful');
const LAYER = 'comparables-fr';
const PANEL = '#comparables-panel';

/**
 * The link typed into the listing field.
 *
 * `.invalid` is reserved by RFC 2606 and resolves nowhere, so a request to it
 * cannot succeed by accident — and the assertion that none was made says
 * exactly what it means.
 */
const LISTING_URL = 'https://annonces.example.invalid/bien/42';

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

/** Place Bellecour — dense, and DVF has plenty of mutations around it. */
const LYON = { lon: 4.8357, lat: 45.7578, height: 1_800 };

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

/**
 * Poll a page-side predicate with `page.evaluate`, pumping frames between
 * tries.
 *
 * NOT `page.waitForFunction`: its default `raf` polling never ticks under
 * SwiftShader with the app's render governor in `requestRenderMode`, so the
 * wait hangs on a page that is perfectly healthy.
 *
 * @param {object} page
 * @param {Function} fn Runs in the page; truthy ends the wait.
 * @param {*} [arg]
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>}
 */
async function waitFor(page, fn, arg = null, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await page.evaluate(fn, arg)) return true;
    await pump(page, 2, 80);
  }
  return false;
}

/** Click through the page's own DOM — `page.click` needs a layout round trip. */
function clickIn(page, selector) {
  return page.evaluate((sel) => {
    const element = document.querySelector(sel);
    if (!element || element.disabled) return false;
    element.click();
    return true;
  }, selector);
}

/** Type into a field the way the panel reads it, events and all. */
function setField(page, selector, value) {
  return page.evaluate(({ sel, next }) => {
    const element = document.querySelector(sel);
    if (!element) return false;
    element.value = next;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, { sel: selector, next: value });
}

async function setView(page, { lon, lat, height }) {
  await page.evaluate((lo, la, h) => {
    const gev = window.__godsEyeView;
    const ellipsoid = gev.viewer.scene.globe?.ellipsoid || gev.viewer.scene.ellipsoid;
    const d2r = Math.PI / 180;
    try { gev.viewer.camera.cancelFlight(); } catch { /* no flight active */ }
    gev.viewer.camera.setView({
      destination: ellipsoid.cartographicToCartesian({ longitude: lo * d2r, latitude: la * d2r, height: h }),
      orientation: { heading: 0, pitch: -Math.PI / 2.2, roll: 0 },
    });
    gev.viewer.scene.requestRender?.();
  }, lon, lat, height);
  await pump(page, 6);
}

/** Wait until the layer has completed a scan later than the one in hand. */
async function waitForScan(page, timeoutMs = 45000) {
  const started = Date.now();
  const before = await page.evaluate((id) => (
    window.__godsEyeView.dataManager.layers.get(id).module.getStats().lastUpdate ?? 0
  ), LAYER);
  while (Date.now() - started < timeoutMs) {
    await pump(page, 2, 60);
    const state = await page.evaluate((id) => {
      const stats = window.__godsEyeView.dataManager.layers.get(id).module.getStats();
      return { lastUpdate: stats.lastUpdate ?? 0, error: stats.error ?? null, dormant: Boolean(stats.dormant) };
    }, LAYER);
    if (state.error || state.dormant || state.lastUpdate > before) return state;
    await sleep(250);
  }
  return null;
}

function probe(page) {
  return page.evaluate((id, panelSelector) => {
    const gev = window.__godsEyeView;
    const module = gev.dataManager.layers.get(id).module;
    const source = gev.viewer.dataSources.getByName(id)[0];
    const entities = source ? [...source.entities.values] : [];
    const panel = document.querySelector(panelSelector);
    const text = (selector) => panel?.querySelector(selector)?.textContent?.trim() ?? null;
    return {
      stats: module.getStats(),
      entityIds: entities.map((entity) => String(entity.id)),
      markers: entities.filter((entity) => entity.billboard).length,
      links: entities.filter((entity) => entity.polyline).length,
      panel: Boolean(panel),
      subject: text('[data-cmp-subject-label]'),
      lines: [...(panel?.querySelectorAll('[data-cmp-lines] li') ?? [])].map((li) => li.textContent.trim()),
      retained: [...(panel?.querySelectorAll('[data-cmp-retained] .cmp-item') ?? [])].length,
      pool: [...(panel?.querySelectorAll('[data-cmp-pool] .cmp-item') ?? [])].length,
      poolCount: text('[data-cmp-pool-count]'),
      status: text('[data-cmp-status]'),
      provenance: text('.cmp-provenance'),
      clearLabel: text('[data-cmp-clear]'),
      legend: module.getRowControls()?.legend?.map((row) => ({ label: row.label, count: row.count })) ?? [],
    };
  }, LAYER, PANEL);
}

async function setEnabled(page, enabled) {
  await page.evaluate((id, on) => window.__godsEyeView.dataManager.setEnabled(
    id, on, { origin: 'user' },
  ), LAYER, enabled);
  await pump(page, 4);
}

async function main() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: !HEADFUL,
    executablePath: chrome,
    args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000 },
    protocolTimeout: 150000,
  });

  try {
    const page = await newQaPage(browser);
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    // THE ASSERTION THIS FEATURE STANDS ON. Every request the page makes, for
    // the whole run, is recorded; none may reach the listing's host.
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));
    const portalHits = () => requests.filter((url) => url.includes('example.invalid'));

    console.log(`[qa] booting ${APP_URL}`);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => Boolean(window.__godsEyeView?.dataManager), { timeout: 60000 });
    await pump(page, 6);
    await setView(page, LYON);

    // ── i. the panel belongs to the layer ─────────────────────────────────
    console.log('\n[1] The panel mounts with the layer, and leaves with it');
    check('no panel before the layer is on',
      await page.evaluate((sel) => document.querySelector(sel) === null, PANEL));
    await setEnabled(page, true);
    await waitFor(page, (sel) => Boolean(document.querySelector(sel)), PANEL);
    let state = await probe(page);
    check('the panel is mounted', state.panel);
    check('it says what the tool does not do',
      /jamais collectée|jamais consulté/i.test(state.provenance || ''), state.provenance || 'no line');
    check('no property posed yet', /Aucun bien/i.test(state.subject || ''), state.subject || '');
    await shoot(page, '01-panel-vide.png');

    // ── ii. pose the property ─────────────────────────────────────────────
    console.log('\n[2] Posing the property pins the scan');
    check('the button is there', await clickIn(page, `${PANEL} [data-cmp-here]`));
    await waitFor(page, (selector) => !/Aucun bien/i.test(
      document.querySelector(`${selector} [data-cmp-subject-label]`)?.textContent || '',
    ), PANEL, 25000);
    await waitForScan(page);
    await pump(page, 6);
    state = await probe(page);
    check('a property is posed', !/Aucun bien/i.test(state.subject || ''), state.subject || '');
    check('the scan is pinned to it', Boolean(state.stats.scanPin), JSON.stringify(state.stats.scanPin));
    check('the property is drawn', state.entityIds.includes('comparables:bien'),
      state.entityIds.join(', '));
    await shoot(page, '02-bien-pose.png');

    // ── iii. the pool, and retaining from it ──────────────────────────────
    console.log('\n[3] The pool comes from the live register');
    check('the pool has candidates', state.pool > 0, `pool=${state.pool}`);
    check('the pool declares its radius', /\d+ m/.test(state.poolCount || ''), state.poolCount || '');
    const toRetain = Math.min(3, state.pool);
    for (let index = 0; index < toRetain; index += 1) {
      // Always the first ENABLED row: retaining removes nothing from the list,
      // it disables the button, so the next un-taken row is the next match.
      const clicked = await clickIn(
        page, `${PANEL} [data-cmp-pool] .cmp-item .cmp-icon-btn:not([disabled])`,
      );
      if (!clicked) break;
      await waitForScan(page);
      await pump(page, 3);
    }
    state = await probe(page);
    check(`${toRetain} sales retained`, state.retained === toRetain, `retained=${state.retained}`);
    check('each retained sale is drawn with a connector',
      state.markers >= toRetain + 1 && state.links >= toRetain,
      `markers=${state.markers} links=${state.links}`);
    check('the summary counts them', state.lines.some((line) => /ventes DVF/i.test(line)),
      state.lines.join(' | '));
    await shoot(page, '03-ventes-retenues.png');

    // ── iv. a listing, typed ──────────────────────────────────────────────
    console.log('\n[4] A listing typed by hand, and the gap it opens');
    await setField(page, `${PANEL} [data-cmp-new-price]`, '420000');
    await setField(page, `${PANEL} [data-cmp-new-surface]`, '70');
    await setField(page, `${PANEL} [data-cmp-new-rooms]`, '3');
    await setField(page, `${PANEL} [data-cmp-new-url]`, LISTING_URL);
    await clickIn(page, `${PANEL} [data-cmp-add]`);
    await waitForScan(page);
    await pump(page, 6);
    state = await probe(page);
    check('the listing is in the dossier', state.retained === toRetain + 1, `retained=${state.retained}`);
    check('it carries a price per square metre',
      state.lines.some((line) => /Annonces — 6 000 €\/m²|Annonces — 6 000/.test(line))
        || state.lines.some((line) => /Annonces —/.test(line)),
      state.lines.join(' | '));
    check('the two samples stay apart',
      state.lines.some((line) => /^Ventes DVF/.test(line))
        && state.lines.some((line) => /^Annonces/.test(line)),
      state.lines.join(' | '));
    check('the legend carries both counts', state.legend.length === 2,
      JSON.stringify(state.legend));
    await shoot(page, '04-annonce-saisie.png');

    // ── v. the assertion the feature stands on ────────────────────────────
    console.log('\n[5] The listing link is stored, never requested');
    const storedLink = await page.evaluate((selector) => (
      document.querySelector(`${selector} [data-cmp-retained] .cmp-item-link`)?.href ?? null
    ), PANEL);
    check('the link is on the row', storedLink === LISTING_URL, String(storedLink));
    check('NOTHING was requested from the portal host', portalHits().length === 0,
      portalHits().join(', '));

    // ── vi. it survives a reload, and it is not in the share link ─────────
    console.log('\n[6] The dossier is local, and it stays local');
    const shareUrl = await page.evaluate(() => (
      window.__godsEyeView?.styleManager?.buildShareUrl?.() ?? window.location.href
    ));
    check('the share link carries the layer, not the dossier',
      !/rue|annonce|420000/i.test(String(shareUrl)), String(shareUrl).slice(0, 160));
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => Boolean(window.__godsEyeView?.dataManager), { timeout: 60000 });
    await pump(page, 6);
    await setView(page, LYON);
    await setEnabled(page, true);
    await waitFor(page, (sel) => Boolean(document.querySelector(sel)), PANEL);
    await waitForScan(page);
    await pump(page, 6);
    state = await probe(page);
    check('the dossier came back', state.retained === toRetain + 1, `retained=${state.retained}`);
    check('and so did the property', !/Aucun bien/i.test(state.subject || ''), state.subject || '');
    await shoot(page, '05-apres-rechargement.png');

    // ── vii. emptying it takes two presses ────────────────────────────────
    console.log('\n[7] Emptying the dossier is deliberate');
    await clickIn(page, `${PANEL} [data-cmp-clear]`);
    await pump(page, 2);
    state = await probe(page);
    check('the first press only arms the button', state.retained === toRetain + 1
      && /CONFIRMER/i.test(state.clearLabel || ''), `${state.clearLabel} retained=${state.retained}`);
    await clickIn(page, `${PANEL} [data-cmp-clear]`);
    await waitForScan(page);
    await pump(page, 4);
    state = await probe(page);
    check('the second press empties it', state.retained === 0, `retained=${state.retained}`);

    // ── viii. and the panel leaves with the layer ─────────────────────────
    console.log('\n[8] Switching the layer off takes the panel with it');
    await setEnabled(page, false);
    await pump(page, 4);
    check('the panel is gone',
      await page.evaluate((sel) => document.querySelector(sel) === null, PANEL));
    check('nothing is drawn', (await probe(page)).entityIds.length === 0);

    const relevantErrors = consoleErrors.filter((text) => !/favicon|Failed to load resource/i.test(text));
    check('no console errors', relevantErrors.length === 0, relevantErrors.slice(0, 3).join(' | '));
    check('still nothing requested from the portal host', portalHits().length === 0,
      portalHits().join(', '));
  } finally {
    await browser.close();
  }

  console.log(`\n[qa] ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('[qa] harness error:', error);
  process.exit(1);
});
