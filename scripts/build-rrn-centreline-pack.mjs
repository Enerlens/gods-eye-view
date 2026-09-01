#!/usr/bin/env node
/**
 * Build `config/rrn_centreline.json` — the national road network addressed the
 * way a road operator addresses it, so a live event can be drawn on the tarmac
 * instead of across the fields beside it.
 *
 * ── THE PROBLEM THIS EXISTS FOR ─────────────────────────────────────────────
 *
 * Bison Futé publishes each road event's location twice. Once as two TPEG
 * coordinates — the two ENDS, and nothing between them — which is what the
 * layer has always drawn: a straight chord. And once as a pair of POINT-REPÈRE
 * addresses on a named route:
 *
 *     <linearElement><roadNumber>N0126</roadNumber></linearElement>
 *     <fromPoint>  81PR47U + 394 m
 *     <toPoint>    81PR5U  +   0 m
 *
 * The second is a real linear reference and the app was throwing it away. The
 * cost, measured over the live feed on 2026-09-01: across the 183 events this
 * pack can shape, the chord strays from the surveyed carriageway by a median
 * 107 m, a p90 of 648 m, and a maximum of 4 749 m. That maximum is the N126
 * roadworks near Castres — 37 km of chord drawn across open country for a
 * 40 km stretch of road.
 *
 * ── WHY A COMMITTED PACK AND NOT A LOOKUP ───────────────────────────────────
 *
 * The join needs two national referentials that are 23 MB of shapefile and CSV
 * between them, and it needs them on every serve. `config/datex_traficolor_sites.json`
 * already established the pattern for the sibling road-status layer: resolve at
 * BUILD time, commit the answer, read it once per process. This is the same
 * arrangement, generalised — that file holds 608 fixed sensor sites, this one
 * holds the network itself, because a live event can be anywhere on it.
 *
 * ── WHAT IS IN IT, AND WHAT IT COSTS ────────────────────────────────────────
 *
 *   `posts` — "ROUTE|dep|pr|side" → cumulative distance in metres. 51 834 keys.
 *             This is the field `locateBorne()` computes and throws away, and
 *             it is the entire join key: a PR address plus its abscissa is a
 *             cumul, and a cumul indexes the polyline.
 *   `lines` — "ROUTE|side" → sections [fromCumul, toCumul, coords], Lambert-93
 *             integer metres, delta-coded, simplified at CENTRELINE_SIMPLIFY_M.
 *
 * Measured at the shipped 4 m tolerance: 167 110 vertices, ~3.2 MB minified,
 * ~1.0 MB gzipped, 9 ms to `JSON.parse`. Coarsening to 25 m saves only 0.5 MB
 * because the post table then dominates, so 4 m is the right trade.
 *
 * WRITTEN MINIFIED, DELIBERATELY. `build-datex-traficolor-sites.mjs` writes its
 * output with `JSON.stringify(payload, null, 2)`, which inflates a
 * numeric-array payload by 2.31× — that file is 496 KB on disk for 250 KB of
 * data. At this size that would be 7.3 MB instead of 3.2 MB, so this script
 * refuses to pretty-print.
 *
 * ── DETERMINISM ─────────────────────────────────────────────────────────────
 *
 * Both source editions are PINNED (see `rrnBornage.mjs` / `rrnCentreline.mjs`).
 * Keys are emitted in sorted order and coordinates are rounded to whole metres
 * before delta-coding, so two runs on any machine produce the same bytes and a
 * diff shows what the referential actually changed.
 *
 * A PINNED EDITION IS ALSO THE ONE REAL RISK. The pack is a snapshot of a
 * numbering scheme while the DATEX feed is live: if a later edition renumbers a
 * PR, cumul moves under the pack while the feed keeps sending addresses in the
 * new numbering, and the two drift apart silently. `--verify` re-resolves a
 * captured DATEX snapshot against the freshly built pack and fails the build if
 * the resolve rate drops, which is the cheap guard against exactly that.
 *
 * Usage:
 *   node scripts/build-rrn-centreline-pack.mjs
 *   node scripts/build-rrn-centreline-pack.mjs --tolerance=25
 *   node scripts/build-rrn-centreline-pack.mjs --refresh   # re-download sources
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import {
  BORNAGE_CSV_URL,
  BORNAGE_EDITION,
  BORNAGE_LICENCE,
  buildBornageIndex,
  parseBornage,
} from './lib/rrnBornage.mjs';
import {
  CENTRELINE_EDITION,
  CENTRELINE_LICENCE,
  CENTRELINE_MEMBERS,
  CENTRELINE_SIMPLIFY_M,
  CENTRELINE_ZIP_URL,
  buildCentrelineIndex,
  simplifyPolyline,
} from './lib/rrnCentreline.mjs';
import { readZipMember } from './lib/remoteZip.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_PATH = path.join(ROOT, 'config', 'rrn_centreline.json');
const BORNAGE_CACHE_PATH = path.join(ROOT, '.gev-cache', 'bornage', 'bornes.csv');
const CENTRELINE_CACHE_PATH = path.join(ROOT, '.gev-cache', 'bornage', 'rrn-liaisons.zip');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const TOLERANCE_M = Number(option('tolerance', CENTRELINE_SIMPLIFY_M));

async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBinary(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

/** Read a cached source, or download and cache it. */
async function cached(cachePath, label, download, { binary = false } = {}) {
  if (!flag('refresh')) {
    const hit = binary
      ? await fsp.readFile(cachePath).catch(() => null)
      : await fsp.readFile(cachePath, 'utf8').catch(() => null);
    if (hit) {
      console.log(`${label}: reusing ${path.relative(ROOT, cachePath)} (${(hit.length / 1048576).toFixed(1)} MB)`);
      return hit;
    }
  }
  console.log(`${label}: downloading…`);
  const body = await download();
  await fsp.mkdir(path.dirname(cachePath), { recursive: true });
  await fsp.writeFile(cachePath, body);
  return body;
}

