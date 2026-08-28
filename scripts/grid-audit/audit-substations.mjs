/**
 * Does OSM know about the substations RTE published before it stopped?
 *
 * Reference: the archived ODRÉ export of 27 June 2023 (5,003 sites, WGS84,
 * Licence Ouverte 2.0) — RTE's own register, complete by construction.
 * Subject:   OpenStreetMap today, queried uncapped.
 *
 * The comparison is deliberately asymmetric. RTE's list is the truth for
 * "does this substation exist"; OSM is the truth for nothing, which is the
 * whole point of measuring it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { overpass } from './fetch-osm.mjs';
import { GridIndex, parseVolts } from './lib.mjs';
import { ensureReference, REFERENCE, CACHE_DIR } from './reference.mjs';

await ensureReference();
/** The layer's own floor: below this nothing is drawn, so nothing is audited. */
const MIN_VOLTS = 50_000;
/**
 * RTE's export is "Sites électriques RTE ET POINTS DE PIQUAGE": 816 of its
 * records are tap-offs carried on a pylon, not substations. OSM does not tag
 * those `power=substation` and is not wrong to refuse — so they are reported
 * separately rather than counted as misses.
 */
const SUBSTATION = 'Poste de transformation';
/** Métropole bbox, used only to drop the DOM from the OSM side. */
const METRO = { west: -5.3, south: 41.2, east: 9.7, north: 51.2 };

// ---------------------------------------------------------------------------
// Reference side — RTE, 27 June 2023
// ---------------------------------------------------------------------------
const archive = JSON.parse(fs.readFileSync(REFERENCE.substations, 'utf8'));

const reference = [];
const skipped = { noPosition: 0, notInService: 0, belowFloor: 0, unknownVoltage: 0 };
for (const record of archive) {
  const f = record.fields || {};
  if (!Number.isFinite(f.latitude_poste) || !Number.isFinite(f.longitude_poste)) {
    skipped.noPosition += 1;
    continue;
  }
  // "EN EXPLOITATION" is in service. Everything else is a project, a reserve,
  // or a decommissioned site — OSM is not wrong to be missing those.
  if (f.etat !== 'EN EXPLOITATION') {
    skipped.notInService += 1;
    continue;
  }
  const volts = parseVolts(f.tension);
  if (!volts.length) {
    skipped.unknownVoltage += 1;
    continue;
  }
  if (Math.max(...volts) < MIN_VOLTS) {
    skipped.belowFloor += 1;
    continue;
  }
  reference.push({
    code: f.code_poste,
    name: f.nom_poste,
    lon: f.longitude_poste,
    lat: f.latitude_poste,
    volts: Math.max(...volts),
    tension: f.tension,
    fonction: f.fonction_du_poste,
  });
}

// ---------------------------------------------------------------------------
// Subject side — OSM, today
// ---------------------------------------------------------------------------
const QUERY = `[out:json][timeout:900];
area["ISO3166-1"="FR"]["admin_level"="2"]->.fr;
(
  node["power"="substation"](area.fr);
  way["power"="substation"](area.fr);
  relation["power"="substation"](area.fr);
);
out center tags;`;

const payload = await overpass(QUERY, 'OSM substations, France');

const osmAll = [];
for (const el of payload.elements) {
  const lon = el.lon ?? el.center?.lon;
  const lat = el.lat ?? el.center?.lat;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
  if (lon < METRO.west || lon > METRO.east || lat < METRO.south || lat > METRO.north) continue;
  const volts = parseVolts(el.tags?.voltage);
  osmAll.push({
    id: `${el.type}/${el.id}`,
    lon,
    lat,
    volts: volts.length ? Math.max(...volts) : null,
    name: el.tags?.name || null,
    operator: el.tags?.operator || null,
    substation: el.tags?.substation || null,
  });
}
const osmHv = osmAll.filter((s) => s.volts !== null && s.volts >= MIN_VOLTS);

// ---------------------------------------------------------------------------
// Match
// ---------------------------------------------------------------------------
/** A substation yard is hundreds of metres across; these are the radii tested. */
const RADII = [250, 500, 1000, 2000];
const SEARCH = Math.max(...RADII);

const indexHv = new GridIndex(0.02);
for (const s of osmHv) indexHv.add(s.lon, s.lat, s);
const indexAny = new GridIndex(0.02);
for (const s of osmAll) indexAny.add(s.lon, s.lat, s);

