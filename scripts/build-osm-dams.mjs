#!/usr/bin/env node
/**
 * Rebuild src/data/local_data/dams/dams.geojsonl — the bundled dam pack behind
 * the `local-dams` layer ("Barrages").
 *
 * Source:   OpenStreetMap, via the Overpass API.
 * Query:    `damOverpassQuery()` in src/data/damsPack.js — waterway=dam,
 *           man_made=dam or building=dam, anywhere inside the French Republic
 *           (`ISO3166-1=FR`, which is métropole AND the overseas départements
 *           and collectivités: Réunion, Guyane, Antilles, Mayotte,
 *           Nouvelle-Calédonie, Polynésie).
 * License:  Open Database License (ODbL) 1.0. The attribution and share-alike
 *           obligations travel with the derived database — see DATA_SOURCES.md
 *           and the "Data attribution" popover in the app.
 *
 * WHY THE WORLD OUTSIDE FRANCE IS NOT RE-EXTRACTED
 * ------------------------------------------------
 * The pack was, until this script existed, 704 features for the entire planet,
 * decoded out of an Open Infrastructure Map POWER-PLANT layer that had been
 * filtered on a dam tag — 44 of them in France. A France fork therefore shipped
 * a "Barrages" row that lit up on nothing. France is now extracted directly and
 * completely; the rest of the world is CARRIED OVER from that old snapshot,
 * feature for feature, because re-extracting `waterway=dam` worldwide is tens of
 * megabytes of committed geometry for a fork whose subject is France. What the
 * layer claims is set accordingly: `coverage: 'fr'` in the taxonomy.
 *
 * IDEMPOTENCE
 * -----------
 * The world half is read back out of the file this script writes, so running it
 * twice is a no-op on that half:
 *   - a carried-over feature already in the shipped shape passes through byte
 *     for byte;
 *   - a feature still in the legacy `{name, tags, osm_id}` shape is migrated
 *     through `damFeatureProperties` on the way past (this happens exactly once,
 *     on the first run against the old file);
 *   - a carried-over feature whose OSM id is in the fresh French extraction is
 *     DROPPED, because the fresh one supersedes it. Id and not proximity: the
 *     old snapshot's geometry is the power station's outline, not the dam's, so
 *     the two centroids can sit 300 m apart while being the same OSM object.
 *
 * DETERMINISM
 * -----------
 * Features are emitted in code-point order of their compact OSM id (never
 * `localeCompare`, whose collation depends on the runtime's ICU build), and
 * coordinates are rounded to 6 decimals (~11 cm). Two runs over the same
 * Overpass answer produce the same bytes on any machine, so the committed
 * file's diff shows what OSM actually changed.
 *
 * Usage:
 *   node scripts/build-osm-dams.mjs                  # queries Overpass
 *   node scripts/build-osm-dams.mjs ./raw-fr.json    # reads a saved answer
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DAM_STRUCTURES,
  DAM_TAG_FILTERS,
  damFeatureProperties,
  damTier,
} from '../src/data/damsPack.js';

/**
 * Overpass refuses a request that carries no `User-Agent`, with HTTP 406.
 *
 * Not a guess: measured 2026-09-01 against overpass-api.de, same query, same
 * moment — bare 406, an explicit catch-all Accept 406, a User-Agent **200**. Node's
 * `fetch` sends no User-Agent by default and curl sends one, which is why this
 * script failed eight consecutive rounds while the identical query pasted into
 * a terminal answered immediately, and why the failure read as load.
 *
 * Every other Overpass caller in this repo already sends one — the
 * `/api/overpass` proxy, the hydro registry, the RTE unit registry, the grid
 * audit. This script was the only one that did not.
 */
const OVERPASS_USER_AGENT = 'gods-eye-view-dams-pack/1.0 (+https://github.com/Enerlens/gods-eye-view)';

/** Same mirrors, same order, as the app's `/api/overpass` proxy. */
const OVERPASS_UPSTREAMS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

