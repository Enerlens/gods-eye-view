#!/usr/bin/env node
/**
 * qa-vessel-destinations — how much of what a master TYPES the map can name.
 *
 * `portDirectory.js` turns the twenty-character AIS `destination` field into a
 * place. Every percentage in that module's header came from running this, and
 * the number is not a detail: it is the share of vessel cards that say
 * `→ Antwerpen · 26 km` instead of `→ BEANR`.
 *
 * WHAT IT MEASURES, AND AGAINST WHAT
 * ----------------------------------
 * Three indexes over the same live sample, so the two additions are separable
 * rather than folded into one headline:
 *
 *   1. the **World Port Index** alone — 2 951 sea harbours, what the app drew
 *      before 2026-09-09;
 *   2. plus the **UN/LOCODE ports** of `gazetteer.json` — the inland river
 *      ports the WPI is not an index of;
 *   3. plus its **exonyms** — `ANTWERP` for `Antwerpen`, `GENOA` for `Genova`.
 *
 * It also prints the two things a census hides: the distance distribution of
 * NAME matches, which is what {@link PORT_GAZETTEER_NAME_MATCH_MAX_M} was cut
 * from, and the unresolved field values by frequency, which is the only honest
 * way to know whether the remainder is a gap or simply not a place.
 *
 * THE SAMPLE
 * ----------
 * Harvested from the running dev server's `/api/ais-live`, one poll every
 * `--interval` seconds for `--minutes`, keyed on MMSI so a vessel seen forty
 * times counts once. Needs `AISSTREAM_API_KEY` in the environment the server
 * was started with; without it the endpoint answers 503 and this reports "not
 * testable here" rather than failing.
 *
 * `--save FILE` writes the harvest and `--sample FILE` replays one, which is
 * what makes a ceiling reproducible: the same afternoon's fleet, re-scored
 * against a changed rule.
 *
 * Run:
 *   node scripts/qa-vessel-destinations.mjs --url http://localhost:4173
 *   node scripts/qa-vessel-destinations.mjs --sample /tmp/ais-sample.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PORT_GAZETTEER_NAME_MATCH_MAX_M,
  PORT_NAME_MATCH_MAX_M,
  buildPortIndex,
  foldPortKey,
  matchDestinationToPort,
  portDistanceM,
} from '../src/data/portDirectory.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORTS_DIR = path.join(HERE, '..', 'src', 'data', 'local_data', 'ports');

const argv = process.argv.slice(2);
const opt = (name, dflt = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const APP_URL = opt('--url', 'http://localhost:4173');
const MINUTES = Number(opt('--minutes', 20));
const INTERVAL_SEC = Number(opt('--interval', 90));
const SAMPLE_IN = opt('--sample');
const SAMPLE_OUT = opt('--save');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One poll of the live subscription, folded to what this harness scores. */
async function pollVessels(url) {
  const res = await fetch(`${url.replace(/\/$/, '')}/api/ais-live`, {
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).rows || [];
}

/**
 * Harvest distinct vessels carrying a destination.
 *
 * Keyed on MMSI and LAST WRITE WINS: a vessel that changes its destination
 * mid-run is one vessel, and the field it is carrying at the end is the one a
 * reader would have clicked on.
 */
async function harvest() {
  const polls = Math.max(1, Math.round((MINUTES * 60) / INTERVAL_SEC));
  const seen = new Map();
  console.log(`\nRécolte : ${polls} relevés à ${INTERVAL_SEC} s sur ${APP_URL}\n`);
  for (let i = 0; i < polls; i += 1) {
    try {
      const rows = await pollVessels(APP_URL);
      for (const row of rows) {
        const destination = String(row.destination || '').trim();
        if (!destination) continue;
        seen.set(String(row.mmsi), {
          mmsi: String(row.mmsi), destination, lat: row.lat, lon: row.lon, name: row.name,
        });
      }
      console.log(`  [${String(i + 1).padStart(2)}/${polls}] ${rows.length} navires, `
        + `${seen.size} avec une destination`);
    } catch (error) {
      console.log(`  [${String(i + 1).padStart(2)}/${polls}] ${error.message}`);
      if (i === 0) return null; // the endpoint is not answering at all
    }
    if (i < polls - 1) await sleep(INTERVAL_SEC * 1000);
  }
  return [...seen.values()];
}

/** Score one sample against one index. */
function census(sample, index) {
  const out = { locode: 0, name: 0, none: 0, gazetteer: 0, matches: [], unresolved: new Map() };
  for (const vessel of sample) {
    const from = { lat: vessel.lat, lon: vessel.lon };
    const match = matchDestinationToPort(vessel.destination, index, from);
    if (!match) {
      out.none += 1;
      const key = foldPortKey(vessel.destination) || '(vide)';
      out.unresolved.set(key, (out.unresolved.get(key) || 0) + 1);
      continue;
    }
    if (match.how === 'locode') out.locode += 1; else out.name += 1;
    if (match.port.gazetteer) out.gazetteer += 1;
    out.matches.push({
      destination: vessel.destination,
      port: match.port,
      how: match.how,
      km: portDistanceM(vessel.lat, vessel.lon, match.port.lat, match.port.lon) / 1000,
    });
  }
  return out;
}

function line(label, result, total) {
  const resolved = total - result.none;
  console.log(`  ${label.padEnd(34)} ${String(resolved).padStart(5)} / ${total}`
    + `  (${((resolved / total) * 100).toFixed(1)} %)`
    + `   code ${String(result.locode).padStart(4)} · nom ${String(result.name).padStart(4)}`);
}

async function main() {
  const features = fs.readFileSync(path.join(PORTS_DIR, 'ports.geojsonl'), 'utf8')
    .split('\n').filter(Boolean).map((row) => JSON.parse(row));
  let gazetteer = null;
  try {
    gazetteer = JSON.parse(fs.readFileSync(path.join(PORTS_DIR, 'gazetteer.json'), 'utf8'));
  } catch {
    console.log('  ○ pas de gazetteer.json — `node scripts/build-port-gazetteer.mjs` le fabrique');
  }

  const sample = SAMPLE_IN
    ? JSON.parse(fs.readFileSync(SAMPLE_IN, 'utf8'))
    : await harvest();
  if (!sample?.length) {
    console.log('\n  ○ aucun navire avec destination — non mesurable ici\n');
    process.exit(0);
  }
  if (SAMPLE_OUT) fs.writeFileSync(SAMPLE_OUT, JSON.stringify(sample), 'utf8');

  const wpiOnly = buildPortIndex(features);
  const portsOnly = buildPortIndex(features, gazetteer ? { ports: gazetteer.ports } : null);
  const full = buildPortIndex(features, gazetteer);

  console.log(`\n--- Le recensement, sur ${sample.length} navires distincts ---\n`);
  const a = census(sample, wpiOnly);
  line('World Port Index seul', a, sample.length);
  const b = census(sample, portsOnly);
  line('+ les ports UN/LOCODE', b, sample.length);
  const c = census(sample, full);
  line('+ leurs exonymes', c, sample.length);
  console.log(`\n  L'index complet : ${full.ports} escales du WPI, `
    + `${full.gazetteerPorts} lieux du gazetteer, ${full.aliases} graphies, `
    + `${full.contestedNames} noms partagés par plusieurs lieux.`);

  // The distance distribution the two ceilings were cut from.
  console.log('\n--- Distance des correspondances par NOM ---\n');
  const bins = [0, 5, 25, 100, 200, 300, 500, 800, 1500, 3000, 20000];
  const named = c.matches.filter((m) => m.how === 'name').sort((x, y) => x.km - y.km);
  for (let i = 0; i < bins.length - 1; i += 1) {
    const inBin = named.filter((m) => m.km >= bins[i] && m.km < bins[i + 1]);
    if (!inBin.length) continue;
    console.log(`  ${String(bins[i]).padStart(5)}–${String(bins[i + 1]).padStart(5)} km : `
      + `${String(inBin.length).padStart(4)}   dont gazetteer ${inBin.filter((m) => m.port.gazetteer).length}`);
  }
  const over = named.filter((m) => m.port.gazetteer && m.km * 1000 > PORT_GAZETTEER_NAME_MATCH_MAX_M);
  console.log(`\n  ${over.length === 0 ? '✔' : '✖'} aucune correspondance du gazetteer ne dépasse `
    + `son plafond de ${PORT_GAZETTEER_NAME_MATCH_MAX_M / 1000} km`
    + `${over.length ? ` — ${over.map((m) => m.destination).join(', ')}` : ''}`);
  const overWpi = named.filter((m) => !m.port.gazetteer && m.km * 1000 > PORT_NAME_MATCH_MAX_M);
  console.log(`  ${overWpi.length === 0 ? '✔' : '✖'} aucune correspondance du WPI ne dépasse `
    + `son plafond de ${PORT_NAME_MATCH_MAX_M / 1000} km`);

  console.log('\n--- Ce que le gazetteer a résolu (30 premiers) ---\n');
  const gaz = new Map();
  for (const m of c.matches.filter((x) => x.port.gazetteer)) {
    const key = `${m.destination} → ${m.port.name} (${m.port.unlocode}) ${Math.round(m.km)} km`;
    gaz.set(key, (gaz.get(key) || 0) + 1);
  }
  console.log([...gaz.entries()].sort((x, y) => y[1] - x[1]).slice(0, 30)
    .map(([k, n]) => `  ${String(n).padStart(3)}  ${k}`).join('\n') || '  (aucune)');

  console.log('\n--- Ce qui reste non résolu (30 premiers) ---\n');
  console.log([...c.unresolved.entries()].sort((x, y) => y[1] - x[1]).slice(0, 30)
    .map(([k, n]) => `  ${String(n).padStart(3)}  ${k}`).join('\n'));
  console.log('');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
