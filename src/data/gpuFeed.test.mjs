// src/data/gpuFeed.test.mjs
// Pins the UPSTREAM Géoportail de l'urbanisme shapes against real captured
// APIcarto answers. The projection here is mostly a weight problem: 1.4 MB of
// servitude geometry arrives for a single point, and every byte of it is a
// legally-drawn boundary published to the millimetre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GPU_COORDINATE_DECIMALS,
  GPU_MAX_FEATURE_PARTS,
  GPU_MAX_FEATURE_VERTICES,
  GPU_UPSTREAM_LIMIT,
  GPU_MAX_RING_VERTICES,
  SUP_TYPE_LABELS,
  buildGpuBoxUrl,
  buildGpuUrl,
  decimateRing,
  gpuTruncation,
  projectGpu,
  projectServitudes,
  projectZones,
} from './gpuFeed.js';
import { pointInPolygons } from './ringGeometry.js';

const read = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const ZONING = read('gpu-zone-urba-sample.json');
const ENCLAVES = read('gpu-zone-urba-enclaves-sample.json');
/** The exact coordinate APIcarto answered `UB` for, in the village centre. */
const USTARITZ = { lon: -1.454242, lat: 43.395303 };
const SERVITUDES = read('gpu-assiette-sup-s-sample.json');

test('the captured answers still carry every field the projection reads', () => {
  const zone = ZONING.features[0].properties;
  for (const key of ['gid', 'libelle', 'libelong', 'typezone', 'partition', 'idurba', 'datvalid']) {
    assert.ok(Object.hasOwn(zone, key), `zone.${key} must still be published`);
  }
  const sup = SERVITUDES.features[0].properties;
  // There is NO `categorie` on a servitude — the type is `suptype`. A
  // projection reading `categorie` would label every servitude `null`.
  assert.equal(Object.hasOwn(sup, 'categorie'), false);
  for (const key of ['suptype', 'typeass', 'nomass', 'idass', 'paramcalc']) {
    assert.ok(Object.hasOwn(sup, key), `sup.${key} must still be published`);
  }
});

test('the point is sent as a GeoJSON geometry, not as lat/lon parameters', () => {
  const url = new URL(buildGpuUrl('zone-urba', { lon: 2.3760, lat: 48.8300 }));
  assert.deepEqual(JSON.parse(url.searchParams.get('geom')), {
    type: 'Point', coordinates: [2.376, 48.83],
  });
  assert.throws(() => buildGpuUrl('zone-urba', { lon: NaN, lat: 48 }), /must be finite/);
});

test('the zoning answer keeps what a buyer would ask of a PLU', () => {
  const [zone] = projectZones(ZONING);
  assert.equal(zone.code, 'UG');
  assert.equal(zone.label, 'Zone urbaine générale');
  assert.equal(zone.kind, 'U');
  assert.equal(zone.partition, 'DU_75056');
  assert.equal(zone.approvedOn, '20260616');
  assert.equal(zone.regulationFile, '75056_reglement_20260616.pdf');
});

test('a servitude code becomes the sentence a buyer needs', () => {
  const servitudes = projectServitudes(SERVITUDES);
  const railway = servitudes.find((entry) => entry.code === 't1');
  assert.equal(railway.label, 'Voie ferrée — zone de protection');
  assert.equal(railway.bufferM, 50);
  const monument = servitudes.find((entry) => entry.code === 'ac1');
  assert.equal(monument.label, "Abords d'un monument historique");
  assert.equal(monument.bufferM, 500);
  // The airport noise-exposure family is mapped even though this point has
  // none: it is the servitude the Paris demo exists to be able to show.
  assert.equal(SUP_TYPE_LABELS.t5, 'Servitude aéronautique de dégagement (aérodrome)');
});

test('an unmapped code keeps its code rather than disappearing', () => {
  const projected = projectServitudes({
    features: [{
      properties: { suptype: 'zz9', idass: 'x' },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] },
    }],
  });
  assert.equal(projected[0].label, 'ZZ9');
  assert.equal(projected.length, 1, 'a servitude nobody has named is still a servitude');
});