/**
 * The French Republic as one Overpass area. `admin_level=2` pins it to the
 * country relation: without it the selector also matches the ISO code carried
 * by lower-level boundaries, and the query becomes ambiguous.
 */
const FRANCE_AREA = '["ISO3166-1"="FR"][admin_level=2]';

const OUT_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', 'src', 'data', 'local_data', 'dams',
);
const OUT_JSONL = path.join(OUT_DIR, 'dams.geojsonl');
const OUT_GEOJSON = path.join(OUT_DIR, 'dams.geojson');
const DECIMALS = 6;
const EARTH_RADIUS_M = 6371008.8;
const QUERY_TIMEOUT_S = 600;
/** How many times to walk the whole mirror list before giving up. */
const OVERPASS_ROUNDS = 5;
/** Base wait between rounds; multiplied by the round number. */
const OVERPASS_BACKOFF_MS = 60_000;
/** Client-side ceiling per request, above the server's own 600 s. */
const OVERPASS_TIMEOUT_MS = 660_000;

/** Round to DECIMALS without the `-0` and `4.20000000001` artifacts of toFixed. */
function round(value) {
  return Number(Number(value).toFixed(DECIMALS)) + 0;
}

/** Great-circle distance between two [lon, lat] points, in metres. */
function haversineM(a, b) {
  const toRad = Math.PI / 180;
  const lat1 = a[1] * toRad;
  const lat2 = b[1] * toRad;
  const dLat = lat2 - lat1;
  const dLon = (b[0] - a[0]) * toRad;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The longest straight-line dimension of a mapped structure, in metres.
 *
 * Max pairwise vertex distance, not the length along the way: for an open crest
 * the two are within a few percent (dams are traced almost straight), and for a
 * closed footprint the pairwise maximum is the only one that means anything —
 * the perimeter of a rectangle says nothing about how wide the dam is.
 *
 * O(n²) is fine here: the median French dam way has 5 vertices and the worst
 * has 271.
 *
 * @param {[number,number][]} points Ordered [lon, lat] vertices.
 * @returns {number} Metres, 0 for a single point.
 */
function spanMetres(points) {
  let longest = 0;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const distance = haversineM(points[i], points[j]);
      if (distance > longest) longest = distance;
    }
  }
  return longest;
}

/**
 * The point halfway ALONG a polyline — the middle of the crest.
 *
 * Not the mean of the vertices: that is pulled towards whichever end the mapper
 * traced in more detail, which on a dam anchored to a road junction can put the
 * marker off the structure entirely.
 *
 * @param {[number,number][]} points Ordered [lon, lat] vertices.
 * @returns {[number,number]} A point on the line.
 */
function midpointAlong(points) {
  if (points.length === 1) return points[0];
  const legs = [];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const length = haversineM(points[i - 1], points[i]);
    legs.push(length);
    total += length;
  }
  if (total === 0) return points[0];
  let walked = 0;
  for (let i = 0; i < legs.length; i += 1) {
    if (walked + legs[i] >= total / 2) {
      const t = legs[i] === 0 ? 0 : (total / 2 - walked) / legs[i];
      const [x1, y1] = points[i];
      const [x2, y2] = points[i + 1];
      return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
    }
    walked += legs[i];
  }
  return points[points.length - 1];
}

/** Mean of a point cloud — only used where there is no single line to walk. */
function centroid(points) {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point[0];
    y += point[1];
  }
  return [x / points.length, y / points.length];
}

/** `n123` / `w123` / `r123` — the compact element id used as the feature id. */
function compactId(element) {
  const prefix = element.type === 'node' ? 'n' : element.type === 'way' ? 'w' : 'r';
  return `${prefix}${element.id}`;
}

/** A closed way is an area: same first and last vertex, at least a triangle. */
function isClosedRing(points) {
  if (points.length < 4) return false;
  const first = points[0];
  const last = points[points.length - 1];
  return first[0] === last[0] && first[1] === last[1];
}

