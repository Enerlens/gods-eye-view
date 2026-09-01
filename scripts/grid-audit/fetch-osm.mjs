/**
 * Tiled, cached Overpass fetcher for the audit.
 *
 * Deliberately does NOT go through the app's own `/api/power-grid` proxy: that
 * one caps elements per class and snaps boxes, which is right for a viewport
 * and wrong for a census. Here we want everything OSM has, so the question
 * "is OSM complete?" is not confounded with "did our caps truncate?".
 *
 * Polite by construction: sequential, one mirror at a time, disk-cached, and
 * every tile is written before the next is asked for, so a re-run costs nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CACHE_DIR } from './reference.mjs';

// Ordered by measured reliability for THIS query during the audit run of
// 2026-08-28, re-probed mid-run: overpass.osm.jp refused every connection,
// and at 21:40 UTC overpass-api.de, kumi and private.coffee were ALL failing
// at once (000 / 502 / 000 on a one-node probe) while osm.ch answered 200.
// Public mirrors go down together often enough that the list is the fallback
// plan, not a preference — and the sweep is paced on top, because
// overpass-api.de answers 429 once a census-sized run gets going.
const MIRRORS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  // overpass.osm.ch is REJECTED by the probe below, and is listed here only so
  // it is never silently re-added: it serves a Switzerland-only extract and
  // answers a French bbox with HTTP 200 and zero elements. During this audit it
  // was the only mirror up, and it wrote 16 confidently empty tiles into the
  // cache before the zeros were noticed. A wrong answer that looks like a
  // successful one is the failure mode this whole file now guards against.
  'https://overpass.osm.ch/api/interpreter',
];
/**
 * A box that unambiguously contains high-voltage lines in central France
 * (south of Bourges). Any mirror answering "0" here is serving a regional
 * extract, not the planet, and must not be used.
 */
const PROBE_QUERY =
  '[out:json][timeout:60];way["power"="line"]["voltage"](46.9,2.2,47.2,2.6);out count;';
/** Mirrors that passed the extract probe, resolved once and reused. */
let liveMirrors = null;

/** Drop any mirror that cannot see France. */
async function resolveMirrors() {
  if (liveMirrors) return liveMirrors;
  const usable = [];
  for (const mirror of MIRRORS) {
    try {
      const res = await fetch(mirror, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: PROBE_QUERY }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const total = Number(JSON.parse(await res.text()).elements?.[0]?.tags?.total ?? 0);
      if (total > 0) {
        usable.push(mirror);
        process.stderr.write(`  [probe] ${mirror} — sees France (${total} ways)\n`);
      } else {
        process.stderr.write(`  [probe] ${mirror} — REJECTED, regional extract (0 ways in France)\n`);
      }
    } catch (err) {
      process.stderr.write(`  [probe] ${mirror} — unreachable (${err.message}), kept as a long shot\n`);
      usable.push(mirror);
    }
  }
  if (!usable.length) throw new Error('no Overpass mirror can see France');
  liveMirrors = usable;
  return usable;
}
/** Minimum spacing between two live Overpass hits, whatever the outcome. */
const MIN_GAP_MS = 2_500;
let lastHitAt = 0;
const CACHE = path.join(CACHE_DIR, 'osm-cache');
fs.mkdirSync(CACHE, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run one Overpass query, cached on disk by its exact text.
 * @param {string} query Overpass QL
 * @param {string} label human tag for the progress line
 * @returns {Promise<object>} the parsed Overpass payload
 */
export async function overpass(query, label) {
  const key = createHash('sha1').update(query).digest('hex');
  const file = path.join(CACHE, `${key}.json`);
  if (fs.existsSync(file)) {
    const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
    process.stderr.write(`  [cache] ${label} — ${cached.elements.length} elements\n`);
    return cached;
  }

  let lastError = null;
  // Two passes over the mirrors, no more. A tile that fails because it is too
  // BIG (Catalonia's grid inside a France-shaped tile) fails identically on
  // every attempt, and the caller's answer to that is to split it — so burning
  // fifteen tries first only delays the fix that works.
  const mirrors = await resolveMirrors();
  for (let attempt = 0; attempt < mirrors.length * 2; attempt += 1) {
    const mirror = mirrors[attempt % mirrors.length];
    const gap = MIN_GAP_MS - (Date.now() - lastHitAt);
    if (gap > 0) await sleep(gap);
    lastHitAt = Date.now();
    const started = Date.now();
    try {
      const res = await fetch(mirror, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': 'gods-eye-view-grid-audit/1.0 (OSM coverage check vs RTE open data)',
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(300_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const payload = JSON.parse(text);
      if (!Array.isArray(payload.elements)) throw new Error('no elements array');
      fs.writeFileSync(file, text);
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      process.stderr.write(
        `  [ok]    ${label} — ${payload.elements.length} elements, ${(text.length / 1e6).toFixed(1)} MB, ${secs}s\n`,
      );
      return payload;
    } catch (err) {
      lastError = err;
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      process.stderr.write(`  [retry] ${label} — ${String(err.message)} after ${secs}s\n`);
      // Linear, not exponential: a 429 clears on a scale of seconds, and the
      // sweep has 40 tiles to get through. Capped so one sick mirror cannot
      // stall the run behind a ten-minute sleep.
      await sleep(Math.min(45_000, 4_000 + attempt * 6_000));
    }
  }
  throw new Error(`${label}: every mirror failed — ${lastError?.message}`);
}

/** Metropolitan France, Corsica included, as audit tiles. */
export function franceTiles(step) {
  const [west, south, east, north] = [-5.3, 41.2, 9.7, 51.2];
  const tiles = [];
  for (let x = west; x < east; x += step) {
    for (let y = south; y < north; y += step) {
      tiles.push({
        west: Number(x.toFixed(3)),
        south: Number(y.toFixed(3)),
        east: Number(Math.min(east, x + step).toFixed(3)),
        north: Number(Math.min(north, y + step).toFixed(3)),
      });
    }
  }
  return tiles;
}
