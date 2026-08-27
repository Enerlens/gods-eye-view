// The national IRVE rollup — the sweep that has to be provably complete, and
// the fold onto the bundled département polygons.
//
// Two properties carry this file. The first is that Opendatasoft truncates an
// over-limit aggregated query SILENTLY — 20 000 rows, HTTP 200, no error — so
// "did we get everything" is a question only arithmetic can answer, and the
// national map is worthless without it. The second is that the polygons are
// metropolitan only, so an overseas charge point must be counted and named
// rather than folded into whichever département happens to be nearest.
//
// The polygons under test are the real bundled ones, not a fixture: the rollup
// is painted on that exact file, and a test against a copy could pass while
// the shipped shapes disagreed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildDepartementIndex,
  nearestDepartementWithin,
  irveCountBin,
  irveCountBins,
  locateDepartement,
  pointInRing,
  projectIrveDepartements,
  ringAreaKm2,
  sweepStripeTruncated,
  IRVE_COAST_SNAP_KM,
  IRVE_DEPARTEMENT_BINS,
  IRVE_SWEEP_FIELDS,
  IRVE_SWEEP_LIMIT,
  IRVE_SWEEP_MIN_SPAN_DEG,
  IRVE_SWEEP_SEED_SPAN_DEG,
} from './irveDepartements.js';

const GEOJSON = JSON.parse(readFileSync(
  new URL('./local_data/france_departements/departements.geojson', import.meta.url),
  'utf8',
));
const INDEX = buildDepartementIndex(GEOJSON);

/** A grouped sweep row, shaped exactly as the proxy hands it over. */
function group(lat, lon, overrides = {}) {
  return {
    consolidated_latitude: lat,
    consolidated_longitude: lon,
    puissance_nominale: 22,
    consolidated_is_lon_lat_correct: 'True',
    consolidated_commune: 'Quelque part',
    pdc: 1,
    ...overrides,
  };
}

// ── The silent-truncation defence ───────────────────────────────────────────

test('a stripe that reaches the limit is presumed truncated', () => {
  // Measured: the whole dataset grouped at limit=20000 returns 20 000 rows,
  // HTTP 200, no error field, summing to 71 125 of 231 079 charge points.
  // Reaching the limit is the ONLY signal Opendatasoft gives.
  assert.equal(sweepStripeTruncated(IRVE_SWEEP_LIMIT), true);
  assert.equal(sweepStripeTruncated(IRVE_SWEEP_LIMIT + 1), true);
  assert.equal(sweepStripeTruncated(IRVE_SWEEP_LIMIT - 1), false);
  assert.equal(sweepStripeTruncated(0), false);
});

test('the sweep limit stays under the API ceiling it was measured against', () => {
  // Opendatasoft: "Invalid value for sum of offset + limit ... <= 30000 is expected."
  assert.ok(IRVE_SWEEP_LIMIT <= 30000, String(IRVE_SWEEP_LIMIT));
  assert.ok(IRVE_SWEEP_MIN_SPAN_DEG > 0 && IRVE_SWEEP_MIN_SPAN_DEG < 1);
  assert.ok(IRVE_SWEEP_SEED_SPAN_DEG >= 1);
});

test('the sweep group key is the SHORT one, or the sweep cannot finish', () => {
  // Five columns come to 72 106 groups nationally. The viewport regime's
  // eighteen would come to several hundred thousand, which no number of
  // stripes gets under a 20 000-row cap.
  assert.equal(IRVE_SWEEP_FIELDS.length, 5);
  assert.ok(IRVE_SWEEP_FIELDS.includes('consolidated_latitude'));
  assert.ok(IRVE_SWEEP_FIELDS.includes('puissance_nominale'));
  // Both verification columns are needed or the national total would count
  // points the viewport regime withholds.
  assert.ok(IRVE_SWEEP_FIELDS.includes('consolidated_is_lon_lat_correct'));
  assert.ok(IRVE_SWEEP_FIELDS.includes('consolidated_commune'));
  assert.ok(!IRVE_SWEEP_FIELDS.includes('nom_station'));
});

test('a short sweep against the dataset own count is reported as truncated', () => {
  const projected = projectIrveDepartements({
    groups: [group(48.8566, 2.3522, { pdc: 10 })],
    index: INDEX,
    totalCount: 50,
  });
  assert.equal(projected.truncated, true);
  assert.equal(projected.pdcSwept, 10);
  assert.equal(projected.pdcTotal, 50);
});

test('a complete sweep is not, and a missing count is not either', () => {
  const rows = [group(48.8566, 2.3522, { pdc: 10 })];
  assert.equal(projectIrveDepartements({ groups: rows, index: INDEX, totalCount: 10 }).truncated, false);
  const noCount = projectIrveDepartements({ groups: rows, index: INDEX });
  assert.equal(noCount.truncated, false);
  assert.equal(noCount.pdcTotal, null);
});

