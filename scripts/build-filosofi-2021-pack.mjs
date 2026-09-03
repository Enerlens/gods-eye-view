#!/usr/bin/env node
/**
 * Build a local pack of the INSEE carroyage **millésime 2021**, so the layer can
 * draw the newest edition instead of the 2019 one the Géoplateforme relays.
 *
 * ── WHY A PACK AND NOT A SERVICE ────────────────────────────────────────────
 * INSEE published the 2021 carroyage on **12 February 2026**. The Géoplateforme
 * WFS the layer normally reads has NOT been updated: measured 2026-09-03, it
 * still answers 2 314 836 cells at 200 m, against 2 313 783 documented for 2019
 * and 2 324 577 for 2021. So 2021 exists only as files.
 *
 * ── WHY NOT THE PARQUET ON data.gouv.fr ─────────────────────────────────────
 * There is a 95 MB Parquet of the same millésime, range-readable over HTTP,
 * which would have been the cheap route. It has **34 columns and none of them is
 * the imputation flag**. This layer draws a modelled cell as a hollow ring and
 * an observed one as a solid disc, because 39 % of cells are modelled and
 * drawing them alike is drawing a model and calling it a census. A source that
 * cannot say which is which is not a source this layer can use, however
 * convenient. INSEE's own CSV carries `i_est_200`, `i_est_1km` AND `lcog_geo`,
 * so that is what this reads.
 *
 * ── ALL THREE TERRITORIES ───────────────────────────────────────────────────
 * Métropole is EPSG:3035, Martinique is 5490 and La Réunion is 2975 — INSEE
 * grids each in its own zone rather than reprojecting them, which is right:
 * LAEA Europe is a projection for Europe and a Réunion carreau expressed in it
 * would not be square on the ground. The app inverts all three, so the grid
 * travels with every cell and is part of its shard key — two cells in two
 * territories can carry the same northing and easting and mean different
 * places.
 *
 * ── WHAT IT WRITES ──────────────────────────────────────────────────────────
 * Gzipped JSON shards on a 51.2 km LAEA tile grid, in the layer's OWN wire
 * shape — the same objects `projectCarreaux()` produces from the WFS — so the
 * proxy serves 2021 through the path that already exists and the client cannot
 * tell which source answered except by reading the `vintage` it is told.
 *
 * The output is NOT committed: about 130 MB for both grids. It lands in
 * `.gev-cache/`, which is gitignored, and the proxy falls back to the WFS when
 * it is absent. A clone with no pack draws 2019 and says 2019.
 *
 * ── THE 1 km GRID IS AGGREGATED HERE, NOT DOWNLOADED ────────────────────────
 * INSEE ships a separate 1 km file, but every 200 m row already carries its
 * `idcar_1km` and its own `i_est_1km`, so the coarse grid is a group-by over
 * the file already open. The RATIOS are recomputed from summed numerators and
 * denominators, never averaged: the mean of nine cells' poverty rates is not
 * the poverty rate of the nine, and using it would have made the coarse grid
 * disagree with the fine one over the same ground.
 *
 * Usage:
 *   node scripts/build-filosofi-2021-pack.mjs                 # download + build
 *   node scripts/build-filosofi-2021-pack.mjs --from FILE.zip # build from a local archive
 *   node scripts/build-filosofi-2021-pack.mjs --check         # report what is on disk
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import os from 'node:os';
import readline from 'node:readline';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { findCentralEntry, findEndOfCentralDirectory } from './lib/remoteZip.mjs';
import { cellCentre } from '../src/data/filosofiFeed.js';
import {
  PACK_CRS,
  PACK_VINTAGE,
  SHARD_M,
  packIndexPath,
  shardKey,
  shardPath as packShardPath,
} from './lib/filosofiPack.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
export const PACK_DIR = path.join(REPO, '.gev-cache', 'filosofi-2021');
const INDEX_FILE = packIndexPath(PACK_DIR);

/** The publisher's own page and file, recorded in the index so the pack can be traced. */
const SOURCE_PAGE = 'https://www.insee.fr/fr/statistiques/8735162';
const SOURCE_ZIP = 'https://www.insee.fr/fr/statistiques/fichier/8735162/Filosofi2021_carreaux_200m_csv.zip';
export { PACK_VINTAGE };

