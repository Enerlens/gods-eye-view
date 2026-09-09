#!/usr/bin/env node
/**
 * qa:lazy-layers — the 60 data layers cost nothing to open the globe, and still
 * work when someone asks for one.
 *
 * Both halves are load-bearing. "Never load a layer" passes the first check by
 * deleting the product; "load them all at boot" passes the rest by undoing the
 * 4.7 MB this change is about. Only asserting both pins what was decided:
 *
 *   1. a cold boot registers all 60 layers and fetches ZERO layer chunks — the
 *      panel draws every row from `LAYER_MANIFEST`, not from the modules;
 *   2. the rows say the same thing the modules do (name, icon, source), which
 *      is the failure mode a stale manifest would produce silently;
 *   3. switching one on fetches exactly its chunk, and the module lands;
 *   4. switching it off and on again does NOT fetch a second time;
 *   5. a layer nobody touched is still unloaded at the end.
 *
 * `earthquakes` is the layer switched on because its chunk is small and its
 * feed is keyless. Whether the USGS fetch itself succeeds is deliberately NOT
 * asserted: this harness is about the module arriving, and a network hiccup
 * upstream must not read as a code-splitting regression.
 *
 * Usage: node scripts/qa-lazy-layers.mjs [--url http://127.0.0.1:4179]
 */
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';
import { LAYER_MANIFEST } from '../src/data/layerManifest.js';
import { LAYER_MANIFEST_SOURCES } from './lib/layerManifestSources.mjs';

const argv = process.argv.slice(2);
const url = argv.includes('--url') ? argv[argv.indexOf('--url') + 1] : 'http://127.0.0.1:4179';

