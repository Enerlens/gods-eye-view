#!/usr/bin/env node
/*
 * MEASURE — the same chain as `measure-plug-e2e.mjs`, but inside the app.
 *
 * The Node harness times the platforms. This one times what the visitor
 * actually waits for: the search, the proposal, and then the part Node cannot
 * see — `datasets.plug()` registering a layer, the loader fetching, and Cesium
 * putting the first marks on the globe.
 *
 * It measures four boundaries, all from inside one page evaluation so that no
 * poll interval is mistaken for latency:
 *
 *   search   fetch → hits
 *   infer    the shortlist read at once → the first draft that validates
 *   plug     plug() → the layer's count leaves zero
 *   paint    that count → the next frame Cesium renders
 *
 * No camera move, no screenshot, no pointer click: on this page a pointer
 * click can outlive a 180 s protocol timeout while `evaluate` answers in 1 ms.
 * The default view is already Paris, which is what the viewport-scoped
 * datasets need.
 *
 * Run: node scripts/measure-plug-render.mjs --url http://localhost:4415 [--reps 3]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const args = process.argv.slice(2);
const option = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : fallback;
};
const APP_URL = option('--url', process.env.QA_BASE_URL || 'http://localhost:4415');
const REPS = Number(option('--reps', '3'));
const GPU = args.includes('--gpu');
const JSON_OUT = option('--json');

const SCENARIOS = [
  { key: 'defibrillateurs', ask: 'Est-ce qu\'on a les défibrillateurs ?', query: 'défibrillateurs' },
  { key: 'arbres', ask: 'Les arbres remarquables de Paris ?', query: 'arbres remarquables Paris' },
  { key: 'pharmacies', ask: 'Les pharmacies ?', query: 'pharmacies' },
];

const chromeCandidates = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  (() => { try { return puppeteer.executablePath(); } catch { return null; } })(),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean);
const chrome = chromeCandidates.find((candidate) => {
  try { return fs.existsSync(candidate); } catch { return false; }
});

/** The whole chain, timed where it happens. Returns milliseconds, not verdicts. */
async function measureInPage(page, scenario, suffix) {
  return page.evaluate(async ({ query, suffix: idSuffix }) => {
    const box = window.__godsEyeView?.datasets;
    const manager = window.__godsEyeView?.dataManager;
    const viewer = window.__godsEyeView?.viewer;
    if (!box || !manager) return { error: 'no dataset box' };
    const out = { rejected: [] };

    const t0 = performance.now();
    let hits;
    try {
      const response = await fetch(`https://www.data.gouv.fr/api/2/datasets/search/?q=${encodeURIComponent(query)}&page_size=5`);
      hits = await response.json();
    } catch (error) {
      return { error: `search: ${error?.message || error}` };
    }
    out.search = performance.now() - t0;
    const candidates = (hits.data || []).map((item) => ({
      title: item.title,
      page: `https://www.data.gouv.fr/datasets/${item.slug}/`,
    }));
    if (!candidates.length) return { ...out, error: 'aucun candidat' };

    const t1 = performance.now();
    const drafts = await Promise.all(candidates.map(async (candidate) => {
      try {
        const inferred = await box.infer(candidate.page);
        return { candidate, inferred, fault: inferred.faults?.length ? inferred.faults.join(' · ') : null };
      } catch (error) {
        return { candidate, inferred: null, fault: String(error?.message || error) };
      }
    }));
    out.infer = performance.now() - t1;
    const kept = drafts.find((draft) => draft.inferred && !draft.fault);
    out.rejected = drafts.filter((draft) => draft.fault).map((draft) => `${draft.candidate.title} — ${draft.fault}`);
    if (!kept) return { ...out, error: 'aucun candidat exploitable' };
    out.title = kept.candidate.title;
    out.rank = drafts.indexOf(kept) + 1;

    // A private id per repetition, so a run never measures a warm layer.
    const manifest = { ...kept.inferred.manifest, id: `mesure-${idSuffix}` };
    out.kind = manifest.source?.kind;
    out.scope = manifest.source?.scope || 'all';

    const t2 = performance.now();
    let plugged;
    try {
      plugged = await box.plug(manifest);
    } catch (error) {
      return { ...out, error: `plug: ${error?.message || error}` };
    }
    out.plugCall = performance.now() - t2;

    const layerId = plugged.layerId;
    const deadline = performance.now() + 120000;
    let count = 0;
    let failure = null;
    while (performance.now() < deadline) {
      const layer = manager.getAll().find((entry) => entry.id === layerId);
      const stats = layer?.stats || {};
      if (stats.count > 0) { count = stats.count; break; }
      if (stats.error) { failure = String(stats.error); break; }
      await new Promise((resolve) => { requestAnimationFrame(resolve); });
    }
    out.plug = performance.now() - t2;
    out.count = count;
    if (!count) return { ...out, error: failure || 'aucun objet dessiné' };

    // The first frame Cesium renders after the marks exist.
    const t3 = performance.now();
    await new Promise((resolve) => {
      if (!viewer?.scene?.postRender) { resolve(); return; }
      const remove = viewer.scene.postRender.addEventListener(() => { remove(); resolve(); });
      viewer.scene.requestRender?.();
    });
    out.paint = performance.now() - t3;
    const layer = manager.getAll().find((entry) => entry.id === layerId);
    out.coverage = layer?.stats?.coverage || null;
    out.total = performance.now() - t0;
    await box.unplug(manifest.id).catch(() => {});
    return out;
  }, { query: scenario.query, suffix: suffix });
}

