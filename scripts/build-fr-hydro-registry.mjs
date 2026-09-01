#!/usr/bin/env node
/**
 * Build `src/data/local_data/fr_hydro_plants/plants.json` — every hydro
 * installation in France's national register, and the best position anyone
 * publishes for each.
 *
 * WHY THIS SCRIPT EXISTS: **the register has no coordinates, and half of it has
 * no names.** ODRÉ's *Registre national des installations de production et de
 * stockage d'électricité* is the only nationwide list of French hydro — 2 757
 * installations, 26,04 GW — and for each one it publishes a commune INSEE code
 * and nothing spatial. 1 359 of the rows publish `Confidentiel` where a name
 * should be. So both the position and the identity have to be joined in from
 * elsewhere, at authoring time, and committed so every row is auditable in the
 * diff instead of derived live from three services that each drift.
 *
 * This is the same problem `build-rte-units-registry.mjs` solves for the ≥ 100
 * MW fleet, one order of magnitude down and much harder: that script places 108
 * stations that mostly have a published EDF coordinate, this one faces 2 757
 * plants of which EDF publishes 51.
 *
 *   1. **ODRÉ — Registre national** (Licence Ouverte 2.0). The spine: EIC code,
 *      installed power, technology, commune, connection voltage and substation,
 *      regime, commissioning date, grid operator, and the rolling twelve-month
 *      energy actually injected. Coordinates: none.
 *
 *   2. **EDF Open Data** (Licence Ouverte 2.0), `centrales-de-production-
 *      hydraulique-de-edf-sa`. 51 plants, with the operator's own coordinate for
 *      its own station. Beware: **`coordonnees_x_wgs` is the LATITUDE** — read
 *      the usual way, Grand-Maison lands off Somalia. Guarded below.
 *
 *   3. **OpenStreetMap** (ODbL 1.0), via Overpass: `power=plant` +
 *      `plant:source=hydro`. 1 947 elements over the France box, of which the
 *      join uses whatever it can prove. Keep the contributor attribution when
 *      redistributing the file this writes.
 *
 *   4. **geo.api.gouv.fr** (Licence Ouverte), commune centres — used to BOUND
 *      the search for a candidate, and as the anchor for the plants no source
 *      places. See the placement rule.
 *
 * ── The placement rule ──────────────────────────────────────────────────────
 *
 *   `edf-published`  the operator's own point for a station it names. Nothing
 *                    is inferred about which object the plant is.
 *   `osm-plant`      a volunteer-mapped `power=plant` inside the commune's
 *                    12 km ring, claimed by name, then by megawatts, then by
 *                    being the only candidate for the only row. Every plant
 *                    records WHICH of the three under `matchedBy`.
 *   (none)           everything else. These are NOT drawn at their commune
 *                    centre as plants — they are rolled up into one marker per
 *                    commune. See `clusterUnplaced` in `frHydroFeed.js` for the
 *                    measurement that forced that choice: the commune centre
 *                    sits a median 3,4 km from the powerhouse, and beyond 3 km
 *                    for half of them, which in a Pyrenean valley is a
 *                    different river.
 *
 * Rows are placed LARGEST FIRST and each OSM element can be claimed once, so a
 * 74 MW plant takes the outline a 0,4 MW plant might otherwise have matched on
 * a shared token. Nothing is ever averaged between two anchors — an average of
 * two published positions is a third, unpublished one.
 *
 * Usage:
 *   npm run hydro:registry
 *   npm run hydro:registry -- --report        # full placement + coverage audit
 *   npm run hydro:registry -- --floor-kw=1000 # only plants ≥ 1 MW
 *   npm run hydro:registry -- --refresh-osm   # re-query Overpass, ignore cache
 *   npm run hydro:registry -- --allow-partial # accept a run with OSM down
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HYDRO_FILIERE,
  HYDRO_FLOOR_KW,
  HYDRO_MAX_ANCHOR_KM,
  HYDRO_REGISTRY_DATASET,
  clusterUnplaced,
  haversineKm,
  hydroNameMatch,
  normalizeHydroName,
  parseOsmOutputMw,
  projectHydroRow,
  summarizeHydro,
} from '../src/data/frHydroFeed.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = path.join(ROOT, 'src', 'data', 'local_data', 'fr_hydro_plants', 'plants.json');
const CACHE_DIR = path.join(ROOT, '.gev-cache');
const USER_AGENT = 'gods-eye-view/0.1 (+https://github.com/bilawalsidhu/gods-eye-view)';

const ODRE_BASE = 'https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets';
const GEO_API = 'https://geo.api.gouv.fr/communes';
/** IGN Géoplateforme WFS — the data behind the Plan IGN raster. */
const IGN_WFS = 'https://data.geopf.fr/wfs/ows';
const IGN_LAYER = 'BDTOPO_V3:zone_d_activite_ou_d_interet';
/** EDF Open Data on its native data-fair routes — see `build-rte-units-registry.mjs`. */
const EDF_BASE = 'https://opendata.edf.fr/data-fair/api/v1/datasets';
const EDF_HYDRO_SLUG = 'centrales-de-production-hydraulique-de-edf-sa';

/**
 * Overpass mirrors, in the order they answered during this build.
 *
 * `overpass.openstreetmap.fr` leads because it was the only mirror of four that
 * served the country-wide hydro query at all on 2026-08-31 — the other three
 * returned 429, 500, 502 and 504 across eleven attempts in twenty minutes. The
 * answer is cached on disk for exactly this reason.
 */
const OVERPASS_MIRRORS = Object.freeze([
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]);

/** Metropolitan France with a margin, as a box. See `OVERPASS_PLANTS`. */
const FRANCE_BBOX = '41.2,-5.4,51.2,9.7';

/**
 * The plant query — `out tags bb`, NOT `out tags center`.
 *
 * **This is the single most load-bearing line in the file.** Overpass's
 * `center` on a relation is the centre of its BOUNDING BOX, and OSM maps a
 * large hydro scheme as a `type=site` relation covering the intake, the
 * headrace tunnel, the penstock, the powerhouse and the tailrace. The bbox
 * centre of such a relation is a point on no object at all — for the Centrale
 * du Hourat at Laruns it lands 2,8 km up the mountain in the forest, halfway
 * along the penstock, while the powerhouse sits in the valley by the gave.
 *
 * Measured against the first build of this registry: **167 of 722
 * OSM-positioned plants (23 %) were placed at the centre of an object more
 * than 500 m across, and 99 of them more than 3 km across** — Grand-Maison's
 * relation spans 12,1 km, Montpezat's 22,8 km. Asking for `bb` instead of
 * `center` is what lets the build SEE that and refuse it; `resolveOsmPosition`
 * is what fixes it.
 *
 * `area["ISO3166-1"="FR"]` is the obvious spelling and it times out on every
 * mirror for these tag combinations; the box costs a few hundred foreign
 * elements that the 12 km commune ring then discards anyway.
 */
const OVERPASS_PLANTS = `[out:json][timeout:600];
nwr["power"="plant"]["plant:source"="hydro"](${FRANCE_BBOX});
out tags bb;`;

