#!/usr/bin/env node
/**
 * Build the "pouls vélo" pack — one typical week of cycling in Lyon and in
 * Paris, hour by hour, from the two cities' own archives.
 *
 * WHY THE TWO CITIES ARE MEASURED BY DIFFERENT INSTRUMENTS, WHICH IS THE
 * LAYER'S WHOLE ARGUMENT.
 *
 * The Métropole de Lyon publishes the availability of every Vélo'v station
 * continuously since 2023-03-27 — a real archive, filterable per station and
 * per date, and the only one of its kind in France. **Paris publishes no
 * equivalent for Vélib' at all.** Verified 2026-09-02: opendata.paris.fr carries
 * only the real-time dataset (2 velib datasets, both live), data.gouv.fr has no
 * availability history, transport.data.gouv.fr's `history` array for the Vélib'
 * dataset is empty, and the community archive everyone cites —
 * `lovasoa/historique-velib-opendata` — was last pushed 2023-04-04 with release
 * assets dated 2021.
 *
 * So Paris cannot be shown through its docks. What Paris DOES publish, and Lyon
 * publishes far less usably, is permanent counters: 113 of them, hourly, with
 * roughly thirteen months of rolling history, refreshed daily.
 *
 * The two cities therefore answer through different instruments:
 *
 *   · **Lyon — STOCKS.** How full each Vélo'v station is, hour by hour. A dock
 *     that empties every morning and refills every evening is a commuter
 *     origin; the reverse is a destination.
 *   · **Paris — FLOWS.** How many cyclists pass each counter, hour by hour. A
 *     count of people going by, not of bicycles standing still.
 *
 * A layer that drew both in one colour ramp and called it "cycling" would be
 * lying by omission. This pack keeps the unit on every city and the layer keeps
 * it on every card.
 *
 * TWO TRAPS, BOTH MEASURED, BOTH FATAL IF MISSED.
 *
 *   1. **Paris timestamps are UTC and the profile is LOCAL.** The ODS `date`
 *      field is `2026-06-01T00:00:00+00:00`. Grouping on `date_format(date,
 *      "H")` without a timezone yields the UTC hour, and the morning peak lands
 *      at 04:00-05:00 — measured on counter 100003096, whose 04:00 bucket reads
 *      38 without the timezone and 4 with it. Every query below passes
 *      `timezone=Europe/Paris`. A two-hour shift is exactly the kind of error
 *      that produces a plausible-looking chart.
 *   2. **Lyon's archive does not write every station every minute.** A 5-minute
 *      window over the whole network returned 332 of 454 stations in one probe
 *      and 360 in another; a 10-minute window returned all 454. This script
 *      samples a 5-minute window per hour and relies on FOUR weeks to fill the
 *      gaps — a station present 73 % of the time is present in at least one of
 *      four samples 99.5 % of the time — and it records `samples[i]` per slot so
 *      the layer can say how many of the four actually landed.
 *
 * WHY ONE FIXED FOUR-WEEK WINDOW AND NOT "ALL OF IT". A typical week in June is
 * not a typical week in January, and averaging thirteen months would hide that
 * rather than solve it. Both cities are read over the SAME four weeks so the two
 * pictures describe the same days: June is chosen because it is an ordinary
 * month in France — August is the holiday exodus and would flatter Lyon's
 * quieter stations, and the winter months would flatter neither.
 *
 * COST, measured 2026-09-02:
 *   · Paris: 113 requests, one aggregation per counter, ~10 KB each.
 *   · Lyon: 672 requests (one per hour of the window), ~325 KB each — about
 *     220 MB pulled once. Paced at 300 ms so the Métropole's portal is never
 *     asked for more than three windows a second.
 *
 * Usage: node scripts/build-velo-pulse.mjs [--start 2026-06-01] [--weeks 4] [--dry]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, 'src', 'data', 'local_data', 'velo_pulse');
const OUT_FILE = path.join(OUT_DIR, 'pulse.json');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
/** The Monday the window opens on. June: an ordinary month. See the header. */
const START = option('--start', '2026-06-01');
const WEEKS = Number(option('--weeks', '4'));
const DRY = args.includes('--dry');
const LYON_ONLY = args.includes('--lyon-only');
const PARIS_ONLY = args.includes('--paris-only');

/** Hours in a week. The profile index everywhere in this pack. */
const SLOTS = 168;
/** Politeness between Lyon window requests, in ms. */
const LYON_PACE_MS = 300;
/** Politeness between Paris aggregation requests, in ms. */
const PARIS_PACE_MS = 120;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @param {string} url @param {object} [options] */
async function getJson(url, { attempts = 3, timeoutMs = 120_000 } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(500 * attempt);
    }
  }
  throw lastError;
}

