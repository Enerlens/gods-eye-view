#!/usr/bin/env node
/*
 * MEASURE — how long "is there data on X?" takes, from the question to the marks.
 *
 * The dataset box (docs/DATASETS.md) already turns a pasted address into a
 * drawn layer. This harness times the chain a voice agent would walk instead,
 * stage by stage, against the real platforms, so that a progress surface can
 * be built on measured numbers rather than on a guess:
 *
 *   search  → data.gouv.fr's relevance search: does such a dataset exist?
 *   infer   → the platform's own metadata + a sample: the proposal
 *   (human) → the visitor validates — not measured here, it is not ours
 *   load    → the rows inside the current view: the integration
 *   (render)→ the local GeoJSON loader draws them — measured in qa-datasets
 *
 * Every stage records wall-clock, request count and bytes, per repetition, so
 * the cold first pass is never averaged away with the warm ones. What the run
 * prints is a distribution, not a mean: min / median / max, and the raw values.
 *
 * It also records WHICH dataset the search proposed first — the honest
 * bottleneck of this chain is relevance, not latency, and a harness that only
 * timed the calls would hide that.
 *
 * Usage:
 *   node scripts/measure-plug-e2e.mjs                    # all scenarios, 3 reps
 *   node scripts/measure-plug-e2e.mjs --reps 5
 *   node scripts/measure-plug-e2e.mjs --only defibril
 *   node scripts/measure-plug-e2e.mjs --json out.json    # raw records
 */
import { writeFile } from 'node:fs/promises';
import { inferDatasetManifest } from '../src/data/datasetInference.js';
import { datasetManifestFaults, normalizeDatasetManifest } from '../src/data/datasetManifest.js';
import { loadDatasetFeatures } from '../src/data/datasetSources.js';

const args = process.argv.slice(2);
const option = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : fallback;
};
const REPS = Number(option('--reps', '3'));
const ONLY = option('--only');
const JSON_OUT = option('--json');
/* How many search hits the proposal stage proves before it speaks. 0 = the naive
 * chain: propose the top hit sight unseen. */
const VERIFY = Number(option('--verify', '0'));

/** The view the reader is looking at while asking — central Paris, ~13 km wide. */
const PARIS = { west: 2.24, south: 48.81, east: 2.42, north: 48.91 };

/*
 * Scenarios are phrased as a visitor would ask them out loud, then reduced to
 * the query string a search tool would receive. The last one is deliberately
 * hopeless: a chain that is only ever measured on its successes lies about
 * what a live session feels like.
 */
const SCENARIOS = [
  { key: 'defibrillateurs', ask: 'Est-ce qu\'on a les défibrillateurs ?', query: 'défibrillateurs' },
  { key: 'irve', ask: 'Et les bornes de recharge pour voitures électriques ?', query: 'bornes de recharge véhicules électriques' },
  { key: 'arbres', ask: 'Les arbres remarquables de Paris ?', query: 'arbres remarquables Paris' },
  { key: 'pharmacies', ask: 'Les pharmacies ?', query: 'pharmacies' },
  { key: 'accidents', ask: 'Les accidents de la route ?', query: 'accidents corporels de la circulation' },
  { key: 'introuvable', ask: 'Les nids de frelons asiatiques signalés cette semaine ?', query: 'nids de frelons asiatiques signalements hebdomadaires' },
];

/** A fetch that counts what it cost, so a stage reports bytes as well as milliseconds. */
function instrumentedFetch() {
  const calls = [];
  const impl = async (url, init) => {
    const started = performance.now();
    const href = typeof url === 'string' ? url : url?.url || String(url);
    let response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      calls.push({ url: href, ms: performance.now() - started, status: 0, bytes: 0, error: String(error?.message || error) });
      throw error;
    }
    // Read the body here so the byte count is real, then hand back a clone-safe
    // response the caller can consume normally.
    const buffer = await response.arrayBuffer();
    calls.push({ url: href, ms: performance.now() - started, status: response.status, bytes: buffer.byteLength });
    return new Response(buffer, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
  return { impl, calls };
}

function stageTotals(calls, from) {
  const slice = calls.slice(from);
  return { requests: slice.length, bytes: slice.reduce((sum, call) => sum + call.bytes, 0) };
}

/** data.gouv.fr's relevance search — api/2, the service that ranks, not api/1. */
async function searchDatagouv(query, fetchImpl, pageSize = 5) {
  const url = `https://www.data.gouv.fr/api/2/datasets/search/?q=${encodeURIComponent(query)}&page_size=${pageSize}`;
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`search ${response.status}`);
  const payload = await response.json();
  const candidates = (payload.data || []).map((item) => ({
    title: item.title,
    slug: item.slug,
    publisher: item.organization?.name || item.owner?.first_name || null,
    licence: item.license || null,
    quality: item.quality?.score ?? null,
    resources: item.resources?.total ?? 0,
    page: `https://www.data.gouv.fr/datasets/${item.slug}/`,
  }));
  return { total: payload.total ?? 0, candidates };
}

