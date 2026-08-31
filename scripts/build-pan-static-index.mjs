#!/usr/bin/env node
/**
 * Build `config/pan_gtfs_static.json` — for every French GTFS-Realtime vehicle
 * feed, the two companion resources that answer "what line is this, where does
 * it go, and which stops does it serve":
 *
 *   - its **TripUpdates** sibling, the realtime feed carrying the ordered
 *     stops of every running trip with the operator's own predicted times;
 *   - its static GTFS's **GeoJSON conversion**, which the PAN produces and
 *     hosts itself, carrying `shapes.txt` already joined to `routes.txt` plus
 *     every stop point with its `stop_id`.
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS SO SMALL. Drawing a line's trace needs
 * `shapes.txt`, and listing its stops needs `stop_times.txt`. Measured
 * 2026-08-31, those are the two largest members of a French GTFS archive by a
 * wide margin — Normandy's are 36 MB and 13 MB COMPRESSED, and Bordeaux's
 * `stop_times.txt` expands to 223 MB. Neither can be shipped, cached per
 * network at build time, or pulled into a browser.
 *
 * Both have a keyless substitute, and this index is the map to them:
 *
 *   - the trace comes from the PAN's own GeoJSON conversion of the archive,
 *     ~13 MB for Bordeaux and served from a CDN in under a second, fetched by
 *     the dev-server proxy once per network and cached to disk;
 *   - the stops come from the network's TripUpdates feed, which is live, a
 *     megabyte, and — measured 2026-08-31 — published by ALL 142 datasets that
 *     publish vehicle positions.
 *
 * WHAT IS RECORDED AND WHAT IS NOT. Per vehicle-position feed: the trip-update
 * resource, the static resources in catalog order with each one's conversion
 * URL, byte size and conversion timestamp, and the flags the PAN's own
 * validator publishes (`has_shapes`, stop count). NOT recorded: any geometry.
 * Nothing here is larger than a URL, and the file is ~90 KB.
 *
 * THE CONVERSION URL IS DERIVED, THE CONVERSION'S EXISTENCE IS MEASURED. The
 * stable URL is a function of the resource id, but only the per-dataset
 * endpoint says whether a conversion has been produced and when — so this
 * script makes one call per dataset rather than assuming 142 URLs resolve.
 *
 * Source:   GET https://transport.data.gouv.fr/api/datasets      (public, keyless)
 *           GET https://transport.data.gouv.fr/api/datasets/:id  (public, keyless)
 * Licences: carried per feed from the catalog, verbatim. The conversion
 *           inherits the licence of the archive it was made from; nothing is
 *           re-licensed here.
 *
 * Usage:
 *   node scripts/build-pan-static-index.mjs [--concurrency=6] [--timeout=30000]
 *                                           [--catalog=path/to/datasets.json]
 *                                           [--out=config/pan_gtfs_static.json]
 *                                           [--no-probe]
 *
 * `--no-probe` skips the one-byte range check that confirms each conversion is
 * actually served, and records `reachable: null` instead of true/false.
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PAN_DATASETS_URL,
  isTripUpdateResource,
  isVehiclePositionResource,
  panFeedDescriptor,
  panGeoJsonConversionUrl,
  staticGtfsResources,
} from '../src/data/panFeeds.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = path.join(ROOT, 'config', 'pan_gtfs_static.json');
const FEED_INDEX = path.join(ROOT, 'config', 'pan_gtfs_rt_feeds.json');
const USER_AGENT = 'gods-eye-view/0.1 (+https://github.com/bilawalsidhu/gods-eye-view)';

function parseArgs(argv) {
  const args = { concurrency: 6, timeout: 30000, out: DEFAULT_OUT, catalog: null, probe: true };
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=');
    if (key === 'concurrency') args.concurrency = Math.max(1, Number(value) || 6);
    else if (key === 'timeout') args.timeout = Math.max(1000, Number(value) || 30000);
    else if (key === 'out') args.out = path.resolve(ROOT, value);
    else if (key === 'catalog') args.catalog = path.resolve(ROOT, value);
    else if (key === 'no-probe') args.probe = false;
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
 * Confirm a conversion URL is actually served, in one byte.
 *
 * A `GET` with `Range: bytes=0-0`, not a `HEAD`: the conversion is a redirect
 * to object storage, and several PAN redirect targets answer `HEAD`
 * differently from `GET`. A `200` counts as reachable too — the point here is
 * "does this URL yield the file", not "does it honour ranges".
 *
 * @returns {Promise<?boolean>} null when the check was not run.
 */
