#!/usr/bin/env node
/**
 * Build `config/pan_route_types.json` — the `route_id → route_type` map that
 * lets a live French transit vehicle be drawn as a bus, a tram, a métro or a
 * river shuttle instead of an undifferentiated dot.
 *
 * THE PROBLEM. GTFS-Realtime `VehiclePosition` carries no vehicle class. It
 * carries `trip.route_id`, and what that id MEANS lives in the network's
 * static GTFS `routes.txt`. So the join is mandatory, and it cannot happen in
 * the browser: measured 2026-08-31, Bordeaux TBM's static archive is 26.7 MB
 * zipped and 250 MB expanded (`stop_times.txt` alone is 223 MB), and there are
 * ~140 such networks. `routes.txt` inside it is 8.7 KB.
 *
 * SO THIS SCRIPT READS ONLY THAT MEMBER. Where the publisher honours HTTP
 * `Range` — which `transport.data.gouv.fr` does — `scripts/lib/remoteZip.mjs`
 * pulls `routes.txt` out of a 50 MB archive in about 80 KB of transfer. Where
 * it does not — several publishers stream the archive chunked from origin, so
 * there is no range to ask for — the whole body is read once and discarded.
 * The build prints which path each network took and what it cost.
 *
 * WHAT IS COMMITTED, AND WHAT IT IS NOT. Per feed: the route map, the tally of
 * vehicle kinds the network publishes, and — when the archive declares a
 * single class for every route — `uniformKind`, which types vehicles whose
 * `route_id` never resolves. NOT committed: `shapes.txt` (20 MB for Bordeaux
 * alone), `trips.txt` (7 MB, and its ids are re-minted with every GTFS
 * version, so a shipped copy is stale within days), or anything else.
 *
 * THE JOIN RATE IS MEASURED, NOT ASSUMED. Unless `--no-join-check` is passed,
 * each network's live feed is probed once and the fraction of vehicles the map
 * actually resolves is recorded per feed. A network that ships a route map
 * resolving 0% of its own vehicles is a fact worth having in the file rather
 * than a surprise at runtime.
 *
 * Source:   GET https://transport.data.gouv.fr/api/datasets  (public, keyless)
 * Licences: the static GTFS carries the same licence as its realtime sibling,
 *           recorded per feed in `config/pan_gtfs_rt_feeds.json`. Nothing is
 *           re-licensed here; only `route_id` and `route_type` are extracted.
 *
 * Usage:
 *   node scripts/build-pan-route-types.mjs [--concurrency=4] [--timeout=120000]
 *                                          [--catalog=path/to/datasets.json]
 *                                          [--out=config/pan_route_types.json]
 *                                          [--no-join-check] [--max-download-mb=96]
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { vehiclePositionsFromBytes } from '../src/data/gtfsRealtime.js';
import { PAN_DATASETS_URL, isVehiclePositionResource } from '../src/data/panFeeds.js';
import {
  kindFromRouteType,
  parseRouteTypes,
  resolveVehicleKind,
  uniformKindOf,
} from '../src/data/transitVehicleKind.js';
import { fetchZipMemberRanged, readZipMember } from './lib/remoteZip.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = path.join(ROOT, 'config', 'pan_route_types.json');
const FEED_INDEX = path.join(ROOT, 'config', 'pan_gtfs_rt_feeds.json');
const USER_AGENT = 'gods-eye-view/0.1 (+https://github.com/bilawalsidhu/gods-eye-view)';

function parseArgs(argv) {
  const args = {
    concurrency: 4,
    timeout: 120000,
    out: DEFAULT_OUT,
    catalog: null,
    joinCheck: true,
    maxDownloadMb: 96,
  };
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=');
    if (key === 'concurrency') args.concurrency = Math.max(1, Number(value) || 4);
    else if (key === 'timeout') args.timeout = Math.max(5000, Number(value) || 120000);
    else if (key === 'out') args.out = path.resolve(ROOT, value);
    else if (key === 'catalog') args.catalog = path.resolve(ROOT, value);
    else if (key === 'no-join-check') args.joinCheck = false;
    else if (key === 'max-download-mb') args.maxDownloadMb = Math.max(1, Number(value) || 96);
    else if (key === 'help' || key === 'h') args.help = true;
  }
  return args;
}

async function fetchJson(url, timeoutMs) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/**
 * Read `routes.txt` out of one remote GTFS archive.
 *
 * Ranged first, whole-body second. The whole-body path is capped: an archive
 * larger than the cap is refused rather than pulled into memory, because the
 * only thing wanted from it is a few kilobytes and no French network needs
 * that much to publish its route list.
 *
 * @returns {Promise<{text: string, via: 'range'|'download', bytes: number}>}
 */
