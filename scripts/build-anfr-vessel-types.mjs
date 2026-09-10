#!/usr/bin/env node
/**
 * Build src/data/local_data/vessels_fr/anfr-types.json — the frozen MMSI →
 * ship-type index that fills the AIS layer's "type non déclaré" bucket.
 *
 * Source:   ANFR, « Données radiomaritimes »
 *           https://www.data.gouv.fr/datasets/donnees-radiomaritimes/
 * Licence:  Licence Ouverte v2.0 (lov2) — attribution required, confirmed on
 *           the dataset page, not on an API response.
 *
 * ── THE DEFECT THIS PACK EXISTS TO CLOSE ────────────────────────────────────
 *
 * AIS position reports carry no identity. Type, name and hull ride only in
 * message 5 and in part B of message 24, and a transponder whose ship-type
 * field was never configured broadcasts code 0, "not available", forever. That
 * is not a gap time will close: the ship IS declaring, and what it declares is
 * nothing.
 *
 * Measured on the live feed on 2026-09-10, Channel / North Sea box, 5 749
 * contacts — 54.7 % drew the unfamilied slate, and it decomposed into three
 * different problems:
 *
 *   · 1 934 (33.6 %) declared type 0 — the transponder spoke and said nothing;
 *   ·   543  (9.4 %) had sent no static message yet — the one bucket the disk
 *     registry (`aisStaticRegistry.js`) fills on its own, given uptime;
 *   ·   670 (11.7 %) declared a perfectly good type the legend had no swatch
 *     for. That third one is fixed in `vesselLabels.js`, not here.
 *
 * This pack attacks the first bucket, the only one no amount of listening will
 * ever fill.
 *
 * ── WHY ONLY FOUR OF THE ELEVEN ANFR CATEGORIES ARE KEPT ────────────────────
 *
 * The ANFR field is a RADIO LICENCE category, not a ship type, and the two
 * agree only sometimes. Cross-checked on 2026-09-10 over the 431 live contacts
 * where BOTH the transponder and the register declared something:
 *
 *   PLAISANCE   69 cases — 100 % agreement   → kept
 *   H.S.C.       3 cases — 100 % agreement   → kept
 *   PASSAGERS   38 cases —  97 % agreement   → kept
 *   PÊCHE       61 cases —  95 % agreement   → kept
 *   ────────────────────────────────────────────────────────────
 *   CHARGE     120 cases —   9 % agreement   → DROPPED
 *   FLUVIAL    122 cases —   0 % agreement   → DROPPED
 *   N.U.C.      10 cases —   0 % agreement   → DROPPED
 *   SPÉCIAL      6 cases —   0 % agreement   → DROPPED
 *   AUTRE        2 cases —   0 % agreement   → DROPPED
 *   AQUACOLE, MILITAIRE — never observed live, no evidence → DROPPED
 *
 * `CHARGE` means "commercial, not carrying passengers": it swallows tugs (AIS
 * 52), dredgers (33) and pilot boats (50) and calls them all cargo. `FLUVIAL`
 * means "river licence" and says nothing at all about what the boat does.
 * Shipping those two would repaint 242 correctly-typed vessels with a wrong
 * family — worse than the slate they replaced.
 *
 * Restricted to the four kept categories, the join filled 508 of 2 477
 * undeclared contacts (20.5 % of the bucket) at ~98 % measured accuracy.
 *
 * ── WHY THIS IS A ONE-SHOT PACK AND NOT A MONTHLY REFRESH ───────────────────
 *
 * A hull's category changes on a shipyard timescale. The register is republished
 * monthly, but the delta that matters to us — a boat changing between plaisance,
 * pêche and passagers — is close to nil month over month, and a scheduled
 * download would buy a network dependency at runtime for that. Re-run this
 * script by hand when the coverage is worth refreshing.
 *
 * ── WHAT IS DELIBERATELY NOT KEPT ───────────────────────────────────────────
 *
 * The register carries owner-adjacent fields — registration number, quartier
 * maritime, radio equipment inventory, licence dates. None of it is needed to
 * answer "what kind of boat is this", so none of it is written: the pack is
 * MMSI → family and nothing else.
 *
 * INACTIVE licences are kept. A lapsed radio licence does not change what the
 * hull is, and the boats are demonstrably still at sea — RIVIERA BAY (227328860,
 * INACTIVE) was live in the Channel during the measurement above. Reassignment
 * would be the reason to drop them, and there is no evidence of it: the source
 * file holds 123 585 distinct MMSIs across the kept categories with ZERO
 * conflicting type declarations.
 *
 * Overseas territories come along for free — 9 557 of the kept MMSIs sit under
 * MID 329 (Guadeloupe), 347 (Martinique), 540 (Nouvelle-Calédonie), 546
 * (Polynésie), 660 (La Réunion), 745 (Guyane), 635 (TAAF), 361 (Saint-Pierre),
 * 578 (Wallis) and 618 (Crozet).
 *
 * ── SOURCE FORMAT ───────────────────────────────────────────────────────────
 *
 * Headerless, semicolon-separated, quoted, latin-1, 15 columns. The three this
 * script reads:
 *
 *   [5]  MMSI (9 digits, or empty when the ship holds no DSC identity)
 *   [6]  category — PLAISANCE, PÊCHE, CHARGE, N.U.C., FLUVIAL, PASSAGERS,
 *        AQUACOLE, SPÉCIAL, AUTRE, H.S.C., MILITAIRE
 *  [12]  licence status — ACTIVE / INACTIVE
 *
 * Usage:
 *   node scripts/build-anfr-vessel-types.mjs                 # download
 *   node scripts/build-anfr-vessel-types.mjs <file.csv|.zip> # local source
 *
 * A .zip argument (and the downloaded archive) is expanded with `unzip -p`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  ANFR_KEPT_CATEGORIES,
  VESSEL_REGISTRY_FR_VERSION,
} from '../src/data/vesselRegistryFr.js';

/**
 * The September 2025 edition, pinned. A dated URL rather than "latest" so a
 * rebuild reproduces the pack in the repository byte for byte; bump it by hand
 * when refreshing.
 */
