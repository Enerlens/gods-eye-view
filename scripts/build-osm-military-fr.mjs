#!/usr/bin/env node
/**
 * Rebuild src/data/local_data/military/military-fr.jsonl — the bundled French
 * pack behind the `military-installations` layer ("Sites militaires").
 *
 * Source:   OpenStreetMap, via the Overpass API.
 * Query:    the SAME tag filters the live proxy uses
 *           (`militaryInstallationsProxy` in vite.config.js) —
 *           `military=airfield|naval_base|range|barracks|base` plus
 *           `landuse=military` — anywhere inside the French Republic
 *           (`ISO3166-1=FR`, admin_level 2: métropole AND the overseas
 *           départements and collectivités).
 * License:  Open Database License (ODbL) 1.0. The attribution and share-alike
 *           obligations travel with the derived database — see DATA_SOURCES.md
 *           and the "Data attribution" popover in the app.
 *
 * WHY A PACK EXISTS AT ALL, NEXT TO A LIVE PROXY
 * ----------------------------------------------
 * The layer asks Overpass for the current viewport, and that is the right
 * design up close: it returns footprints, and it is current to the minute.
 * It does not scale outward, and the numbers are not close. Measured
 * 2026-09-10 against overpass-api.de, same filters:
 *
 *     1.5° box, with geometry    4 s
 *     4.5° box, with geometry   44 s
 *     5°   box, with geometry   41 s   (700 elements — saturated)
 *     5°   box, no geometry     10 s
 *     7.5° box, no geometry     50 s
 *     10°  box, no geometry     84 s
 *
 * The client gate was 10°, so the whole band between about 5° and 10° was a
 * promise the upstream could not keep: a 40-second wait, or the outright
 * failure this harness measured at 7.7°. A viewer who pulled back to look at a
 * région got nothing, which is exactly the complaint this pack answers.
 *
 * Extracted once, France is 7 530 features and about 600 kB of JSONL — smaller
 * than one of this app's imagery tiles, fetched only when the layer is switched
 * on, and answering at any altitude with no network at all.
 *
 * WHAT THE PACK DOES NOT DO
 * -------------------------
 * No footprints. `out center tags` returns one point per feature; the polygon a
 * base is drawn with is worth having at 5 km and is sub-pixel at 500, so it
 * stays a property of the live query. The two sets merge by OSM id at render
 * time and the live record always wins, which is what keeps a base that was
 * mapped this morning from being drawn as last month's point.
 *
 * IDEMPOTENCE AND DETERMINISM
 * ---------------------------
 * Elements are emitted in code-point order of their compact OSM id (never
 * `localeCompare`, whose collation depends on the runtime's ICU build), and
 * coordinates are rounded to 5 decimals (~1 m). Two runs over the same Overpass
 * answer produce the same bytes on any machine, so the committed file's diff
 * shows what OSM actually changed.
 *
 * Usage:
 *   node scripts/build-osm-military-fr.mjs                # queries Overpass
 *   node scripts/build-osm-military-fr.mjs ./raw-fr.json  # reads a saved answer
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// From the data module, never from the runtime pack module: that one imports
// the .jsonl through Vite's `?url`, which Node cannot resolve — and this script
// is what writes that file in the first place.
import { MILITARY_TAG_FILTERS } from '../src/data/militaryInstallationData.js';

/**
 * Overpass refuses a request that carries no `User-Agent`, with HTTP 406.
 * Node's `fetch` sends none by default; every other Overpass caller in this
 * repository sends one. See `scripts/build-osm-dams.mjs` for the measurement.
 */
const OVERPASS_USER_AGENT = 'gods-eye-view-military-pack/1.0 (+https://github.com/mml-studio/gods-eye-view)';

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
  '..', 'src', 'data', 'local_data', 'military',
);
const OUT_JSONL = path.join(OUT_DIR, 'military-fr.jsonl');
/** ~1 m. A pack mark is a locator, not a survey point. */
const DECIMALS = 5;
const QUERY_TIMEOUT_S = 600;
const OVERPASS_ROUNDS = 5;
const OVERPASS_BACKOFF_MS = 60_000;
const OVERPASS_TIMEOUT_MS = 660_000;

/** The tags the runtime normalizer reads. Everything else is dropped. */
const KEPT_TAGS = ['military', 'landuse', 'name', 'name:en'];

