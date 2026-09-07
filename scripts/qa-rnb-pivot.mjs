#!/usr/bin/env node
/**
 * qa-rnb-pivot — is the Référentiel National des Bâtiments still the pivot?
 *
 * No browser and no dev server. The claim this harness defends is arithmetic
 * over three live public services, and every number in `rnbPivot.js` came from
 * running it: IGN's BD TOPO vector tiles, the RNB API, and the ADEME DPE
 * register. It decodes the same tiles the layer would draw, with the same
 * module, and runs the same `joinPointsToBuildings` the map runs.
 *
 * What it proves, in order:
 *
 *  A. THE TILES STILL CARRY THE KEY. The share of drawn footprints publishing
 *     `identifiants_rnb`. Measured 95.5 % (Paris 13e) to 99.2 % (Lyon,
 *     Marseille) on 2026-09-07. If IGN stopped shipping it, the identity join
 *     degrades silently to the geometric one and nothing else would say so.
 *
 *  B. THE TWO REGISTERS NAME EACH OTHER. For every RNB building carrying a
 *     `bdtopo` ext_id, does that `cleabs` match the tile that carries the same
 *     RNB id? 573 of 573 on the Lyon sample, zero disagreements. This is the
 *     calibration behind calling it an identity join rather than a heuristic —
 *     the same discipline `rrnBornage.mjs` applies to the kilometre posts.
 *
 *  C. THE PIVOT STILL BUYS WHAT IT CLAIMS. DPE rows joined to those footprints
 *     by the geocoded dot alone, against the identity-first join the map now
 *     runs. Paris 13e 81.8 % → 96.3 %, Lyon 2e 40.4 % → 75.7 %, Marseille
 *     78.8 % → 88.9 %, Ustaritz 14.0 % → 41.5 %.
 *
 *  D. WHAT THE DOT WAS GETTING WRONG. Rows both methods place, on two
 *     different buildings. Small and never zero: 2, 4, 83 and 4 across the four
 *     boxes — every one of them a volume painted with a neighbour's letter.
 *
 * A service that is down is reported as "not testable here", not as a failure:
 * three upstreams means three ways to have a bad afternoon that says nothing
 * about this repository.
 *
 * Run: node scripts/qa-rnb-pivot.mjs [--box paris|lyon|marseille|ustaritz|all]
 */
import { PbfReader } from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
import {
  BDTOPO_LAYER_NAME,
  bdtopoTileUrl,
  bdtopoTiles,
} from '../src/data/bdtopoBuildingsFeed.js';
import { buildFootprintIndex, joinPointsToBuildings, locateBuilding } from '../src/data/buildingTheme.js';
import {
  RNB_API_BASE,
  indexFootprintsByRnb,
  parseRnbIds,
  projectRnbBuilding,
  rnbFootprintCoverage,
} from '../src/data/rnbPivot.js';
import { DPE_FIELDS } from '../src/data/dpeFeed.js';

const ADEME_LINES = 'https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines';

/**
 * The four boxes every measured number in `rnbPivot.js` was taken over.
 *
 * Two dense city centres, one southern port and one rural commune, because the
 * gain is NOT uniform and a harness run on Paris alone would report a register
 * that is thin everywhere else as healthy.
 */
const BOXES = {
  paris: { label: 'Paris 13e', west: 2.3720, south: 48.8280, east: 2.3800, north: 48.8320 },
  lyon: { label: 'Lyon 2e', west: 4.8200, south: 45.7530, east: 4.8320, north: 45.7610 },
  marseille: { label: 'Marseille', west: 5.3700, south: 43.2900, east: 5.3820, north: 43.2980 },
  ustaritz: { label: 'Ustaritz', west: -1.4600, south: 43.3900, east: -1.4450, north: 43.4000 },
};

/** Floor under A, well below the 95.5 % worst box: this is a smoke alarm. */
const MIN_TILE_COVERAGE = 0.80;
/** Floor under B. One edition disagreeing on a tenth of its own ids is a break. */
const MIN_CROSS_AGREEMENT = 0.98;
/**
 * How many RNB pages B reads per box. The API serves 20 per page, so this is a
 * 600-building sample — the size every calibration number in `rnbPivot.js` was
 * taken over, so a harness run reproduces the header rather than approximating
 * it.
 */
const RNB_PAGE_LIMIT = 30;