// ---------------------------------------------------------------------------
// Reading INSEE's CSV
// ---------------------------------------------------------------------------
/** `CRS3035RES200mN2029400E4259000` → `{crs, res, n, e}`. */
const ID_GRAMMAR = /^CRS(\d+)RES(\d+)mN(\d+)E(\d+)$/;

/**
 * Read a cell identifier, INCLUDING the projection it is expressed in.
 *
 * THE DOM ARE NOT IN EPSG:3035 IN INSEE'S OWN FILES, and that is the whole
 * reason this returns the CRS instead of assuming it. Métropole is `CRS3035`
 * (LAEA Europe); Martinique is `CRS5490` (UTM 20 N) and La Réunion is `CRS2975`
 * (UTM 40 S). The layer inverts 3035 and only 3035, so a cell in either of the
 * others cannot be turned back into a polygon here. They are counted and
 * skipped, never silently folded in at coordinates that would land them in the
 * Atlantic.
 *
 * @param {string} id
 * @returns {?{crs:number, res:number, n:number, e:number}}
 */
export function parseIdcar(id) {
  const match = ID_GRAMMAR.exec(String(id ?? '').trim());
  if (!match) return null;
  return {
    crs: Number(match[1]), res: Number(match[2]), n: Number(match[3]), e: Number(match[4]),
  };
}

/**
 * Split one CSV line, respecting quotes.
 *
 * NOT `line.split(',')`, and the reason is a real bug this replaced: about
 * **8 % of rows quote their commune field because the cell straddles several
 * communes** — `"2A041,2A247"` — and a naive split shifts every column after it
 * by one. The first build published a France with 64 010 communes and the wrong
 * income in one row out of twelve.
 *
 * @param {string} line
 * @returns {string[]}
 */
export function splitCsvLine(line) {
  const out = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { out.push(field); field = ''; }
    else field += char;
  }
  out.push(field);
  return out;
}

/**
 * The single commune a cell belongs to, or null when it belongs to several.
 *
 * INSEE lists every commune a carreau touches. The layer's wire shape carries
 * ONE code, and picking the first of a list would be inventing an answer the
 * publisher deliberately declined to give — the same reason the 1 km grid names
 * no commune at all. A straddling cell gets null and is counted in the index.
 *
 * @param {?string} raw
 * @returns {?string}
 */
export function singleCommune(raw) {
  // The quotes are stripped by `splitCsvLine` before this sees them, but the
  // function is exported and a caller reading the CSV another way should not
  // get a commune code with a quotation mark in it.
  const value = String(raw ?? '').trim().replace(/^"|"$/g, '');
  if (!value) return null;
  const codes = value.split(',').map((code) => code.trim()).filter(Boolean);
  return codes.length === 1 ? codes[0] : null;
}