async function runScenario(scenario) {
  const { impl, calls } = instrumentedFetch();
  const record = { key: scenario.key, ask: scenario.ask, query: scenario.query, stages: {}, ok: false };
  const mark = () => calls.length;

  // ── search ───────────────────────────────────────────────────────────────
  let at = mark();
  let started = performance.now();
  let search;
  try {
    search = await searchDatagouv(scenario.query, impl);
    record.stages.search = { ms: performance.now() - started, ...stageTotals(calls, at), hits: search.total };
    record.candidates = search.candidates;
  } catch (error) {
    record.stages.search = { ms: performance.now() - started, ...stageTotals(calls, at), error: String(error?.message || error) };
    return record;
  }
  if (!search.candidates.length) {
    record.note = 'aucun candidat';
    return record;
  }

  /*
   * ── infer (the proposal) ──────────────────────────────────────────────────
   *
   * Two chains, and the difference between them is the whole design question.
   *
   * VERIFY = 0 — the naive chain: read the top hit, propose it. Cheapest, and
   * it proposes datasets that cannot be drawn: a zombie whose resources all
   * 404, or a table with no column that says where a row is.
   *
   * VERIFY = n — read the first n hits AT ONCE and propose the first that
   * validates. The reads are network-bound and independent, so n of them cost
   * about one; what it buys is that nothing is ever proposed before it has
   * been proven drawable.
   */
  at = mark();
  started = performance.now();
  const shortlist = VERIFY > 0 ? search.candidates.slice(0, VERIFY) : search.candidates.slice(0, 1);
  const drafts = await Promise.all(shortlist.map(async (candidate) => {
    try {
      const inferred = await inferDatasetManifest(candidate.page, { fetchImpl: impl, relay: null });
      return { candidate, inferred, fault: inferred.faults.length ? inferred.faults.join(' · ') : null };
    } catch (error) {
      return { candidate, inferred: null, fault: String(error?.message || error) };
    }
  }));
  const kept = drafts.find((draft) => draft.inferred && !draft.fault) || null;
  record.stages.infer = {
    ms: performance.now() - started,
    ...stageTotals(calls, at),
    read: shortlist.length,
    drawable: drafts.filter((draft) => !draft.fault).length,
    rejected: drafts.filter((draft) => draft.fault).map((draft) => `${draft.candidate.title.slice(0, 44)} — ${draft.fault.slice(0, 70)}`),
    platform: kept?.inferred.platform || null,
  };
  if (!kept) {
    record.note = `aucun candidat exploitable sur ${shortlist.length} lu(s)`;
    return record;
  }
  record.picked = kept.candidate;
  record.rank = shortlist.indexOf(kept.candidate) + 1;
  const inference = kept.inferred;

  // ── load (the integration) ───────────────────────────────────────────────
  const manifest = normalizeDatasetManifest(inference.manifest);
  record.manifest = { id: manifest.id, kind: manifest.source.kind, scope: manifest.source.scope, maxFeatures: manifest.source.maxFeatures };
  at = mark();
  started = performance.now();
  try {
    const loaded = await loadDatasetFeatures(manifest, {
      bbox: manifest.source.scope === 'viewport' ? PARIS : null,
      fetchImpl: impl,
      relay: null,
    });
    record.stages.load = {
      ms: performance.now() - started,
      ...stageTotals(calls, at),
      features: loaded.features?.length ?? 0,
      total: loaded.total ?? null,
      truncated: Boolean(loaded.truncated),
      unplaced: loaded.unplaced ?? 0,
    };
    record.ok = (loaded.features?.length ?? 0) > 0;
  } catch (error) {
    record.stages.load = { ms: performance.now() - started, ...stageTotals(calls, at), error: String(error?.message || error) };
    return record;
  }

  record.machineMs = ['search', 'infer', 'load'].reduce((sum, key) => sum + (record.stages[key]?.ms || 0), 0);
  record.calls = calls;
  return record;
}

