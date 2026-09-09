#!/usr/bin/env node
/**
 * perf-entity-weight — what one drawn feature of a bundled pack actually costs.
 *
 * `PLAN-PERFORMANCE.md` § 3.1 first concluded that the 28–36 KiB a feature
 * retains "is the `Entity` + `Property` machinery itself, and only the
 * migration to primitives removes it". The first half is right; the second was
 * a conclusion rather than a measurement, and it sent the plan at the most
 * expensive fix available. This bench is what said otherwise: it builds the
 * object graph a pack ends up with, then re-weighs it with one layer removed at
 * a time, so the cost can be attributed to a PART instead of to a category.
 *
 * ── WHY IT RUNS IN NODE AND NOT IN THE BROWSER ──────────────────────────────
 *
 * `perf-infra-lod.mjs` reads the whole scene's retained heap through CDP, which
 * is the number that matters and the number that cannot be decomposed: it moves
 * with Cesium's tile cache, with the imagery, and with whatever the boot
 * reading happened to catch. Here nothing is rendered — the entity graph is
 * assembled directly, with the same graphics the loader assigns — so
 * `heapUsed` around two forced collections IS the cost of that graph and
 * nothing else. The two benches answer different questions and both are needed:
 * this one says WHAT to remove, the other says whether removing it worked.
 *
 * `GeoJsonDataSource` itself cannot run here (its pin builder needs a real 2-D
 * canvas), which is why the entity is built by hand. The shapes are the ones
 * `localGeojson.js` assigns; if that loop changes, this file changes with it.
 *
 * Usage:
 *   node --expose-gc scripts/perf-entity-weight.mjs
 *   node --expose-gc scripts/perf-entity-weight.mjs --pack dams --count 3000
 */
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';

if (typeof globalThis.gc !== 'function') {
  console.error('Run with --expose-gc: node --expose-gc scripts/perf-entity-weight.mjs');
  process.exit(2);
}

// Cesium types a material uniform by testing it against the DOM image classes
// (`Material.js`, `uniformValue instanceof HTMLCanvasElement`), and under Node
// those identifiers do not exist. Nothing here is ever an instance of them, so
// declaring the names lets the chain fall through to the object branch the
// colour uniform belongs in. Same shim as the unit tests use.
for (const name of ['HTMLCanvasElement', 'HTMLImageElement', 'ImageBitmap', 'OffscreenCanvas']) {
  if (!(name in globalThis)) globalThis[name] = class {};
}

const argv = process.argv;
const arg = (flag, fallback) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : fallback);
const pack = arg('--pack', 'airports');
const count = Number(arg('--count', 3000));
const color = Cesium.Color.fromCssColorString('#7dd3fc');

const path = new URL(`../src/data/local_data/${pack}/${pack}.geojsonl`, import.meta.url);
const features = readFileSync(path, 'utf8')
  .split('\n')
  .filter((line) => line.trim().length > 0)
  .slice(0, count)
  .map((line) => JSON.parse(line));

if (!features.length) {
  console.error(`No features read from ${path.pathname}`);
  process.exit(2);
}

/**
 * Weigh one build.
 *
 * TWO collections on each side, not one: the first sweeps what the previous
 * build left behind, the second sweeps what building this one allocated and
 * dropped. With a single call the reading drifts by tens of bytes per feature
 * in whichever direction the allocator happened to be leaning.
 * @param {string} label
 * @param {() => unknown} build Returns everything the build must retain.
 * @returns {number} Bytes per feature.
 */
function weigh(label, build) {
  globalThis.gc(); globalThis.gc();
  const before = process.memoryUsage().heapUsed;
  const keep = build();
  globalThis.gc(); globalThis.gc();
  const after = process.memoryUsage().heapUsed;
  const perFeature = Math.round((after - before) / features.length);
  console.log(`  ${label.padEnd(52)}${String(perFeature).padStart(7)} B/feature`);
  // Returned so the caller's reference keeps it alive across the second read;
  // dropped here so the next build starts from a swept heap.
  void keep;
  return perFeature;
}

