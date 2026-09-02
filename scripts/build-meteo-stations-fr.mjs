#!/usr/bin/env node
/**
 * Build `src/data/local_data/meteo_stations_fr/stations.json` — every station in
 * Météo-France's real-time observation network, and what each one can actually
 * measure.
 *
 * WHY THIS SCRIPT EXISTS: **the station list says where, and nothing about
 * what.** Météo-France publishes the real-time network as eight columns —
 * identifier, WMO number, name, latitude, longitude, altitude, opening date,
 * pack — and 2 144 identical rows. Whether a given dot holds an anemometer, a
 * barometer, both or neither is in a DIFFERENT file, a 191 MB inventory of every
 * parameter every poste has ever measured, dated one instrument at a time. The
 * whole argument of this layer is that difference, so it has to be joined at
 * authoring time and committed, not derived live from a file no browser can
 * fetch.
 *
 * ── The four sources ────────────────────────────────────────────────────────
 *
 *   1. **Liste des stations du réseau d'observation temps réel** (Licence
 *      Ouverte 2.0), via data.gouv.fr. The spine: 2 144 stations with their
 *      position, altitude, opening date and publication pack.
 *
 *   2. **Informations sur les stations — `fiches.json`** (Licence Ouverte 2.0),
 *      191 MB from Météo-France's own S3. Read for one thing: the parameters
 *      each station measures TODAY, meaning those with no `dateFin`. Fourteen
 *      booleans per station survive into the pack; the rest is discarded.
 *
 *   3. **`POSTES_MF.csv`** (Licence Ouverte 2.0). The commune, the lieu-dit,
 *      the current poste type — and `DATFERM`, which is the only way to learn
 *      that seven stations in the real-time list are closed.
 *
 *   4. **Liste des stations SYNOP** (Licence Ouverte 2.0). The 62 whose
 *      observations anyone can read without an API key.
 *
 * Plus one listing rather than a download: the S3 index of
 * `REF_STATION/FICHECLIM_*.data`, which says WHICH stations have a published
 * fiche climatologique. The fiches themselves are fetched per card at runtime;
 * only the boolean is shipped, so a card never offers a link that 404s.
 *
 * ── What is NOT in this build, and why ──────────────────────────────────────
 *
 * **The 12 347 closed postes.** `POSTES_MF.csv` carries every poste back to
 * 1806 and only 2 404 are still open. A layer of historical postes is a
 * different layer with a different argument, and drawing them beside live
 * instruments would say the network is five times its real size.
 *
 * **The 699 *stations complémentaires*.** Type 5, published separately,
 * 535 of them open, run by the DGPR, the DIR routes, the DREAL, EDF and INRAE.
 * None of them appears in the real-time list this layer draws — verified, the
 * intersection is empty — and Météo-France does not guarantee their expertise.
 *
 * **The Infoclimat / StatIC network.** 1 138 French stations, and **553 of them
 * are CC BY-NC**: more than half the file forbids commercial reuse, station by
 * station. A layer that mixed them in would be shipping a licence trap.
 *
 * Usage:
 *   node scripts/build-meteo-stations-fr.mjs             # rebuild the pack
 *   node scripts/build-meteo-stations-fr.mjs --report    # + per-département table
 *   node scripts/build-meteo-stations-fr.mjs --keep-fiches=/tmp/fiches.json
 */

import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import {
  FICHES_URL,
  POSTES_URL,
  RT_STATIONS_URL,
  SYNOP_STATIONS_URL,
  STATION_CLASSES,
  STATION_CLASS_ORDER,
  FAMILY_BY_KEY,
  FAMILY_KEYS,
  classifyStation,
  familiesFromFiche,
  projectStationRow,
  splitSemicolon,
  summarizeStations,
} from '../src/data/meteoStationsFrFeed.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = path.join(ROOT, 'src/data/local_data/meteo_stations_fr/stations.json');
const USER_AGENT = 'gods-eye-view/meteo-stations-fr (+https://github.com/Enerlens/gods-eye-view)';

/** The S3 listing that says which stations have a published fiche climatologique. */
const FICHECLIM_INDEX = 'https://meteofrance.s3.sbg.io.cloud.ovh.net/?list-type=2&prefix=data/synchro_ftp/REF_STATION/&max-keys=1000';

/**
 * Refuse the build if the network shrinks by more than this fraction.
 *
 * The pack is committed, so a bad rebuild is a diff someone has to notice. A
 * station list that suddenly holds 200 rows is an upstream outage served with
 * HTTP 200, and shipping it would silently delete 90 % of the layer. 15 % is
 * far wider than any real month-to-month change in a national network and far
 * narrower than any plausible truncation.
 */