/**
 * The generator query — how an oversized plant gets a real position.
 *
 * A `power=generator` + `generator:source=hydro` element IS the machine: the
 * two 19,8 MW Pelton units of the Hourat are nodes inside its powerhouse. When
 * a plant's own outline is too big to be a position, the centroid of the
 * generators inside it is the generating hall, which is the object a reader
 * pointing at a map means.
 *
 * Asked per OVERSIZED PLANT BOX rather than over France, because the
 * country-wide form of this query is answered by no public mirror: measured
 * 2026-08-31, `nwr[power=generator][generator:source=hydro]` over the France
 * box drew 504, a dropped connection and 500 from three mirrors across six
 * attempts, while the same tags asked inside the 232 boxes that actually need
 * them answered in 48 s with 500 generators. It is also the honest scope — a
 * generator outside every oversized plant could never be a snap target.
 * @param {Array<object>} plants Oversized candidates.
 * @returns {string}
 */
function generatorQuery(plants) {
  const boxes = plants.map((plant) => {
    const b = plant.box;
    return `  nwr["power"="generator"]["generator:source"="hydro"]`
      + `(${b.minlat.toFixed(5)},${b.minlon.toFixed(5)},${b.maxlat.toFixed(5)},${b.maxlon.toFixed(5)});`;
  });
  return `[out:json][timeout:600];\n(\n${boxes.join('\n')}\n);\nout tags center;`;
}

/**
 * RTE switchyards, keyed by the `ref:FR:RTE` code the register publishes as
 * `postesource`.
 *
 * The last resort before a plant falls to its commune, and it is applied ONLY
 * to RTE-connected rows — see tier 5 in `placePlant` for why using it on an
 * Enedis row would be worse than drawing nothing.
 *
 * A BOX, not `area["ISO3166-1"="FR"]`, and therefore a different cache name
 * from the sibling `build-rte-units-registry.mjs` even though the two want the
 * same objects. The area form is what that script uses and it was answered by
 * no mirror at all on 2026-08-31 — 504, 504, 502, 502 from four — while the box
 * form answers. Sharing a cache with a script that asks a different question
 * would make each build invalidate the other's answer on every run.
 */
const OVERPASS_SWITCHYARDS = `[out:json][timeout:600];
nwr["power"="substation"]["ref:FR:RTE"](${FRANCE_BBOX});
out tags center;`;

/**
 * BD TOPO's `nature_detaillee` values that CANNOT be a hydro plant.
 *
 * The filter is written as a deny-list, not an allow-list, because 501 of the
 * 4 318 `Centrale électrique` features publish no `nature_detaillee` at all —
 * and at Laruns those unlabelled ones are the Baralet, Borce, Estaens, Geteu
 * and Artouste-Lac powerhouses. An allow-list would throw away exactly the
 * objects this tier exists to find.
 */
const IGN_NOT_HYDRO = Object.freeze(new Set([
  'Centrale photovoltaïque sol ou agrivoltaïque',
  'Centrale photovoltaïque sur bâti',
  'Centrale photovoltaïque flottante',
  'Parc éolien',
  'Centrale thermique',
  'Centrale géothermique',
]));

/** …and the ones that certainly ARE, which outrank an unlabelled candidate. */
const IGN_HYDRO = Object.freeze(new Set([
  'Centrale hydroélectrique', 'Centrale marémotrice', 'Ferme hydrolienne',
]));

/**
 * How close an IGN footprint must be to a position already established from
 * another source before it is taken as the SAME plant, in metres.
 *
 * 250 m, read off the measured distribution rather than chosen: of the 521
 * placed plants that have an IGN `Centrale électrique` in their commune, 47 %
 * are already within 25 m of one, 60 % within 50 m, 67 % within 100 m and 72 %
 * within 250 m — and then the curve flattens, with only 12 more arriving by
 * 500 m. Agreement clusters tight; anything past a couple of hundred metres is
 * a different object, not a better version of the same one.
 */
const IGN_SNAP_M = 250;

/**
 * How far a row's own source substation may sit from the commune it names
 * before the COMMUNE is treated as the wrong field, in kilometres.
 *
 * Both sides of this test are published codes: the register's `postesource` and
 * OpenStreetMap's `ref:FR:RTE`. When they disagree by a continent, the register
 * is contradicting itself and one of its two fields has to lose.
 *
 * Measured across the 378 RTE-connected rows whose substation OSM carries: the
 * median distance is 2,4 km, p90 is 5,4 km, **the largest legitimate one is
 * 11 km — and then the next four are 6 717, 6 864, 7 263 and 8 945 km.** There
 * is no threshold to argue about inside a gap like that. All four are
 * metropolitan hydro plants filed under an overseas commune whose INSEE code
 * begins 97: the Lac d'Oô (Luchon, Haute-Garonne) is published in Guyane, Luz
 * (Hautes-Pyrénées) in Martinique, Motz (Savoie) in Guadeloupe, and
 * Pont-du-Loup (Alpes-Maritimes) at La Réunion.
 */
const COMMUNE_CONTRADICTION_KM = 100;

/**
 * The widest an OSM object may be and still BE a position, in metres.
 *
 * A powerhouse polygon is tens of metres across; a `landuse=industrial` around
 * one is a couple of hundred. Past 500 m the object is a scheme, a reservoir or
 * a valley, and its centre is an average of things rather than a place.
 */
const COMPACT_SPAN_M = 500;

/** Sanity box for a parsed coordinate — a PARSE CHECK, not a coverage claim. */
const FRANCE_BOX = Object.freeze({ minLat: 41, maxLat: 51.5, minLon: -5.5, maxLon: 9.8 });

/** Overseas boxes the register reaches and the metropolitan box does not. */
const OVERSEAS_BOXES = Object.freeze([
  Object.freeze({ minLat: 2, maxLat: 6, minLon: -55, maxLon: -51 }), // Guyane
  Object.freeze({ minLat: -21.5, maxLat: -20.7, minLon: 55.1, maxLon: 55.9 }), // La Réunion
  Object.freeze({ minLat: 14.3, maxLat: 16.6, minLon: -61.9, maxLon: -60.7 }), // Antilles
]);