/** @param {string} raw @returns {?number} */
function num(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * A percentage from a numerator and a denominator, rounded to a tenth.
 *
 * Rounded to ONE decimal because that is the precision the WFS relay publishes,
 * and a pack that carried three would make the same cell look different
 * depending on which source answered.
 *
 * @param {?number} part @param {?number} whole @returns {?number}
 */
export function share(part, whole) {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

/**
 * One CSV row as the wire cell the layer already knows.
 *
 * The field names are INSEE's raw ones; the Géoplateforme publishes the same
 * numbers pre-divided under names like `ind_snv_div_ind`. Doing the division
 * here is what makes the two sources interchangeable downstream.
 *
 * @param {Object<string,string>} row
 * @returns {?object}
 */
export function cellFromRow(row) {
  const parsed = parseIdcar(row.idcar_200m);
  if (!parsed || !PACK_CRS.includes(parsed.crs)) return null;
  const ind = num(row.ind);
  const men = num(row.men);
  const indSnv = num(row.ind_snv);
  const jeunes = ['ind_0_3', 'ind_4_5', 'ind_6_10', 'ind_11_17']
    .reduce((sum, key) => sum + (num(row[key]) ?? 0), 0);
  const aines = ['ind_65_79', 'ind_80p']
    .reduce((sum, key) => sum + (num(row[key]) ?? 0), 0);
  const est = row.i_est_200 === '1' ? 1 : (row.i_est_200 === '0' ? 0 : null);
  return {
    n: parsed.n,
    e: parsed.e,
    // The grid, because a cell means nothing without it: métropole is LAEA and
    // the two DOM are their own UTM zones.
    crs: parsed.crs,
    // Halves are kept: INSEE's imputation splits people between cells, and
    // rounding here would make the layer's totals disagree with the source's.
    ind,
    men,
    niveau: Number.isFinite(indSnv) && Number.isFinite(ind) && ind > 0
      ? Math.round(indSnv / ind) : null,
    pauvrete: share(num(row.men_pauv), men),
    social: share(num(row.log_soc), men),
    // `men_surf` is a TOTAL floor area, not a mean: the per-dwelling figure is
    // the division, and reading the column straight would publish a France of
    // 35 000 m² apartments.
    surface: Number.isFinite(num(row.men_surf)) && Number.isFinite(men) && men > 0
      ? Math.round((num(row.men_surf) / men) * 10) / 10 : null,
    jeunes: share(jeunes, ind),
    aines: share(aines, ind),
    proprietaires: share(num(row.men_prop), men),
    solo: share(num(row.men_1ind), men),
    collectif: share(num(row.men_coll), men),
    est,
    com: singleCommune(row.lcog_geo),
  };
}

/**
 * Accumulate a 200 m row into its 1 km parent.
 *
 * SUMS, never means. The coarse cell's poverty rate is the summed poor
 * households over the summed households; averaging the nine children's rates
 * would weight a 4-household square like a 400-household one and make the two
 * grids disagree over the same ground.
 *
 * @param {Map<string, object>} coarse
 * @param {Object<string,string>} row
 */
export function accumulateKm(coarse, row) {
  const parsed = parseIdcar(row.idcar_1km);
  if (!parsed || !PACK_CRS.includes(parsed.crs)) return;
  const key = row.idcar_1km;
  let cell = coarse.get(key);
  if (!cell) {
    cell = {
      n: parsed.n,
      e: parsed.e,
      crs: parsed.crs,
      ind: 0,
      men: 0,
      indSnv: 0,
      menPauv: 0,
      logSoc: 0,
      menSurf: 0,
      menProp: 0,
      men1ind: 0,
      menColl: 0,
      jeunes: 0,
      aines: 0,
      // The coarse grid has its OWN published flag; it is not derived from the
      // children, because INSEE decides confidentiality at each resolution.
      est: row.i_est_1km === '1' ? 1 : (row.i_est_1km === '0' ? 0 : null),
    };
    coarse.set(key, cell);
  }
  const add = (field, column) => { cell[field] += num(row[column]) ?? 0; };
  add('ind', 'ind');
  add('men', 'men');
  add('indSnv', 'ind_snv');
  add('menPauv', 'men_pauv');
  add('logSoc', 'log_soc');
  add('menSurf', 'men_surf');
  add('menProp', 'men_prop');
  add('men1ind', 'men_1ind');
  add('menColl', 'men_coll');
  for (const column of ['ind_0_3', 'ind_4_5', 'ind_6_10', 'ind_11_17']) {
    cell.jeunes += num(row[column]) ?? 0;
  }
  for (const column of ['ind_65_79', 'ind_80p']) cell.aines += num(row[column]) ?? 0;
}

/**
 * One accumulated 1 km cell as the wire shape.
 *
 * `com` is deliberately null: a 1 km square spans several communes and INSEE
 * names none on its own coarse file either. Naming the first child's commune
 * would be inventing an answer the publisher declined to give.
 *
 * @param {object} cell
 * @returns {object}
 */
export function coarseCellToWire(cell) {
  const round = (value) => Math.round(value * 10) / 10;
  return {
    n: cell.n,
    e: cell.e,
    crs: cell.crs,
    ind: round(cell.ind),
    men: round(cell.men),
    niveau: cell.ind > 0 ? Math.round(cell.indSnv / cell.ind) : null,
    pauvrete: share(cell.menPauv, cell.men),
    social: share(cell.logSoc, cell.men),
    surface: cell.men > 0 ? Math.round((cell.menSurf / cell.men) * 10) / 10 : null,
    jeunes: share(cell.jeunes, cell.ind),
    aines: share(cell.aines, cell.ind),
    proprietaires: share(cell.menProp, cell.men),
    solo: share(cell.men1ind, cell.men),
    collectif: share(cell.menColl, cell.men),
    est: cell.est,
    com: null,
  };
}

// ---------------------------------------------------------------------------
// The build
// ---------------------------------------------------------------------------
/**
 * Download the archive once, to a temp file outside the cache.
 *
 * OUTSIDE `.gev-cache/` deliberately: on the staging VPS that directory is a
 * Docker volume the pack has to survive redeploys in, and the first version of
 * this script unpacked 558 MB of intermediates into it and left them there.
 * The zip goes to the OS temp directory and is removed in a `finally`.
 *
 * @param {string} workDir
 * @returns {Promise<string>} Path to the downloaded archive.
 */
async function downloadArchive(workDir) {
  const zipPath = path.join(workDir, 'filosofi2021_csv.zip');
  process.stderr.write(`Downloading ${SOURCE_ZIP}\n  (91 MB, once)…\n`);
  const response = await fetch(SOURCE_ZIP, { signal: AbortSignal.timeout(20 * 60_000) });
  if (!response.ok) throw new Error(`INSEE HTTP ${response.status}`);
  await fsp.writeFile(zipPath, Buffer.from(await response.arrayBuffer()));
  return zipPath;
}

/**
 * Locate one member inside a local ZIP, without expanding anything.
 *
 * NO `unzip`, and that is a deployment fact rather than a preference: the
 * staging container has no unzip binary, and the first version of this script
 * shelled out to one. The repo already reads ZIP central directories for the
 * GTFS route-type index (`lib/remoteZip.mjs`), so this reuses that rather than
 * adding either a binary dependency or a second parser.
 *
 * @param {string} zipPath
 * @param {string} name Member basename.
 * @returns {Promise<?{start:number, compressedSize:number, method:number}>}
 */
async function locateMember(zipPath, name) {
  const handle = await fsp.open(zipPath, 'r');
  try {
    const { size } = await handle.stat();
    const tailStart = Math.max(0, size - 65_536);
    const tail = Buffer.alloc(size - tailStart);
    await handle.read(tail, 0, tail.length, tailStart);
    const eocd = findEndOfCentralDirectory(tail, tailStart);
    const directory = Buffer.alloc(eocd.size);
    await handle.read(directory, 0, eocd.size, eocd.offset);
    const entry = findCentralEntry(directory, name);
    if (!entry) return null;
    // The local header repeats the name and extra fields, and its lengths are
    // the authoritative ones — several writers pad the local extra differently
    // from the central one, and trusting the central lengths lands mid-payload.
    const header = Buffer.alloc(30);
    await handle.read(header, 0, 30, entry.localOffset);
    const start = entry.localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
    return { start, compressedSize: entry.compressedSize, method: entry.method };
  } finally {
    await handle.close();
  }
}

/**
 * Stream one CSV out of the archive, emitting a row at a time.
 *
 * STREAMED, never expanded: `carreaux_200m_met.csv` is 467 MB flat and the
 * three together are 473 MB. Writing them to disk to read them once is half a
 * gigabyte of I/O for nothing, and on the staging volume it was half a
 * gigabyte that stayed.
 *
 * @param {string} zipPath
 * @param {{start:number, compressedSize:number, method:number}} member
 * @param {(row: Object<string,string>) => void} onRow
 * @returns {Promise<number>} Rows read.
 */
async function streamCsv(zipPath, member, onRow) {
  const raw = fs.createReadStream(zipPath, {
    start: member.start,
    end: member.start + member.compressedSize - 1,
  });
  if (member.method !== 0 && member.method !== 8) {
    throw new Error(`unsupported compression method ${member.method}`);
  }
  const stream = member.method === 8 ? raw.pipe(zlib.createInflateRaw()) : raw;
  stream.setEncoding('utf8');
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let header = null;
  let count = 0;
  for await (const line of lines) {
    if (!line) continue;
    const parts = splitCsvLine(line);
    if (!header) { header = parts; continue; }
    const row = {};
    for (let i = 0; i < header.length; i += 1) row[header[i]] = parts[i];
    onRow(row);
    count += 1;
    if (count % 500_000 === 0) {
      process.stderr.write(`    ${count.toLocaleString('en-US')} rows…\n`);
    }
  }
  return count;
}

/**
 * The WGS84 box a shard covers, from its own cells.
 *
 * Stored in the index so the PROXY never has to project anything: it has a
 * viewport in degrees and needs the files that touch it, and the alternative
 * was carrying a forward LAEA projection into a second module to answer a
 * question the builder can answer once. The margin is one cell, because a
 * centre is not a corner.
 *
 * @param {Array<object>} cells
 * @param {number} resolution
 * @returns {{south:number, west:number, north:number, east:number}}
 */
export function shardBounds(cells, resolution) {
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const cell of cells) {
    const [lon, lat] = cellCentre({
      res: resolution, n: cell.n, e: cell.e, crs: cell.crs ?? 3035,
    });
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    if (lon < west) west = lon;
    if (lon > east) east = lon;
  }
  // One cell of margin, in degrees. Latitude is 111 km per degree everywhere;
  // longitude is that times the cosine, and over France the widening never
  // exceeds 1.6.
  const marginLat = resolution / 111_000;
  const marginLon = marginLat * 1.6;
  return {
    south: Number((south - marginLat).toFixed(5)),
    west: Number((west - marginLon).toFixed(5)),
    north: Number((north + marginLat).toFixed(5)),
    east: Number((east + marginLon).toFixed(5)),
  };
}

async function writeShards(packDir, resolution, shards) {
  const dir = path.join(packDir, `r${resolution}`);
  await fsp.mkdir(dir, { recursive: true });
  let bytes = 0;
  const bounds = {};
  for (const [key, cells] of shards) {
    const body = zlib.gzipSync(JSON.stringify(cells), { level: 9 });
    await fsp.writeFile(packShardPath(packDir, resolution, key), body);
    bytes += body.length;
    bounds[key] = { ...shardBounds(cells, Number(resolution)), cells: cells.length };
  }
  return { bytes, bounds };
}

/**
 * Read one INSEE archive and write a complete pack.
 *
 * Split out of the CLI so it can be tested against a hand-built ZIP of three
 * rows instead of a 91 MB download — the reader has to survive stored members
 * as well as deflated ones, a member INSEE stops shipping, and three grids
 * landing in three shards, and none of that needs the real file.
 *
 * @param {string} zipPath
 * @param {string} packDir
 * @returns {Promise<object>} The index it wrote.
 */
export async function buildPackFromArchive(zipPath, packDir) {
  const MEMBERS = ['carreaux_200m_met.csv', 'carreaux_200m_mart.csv', 'carreaux_200m_reun.csv'];

  /** @type {Map<string, Array<object>>} */
  const fine = new Map();
  /** @type {Map<string, object>} */
  const coarseCells = new Map();
  const communes = new Set();
  /** Rows this pack cannot express, by the projection they are published in. */
  const skippedByCrs = new Map();
  let rows = 0;
  let multiCommune = 0;

  for (const name of MEMBERS) {
    const member = await locateMember(zipPath, name);
    if (!member) {
      // A member INSEE stopped shipping is a change in the source, not a file
      // to skip quietly: the totals would come out short and look like data.
      throw new Error(`${name} is not in ${path.basename(zipPath)}`);
    }
    process.stderr.write(`  ${name}\n`);
    rows += await streamCsv(zipPath, member, (row) => {
      const parsed = parseIdcar(row.idcar_200m);
      if (parsed && !PACK_CRS.includes(parsed.crs)) {
        skippedByCrs.set(parsed.crs, (skippedByCrs.get(parsed.crs) || 0) + 1);
        return;
      }
      const cell = cellFromRow(row);
      if (!cell) return;
      if (cell.com) communes.add(cell.com);
      else if (row.lcog_geo) multiCommune += 1;
      const key = shardKey(cell.crs, cell.n, cell.e);
      if (!fine.has(key)) fine.set(key, []);
      fine.get(key).push(cell);
      accumulateKm(coarseCells, row);
    });
  }

  /** @type {Map<string, Array<object>>} */
  const coarse = new Map();
  for (const cell of coarseCells.values()) {
    const wire = coarseCellToWire(cell);
    const key = shardKey(wire.crs, wire.n, wire.e);
    if (!coarse.has(key)) coarse.set(key, []);
    coarse.get(key).push(wire);
  }

  await fsp.mkdir(packDir, { recursive: true });
  process.stderr.write('  writing shards…\n');
  const fineWritten = await writeShards(packDir, '200', fine);
  const coarseWritten = await writeShards(packDir, '1000', coarse);
  const fineBytes = fineWritten.bytes;
  const coarseBytes = coarseWritten.bytes;

  const index = {
    vintage: PACK_VINTAGE,
    builtAt: new Date().toISOString(),
    source: { page: SOURCE_PAGE, file: SOURCE_ZIP, members: MEMBERS },
    shardMetres: SHARD_M,
    rows,
    cells: { 200: [...fine.values()].reduce((s, a) => s + a.length, 0), 1000: coarseCells.size },
    shards: { 200: fine.size, 1000: coarse.size },
    // Per-shard WGS84 boxes, so the proxy picks files by viewport without
    // projecting anything itself.
    bounds: { 200: fineWritten.bounds, 1000: coarseWritten.bounds },
    bytes: { 200: fineBytes, 1000: coarseBytes },
    // Communes are named by CODE only. The CSV carries `lcog_geo` and no name,
    // and inventing one from another file would be a second source with its own
    // millésime hiding inside this one.
    communes: communes.size,
    // Cells INSEE lists against several communes at once. The wire shape carries
    // one code, so these carry none — counted here rather than resolved by
    // picking a winner the publisher declined to pick.
    multiCommune,
    // What this pack CANNOT hold, by projection. Martinique (CRS5490) and La
    // Réunion (CRS2975) are published in their own UTM zones and the layer
    // inverts EPSG:3035 only, so the proxy must keep serving those two from the
    // Géoplateforme relay — which reprojects them — and say which millésime
    // each territory is on.
    skipped: Object.fromEntries([...skippedByCrs].map(([crs, count]) => [`CRS${crs}`, count])),
    // A digest of what went in, so a half-written pack after a crash is visible
    // rather than served as if it were complete.
    digest: createHash('sha1')
      .update(`${rows}:${fine.size}:${coarse.size}`).digest('hex').slice(0, 12),
  };
  await fsp.writeFile(packIndexPath(packDir), `${JSON.stringify(index, null, 1)}\n`);
  return index;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--check')) {
    try {
      const index = JSON.parse(await fsp.readFile(INDEX_FILE, 'utf8'));
      const fine = index.cells[200].toLocaleString('en-US');
      const coarse = index.cells[1000].toLocaleString('en-US');
      process.stdout.write(`pack millésime ${index.vintage}: ${fine} carreaux 200 m,`
        + ` ${coarse} à 1 km, ${index.shards[200]} + ${index.shards[1000]} shards,`
        + ` built ${index.builtAt}\n`);
    } catch {
      process.stdout.write('no pack on disk — the proxy serves'
        + ' the Géoplateforme relay (2019)\n');
      process.exitCode = 1;
    }
    return;
  }

  const fromIndex = argv.indexOf('--from');
  const localZip = fromIndex >= 0 && argv[fromIndex + 1] ? path.resolve(argv[fromIndex + 1]) : null;
  // A temp directory OUTSIDE the cache volume, removed whatever happens.
  const workDir = localZip ? null : await fsp.mkdtemp(path.join(os.tmpdir(), 'filosofi-2021-'));
  const zipPath = localZip || await downloadArchive(workDir);

  const MEMBERS = ['carreaux_200m_met.csv', 'carreaux_200m_mart.csv', 'carreaux_200m_reun.csv'];
  try {
    const index = await buildPackFromArchive(zipPath, PACK_DIR);
    const fineBytes = index.bytes[200];
    const coarseBytes = index.bytes[1000];

    process.stdout.write(`${index.cells[200].toLocaleString('en-US')} carreaux de 200 m`
      + ` in ${index.shards[200]} shards (${(fineBytes / 1e6).toFixed(1)} MB gz)\n`);
    process.stdout.write(`${index.cells[1000].toLocaleString('en-US')} carreaux de 1 km`
      + ` in ${index.shards[1000]} shards (${(coarseBytes / 1e6).toFixed(1)} MB gz)\n`);
    process.stdout.write(`${index.communes.toLocaleString('en-US')} communes`
      + ` (${index.multiCommune.toLocaleString('en-US')} carreaux à cheval, sans code)`
      + ` · millésime ${index.vintage}\n`);
    for (const [crs, count] of Object.entries(index.skipped)) {
      process.stdout.write(`${count.toLocaleString('en-US')} carreaux en ${crs}`
        + ' laissés au relais WFS — projection non inversée par le calque\n');
    }
  } finally {

    // A build that threw must not leave 91 MB behind — least of all on the
    // staging volume this pack has to fit in.
    if (workDir) await fsp.rm(workDir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