/**
 * Project one Overpass element into a GeoJSON Feature.
 *
 * GEOMETRY, and why most dams ship as a point:
 *   - node → Point. 291 French dams are mapped as one node.
 *   - closed way → Polygon. 1,147 footprints, drawn on the globe as an outline
 *     once you are close enough to see a dam-sized object.
 *   - open way → Point at the middle of the crest. 4,072 of them, and this is
 *     the deliberate loss in the pack: the layer draws a stem, a marker and a
 *     card off ONE position per feature, and the stem it installs would
 *     overwrite the LineString's own polyline — a crest line would render as a
 *     blue thread with no name and no card. A point that carries the card is
 *     worth more than a line that carries nothing.
 *   - relation → Point at the centre of its outer rings. 19 of them; a
 *     multipolygon is more than one ring and this renderer draws one.
 *
 * @param {object} element Overpass element with `geometry`/`members`.
 * @returns {object|null} Feature, or null when the element carries no position.
 */
function toFeature(element) {
  const tags = element.tags || {};
  // HALF of France's `man_made=dyke` is roads. 1 428 of the 2 661 elements
  // carry `highway=*` — 49 of them are ways of the Levée de la Loire alone —
  // and the OSM wiki is explicit that a road ON a dyke belongs on the highway
  // as `embankment=dyke`, not as `man_made=dyke`. Importing them would draw
  // the D-road along the Loire as a barrage.
  //
  // The cost is stated rather than hidden: where a levée is mapped ONLY as a
  // road, this pack does not hold it, and a French reader looking for the
  // Loire levées will not find them here. Drawing a road instead would be a
  // worse answer to the same question.
  if (tags.highway && (tags.man_made === 'dyke' || tags.embankment === 'dyke')) return null;
  let points = [];
  let geometry = null;

  if (element.type === 'node') {
    if (!Number.isFinite(element.lon) || !Number.isFinite(element.lat)) return null;
    points = [[element.lon, element.lat]];
    geometry = { type: 'Point', coordinates: [round(element.lon), round(element.lat)] };
  } else if (element.type === 'way') {
    points = (element.geometry || [])
      .filter((point) => Number.isFinite(point?.lon) && Number.isFinite(point?.lat))
      .map((point) => [point.lon, point.lat]);
    if (points.length === 0) return null;
    if (isClosedRing(points)) {
      geometry = {
        type: 'Polygon',
        coordinates: [points.map(([lon, lat]) => [round(lon), round(lat)])],
      };
    } else {
      const [lon, lat] = midpointAlong(points);
      geometry = { type: 'Point', coordinates: [round(lon), round(lat)] };
    }
  } else {
    for (const member of element.members || []) {
      if (member.role && member.role !== 'outer') continue;
      for (const point of member.geometry || []) {
        if (Number.isFinite(point?.lon) && Number.isFinite(point?.lat)) {
          points.push([point.lon, point.lat]);
        }
      }
    }
    if (points.length === 0) return null;
    const [lon, lat] = centroid(points);
    geometry = { type: 'Point', coordinates: [round(lon), round(lat)] };
  }

  const id = compactId(element);
  return {
    type: 'Feature',
    id,
    geometry,
    properties: damFeatureProperties({ tags, osm: id, spanM: spanMetres(points) }),
  };
}

/**
 * POST one Overpass query, walking the mirror list until one answers — and
 * walking it again, more slowly, when they all refuse at once.
 *
 * ONE PASS IS NOT ENOUGH, and that is a fact about the service rather than a
 * defensive habit. Measured 2026-09-01 while rebuilding this pack: every
 * mirror answered 406/500/502 for the whole national extraction, and the
 * IDENTICAL query sent by hand a minute later returned 504 — a gateway
 * timeout, not a rejection. Overpass is a shared public instance whose load
 * varies minute to minute, and a build that gives up after four requests
 * reports "every mirror refused" for what is really "come back shortly".
 *
 * The backoff is deliberately long. There is no point retrying a saturated
 * instance in two seconds; the wait is what the retry is FOR.
 *
 * @param {string} query Overpass QL program.
 * @returns {Promise<object>} Parsed Overpass answer.
 */
