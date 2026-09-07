#!/usr/bin/env node
/**
 * Measure what recording ALL French GTFS-RT feeds nationally would cost.
 *
 * `docs/CHRONIQUE.md` records the chronicle as viewport-driven — it keeps only
 * what an operator's camera happened to make the proxy download — and states
 * the open question in one line: *"le stockage d'un an de GTFS-RT national
 * demande un chiffrage avant de l'allumer"*. This script is that measurement.
 *
 * It answers four questions with bytes on the wire, not with arithmetic on
 * guesses:
 *
 *   1. How big is one national sweep — every position body, every companion
 *      trip-update body — in wire bytes and in gzip bytes?
 *   2. How often does a feed actually republish? Polling faster than the
 *      publisher moves is pure spend, and the header timestamp says so.
 *   3. What does one stored sample weigh in each of four retention shapes:
 *      whole bodies, one line per vehicle, one line per vehicle that MOVED,
 *      and one line per stop passage (the punctuality archive)?
 *   4. What does the fleet look like right now, so the day-shape scaling in
 *      the write-up starts from a measured point and not from a feeling?
 *
 * Usage:
 *   node scripts/measure-pan-gtfs-rt-cost.mjs                 # inventory only
 *   node scripts/measure-pan-gtfs-rt-cost.mjs --rounds 10 --interval 30
 *   node scripts/measure-pan-gtfs-rt-cost.mjs --companions --out report.json
 *
 * Flags:
 *   --rounds N       cadence rounds over the position feeds (default 0)
 *   --interval S     seconds between rounds (default 30)
 *   --companions     also sweep the 86 distinct trip-update resources
 *   --limit N        only the N largest feeds (debugging)
 *   --concurrency N  parallel requests (default 8)
 *   --out PATH       write the JSON report here
 *   --budget PATH    no network: re-derive the projections from a saved report
 *   --peak-fleet N   vehicles the national index saw at 17 h (default 7212)
 *   --day-factor N   vehicle-hours per 17 h vehicle (default 10.62, measured by
 *                    `scripts/measure-gtfs-service-day.mjs`)
 *   --passage-factor N  stop passages per 17 h vehicle (default 428.3, same source)
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import {
  decodeFeedMessage,
  decodeTripUpdateFeed,
  decodeAlertFeed,
} from '../src/data/gtfsRealtime.js';

const gzip = promisify(zlib.gzip);

const USER_AGENT =
  'gods-eye-view/0.1 (+https://github.com/bilawalsidhu/gods-eye-view; GTFS-RT storage sizing)';
const TIMEOUT_MS = 15_000;
const MAX_BYTES = 48 * 1024 * 1024;

function parseArgs(argv) {
  const args = {
    rounds: 0, interval: 30, companions: false,
    limit: 0, concurrency: 8, out: '', budget: '',
    peakFleet: 7212, dayFactor: 10.62, passageFactor: 428.3,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--companions') args.companions = true;
    else if (flag === '--rounds') args.rounds = Number(argv[++i]) || 0;
    else if (flag === '--interval') args.interval = Number(argv[++i]) || 30;
    else if (flag === '--limit') args.limit = Number(argv[++i]) || 0;
    else if (flag === '--concurrency') args.concurrency = Number(argv[++i]) || 8;
    else if (flag === '--out') args.out = argv[++i] || '';
    else if (flag === '--budget') args.budget = argv[++i] || '';
    else if (flag === '--peak-fleet') args.peakFleet = Number(argv[++i]) || 7212;
    else if (flag === '--day-factor') args.dayFactor = Number(argv[++i]) || 10.62;
    else if (flag === '--passage-factor') args.passageFactor = Number(argv[++i]) || 428.3;
  }
  return args;
}

/** Fetch one body, measuring wire bytes, gzip bytes and latency. */
async function probe(url) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Encoding': 'gzip, deflate' },
      signal: controller.signal,
      redirect: 'follow',
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_BYTES) throw new Error(`body over cap: ${buffer.length}`);
    const gzipped = await gzip(buffer, { level: 6 });
    return {
      ok: response.ok,
      status: response.status,
      ms: Date.now() - started,
      bytes: buffer.length,
      gzBytes: gzipped.length,
      // What the origin actually put on the wire, when it says so. `null`
      // means chunked or undeclared, not zero.
      wireBytes: Number(response.headers.get('content-length')) || null,
      contentEncoding: response.headers.get('content-encoding') || 'identity',
      sha: crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 16),
      buffer,
    };
  } catch (error) {
    return {
      ok: false, status: 0, ms: Date.now() - started, error: String(error?.message || error),
      bytes: 0, gzBytes: 0, wireBytes: null, contentEncoding: '', sha: '', buffer: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Run `worker` over `items` with a fixed number of parallel slots. */
async function pool(items, concurrency, worker) {
  const out = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      out[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return out;
}

/**
 * Every entity shape in one body, counted in a single decode pass each.
 *
 * The three decoders flatten as they read — a vehicle carries `lat`/`lon` and
 * a trip carries `stopTimeUpdates` directly, with no `position` or
 * `stop_time_update` wrapper — so this reads the shape `gtfsRealtime.js`
 * actually returns, not the shape the .proto declares.
 */
function readBody(buffer) {
  const positions = decodeFeedMessage(buffer);
  const trips = decodeTripUpdateFeed(buffer);
  const alerts = decodeAlertFeed(buffer);
  const vehicles = [];
  // A position that names the stop it is at, and when, is a stop passage
  // already — no trip-update body needed to know the bus went through.
  let withStop = 0;
  let withOwnTimestamp = 0;
  for (const entity of positions.entities) {
    const vehicle = entity?.vehicle;
    if (vehicle && Number.isFinite(vehicle.lat) && Number.isFinite(vehicle.lon)) {
      vehicles.push(entity);
      if (vehicle.stopId || Number.isFinite(vehicle.stopSequence)) withStop += 1;
      if (Number.isFinite(vehicle.timestamp)) withOwnTimestamp += 1;
    }
  }
  const stopPassages = [];
  let withDelay = 0;
  const tripIds = new Set();
  for (const entity of trips.entities) {
    const update = entity?.tripUpdate;
    if (!update) continue;
    tripIds.add(update.tripId || entity.id || '');
    for (const stop of update.stopTimeUpdates || []) {
      const delay = stop?.arrival?.delay ?? stop?.departure?.delay ?? update.delay;
      if (Number.isFinite(delay)) withDelay += 1;
      stopPassages.push({ update, stop, delay });
    }
  }
  const alertCount = alerts.entities.filter((entity) => entity?.alert).length;
  return {
    headerTs: positions.header?.timestamp || null,
    entities: positions.entities.length,
    vehicles,
    vehicleCount: vehicles.length,
    vehiclesWithStop: withStop,
    vehiclesWithOwnTimestamp: withOwnTimestamp,
    tripCount: tripIds.size,
    stopPassages,
    stopTimeUpdates: stopPassages.length,
    stopTimeUpdatesWithDelay: withDelay,
    alertCount,
  };
}

/** One stored position sample, in the shape the chronicle's raw log would use. */
function positionRecord(feedId, entity, at) {
  const vehicle = entity.vehicle || {};
  return {
    t: at,
    f: feedId,
    v: vehicle.vehicleId || entity.id || '',
    tr: vehicle.tripId || '',
    r: vehicle.routeId || '',
    ts: vehicle.timestamp || null,
    y: Math.round((vehicle.lat ?? 0) * 1e5) / 1e5,
    x: Math.round((vehicle.lon ?? 0) * 1e5) / 1e5,
    b: vehicle.bearing == null ? null : Math.round(vehicle.bearing),
    s: vehicle.speed == null ? null : Math.round(vehicle.speed * 10) / 10,
  };
}

/**
 * One stored STOP PASSAGE — the punctuality archive's unit.
 *
 * Not a re-prediction: the shape a keeper would write once per trip and stop,
 * carrying the delay that was true when the vehicle went through.
 */
function passageRecord(feedId, { update, stop, delay }) {
  return {
    f: feedId,
    tr: update.tripId || '',
    r: update.routeId || '',
    st: stop.stopId || '',
    q: stop.stopSequence ?? null,
    d: Number.isFinite(delay) ? delay : null,
    t: stop?.arrival?.time || stop?.departure?.time || update.timestamp || null,
  };
}

/** Identity of a vehicle sample, for "did this vehicle move since last round". */
function vehicleKey(feedId, entity) {
  const vehicle = entity.vehicle || {};
  return `${feedId}|${vehicle.vehicleId || entity.id || ''}|${vehicle.tripId || ''}`;
}
function vehicleState(entity) {
  const vehicle = entity.vehicle || {};
  return `${vehicle.timestamp || ''}|${vehicle.lat}|${vehicle.lon}`;
}

/** Bytes of NDJSON, raw and gzipped, for a set of records. */
async function weigh(records) {
  if (!records.length) return { records: 0, ndjson: 0, gz: 0 };
  const text = `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
  const buffer = Buffer.from(text, 'utf8');
  const gzipped = await gzip(buffer, { level: 6 });
  return { records: records.length, ndjson: buffer.length, gz: gzipped.length };
}


const GB = 1024 ** 3;
const MB = 1024 ** 2;
/** A chronicle series with all 168 slots filled — `src/data/chronicle.js`. */
const SERIES_BYTES = 5341;
/** Lines across the 148 French networks with a static GTFS, from the shipped index. */
const FRENCH_ROUTE_COUNT = 6895;
/** gzip cost of one alert, fitted across the sweep. Text, so it dwarfs a position. */
const ALERT_GZ = 812;
/** Request + response headers, both ways. Estimated, not measured. */
const HTTP_OVERHEAD = 700;

/**
 * Turn one measured sweep into a year, at several cadences.
 *
 * The model has exactly two moving parts, because the measurement supports
 * exactly two: a body cost that does not depend on the hour (framing, and the
 * alerts, which a person writes and which do not thin out at night), and a
 * cost proportional to the vehicles in service. The day's shape enters as one
 * number — vehicle-hours per vehicle running at 17 h — measured from the
 * published schedules by `measure-gtfs-service-day.mjs` rather than assumed.
 *
 * Pure, so the figures quoted in `docs/CHRONIQUE-GTFS-RT.md` can be checked
 * offline against a report that never touched the network.
 */
export function budgetFromReport(report, {
  peakFleet = 7212, dayFactor = 10.62, passageFactor = 428.3,
  cadences = [30, 60, 120, 300],
} = {}) {
  const live = report.inventory.filter((entry) => entry.ok && entry.read);
  const fleet = live.reduce((total, entry) => total + entry.read.vehicleCount, 0);
  const sweepGz = live.reduce((total, entry) => total + entry.gzBytes, 0);
  const alerts = live.reduce((total, entry) => total + entry.read.alertCount, 0);
  const fixedGz = live.length * 35 + alerts * ALERT_GZ;
  const variableGz = Math.max(0, sweepGz - fixedGz);
  const perSampleGz = report.positionWeight.records
    ? report.positionWeight.gz / report.positionWeight.records : 0;
  const perPassageGz = report.companionWeight?.records
    ? report.companionWeight.gz / report.companionWeight.records : null;

  const vehicleHours = dayFactor * peakFleet;
  const passagesPerDay = passageFactor * peakFleet;
  // Sum over the day of (fleet at that hour ÷ fleet when this sweep ran).
  const hourRatioSum = fleet ? vehicleHours / fleet : 0;

  // Only the interval this report actually polled at has a measured
  // deduplication rate; the others are left null rather than modelled.
  const measured = (report.rounds || []).filter((round) => round.round > 0 && round.vehicles);
  const movedFraction = measured.length
    ? measured.reduce((total, round) => total + round.moved / round.vehicles, 0) / measured.length
    : null;

  const rows = cadences.map((seconds) => {
    const sweeps = 86400 / seconds;
    const samples = vehicleHours * 3600 / seconds;
    const payload = sweeps * fixedGz + (3600 / seconds) * variableGz * hourRatioSum;
    const http = sweeps * live.length * HTTP_OVERHEAD;
    return {
      seconds,
      requestsPerDay: sweeps * live.length,
      ingressPerDay: payload + http,
      ingressPerYear: (payload + http) * 365,
      bodiesPerYear: payload * 365,
      positionsPerYear: samples * perSampleGz * 365,
      dedupedPerYear: movedFraction != null && seconds === report.args.interval
        ? samples * perSampleGz * movedFraction * 365 : null,
    };
  });

  const okCompanions = (report.companions || []).filter((entry) => entry.ok && entry.read);
  const companionGz = okCompanions.reduce((total, entry) => total + entry.gzBytes, 0);
  const companionFixed = okCompanions.length * 35;
  const companionVariable = Math.max(0, companionGz - companionFixed);
  const companionRows = okCompanions.length
    ? [30, 60, 300].map((seconds) => {
      const sweeps = 86400 / seconds;
      const ingress = sweeps * companionFixed
        + (3600 / seconds) * companionVariable * hourRatioSum
        + sweeps * okCompanions.length * HTTP_OVERHEAD;
      return {
        seconds,
        requestsPerDay: sweeps * okCompanions.length,
        ingressPerDay: ingress,
        ingressPerYear: ingress * 365,
      };
    })
    : [];

  return {
    feeds: live.length, fleet, sweepGz, fixedGz, variableGz,
    perSampleGz, perPassageGz, movedFraction,
    vehicleHours, passagesPerDay,
    rows, companions: { count: okCompanions.length, sweepGz: companionGz, rows: companionRows },
    passages: perPassageGz
      ? { perDay: passagesPerDay * perPassageGz, perYear: passagesPerDay * perPassageGz * 365 }
      : null,
    profiles: {
      feedSeriesBytes: live.length * 3 * SERIES_BYTES,
      routeSeriesBytes: FRENCH_ROUTE_COUNT * 2 * SERIES_BYTES,
    },
  };
}

/** The same numbers, as the tables `docs/CHRONIQUE-GTFS-RT.md` quotes. */
function printBudget(report, args) {
  const budget = budgetFromReport(report, args);
  console.log(`\n## budget — from ${report.measuredAt}, fleet ${budget.fleet} vehicles`);
  console.log(`sweep ${(budget.sweepGz / 1024).toFixed(0)} KB gz`
    + ` = ${(budget.fixedGz / 1024).toFixed(0)} KB that the hour does not move`
    + ` + ${(budget.variableGz / 1024).toFixed(0)} KB that follows the fleet`);
  console.log(`day: ${args.peakFleet} vehicles at 17 h × ${args.dayFactor}`
    + ` = ${Math.round(budget.vehicleHours).toLocaleString('fr-FR')} vehicle-hours,`
    + ` ${Math.round(budget.passagesPerDay).toLocaleString('fr-FR')} stop passages`);
  if (budget.movedFraction != null) {
    console.log(`at ${report.args.interval}s, ${(budget.movedFraction * 100).toFixed(0)}%`
      + ' of vehicles report a position their last sample did not already carry');
  }
  console.table(budget.rows.map((row) => ({
    cadence: `${row.seconds} s`,
    'requêtes/j': Math.round(row.requestsPerDay).toLocaleString('fr-FR'),
    'entrant/j': `${(row.ingressPerDay / MB).toFixed(0)} Mo`,
    'entrant/an': `${(row.ingressPerYear / GB).toFixed(0)} Go`,
    'corps gardés/an': `${(row.bodiesPerYear / GB).toFixed(0)} Go`,
    'positions/an': `${(row.positionsPerYear / GB).toFixed(1)} Go`,
    'dédupliquées/an': row.dedupedPerYear == null ? '·' : `${(row.dedupedPerYear / GB).toFixed(1)} Go`,
  })));

  if (budget.companions.rows.length) {
    console.log(`\ncompagnons trip-update — ${budget.companions.count} ressources,`
      + ` ${(budget.companions.sweepGz / 1024).toFixed(0)} KB gz par balayage :`);
    console.table(budget.companions.rows.map((row) => ({
      cadence: `${row.seconds} s`,
      'requêtes/j': Math.round(row.requestsPerDay).toLocaleString('fr-FR'),
      'entrant/j': `${(row.ingressPerDay / MB).toFixed(0)} Mo`,
      'entrant/an': `${(row.ingressPerYear / GB).toFixed(0)} Go`,
    })));
  }

  if (budget.passages) {
    console.log(`stop passages, one line each: ${(budget.passages.perDay / MB).toFixed(0)} Mo/day`
      + ` · ${(budget.passages.perYear / GB).toFixed(1)} Go/an — and the cadence does not change it,`
      + ' a passage happens once whether it is polled once or twenty times');
  }
  console.log(`168-slot profiles: ${(budget.profiles.feedSeriesBytes / MB).toFixed(1)} Mo`
    + ` for ${budget.feeds * 3} feed series`
    + ` · ${(budget.profiles.routeSeriesBytes / MB).toFixed(0)} Mo for one per line`
    + ` (${FRENCH_ROUTE_COUNT} lines × 2) — both forever`);
  return budget;
}

const sum = (values) => values.reduce((total, value) => total + value, 0);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.budget) {
    const report = JSON.parse(fs.readFileSync(args.budget, 'utf8'));
    printBudget(report, args);
    return;
  }
  const indexPath = path.join(process.cwd(), 'config', 'pan_gtfs_rt_feeds.json');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

  // A duplicate resource is the same body under another id: fetching both
  // would double the bill and store the same vehicles twice.
  let feeds = index.feeds.filter((feed) => !feed.duplicateOf);
  if (args.limit) {
    feeds = feeds
      .slice()
      .sort((a, b) => (b.lastProbe?.vehicles || 0) - (a.lastProbe?.vehicles || 0))
      .slice(0, args.limit);
  }

  const startedAt = new Date();
  console.log(`# national GTFS-RT sizing — ${startedAt.toISOString()}`);
  console.log(`# index ${index.generatedAt}, ${feeds.length} distinct position resources`);

  // --- Phase A: one national sweep, everything decoded ---------------------
  const inventory = await pool(feeds, args.concurrency, async (feed) => {
    const result = await probe(feed.url);
    let read = null;
    let decodeMs = null;
    if (result.ok && result.buffer) {
      const startedDecode = process.hrtime.bigint();
      try { read = readBody(result.buffer); } catch (error) {
        result.error = `decode: ${String(error?.message || error)}`;
      }
      decodeMs = Number(process.hrtime.bigint() - startedDecode) / 1e6;
    }
    const records = read
      ? read.vehicles.map((entity) => positionRecord(feed.id, entity, startedAt.getTime()))
      : [];
    return {
      id: feed.id,
      network: feed.network,
      publisher: feed.publisher,
      licence: feed.licenceLabel,
      sameResource: Boolean(feed.tripUpdates?.sameResource),
      url: feed.url,
      ...result,
      buffer: undefined,
      decodeMs,
      read: read ? { ...read, vehicles: undefined, stopPassages: undefined } : null,
      records,
    };
  });

  const live = inventory.filter((entry) => entry.ok && entry.read);
  const allRecords = live.flatMap((entry) => entry.records);
  const positionWeight = await weigh(allRecords);

  console.log('\n## sweep of the position feeds');
  console.log(`ok ${live.length}/${inventory.length}`
    + ` · failed ${inventory.filter((entry) => !entry.ok).length}`);
  console.log(`bytes  raw ${(sum(live.map((entry) => entry.bytes)) / 1024).toFixed(0)} KB`
    + ` · gzip ${(sum(live.map((entry) => entry.gzBytes)) / 1024).toFixed(0)} KB`);
  console.log(`vehicles ${sum(live.map((entry) => entry.read.vehicleCount))}`
    + ` · trips ${sum(live.map((entry) => entry.read.tripCount))}`
    + ` · stop-time updates ${sum(live.map((entry) => entry.read.stopTimeUpdates))}`
    + ` · alerts ${sum(live.map((entry) => entry.read.alertCount))}`);
  const withStop = sum(live.map((entry) => entry.read.vehiclesWithStop));
  const feedsWithStop = live.filter((entry) =>
    entry.read.vehicleCount > 0 && entry.read.vehiclesWithStop === entry.read.vehicleCount).length;
  const feedsWithVehicles = live.filter((entry) => entry.read.vehicleCount > 0).length;
  console.log(`positions naming a stop: ${withStop}`
    + `/${sum(live.map((entry) => entry.read.vehicleCount))} vehicles`
    + ` · ${feedsWithStop}/${feedsWithVehicles} feeds do it for every vehicle`
    + ` · ${sum(live.map((entry) => entry.read.vehiclesWithOwnTimestamp))} carry their own timestamp`);
  console.log(`decode: ${sum(live.map((entry) => entry.decodeMs || 0)).toFixed(0)} ms of CPU`
    + ` for the whole sweep (3 passes per body)`);
  console.log(`one stored position: ${positionWeight.records} records`
    + ` → ${positionWeight.ndjson} B ndjson, ${positionWeight.gz} B gzip`
    + (positionWeight.records
      ? ` (${(positionWeight.ndjson / positionWeight.records).toFixed(1)} B/rec raw,`
        + ` ${(positionWeight.gz / positionWeight.records).toFixed(1)} B/rec gz)`
      : ''));

  // --- Phase A2: the companion trip-update bodies --------------------------
  let companions = [];
  let companionWeight = null;
  if (args.companions) {
    const seen = new Map();
    for (const feed of feeds) {
      const companion = feed.tripUpdates;
      if (!companion?.url || companion.sameResource) continue;
      if (!seen.has(companion.url)) seen.set(companion.url, feed);
    }
    const targets = [...seen.entries()];
    companions = await pool(targets, args.concurrency, async ([url, feed]) => {
      const result = await probe(url);
      let read = null;
      if (result.ok && result.buffer) {
        try { read = readBody(result.buffer); } catch (error) {
          result.error = `decode: ${String(error?.message || error)}`;
        }
      }
      const passages = read
        ? read.stopPassages.map((passage) => passageRecord(feed.id, passage))
        : [];
      return {
        forFeed: feed.id, network: feed.network, url,
        ...result, buffer: undefined, passages,
        read: read ? { ...read, vehicles: undefined, stopPassages: undefined } : null,
      };
    });
    const okCompanions = companions.filter((entry) => entry.ok && entry.read);
    const passageWeight = await weigh(okCompanions.flatMap((entry) => entry.passages));
    console.log('\n## sweep of the companion trip-update resources');
    console.log(`ok ${okCompanions.length}/${companions.length}`);
    console.log(`bytes  raw ${(sum(okCompanions.map((entry) => entry.bytes)) / 1024).toFixed(0)} KB`
      + ` · gzip ${(sum(okCompanions.map((entry) => entry.gzBytes)) / 1024).toFixed(0)} KB`);
    console.log(`trips ${sum(okCompanions.map((entry) => entry.read.tripCount))}`
      + ` · stop-time updates ${sum(okCompanions.map((entry) => entry.read.stopTimeUpdates))}`
      + ` · with a delay ${sum(okCompanions.map((entry) => entry.read.stopTimeUpdatesWithDelay))}`);
    console.log(`one stored stop passage: ${passageWeight.records} records`
      + ` → ${passageWeight.ndjson} B ndjson, ${passageWeight.gz} B gzip`
      + (passageWeight.records
        ? ` (${(passageWeight.ndjson / passageWeight.records).toFixed(1)} B/rec raw,`
          + ` ${(passageWeight.gz / passageWeight.records).toFixed(1)} B/rec gz)`
        : ''));
    companionWeight = passageWeight;
  }

  // --- Phase B: cadence ----------------------------------------------------
  const rounds = [];
  if (args.rounds > 0) {
    console.log(`\n## cadence — ${args.rounds} rounds, ${args.interval}s apart`);
    const lastSha = new Map();
    const lastHeaderTs = new Map();
    const lastState = new Map();
    const republishGaps = new Map();
    for (let round = 0; round < args.rounds; round += 1) {
      if (round > 0) await new Promise((resolve) => setTimeout(resolve, args.interval * 1000));
      const at = Date.now();
      const results = await pool(feeds, args.concurrency, async (feed) => {
        const result = await probe(feed.url);
        if (!result.ok || !result.buffer) return { id: feed.id, ok: false, bytes: 0, gzBytes: 0 };
        let read = null;
        try { read = readBody(result.buffer); } catch { return { id: feed.id, ok: false, bytes: 0, gzBytes: 0 }; }
        const changed = lastSha.get(feed.id) !== result.sha;
        const headerMoved = read.headerTs && lastHeaderTs.get(feed.id) !== read.headerTs;
        if (headerMoved && lastHeaderTs.has(feed.id)) {
          const gap = read.headerTs - lastHeaderTs.get(feed.id);
          if (gap > 0 && gap < 3600) {
            const gaps = republishGaps.get(feed.id) || [];
            gaps.push(gap);
            republishGaps.set(feed.id, gaps);
          }
        }
        // Vehicles whose position or own timestamp moved since last round.
        const moved = [];
        const state = new Map();
        for (const entity of read.vehicles) {
          const key = vehicleKey(feed.id, entity);
          const now = vehicleState(entity);
          state.set(key, now);
          if (lastState.get(key) !== now) moved.push(entity);
        }
        for (const [key, value] of state) lastState.set(key, value);
        lastSha.set(feed.id, result.sha);
        if (read.headerTs) lastHeaderTs.set(feed.id, read.headerTs);
        return {
          id: feed.id, ok: true, bytes: result.bytes, gzBytes: result.gzBytes,
          changed, vehicles: read.vehicleCount, moved: moved.length,
          movedRecords: moved.map((entity) => positionRecord(feed.id, entity, at)),
        };
      });
      const okRound = results.filter((entry) => entry.ok);
      const movedWeight = await weigh(okRound.flatMap((entry) => entry.movedRecords || []));
      const summary = {
        round, at: new Date(at).toISOString(),
        feedsOk: okRound.length,
        bytes: sum(okRound.map((entry) => entry.bytes)),
        gzBytes: sum(okRound.map((entry) => entry.gzBytes)),
        changed: okRound.filter((entry) => entry.changed).length,
        changedBytes: sum(okRound.filter((entry) => entry.changed).map((entry) => entry.gzBytes)),
        vehicles: sum(okRound.map((entry) => entry.vehicles)),
        moved: sum(okRound.map((entry) => entry.moved)),
        movedNdjson: movedWeight.ndjson,
        movedGz: movedWeight.gz,
      };
      rounds.push(summary);
      console.log(`round ${round}: ${summary.feedsOk} ok`
        + ` · ${(summary.gzBytes / 1024).toFixed(0)} KB gz fetched`
        + ` · ${summary.changed} bodies changed (${(summary.changedBytes / 1024).toFixed(0)} KB)`
        + ` · ${summary.vehicles} vehicles, ${summary.moved} moved`
        + ` → ${(summary.movedGz / 1024).toFixed(1)} KB gz stored`);
    }
    const gapStats = [...republishGaps.entries()].map(([id, gaps]) => ({
      id,
      median: gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)],
      samples: gaps.length,
    }));
    if (gapStats.length) {
      const medians = gapStats.map((entry) => entry.median).sort((a, b) => a - b);
      console.log(`\nrepublication gap (header timestamp), ${gapStats.length} feeds:`
        + ` p25 ${medians[Math.floor(medians.length * 0.25)]}s`
        + ` · median ${medians[Math.floor(medians.length / 2)]}s`
        + ` · p75 ${medians[Math.floor(medians.length * 0.75)]}s`
        + ` · max ${medians[medians.length - 1]}s`);
    }
    rounds.gapStats = gapStats;
  }

  const report = {
    measuredAt: startedAt.toISOString(),
    indexGeneratedAt: index.generatedAt,
    args,
    inventory: inventory.map((entry) => ({ ...entry, records: entry.records?.length || 0 })),
    positionWeight,
    companionWeight,
    companions: companions.map((entry) => ({
      ...entry, buffer: undefined, passages: entry.passages?.length || 0,
    })),
    rounds,
  };
  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\nreport → ${args.out}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
