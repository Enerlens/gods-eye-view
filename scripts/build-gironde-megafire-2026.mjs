#!/usr/bin/env node
/**
 * Rebuild src/data/local_data/gironde_megafire_2026/ — the bundled pack behind
 * the `gironde-megafire-2026` layer ("Mégafeu de Gironde · juil. 2026").
 *
 * Sources, all three keyless except the last:
 *   Copernicus EMS Rapid Mapping, activation EMSR899 — five delineation and
 *     grading products over one AOI, each drawn on a dated satellite frame.
 *     Metadata from the public activations API, geometry from the per-product
 *     ZIPs, which ship ready-made GeoJSON beside the shapefiles.
 *   EFFIS (JRC MapServer WFS) — the automatic burnt-area layer, `ms:modis.ba.poly`,
 *     which closes a perimeter after the mappers stop.
 *   NASA FIRMS — VIIRS S-NPP / NOAA-20 / NOAA-21 and MODIS active-fire
 *     detections over the window. THIS ONE NEEDS `FIRMS_MAP_KEY` (free, from
 *     https://firms.modaps.eosdis.nasa.gov/api/map_key/).
 *
 * License: Copernicus products are free and open under Regulation (EU)
 *   1159/2013 and carry a "Contains modified Copernicus ..." obligation; FIRMS
 *   is NASA public domain. Both credits travel in the pack and in
 *   DATA_SOURCES.md. See MEGAFIRE_CREDITS in src/data/megafirePack.js.
 *
 * WHY A FROZEN PACK AND NOT A LIVE FEED
 * -------------------------------------
 * The fire has been out since 1 August 2026. Nothing this layer draws can
 * change again, so re-fetching it at runtime would buy a reader nothing and
 * cost them three upstreams that can each be down. It would also LOSE data:
 * FIRMS's near-real-time archive is a rolling window, and the 22 July
 * detections were already 49 days old when this pack was first built.
 *
 * THE CACHE IS NOT AN OPTIMISATION
 * --------------------------------
 * The five Copernicus ZIPs are 610 MB together — one of them, GRA_PRODUCT, is
 * 310 MB on its own for 4.58 million vertices. They land in .gev-cache/emsr899/
 * and are reused, so a second run costs one small API call and ~9 500 FIRMS
 * rows. Pass --refetch to force the downloads.
 *
 * DETERMINISM
 * -----------
 * Polygons are emitted in descending area, hotspots in ascending acquisition
 * time then longitude, and every coordinate is rounded to 5 decimals (~1.1 m).
 * Two runs over the same upstream answers produce the same bytes, so the
 * committed diff shows what the publishers actually changed.
 *
 * Usage:
 *   node scripts/build-gironde-megafire-2026.mjs
 *   node scripts/build-gironde-megafire-2026.mjs --refetch
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { simplifyPolyline } from './lib/rrnCentreline.mjs';
import {
  MEGAFIRE_ACTIVATION,
  MEGAFIRE_ACTIVATION_TIME,
  MEGAFIRE_BBOX,
  MEGAFIRE_CENTRE,
  MEGAFIRE_COORD_DP,
  MEGAFIRE_CREDITS,
  MEGAFIRE_EVENT_TIME,
  MEGAFIRE_MIN_HOLE_HA,
  MEGAFIRE_MIN_RING_HA,
  MEGAFIRE_SCHEMA,
  MEGAFIRE_SIMPLIFY_M,
  MEGAFIRE_STEPS,
  MEGAFIRE_WINDOW_END,
  MEGAFIRE_WINDOW_START,
  megafirePolygonAreaM2,
  megafireRingAreaM2,
  megafireToDegrees,
  megafireToMetres,
} from '../src/data/megafirePack.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CACHE = path.join(ROOT, '.gev-cache', 'emsr899');
const OUT = path.join(ROOT, 'src', 'data', 'local_data', 'gironde_megafire_2026');

const ACTIVATION_API = 'https://mapping.emergency.copernicus.eu/backend/dashboard-api'
  + `/public-activations/?code=${MEGAFIRE_ACTIVATION}`;
const PRODUCT_BASE = `https://rapidmapping.emergency.copernicus.eu/backend/${MEGAFIRE_ACTIVATION}/AOI01`;
const EFFIS_WFS = 'https://maps.effis.emergency.copernicus.eu/effis';
const FIRMS_BASE = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';

/**
 * The FIRMS sources this pack reads, and the 5-day chunks it reads them in.
 *
 * Four satellites and not one: VIIRS flies on three platforms with staggered
 * overpasses, so together they give roughly eight looks a day instead of two,
 * and MODIS adds two more at coarser resolution. The day range is capped at 5
 * by the API itself, hence the chunking.
 */
