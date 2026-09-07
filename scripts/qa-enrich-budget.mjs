#!/usr/bin/env node
/**
 * qa-enrich-budget — phase 3a item 2: the measurement the budget raise was
 * conditioned on.
 *
 * `ENRICH_AMBIENT_BUDGET_CEIL` = 300 tokens, refilled 150 per 5 minutes, was
 * sized on 2026-07-03 when a rationed adsbdb lookup was the ONLY way a contact
 * could get an ICAO type designator. Phase 3a item 1 changed that premise: on
 * the adsb.lol path the designator now arrives in the feed itself, free, at
 * `state[18]`. Nobody re-measured the demand afterwards, so this harness does.
 *
 * WHAT SIZES THE TWO KNOBS. The token bucket has a ceiling and a refill rate,
 * and they answer two different questions:
 *
 *   - The CEILING is the FIRST-LOOK burst: how many airborne contacts a fresh
 *     region puts on screen at once. Under-size it and the visitor watches a
 *     region classify itself over the following quarter-hour.
 *   - The REFILL is the CHURN: how many contacts NEW to the session enter that
 *     region per 5 minutes. Under-size it and the bucket drains permanently —
 *     which is the exact 2026-07-03 field bug, in slow motion.
 *
 * Both are measured here on live upstream data, per region, over a real
 * wall-clock run; nothing is extrapolated from a single snapshot.
 *
 * WHAT THIS OVER- AND UNDER-COUNTS, said plainly. The ambient sweep enqueues
 * on-screen airborne contacts, and "on screen" depends on a camera this
 * harness does not have. It samples the same 250 nm circle the proxy's
 * fallback serves, which is a fair stand-in for a regional view, larger than a
 * city-level one and much smaller than a continental one. Ground contacts are
 * excluded exactly as the sweep excludes them.
 *
 * The two feed paths differ and are reported separately:
 *   - adsb.lol: `t` is present on most records, so only the remainder needs a
 *     lookup for its silhouette.
 *   - OpenSky /states/all: carries no designator at all, so the whole airborne
 *     count is demand. This is the path that sizes the knobs.
 *
 * NEEDS THE NETWORK: calls api.adsb.lol directly with the proxy's URL, radius
 * and User-Agent. An unreachable upstream is reported as "not testable here",
 * not as a failure.
 *
 * Usage: node scripts/qa-enrich-budget.mjs [--minutes 12] [--interval 30]
 */
import { normalizeAdsbLolPointResponse } from '../src/data/adsbLolFallback.js';

/** Mirrors vite.config.js ADSBLOL_POINT_RADIUS_NM — the proxy's own radius. */
const RADIUS_NM = 250;
/** Mirrors flights.js POLL cadence: the sweep runs once per poll. */
const DEFAULT_INTERVAL_SEC = 30;
const DEFAULT_MINUTES = 12;
/** The window the token bucket refills on (flights.js ENRICH_AMBIENT_REFILL_WINDOW_MS). */
const REFILL_WINDOW_MIN = 5;

/** Shipped knobs under measurement. */
const SHIPPED = { ceil: 300, refill: 150 };

const argv = process.argv.slice(2);
const getOpt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : dflt;
};
const MINUTES = getOpt('--minutes', DEFAULT_MINUTES);
const INTERVAL_SEC = getOpt('--interval', DEFAULT_INTERVAL_SEC);

