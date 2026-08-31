#!/usr/bin/env node
/**
 * Build src/data/local_data/airports/airports.geojsonl from OurAirports — the
 * open catalogue of the world's airports, aerodromes, heliports and water
 * landing areas.
 *
 * Source:   https://davidmegginson.github.io/ourairports-data/  (daily mirror
 *           of https://ourairports.com/data/, same files, stable URLs)
 * Files:    airports.csv, runways.csv, countries.csv
 * License:  DEDICATED TO THE PUBLIC DOMAIN by OurAirports/David Megginson —
 *           "You may use it for any purpose, including commercial." No
 *           attribution is legally required; we credit OurAirports and its
 *           volunteer editors anyway, in DATA_SOURCES.md and in the in-app
 *           "Data attribution" popover.
 *
 * WHAT THIS SCRIPT DECIDES, AND WHERE THE DECISION LIVES
 * -----------------------------------------------------
 * Almost nothing, on purpose. The selection policy, the ICAO derivation, the
 * runway summary and the surface families all live in
 * `src/data/airportsPack.js`, because the LAYER reads the same rules back when
 * it writes a card. This file is the plumbing around them: fetch, parse, join,
 * sort, write. If you are here to change what ships, change the pack module —
 * it is the one under unit test.
 *
 * THE JOIN
 * --------
 * `runways.csv` is keyed on `airport_ref` (the airport's numeric `id`), with
 * `airport_ident` as a redundant second key. The numeric ref is used: idents
 * get reassigned upstream when an airfield's ICAO code changes, and a stale
 * ident would silently attach one airport's runways to another. 48,203 runway
 * rows are grouped once into a Map, so the join is linear, not quadratic.
 *
 * DETERMINISM
 * -----------
 * Features are emitted in CODE-POINT order of ICAO → IATA → local code → name
 * (never `localeCompare`, whose collation depends on the runtime's ICU build),
 * coordinates are rounded to 5 decimals (~1 m), and every optional field is
 * omitted rather than emitted empty. Two runs over the same input produce the
 * same bytes on any machine, so the committed file's diff shows what upstream
 * actually changed.
 *
 * Usage:
 *   node scripts/build-ourairports.mjs            # downloads the three CSVs
 *   node scripts/build-ourairports.mjs ./raw-dir  # reads them from a directory
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FRENCH_TERRITORY_CODES,
  airportIcaoCode,
  isPackedAirport,
  summarizeRunways,
} from '../src/data/airportsPack.js';

const BASE_URL = 'https://davidmegginson.github.io/ourairports-data';
const FILES = Object.freeze(['airports.csv', 'runways.csv', 'countries.csv']);
const OUT_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', 'src', 'data', 'local_data', 'airports',
);
const OUT = path.join(OUT_DIR, 'airports.geojsonl');
const DECIMALS = 5;
const FEET_TO_METRES = 0.3048;
const FRENCH_TERRITORIES = new Set(FRENCH_TERRITORY_CODES);

/**
 * Parse RFC 4180 CSV into row objects keyed by the header line.
 *
 * Hand-rolled rather than pulled in as a dependency: the app has no CSV parser
 * and this file is the only consumer. It handles the two things OurAirports
 * actually contains — quoted fields with embedded commas ("Paris, Charles de
 * Gaulle") and doubled quotes inside them — and nothing else.
 *
 * @param {string} source Whole CSV file.
 * @returns {object[]} One object per data row.
 */
function parseCsv(source) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let started = false; // Distinguishes a trailing empty field from no field.

  const endField = () => { row.push(field); field = ''; started = false; };
  const endRow = () => {
    if (started || field || row.length) endField();
    if (row.length) rows.push(row);
    row = [];
  };

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char !== '"') { field += char; continue; }
      if (source[i + 1] === '"') { field += '"'; i += 1; continue; }
      quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; started = true; continue; }
    if (char === ',') { endField(); continue; }
    if (char === '\r') continue;
    if (char === '\n') { endRow(); continue; }
    field += char;
    started = true;
  }
  endRow();

  if (rows.length === 0) return [];
  const header = rows[0];
  return rows.slice(1).map((values) => {
    const record = {};
    for (let i = 0; i < header.length; i += 1) record[header[i]] = values[i] ?? '';
    return record;
  });
}

/**
 * Read the three source CSVs, from disk when a directory is given and from the
 * OurAirports mirror otherwise.
 * @param {string|undefined} directory Optional local directory of raw CSVs.
 * @returns {Promise<Record<string,string>>} File name → contents.
 */
