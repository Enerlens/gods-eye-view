// The join the audit called impossible: a vigilance label that names the river.
//
// `docs/PLAN-CROISEMENTS.md` recorded two obstacles and called the second the
// real one — "un tronçon Vigicrues ne porte AUCUN code de département : le
// rattacher demanderait un point-dans-polygone de chaque tronçon contre chaque
// contour départemental, à chaque bulletin".
//
// It is only that expensive if you do it for all 337 reaches. Outside an
// episode every reach is green and no label mentions rivers at all, so the
// work is bounded by what is RAISED — which is what these tests pin down,
// alongside the two ways the join could lie: naming a river under a wind
// warning, and crediting one département for a reach that crosses four.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VIGICRUES_ALERT_LEVEL,
  VIGICRUES_SAMPLES_PER_REACH,
  buildVigicruesRecords,
  raisedVigicruesSamples,
} from './vigicrues.js';
import {
  VIGILANCE_FLOOD_PHENOMENON,
  VIGILANCE_REACH_NAME_LIMIT,
  vigilanceLabelText,
  vigilanceReachNames,
} from './meteoFranceVigilance.js';
import { buildDepartementIndex, locateDepartement } from './franceDepartements.js';

/** A reach as the geometry document publishes it: parts of [lon, lat]. */
const reach = (id, name, points) => ({ id, name, parts: [points], updatedAt: null });

test('a calm France offers nothing to place', () => {
  // Every reach green — this layer's own headline for ordinary weather.
  const records = buildVigicruesRecords(
    [reach('A', 'Loire aval', [[2, 47], [3, 47.5]])],
    { A: 1 },
  );
  assert.equal(raisedVigicruesSamples(records).length, 0);
});

test('a raised reach is sampled along its length, not at its middle', () => {
  const line = [];
  for (let i = 0; i <= 40; i += 1) line.push([-1 + i * 0.1, 47]);
  const records = buildVigicruesRecords([reach('A', 'Loire aval', line)], { A: 3 });
  const [sample] = raisedVigicruesSamples(records);
  assert.equal(sample.id, 'A');
  assert.equal(sample.level, 3);
  assert.equal(sample.points.length, VIGICRUES_SAMPLES_PER_REACH);
  // The ends are in, which is the whole point: a reach that leaves its
  // département must be sampled where it leaves.
  assert.deepEqual(sample.points[0], line[0]);
  assert.deepEqual(sample.points[sample.points.length - 1], line[line.length - 1]);
});

test('a reach shorter than the sample count is sampled as far as it goes', () => {
  const records = buildVigicruesRecords([reach('A', 'Petit ru', [[2, 47], [2.1, 47]])], { A: 2 });
  const [sample] = raisedVigicruesSamples(records);
  assert.equal(sample.points.length, 2);
  assert.equal(VIGICRUES_ALERT_LEVEL, 2, 'yellow is already raised');
});

test('a reach in several parts is sampled over the WHOLE reach', () => {
  // A long trunk and a three-vertex stub. Sampling the parts independently
  // would spend a fifth of the budget on the stub.
  const trunk = [];
  for (let i = 0; i <= 20; i += 1) trunk.push([0 + i * 0.1, 47]);
  const records = buildVigicruesRecords(
    [{ id: 'A', name: 'Aude aval', parts: [trunk, [[9, 42], [9.1, 42], [9.2, 42]]], updatedAt: null }],
    { A: 3 },
  );
  const [sample] = raisedVigicruesSamples(records);
  assert.equal(sample.points.length, VIGICRUES_SAMPLES_PER_REACH);
  const onStub = sample.points.filter(([lon]) => lon >= 9).length;
  assert.ok(onStub <= 1, `the 3-vertex stub took ${onStub} of ${VIGICRUES_SAMPLES_PER_REACH} samples`);
});

test('the names are most-severe first, capped, and the rest counted', () => {
  const names = vigilanceReachNames([
    { name: 'Berre', level: 2 },
    { name: 'Orbieu', level: 3 },
    { name: 'Aude aval', level: 2 },
    { name: 'Cesse', level: 2 },
  ]);
  assert.equal(names, 'Orbieu, Aude aval, Berre +1');
  assert.equal(VIGILANCE_REACH_NAME_LIMIT, 3);
  // Nothing to say is `null`, so the caller appends nothing rather than a
  // dangling separator — and an EMPTY list is nothing to say too.
  assert.equal(vigilanceReachNames([]), null);
  assert.equal(vigilanceReachNames(null), null);
});

test('the label keeps its old shape when no river is offered', () => {
  const record = {
    code: '11',
    name: 'Aude',
    level: { level: 3, label: 'Orange' },
    phenomena: [{ id: '4', name: 'Crues', level: { level: 3 } }],
  };
  assert.equal(vigilanceLabelText(record), 'Aude · Orange · Crues');
  assert.equal(
    vigilanceLabelText(record, [{ name: 'Orbieu', level: 3 }]),
    'Aude · Orange · Crues · Orbieu',
  );
});

test('the flood phenomenon is read from the published table, not written down', () => {
  assert.equal(VIGILANCE_FLOOD_PHENOMENON, '4');
});

test('a reach crossing two départements is named in both', () => {
  // Two unit squares side by side, standing in for the bundled outlines.
  const index = buildDepartementIndex({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { code: '01', nom: 'Ouest' },
        geometry: { type: 'Polygon', coordinates: [[[0, 46], [1, 46], [1, 48], [0, 48], [0, 46]]] },
      },
      {
        type: 'Feature',
        properties: { code: '02', nom: 'Est' },
        geometry: { type: 'Polygon', coordinates: [[[1, 46], [2, 46], [2, 48], [1, 48], [1, 46]]] },
      },
    ],
  });
  const line = [];
  for (let i = 0; i <= 20; i += 1) line.push([0.2 + i * 0.08, 47]);
  const records = buildVigicruesRecords([reach('A', 'Rivière', line)], { A: 3 });
  const [sample] = raisedVigicruesSamples(records);
  const codes = new Set();
  for (const [lon, lat] of sample.points) {
    // A STRING, not a record. The production join read `?.code` off it at
    // first and would have named no river at all, silently, for ever.
    const code = locateDepartement(index, lat, lon);
    assert.equal(typeof code, 'string', 'locateDepartement answers an INSEE code');
    codes.add(code);
  }
  assert.deepEqual([...codes].sort(), ['01', '02'],
    'a reach that leaves its département must be named in the one it enters');
});
