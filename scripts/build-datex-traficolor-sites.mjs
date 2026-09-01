#!/usr/bin/env node
/**
 * Build `config/datex_traficolor_sites.json` — the geometry the live French
 * road-status layer is drawn on.
 *
 * THE PROBLEM. Bison Futé publishes the STATE of the national road network
 * (`TRAFICOLOR-DIR`, a colour per site, every 60–360 s) and the COUNT on it
 * (`QTV-DIR`, veh/h and km/h per station, every 6 min) as two streams of site
 * IDENTIFIERS. Neither carries a coordinate. The only geometry on the server
 * is `QTV-DIR/refDir.csv`, and that file has three properties that make
 * reading it at runtime a mistake:
 *
 *   1. **It is in Lambert-93.** Projected metres, which nothing on a globe can
 *      use. Reprojection is exact and cheap (`scripts/lib/lambert93.mjs`), but
 *      it has no business happening in a browser once per session forever.
 *
 *   2. **It is not a referential.** It is regenerated with every six-minute
 *      publication cycle and its row set MOVES: measured on 2026-08-31, one
 *      cycle carried 1 197 stations and the next 1 192, five having dropped
 *      out. A station that stops reporting for a cycle takes its geometry with
 *      it, so a client reading the live file would watch segments blink out of
 *      existence for reasons that have nothing to do with the road.
 *
 *   3. **It lies about its own shape.** The header declares twenty columns and
 *      every single row publishes nineteen — `code_insee_commune` is absent.
 *      A reader that zips rows against the header shifts every field from the
 *      fourth onward, reads `nb_voies` as an easting, and concludes that most
 *      of the network is unlocatable. It is not: 836 of 1 197 stations carry
 *      real coordinates, and 834 carry a full start AND end pair, which is why
 *      this layer can draw 904 km of SEGMENTS rather than a field of dots.
 *
 * SO THE GEOMETRY IS BUILT ONCE, HERE, AND COMMITTED. Reprojected to WGS84,
 * validated against the projection's own area of use, and accumulated: each
 * run UNIONS what it sees with what the committed file already holds, so
 * re-running the script recovers stations that happened to be absent from the
 * cycle a previous run caught. Nothing is ever silently dropped — a station
 * present in the file and absent from today's cycle keeps its geometry and is
 * counted in `stats.carriedOver`.
 *
 * WHAT IS COMMITTED. Per site: the DIR that operates it, its road, its
 * traficolor zone, and its two endpoints at five decimals (~1 m). Nothing
 * else, and no measurement — flow, speed and colour are live values that would
 * be stale before the commit landed.
 *
 * WHAT IS NOT LOCATABLE, AND SAID SO. DIR Ouest (117 stations) and DIR Est
 * (72) publish their rows with every coordinate field empty, and the four
 * Breton status feeds use site identifiers that appear in no referential row
 * at all. Those sites are kept in the file with `c: null` so the proxy can
 * report "this agglomeration's state is published, its position is not"
 * instead of silently showing an empty map over Nantes, Rennes and Lille.
 *
 * Source:   http://tipi.bison-fute.gouv.fr/bison-fute-ouvert/publicationsDIR/
 * Licence:  Licence Ouverte 2.0 — attribution required, redistribution allowed.
 *           Only identifiers, road names and coordinates are extracted.
 *
 * Usage:
 *   node scripts/build-datex-traficolor-sites.mjs
 *       [--samples=1]          how many publication cycles to read
 *       [--interval=370]       seconds between samples (the cycle is 360 s)
 *       [--no-merge]           replace the committed file instead of unioning
 *       [--no-coverage]        skip the per-agglomeration status probe
 *       [--timeout=60000]
 *       [--out=config/datex_traficolor_sites.json]
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AGGLOMERATION_LABELS,
  QTV_REFERENTIAL_URL,
  ROAD_STATUS_LICENCE,
  TRAFICOLOR_INDEX_URL,
  agglomerationLabel,
  latestPublicationFile,
  parseIndexDirectories,
  parseStationReferential,
  parseTraficolorStatuses,
} from '../src/data/datexRoadStatus.js';
import { isPlausibleFrenchPoint, lambert93ToWgs84 } from './lib/lambert93.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = path.join(ROOT, 'config', 'datex_traficolor_sites.json');
const USER_AGENT = 'gods-eye-view/0.1 (+https://github.com/bilawalsidhu/gods-eye-view)';
/** Five decimals is ~1.1 m of longitude in France — finer than the source. */
const COORD_PRECISION = 5;