const MIN_STATIONS = 1800;

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT, timeout: 300_000, report: false, keepFiches: null };
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=');
    if (key === 'out') args.out = path.resolve(ROOT, value);
    else if (key === 'timeout') args.timeout = Math.max(10_000, Number(value) || 300_000);
    else if (key === 'report') args.report = true;
    else if (key === 'keep-fiches') args.keepFiches = path.resolve(ROOT, value || '/tmp/fiches.json');
  }
  return args;
}

async function getText(url, timeoutMs) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  return response.text();
}

/**
 * Parse a `;`-separated Météo-France CSV into rows keyed by header name.
 *
 * The column count is asserted per row rather than assumed: every file here is
 * unquoted (see `splitSemicolon`), so a stray separator would silently shift
 * every field after it, and a shifted latitude is a station in the sea.
 * @param {string} text
 * @param {string} label For the error message.
 * @returns {Array<Record<string, string>>}
 */
function parseSemicolonCsv(text, label) {
  const lines = String(text).split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) throw new Error(`${label} : fichier vide`);
  const header = splitSemicolon(lines[0].replace(/^﻿/, ''));
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitSemicolon(lines[i]);
    if (cells.length !== header.length) {
      throw new Error(`${label} : ligne ${i + 1} a ${cells.length} colonnes, attendu ${header.length}`);
    }
    rows.push(Object.fromEntries(header.map((name, position) => [name, cells[position]])));
  }
  return rows;
}

/**
 * Stream the 191 MB fiches inventory and keep fourteen booleans per station.
 *
 * The file is one JSON array of 13 745 objects, each carrying its whole
 * parameter history — `JSON.parse` on the string is roughly a gigabyte of
 * heap for a result that is 2 138 short arrays. So the array is split at
 * top-level object boundaries and each object is parsed alone, which holds the
 * peak at one fiche.
 *
 * `--keep-fiches` writes the raw file so a rebuild during the same session does
 * not pull 191 MB twice; it is a developer convenience and never a source.
 * @param {string} url
 * @param {number} timeoutMs
 * @param {string|null} keepPath
 * @param {Set<string>} wanted Station ids worth parsing.
 * @returns {Promise<{families: Map<string, string[]>, seen: number}>}
 */
async function loadFamilies(url, timeoutMs, keepPath, wanted) {
  let text;
  if (keepPath && fs.existsSync(keepPath)) {
    process.stderr.write(`  fiches.json : relu depuis ${path.relative(ROOT, keepPath)}\n`);
    text = await fsp.readFile(keepPath, 'utf8');
  } else {
    text = await getText(url, timeoutMs);
    if (keepPath) await fsp.writeFile(keepPath, text, 'utf8');
  }

  const families = new Map();
  let seen = 0;
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === '{') { if (depth === 0) start = i; depth += 1; continue; }
    if (char !== '}') continue;
    depth -= 1;
    if (depth !== 0) continue;
    const fiche = JSON.parse(text.slice(start, i + 1));
    seen += 1;
    const id = String(fiche?.id ?? '').trim();
    if (!id || !wanted.has(id)) continue;
    families.set(id, familiesFromFiche(fiche) || []);
  }
  return { families, seen };
}

/**
 * Every station id with a published fiche climatologique.
 *
 * A paginated S3 listing, not a guess: asking for 1 578 files one HEAD at a
 * time would be 1 578 requests to learn a boolean the index already states.
 * @param {number} timeoutMs
 * @returns {Promise<Set<string>>}
 */
async function loadFicheIndex(timeoutMs) {
  const ids = new Set();
  let token = null;
  for (let page = 0; page < 40; page += 1) {
    const url = FICHECLIM_INDEX + (token ? `&continuation-token=${encodeURIComponent(token)}` : '');
    const xml = await getText(url, timeoutMs);
    for (const match of xml.matchAll(/FICHECLIM_(\d+)\.data/g)) ids.add(match[1]);
    const next = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml);
    if (!next) break;
    token = next[1];
  }
  return ids;
}

/**
 * Read the running-year SYNOP archive for WHICH stations actually publish.
 *
 * THIS IS WHY IT IS A DOWNLOAD AND NOT A PROBE. Météo-France publishes a *liste
 * des stations SYNOP* naming **62** stations, and the archive that list
 * describes contains **190** — Boulogne, Le Touquet, Dunkerque, Dieppe,
 * Beauvais-Tillé, Ouessant-Stiff and 123 others write an hourly open
 * observation the list does not mention. Every one of the 190 resolves to a
 * station in the real-time list. Trusting the list would have told a reader
 * that 128 stations publish nothing when they publish every hour.
 *
 * It cuts the other way too: **CAP CEPET (07661) is named in the list and has
 * written no observation at all this year.** So `live` is derived from the
 * archive, `synop` from the list, and the two are shipped separately because
 * they disagree in both directions.
 *
 * A failure here is reported and does not fail the build: the pack is about the
 * network, and the live reading is an enrichment.
 * @param {number} timeoutMs
 * @returns {Promise<{newest: string|null, stations: Set<string>}|null>}
 */
