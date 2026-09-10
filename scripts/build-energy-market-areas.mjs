#!/usr/bin/env node
/**
 * Build the bundled outlines of the five market areas France exchanges
 * electricity with, for the `france-energy` layer.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * éCO2mix publishes `ech_comm_angleterre`, `ech_comm_espagne`,
 * `ech_comm_italie`, `ech_comm_suisse` and `ech_comm_allemagne_belgique` — a
 * commercial balance with each neighbouring MARKET AREA. The layer used to
 * draw each of them as an arc and nothing else, so the counterparty existed
 * only as the far end of an arrow: the reader could see that 2 227 MW went
 * "vers Suisse" without anything on the globe saying where Suisse is.
 *
 * These outlines delimit the counterparty. They are drawn as a LINE and never
 * filled — see the layer header: France's régions are the only thing this
 * layer measures, and a filled foreign polygon would suggest a reading inside
 * a country where nothing was read.
 *
 * ── What is simplified, and by how much ─────────────────────────────────────
 *
 * Natural Earth 1:50m, already a generalisation, is thinned further with
 * Douglas–Peucker at {@link SIMPLIFY_TOLERANCE_DEG} and stripped of every ring
 * under {@link MIN_RING_AREA_DEG2}. These are borders drawn at continental
 * altitude to say "this country, over here"; a fjord costs bytes and says
 * nothing at that scale. The script prints the before/after point count so the
 * cost of the thinning is a measured number and not a hope.
 *
 * Northern Ireland is REMOVED from the British outline on purpose. The
 * `ech_comm_angleterre` counterparty is the GB bidding zone; Northern Ireland
 * trades in the all-island SEM with the Republic and is not part of it, so
 * leaving it in would draw a border around a market that is not the one being
 * measured.
 *
 * Run: node scripts/build-energy-market-areas.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, 'src', 'data', 'local_data', 'energy_market_areas');
const OUT_FILE = path.join(OUT_DIR, 'market_areas.geojson');

const SOURCE_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master'
  + '/geojson/ne_50m_admin_0_countries.geojson';

/** Douglas–Peucker tolerance, in degrees. ~5.5 km of latitude. */
const SIMPLIFY_TOLERANCE_DEG = 0.05;
/**
 * Rings under this many square degrees are dropped.
 *
 * Tuned, not guessed. At 0.5 the surviving rings are exactly the ones the
 * exchange fields are about: Great Britain, peninsular Spain, mainland Italy
 * with Sicily and Sardinia (both Italian market zones), Germany and Belgium.
 * What it removes is Shetland and Anglesey, Rügen, the BALEARICS and the
 * CANARIES — and the last two matter beyond byte count: they are island
 * systems of their own, not part of the peninsular market that
 * `ech_comm_espagne` settles against, so an outline that included them would
 * be drawing the Spanish STATE where the data means the Spanish MARKET.
 */
const MIN_RING_AREA_DEG2 = 0.5;
/** Coordinate precision kept in the output. 4 decimals ≈ 11 m. */
const COORD_DECIMALS = 4;

/**
 * One feature per `ech_comm_*` field, which is why Germany and Belgium share
 * an entry: éCO2mix publishes ONE balance for the two of them, and two
 * separately labelled outlines would invent a split the data does not have.
 */
const MARKETS = [
  { key: 'angleterre', label: 'Angleterre', iso: ['GBR'] },
  { key: 'espagne', label: 'Espagne', iso: ['ESP'] },
  { key: 'italie', label: 'Italie', iso: ['ITA'] },
  { key: 'suisse', label: 'Suisse', iso: ['CHE'] },
  { key: 'allemagne_belgique', label: 'Allemagne + Belgique', iso: ['DEU', 'BEL'] },
];

/** Northern Ireland: everything of GBR west of this meridian and north of 53.5. */
const ULSTER = { maxLon: -5.35, minLat: 53.5 };

function ringArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(sum / 2);
}

function perpendicularDistance(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy);
  const clamped = Math.max(0, Math.min(1, t));
  return Math.hypot(point[0] - (start[0] + clamped * dx), point[1] - (start[1] + clamped * dy));
}