// ── The bundled polygons ────────────────────────────────────────────────────

test('the bundled file is the 96 metropolitan départements, Corse included', () => {
  assert.equal(INDEX.list.length, 96);
  assert.ok(INDEX.byCode.has('2A') && INDEX.byCode.has('2B'), 'Corse must be present');
  assert.ok(INDEX.byCode.has('75') && INDEX.byCode.has('59'));
  // No DOM shapes: 971–976 are outside this file, which is why the rollup
  // reports them as unassigned instead of painting them.
  assert.ok(![...INDEX.byCode.keys()].some((code) => code.startsWith('97')));
});

test('a MultiPolygon département keeps a bbox per part', () => {
  // Ten départements carry islands. One bbox around Finistère plus Ouessant
  // would admit a large patch of sea as a candidate on every point tested.
  const multi = INDEX.list.filter((entry) => entry.parts.length > 1);
  assert.ok(multi.length >= 5, `${multi.length} multi-part départements`);
  for (const entry of multi) {
    for (const part of entry.parts) {
      assert.ok(part.bbox[2] - part.bbox[0] <= entry.bbox[2] - entry.bbox[0] + 1e-9, entry.code);
    }
  }
});

test('polygon areas land within a few percent of the published ones', () => {
  // Simplified geometry, so this is the area of the shape that is DRAWN — but
  // it has to be close enough that a per-1 000 km² figure is not a fiction.
  const expect = { '75': 105, '48': 5167, '33': 10000, '02': 7369, '90': 609 };
  for (const [code, km2] of Object.entries(expect)) {
    const measured = INDEX.byCode.get(code).areaKm2;
    const drift = Math.abs(measured - km2) / km2;
    assert.ok(drift < 0.06, `${code}: ${Math.round(measured)} km² vs ${km2} (${(drift * 100).toFixed(1)}%)`);
  }
});

test('a ring with fewer than four points has no area', () => {
  assert.equal(ringAreaKm2([[0, 0], [1, 0], [0, 0]]), 0);
  assert.equal(ringAreaKm2(null), 0);
  assert.ok(ringAreaKm2([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]) > 10000);
});

test('the ray cast closes the ring it is handed', () => {
  const square = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]];
  assert.equal(pointInRing(1, 1, square), true);
  assert.equal(pointInRing(3, 1, square), false);
  assert.equal(pointInRing(1, 3, square), false);
});

// ── Locating a coordinate ───────────────────────────────────────────────────

test('real French coordinates resolve to the right département', () => {
  const cases = [
    [48.8566, 2.3522, '75', 'Paris'],
    [45.7640, 4.8357, '69', 'Lyon'],
    [43.2965, 5.3698, '13', 'Marseille'],
    [44.8378, -0.5792, '33', 'Bordeaux'],
    [48.5734, 7.7521, '67', 'Strasbourg'],
    [42.7028, 9.4509, '2B', 'Bastia'],
    [48.8915, 2.2420, '92', 'La Défense'],
  ];
  for (const [lat, lon, code, name] of cases) {
    assert.equal(locateDepartement(INDEX, lat, lon), code, name);
  }
});

test('a coordinate outside metropolitan France resolves to nothing', () => {
  // Overseas départements, and the two places this dataset actually puts
  // French charge points by mistake.
  assert.equal(locateDepartement(INDEX, -20.8823, 55.4504), null, 'Saint-Denis de La Réunion');
  assert.equal(locateDepartement(INDEX, 16.2650, -61.5510), null, 'Guadeloupe');
  assert.equal(locateDepartement(INDEX, -44.9962, 44.9962), null, 'south of Madagascar');
  assert.equal(locateDepartement(INDEX, 51.5074, -0.1278), null, 'London');
  assert.equal(locateDepartement(INDEX, 0, 0), null, 'Null Island');
});

// ── The simplified coastline, and the 2 km that repairs it ─────────────────

test('a point the simplified coastline left in the sea snaps to its département', () => {
  // Corse-du-Sud is 152 vertices for the whole island, so the Gulf of Ajaccio
  // is cut straight across and the centre of Ajaccio is offshore.
  assert.equal(locateDepartement(INDEX, 41.9192, 8.7386), null, 'Ajaccio is outside the simplified shape');
  const ajaccio = nearestDepartementWithin(INDEX, 41.9192, 8.7386);
  assert.equal(ajaccio.code, '2A');
  assert.ok(ajaccio.km < 0.5, `${ajaccio.km} km`);
  assert.equal(nearestDepartementWithin(INDEX, 43.584048, 7.125391).code, '06', 'Antibes');
  assert.equal(nearestDepartementWithin(INDEX, 46.159848, -1.220784).code, '17', 'La Rochelle');
});