function parseArgs(argv) {
  const args = {
    out: DEFAULT_OUT,
    floorKw: HYDRO_FLOOR_KW,
    maxAnchorKm: HYDRO_MAX_ANCHOR_KM,
    timeout: 300_000,
    report: false,
    allowPartial: false,
    refreshOsm: false,
  };
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=');
    if (key === 'out') args.out = path.resolve(ROOT, value);
    else if (key === 'floor-kw') args.floorKw = Math.max(0, Number(value) || 0);
    else if (key === 'max-anchor-km') args.maxAnchorKm = Math.max(1, Number(value) || HYDRO_MAX_ANCHOR_KM);
    else if (key === 'timeout') args.timeout = Math.max(10_000, Number(value) || 300_000);
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

const round5 = (value) => Math.round(value * 1e5) / 1e5;

function inBox(lat, lon, box) {
  return lat >= box.minLat && lat <= box.maxLat && lon >= box.minLon && lon <= box.maxLon;
}

/** A coordinate anywhere the register can legitimately reach. */
function inFrance(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return inBox(lat, lon, FRANCE_BOX) || OVERSEAS_BOXES.some((box) => inBox(lat, lon, box));
}

// --- Sources ----------------------------------------------------------------

/**
 * Every hydro row in the current edition, via the export route.
 *
 * `/exports/json` rather than paged `/records`: the register's `records` route
 * refuses an offset beyond 10 000 and the filière alone is 2 757 rows, so
 * paging works today and would break the first time France builds a few hundred
 * more mills. The export returns the whole filière in one ~4 MB body.
 */
async function fetchRegistre(args) {
  const where = encodeURIComponent(
    `filiere='${HYDRO_FILIERE}'${args.floorKw > 0 ? ` AND puismaxinstallee >= ${args.floorKw}` : ''}`,
  );
  const rows = await getJson(
    `${ODRE_BASE}/${HYDRO_REGISTRY_DATASET}/exports/json?where=${where}`,
    args.timeout,
  );
  let edition = null;
  let modified = null;
  try {
    const meta = await getJson(`${ODRE_BASE}/${HYDRO_REGISTRY_DATASET}`, args.timeout);
    edition = meta?.metas?.default?.title || null;
    modified = meta?.metas?.default?.modified || null;
  } catch { /* the catalogue entry is a nicety, not a dependency */ }
  return { rows: Array.isArray(rows) ? rows : [], edition, modified };
}

/**
 * EDF's own coordinates for its own hydro stations, keyed by normalised name.
 *
 * **`coordonnees_x_wgs` is the LATITUDE.** The guard below is not defensive
 * padding: read x as longitude and France's largest hydro plant plots in the
 * Indian Ocean, silently, and the layer looks fine everywhere else.
 */
async function fetchEdfStations(timeoutMs) {
  const byName = new Map();
  let dropped = 0;
  const payload = await getJson(
    `${EDF_BASE}/${EDF_HYDRO_SLUG}/lines?size=1000`,
    timeoutMs,
  );
  for (const row of payload?.results || []) {
    const lat = Number(row?.coordonnees_x_wgs);
    const lon = Number(row?.coordonnees_y_wgs);
    const centrale = String(row?.centrale ?? '').trim();
    if (!centrale) continue;
    if (!inFrance(lat, lon)) { dropped += 1; continue; }
    const key = normalizeHydroName(centrale);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, { lat, lon, centrale });
  }
  if (dropped) process.stderr.write(`  ${dropped} EDF row(s) dropped by the coordinate guard\n`);
  return byName;
}

/** Read a cached Overpass answer, or fetch and cache it. */
async function cachedOverpass(name, query, { timeoutMs, minElements, refresh }) {
  const cachePath = path.join(CACHE_DIR, `${name}.json`);
  if (!refresh) {
    try {
      const cached = JSON.parse(await fsp.readFile(cachePath, 'utf8'));
      // The QUERY is compared, not just the file name. The generator query is
      // derived from the plant set and changes whenever OpenStreetMap gains or
      // loses an oversized plant; reusing an answer to a different question
      // would silently place plants from boxes nobody asked about.
      const sameQuery = cached?.query === query;
      if (sameQuery && Array.isArray(cached?.elements) && cached.elements.length >= minElements) {
        process.stderr.write(`  ${cached.elements.length} elements from cache (${cached.at || 'undated'})\n`);
        return cached.elements;
      }
      if (!sameQuery && cached) process.stderr.write('  cache is for a different query — refetching\n');
    } catch { /* no usable cache */ }
  }
  const elements = await overpass(query, timeoutMs, minElements);
  try {
    await fsp.mkdir(CACHE_DIR, { recursive: true });
    await fsp.writeFile(cachePath, JSON.stringify({ at: new Date().toISOString(), query, elements }), 'utf8');
  } catch (error) {
    process.stderr.write(`  cache write failed (${error.message})\n`);
  }
  return elements;
}

/**
 * One Overpass query against the first mirror that actually answers.
 *
 * `minElements` guards the failure mode that matters: a mirror serving a
 * partial or empty database answers 200 with `elements: []`, which without this
 * check is indistinguishable from "France has no hydro plants" and would demote
 * all 2 757 rows to commune clusters.
 */
async function overpass(query, timeoutMs, minElements) {
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
      process.stderr.write(`  ${payload.elements.length} elements from ${new URL(mirror).host}\n`);
      return payload.elements;
    } catch (error) {
      lastError = error;
      process.stderr.write(`  ${new URL(mirror).host}: ${error.message}\n`);
    }
  }
  throw new Error(`every Overpass mirror failed (last: ${lastError?.message})`);
}

/**
 * Bounding box → its centre and its diagonal in metres.
 *
 * A node has no bounds and a span of zero: it is already a point.
 */
function boundsOf(element) {
  const b = element?.bounds;
  if (b && Number.isFinite(b.minlat)) {
    const lat = (b.minlat + b.maxlat) / 2;
    const lon = (b.minlon + b.maxlon) / 2;
    const spanM = haversineKm(
      { lat: b.minlat, lon: b.minlon },
      { lat: b.maxlat, lon: b.maxlon },
    ) * 1000;
    return { lat, lon, spanM, box: b };
  }
  const lat = Number(element?.lat ?? element?.center?.lat);
  const lon = Number(element?.lon ?? element?.center?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, spanM: 0, box: null };
}

/** Project the Overpass plant answer into placement candidates. */
function projectOsmPlants(elements) {
  const plants = [];
  for (const element of elements) {
    const bounds = boundsOf(element);
    if (!bounds || !inFrance(bounds.lat, bounds.lon)) continue;
    const tags = element?.tags || {};
    plants.push({
      id: `${element.type}/${element.id}`,
      lat: bounds.lat,
      lon: bounds.lon,
      spanM: bounds.spanM,
      box: bounds.box,
      name: tags.name || null,
      normalized: normalizeHydroName(tags.name),
      mw: parseOsmOutputMw(tags['plant:output:electricity']),
      operator: tags.operator || null,
      claimed: false,
    });
  }
  return plants;
}

/** Project the Overpass generator answer into snap targets. */
function projectOsmGenerators(elements) {
  const generators = [];
  for (const element of elements) {
    const bounds = boundsOf(element);
    if (!bounds || !inFrance(bounds.lat, bounds.lon)) continue;
    generators.push({ id: `${element.type}/${element.id}`, lat: bounds.lat, lon: bounds.lon });
  }
  return generators;
}

/** RTE switchyards keyed by the `ref:FR:RTE` code the register publishes. */
function projectSwitchyards(elements) {
  const byRef = new Map();
  for (const element of elements) {
    const ref = String(element?.tags?.['ref:FR:RTE'] ?? '').trim();
    const bounds = boundsOf(element);
    if (!ref || !bounds || !inFrance(bounds.lat, bounds.lon)) continue;
    if (!byRef.has(ref)) byRef.set(ref, []);
    byRef.get(ref).push({
      id: `${element.type}/${element.id}`,
      lat: bounds.lat,
      lon: bounds.lon,
      name: element.tags?.name || null,
    });
  }
  return byRef;
}

