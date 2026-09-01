#!/usr/bin/env node
/**
 * Build `src/data/local_data/rte_production_units/units.json` — the shipped
 * register of every French generating unit RTE's `actual_generations_per_unit`
 * resource can speak about, and the coordinates to draw it at.
 *
 * WHY THIS SCRIPT EXISTS: **RTE publishes no coordinate for any unit.** Its
 * API returns an EIC code, a name, a production type and a number of
 * megawatts. To put that number anywhere on a globe you have to join it to
 * something that knows where the machine is — and no single open dataset knows
 * both. So four are joined here, at authoring time, and the result is
 * committed so every row is auditable in the diff rather than derived live
 * from four services that can each drift.
 *
 *   1. **ODRÉ — Registre national des installations de production et de
 *      stockage d'électricité** (Licence Ouverte 2.0). The spine: EIC code,
 *      installed power, filière, commune, connection substation, regime. 171
 *      units at or above the 100 MW publication floor as of 2026-08-28.
 *      Coordinates: none.
 *
 *   2. **EDF Open Data** (Licence Ouverte 2.0), three files on the portal's
 *      native data-fair routes: the localisation of EDF SA's own nuclear,
 *      hydraulic and thermal stations. 79 stations, and their `centrale` column
 *      is written in the same shouted convention as the register's own names.
 *
 *   3. **OpenStreetMap** (ODbL 1.0), via Overpass: `power=plant` areas, and
 *      `power=substation` yards carrying `ref:FR:RTE` — the same five-character
 *      substation code the register publishes as `postesource`. 4 131 of them
 *      over France.
 *
 *   4. **geo.api.gouv.fr** (Licence Ouverte), for the centre of the commune the
 *      register names, as the anchor of last resort.
 *
 * ── The placement rule, and why it is written down per site ─────────────────
 *
 * Every site records WHICH of the four anchors it got, and how far that anchor
 * sits from the commune the register names. In order:
 *
 *   `edf-published`   the operator's own coordinate for its own station. The
 *                     shortest path from a published name to a published point,
 *                     and the only tier where nothing is inferred about WHICH
 *                     object the station is.
 *   `osm-plant`       the OpenStreetMap `power=plant` whose name matches the
 *                     station's, of a compatible source, uniquely. The station
 *                     itself, as volunteers mapped it.
 *   `rte-switchyard`  the OSM substation whose `ref:FR:RTE` IS the register's
 *                     `postesource`. Not the generating hall, but the yard the
 *                     units connect to — on-site for a nuclear or thermal
 *                     station, and sometimes a valley away for hydro.
 *   `commune-centre`  the centre of the commune. Right to within the commune
 *                     and no further, which the card says.
 *
 * **Why EDF outranks OpenStreetMap.** Measured 2026-08-28 across the 69
 * stations where both publish a position: they agree to within 300 m on every
 * reactor and every thermal site, so on those the order is nearly a free
 * choice — and diverge by up to 9.5 km on hydro, where one scheme spreads a
 * powerhouse, an intake and a dam across a valley under names that all match.
 * That is precisely where a name heuristic over volunteer mapping is weakest
 * and where the operator is the only party who knows which object IS the
 * station. Each `edf-published` row therefore also carries `supersededOsmKm`,
 * the distance to the OSM candidate it outranked, so the choice is auditable
 * per station instead of resting on this paragraph.
 *
 * A candidate more than `--max-anchor-km` from the commune centre is REFUSED
 * rather than trusted: a name collision that throws Gravelines to Marseille has
 * to fail loudly, not quietly. Nothing is ever averaged between two anchors —
 * an average of two published positions is a third, unpublished one.
 *
 * Usage:
 *   node scripts/build-rte-units-registry.mjs
 *   node scripts/build-rte-units-registry.mjs --floor-mw=100 --max-anchor-km=30
 *   node scripts/build-rte-units-registry.mjs --report        # placement audit
 *   node scripts/build-rte-units-registry.mjs --refresh-osm   # re-query Overpass
 *                                                             # instead of reusing
 *                                                             # the cached answers
 *   node scripts/build-rte-units-registry.mjs --allow-partial # accept a degraded
 *                                                             # run when Overpass
 *                                                             # is down
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RTE_GENERATION_CLASSES,
  RTE_REGISTRY_DATASET,
  RTE_UNIT_FLOOR_MW,
  groupRegistreSites,
  normalizeStationName,
  projectRegistreUnit,
  stationNameMatch,
} from '../src/data/rteGenerationFeed.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = path.join(ROOT, 'src', 'data', 'local_data', 'rte_production_units', 'units.json');
const USER_AGENT = 'gods-eye-view/0.1 (+https://github.com/bilawalsidhu/gods-eye-view)';

const ODRE_BASE = 'https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets';
const GEO_API = 'https://geo.api.gouv.fr/communes';
/**
 * EDF Open Data, on its NATIVE data-fair routes.
 *
 * opendata.edf.fr used to be an Opendatasoft portal and has migrated to
 * Koumoul; the `/api/v1/datasets` route most links still point at now answers
 * the SPA's HTML 404 (measured 2026-08-28). `/data-fair/api/v1/datasets/{slug}/lines`
 * is the route that answers.
 */