/**
 * The hour-of-week index for a LOCAL wall-clock date and hour.
 *
 * 0 is Monday 00:00 local. Local, never UTC: a typical week is a local
 * phenomenon — the morning peak is at 8 a.m. where the cyclist is, not at
 * 6 a.m. in Greenwich — and both sources are read in local time for that
 * reason. `Date.UTC` is used only to get the weekday of a calendar date
 * without a timezone ever entering the arithmetic.
 *
 * @param {number} year @param {number} month 1-12 @param {number} day
 * @param {number} hour 0-23
 * @returns {number} 0..167
 */
export function slotIndex(year, month, day, hour) {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  // getUTCDay: 0 = Sunday. The pack's week starts on Monday.
  const isoDay = weekday === 0 ? 6 : weekday - 1;
  return isoDay * 24 + hour;
}

/** `2026-08-25 08:00:00+02:00` → its local slot. */
export function slotFromLyonStamp(stamp) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2})/.exec(String(stamp ?? ''));
  if (!match) return null;
  return slotIndex(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]));
}

/** ISO weekday 1-7 (Monday first) and an hour, as ODS reports them. */
export function slotFromParisGroup(dow, hour) {
  const day = Number(dow);
  const h = Number(hour);
  if (!Number.isInteger(day) || day < 1 || day > 7) return null;
  if (!Number.isInteger(h) || h < 0 || h > 23) return null;
  return (day - 1) * 24 + h;
}

/** Every hour in the window, as `YYYY-MM-DD HH`. */
export function windowHours(startISO, weeks) {
  const start = new Date(`${startISO}T00:00:00Z`);
  const hours = [];
  for (let index = 0; index < weeks * SLOTS; index += 1) {
    const at = new Date(start.getTime() + index * 3_600_000);
    hours.push({
      year: at.getUTCFullYear(),
      month: at.getUTCMonth() + 1,
      day: at.getUTCDate(),
      hour: at.getUTCHours(),
    });
  }
  return hours;
}

const pad = (value) => String(value).padStart(2, '0');
const stamp = ({ year, month, day, hour }, minute) => (
  `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:00`
);

// ---------------------------------------------------------------------------
// Lyon — Vélo'v dock occupancy
// ---------------------------------------------------------------------------
const LYON_HISTORY = 'https://data.grandlyon.com/fr/datapusher/ws/timeseries/jcd_jcdecaux.historiquevelov/all.json';
const LYON_STATIONS = 'https://data.grandlyon.com/fr/datapusher/ws/rdata/jcd_jcdecaux.jcdvelov/all.json?maxfeatures=2000';

/**
 * Occupancy of one archive row, as a percentage of its own capacity.
 *
 * `total_stands` and not `main_stands`: the overflow racks are part of the
 * station a cyclist sees, and a station whose main rack is full while its
 * overflow is empty is not a full station.
 *
 * @param {object} row
 * @returns {number|null} 0..100, or null when the row cannot say.
 */
export function rowOccupancy(row) {
  const total = row?.total_stands;
  const capacity = Number(total?.capacity);
  const bikes = Number(total?.availabilities?.bikes);
  if (!Number.isFinite(capacity) || capacity <= 0) return null;
  if (!Number.isFinite(bikes) || bikes < 0) return null;
  return Math.min(100, (bikes / capacity) * 100);
}

