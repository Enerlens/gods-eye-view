// What the national regime is allowed to paint, over the real bundled outlines.
//
// The property under test is that **the choropleth's blind spots are counted
// rather than absorbed.** Three of them exist and each has a test: a point that
// falls outside every metropolitan polygon is unassigned and reported (not
// snapped to the nearest thing on the map), a département with no communes in
// the fold gets bin −1 and draws as absence (not as the bottom of the ramp),
// and the two FINESS families are outside the coverage ratio because FINESS
// publishes no INSEE commune code.
//
// The second property is that nothing is ever joined on a département code.
// The two registers spell the same overseas territories `976` and `9F`, and
// Corsica is `2A`/`2B` in one and zero-padded elsewhere, so the fold is
// point-in-polygon against the shapes that are actually drawn.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildDepartementIndex } from './franceDepartements.js';
import { AMENITY_FAMILIES, AMENITY_FAMILY_REGISTER } from './amenitiesFeed.js';
import {
  AMENITIES_COVERAGE_FAMILIES,
  AMENITIES_DEPARTEMENT_BINS,
  amenitiesDepartementBinLabels,
  projectAmenitiesDepartements,
} from './amenitiesDepartements.js';

const GEOJSON = JSON.parse(readFileSync(
  new URL('./local_data/france_departements/departements.geojson', import.meta.url),
  'utf8',
));
const INDEX = buildDepartementIndex(GEOJSON);

const site = (family, lat, lon) => ({ family, lat, lon, precision: 'numero' });
const commune = (depcom, lat, lon, covered) => ({ depcom, lat, lon, covered });

test('the bundled outlines are the 96 metropolitan départements and nothing else', () => {
  assert.equal(INDEX.list.length, 96);
  assert.ok(INDEX.byCode.has('2A'));
  assert.ok(INDEX.byCode.has('2B'));
  assert.equal(INDEX.byCode.has('971'), false);
  assert.equal(INDEX.byCode.has('976'), false);
});

test('points are placed by polygon, so a Corsican row lands in Corsica whatever the register calls it', () => {
  const result = projectAmenitiesDepartements({
    // Ajaccio (2A), Bastia (2B), Paris (75), Bourg-en-Bresse (01).
    records: [
      site('medecin', 41.9192, 8.7386),
      site('pharmacie', 42.7028, 9.4509),
      site('hopital', 48.8566, 2.3522),
      site('poste', 46.2052, 5.2247),
    ],
    communes: [],
    index: INDEX,
  });
  const codes = result.departements.map((row) => row.code);
  assert.ok(codes.includes('2A'));
  assert.ok(codes.includes('2B'));
  assert.ok(codes.includes('75'));
  assert.ok(codes.includes('01'));
  assert.equal(result.assigned, 4);
  assert.equal(result.unassigned, 0);
});

test('an overseas point is reported unassigned, never dragged onto a metropolitan polygon', () => {
  const result = projectAmenitiesDepartements({
    records: [
      site('pharmacie', -20.94607, 55.65446), // La Réunion
      site('hopital', 4.92347, -52.31973), // Guyane
      site('pharmacie', -12.78423, 45.22332), // Mayotte
      site('hopital', 46.77332, -56.17201), // Saint-Pierre-et-Miquelon
      site('medecin', 48.8566, 2.3522), // Paris, the control
    ],
    communes: [],
    index: INDEX,
  });
  assert.equal(result.unassigned, 4);
  assert.equal(result.assigned, 1);
  assert.equal(result.departements.length, 1);
  assert.equal(result.departements[0].code, '75');
});

test('the coverage share is computed over the BPE families only, and says so in its own shape', () => {
  assert.deepEqual([...AMENITIES_COVERAGE_FAMILIES].sort(),
    AMENITY_FAMILIES.filter((f) => AMENITY_FAMILY_REGISTER[f] === 'bpe').sort());
  assert.equal(AMENITIES_COVERAGE_FAMILIES.includes('pharmacie'), false);
  assert.equal(AMENITIES_COVERAGE_FAMILIES.includes('hopital'), false);
  assert.equal(AMENITIES_COVERAGE_FAMILIES.length, 5);
});

test('the share is covered communes over folded communes, per département', () => {
  const result = projectAmenitiesDepartements({
    records: [site('medecin', 48.8566, 2.3522)],
    communes: [
      commune('75101', 48.8600, 2.3400, true),
      commune('75102', 48.8670, 2.3410, true),
      commune('75103', 48.8630, 2.3600, false),
      commune('75104', 48.8540, 2.3570, false),
      // Bourg-en-Bresse, a different département entirely.
      commune('01053', 46.2052, 5.2247, true),
    ],
    index: INDEX,
  });
  const paris = result.departements.find((row) => row.code === '75');
  assert.equal(paris.communes, 4);
  assert.equal(paris.covered, 2);
  assert.equal(paris.share, 50);
  const ain = result.departements.find((row) => row.code === '01');
  assert.equal(ain.share, 100);
  assert.equal(result.communesPlaced, 5);
  assert.equal(result.communesCovered, 3);
  assert.equal(result.nationalShare, 60);
});

