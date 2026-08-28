/**
 * Does OSM cover the ROUTES RTE published before it stopped?
 *
 * Raw length is the wrong metric: RTE publishes one record per tronçon and
 * lists co-located circuits in attributes, while OSM sometimes draws one way
 * per circuit and sometimes one way with `cables=6`. Comparing kilometres
 * would measure that modelling difference, not coverage.
 *
 * So this measures CORRIDOR COVERAGE instead, which is the question that
 * actually matters for a map: walk every RTE route at a fixed step, and ask
 * whether OSM has a high-voltage line within a tolerance of that point. The
 * answer is a fraction of RTE route-kilometres that OSM knows about, per
 * voltage band — robust to how either side chose to split its ways.
 */
import fs from 'node:fs';
import path from 'node:path';
import { overpass, franceTiles } from './fetch-osm.mjs';
import { readPolylineShp, readDbf, haversine, pathLength, parseVolts } from './lib.mjs';
import { ensureReference, REFERENCE, CACHE_DIR } from './reference.mjs';

await ensureReference();
const MIN_VOLTS = 50_000;
/** Step along an RTE route when sampling it for coverage. */
const SAMPLE_STEP_M = 200;
/** How far off a sample an OSM line may be and still count as the same corridor. */
const TOLERANCE_M = 150;
/** Densification step for OSM geometry, comfortably under the tolerance. */
const OSM_DENSIFY_M = 60;

const band = (volts) =>
  volts >= 300_000 ? '>= 300 kV' : volts >= 180_000 ? '180-299 kV' : volts >= 100_000 ? '100-179 kV' : '50-99 kV';
const BANDS = ['>= 300 kV', '180-299 kV', '100-179 kV', '50-99 kV'];

// ---------------------------------------------------------------------------
// Subject side — every OSM high-voltage line in France, uncapped
// ---------------------------------------------------------------------------
process.stderr.write('Fetching OSM lines (tiled, cached)\n');
const seen = new Set();
/** Flat cell index: "cx:cy" -> number[] of [lon, lat, lon, lat, ...] */
const CELL_DEG = 0.01;
const cells = new Map();
let osmWays = 0;
let osmLengthByBand = new Map();
let osmDenseCount = 0;

/** Add one densified point to the flat index. */
function indexPoint(lon, lat) {
  const key = `${Math.floor(lon / CELL_DEG)}:${Math.floor(lat / CELL_DEG)}`;
  let arr = cells.get(key);
  if (!arr) cells.set(key, (arr = []));
  arr.push(lon, lat);
  osmDenseCount += 1;
}

/** Walk a path, emitting a point at most every `step` metres. */
function densify(points, step, emit) {
  if (!points.length) return;
  emit(points[0][0], points[0][1]);
  let carry = 0;
  for (let i = 1; i < points.length; i += 1) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const seg = haversine(x0, y0, x1, y1);
    if (seg <= 0) continue;
    let travelled = step - carry;
    while (travelled < seg) {
      const t = travelled / seg;
      emit(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
      travelled += step;
    }
    carry = (carry + seg) % step;
    emit(x1, y1);
  }
}

/**
 * Fetch one tile, subdividing on failure.
 *
 * A fixed grid over France necessarily hangs off the edges — tile (-1.3, 41.2)
 * is mostly Spain, and Catalonia's mapped grid is dense enough that Overpass
 * answers 500 on it however many times it is asked. Splitting is the fix that
 * a longer timeout is not: four quarter-tiles each succeed where the whole
 * fails, and the union is identical because `out geom` returns whole ways.
 */
