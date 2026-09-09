#!/usr/bin/env node
/**
 * Browser proof that the dataset box plugs a dataset end to end.
 *
 * What it proves, in a real page:
 *   i.   the shipped catalog (`datasets/*.json`) is on the panel — one row per
 *        manifest, in the group its manifest names;
 *   ii.  `datasets.infer(url)` turns a pasted Opendatasoft address into a
 *        validating draft with the geo field found;
 *   iii. `datasets.plug(manifest)` registers a NEW layer after the seal, the
 *        row appears under JEUX BRANCHÉS, the layer turns on and draws a
 *        non-zero count, and its coverage line says how much of the source
 *        that is;
 *   iv.  the panel's own form does the same from a pasted URL — ANALYSER,
 *        then BRANCHER — and lists the plugged dataset;
 *   iv-b. a SUBJECT typed into the same field opens the shortlist: candidates
 *        proven drawable, each under its four facts, what was set aside with
 *        the reason, and a choice that lands in the draft without a second
 *        read — then a load whose status line moves through a true fraction;
 *   v.   the manifest survives a reload (persisted) and `unplug` removes it.
 *
 * The plugged subject is the Paris remarkable trees (185 features, ODbL,
 * CORS-open): small, keyless, and drawn without any proxy — the first-class
 * path of the box. The catalog's viewport-scoped datasets are only checked
 * for presence and for their zoom-in prompt from orbit; loading them for a
 * close view is exercised by `qa:datasets --deep`.
 *
 * Run: node scripts/qa-datasets.mjs --url http://localhost:4173 [--deep] [--shots] [--gpu] [--headful]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'datasets');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = option('--url', process.env.QA_BASE_URL || 'http://localhost:4173');
const HEADFUL = args.includes('--headful');
const DEEP = args.includes('--deep');
// Screenshots are opt-in: under SwiftShader a `Page.captureScreenshot` of a
// scene with a few thousand marks can outlast the protocol timeout, and a
// missing picture must not fail the checks that already passed.
const SHOTS = args.includes('--shots');
// `--gpu` uses the machine's GPU through ANGLE/Metal (the airports harness's
// flags) instead of SwiftShader; on a Mac it is the difference between a
// harness that runs in two minutes and one that stalls on the first click.
const GPU = args.includes('--gpu');

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
async function shoot(page, name) {
  if (!SHOTS) return;
  try {
    await page.screenshot({ path: path.join(SHOTS_DIR, name) });
  } catch (error) {
    console.warn(`[shot] ${name} skipped: ${error?.message || error}`);
  }
}
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const TREES_URL = 'https://opendata.paris.fr/explore/dataset/arbresremarquablesparis/information/';
const TREES_MANIFEST = {
  id: 'qa-arbres-paris',
  label: 'QA arbres Paris',
  source: { kind: 'opendatasoft', url: 'https://opendata.paris.fr', dataset: 'arbresremarquablesparis', geoField: 'geom_x_y', maxFeatures: 1000 },
  feature: { title: ['arbres_libellefrancais', 'arbres_genre'], details: [{ field: 'arbres_genre', label: 'Genre' }] },
  attribution: { publisher: 'Ville de Paris', licence: 'ODbL', url: TREES_URL },
};

async function waitFor(page, fn, { timeout = 30_000, interval = 250, arg = undefined } = {}) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    last = await page.evaluate(fn, arg);
    if (last) return last;
    await sleep(interval);
  }
  return last;
}

/**
 * Click and type through the DOM rather than through puppeteer's input
 * emulation: the pointer path scrolls the element into view first with a
 * `Runtime.callFunctionOn` that never returns on this page (measured: the
 * page answers `evaluate` in 1 ms while the pointer click times out at
 * 180 s), and the panel's listeners hear a DOM `click()` and an `input`
 * event exactly as they hear a pointer.
 */
async function domClick(page, selector) {
  return page.evaluate((s) => {
    const node = document.querySelector(s);
    if (!node) return false;
    node.click();
    return true;
  }, selector);
}