test('the snap cannot reach a foreign station, which is the whole point of 2 km', () => {
  // Measured: 601 of the 886 stranded charge points are within 500 m of a
  // boundary and 778 within 2 km, then a gap — everything past 5 km is in
  // Belgium, Luxembourg or Germany.
  assert.equal(IRVE_COAST_SNAP_KM, 2);
  assert.equal(nearestDepartementWithin(INDEX, 49.5836, 6.1230), null, 'Luxembourg');
  assert.equal(nearestDepartementWithin(INDEX, 50.6801, 5.0808), null, 'Belgium');
  assert.equal(nearestDepartementWithin(INDEX, 50.4279, 6.2032), null, 'Germany');
  assert.equal(nearestDepartementWithin(INDEX, -20.8823, 55.4504), null, 'La Réunion');
});

test('a snapped charge point is counted where it landed AND declared as moved', () => {
  const projected = projectIrveDepartements({
    groups: [
      group(41.9192, 8.7386, { pdc: 9 }),      // Ajaccio, 60 m offshore
      group(48.8566, 2.3522, { pdc: 4 }),      // Paris, inside
      group(50.6801, 5.0808, { pdc: 6 }),      // Belgium, out of reach
    ],
    index: INDEX,
    totalCount: 19,
  });
  assert.equal(projected.departements.find((row) => row.code === '2A').pdc, 9);
  assert.equal(projected.pdcSnapped, 9);
  assert.equal(projected.pdcUnassigned, 6);
  assert.equal(projected.pdcAssigned, 13);
});

test('a zero tolerance turns the snap off entirely', () => {
  const projected = projectIrveDepartements({
    groups: [group(41.9192, 8.7386, { pdc: 9 })],
    index: INDEX,
    snapKm: 0,
  });
  assert.equal(projected.pdcSnapped, 0);
  assert.equal(projected.pdcUnassigned, 9);
});

test('an unusable coordinate is refused rather than coerced', () => {
  assert.equal(locateDepartement(INDEX, NaN, 2), null);
  assert.equal(locateDepartement(INDEX, 48.85, undefined), null);
  assert.equal(locateDepartement(null, 48.85, 2.35), null);
});

// ── The fold ────────────────────────────────────────────────────────────────

test('charge points land in their département with their band split', () => {
  const projected = projectIrveDepartements({
    groups: [
      group(48.8566, 2.3522, { pdc: 40, puissance_nominale: 7 }),
      group(48.8600, 2.3400, { pdc: 10, puissance_nominale: 300 }),
      group(45.7640, 4.8357, { pdc: 25, puissance_nominale: 22 }),
    ],
    index: INDEX,
    totalCount: 75,
  });
  const paris = projected.departements.find((row) => row.code === '75');
  assert.equal(paris.pdc, 50);
  assert.equal(paris.sites, 2);
  assert.equal(paris.bands.lente, 40);
  assert.equal(paris.bands.hpc, 10);
  const rhone = projected.departements.find((row) => row.code === '69');
  assert.equal(rhone.pdc, 25);
  assert.equal(rhone.bands.normale, 25);
  assert.equal(projected.pdcAssigned, 75);
  assert.equal(projected.painted, 2);
});

test('every département is present in the answer, even the empty ones', () => {
  // The map paints 96 shapes or none: a département missing from the payload
  // would be indistinguishable from one the sweep lost.
  const projected = projectIrveDepartements({ groups: [group(48.8566, 2.3522)], index: INDEX });
  assert.equal(projected.departements.length, 96);
  assert.equal(projected.departements.filter((row) => row.pdc === 0).length, 95);
});

test('an overseas charge point is counted and named, never folded into a neighbour', () => {
  const projected = projectIrveDepartements({
    groups: [
      group(48.8566, 2.3522, { pdc: 5 }),
      group(-20.8823, 55.4504, { pdc: 7 }),   // La Réunion
      group(16.2650, -61.5510, { pdc: 3 }),   // Guadeloupe
    ],
    index: INDEX,
    totalCount: 15,
  });
  assert.equal(projected.pdcUnassigned, 10);
  assert.equal(projected.pdcAssigned, 5);
  assert.equal(projected.truncated, false);
});