async function fetchTile(t, label, depth = 0) {
  const query = `[out:json][timeout:900];
(
  way["power"~"^(line|cable)$"]["voltage"](${t.south},${t.west},${t.north},${t.east});
);
out geom;`;
  try {
    return [await overpass(query, label)];
  } catch (err) {
    if (depth >= 3) {
      process.stderr.write(`  [GIVE UP] ${label} — ${err.message}\n`);
      gaveUp.push(label);
      return [];
    }
    const midLon = (t.west + t.east) / 2;
    const midLat = (t.south + t.north) / 2;
    const quarters = [
      { west: t.west, south: t.south, east: midLon, north: midLat },
      { west: midLon, south: t.south, east: t.east, north: midLat },
      { west: t.west, south: midLat, east: midLon, north: t.north },
      { west: midLon, south: midLat, east: t.east, north: t.north },
    ];
    process.stderr.write(`  [split]  ${label} into 4 at depth ${depth + 1}\n`);
    const out = [];
    for (const [q, quarter] of quarters.entries()) {
      out.push(...(await fetchTile(quarter, `${label}.${q + 1}`, depth + 1)));
    }
    return out;
  }
}

/**
 * Tiles this pass could not get. The whole sweep is resumable — every answer is
 * cached by query text — so the honest thing on a partial pass is to exit
 * NON-ZERO and let the caller run it again when Overpass is healthy. A report
 * built on a silently incomplete OSM side would read as "OSM is missing this",
 * when the truth is "we never asked successfully".
 */
const gaveUp = [];

const TILES = franceTiles(2);
for (const [i, t] of TILES.entries()) {
  const payloads = await fetchTile(t, `lines tile ${i + 1}/${TILES.length} (${t.west},${t.south})`);
  for (const el of payloads.flatMap((p) => p.elements)) {
    if (el.type !== 'way' || seen.has(el.id) || !Array.isArray(el.geometry)) continue;
    const volts = parseVolts(el.tags?.voltage);
    if (!volts.length || Math.max(...volts) < MIN_VOLTS) continue;
    seen.add(el.id);
    osmWays += 1;
    const pts = el.geometry.filter((g) => g && Number.isFinite(g.lon)).map((g) => [g.lon, g.lat]);
    if (pts.length < 2) continue;
    const b = band(Math.max(...volts));
    osmLengthByBand.set(b, (osmLengthByBand.get(b) || 0) + pathLength(pts));
    densify(pts, OSM_DENSIFY_M, indexPoint);
  }
}
process.stderr.write(`OSM: ${osmWays} ways >= 50 kV, ${osmDenseCount} indexed points, ${cells.size} cells\n\n`);