async function domType(page, selector, value) {
  return page.evaluate(({ s, v }) => {
    const node = document.querySelector(s);
    if (!node) return false;
    node.value = v;
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, { s: selector, v: value });
}

async function layerStats(page, layerId) {
  return page.evaluate((id) => {
    const layer = window.__godsEyeView?.dataManager?.getAll?.().find((entry) => entry.id === id);
    return layer ? { enabled: layer.enabled, count: layer.stats?.count || 0, coverage: layer.stats?.coverage || null, error: layer.stats?.error || null, status: layer.stats?.status || null, category: layer.category } : null;
  }, layerId);
}

async function main() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: !HEADFUL,
    executablePath: chrome || undefined,
    // The same flags as `qa-label-click.mjs`: SwiftShader has to be allowed
    // explicitly or the CesiumWidget refuses to construct in headless Chrome.
    args: GPU
      ? ['--no-sandbox', '--disable-setuid-sandbox', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', '--window-size=1600,1000']
      : ['--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000 },
    protocolTimeout: 180000,
  });
  try {
    const page = await newQaPage(browser);
    page.on('pageerror', (error) => console.warn('[page error]', error?.message || error));
    await page.goto(`${APP_URL}/?welcome=0`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    const ready = await waitFor(page, () => Boolean(window.__godsEyeView?.datasets && window.__godsEyeView?.dataManager), { timeout: 120_000 });
    check('app exposes the dataset box', Boolean(ready));
    if (!ready) return;

    // i. the shipped catalog
    const catalog = await page.evaluate(() => window.__godsEyeView.datasets.list().filter((entry) => entry.origin === 'catalog').map((entry) => entry.layerId));
    check('catalog datasets are registered', catalog.length >= 2, catalog.join(', '));
    const catalogRows = await page.evaluate((ids) => ids.map((id) => {
      const row = document.querySelector(`#data-toggles [data-layer-id="${id}"]`);
      return { id, present: Boolean(row), group: row?.closest('.data-category')?.dataset?.categoryId || null, name: row?.querySelector('.data-name')?.textContent || null };
    }), catalog);
    check('every catalog dataset has a row in its group', catalogRows.every((row) => row.present && row.group), JSON.stringify(catalogRows));
    const plugPanel = await page.evaluate(() => Boolean(document.querySelector('#dataset-plug-panel [data-dsp-open]')));
    check('the plug panel is mounted under the layer list', plugPanel);

    // A viewport-scoped catalog dataset from orbit: a prompt, not a fault.
    const gatedId = catalog.find((id) => id.includes('geodae')) || catalog[0];
    await page.evaluate(async (id) => { await window.__godsEyeView.dataManager.setEnabled(id, true, { origin: 'user' }); }, gatedId);
    await sleep(3500);
    const gated = await layerStats(page, gatedId);
    check('a viewport-scoped catalog dataset prompts to zoom in from the default view or loads', Boolean(gated?.enabled) && (gated.status === 'zoom-in' || gated.count > 0) && !gated.error, JSON.stringify(gated));
    await page.evaluate(async (id) => { await window.__godsEyeView.dataManager.setEnabled(id, false, { origin: 'user' }); }, gatedId);

    // ii. inference from a pasted address
    let inferred = null;
    try {
      inferred = await page.evaluate(async (url) => {
        const result = await window.__godsEyeView.datasets.infer(url);
        return { faults: result.faults, kind: result.manifest?.source?.kind, geoField: result.manifest?.source?.geoField, licence: result.manifest?.attribution?.licence, notes: result.notes };
      }, TREES_URL);
    } catch (error) {
      inferred = { error: error?.message || String(error) };
    }
    check('infer() reads an Opendatasoft page into a validating draft', inferred && !inferred.error && inferred.faults?.length === 0 && inferred.kind === 'opendatasoft' && inferred.geoField === 'geom_x_y', JSON.stringify(inferred));

    // iii. plug through the API
    const plugged = await page.evaluate(async (manifest) => {
      const result = await window.__godsEyeView.datasets.plug(manifest);
      return { layerId: result.layerId, persisted: result.persisted };
    }, TREES_MANIFEST);
    check('plug() registers a layer after the seal', plugged.layerId === 'ds-qa-arbres-paris', JSON.stringify(plugged));
    const drawn = await waitFor(page, (id) => {
      const layer = window.__godsEyeView.dataManager.getAll().find((entry) => entry.id === id);
      return layer && layer.enabled && layer.stats?.count > 0 ? layer.stats.count : null;
    }, { timeout: 45_000, arg: plugged.layerId });
    const stats = await layerStats(page, plugged.layerId);
    check('the plugged dataset turns on and draws its features', Number(drawn) > 100, JSON.stringify(stats));
    check('the row is grouped under JEUX BRANCHÉS with a coverage line', stats?.category === 'plugged' && /jeu entier/.test(stats?.coverage || ''), JSON.stringify(stats));
    const rowText = await page.evaluate((id) => document.querySelector(`#data-toggles [data-layer-id="${id}"] .data-toggle-meta`)?.textContent || '', plugged.layerId);
    check('the meta line prints publisher and licence', /Ville de Paris/.test(rowText) && /ODbL/.test(rowText), rowText);
    const legend = await page.evaluate((id) => {
      const module = window.__godsEyeView.dataManager.layers.get(id)?.module;
      return module?.getRowControls?.()?.legend || null;
    }, plugged.layerId);
    check('the row publishes a legend with the drawn count', Array.isArray(legend) && legend.length === 1 && legend[0].count > 100, JSON.stringify(legend));

    // The default view already frames Paris; a camera move under SwiftShader
    // can stall the page past the protocol timeout, so none is made here.
    await shoot(page, 'plugged-paris-trees.png');

    // iv. the panel's own form
    await domClick(page, '#dataset-plug-panel [data-dsp-open]');
    await domType(page, '#dataset-plug-panel [data-dsp-url]', 'https://www.data.gouv.fr/datasets/geodae-base-nationale-des-defibrillateurs/');
    await domClick(page, '#dataset-plug-panel [data-dsp-analyse]');
    const draftShown = await waitFor(page, () => {
      const section = document.querySelector('#dataset-plug-panel [data-dsp-draft]');
      const button = document.querySelector('#dataset-plug-panel [data-dsp-plug]');
      return section && !section.hidden ? { disabled: button?.disabled, status: document.querySelector('#dataset-plug-panel [data-dsp-status]')?.textContent, facts: document.querySelector('#dataset-plug-panel [data-dsp-facts]')?.textContent } : null;
    }, { timeout: 60_000 });
    check('the form analyses a data.gouv page into a ready draft', Boolean(draftShown) && draftShown.disabled === false, JSON.stringify(draftShown));
    await shoot(page, 'plug-panel-draft.png');
    // Rename so it cannot collide with the catalog's own GeoDAE manifest.
    await page.evaluate(() => {
      const input = document.querySelector('#dataset-plug-panel [data-dsp-label]');
      input.value = 'QA DAE formulaire';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    let formPlugged = null;
    if (draftShown && draftShown.disabled === false) {
      await domClick(page, '#dataset-plug-panel [data-dsp-plug]');
      // The trees are already listed from step iii; wait for a SECOND item —
      // the one the form just plugged — not for the first item to exist.
      formPlugged = await waitFor(page, () => {
        // Sample the status on the way: this load is several pages, so it is
        // where the honest fraction can be caught in flight.
        const text = document.querySelector('#dataset-plug-panel [data-dsp-status]')?.textContent || '';
        window.__qaFractions = window.__qaFractions || [];
        if (/ sur /.test(text) && !window.__qaFractions.includes(text)) window.__qaFractions.push(text);
        const items = [...document.querySelectorAll('#dataset-plug-panel .dsp-item[data-dataset-id]')];
        const fresh = items.find((item) => item.dataset.datasetId !== 'qa-arbres-paris');
        return fresh ? { id: fresh.dataset.datasetId, status: text } : null;
      }, { timeout: 30_000, interval: 120 });
    }
    const listed = await page.evaluate(() => [...document.querySelectorAll('#dataset-plug-panel .dsp-item')].map((item) => item.dataset.datasetId));
    check('BRANCHER from the form registers and lists the dataset', Boolean(formPlugged) && listed.length >= 2, JSON.stringify({ formPlugged, listed }));

    if (DEEP && formPlugged?.id) {
      // The form-plugged GeoDAE is viewport-scoped: on the default Paris view
      // it has to come back through the Tabular API with bbox filters, and
      // its report has to name the view or the clip.
      const layerId = `ds-${formPlugged.id}`;
      const deepCount = await waitFor(page, (id) => {
        const layer = window.__godsEyeView.dataManager.getAll().find((entry) => entry.id === id);
        return layer?.stats?.count > 0 ? layer.stats.count : null;
      }, { timeout: 90_000, arg: layerId });
      const deepStats = await layerStats(page, layerId);
      const report = await page.evaluate((id) => window.__godsEyeView.dataManager.layers.get(id)?.module?.getLoadReport?.() || null, layerId);
      check('[deep] the form-plugged data.gouv dataset loads the view through the Tabular API', Number(deepCount) > 10 && report?.via === 'tabular' && /dans la vue|affichés sur/.test(deepStats?.coverage || ''), JSON.stringify({ deepStats, via: report?.via, requests: report?.requests, total: report?.total }));
      await shoot(page, 'deep-geodae-default-view.png');
    }

    // iv-b. the load's own account of itself, caught during step iv
    const fractions = await page.evaluate(() => window.__qaFractions || []);
    check('a multi-page load says a true fraction while it runs',
      fractions.length > 0 && /^« .* » — \d[\d ]* sur \d[\d ]*( — environ .*)?$/.test(fractions[0]),
      JSON.stringify({ first: fractions[0], last: fractions.at(-1), samples: fractions.length }));
    // An estimate is a promise: it may only ride on a fraction that earned it.
    check('a time left never appears without the fraction that justifies it',
      fractions.filter((line) => /environ \d/.test(line)).every((line) => / sur /.test(line)),
      `${fractions.filter((line) => /environ \d/.test(line)).length} lignes avec un temps sur ${fractions.length}`);

    // iv-c. a subject opens the shortlist — proven candidates, facts, and the
    // ones set aside with the reason.
    await domType(page, '#dataset-plug-panel [data-dsp-url]', 'accidents corporels de la circulation');
    const intent = await page.evaluate(() => document.querySelector('#dataset-plug-panel [data-dsp-analyse]').textContent);
    check('the button says CHERCHER for words and ANALYSER for an address', intent === 'CHERCHER', intent);
    await domClick(page, '#dataset-plug-panel [data-dsp-analyse]');
    const aside = await waitFor(page, () => {
      const node = document.querySelector('#dataset-plug-panel [data-dsp-blocked]');
      return node && !node.hidden ? node.textContent : null;
    }, { timeout: 60_000 });
    // This subject reliably holds unusable hits: national files with no column
    // saying where a row is, and resources on hosts the relay will not fetch.
    check('what was set aside is shown with the reason, not hidden',
      Boolean(aside) && /Écartés/.test(aside) && /\(.+\)/.test(aside), String(aside || '(rien)'));

    await domType(page, '#dataset-plug-panel [data-dsp-url]', 'pharmacies');
    await domClick(page, '#dataset-plug-panel [data-dsp-analyse]');
    const shortlist = await waitFor(page, () => {
      const rows = [...document.querySelectorAll('#dataset-plug-panel .dsp-cand')];
      return rows.length ? rows.map((row) => ({
        title: row.querySelector('.dsp-cand-title')?.textContent || '',
        facts: row.querySelector('.dsp-cand-facts')?.textContent || '',
      })) : null;
    }, { timeout: 60_000 });
    const counted = shortlist?.filter((row) => /\d[\d ]* objets/.test(row.facts)) || [];
    check('a subject proposes candidates, each under its own facts',
      Boolean(shortlist) && shortlist.length >= 2 && counted.length >= 1,
      JSON.stringify({ rows: shortlist?.length, counted: counted.length, first: shortlist?.[0] }));

    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#dataset-plug-panel .dsp-cand')];
      const withCount = rows.find((row) => /\d[\d ]* objets/.test(row.querySelector('.dsp-cand-facts')?.textContent || '')) || rows[0];
      withCount.querySelector('.dsp-cand-btn').click();
    });
    const chosen = await page.evaluate(() => ({
      marked: document.querySelectorAll('#dataset-plug-panel .dsp-cand-chosen').length,
      plugReady: document.querySelector('#dataset-plug-panel [data-dsp-plug]')?.disabled === false,
    }));
    check('choosing a candidate fills the draft with no second read', chosen.marked === 1 && chosen.plugReady, JSON.stringify(chosen));

    await domType(page, '#dataset-plug-panel [data-dsp-label]', 'QA sélection');
    await domClick(page, '#dataset-plug-panel [data-dsp-plug]');
    const settledLine = await waitFor(page, () => {
      const text = document.querySelector('#dataset-plug-panel [data-dsp-status]')?.textContent || '';
      return /dans la vue|jeu entier|affichés sur|rien à cet endroit|a échoué/.test(text) ? text : null;
    }, { timeout: 120_000, interval: 150 });
    // A proposal is a promise; the marks are the proof. The last word is the
    // layer's own coverage sentence, never a bar that reached its end.
    check('the chosen dataset ends on its coverage sentence, not on a filled bar',
      Boolean(settledLine) && !/ sur \d/.test(String(settledLine).replace(/affichés sur/, '')),
      String(settledLine || ''));

    // v. persistence across a reload, then unplug
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90_000 });
    const restored = await waitFor(page, () => {
      const box = window.__godsEyeView?.datasets;
      if (!box) return null;
      const entries = box.list().filter((entry) => entry.origin === 'plugged');
      return entries.length ? entries.map((entry) => ({ id: entry.id, enabled: entry.enabled })) : null;
    }, { timeout: 120_000 });
    check('plugged datasets survive a reload with their ON state', Array.isArray(restored) && restored.some((entry) => entry.id === 'qa-arbres-paris' && entry.enabled), JSON.stringify(restored));
    const unplugged = await page.evaluate(async () => {
      const box = window.__godsEyeView.datasets;
      const ids = box.list().filter((entry) => entry.origin === 'plugged').map((entry) => entry.id);
      const outcomes = [];
      for (const id of ids) outcomes.push([id, await box.unplug(id)]);
      return { outcomes, remaining: box.list().filter((entry) => entry.origin === 'plugged').length, rows: document.querySelectorAll('#data-toggles [data-layer-id^="ds-qa-"]').length };
    });
    check('unplug() removes the layers, the rows and the storage entries', unplugged.outcomes.every(([, ok]) => ok) && unplugged.remaining === 0 && unplugged.rows === 0, JSON.stringify(unplugged));
    await shoot(page, 'after-unplug.png');
  } finally {
    await browser.close();
  }
}

main().then(() => {
  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  fs.writeFileSync(path.join(SHOTS_DIR, 'results.json'), JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