/**
 * Turn a matched OSM plant into a position, or refuse it.
 *
 * See `OVERPASS_PLANTS` for why this exists. Three outcomes, and the third one
 * is the point: a plant this cannot resolve is NOT drawn at its scheme's bbox
 * centre, it is handed back to its commune ring, because "somewhere in this
 * commune" is true and "here, in this forest" is not.
 *
 * @returns {?{lat:number, lon:number, geometry:string, spanM:number, snapKm:?number}}
 */
function resolveOsmPosition(plant, generators) {
  if (plant.spanM <= COMPACT_SPAN_M) {
    return {
      lat: plant.lat, lon: plant.lon, geometry: 'outline', spanM: plant.spanM, snapKm: null,
    };
  }
  if (!plant.box) return null;
  const inside = generators.filter((generator) => (
    generator.lat >= plant.box.minlat && generator.lat <= plant.box.maxlat
    && generator.lon >= plant.box.minlon && generator.lon <= plant.box.maxlon
  ));
  if (!inside.length) return null;
  const lat = inside.reduce((sum, g) => sum + g.lat, 0) / inside.length;
  const lon = inside.reduce((sum, g) => sum + g.lon, 0) / inside.length;
  // The generators must themselves sit in one place. A scheme with machines in
  // two powerhouses averages to a third point that is neither, which is the
  // very failure this function exists to stop.
  const spread = inside.reduce(
    (max, g) => Math.max(max, haversineKm({ lat, lon }, g) * 1000), 0,
  );
  if (spread > COMPACT_SPAN_M) return null;
  return {
    lat,
    lon,
    geometry: 'generators',
    spanM: plant.spanM,
    // How far the honest answer sits from the bbox centre this build would
    // have used — the audit trail for the bug this replaced.
    snapKm: Math.round(haversineKm({ lat, lon }, plant) * 100) / 100,
  };
}

/**
 * Paris, Lyon and Marseille arrondissement codes → their parent commune.
 *
 * The register writes `13214` (Marseille 14e) where two Canal de Marseille
 * turbines sit, and `geo.api.gouv.fr/communes?code=13214` answers with an empty
 * array: an arrondissement municipal is not a commune. Without this the two
 * rows are dropped for want of any anchor at all. The parent's centre is a
 * worse position than an arrondissement's would be, and it is the one the
 * publisher's own hierarchy supports.
 * @param {string} code
 * @returns {string} The code to ask for.
 */
function parentCommune(code) {
  const n = Number(code);
  if (n >= 75101 && n <= 75120) return '75056';
  if (n >= 69381 && n <= 69389) return '69123';
  if (n >= 13201 && n <= 13216) return '13055';
  return code;
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * IGN BD TOPO's electrical-plant footprints — what the Plan IGN actually draws.
 *
 * The best positional evidence in this build, and the reason is measurable:
 * these are surveyed building footprints with a **median span of 28 m** (p90
 * 164 m), each carrying IGN's own `precision_planimetrique` — 3 m on more than
 * half of them — against an OpenStreetMap `type=site` relation that can be
 * twelve kilometres wide. And the join needs no guessing at all: BD TOPO
 * publishes `insee_commune` on every feature, which is the same INSEE code
 * ODRÉ's register publishes on every row.
 *
 * What it does NOT carry is power, operator or filière, so it can say WHERE a
 * plant is and never WHICH plant it is. That is why it refines positions other
 * tiers have already identified, and only places a plant on its own when the
 * commune leaves no room for ambiguity.
 *
 * Paged, because the WFS caps a response at 1 000 features and there are 4 318.
 * @returns {Promise<{byInsee: Map<string, Array<object>>, total:number, skipped:number}>}
 */
async function fetchIgnPlants(timeoutMs) {
  const features = [];
  for (let start = 0; start < 20_000; start += 1000) {
    const url = `${IGN_WFS}?${new URLSearchParams({
      SERVICE: 'WFS',
      VERSION: '2.0.0',
      REQUEST: 'GetFeature',
      TYPENAMES: IGN_LAYER,
      OUTPUTFORMAT: 'application/json',
      SRSNAME: 'EPSG:4326',
      COUNT: '1000',
      STARTINDEX: String(start),
      CQL_FILTER: "nature='Centrale électrique'",
    })}`;
    const page = await getJson(url, timeoutMs);
    const batch = Array.isArray(page?.features) ? page.features : [];
    features.push(...batch);
    if (batch.length < 1000) break;
  }
  const byInsee = new Map();
  let skipped = 0;
  for (const feature of features) {
    const props = feature?.properties || {};
    // A plant that is not built yet is not a position for a plant that is
    // running: 61 are `En projet` and 24 `En construction`.
    if (props.etat_de_l_objet !== 'En service') { skipped += 1; continue; }
    if (IGN_NOT_HYDRO.has(props.nature_detaillee)) { skipped += 1; continue; }
    const insee = String(props.insee_commune ?? '').trim();
    const box = polygonBounds(feature.geometry);
    if (!insee || !box) { skipped += 1; continue; }
    if (!byInsee.has(insee)) byInsee.set(insee, []);
    byInsee.get(insee).push({
      id: props.cleabs,
      lat: box.lat,
      lon: box.lon,
      spanM: box.spanM,
      name: props.toponyme || null,
      normalized: normalizeHydroName(props.toponyme),
      // Explicitly hydro, as against merely not-explicitly-something-else.
      sure: IGN_HYDRO.has(props.nature_detaillee),
      kind: props.nature_detaillee || null,
      precisionM: Number(props.precision_planimetrique) || null,
      claimed: false,
    });
  }
  return { byInsee, total: features.length, skipped };
}

/** Bounding box of a (Multi)Polygon, as centre + diagonal in metres. */
function polygonBounds(geometry) {
  const rings = geometry?.type === 'MultiPolygon'
    ? geometry.coordinates.flat()
    : (geometry?.type === 'Polygon' ? geometry.coordinates : null);
  if (!rings?.length) return null;
  let minLat = Infinity; let maxLat = -Infinity; let minLon = Infinity; let maxLon = -Infinity;
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
  }
  if (!Number.isFinite(minLat)) return null;
  return {
    lat: (minLat + maxLat) / 2,
    lon: (minLon + maxLon) / 2,
    spanM: haversineKm({ lat: minLat, lon: minLon }, { lat: maxLat, lon: maxLon }) * 1000,
  };
}

/**
 * Commune centres for a set of INSEE codes, 40 at a time.
 *
 * RETRIES, AND THEN SAYS WHAT IT COULD NOT GET. A commune whose centre is
 * missing loses every unplaced plant in it — the roll-up has nowhere to sit —
 * so a transient 503 from geo.api.gouv.fr silently shrinks the registry.
 * Measured on two consecutive runs of this script on 2026-08-31: one resolved
 * 1 819 communes and the next 1 802, and the difference was 27 plants that
 * vanished from the output with nothing in the diff to explain it. Three
 * attempts with backoff, then a second sweep of whatever is still missing, and
 * the caller decides what to do with the remainder.
 *
 * @returns {Promise<{centres: Map<string, object>, missing: Array<string>}>}
 */