function parseArgs(argv) {
  const args = {
    samples: 1,
    intervalS: 370,
    merge: true,
    coverage: true,
    timeout: 60000,
    out: DEFAULT_OUT,
    help: false,
  };
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=');
    if (key === 'samples') args.samples = Math.max(1, Math.min(24, Number(value) || 1));
    else if (key === 'interval') args.intervalS = Math.max(30, Number(value) || 370);
    else if (key === 'no-merge') args.merge = false;
    else if (key === 'no-coverage') args.coverage = false;
    else if (key === 'timeout') args.timeout = Math.max(5000, Number(value) || 60000);
    else if (key === 'out') args.out = path.resolve(ROOT, value);
    else if (key === 'help' || key === 'h') args.help = true;
  }
  return args;
}

async function fetchText(url, timeoutMs) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const round = (value) => Number(value.toFixed(COORD_PRECISION));

/**
 * Reproject one referential row into a drawable segment.
 *
 * A row with only a start point is kept as a one-point site — 2 of 836 on
 * 2026-08-31 — because a status with a position is still worth drawing; the
 * layer renders it as a short stub rather than pretending to a length the
 * source never gave.
 *
 * @param {object} station Parsed referential row, in Lambert-93 metres.
 * @returns {{coords: ?Array<number>, rejected: ?string}}
 */
function projectStation(station) {
  if (!Number.isFinite(station.xStart) || !Number.isFinite(station.yStart)) {
    return { coords: null, rejected: null };
  }
  const start = lambert93ToWgs84(station.xStart, station.yStart);
  if (!isPlausibleFrenchPoint(start.lon, start.lat)) {
    return { coords: null, rejected: 'start outside the Lambert-93 area of use' };
  }
  const coords = [round(start.lon), round(start.lat)];
  if (Number.isFinite(station.xEnd) && Number.isFinite(station.yEnd)) {
    const end = lambert93ToWgs84(station.xEnd, station.yEnd);
    if (!isPlausibleFrenchPoint(end.lon, end.lat)) {
      return { coords: null, rejected: 'end outside the Lambert-93 area of use' };
    }
    coords.push(round(end.lon), round(end.lat));
  }
  return { coords, rejected: null };
}

/** Great-circle length of a two-point segment, in metres. */
function segmentLengthM(coords) {
  if (!Array.isArray(coords) || coords.length < 4) return 0;
  const [lon1, lat1, lon2, lat2] = coords;
  const meanLat = ((lat1 + lat2) / 2) * (Math.PI / 180);
  return Math.hypot(
    (lon2 - lon1) * 111320 * Math.cos(meanLat),
    (lat2 - lat1) * 110570,
  );
}

/**
 * Read every agglomeration status feed once, for the coverage table.
 *
 * This is the only part of the build that touches TRAFICOLOR, and it records
 * nothing live: how many sites each centre publishes, how many of them the
 * referential can place, and how often the directory gains a file. The last
 * one is measured from the file names rather than documented anywhere.
 *
 * @param {Map<string, ?Array<number>>} located Site id → coordinates or null.
 * @param {number} timeoutMs Per-request timeout.
 * @returns {Promise<Array<object>>}
 */