const args = process.argv.slice(2);
const boxArg = (() => {
  const index = args.indexOf('--box');
  return index >= 0 && args[index + 1] ? args[index + 1] : 'all';
})();
const selected = boxArg === 'all' ? Object.keys(BOXES) : [boxArg];
for (const key of selected) {
  if (!BOXES[key]) {
    console.error(`unknown box "${key}" — one of ${Object.keys(BOXES).join(', ')}, or all`);
    process.exit(2);
  }
}

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const mark = ok === null ? '○' : (ok ? '✔' : '✖');
  console.log(`  ${mark} ${name}${detail ? ` — ${detail}` : ''}`);
}
const percent = (part, total) => (total ? `${((100 * part) / total).toFixed(1)} %` : 'n/a');

/**
 * Decode the tiles the layer would load for this box into join-shaped
 * footprints.
 *
 * Deliberately the layer's OWN geometry path, minus the seating: the ring, the
 * courtyards and the `identifiants_rnb` split all come from the same code the
 * browser runs, so a harness pass means the browser would see the same thing.
 */
async function footprintsFor(box) {
  const { tiles } = bdtopoTiles(box);
  const footprints = [];
  let refused = 0;
  for (const tile of tiles) {
    let bytes;
    try {
      const response = await fetch(bdtopoTileUrl(tile));
      if (response.status === 404) continue; // an empty square, not a failure
      if (!response.ok) { refused += 1; continue; }
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch { refused += 1; continue; }
    if (!bytes.length) continue;
    const layer = new VectorTile(new PbfReader(bytes)).layers?.[BDTOPO_LAYER_NAME];
    if (!layer) continue;
    for (let index = 0; index < layer.length; index += 1) {
      const feature = layer.feature(index);
      const props = feature.properties || {};
      const geojson = feature.toGeoJSON(tile.x, tile.y, tile.z);
      const polygons = geojson.geometry?.type === 'MultiPolygon'
        ? geojson.geometry.coordinates
        : [geojson.geometry?.coordinates];
      const rnb = parseRnbIds(props.identifiants_rnb);
      for (const polygon of polygons) {
        const ring = polygon?.[0];
        if (!ring || ring.length < 4) continue;
        const degrees = [];
        for (const [lon, lat] of ring) degrees.push(lon, lat);
        const holes = [];
        for (let h = 1; h < polygon.length; h += 1) {
          const inner = polygon[h];
          if (!inner || inner.length < 4) continue;
          const flat = [];
          for (const [lon, lat] of inner) flat.push(lon, lat);
          holes.push(flat);
        }
        footprints.push({
          id: `bdtopo:${props.cleabs}:${footprints.length}`,
          cleabs: props.cleabs ? String(props.cleabs) : null,
          degrees,
          holes,
          rnb,
        });
      }
    }
  }
  return { footprints, refused, tiles: tiles.length };
}

/** Every RNB building in the box, up to the page limit. */
async function rnbBuildingsIn(box) {
  let url = `${RNB_API_BASE}/buildings/?bbox=${box.west},${box.south},${box.east},${box.north}`;
  const buildings = [];
  for (let page = 0; url && page < RNB_PAGE_LIMIT; page += 1) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`RNB bbox: HTTP ${response.status}`);
    const body = await response.json();
    if (!Array.isArray(body.results)) throw new Error('RNB bbox: no results');
    for (const entry of body.results) {
      const projected = projectRnbBuilding(entry);
      if (projected) buildings.push(projected);
    }
    url = body.next || null;
  }
  return buildings;
}

/** Every DPE row in the box, through the field selection the proxy pins. */
async function dpeRowsIn(box) {
  const select = DPE_FIELDS.join(',');
  const url = `${ADEME_LINES}?size=5000&select=${encodeURIComponent(select)}`
    + `&bbox=${box.west},${box.south},${box.east},${box.north}`;
  const response = await fetch(url);
  // A 400 here is the whole reason `DPE_FIELDS` is pinned: this dataset refuses
  // a column it does not publish rather than ignoring it.
  if (!response.ok) throw new Error(`ADEME: HTTP ${response.status}`);
  const body = await response.json();
  return {
    total: body.total ?? null,
    rows: (Array.isArray(body.results) ? body.results : []).map((row) => {
      const [lat, lon] = String(row._geopoint || '').split(',').map(Number);
      return {
        id: row.numero_dpe,
        rnb: String(row.id_rnb ?? '').trim() || null,
        lat: Number.isFinite(lat) ? lat : null,
        lon: Number.isFinite(lon) ? lon : null,
      };
    }),
  };
}

