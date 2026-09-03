#!/usr/bin/env node
/**
 * Build the anchor pack the national Filosofi view stands on: one point per
 * département and one per région, with the official code and name.
 *
 * WHY A PACK RATHER THAN A LIVE FETCH. Two things have to agree for a national
 * view to be honest — the shape of the country and the codes INSEE answers
 * with — and they come from two different publishers. The outlines are already
 * bundled (`france_departements/departements.geojson`, IGN ADMIN EXPRESS via
 * france-geojson); the département → région mapping is not, and asking
 * `geo.api.gouv.fr` for it on every session would put a live dependency in
 * front of a map that draws fine without one. It changes when the government
 * redraws the regions, which has happened twice since 1982.
 *
 * WHY POINTS AND NOT POLYGONS. The layer draws one disc per territory — the
 * same grammar it uses for a carreau, for the same reason: a filled département
 * is an opaque quilt at national zoom and the map underneath it disappears.
 * See `filosofiCarreaux.js`. A disc needs an anchor, so that is what this
 * builds.
 *
 * THE ANCHOR IS THE LARGEST RING'S CENTROID, not the whole shape's. Charente-
 * Maritime with Ré and Oléron, Morbihan with Belle-Île, the Var with
 * Porquerolles — an all-rings centroid drags the anchor offshore, and a disc
 * floating in the sea next to its own département reads as a bug.
 *
 * AND WHEN THAT CENTROID IS OUTSIDE ITS OWN RING, the anchor is the interior
 * point farthest from the boundary instead. One département needs this and it
 * is the one that would be worst to get wrong: **Hauts-de-Seine is a crescent
 * wrapped around Paris**, so its area centroid lands in Paris — the 92 disc
 * would have been drawn on top of the 75 disc, two different territories at
 * one point. Measured, not assumed: the script checks all 97 and reports any
 * it had to move.
 *
 * Usage: node scripts/build-fr-territoires.mjs [--check]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ringAreaKm2, pointInRing } from '../src/data/franceDepartements.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const OUTLINES = path.join(REPO, 'src', 'data', 'local_data', 'france_departements', 'departements.geojson');
const OUT_DIR = path.join(REPO, 'src', 'data', 'local_data', 'france_territoires');
const OUT_FILE = path.join(OUT_DIR, 'territoires.json');

const GEO_API = 'https://geo.api.gouv.fr';

/**
 * La Réunion has Filosofi figures and no bundled outline.
 *
 * The anchor is the centre of the coverage box `filosofiCarreaux.js` already
 * declares for the carroyage — a number this repo has published and tested
 * since the layer shipped, rather than a coordinate typed from memory. It puts
 * the disc on the island; it is not a centroid and the pack says so.
 */
const REUNION_BOX = { south: -21.5, west: 55.1, north: -20.8, east: 55.9 };

/**
 * The interior point farthest from the boundary — a pole of inaccessibility.
 *
 * A coarse grid over the ring's own bounding box, then one refinement pass
 * around the winner. 64 × 64 is 4 096 point-in-ring tests per département and
 * the whole script runs in under a second; a proper Delaunay-based solver would
 * be more precise about a coordinate that only has to land in the right half of
 * a département.
 *
 * @param {Array<Array<number>>} ring
 * @returns {[number, number]}
 */
function poleOfInaccessibility(ring) {
  const lons = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  let box = {
    west: Math.min(...lons), east: Math.max(...lons),
    south: Math.min(...lats), north: Math.max(...lats),
  };
  let best = null;
  for (let pass = 0; pass < 2; pass += 1) {
    const steps = 64;
    const dLon = (box.east - box.west) / steps;
    const dLat = (box.north - box.south) / steps;
    for (let i = 1; i < steps; i += 1) {
      for (let j = 1; j < steps; j += 1) {
        const lon = box.west + (i * dLon);
        const lat = box.south + (j * dLat);
        if (!pointInRing(lon, lat, ring)) continue;
        // Distance to the boundary, approximated on the vertices. The rings are
        // simplified — 152 points for the whole of Corse-du-Sud — so vertex
        // distance and true segment distance are the same order here.
        let nearest = Infinity;
        for (const [vLon, vLat] of ring) {
          const dx = (vLon - lon) * Math.cos((lat * Math.PI) / 180);
          const dy = vLat - lat;
          const d = (dx * dx) + (dy * dy);
          if (d < nearest) nearest = d;
        }
        if (!best || nearest > best.score) best = { lon, lat, score: nearest };
      }
    }
    if (!best) break;
    // Refine around the winner, two grid cells either way.
    box = {
      west: best.lon - (2 * dLon), east: best.lon + (2 * dLon),
      south: best.lat - (2 * dLat), north: best.lat + (2 * dLat),
    };
  }
  if (!best) throw new Error('no interior point found');
  return [best.lon, best.lat];
}

/** @param {Array<Array<number>>} ring @returns {[number, number]} Area-weighted centroid. */
function ringCentroid(ring) {
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    const cross = (x1 * y2) - (x2 * y1);
    twiceArea += cross;
    x += (x1 + x2) * cross;
    y += (y1 + y2) * cross;
  }
  // A degenerate ring (all points collinear) has no centroid; fall back to the
  // mean of its vertices rather than dividing by zero.
  if (!twiceArea) {
    const n = ring.length - 1;
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
  }
  return [x / (3 * twiceArea), y / (3 * twiceArea)];
}