const EDF_BASE = 'https://opendata.edf.fr/data-fair/api/v1/datasets';
const OVERPASS_MIRRORS = Object.freeze([
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
]);

/**
 * OSM `plant:source` → the generation classes it may anchor.
 *
 * A compatibility table, not a translation: it exists only to stop a gas
 * station's name matching a hydro plant's. `combustion` is OSM's catch-all for
 * "it burns something" and is allowed to anchor any of the three fossil classes.
 */
const OSM_SOURCE_CLASSES = Object.freeze({
  nuclear: ['nuclear'],
  hydro: ['hydro-reservoir', 'hydro-run-of-river', 'hydro-pumped'],
  gas: ['fossil-gas'],
  coal: ['fossil-coal'],
  oil: ['fossil-oil'],
  diesel: ['fossil-oil'],
  combustion: ['fossil-gas', 'fossil-oil', 'fossil-coal'],
  biomass: ['biomass'],
  waste: ['biomass'],
  tidal: ['marine'],
});

/**
 * `plant:source` values deliberately NOT queried.
 *
 * France has tens of thousands of mapped solar and onshore-wind plants and a
 * country-wide Overpass query for them times out on every public mirror
 * (measured 2026-08-28: HTTP 504 from three). They would also buy nothing: the
 * only solar above the 100 MW floor is the two Corsican farms the register
 * publishes as `Confidentiel` with no name to match on, and France's offshore
 * wind farms — the only wind above the floor — are not mapped as `power=plant`
 * at all (0 elements over the Fécamp, Saint-Brieuc and Saint-Nazaire boxes).
 * Those six sites take the commune anchor and say so.
 */
const OSM_SOURCES_SKIPPED = Object.freeze(['solar', 'wind']);

/**
 * The three EDF Open Data files, and where each hides its coordinate.
 *
 * They do not agree with each other. Nuclear and thermal publish ONE string,
 * `point_gps_wsg84` (yes, WGS misspelt WSG), formatted `"lat, lon"`. Hydro
 * publishes two numeric columns — and **`coordonnees_x_wgs` is the LATITUDE**:
 * Grand-Maison is x=45.1458 / y=6.0512, the opposite of the x=longitude
 * convention every other file here uses. Read the usual way, France's largest
 * hydro plant lands off the coast of Somalia.
 *
 * `centrale` is the site name, and it is the reason this join works at all: it
 * is written in the SAME shouted convention as ODRÉ's register, articles parked
 * at the end included — `BATHIE (LA)`, `AIGLE (L')`, `TRICASTIN (LE)`. Both
 * files ultimately describe the same operator's own stations.
 */
const EDF_DATASETS = Object.freeze([
  Object.freeze({ key: 'nucleaire', slug: 'centrales-de-production-nucleaire-edf', coords: 'gps' }),
  Object.freeze({ key: 'hydraulique', slug: 'centrales-de-production-hydraulique-de-edf-sa', coords: 'xy' }),
  Object.freeze({
    key: 'thermique',
    slug: 'centrales-de-production-thermique-a-flamme-d-edf-sa-fioul-gaz-charbon',
    coords: 'gps',
  }),
]);