test('a ring over the per-ring cap is decimated, and says so', () => {
  const railway = projectServitudes(SERVITUDES).find((entry) => entry.code === 't1');
  assert.equal(railway.sourceVertices, 1394);
  assert.ok(railway.parts.flat(2).length <= GPU_MAX_RING_VERTICES);
  assert.equal(railway.simplified, true);
});

test('a per-ring cap alone is not enough, and the measurement is why', () => {
  // The live `pm1` envelope is ONE feature made of 759 separate polygons, every
  // one of them under the per-ring cap. Capping only rings left 37,983 points
  // standing. The fixture keeps 30 of those polygons so the per-feature budget
  // still has something to bite on.
  const wide = projectServitudes(SERVITUDES)
    .filter((entry) => entry.code === 'pm1')
    .find((entry) => entry.sourceParts > GPU_MAX_FEATURE_PARTS);
  assert.equal(wide.sourceParts, 30);
  assert.equal(wide.servedParts, GPU_MAX_FEATURE_PARTS);
  assert.equal(wide.simplified, true);
});

test('a feature within both budgets is served whole and unflagged', () => {
  const intact = projectServitudes(SERVITUDES)
    .filter((entry) => entry.code === 'pm1')
    .find((entry) => entry.sourceParts === 23);
  assert.equal(intact.servedParts, 23);
  assert.equal(intact.simplified, false, 'nothing was dropped, so nothing is claimed');
});

test('coordinates are rounded to a metre and collapsed duplicates dropped', () => {
  const { ring, simplified } = decimateRing([
    [2.376000001, 48.830000001],
    [2.376000002, 48.830000002],
    [2.377, 48.831],
    [2.378, 48.832],
  ]);
  // The first two points are 10 cm apart and become one.
  assert.equal(ring.length, 3);
  assert.equal(simplified, false);
  for (const [lon, lat] of ring) {
    assert.equal(String(lon).split('.')[1].length <= GPU_COORDINATE_DECIMALS, true);
    assert.equal(String(lat).split('.')[1].length <= GPU_COORDINATE_DECIMALS, true);
  }
});

test('the projection cuts the payload by an order of magnitude', () => {
  const projected = projectGpu({ zoning: ZONING, servitudes: SERVITUDES });
  const before = JSON.stringify(ZONING).length + JSON.stringify(SERVITUDES).length;
  const after = JSON.stringify(projected).length;
  assert.ok(after * 2 < before, `${after} must be well under half of ${before}`);
  assert.equal(projected.available.zoning, true);
  assert.equal(projected.available.servitudes, true);
});

test('one failed endpoint leaves the other standing', () => {
  const projected = projectGpu({ zoning: ZONING, servitudes: null });
  assert.equal(projected.zones.length, 1);
  assert.deepEqual(projected.servitudes, []);
  assert.equal(projected.available.servitudes, false);
});

// The reported symptom, in the operator's own words: "comment c'est possible
// qu'une maison puisse se retrouver en même temps dans deux zones de PLU ?"
// The register was right and the projection was wrong — it kept outer rings
// and threw the enclaves away, so a filled UB swallowed a school and an
// industrial estate. These pin the real answer for the real point.
test('an enclave inside a zone survives the projection', () => {
  const [zone] = projectZones(ENCLAVES);
  assert.equal(zone.code, 'UB');
  assert.equal(zone.kind, 'U');
  assert.equal(zone.parts.length, 1, 'one piece of ground');
  assert.equal(zone.parts[0].length, 3, 'an outer ring and TWO interior rings');
  assert.equal(zone.holes, 2);
});

test('the enclave rings are inside the outer ring, not beside it', () => {
  const [zone] = projectZones(ENCLAVES);
  const [outer, ...holes] = zone.parts[0];
  const bounds = (ring) => ring.reduce((box, [lon, lat]) => ({
    west: Math.min(box.west, lon),
    east: Math.max(box.east, lon),
    south: Math.min(box.south, lat),
    north: Math.max(box.north, lat),
  }), {
    west: Infinity, east: -Infinity, south: Infinity, north: -Infinity,
  });
  const outerBox = bounds(outer);
  for (const hole of holes) {
    const box = bounds(hole);
    assert.ok(box.west >= outerBox.west && box.east <= outerBox.east
      && box.south >= outerBox.south && box.north <= outerBox.north,
    'a hole this projection keeps must lie within the ring it perforates');
  }
});

