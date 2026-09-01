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
 *      this layer can draw 936 km of SEGMENTS rather than a field of dots.
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
 * AND WHAT HAS NO COORDINATE IS ASKED FOR ITS ADDRESS INSTEAD. A row with no
 * `x_deb` is not necessarily a row with no geometry: 153 of the 525 that
 * publish no coordinate publish a POINT REPÈRE — the kilometre post the French
 * road network is addressed by — and every post of the non-conceded network is
 * published with its Lambert-93 position in a second open dataset, the
 * `Bornage du réseau routier national`. Resolving one against the other
 * (`scripts/lib/rrnBornage.mjs`) recovers all 115 stations of DIR Ouest, 26 of
 * DIR Atlantique, 10 of DIR Centre-Est and 2 of DIR Est.
 *
 * That join is CALIBRATED on every run rather than trusted: 831 stations
 * publish an address AND a coordinate, so the build resolves their address too
 * and prints the disagreement. On 2026-09-01 it was p50 3.9 m, p90 7.3 m,
 * max 64 m — the DIRs derive their own coordinates from this referential, and
 * a future edition that stopped agreeing would move that number, in the build
 * log, before it moved a station on screen.
 *
 * THE SAME KEY LIGHTS FOUR DARK CITIES. The Breton traffic centres (Nantes,
 * Rennes, Saint-Brieuc, Lorient–Vannes) publish TRAFICOLOR under identifiers
 * that appear in no referential row — which is why they were drawn nowhere —
 * but those identifiers ARE point-repère addresses: `35A0084T096_00D` is
 * département 35, route A84, PR 96, abscissa 0, right-hand carriageway. 602 of
 * their 619 sites resolve, and are added to the file as status-only sites with
 * no counting station behind them.
 *
 * WHAT IS STILL NOT LOCATABLE, AND SAID SO. DIR Nord (163 stations, Lille) and
 * DIR Est (Nancy–Metz) publish rows with no coordinate AND no address, under
 * identifiers that are operator codes rather than addresses — the two readings
 * of the Lille codes that fit the bornage at all put its A1 sensors in
 * département 95, inside Île-de-France. Those sites stay in the file with
 * `c: null` so the proxy can report "this agglomeration's state is published,
 * its position is not" instead of silently showing an empty map over Lille.
 *
 * Sources:  http://tipi.bison-fute.gouv.fr/bison-fute-ouvert/publicationsDIR/
 *           https://www.data.gouv.fr/datasets/bornage-du-reseau-routier-national
 * Licence:  Licence Ouverte 2.0 for both — attribution required, redistribution
 *           allowed. Only identifiers, road names and coordinates are extracted.
 *
 * Usage:
 *   node scripts/build-datex-traficolor-sites.mjs
 *       [--samples=1]          how many publication cycles to read
 *       [--interval=370]       seconds between samples (the cycle is 360 s)
 *       [--no-merge]           replace the committed file instead of unioning
 *       [--no-coverage]        skip the per-agglomeration status probe
 *       [--no-bornage]         skip the point-repère join entirely
 *       [--refresh-bornage]    re-download the 3 MB bornage instead of caching
 *       [--no-centreline]      skip the surveyed-centreline shaping
 *       [--refresh-centreline] re-download the 20 MB RRN archive
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
import { isPlausibleFrenchPoint, lambert93ToWgs84, wgs84ToLambert93 } from './lib/lambert93.mjs';
import {
  BORNAGE_CSV_URL,
  bornesBetween,
  BORNAGE_DATASET_PAGE,
  BORNAGE_EDITION,
  BORNAGE_LICENCE,
  buildBornageIndex,
  departementFromSiteId,
  locateBorne,
  normaliseRouteCode,
  parseBornage,
  parsePrAddress,
  parseTraficolorSiteId,
} from './lib/rrnBornage.mjs';
import {
  CENTRELINE_DATASET_PAGE,
  CENTRELINE_EDITION,
  CENTRELINE_LICENCE,
  CENTRELINE_MEMBERS,
  CENTRELINE_SIMPLIFY_M,
  CENTRELINE_ZIP_URL,
  buildCentrelineIndex,
  simplifyPolyline,
  traceAlongRoad,
} from './lib/rrnCentreline.mjs';
import { readZipMember } from './lib/remoteZip.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = path.join(ROOT, 'config', 'datex_traficolor_sites.json');
const USER_AGENT = 'gods-eye-view/0.1 (+https://github.com/bilawalsidhu/gods-eye-view)';
/** Five decimals is ~1.1 m of longitude in France — finer than the source. */
const COORD_PRECISION = 5;
/**
 * Where the 3 MB bornage is kept between runs.
 *
 * Cached rather than re-fetched because the edition is PINNED: the URL names
 * `bornes-2025.csv`, so a second download of the same day returns the same
 * bytes. `--refresh-bornage` forces it when the pin moves.
 */
