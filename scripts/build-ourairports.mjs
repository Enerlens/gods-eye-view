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
 * SECOND SOURCE — the ground, and it is NOT public domain
 * ------------------------------------------------------
 * Source:   https://data.geopf.fr/wfs/ows  ·  `BDTOPO_V3:aerodrome`
 * License:  IGN, BD TOPO® — LICENCE OUVERTE 2.0. Attribution is REQUIRED, so
 *           the shipped pack is no longer a single-licence file: every feature
 *           carrying a `footprint` carries an IGN outline, the card says "IGN"
 *           on that line, and DATA_SOURCES.md carries the credit. Anything that
 *           strips the footprints (`--no-footprints`) returns the file to
 *           public domain alone.
 * Coverage: métropole + DROM only. Polynésie and Nouvelle-Calédonie are not in
 *           BD TOPO, which is why Tahiti-Fa'a'ā — 1.89 M passengers — receives
 *           no outline while a grass strip in the Aveyron does.
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
 * ident would silently attach one airport's runways to another. 48,230 runway
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
 *   node scripts/build-ourairports.mjs            # downloads the CSVs + the WFS
 *   node scripts/build-ourairports.mjs ./raw-dir  # reads them from a directory
 *   node scripts/build-ourairports.mjs --no-footprints   # OurAirports alone
 *
 * A local directory is read for `aerodrome.geojson` too; when the file is not
 * there the build says so and ships without footprints rather than failing —
 * the same posture the three CSVs get, since a pack without outlines is the
 * pack that shipped until today.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FRENCH_TERRITORY_CODES,
  airportIcaoCode,
  attachAirportFootprints,
  isPackedAirport,
  summarizeRunways,
} from '../src/data/airportsPack.js';

const BASE_URL = 'https://davidmegginson.github.io/ourairports-data';
const FILES = Object.freeze(['airports.csv', 'runways.csv', 'countries.csv']);

/**
 * The IGN aerodrome layer, as a whole-country GeoJSON in lon/lat.
 *
 * `COUNT` is the server's page size, not a cap on the answer: the loop below
 * follows `STARTINDEX` until a page comes back short. 1 370 objects fit in two
 * pages today and the pagination is here for the day they do not — a silent
 * truncation would look exactly like an aerodrome being demolished.
 *
 * `SRSNAME=EPSG:4326` on this service returns lon/lat, which is what the pack
 * writes; `CRS:84` is the spelling the viewport layers need on the BBOX
 * parameter, and neither is a substitute for the other.
 */
const IGN_WFS_URL = 'https://data.geopf.fr/wfs/ows';
const IGN_TYPENAME = 'BDTOPO_V3:aerodrome';
const IGN_PAGE = 1000;
const IGN_FILE = 'aerodrome.geojson';
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

/**
 * Read the IGN aerodrome layer, from disk when a directory is given and from
 * the Géoplateforme WFS otherwise.
 *
 * Returns [] — never throws — when the source is missing or unreadable. A
 * footprint is an ENRICHMENT: losing it costs 417 outlines and no feature, and
 * a build that dies because a public WFS is having a bad afternoon would be a
 * worse failure than a pack that ships the way it shipped yesterday. The count
 * lands in the summary either way, so a silent zero is impossible to miss.
 *
 * @param {string|undefined} directory Optional local directory.
 * @param {boolean} enabled False when `--no-footprints` was passed.
 * @returns {Promise<object[]>} BD TOPO features.
 */
async function loadFootprints(directory, enabled) {
  if (!enabled) {
    process.stderr.write('Footprints  skipped (--no-footprints)\n');
    return [];
  }
  if (directory) {
    const local = path.join(directory, IGN_FILE);
    if (!fs.existsSync(local)) {
      process.stderr.write(`Footprints  ${local} not found — building without outlines\n`);
      return [];
    }
    process.stderr.write(`Reading ${local}\n`);
    return JSON.parse(fs.readFileSync(local, 'utf8'))?.features || [];
  }
  const features = [];
  for (let startIndex = 0; ; startIndex += IGN_PAGE) {
    const url = `${IGN_WFS_URL}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature`
      + `&TYPENAMES=${encodeURIComponent(IGN_TYPENAME)}&OUTPUTFORMAT=application/json`
      + `&SRSNAME=EPSG:4326&COUNT=${IGN_PAGE}&STARTINDEX=${startIndex}`;
    process.stderr.write(`Fetching ${IGN_TYPENAME} [${startIndex}…]\n`);
    let page;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      page = await response.json();
    } catch (error) {
      process.stderr.write(`Footprints  ${IGN_TYPENAME} failed (${error?.message || error})`
        + ' — building without outlines\n');
      return [];
    }
    const batch = Array.isArray(page?.features) ? page.features : [];
    features.push(...batch);
    if (batch.length < IGN_PAGE) return features;
  }
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

  // The anchor is handed over so `runwayGeometry` can refuse a runway joined to
  // the wrong field — the 36 km outlier the pack module documents. It is this
  // row's own published point, which is also the point the feature ships.
  const summary = summarizeRunways(runways, { lon, lat });
  if (summary.count > 0) properties.runways = summary;

  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [round(lon), round(lat)] },
    properties,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const withFootprints = !args.includes('--no-footprints');
  const directory = args.find((arg) => !arg.startsWith('--'));
  const sources = await loadSources(directory);
  const footprints = await loadFootprints(directory, withFootprints);

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

  // AFTER the features exist and BEFORE they are sorted: the join reads each
  // feature's own published point, and every decision it makes lives in the
  // pack module under unit test — this file only hands it the two inputs.
  const footprintReport = attachAirportFootprints(features, footprints);

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
  let withGeometry = 0;
  let frenchWithGeometry = 0;
  let segments = 0;
  let withFootprintNoRunway = 0;
  for (const feature of features) {
    const props = feature.properties;
    byType.set(props.type, (byType.get(props.type) || 0) + 1);
    const isFrench = FRENCH_TERRITORIES.has(props.countryCode);
    if (isFrench) french += 1;
    if (props.runways?.longestM) withRunway += 1;
    if (props.runways?.surface) withSurface += 1;
    const geom = props.runways?.geom;
    const hasRunwayShape = Array.isArray(geom) && geom.length > 0;
    if (hasRunwayShape) {
      withGeometry += 1;
      segments += geom.length;
      if (isFrench) frenchWithGeometry += 1;
    }
    if (props.footprint && !hasRunwayShape) withFootprintNoRunway += 1;
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
    `Runway shape   ${withGeometry.toLocaleString('en-US')} features (${Math.round((withGeometry / features.length) * 100)}%), `
      + `${segments.toLocaleString('en-US')} drawn runways, ${frenchWithGeometry.toLocaleString('en-US')} of them French`,
    `Footprints     ${footprintReport.attached.toLocaleString('en-US')} attached `
      + `(${footprintReport.byKey} on ICAO, ${footprintReport.byContainment} on containment), `
      + `${withFootprintNoRunway.toLocaleString('en-US')} of them with no runway shape at all`,
    `  refused      ${footprintReport.refusedOffset} on anchor offset, `
      + `${footprintReport.refusedShared} on a shared outline · worst offset kept `
      + `${footprintReport.maxOffsetM.toLocaleString('en-US')} m`,
    `  unattached   ${footprintReport.unattached.toLocaleString('en-US')} candidate outlines matched no packed field`,
    ...[...byType.entries()].sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `  ${type.padEnd(14)} ${count.toLocaleString('en-US')}`),
    '',
  ].join('\n'));
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
