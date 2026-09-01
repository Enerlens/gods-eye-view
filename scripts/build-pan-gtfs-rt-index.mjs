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
 * THREE THINGS THE CATALOG DOES NOT SAY, MEASURED HERE. The first two live
 * under `src/data/panFeedHealth.js`; all three are recorded per feed:
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
 *
 *   - `tripUpdates` / `alerts` — WHICH resource carries this feed's delays and
 *     which carries its disruptions. Every one of the 150 datasets publishes
 *     trip updates and 60 publish alerts, but the catalog never says which
 *     resource pairs with which position feed, and a dataset can publish
 *     several of each: Astuce ships three position feeds and four trip-update
 *     feeds, one per operator, on interleaved ids. So candidates are probed
 *     and the winner is the one whose trips actually JOIN the vehicles this
 *     feed just reported — the measured join rate ships with it.
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  alertsFromBytes,
  boundsOfVehicles,
  tripUpdatesFromBytes,
  vehiclePositionsFromBytes,
} from '../src/data/gtfsRealtime.js';
import {
  companionResources,
  vehiclePositionFeedsFromCatalog,
  PAN_DATASETS_URL,
  PAN_SERVICE_ALERTS_FEATURE,
  PAN_TRIP_UPDATES_FEATURE,
} from '../src/data/panFeeds.js';
import { indexTripUpdates, matchTripUpdate } from '../src/data/transitSchedule.js';
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
/**
 * Feed body cap. The largest French vehicle-position feed is well under 1 MB;
 * the largest TRIP-UPDATE body is TBM's at 1.2 MB, because a trip update
 * carries every remaining stop of every running trip (36 on average).
 */
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

/**
 * Bodies already fetched in THIS run, keyed by URL.
 *
 * 63 of the 150 position feeds serve their trip updates and alerts from the
 * same resource id, and several datasets point two position feeds at one
 * companion. Without this the build would download the same megabyte three
 * times and hammer a publisher that answers 429 when asked twice quickly.
 */
const _bodies = new Map();