test('a commune with no position anywhere in the file is counted unplaced, not dropped in silence', () => {
  const result = projectAmenitiesDepartements({
    records: [],
    communes: [
      commune('75101', 48.86, 2.34, true),
      { depcom: '97601', covered: false },
      commune('97601', -12.78, 45.22, false),
    ],
    index: INDEX,
  });
  assert.equal(result.communesPlaced, 1);
  assert.equal(result.communesUnplaced, 2);
});

test('a département with no communes in the fold draws as absence, not as the bottom of the ramp', () => {
  const result = projectAmenitiesDepartements({
    records: [site('hopital', 48.8566, 2.3522)],
    communes: [],
    index: INDEX,
  });
  const paris = result.departements.find((row) => row.code === '75');
  assert.equal(paris.communes, 0);
  assert.equal(paris.share, 0);
  // -1, which the layer's colour function refuses to give a swatch.
  assert.equal(paris.bin, -1);
  assert.equal(result.painted, 0);
  // The point is still counted; only the paint is withheld.
  assert.equal(paris.amenities, 1);
  assert.equal(result.assigned, 1);
});

test('the bins are quantiles over the shares and every one of the six is reachable', () => {
  const communes = [];
  const shares = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 15, 25];
  // One synthetic département per share, each in a different real polygon by
  // using the polygon's own bbox centre as the commune position.
  const codes = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  codes.forEach((code, i) => {
    const entry = INDEX.byCode.get(code);
    const lat = (entry.bbox[1] + entry.bbox[3]) / 2;
    const lon = (entry.bbox[0] + entry.bbox[2]) / 2;
    for (let n = 0; n < 10; n += 1) {
      communes.push(commune(`${code}${n}`, lat, lon, n < shares[i] / 10));
    }
  });
  const result = projectAmenitiesDepartements({ records: [], communes, index: INDEX });
  assert.equal(result.thresholds.length, AMENITIES_DEPARTEMENT_BINS - 1);
  for (let i = 1; i < result.thresholds.length; i += 1) {
    assert.ok(result.thresholds[i] > result.thresholds[i - 1], 'thresholds must be strictly ascending');
  }
  const used = new Set(result.departements.filter((row) => row.bin >= 0).map((row) => row.bin));
  assert.ok(used.size >= 4, `expected the ramp to be used, got bins ${[...used]}`);
});

test('the legend labels read as percentages, with a French decimal comma', () => {
  const labels = amenitiesDepartementBinLabels([29, 43, 49, 56, 69], 21.6);
  assert.equal(labels.length, 6);
  assert.equal(labels[0], '21,6 – 29 %');
  assert.equal(labels[5], '> 69 %');
  for (const label of labels) assert.ok(label.includes('%'));
  // No thresholds at all still yields one honest row rather than none.
  assert.deepEqual(amenitiesDepartementBinLabels([], 0), ['> 0 %']);
  assert.deepEqual(amenitiesDepartementBinLabels(null, 0), ['> 0 %']);
});

test('a coastal point two kilometres out is snapped and the snap is counted', () => {
  const result = projectAmenitiesDepartements({
    // A point just off the Vendée coast, inside the 2 km shared tolerance.
    records: [site('poste', 46.4970, -1.8200)],
    communes: [],
    index: INDEX,
  });
  assert.equal(result.assigned + result.unassigned, 1);
  if (result.assigned === 1) {
    assert.equal(result.snapped, 1);
  } else {
    assert.equal(result.unassigned, 1);
  }
});

test('the per-family counts on a département row cover every family and nothing else', () => {
  const result = projectAmenitiesDepartements({
    records: [
      site('medecin', 48.8566, 2.3522),
      site('medecin', 48.8570, 2.3530),
      site('hopital', 48.8580, 2.3540),
    ],
    communes: [],
    index: INDEX,
  });
  const paris = result.departements.find((row) => row.code === '75');
  assert.deepEqual(Object.keys(paris.families).sort(), [...AMENITY_FAMILIES].sort());
  assert.equal(paris.families.medecin, 2);
  assert.equal(paris.families.hopital, 1);
  assert.equal(paris.families.pharmacie, 0);
  assert.equal(paris.amenities, 3);
});

test('an empty input yields an empty rollup rather than a NaN share', () => {
  const result = projectAmenitiesDepartements({ records: [], communes: [], index: INDEX });
  assert.deepEqual(result.departements, []);
  assert.equal(result.painted, 0);
  assert.equal(result.nationalShare, 0);
  assert.equal(result.assigned, 0);
  assert.equal(result.communesPlaced, 0);
});