async function probeCoverage(located, timeoutMs) {
  const index = await fetchText(TRAFICOLOR_INDEX_URL, timeoutMs);
  const directories = parseIndexDirectories(index);
  const rows = [];
  for (const directory of directories) {
    try {
      const listing = await fetchText(`${TRAFICOLOR_INDEX_URL}${directory}/`, timeoutMs);
      const files = [...listing.matchAll(/<a href="([A-Za-z0-9_.-]+\.xml)"/g)].map((m) => m[1]);
      const latest = latestPublicationFile(listing);
      if (!latest) {
        rows.push({
          directory, label: agglomerationLabel(directory), sites: 0, located: 0, cadenceS: null, files: 0,
        });
        continue;
      }
      const body = await fetchText(`${TRAFICOLOR_INDEX_URL}${directory}/${latest}`, timeoutMs);
      const { statuses } = parseTraficolorStatuses(body);
      let placeable = 0;
      for (const id of statuses.keys()) if (located.get(id)) placeable += 1;
      rows.push({
        directory,
        label: agglomerationLabel(directory),
        sites: statuses.size,
        located: placeable,
        cadenceS: cadenceFromFileNames(files),
        files: files.length,
      });
    } catch (error) {
      console.warn(`  ! ${directory}: ${error?.message || error}`);
      rows.push({
        directory, label: agglomerationLabel(directory), sites: null, located: null, cadenceS: null, files: null,
      });
    }
  }
  return rows.sort((a, b) => (b.located || 0) - (a.located || 0));
}

/** Publication interval in seconds, from the timestamps in the file names. */
function cadenceFromFileNames(files) {
  const stamps = files
    .map((name) => /(\d{8})_(\d{6})\.xml$/.exec(name))
    .filter(Boolean)
    .map(([, day, time]) => Date.UTC(
      Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)),
      Number(time.slice(0, 2)), Number(time.slice(2, 4)), Number(time.slice(4, 6)),
    ))
    .sort((a, b) => a - b);
  if (stamps.length < 2) return null;
  let smallest = Infinity;
  for (let i = 1; i < stamps.length; i += 1) {
    const delta = (stamps[i] - stamps[i - 1]) / 1000;
    if (delta > 0 && delta < smallest) smallest = delta;
  }
  return Number.isFinite(smallest) ? smallest : null;
}

