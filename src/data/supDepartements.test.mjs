// The national rollup of the higher-education layer.
//
// Run against the REAL bundled département polygons and the REAL register
// fixture. The fact this module exists to state honestly — that the polygons
// are metropolitan-only, so La Réunion and Polynésie française cannot be
// painted — is a property of that actual file, and a synthetic index would
// have neither the gap nor the coastline that makes the snap necessary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildDepartementIndex } from './franceDepartements.js';
import {
  SUP_COAST_SNAP_KM,
  SUP_DEPARTEMENT_BINS,
  projectSupDepartements,
} from './supDepartements.js';
import { SUP_CYCLES, SUP_KINDS, indexSupOffers, projectSupSites } from './supFeed.js';

const INDEX = buildDepartementIndex(JSON.parse(readFileSync(
  new URL('./local_data/france_departements/departements.geojson', import.meta.url),
  'utf8',
)));
const ATLAS = JSON.parse(readFileSync(
  new URL('./fixtures/sup-atlas-sample.json', import.meta.url),
  'utf8',
));
const OFFERS = JSON.parse(readFileSync(
  new URL('./fixtures/sup-parcoursup-sample.json', import.meta.url),
  'utf8',
));

const REGISTER = projectSupSites({
  records: ATLAS,
  offers: indexSupOffers(OFFERS),
  rentree: '2024',
  session: '2026',
});

const at = (lat, lon, extra = {}) => ({
  id: `${lat},${lon}`,
  uai: extra.uai || `U${lat}`,
  lat,
  lon,
  kind: 'universite',
  sector: 'public',
  students: 100,
  cycles: { licence: 100, master: 0, doctorat: 0 },
  ...extra,
});

test('the bundled polygons are metropolitan-only — the premise of everything below', () => {
  assert.equal(INDEX.list.length, 96);
  for (const code of ['971', '972', '973', '974', '976', '987', '988']) {
    assert.equal(INDEX.byCode.has(code), false, `${code} should not be in the bundle`);
  }
});

test('assignment is point-in-polygon, so no code convention has to match', () => {
  // The register spells the département `D075`; the polygons say `75`. A code
  // join would miss every row and would do it silently.
  const out = projectSupDepartements({
    records: null,
    sites: [at(48.8566, 2.3522, { dept: 'D075', deptName: '75 - Paris' })],
    index: INDEX,
  });
  assert.equal(out.assigned, 1);
  assert.equal(out.departements.find((row) => row.code === '75').students, 100);
});

test('an overseas site is named and reported, never snapped to metropolitan France', () => {
  // The nearest French polygon to a campus in Cayenne is 7 000 km away. It is
  // counted as a shortfall, not moved.
  const out = projectSupDepartements({
    sites: [at(4.9224, -52.3135, { deptName: '973 - Guyane' })],
    index: INDEX,
  });
  assert.equal(out.assigned, 0);
  assert.equal(out.unassigned, 1);
  assert.equal(out.snapped, 0);
  assert.deepEqual(out.offshore, [{ name: '973 - Guyane', sites: 1, students: 100 }]);
  assert.equal(out.studentsAssigned, 0);
  // The total still knows about it — the shortfall is stated, not deducted.
  assert.equal(out.students, 100);
});

test('the real fixture puts La Réunion and Polynésie française offshore, by name', () => {
  const out = projectSupDepartements({ sites: REGISTER.sites, index: INDEX });
  const names = out.offshore.map((row) => row.name);
  assert.ok(names.some((name) => name.startsWith('974')));
  assert.ok(names.some((name) => name.startsWith('987')));
  // Naming them is the point: a `—` bucket would be an unreadable shortfall.
  assert.ok(out.offshore.every((row) => row.name !== '—'));
  assert.equal(out.assigned + out.unassigned, REGISTER.count);
});

test('a site just off the simplified coast snaps, and is counted as having done so', () => {
  // The bundled outlines are ~14 000 vertices for all of France, so a
  // seafront campus can sit in the drawn sea. Moving a point is a thing the
  // map did, and it is reported rather than absorbed.
  const out = projectSupDepartements({
    sites: [at(43.5480, 7.1400, { deptName: '06 - Alpes-Maritimes' })],
    index: INDEX,
    snapKm: 5,
  });
  assert.equal(out.assigned, 1);
  assert.equal(out.snapped, 1);
  const out0 = projectSupDepartements({
    sites: [at(43.5480, 7.1400)],
    index: INDEX,
    snapKm: 0,
  });
  assert.equal(out0.assigned, 0);
  assert.equal(out0.unassigned, 1);
});