/** Three fleets that do not overlap: one busy region could flatter the churn. */
const REGIONS = [
  { name: 'Paris', lat: 48.75, lon: 2.25 },
  { name: 'Los Angeles', lat: 34, lon: -118.25 },
  { name: 'Francfort', lat: 50, lon: 8.5 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchRegion(region) {
  const url = `https://api.adsb.lol/v2/lat/${region.lat}/lon/${region.lon}/dist/${RADIUS_NM}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'gods-eye-view-adsblol-regional-fallback/1.0',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return normalizeAdsbLolPointResponse(await res.json());
}

/** The sweep's own eligibility rule: airborne, 6-char hex, not yet requested. */
function eligible(state) {
  const onGround = state[8] === true;
  const hex = String(state[0] || '');
  return !onGround && /^[0-9a-f]{6}$/i.test(hex);
}

async function main() {
  const samples = Math.max(2, Math.round((MINUTES * 60) / INTERVAL_SEC));
  console.log(`\nqa-enrich-budget — ${REGIONS.length} régions, ${samples} relevés à ${INTERVAL_SEC} s (${MINUTES} min)\n`);

  // Probe once before committing to a long run.
  try {
    await fetchRegion(REGIONS[0]);
  } catch (error) {
    console.log(`  ○ upstream injoignable (${error?.message || error}) — non mesurable ici`);
    process.exit(0);
  }

  // `startMin` is the elapsed time of a region's FIRST SUCCESSFUL sample, not
  // of the run. A region whose opening sample is dropped upstream would
  // otherwise have its entire first-look fleet counted as arrivals, and report
  // a churn rate several times the truth — which is exactly what a first run
  // did for Frankfurt (488 per 5 min against a real ~138).
  /** @type {Map<string, {seen:Map<string,number>, firstLook:number, startMin:number|null, counts:number[], withType:number, total:number, misses:number}>} */
  const acc = new Map(REGIONS.map((r) => [r.name, {
    seen: new Map(), firstLook: 0, startMin: null, counts: [], withType: 0, total: 0, misses: 0,
  }]));

  const startedAt = Date.now();
  for (let i = 0; i < samples; i++) {
    const elapsedMin = (Date.now() - startedAt) / 60000;
    // SEQUENTIALLY, with a stagger. Firing the three regions in parallel made
    // upstream drop all but the first every round — the proxy never does that
    // (it holds one view anchor at a time), so parallelism here would be
    // measuring the harness rather than the fleet.
    const results = [];
    for (const region of REGIONS) {
      try {
        results.push({ region, snapshot: await fetchRegion(region) });
      } catch (error) {
        results.push({ region, error });
      }
      await sleep(1500);
    }
    for (const { region, snapshot, error } of results) {
      const a = acc.get(region.name);
      if (error || !snapshot) { a.misses += 1; continue; }
      const airborne = snapshot.states.filter(eligible);
      a.counts.push(airborne.length);
      if (a.startMin === null) {
        a.startMin = elapsedMin;
        a.firstLook = airborne.length;
      }
      for (const state of airborne) {
        const hex = String(state[0]).toLowerCase();
        if (!a.seen.has(hex)) a.seen.set(hex, elapsedMin);
        a.total += 1;
        if (String(state[18] || '').trim()) a.withType += 1;
      }
    }
    const tick = results.map(({ region, snapshot, error }) => (
      `${region.name} ${error ? '—' : snapshot.states.filter(eligible).length}`
    )).join('  ');
    console.log(`  [${String(i + 1).padStart(2)}/${samples}] ${tick}`);
    if (i < samples - 1) await sleep(INTERVAL_SEC * 1000);
  }

  const runMin = (Date.now() - startedAt) / 60000;
  console.log('\n--- Mesures ---\n');

  const rows = [];
  for (const region of REGIONS) {
    const a = acc.get(region.name);
    if (!a.counts.length) { console.log(`  ${region.name}: aucun relevé`); continue; }
    const mean = a.counts.reduce((s, n) => s + n, 0) / a.counts.length;
    const peak = Math.max(...a.counts);
    // Churn: contacts first seen strictly after the opening minute, per 5 min.
    // The first snapshot is the burst, not churn — counting it as churn would
    // inflate the refill rate by the whole first-look fleet.
    const startMin = a.startMin ?? 0;
    const observedMin = Math.max(0, runMin - startMin);
    const newAfterStart = [...a.seen.values()].filter((min) => min > startMin).length;
    const churnPer5 = observedMin > 0 ? (newAfterStart / observedMin) * REFILL_WINDOW_MIN : 0;
    const typeShare = a.total ? a.withType / a.total : 0;
    rows.push({ name: region.name, firstLook: a.firstLook, mean, peak, distinct: a.seen.size, churnPer5, typeShare });
    console.log(`  ${region.name}${a.misses ? `  (${a.misses} relevé(s) manqué(s) en amont)` : ''}`);
    console.log(`    première vue (contacts en vol)      : ${a.firstLook}`);
    console.log(`    moyenne / pic par relevé            : ${mean.toFixed(0)} / ${peak}`);
    console.log(`    distincts sur ${observedMin.toFixed(1)} min observées : ${a.seen.size}`);
    console.log(`    NOUVEAUX par ${REFILL_WINDOW_MIN} min (renouvellement) : ${churnPer5.toFixed(0)}`);
    console.log(`    part portant un désignateur \`t\`     : ${(typeShare * 100).toFixed(1)} %`);
    console.log('');
  }

  if (!rows.length) process.exit(1);

  const worstFirstLook = Math.max(...rows.map((r) => r.firstLook));
  const worstChurn = Math.max(...rows.map((r) => r.churnPer5));
  console.log('--- Ce que cela dit des deux boutons ---\n');
  console.log(`  Plafond (rafale de première vue), pire région : ${worstFirstLook}   — actuel ${SHIPPED.ceil}`);
  console.log(`  Recharge (renouvellement / 5 min), pire région : ${worstChurn.toFixed(0)}   — actuel ${SHIPPED.refill}`);
  const ceilOk = SHIPPED.ceil >= worstFirstLook;
  const refillOk = SHIPPED.refill >= worstChurn;
  console.log(`\n  ${ceilOk ? '✔' : '✖'} le plafond ${ceilOk ? 'couvre' : 'NE COUVRE PAS'} la première vue`);
  console.log(`  ${refillOk ? '✔' : '✖'} la recharge ${refillOk ? 'couvre' : 'NE COUVRE PAS'} le renouvellement`);
  console.log(`\n  Débit soutenu si la recharge couvre le renouvellement : `
    + `${(worstChurn / (REFILL_WINDOW_MIN * 60)).toFixed(2)} req/s `
    + `(la goutte-à-goutte du client plafonne à 5 req/s).\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