/** Fetch one GTFS-RT body, once per run. Never throws — failures are values. */
async function fetchBody(url, timeoutMs) {
  const cached = _bodies.get(url);
  if (cached) return cached;
  const promise = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/x-protobuf,application/octet-stream;q=0.9,*/*;q=0.8', 'User-Agent': USER_AGENT },
        signal: controller.signal,
        redirect: 'follow',
      });
      if (!response.ok) return { ok: false, error: `HTTP ${response.status}`, ms: Date.now() - startedAt };
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > MAX_BODY_BYTES) {
        return { ok: false, error: 'body too large', ms: Date.now() - startedAt };
      }
      return { ok: true, bytes, ms: Date.now() - startedAt };
    } catch (error) {
      const message = error?.name === 'AbortError' ? 'timeout' : (error?.message || String(error));
      return { ok: false, error: message, ms: Date.now() - startedAt };
    } finally {
      clearTimeout(timer);
    }
  })();
  _bodies.set(url, promise);
  return promise;
}

/** Fetch one feed body and measure it. Never throws — failures are recorded. */
async function probeFeed(feed, timeoutMs) {
  const startedAt = Date.now();
  try {
    const body = await fetchBody(feed.url, timeoutMs);
    if (!body.ok) return { ok: false, error: body.error, ms: body.ms };
    const bytes = body.bytes;
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
      // Kept for the companion measurement below, never written to the index.
      // NOT named `vehicles`: that key is the COUNT one line up, and a second
      // property of the same name would silently replace it with the array.
      vehicleRecords: vehicles,
    };
  } catch (error) {
    return { ok: false, error: error?.message || String(error), ms: Date.now() - startedAt };
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

/** How many candidate companions of one kind are probed before giving up. */
const MAX_COMPANION_CANDIDATES = 4;

/**
 * Pick, by measurement, the trip-update and alert resources that belong to one
 * position feed.
 *
 * TRIP UPDATES are scored on the only question that matters downstream: what
 * fraction of the vehicles this feed just reported can be joined to a trip in
 * the candidate body, by `trip_id` or by vehicle id. A candidate that answers
 * for none of them is not this feed's companion however adjacent its id.
 *
 * ALERTS cannot be scored that way — an alert names lines, not vehicles, and a
 * network with nothing wrong publishes an empty body that is still the right
 * resource. They are scored on how many of the feed's own `route_id`s the
 * candidate informs, with the alert count as the tie-break, and the top-ranked
 * candidate is kept when nothing separates them.
 *
 * @returns {{tripUpdates: ?Object, alerts: ?Object}}
 */
async function resolveCompanions({ feed, dataset, resource, probe, timeoutMs }) {
  const vehicles = probe?.vehicleRecords || [];
  const routeIds = new Set(vehicles.map((vehicle) => vehicle.routeId).filter(Boolean));

  const tripCandidates = companionResources(dataset, resource, PAN_TRIP_UPDATES_FEATURE)
    .slice(0, MAX_COMPANION_CANDIDATES);
  let bestTrip = null;
  for (const candidate of tripCandidates) {
    const body = await fetchBody(candidate.url, timeoutMs);
    if (!body.ok) continue;
    let trips = [];
    try {
      trips = tripUpdatesFromBytes(body.bytes).trips;
    } catch { continue; }
    const index = indexTripUpdates(trips);
    const matched = vehicles.filter((vehicle) => matchTripUpdate(vehicle, index)).length;
    // Unmeasurable, not zero: a feed with no vehicles running at probe time
    // says nothing about which companion is its own.
    const joinRate = vehicles.length ? matched / vehicles.length : null;
    const entry = {
      resourceId: candidate.id,
      url: candidate.url,
      sameResource: candidate.id === resource.id,
      tripCount: trips.length,
      joinRate: joinRate === null ? null : Number(joinRate.toFixed(3)),
      bytes: body.bytes.byteLength,
      measuredAt: new Date().toISOString(),
    };
    // Strictly better only. A TIE keeps the earlier candidate, which is the
    // one `companionResources` ranked first — the feed's own body, then the
    // adjacent id. Breaking ties on trip count instead would hand TaM's
    // suburban feed to the urban network's much larger body, both being
    // unjoinable at a quiet hour.
    if (!bestTrip || (entry.joinRate ?? -1) > (bestTrip.joinRate ?? -1)) bestTrip = entry;
    // A perfect join cannot be beaten; stop paying for the rest.
    if (bestTrip.joinRate === 1) break;
  }

  const alertCandidates = companionResources(dataset, resource, PAN_SERVICE_ALERTS_FEATURE)
    .slice(0, MAX_COMPANION_CANDIDATES);
  let bestAlert = null;
  for (const candidate of alertCandidates) {
    const body = await fetchBody(candidate.url, timeoutMs);
    if (!body.ok) continue;
    let alerts = [];
    try {
      alerts = alertsFromBytes(body.bytes).alerts;
    } catch { continue; }
    const informed = new Set(
      alerts.flatMap((alert) => alert.informed.map((entity) => entity.routeId).filter(Boolean)),
    );
    let hits = 0;
    for (const routeId of routeIds) if (informed.has(routeId)) hits += 1;
    const entry = {
      resourceId: candidate.id,
      url: candidate.url,
      sameResource: candidate.id === resource.id,
      alertCount: alerts.length,
      routeMatch: routeIds.size ? Number((hits / routeIds.size).toFixed(3)) : null,
      bytes: body.bytes.byteLength,
      measuredAt: new Date().toISOString(),
    };
    // Same tie rule, with one addition: when NEITHER candidate could be scored
    // (the feed reported no routes at all), the one that actually carries
    // alerts is more useful than an empty body at the adjacent id.
    const better = (entry.routeMatch ?? -1) > (bestAlert?.routeMatch ?? -1);
    const unscoredButLouder = bestAlert
      && entry.routeMatch === null && bestAlert.routeMatch === null
      && entry.alertCount > bestAlert.alertCount;
    if (!bestAlert || better || unscoredButLouder) bestAlert = entry;
  }

  return { tripUpdates: bestTrip, alerts: bestAlert };
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

  // --- Companion resolution -----------------------------------------------
  // A network's delays live in a DIFFERENT resource from its positions, and
  // the catalog does not say which. Adjacent resource ids are a strong hint
  // (`companionResources` ranks on it) but they are only a hint: Astuce
  // publishes three position feeds and four trip-update feeds, one per
  // operator, on interleaved ids. So the candidates are probed and the one
  // whose trips actually JOIN this feed's own vehicles is kept, with the
  // measured join rate carried into the index so the layer can be honest
  // about a network where the answer is "none of them".
  const companions = new Map();
  if (args.probe) {
    const byResourceId = new Map();
    for (const dataset of datasets) {
      for (const resource of Array.isArray(dataset?.resources) ? dataset.resources : []) {
        if (resource?.id !== undefined) byResourceId.set(resource.id, { dataset, resource });
      }
    }
    const pairable = feeds.filter((feed, i) => probes[i]?.ok && byResourceId.has(feed.resourceId));
    console.log(`[PAN] resolving trip-update and alert companions for ${pairable.length} feeds …`);
    let done = 0;
    await mapWithConcurrency(pairable, args.concurrency, async (feed) => {
      const i = feeds.indexOf(feed);
      const probe = probes[i];
      const { dataset, resource } = byResourceId.get(feed.resourceId);
      const resolved = await resolveCompanions({ feed, dataset, resource, probe, timeoutMs: args.timeout });
      companions.set(feed.id, resolved);
      done += 1;
      const trip = resolved.tripUpdates
        ? `TU ${resolved.tripUpdates.resourceId} ${resolved.tripUpdates.joinRate === null ? 'unmeasured' : `${Math.round(resolved.tripUpdates.joinRate * 100)}%`}`
        : 'TU none';
      const alert = resolved.alerts ? `AL ${resolved.alerts.resourceId} (${resolved.alerts.alertCount})` : 'AL none';
      console.log(`[PAN] ${String(done).padStart(3)}/${pairable.length} ${trip.padEnd(22)} ${alert.padEnd(18)} ${feed.network}`);
      return resolved;
    });
  } else {
    console.log('[PAN] --no-probe: keeping companions from the existing index');
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
      // The resources that carry this feed's DELAYS and its DISRUPTIONS, each
      // chosen by measurement — see `resolveCompanions`. A run that could not
      // measure keeps whatever the last one learned.
      tripUpdates: companions.get(feed.id)?.tripUpdates || prior?.tripUpdates || null,
      alerts: companions.get(feed.id)?.alerts || prior?.alerts || null,
    };
  });

  const withBounds = indexed.filter((feed) => feed.bbox).length;
  const withTripUpdates = indexed.filter((feed) => feed.tripUpdates?.url).length;
  const withAlerts = indexed.filter((feed) => feed.alerts?.url).length;
  const sharedBody = indexed.filter((feed) => feed.tripUpdates?.sameResource).length;
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
    // How much of the catalog can answer "how late is this bus" at all, and
    // how much of that answer costs no second request.
    feedsWithTripUpdates: withTripUpdates,
    feedsWithAlerts: withAlerts,
    feedsSharingOneBody: sharedBody,
    feeds: indexed,
  };

  await fsp.mkdir(path.dirname(args.out), { recursive: true });
  await fsp.writeFile(args.out, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(
    `[PAN] wrote ${path.relative(ROOT, args.out)} — ${indexed.length} feeds, `
    + `${withBounds} with observed bounds, ${payload.feedsQueryable} queryable `
    + `(${duplicates} duplicate, ${quarantined} quarantined), `
    + `${withTripUpdates} with trip updates (${sharedBody} in the same body), ${withAlerts} with alerts`,
  );
}

main().catch((error) => {
  console.error('[PAN] build failed:', error?.message || error);
  process.exitCode = 1;
});