for (const key of selected) {
  const box = BOXES[key];
  console.log(`\n── ${box.label} (${box.west},${box.south} → ${box.east},${box.north}) ──`);

  let footprints = [];
  let tileCount = 0;
  try {
    const loaded = await footprintsFor(box);
    footprints = loaded.footprints;
    tileCount = loaded.tiles;
    if (loaded.refused) console.log(`      ${loaded.refused} of ${tileCount} tiles refused`);
  } catch (error) {
    record('A. the BD TOPO tiles still carry the RNB identifier', null,
      `Géoplateforme unreachable: ${error.message}`);
    continue;
  }

  // ── A. the key is on the tile ────────────────────────────────────────────
  const coverage = rnbFootprintCoverage(footprints);
  record(
    'A. the BD TOPO tiles still carry the RNB identifier',
    coverage.footprints > 0 && coverage.coverage >= MIN_TILE_COVERAGE,
    `${coverage.withId}/${coverage.footprints} footprints (${percent(coverage.withId, coverage.footprints)}), `
    + `${coverage.distinctIds} distinct ids · ${coverage.multiId} polygons carry several `
    + `· ${coverage.splitIds} ids are drawn as several polygons`,
  );

  // ── B. the two registers name each other ─────────────────────────────────
  const byRnb = indexFootprintsByRnb(footprints);
  const cleabsByRnb = new Map();
  for (const footprint of footprints) {
    for (const id of footprint.rnb) {
      if (!cleabsByRnb.has(id)) cleabsByRnb.set(id, new Set());
      if (footprint.cleabs) cleabsByRnb.get(id).add(footprint.cleabs);
    }
  }
  try {
    const buildings = await rnbBuildingsIn(box);
    let agree = 0;
    let disagree = 0;
    let unknownHere = 0;
    let withExtId = 0;
    const examples = [];
    for (const building of buildings) {
      if (!building.bdtopoCleabs) continue;
      withExtId += 1;
      const drawn = cleabsByRnb.get(building.rnbId);
      if (!drawn) { unknownHere += 1; continue; }
      if (drawn.has(building.bdtopoCleabs)) agree += 1;
      else {
        disagree += 1;
        if (examples.length < 3) {
          examples.push(`${building.rnbId}: RNB says ${building.bdtopoCleabs}, tile says ${[...drawn].join('/')}`);
        }
      }
    }
    const checked = agree + disagree;
    record(
      'B. the RNB and BD TOPO name each other, cleabs for cleabs',
      checked > 0 && agree / checked >= MIN_CROSS_AGREEMENT,
      `${agree}/${checked} agree (${percent(agree, checked)}) over ${buildings.length} RNB buildings; `
      + `${withExtId} carry a bdtopo ext_id, ${unknownHere} name no drawn polygon`,
    );
    for (const example of examples) console.log(`      ${example}`);
  } catch (error) {
    record('B. the RNB and BD TOPO name each other, cleabs for cleabs', null,
      `RNB API unreachable: ${error.message}`);
  }

  // ── C and D. what the pivot buys, and what the dot got wrong ─────────────
  try {
    const { total, rows } = await dpeRowsIn(box);
    const index = buildFootprintIndex(footprints);
    let dotOnly = 0;
    let disagreement = 0;
    for (const row of rows) {
      const hit = Number.isFinite(row.lon) && Number.isFinite(row.lat)
        ? locateBuilding(index, row.lon, row.lat)
        : null;
      if (hit) dotOnly += 1;
      const targets = row.rnb ? byRnb.get(row.rnb) : null;
      if (hit && targets && !targets.includes(hit)) disagreement += 1;
    }
    // The join the map actually runs, on the same inputs.
    const join = joinPointsToBuildings(footprints, rows);
    const withKey = rows.filter((row) => row.rnb).length;
    record(
      'C. the identity join reaches more diagnostics than the dot',
      rows.length > 0 && join.matchedPoints >= dotOnly,
      `${dotOnly} → ${join.matchedPoints} of ${rows.length} rows `
      + `(${percent(dotOnly, rows.length)} → ${percent(join.matchedPoints, rows.length)})`
      + `${total !== null && total > rows.length ? `, ${total} in the box` : ''}; `
      + `${percent(withKey, rows.length)} of rows carry an id_rnb`,
    );
    console.log(`      ${join.matchedById} by identifier, ${join.matchedByPoint} by geocode, `
      + `${join.idOffScreen} name a building this box does not draw, `
      + `${join.unmatchedPoints + join.unplacedPoints} reach no volume at all`);
    record(
      'D. and it re-attributes the ones the dot put on a neighbour (informational)',
      null,
      `${disagreement} of ${rows.length} rows were painted on a different building by the dot`,
    );
  } catch (error) {
    record('C. the identity join reaches more diagnostics than the dot', null,
      `ADEME unreachable: ${error.message}`);
  }
}

const failed = results.filter((result) => result.ok === false).length;
const skipped = results.filter((result) => result.ok === null).length;
console.log(`\n  ${results.length - failed - skipped}/${results.length - skipped} checks passed`
  + `${skipped ? ` (${skipped} informational or not testable here)` : ''}\n`);
process.exit(failed ? 1 : 0);