test('the national fold applies the SAME coordinate verdict as a city view', () => {
  // Otherwise a département total and the dots inside it would disagree, and
  // both would look right.
  const projected = projectIrveDepartements({
    groups: [
      group(48.8566, 2.3522, { pdc: 5 }),
      // Contradicts its own verified commune — withheld, exactly as the
      // viewport regime withholds it.
      group(-44.9962, 44.9962, { pdc: 4, consolidated_is_lon_lat_correct: 'False', consolidated_commune: 'Le Porge' }),
      // Not verifiable, which is not the same thing — kept.
      group(45.7640, 4.8357, { pdc: 6, consolidated_is_lon_lat_correct: 'False', consolidated_commune: null }),
      group(0, 0, { pdc: 2, consolidated_commune: 'Villefranche-sur-Saône' }),
    ],
    index: INDEX,
    totalCount: 17,
  });
  assert.equal(projected.pdcWithheld, 4);
  assert.equal(projected.pdcInvalid, 2);
  assert.equal(projected.pdcAssigned, 11);
  assert.equal(projected.pdcSwept, 17);
  assert.equal(projected.truncated, false);
});

test('every swept charge point is accounted for in exactly one bucket', () => {
  const projected = projectIrveDepartements({
    groups: [
      group(48.8566, 2.3522, { pdc: 5 }),
      group(-20.8823, 55.4504, { pdc: 7 }),
      group(-44.9962, 44.9962, { pdc: 4, consolidated_is_lon_lat_correct: 'False', consolidated_commune: 'Le Porge' }),
      group(0, 0, { pdc: 2, consolidated_commune: 'Ajaccio' }),
    ],
    index: INDEX,
  });
  assert.equal(
    projected.pdcAssigned + projected.pdcUnassigned + projected.pdcWithheld + projected.pdcInvalid,
    projected.pdcSwept,
  );
  // pdcSnapped is a SUBSET of pdcAssigned, not a fifth bucket — adding it
  // would double-count, which is exactly the mistake it exists to make visible.
  assert.ok(projected.pdcSnapped <= projected.pdcAssigned);
});

test('a coordinate is located once however many groups sit on it', () => {
  // Q-Park's car park is eight grouped rows on one point; the ray cast runs
  // once for it, and the site count says one.
  const projected = projectIrveDepartements({
    groups: Array.from({ length: 8 }, () => group(48.891554, 2.242018, { pdc: 28 })),
    index: INDEX,
  });
  assert.equal(projected.siteCount, 1);
  assert.equal(projected.departements.find((row) => row.code === '92').sites, 1);
  assert.equal(projected.departements.find((row) => row.code === '92').pdc, 224);
});

test('density is derived from the polygon that is actually drawn', () => {
  const projected = projectIrveDepartements({
    groups: [group(48.8566, 2.3522, { pdc: 1050 })],
    index: INDEX,
  });
  const paris = projected.departements.find((row) => row.code === '75');
  assert.ok(paris.areaKm2 > 90 && paris.areaKm2 < 120, `${paris.areaKm2} km²`);
  assert.ok(Math.abs(paris.per1000Km2 - (1050 / paris.areaKm2) * 1000) < 1);
});

// ── The quantile scale ──────────────────────────────────────────────────────

test('quantile bins split the distribution, where a linear scale would not', () => {
  // Measured nationally: 227 (Lozère) → 10 539 (Paris). On a linear ramp Paris
  // alone occupies the top fifth and 90 départements share the bottom one.
  const counts = [227, 339, 364, 384, 456, 700, 900, 1400, 1900, 2500, 4000, 10539];
  const bins = irveCountBins(counts, 6);
  assert.equal(bins.length, 5);
  for (let i = 1; i < bins.length; i += 1) assert.ok(bins[i] > bins[i - 1], bins.join(','));
  const assigned = counts.map((count) => irveCountBin(count, bins));
  assert.equal(new Set(assigned).size, 6, `every bin used: ${assigned.join(',')}`);
  assert.equal(irveCountBin(10539, bins), 5);
  assert.equal(irveCountBin(227, bins), 0);
});

test('a département with nothing in it gets no bin, and no colour', () => {
  const bins = irveCountBins([10, 20, 30], 6);
  assert.equal(irveCountBin(0, bins), -1);
  assert.equal(irveCountBin(null, bins), -1);
  assert.equal(irveCountBin(-5, bins), -1);
});

test('ties cannot collapse two thresholds into one unreachable bin', () => {
  const bins = irveCountBins(new Array(40).fill(7), 6);
  assert.equal(bins.length, 5);
  for (let i = 1; i < bins.length; i += 1) assert.ok(bins[i] > bins[i - 1], bins.join(','));
});

test('an empty distribution still yields a usable scale', () => {
  assert.deepEqual(irveCountBins([], 6), [0, 0, 0, 0, 0]);
  assert.equal(IRVE_DEPARTEMENT_BINS, 6);
});

test('an empty or malformed sweep projects to an empty answer, not a throw', () => {
  for (const input of [undefined, {}, { groups: null }, { groups: [], index: INDEX }, { groups: [{}] }]) {
    const projected = projectIrveDepartements(input);
    assert.equal(projected.pdcAssigned, 0);
    assert.equal(projected.painted, 0);
  }
});