function stats(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return { min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], max: sorted[sorted.length - 1] };
}
const ms = (value) => (value == null ? '—' : `${Math.round(value)} ms`);

const browser = await puppeteer.launch({
  headless: true,
  executablePath: chrome || undefined,
  args: GPU
    ? ['--no-sandbox', '--disable-setuid-sandbox', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', '--window-size=1600,1000']
    : ['--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1600,1000'],
  defaultViewport: { width: 1600, height: 1000 },
  protocolTimeout: 300000,
});
const runs = [];
try {
  const page = await newQaPage(browser);
  page.on('pageerror', (error) => console.warn('[page]', String(error?.message || error).slice(0, 120)));
  const bootStarted = Date.now();
  await page.goto(`${APP_URL}/?welcome=0`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const started = Date.now();
  while (Date.now() - started < 180000) {
    const ready = await page.evaluate(() => Boolean(window.__godsEyeView?.datasets && window.__godsEyeView?.dataManager));
    if (ready) break;
    await new Promise((resolve) => { setTimeout(resolve, 250); });
  }
  console.log(`app prête en ${Math.round((Date.now() - bootStarted) / 100) / 10} s (${GPU ? 'Metal' : 'SwiftShader'})\n`);

  for (const scenario of SCENARIOS) {
    console.log(`━━ ${scenario.ask}`);
    for (let rep = 1; rep <= REPS; rep += 1) {
      const record = await measureInPage(page, scenario, `${scenario.key}-${rep}-${Date.now() % 100000}`);
      record.key = scenario.key;
      record.rep = rep;
      runs.push(record);
      if (record.error) {
        console.log(`   ${String(rep).padEnd(2)} ✗ ${record.error}  (search ${ms(record.search)} · infer ${ms(record.infer)})`);
      } else {
        console.log(`   ${String(rep).padEnd(2)} search ${ms(record.search).padStart(7)} · infer ${ms(record.infer).padStart(7)} · plug→objets ${ms(record.plug).padStart(8)} · 1re image ${ms(record.paint).padStart(7)}  ⇒ ${record.count} objets, total ${ms(record.total)}`);
      }
    }
    const first = runs.find((run) => run.key === scenario.key && !run.error);
    if (first) console.log(`   retenu : ${first.title} (hit n°${first.rank}, ${first.kind}/${first.scope}) — ${first.coverage || ''}`);
    for (const line of (runs.find((run) => run.key === scenario.key)?.rejected || [])) console.log(`   écarté : ${line.slice(0, 110)}`);
    console.log('');
  }
} finally {
  await browser.close();
}

console.log('━━━━━━ DISTRIBUTION (dans la page) ━━━━━━');
const good = runs.filter((run) => !run.error);
for (const key of ['search', 'infer', 'plug', 'paint', 'total']) {
  const summary = stats(good.map((run) => run[key]).filter((value) => Number.isFinite(value)));
  console.log(`${key.padEnd(7)} ${ms(summary?.min).padStart(9)} … ${ms(summary?.median).padStart(9)} … ${ms(summary?.max).padStart(9)}`);
}
console.log(`\n${good.length}/${runs.length} passes ont dessiné.`);
if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, `${JSON.stringify(runs, null, 2)}\n`);
  console.log(`Brut : ${JSON_OUT}`);
}