async function loadSources(directory) {
  const out = {};
  for (const file of FILES) {
    if (directory) {
      const local = path.join(directory, file);
      process.stderr.write(`Reading ${local}\n`);
      out[file] = fs.readFileSync(local, 'utf8');
      continue;
    }
    const url = `${BASE_URL}/${file}`;
    process.stderr.write(`Fetching ${url}\n`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
    out[file] = await response.text();
  }
  return out;
}

function clean(value) {
  return String(value ?? '').trim();
}

/** Round to DECIMALS without the `-0` and `4.20000000001` artifacts of toFixed. */
function round(value) {
  return Number(Number(value).toFixed(DECIMALS)) + 0;
}

/**
 * Project one selected row plus its runways into a GeoJSON Feature.
 *
 * Every field is omitted when absent — never emitted as `""`, `null` or
 * `"unknown"`. A card that says nothing about a runway is honest; a card that
 * says "piste inconnue" under six thousand airfields is noise dressed as data.
 *
 * @param {object} row Raw airports.csv row.
 * @param {object[]} runways Raw runways.csv rows for this airport.
 * @param {Map<string,string>} countryNames ISO code → country name.
 * @returns {object|null} Feature, or null when the row has no usable position.
 */
function toFeature(row, runways, countryNames) {
  const lon = Number(clean(row.longitude_deg));
  const lat = Number(clean(row.latitude_deg));
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  // Null Island is a missing coordinate, not an airport in the Gulf of Guinea.
  if (lon === 0 && lat === 0) return null;

  const icao = airportIcaoCode(row);
  const iata = clean(row.iata_code).toUpperCase();
  const localCode = clean(row.local_code).toUpperCase();
  const countryCode = clean(row.iso_country).toUpperCase();

  const properties = {
    name: clean(row.name),
    type: clean(row.type),
  };
  if (icao) properties.icao = icao;
  if (iata) properties.iata = iata;
  // Only when the row has NO other identifier: a national code beside an ICAO
  // code is noise, but a row with neither is un-lookupable without it.
  if (!icao && !iata && localCode) properties.localCode = localCode;

  const municipality = clean(row.municipality);
  if (municipality) properties.municipality = municipality;
  if (countryCode) properties.countryCode = countryCode;
  const country = countryNames.get(countryCode);
  if (country) properties.country = country;
  if (clean(row.scheduled_service).toLowerCase() === 'yes') properties.scheduled = true;

  const elevationFt = Number(clean(row.elevation_ft));
  if (Number.isFinite(elevationFt) && clean(row.elevation_ft) !== '') {
    properties.elevationM = Math.round(elevationFt * FEET_TO_METRES);
  }

  const summary = summarizeRunways(runways);
  if (summary.count > 0) properties.runways = summary;

  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [round(lon), round(lat)] },
    properties,
  };
}

async function main() {
  const directory = process.argv[2];
  const sources = await loadSources(directory);

  const airports = parseCsv(sources['airports.csv']);
  const runways = parseCsv(sources['runways.csv']);
  const countries = parseCsv(sources['countries.csv']);

  const countryNames = new Map(
    countries.map((row) => [clean(row.code).toUpperCase(), clean(row.name)]),
  );

  // Group runways by the airport's numeric id — see the header on why not ident.
  const runwaysByAirport = new Map();
  for (const runway of runways) {
    const ref = clean(runway.airport_ref);
    if (!ref) continue;
    const bucket = runwaysByAirport.get(ref);
    if (bucket) bucket.push(runway);
    else runwaysByAirport.set(ref, [runway]);
  }

  const selected = airports.filter(isPackedAirport);
  const features = [];
  let droppedForPosition = 0;
  for (const row of selected) {
    const feature = toFeature(row, runwaysByAirport.get(clean(row.id)) || [], countryNames);
    if (feature) features.push(feature);
    else droppedForPosition += 1;
  }

  // Code-point order, NOT localeCompare: collation depends on the runtime's ICU
  // build, and this file is committed — two machines must produce the same bytes.
  const sortKey = (feature) => {
    const props = feature.properties;
    return `${props.icao || props.iata || props.localCode || ''}\u0000${props.name}`;
  };
  features.sort((a, b) => {
    const left = sortKey(a);
    const right = sortKey(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, `${features.map((f) => JSON.stringify(f)).join('\n')}\n`, 'utf8');

  // ── Summary, so a rebuild's effect is visible without reading the diff ──
  const byType = new Map();
  let french = 0;
  let withRunway = 0;
  let withSurface = 0;
  for (const feature of features) {
    const props = feature.properties;
    byType.set(props.type, (byType.get(props.type) || 0) + 1);
    if (FRENCH_TERRITORIES.has(props.countryCode)) french += 1;
    if (props.runways?.longestM) withRunway += 1;
    if (props.runways?.surface) withSurface += 1;
  }
  const bytes = fs.statSync(OUT).size;
  process.stderr.write([
    '',
    `Catalogue      ${airports.length.toLocaleString('en-US')} rows`,
    `Selected       ${selected.length.toLocaleString('en-US')} rows`,
    `Written        ${features.length.toLocaleString('en-US')} features → ${OUT} (${(bytes / 1e6).toFixed(2)} MB)`,
    `Dropped        ${droppedForPosition} for a missing/impossible position`,
    `French         ${french.toLocaleString('en-US')} in France + territories`,
    `Runway length  ${withRunway.toLocaleString('en-US')} features (${Math.round((withRunway / features.length) * 100)}%)`,
    `Surface family ${withSurface.toLocaleString('en-US')} features (${Math.round((withSurface / features.length) * 100)}%)`,
    ...[...byType.entries()].sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `  ${type.padEnd(14)} ${count.toLocaleString('en-US')}`),
    '',
  ].join('\n'));
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