async function fetchCommuneCentres(codes, timeoutMs) {
  const centres = new Map();
  const wanted = [...codes].filter(Boolean);

  const resolve = async (code) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        let rows = await getJson(`${GEO_API}?code=${encodeURIComponent(code)}&fields=code,nom,centre`, timeoutMs);
        const parent = parentCommune(code);
        if ((!Array.isArray(rows) || !rows.length) && parent !== code) {
          rows = await getJson(`${GEO_API}?code=${encodeURIComponent(parent)}&fields=code,nom,centre`, timeoutMs);
        }
        const centre = Array.isArray(rows) ? rows[0]?.centre?.coordinates : null;
        // An empty array is a real answer — this code is not a commune — and
        // retrying it just burns requests. A THROWN error is the transient one.
        if (!Array.isArray(centre) || centre.length < 2) return null;
        return [code, { lat: Number(centre[1]), lon: Number(centre[0]), nom: rows[0]?.nom || null }];
      } catch {
        await sleep(250 * (attempt + 1));
      }
    }
    return null;
  };

  for (const pass of [wanted, null]) {
    const list = pass || wanted.filter((code) => !centres.has(code));
    if (!list.length) break;
    if (!pass) process.stderr.write(`  retrying ${list.length} commune(s)…\n`);
    for (let i = 0; i < list.length; i += 40) {
      const results = await Promise.all(list.slice(i, i + 40).map(resolve));
      for (const entry of results) if (entry) centres.set(entry[0], entry[1]);
    }
  }
  return { centres, missing: wanted.filter((code) => !centres.has(code)) };
}

// --- Placement --------------------------------------------------------------

/**
 * A coarse spatial index over the OSM candidates.
 *
 * 2 757 plants × 1 947 candidates is five million haversines run three times
 * over; bucketing by tenth-of-a-degree makes each lookup a handful of cells.
 * Nothing about the result depends on it.
 */
