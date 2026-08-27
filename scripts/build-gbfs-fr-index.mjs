#!/usr/bin/env node
/**
 * Build `config/gbfs_fr_systems.json` — the shipped index of French shared-
 * mobility systems (GBFS) published on the Point d'Accès National,
 * https://transport.data.gouv.fr.
 *
 * Source:   GET https://transport.data.gouv.fr/api/datasets  (public, keyless)
 * Licences: carried per system, verbatim from the catalog.
 *
 * WHAT THIS SCRIPT IS REALLY FOR: de-duplication. The catalog lists 172 GBFS
 * resources, but far fewer real systems, and it duplicates itself four ways —
 * one operator under many dataset entries, one system at several GBFS
 * versions, one system on two different publisher hosts, and systems already
 * drawn by `bikeshare.js`. None of those are catchable by comparing URLs or
 * names, so every system is probed and identified by the SET OF PLACES it
 * reports (see `coordSignature` / `containment` in `src/data/gbfsFeeds.js`).
 *
 * Duplicates are KEPT in the output and marked `redundant`, never silently
 * dropped: the index is then also the evidence for why something is not drawn.
 *
 * Usage:
 *   node scripts/build-gbfs-fr-index.mjs [--concurrency=8] [--timeout=20000]
 *                                        [--catalog=path/to/datasets.json]
 *                                        [--out=config/gbfs_fr_systems.json]
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bikeshareCoveredSystems } from '../src/data/bikeshare.js';
import { boundsOfPoints } from '../src/data/viewportBox.js';
import {
  coordSignature,
  findRedundantSystems,
  freeVehicleFeedUrl,
  gbfsSystemsFromCatalog,
  parseGbfsStationStatus,
  parseGbfsStations,
  parseGbfsVehicles,
  isSentinelStation,
  normalizedSystemName,
  registrableDomain,
  sharedStationFraction,
  stationFrequency,
  systemDrawsStations,
  resolveGbfsDiscovery,
  vehicleKindLookup,
  PAN_DATASETS_URL,
} from '../src/data/gbfsFeeds.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = path.join(ROOT, 'config', 'gbfs_fr_systems.json');
const USER_AGENT = 'gods-eye-view/0.1 (+https://github.com/bilawalsidhu/gods-eye-view)';
const MAX_BODY_BYTES = 24 * 1024 * 1024;

/** Publisher host of a resolved feed URL, or null when it cannot be parsed. */
function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
}

function parseArgs(argv) {
  const args = { concurrency: 8, timeout: 20000, out: DEFAULT_OUT, catalog: null };
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=');
    if (key === 'concurrency') args.concurrency = Math.max(1, Number(value) || 8);
    else if (key === 'timeout') args.timeout = Math.max(1000, Number(value) || 20000);
    else if (key === 'out') args.out = path.resolve(ROOT, value);
    else if (key === 'catalog') args.catalog = path.resolve(ROOT, value);
  }
  return args;
}

