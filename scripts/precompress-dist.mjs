#!/usr/bin/env node
/**
 * build (second half) — write a brotli `.br` next to every asset the preview
 * server is allowed to serve pre-compressed.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * A hosted GEV runs `vite preview`, which compresses on the fly, in gzip, at
 * whatever level it can afford per request. Nothing about the built bundle
 * changes between requests, so that per-request budget is the only reason the
 * bytes are not smaller. Measured on this tree, 2026-09-09:
 *
 *   cesium-1.138.0/Cesium.js   5 593 kB raw   1 651 kB gzip   1 282 kB br-11
 *   assets/index-*.js          1 108 kB raw     326 kB gzip     266 kB br-11
 *
 * — about 430 kB off the two scripts a cold boot cannot avoid, for compression
 * we pay for once, here, instead of on every visit.
 *
 * The edge cannot buy this back: Cloudflare passes an origin's gzip through
 * rather than re-encoding it, so the origin sends brotli or nobody does.
 *
 * ── WHAT IT DOES ────────────────────────────────────────────────────────────
 *
 * Walks `dist/`, and for every file that `precompressibleAsset` (vite.config.js)
 * says the middleware would serve — content-addressed URL, known extension,
 * over 1 kB — writes `<file>.br` at brotli quality 11.
 *
 * Two properties make that affordable in a Docker build as well as locally:
 *
 *   - **A content-addressed cache.** Compressed bodies are memoised in
 *     `node_modules/.cache/gev-precompress/<sha256>.br`, so the 170 Cesium
 *     files — identical until the engine is upgraded — are compressed on the
 *     first build of a checkout and copied on every one after.
 *   - **Concurrency.** `brotliCompress` releases the event loop onto libuv's
 *     thread pool, so the files run several at a time rather than in series.
 *
 * A failure here is a warning, never a broken build: without `.br` files the
 * middleware falls through and vite gzips as before.
 *
 * Usage: node scripts/precompress-dist.mjs [--dist <dir>] [--quiet]
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import { PRECOMPRESS_MIN_BYTES, precompressibleAsset } from '../vite.config.js';

const brotli = promisify(zlib.brotliCompress);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = path.join(REPO_ROOT, 'node_modules', '.cache', 'gev-precompress');

/**
 * Maximum quality, always.
 *
 * The build pays this once per distinct file; the visitor pays the difference
 * on every cold load. Measured on the 1.1 MB entry chunk: q9 288 kB in 0.09 s,
 * q10 270 kB in 1.6 s, q11 266 kB in 4.1 s.
 */
const BROTLI_QUALITY = 11;

/**
 * Every file under `root`, as paths relative to it, in stable order.
 *
 * @param {string} root - Directory to walk.
 * @returns {string[]} Relative POSIX paths.
 */
export function walkFiles(root) {
  const out = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) out.push(path.relative(root, absolute).split(path.sep).join('/'));
    }
  };
  visit(root);
  return out;
}

/**
 * The files in a build output that are worth pre-compressing.
 *
 * Asks the delivery layer rather than re-deciding: a file this returns that the
 * middleware would not serve is wasted build time, and the reverse is a URL
 * that silently loses its brotli.
 *
 * @param {string} root - Build output directory.
 * @param {string[]} [relativePaths] - Defaults to walking `root`.
 * @returns {string[]} Relative paths to compress.
 */
export function selectPrecompressible(root, relativePaths = walkFiles(root)) {
  return relativePaths.filter((relative) => {
    if (!precompressibleAsset(`/${relative}`)) return false;
    let stat;
    try {
      stat = fs.statSync(path.join(root, relative));
    } catch {
      return false;
    }
    return stat.size >= PRECOMPRESS_MIN_BYTES;
  });
}

/** Compress one file, through the on-disk memo. @returns {Promise<number>} compressed bytes */
async function compressOne(root, relative) {
  const source = await fsp.readFile(path.join(root, relative));
  const key = createHash('sha256').update(source).digest('hex');
  const memo = path.join(CACHE_DIR, `${key}.br`);
  const target = `${path.join(root, relative)}.br`;
  let body;
  try {
    body = await fsp.readFile(memo);
  } catch {
    body = await brotli(source, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: source.length,
      },
    });
    await fsp.writeFile(memo, body).catch(() => {}); // A cold cache is slow, not wrong.
  }
  await fsp.writeFile(target, body);
  return body.length;
}

/**
 * Run `worker` over `items`, `limit` at a time.
 *
 * @template T
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<void>} worker
 */
async function pooled(items, limit, worker) {
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await worker(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}

async function main(argv = process.argv.slice(2)) {
  const distIndex = argv.indexOf('--dist');
  const root = path.resolve(REPO_ROOT, distIndex >= 0 ? argv[distIndex + 1] : 'dist');
  const quiet = argv.includes('--quiet');
  if (!fs.existsSync(root)) {
    console.warn(`[precompress] no build output at ${root} — nothing to do.`);
    return;
  }
  await fsp.mkdir(CACHE_DIR, { recursive: true });
  const files = selectPrecompressible(root);
  const started = Date.now();
  let before = 0;
  let after = 0;
  let failed = 0;
  await pooled(files, Math.max(2, os.availableParallelism?.() ?? os.cpus().length), async (relative) => {
    try {
      const size = fs.statSync(path.join(root, relative)).size;
      // Read the running totals AFTER the await, never as `total += await …`:
      // that form reads the old value before suspending, so concurrent workers
      // overwrite each other and the report under-counts.
      const compressed = await compressOne(root, relative);
      before += size;
      after += compressed;
    } catch (error) {
      failed += 1;
      console.warn(`[precompress] ${relative}: ${error?.message || error}`);
    }
  });
  if (!quiet) {
    const mb = (bytes) => `${(bytes / 1_048_576).toFixed(2)} Mo`;
    console.log(
      `[precompress] ${files.length - failed} fichiers — ${mb(before)} → ${mb(after)} en brotli-${BROTLI_QUALITY}`
      + ` (${(100 - (100 * after) / (before || 1)).toFixed(0)} %), ${((Date.now() - started) / 1000).toFixed(1)} s`
      + (failed ? `, ${failed} échec(s)` : ''),
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // Never fail the build over a missing optimisation: no `.br` means vite
    // gzips on the fly, exactly as it did before this script existed.
    console.warn(`[precompress] skipped: ${error?.message || error}`);
  });
}
