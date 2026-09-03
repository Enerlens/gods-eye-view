import path from 'node:path';

/**
 * The on-disk contract for the local carroyage pack, in one place.
 *
 * WHY THIS FILE IS SEPARATE FROM THE SCRIPT THAT WRITES IT. Two programs have
 * to agree about this layout — `scripts/build-filosofi-2021-pack.mjs`, which
 * writes it, and the Vite proxy, which reads it — and the script carries a
 * `#!/usr/bin/env node` shebang that esbuild refuses to bundle. Importing the
 * script from the config was a build failure, not a style problem.
 *
 * AND IT LIVES UNDER `scripts/`, not `src/`, because it imports `node:path`.
 * Everything in `src/` is bundled for the browser and a boundary test refuses a
 * Node core import there — correctly: this module is read by the proxy and by a
 * build script, and never by a page.
 *
 * WHAT THE PACK IS FOR. INSEE published the 2021 carroyage on 2026-02-12; the
 * Géoplateforme WFS the app relays is still on 2019 (measured 2026-09-03 by cell
 * count: 2 314 836 served, against 2 313 783 documented for 2019 and 2 324 577
 * for 2021). The pack is how a deployment can draw the newer millésime without
 * waiting for the relay — and it is OPTIONAL. A clone with no pack draws 2019
 * and says 2019, because the vintage travels with every answer instead of being
 * a constant the client assumes.
 *
 * @module scripts/lib/filosofiPack
 */

/** The millésime the current pack builder produces. */
export const PACK_VINTAGE = 2021;

/**
 * Shard side, in metres of EPSG:3035.
 *
 * 50 000 m is a whole number of cells at BOTH resolutions — 250 of 200 m and 50
 * of 1 km — so a shard key is exact integer arithmetic on either grid rather
 * than a rounding. (51 200 was tried first, for being 256 fine cells; it is
 * 51.2 coarse ones, and a constant that divides one grid and not the other is a
 * trap left for whoever adds the third.) It puts roughly 5 000 inhabited cells
 * in a shard over a city and a handful over the Massif Central, so a city
 * viewport reads two or three files and a rural one reads a nearly empty one.
 */
export const SHARD_M = 50_000;

/**
 * The projection the pack can express, and the only one this app inverts.
 *
 * INSEE publishes Martinique in CRS5490 and La Réunion in CRS2975 — their own
 * UTM zones — so those two territories cannot be packed and stay on the WFS,
 * which reprojects them. That means one layer can be on two millésimes at once,
 * which is why the answer carries its vintage per box rather than per layer.
 */
export const PACK_CRS = 3035;

/** Métropole and Corsica — the extent the pack covers. */
export const PACK_BOX = Object.freeze({ south: 41.2, west: -5.3, north: 51.2, east: 9.7 });

/** @param {number} n @param {number} e @returns {string} */
export function shardKey(n, e) {
  return `${Math.floor(n / SHARD_M)}_${Math.floor(e / SHARD_M)}`;
}

/**
 * Every shard key a WGS84 box can touch, given the index's own per-shard boxes.
 *
 * The index carries a box per shard so that nothing here has to project
 * anything: the proxy has degrees and needs files, and a forward LAEA
 * projection in a second module is a second place to get it wrong.
 *
 * @param {Object<string, {south:number, west:number, north:number, east:number}>} bounds
 * @param {{south:number, west:number, north:number, east:number}} box
 * @returns {string[]}
 */
export function shardsForBox(bounds, box) {
  const keys = [];
  for (const [key, area] of Object.entries(bounds || {})) {
    if (area.south > box.north || area.north < box.south) continue;
    if (area.west > box.east || area.east < box.west) continue;
    keys.push(key);
  }
  return keys;
}

/** @param {string} packDir @param {number|string} resolution @param {string} key @returns {string} */
export function shardPath(packDir, resolution, key) {
  return path.join(packDir, `r${resolution}`, `${key}.json.gz`);
}

/** @param {string} packDir @returns {string} */
export function packIndexPath(packDir) {
  return path.join(packDir, 'index.json');
}

/**
 * Whether the pack can answer for a box at all.
 * @param {{south:number, west:number, north:number, east:number}} box
 * @returns {boolean}
 */
export function packCovers(box) {
  return Boolean(box) && box.south >= PACK_BOX.south && box.north <= PACK_BOX.north
    && box.west >= PACK_BOX.west && box.east <= PACK_BOX.east;
}
