#!/usr/bin/env node
/**
 * Build src/data/local_data/ports/ports.geojsonl from the NGA World Port Index
 * (Pub. 150) — the public-domain US government catalog of world ports.
 *
 * Source API:  https://msi.nga.mil/api/publications/world-port-index?output=json
 * Publication: NGA Pub. 150, World Port Index
 * License:     US Government work — public domain (17 U.S.C. § 105). No
 *              attribution legally required; we credit NGA anyway.
 *
 * WHAT IS KEPT, AND WHY THE REST IS DROPPED
 * -----------------------------------------
 * The upstream record carries ~100 fields per port. Most are the single
 * character `U` ("unknown") for almost every row, and a handful are populated
 * so rarely — or so implausibly — that shipping them would dress guesses up as
 * data. Measured over the full 2,951-row catalog on 2026-08-26:
 *
 *   - `portSecurity`  U for 2,921/2,951 (98.98%)   → dropped
 *   - `vts`           U for 2,940/2,951 (99.63%)   → dropped
 *   - `tss`           U for 2,947/2,951 (99.86%)   → dropped
 *   - `maxVesselDraft`  present for 93/2,951 (3.2%), and the observed maximum
 *     is 61 m — more than double the deepest draft any ship has ever had.
 *     Coverage that thin plus values that wrong → dropped.
 *   - `maxVesselLength` present for 93/2,951, observed maximum 760 m against a
 *     real-world record of ~458 m → dropped.
 *   - `maxVesselBeam`   present for 61/2,951 → dropped.
 *
 * A field that is unknown for 99% of rows is not information; rendering it
 * would put "VTS: unknown" under three thousand ports and call it intelligence.
 *
 * DEPTHS ARE BINNED RANGE CODES, NOT SURVEYED SOUNDINGS
 * ----------------------------------------------------
 * `chDepth` / `anDepth` / `cpDepth` are carried through in metres, but the WPI
 * publishes them as *range bins*, not measurements. Rotterdam reports a channel
 * depth of 11 m where the real Maasgeul is dredged to roughly 24 m, and
 * Marseille reports a cargo-pier depth (16 m) deeper than its channel (13 m).
 * Both are consistent with per-facility binning and inconsistent with a survey.
 * They are therefore emitted under `approxDepthM` — never `depthM` — and the
 * layer labels them as approximate. Do not route a vessel with them.
 *
 * HARBOR SIZE: `V` IS *VERY SMALL*, NOT "VERY LARGE"
 * -------------------------------------------------
 * The obvious misreading inverts the whole scale. `V` is the most common code
 * in the catalog (1,784/2,951 = 60.5%), and the ports that carry `L` are
 * Rotterdam, Shanghai, Antwerpen, Busan and Hamburg while Marseille carries
 * `S`. The ladder runs V (very small) → S → M → L (large), verified against
 * those known ports on 2026-08-26.
 *
 * Transform (deterministic):
 *   1. `xcoord`/`ycoord` → GeoJSON Point [lon, lat], rounded to 5 decimals (~1 m).
 *      Rows with missing, non-finite, or out-of-range coordinates are dropped.
 *   2. Coded fields decoded to human text via the tables below; a code absent
 *      from its table is dropped rather than guessed at.
 *   3. `U` ("unknown") and empty strings are omitted, not emitted as "unknown".
 *   4. Features sorted by portNumber for a stable diff.
 *
 * Usage:
 *   node scripts/build-nga-ports.mjs [raw.json]
 * With no argument it downloads the live catalog; with an argument it reads the
 * given raw WPI JSON file.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_URL = 'https://msi.nga.mil/api/publications/world-port-index?output=json';
const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)),
  '..', 'src', 'data', 'local_data', 'ports');
const OUT = path.join(OUT_DIR, 'ports.geojsonl');
const DECIMALS = 5;

/**
 * Harbor size. `V` is VERY SMALL — see the header note before "fixing" this.
 * NGA Pub. 150 column "Harbor Size".
 */
const HARBOR_SIZE = Object.freeze({
  V: 'Very small',
  S: 'Small',
  M: 'Medium',
  L: 'Large',
});

/** Harbor type. NGA Pub. 150 column "Harbor Type". */
const HARBOR_TYPE = Object.freeze({
  CN: 'Coastal — natural',
  CB: 'Coastal — breakwater',
  CT: 'Coastal — tide gate',
  RN: 'River — natural',
  RB: 'River — basin',
  RT: 'River — tide gate',
  LC: 'Lake or canal',
  OR: 'Open roadstead',
  TH: 'Typhoon harbor',
});

/** Degree of shelter afforded. NGA Pub. 150 column "Shelter Afforded". */
const SHELTER = Object.freeze({
  E: 'Excellent',
  G: 'Good',
  F: 'Fair',
  P: 'Poor',
  N: 'None',
});