async function runOverpass(query) {
  const failures = [];
  for (let round = 0; round < OVERPASS_ROUNDS; round += 1) {
    if (round > 0) {
      const waitMs = OVERPASS_BACKOFF_MS * round;
      process.stderr.write(`  … all mirrors busy, waiting ${Math.round(waitMs / 1000)}s\n`);
      await new Promise((resolve) => { setTimeout(resolve, waitMs); });
      failures.length = 0;
    }
    for (const endpoint of OVERPASS_UPSTREAMS) {
      process.stderr.write(`Querying ${endpoint}\n`);
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'text/plain;charset=UTF-8',
            'User-Agent': OVERPASS_USER_AGENT,
          },
          body: query,
          signal: AbortSignal.timeout(OVERPASS_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (!Array.isArray(payload?.elements)) throw new Error('no elements array');
        return payload;
      } catch (error) {
        failures.push(`${endpoint}: ${error?.message || error}`);
        process.stderr.write(`  ↳ ${error?.message || error}\n`);
      }
    }
  }
  throw new Error(
    `every Overpass mirror refused the query, ${OVERPASS_ROUNDS} rounds apart —\n  ${failures.join('\n  ')}`
    + '\n\nThis is usually load, not the query. Try again later, or pass a saved'
    + ' answer: node scripts/build-osm-dams.mjs ./raw-fr.json',
  );
}

/**
 * Reduce a carried-over LINE to the point at the middle of it.
 *
 * The same rule the French half applies to an open way, applied to the seven
 * world features that shipped as (Multi)LineString: the layer draws one stem,
 * one marker and one card off ONE position per feature, and the stem it
 * installs overwrites a LineString's own polyline — so those seven rendered as
 * anonymous blue threads with no name and no card. Anything else (Point,
 * Polygon, MultiPolygon — Cesium cards each ring of the last) passes through.
 *
 * @param {object} geometry GeoJSON geometry.
 * @returns {object} The same geometry, or a Point standing in for a line.
 */
function flattenLineGeometry(geometry) {
  if (geometry?.type === 'LineString') {
    const [lon, lat] = midpointAlong(geometry.coordinates);
    return { type: 'Point', coordinates: [round(lon), round(lat)] };
  }
  if (geometry?.type === 'MultiLineString') {
    const longest = geometry.coordinates
      .slice()
      .sort((a, b) => b.length - a.length)[0] || [];
    if (longest.length === 0) return geometry;
    const [lon, lat] = midpointAlong(longest);
    return { type: 'Point', coordinates: [round(lon), round(lat)] };
  }
  return geometry;
}

/**
 * Read the previous pack and keep everything the fresh extraction does not
 * supersede. See IDEMPOTENCE in the file header.
 *
 * @param {Set<string>} freshIds Compact ids present in the new French extraction.
 * @returns {{kept: object[], migrated: number, superseded: number, doubled: number}}
 */