const BORNAGE_CACHE_PATH = path.join(ROOT, '.gev-cache', 'bornage', 'bornes.csv');
/**
 * Where the 20 MB RRN centreline archive is kept between runs.
 *
 * Cached for the same reason the bornage is — the URL names a dated edition,
 * so a second download returns the same bytes — and it matters more here: the
 * archive expands to 55 MB and only two of its eight members are read.
 */
const CENTRELINE_CACHE_PATH = path.join(ROOT, '.gev-cache', 'bornage', 'rrn-liaisons.zip');

function parseArgs(argv) {
  const args = {
    samples: 1,
    intervalS: 370,
    merge: true,
    coverage: true,
    bornage: true,
    refreshBornage: false,
    centreline: true,
    refreshCentreline: false,
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
    else if (key === 'no-bornage') args.bornage = false;
    else if (key === 'refresh-bornage') args.refreshBornage = true;
    else if (key === 'no-centreline') args.centreline = false;
    else if (key === 'refresh-centreline') args.refreshCentreline = true;
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

async function fetchBinary(url, timeoutMs) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
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

/**
 * Load the national kilometre-post referential, from disk if it is already
 * there.
 *
 * @param {object} args Parsed CLI arguments.
 * @returns {Promise<?object>} Index from `buildBornageIndex`, or null.
 */
async function loadBornageIndex(args) {
  let csv = null;
  if (!args.refreshBornage) {
    csv = await fsp.readFile(BORNAGE_CACHE_PATH, 'utf8').catch(() => null);
  }
  if (csv) {
    console.log(`bornage: reusing ${path.relative(ROOT, BORNAGE_CACHE_PATH)} (${(csv.length / 1024 / 1024).toFixed(1)} MB)`);
  } else {
    console.log(`bornage: downloading ${BORNAGE_EDITION} edition…`);
    csv = await fetchText(BORNAGE_CSV_URL, Math.max(args.timeout, 120000));
    await fsp.mkdir(path.dirname(BORNAGE_CACHE_PATH), { recursive: true });
    await fsp.writeFile(BORNAGE_CACHE_PATH, csv, 'utf8');
  }
  const parsed = parseBornage(csv);
  if (!parsed.bornes.length) {
    console.warn('  ! bornage parsed to nothing — the point-repère join is skipped');
    return null;
  }
  console.log(
    `  ${parsed.bornes.length} kilometre posts`
    + (parsed.skipped ? `, ${parsed.skipped} rows skipped` : ''),
  );
  return buildBornageIndex(parsed.bornes);
}

/**
 * Load the surveyed centreline of the national network, from disk if it is
 * already there.
 *
 * Needs the bornage: a section is placed by the two kilometre posts it names,
 * so with no post index there is nothing to place it against and the whole
 * pass is skipped rather than half-done.
 *
 * @param {object} args Parsed CLI arguments.
 * @param {?object} bornage Index from `buildBornageIndex`, or null.
 * @returns {Promise<?object>} Index from `buildCentrelineIndex`, or null.
 */
async function loadCentrelineIndex(args, bornage) {
  if (!bornage) {
    console.log('centreline: skipped — it is placed by the kilometre posts, and those are not loaded');
    return null;
  }
  let archive = null;
  if (!args.refreshCentreline) {
    archive = await fsp.readFile(CENTRELINE_CACHE_PATH).catch(() => null);
  }
  if (archive) {
    console.log(`centreline: reusing ${path.relative(ROOT, CENTRELINE_CACHE_PATH)} (${(archive.length / 1024 / 1024).toFixed(1)} MB)`);
  } else {
    console.log(`centreline: downloading ${CENTRELINE_EDITION} edition…`);
    archive = await fetchBinary(CENTRELINE_ZIP_URL, Math.max(args.timeout, 300000));
    await fsp.mkdir(path.dirname(CENTRELINE_CACHE_PATH), { recursive: true });
    await fsp.writeFile(CENTRELINE_CACHE_PATH, archive);
  }
  const shp = readZipMember(archive, CENTRELINE_MEMBERS.shp);
  const dbf = readZipMember(archive, CENTRELINE_MEMBERS.dbf);
  if (!shp || !dbf) {
    console.warn(`  ! ${CENTRELINE_MEMBERS.shp}/${CENTRELINE_MEMBERS.dbf} absent from the archive — shaping falls back to the posts`);
    return null;
  }
  const index = buildCentrelineIndex({ shp, dbf }, bornage);
  if (!index.joined) {
    console.warn('  ! no section joined to a kilometre post — shaping falls back to the posts');
    return null;
  }
  const { rejected } = index;
  console.log(
    `  ${index.joined} of ${index.sections} sections placed on ${index.lines.size} carriageways`
    + ` (${rejected.notNumbered} slip roads and unnumbered axes, ${rejected.postUnknown} naming a post the bornage does not hold`
    + `, ${rejected.farFromPosts} drawn away from the posts they name)`,
  );
  return index;
}

/**
 * Resolve one point-repère address to WGS84 degrees.
 *
 * The abscissa is applied only when the caller asks for it, because the two
 * publications this build reads disagree about whether it belongs: the
 * referential's own coordinates ignore it (measured, see `rrnBornage.mjs`),
 * and the traficolor identifiers cannot do without it.
 *
 * @param {object} index From `buildBornageIndex`.
 * @param {{axis: ?string, pr: ?string, abscisseM: number, id: string}} address
 * @returns {?{coords: Array<number>, hit: object}}
 */
function resolvePrPoint(index, address) {
  if (!index) return null;
  const route = normaliseRouteCode(address.axis);
  const parsed = parsePrAddress(address.pr);
  if (!route || !parsed) return null;
  return projectBorne(locateBorne(index, { ...parsed, route }, {
    abscisseM: address.abscisseM || 0,
    depHint: departementFromSiteId(address.id),
  }));
}

/**
 * A resolved post, in degrees, or null if it landed outside the projection's
 * area of use — the same gate `projectStation` applies to a published
 * coordinate, for the same reason.
 *
 * @param {?object} hit From `locateBorne`.
 * @returns {?{coords: Array<number>, hit: object}}
 */
function projectBorne(hit) {
  if (!hit) return null;
  const point = lambert93ToWgs84(hit.x, hit.y);
  if (!isPlausibleFrenchPoint(point.lon, point.lat)) return null;
  return { coords: [round(point.lon), round(point.lat)], hit };
}

/**
 * Check the join against the stations that answer the question both ways.
 *
 * Run on EVERY build, not once when the code was written: the referential and
 * the bornage are published by different services on different schedules, and
 * the day their agreement breaks is the day this number moves. A build whose
 * median disagreement jumps from metres to hundreds of metres has joined the
 * wrong thing and should not be committed.
 *
 * @param {object} index From `buildBornageIndex`.
 * @param {Array<object>} stations Parsed referential rows.
 * @returns {?{n: number, p50: number, p90: number, max: number, within25m: number}}
 */
function calibratePrJoin(index, stations) {
  const errors = [];
  for (const station of stations) {
    if (!Number.isFinite(station.xStart) || !Number.isFinite(station.yStart)) continue;
    const route = normaliseRouteCode(station.axis);
    const parsed = parsePrAddress(station.prStart);
    if (!route || !parsed) continue;
    const hit = locateBorne(index, { ...parsed, route }, { depHint: departementFromSiteId(station.id) });
    if (!hit) continue;
    errors.push(Math.hypot(hit.x - station.xStart, hit.y - station.yStart));
  }
  if (!errors.length) return null;
  errors.sort((a, b) => a - b);
  const at = (q) => errors[Math.min(errors.length - 1, Math.floor(q * (errors.length - 1)))];
  return {
    n: errors.length,
    p50: Number(at(0.5).toFixed(1)),
    p90: Number(at(0.9).toFixed(1)),
    max: Number(at(1).toFixed(1)),
    within25m: Number((errors.filter((e) => e <= 25).length / errors.length).toFixed(4)),
  };
}

/**
 * Road name as a sign writes it: `A0084` → `A84`, `N0165` → `N165`.
 *
 * The referential is filled in by ten DIRs and each pads differently, so the
 * same motorway reaches the card as `A28` from Rouen and `A0084` from Nantes.
 * Only the padding is removed — an axis this does not recognise is passed
 * through untouched rather than reformatted into something the publisher did
 * not say.
 *
 * @param {?string} axis
 * @returns {?string}
 */
function humanRouteName(axis) {
  if (typeof axis !== 'string' || !axis.trim()) return null;
  const match = /^([ANDMP])0*(\d{1,4})$/i.exec(axis.trim());
  return match ? `${match[1].toUpperCase()}${match[2]}` : axis.trim();
}

/**
 * Length of a segment along every one of its vertices, in metres.
 *
 * Summed rather than measured end to end, because a segment that follows the
 * road through its kilometre posts is longer than the straight line between
 * its ends — and the road is the thing whose length this file reports.
 */
function segmentLengthM(coords) {
  if (!Array.isArray(coords) || coords.length < 4) return 0;
  let total = 0;
  for (let i = 0; i + 3 < coords.length; i += 2) {
    const meanLat = ((coords[i + 1] + coords[i + 3]) / 2) * (Math.PI / 180);
    total += Math.hypot(
      (coords[i + 2] - coords[i]) * 111320 * Math.cos(meanLat),
      (coords[i + 3] - coords[i + 1]) * 110570,
    );
  }
  return total;
}

/**
 * A segment whose two published ends are the same place.
 *
 * 234 of the 842 stored segments, measured 2026-09-01: stations whose
 * referential row repeats `x_deb` as `x_fin`. They were being written as
 * four-number segments and drawn as zero-length ground polylines — geometry
 * Cesium cannot stroke — when what the publisher said is "here", once.
 * Collapsing them to a single point is what makes the renderer draw them as
 * the 25 m stub a positioned station with no extent deserves.
 *
 * @param {?Array<number>} coords Flat `[lon, lat, …]`.
 * @returns {boolean}
 */
function isDegenerateSegment(coords) {
  return Array.isArray(coords) && coords.length === 4
    && coords[0] === coords[2] && coords[1] === coords[3];
}

/**
 * Re-shape a segment so it follows the road instead of cutting across it.
 *
 * TWO SOURCES, TRIED IN THAT ORDER, and they are not interchangeable.
 *
 *   1. The SURVEYED CENTRELINE of the carriageway (`rrnCentreline.mjs`), at a
 *      mean 26 m between vertices. This is the road.
 *   2. Failing that, the KILOMETRE POSTS between the two ends
 *      (`bornesBetween`), at 1 000 m. This is a hint about the road.
 *
 * The second used to be the only one, and it could not carry the layer: the
 * median segment is 948 m long and the median post interval 1 000 m, so 643 of
 * 842 segments contained no post at all and stayed straight. Measured
 * 2026-09-01 against the centreline, the drawn line strayed a median 56 m from
 * its own tarmac and 142 m at p90, with 411 segments past 25 m. Tracing the
 * centreline instead answers 589 of the 608 real segments and leaves the
 * remainder — slip roads, unnumbered axes — to the posts exactly as before.
 *
 * ALWAYS FROM THE TWO ENDS, never from the current vertex list, so re-running
 * the build re-derives the shape rather than accumulating it. And the two ends
 * are kept VERBATIM: this changes the path between a station's endpoints, not
 * the endpoints, which remain what the DIR published.
 *
 * @param {?object} bornage Kilometre-post index, or null.
 * @param {?object} centreline Surveyed-centreline index, or null.
 * @param {object} record Committed site record.
 * @returns {?{coords: Array<number>, from: string}} New coordinate list and
 *   which source shaped it, or null to keep the old one.
 */
function shapeSegmentToRoad(bornage, centreline, record) {
  const coords = record?.c;
  if (!bornage || !Array.isArray(coords) || coords.length < 4) return null;
  if (isDegenerateSegment(coords)) return null;
  const route = normaliseRouteCode(record.a);
  if (!route) return null;
  const start = wgs84ToLambert93(coords[0], coords[1]);
  const end = wgs84ToLambert93(coords[coords.length - 2], coords[coords.length - 1]);

  const traced = traceAlongRoad(centreline, bornage, route, start, end);
  if (traced.points) {
    const simplified = simplifyPolyline(traced.points, CENTRELINE_SIMPLIFY_M);
    const out = [];
    for (let i = 0; i + 1 < simplified.length; i += 2) {
      const point = lambert93ToWgs84(simplified[i], simplified[i + 1]);
      if (!isPlausibleFrenchPoint(point.lon, point.lat)) return null;
      out.push(round(point.lon), round(point.lat));
    }
    // The ends are the publisher's, to the file's own five decimals, whatever
    // rounding the round trip through Lambert-93 did to them.
    out[0] = coords[0];
    out[1] = coords[1];
    out[out.length - 2] = coords[coords.length - 2];
    out[out.length - 1] = coords[coords.length - 1];
    return { coords: out, from: 'centreline' };
  }

  const { posts } = bornesBetween(bornage, route, start, end);
  if (!posts.length) return null;
  const middle = [];
  for (const post of posts) {
    const point = lambert93ToWgs84(post.x, post.y);
    if (!isPlausibleFrenchPoint(point.lon, point.lat)) return null;
    middle.push(round(point.lon), round(point.lat));
  }
  return {
    coords: [
      coords[0], coords[1],
      ...middle,
      coords[coords.length - 2], coords[coords.length - 1],
    ],
    from: 'posts',
  };
}

/**
 * Read every agglomeration status feed once, for the coverage table.
 *
 * This is the only part of the build that touches TRAFICOLOR, and it records
 * nothing live: how many sites each centre publishes, how many of them the
 * referential can place, and how often the directory gains a file. The last
 * one is measured from the file names rather than documented anywhere.
 *
 * IT ALSO PLACES THE SITES THE REFERENTIAL NEVER MENTIONS. Four centres
 * publish identifiers that are themselves point-repère addresses, and this is
 * the only pass that ever sees those identifiers — so a status site that no
 * counting station backs, but whose id resolves against the bornage, is added
 * to the file here with `k: 'status'`. That is what turns Nantes, Rennes,
 * Saint-Brieuc and Lorient–Vannes from four grey names in the coverage table
 * into 602 drawn sites.
 *
 * `added` counts what THIS run placed; the `fromPointRepere` of each row
 * counts what the file HOLDS. They differ on every merge run after the first,
 * and conflating them once made a rebuild report Brittany as unlit on the day
 * nothing about Brittany had changed.
 *
 * @param {Map<string, object>} sites Site id → committed record, mutated here.
 * @param {?object} bornage Kilometre-post index, or null when skipped.
 * @param {number} timeoutMs Per-request timeout.
 * @returns {Promise<{rows: Array<object>, added: number}>}
 */
async function probeCoverage(sites, bornage, timeoutMs) {
  const index = await fetchText(TRAFICOLOR_INDEX_URL, timeoutMs);
  const directories = parseIndexDirectories(index);
  const rows = [];
  let added = 0;
  for (const directory of directories) {
    try {
      const listing = await fetchText(`${TRAFICOLOR_INDEX_URL}${directory}/`, timeoutMs);
      const files = [...listing.matchAll(/<a href="([A-Za-z0-9_.-]+\.xml)"/g)].map((m) => m[1]);
      const latest = latestPublicationFile(listing);
      if (!latest) {
        rows.push({
          directory,
          label: agglomerationLabel(directory),
          sites: 0,
          located: 0,
          fromPointRepere: 0,
          cadenceS: null,
          files: 0,
        });
        continue;
      }
      const body = await fetchText(`${TRAFICOLOR_INDEX_URL}${directory}/${latest}`, timeoutMs);
      const { statuses } = parseTraficolorStatuses(body);
      let placeable = 0;
      let fromPr = 0;
      for (const id of statuses.keys()) {
        const existing = sites.get(id);
        if (!existing?.c && bornage) {
          // The identifier already carries its département and carriageway, so
          // it goes to the index as written rather than back through the
          // referential's looser `76PR91D` grammar.
          const address = parseTraficolorSiteId(id);
          const resolved = address
            && projectBorne(locateBorne(bornage, address, { abscisseM: address.abscisseM }));
          if (resolved) {
            sites.set(id, {
              d: existing?.d || null,
              a: existing?.a || humanRouteName(address.route),
              z: existing?.z || null,
              c: resolved.coords,
              g: 'pr',
              k: existing ? existing.k || 'qtv' : 'status',
            });
            added += 1;
          }
        }
        const placed = sites.get(id);
        if (placed?.c) placeable += 1;
        // Counted from the RECORD, not from what this run happened to add. A
        // merge run against a file that already holds Brittany places nothing
        // new, and reporting zero there would say the point-repère join had
        // stopped working on the very day it was working from cache.
        if (placed?.c && placed.g === 'pr') fromPr += 1;
      }
      rows.push({
        directory,
        label: agglomerationLabel(directory),
        sites: statuses.size,
        located: placeable,
        fromPointRepere: fromPr,
        cadenceS: cadenceFromFileNames(files),
        files: files.length,
      });
    } catch (error) {
      console.warn(`  ! ${directory}: ${error?.message || error}`);
      rows.push({
        directory,
        label: agglomerationLabel(directory),
        sites: null,
        located: null,
        fromPointRepere: null,
        cadenceS: null,
        files: null,
      });
    }
  }
  return { rows: rows.sort((a, b) => (b.located || 0) - (a.located || 0)), added };
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

  const bornage = args.bornage ? await loadBornageIndex(args) : null;
  const centreline = args.centreline ? await loadCentrelineIndex(args, bornage) : null;

  let lastCycleRows = 0;
  let headerColumns = 0;
  let skippedRows = 0;
  let rejected = 0;
  const seenThisRun = new Set();
  /** Last cycle's row for every station seen, for the point-repère pass. */
  const rowsById = new Map();
  let calibration = null;

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
    if (bornage && !calibration) calibration = calibratePrJoin(bornage, parsed.stations);
    for (const station of parsed.stations) {
      seenThisRun.add(station.id);
      carriedOver.delete(station.id);
      rowsById.set(station.id, station);
      const { coords, rejected: why } = projectStation(station);
      if (why) {
        rejected += 1;
        console.warn(`  ! ${station.id}: ${why}`);
        continue;
      }
      const record = {
        d: station.dir || null,
        a: humanRouteName(station.axis),
        z: station.zone || null,
        c: coords,
        // Where this position came from. A published `x_deb` and a position
        // resolved from a kilometre post are both correct and are not the
        // same claim, so the file says which one it is holding.
        g: coords ? 'xy' : null,
        k: 'qtv',
      };
      const existing = sites.get(station.id);
      // Never trade a located record for an unlocated one: a cycle that drops
      // the coordinates of a station it still lists is a gap in that cycle,
      // not news about the road.
      if (existing?.c && !record.c) {
        sites.set(station.id, {
          ...existing,
          d: record.d || existing.d,
          a: record.a || existing.a,
          k: 'qtv',
        });
      } else {
        sites.set(station.id, record);
      }
    }
  }

  // ── The point-repère pass ────────────────────────────────────────────────
  // Only rows that published NO coordinate are asked for their address: where
  // the publisher gave a position, the publisher's position is the answer.
  let fromPointRepere = 0;
  const prMisses = { noRoute: 0, noAddress: 0, unresolved: 0 };
  if (bornage) {
    for (const [id, record] of sites) {
      if (record.c) continue;
      const station = rowsById.get(id);
      if (!station) continue;
      const resolved = resolvePrPoint(bornage, {
        axis: station.axis, pr: station.prStart, abscisseM: 0, id,
      });
      if (!resolved) {
        if (!normaliseRouteCode(station.axis)) prMisses.noRoute += 1;
        else if (!parsePrAddress(station.prStart)) prMisses.noAddress += 1;
        else prMisses.unresolved += 1;
        continue;
      }
      // The end post too, when there is one: a station with both is a segment
      // rather than the stub a single point can only be drawn as.
      const end = resolvePrPoint(bornage, {
        axis: station.axis, pr: station.prEnd, abscisseM: 0, id,
      });
      const coords = end && (end.coords[0] !== resolved.coords[0] || end.coords[1] !== resolved.coords[1])
        ? [...resolved.coords, ...end.coords]
        : resolved.coords;
      sites.set(id, { ...record, c: coords, g: 'pr' });
      fromPointRepere += 1;
    }
    console.log(
      `point-repère join: ${fromPointRepere} stations placed from their kilometre post`
      + `, ${prMisses.noRoute} rows carry no route, ${prMisses.noAddress} no address`
      + `, ${prMisses.unresolved} an address the bornage does not hold`,
    );
    if (calibration) {
      console.log(
        `  calibrated on ${calibration.n} stations that publish both:`
        + ` p50 ${calibration.p50} m, p90 ${calibration.p90} m, max ${calibration.max} m`
        + `, ${(calibration.within25m * 100).toFixed(1)}% within 25 m`,
      );
    }
  }

  let coverage = [];
  let statusSitesAdded = 0;
  if (args.coverage) {
    console.log('probing the agglomeration status feeds…');
    const probed = await probeCoverage(sites, bornage, args.timeout);
    coverage = probed.rows;
    statusSitesAdded = probed.added;
    if (statusSitesAdded) {
      console.log(`  ${statusSitesAdded} status sites placed from their own point-repère identifier`);
    }
  }

  // ── Follow the road ──────────────────────────────────────────────────────
  // Last, so it applies to every segment whatever placed it: a coordinate the
  // DIR published, a kilometre post resolved above, or a record carried over
  // from an earlier cycle.
  let shaped = 0;
  let shapeVertices = 0;
  let fromCentreline = 0;
  let fromPosts = 0;
  let collapsed = 0;
  if (bornage) {
    for (const [id, record] of sites) {
      // A station published with `x_deb === x_fin` is a point wearing a
      // segment's shape. Say so before anything tries to shape it.
      if (isDegenerateSegment(record.c)) {
        sites.set(id, { ...record, c: [record.c[0], record.c[1]] });
        collapsed += 1;
        continue;
      }
      const reshaped = shapeSegmentToRoad(bornage, centreline, record);
      if (!reshaped) continue;
      // Counted against the CHORD, not against whatever the file already
      // held, so a re-run of the build reports the same number instead of
      // shrinking it to zero once the geometry is committed.
      shapeVertices += reshaped.coords.length / 2 - 2;
      sites.set(id, { ...record, c: reshaped.coords });
      shaped += 1;
      if (reshaped.from === 'centreline') fromCentreline += 1;
      else fromPosts += 1;
    }
    console.log(
      `road shaping: ${shaped} segments follow the road (+${shapeVertices} vertices)`
      + ` — ${fromCentreline} on the surveyed centreline, ${fromPosts} threaded through their kilometre posts`,
    );
    if (collapsed) {
      console.log(`  ${collapsed} sites published a start equal to their end and are written as points`);
    }
  }

  const byDir = {};
  let locatedCount = 0;
  let segmentCount = 0;
  let lengthM = 0;
  const geometry = { published: 0, pointRepere: 0 };
  let statusOnlySites = 0;
  for (const record of sites.values()) {
    // `byDir` counts COUNTING STATIONS. A status site placed from its own
    // identifier has no station and no DIR behind it, and filing 326 of them
    // under `unknown` would invent an eleventh directorate.
    const station = record.k !== 'status';
    const dir = record.d || 'unknown';
    if (station) {
      byDir[dir] = byDir[dir] || { sites: 0, located: 0, fromPointRepere: 0 };
      byDir[dir].sites += 1;
    } else {
      statusOnlySites += 1;
    }
    if (record.c) {
      locatedCount += 1;
      if (station) byDir[dir].located += 1;
      if (record.g === 'pr') {
        geometry.pointRepere += 1;
        if (station) byDir[dir].fromPointRepere += 1;
      } else geometry.published += 1;
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
    // The second dataset this file is built from, and how far it disagreed
    // with the first on the stations that answer to both. `calibration` is
    // re-measured on every run; if it ever leaves the metre range, the join
    // has stopped meaning what this file says it means.
    bornage: bornage ? {
      source: BORNAGE_CSV_URL,
      datasetPage: BORNAGE_DATASET_PAGE,
      edition: BORNAGE_EDITION,
      licence: BORNAGE_LICENCE,
      posts: bornage.size,
      calibration,
      shaping: { segments: shaped, vertices: shapeVertices },
    } : null,
    // The third dataset, and the one that decides what the layer LOOKS like:
    // the surveyed centre of every carriageway, placed against the bornage by
    // the posts each section names rather than by proximity.
    centreline: centreline ? {
      source: CENTRELINE_ZIP_URL,
      datasetPage: CENTRELINE_DATASET_PAGE,
      edition: CENTRELINE_EDITION,
      licence: CENTRELINE_LICENCE,
      sections: centreline.joined,
      carriageways: centreline.lines.size,
      simplifyM: CENTRELINE_SIMPLIFY_M,
      shaped: fromCentreline,
    } : null,
    stats: {
      sites: sites.size,
      located: locatedCount,
      unlocated: sites.size - locatedCount,
      segments: segmentCount,
      lengthKm: Number((lengthM / 1000).toFixed(1)),
      seenThisRun: seenThisRun.size,
      carriedOver: carriedOver.size,
      // How the located half is located: a coordinate the DIR published, or a
      // kilometre post this build resolved.
      geometry,
      // Segments drawn through the surveyed posts of their own carriageway
      // rather than as the straight line between their two ends.
      shapedToRoad: shaped,
      // Split by what shaped them: the 26 m survey, or the 1 000 m posts.
      shapedFromCentreline: fromCentreline,
      shapedFromPosts: fromPosts,
      collapsedToPoint: collapsed,
      statusOnlySites,
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
    + `, ${payload.stats.unlocated} with neither a position nor an address`,
  );
  console.log(
    `  ${geometry.published} from a published coordinate`
    + `, ${geometry.pointRepere} from a kilometre post`
    + `, ${statusOnlySites} of them status sites the referential never lists`,
  );
  if (shaped) {
    console.log(
      `  ${shaped} segments follow the road rather than the straight line between their ends`
      + ` (${fromCentreline} on surveyed centreline)`,
    );
  }
  if (carriedOver.size) {
    console.log(`  ${carriedOver.size} kept from an earlier cycle that this run did not see`);
  }
  for (const [dir, tally] of Object.entries(byDir).sort((a, b) => b[1].sites - a[1].sites)) {
    const pct = tally.sites ? Math.round((100 * tally.located) / tally.sites) : 0;
    const pr = tally.fromPointRepere ? ` , ${tally.fromPointRepere} from a PR` : '';
    console.log(`  ${dir.padEnd(8)} ${String(tally.sites).padStart(5)} sites | ${String(tally.located).padStart(5)} located (${pct}%)${pr}`);
  }
  if (coverage.length) {
    console.log('');
    for (const row of coverage) {
      const cadence = row.cadenceS === null ? '   ?' : `${String(row.cadenceS).padStart(4)}s`;
      const pr = row.fromPointRepere ? `+${row.fromPointRepere} PR` : '      ';
      console.log(
        `  ${row.directory.padEnd(24)} ${String(row.sites ?? '?').padStart(4)} sites`
        + ` | ${String(row.located ?? '?').padStart(4)} drawable | ${pr.padStart(7)} | ${cadence} | ${row.label}`,
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
