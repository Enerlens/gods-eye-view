#!/usr/bin/env node
/**
 * Measure one network's SERVICE DAY out of its static GTFS.
 *
 * Every storage figure in `docs/CHRONIQUE-GTFS-RT.md` is a rate multiplied by
 * a day, and the day is not flat: a national fleet count taken at 17 h says
 * nothing about what the same feeds cost at 03 h. A live probe can only ever
 * measure the hour it runs in, so the shape of the day comes from the place
 * that already knows it — the published schedule.
 *
 * For a given service date this reads `calendar.txt`, `calendar_dates.txt`,
 * `trips.txt` and `stop_times.txt` out of the archive and prints:
 *
 *   - the hourly curve of trips in service (the fleet the RT feeds report),
 *   - vehicle-hours per day divided by the count at 17 h — the factor that
 *     turns a peak-hour probe into a day,
 *   - stop passages per day divided by that same count — the factor that
 *     sizes a punctuality archive.
 *
 * Both ratios are expressed against 17 h because that is when the national
 * index last probed every feed (`config/pan_gtfs_rt_feeds.json`), so the
 * multiplication has one measured end and one published end.
 *
 * Usage:
 *   node scripts/measure-gtfs-service-day.mjs                    # the four sampled networks
 *   node scripts/measure-gtfs-service-day.mjs --date 20260907
 *   node scripts/measure-gtfs-service-day.mjs --feed pan-83026
 *   node scripts/measure-gtfs-service-day.mjs --archive /tmp/tbm.zip
 */
import fs from 'node:fs';
import path from 'node:path';
import { fetchZipMemberRanged, readZipMember } from './lib/remoteZip.mjs';

const USER_AGENT =
  'gods-eye-view/0.1 (+https://github.com/bilawalsidhu/gods-eye-view; GTFS service-day sizing)';
/** The four networks measured for the write-up: a metropolis, two mid-size, one village line. */
const DEFAULT_FEEDS = ['pan-83026', 'pan-82163', 'pan-81786', 'pan-83192'];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function parseArgs(argv) {
  const args = { date: '', feeds: [], archives: [], hour: 17 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--date') args.date = argv[++i] || '';
    else if (argv[i] === '--feed') args.feeds.push(argv[++i]);
    else if (argv[i] === '--archive') args.archives.push(argv[++i]);
    else if (argv[i] === '--hour') args.hour = Number(argv[++i]) || 17;
  }
  if (!args.feeds.length && !args.archives.length) args.feeds = DEFAULT_FEEDS;
  if (!args.date) {
    const now = new Date();
    args.date = `${now.getFullYear()}`
      + `${String(now.getMonth() + 1).padStart(2, '0')}`
      + `${String(now.getDate()).padStart(2, '0')}`;
  }
  return args;
}

/** Rows of a GTFS member, as objects, scanned line by line. */
export function* csvRows(buffer) {
  const text = buffer.toString('utf8');
  let start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let header = null;
  while (start < text.length) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = text.length;
    const line = text.slice(start, end).replace(/\r$/, '');
    start = end + 1;
    if (!line) continue;
    // GTFS quotes fields containing commas; the columns read here never do,
    // but a quoted comma elsewhere in the row must not shift them.
    const cells = line.includes('"') ? splitQuoted(line) : line.split(',');
    if (!header) { header = cells; continue; }
    const row = {};
    for (let i = 0; i < header.length; i += 1) row[header[i]] = cells[i];
    yield row;
  }
}

function splitQuoted(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cell += '"'; i += 1; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) { cells.push(cell); cell = ''; }
    else cell += ch;
  }
  cells.push(cell);
  return cells;
}