test('a hole is never dropped while the ring it perforates survives', () => {
  // Half a donut is not a cheaper donut. Rebuilt with an outer ring far over
  // the vertex budget, so the part is taken and its holes must come with it.
  const ring = (cx, cy, r, n) => Array.from({ length: n }, (unused, i) => [
    Number((cx + (r * Math.cos((2 * Math.PI * i) / n))).toFixed(5)),
    Number((cy + (r * Math.sin((2 * Math.PI * i) / n))).toFixed(5)),
  ]);
  const [zone] = projectZones({
    features: [{
      properties: { gid: 1, libelle: 'UB', typezone: 'U' },
      geometry: {
        type: 'Polygon',
        coordinates: [ring(2, 48, 0.02, 5000), ring(2, 48, 0.004, 900), ring(2.01, 48, 0.002, 40)],
      },
    }],
  });
  assert.equal(zone.holes, 2);
  assert.equal(zone.parts[0][0].length <= GPU_MAX_RING_VERTICES + 1, true);
  assert.equal(zone.simplified, true, 'the outer ring was decimated and says so');
});

test('the enclaves cost vertices, and the budget still holds', () => {
  // Measured on the drawn shape rather than on bytes: the byte ratio of one
  // small zone sits near a half and would flip on a field being added, which
  // makes it a test of the payload's shape rather than of the budget.
  const [zone] = projectZones(ENCLAVES);
  const drawn = zone.parts.reduce((sum, part) => sum + part.reduce((n, ring) => n + ring.length, 0), 0);
  assert.ok(drawn <= GPU_MAX_FEATURE_VERTICES + GPU_MAX_RING_VERTICES,
    `${drawn} vertices must stay inside the per-feature budget`);
  assert.equal(zone.sourceRings, 3, 'the outer ring and its two enclaves were all read');
  assert.ok(zone.sourceVertices > drawn, 'the upstream was heavier than what is drawn');
});

// ── The box regime ──────────────────────────────────────────────────────────

test('a box is asked for as a Polygon, with the cap the service actually has', () => {
  const url = new URL(buildGpuBoxUrl('zone-urba', {
    south: 43.385, west: -1.464, north: 43.405, east: -1.444,
  }));
  const geom = JSON.parse(url.searchParams.get('geom'));
  assert.equal(geom.type, 'Polygon');
  assert.equal(geom.coordinates[0].length, 5, 'a closed ring');
  assert.deepEqual(geom.coordinates[0][0], geom.coordinates[0][4]);
  // Asking for more than the service will send buys nothing and hides the
  // truncation behind a number the caller chose.
  assert.equal(url.searchParams.get('_limit'), String(GPU_UPSTREAM_LIMIT));
  assert.throws(() => buildGpuBoxUrl('zone-urba', { south: 1, west: 2, north: 0, east: 3 }), /ordered/);
  assert.throws(() => buildGpuBoxUrl('zone-urba', { south: NaN }), /finite/);
});

test('truncation is read from totalFeatures, because HTTP 200 will not say it', () => {
  // Measured 2026-09-01: a 0.40° box over Paris returns 5 000 of 17 182 and a
  // 1.0° Île-de-France box 5 000 of 46 500 — both HTTP 200, no warning.
  assert.deepEqual(gpuTruncation({ features: new Array(5000), totalFeatures: 17182 }),
    { truncated: true, returned: 5000, total: 17182 });
  assert.equal(gpuTruncation({ features: new Array(55), totalFeatures: 55 }).truncated, false);
  // No count published is not evidence of truncation; inventing a refusal
  // would blank a layer that had a perfectly good answer.
  assert.equal(gpuTruncation({ features: new Array(12) }).truncated, false);
  assert.equal(gpuTruncation(null).truncated, false);
});