/** Douglas–Peucker on an open polyline. */
function simplify(points, tolerance) {
  if (points.length < 3) return points.slice();
  let index = 0;
  let farthest = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = perpendicularDistance(points[i], points[0], points[points.length - 1]);
    if (distance > farthest) {
      farthest = distance;
      index = i;
    }
  }
  if (farthest <= tolerance) return [points[0], points[points.length - 1]];
  return [
    ...simplify(points.slice(0, index + 1), tolerance).slice(0, -1),
    ...simplify(points.slice(index), tolerance),
  ];
}

/** Simplify a CLOSED ring while keeping it closed and at least a triangle. */
function simplifyRing(ring, tolerance) {
  const open = ring.slice(0, -1);
  if (open.length < 4) return ring;
  // Anchor on the two farthest-apart-ish vertices by splitting the ring in
  // half: Douglas–Peucker on a closed ring collapses if both ends are the
  // same point.
  const half = Math.floor(open.length / 2);
  const first = simplify([...open.slice(0, half + 1)], tolerance);
  const second = simplify([...open.slice(half), open[0]], tolerance);
  const merged = [...first.slice(0, -1), ...second.slice(0, -1)];
  if (merged.length < 3) return ring;
  return [...merged, merged[0]];
}

const round = (value) => Number(value.toFixed(COORD_DECIMALS));

function countPoints(polygons) {
  return polygons.reduce((sum, rings) => sum + rings.reduce((n, ring) => n + ring.length, 0), 0);
}

async function main() {
  process.stdout.write(`[market-areas] fetching ${SOURCE_URL}\n`);
  const response = await fetch(SOURCE_URL);
  if (!response.ok) throw new Error(`Natural Earth returned HTTP ${response.status}`);
  const world = await response.json();

  const byIso = new Map();
  for (const feature of world.features) {
    const iso = feature.properties.ISO_A3_EH || feature.properties.ADM0_A3;
    if (iso) byIso.set(iso, feature);
  }

  const features = [];
  let before = 0;
  let after = 0;
  for (const market of MARKETS) {
    const polygons = [];
    for (const iso of market.iso) {
      const feature = byIso.get(iso);
      if (!feature) throw new Error(`Natural Earth has no ${iso}`);
      const parts = feature.geometry.type === 'Polygon'
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;
      for (const rings of parts) {
        const outer = rings[0];
        if (ringArea(outer) < MIN_RING_AREA_DEG2) continue;
        if (iso === 'GBR') {
          const lons = outer.map((p) => p[0]);
          const lats = outer.map((p) => p[1]);
          const maxLon = Math.max(...lons);
          const minLat = Math.min(...lats);
          if (maxLon < ULSTER.maxLon && minLat > ULSTER.minLat) continue;
        }
        before += outer.length;
        const thinned = simplifyRing(outer, SIMPLIFY_TOLERANCE_DEG)
          .map((point) => [round(point[0]), round(point[1])]);
        after += thinned.length;
        polygons.push([thinned]);
      }
    }
    if (!polygons.length) throw new Error(`${market.key} kept no ring`);
    features.push({
      type: 'Feature',
      properties: { key: market.key, label: market.label },
      geometry: { type: 'MultiPolygon', coordinates: polygons },
    });
    process.stdout.write(
      `[market-areas] ${market.key.padEnd(19)} ${String(polygons.length).padStart(2)} ring(s),`
      + ` ${String(countPoints(polygons)).padStart(4)} points\n`,
    );
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify({
    type: 'FeatureCollection',
    features,
  })}\n`);
  const bytes = fs.statSync(OUT_FILE).size;
  process.stdout.write(
    `[market-areas] ${before} → ${after} points (${Math.round((1 - after / before) * 100)} % thinned),`
    + ` ${bytes} bytes → ${path.relative(REPO_ROOT, OUT_FILE)}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`[market-areas] ${error?.stack || error}\n`);
  process.exit(1);
});
