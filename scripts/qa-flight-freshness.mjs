#!/usr/bin/env node
/**
 * qa-flight-freshness — phase 3d: why the flights layer wore an orange badge
 * and dropped to the regional feed within minutes, and what changed.
 *
 * The report was "this data layer falls into fallback mode very quickly".
 * There was no fault behind it. There were two independently written 120 s
 * constants — one in the proxy deciding when to abandon OpenSky for the 250 nm
 * adsb.lol circle, one in the browser deciding when to light STALE — and a
 * credit governor between them that stretches the response cache to 300 s as
 * the daily OpenSky budget thins. A body served from a 300 s cache is more
 * than 120 s old by construction. Past the first tier, the thresholds were not
 * measuring staleness; they were guaranteeing it.
 *
 * This harness measures the live proxy across one full cache window and shows
 * both verdicts side by side. It does not look at pixels: the claim is
 * arithmetic, and the arithmetic is the whole of it.
 *
 *  A. THE GOVERNOR IS REALLY STRETCHED. `X-OpenSky-Ttl-Seconds` reports the TTL
 *     in force. On an anonymous key this reaches 300 s within the hour, which
 *     is the precondition for everything below. (A run at 9 s proves nothing
 *     about the bug and says so rather than passing quietly.)
 *
 *  B. THE OLD RULE WOULD HAVE FLIPPED. Count the samples whose snapshot age
 *     exceeds a fixed 120 s. Those are the polls that used to read FALLBACK.
 *
 *  C. THE NEW RULE DOES NOT. No sample within the governor's own TTL plus its
 *     tolerance is called stale, and the served source stays OpenSky.
 *
 *  D. THE VERDICT IS A FIELD, NOT A REGEX. When the regional circle IS served,
 *     the response says so in `X-Flight-Fallback`, so the control chip stops
 *     inferring a feed verdict from the prose of a source name.
 *
 * Run: node scripts/qa-flight-freshness.mjs --url http://localhost:5174
 */
import {
  OPENSKY_MAX_TTL_MS,
  openSkyStaleThresholdMs,
} from '../src/data/openSkyFreshness.js';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = option('--url', process.env.QA_BASE_URL || 'http://localhost:5174');
/** The client's own poll cadence, so the samples are the polls it would make. */
const SAMPLE_INTERVAL_MS = 30_000;
/** One full longest-tier window, plus a sample either side of it. */
const SAMPLE_COUNT = Number(option('--samples', '13'));
/** The constant this phase replaced, kept here to score the old rule. */
const LEGACY_STALE_MS = 120_000;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const failures = [];
function check(label, condition, detail = '') {
  const ok = Boolean(condition);
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

async function sample() {
  const response = await fetch(`${APP_URL}/api/opensky/states?lat=48.85&lon=2.4`);
  const header = (name) => response.headers.get(name);
  let snapshotEpochMs = null;
  let count = 0;
  try {
    const body = await response.json();
    const seconds = Number(body?.time);
    if (Number.isFinite(seconds) && seconds > 0) snapshotEpochMs = seconds * 1000;
    count = Array.isArray(body?.states) ? body.states.length : 0;
  } catch { /* a body we cannot read is reported as such below */ }
  const ttlSec = Number(header('x-opensky-ttl-seconds'));
  return {
    status: response.status,
    source: header('x-flight-source') || 'OpenSky Network',
    fallbackHeader: header('x-flight-fallback'),
    cache: header('x-opensky-cache'),
    auth: header('x-opensky-auth'),
    ttlMs: Number.isFinite(ttlSec) ? ttlSec * 1000 : null,
    ageMs: snapshotEpochMs == null ? null : Math.max(0, Date.now() - snapshotEpochMs),
    count,
  };
}

async function main() {
  console.log(`[qa] sampling ${APP_URL}/api/opensky every ${SAMPLE_INTERVAL_MS / 1000} s, ${SAMPLE_COUNT} times`);
  const samples = [];
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    if (index > 0) await sleep(SAMPLE_INTERVAL_MS);
    const taken = await sample();
    samples.push(taken);
    const age = taken.ageMs == null ? '—' : `${Math.round(taken.ageMs / 1000)} s`;
    console.log(
      `    ${String(index + 1).padStart(2)}. ${taken.source.padEnd(18)} cache=${String(taken.cache).padEnd(8)}`
      + ` ttl=${taken.ttlMs == null ? '—' : `${taken.ttlMs / 1000}s`} age=${age.padStart(6)} n=${taken.count}`,
    );
  }
  console.log('');

  const ttls = samples.map((one) => one.ttlMs).filter((ttl) => Number.isFinite(ttl));
  check('the proxy publishes the TTL it is applying', ttls.length === samples.length);
  const maxTtl = ttls.length ? Math.max(...ttls) : 0;
  console.log(`[qa] auth mode: ${samples[0]?.auth}, widest TTL seen: ${maxTtl / 1000} s`);

  // ── A. is the precondition even present? ──────────────────────────────────
  if (maxTtl < OPENSKY_MAX_TTL_MS) {
    console.log('[qa] the credit governor is NOT stretched on this key right now');
    console.log('[qa] (full budget → 9 s TTL → the old and new rules agree). Nothing to');
    console.log('[qa] measure: re-run on a key whose daily OpenSky credit has thinned,');
    console.log('[qa] which an anonymous one does within the hour.');
    process.exitCode = failures.length ? 1 : 2;
    return;
  }

  const aged = samples.filter((one) => Number.isFinite(one.ageMs));
  const legacyStale = aged.filter((one) => one.ageMs > LEGACY_STALE_MS);
  const currentStale = aged.filter(
    (one) => one.ageMs > openSkyStaleThresholdMs(one.ttlMs),
  );

  // ── B / C. the two rules, on the same samples ─────────────────────────────
  check(
    'B. the fixed 120 s rule would have called some of these polls stale',
    legacyStale.length > 0,
    `${legacyStale.length}/${aged.length} samples over 120 s old`,
  );
  check(
    'C. the TTL-aware rule calls none of them stale',
    currentStale.length === 0,
    `${currentStale.length}/${aged.length} over TTL + tolerance`
    + ` (${openSkyStaleThresholdMs(maxTtl) / 1000} s at this TTL)`,
  );
  check(
    'C. and the served source stays the worldwide OpenSky feed',
    samples.every((one) => !/adsb\.lol/i.test(one.source)),
    samples.filter((one) => /adsb\.lol/i.test(one.source)).length + ' regional samples',
  );

  // ── D. the verdict is a field ─────────────────────────────────────────────
  const regional = samples.filter((one) => /adsb\.lol/i.test(one.source));
  check(
    'D. a regional response declares itself in X-Flight-Fallback, not in its name',
    regional.every((one) => one.fallbackHeader === '1'),
    regional.length ? `${regional.length} regional samples` : 'none served this run',
  );

  console.log('');
  if (failures.length) {
    console.error(`[qa] ${failures.length} failure(s):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log('[qa] flight feed freshness: all checks passed');
}

main().catch((error) => {
  console.error('[qa] harness error:', error);
  process.exitCode = 1;
});
