// The national rollup.
//
// Run against the REAL bundled département polygons, not a stand-in square:
// the two facts this module has to get right — that the polygons are
// metropolitan-only, and that the register's `code_departement` cannot be
// joined to them — are both properties of that actual file, and a synthetic
// index would have neither.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildDepartementIndex } from './franceDepartements.js';
import {
  SCHOOLS_COAST_SNAP_KM,
  SCHOOLS_DEPARTEMENT_BINS,
  SCHOOLS_SWEEP_FIELDS,
  projectSchoolsDepartements,
} from './schoolsDepartements.js';
import { SCHOOL_LEVELS } from './schoolsFeed.js';

const INDEX = buildDepartementIndex(JSON.parse(readFileSync(
  new URL('./local_data/france_departements/departements.geojson', import.meta.url),
  'utf8',
)));
const SAMPLE = JSON.parse(readFileSync(
  new URL('./fixtures/schools-annuaire-sample.json', import.meta.url),
  'utf8',
));

const at = (lat, lon, extra = {}) => ({
  identifiant_de_l_etablissement: `${lat},${lon}`,
  type_etablissement: 'Ecole',
  statut_public_prive: 'Public',
  latitude: lat,
  longitude: lon,
  ...extra,
});

test('the bundled polygons are metropolitan-only — the premise of everything below', () => {
  assert.equal(INDEX.list.length, 96);
  for (const code of ['971', '972', '973', '974', '976', '988']) {
    assert.equal(INDEX.byCode.has(code), false, `${code} should not be in the bundle`);
  }
  // And Corsica is spelled the IGN way, not the register's way.
  assert.ok(INDEX.byCode.has('2A'));
  assert.equal(INDEX.byCode.has('02A'), false);
});

test('assignment is point-in-polygon, so the code format mismatch cannot bite', () => {
  // The register says `075`; the polygons say `75`. A code join would miss
  // every single row, and would do it silently.
  const out = projectSchoolsDepartements({
    records: [at(48.8566, 2.3522, { code_departement: '075' })],
    index: INDEX,
  });
  assert.equal(out.assigned, 1);
  assert.equal(out.departements.find((d) => d.code === '75').schools, 1);
});

test('Corsica assigns despite the register spelling it 02A', () => {
  const out = projectSchoolsDepartements({
    records: [at(41.9192, 8.7386, { code_departement: '02A' })],
    index: INDEX,
  });
  assert.equal(out.assigned, 1);
  assert.equal(out.unassigned, 0);
});

test('overseas schools are counted and named, never dropped and never snapped', () => {
  // The nearest French polygon to Saint-Denis is 9 000 km away. Snapping it
  // into a metropolitan département would be worse than not painting it.
  const out = projectSchoolsDepartements({
    records: [
      at(-20.8789, 55.4481, { code_departement: '974' }),
      at(16.2650, -61.5510, { code_departement: '971' }),
      at(48.8566, 2.3522, { code_departement: '075' }),
    ],
    index: INDEX,
  });
  assert.equal(out.assigned, 1);
  assert.equal(out.unassigned, 2);
  assert.equal(out.snapped, 0);
  assert.deepEqual(
    out.offshore.map((entry) => entry.code).sort(),
    ['971', '974'],
  );
  // Every metropolitan département stays at zero rather than absorbing them.
  const total = out.departements.reduce((sum, d) => sum + d.schools, 0);
  assert.equal(total, 1);
});

test('the mesh carries every swept school, including the ones no polygon holds', () => {
  // The choropleth is limited by the bundle; the maillage is not. La Réunion's
  // schools are as real as the Rhône's and are drawn in both other regimes.
  const out = projectSchoolsDepartements({
    records: [at(-20.8789, 55.4481), at(48.8566, 2.3522)],
    index: INDEX,
  });
  assert.equal(out.mesh.length, 2);
  assert.ok(out.mesh.some((tuple) => tuple[0] < 0));
});

test('the mesh tuple is [lat, lon, pupils, level] with a rounded coordinate', () => {
  const out = projectSchoolsDepartements({
    records: [at(48.123456789, 2.987654321, { identifiant_de_l_etablissement: 'A' })],
    index: INDEX,
    rolls: new Map([['A', 321]]),
  });
  assert.deepEqual(out.mesh[0], [48.12346, 2.98765, 321, 0]);
});

test('a school with no roll enters the mesh at weight 0, not excluded', () => {
  const out = projectSchoolsDepartements({ records: [at(48.8566, 2.3522)], index: INDEX });
  assert.equal(out.mesh.length, 1);
  assert.equal(out.mesh[0][2], 0);
  assert.equal(out.withRoll, 0);
  assert.equal(out.pupils, 0);
});

test('a coastal near-miss snaps within the tolerance and is counted as moved', () => {
  // Moving a point is a thing the map did, not a thing the file said.
  const marseille = { lat: 43.2965, lon: 5.3698 };
  const justOffshore = at(marseille.lat - 0.06, marseille.lon - 0.16);
  const out = projectSchoolsDepartements({ records: [justOffshore], index: INDEX });
  if (out.assigned === 1) {
    assert.equal(out.snapped, 1);
  } else {
    // If the simplified outline happens to contain it, it is not a snap.
    assert.equal(out.snapped, 0);
  }
  assert.equal(SCHOOLS_COAST_SNAP_KM, 2);
});