test('under a POINT query the service decided, and this does not second-guess it', () => {
  // The trap, measured on the real Ustaritz answer: APIcarto returns `UB` for
  // this exact coordinate, and the coordinate falls OUTSIDE the ring after the
  // 521→400 decimation, because a straightened edge cut across it. Deciding
  // `atPoint` from the drawn shape would contradict the register by exactly
  // the tolerance the layer already declares.
  const [zone] = projectZones(ENCLAVES, { point: USTARITZ, boxed: false });
  assert.equal(zone.atPoint, true);
  assert.equal(pointInPolygons(zone.parts, USTARITZ.lon, USTARITZ.lat), false,
    'the drawn ring really does exclude the point — that is why the flag is not read from it');
});

test('under a BOX query this decides, from the ring as PUBLISHED', () => {
  const [zone] = projectZones(ENCLAVES, { point: USTARITZ, boxed: true });
  assert.equal(zone.atPoint, true, 'the published ring contains the point, and it is the one asked');
  const away = projectZones(ENCLAVES, { point: { lon: 2.35, lat: 48.85 }, boxed: true });
  assert.equal(away[0].atPoint, false, 'a point in Paris is not in an Ustaritz zone');
});

test('a zone the operator is standing in sorts before the neighbours', () => {
  const neighbour = structuredClone(ENCLAVES.features[0]);
  neighbour.properties = { ...neighbour.properties, gid: 999, libelle: 'A', typezone: 'A' };
  // Move it far enough that it cannot hold the point.
  neighbour.geometry.coordinates = neighbour.geometry.coordinates.map(
    (part) => part.map((ring) => ring.map(([lon, lat]) => [lon + 1, lat + 1])),
  );
  const zones = projectZones({ features: [neighbour, ENCLAVES.features[0]] },
    { point: USTARITZ, boxed: true });
  assert.equal(zones.length, 2);
  assert.equal(zones[0].code, 'UB');
  assert.equal(zones[0].atPoint, true);
  assert.equal(zones[1].atPoint, false);
});

test('every zone carries a label anchor inside its own drawn shape', () => {
  const [zone] = projectZones(ENCLAVES);
  assert.ok(zone.anchor, 'a zone this size must be labellable');
  assert.equal(pointInPolygons(zone.parts, zone.anchor.lon, zone.anchor.lat), true);
  // Rounded like the rings: this is a place to stand a label, not a survey.
  assert.ok(String(zone.anchor.lon).split('.')[1].length <= GPU_COORDINATE_DECIMALS);
});

test('the assembled document says which question it answered', () => {
  const box = { south: 43.385, west: -1.464, north: 43.405, east: -1.444 };
  const asPoint = projectGpu({ zoning: ENCLAVES, servitudes: null, point: USTARITZ });
  assert.equal(asPoint.regime, 'point');
  assert.equal(asPoint.box, null);
  assert.equal(asPoint.zonesAtPoint, 1);

  const asBox = projectGpu({ zoning: ENCLAVES, servitudes: null, point: USTARITZ, box });
  assert.equal(asBox.regime, 'box');
  assert.deepEqual(asBox.box, box);
  assert.equal(asBox.zonesAtPoint, 1);
});

test('a refused zoning half draws nothing and reports the true count', () => {
  // Not an empty answer and not an error: a zoning map missing four fifths of
  // itself looks exactly like a commune with genuinely mixed zoning.
  const refused = projectGpu({
    zoning: ENCLAVES,
    servitudes: SERVITUDES,
    point: USTARITZ,
    box: { south: 43, west: -2, north: 44, east: -1 },
    zoningRefused: { found: 46500, limit: GPU_UPSTREAM_LIMIT },
  });
  assert.deepEqual(refused.zones, []);
  assert.equal(refused.zoningRefused.found, 46500);
  assert.equal(refused.available.zoning, false, 'a refusal is not an available answer');
  assert.ok(refused.servitudes.length > 0, 'the other half is untouched');
});