/** Every outer ring of a feature, largest first. */
function outerRings(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons
    .map((poly) => poly[0])
    .filter((ring) => Array.isArray(ring) && ring.length >= 4)
    .map((ring) => ({ ring, areaKm2: ringAreaKm2(ring) }))
    .sort((a, b) => b.areaKm2 - a.areaKm2);
}

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const check = process.argv.includes('--check');
  const geojson = JSON.parse(fs.readFileSync(OUTLINES, 'utf8'));

  process.stderr.write('Fetching the département → région mapping from geo.api.gouv.fr…\n');
  const [apiDeps, apiRegions] = await Promise.all([
    getJson(`${GEO_API}/departements?fields=code,nom,codeRegion`),
    getJson(`${GEO_API}/regions?fields=code,nom`),
  ]);
  const regionOf = new Map(apiDeps.map((d) => [d.code, d.codeRegion]));
  const regionName = new Map(apiRegions.map((r) => [r.code, r.nom]));
  const apiName = new Map(apiDeps.map((d) => [d.code, d.nom]));

  const departements = [];
  for (const feature of geojson.features) {
    const code = feature.properties?.code;
    if (!code) continue;
    const rings = outerRings(feature.geometry);
    if (!rings.length) throw new Error(`${code}: no usable ring`);
    let [lon, lat] = ringCentroid(rings[0].ring);
    // Checked, not assumed. A centroid outside its own ring is a crescent, and
    // the anchor moves inside it.
    let moved = false;
    if (!pointInRing(lon, lat, rings[0].ring)) {
      [lon, lat] = poleOfInaccessibility(rings[0].ring);
      moved = true;
      process.stderr.write(`  · ${code} ${feature.properties.nom}: centroid was outside its own ring,`
        + ` anchored on the interior point farthest from the boundary\n`);
    }
    const region = regionOf.get(code);
    if (!region) throw new Error(`${code}: geo.api.gouv.fr knows no region`);
    departements.push({
      code,
      nom: apiName.get(code) || feature.properties.nom,
      region,
      lon: Number(lon.toFixed(5)),
      lat: Number(lat.toFixed(5)),
      areaKm2: Math.round(rings.reduce((sum, r) => sum + r.areaKm2, 0)),
      rings: rings.length,
      ...(moved ? { anchorMovedInside: true } : {}),
    });
  }
  departements.sort((a, b) => a.code.localeCompare(b.code));

  // La Réunion: figures without an outline. Flagged, never silently mixed in
  // with the 96 that have one.
  departements.push({
    code: '974',
    nom: apiName.get('974') || 'La Réunion',
    region: regionOf.get('974'),
    lon: Number(((REUNION_BOX.west + REUNION_BOX.east) / 2).toFixed(5)),
    lat: Number(((REUNION_BOX.south + REUNION_BOX.north) / 2).toFixed(5)),
    areaKm2: null,
    rings: 0,
    anchorFromCoverageBox: true,
  });

  const regions = [];
  const byRegion = new Map();
  for (const dep of departements) {
    if (!byRegion.has(dep.region)) byRegion.set(dep.region, []);
    byRegion.get(dep.region).push(dep);
  }
  for (const [code, members] of byRegion) {
    // Area-weighted over the members that have an area. A région's anchor is
    // the centre of the land it covers, not the mean of its départements —
    // otherwise Paris and its two tiny neighbours would drag Île-de-France's
    // disc into the city they are already crowded around.
    const weighted = members.filter((d) => Number.isFinite(d.areaKm2));
    const total = weighted.reduce((sum, d) => sum + d.areaKm2, 0);
    const lon = total
      ? weighted.reduce((sum, d) => sum + (d.lon * d.areaKm2), 0) / total
      : members[0].lon;
    const lat = total
      ? weighted.reduce((sum, d) => sum + (d.lat * d.areaKm2), 0) / total
      : members[0].lat;
    regions.push({
      code,
      nom: regionName.get(code) || `Région ${code}`,
      lon: Number(lon.toFixed(5)),
      lat: Number(lat.toFixed(5)),
      areaKm2: total || null,
      departements: members.map((d) => d.code).sort(),
    });
  }
  regions.sort((a, b) => a.code.localeCompare(b.code));

  const pack = {
    measuredAt: new Date().toISOString().slice(0, 10),
    note: 'Anchors for the national Filosofi view — one point per territory, not a boundary.',
    sources: {
      outlines: 'IGN ADMIN EXPRESS COG 2018 via france-geojson (Licence Ouverte) — src/data/local_data/france_departements/departements.geojson',
      mapping: 'geo.api.gouv.fr (API Géo, Licence Ouverte) — départements, régions, codeRegion',
      reunion: 'Anchor = centre of the carroyage coverage box declared in src/data/filosofiCarreaux.js; no bundled outline.',
    },
    departements,
    regions,
  };

  const serialized = `${JSON.stringify(pack, null, 1)}\n`;
  if (check) {
    const current = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, 'utf8') : '';
    const same = current.replace(/"measuredAt": "[^"]*"/, '') === serialized.replace(/"measuredAt": "[^"]*"/, '');
    process.stdout.write(same ? 'territoires.json is current\n' : 'territoires.json is STALE\n');
    process.exitCode = same ? 0 : 1;
    return;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, serialized);
  process.stdout.write(`${departements.length} départements, ${regions.length} régions → ${path.relative(REPO, OUT_FILE)}\n`);
  process.stdout.write(`${(serialized.length / 1024).toFixed(1)} KB\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