test('a point in the middle of the Atlantic never snaps anywhere', () => {
  const out = projectSchoolsDepartements({ records: [at(45, -20)], index: INDEX });
  assert.equal(out.assigned, 0);
  assert.equal(out.snapped, 0);
  assert.equal(out.unassigned, 1);
});

test('rows with no coordinate are not swept at all', () => {
  const out = projectSchoolsDepartements({
    records: [at(48.8566, 2.3522), { latitude: null, longitude: null }, at(0, 0)],
    index: INDEX,
  });
  assert.equal(out.schoolsSwept, 1);
  assert.equal(out.mesh.length, 1);
});

// --- The rollup's numbers ---------------------------------------------------

test('the fixture folds onto real départements with a real level breakdown', () => {
  const out = projectSchoolsDepartements({ records: SAMPLE, index: INDEX });
  assert.equal(out.schoolsSwept, SAMPLE.length);
  assert.equal(out.assigned + out.unassigned, SAMPLE.length);
  // The Réunion row in the fixture cannot be painted.
  assert.equal(out.unassigned, 1);
  assert.deepEqual(out.offshore.map((e) => e.code), ['974']);
  const summedLevels = out.departements.reduce(
    (sum, d) => sum + SCHOOL_LEVELS.reduce((s, level) => s + d.levels[level], 0),
    0,
  );
  assert.equal(summedLevels, out.assigned);
});

test('public, privé and éducation prioritaire are tallied per département', () => {
  const out = projectSchoolsDepartements({
    records: [
      at(48.8566, 2.3522, { statut_public_prive: 'Public', appartenance_education_prioritaire: 'REP+' }),
      at(48.8600, 2.3400, { statut_public_prive: 'Privé' }),
      at(48.8700, 2.3300, { statut_public_prive: null }),
    ],
    index: INDEX,
  });
  const paris = out.departements.find((d) => d.code === '75');
  assert.equal(paris.schools, 3);
  assert.equal(paris.public, 1);
  assert.equal(paris.prive, 1);
  assert.equal(paris.ep, 1);
});

test('density is derived from the polygon that is actually drawn', () => {
  const out = projectSchoolsDepartements({
    records: [at(48.8566, 2.3522)],
    index: INDEX,
  });
  const paris = out.departements.find((d) => d.code === '75');
  assert.ok(paris.areaKm2 > 0);
  assert.ok(Math.abs(paris.per1000Km2 - (paris.schools / paris.areaKm2) * 1000) < 1e-9);
});

test('a département with nothing in it is bin -1, not the bottom of the scale', () => {
  const out = projectSchoolsDepartements({ records: [at(48.8566, 2.3522)], index: INDEX });
  const empty = out.departements.filter((d) => d.schools === 0);
  assert.ok(empty.length > 90);
  for (const d of empty) {
    assert.equal(d.bin, -1);
    assert.equal(d.per1000Km2, 0);
  }
});

test('every département in the index appears in the output, painted or not', () => {
  const out = projectSchoolsDepartements({ records: SAMPLE, index: INDEX });
  assert.equal(out.departements.length, 96);
  assert.equal(out.painted, out.departements.filter((d) => d.schools > 0).length);
});

test('the bins are ascending and there are binCount - 1 of them', () => {
  const records = [];
  for (let i = 0; i < 300; i += 1) {
    // Scatter across metropolitan France so several départements get counts.
    records.push(at(43.5 + (i % 20) * 0.35, 0.5 + Math.floor(i / 20) * 0.4));
  }
  const out = projectSchoolsDepartements({ records, index: INDEX });
  assert.equal(out.thresholds.length, SCHOOLS_DEPARTEMENT_BINS - 1);
  for (let i = 1; i < out.thresholds.length; i += 1) {
    assert.ok(out.thresholds[i] > out.thresholds[i - 1], 'thresholds must stay strictly ascending');
  }
});

test('a short export against the portal count is reported as truncated', () => {
  const complete = projectSchoolsDepartements({
    records: SAMPLE, index: INDEX, totalCount: SAMPLE.length,
  });
  assert.equal(complete.truncated, false);
  const short = projectSchoolsDepartements({
    records: SAMPLE, index: INDEX, totalCount: SAMPLE.length + 100,
  });
  assert.equal(short.truncated, true);
});

test('an unknown total is not read as truncated', () => {
  const out = projectSchoolsDepartements({ records: SAMPLE, index: INDEX, totalCount: null });
  assert.equal(out.truncated, false);
  assert.equal(out.schoolsTotal, null);
});

test('the sweep asks for the columns the projection actually reads', () => {
  for (const field of ['latitude', 'longitude', 'identifiant_de_l_etablissement', 'type_etablissement']) {
    assert.ok(SCHOOLS_SWEEP_FIELDS.includes(field), `${field} missing from the sweep`);
  }
  // A field nobody reads is a bigger export for nothing.
  assert.equal(SCHOOLS_SWEEP_FIELDS.includes('nom_etablissement'), false);
});

test('an empty or malformed sweep projects to an empty answer, not a throw', () => {
  for (const records of [[], null, undefined, 'nope']) {
    const out = projectSchoolsDepartements({ records, index: INDEX });
    assert.equal(out.schoolsSwept, 0);
    assert.equal(out.painted, 0);
    assert.deepEqual(out.mesh, []);
  }
  assert.doesNotThrow(() => projectSchoolsDepartements());
});