function carryOverWorld(freshIds) {
  if (!fs.existsSync(OUT_JSONL)) return { kept: [], migrated: 0, superseded: 0, doubled: 0 };
  const lines = fs.readFileSync(OUT_JSONL, 'utf8').split('\n').filter((line) => line.trim());
  const kept = [];
  const keptIds = new Set();
  let migrated = 0;
  let superseded = 0;
  let doubled = 0;

  for (const line of lines) {
    const feature = JSON.parse(line);
    const properties = feature.properties || {};
    // The legacy snapshot signed relation ids negative (the osm2pgsql
    // convention Open Infrastructure Map inherits); the shipped shape spells
    // the namespace out.
    let id = String(properties.osm || '');
    if (!id) {
      const raw = Number(properties.osm_id ?? feature.id);
      if (Number.isFinite(raw)) id = `${raw < 0 ? 'r' : 'w'}${Math.abs(raw)}`;
    }
    if (id && freshIds.has(id)) {
      superseded += 1;
      continue;
    }
    // The old snapshot decoded some OSM relations TWICE — once out of the
    // `power_plant` layer and once out of `power_plant_relation_by_geom_type`,
    // as a polygon and as a line over the same object. One object, one marker.
    if (id && keptIds.has(id)) {
      doubled += 1;
      continue;
    }
    if (id) keptIds.add(id);
    if (properties.tags) {
      migrated += 1;
      kept.push({
        type: 'Feature',
        id: id || feature.id,
        geometry: flattenLineGeometry(feature.geometry),
        properties: damFeatureProperties({
          tags: { ...properties.tags, name: properties.tags.name || properties.name },
          osm: id,
          // The old snapshot ships power-plant outlines, not dam crests; a
          // "longest dimension" measured off one would describe the usine.
          spanM: null,
        }),
      });
      continue;
    }
    kept.push({ ...feature, geometry: flattenLineGeometry(feature.geometry) });
  }
  return { kept, migrated, superseded, doubled };
}

/**
 * Fetch the extraction ONE TAG FILTER AT A TIME, and merge by OSM id.
 *
 * The five filters in `DAM_TAG_FILTERS` used to go out as one union, and that
 * stopped working when dykes joined them: every mirror answered 406 or 500 for
 * the union, while the same filters asked separately answer 200 — measured
 * 2026-09-01, `waterway=dam` 5 519 in 200 OK and `embankment=dyke` 521 in
 * 200 OK, with only `man_made=dyke` needing a retry of its own. A union query
 * is one expensive statement to an Overpass instance that bills by the whole
 * statement; five cheap ones cost more round trips and actually complete.
 *
 * Merging by id is not just deduplication — it is what makes the double-tagged
 * features work. 25 French structures carry `man_made=dyke` AND `waterway=dam`,
 * so they come back from two different filters, and `damStructureKind` needs
 * BOTH tags present on the merged element to answer `dam+dyke` rather than
 * silently picking whichever filter ran first.
 *
 * @returns {Promise<{elements: Array<object>}>}
 */
async function runOverpassPerFilter() {
  const merged = new Map();
  for (const [key, value] of DAM_TAG_FILTERS) {
    const query = [
      `[out:json][timeout:${QUERY_TIMEOUT_S}];`,
      `area${FRANCE_AREA}->.scope;`,
      `nwr["${key}"="${value}"](area.scope);`,
      'out geom;',
      '',
    ].join('\n');
    process.stderr.write(`\n${key}=${value}\n`);
    const answer = await runOverpass(query);
    let seen = 0;
    for (const element of answer.elements || []) {
      if (element.type === 'count') continue;
      seen += 1;
      const id = `${element.type}/${element.id}`;
      const existing = merged.get(id);
      if (existing) {
        // Same object, second filter: keep the geometry already read and fold
        // the tags together, so a dyke that is also a dam says so.
        existing.tags = { ...(existing.tags || {}), ...(element.tags || {}) };
      } else {
        merged.set(id, element);
      }
    }
    process.stderr.write(`  ${seen} elements (${merged.size} distinct so far)\n`);
  }
  return { elements: [...merged.values()] };
}