const results = reference.map((ref) => {
  const hv = indexHv.near(ref.lon, ref.lat, SEARCH)[0] || null;
  const any = indexAny.near(ref.lon, ref.lat, SEARCH)[0] || null;
  return { ref, hv, any };
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const pct = (n, d) => `${((100 * n) / d).toFixed(1)}%`;
const line = (s = '') => process.stdout.write(`${s}\n`);

line('='.repeat(78));
line('SUBSTATIONS — OSM measured against RTE\'s own register (27 June 2023)');
line('='.repeat(78));
line();
line(`RTE archive                     : ${archive.length} sites`);
line(`  dropped, not in service       : ${skipped.notInService}`);
line(`  dropped, no voltage published : ${skipped.unknownVoltage}`);
line(`  dropped, below ${MIN_VOLTS / 1000} kV floor    : ${skipped.belowFloor}`);
line(`  dropped, no position          : ${skipped.noPosition}`);
line(`REFERENCE SET                   : ${reference.length} in-service sites at >= ${MIN_VOLTS / 1000} kV`);
line(`  of which real substations     : ${reference.filter((r) => r.fonction === SUBSTATION).length}`);
line(`  of which tap points (piquage) : ${reference.filter((r) => r.fonction !== SUBSTATION).length}`);
line();
line(`OSM power=substation in France  : ${osmAll.length}`);
line(`  ... carrying a voltage >= ${MIN_VOLTS / 1000} kV : ${osmHv.length}   <- what our layer draws`);
line(`  ... no voltage tag at all     : ${osmAll.filter((s) => s.volts === null).length}`);
line();
for (const [heading, note, subset] of [
  [
    'SUBSTATIONS PROPER — the comparison that means something',
    null,
    results.filter((x) => x.ref.fonction === SUBSTATION),
  ],
  [
    'TAP POINTS (poste de piquage) — reported apart',
    'These sit on a PYLON, not in a yard, so OSM has no reason to call them a\nsubstation and mostly does not. A low rate here is a taxonomy difference,\nnot a coverage gap.',
    results.filter((x) => x.ref.fonction !== SUBSTATION),
  ],
]) {
  line(heading);
  if (note) line(note);
  line();
  line('   R      matched by an OSM site   ... that also carries >= 50 kV');
  for (const r of RADII) {
    const anyHit = subset.filter((x) => x.any && x.any.distance <= r).length;
    const hvHit = subset.filter((x) => x.hv && x.hv.distance <= r).length;
    line(
      `  ${String(r).padStart(4)} m   ${String(anyHit).padStart(5)} / ${subset.length}  ${pct(anyHit, subset.length).padStart(6)}` +
        `      ${String(hvHit).padStart(5)}  ${pct(hvHit, subset.length).padStart(6)}`,
    );
  }
  line();
}

const substations = results.filter((x) => x.ref.fonction === SUBSTATION);
const matched = substations.filter((x) => x.hv && x.hv.distance <= 1000);
const dists = matched.map((x) => x.hv.distance).sort((a, b) => a - b);
const q = (p) => Math.round(dists[Math.floor(dists.length * p)] || 0);
line(`Offset RTE point -> OSM centre (matched at 1 km): median ${q(0.5)} m, p90 ${q(0.9)} m`);
line();

// Voltage agreement, on sites both sides agree exist.
let agree = 0;
let osmHigher = 0;
let osmLower = 0;
for (const x of matched) {
  if (x.hv.value.volts === x.ref.volts) agree += 1;
  else if (x.hv.value.volts > x.ref.volts) osmHigher += 1;
  else osmLower += 1;
}
line(`Voltage agreement on ${matched.length} matched sites:`);
line(`  identical highest voltage     : ${agree} (${pct(agree, matched.length)})`);
line(`  OSM states a higher voltage   : ${osmHigher} (${pct(osmHigher, matched.length)})`);
line(`  OSM states a lower voltage    : ${osmLower} (${pct(osmLower, matched.length)})`);
line();

// Where OSM is silent, by voltage band — the actionable part.
const missing = substations.filter((x) => !x.hv || x.hv.distance > 1000);
const byBand = new Map();
for (const x of missing) {
  const band = x.ref.volts >= 300_000 ? '>= 300 kV' : x.ref.volts >= 180_000 ? '180-299 kV' : x.ref.volts >= 100_000 ? '100-179 kV' : '50-99 kV';
  byBand.set(band, (byBand.get(band) || 0) + 1);
}
const refByBand = new Map();
for (const r of reference.filter((x) => x.fonction === SUBSTATION)) {
  const band = r.volts >= 300_000 ? '>= 300 kV' : r.volts >= 180_000 ? '180-299 kV' : r.volts >= 100_000 ? '100-179 kV' : '50-99 kV';
  refByBand.set(band, (refByBand.get(band) || 0) + 1);
}
line('SUBSTATIONS MISSING FROM OSM AT >= 50 kV, by band (none within 1 km):');
for (const band of ['>= 300 kV', '180-299 kV', '100-179 kV', '50-99 kV']) {
  const miss = byBand.get(band) || 0;
  const total = refByBand.get(band) || 0;
  if (!total) continue;
  line(`  ${band.padEnd(11)} ${String(miss).padStart(4)} of ${String(total).padStart(4)}   ${pct(miss, total).padStart(6)} missing`);
}
line();

const drawnButUntagged = missing.filter((x) => x.any && x.any.distance <= 1000).length;
line(`Of those, OSM DOES map ${drawnButUntagged} — it just gives them no usable voltage,`);
line(`so our own >= 50 kV filter is what drops them, not OSM's silence.`);
line();

fs.writeFileSync(
  path.join(CACHE_DIR, 'out-substations.json'),
  JSON.stringify(
    {
      referenceCount: reference.length,
      osmAll: osmAll.length,
      osmHv: osmHv.length,
      missing: missing.map((x) => ({
        code: x.ref.code,
        name: x.ref.name,
        tension: x.ref.tension,
        lon: x.ref.lon,
        lat: x.ref.lat,
        nearestAnyOsm: x.any ? { id: x.any.value.id, distance: Math.round(x.any.distance), voltage: x.any.value.volts } : null,
      })),
    },
    null,
    1,
  ),
);
line(`Detail for every miss written to ${path.join(CACHE_DIR, 'out-substations.json')}`);