function stats(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { n: sorted.length, min: sorted[0], median: at(0.5), max: sorted[sorted.length - 1] };
}

const ms = (value) => (value == null ? '—' : `${Math.round(value)} ms`);
const kb = (value) => (value == null ? '—' : `${(value / 1024).toFixed(value < 1024 * 10 ? 1 : 0)} ko`);

const selected = SCENARIOS.filter((scenario) => !ONLY || scenario.key.includes(ONLY) || scenario.query.includes(ONLY));
const runs = [];

for (const scenario of selected) {
  console.log(`\n━━ ${scenario.ask}`);
  console.log(`   « ${scenario.query} »`);
  for (let rep = 1; rep <= REPS; rep += 1) {
    const record = await runScenario(scenario);
    record.rep = rep;
    runs.push(record);
    const line = ['search', 'infer', 'load']
      .map((key) => {
        const stage = record.stages[key];
        if (!stage) return `${key} —`;
        if (stage.error) return `${key} ✗ ${stage.error.slice(0, 40)}`;
        return `${key} ${Math.round(stage.ms)}ms/${stage.requests}req`;
      })
      .join('  ·  ');
    const tail = record.ok
      ? `  ⇒ ${record.stages.load.features} objets${record.stages.load.total ? ` / ${record.stages.load.total}` : ''}, ${ms(record.machineMs)}${record.rank > 1 ? ` (hit n°${record.rank})` : ''}`
      : `  ⇒ ✗ ${record.note || 'échec'}`;
    console.log(`   ${rep === 1 ? 'froid' : `rep ${rep}`.padEnd(5)}  ${line}${tail}`);
  }
  const rejected = runs.filter((run) => run.key === scenario.key)[0]?.stages.infer?.rejected || [];
  for (const line of rejected) console.log(`   écarté : ${line}`);
  const first = runs.filter((run) => run.key === scenario.key)[0];
  if (first?.candidates?.length) {
    console.log('   proposé :');
    first.candidates.slice(0, 3).forEach((candidate, index) => {
      console.log(`     ${index === 0 ? '→' : ' '} ${candidate.title} — ${candidate.publisher || '?'} (${candidate.resources} ressources)`);
    });
  }
}

// ── The distribution, per stage, across everything that succeeded ──────────
console.log('\n\n━━━━━━ DISTRIBUTION ━━━━━━');
const good = runs.filter((run) => run.ok);
for (const key of ['search', 'infer', 'load']) {
  const cold = stats(runs.filter((run) => run.rep === 1 && run.stages[key] && !run.stages[key].error).map((run) => run.stages[key].ms));
  const warm = stats(runs.filter((run) => run.rep > 1 && run.stages[key] && !run.stages[key].error).map((run) => run.stages[key].ms));
  const requests = stats(runs.filter((run) => run.stages[key] && !run.stages[key].error).map((run) => run.stages[key].requests));
  console.log(`${key.padEnd(7)} froid ${ms(cold?.min).padStart(8)} … ${ms(cold?.median).padStart(8)} … ${ms(cold?.max).padStart(8)}   ·   chaud ${ms(warm?.median).padStart(8)}   ·   ${requests?.min}–${requests?.max} requêtes`);
}
const totals = stats(good.map((run) => run.machineMs));
console.log(`\ntotal machine (search+infer+load) : ${ms(totals?.min)} … ${ms(totals?.median)} … ${ms(totals?.max)}   sur ${good.length}/${runs.length} passes réussies`);
console.log(`bytes par passe réussie : ${kb(stats(good.map((run) => run.calls.reduce((sum, call) => sum + call.bytes, 0)))?.median)}`);

const failures = runs.filter((run) => !run.ok);
if (failures.length) {
  console.log('\n━━━━━━ CE QUI N\'A PAS ABOUTI ━━━━━━');
  for (const run of failures) {
    const stage = ['search', 'infer', 'load'].find((key) => run.stages[key]?.error) || null;
    console.log(`  ${run.key} (rep ${run.rep}) — ${stage ? `${stage} : ${run.stages[stage].error}` : run.note || 'inconnu'}`);
  }
}

if (JSON_OUT) {
  await writeFile(JSON_OUT, `${JSON.stringify(runs, null, 2)}\n`, 'utf8');
  console.log(`\nBrut : ${JSON_OUT}`);
}