const SOURCE_URL = 'https://static.data.gouv.fr/resources/donnees-radiomaritimes/20250915-090234/opendata-11-09-25.csv.zip';
const SOURCE_EDITION = '2025-09-11';
const DATASET_PAGE = 'https://www.data.gouv.fr/datasets/donnees-radiomaritimes/';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, '..', 'src', 'data', 'local_data', 'vessels_fr');
const OUT = path.join(OUT_DIR, 'anfr-types.json');

/** Column offsets in the headerless source file. */
const COL_MMSI = 5;
const COL_CATEGORY = 6;
const COL_STATUS = 12;

/** MMSI is numeric by protocol and always nine digits in this register. */
const MMSI_PATTERN = /^\d{9}$/;

function unzipToText(zipPath) {
  // The archive holds a single CSV; `-p` streams it to stdout without landing
  // a second copy on disk. maxBuffer is generous: the 2025 edition is 31 MB.
  const buffer = execFileSync('unzip', ['-p', zipPath], { maxBuffer: 256 * 1024 * 1024 });
  return new TextDecoder('latin1').decode(buffer);
}

async function readSource(argument) {
  if (argument) {
    if (argument.endsWith('.zip')) return unzipToText(argument);
    return new TextDecoder('latin1').decode(fs.readFileSync(argument));
  }
  process.stderr.write(`  ↓ ${SOURCE_URL}\n`);
  const response = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`ANFR download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const scratch = path.join(os.tmpdir(), `anfr-radiomaritime-${process.pid}.zip`);
  fs.writeFileSync(scratch, bytes);
  try {
    return unzipToText(scratch);
  } finally {
    fs.rmSync(scratch, { force: true });
  }
}

/**
 * Split one source line. The register quotes every cell, including empty ones,
 * and no cell in the columns we read has ever contained a semicolon — the free
 * text that could (the equipment inventory) uses " - " as its own separator.
 * @param {string} line
 * @returns {Array<string>}
 */
function splitRow(line) {
  return line.split(';').map((cell) => cell.replace(/^"|"$/g, '').trim());
}

const text = await readSource(process.argv[2]);
const lines = text.split(/\r?\n/);

/** @type {Map<string, string>} MMSI → family key. */
const kept = new Map();
const skippedCategories = new Map();
let withMmsi = 0;
let conflicts = 0;

for (const line of lines) {
  if (!line) continue;
  const cells = splitRow(line);
  const mmsi = cells[COL_MMSI];
  if (!MMSI_PATTERN.test(mmsi)) continue;
  withMmsi += 1;
  const category = cells[COL_CATEGORY];
  const family = ANFR_KEPT_CATEGORIES[category];
  if (!family) {
    skippedCategories.set(category, (skippedCategories.get(category) || 0) + 1);
    continue;
  }
  const previous = kept.get(mmsi);
  if (previous && previous !== family) {
    // Never observed in the 2025 editions. Reported rather than silently
    // resolved: a register that starts contradicting itself about a hull is a
    // reason to re-read the source, not to pick a winner.
    conflicts += 1;
    process.stderr.write(`  ! ${mmsi}: ${previous} vs ${family} — kept the first\n`);
    continue;
  }
  if (!previous) kept.set(mmsi, family);
}

if (!kept.size) throw new Error('ANFR source yielded no usable rows — check the column offsets');

/**
 * One sorted, comma-joined MMSI list per family.
 *
 * Not one object key per MMSI: 123 585 JSON keys cost 2 MB and buy nothing,
 * since the only question ever asked of this pack is "which family, if any".
 * Sorted so a rebuild produces a stable diff.
 */
const byFamily = new Map();
for (const [mmsi, family] of kept) {
  if (!byFamily.has(family)) byFamily.set(family, []);
  byFamily.get(family).push(mmsi);
}

const mmsiLists = {};
for (const family of [...byFamily.keys()].sort()) {
  mmsiLists[family] = byFamily.get(family).sort().join(',');
}

const document = {
  version: VESSEL_REGISTRY_FR_VERSION,
  source: 'ANFR — Données radiomaritimes',
  sourceUrl: DATASET_PAGE,
  licence: 'Licence Ouverte v2.0',
  edition: SOURCE_EDITION,
  builtAt: new Date().toISOString().slice(0, 10),
  count: kept.size,
  mmsi: mmsiLists,
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(document)}\n`, 'utf8');

const bytes = fs.statSync(OUT).size;
process.stderr.write(`\n  ${lines.length} lines, ${withMmsi} with an MMSI, ${conflicts} conflicts\n`);
for (const family of Object.keys(mmsiLists)) {
  process.stderr.write(`    ${String(byFamily.get(family).length).padStart(7)}  ${family}\n`);
}
const dropped = [...skippedCategories.entries()].sort((a, b) => b[1] - a[1]);
process.stderr.write(`  dropped: ${dropped.map(([k, v]) => `${k || '(vide)'} ${v}`).join(', ')}\n`);
process.stderr.write(`  → ${path.relative(process.cwd(), OUT)} (${(bytes / 1024 / 1024).toFixed(2)} MB)\n\n`);
