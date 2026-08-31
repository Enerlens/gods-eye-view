#!/usr/bin/env node
/**
 * Build `config/pan_gtfs_rt_feeds.json` — the shipped index of French
 * GTFS-Realtime **vehicle position** feeds published on the Point d'Accès
 * National, https://transport.data.gouv.fr (the national access point France
 * operates under EU regulation 2017/1926).
 *
 * Source:   GET https://transport.data.gouv.fr/api/datasets  (public, keyless)
 * Licences: carried per feed, verbatim from the catalog (`lov2` = Licence
 *           Ouverte 2.0, `odc-odbl` = ODbL 1.0, …). No dataset is re-licensed
 *           here; the index only records what the publisher declared.
 *
 * WHY THE INDEX IS SHIPPED: the catalog publishes coverage as a NAME
 * ("epci: Bordeaux Métropole"), never as a bounding box, so a viewport-driven
 * layer has no way to ask "which feeds are on screen". The only non-inventive
 * footprint is the OBSERVED one — where a feed's vehicles actually were when
 * it was probed — and probing 150 feeds is a minute of wall clock that must
 * not sit in front of a user's first frame. So it is done here, once, and
 * committed. The dev-server proxy keeps growing these bounds at runtime.
 *
 * WHAT AN OBSERVED BBOX IS AND IS NOT: it is a measurement of one moment. A
 * network's real service area is at least as large as its box; an off-peak
 * probe sees less of it, and a network with no vehicles running at probe time
 * gets `bbox: null` and is carried in the index without one (the proxy gives
 * such feeds a small rotating allowance so they can reveal themselves later).
 * Junk fixes are fenced out before measuring — see `boundsOfVehicles` — because
 * one bus reported in the Sahara turns a city footprint into half a continent.
 *
 * Usage:
 *   node scripts/build-pan-gtfs-rt-index.mjs [--concurrency=8] [--timeout=20000]
 *                                            [--catalog=path/to/datasets.json]
 *                                            [--out=config/pan_gtfs_rt_feeds.json]
 *                                            [--no-probe]
 *
 * `--no-probe` refreshes descriptors from the catalog while KEEPING the bounds
 * already in the output file — use it to pick up new networks without
 * re-measuring every footprint.
 *
 * TWO THINGS THE CATALOG DOES NOT SAY, MEASURED HERE. Both live under
 * `src/data/panFeedHealth.js` and are recorded per feed:
 *
 *   - `duplicateOf` — some networks publish one body under two resource ids.
 *     Measured 2026-08-31, Kicéo's two resources returned the same 62 vehicles
 *     at the same 62 coordinates and Lila presqu'île's the same 14; each was
 *     drawn twice. A candidate found in the first probe pass is RE-PROBED, and
 *     only a second agreement is recorded — resources that merely looked alike
 *     for one moment are kept.
 *
 *   - `health` — a run of failed probes quarantines a feed out of viewport
 *     selection. Between 2026-08-26 and 2026-08-31, seven resources began
 *     answering HTTP 403 behind a WAF and one HTTP 500. Nothing is deleted: a
 *     single successful probe in any later build clears the quarantine.
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { vehiclePositionsFromBytes, boundsOfVehicles } from '../src/data/gtfsRealtime.js';
import { PAN_DATASETS_URL, vehiclePositionFeedsFromCatalog } from '../src/data/panFeeds.js';
import {
  applyProbeHealth,
  duplicateFeedGroups,
  fleetFingerprint,
  fleetRoster,
  sameFleet,
} from '../src/data/panFeedHealth.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = path.join(ROOT, 'config', 'pan_gtfs_rt_feeds.json');
const USER_AGENT = 'gods-eye-view/0.1 (+https://github.com/bilawalsidhu/gods-eye-view)';
/** Feed body cap. The largest French vehicle-position feed is well under 1 MB. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

function parseArgs(argv) {
  const args = { concurrency: 8, timeout: 20000, out: DEFAULT_OUT, catalog: null, probe: true };
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=');
    if (key === 'concurrency') args.concurrency = Math.max(1, Number(value) || 8);
    else if (key === 'timeout') args.timeout = Math.max(1000, Number(value) || 20000);
    else if (key === 'out') args.out = path.resolve(ROOT, value);
    else if (key === 'catalog') args.catalog = path.resolve(ROOT, value);
    else if (key === 'no-probe') args.probe = false;
    else if (key === 'help' || key === 'h') args.help = true;
  }
  return args;
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch one feed body and measure it. Never throws — failures are recorded. */
async function probeFeed(feed, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(feed.url, {
      headers: { Accept: 'application/x-protobuf,application/octet-stream;q=0.9,*/*;q=0.8', 'User-Agent': USER_AGENT },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}`, ms: Date.now() - startedAt };
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_BODY_BYTES) {
      return { ok: false, error: 'body too large', ms: Date.now() - startedAt };
    }
    const { vehicles, entityCount } = vehiclePositionsFromBytes(bytes, { feedId: feed.id });
    return {
      ok: true,
      ms: Date.now() - startedAt,
      bytes: bytes.byteLength,
      entityCount,
      vehicles: vehicles.length,
      bbox: boundsOfVehicles(vehicles, { rejectOutliers: true }),
      // Two digests of the same fleet: positional (finds duplicate candidates)
      // and roster-only (confirms them after the fleet has moved on).
      fingerprint: fleetFingerprint(vehicles, feed.id),
      roster: fleetRoster(vehicles, feed.id),
    };
  } catch (error) {
    const message = error?.name === 'AbortError' ? 'timeout' : (error?.message || String(error));
    return { ok: false, error: message, ms: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}

/** Run `worker` over `items` with a fixed number of in-flight tasks. */
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function readExistingIndex(outPath) {
  try {
    return JSON.parse(await fsp.readFile(outPath, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(String(await fsp.readFile(fileURLToPath(import.meta.url), 'utf8')).split('*/')[0]);
    return;
  }

  console.log(`[PAN] catalog ← ${args.catalog || PAN_DATASETS_URL}`);
  const datasets = args.catalog
    ? JSON.parse(await fsp.readFile(args.catalog, 'utf8'))
    : await fetchJson(PAN_DATASETS_URL, Math.max(args.timeout, 60000));
  console.log(`[PAN] ${datasets.length} datasets`);

  const feeds = vehiclePositionFeedsFromCatalog(datasets);
  console.log(`[PAN] ${feeds.length} gtfs-rt resources declaring vehicle_positions`);

  const previous = await readExistingIndex(args.out);
  const previousById = new Map((previous?.feeds || []).map((feed) => [feed.id, feed]));

  let probes = [];
  if (args.probe) {
    console.log(`[PAN] probing at concurrency ${args.concurrency}, timeout ${args.timeout}ms …`);
    let done = 0;
    probes = await mapWithConcurrency(feeds, args.concurrency, async (feed) => {
      const probe = await probeFeed(feed, args.timeout);
      done += 1;
      const mark = probe.ok ? `${String(probe.vehicles).padStart(5)} veh` : `  FAIL ${probe.error}`;
      console.log(`[PAN] ${String(done).padStart(3)}/${feeds.length} ${mark}  ${feed.network}`);
      return probe;
    });
  } else {
    console.log('[PAN] --no-probe: keeping bounds from the existing index');
  }

  // --- Duplicate confirmation ---------------------------------------------
  // A single agreeing probe is a coincidence budget this build refuses to
  // spend: a wrong verdict here silently deletes a network from the map. So
  // candidates found positionally in the first pass are re-probed — and the
  // second question is the ROSTER, not the positions. The fleet has moved
  // between the two passes; asking for identical coordinates twice tests the
  // upstream's refresh timing, not whether two resources are one feed.
  const duplicateOf = new Map();
  const disproven = new Set();
  if (args.probe) {
    const candidates = duplicateFeedGroups(feeds.map((feed, i) => ({
      id: feed.id,
      resourceId: feed.resourceId,
      fingerprint: probes[i]?.fingerprint || null,
    })));
    if (candidates.length) {
      const members = [...new Set(candidates.flatMap((g) => [g.keeper, ...g.duplicates]))];
      console.log(`[PAN] ${candidates.length} duplicate candidate group(s), re-probing ${members.length} feeds …`);
      const byId = new Map(feeds.map((feed) => [feed.id, feed]));
      // Every member of a group at once, so the two bodies are read as close
      // to the same instant as the network allows.
      const confirmPairs = await Promise.all(members.map(async (id) => {
        const probe = await probeFeed(byId.get(id), args.timeout);
        return [id, probe?.ok ? probe.roster : null];
      }));
      const confirmed = new Map(confirmPairs);
      for (const group of candidates) {
        const keeperRoster = confirmed.get(group.keeper);
        for (const id of group.duplicates) {
          if (sameFleet(keeperRoster, confirmed.get(id))) {
            duplicateOf.set(id, group.keeper);
            console.log(`[PAN] duplicate confirmed: ${id} → ${group.keeper} (${group.fleet} vehicles)`);
          } else if (keeperRoster && confirmed.get(id)) {
            // Both answered and the rosters differ: positive evidence that
            // these are two feeds, which is the only thing that may overturn
            // a verdict an earlier build confirmed.
            disproven.add(id);
            console.log(`[PAN] duplicate DISPROVEN on re-probe: ${id} vs ${group.keeper}`);
          } else {
            console.log(`[PAN] duplicate inconclusive (a feed did not answer): ${id} vs ${group.keeper}`);
          }
        }
      }
    }
  }

  /**
   * Resolve one feed's duplicate verdict.
   *
   * A confirmed duplicate is STICKY: a resource does not stop being a mirror
   * because one probe timed out, and letting a failed probe clear the verdict
   * makes the flag flap between builds — which is how a double-drawn fleet
   * comes back. Only two feeds that both answered with different rosters
   * overturn it.
   */
  function resolveDuplicateOf(feed, prior) {
    if (!args.probe) return prior?.duplicateOf || null;
    if (duplicateOf.has(feed.id)) return duplicateOf.get(feed.id);
    if (disproven.has(feed.id)) return null;
    return prior?.duplicateOf || null;
  }

  const now = new Date().toISOString();
  const indexed = feeds.map((feed, i) => {
    const probe = probes[i];
    const prior = previousById.get(feed.id);
    // Bounds only ever grow across builds: a quiet probe must not shrink a
    // footprint measured at rush hour.
    const bbox = probe?.bbox
      ? (prior?.bbox
        ? {
          south: Math.min(prior.bbox.south, probe.bbox.south),
          west: Math.min(prior.bbox.west, probe.bbox.west),
          north: Math.max(prior.bbox.north, probe.bbox.north),
          east: Math.max(prior.bbox.east, probe.bbox.east),
        }
        : probe.bbox)
      : (prior?.bbox || null);
    return {
      ...feed,
      bbox,
      vehicleSample: probe?.ok ? probe.vehicles : (prior?.vehicleSample ?? 0),
      observedAt: probe?.bbox ? now : (prior?.observedAt || null),
      lastProbe: probe
        ? { at: now, ok: probe.ok, ms: probe.ms, vehicles: probe.vehicles ?? 0, error: probe.error || null }
        : (prior?.lastProbe || null),
      // A run of failed probes takes a feed out of viewport selection without
      // deleting it; one success anywhere in a later build brings it back.
      health: probe
        ? applyProbeHealth(prior?.health, probe, now)
        : (prior?.health || null),
      // Set only when a second probe agreed that this resource carries the
      // same fleet as its keeper, and cleared only by contrary evidence.
      duplicateOf: resolveDuplicateOf(feed, prior),
    };
  });

  const withBounds = indexed.filter((feed) => feed.bbox).length;
  const quarantined = indexed.filter((feed) => feed.health?.quarantined).length;
  const duplicates = indexed.filter((feed) => feed.duplicateOf).length;
  const payload = {
    source: PAN_DATASETS_URL,
    generatedAt: now,
    generator: 'scripts/build-pan-gtfs-rt-index.mjs',
    note: 'bbox values are OBSERVED vehicle bounds at probe time, not published coverage areas',
    datasetCount: datasets.length,
    feedCount: indexed.length,
    feedsWithBounds: withBounds,
    // Shipped ≠ queryable. Duplicates and quarantined feeds stay in the file
    // so the next build can revive them, but no viewport spends a slot on
    // them — see `panFeedHealth.partitionFeedsByHealth`.
    feedsQueryable: indexed.length - quarantined - duplicates,
    feedsQuarantined: quarantined,
    feedsDuplicate: duplicates,
    feeds: indexed,
  };

  await fsp.mkdir(path.dirname(args.out), { recursive: true });
  await fsp.writeFile(args.out, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(
    `[PAN] wrote ${path.relative(ROOT, args.out)} — ${indexed.length} feeds, `
    + `${withBounds} with observed bounds, ${payload.feedsQueryable} queryable `
    + `(${duplicates} duplicate, ${quarantined} quarantined)`,
  );
}

main().catch((error) => {
  console.error('[PAN] build failed:', error?.message || error);
  process.exitCode = 1;
});