/** Is there an indexed OSM point within `radius` of (lon, lat)? */
function covered(lon, lat, radius) {
  const cx = Math.floor(lon / CELL_DEG);
  const cy = Math.floor(lat / CELL_DEG);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      const arr = cells.get(`${cx + dx}:${cy + dy}`);
      if (!arr) continue;
      for (let k = 0; k < arr.length; k += 2) {
        if (haversine(lon, lat, arr[k], arr[k + 1]) <= radius) return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Reference side — RTE's own routes, 30 June 2023
// ---------------------------------------------------------------------------
const SOURCES = [
  { kind: 'aerial', ...REFERENCE.aerial },
  { kind: 'underground', ...REFERENCE.underground },
];

const stats = new Map(); // band -> {refM, coveredM, refCount}
const perKind = new Map(); // kind -> {refM, coveredM}
const worst = [];

for (const src of SOURCES) {
  const rows = readDbf(path.join(src.dir, `${src.stem}.dbf`));
  const { shapes } = readPolylineShp(path.join(src.dir, `${src.stem}.shp`));
  process.stderr.write(`RTE ${src.kind}: ${shapes.length} records\n`);

  for (let i = 0; i < shapes.length; i += 1) {
    const row = rows[i];
    if (!row) continue;
    if (row.etat && row.etat !== 'EN EXPLOITATION') continue;
    const volts = parseVolts(row.tension);
    if (!volts.length || Math.max(...volts) < MIN_VOLTS) continue;
    const b = band(Math.max(...volts));

    for (const part of shapes[i]) {
      if (part.length < 2) continue;
      const samples = [];
      densify(part, SAMPLE_STEP_M, (lon, lat) => samples.push([lon, lat]));
      if (!samples.length) continue;
      const total = pathLength(part);
      const share = total / samples.length;
      let hit = 0;
      for (const [lon, lat] of samples) if (covered(lon, lat, TOLERANCE_M)) hit += 1;

      const s = stats.get(b) || { refM: 0, coveredM: 0, refCount: 0 };
      s.refM += total;
      s.coveredM += share * hit;
      s.refCount += 1;
      stats.set(b, s);

      const k = perKind.get(src.kind) || { refM: 0, coveredM: 0 };
      k.refM += total;
      k.coveredM += share * hit;
      perKind.set(src.kind, k);

      if (total > 2000 && hit / samples.length < 0.25) {
        worst.push({
          kind: src.kind,
          name: row.nom_ligne,
          code: row.code_ligne,
          tension: row.tension,
          km: +(total / 1000).toFixed(1),
          covered: +((100 * hit) / samples.length).toFixed(0),
          at: part[Math.floor(part.length / 2)],
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const line = (s = '') => process.stdout.write(`${s}\n`);
const km = (m) => (m / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 });

line('='.repeat(78));
line("LINES — OSM corridor coverage measured against RTE's own routes (30 June 2023)");
line('='.repeat(78));
line();
line(`Sampled every ${SAMPLE_STEP_M} m along each RTE route; a sample counts as covered if any`);
line(`OSM line of >= ${MIN_VOLTS / 1000} kV passes within ${TOLERANCE_M} m of it.`);
line();
line('  band          RTE route-km    covered by OSM      coverage');
let totalRef = 0;
let totalCov = 0;
for (const b of BANDS) {
  const s = stats.get(b);
  if (!s) continue;
  totalRef += s.refM;
  totalCov += s.coveredM;
  line(
    `  ${b.padEnd(12)} ${km(s.refM).padStart(10)}     ${km(s.coveredM).padStart(10)}       ${((100 * s.coveredM) / s.refM).toFixed(1).padStart(5)}%`,
  );
}
line(`  ${'TOTAL'.padEnd(12)} ${km(totalRef).padStart(10)}     ${km(totalCov).padStart(10)}       ${((100 * totalCov) / totalRef).toFixed(1).padStart(5)}%`);
line();
line('  by construction type');
for (const [kind, k] of perKind) {
  line(`  ${kind.padEnd(12)} ${km(k.refM).padStart(10)}     ${km(k.coveredM).padStart(10)}       ${((100 * k.coveredM) / k.refM).toFixed(1).padStart(5)}%`);
}
line();
line('OSM total length of its own >= 50 kV ways (for scale — NOT comparable directly,');
line('since OSM may draw one way per circuit where RTE draws one route):');
for (const b of BANDS) {
  const v = osmLengthByBand.get(b);
  if (v) line(`  ${b.padEnd(12)} ${km(v).padStart(10)} km`);
}
line();

worst.sort((a, b) => b.km - a.km);
line(`Longest RTE routes OSM barely knows (> 2 km, under 25% covered): ${worst.length}`);
for (const w of worst.slice(0, 15)) {
  line(`  ${String(w.km).padStart(6)} km  ${String(w.covered).padStart(3)}%  ${w.tension.padEnd(7)} ${String(w.name || w.code).slice(0, 46)}`);
}

fs.writeFileSync(path.join(CACHE_DIR, 'out-lines.json'), JSON.stringify({ stats: [...stats], perKind: [...perKind], worst }, null, 1));
line();
line('Detail written to out-lines.json');

if (gaveUp.length) {
  process.stderr.write(`\nINCOMPLETE: ${gaveUp.length} tiles never answered — ${gaveUp.join(', ')}\n`);
  process.stderr.write('Re-run when Overpass recovers; cached tiles are reused, only the gaps refetch.\n');
  process.exit(1);
}
