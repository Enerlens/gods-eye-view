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
  GPU_MAX_RING_VERTICES,
  SUP_TYPE_LABELS,
  buildGpuUrl,
  decimateRing,
  projectGpu,
  projectServitudes,
  projectZones,
} from './gpuFeed.js';

const read = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const ZONING = read('gpu-zone-urba-sample.json');
const ENCLAVES = read('gpu-zone-urba-enclaves-sample.json');
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

test('the enclaves cost bytes, and the projection still pays for itself', () => {
  const projected = projectGpu({ zoning: ENCLAVES, servitudes: null });
  const after = JSON.stringify(projected).length;
  assert.ok(after * 2 < JSON.stringify(ENCLAVES).length,
    `${after} must still be well under half of the captured answer`);
});