const FIRMS_SOURCES = ['VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT', 'MODIS_NRT'];
const FIRMS_CHUNKS = ['2026-07-20', '2026-07-25', '2026-07-30', '2026-08-04', '2026-08-09'];

const REFETCH = process.argv.includes('--refetch');

/** @param {string} message */
function log(message) { process.stdout.write(`${message}\n`); }

/**
 * Fetch to a cached file, returning its path. Downloads only when missing (or
 * when --refetch), because the Copernicus ZIPs are hundreds of megabytes.
 * @param {string} url
 * @param {string} name - File name inside the cache directory.
 * @returns {Promise<string>} Absolute path to the cached file.
 */
async function cached(url, name) {
  fs.mkdirSync(CACHE, { recursive: true });
  const target = path.join(CACHE, name);
  if (!REFETCH && fs.existsSync(target) && fs.statSync(target).size > 0) return target;
  log(`  ↓ ${name}`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(target, buffer);
  return target;
}

/**
 * Read one GeoJSON member out of a cached product ZIP.
 *
 * `unzip -p` and not a JS zip reader on purpose: these archives hold a 310 MB
 * member beside the one wanted, and streaming a single entry out of the system
 * unzip costs no heap. `-p` also means a missing member is an empty string
 * rather than a throw, which is the right shape here — GRA_MONIT01 genuinely
 * ships no fire fronts and no flames, the fire being out by then.
 *
 * @param {string} zipPath
 * @param {string} pattern - Glob for the member, e.g. `*observedEventA*.json`.
 * @returns {?{type: string, features: Array<object>}} Parsed GeoJSON, or null.
 */
function readGeojsonMember(zipPath, pattern) {
  let raw;
  try {
    raw = execFileSync('unzip', ['-p', zipPath, pattern], {
      maxBuffer: 512 * 1024 * 1024,
      encoding: 'utf8',
      // stderr ignored: `unzip -p` prints "filename not matched" for a member
      // that legitimately does not exist, and GRA_MONIT01 legitimately has no
      // fronts and no flames.
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed || trimmed[0] !== '{') return null;
  return JSON.parse(trimmed);
}

/**
 * Every `[ring, ...holes]` of a GeoJSON feature collection, in flat metres.
 * @param {?{features: Array<object>}} collection
 * @returns {Array<Array<number[]>>}
 */
function polygonsInMetres(collection) {
  const out = [];
  for (const feature of collection?.features || []) {
    const geometry = feature?.geometry;
    if (!geometry) continue;
    const list = geometry.type === 'Polygon' ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
    for (const rings of list) {
      out.push(rings.map((ring) => {
        const flat = [];
        for (const [lon, lat] of ring) {
          const [x, y] = megafireToMetres(lon, lat);
          flat.push(x, y);
        }
        return flat;
      }));
    }
  }
  return out;
}

/**
 * Simplify and thin one product's polygons for shipping.
 *
 * Returns both the drawing and the two areas behind it, so the caller can
 * report how much the simplification moved — the check that caught the
 * hole-reading bug (see the megafirePack header).
 *
 * @param {Array<Array<number[]>>} polygons - Flat metres, outer ring first.
 * @returns {{rings: Array<Array<number[]>>, rawHa: number, keptHa: number, vertices: number}}
 */
function thinPolygons(polygons) {
  const rawHa = polygons.reduce((sum, rings) => sum + megafirePolygonAreaM2(rings), 0) / 1e4;
  const kept = [];
  for (const rings of polygons) {
    // Both thresholds are applied to the SIMPLIFIED ring, never the raw one.
    // Douglas-Peucker cuts corners off a small irregular ring, so a 0.3 ha hole
    // can come out at 0.2 ha — and the promise the pack makes ("nothing under
    // this area ships") is about what ships. Filtering before simplifying
    // measured the wrong object, and `megafirePack.test.mjs` caught it.
    const outer = simplifyPolyline(rings[0], MEGAFIRE_SIMPLIFY_M);
    // A ring needs four points to bound anything; three is a degenerate sliver
    // Douglas-Peucker can leave behind, and Cesium draws it as nothing.
    if (outer.length < 8 || megafireRingAreaM2(outer) < MEGAFIRE_MIN_RING_HA * 1e4) continue;
    const holes = [];
    for (let i = 1; i < rings.length; i += 1) {
      const hole = simplifyPolyline(rings[i], MEGAFIRE_SIMPLIFY_M);
      if (hole.length >= 8 && megafireRingAreaM2(hole) >= MEGAFIRE_MIN_HOLE_HA * 1e4) holes.push(hole);
    }
    kept.push([outer, ...holes]);
  }
  kept.sort((a, b) => megafirePolygonAreaM2(b) - megafirePolygonAreaM2(a));
  const keptHa = kept.reduce((sum, rings) => sum + megafirePolygonAreaM2(rings), 0) / 1e4;
  const vertices = kept.reduce((sum, rings) => sum
    + rings.reduce((count, ring) => count + ring.length / 2, 0), 0);
  return {
    rings: kept.map((rings) => rings.map(toDegreeRing)),
    rawHa,
    keptHa,
    vertices,
  };
}

/**
 * Flat metres → the shipped flat `[lon, lat, lon, lat, ...]`.
 * @param {number[]} flat
 * @returns {number[]}
 */
function toDegreeRing(flat) {
  const out = new Array(flat.length);
  for (let i = 0; i < flat.length; i += 2) {
    const [lon, lat] = megafireToDegrees(flat[i], flat[i + 1]);
    out[i] = lon;
    out[i + 1] = lat;
  }
  return out;
}

/**
 * Lines (fire fronts) as shipped flat degree arrays.
 * @param {?{features: Array<object>}} collection
 * @returns {Array<number[]>}
 */
function linesToDegrees(collection) {
  const out = [];
  for (const feature of collection?.features || []) {
    const geometry = feature?.geometry;
    if (!geometry) continue;
    const list = geometry.type === 'LineString' ? [geometry.coordinates]
      : geometry.type === 'MultiLineString' ? geometry.coordinates : [];
    for (const line of list) {
      if (line.length < 2) continue;
      const flat = [];
      for (const [lon, lat] of line) {
        const [x, y] = megafireToMetres(lon, lat);
        flat.push(x, y);
      }
      // Fronts are already sparse (37 lines, 258 vertices at their busiest) but
      // they go through the same tolerance so a front and the perimeter it sits
      // on cannot disagree about where a corner is.
      out.push(toDegreeRing(simplifyPolyline(flat, MEGAFIRE_SIMPLIFY_M)));
    }
  }
  out.sort((a, b) => b.length - a.length || a[0] - b[0]);
  return out;
}

/**
 * Points (active flames) as shipped `[lon, lat]` pairs.
 * @param {?{features: Array<object>}} collection
 * @returns {Array<number[]>}
 */
function pointsToDegrees(collection) {
  const power = 10 ** MEGAFIRE_COORD_DP;
  const round = (value) => Math.round(value * power) / power;
  const out = [];
  for (const feature of collection?.features || []) {
    const geometry = feature?.geometry;
    if (geometry?.type !== 'Point') continue;
    out.push([round(geometry.coordinates[0]), round(geometry.coordinates[1])]);
  }
  out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return out;
}

/**
 * Copernicus's own statistics for one product, flattened to the handful the
 * card can show. Everything here is carried verbatim; nothing is recomputed.
 * @param {object} product
 * @returns {object}
 */
function productStats(product) {
  const stats = product?.stats || {};
  const pick = (group, key) => stats[group]?.[key]?.affected ?? null;
  return {
    burntHa: stats['Burnt area']?.None?.affected ?? null,
    forestHa: pick('Land use', 'Forests '),
    scrubHa: pick('Land use', 'Shrub and/or herbaceous vegetation association'),
    residentialHa: pick('Built-up', 'Residential Buildings'),
    populationAffected: pick('Estimated population', 'None'),
    highwayKm: pick('Transportation', 'Highways'),
    trackKm: pick('Transportation', 'Cart Track'),
    powerLineKm: pick('Facilities', 'Long-distance pipelines, communication and electricity lines'),
    fireFrontKm: pick('Fire Fronts', 'None'),
    activeFlames: pick('Active Flames', 'None'),
  };
}

/** @returns {Promise<object>} The EMSR899 activation record. */
async function fetchActivation() {
  const file = await cached(ACTIVATION_API, 'activation.json');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const record = (parsed.results || parsed)[0] || parsed;
  if (record.code !== MEGAFIRE_ACTIVATION) {
    throw new Error(`activation API returned ${record.code}, expected ${MEGAFIRE_ACTIVATION}`);
  }
  return record;
}

/**
 * EFFIS's closing perimeter, plus every other burnt area it maps in the box.
 *
 * The main polygon is picked by AREA and not by commune name: EFFIS files this
 * fire under "Porge" while the activation is named for Saumos where it started
 * and the evacuation was at Cap-Ferret, so no name is the right key.
 *
 * @returns {Promise<{main: object, others: Array<object>}>}
 */
async function fetchEffis() {
  const { west, south, east, north } = MEGAFIRE_BBOX;
  const url = `${EFFIS_WFS}?service=WFS&version=1.1.0&request=GetFeature`
    + '&typename=ms:modis.ba.poly'
    + '&outputformat=' + encodeURIComponent('application/json; subtype=geojson')
    + `&bbox=${west},${south},${east},${north}`;
  const file = await cached(url, 'effis.geojson');
  const collection = JSON.parse(fs.readFileSync(file, 'utf8'));
  const inWindow = collection.features.filter((feature) => {
    const date = String(feature.properties?.FIREDATE || '');
    return date >= '2026-07-20' && date <= '2026-08-15';
  });
  inWindow.sort((a, b) => Number(b.properties.AREA_HA) - Number(a.properties.AREA_HA));
  if (!inWindow.length) throw new Error('EFFIS returned no 2026 burnt area in the box');
  const [main, ...others] = inWindow;
  const thinned = thinPolygons(polygonsInMetres({ features: [main] }));
  return {
    main: {
      commune: main.properties.COMMUNE,
      province: main.properties.PROVINCE,
      areaHa: Number(main.properties.AREA_HA),
      firstDetection: `${String(main.properties.FIREDATE).replace(' ', 'T')}Z`,
      lastDetection: `${String(main.properties.FINALDATE).replace(' ', 'T')}Z`,
      rings: thinned.rings,
    },
    others: others.map((feature) => ({
      commune: feature.properties.COMMUNE,
      areaHa: Number(feature.properties.AREA_HA),
      firstDetection: `${String(feature.properties.FIREDATE).replace(' ', 'T')}Z`,
    })).sort((a, b) => b.areaHa - a.areaHa),
  };
}

/**
 * Every FIRMS detection in the box over the window.
 *
 * Deduplicated on (lat, lon, date, time, source): the 5-day chunks are laid out
 * not to overlap, but a satellite that crosses a chunk boundary mid-granule can
 * still be returned twice, and a duplicated detection would double-count in the
 * replay's own counter.
 *
 * @returns {Promise<Array<{lat: number, lon: number, ms: number, frp: number,
 *   confidence: string, source: string}>>}
 */
async function fetchFirms() {
  const key = String(process.env.FIRMS_MAP_KEY || '').trim();
  if (!key) throw new Error('FIRMS_MAP_KEY is not set — see https://firms.modaps.eosdis.nasa.gov/api/map_key/');
  const { west, south, east, north } = MEGAFIRE_BBOX;
  const seen = new Set();
  const rows = [];
  for (const source of FIRMS_SOURCES) {
    for (const start of FIRMS_CHUNKS) {
      const url = `${FIRMS_BASE}/${key}/${source}/${west},${south},${east},${north}/5/${start}`;
      const file = await cached(url, `firms-${source}-${start}.csv`);
      const text = fs.readFileSync(file, 'utf8');
      const lines = text.trim().split('\n');
      const header = lines[0].split(',').map((field) => field.trim());
      const index = Object.fromEntries(header.map((field, i) => [field, i]));
      for (const line of lines.slice(1)) {
        const cells = line.split(',');
        if (cells.length < header.length) continue;
        const date = cells[index.acq_date];
        const time = String(cells[index.acq_time]).padStart(4, '0');
        const dedupe = `${cells[index.latitude]}|${cells[index.longitude]}|${date}|${time}|${source}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        rows.push({
          lat: Number(cells[index.latitude]),
          lon: Number(cells[index.longitude]),
          ms: Date.parse(`${date}T${time.slice(0, 2)}:${time.slice(2)}:00Z`),
          frp: Number(cells[index.frp]),
          confidence: String(cells[index.confidence] ?? '').trim(),
          source,
        });
      }
    }
  }
  const windowStart = Date.parse(MEGAFIRE_WINDOW_START);
  const windowEnd = Date.parse(MEGAFIRE_WINDOW_END);
  const inWindow = rows.filter((row) => Number.isFinite(row.ms)
    && row.ms >= windowStart && row.ms <= windowEnd
    && Number.isFinite(row.lat) && Number.isFinite(row.lon));
  inWindow.sort((a, b) => a.ms - b.ms || a.lon - b.lon || a.lat - b.lat);
  log(`  FIRMS: ${rows.length} detections, ${inWindow.length} inside the window`);
  return inWindow;
}

/** Entry point. */
async function main() {
  log(`Building the ${MEGAFIRE_ACTIVATION} pack`);

  const activation = await fetchActivation();
  const products = new Map(
    (activation.aois?.[0]?.products || []).map((product) => [
      `${product.type}_${product.monitoring ? `MONIT0${product.monitoringNumber}` : 'PRODUCT'}`,
      product,
    ]),
  );

  const steps = [];
  for (const step of MEGAFIRE_STEPS) {
    const product = products.get(step.product);
    if (!product) throw new Error(`activation API no longer lists ${step.product}`);
    // `downloadPath` and not a URL assembled here: the version suffix in a
    // product ZIP's name is bumped when Copernicus reissues a product, and the
    // API is the only place that says which version is current. It already
    // points inside PRODUCT_BASE, which is asserted rather than assumed.
    const zipUrl = String(product.downloadPath || '');
    if (!zipUrl.startsWith(PRODUCT_BASE)) {
      throw new Error(`${step.product}: unexpected download path ${zipUrl}`);
    }
    const zipPath = await cached(zipUrl, path.basename(zipUrl));
    const areas = readGeojsonMember(zipPath, '*observedEventA*.json');
    const lines = readGeojsonMember(zipPath, '*observedEventL*.json');
    const points = readGeojsonMember(zipPath, '*observedEventP*.json');
    const thinned = thinPolygons(polygonsInMetres(areas));
    const fronts = linesToDegrees(lines);
    const flames = pointsToDegrees(points);
    log(`  ${step.product.padEnd(12)} ${String(thinned.rings.length).padStart(4)} polys `
      + `${String(thinned.vertices).padStart(6)} sommets | ${thinned.keptHa.toFixed(0)} ha dessinés `
      + `/ ${thinned.rawHa.toFixed(0)} ha bruts / ${step.burntHa} ha publiés `
      + `| ${fronts.length} fronts, ${flames.length} flammes`);
    steps.push({
      id: step.id,
      product: step.product,
      acq: step.acq,
      sensor: step.sensor,
      resolution: step.resolution,
      burntHa: step.burntHa,
      label: step.label,
      measuredHa: Number(thinned.rawHa.toFixed(1)),
      drawnHa: Number(thinned.keptHa.toFixed(1)),
      stats: productStats(product),
      rings: thinned.rings,
      fronts,
      flames,
    });
  }

  const effis = await fetchEffis();
  log(`  EFFIS: ${effis.main.areaHa} ha at ${effis.main.commune}, `
    + `${effis.others.length} other burnt areas in the box`);

  const hotspots = await fetchFirms();

  fs.mkdirSync(OUT, { recursive: true });

  const event = {
    schema: MEGAFIRE_SCHEMA,
    builtAt: new Date().toISOString().slice(0, 10),
    activation: {
      code: activation.code,
      name: activation.name,
      activator: activation.activator,
      eventTime: MEGAFIRE_EVENT_TIME,
      activationTime: MEGAFIRE_ACTIVATION_TIME,
      gdacsId: activation.gdacsId,
      reportLink: activation.reportLink,
      stats: activation.stats,
    },
    window: { start: MEGAFIRE_WINDOW_START, end: MEGAFIRE_WINDOW_END },
    centre: MEGAFIRE_CENTRE,
    steps,
    effis,
    credits: MEGAFIRE_CREDITS,
  };
  writeJson(path.join(OUT, 'event.json'), event);

  const power = 10 ** MEGAFIRE_COORD_DP;
  const round = (value) => Math.round(value * power) / power;
  const windowStart = Date.parse(MEGAFIRE_WINDOW_START);
  writeJson(path.join(OUT, 'hotspots.json'), {
    schema: MEGAFIRE_SCHEMA,
    epoch: MEGAFIRE_WINDOW_START,
    // Minutes since `epoch`, not epoch milliseconds: VIIRS reports whole
    // minutes anyway, and the narrower column is a third of the file.
    columns: ['lon', 'lat', 'minutes', 'frp', 'confidence', 'source'],
    sources: FIRMS_SOURCES,
    rows: hotspots.map((row) => [
      round(row.lon),
      round(row.lat),
      Math.round((row.ms - windowStart) / 60000),
      Number(row.frp.toFixed(1)),
      row.confidence,
      FIRMS_SOURCES.indexOf(row.source),
    ]),
  });

  writeReadme(event, hotspots);
  log('Done.');
}

/**
 * Write JSON with one array element per line where it helps a diff, compact
 * where it does not. A 37 000-vertex ring on its own line is unreadable either
 * way, so the rings go compact and everything above them stays pretty.
 * @param {string} file
 * @param {object} value
 */
function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`);
  log(`  → ${path.relative(ROOT, file)} (${(fs.statSync(file).size / 1e6).toFixed(2)} MB)`);
}

/**
 * The pack's own README, regenerated with the figures of the run that wrote it.
 * @param {object} event
 * @param {Array<object>} hotspots
 */
function writeReadme(event, hotspots) {
  const byDay = new Map();
  for (const row of hotspots) {
    const day = new Date(row.ms).toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) || 0) + 1);
  }
  const peak = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0];
  const maxFrp = hotspots.reduce((max, row) => Math.max(max, row.frp), 0);
  const lines = [
    '# Mégafeu de Gironde — 22 juillet au 1ᵉʳ août 2026',
    '',
    'Pack figé pour la couche `gironde-megafire-2026`. Reconstruit par',
    '`node scripts/build-gironde-megafire-2026.mjs` (voir l\'en-tête du script pour',
    'les sources et la raison pour laquelle rien n\'est relu à l\'exécution).',
    '',
    `Construit le ${event.builtAt}.`,
    '',
    '## Ce que le pack contient',
    '',
    '| Fichier | Contenu |',
    '| --- | --- |',
    '| `event.json` | Les cinq périmètres Copernicus datés, leurs fronts et leurs flammes, le périmètre final EFFIS, et les statistiques publiées par Copernicus pour chaque produit. |',
    '| `hotspots.json` | Les détections NASA FIRMS de la fenêtre, en minutes depuis son ouverture. |',
    '',
    '## Les cinq images',
    '',
    '| Acquisition (UTC) | Produit | Capteur | Surface brûlée publiée | Polygones dessinés |',
    '| --- | --- | --- | ---: | ---: |',
    ...event.steps.map((step) => `| ${step.acq.replace('T', ' ').replace(':00Z', '')} | `
      + `${step.product} | ${step.sensor} | ${step.burntHa.toLocaleString('fr-FR')} ha | `
      + `${step.rings.length} |`),
    '',
    'La colonne « surface brûlée publiée » est celle de Copernicus, jamais recalculée',
    'à partir du dessin. `measuredHa` (géométrie brute) et `drawnHa` (après',
    'simplification) sont conservés dans `event.json` pour que l\'écart reste',
    'mesurable.',
    '',
    '## Les points chauds',
    '',
    `${hotspots.length.toLocaleString('fr-FR')} détections retenues dans la fenêtre, `
      + `dont ${peak[1].toLocaleString('fr-FR')} le ${peak[0]} — le jour le plus actif.`,
    `Puissance radiative maximale sur un pixel : ${maxFrp.toLocaleString('fr-FR')} MW.`,
    '',
    '## Crédits',
    '',
    ...event.credits.map((credit) => `- **${credit.source}** — ${credit.credit}  `
      + `\n  ${credit.licence} · <${credit.url}>`),
    '',
  ];
  const file = path.join(OUT, 'README.md');
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  log(`  → ${path.relative(ROOT, file)}`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exit(1);
});