/**
 * Sanity box for an EDF coordinate — metropolitan France with a margin.
 *
 * A PARSE CHECK, not a coverage claim: it exists so the x/y swap above fails
 * loudly instead of anchoring a power station in the Indian Ocean.
 */
const FRANCE_BOX = Object.freeze({ minLat: 41, maxLat: 51.5, minLon: -5.5, maxLon: 9.8 });

function parseArgs(argv) {
  const args = {
    out: DEFAULT_OUT,
    floorMw: RTE_UNIT_FLOOR_MW,
    maxAnchorKm: 30,
    timeout: 240_000,
    report: false,
    allowPartial: false,
    refreshOsm: false,
  };
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=');
    if (key === 'out') args.out = path.resolve(ROOT, value);
    else if (key === 'floor-mw') args.floorMw = Math.max(1, Number(value) || RTE_UNIT_FLOOR_MW);
    else if (key === 'max-anchor-km') args.maxAnchorKm = Math.max(1, Number(value) || 30);
    else if (key === 'timeout') args.timeout = Math.max(10_000, Number(value) || 240_000);
    else if (key === 'report') args.report = true;
    else if (key === 'allow-partial') args.allowPartial = true;
    else if (key === 'refresh-osm') args.refreshOsm = true;
  }
  return args;
}