async function main() {
  const rawPath = process.argv[2];
  const answer = rawPath
    ? JSON.parse(fs.readFileSync(rawPath, 'utf8'))
    : await runOverpassPerFilter();

  const french = [];
  let droppedForGeometry = 0;
  for (const element of answer.elements) {
    if (element.type === 'count') continue;
    const feature = toFeature(element);
    if (feature) french.push(feature);
    else droppedForGeometry += 1;
  }
  if (french.length === 0) throw new Error('the French extraction came back empty — refusing to write');

  const freshIds = new Set(french.map((feature) => String(feature.id)));
  const { kept, migrated, superseded, doubled } = carryOverWorld(freshIds);

  const features = french.concat(kept);
  // Code-point order, NOT localeCompare — this file is committed and two
  // machines must produce the same bytes.
  features.sort((a, b) => {
    const left = String(a.id);
    const right = String(b.id);
    return left < right ? -1 : left > right ? 1 : 0;
  });

  const jsonl = `${features.map((feature) => JSON.stringify(feature)).join('\n')}\n`;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_JSONL, jsonl, 'utf8');
  // The .geojson twin is the human-readable form kept beside the runtime file;
  // both have always carried the same features and the same privacy transform.
  fs.writeFileSync(
    OUT_GEOJSON,
    `${JSON.stringify({ type: 'FeatureCollection', features })}\n`,
    'utf8',
  );

  // ── Summary, so a rebuild's effect is visible without reading the diff ──
  const tally = { major: 0, named: 0, minor: 0 };
  // The second axis. A rebuild that changed how many digues the pack holds
  // without saying so would be exactly the silence this field exists to end.
  const kinds = {};
  const shape = { Point: 0, Polygon: 0 };
  let named = 0;
  let hydro = 0;
  let withHeight = 0;
  let withSpan = 0;
  for (const feature of features) {
    tally[damTier(feature.properties)] += 1;
    const kind = feature.properties.kind || '(non classé)';
    kinds[kind] = (kinds[kind] || 0) + 1;
    shape[feature.geometry.type] = (shape[feature.geometry.type] || 0) + 1;
    if (feature.properties.name) named += 1;
    if (feature.properties.hydro) hydro += 1;
    if (feature.properties.heightM !== undefined) withHeight += 1;
    if (feature.properties.spanM !== undefined) withSpan += 1;
  }
  const bytes = fs.statSync(OUT_JSONL).size;
  const pct = (part) => `${Math.round((part / features.length) * 100)}%`;
  process.stderr.write([
    '',
    `Overpass          ${answer.elements.length.toLocaleString('en-US')} elements (France + outre-mer)`,
    `Dropped           ${droppedForGeometry} for a missing position`,
    `Carried over      ${kept.length.toLocaleString('en-US')} world features `
      + `(${migrated} migrated to the shipped shape, ${superseded} superseded by the French `
      + `extraction, ${doubled} dropped as a second decoding of the same OSM object)`,
    `Written           ${features.length.toLocaleString('en-US')} features → ${OUT_JSONL} (${(bytes / 1e6).toFixed(2)} MB)`,
    '',
    ...DAM_STRUCTURES.map((structure) => (
      `  ${structure.label.padEnd(15)} ${(kinds[structure.key] || 0).toLocaleString('en-US')}`
    )),
    `  ${'Non classé'.padEnd(15)} ${(kinds['(non classé)'] || 0).toLocaleString('en-US')}`
      + '  (the carried-over world half — no tags left to classify)',
    '',
    `  Grand barrage   ${tally.major.toLocaleString('en-US')}`,
    `  Barrage nommé   ${tally.named.toLocaleString('en-US')}`,
    `  Petit ouvrage   ${tally.minor.toLocaleString('en-US')}`,
    '',
    `  named           ${named.toLocaleString('en-US')} (${pct(named)})`,
    `  hydroélectrique ${hydro.toLocaleString('en-US')} (${pct(hydro)})`,
    `  height          ${withHeight.toLocaleString('en-US')} (${pct(withHeight)})`,
    `  span            ${withSpan.toLocaleString('en-US')} (${pct(withSpan)})`,
    `  footprints      ${(shape.Polygon || 0).toLocaleString('en-US')} polygons, `
      + `${(shape.Point || 0).toLocaleString('en-US')} points`,
    '',
  ].join('\n'));
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