async function getJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new Error('body too large');
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve one system's feed URLs, then measure what it actually reports. */
async function probeSystem(system, timeoutMs) {
  const out = {
    feeds: null, stations: 0, docked: 0, vehicles: 0, bbox: null,
    places: new Set(), fleet: new Set(), kinds: {}, error: null, kind: null, sentinel: false,
  };
  try {
    let feeds = null;
    const url = system.discoveryUrl;
    const pathname = new URL(url).pathname;
    if (/gbfs(\.json)?$/i.test(pathname) || /manifest/i.test(url)) {
      feeds = resolveGbfsDiscovery(await getJson(url, timeoutMs));
    }
    if (!feeds) {
      // A direct data URL: derive its siblings from the same folder.
      const base = url.replace(/[^/]*$/, '');
      feeds = {
        station_information: `${base}station_information.json`,
        station_status: `${base}station_status.json`,
        free_bike_status: `${base}free_bike_status.json`,
        vehicle_types: `${base}vehicle_types.json`,
      };
    }
    out.feeds = feeds;

    const kinds = feeds.vehicle_types
      ? vehicleKindLookup(await getJson(feeds.vehicle_types, timeoutMs).catch(() => null))
      : {};
    out.kinds = kinds;

    const points = [];
    if (feeds.station_information) {
      const stations = parseGbfsStations(await getJson(feeds.station_information, timeoutMs).catch(() => null));
      out.stations = stations.length;
      points.push(...stations);
      if (feeds.station_status && stations.length) {
        const status = parseGbfsStationStatus(await getJson(feeds.station_status, timeoutMs).catch(() => null));
        for (const station of stations) {
          const row = status.get(station.id);
          out.docked += row?.available || 0;
          if (row && isSentinelStation(row)) out.sentinel = true;
        }
      }
    }
    const freeUrl = freeVehicleFeedUrl(feeds);
    if (freeUrl) {
      const vehicles = parseGbfsVehicles(await getJson(freeUrl, timeoutMs).catch(() => null), kinds);
      out.vehicles = vehicles.length;
      points.push(...vehicles);
    }

    if (!points.length) throw new Error('no positioned objects');
    // Fenced: a single junk fix — a Villefranche-sur-Saône scooter reported
    // over Nantes — would otherwise stretch this system's footprint across
    // half of France and pull it into every viewport in between.
    out.bbox = boundsOfPoints(points, { rejectOutliers: true });
    out.kind = out.stations && out.vehicles ? 'hybrid' : (out.stations ? 'docked' : 'free-floating');
    // Two signatures, because they answer different questions: stations are
    // stable and comparable across snapshots, fleets are all a purely
    // free-floating system has. The redundancy rules pick between them.
    out.places = coordSignature(points.slice(0, out.stations));
    out.fleet = coordSignature(points.slice(out.stations));
  } catch (error) {
    out.error = error?.name === 'AbortError' ? 'timeout' : (error?.message || String(error));
  }
  return out;
}