/**
 * Trim to a clean string, treating the WPI "unknown" sentinel as absent.
 * Interior runs of whitespace are collapsed: the source pads some region names
 * into fixed-width columns ("ICELAND  WEST COAST"), which survives verbatim
 * into a rendered label as a visible double space.
 */
function clean(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text || text === 'U' || text === 'null' || text === 'undefined') return '';
  return text;
}

/** Decode a coded field, dropping anything not in the table rather than guessing. */
function decode(table, value) {
  const code = clean(value).toUpperCase();
  return code && Object.hasOwn(table, code) ? table[code] : '';
}

/** Round to DECIMALS, normalizing -0 to 0 so the output diff stays stable. */
function round(value) {
  const factor = 10 ** DECIMALS;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Parse a WPI depth into metres.
 * These are range-bin codes, not soundings — the caller emits them as approximate.
 * @returns {number|null} Depth in metres, or null when absent/unparseable/absurd.
 */
function depthMetres(value) {
  const text = clean(value);
  if (!text) return null;
  const num = Number(text);
  // 0 is a real WPI value meaning "less than the smallest bin", but as a
  // rendered depth it reads as "this port has no water in it". Drop it.
  // The upper guard rejects transcription noise; the observed catalog maximum
  // is 45 m (an anchorage), so 100 m is a generous ceiling, not a real limit.
  if (!Number.isFinite(num) || num <= 0 || num > 100) return null;
  return num;
}

/** Build one output feature, or null when the row cannot be trusted. */
export function portFeature(row) {
  const lon = Number(row?.xcoord);
  const lat = Number(row?.ycoord);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
  // A port at exactly 0,0 is Null Island, not a port in the Gulf of Guinea.
  if (lon === 0 && lat === 0) return null;

  const name = clean(row.portName);
  if (!name) return null;

  const properties = { name };

  const country = clean(row.countryName);
  if (country) properties.country = country;
  const countryCode = clean(row.countryCode);
  if (countryCode) properties.countryCode = countryCode;

  // regionName is upper-cased in the source ("IRAN"); title-case it so the
  // card copy does not shout.
  const region = clean(row.regionName);
  if (region) {
    properties.region = region.replace(
      /\p{L}[\p{L}'’-]*/gu,
      (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    );
  }

  const unlocode = clean(row.unloCode);
  if (unlocode) properties.unlocode = unlocode;

  const harborSize = decode(HARBOR_SIZE, row.harborSize);
  if (harborSize) properties.harborSize = harborSize;
  const harborType = decode(HARBOR_TYPE, row.harborType);
  if (harborType) properties.harborType = harborType;
  const shelter = decode(SHELTER, row.shelter);
  if (shelter) properties.shelter = shelter;

  // Emitted under an `approx` name on purpose — see the header note.
  const channel = depthMetres(row.chDepth);
  const anchorage = depthMetres(row.anDepth);
  const cargoPier = depthMetres(row.cpDepth);
  if (channel !== null || anchorage !== null || cargoPier !== null) {
    properties.approxDepthM = {};
    if (channel !== null) properties.approxDepthM.channel = channel;
    if (anchorage !== null) properties.approxDepthM.anchorage = anchorage;
    if (cargoPier !== null) properties.approxDepthM.cargoPier = cargoPier;
  }

  const waterBody = clean(row.dodWaterBody);
  if (waterBody) properties.waterBody = waterBody;

  const portNumber = Number(row.portNumber);
  if (Number.isFinite(portNumber)) properties.portNumber = portNumber;

  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [round(lon), round(lat)] },
    properties,
  };
}

/** Transform a raw WPI payload into sorted output features. */
export function buildPorts(raw) {
  const rows = Array.isArray(raw?.ports) ? raw.ports : [];
  if (!rows.length) throw new Error('WPI payload carried no `ports` array');

  const features = [];
  for (const row of rows) {
    const feature = portFeature(row);
    if (feature) features.push(feature);
  }

  features.sort((a, b) => {
    const an = a.properties.portNumber ?? Number.MAX_SAFE_INTEGER;
    const bn = b.properties.portNumber ?? Number.MAX_SAFE_INTEGER;
    if (an !== bn) return an - bn;
    return a.properties.name.localeCompare(b.properties.name);
  });

  return features;
}

async function main() {
  const [, , rawPath] = process.argv;

  let raw;
  if (rawPath) {
    raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
    console.log(`Read ${rawPath}`);
  } else {
    console.log(`Fetching ${SOURCE_URL} …`);
    const response = await fetch(SOURCE_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    raw = await response.json();
  }

  const features = buildPorts(raw);
  const dropped = (raw.ports?.length ?? 0) - features.length;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, `${features.map((f) => JSON.stringify(f)).join('\n')}\n`, 'utf8');

  const bytes = fs.statSync(OUT).size;
  console.log(`Wrote ${features.length} ports → ${OUT} (${(bytes / 1024).toFixed(0)} KB)`);
  if (dropped > 0) console.log(`Dropped ${dropped} unusable row(s) (bad or missing coordinates, or no name)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
