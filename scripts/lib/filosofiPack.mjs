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
 * The projections the pack can express — all three INSEE publishes on.
 *
 * INSEE grids each territory in its own zone rather than reprojecting them:
 * métropole in EPSG:3035 (LAEA Europe), Martinique in 5490 (UTM 20 N), La
 * Réunion in 2975 (UTM 40 S). The app inverts all three, so the pack can hold
 * all three — but the GRID IS PART OF A CELL'S IDENTITY, because two cells in
 * two territories can carry the same northing and easting and mean different
 * places. It is therefore part of the shard key.
 */
export const PACK_CRS = Object.freeze([3035, 5490, 2975]);

/** Where the pack has cells. One box per grid, matching the layer's coverage. */
export const PACK_BOXES = Object.freeze([
  Object.freeze({ south: 41.2, west: -5.3, north: 51.2, east: 9.7 }), // métropole + Corse
  Object.freeze({ south: 14.3, west: -61.3, north: 15.0, east: -60.7 }), // Martinique
  Object.freeze({ south: -21.5, west: 55.1, north: -20.8, east: 55.9 }), // La Réunion
]);

/** @param {number} crs @param {number} n @param {number} e @returns {string} */
export function shardKey(crs, n, e) {
  return `${crs}-${Math.floor(n / SHARD_M)}_${Math.floor(e / SHARD_M)}`;
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
 *
 * INSIDE one of the boxes, not merely touching it: a viewport straddling the
 * edge of a territory would be answered from the pack for the half that is
 * packed and silently short the other half. A straddling box goes to the relay,
 * which has every territory in one grid.
 *
 * @param {{south:number, west:number, north:number, east:number}} box
 * @returns {boolean}
 */
export function packCovers(box) {
  if (!box) return false;
  return PACK_BOXES.some((area) => box.south >= area.south && box.north <= area.north
    && box.west >= area.west && box.east <= area.east);
}