async function readRoutesTxt(url, { timeoutMs, maxDownloadBytes }) {
  try {
    const ranged = await fetchZipMemberRanged(url, 'routes.txt', {
      userAgent: USER_AGENT,
      timeoutMs,
    });
    if (!ranged.buffer) throw new Error('archive has no routes.txt');
    return { text: ranged.buffer.toString('utf8'), via: 'range', bytes: ranged.fetchedBytes };
  } catch (rangeError) {
    // A publisher that streams its archive chunked from origin cannot serve a
    // range. Fall back, but say what it cost.
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} (range: ${rangeError.message})`);
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxDownloadBytes) {
      await response.arrayBuffer().catch(() => {});
      throw new Error(`archive ${(declared / 1048576).toFixed(0)} MB exceeds download cap`);
    }
    const archive = Buffer.from(await response.arrayBuffer());
    if (archive.length > maxDownloadBytes) throw new Error('archive exceeds download cap');
    const member = readZipMember(archive, 'routes.txt');
    if (!member) throw new Error('archive has no routes.txt');
    return { text: member.toString('utf8'), via: 'download', bytes: archive.length };
  }
}

/** Probe one realtime feed and report how much of it the route map explains. */
async function measureJoin(feed, entry, timeoutMs) {
  try {
    const response = await fetch(feed.url, {
      headers: {
        Accept: 'application/x-protobuf,application/octet-stream;q=0.9,*/*;q=0.8',
        'User-Agent': USER_AGENT,
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    const { vehicles } = vehiclePositionsFromBytes(bytes, { feedId: feed.id });
    if (!vehicles.length) return null;
    let direct = 0;
    let resolved = 0;
    for (const vehicle of vehicles) {
      const outcome = resolveVehicleKind(vehicle.routeId, entry);
      if (outcome.source === 'route_type') direct += 1;
      if (outcome.kind) resolved += 1;
    }
    return { sampled: vehicles.length, direct, resolved };
  } catch {
    return null;
  }
}

/** Run `worker` over `items` with a fixed number of in-flight tasks. */
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

/**
 * Pair every vehicle-position feed with the static GTFS resources published
 * alongside it, in the same dataset.
 *
 * Several datasets ship more than one GTFS (STAR Rennes publishes "version en
 * cours" and "version à venir", and the first of them currently 404s), so the
 * list is kept in order and tried in turn rather than reduced to a guess.
 */
function pairFeedsWithStatic(datasets) {
  const pairs = [];
  for (const dataset of Array.isArray(datasets) ? datasets : []) {
    const resources = Array.isArray(dataset?.resources) ? dataset.resources : [];
    const realtime = resources.filter(isVehiclePositionResource);
    if (!realtime.length) continue;
    const statics = resources
      .filter((resource) => resource.format === 'GTFS' && resource.url)
      .map((resource) => ({
        url: String(resource.url),
        title: String(resource.title || ''),
        // The PAN validates every static feed it lists and records which modes
        // it found. Kept as a cross-check on what routes.txt yields.
        catalogModes: Array.isArray(resource?.metadata?.modes) ? resource.metadata.modes : [],
      }));
    for (const resource of realtime) {
      pairs.push({
        id: `pan-${resource.id}`,
        network: String(dataset.title || '').trim(),
        url: String(resource.url),
        statics,
      });
    }
  }
  return pairs;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(String(await fsp.readFile(fileURLToPath(import.meta.url), 'utf8')).split('*/')[0]);
    return;
  }

  console.log(`[routes] catalog ← ${args.catalog || PAN_DATASETS_URL}`);
  const datasets = args.catalog
    ? JSON.parse(await fsp.readFile(args.catalog, 'utf8'))
    : await fetchJson(PAN_DATASETS_URL, Math.max(args.timeout, 60000));

  // Duplicates resolved by the feed index are skipped: they are the same body
  // as their keeper and would download the same archive twice.
  let skipIds = new Set();
  try {
    const index = JSON.parse(await fsp.readFile(FEED_INDEX, 'utf8'));
    skipIds = new Set((index.feeds || []).filter((feed) => feed.duplicateOf).map((feed) => feed.id));
  } catch {
    console.log('[routes] no feed index found — every resource will be processed');
  }

  const pairs = pairFeedsWithStatic(datasets).filter((pair) => !skipIds.has(pair.id));
  console.log(`[routes] ${pairs.length} realtime feeds with a static sibling `
    + `(${skipIds.size} duplicate feeds skipped)`);

  let done = 0;
  let fetchedBytes = 0;
  const maxDownloadBytes = args.maxDownloadMb * 1048576;
  const built = await mapWithConcurrency(pairs, args.concurrency, async (pair) => {
    let routes = null;
    let via = null;
    let bytes = 0;
    let error = null;
    for (const resource of pair.statics) {
      try {
        const read = await readRoutesTxt(resource.url, {
          timeoutMs: args.timeout,
          maxDownloadBytes,
        });
        const parsed = parseRouteTypes(read.text);
        if (!Object.keys(parsed).length) throw new Error('routes.txt has no usable route_type column');
        routes = parsed;
        via = read.via;
        bytes = read.bytes;
        break;
      } catch (resourceError) {
        error = resourceError?.message || String(resourceError);
      }
    }

    done += 1;
    if (!routes) {
      console.log(`[routes] ${String(done).padStart(3)}/${pairs.length}  FAIL ${pair.network.slice(0, 44)} — ${error}`);
      return { pair, error };
    }

    fetchedBytes += bytes;
    const kinds = {};
    for (const routeType of Object.values(routes)) {
      const kind = kindFromRouteType(routeType) || 'unknown';
      kinds[kind] = (kinds[kind] || 0) + 1;
    }
    const entry = { routes, uniformKind: uniformKindOf(routes) };
    const join = args.joinCheck ? await measureJoin(pair, entry, 25000) : null;

    const joinMark = join
      ? ` join ${Math.round((100 * join.resolved) / join.sampled)}% of ${join.sampled}`
      : '';
    console.log(
      `[routes] ${String(done).padStart(3)}/${pairs.length}  ${String(Object.keys(routes).length).padStart(4)} routes`
      + ` ${via === 'range' ? 'range' : ' full'} ${(bytes / 1024).toFixed(0).padStart(6)}KB`
      + `${joinMark}  ${pair.network.slice(0, 40)}`,
    );
    return { pair, routes, kinds, uniformKind: entry.uniformKind, via, bytes, join };
  });

  const now = new Date().toISOString();
  const feeds = {};
  let routeCount = 0;
  for (const result of built) {
    if (!result?.routes) continue;
    routeCount += Object.keys(result.routes).length;
    feeds[result.pair.id] = {
      network: result.pair.network,
      routes: result.routes,
      kinds: result.kinds,
      uniformKind: result.uniformKind,
      // How well this map explained the live feed at build time. `null` when
      // the feed was asleep or the check was skipped.
      join: result.join
        ? {
          sampled: result.join.sampled,
          direct: result.join.direct,
          resolved: result.join.resolved,
          at: now,
        }
        : null,
    };
  }

  const failures = built.filter((result) => result && !result.routes);
  const payload = {
    source: PAN_DATASETS_URL,
    generatedAt: now,
    generator: 'scripts/build-pan-route-types.mjs',
    note: 'route_id → GTFS route_type, read from each network\'s static routes.txt; '
      + 'uniformKind is set only when every route in the network shares one class',
    feedCount: Object.keys(feeds).length,
    feedsWithoutRoutes: failures.length,
    routeCount,
    feeds,
    // Named, not silent: a feed missing here draws with its network's service
    // class and the layer says the type is unknown.
    unresolved: failures.map((result) => ({
      id: result.pair.id,
      network: result.pair.network,
      error: result.error,
    })),
  };

  await fsp.mkdir(path.dirname(args.out), { recursive: true });
  await fsp.writeFile(args.out, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  const outBytes = (await fsp.stat(args.out)).size;
  console.log(
    `[routes] wrote ${path.relative(ROOT, args.out)} — ${payload.feedCount} feeds, `
    + `${routeCount} routes, ${(outBytes / 1024).toFixed(0)} KB `
    + `(${(fetchedBytes / 1048576).toFixed(1)} MB transferred, ${failures.length} unresolved)`,
  );
}

main().catch((error) => {
  console.error('[routes] build failed:', error?.message || error);
  process.exitCode = 1;
});