function buildGrid(plants) {
  const grid = new Map();
  for (const plant of plants) {
    const key = `${Math.round(plant.lat * 10)}:${Math.round(plant.lon * 10)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(plant);
  }
  return grid;
}

function candidatesNear(grid, centre, radiusKm) {
  const span = Math.ceil(radiusKm / 11) + 1;
  const baseLat = Math.round(centre.lat * 10);
  const baseLon = Math.round(centre.lon * 10);
  const out = [];
  for (let i = -span; i <= span; i += 1) {
    for (let j = -span; j <= span; j += 1) {
      for (const plant of grid.get(`${baseLat + i}:${baseLon + j}`) || []) {
        if (plant.claimed) continue;
        const km = haversineKm(centre, plant);
        if (km <= radiusKm) out.push({ km, plant });
      }
    }
  }
  return out.sort((a, b) => a.km - b.km);
}

/**
 * Find this plant's position, best evidence first.
 *
 * Returns null when no source places it — which is a RESULT, not a failure, and
 * is what sends the row to its commune's cluster.
 */
function placePlant(plant, {
  edfStations, grid, generators, switchyards, centres, maxAnchorKm, rowsInCommune,
}) {
  const centre = centres.get(plant.insee) || null;
  const normalized = normalizeHydroName(plant.name);

  // 0. THE REGISTER CONTRADICTING ITSELF.
  //
  // Before any tier that trusts the commune, check the commune against the
  // row's own source substation — two published codes, one on each side. Four
  // rows fail it by thousands of kilometres (see COMMUNE_CONTRADICTION_KM), and
  // for those the commune is simply the wrong field: every commune-based tier
  // would place the plant on the wrong continent, and the commune ring would
  // file it there too. The substation wins, because `postesource` ↔
  // `ref:FR:RTE` is a code match and the commune is a code that does not agree
  // with it.
  const rteRef = plant.operator === 'RTE' ? String(plant.poste ?? '').trim() : '';
  if (centre && rteRef) {
    const yards = switchyards.get(rteRef) || [];
    const nearest = yards.reduce((best, yard) => {
      const km = haversineKm(centre, yard);
      return best && best.km <= km ? best : { km, yard };
    }, null);
    if (nearest && nearest.km > COMMUNE_CONTRADICTION_KM) {
      nearest.yard.claimed = true;
      return {
        lat: round5(nearest.yard.lat),
        lon: round5(nearest.yard.lon),
        placement: 'rte-switchyard',
        placementRef: nearest.yard.id,
        placementName: nearest.yard.name,
        matchedBy: 'postesource',
        geometry: 'switchyard',
        outlineSpanM: null,
        snapKm: null,
        anchorKm: null,
        // Carried into the file so the card can show the reader both claims
        // rather than silently preferring one.
        communeContradictedKm: Math.round(nearest.km),
      };
    }
  }

  // 1. EDF's own coordinate for its own station, if the names agree and the
  //    point lands inside the commune's ring. The ring test is what stops a
  //    name collision from teleporting a plant across France.
  if (normalized) {
    for (const [key, station] of edfStations) {
      if (station.claimed) continue;
      if (hydroNameMatch(normalized, key) < 1) continue;
      const km = centre ? haversineKm(centre, station) : null;
      if (km !== null && km > maxAnchorKm) continue;
      station.claimed = true;
      return {
        lat: round5(station.lat),
        lon: round5(station.lon),
        placement: 'edf-published',
        placementRef: `edf:${station.centrale}`,
        placementName: station.centrale,
        matchedBy: 'name',
        geometry: 'published-point',
        outlineSpanM: null,
        snapKm: null,
        anchorKm: km === null ? null : Math.round(km * 100) / 100,
      };
    }
  }

  if (!centre) return null;
  const candidates = candidatesNear(grid, centre, maxAnchorKm);
  if (!candidates.length) return null;

  /**
   * Claim a matched candidate — but only if its geometry can BE a position.
   *
   * A match is an identity claim ("this OSM object is this register row") and a
   * position is a separate claim ("and it is here"). The first can succeed
   * while the second fails, which is exactly what a 12 km `type=site` relation
   * is: certainly Grand-Maison, certainly not a point. Returning null here
   * sends the row to its commune ring with its identity unused rather than
   * drawing it in a forest.
   */
  const claim = (entry, matchedBy) => {
    const resolved = resolveOsmPosition(entry.plant, generators);
    if (!resolved) return null;
    // The ring is re-tested on the RESOLVED point, not on the candidate's bbox
    // centre. Snapping to a generating hall moves a position by up to 7,5 km,
    // so a candidate that passed the ring as a 12 km-wide scheme can land
    // outside it as a building — and a guard that only checks the value it is
    // about to throw away is not a guard.
    const km = haversineKm(centre, resolved);
    if (km > maxAnchorKm) return null;
    entry.plant.claimed = true;
    return {
      lat: round5(resolved.lat),
      lon: round5(resolved.lon),
      placement: 'osm-plant',
      placementRef: entry.plant.id,
      placementName: entry.plant.name,
      matchedBy,
      // Which OBJECT the coordinate is: the mapped outline itself, or the
      // generators inside a scheme too large to be one.
      geometry: resolved.geometry,
      outlineSpanM: Math.round(resolved.spanM),
      snapKm: resolved.snapKm,
      anchorKm: Math.round(km * 100) / 100,
    };
  };

  // 2. Name. Strongest evidence available for a named row, and the only tier
  //    that can tell two same-sized plants on one river apart.
  if (normalized) {
    let best = null;
    let bestStrength = 0;
    for (const entry of candidates) {
      const strength = hydroNameMatch(normalized, entry.plant.normalized);
      if (strength > bestStrength) { bestStrength = strength; best = entry; }
      if (bestStrength === 1) break;
    }
    if (best) {
      const claimed = claim(best, bestStrength === 1 ? 'name' : 'name-partial');
      if (claimed) return claimed;
    }
  }

  // 3. Megawatts, but ONLY when exactly one candidate in the ring matches.
  //    Two candidates at the same power is not evidence, it is a coin toss, and
  //    the plant goes to its commune instead.
  const targetMw = plant.kw / 1000;
  const tolerance = Math.max(0.15 * targetMw, 0.05);
  const byPower = candidates.filter((entry) => (
    entry.plant.mw !== null && Math.abs(entry.plant.mw - targetMw) <= tolerance
  ));
  if (byPower.length === 1) {
    const claimed = claim(byPower[0], 'power');
    if (claimed) return claimed;
  }

  // 4. Sole candidate for the sole row in the commune. Nothing else it could
  //    be — and if the commune held two rows or two candidates, this does not
  //    fire.
  if (rowsInCommune === 1 && candidates.length === 1) {
    const claimed = claim(candidates[0], 'sole');
    if (claimed) return claimed;
  }

  // 5. The RTE switchyard whose published `ref:FR:RTE` IS this row's
  //    `postesource`. A published code on both sides, so the IDENTITY is not in
  //    doubt — but a yard is not a generating hall, and the card says so.
  //
  //    RTE-CONNECTED ROWS ONLY. On an RTE row the `postesource` IS the plant's
  //    own switchyard, metres from the machines: the Hourat's yard is 120 m
  //    from its powerhouse. On an Enedis row it is a DISTRIBUTION substation
  //    serving a whole area, kilometres away and shared by every producer
  //    connected to it — using it would both misplace the plant and stack a
  //    dozen of them on one pixel, which is the exact pair of failures the
  //    commune ring exists to avoid. 403 of the register's 2 742 rows are
  //    RTE-connected; the other 2 339 skip this tier.
  const ref = plant.operator === 'RTE' ? String(plant.poste ?? '').trim() : '';
  for (const yard of (ref ? switchyards.get(ref) || [] : [])) {
    if (yard.claimed) continue;
    const km = haversineKm(centre, yard);
    if (km > maxAnchorKm) continue;
    yard.claimed = true;
    return {
      lat: round5(yard.lat),
      lon: round5(yard.lon),
      placement: 'rte-switchyard',
      placementRef: yard.id,
      placementName: yard.name,
      matchedBy: 'postesource',
      geometry: 'switchyard',
      outlineSpanM: null,
      snapKm: null,
      anchorKm: Math.round(km * 100) / 100,
    };
  }

  return null;
}

// --- Report -----------------------------------------------------------------

const BRACKETS = Object.freeze([
  { label: '≥ 100 MW', min: 100_000 },
  { label: '10–100 MW', min: 10_000 },
  { label: '4,5–10 MW', min: 4_500 },
  { label: '1–4,5 MW', min: 1_000 },
  { label: '< 1 MW', min: 0 },
]);

function bracketOf(kw) {
  return BRACKETS.find((bracket) => kw >= bracket.min) || BRACKETS[BRACKETS.length - 1];
}

function printReport(placed, unplaced) {
  const all = [...placed, ...unplaced];
  const rows = new Map(BRACKETS.map((b) => [b.label, { total: 0, placed: 0, kw: 0, placedKw: 0, anon: 0 }]));
  for (const plant of all) {
    const row = rows.get(bracketOf(plant.kw).label);
    row.total += 1;
    row.kw += plant.kw;
    if (plant.anonymous) row.anon += 1;
    if (plant.lat !== undefined && plant.lat !== null) { row.placed += 1; row.placedKw += plant.kw; }
  }
  process.stderr.write('\n  Couverture par tranche de puissance\n');
  process.stderr.write(`  ${'tranche'.padEnd(11)}${'total'.padStart(7)}${'placées'.padStart(9)}${'taux'.padStart(7)}`
    + `${'GW'.padStart(8)}${'GW placés'.padStart(11)}${'anonymes'.padStart(10)}\n`);
  for (const bracket of BRACKETS) {
    const row = rows.get(bracket.label);
    if (!row.total) continue;
    process.stderr.write(
      `  ${bracket.label.padEnd(11)}${String(row.total).padStart(7)}${String(row.placed).padStart(9)}`
      + `${`${Math.round((100 * row.placed) / row.total)}%`.padStart(7)}`
      + `${(row.kw / 1e6).toFixed(2).padStart(8)}${(row.placedKw / 1e6).toFixed(2).padStart(11)}`
      + `${String(row.anon).padStart(10)}\n`,
    );
  }
  const by = {};
  const geom = {};
  for (const plant of placed) {
    by[plant.matchedBy] = (by[plant.matchedBy] || 0) + 1;
    geom[plant.geometry] = (geom[plant.geometry] || 0) + 1;
  }
  process.stderr.write(`\n  Preuve du placement : ${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(', ')}\n`);
  process.stderr.write(`  Objet positionné    : ${Object.entries(geom).map(([k, v]) => `${k} ${v}`).join(', ')}\n`);
  const snapped = placed.filter((p) => Number.isFinite(p.snapKm) && p.snapKm > 0);
  if (snapped.length) {
    const km = snapped.map((p) => p.snapKm).sort((a, b) => a - b);
    process.stderr.write(
      `  ${snapped.length} centrale(s) recalées du centre d'emprise vers leur salle des machines : `
      + `médiane ${km[Math.floor(km.length / 2)].toFixed(1)} km, max ${km[km.length - 1].toFixed(1)} km\n`,
    );
  }
  const wide = placed.filter((p) => Number.isFinite(p.outlineSpanM) && p.outlineSpanM > COMPACT_SPAN_M);
  process.stderr.write(`  ${placed.filter((p) => p.geometry === 'outline').length} positionnées sur une emprise `
    + `de moins de ${COMPACT_SPAN_M} m; ${wide.length} sur une emprise plus large (recalées)\n`);
  const anchors = placed.map((p) => p.anchorKm).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (anchors.length) {
    process.stderr.write(
      `  Distance au centre de commune : médiane ${anchors[Math.floor(anchors.length / 2)].toFixed(1)} km, `
      + `p90 ${anchors[Math.floor(anchors.length * 0.9)].toFixed(1)} km, max ${anchors[anchors.length - 1].toFixed(1)} km\n`,
    );
  }
}