async function getJson(url, timeoutMs, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...(init.headers || {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  return response.json();
}

const EARTH_MEAN_RADIUS_KM = 6371.0088;

/** Great-circle distance in kilometres. */
function haversineKm(a, b) {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const lat1 = a.lat * toRad;
  const lat2 = b.lat * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_MEAN_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Round a coordinate to ~1.1 m, the precision the layer publishes. */
const round5 = (value) => Math.round(value * 1e5) / 1e5;

// --- Sources ----------------------------------------------------------------

/**
 * Every register row at or above the publication floor, paged.
 * @returns {Promise<{rows: Array<object>, edition: ?string, modified: ?string}>}
 */
async function fetchRegistre(args) {
  const where = encodeURIComponent(`puismaxinstallee >= ${args.floorMw * 1000}`);
  const rows = [];
  for (let offset = 0; offset < 5000; offset += 100) {
    const page = await getJson(
      `${ODRE_BASE}/${RTE_REGISTRY_DATASET}/records?limit=100&offset=${offset}`
      + `&where=${where}&order_by=codeeicresourceobject`,
      args.timeout,
    );
    const batch = Array.isArray(page?.results) ? page.results : [];
    rows.push(...batch);
    if (batch.length < 100) break;
  }
  let edition = null;
  let modified = null;
  try {
    const meta = await getJson(`${ODRE_BASE}/${RTE_REGISTRY_DATASET}`, args.timeout);
    edition = meta?.metas?.default?.title || null;
    modified = meta?.metas?.default?.modified || null;
  } catch { /* the catalogue entry is a nicety, not a dependency */ }
  return { rows, edition, modified };
}

/**
 * Read a cached Overpass response, or fetch it and cache it.
 *
 * Overpass outages are ROUTINE — this build drew 429, 502, 504, a DNS failure
 * and one mirror answering 200 with an empty database inside twenty minutes
 * (2026-08-28), which is the same experience the power-grid layer's proxy
 * documents. Two country-wide queries are the slowest and least reliable part
 * of this script and their answers change on the scale of months, so they are
 * kept on disk under `.gev-cache/` (gitignored). A rebuild that only needs to
 * re-run the ODRÉ or EDF half then costs nothing and cannot be blocked by a
 * mirror having a bad afternoon.
 *
 * @param {string} name - Cache file stem.
 * @param {string} query - Overpass QL.
 * @param {object} options - `{timeoutMs, minElements, cacheDir, refresh}`.
 * @returns {Promise<Array<object>>}
 */
async function cachedOverpass(name, query, { timeoutMs, minElements, cacheDir, refresh }) {
  const cachePath = path.join(cacheDir, `${name}.json`);
  if (!refresh) {
    try {
      const cached = JSON.parse(await fsp.readFile(cachePath, 'utf8'));
      if (Array.isArray(cached?.elements) && cached.elements.length >= minElements) {
        process.stderr.write(`  ${cached.elements.length} elements from cache (${cached.at || 'undated'})\n`);
        return cached.elements;
      }
    } catch { /* no usable cache */ }
  }
  const elements = await overpass(query, timeoutMs, { minElements });
  try {
    await fsp.mkdir(cacheDir, { recursive: true });
    await fsp.writeFile(
      cachePath,
      JSON.stringify({ at: new Date().toISOString(), query, elements }),
      'utf8',
    );
  } catch (error) {
    process.stderr.write(`  cache write failed (${error.message})\n`);
  }
  return elements;
}

/**
 * Run one Overpass query against the first mirror that actually answers.
 *
 * `minElements` is not a nicety. A country-wide `power=*` query has thousands
 * of answers, so an empty `elements` array from a mirror means that mirror is
 * broken or serving a partial database — not that France has no substations.
 * One mirror in this list answered `200` with zero elements and an
 * `osm3s.timestamp_osm_base` of `"116726"` (measured 2026-08-28), which is not
 * a date. Without this guard that empty success is indistinguishable from a
 * real one, and it silently demotes every station to its commune centre.
 */
async function overpass(query, timeoutMs, { minElements = 1 } = {}) {
  let lastError = null;
  for (const mirror of OVERPASS_MIRRORS) {
    try {
      const response = await fetch(mirror, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', 'User-Agent': USER_AGENT },
        body: query,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload?.elements)) throw new Error('no elements array');
      if (payload.elements.length < minElements) {
        throw new Error(`${payload.elements.length} elements, expected at least ${minElements}`);
      }
      return payload.elements;
    } catch (error) {
      lastError = error;
      process.stderr.write(`  overpass ${new URL(mirror).host} failed (${error.message})\n`);
    }
  }
  throw lastError || new Error('every Overpass mirror failed');
}

/** OSM position of an element: its own, or the centre Overpass computes for an area. */
function osmPosition(element) {
  const lat = Number(element?.lat ?? element?.center?.lat);
  const lon = Number(element?.lon ?? element?.center?.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

/** RTE substation yards, keyed by the `ref:FR:RTE` code the register also uses. */
async function fetchSwitchyards(options) {
  const elements = await cachedOverpass('rte-switchyards', `
[out:json][timeout:240];
area["ISO3166-1"="FR"]["admin_level"="2"]->.fr;
nwr["power"="substation"]["ref:FR:RTE"](area.fr);
out tags center;`, { ...options, minElements: 1000 });
  const byRef = new Map();
  for (const element of elements) {
    const ref = String(element?.tags?.['ref:FR:RTE'] ?? '').trim();
    const position = osmPosition(element);
    if (!ref || !position) continue;
    if (!byRef.has(ref)) byRef.set(ref, []);
    byRef.get(ref).push({
      ...position,
      osmId: `${element.type}/${element.id}`,
      name: element.tags?.name || null,
      voltage: element.tags?.voltage || null,
    });
  }
  return byRef;
}

/** OSM power plants of the classes this register can contain. */
async function fetchPlants(options) {
  const sources = Object.keys(OSM_SOURCE_CLASSES).join('|');
  const elements = await cachedOverpass('power-plants', `
[out:json][timeout:240];
area["ISO3166-1"="FR"]["admin_level"="2"]->.fr;
nwr["power"="plant"]["plant:source"~"^(${sources})$"](area.fr);
out tags center;`, { ...options, minElements: 500 });
  const plants = [];
  for (const element of elements) {
    const position = osmPosition(element);
    const name = element?.tags?.name;
    if (!position || !name) continue;
    plants.push({
      ...position,
      osmId: `${element.type}/${element.id}`,
      name,
      normalized: normalizeStationName(name),
      source: String(element.tags['plant:source'] || '').trim(),
      output: element.tags['plant:output:electricity'] || null,
    });
  }
  return plants;
}

/**
 * EDF's own published coordinates for its own stations, keyed by normalized name.
 *
 * Each parsed point is cross-checked against data-fair's computed `_geopoint`
 * and against the France box. Both guards are aimed at the same trap — the
 * hydro file's x=latitude convention — from two directions: the box catches a
 * swap that leaves France, and `_geopoint` catches one that does not. A row
 * failing either is dropped with a warning rather than trusted.
 *
 * @returns {Promise<Map<string, Array<object>>>}
 */
async function fetchEdfStations(timeoutMs) {
  const byName = new Map();
  let dropped = 0;
  for (const dataset of EDF_DATASETS) {
    const payload = await getJson(`${EDF_BASE}/${dataset.slug}/lines?size=500`, timeoutMs);
    const rows = Array.isArray(payload?.results) ? payload.results : [];
    for (const row of rows) {
      const centrale = String(row?.centrale ?? '').trim();
      if (!centrale) continue;

      let lat = null;
      let lon = null;
      if (dataset.coords === 'xy') {
        // Not a typo: x is the latitude in this file.
        lat = Number(row.coordonnees_x_wgs);
        lon = Number(row.coordonnees_y_wgs);
      } else {
        const parts = String(row.point_gps_wsg84 ?? '').split(',');
        if (parts.length === 2) { lat = Number(parts[0]); lon = Number(parts[1]); }
      }
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) { dropped += 1; continue; }
      if (lat < FRANCE_BOX.minLat || lat > FRANCE_BOX.maxLat
        || lon < FRANCE_BOX.minLon || lon > FRANCE_BOX.maxLon) {
        process.stderr.write(`  EDF ${centrale}: ${lat},${lon} is outside France — dropped\n`);
        dropped += 1;
        continue;
      }
      const computed = String(row._geopoint ?? '').split(',');
      if (computed.length === 2) {
        const check = { lat: Number(computed[0]), lon: Number(computed[1]) };
        if (Number.isFinite(check.lat) && haversineKm({ lat, lon }, check) > 0.05) {
          process.stderr.write(`  EDF ${centrale}: published columns disagree with _geopoint — dropped\n`);
          dropped += 1;
          continue;
        }
      }

      const key = normalizeStationName(centrale);
      if (!key) continue;
      if (!byName.has(key)) byName.set(key, []);
      const bucket = byName.get(key);
      // Nuclear and thermal publish one row per UNIT with the site's coordinate
      // repeated on each, so six Gravelines rows are one station.
      if (!bucket.some((entry) => entry.centrale === centrale && entry.file === dataset.key)) {
        bucket.push({ lat, lon, centrale, file: dataset.key });
      }
    }
  }
  if (dropped) process.stderr.write(`  ${dropped} EDF row(s) dropped by the coordinate guards\n`);
  return byName;
}

/** Commune centres for a set of INSEE codes. */
async function fetchCommuneCentres(codes, timeoutMs) {
  const centres = new Map();
  const list = [...codes].filter(Boolean);
  for (let i = 0; i < list.length; i += 40) {
    const slice = list.slice(i, i + 40);
    const results = await Promise.all(slice.map(async (code) => {
      try {
        const rows = await getJson(
          `${GEO_API}?code=${encodeURIComponent(code)}&fields=code,nom,centre`,
          timeoutMs,
        );
        const centre = Array.isArray(rows) ? rows[0]?.centre?.coordinates : null;
        if (!Array.isArray(centre) || centre.length < 2) return null;
        return [code, { lat: Number(centre[1]), lon: Number(centre[0]), nom: rows[0]?.nom || null }];
      } catch {
        return null;
      }
    }));
    for (const entry of results) if (entry) centres.set(entry[0], entry[1]);
  }
  return centres;
}

// --- Placement --------------------------------------------------------------

/**
 * How far the OpenStreetMap outline that WOULD have been used sits from the
 * anchor actually chosen, or null when OSM offers no comparable candidate.
 *
 * Purely evidence: it goes into the committed file so a reader can see, per
 * station, how much the two sources disagreed and judge the tier order for
 * themselves rather than taking this script's word for it.
 * @returns {?number} Kilometres, or null.
 */
function osmDistanceKm(site, { plants, wanted, anchor }) {
  let best = null;
  let bestStrength = 0;
  for (const plant of plants) {
    if (!plant.normalized) continue;
    if (!(OSM_SOURCE_CLASSES[plant.source] || []).includes(site.class)) continue;
    const strength = stationNameMatch(wanted, plant.normalized);
    if (strength > bestStrength) { bestStrength = strength; best = plant; }
  }
  if (!best) return null;
  return Math.round(haversineKm(anchor, best) * 100) / 100;
}

/**
 * Anchor one site, recording which published position it came from.
 *
 * @param {object} site - Grouped site from `groupRegistreSites`.
 * @param {object} context - `{switchyards, plants, communes, maxAnchorKm}`.
 * @returns {?object} `{lat, lon, placement, placementRef, placementName, anchorKm}`
 */
export function placeSite(site, { edfStations, switchyards, plants, communes, maxAnchorKm }) {
  const commune = communes.get(site.insee) || null;
  const within = (candidate) => {
    if (!commune) return { ok: true, km: null };
    const km = haversineKm(commune, candidate);
    return { ok: km <= maxAnchorKm, km: Math.round(km * 100) / 100 };
  };
  const wanted = normalizeStationName(site.rawSiteName || site.name || '');

  /**
   * Pick from a set of name candidates: the strongest match wins, and a tie at
   * the strongest strength is only broken if one candidate is unambiguously
   * nearer the commune the register names.
   */
  const pick = (candidates) => {
    const near = candidates.map((entry) => ({ ...entry, ...within(entry) })).filter((e) => e.ok);
    if (!near.length) return null;
    const best = Math.max(...near.map((entry) => entry.strength));
    const top = near.filter((entry) => entry.strength === best);
    if (top.length === 1) return top[0];
    if (!commune) return null;
    top.sort((a, b) => a.km - b.km);
    return top[0].km + 1 < top[1].km ? top[0] : null;
  };

  // 0. The operator's own published coordinate for its own station.
  //
  // EDF publishes the localisation of its fleet, and `centrale` is written in
  // the same convention as the register's site names, so this is the shortest
  // path from a published name to a published point — one join instead of two
  // heuristics. Measured 2026-08-28 across the 69 stations where both exist:
  // EDF and OpenStreetMap agree to within 300 m on every reactor and every
  // thermal site, and diverge by up to 9.5 km on hydro — where one scheme has
  // several plants, an intake and a dam sharing a name, and where the operator
  // is the only party that knows which of them IS the station.
  let edfAnchor = null;
  if (wanted && edfStations?.size) {
    const candidates = [];
    for (const [key, stations] of edfStations) {
      const strength = stationNameMatch(wanted, key);
      if (strength) for (const station of stations) candidates.push({ ...station, strength });
    }
    edfAnchor = pick(candidates);
    if (edfAnchor) {
      return {
        lat: round5(edfAnchor.lat),
        lon: round5(edfAnchor.lon),
        placement: 'edf-published',
        placementRef: `edf:${edfAnchor.file}:${edfAnchor.centrale}`,
        placementName: edfAnchor.centrale,
        anchorKm: edfAnchor.km,
        // Recorded, not hidden: how far the OpenStreetMap outline this would
        // otherwise have used sits from the operator's own point. Every row
        // above ~1 km is a hydro scheme, and that disagreement is the reason
        // this tier outranks the next one.
        supersededOsmKm: osmDistanceKm(site, { plants, wanted, anchor: edfAnchor }),
      };
    }
  }

  // 1. The station itself, by name, in OpenStreetMap.
  if (wanted) {
    const candidates = [];
    for (const plant of plants) {
      if (!plant.normalized) continue;
      if (!(OSM_SOURCE_CLASSES[plant.source] || []).includes(site.class)) continue;
      const strength = stationNameMatch(wanted, plant.normalized);
      if (strength) candidates.push({ ...plant, strength });
    }
    const chosen = pick(candidates);
    if (chosen) {
      return {
        lat: round5(chosen.lat),
        lon: round5(chosen.lon),
        placement: 'osm-plant',
        placementRef: chosen.osmId,
        placementName: chosen.name,
        anchorKm: chosen.km,
      };
    }
  }

  // 2. The RTE yard the register says these units connect to.
  const yards = switchyards.get(site.id) || [];
  const nearYards = yards.map((yard) => ({ yard, ...within(yard) })).filter((entry) => entry.ok);
  if (nearYards.length) {
    nearYards.sort((a, b) => (a.km ?? 0) - (b.km ?? 0));
    const { yard, km } = nearYards[0];
    return {
      lat: round5(yard.lat),
      lon: round5(yard.lon),
      placement: 'rte-switchyard',
      placementRef: yard.osmId,
      placementName: yard.name,
      anchorKm: km,
      placementCandidates: nearYards.length > 1 ? nearYards.length : undefined,
    };
  }

  // 3. The commune. Right to within the commune, and the card says so.
  if (commune) {
    return {
      lat: round5(commune.lat),
      lon: round5(commune.lon),
      placement: 'commune-centre',
      placementRef: site.insee ? `INSEE:${site.insee}` : null,
      placementName: commune.nom,
      anchorKm: 0,
    };
  }
  return null;
}

// --- Main -------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  process.stderr.write(`Registre national (≥ ${args.floorMw} MW)…\n`);
  const { rows, edition, modified } = await fetchRegistre(args);
  const units = rows.map(projectRegistreUnit).filter(Boolean);
  process.stderr.write(`  ${rows.length} rows, ${units.length} with an EIC code\n`);

  // The site name the register writes is what OSM is searched for; keep it on
  // the grouped site so `placeSite` matches on the station, not on the caption
  // this build prepends to it.
  const rawSiteNames = new Map();
  for (const unit of units) {
    if (unit.site && unit.siteName && !rawSiteNames.has(unit.site)) {
      rawSiteNames.set(unit.site, unit.siteName);
    }
  }
  const sites = groupRegistreSites(units);
  for (const site of sites) site.rawSiteName = rawSiteNames.get(site.id) || null;
  process.stderr.write(`  ${sites.length} sites\n`);

  process.stderr.write('EDF Open Data — the operator’s own coordinates…\n');
  let edfStations = new Map();
  try {
    edfStations = await fetchEdfStations(args.timeout);
    process.stderr.write(`  ${edfStations.size} distinct stations\n`);
  } catch (error) {
    // EDF's portal migrated hosts once already. Losing it costs precision on
    // the 69 stations it covers, not the layer — the two OpenStreetMap tiers
    // and the commune centre still place every site.
    process.stderr.write(`  EDF Open Data unavailable (${error.message}) — falling back to the OSM tiers\n`);
  }

  // The two OpenStreetMap tiers are NOT optional the way EDF's is. Losing them
  // silently demotes every non-EDF station to its commune centre, which writes
  // a strictly worse registry over a good one and looks like a successful
  // build. Public Overpass mirrors make that routine — this run drew 429, 502
  // and 504 from three of them — so the failure is fatal unless asked for.
  const osmOptions = {
    timeoutMs: args.timeout,
    cacheDir: path.join(ROOT, '.gev-cache', 'rte-units-osm'),
    refresh: args.refreshOsm,
  };
  let switchyards = new Map();
  let plants = [];
  let osmFailure = null;
  try {
    process.stderr.write('OpenStreetMap — RTE switchyards…\n');
    switchyards = await fetchSwitchyards(osmOptions);
    process.stderr.write(`  ${switchyards.size} distinct ref:FR:RTE codes\n`);

    process.stderr.write('OpenStreetMap — power plants…\n');
    plants = await fetchPlants(osmOptions);
    process.stderr.write(`  ${plants.length} named plants\n`);
  } catch (error) {
    osmFailure = error;
  }
  if (osmFailure && !args.allowPartial) {
    throw new Error(
      `OpenStreetMap is unavailable (${osmFailure.message}). Refusing to write a registry `
      + 'that would place every non-EDF station at its commune centre. Retry later, or pass '
      + '--allow-partial to accept the degraded placement deliberately.',
    );
  }
  if (osmFailure) {
    process.stderr.write(`  ⚠ writing a DEGRADED registry: ${osmFailure.message}\n`);
  }

  process.stderr.write('geo.api.gouv.fr — commune centres…\n');
  const communes = await fetchCommuneCentres(new Set(sites.map((site) => site.insee)), 30_000);
  process.stderr.write(`  ${communes.size} centres\n`);

  const placementCounts = {
    'edf-published': 0, 'osm-plant': 0, 'rte-switchyard': 0, 'commune-centre': 0, none: 0,
  };
  const placed = [];
  for (const site of sites) {
    const anchor = placeSite(site, {
      edfStations, switchyards, plants, communes, maxAnchorKm: args.maxAnchorKm,
    });
    placementCounts[anchor?.placement || 'none'] += 1;
    const { rawSiteName, classes, ...rest } = site;
    placed.push({
      ...rest,
      classMix: Object.fromEntries(
        Object.entries(classes)
          .sort((a, b) => b[1] - a[1])
          .map(([id, mw]) => [id, Math.round(mw * 10) / 10]),
      ),
      ...(anchor || { lat: null, lon: null, placement: null, placementRef: null }),
    });
  }
  placed.sort((a, b) => b.mw - a.mw || a.id.localeCompare(b.id));

  if (args.report) {
    for (const site of placed) {
      process.stdout.write(
        `${String(site.placement || 'NONE').padEnd(15)} `
        + `${String(site.anchorKm ?? '—').padStart(7)} km  `
        + `${String(Math.round(site.mw)).padStart(5)} MW  `
        + `${site.id.padEnd(7)} ${String(site.class).padEnd(19)} `
        + `${String(site.name).slice(0, 44).padEnd(46)}`
        + `${site.placementName || ''}`
        + `${Number.isFinite(site.supersededOsmKm) ? `   [osm ${site.supersededOsmKm} km away]` : ''}\n`,
      );
    }
  }

  const payload = {
    generated: new Date().toISOString().slice(0, 10),
    floorMw: args.floorMw,
    maxAnchorKm: args.maxAnchorKm,
    registre: { dataset: RTE_REGISTRY_DATASET, edition, modified },
    sources: [
      'ODRÉ — Registre national des installations de production et de stockage '
      + "d'électricité (Licence Ouverte 2.0)",
      'EDF Open Data — localisation des centrales nucléaires, hydrauliques et '
      + 'thermiques à flamme d’EDF SA (Licence Ouverte 2.0)',
      '© OpenStreetMap contributors (ODbL 1.0) — power=plant, power=substation ref:FR:RTE',
      'geo.api.gouv.fr — centre de commune (Licence Ouverte)',
    ],
    stats: {
      units: units.length,
      sites: placed.length,
      placement: placementCounts,
      installedMw: Math.round(placed.reduce((sum, site) => sum + site.mw, 0)),
      byClass: Object.fromEntries(
        Object.keys(RTE_GENERATION_CLASSES)
          .map((id) => [id, units.filter((unit) => unit.class === id).length])
          .filter(([, count]) => count > 0),
      ),
    },
    sites: placed,
    units: units.map((unit) => ({
      eic: unit.eic,
      site: unit.site,
      code: unit.code,
      unitName: unit.unitName,
      class: unit.class,
      mw: unit.mw,
      regime: unit.regime,
      kv: unit.kv,
      commissioned: unit.commissioned,
      confidential: unit.confidential || undefined,
    })).sort((a, b) => a.eic.localeCompare(b.eic)),
  };

  await fsp.mkdir(path.dirname(args.out), { recursive: true });
  await fsp.writeFile(args.out, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  process.stderr.write(
    `\n${path.relative(ROOT, args.out)}: ${payload.stats.units} units, `
    + `${payload.stats.sites} sites, ${payload.stats.installedMw} MW\n`
    + `  placement: ${Object.entries(placementCounts)
      .filter(([, count]) => count)
      .map(([key, count]) => `${key} ${count}`)
      .join(', ')}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`build-rte-units-registry failed: ${error?.stack || error}\n`);
  process.exitCode = 1;
});