async function buildLyon() {
  process.stderr.write('Lyon — Vélo\'v\n');
  const referential = await getJson(LYON_STATIONS);
  const stations = new Map();
  for (const row of referential.values || []) {
    const number = Number(row.number);
    const lon = Number(row.lng);
    const lat = Number(row.lat);
    if (!Number.isFinite(number) || !Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    stations.set(number, {
      id: String(number),
      name: String(row.name || '').replace(/^\d+\s*-\s*/, '').trim() || `Station ${number}`,
      commune: row.commune ?? null,
      lon: Math.round(lon * 1e5) / 1e5,
      lat: Math.round(lat * 1e5) / 1e5,
      capacity: Number(row.total_stands) || Number(row.bike_stands) || null,
      sum: new Array(SLOTS).fill(0),
      samples: new Array(SLOTS).fill(0),
    });
  }
  process.stderr.write(`  referential: ${stations.size} stations\n`);

  const hours = windowHours(START, WEEKS);
  let unknownStations = 0;
  let bytes = 0;
  for (const [index, hour] of hours.entries()) {
    const query = new URLSearchParams({
      horodate__gte: stamp(hour, 0),
      horodate__lte: stamp(hour, 5),
      maxfeatures: '6000',
    });
    let payload = null;
    try {
      payload = await getJson(`${LYON_HISTORY}?${query}`);
    } catch (error) {
      process.stderr.write(`\n  ${stamp(hour, 0)}: ${error.message}\n`);
    }
    const rows = payload?.values || [];
    bytes += JSON.stringify(rows).length;
    // LAST row per station in the window: the closest thing the archive has to
    // a snapshot at HH:05.
    const latest = new Map();
    for (const row of rows) {
      const number = Number(row.number);
      const previous = latest.get(number);
      if (!previous || String(row.horodate) > String(previous.horodate)) latest.set(number, row);
    }
    const slot = slotIndex(hour.year, hour.month, hour.day, hour.hour);
    for (const [number, row] of latest) {
      const station = stations.get(number);
      if (!station) { unknownStations += 1; continue; }
      // A CLOSED station is not an empty station, and averaging it in as 0 %
      // would draw a maintenance outage as a commuter origin.
      if (String(row.status).toUpperCase() !== 'OPEN') continue;
      const occupancy = rowOccupancy(row);
      if (occupancy === null) continue;
      station.sum[slot] += occupancy;
      station.samples[slot] += 1;
    }
    if (index % 24 === 0) {
      process.stderr.write(`  ${stamp(hour, 0)}  ${index + 1}/${hours.length}`
        + `  ${(bytes / 1e6).toFixed(0)} MB\r`);
    }
    await sleep(LYON_PACE_MS);
  }
  process.stderr.write('\n');

  const sites = [];
  for (const station of stations.values()) {
    const filled = station.samples.filter((n) => n > 0).length;
    // A station sampled in fewer than half the week's hours cannot describe a
    // week. Dropped, and counted, rather than drawn with holes in it.
    if (filled < SLOTS / 2) continue;
    sites.push({
      id: station.id,
      name: station.name,
      commune: station.commune,
      lon: station.lon,
      lat: station.lat,
      capacity: station.capacity,
      // Occupancy in tenths of a percent, as an integer: 0..1000. A float per
      // slot would triple the pack for precision the source does not have.
      profile: station.sum.map((total, i) => (
        station.samples[i] ? Math.round((total / station.samples[i]) * 10) : null
      )),
      samples: station.samples,
    });
  }
  const dropped = stations.size - sites.length;
  process.stderr.write(`  kept ${sites.length} stations, dropped ${dropped} under-sampled`
    + `, ${unknownStations} rows for stations absent from the referential\n`);
  return {
    label: 'Lyon — Vélo\'v',
    instrument: 'stock',
    unit: 'remplissage de la station, en %',
    scale: 1000,
    source: 'Métropole de Lyon / JCDecaux — historique des disponibilités Vélo\'v',
    sourceUrl: 'https://data.grandlyon.com/portail/fr/jeux-de-donnees/historique-disponibilites-stations-velo-v-metropole-lyon/donnees',
    licence: 'Licence Ouverte 2.0',
    sites,
    stats: {
      referential: stations.size,
      kept: sites.length,
      dropped,
      bytesFetched: bytes,
      requests: hours.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Paris — permanent bike counters
// ---------------------------------------------------------------------------
const PARIS_BASE = 'https://opendata.paris.fr/api/explore/v2.1/catalog/datasets';
const PARIS_COUNTS = `${PARIS_BASE}/comptage-velo-donnees-compteurs/records`;

async function buildParis() {
  process.stderr.write('Paris — compteurs vélo\n');
  const end = new Date(new Date(`${START}T00:00:00Z`).getTime() + WEEKS * 7 * 86_400_000);
  const endISO = end.toISOString().slice(0, 10);
  const where = `date >= date'${START}' AND date < date'${endISO}'`;

  // The referential carries the position; the measures carry the counts. They
  // join on `id_compteur`, which is `<site>-<channel>`.
  const referential = await getJson(
    `${PARIS_BASE}/comptage-velo-compteurs/records?limit=100&offset=0`,
  );
  const second = await getJson(
    `${PARIS_BASE}/comptage-velo-compteurs/records?limit=100&offset=100`,
  );
  const counters = [...(referential.results || []), ...(second.results || [])];
  process.stderr.write(`  referential: ${counters.length} counters\n`);

  const sites = [];
  let missing = 0;
  for (const [index, counter] of counters.entries()) {
    const id = counter.id_compteur;
    if (!id) { missing += 1; continue; }
    const query = new URLSearchParams({
      select: 'sum(sum_counts) as total, count(*) as n',
      where: `${where} AND id_compteur='${id}'`,
      group_by: 'date_format(date, "e") as dow, date_format(date, "H") as hour',
      // WITHOUT THIS THE WHOLE PROFILE IS SHIFTED TWO HOURS. The stored `date`
      // is UTC; measured on counter 100003096, the 04:00 bucket reads 38
      // without a timezone and 4 with it. See the module header.
      timezone: 'Europe/Paris',
      limit: '200',
    });
    let payload = null;
    try {
      payload = await getJson(`${PARIS_COUNTS}?${query}`);
    } catch (error) {
      process.stderr.write(`\n  ${id}: ${error.message}\n`);
    }
    const profile = new Array(SLOTS).fill(null);
    const samples = new Array(SLOTS).fill(0);
    for (const row of payload?.results || []) {
      const slot = slotFromParisGroup(row.dow, row.hour);
      if (slot === null) continue;
      const weeks = Number(row.n);
      const total = Number(row.total);
      if (!Number.isFinite(weeks) || weeks <= 0 || !Number.isFinite(total)) continue;
      profile[slot] = Math.round(total / weeks);
      samples[slot] = weeks;
    }
    const filled = samples.filter((n) => n > 0).length;
    if (filled < SLOTS / 2) { missing += 1; continue; }

    // The referential publishes the position under `coordinates`; a counter
    // without one cannot be drawn and is not drawn.
    const lon = Number(counter.coordinates?.lon);
    const lat = Number(counter.coordinates?.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) { missing += 1; continue; }

    sites.push({
      id,
      // `nom_compteur` carries the direction ("Pont National SO-NE"); the site
      // name and the channel are kept apart so a card can say both.
      name: counter.name || counter.nom_compteur || id,
      direction: counter.channel_name ?? null,
      installedOn: counter.installation_date ?? null,
      lon: Math.round(lon * 1e5) / 1e5,
      lat: Math.round(lat * 1e5) / 1e5,
      profile,
      samples,
    });
    if (index % 10 === 0) {
      process.stderr.write(`  ${index + 1}/${counters.length}\r`);
    }
    await sleep(PARIS_PACE_MS);
  }
  process.stderr.write('\n');
  process.stderr.write(`  kept ${sites.length} counters, dropped ${missing}\n`);
  return {
    label: 'Paris — compteurs vélo',
    instrument: 'flow',
    unit: 'cyclistes comptés par heure',
    scale: 1,
    source: 'Ville de Paris — comptage vélo, données compteurs',
    sourceUrl: 'https://opendata.paris.fr/explore/dataset/comptage-velo-donnees-compteurs/',
    licence: 'ODbL',
    sites,
    stats: { referential: counters.length, kept: sites.length, dropped: missing },
  };
}

async function main() {
  const end = new Date(new Date(`${START}T00:00:00Z`).getTime() + WEEKS * 7 * 86_400_000 - 86_400_000);
  const window = { start: START, end: end.toISOString().slice(0, 10), weeks: WEEKS };
  process.stderr.write(`Window: ${window.start} → ${window.end} (${WEEKS} weeks)\n\n`);

  const cities = {};
  if (!PARIS_ONLY) cities.lyon = await buildLyon();
  if (!LYON_ONLY) cities.paris = await buildParis();

  const pack = {
    generated: new Date().toISOString(),
    window,
    slots: SLOTS,
    // Stated in the pack rather than only in this script, because the layer
    // prints it: a typical week in June is not a typical week in January, and
    // a reader who does not know which four weeks these are cannot judge it.
    note: 'Semaine type = moyenne heure par heure sur quatre semaines de juin 2026. '
      + 'Lyon mesure des STOCKS (remplissage des stations Vélo\'v), Paris des FLUX '
      + '(cyclistes comptés). Paris ne publie aucun historique de disponibilité Vélib\'.',
    cities,
  };

  if (DRY) {
    process.stderr.write('\n--dry: nothing written\n');
    process.stdout.write(`${JSON.stringify({ ...pack, cities: Object.fromEntries(
      Object.entries(cities).map(([key, city]) => [key, { ...city, sites: city.sites.length }]),
    ) }, null, 2)}\n`);
    return;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(pack));
  const size = fs.statSync(OUT_FILE).size;
  process.stderr.write(`\nWrote ${path.relative(REPO_ROOT, OUT_FILE)} — ${(size / 1024).toFixed(0)} KB\n`);
  for (const [key, city] of Object.entries(cities)) {
    process.stderr.write(`  ${key}: ${city.sites.length} sites, ${city.instrument}, ${city.unit}\n`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