/** `HH:MM:SS` past midnight, where HH may exceed 24 for a service that runs late. */
export function seconds(value) {
  const parts = String(value || '').split(':');
  if (parts.length < 3) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  const s = Number(parts[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(s)) return null;
  return h * 3600 + m * 60 + s;
}

/** Where a whole archive lands when the host refuses range requests. */
const ARCHIVE_CACHE = path.join(process.cwd(), '.gev-cache', 'gtfs-static');

/** Resolve one PAN feed id to the download URL(s) of its static GTFS. */
async function staticUrlForFeed(feedId) {
  const indexPath = path.join(process.cwd(), 'config', 'pan_gtfs_static.json');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const entry = index.feeds?.[feedId];
  if (!entry) throw new Error(`${feedId} is not in config/pan_gtfs_static.json`);
  const resourceId = entry.statics?.[0]?.resourceId;
  const response = await fetch(`https://transport.data.gouv.fr/api/datasets/${entry.datasetId}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`PAN dataset ${entry.datasetId}: HTTP ${response.status}`);
  const dataset = await response.json();
  const resources = (dataset.resources || []).filter((item) => item.format === 'GTFS' && item.url);
  if (!resources.length) throw new Error(`${feedId}: no GTFS resource with a URL`);
  // The indexed resource id first, then the others: a network that swapped its
  // archive last week — Rémi did, between two index builds — still resolves.
  const ordered = [
    ...resources.filter((item) => item.id === resourceId),
    ...resources.filter((item) => item.id !== resourceId),
  ];
  return { urls: ordered.map((item) => item.url), network: entry.network };
}

/**
 * The whole archive, downloaded once and kept.
 *
 * `fetchZipMemberRanged` is tried first and refuses loudly when the host
 * ignores `Range` — which data.gouv.fr's storage does on most redirects
 * (measured 2026-09-07: 3 of 4 sampled networks answered 200 to a ranged
 * request). Falling back is the documented contract of that module.
 */
async function wholeArchive(urls, label) {
  fs.mkdirSync(ARCHIVE_CACHE, { recursive: true });
  const cached = path.join(ARCHIVE_CACHE, `${label.replace(/[^\w.-]+/g, '_')}.zip`);
  if (fs.existsSync(cached) && fs.statSync(cached).size > 1024) return fs.readFileSync(cached);
  let lastError = null;
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        redirect: 'follow',
        signal: AbortSignal.timeout(300000),
      });
      if (!response.ok) { lastError = new Error(`HTTP ${response.status}`); continue; }
      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(cached, buffer);
      return buffer;
    } catch (error) { lastError = error; }
  }
  throw lastError || new Error('no archive URL answered');
}

/** Read one member, from a local archive or over three range requests. */
async function member(source, name) {
  if (source.archive) return readZipMember(source.archive, name);
  if (!source.ranged) {
    try {
      const { buffer } = await fetchZipMemberRanged(source.urls[0], name, { userAgent: USER_AGENT });
      source.ranged = true;
      return buffer;
    } catch {
      source.archive = await wholeArchive(source.urls, source.label);
      return readZipMember(source.archive, name);
    }
  }
  const { buffer } = await fetchZipMemberRanged(source.urls[0], name, { userAgent: USER_AGENT });
  return buffer;
}

/**
 * The service day, computed from four GTFS members already in memory.
 *
 * Pure on purpose: every storage figure in `docs/CHRONIQUE-GTFS-RT.md` is a
 * rate multiplied by what this returns, so it is the half worth testing
 * offline. `calendarDates` may be null — several networks have no exceptions —
 * but skipping it when it exists silently zeroes a network: 165 of Irigo's
 * services are declared there and nowhere else.
 *
 * @param {{calendar: ?Buffer, calendarDates: ?Buffer, trips: Buffer, stopTimes: Buffer}} members
 * @param {{date: string, refHour: number}} options `date` as `YYYYMMDD`.
 */
export function computeServiceDay(members, { date, refHour = 17 }) {
  const weekday = WEEKDAYS[new Date(
    Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8)),
  ).getDay()];

  const active = new Set();
  if (members.calendar) {
    for (const row of csvRows(members.calendar)) {
      if (row[weekday] === '1' && row.start_date <= date && date <= row.end_date) {
        active.add(row.service_id);
      }
    }
  }
  if (members.calendarDates) {
    for (const row of csvRows(members.calendarDates)) {
      if (row.date !== date) continue;
      if (row.exception_type === '1') active.add(row.service_id);
      else if (row.exception_type === '2') active.delete(row.service_id);
    }
  }

  const running = new Set();
  for (const row of csvRows(members.trips)) {
    if (active.has(row.service_id)) running.add(row.trip_id);
  }

  const span = new Map();
  let passages = 0;
  for (const row of csvRows(members.stopTimes)) {
    if (!running.has(row.trip_id)) continue;
    const at = seconds(row.departure_time) ?? seconds(row.arrival_time);
    if (at == null) continue;
    passages += 1;
    const known = span.get(row.trip_id);
    if (!known) span.set(row.trip_id, [at, at]);
    else { if (at < known[0]) known[0] = at; if (at > known[1]) known[1] = at; }
  }

  // A trip is "in service" for an hour when its span covers that hour's
  // midpoint — the same thing a vehicle feed would report as a live vehicle.
  // Thirty slots, not 24: a GTFS time may read 25:40:00 and that trip is still
  // a vehicle on the road at 01 h 40.
  const perHour = new Array(30).fill(0);
  for (const [from, to] of span.values()) {
    for (let hour = 0; hour < perHour.length; hour += 1) {
      const midpoint = hour * 3600 + 1800;
      if (from <= midpoint && midpoint <= to) perHour[hour] += 1;
    }
  }
  const vehicleHours = perHour.reduce((total, count) => total + count, 0);
  const atRef = perHour[refHour] || 0;
  const peak = perHour.reduce(
    (best, count, hour) => (count > best.count ? { hour, count } : best), { hour: 0, count: 0 });

  return {
    date, weekday, services: active.size, trips: span.size, passages,
    perHour, vehicleHours, atRef, peak,
    vehicleHoursPerRefVehicle: atRef ? vehicleHours / atRef : null,
    passagesPerRefVehicle: atRef ? passages / atRef : null,
  };
}

/** Read the four members this needs, then hand them to {@link computeServiceDay}. */
async function serviceDay(source, date, refHour) {
  const members = {
    calendar: await member(source, 'calendar.txt'),
    calendarDates: await member(source, 'calendar_dates.txt'),
    trips: await member(source, 'trips.txt'),
    stopTimes: await member(source, 'stop_times.txt'),
  };
  return computeServiceDay(members, { date, refHour });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`# service day ${args.date}, ratios against ${args.hour} h`);
  const results = [];
  const sources = [
    ...args.archives.map((file) => ({
      label: path.basename(file), archive: fs.readFileSync(file),
    })),
    ...(await Promise.all(args.feeds.map(async (feedId) => {
      const resolved = await staticUrlForFeed(feedId);
      return { label: `${resolved.network} (${feedId})`, urls: resolved.urls, feedId };
    }))),
  ];

  for (const source of sources) {
    try {
      const day = await serviceDay(source, args.date, args.hour);
      results.push({ label: source.label, ...day });
      console.log(`\n## ${source.label} — ${day.weekday}`);
      console.log(`services ${day.services} · trips ${day.trips}`
        + ` · stop passages ${day.passages.toLocaleString('fr-FR')}`);
      console.log(`in service: peak ${day.peak.count} at ${day.peak.hour} h`
        + ` · ${args.hour} h ${day.atRef} · vehicle-hours ${day.vehicleHours}`);
      console.log(`ratios: ${day.vehicleHoursPerRefVehicle?.toFixed(2)} vehicle-hours`
        + ` and ${day.passagesPerRefVehicle?.toFixed(1)} stop passages`
        + ` per vehicle running at ${args.hour} h`);
      console.log(`curve ${day.perHour.slice(4, 27).map((count, i) => `${i + 4}:${count}`).join(' ')}`);
    } catch (error) {
      console.log(`\n## ${source.label} — FAILED: ${String(error?.message || error)}`);
    }
  }

  if (results.length > 1) {
    // Weighted by each network's own 17 h fleet: a village line and a
    // metropolis must not carry the same weight in a national factor.
    const weight = results.reduce((total, day) => total + day.atRef, 0);
    const weighted = (pick) =>
      results.reduce((total, day) => total + pick(day) * day.atRef, 0) / weight;
    console.log(`\n## weighted by ${args.hour} h fleet (${weight} vehicles)`);
    console.log(`vehicle-hours per ${args.hour} h vehicle: `
      + `${weighted((day) => day.vehicleHoursPerRefVehicle).toFixed(2)}`);
    console.log(`stop passages per ${args.hour} h vehicle: `
      + `${weighted((day) => day.passagesPerRefVehicle).toFixed(1)}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