/** The layer switched on mid-run. Small chunk, keyless feed. */
const PROBE_LAYER = 'earthquakes';
/** A layer nobody touches, to prove nothing warmed the whole registry. */
const UNTOUCHED_LAYER = 'traffic';
/** Past the boot burst, so a late chunk still counts against check 1. */
const BOOT_WATCH_MS = 15_000;

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

  /** Every built JS chunk requested, in order, so each check can slice it. */
  const scriptRequests = [];
  page.on('request', (req) => {
    const requested = req.url();
    if (/\/assets\/[^/?]+\.js(\?|$)/.test(requested)) scriptRequests.push(requested.split('/').pop());
  });

  const startedAt = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => !!window.__godsEyeView?.dataManager, { timeout: 120_000 });
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, BOOT_WATCH_MS - (Date.now() - startedAt))));

  const bootChunks = [...scriptRequests];

  // ── 1. every layer registered, none of them loaded ────────────────────────
  const bootState = await page.evaluate(() => {
    const { dataManager } = window.__godsEyeView;
    const rows = dataManager.getAll();
    const loaded = [];
    for (const row of rows) {
      const module = dataManager.layers.get(row.id)?.module;
      if (module?.__lazy?.isLoaded?.()) loaded.push(row.id);
    }
    return {
      registered: rows.length,
      lazy: rows.filter((row) => dataManager.layers.get(row.id)?.module?.__lazy).length,
      loaded,
      ids: rows.map((row) => row.id),
      panelRows: document.querySelectorAll('#data-toggles [data-layer-id]').length,
    };
  });

  check(
    'a cold boot registers every production layer',
    bootState.registered >= LAYER_MANIFEST.length
      && LAYER_MANIFEST.every((entry) => bootState.ids.includes(entry.id)),
    { registered: bootState.registered, manifest: LAYER_MANIFEST.length },
  );

  check(
    'a cold boot loads NO layer module',
    bootState.loaded.length === 0,
    { loaded: bootState.loaded },
  );

  // The boot fetched some chunks — the entry, the Vite preload polyfill, the
  // ones the eager shell still pulls. None of them may be a layer's. Rollup
  // names a lazy chunk after its module file, so the manifest's own source list
  // is the exact set to look for rather than a hand-kept guess.
  const layerChunkPrefixes = [...new Set(
    LAYER_MANIFEST_SOURCES.map((entry) => entry.module.replace(/^\.\//, '').replace(/\.js$/, '')),
  )];
  const isLayerChunk = (chunk) => layerChunkPrefixes.some((prefix) => chunk.startsWith(`${prefix}-`));
  const bootLayerChunks = bootChunks.filter(isLayerChunk);
  check(
    'no layer chunk is fetched inside the boot',
    bootLayerChunks.length === 0,
    { bootChunks: bootChunks.length, layerChunks: bootLayerChunks },
  );

  // ── 2. the rows say what the modules say ──────────────────────────────────
  const rowIdentity = await page.evaluate(() => {
    const rows = window.__godsEyeView.dataManager.getAll();
    return rows.map((row) => ({ id: row.id, name: row.name, icon: row.icon, source: row.source }));
  });
  const identityMismatches = LAYER_MANIFEST.filter((entry) => {
    const row = rowIdentity.find((candidate) => candidate.id === entry.id);
    return !row || row.name !== entry.name || row.icon !== entry.icon || row.source !== entry.source;
  }).map((entry) => entry.id);
  check(
    'every row draws the identity the manifest carries',
    identityMismatches.length === 0 && bootState.panelRows > 0,
    { mismatches: identityMismatches, panelRows: bootState.panelRows },
  );

  // ── 3. switching one on fetches exactly its chunk ─────────────────────────
  const beforeEnable = scriptRequests.length;
  await page.evaluate(async (layerId) => {
    const { dataManager } = window.__godsEyeView;
    // The enable may fail upstream (USGS down, offline runner) — this harness
    // only asks whether the MODULE arrived, so the rejection is swallowed here
    // rather than failing the check below for the wrong reason.
    try {
      await dataManager.setEnabled(layerId, true, { origin: 'user' });
    } catch { /* upstream, not us */ }
  }, PROBE_LAYER);
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const enableChunks = scriptRequests.slice(beforeEnable);
  const probeLoaded = await page.evaluate(
    (layerId) => window.__godsEyeView.dataManager.layers.get(layerId)?.module?.__lazy?.isLoaded?.() === true,
    PROBE_LAYER,
  );
  check(
    `switching ${PROBE_LAYER} on fetches its chunk and lands the module`,
    probeLoaded && enableChunks.some((chunk) => chunk.startsWith(`${PROBE_LAYER}-`)),
    { chunks: enableChunks, loaded: probeLoaded },
  );

  // ── 4. off, then on again, costs nothing ──────────────────────────────────
  const beforeReplay = scriptRequests.length;
  await page.evaluate(async (layerId) => {
    const { dataManager } = window.__godsEyeView;
    try { await dataManager.setEnabled(layerId, false, { origin: 'user' }); } catch { /* ignore */ }
    try { await dataManager.setEnabled(layerId, true, { origin: 'user' }); } catch { /* ignore */ }
  }, PROBE_LAYER);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const replayChunks = scriptRequests.slice(beforeReplay)
    .filter((chunk) => chunk.startsWith(`${PROBE_LAYER}-`));
  check(
    'toggling the same layer again downloads nothing',
    replayChunks.length === 0,
    { refetched: replayChunks },
  );

  // ── 5. the cockpit's own bindings survived the move ───────────────────────
  // `ui.js` no longer imports the thirteen layers it drives; it binds them from
  // the manager. Two of those bindings are read by SUBSCRIBING, which a stub
  // cannot answer until its module lands — so the HUD wiring is re-run on the
  // first enable. If that re-run were dropped, the CCTV and radio panels would
  // simply never update, silently, which no other check here would notice.
  await page.evaluate(async () => {
    const { dataManager } = window.__godsEyeView;
    for (const layerId of ['cctv', 'radio']) {
      try { await dataManager.setEnabled(layerId, true, { origin: 'user' }); } catch { /* upstream */ }
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const cockpitBindings = await page.evaluate(() => {
    const { styleManager, dataManager } = window.__godsEyeView;
    const detection = styleManager.getDetectionDiagnostics?.() || null;
    return {
      cctvLoaded: dataManager.layers.get('cctv')?.module?.__lazy?.isLoaded?.() === true,
      radioLoaded: dataManager.layers.get('radio')?.module?.__lazy?.isLoaded?.() === true,
      cctvSubscribed: typeof styleManager._cctvUnsubscribe === 'function',
      radioSubscribed: typeof styleManager._radioUnsubscribe === 'function',
      cctvStatePresent: styleManager._cctvState !== null && styleManager._cctvState !== undefined,
      radioStatePresent: styleManager._radioState !== null && styleManager._radioState !== undefined,
      registeredLayerCount: detection?.registeredLayerCount ?? null,
    };
  });

  check(
    'enabling CCTV and radio binds their HUD subscriptions',
    cockpitBindings.cctvLoaded && cockpitBindings.radioLoaded
      && cockpitBindings.cctvSubscribed && cockpitBindings.radioSubscribed
      && cockpitBindings.cctvStatePresent && cockpitBindings.radioStatePresent,
    cockpitBindings,
  );

  check(
    'the detection overlay received its nine-layer register',
    cockpitBindings.registeredLayerCount === 9,
    { registeredLayerCount: cockpitBindings.registeredLayerCount },
  );

  // ── 6. an untouched layer is still unloaded ───────────────────────────────
  const untouched = await page.evaluate(
    (layerId) => window.__godsEyeView.dataManager.layers.get(layerId)?.module?.__lazy?.isLoaded?.() === true,
    UNTOUCHED_LAYER,
  );
  check(
    `${UNTOUCHED_LAYER} is still unloaded after all of that`,
    untouched === false,
    { loaded: untouched },
  );

} finally {
  await browser.close();
}

const passed = results.filter((entry) => entry.pass).length;
console.log(`\nqa:lazy-layers ${passed}/${results.length}`);
process.exitCode = passed === results.length ? 0 : 1;