async function loadSynopCoverage(timeoutMs) {
  const year = new Date().getUTCFullYear();
  const url = `https://meteofrance.s3.sbg.io.cloud.ovh.net/data/synchro_ftp/OBS/SYNOP/synop_${year}.csv.gz`;
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const lines = readline.createInterface({
      input: Readable.fromWeb(response.body).pipe(zlib.createGunzip()),
      crlfDelay: Infinity,
    });
    let header = null;
    let validityAt = -1;
    let wmoAt = -1;
    let newest = null;
    const stations = new Set();
    for await (const line of lines) {
      if (!header) {
        header = splitSemicolon(line);
        validityAt = header.indexOf('validity_time');
        wmoAt = header.indexOf('geo_id_wmo');
        if (validityAt < 0 || wmoAt < 0) return null;
        continue;
      }
      const cells = line.split(';');
      const validity = cells[validityAt]?.trim();
      if (validity && (!newest || validity > newest)) newest = validity;
      const wmo = cells[wmoAt]?.trim();
      if (wmo) stations.add(wmo);
    }
    return { newest, stations };
  } catch {
    return null;
  }
}

function printReport(stations) {
  const byDep = new Map();
  for (const station of stations) {
    const dep = station.dep || '??';
    const bucket = byDep.get(dep) || { total: 0, wind: 0, pressure: 0, live: 0 };
    bucket.total += 1;
    if (station.fam?.includes('wind')) bucket.wind += 1;
    if (station.fam?.includes('pressure')) bucket.pressure += 1;
    if (station.live) bucket.live += 1;
    byDep.set(dep, bucket);
  }
  const rows = [...byDep.entries()].sort((a, b) => b[1].total - a[1].total);
  process.stderr.write('\n  dép.  stations   vent  pression   relevés\n');
  for (const [dep, bucket] of rows) {
    process.stderr.write(
      `  ${dep.padEnd(5)} ${String(bucket.total).padStart(8)} ${String(bucket.wind).padStart(6)}`
      + ` ${String(bucket.pressure).padStart(9)} ${String(bucket.live).padStart(9)}\n`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  process.stderr.write('Stations météo (FR) — construction du pack\n');

  const [listText, synopText, postesText] = await Promise.all([
    getText(RT_STATIONS_URL, args.timeout),
    getText(SYNOP_STATIONS_URL, args.timeout),
    getText(POSTES_URL, args.timeout),
  ]);

  const rows = parseSemicolonCsv(listText, 'liste temps réel');
  const stations = rows.map(projectStationRow).filter(Boolean);
  const dropped = rows.length - stations.length;
  if (dropped) process.stderr.write(`  ⚠ ${dropped} ligne(s) sans identité ou sans position — écartée(s)\n`);
  if (stations.length < MIN_STATIONS) {
    throw new Error(
      `liste temps réel : ${stations.length} stations, plancher ${MIN_STATIONS} — `
      + 'réponse tronquée en amont, rien n’est écrit',
    );
  }
  process.stderr.write(`  liste temps réel : ${stations.length} stations\n`);

  const synopIds = new Set(parseSemicolonCsv(synopText, 'liste SYNOP').map((row) => String(row.ID).trim()));
  process.stderr.write(`  SYNOP ouvert : ${synopIds.size} stations\n`);

  const postes = new Map(
    parseSemicolonCsv(postesText, 'POSTES_MF').map((row) => [String(row.NUM_POSTE).padStart(8, '0'), row]),
  );
  process.stderr.write(`  POSTES_MF : ${postes.size} postes depuis 1806\n`);

  const ficheIds = await loadFicheIndex(args.timeout);
  process.stderr.write(`  fiches climatologiques publiées : ${ficheIds.size}\n`);

  const wanted = new Set(stations.map((station) => station.id));
  process.stderr.write('  fiches.json : 191 Mo, lecture en flux…\n');
  const { families, seen } = await loadFamilies(FICHES_URL, args.timeout, args.keepFiches, wanted);
  process.stderr.write(`  fiches.json : ${seen} fiches lues, ${families.size} appariées\n`);

  const coverage = await loadSynopCoverage(args.timeout);
  const liveIds = coverage?.stations ?? new Set();
  if (coverage) {
    process.stderr.write(
      `  archive SYNOP : ${liveIds.size} stations publient en clair, `
      + `dernière observation ${coverage.newest}\n`,
    );
  } else {
    process.stderr.write('  ⚠ archive SYNOP injoignable — aucun relevé live ne sera annoncé\n');
  }

  const noFiche = [];
  const closed = [];
  for (const station of stations) {
    const poste = postes.get(station.id);
    const fam = families.get(station.id) ?? null;
    if (fam === null) noFiche.push(station);

    station.commune = poste ? (poste.COMMUNE || null) : null;
    station.place = poste ? (poste.LIEU_DIT || null) : null;
    station.type = poste && poste.TYPE_POSTE_ACTUEL !== '' ? Number(poste.TYPE_POSTE_ACTUEL) : null;
    // The seven closed stations the real-time list still carries. Flagged, kept.
    station.closed = poste && poste.DATFERM ? poste.DATFERM : null;
    if (station.closed) closed.push(station);
    // Two different claims, deliberately not merged — see `loadSynopCoverage`.
    // `synop` is what Météo-France's station list SAYS publishes openly;
    // `live` is what the archive it describes actually contains.
    station.synop = station.omm ? synopIds.has(station.omm) : false;
    station.live = station.omm ? liveIds.has(station.omm) : false;
    station.fiche = ficheIds.has(station.id);
    station.fam = fam;
    station.klass = classifyStation(fam);
  }

  if (noFiche.length) {
    process.stderr.write(
      `  ⚠ ${noFiche.length} station(s) absente(s) de toutes les métadonnées, inventaire inconnu : `
      + `${noFiche.map((s) => `${s.name} (${s.id})`).join(', ')}\n`,
    );
  }
  if (closed.length) {
    process.stderr.write(
      `  ⚠ ${closed.length} station(s) fermée(s) selon Météo-France mais toujours dans la liste temps réel : `
      + `${closed.map((s) => `${s.name} (${s.closed})`).join(', ')}\n`,
    );
  }

  const listedNotLive = stations.filter((station) => station.synop && !station.live);
  const liveNotListed = stations.filter((station) => station.live && !station.synop);
  if (coverage) {
    process.stderr.write(
      `  liste SYNOP contre archive : ${liveNotListed.length} station(s) publient sans être listées, `
      + `${listedNotLive.length} listée(s) ne publie(nt) rien`
      + `${listedNotLive.length ? ` (${listedNotLive.map((s) => s.name).join(', ')})` : ''}\n`,
    );
  }

  stations.sort((a, b) => a.id.localeCompare(b.id));
  const stats = summarizeStations(stations);

  if (args.report) printReport(stations);

  const document = {
    generated: new Date().toISOString().slice(0, 10),
    sources: [
      'Météo-France — Liste des stations du réseau d’observation temps réel (Licence Ouverte 2.0)',
      'Météo-France — Informations sur les stations, fiches.json (Licence Ouverte 2.0)',
      'Météo-France — Postes, POSTES_MF.csv (Licence Ouverte 2.0)',
      'Météo-France — Données SYNOP essentielles OMM, liste des stations (Licence Ouverte 2.0)',
    ],
    // The live product the layer's card depends on, with the freshness measured
    // at build time and BOTH counts kept. A reader comparing the card to the
    // file can tell whether a silent reading is an outage or a station that
    // never publishes — and can see that the published list is a third of the
    // product it names.
    synop: coverage
      ? { listed: synopIds.size, live: liveIds.size, newest: coverage.newest }
      : null,
    stats,
    // What the network holds and this file does not, stated in the file.
    excluded: {
      closedPostes: postes.size - stations.length,
      complementary: 'stations complémentaires (type 5) — publiées séparément, hors réseau temps réel',
      infoclimat: 'réseau StatIC — 553 des 1 138 stations françaises sont CC BY-NC',
    },
    stations,
  };

  await fsp.mkdir(path.dirname(args.out), { recursive: true });
  await fsp.writeFile(args.out, `${JSON.stringify(document, null, 0)}\n`, 'utf8');
  const bytes = (await fsp.stat(args.out)).size;

  process.stderr.write(
    `\n${path.relative(ROOT, args.out)} — ${stats.stations} stations `
    + `(${stats.metropole} métropole, ${stats.overseas} outre-mer), `
    + `${(bytes / 1024).toFixed(0)} KB\n`,
  );
  for (const key of STATION_CLASS_ORDER) {
    const count = stats.byClass[key] || 0;
    if (!count) continue;
    process.stderr.write(`  ${String(count).padStart(5)}  ${STATION_CLASSES[key].label}\n`);
  }
  process.stderr.write('  ─\n');
  for (const key of FAMILY_KEYS) {
    process.stderr.write(
      `  ${String(stats.byFamily[key] || 0).padStart(5)}  ${FAMILY_BY_KEY[key].label}\n`,
    );
  }
}

main().catch((error) => {
  process.stderr.write(`\n✖ ${error.message}\n`);
  process.exitCode = 1;
});