// --- Main -------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  process.stderr.write(`ODRÉ — registre national, filière ${HYDRO_FILIERE}`
    + `${args.floorKw ? ` (≥ ${args.floorKw} kW)` : ''}…\n`);
  const { rows, edition, modified } = await fetchRegistre(args);
  const plants = [];
  // The rows the projection refuses, kept as a COUNT and a reason rather than
  // vanishing: every one of them is a row the register published and this file
  // does not carry, and a reader deserves to see the difference between 2 757
  // and 2 742 explained rather than discovered.
  const aggregates = { rows: 0, kw: 0, label: null };
  for (const row of rows) {
    const projected = projectHydroRow(row);
    if (projected) { plants.push(projected); continue; }
    aggregates.rows += 1;
    aggregates.kw += Number(row?.puismaxinstallee) || 0;
    aggregates.label = aggregates.label || String(row?.nominstallation ?? '').trim() || null;
  }
  process.stderr.write(`  ${plants.length} installations, `
    + `${(plants.reduce((sum, p) => sum + p.kw, 0) / 1e6).toFixed(2)} GW\n`);
  if (aggregates.rows) {
    // Measured 2026-08-31: 15 rows named "Agrégation des installations de
    // moins de 36KW", 24,3 MW, published per REGION with no commune and no
    // coordinate anyone could ever resolve. They are a real part of France's
    // hydro fleet and there is nowhere honest to draw them.
    process.stderr.write(
      `  ${aggregates.rows} row(s) carry no commune — ${(aggregates.kw / 1000).toFixed(1)} MW `
      + `of "${aggregates.label}" left out, recorded in the file's \`excluded\`\n`,
    );
  }
  if (!plants.length) throw new Error('the register returned no hydro rows — refusing to write an empty registry');

  process.stderr.write('EDF Open Data — centrales hydrauliques…\n');
  let edfStations = new Map();
  try {
    edfStations = await fetchEdfStations(args.timeout);
    process.stderr.write(`  ${edfStations.size} stations\n`);
  } catch (error) {
    process.stderr.write(`  ⚠ unavailable (${error.message}) — falling back to OSM for the big plants\n`);
  }

  process.stderr.write('OpenStreetMap — power=plant + plant:source=hydro…\n');
  let osmPlants = [];
  let generators = [];
  let switchyards = new Map();
  let osmFailure = null;
  try {
    const elements = await cachedOverpass('fr-hydro-plants-bb', OVERPASS_PLANTS, {
      timeoutMs: args.timeout,
      minElements: 500,
      refresh: args.refreshOsm,
    });
    osmPlants = projectOsmPlants(elements);
    // "inside the parse box", not "inside France": the query box reaches into
    // Spain, Italy, Switzerland, Germany and Belgium, and it is the 12 km
    // commune ring — not this count — that keeps a Navarrese plant from
    // anchoring a Béarnais one.
    const oversized = osmPlants.filter((p) => p.spanM > COMPACT_SPAN_M).length;
    process.stderr.write(`  ${osmPlants.length} candidates inside the parse box, `
      + `${oversized} of them wider than ${COMPACT_SPAN_M} m\n`);

    const oversizedPlants = osmPlants.filter((p) => p.spanM > COMPACT_SPAN_M && p.box);
    if (oversizedPlants.length) {
      process.stderr.write('OpenStreetMap — power=generator inside those emprises…\n');
      generators = projectOsmGenerators(await cachedOverpass(
        'fr-hydro-generators',
        generatorQuery(oversizedPlants),
        { timeoutMs: args.timeout, minElements: 100, refresh: args.refreshOsm },
      ));
      process.stderr.write(`  ${generators.length} generators\n`);
    }

    process.stderr.write('OpenStreetMap — power=substation ref:FR:RTE…\n');
    switchyards = projectSwitchyards(await cachedOverpass('fr-rte-switchyards-bb', OVERPASS_SWITCHYARDS, {
      timeoutMs: args.timeout,
      minElements: 1000,
      refresh: args.refreshOsm,
    }));
    process.stderr.write(`  ${switchyards.size} distinct RTE codes\n`);
  } catch (error) {
    osmFailure = error;
  }
  if (osmFailure && !args.allowPartial) {
    throw new Error(
      `OpenStreetMap is unavailable (${osmFailure.message}). Refusing to write a registry that would `
      + 'roll almost every plant in France up to its commune centre. Retry later, or pass '
      + '--allow-partial to accept that deliberately.',
    );
  }
  if (osmFailure) process.stderr.write(`  ⚠ writing a DEGRADED registry: ${osmFailure.message}\n`);

  process.stderr.write('IGN BD TOPO — zone_d_activite_ou_d_interet, nature=Centrale électrique…\n');
  let ignPlants = { byInsee: new Map(), total: 0, skipped: 0 };
  try {
    ignPlants = await fetchIgnPlants(args.timeout);
    process.stderr.write(`  ${ignPlants.total} features, ${ignPlants.skipped} écartées `
      + `(non hydro ou hors service), ${ignPlants.byInsee.size} communes\n`);
  } catch (error) {
    // A tier that improves precision is not a tier the build depends on: the
    // other four still place plants, and losing this one costs accuracy rather
    // than correctness. It is reported, not fatal.
    process.stderr.write(`  ⚠ IGN unavailable (${error.message}) — positions keep their OSM/EDF anchors\n`);
  }

  process.stderr.write('geo.api.gouv.fr — commune centres…\n');
  const wantedCommunes = new Set(plants.map((p) => p.insee));
  const { centres, missing } = await fetchCommuneCentres(wantedCommunes, 30_000);
  process.stderr.write(`  ${centres.size} of ${wantedCommunes.size} centres\n`);
  // A missing centre is not cosmetic: it deletes plants from the output. The
  // build refuses rather than writing a registry whose row count silently
  // depends on how geo.api.gouv.fr felt this afternoon.
  if (missing.length && !args.allowPartial) {
    throw new Error(
      `geo.api.gouv.fr did not place ${missing.length} commune(s) after retries `
      + `(${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ', …' : ''}). `
      + 'Every unplaced plant in them would be dropped from the registry. Retry later, or pass '
      + '--allow-partial to accept that deliberately.',
    );
  }

  const rowsInCommune = new Map();
  for (const plant of plants) {
    rowsInCommune.set(plant.insee, (rowsInCommune.get(plant.insee) || 0) + 1);
  }

  // Largest first: a 74 MW plant claims the outline before a 0,4 MW one can
  // take it on a shared token.
  const ordered = [...plants].sort((a, b) => b.kw - a.kw || a.id.localeCompare(b.id));
  const grid = buildGrid(osmPlants);
  const placed = [];
  const unplaced = [];
  for (const plant of ordered) {
    const anchor = placePlant(plant, {
      edfStations,
      grid,
      generators,
      switchyards,
      centres,
      maxAnchorKm: args.maxAnchorKm,
      rowsInCommune: rowsInCommune.get(plant.insee) || 1,
    });
    if (anchor) placed.push({ ...plant, ...anchor });
    else unplaced.push(plant);
  }

  // ── IGN BD TOPO, in two passes ──────────────────────────────────────────
  //
  // The order matters. A plant another tier has already IDENTIFIED gets first
  // claim on the footprint nearest to it, so the refinement pass cannot be
  // gazumped by a nameless row in the same commune taking the wrong building.
  const ignStats = {
    refined: 0, placed: 0, shiftM: [], byMatch: {},
  };
  if (ignPlants.byInsee.size) {
    // Pass 1 — REFINE. Every (placed plant, footprint) pair in the same commune
    // and within IGN_SNAP_M, assigned globally nearest-first so two plants in
    // one valley cannot swap buildings.
    const pairs = [];
    for (const plant of placed) {
      for (const feature of ignPlants.byInsee.get(plant.insee) || []) {
        const m = haversineKm(plant, feature) * 1000;
        if (m <= IGN_SNAP_M) pairs.push({ m, plant, feature });
      }
    }
    pairs.sort((a, b) => a.m - b.m);
    const taken = new Set();
    for (const { m, plant, feature } of pairs) {
      if (feature.claimed || taken.has(plant.id)) continue;
      feature.claimed = true;
      taken.add(plant.id);
      // The identity evidence is UNCHANGED — IGN did not identify this plant,
      // it only says where the building is. What changes is the coordinate and
      // the object it points at, and both say so.
      plant.corroborates = plant.placement;
      plant.placement = 'ign-bdtopo';
      plant.geometry = 'ign-footprint';
      plant.ignRef = feature.id;
      plant.ignKind = feature.kind;
      plant.ignPrecisionM = feature.precisionM;
      plant.ignShiftM = Math.round(m);
      plant.outlineSpanM = Math.round(feature.spanM);
      plant.lat = round5(feature.lat);
      plant.lon = round5(feature.lon);
      const centre = centres.get(plant.insee);
      if (centre) plant.anchorKm = Math.round(haversineKm(centre, plant) * 100) / 100;
      ignStats.refined += 1;
      ignStats.shiftM.push(m);
    }

    // Pass 2 — PLACE. Rows nothing else could position at all.
    const stillUnplaced = [];
    const unplacedInCommune = new Map();
    for (const plant of unplaced) {
      unplacedInCommune.set(plant.insee, (unplacedInCommune.get(plant.insee) || 0) + 1);
    }
    for (const plant of [...unplaced].sort((a, b) => b.kw - a.kw)) {
      const free = (ignPlants.byInsee.get(plant.insee) || []).filter((f) => !f.claimed);
      // Explicitly hydro beats merely not-explicitly-something-else.
      free.sort((a, b) => Number(b.sure) - Number(a.sure));
      const normalized = normalizeHydroName(plant.name);
      let hit = null;
      let matchedBy = null;
      if (normalized) {
        hit = free.find((f) => f.normalized && hydroNameMatch(normalized, f.normalized) === 1) || null;
        if (hit) matchedBy = 'toponyme';
      }
      // No name on either side, so the only thing that can carry the claim is
      // that the commune leaves exactly one possibility on each side. A commune
      // with two unplaced rows, or two free footprints, is an ambiguity and
      // goes to the ring rather than to a coin toss.
      if (!hit && free.length === 1 && unplacedInCommune.get(plant.insee) === 1) {
        [hit] = free;
        matchedBy = 'insee-sole';
      }
      if (!hit) { stillUnplaced.push(plant); continue; }
      hit.claimed = true;
      const centre = centres.get(plant.insee);
      placed.push({
        ...plant,
        lat: round5(hit.lat),
        lon: round5(hit.lon),
        placement: 'ign-bdtopo',
        placementRef: hit.id,
        placementName: hit.name,
        matchedBy,
        geometry: 'ign-footprint',
        outlineSpanM: Math.round(hit.spanM),
        snapKm: null,
        ignRef: hit.id,
        ignKind: hit.kind,
        ignPrecisionM: hit.precisionM,
        ignShiftM: null,
        // The ring is NOT applied here. It exists to catch a join built on a
        // guess, and this join is built on an INSEE code both publishers
        // print: IGN says the footprint is in this commune, the register says
        // the plant is. A large mountain commune can legitimately put the two
        // more than 12 km from its centre.
        anchorKm: centre ? Math.round(haversineKm(centre, hit) * 100) / 100 : null,
      });
      ignStats.placed += 1;
      ignStats.byMatch[matchedBy] = (ignStats.byMatch[matchedBy] || 0) + 1;
    }
    unplaced.length = 0;
    unplaced.push(...stillUnplaced);

    const shift = ignStats.shiftM.slice().sort((a, b) => a - b);
    process.stderr.write(
      `  IGN BD TOPO : ${ignStats.refined} position(s) recalées sur l'emprise levée par l'IGN`
      + `${shift.length ? ` (médiane ${shift[Math.floor(shift.length / 2)].toFixed(0)} m,`
        + ` max ${shift[shift.length - 1].toFixed(0)} m)` : ''}`
      + `, ${ignStats.placed} nouvelle(s) centrale(s) placées`
      + `${Object.keys(ignStats.byMatch).length
        ? ` (${Object.entries(ignStats.byMatch).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''}\n`,
    );
  }

  const clusters = clusterUnplaced(unplaced, centres);
  const clustered = clusters.reduce((sum, c) => sum + c.plants, 0);
  const orphans = unplaced.filter((p) => !centres.has(p.insee));
  if (orphans.length) {
    process.stderr.write(
      `  ⚠ ${orphans.length} plant(s) in a commune geo.api.gouv.fr does not place — dropped: `
      + `${orphans.map((p) => `${p.commune || '?'} (${p.insee})`).join(', ')}\n`,
    );
  }
  if (unplaced.length - clustered !== orphans.length) {
    throw new Error(`${unplaced.length - clustered} plant(s) lost between the placement pass and the clusters`);
  }

  placed.sort((a, b) => b.kw - a.kw || a.id.localeCompare(b.id));
  const summary = summarizeHydro(placed, clusters);

  if (args.report) printReport(placed, unplaced);

  const document = {
    generated: new Date().toISOString().slice(0, 10),
    floorKw: args.floorKw,
    maxAnchorKm: args.maxAnchorKm,
    registre: { dataset: HYDRO_REGISTRY_DATASET, edition, modified },
    sources: [
      'ODRÉ — Registre national des installations de production et de stockage d’électricité (Licence Ouverte 2.0)',
      'IGN — BD TOPO®, zone_d_activite_ou_d_interet / nature=Centrale électrique (Licence Ouverte 2.0)',
      'EDF Open Data — localisation des centrales hydrauliques d’EDF SA (Licence Ouverte 2.0)',
      '© OpenStreetMap contributors (ODbL 1.0) — power=plant, plant:source=hydro',
      'geo.api.gouv.fr — centre de commune (Licence Ouverte)',
    ],
    stats: summary,
    // What the register holds and this file does not, stated in the file.
    excluded: {
      noCommune: { rows: aggregates.rows, kw: Math.round(aggregates.kw * 1000) / 1000, label: aggregates.label },
      noCommuneCentre: orphans.map((p) => ({ insee: p.insee, commune: p.commune, kw: p.kw })),
    },
    plants: placed,
    clusters,
  };

  await fsp.mkdir(path.dirname(args.out), { recursive: true });
  await fsp.writeFile(args.out, `${JSON.stringify(document, null, 0)}\n`, 'utf8');
  const bytes = (await fsp.stat(args.out)).size;
  process.stderr.write(
    `\n${path.relative(ROOT, args.out)} — ${summary.plants} installations `
    + `(${summary.placed} placées, ${summary.clustered} regroupées sur ${summary.communes} communes), `
    + `${(summary.installedKw / 1e6).toFixed(2)} GW, ${(bytes / 1024).toFixed(0)} KB\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`\n✖ ${error.message}\n`);
  process.exitCode = 1;
});