/** Signature for a system another layer already draws. */
async function probeCovered(entry, timeoutMs) {
  try {
    const stations = parseGbfsStations(await getJson(entry.stationInformationUrl, timeoutMs));
    if (!stations.length) return null;
    return {
      id: `bikeshare:${entry.id}`,
      statusUrl: entry.stationStatusUrl,
      domain: registrableDomain(hostOf(entry.stationStatusUrl)),
      // Every system in that registry is a dock network by construction.
      docked: true,
      normalizedName: normalizedSystemName(entry.provider),
      stationCount: stations.length,
      places: coordSignature(stations),
      fleet: new Set(),
    };
  } catch {
    return null;
  }
}

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

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log(`[GBFS] catalog ← ${args.catalog || PAN_DATASETS_URL}`);
  const datasets = args.catalog
    ? JSON.parse(await fsp.readFile(args.catalog, 'utf8'))
    : await getJson(PAN_DATASETS_URL, Math.max(args.timeout, 60000));
  const systems = gbfsSystemsFromCatalog(datasets);
  console.log(`[GBFS] ${systems.length} GBFS resources in the catalog`);

  console.log('[GBFS] fingerprinting the systems another layer already draws…');
  const coveredEntries = bikeshareCoveredSystems();
  const covered = (await mapWithConcurrency(coveredEntries, args.concurrency,
    (entry) => probeCovered(entry, args.timeout))).filter(Boolean);
  console.log(`[GBFS]   ${covered.length}/${coveredEntries.length} already-covered systems fingerprinted`);

  console.log(`[GBFS] probing at concurrency ${args.concurrency}…`);
  let done = 0;
  const probes = await mapWithConcurrency(systems, args.concurrency, async (system) => {
    const probe = await probeSystem(system, args.timeout);
    done += 1;
    const mark = probe.error
      ? `FAIL ${probe.error}`.padEnd(26)
      : `${String(probe.stations).padStart(5)} st ${String(probe.vehicles).padStart(6)} veh`;
    console.log(`[GBFS] ${String(done).padStart(3)}/${systems.length} ${mark} ${system.name}`);
    return probe;
  });

  const probed = systems
    .map((system, i) => ({ system, probe: probes[i] }))
    .filter(({ probe }) => !probe.error && (probe.places.size || probe.fleet.size));

  const verdicts = findRedundantSystems(
    probed.map(({ system, probe }) => {
      const statusUrl = probe.feeds?.station_status || freeVehicleFeedUrl(probe.feeds) || null;
      return {
        id: system.id,
        statusUrl,
        domain: registrableDomain(hostOf(statusUrl)),
        docked: probe.kind === 'docked',
        normalizedName: normalizedSystemName(system.name),
        stationCount: probe.stations,
        places: probe.places,
        fleet: probe.fleet,
      };
    }),
    { alreadyCovered: covered },
  );

  // How often each station position is reported by more than one SURVIVING
  // system — the empirical test for "this is public parking, not the
  // operator's docks". Counted after the redundancy pass on purpose: the
  // catalog lists Vélam Amiens five times under one URL, and counting those
  // copies as five publishers made its own 45 docks look like shared bays.
  const frequency = stationFrequency(
    probed
      .filter(({ system }) => !verdicts.has(system.id))
      .map(({ probe }) => ({ places: probe.places })),
  );

  const now = new Date().toISOString();
  const indexed = systems.map((system, i) => {
    const probe = probes[i];
    const verdict = verdicts.get(system.id) || null;
    const shared = Number(sharedStationFraction(probe.places, frequency).toFixed(3));
    const entry = {
      ...system,
      bbox: probe.bbox,
      kind: probe.kind,
      stationCount: probe.stations,
      sharedStationFraction: shared,
      sentinelStations: probe.sentinel === true,
      dockedAvailable: probe.docked,
      freeVehicles: probe.vehicles,
      objectSample: probe.stations + probe.vehicles,
      feeds: probe.feeds
        ? {
          station_information: probe.feeds.station_information || null,
          station_status: probe.feeds.station_status || null,
          vehicle_status: freeVehicleFeedUrl(probe.feeds),
          vehicle_types: probe.feeds.vehicle_types || null,
        }
        : null,
      redundant: verdict,
      observedAt: probe.error ? null : now,
      probeError: probe.error,
    };
    entry.drawStations = systemDrawsStations(entry);
    return entry;
  });

  const live = indexed.filter((s) => !s.probeError && !s.redundant);
  const payload = {
    source: PAN_DATASETS_URL,
    generatedAt: now,
    generator: 'scripts/build-gbfs-fr-index.mjs',
    note: 'bbox values are OBSERVED object bounds at probe time; `redundant` records a measured duplicate, not a naming guess',
    catalogResourceCount: systems.length,
    distinctSystemCount: live.length,
    redundantCount: indexed.filter((s) => s.redundant).length,
    unreachableCount: indexed.filter((s) => s.probeError).length,
    systems: indexed,
  };

  await fsp.mkdir(path.dirname(args.out), { recursive: true });
  await fsp.writeFile(args.out, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  const stations = live.filter((x) => x.drawStations).reduce((s, x) => s + x.stationCount, 0);
  const vehicles = live.reduce((s, x) => s + x.freeVehicles, 0);
  const suppressed = live.filter((x) => x.stationCount && !x.drawStations);
  console.log(`\n[GBFS] wrote ${path.relative(ROOT, args.out)}`);
  console.log(`[GBFS]   ${systems.length} catalog resources → ${live.length} distinct systems to draw`);
  console.log(`[GBFS]   ${payload.redundantCount} redundant, ${payload.unreachableCount} unreachable`);
  console.log(`[GBFS]   ${stations.toLocaleString('fr-FR')} own-infrastructure stations + ${vehicles.toLocaleString('fr-FR')} free-floating vehicles`);
  if (suppressed.length) {
    const bays = suppressed.reduce((s, x) => s + x.stationCount, 0);
    console.log(`[GBFS]   ${bays.toLocaleString('fr-FR')} station rows across ${suppressed.length} systems are shared public parking or sentinels — not drawn per operator`);
  }
}

main().catch((error) => {
  console.error('[GBFS] build failed:', error?.message || error);
  process.exitCode = 1;
});