/** Round without the `-0` and `4.20000000001` artifacts of toFixed. */
const round = (value) => Number(Number(value).toFixed(DECIMALS)) + 0;

/** `n123` / `w123` / `r123` — the compact element id used for ordering. */
const compactId = (element) => `${element.type[0]}${element.id}`;

async function runOverpass(query) {
  const failures = [];
  for (let round_ = 0; round_ < OVERPASS_ROUNDS; round_ += 1) {
    if (round_ > 0) {
      const waitMs = OVERPASS_BACKOFF_MS * round_;
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
    + ' answer: node scripts/build-osm-military-fr.mjs ./raw-fr.json',
  );
}

/**
 * The whole French Republic, in one query.
 *
 * `out center tags` and NOT `out center tags geom`: Overpass takes the LAST
 * geometry mode only, so asking for both means `center` is never emitted and
 * every way and relation arrives point-less — the bug
 * `militaryInstallationData.js` records against the live proxy. This pack wants
 * exactly the centres.
 */
function packQuery() {
  const filters = MILITARY_TAG_FILTERS
    .map((filter) => `  nwr${filter}(area.scope);`)
    .join('\n');
  return [
    `[out:json][timeout:${QUERY_TIMEOUT_S}];`,
    `area${FRANCE_AREA}->.scope;`,
    '(',
    filters,
    ');',
    'out center tags;',
    '',
  ].join('\n');
}

/**
 * One Overpass element, reduced to what the runtime normalizer reads.
 * @param {object} element Raw Overpass element.
 * @returns {?object} A compact element, or null when it carries no position.
 */
function packElement(element) {
  const lat = Number(element?.lat ?? element?.center?.lat);
  const lon = Number(element?.lon ?? element?.center?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const tags = {};
  for (const key of KEPT_TAGS) {
    const value = element?.tags?.[key];
    if (typeof value === 'string' && value.trim()) tags[key] = value.trim();
  }
  if (!tags.military && tags.landuse !== 'military') return null;
  // `center`, never `lat`/`lon`, whatever the element type: the normalizer
  // reads both, and one shape keeps the file's lines uniform.
  return {
    type: element.type,
    id: element.id,
    center: { lat: round(lat), lon: round(lon) },
    tags,
  };
}

async function main() {
  const rawPath = process.argv[2];
  const answer = rawPath
    ? JSON.parse(fs.readFileSync(rawPath, 'utf8'))
    : await runOverpass(packQuery());

  const elements = [];
  let dropped = 0;
  for (const element of answer.elements || []) {
    if (element.type === 'count' || element.type === 'area') continue;
    const packed = packElement(element);
    if (packed) elements.push(packed);
    else dropped += 1;
  }
  if (elements.length === 0) throw new Error('the extraction came back empty — refusing to write');

  // Code-point order, NOT localeCompare — this file is committed and two
  // machines must produce the same bytes.
  elements.sort((a, b) => {
    const left = compactId(a);
    const right = compactId(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });

  const meta = {
    pack: 'military-fr',
    retrievedAt: new Date().toISOString().slice(0, 10),
    count: elements.length,
    source: 'OpenStreetMap',
    licence: 'ODbL 1.0',
    scope: 'French Republic (ISO3166-1=FR, admin_level=2)',
    filters: MILITARY_TAG_FILTERS,
  };
  const lines = [meta, ...elements].map((one) => JSON.stringify(one));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_JSONL, `${lines.join('\n')}\n`, 'utf8');

  const tally = {};
  let named = 0;
  for (const element of elements) {
    const klass = element.tags.military || 'landuse=military';
    tally[klass] = (tally[klass] || 0) + 1;
    if (element.tags.name) named += 1;
  }
  process.stderr.write(`\n${OUT_JSONL}\n`);
  process.stderr.write(`  ${elements.length} features, ${dropped} dropped for no position or no tag\n`);
  process.stderr.write(`  ${named} named (${Math.round((named / elements.length) * 100)}%)\n`);
  for (const [klass, count] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    process.stderr.write(`  ${String(count).padStart(6)}  ${klass}\n`);
  }
  process.stderr.write(`  ${Math.round(fs.statSync(OUT_JSONL).size / 1024)} kB on disk\n`);
}

await main();