/** The anchor, the stem base and the tip, exactly as the loader derives them. */
function geometry(feature) {
  const geom = feature.geometry || {};
  const [lon, lat] = geom.type === 'Point'
    ? geom.coordinates
    : (geom.coordinates?.[0]?.[0] || [0, 0]);
  return {
    base: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
    tip: Cesium.Cartesian3.fromDegrees(lon, lat, 2000),
    carto: Cesium.Cartographic.fromDegrees(lon, lat, 0),
  };
}

const point = () => new Cesium.PointGraphics({
  pixelSize: 10, color, outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
  disableDepthTestDistance: Number.POSITIVE_INFINITY,
});

console.log(`\nperf-entity-weight — ${pack}, ${features.length} real features, Node ${process.versions.node}\n`);

weigh('the parsed features alone (already in memory)', () => features.slice());
const bare = weigh('A. bare Entity, no graphics, no properties', () => features.map((f, i) => (
  new Cesium.Entity({ id: String(f.id ?? i) })
)));
const withBag = weigh('B. Entity + the PropertyBag GeoJSON builds', () => features.map((f, i) => (
  new Cesium.Entity({ id: String(f.id ?? i), properties: f.properties })
)));
const withPoint = weigh('C. Entity + position + point, no properties', () => features.map((f, i) => (
  new Cesium.Entity({ id: String(f.id ?? i), position: geometry(f).tip, point: point() })
)));
const shipped = weigh('D. the feature as localGeojson used to build it', () => features.map((f, i) => {
  const g = geometry(f);
  return new Cesium.Entity({
    id: String(f.id ?? i),
    properties: f.properties,
    position: g.tip,
    point: point(),
    polyline: new Cesium.PolylineGraphics({
      positions: [g.base, g.tip], width: 3.5,
      material: new Cesium.ColorMaterialProperty(color),
    }),
  });
}));
const noBag = weigh('E. …minus the duplicate PropertyBag', () => features.map((f, i) => {
  const g = geometry(f);
  return new Cesium.Entity({
    id: String(f.id ?? i),
    position: g.tip,
    point: point(),
    polyline: new Cesium.PolylineGraphics({
      positions: [g.base, g.tip], width: 3.5,
      material: new Cesium.ColorMaterialProperty(color),
    }),
  });
}));
const shippedNow = weigh('F. …and minus the per-entity stem (pooled) — SHIPPED', () => features.map((f, i) => {
  const entity = new Cesium.Entity({
    id: String(f.id ?? i), position: geometry(f).tip, point: point(),
  });
  // The plain properties the card, the label and the voice scan read. The same
  // object the context record holds, so it is a reference and not a copy — but
  // it has to be weighed, or the saving above would be reported net of nothing.
  return { entity, properties: { ...f.properties } };
}));
const primitives = weigh('G. the primitive path (PointPrimitive + record)', () => {
  const points = new Cesium.PointPrimitiveCollection();
  return features.map((f, i) => {
    const g = geometry(f);
    return {
      point: points.add({
        position: g.tip, pixelSize: 10, color, outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY, show: false,
      }),
      id: String(f.id ?? i), carto: g.carto, base: g.base, tip: g.tip,
      properties: { ...f.properties },
      collection: points,
    };
  });
});

// Every share is read against D, the feature as it used to be built: that is
// the number the plan set its target on, and quoting a saving against anything
// else would flatter it.
const share = (value) => `${Math.round((value / shipped) * 100)} %`;
console.log('');
console.log(`  the PropertyBag on its own (B−A)  ${String(withBag - bare).padStart(7)} B  = ${share(withBag - bare)} of a drawn feature`);
console.log(`  the position + point (C−A)        ${String(withPoint - bare).padStart(7)} B  = ${share(withPoint - bare)}`);
console.log(`  the stem alone (D−B−(C−A))        ${String(shipped - withBag - (withPoint - bare)).padStart(7)} B  = ${share(shipped - withBag - (withPoint - bare))}`);
console.log('');
console.log(`  SHIPPED: dropping the bag         ${String(shipped - noBag).padStart(7)} B  = ${share(shipped - noBag)}`);
console.log(`  SHIPPED: + pooling the stem       ${String(shipped - shippedNow).padStart(7)} B  = ${share(shipped - shippedNow)} (D → F)`);
console.log(`  STILL OPEN: F → the primitives    ${String(shippedNow - primitives).padStart(7)} B  = ${share(shippedNow - primitives)} more of D`);
console.log('');