/**
 * Delta-code a flat `[x, y, …]` list of Lambert-93 metres.
 *
 * Whole metres, then first-differences. The survey's own vertex spacing is
 * ~26 m and the product is accurate to far worse than a metre, so rounding
 * costs nothing real; the differences are then small integers that JSON
 * serialises in two or three characters instead of eight.
 * @param {Array<number>} flat
 * @returns {Array<number>}
 */
function deltaCode(flat) {
  const out = new Array(flat.length);
  let px = 0;
  let py = 0;
  for (let i = 0; i < flat.length; i += 2) {
    const x = Math.round(flat[i]);
    const y = Math.round(flat[i + 1]);
    out[i] = x - px;
    out[i + 1] = y - py;
    px = x;
    py = y;
  }
  return out;
}

async function main() {
  console.log(`bornage edition ${BORNAGE_EDITION} · centreline edition ${CENTRELINE_EDITION}`);

  const csv = await cached(
    BORNAGE_CACHE_PATH,
    'bornage',
    () => fetchText(BORNAGE_CSV_URL, 180000),
  );
  const parsed = parseBornage(csv);
  if (!parsed.bornes.length) throw new Error('bornage parsed to nothing');
  console.log(`  ${parsed.bornes.length} kilometre posts${parsed.skipped ? `, ${parsed.skipped} rows skipped` : ''}`);
  const bornage = buildBornageIndex(parsed.bornes);

  const archive = await cached(
    CENTRELINE_CACHE_PATH,
    'centreline',
    () => fetchBinary(CENTRELINE_ZIP_URL, 600000),
    { binary: true },
  );
  const shp = readZipMember(archive, CENTRELINE_MEMBERS.shp);
  const dbf = readZipMember(archive, CENTRELINE_MEMBERS.dbf);
  if (!shp || !dbf) throw new Error(`${CENTRELINE_MEMBERS.shp}/${CENTRELINE_MEMBERS.dbf} absent from the archive`);
  const centreline = buildCentrelineIndex({ shp, dbf }, bornage);
  if (!centreline.joined) throw new Error('no section joined to a kilometre post');
  console.log(
    `  ${centreline.joined} of ${centreline.sections} sections on ${centreline.lines.size} carriageways`
    + ` (${centreline.rejected.notNumbered} unnumbered, ${centreline.rejected.postUnknown} naming an unknown post)`,
  );

  // ── posts: the cumul table the join turns on ──────────────────────────────
  const posts = {};
  for (const [key, borne] of [...bornage.exact].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    posts[key] = Math.round(borne.cumul);
  }

  // ── lines: the carriageways, simplified and delta-coded ───────────────────
  const lines = {};
  let vertices = 0;
  let rawVertices = 0;
  for (const key of [...centreline.lines.keys()].sort()) {
    const sections = centreline.lines.get(key);
    const out = [];
    for (const section of sections) {
      rawVertices += section.points.length / 2;
      const simplified = simplifyPolyline(section.points, TOLERANCE_M);
      if (simplified.length < 4) continue;
      vertices += simplified.length / 2;
      out.push([Math.round(section.from), Math.round(section.to), deltaCode(simplified)]);
    }
    if (out.length) lines[key] = out;
  }

  const pack = {
    // Provenance travels with the data: Licence Ouverte 2.0 obliges naming the
    // source and its update date wherever the derived product is used.
    source: 'DGITM / Cerema — bornage du RRN + liaisons du réseau routier national',
    licence: `${BORNAGE_LICENCE} / ${CENTRELINE_LICENCE}`,
    bornageEdition: BORNAGE_EDITION,
    centrelineEdition: CENTRELINE_EDITION,
    projection: 'EPSG:2154',
    encoding: 'delta-coded integer metres',
    toleranceM: TOLERANCE_M,
    stats: {
      posts: Object.keys(posts).length,
      carriageways: Object.keys(lines).length,
      sections: centreline.joined,
      vertices,
      rawVertices,
    },
    posts,
    lines,
  };

  // MINIFIED. See the header: pretty-printing a numeric-array payload costs
  // 2.31× for nothing a generated file needs.
  const json = JSON.stringify(pack);
  await fsp.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fsp.writeFile(OUT_PATH, `${json}\n`, 'utf8');

  const gz = zlib.gzipSync(Buffer.from(json), { level: 9 }).length;
  console.log(
    `\nwrote ${path.relative(ROOT, OUT_PATH)}`
    + ` — ${(json.length / 1048576).toFixed(2)} MB (${(gz / 1048576).toFixed(2)} MB gzip)`
    + `, ${pack.stats.posts} posts, ${pack.stats.carriageways} carriageways,`
    + ` ${vertices} of ${rawVertices} vertices at ${TOLERANCE_M} m`,
  );
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