async function probeConversion(url, timeoutMs) {
  try {
    const response = await fetch(url, {
      headers: { Range: 'bytes=0-0', 'User-Agent': USER_AGENT },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    await response.arrayBuffer().catch(() => {});
    return response.status === 206 || response.status === 200;
  } catch {
    return false;
  }
}

/**
 * Everything one dataset contributes: its vehicle feeds, its trip-update
 * resources, and its static archives with the conversion of each.
 *
 * `conversions` lives only on the PER-DATASET endpoint, so the bulk catalog
 * gives the pairing and this second call gives the geometry.
 *
 * @param {Object} dataset One entry of the bulk catalog.
 * @param {Object} detail The same dataset from `/api/datasets/:id`.
 * @returns {Array<{feed: Object, entry: Object}>}
 */
export function pairDataset(dataset, detail) {
  const resources = Array.isArray(dataset?.resources) ? dataset.resources : [];
  const vehicleFeeds = resources.filter(isVehiclePositionResource);
  if (!vehicleFeeds.length) return [];

  const tripUpdates = resources.filter(isTripUpdateResource).map((resource) => ({
    resourceId: resource.id,
    url: String(resource.url),
    title: String(resource.title || '').trim() || null,
    pageUrl: String(resource.page_url || '').trim() || null,
  }));

  // The conversion metadata is keyed by resource id in the detail document;
  // the bulk record is what everything else in this repo is built from, so the
  // two are joined rather than one being trusted for both.
  const detailById = new Map(
    (Array.isArray(detail?.resources) ? detail.resources : []).map((resource) => [resource.id, resource]),
  );
  const statics = staticGtfsResources(dataset).map((resource) => {
    const enriched = detailById.get(resource.id) || {};
    const conversion = enriched?.conversions?.GeoJSON || null;
    const metadata = resource.metadata || enriched.metadata || {};
    return {
      resourceId: resource.id,
      title: String(resource.title || '').trim() || null,
      pageUrl: String(resource.page_url || '').trim() || null,
      updated: resource.updated || null,
      // `has_shapes` is the PAN validator's own verdict on the archive. A feed
      // that declares false has no trace to draw, and saying so here means the
      // proxy never spends a 13 MB fetch to discover it.
      hasShapes: typeof metadata.has_shapes === 'boolean' ? metadata.has_shapes : null,
      stopCount: Number.isFinite(metadata.stops_count) ? metadata.stops_count : null,
      routeCount: Number.isFinite(metadata?.stats?.routes_count) ? metadata.stats.routes_count : null,
      // The URL is always derived, because the catalog under-reports: ten
      // vehicle feeds across seven archives carry no `conversions` block and
      // every one of their derived URLs served content when probed on
      // 2026-08-31. `declared` records which of the two said so, so a
      // conversion nobody announced is never mistaken for one the PAN
      // guarantees it keeps up to date.
      geojson: {
        url: conversion?.stable_url || panGeoJsonConversionUrl(resource.id),
        declared: Boolean(conversion),
        bytes: Number.isFinite(conversion?.filesize) ? conversion.filesize : null,
        checkedAt: conversion?.last_check_conversion_is_up_to_date || null,
        reachable: null,
      },
    };
  });

  return vehicleFeeds.map((resource) => {
    const descriptor = panFeedDescriptor(dataset, resource);
    return {
      feed: descriptor,
      entry: {
        network: descriptor?.network || String(dataset.title || ''),
        datasetId: dataset.id ? String(dataset.id) : null,
        datasetUrl: descriptor?.datasetUrl || null,
        licence: descriptor?.licence || null,
        licenceLabel: descriptor?.licenceLabel || null,
        tripUpdates,
        statics,
      },
    };
  });
}

/**
 * The static resource whose geometry the runtime should try first.
 *
 * Conversions that answered the probe win over ones that did not, and among
 * equals the catalog order is kept — which is the publisher's own preference
 * between a "version en cours" and a "version à venir".
 *
 * @param {Array<Object>} statics Entries as written by {@link pairDataset}.
 * @returns {?Object}
 */
export function preferredStaticResource(statics) {
  const usable = (Array.isArray(statics) ? statics : []).filter((resource) => resource?.geojson);
  return usable.find((resource) => resource.geojson.reachable === true)
    || usable.find((resource) => resource.geojson.reachable !== false)
    || null;
}

/** Count how much of the fleet the index can actually explain. */
export function summarize(entries) {
  let withTripUpdates = 0;
  let withGeometry = 0;
  let withShapesDeclared = 0;
  let conversionBytes = 0;
  for (const entry of Object.values(entries)) {
    if (entry.tripUpdates.length) withTripUpdates += 1;
    const geo = preferredStaticResource(entry.statics);
    if (geo) {
      withGeometry += 1;
      conversionBytes += geo.geojson.bytes || 0;
    }
    if (entry.statics.some((resource) => resource.hasShapes === true)) withShapesDeclared += 1;
  }
  return { withTripUpdates, withGeometry, withShapesDeclared, conversionBytes };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(String(await fsp.readFile(fileURLToPath(import.meta.url), 'utf8')).split('*/')[0]);
    return;
  }

  console.log(`[static] catalog ← ${args.catalog || PAN_DATASETS_URL}`);
  const datasets = args.catalog
    ? JSON.parse(await fsp.readFile(args.catalog, 'utf8'))
    : await fetchJson(PAN_DATASETS_URL, Math.max(args.timeout, 60000));

  // Duplicate feeds resolved by the realtime index share a body with their
  // keeper, so they would also share its line geometry. Skipped, not merged:
  // the keeper's id is the one the proxy serves under.
  let skipIds = new Set();
  try {
    const index = JSON.parse(await fsp.readFile(FEED_INDEX, 'utf8'));
    skipIds = new Set((index.feeds || []).filter((feed) => feed.duplicateOf).map((feed) => feed.id));
  } catch {
    console.log('[static] no realtime index found — every vehicle feed will be indexed');
  }

  const withVehicles = (Array.isArray(datasets) ? datasets : [])
    .filter((dataset) => (dataset?.resources || []).some(isVehiclePositionResource));
  console.log(`[static] ${withVehicles.length} datasets publish vehicle positions`);

  let done = 0;
  const paired = await mapWithConcurrency(withVehicles, args.concurrency, async (dataset) => {
    let detail = null;
    try {
      detail = await fetchJson(`${PAN_DATASETS_URL}/${dataset.id}`, args.timeout);
    } catch (error) {
      // The pairing still works without the detail call; only the conversion
      // URL is lost, and the entry says so rather than pretending otherwise.
      console.log(`[static] detail unavailable for ${dataset.id} — ${error?.message || error}`);
    }
    done += 1;
    const rows = pairDataset(dataset, detail);
    const geo = preferredStaticResource(rows[0]?.entry.statics);
    console.log(
      `[static] ${String(done).padStart(3)}/${withVehicles.length}`
      + ` ${rows.length} feed${rows.length === 1 ? ' ' : 's'}`
      + ` ${rows[0]?.entry.tripUpdates.length ? 'TU' : '--'}`
      + ` ${geo?.geojson.declared ? `${((geo.geojson.bytes || 0) / 1048576).toFixed(1).padStart(5)} MB` : ' undeclared'}`
      + `  ${String(dataset.title || '').slice(0, 46)}`,
    );
    return rows;
  });

  const feeds = {};
  for (const rows of paired) {
    for (const { feed, entry } of rows) {
      if (!feed || skipIds.has(feed.id)) continue;
      feeds[feed.id] = entry;
    }
  }

  if (args.probe) {
    const targets = [];
    for (const entry of Object.values(feeds)) {
      for (const resource of entry.statics) {
        if (resource.geojson) targets.push(resource.geojson);
      }
    }
    console.log(`[static] probing ${targets.length} conversion URLs`);
    await mapWithConcurrency(targets, args.concurrency, async (geojson) => {
      geojson.reachable = await probeConversion(geojson.url, args.timeout);
    });
    const dead = targets.filter((geojson) => geojson.reachable === false).length;
    console.log(`[static] ${targets.length - dead}/${targets.length} conversions served`);
  }

  const ordered = {};
  for (const id of Object.keys(feeds).sort()) ordered[id] = feeds[id];
  const stats = summarize(ordered);
  const payload = {
    source: PAN_DATASETS_URL,
    generatedAt: new Date().toISOString(),
    generator: 'scripts/build-pan-static-index.mjs',
    note: 'Companion resources for the live vehicle feeds: the TripUpdates feed that '
      + 'carries each running trip\'s ordered stops, and the PAN\'s own GeoJSON conversion '
      + 'of the static GTFS, which carries the line traces. URLs only — no geometry is '
      + 'committed here.',
    feedCount: Object.keys(ordered).length,
    feedsWithTripUpdates: stats.withTripUpdates,
    feedsWithGeometry: stats.withGeometry,
    feedsDeclaringShapes: stats.withShapesDeclared,
    conversionBytesTotal: stats.conversionBytes,
    feeds: ordered,
  };

  await fsp.mkdir(path.dirname(args.out), { recursive: true });
  await fsp.writeFile(args.out, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  const bytes = (await fsp.stat(args.out)).size;
  console.log(
    `[static] wrote ${path.relative(ROOT, args.out)} — ${payload.feedCount} feeds, `
    + `${stats.withTripUpdates} with trip updates, ${stats.withGeometry} with a GeoJSON conversion `
    + `(${(stats.conversionBytes / 1048576).toFixed(0)} MB of geometry available on demand), `
    + `${(bytes / 1024).toFixed(0)} KB`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('[static] build failed:', error?.message || error);
    process.exitCode = 1;
  });
}