async function readExisting(outPath) {
  try {
    return JSON.parse(await fsp.readFile(outPath, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(await fsp.readFile(new URL(import.meta.url), 'utf8').then((t) => t.slice(0, t.indexOf('*/') + 2)));
    return;
  }

  const previous = args.merge ? await readExisting(args.out) : null;
  /** @type {Map<string, object>} site id → committed record. */
  const sites = new Map(Object.entries(previous?.sites || {}));
  const carriedOver = new Set(sites.keys());

  let lastCycleRows = 0;
  let headerColumns = 0;
  let skippedRows = 0;
  let rejected = 0;
  const seenThisRun = new Set();

  for (let sample = 0; sample < args.samples; sample += 1) {
    if (sample > 0) {
      console.log(`  … waiting ${args.intervalS}s for the next publication cycle`);
      await sleep(args.intervalS * 1000);
    }
    const csv = await fetchText(QTV_REFERENTIAL_URL, args.timeout);
    const parsed = parseStationReferential(csv);
    lastCycleRows = parsed.rows;
    headerColumns = parsed.headerColumns;
    skippedRows += parsed.skipped;
    console.log(
      `cycle ${sample + 1}/${args.samples}: ${parsed.rows} rows`
      + `, header declares ${parsed.headerColumns} columns`
      + (parsed.skipped ? `, ${parsed.skipped} skipped` : ''),
    );
    for (const station of parsed.stations) {
      seenThisRun.add(station.id);
      carriedOver.delete(station.id);
      const { coords, rejected: why } = projectStation(station);
      if (why) {
        rejected += 1;
        console.warn(`  ! ${station.id}: ${why}`);
        continue;
      }
      const record = {
        d: station.dir || null,
        a: station.axis || null,
        z: station.zone || null,
        c: coords,
      };
      const existing = sites.get(station.id);
      // Never trade a located record for an unlocated one: a cycle that drops
      // the coordinates of a station it still lists is a gap in that cycle,
      // not news about the road.
      if (existing?.c && !record.c) {
        sites.set(station.id, { ...existing, d: record.d || existing.d, a: record.a || existing.a });
      } else {
        sites.set(station.id, record);
      }
    }
  }

  const located = new Map([...sites].map(([id, record]) => [id, record.c || null]));
  let coverage = [];
  if (args.coverage) {
    console.log('probing the agglomeration status feeds…');
    coverage = await probeCoverage(located, args.timeout);
  }

  const byDir = {};
  let locatedCount = 0;
  let segmentCount = 0;
  let lengthM = 0;
  for (const record of sites.values()) {
    const dir = record.d || 'unknown';
    byDir[dir] = byDir[dir] || { sites: 0, located: 0 };
    byDir[dir].sites += 1;
    if (record.c) {
      locatedCount += 1;
      byDir[dir].located += 1;
      if (record.c.length >= 4) {
        segmentCount += 1;
        lengthM += segmentLengthM(record.c);
      }
    }
  }

  const payload = {
    source: QTV_REFERENTIAL_URL,
    statusSource: TRAFICOLOR_INDEX_URL,
    datasetPage: 'https://www.data.gouv.fr/fr/datasets/etat-de-circulation-en-temps-reel-sur-le-reseau-national-routier-non-concede/',
    licence: ROAD_STATUS_LICENCE,
    attribution: 'Bison Futé / DIR — Licence Ouverte 2.0',
    generatedAt: new Date().toISOString(),
    cycles: (previous?.cycles || 0) + args.samples,
    referential: {
      headerColumns,
      rowColumns: 19,
      rowsLastCycle: lastCycleRows,
      skippedRows,
      rejectedOutsideAreaOfUse: rejected,
    },
    stats: {
      sites: sites.size,
      located: locatedCount,
      unlocated: sites.size - locatedCount,
      segments: segmentCount,
      lengthKm: Number((lengthM / 1000).toFixed(1)),
      seenThisRun: seenThisRun.size,
      carriedOver: carriedOver.size,
      byDir,
    },
    coverage,
    sites: Object.fromEntries([...sites].sort(([a], [b]) => (a < b ? -1 : 1))),
  };

  await fsp.mkdir(path.dirname(args.out), { recursive: true });
  await fsp.writeFile(args.out, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  const bytes = (await fsp.stat(args.out)).size;
  console.log('');
  console.log(`wrote ${path.relative(ROOT, args.out)} — ${(bytes / 1024).toFixed(0)} KB`);
  console.log(
    `  ${payload.stats.sites} sites, ${payload.stats.located} located`
    + ` (${payload.stats.segments} segments, ${payload.stats.lengthKm} km)`
    + `, ${payload.stats.unlocated} with no published position`,
  );
  if (carriedOver.size) {
    console.log(`  ${carriedOver.size} kept from an earlier cycle that this run did not see`);
  }
  for (const [dir, tally] of Object.entries(byDir).sort((a, b) => b[1].sites - a[1].sites)) {
    const pct = tally.sites ? Math.round((100 * tally.located) / tally.sites) : 0;
    console.log(`  ${dir.padEnd(8)} ${String(tally.sites).padStart(5)} sites | ${String(tally.located).padStart(5)} located (${pct}%)`);
  }
  if (coverage.length) {
    console.log('');
    for (const row of coverage) {
      const cadence = row.cadenceS === null ? '   ?' : `${String(row.cadenceS).padStart(4)}s`;
      console.log(
        `  ${row.directory.padEnd(24)} ${String(row.sites ?? '?').padStart(4)} sites`
        + ` | ${String(row.located ?? '?').padStart(4)} drawable | ${cadence} | ${row.label}`,
      );
    }
    const unlabelled = coverage.filter((row) => !Object.hasOwn(AGGLOMERATION_LABELS, row.directory));
    if (unlabelled.length) {
      console.log('');
      console.log(`  NOTE: ${unlabelled.length} directory not named in AGGLOMERATION_LABELS: ${unlabelled.map((r) => r.directory).join(', ')}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