test('the snap default is the shared one, not a number invented here', () => {
  assert.equal(SUP_COAST_SNAP_KM, 2);
});

test('the choropleth is binned on STUDENTS, and the card carries the site count', () => {
  // The departure from `schools-fr`, and the reason this layer exists: a map
  // of sites is a map of where lycées are, which is already drawn elsewhere.
  const out = projectSupDepartements({
    sites: [
      at(48.8566, 2.3522, { students: 50_000, uai: 'A' }),
      at(48.8570, 2.3530, { students: 40_000, uai: 'B' }),
      at(45.7640, 4.8357, { students: 10, uai: 'C' }),
      at(45.7650, 4.8360, { students: 10, uai: 'D' }),
      at(45.7660, 4.8370, { students: 10, uai: 'E' }),
      at(45.7670, 4.8380, { students: 10, uai: 'F' }),
    ],
    index: INDEX,
  });
  const paris = out.departements.find((row) => row.code === '75');
  const rhone = out.departements.find((row) => row.code === '69');
  // Paris has FEWER sites and far more students; it must outrank the Rhône.
  assert.ok(paris.sites < rhone.sites);
  assert.ok(paris.bin > rhone.bin);
  assert.equal(paris.students, 90_000);
  assert.equal(rhone.sites, 4);
});

test('an establishment spread over several sites is counted once as an establishment', () => {
  const out = projectSupDepartements({
    sites: [
      at(48.8566, 2.3522, { uai: 'SAME' }),
      at(48.8600, 2.3600, { uai: 'SAME' }),
      at(48.8700, 2.3700, { uai: 'OTHER' }),
    ],
    index: INDEX,
  });
  const paris = out.departements.find((row) => row.code === '75');
  assert.equal(paris.sites, 3);
  // Adding the dots would claim three universities where there are two.
  assert.equal(paris.etabs, 2);
});

test('the per-band and per-cycle breakdowns add up to the département', () => {
  const out = projectSupDepartements({ sites: REGISTER.sites, index: INDEX });
  for (const row of out.departements) {
    assert.equal(SUP_KINDS.reduce((total, kind) => total + row.kinds[kind], 0), row.sites);
    assert.equal(
      SUP_CYCLES.reduce((total, cycle) => total + row.cycles[cycle], 0),
      row.students,
      row.code,
    );
  }
  assert.equal(
    out.departements.reduce((total, row) => total + row.students, 0),
    out.studentsAssigned,
  );
  assert.equal(
    out.departements.reduce((total, row) => total + row.sites, 0),
    out.assigned,
  );
});

test('a département with no students is absence, not the bottom of the ramp', () => {
  const out = projectSupDepartements({
    sites: [at(48.8566, 2.3522)],
    index: INDEX,
  });
  assert.equal(out.painted, 1);
  const empty = out.departements.filter((row) => row.students === 0);
  assert.equal(empty.length, 95);
  // `countBin` returns -1 for a value below the first bin, and the layer
  // refuses to paint that — a zero-student département must not be shaded.
  for (const row of empty) assert.ok(row.bin < 0 || row.students === 0);
});

test('density is per 1 000 km² of the polygon that is actually DRAWN', () => {
  const out = projectSupDepartements({
    sites: [at(48.8566, 2.3522, { students: 1000 })],
    index: INDEX,
  });
  const paris = out.departements.find((row) => row.code === '75');
  assert.ok(paris.areaKm2 > 0);
  assert.ok(Math.abs(paris.per1000Km2 - (1000 / paris.areaKm2) * 1000) < 1e-9);
});

test('the bin count is six, and the thresholds are quantiles over the painted set', () => {
  assert.equal(SUP_DEPARTEMENT_BINS, 6);
  const out = projectSupDepartements({ sites: REGISTER.sites, index: INDEX });
  assert.equal(out.binCount, 6);
  assert.equal(out.thresholds.length, 5);
  for (let i = 1; i < out.thresholds.length; i += 1) {
    assert.ok(out.thresholds[i] >= out.thresholds[i - 1]);
  }
});

test('an empty or malformed input is an empty rollup, not a throw', () => {
  for (const sites of [[], null, undefined, 'nope', [null, { lat: 'x', lon: 2 }]]) {
    const out = projectSupDepartements({ sites, index: INDEX });
    assert.equal(out.assigned, 0);
    assert.equal(out.painted, 0);
    assert.equal(out.departements.length, 96);
  }
  // No index at all is an empty list, not a crash on `index.list`.
  const out = projectSupDepartements({ sites: REGISTER.sites });
  assert.deepEqual(out.departements, []);
});
